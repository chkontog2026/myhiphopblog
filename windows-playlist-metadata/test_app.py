import tempfile
import unittest
import urllib.parse
from pathlib import Path

from mutagen.id3 import ID3, TALB, TDRC, TIT2, TPE1, TPE2, TRCK

from app import (
    DiscogsClient,
    DiscogsRelease,
    DiscogsTrack,
    Track,
    album_destination_name,
    align_discogs_tracks,
    apply_track_edits,
    clean_title,
    corrected_filename,
    greeklish_to_greek,
    normalize_discogs_text,
    parse_discogs_release,
    release_year,
    scan_folder,
    score_discogs_release,
    write_corrected_copy,
)


class MetadataAppTests(unittest.TestCase):
    def test_converts_supplied_example(self):
        self.assertEqual(greeklish_to_greek("Oi Zoes Oson Me Niothoun"), "Οι Ζωές Όσων Μας Νιώθουν")
        self.assertEqual(greeklish_to_greek("Agnwstos Xeimwnas"), "Άγνωστος Χειμώνας")
        self.assertEqual(greeklish_to_greek("Sta Vimata Tou Iskiou"), "Στα Βήματα Του Ίσκιου")
        self.assertEqual(greeklish_to_greek("Ekso Ap'ta Dontia"), "Έξω Απ' Τα Δόντια")

    def test_extracts_release_year(self):
        self.assertEqual(release_year("2004-03-12"), "2004")
        self.assertEqual(release_year("", "Album (1999)"), "1999")

    def test_output_folder_uses_artist_album_and_year(self):
        self.assertEqual(
            album_destination_name("Άγνωστος Χειμώνας", "Στα Βήματα Του Ίσκιου", "2004"),
            "Άγνωστος Χειμώνας - Στα Βήματα Του Ίσκιου (2004)",
        )
        self.assertEqual(
            album_destination_name("  Άγνωστος Χειμώνας  ", "  Στα Βήματα Του Ίσκιου  ", "2004-03-12"),
            "Άγνωστος Χειμώνας - Στα Βήματα Του Ίσκιου (2004)",
        )

    def test_keeps_the_full_title_after_a_numeric_filename_prefix(self):
        self.assertEqual(clean_title("01.Gia Mena.mp3"), "Gia Mena")
        self.assertEqual(clean_title("01.Gia Mena"), "Gia Mena")
        self.assertEqual(greeklish_to_greek(clean_title("01.Gia Mena.mp3")), "Για Μένα")
        self.assertEqual(greeklish_to_greek(clean_title("02.Arrostis Eikonas.mp3")), "Άρρωστης Εικόνας")

    def test_generates_the_expected_names_for_the_supplied_album(self):
        samples = {
            "01.Gia Mena.mp3": "01.Για Μένα.mp3",
            "02.Arrostis Eikonas.mp3": "02.Άρρωστης Εικόνας.mp3",
            "03.Pairno Anapnoi.mp3": "03.Παίρνω Αναπνοή.mp3",
            "04.Ena Meros Foteino.mp3": "04.Ένα Μέρος Φωτεινό.mp3",
            "05.Dio Logia Mono.mp3": "05.Δυο Λόγια Μόνο.mp3",
            "06.Sanatorio.mp3": "06.Σανατόριο.mp3",
            "07.De Ksexno.mp3": "07.Δε Ξεχνώ.mp3",
            "08.Zoume Epikindinos.mp3": "08.Ζούμε Επικίνδυνος.mp3",
            "09.Omixli.mp3": "09.Ομίχλη.mp3",
            "10.Otan Fevgo (Eksodos).mp3": "10.Όταν Φεύγω (Έξοδος).mp3",
        }
        for source, expected in samples.items():
            number = int(source[:2])
            title = greeklish_to_greek(clean_title(source))
            track = Track(Path(source), number, title, "", "", "")
            self.assertEqual(corrected_filename(track), expected)

    def test_manual_edits_change_filename_and_metadata_values(self):
        track = Track(Path("08.Zoume Epikindinos.mp3"), 8, "Ζούμε Επικίνδυνος", "Άγνωστος Χειμώνας", "", "")
        apply_track_edits(track, "08.Ζούμε Επικίνδυνα.mp3", "B.D. Foxmoor, Active Member")
        self.assertEqual(track.title, "Ζούμε Επικίνδυνα")
        self.assertEqual(track.artist, "B.D. Foxmoor, Active Member")
        self.assertEqual(corrected_filename(track), "08.Ζούμε Επικίνδυνα.mp3")

        with self.assertRaises(ValueError):
            apply_track_edits(track, "", track.artist)

    def test_scans_and_writes_corrected_copy(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "01.Oi Zoes Oson Me Niothoun.mp3"
            source.write_bytes(b"\xff\xfb\x90\x64" + bytes(range(64)))
            tags = ID3()
            tags.add(TIT2(encoding=3, text=["Oi Zoes Oson Me Niothoun"]))
            tags.add(TPE1(encoding=3, text=["Agnwstos Xeimwnas"]))
            tags.add(TALB(encoding=3, text=["Sta Vimata Tou Iskiou"]))
            tags.add(TRCK(encoding=3, text=["1/13"]))
            tags.add(TDRC(encoding=3, text=["2004"]))
            tags.save(source, v2_version=3)

            tracks = scan_folder(root)
            self.assertEqual(len(tracks), 1)
            self.assertEqual(tracks[0].original_artist, "Agnwstos Xeimwnas")
            self.assertEqual(tracks[0].original_album, "Sta Vimata Tou Iskiou")
            self.assertEqual(corrected_filename(tracks[0]), "01.Οι Ζωές Όσων Μας Νιώθουν.mp3")
            output = root / "output"
            output.mkdir()
            target = write_corrected_copy(
                tracks[0], output, "Στα Βήματα Του Ίσκιου", "2004", "Άγνωστος Χειμώνας"
            )
            corrected = ID3(target)
            self.assertEqual(str(corrected["TIT2"]), "01.Οι Ζωές Όσων Μας Νιώθουν")
            self.assertEqual(str(corrected["TPE2"]), "Άγνωστος Χειμώνας")
            self.assertEqual(str(corrected["TALB"]), "Στα Βήματα Του Ίσκιου")
            self.assertEqual(str(corrected["TDRC"]), "2004")

    def test_normalizes_accents_and_final_sigma_for_discogs_matching(self):
        self.assertEqual(normalize_discogs_text("Άγνωστος Χειμώνας"), "αγνωστοσ χειμωνασ")
        self.assertEqual(normalize_discogs_text("ΑΓΝΩΣΤΟΣ  ΧΕΙΜΩΝΑΣ"), "αγνωστοσ χειμωνασ")

    def test_parses_discogs_release_and_skips_headings(self):
        release = parse_discogs_release({
            "id": 123,
            "artists_sort": "Άγνωστος Χειμώνας (2)",
            "title": "Στα Βήματα Του Ίσκιου",
            "year": 2004,
            "tracklist": [
                {"type_": "heading", "title": "CD 1"},
                {"type_": "track", "position": "1", "title": "Οι Ζωές Όσων Μας Νιώθουν"},
                {"type_": "track", "position": "2", "title": "Για Μένα", "artists": [{"name": "B.D. Foxmoor (2)"}]},
            ],
        })
        self.assertEqual(release.release_id, 123)
        self.assertEqual(release.artist, "Άγνωστος Χειμώνας")
        self.assertEqual([track.number for track in release.tracks], [1, 2])
        self.assertEqual(release.tracks[1].artist, "B.D. Foxmoor")

    def test_scores_matching_release_above_wrong_release(self):
        exact = DiscogsRelease(1, "Άγνωστος Χειμώνας", "Στα Βήματα Του Ίσκιου", "2004", [
            DiscogsTrack(number, f"Track {number}") for number in range(1, 11)
        ])
        wrong = DiscogsRelease(2, "Άλλος", "Άλλος Δίσκος", "1999", [DiscogsTrack(1, "Track")])
        exact_score = score_discogs_release(exact, "Αγνωστος Χειμωνας", "Στα Βήματα Του Ισκιου", "2004", 10)
        wrong_score = score_discogs_release(wrong, "Αγνωστος Χειμωνας", "Στα Βήματα Του Ισκιου", "2004", 10)
        self.assertGreaterEqual(exact_score, 90)
        self.assertGreater(exact_score, wrong_score)

    def test_aligns_discogs_titles_by_track_number(self):
        local = [
            Track(Path("02.old.mp3"), 2, "Old 2", "Artist", "Album", "2004"),
            Track(Path("01.old.mp3"), 1, "Old 1", "Artist", "Album", "2004"),
        ]
        release = DiscogsRelease(1, "Artist", "Album", "2004", [
            DiscogsTrack(1, "Πρώτο"),
            DiscogsTrack(2, "Δεύτερο"),
        ])
        aligned = align_discogs_tracks(local, release)
        self.assertEqual([(track.number, match.title) for track, match in aligned], [(2, "Δεύτερο"), (1, "Πρώτο")])

    def test_discogs_search_ranks_fetched_releases(self):
        class FakeClient(DiscogsClient):
            def request(self, endpoint):
                if endpoint.startswith("/database/search"):
                    return {"results": [{"id": 10}, {"id": 20}]}
                if endpoint == "/releases/10":
                    return {
                        "id": 10, "artists_sort": "Άγνωστος Χειμώνας", "title": "Στα Βήματα Του Ίσκιου", "year": 2004,
                        "tracklist": [{"position": str(number), "title": f"Σωστό {number}"} for number in range(1, 4)],
                    }
                return {
                    "id": 20, "artists_sort": "Άλλος", "title": "Λάθος", "year": 1999,
                    "tracklist": [{"position": "1", "title": "Λάθος"}],
                }

        releases = FakeClient("token").search("Άγνωστος Χειμώνας", "Στα Βήματα Του Ίσκιου", "2004", 3)
        self.assertEqual([release.release_id for release in releases], [10, 20])
        self.assertGreater(releases[0].score, releases[1].score)

    def test_discogs_search_includes_original_greeklish_terms(self):
        class RecordingClient(DiscogsClient):
            def __init__(self):
                super().__init__("token")
                self.endpoints = []

            def request(self, endpoint):
                self.endpoints.append(endpoint)
                return {"results": []}

        client = RecordingClient()
        client.search(
            "Άγνωστος Χειμώνας",
            "Στα Βήματα Του Ίσκιου",
            "2004",
            10,
            original_artist="Agnwstos Xeimwnas",
            original_album="Sta Vimata Tou Iskiou",
        )
        decoded = "\n".join(urllib.parse.unquote_plus(endpoint) for endpoint in client.endpoints)
        self.assertIn("Agnwstos Xeimwnas", decoded)
        self.assertIn("Sta Vimata Tou Iskiou", decoded)

    def test_discogs_search_falls_back_to_original_artist_and_year(self):
        class RecordingClient(DiscogsClient):
            def __init__(self):
                super().__init__("token")
                self.endpoints = []

            def request(self, endpoint):
                self.endpoints.append(endpoint)
                return {"results": []}

        client = RecordingClient()
        client.search(
            "Ακτιβε Μεμβερ",
            "Απ' Τον Τοπο Της Φυγις",
            "1996",
            18,
            original_artist="Active Member",
            original_album="Ap' Ton Topo Tis Figis",
        )
        decoded = "\n".join(urllib.parse.unquote_plus(endpoint) for endpoint in client.endpoints)
        self.assertIn("artist=Active Member&year=1996", decoded)

    def test_discogs_score_uses_original_artist_for_greeklish_album(self):
        release = DiscogsRelease(
            1,
            "Active Member",
            "Από Τον Τόπο Της Φυγής",
            "1996",
            [DiscogsTrack(number, f"Track {number}") for number in range(1, 19)],
        )
        score = score_discogs_release(
            release,
            "Ακτιβε Μεμβερ",
            "Απ' Τον Τοπο Της Φυγις",
            "1996",
            18,
            original_artist="Active Member",
            original_album="Ap' Ton Topo Tis Figis",
        )
        self.assertGreaterEqual(score, 85)


if __name__ == "__main__":
    unittest.main()
