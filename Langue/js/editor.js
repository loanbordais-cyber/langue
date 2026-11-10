// Zone d'écriture anglaise : soulignement rouge des fautes + suggestion à valider (comme Word),
// indépendant du clavier (français ou autre) et du correcteur de l'iPhone, désactivé ici.
import { esc, countWords, icons } from "./util.js";
import { createDictation, dictationSupported } from "./speech.js";

let worker = null;
let ready = false;
let seq = 0;
const pending = new Map();
const readyCallbacks = [];

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./spell-worker.js?v=2", import.meta.url), { type: "module" });
  worker.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === "ready") { ready = true; readyCallbacks.splice(0).forEach((f) => f()); return; }
    if (msg.type === "error") { console.warn("Correcteur indisponible", msg.message); return; }
    const cb = pending.get(msg.id);
    if (cb) { pending.delete(msg.id); cb(msg); }
  };
  return worker;
}
function ask(payload) {
  return new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    getWorker().postMessage({ ...payload, id });
  });
}
export function preloadSpell() { getWorker(); }

// Liste des mots mal orthographiés avec leur meilleure suggestion (utilisé par le mode démo)
export async function spellReport(text) {
  getWorker();
  if (!ready) await new Promise((r) => readyCallbacks.push(r));
  const { bad } = await ask({ type: "check", text });
  const out = [];
  for (const b of bad) {
    const { suggestions } = await ask({ type: "suggest", word: b.word });
    out.push({ word: b.word, suggestion: suggestions[0] || null });
  }
  return out;
}

const ignored = new Set();

export function createEditor({ value = "", placeholder = "Write in English…", compact = false, onChange = () => {} } = {}) {
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="editor ${compact ? "compact" : ""}">
      <div class="editor-backdrop" aria-hidden="true"></div>
      <textarea lang="en" spellcheck="false" autocorrect="off" autocapitalize="sentences" autocomplete="off" placeholder="${esc(placeholder)}"></textarea>
      <div class="editor-foot">
        <span class="wordcount">0 mot</span>
        ${dictationSupported() ? `<button type="button" class="mic" aria-label="Dicter en anglais">${icons.mic}<span>Dicter</span></button>` : ""}
      </div>
    </div>
    <div class="suggest" hidden></div>`;
  const ta = wrap.querySelector("textarea");
  const back = wrap.querySelector(".editor-backdrop");
  const count = wrap.querySelector(".wordcount");
  const bar = wrap.querySelector(".suggest");
  const micBtn = wrap.querySelector(".mic");
  let bad = [];
  let activeIdx = -1;
  let timer;

  ta.value = value;

  function autosize() {
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
  }

  function paint() {
    const t = ta.value;
    let html = "";
    let last = 0;
    bad.forEach((b, i) => {
      html += esc(t.slice(last, b.start)) + `<mark class="${i === activeIdx ? "active" : ""}">${esc(t.slice(b.start, b.end))}</mark>`;
      last = b.end;
    });
    html += esc(t.slice(last)) + "\n";
    back.innerHTML = html;
  }

  async function check() {
    if (!ready) { readyCallbacks.push(check); return; }
    const text = ta.value;
    const res = await ask({ type: "check", text });
    if (text !== ta.value) return; // le texte a changé entre-temps
    bad = res.bad.filter((b) => !ignored.has(b.word.toLowerCase()));
    caretChanged();
  }

  async function caretChanged() {
    const pos = ta.selectionStart;
    activeIdx = bad.findIndex((b) => pos >= b.start && pos <= b.end);
    paint();
    if (activeIdx < 0 || document.activeElement !== ta) {
      // Si le curseur n'est pas sur une faute, on garde la barre fermée
      if (activeIdx < 0) bar.hidden = true;
      return;
    }
    const b = bad[activeIdx];
    const res = await ask({ type: "suggest", word: b.word });
    if (bad[activeIdx] !== b) return;
    showBar(b, res.suggestions);
  }

  function showBar(b, suggestions) {
    bar.innerHTML = `<span class="bad">${esc(b.word)}</span><span class="arrow">→</span>` +
      (suggestions.length
        ? suggestions.map((s, i) => `<button type="button" class="chip ${i ? "alt" : ""}" data-s="${esc(s)}">${esc(s)}</button>`).join("")
        : `<span class="hint">Aucune suggestion</span>`) +
      `<button type="button" class="chip ignore" data-ignore="1">Ignorer</button>`;
    bar.hidden = false;
    bar.onpointerdown = (e) => e.preventDefault(); // garde le clavier ouvert
    bar.onclick = (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      if (btn.dataset.ignore) {
        ignored.add(b.word.toLowerCase());
      } else {
        const s = btn.dataset.s;
        ta.value = ta.value.slice(0, b.start) + s + ta.value.slice(b.end);
        const caret = b.start + s.length;
        ta.setSelectionRange(caret, caret);
      }
      bar.hidden = true;
      bad = bad.filter((x) => x !== b);
      update();
    };
  }

  function update() {
    autosize();
    const n = countWords(ta.value);
    count.textContent = `${n} mot${n > 1 ? "s" : ""}`;
    paint();
    onChange(ta.value);
    clearTimeout(timer);
    timer = setTimeout(check, 280);
  }

  ta.addEventListener("input", () => {
    // Pendant la frappe, on décale les fautes existantes et on attend la vérification
    bad = [];
    activeIdx = -1;
    bar.hidden = true;
    update();
  });
  ["click", "keyup", "focus"].forEach((ev) => ta.addEventListener(ev, () => setTimeout(caretChanged, 0)));
  ta.addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== ta) { activeIdx = -1; paint(); bar.hidden = true; } }, 150));

  // Dictée
  let dictation = null;
  if (micBtn) {
    micBtn.addEventListener("click", () => {
      if (dictation) { dictation.stop(); return; }
      const base = ta.value;
      dictation = createDictation({
        onText: (finalText, interim) => {
          const sep = base && !/\s$/.test(base) ? " " : "";
          ta.value = base + sep + finalText + (interim ? (finalText ? " " : "") + interim : "");
          update();
        },
        onEnd: (err) => {
          dictation = null;
          micBtn.classList.remove("on");
          micBtn.querySelector("span").textContent = "Dicter";
          if (err) window.dispatchEvent(new CustomEvent("langue-toast", { detail: err }));
        },
      });
      if (dictation) {
        micBtn.classList.add("on");
        micBtn.querySelector("span").textContent = "Stop";
      }
    });
  }

  requestAnimationFrame(() => { update(); });

  return {
    el: wrap,
    get value() { return ta.value; },
    set value(v) { ta.value = v; update(); },
    focus() { ta.focus(); },
    stop() { if (dictation) dictation.stop(); },
  };
}
