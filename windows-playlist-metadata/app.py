from __future__ import annotations

import base64
import ctypes
import json
import os
import re
import shutil
import threading
import tkinter as tk
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from collections import Counter
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

from mutagen.id3 import ID3, ID3NoHeaderError, TALB, TDRC, TIT2, TPE1, TPE2, TRCK


APP_NAME = "Greek MP3 Metadata"
APP_VERSION = "1.1"
DISCOGS_API = "https://api.discogs.com"
DISCOGS_SITE = "https://www.discogs.com"
INVALID_FILENAME = re.compile(r'[<>:"/\\|?*\x00-\x1f]')

WORD_DICTIONARY = {
    "oi": "Οι", "zoes": "Ζωές", "oson": "Όσων", "mas": "Μας", "me": "Με", "niothoun": "Νιώθουν",
    "agnwstos": "Άγνωστος", "xeimwnas": "Χειμώνας", "sta": "Στα", "vimata": "Βήματα", "tou": "Του", "iskiou": "Ίσκιου",
    "exo": "Έξω", "ekso": "Έξω", "ap": "Απ'", "ta": "Τα", "dontia": "Δόντια", "omorfi": "Όμορφη",
    "poli": "Πόλη", "akri": "Άκρη", "ena": "Ένα", "ennia": "Εννιά", "kai": "Και", "ogdontatria": "Ογδοντατρία",
    "anemos": "Άνεμος", "apla": "Απλά", "koita": "Κοίτα", "psila": "Ψηλά", "ela": "Έλα", "mia": "Μια",
    "volta": "Βόλτα", "o": "Ο", "i": "Η", "kairos": "Καιρός", "tis": "Της", "siopis": "Σιωπής", "xroma": "Χρώμα",
    "en": "Εν", "ptisi": "Πτήση", "ti": "Τι", "na": "Να", "mou": "Μου", "peis": "Πεις", "ki": "Κι", "esy": "Εσύ",
    "gia": "Για", "mena": "Μένα", "arrostis": "Άρρωστης", "eikonas": "Εικόνας", "pairno": "Παίρνω",
    "anapnoi": "Αναπνοή", "meros": "Μέρος", "foteino": "Φωτεινό", "dio": "Δυο", "logia": "Λόγια",
    "mono": "Μόνο", "sanatorio": "Σανατόριο", "de": "Δε", "ksexno": "Ξεχνώ", "zoume": "Ζούμε",
    "epikindinos": "Επικίνδυνος", "omixli": "Ομίχλη", "otan": "Όταν", "fevgo": "Φεύγω", "eksodos": "Έξοδος",
}

PHRASE_CORRECTIONS = {
    "oi zoes oson me niothoun": "Οι Ζωές Όσων Μας Νιώθουν",
}

PAIR_MAP = (
    ("th", "θ"), ("ps", "ψ"), ("ch", "χ"), ("ks", "ξ"), ("ou", "ου"),
    ("mp", "μπ"), ("nt", "ντ"), ("gk", "γκ"), ("tz", "τζ"), ("ts", "τσ"),
)

LETTER_MAP = {
    "a": "α", "b": "β", "c": "κ", "d": "δ", "e": "ε", "f": "φ", "g": "γ", "h": "η", "i": "ι",
    "j": "τζ", "k": "κ", "l": "λ", "m": "μ", "n": "ν", "o": "ο", "p": "π", "q": "κ", "r": "ρ",
    "s": "σ", "t": "τ", "u": "υ", "v": "β", "w": "ω", "x": "χ", "y": "υ", "z": "ζ",
}


@dataclass
class Track:
    source: Path
    number: int
    title: str
    artist: str
    album: str
    release_date: str
    original_artist: str = ""
    original_album: str = ""


@dataclass
class DiscogsTrack:
    number: int
    title: str
    artist: str = ""


@dataclass
class DiscogsRelease:
    release_id: int
    artist: str
    title: str
    year: str
    tracks: list[DiscogsTrack]
    score: int = 0

    @property
    def url(self) -> str:
        return f"{DISCOGS_SITE}/release/{self.release_id}"


class DataBlob(ctypes.Structure):
    _fields_ = [("cbData", ctypes.c_ulong), ("pbData", ctypes.POINTER(ctypes.c_byte))]


def config_path() -> Path:
    base = Path(os.environ.get("APPDATA") or Path.home() / "AppData" / "Roaming")
    return base / APP_NAME / "config.json"


def _blob(value: bytes) -> tuple[DataBlob, ctypes.Array[ctypes.c_char]]:
    buffer = ctypes.create_string_buffer(value)
    return DataBlob(len(value), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_byte))), buffer


