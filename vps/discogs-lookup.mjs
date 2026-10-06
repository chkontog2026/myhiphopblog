const greeklishPairs = [
  ["th", "θ"], ["ps", "ψ"], ["ch", "χ"], ["ou", "ου"],
  ["mp", "μπ"], ["nt", "ντ"], ["gk", "γκ"], ["tz", "τζ"],
];

const greeklishLetters = {
  a: "α", b: "β", c: "κ", d: "δ", e: "ε", f: "φ", g: "γ",
  h: "η", i: "ι", j: "τζ", k: "κ", l: "λ", m: "μ", n: "ν",
  o: "ο", p: "π", q: "κ", r: "ρ", s: "σ", t: "τ", u: "υ",
  v: "β", w: "ω", x: "χ", y: "υ", z: "ζ",
};

export function greeklishDiscogsStems(value) {
  const latin = String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!latin || !/[a-z]/.test(latin)) return [];

  let prepared = latin;
  for (const [source, target] of greeklishPairs) prepared = prepared.replaceAll(source, target);
  const greek = [...prepared].map((character) => greeklishLetters[character] || character).join("");
  const variants = [greek];
  // Prefer the combined alternative before the individual forms: it is the
  // common spelling in artist names such as "Agnvstos Xeimwnas".
  if (greek.includes("ξ") && greek.includes("β")) variants.push(greek.replaceAll("ξ", "χ").replaceAll("β", "ω"));
  if (greek.includes("β")) variants.push(greek.replaceAll("β", "ω"));
  if (greek.includes("ξ")) variants.push(greek.replaceAll("ξ", "χ"));
  for (let index = 0; index < greek.length && variants.length < 6; index += 1) {
    if (greek[index] === "ο") variants.push(`${greek.slice(0, index)}ω${greek.slice(index + 1)}`);
  }

  return [...new Set(variants.map((variant) => variant.replace(/[αεηιουω]{1,2}$/u, "").trim()))]
    .filter((variant) => variant.length >= 4);
}

// Discogs often stores Greek releases in Greek even when the uploaded file name
// is Greeklish. Keep the complete transliteration for the API query and add the
// shorter stems only as secondary matching terms.
export function greeklishDiscogsSearchTerms(value) {
  const latin = String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!latin || !/[a-z]/.test(latin)) return [];

  let prepared = latin;
  for (const [source, target] of greeklishPairs) prepared = prepared.replaceAll(source, target);
  const greek = [...prepared].map((character) => greeklishLetters[character] || character).join("");
  const variants = [greek];
  // In Greeklish, "i" can stand for ι, η, υ, ει or οι.  The one-character
  // η variant covers common titles such as "Vimata" → "Βήματα".
  for (let index = 0; index < greek.length && variants.length < 6; index += 1) {
    if (greek[index] === "ι") variants.push(`${greek.slice(0, index)}η${greek.slice(index + 1)}`);
  }
  // Both x/ξ and x/χ, as well as v/β and v/ω, occur in file names.
  // Add the common alternatives so artist names can be found too.
  return [...new Set([...variants, ...greeklishDiscogsStems(value)])]
    .map((term) => term.trim())
    .filter((term) => term.length >= 4);
}

export function discogsGreekAccentVariants(value) {
  const plain = String(value || "").replace(/σ(?=\s|$)/gu, "ς").trim();
  if (!plain || !/[αεηιουω]/u.test(plain)) return plain ? [plain] : [];

  const accented = { α: "ά", ε: "έ", η: "ή", ι: "ί", ο: "ό", υ: "ύ", ω: "ώ" };
  const wordOptions = plain.split(/\s+/).map((word) => {
    const options = [];
    for (let index = 0; index < word.length; index += 1) {
      const replacement = accented[word[index]];
      if (replacement) options.push(`${word.slice(0, index)}${replacement}${word.slice(index + 1)}`);
    }
    return options.length ? options : [word];
  });

  let combinations = [""];
  for (const options of wordOptions) {
    combinations = combinations.flatMap((prefix) => options.map((option) => `${prefix}${prefix ? " " : ""}${option}`));
    if (combinations.length > 24) combinations = combinations.slice(0, 24);
  }
  return [...new Set([plain, ...combinations])];
}

export function normalizeDiscogsSearchText(value) {
  return String(value || "")
    .toLocaleLowerCase("el-GR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ς/g, "σ")
    .replace(/[^a-z0-9α-ω]+/gu, " ")
    .trim();
}
