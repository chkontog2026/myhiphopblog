export function extractTrackTitles(value) {
  const titles = [];

  for (const rawLine of String(value || "").split(/\r?\n/)) {
    const line = rawLine.replace(/\u00a0/g, " ").trim();
    if (!line) continue;

    const title = line.includes("|") ? titleFromTableRow(line) : titleFromPlainRow(line);
    if (title) titles.push(title);
  }

  return titles.slice(0, 200);
}

function titleFromTableRow(line) {
  const cells = line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map(cleanCell);

  if (!cells.length || cells.every((cell) => !cell || /^:?-{2,}:?$/.test(cell))) return "";

  const firstFilledIndex = cells.findIndex(Boolean);
  if (firstFilledIndex < 0 || !isTrackPosition(cells[firstFilledIndex])) return "";

  const candidates = cells.slice(firstFilledIndex + 1).filter(Boolean);
  while (candidates.length && isDuration(candidates.at(-1))) candidates.pop();
  return candidates.length ? cleanTitle(candidates.at(-1)) : "";
}

function titleFromPlainRow(line) {
  if (/^\s*(?:track|position|title|duration)\s*$/i.test(line)) return "";
  if (/^\s*(?:-{2,}|:?-{2,}:?)\s*$/.test(line)) return "";

  const tabCells = line.split(/\t+/).map(cleanCell).filter(Boolean);
  if (tabCells.length > 1 && isTrackPosition(tabCells[0])) {
    while (tabCells.length && isDuration(tabCells.at(-1))) tabCells.pop();
    return cleanTitle(tabCells.at(-1));
  }

  const match = line.match(/^\s*((?:\d{1,3}|[A-Z]{1,3}\d+(?:[.-]\d+)?)[.)]?)\s+(.+?)\s*$/i);
  if (!match || !isTrackPosition(match[1])) return "";
  return cleanTitle(match[2].replace(/\s+\d{1,2}:\d{2}(?::\d{2})?\s*$/, ""));
}

function cleanCell(value) {
  return String(value || "")
    .trim()
    .replace(/^(?:\*\*|__)(.*)(?:\*\*|__)$/, "$1")
    .replace(/^\s*[*_`]+|[*_`]+\s*$/g, "")
    .trim();
}

function cleanTitle(value) {
  return cleanCell(value)
    .replace(/^\[(.+)]\([^)]*\)$/, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function isDuration(value) {
  return /^\d{1,2}:\d{2}(?::\d{2})?$/.test(String(value || "").trim());
}

function isTrackPosition(value) {
  return /^(?:\d{1,3}|[A-Z]{1,3}\d+(?:[.-]\d+)?)[.)]?$/i.test(String(value || "").trim());
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-clean-tracklist]").forEach((button) => {
      button.addEventListener("click", () => {
        const editor = button.closest(".disc-editor");
        const textarea = editor?.querySelector("textarea");
        const message = editor?.querySelector("[data-tracklist-clean-message]");
        if (!textarea || !message) return;

        const titles = extractTrackTitles(textarea.value);
        if (!titles.length) {
          message.textContent = "Δεν βρέθηκαν αριθμημένα κομμάτια.";
          return;
        }

        textarea.value = titles.join("\n");
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        message.textContent = `Κρατήθηκαν ${titles.length} ${titles.length === 1 ? "τίτλος" : "τίτλοι"}.`;
      });
    });
  });
}