def protect_token(token: str) -> str:
    if os.name != "nt":
        return base64.b64encode(token.encode("utf-8")).decode("ascii")
    source, source_buffer = _blob(token.encode("utf-8"))
    output = DataBlob()
    if not ctypes.windll.crypt32.CryptProtectData(
        ctypes.byref(source), APP_NAME, None, None, None, 0, ctypes.byref(output)
    ):
        raise ctypes.WinError()
    try:
        return base64.b64encode(ctypes.string_at(output.pbData, output.cbData)).decode("ascii")
    finally:
        ctypes.windll.kernel32.LocalFree(output.pbData)
        del source_buffer


def unprotect_token(value: str) -> str:
    encrypted = base64.b64decode(value)
    if os.name != "nt":
        return encrypted.decode("utf-8")
    source, source_buffer = _blob(encrypted)
    output = DataBlob()
    if not ctypes.windll.crypt32.CryptUnprotectData(
        ctypes.byref(source), None, None, None, None, 0, ctypes.byref(output)
    ):
        raise ctypes.WinError()
    try:
        return ctypes.string_at(output.pbData, output.cbData).decode("utf-8")
    finally:
        ctypes.windll.kernel32.LocalFree(output.pbData)
        del source_buffer


def load_discogs_token(path: Path | None = None) -> str:
    target = path or config_path()
    try:
        payload = json.loads(target.read_text(encoding="utf-8"))
        return unprotect_token(str(payload.get("discogs_token", "")))
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return ""


def save_discogs_token(token: str, path: Path | None = None) -> None:
    target = path or config_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps({"discogs_token": protect_token(token.strip())}), encoding="utf-8")


def greeklish_to_greek(value: str) -> str:
    source = str(value or "").strip()
    if not source or re.search(r"[α-ωάέήίόύώϊϋΐΰ]", source, re.I):
        return source
    phrase_key = re.sub(r"[^a-z0-9]+", " ", source.lower()).strip()
    if phrase_key in PHRASE_CORRECTIONS:
        return PHRASE_CORRECTIONS[phrase_key]

    def convert_word(match: re.Match[str]) -> str:
        word = match.group(0)
        lower = word.lower()
        if lower in WORD_DICTIONARY:
            return WORD_DICTIONARY[lower]
        prepared = lower
        for latin, greek in PAIR_MAP:
            prepared = prepared.replace(latin, greek)
        converted = "".join(LETTER_MAP.get(char, char) for char in prepared)
        if converted.endswith("σ"):
            converted = converted[:-1] + "ς"
        return converted[:1].upper() + converted[1:] if word[:1].isupper() else converted

    converted = re.sub(r"[a-z]+", convert_word, source, flags=re.I)
    converted = converted.replace("''", "'")
    return re.sub(r"'(?=[Α-ΩΆΈΉΊΌΎΏ])", "' ", converted)


def normalize_discogs_text(value: object) -> str:
    normalized = unicodedata.normalize("NFD", str(value or "").casefold())
    normalized = "".join(char for char in normalized if unicodedata.category(char) != "Mn")
    normalized = normalized.replace("ς", "σ")
    return re.sub(r"[^a-z0-9α-ω]+", " ", normalized).strip()


def discogs_position_number(position: object, fallback: int) -> int:
    value = str(position or "").strip()
    match = re.search(r"(?:^|[-.])(?:cd)?(\d{1,3})$", value, re.I)
    if not match:
        match = re.fullmatch(r"(\d{1,3})", value)
    return int(match.group(1)) if match else fallback


def _discogs_artist_name(value: object) -> str:
    return re.sub(r"\s+\(\d+\)$", "", str(value or "")).strip()


def parse_discogs_release(payload: dict) -> DiscogsRelease:
    release_artist = _discogs_artist_name(payload.get("artists_sort"))
    if not release_artist:
        release_artist = ", ".join(
            filter(None, (_discogs_artist_name(item.get("name")) for item in payload.get("artists", []) if isinstance(item, dict)))
        )
    tracks: list[DiscogsTrack] = []
    for item in payload.get("tracklist", []):
        if not isinstance(item, dict) or item.get("type_", "track") not in ("", "track"):
            continue
        title = str(item.get("title") or "").strip()
        if not title:
            continue
        track_artists = ", ".join(
            filter(None, (_discogs_artist_name(artist.get("name")) for artist in item.get("artists", []) if isinstance(artist, dict)))
        )
        tracks.append(DiscogsTrack(
            discogs_position_number(item.get("position"), len(tracks) + 1),
            title,
            track_artists or release_artist,
        ))
    return DiscogsRelease(
        release_id=int(payload.get("id") or 0),
        artist=release_artist or "Άγνωστος καλλιτέχνης",
        title=str(payload.get("title") or "").strip(),
        year=str(payload.get("year") or "").strip(),
        tracks=tracks,
    )


