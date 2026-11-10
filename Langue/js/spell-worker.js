// Correcteur orthographique anglais (Hunspell en_US via nspell), exécuté hors du fil principal.
import nspell from "https://esm.sh/nspell@2.1.5?bundle";

const DICT = "https://cdn.jsdelivr.net/npm/dictionary-en@4.0.0/";
// Liste des 10 000 mots anglais les plus fréquents : sert à proposer d'abord le mot le plus probable
const FREQ = "https://cdn.jsdelivr.net/gh/first20hours/google-10000-english@master/google-10000-english-usa-no-swears.txt";
let spell = null;
const rank = new Map();
const cache = new Map();

async function load() {
  const [aff, dic, freq] = await Promise.all([
    fetch(DICT + "index.aff").then((r) => r.text()),
    fetch(DICT + "index.dic").then((r) => r.text()),
    fetch(FREQ).then((r) => (r.ok ? r.text() : "")).catch(() => ""),
  ]);
  freq.split("\n").forEach((w, i) => { w = w.trim(); if (w && !rank.has(w)) rank.set(w, i); });
  spell = nspell(aff, dic);
  // Mots courants souvent absents du dictionnaire
  ["ok", "okay", "email", "emails", "online", "app", "apps", "website", "smartphone", "selfie", "wifi", "gonna", "wanna", "youtube", "instagram", "netflix"].forEach((w) => spell.add(w));
  postMessage({ type: "ready" });
}

function isWordOk(word) {
  if (cache.has(word)) return cache.get(word);
  let ok = spell.correct(word);
  if (!ok && /^[A-Z]/.test(word)) ok = spell.correct(word.toLowerCase());
  // Les nombres, sigles et noms propres (majuscule hors début de phrase) sont ignorés
  if (!ok && (/\d/.test(word) || /^[A-Z]{2,}$/.test(word))) ok = true;
  cache.set(word, ok);
  return ok;
}

onmessage = (e) => {
  const { type, id, text, word } = e.data;
  if (!spell) { postMessage({ type: "notready", id }); return; }
  if (type === "check") {
    const bad = [];
    const re = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;
    let m;
    while ((m = re.exec(text))) {
      const w = m[0].replace(/’/g, "'");
      if (w.length < 2 && w !== "i") continue;
      if (!isWordOk(w)) bad.push({ start: m.index, end: m.index + m[0].length, word: m[0] });
    }
    postMessage({ type: "result", id, bad });
  } else if (type === "suggest") {
    const lower = word.toLowerCase();
    const score = (x, i) => {
      const r = rank.has(x.toLowerCase()) ? rank.get(x.toLowerCase()) : 20000;
      const sameStart = x[0]?.toLowerCase() === lower[0] ? 0 : 5000;
      return r + sameStart + i * 50;
    };
    let s = spell.suggest(word.replace(/’/g, "'"))
      .map((x, i) => [x, score(x, i)]).sort((a, b) => a[1] - b[1]).map((p) => p[0]).slice(0, 3);
    if (/^[A-Z]/.test(word)) s = s.map((x) => x.charAt(0).toUpperCase() + x.slice(1));
    postMessage({ type: "suggestions", id, word, suggestions: s });
  }
};

load().catch((err) => postMessage({ type: "error", message: String(err) }));
