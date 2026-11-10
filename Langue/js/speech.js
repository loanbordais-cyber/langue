// Dictée vocale en anglais (reconnaissance de Safari), indépendante de la langue du clavier.
// Et lecture à voix haute des mots (prononciation).

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export function dictationSupported() { return !!SR; }

export function createDictation({ onText, onEnd }) {
  if (!SR) {
    onEnd("La dictée n'est pas disponible ici. Utilise le micro du clavier iPhone réglé en anglais.");
    return null;
  }
  const rec = new SR();
  rec.lang = "en-US";
  rec.continuous = true;
  rec.interimResults = true;
  let finalText = "";
  let stopped = false;
  let error = null;

  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += (finalText ? " " : "") + r[0].transcript.trim();
      else interim += r[0].transcript;
    }
    onText(finalText, interim.trim());
  };
  rec.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") error = "Autorise le micro pour Langue dans les réglages de l'iPhone.";
    else if (e.error === "no-speech") error = "Je n'ai rien entendu, réessaie.";
    else if (e.error !== "aborted") error = "La dictée s'est arrêtée. Réessaie, ou utilise le micro du clavier en anglais.";
  };
  rec.onend = () => { stopped = true; onText(finalText, ""); onEnd(error); };

  try { rec.start(); } catch { onEnd("Impossible de démarrer la dictée."); return null; }
  return { stop() { if (!stopped) rec.stop(); } };
}

let voice = null;
function pickVoice() {
  const voices = speechSynthesis.getVoices();
  voice = voices.find((v) => v.lang === "en-US" && /Samantha|Alex|Ava|Allison/.test(v.name))
    || voices.find((v) => v.lang === "en-US") || voices.find((v) => v.lang.startsWith("en")) || null;
}
if ("speechSynthesis" in window) {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}

export function speak(text) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  if (voice) u.voice = voice;
  u.rate = 0.92;
  speechSynthesis.speak(u);
}