def score_discogs_release(
    release: DiscogsRelease,
    artist: str,
    album: str,
    year: str,
    track_count: int,
    original_artist: str = "",
    original_album: str = "",
) -> int:
    def similarity(left: str, right: str) -> float:
        a, b = normalize_discogs_text(left), normalize_discogs_text(right)
        if not a or not b:
            return 0.0
        if a in b or b in a:
            return 1.0
        return SequenceMatcher(None, a, b).ratio()

    title_score = max(similarity(album, release.title), similarity(original_album, release.title))
    known_artists = [
        value for value in (artist, original_artist)
        if value and "αγνωστοσ" not in normalize_discogs_text(value)
    ]
    artist_score = max((similarity(value, release.artist) for value in known_artists), default=0.65)
    if track_count and release.tracks:
        difference = abs(track_count - len(release.tracks))
        count_score = max(0.0, 1.0 - difference / max(track_count, len(release.tracks)))
    else:
        count_score = 0.5
    year_score = 1.0 if not year else (1.0 if release.year == year else 0.0)
    return round(100 * (0.45 * title_score + 0.25 * artist_score + 0.20 * count_score + 0.10 * year_score))


def align_discogs_tracks(tracks: list[Track], release: DiscogsRelease) -> list[tuple[Track, DiscogsTrack]]:
    by_number: dict[int, DiscogsTrack] = {}
    duplicate_numbers: set[int] = set()
    for item in release.tracks:
        if item.number in by_number:
            duplicate_numbers.add(item.number)
        else:
            by_number[item.number] = item
    if duplicate_numbers:
        for number in duplicate_numbers:
            by_number.pop(number, None)

    aligned: list[tuple[Track, DiscogsTrack]] = []
    used: set[int] = set()
    for index, track in enumerate(tracks):
        item = by_number.get(track.number)
        if item is None and len(tracks) == len(release.tracks) and index < len(release.tracks):
            item = release.tracks[index]
        if item is not None and id(item) not in used:
            aligned.append((track, item))
            used.add(id(item))
    return aligned


class DiscogsClient:
    def __init__(self, token: str, timeout: int = 12) -> None:
        self.token = token.strip()
        self.timeout = timeout

    def request(self, endpoint: str) -> dict:
        request = urllib.request.Request(
            f"{DISCOGS_API}{endpoint}",
            headers={
                "Accept": "application/vnd.discogs.v2.discogs+json",
                "Authorization": f"Discogs token={self.token}",
                "User-Agent": f"GreekMP3Metadata/{APP_VERSION}",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            if error.code == 401:
                raise ValueError("Το Discogs token δεν είναι έγκυρο.") from error
            if error.code == 429:
                raise ValueError("Το όριο αιτημάτων του Discogs εξαντλήθηκε. Δοκίμασε ξανά αργότερα.") from error
            raise ValueError(f"Το Discogs επέστρεψε σφάλμα HTTP {error.code}.") from error
        except (urllib.error.URLError, TimeoutError) as error:
            raise ValueError("Δεν ήταν δυνατή η σύνδεση με το Discogs.") from error

    def search(
        self,
        artist: str,
        album: str,
        year: str,
        track_count: int,
        original_artist: str = "",
        original_album: str = "",
    ) -> list[DiscogsRelease]:
        queries: list[dict[str, str]] = [
            {"type": "release", "artist": artist, "release_title": album, "per_page": "12"},
            {"type": "release", "q": f"{artist} {album}".strip(), "per_page": "12"},
        ]
        if original_artist or original_album:
            queries.extend([
                {
                    "type": "release",
                    "artist": original_artist or artist,
                    "release_title": original_album or album,
                    "per_page": "12",
                },
                {
                    "type": "release",
                    "q": f"{original_artist or artist} {original_album or album}".strip(),
                    "per_page": "12",
                },
            ])
        # Discogs does not reliably match Greek titles entered as Greeklish or
        # as an accent-free phonetic conversion. Artist + year is a useful,
        # narrow fallback; the fetched releases are still ranked by title and
        # track count before the user is allowed to apply one.
        if year:
            for candidate_artist in dict.fromkeys(filter(None, (original_artist, artist))):
                queries.extend([
                    {
                        "type": "release",
                        "artist": candidate_artist,
                        "year": year,
                        "per_page": "24",
                    },
                    {
                        "type": "release",
                        "q": f"{candidate_artist} {year}",
                        "per_page": "24",
                    },
                ])
        if year:
            queries[0]["year"] = year
        ids: list[int] = []
        for query in queries:
            payload = self.request(f"/database/search?{urllib.parse.urlencode(query)}")
            for result in payload.get("results", []):
                try:
                    release_id = int(result.get("id"))
                except (TypeError, ValueError):
                    continue
                if release_id not in ids:
                    ids.append(release_id)
            if len(ids) >= 8:
                break

        releases: list[DiscogsRelease] = []
        for release_id in ids[:8]:
            release = parse_discogs_release(self.request(f"/releases/{release_id}"))
            release.score = score_discogs_release(
                release,
                artist,
                album,
                year,
                track_count,
                original_artist=original_artist,
                original_album=original_album,
            )
            if release.tracks:
                releases.append(release)
        return sorted(releases, key=lambda item: (-item.score, abs(len(item.tracks) - track_count), item.release_id))


def clean_title(value: str) -> str:
    source = re.sub(r"\.(?:mp3|flac|m4a|aac|ogg|wav)$", "", str(value or ""), flags=re.I)
    source = source.replace("_", " ")
    return re.sub(r"\s+", " ", re.sub(r"^\s*\d{1,3}\s*[.\-_)]+\s*", "", source)).strip()


def track_number(tag_value: str, filename: str, fallback: int) -> int:
    match = re.match(r"\s*(\d{1,3})", str(tag_value or "")) or re.match(r"\s*(\d{1,3})\s*[.\-_)]+", filename)
    return int(match.group(1)) if match else fallback


def release_year(value: str, folder_name: str = "") -> str:
    match = re.search(r"\b((?:19|20)\d{2})\b", f"{value} {folder_name}")
    return match.group(1) if match else ""


def safe_filename(value: str) -> str:
    cleaned = INVALID_FILENAME.sub("-", value).rstrip(". ").strip()
    return cleaned or "Άγνωστο κομμάτι"


def read_text(tags: ID3, frame_id: str) -> str:
    frame = tags.get(frame_id)
    return str(frame.text[0]).strip() if frame and getattr(frame, "text", None) else ""


def scan_folder(folder: Path) -> list[Track]:
    files = sorted((path for path in folder.rglob("*.mp3") if path.is_file()), key=lambda p: p.name.casefold())
    tracks: list[Track] = []
    for index, path in enumerate(files, 1):
        try:
            tags = ID3(path)
        except ID3NoHeaderError:
            tags = ID3()
        title = read_text(tags, "TIT2") or clean_title(path.name)
        artist = read_text(tags, "TPE1") or read_text(tags, "TPE2") or "Άγνωστος καλλιτέχνης"
        album = read_text(tags, "TALB") or folder.name
        date = read_text(tags, "TDRC") or read_text(tags, "TYER")
        tracks.append(Track(
            source=path,
            number=track_number(read_text(tags, "TRCK"), path.name, index),
            title=greeklish_to_greek(clean_title(title)),
            artist=greeklish_to_greek(artist),
            album=greeklish_to_greek(album),
            release_date=release_year(date, folder.name),
            original_artist=artist,
            original_album=album,
        ))
    return sorted(tracks, key=lambda item: (item.number, item.source.name.casefold()))


def most_common(values: list[str], fallback: str = "") -> str:
    filtered = [value for value in values if value]
    return Counter(filtered).most_common(1)[0][0] if filtered else fallback


def corrected_filename(track: Track) -> str:
    return safe_filename(f"{track.number:02d}.{track.title}.mp3")


def album_destination_name(artist: str, album: str, year: str) -> str:
    clean_artist = artist.strip() or "Άγνωστος καλλιτέχνης"
    clean_album = album.strip()
    clean_year = release_year(year)
    return safe_filename(f"{clean_artist} - {clean_album}{f' ({clean_year})' if clean_year else ''}")


def apply_track_edits(track: Track, title: str, artist: str) -> None:
    cleaned_title = clean_title(title)
    if not cleaned_title:
        raise ValueError("Ο τίτλος του κομματιού δεν μπορεί να είναι κενός.")
    track.title = cleaned_title
    track.artist = artist.strip() or "Άγνωστος καλλιτέχνης"


def write_corrected_copy(track: Track, destination: Path, album: str, year: str, album_artist: str = "") -> Path:
    target = destination / corrected_filename(track)
    shutil.copy2(track.source, target)
    try:
        tags = ID3(target)
    except ID3NoHeaderError:
        tags = ID3()
    for frame_id in ("TIT2", "TPE1", "TPE2", "TALB", "TRCK", "TDRC", "TYER"):
        tags.delall(frame_id)
    tags.add(TIT2(encoding=3, text=[f"{track.number:02d}.{track.title}"]))
    tags.add(TPE1(encoding=3, text=[track.artist]))
    tags.add(TPE2(encoding=3, text=[album_artist.strip() or track.artist]))
    tags.add(TALB(encoding=3, text=[album]))
    tags.add(TRCK(encoding=3, text=[str(track.number)]))
    if year:
        tags.add(TDRC(encoding=3, text=[year]))
    tags.save(target, v2_version=3)
    return target


class MetadataApp(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title(APP_NAME)
        self.geometry("1120x780")
        self.minsize(900, 650)
        self.configure(bg="#eef0eb")
        self.folder: Path | None = None
        self.tracks: list[Track] = []
        self.album_artist_var = tk.StringVar()
        self.album_var = tk.StringVar()
        self.year_var = tk.StringVar()
        self.folder_var = tk.StringVar(value="Δεν έχει επιλεγεί φάκελος")
        self.status_var = tk.StringVar(value="Επίλεξε έναν φάκελο άλμπουμ για να ξεκινήσεις.")
        self.edit_title_var = tk.StringVar()
        self.edit_artist_var = tk.StringVar()
        self.discogs_token_var = tk.StringVar(value=load_discogs_token())
        self.discogs_status_var = tk.StringVar(value="Προαιρετικός δεύτερος έλεγχος με το επίσημο Discogs tracklist.")
        self.selected_track_index: int | None = None
        self._build_styles()
        self._build_ui()

    def _build_styles(self) -> None:
        style = ttk.Style(self)
        style.theme_use("vista")
        style.configure("Title.TLabel", background="#eef0eb", foreground="#253126", font=("Segoe UI", 22, "bold"))
        style.configure("Subtitle.TLabel", background="#eef0eb", foreground="#647064", font=("Segoe UI", 10))
        style.configure("Card.TFrame", background="#ffffff")
        style.configure("Card.TLabel", background="#ffffff", foreground="#283529", font=("Segoe UI", 10, "bold"))
        style.configure("DiscogsStatus.TLabel", background="#ffffff", foreground="#647064", font=("Segoe UI", 9))
        style.configure("Primary.TButton", font=("Segoe UI", 10, "bold"), padding=(16, 10))
        style.configure("Treeview", rowheight=30, font=("Segoe UI", 9))
        style.configure("Treeview.Heading", font=("Segoe UI", 9, "bold"))

    def _build_ui(self) -> None:
        shell = ttk.Frame(self, padding=24)
        shell.pack(fill="both", expand=True)
        ttk.Label(shell, text="Greek MP3 Metadata", style="Title.TLabel").pack(anchor="w")
        ttk.Label(shell, text="Ελληνικά filenames και ID3 metadata για ολόκληρο άλμπουμ.", style="Subtitle.TLabel").pack(anchor="w", pady=(2, 16))

        choose_card = ttk.Frame(shell, style="Card.TFrame", padding=16)
        choose_card.pack(fill="x")
        choose_row = ttk.Frame(choose_card, style="Card.TFrame")
        choose_row.pack(fill="x")
        ttk.Button(choose_row, text="Επιλογή φακέλου άλμπουμ", style="Primary.TButton", command=self.choose_folder).pack(side="left")
        ttk.Label(choose_row, textvariable=self.folder_var, style="Card.TLabel").pack(side="left", padx=14, fill="x", expand=True)

        fields = ttk.Frame(choose_card, style="Card.TFrame")
        fields.pack(fill="x", pady=(16, 0))
        fields.columnconfigure(0, weight=2)
        fields.columnconfigure(1, weight=3)
        fields.columnconfigure(2, weight=1)
        ttk.Label(fields, text="Καλλιτέχνης άλμπουμ", style="Card.TLabel").grid(row=0, column=0, sticky="w")
        ttk.Label(fields, text="Τίτλος δίσκου", style="Card.TLabel").grid(row=0, column=1, sticky="w", padx=(14, 0))
        ttk.Label(fields, text="Ημερομηνία κυκλοφορίας", style="Card.TLabel").grid(row=0, column=2, sticky="w", padx=(14, 0))
        ttk.Entry(fields, textvariable=self.album_artist_var, font=("Segoe UI", 11)).grid(row=1, column=0, sticky="ew", pady=(5, 0))
        ttk.Entry(fields, textvariable=self.album_var, font=("Segoe UI", 11)).grid(row=1, column=1, sticky="ew", padx=(14, 0), pady=(5, 0))
        ttk.Entry(fields, textvariable=self.year_var, font=("Segoe UI", 11)).grid(row=1, column=2, sticky="ew", padx=(14, 0), pady=(5, 0))

        action_row = ttk.Frame(choose_card, style="Card.TFrame")
        action_row.pack(fill="x", pady=(14, 0))
        ttk.Label(action_row, textvariable=self.status_var, style="Card.TLabel").pack(side="left", fill="x", expand=True)
        self.process_button = ttk.Button(
            action_row,
            text="Δημιουργία διορθωμένου άλμπουμ",
            style="Primary.TButton",
            command=self.process,
            state="disabled",
        )
        self.process_button.pack(side="right")

        discogs_row = ttk.Frame(choose_card, style="Card.TFrame")
        discogs_row.pack(fill="x", pady=(14, 0))
        ttk.Label(discogs_row, text="Discogs API token", style="Card.TLabel").pack(side="left")
        self.discogs_token_entry = ttk.Entry(discogs_row, textvariable=self.discogs_token_var, show="•", width=27)
        self.discogs_token_entry.pack(side="left", padx=(8, 6))
        ttk.Button(discogs_row, text="Αποθήκευση token", command=self.save_token).pack(side="left")
        self.discogs_button = ttk.Button(
            discogs_row,
            text="Έλεγχος στο Discogs",
            command=self.lookup_discogs,
            state="disabled",
        )
        self.discogs_button.pack(side="right")
        credit = ttk.Label(discogs_row, text="Data provided by Discogs", foreground="#3f6650", cursor="hand2")
        credit.pack(side="right", padx=14)
        credit.bind("<Button-1>", lambda _event: webbrowser.open(DISCOGS_SITE))
        ttk.Label(choose_card, textvariable=self.discogs_status_var, style="DiscogsStatus.TLabel").pack(anchor="w", pady=(7, 0))

        table_card = ttk.Frame(shell, style="Card.TFrame", padding=12)
        table_card.pack(fill="both", expand=True, pady=16)
        columns = ("number", "original", "new", "artist")
        self.tree = ttk.Treeview(table_card, columns=columns, show="headings", height=6)
        self.tree.heading("number", text="#")
        self.tree.heading("original", text="Αρχικό filename")
        self.tree.heading("new", text="Νέο filename / τίτλος")
        self.tree.heading("artist", text="Καλλιτέχνης")
        self.tree.column("number", width=48, anchor="center", stretch=False)
        self.tree.column("original", width=260)
        self.tree.column("new", width=350)
        self.tree.column("artist", width=220)
        scrollbar = ttk.Scrollbar(table_card, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=scrollbar.set)
        self.tree.bind("<<TreeviewSelect>>", self._load_selected_track)
        self.tree.bind("<Double-1>", self._focus_title_editor)
        self.tree.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        edit_card = ttk.Frame(shell, style="Card.TFrame", padding=12)
        edit_card.pack(fill="x", pady=(16, 0), before=table_card)
        edit_card.columnconfigure(0, weight=3)
        edit_card.columnconfigure(1, weight=2)
        ttk.Label(edit_card, text="Τίτλος κομματιού", style="Card.TLabel").grid(row=0, column=0, sticky="w")
        ttk.Label(edit_card, text="Καλλιτέχνης / συμμετοχές", style="Card.TLabel").grid(row=0, column=1, sticky="w", padx=(14, 0))
        self.title_editor = ttk.Entry(edit_card, textvariable=self.edit_title_var, font=("Segoe UI", 10), state="disabled")
        self.title_editor.grid(row=1, column=0, sticky="ew", pady=(5, 0))
        self.artist_editor = ttk.Entry(edit_card, textvariable=self.edit_artist_var, font=("Segoe UI", 10), state="disabled")
        self.artist_editor.grid(row=1, column=1, sticky="ew", padx=(14, 0), pady=(5, 0))
        self.apply_edit_button = ttk.Button(
            edit_card,
            text="Εφαρμογή διόρθωσης",
            command=self.apply_selected_edit,
            state="disabled",
        )
        self.apply_edit_button.grid(row=1, column=2, padx=(14, 0), pady=(5, 0))
        self.title_editor.bind("<Return>", lambda _event: self.apply_selected_edit())
        self.artist_editor.bind("<Return>", lambda _event: self.apply_selected_edit())

    def choose_folder(self) -> None:
        selected = filedialog.askdirectory(title="Επιλογή φακέλου άλμπουμ")
        if not selected:
            return
        folder = Path(selected)
        tracks = scan_folder(folder)
        if not tracks:
            messagebox.showwarning(APP_NAME, "Ο φάκελος δεν περιέχει MP3.")
            return
        self.folder = folder
        self.tracks = tracks
        self.folder_var.set(str(folder))
        self.album_artist_var.set(most_common([track.artist for track in tracks], "Άγνωστος καλλιτέχνης"))
        self.album_var.set(most_common([track.album for track in tracks], greeklish_to_greek(folder.name)))
        self.year_var.set(most_common([track.release_date for track in tracks], release_year("", folder.name)))
        self._refresh_table()
        self.process_button.configure(state="normal")
        self.discogs_button.configure(state="normal")
        self.status_var.set(f"Βρέθηκαν {len(tracks)} MP3. Έλεγξε τον τίτλο και την ημερομηνία πριν την αποθήκευση.")

    def save_token(self) -> None:
        token = self.discogs_token_var.get().strip()
        if not token:
            messagebox.showwarning(APP_NAME, "Συμπλήρωσε πρώτα το προσωπικό Discogs API token.")
            return
        try:
            save_discogs_token(token)
        except OSError as error:
            messagebox.showerror(APP_NAME, f"Το token δεν αποθηκεύτηκε:\n{error}")
            return
        self.discogs_status_var.set("Το Discogs token αποθηκεύτηκε κρυπτογραφημένο για αυτόν τον λογαριασμό Windows.")

    def lookup_discogs(self) -> None:
        if not self.folder or not self.tracks:
            return
        token = self.discogs_token_var.get().strip()
        if not token:
            messagebox.showwarning(
                APP_NAME,
                "Συμπλήρωσε το προσωπικό Discogs API token και πάτησε «Αποθήκευση token».",
            )
            self.discogs_token_entry.focus_set()
            return
        artist = self.album_artist_var.get().strip() or most_common([track.artist for track in self.tracks], "")
        album = self.album_var.get().strip() or most_common([track.album for track in self.tracks], self.folder.name)
        original_artist = most_common([track.original_artist for track in self.tracks], artist)
        original_album = most_common([track.original_album for track in self.tracks], self.folder.name)
        year = release_year(self.year_var.get(), self.folder.name)
        self.discogs_button.configure(state="disabled")
        self.discogs_status_var.set("Αναζήτηση και σύγκριση πιθανών κυκλοφοριών στο Discogs…")
        threading.Thread(
            target=self._discogs_worker,
            args=(token, artist, album, year, len(self.tracks), original_artist, original_album),
            daemon=True,
        ).start()

    def _discogs_worker(
        self,
        token: str,
        artist: str,
        album: str,
        year: str,
        track_count: int,
        original_artist: str,
        original_album: str,
    ) -> None:
        try:
            releases = DiscogsClient(token).search(
                artist,
                album,
                year,
                track_count,
                original_artist=original_artist,
                original_album=original_album,
            )
        except Exception as error:
            self.after(0, self._finish_discogs_error, str(error))
            return
        self.after(0, self._show_discogs_matches, releases)

    def _finish_discogs_error(self, error: str) -> None:
        self.discogs_button.configure(state="normal")
        self.discogs_status_var.set("Ο έλεγχος Discogs δεν ολοκληρώθηκε. Η μετατροπή Greeklish παραμένει διαθέσιμη.")
        messagebox.showerror(APP_NAME, error or "Η αναζήτηση στο Discogs απέτυχε.")

    def _show_discogs_matches(self, releases: list[DiscogsRelease]) -> None:
        self.discogs_button.configure(state="normal")
        if not releases:
            self.discogs_status_var.set("Δεν βρέθηκε σχετική κυκλοφορία · παραμένει η μετατροπή Greeklish.")
            messagebox.showinfo(APP_NAME, "Δεν βρέθηκε σχετική κυκλοφορία στο Discogs.")
            return

        dialog = tk.Toplevel(self)
        dialog.title("Επιλογή κυκλοφορίας Discogs")
        dialog.geometry("920x470")
        dialog.minsize(760, 380)
        dialog.transient(self)
        dialog.grab_set()
        shell = ttk.Frame(dialog, padding=18)
        shell.pack(fill="both", expand=True)
        ttk.Label(shell, text="Πιθανές κυκλοφορίες στο Discogs", font=("Segoe UI", 16, "bold")).pack(anchor="w")
        ttk.Label(
            shell,
            text="Έλεγξε τον δίσκο, τη χρονολογία και το πλήθος κομματιών πριν εφαρμόσεις το tracklist.",
        ).pack(anchor="w", pady=(3, 12))
        columns = ("confidence", "release", "year", "tracks")
        tree = ttk.Treeview(shell, columns=columns, show="headings", height=9)
        tree.heading("confidence", text="Βεβαιότητα")
        tree.heading("release", text="Κυκλοφορία")
        tree.heading("year", text="Έτος")
        tree.heading("tracks", text="Κομμάτια")
        tree.column("confidence", width=100, anchor="center", stretch=False)
        tree.column("release", width=570)
        tree.column("year", width=80, anchor="center", stretch=False)
        tree.column("tracks", width=90, anchor="center", stretch=False)
        for index, release in enumerate(releases):
            tree.insert(
                "",
                "end",
                iid=str(index),
                values=(f"{release.score}%", f"{release.artist} — {release.title}", release.year or "—", len(release.tracks)),
            )
        tree.pack(fill="both", expand=True)
        tree.selection_set("0")
        tree.focus("0")
        footer = ttk.Frame(shell)
        footer.pack(fill="x", pady=(12, 0))
        ttk.Label(footer, text="Data provided by Discogs").pack(side="left")

        def selected_release() -> DiscogsRelease | None:
            selection = tree.selection()
            return releases[int(selection[0])] if selection else None

        def open_selected() -> None:
            release = selected_release()
            if release:
                webbrowser.open(release.url)

        def apply_selected() -> None:
            release = selected_release()
            if not release:
                return
            aligned = align_discogs_tracks(self.tracks, release)
            if not aligned:
                messagebox.showwarning(APP_NAME, "Δεν ήταν δυνατή η αντιστοίχιση των κομματιών.", parent=dialog)
                return
            if release.score < 70 and not messagebox.askyesno(
                APP_NAME,
                f"Η αντιστοίχιση έχει βεβαιότητα {release.score}%. Θέλεις να εφαρμοστεί παρ’ όλα αυτά;",
                parent=dialog,
            ):
                return
            self._apply_discogs_release(release, aligned)
            dialog.destroy()

        ttk.Button(footer, text="Άνοιγμα στο Discogs", command=open_selected).pack(side="right", padx=(8, 0))
        ttk.Button(footer, text="Χρήση επιλεγμένης κυκλοφορίας", command=apply_selected).pack(side="right", padx=(8, 0))
        ttk.Button(footer, text="Άκυρο", command=dialog.destroy).pack(side="right")
        tree.bind("<Double-1>", lambda _event: apply_selected())

    def _apply_discogs_release(
        self,
        release: DiscogsRelease,
        aligned: list[tuple[Track, DiscogsTrack]],
    ) -> None:
        self.album_artist_var.set(release.artist)
        self.album_var.set(release.title)
        if release.year:
            self.year_var.set(release.year)
        for track, discogs_track in aligned:
            track.title = clean_title(discogs_track.title)
            track.artist = discogs_track.artist or release.artist or track.artist
        self._refresh_table()
        label = "ακριβής" if release.score >= 85 else "πιθανή"
        self.discogs_status_var.set(
            f"Discogs: {label} αντιστοίχιση {release.score}% · εφαρμόστηκαν {len(aligned)}/{len(self.tracks)} τίτλοι."
        )
        self.status_var.set("Το Discogs tracklist εφαρμόστηκε στην προεπισκόπηση. Έλεγξέ το πριν τη δημιουργία αντιγράφων.")

    def _refresh_table(self) -> None:
        self.tree.delete(*self.tree.get_children())
        for index, track in enumerate(self.tracks):
            self.tree.insert("", "end", iid=str(index), values=(track.number, track.source.name, corrected_filename(track), track.artist))

    def _load_selected_track(self, _event: tk.Event | None = None) -> None:
        selection = self.tree.selection()
        if not selection:
            return
        index = int(selection[0])
        if index >= len(self.tracks):
            return
        self.selected_track_index = index
        track = self.tracks[index]
        self.edit_title_var.set(track.title)
        self.edit_artist_var.set(track.artist)
        self.title_editor.configure(state="normal")
        self.artist_editor.configure(state="normal")
        self.apply_edit_button.configure(state="normal")
        self.status_var.set(f"Επεξεργασία κομματιού {track.number:02d}. Άλλαξε τα πεδία και πάτησε «Εφαρμογή διόρθωσης».")

    def _focus_title_editor(self, _event: tk.Event | None = None) -> None:
        self.after_idle(self.title_editor.focus_set)

    def apply_selected_edit(self) -> None:
        if self.selected_track_index is None or self.selected_track_index >= len(self.tracks):
            return
        track = self.tracks[self.selected_track_index]
        try:
            apply_track_edits(track, self.edit_title_var.get(), self.edit_artist_var.get())
        except ValueError as error:
            messagebox.showwarning(APP_NAME, str(error))
            return
        self.edit_title_var.set(track.title)
        self.edit_artist_var.set(track.artist)
        self.tree.item(
            str(self.selected_track_index),
            values=(track.number, track.source.name, corrected_filename(track), track.artist),
        )
        self.status_var.set(f"Η διόρθωση εφαρμόστηκε στο {corrected_filename(track)}.")

    def process(self) -> None:
        if not self.folder or not self.tracks:
            return
        artist = self.album_artist_var.get().strip()
        album = self.album_var.get().strip()
        year = release_year(self.year_var.get())
        if not artist:
            messagebox.showwarning(APP_NAME, "Συμπλήρωσε τον καλλιτέχνη του άλμπουμ.")
            return
        if not album:
            messagebox.showwarning(APP_NAME, "Συμπλήρωσε τον τίτλο του δίσκου.")
            return
        self.year_var.set(year)
        self.process_button.configure(state="disabled")
        threading.Thread(target=self._process_worker, args=(artist, album, year), daemon=True).start()

    def _process_worker(self, artist: str, album: str, year: str) -> None:
        assert self.folder is not None
        destination = unique_destination(self.folder.parent, album_destination_name(artist, album, year))
        destination.mkdir(parents=True)
        try:
            for index, track in enumerate(self.tracks, 1):
                self.after(0, self.status_var.set, f"Επεξεργασία {index}/{len(self.tracks)}: {track.source.name}")
                write_corrected_copy(track, destination, album, year, artist)
        except Exception as error:
            self.after(0, self._finish_error, str(error))
            return
        self.after(0, self._finish_success, destination)

    def _finish_error(self, error: str) -> None:
        self.process_button.configure(state="normal")
        self.status_var.set("Η επεξεργασία απέτυχε.")
        messagebox.showerror(APP_NAME, error)

    def _finish_success(self, destination: Path) -> None:
        self.process_button.configure(state="normal")
        self.status_var.set(f"Ολοκληρώθηκε: {destination}")
        if messagebox.askyesno(APP_NAME, f"Το διορθωμένο άλμπουμ δημιουργήθηκε:\n\n{destination}\n\nΝα ανοίξει ο φάκελος;"):
            import os
            os.startfile(destination)


def unique_destination(parent: Path, name: str) -> Path:
    candidate = parent / name
    counter = 2
    while candidate.exists():
        candidate = parent / f"{name} ({counter})"
        counter += 1
    return candidate


if __name__ == "__main__":
    MetadataApp().mainloop()
