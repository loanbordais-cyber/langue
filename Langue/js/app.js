import * as store from "./store.js";
import { dayKey, prettyDate, shortDate, esc, toast, icons, waveLoader, checkAnswer, shuffle, countWords } from "./util.js";
import { createEditor, preloadSpell } from "./editor.js";
import { speak } from "./speech.js";

const app = document.getElementById("app");
const tabbar = document.getElementById("tabbar");
const state = { key: null, daily: null, words: [], loadingDaily: null };

window.addEventListener("langue-toast", (e) => toast(e.detail));

/* =========================================================
   Démarrage
   ========================================================= */
async function boot() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  preloadSpell();
  try {
    await store.init();
  } catch (e) {
    console.error(e);
  }
  setTimeout(() => document.getElementById("splash").classList.add("hide"), 900);
  window.addEventListener("hashchange", route);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.key && state.key !== dayKey()) {
      state.daily = null; // il est passé 3h : nouvelle journée
      route();
    }
  });
  // Vérifie le passage de 3h même si l'appli reste ouverte
  setInterval(() => { if (state.key && state.key !== dayKey()) { state.daily = null; route(); } }, 60 * 1000);
  route();
}

/* =========================================================
   Données du jour (générées une fois par jour, à partir de 3h)
   ========================================================= */
async function ensureDaily(force = false) {
  const key = dayKey();
  if (!force && state.daily && state.key === key) return state.daily;
  if (state.loadingDaily) return state.loadingDaily;
  state.loadingDaily = (async () => {
    state.words = await store.listWords();
    let d = await store.getDaily(key);
    if (!d) {
      const gen = await store.ai("daily", { exclude: state.words.map((w) => w.en) });
      const saved = await store.addWords(gen.words, key);
      state.words = [...saved, ...state.words];
      const prev = await store.previousDailyWithWords(key);
      d = {
        word_ids: saved.map((w) => w.id),
        all_ids: saved.map((w) => w.id),
        words_seen: false,
        review: prev ? { ids: prev.all_ids || prev.word_ids, from: prev.day_key, answers: [], done: false } : null,
        text: null,
        text_draft: "",
        questions: gen.questions,
        answers: null,
        answer_drafts: [],
      };
      await store.saveDaily(key, d);
    }
    state.key = key;
    state.daily = d;
    return d;
  })();
  try { return await state.loadingDaily; }
  finally { state.loadingDaily = null; }
}

async function saveDaily() { await store.saveDaily(state.key, state.daily); }
const wordById = (id) => state.words.find((w) => w.id === id);

function status() {
  const d = state.daily;
  const text = d.text?.feedback ? "done" : (d.text_draft || "").trim() ? "part" : "todo";
  const reviewNeeded = d.review && d.review.ids?.length;
  const words = d.words_seen && (!reviewNeeded || d.review.done) ? "done" : d.words_seen ? "part" : "todo";
  const q = d.answers?.feedback ? "done" : (d.answer_drafts || []).some((a) => a && a.trim()) ? "part" : "todo";
  return { text, words, questions: q };
}

/* =========================================================
   Routeur
   ========================================================= */
const TABS = [
  { id: "home", label: "Aujourd'hui", icon: icons.home },
  { id: "library", label: "Mes mots", icon: icons.book },
  { id: "stats", label: "Progrès", icon: icons.chart },
  { id: "settings", label: "Réglages", icon: icons.gear },
];

function route() {
  const page = (location.hash.replace(/^#\/?/, "") || "home").split("?")[0];
  window.speechSynthesis?.cancel?.();
  if (store.mode === "cloud" && !store.user) return renderLogin();
  const isTab = TABS.some((t) => t.id === page);
  tabbar.hidden = !isTab;
  app.classList.toggle("no-tabbar", !isTab);
  if (isTab) {
    tabbar.innerHTML = TABS.map((t) => `<button class="tab ${t.id === page ? "on" : ""}" data-go="${t.id}">${t.icon}<span>${t.label}</span></button>`).join("");
    tabbar.onclick = (e) => { const b = e.target.closest("[data-go]"); if (b) go(b.dataset.go); };
  }
  window.scrollTo(0, 0);
  const views = { home: renderHome, text: renderText, words: renderWords, questions: renderQuestions, library: renderLibrary, stats: renderStats, settings: renderSettings };
  (views[page] || renderHome)();
}
function go(page) { if (location.hash === "#/" + page) route(); else location.hash = "#/" + page; }

function loading(msg) {
  app.innerHTML = `<div class="loading fade-in">${waveLoader}<span>${esc(msg)}</span></div>`;
}
function errorView(err, retry) {
  app.innerHTML = `<div class="loading fade-in"><span>${esc(err.message || "Une erreur est survenue.")}</span><button class="btn small secondary" id="retry">${icons.refresh}Réessayer</button></div>`;
  app.querySelector("#retry").onclick = retry;
}
function header(title, right = "") {
  return `<div class="topbar"><button class="back" data-back aria-label="Retour">${icons.back}</button><h2 class="page-title">${esc(title)}</h2>${right}</div>`;
}
function bindBack() { app.querySelector("[data-back]")?.addEventListener("click", () => go("home")); }
const demoBanner = () => store.mode === "demo"
  ? `<div class="demo-banner">Mode démo : l'IA est simulée et seule l'orthographe est corrigée. Suis le GUIDE pour activer la vraie correction et la sauvegarde dans le cloud.</div>` : "";

/* =========================================================
   Connexion (mode cloud)
   ========================================================= */
function renderLogin(mode = "signin") {
  tabbar.hidden = true;
  app.classList.add("no-tabbar");
  const isUp = mode === "signup";
  app.innerHTML = `
    <div class="fade-in" style="padding-top:10vh">
      <div class="center"><span class="brand" style="font-size:44px">langue</span></div>
      <p class="center muted mt24" style="font-size:16px;line-height:1.5">Ton anglais, un peu chaque jour.</p>
      <form class="card mt24 stack" id="login-card" autocomplete="on">
        <div class="seg"><button type="button" data-m="signin" class="${!isUp ? "on" : ""}">Se connecter</button><button type="button" data-m="signup" class="${isUp ? "on" : ""}">Créer mon compte</button></div>
        <input class="input" id="email" name="email" type="email" inputmode="email" autocomplete="username" autocapitalize="off" placeholder="toi@exemple.com">
        <input class="input" id="pass" name="password" type="password" autocomplete="${isUp ? "new-password" : "current-password"}" placeholder="Mot de passe${isUp ? " (8 caractères min.)" : ""}">
        <button class="btn" id="go" type="submit">${isUp ? "Créer mon compte" : "Me connecter"}</button>
        ${!isUp ? `<button class="btn ghost" id="forgot" type="button">Mot de passe oublié</button>` : ""}
      </form>
    </div>`;
  const card = app.querySelector("#login-card");
  card.querySelectorAll("[data-m]").forEach((b) => b.onclick = () => renderLogin(b.dataset.m));
  app.querySelector("#forgot")?.addEventListener("click", async () => {
    const email = app.querySelector("#email").value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) return toast("Entre d'abord ton adresse e-mail");
    try { await store.resetPassword(email); toast("E-mail de réinitialisation envoyé"); } catch (e) { toast(e.message); }
  });
  card.onsubmit = async (e) => {
    e.preventDefault();
    const email = app.querySelector("#email").value.trim();
    const pass = app.querySelector("#pass").value;
    if (!/^\S+@\S+\.\S+$/.test(email)) return toast("Entre une adresse e-mail valide");
    if (pass.length < (isUp ? 8 : 1)) return toast(isUp ? "Mot de passe : 8 caractères minimum" : "Entre ton mot de passe");
    const btn = app.querySelector("#go"); btn.disabled = true;
    try {
      if (isUp) {
        const loggedIn = await store.signUp(email, pass);
        if (loggedIn) return go("home");
        card.innerHTML = `<p class="hint" style="color:var(--text-2);line-height:1.6">Compte créé ! Ouvre l'e-mail envoyé à <b style="color:var(--text)">${esc(email)}</b> et clique sur le lien pour le confirmer (regarde aussi dans les spams). Reviens ensuite ici pour te connecter.</p><button class="btn" id="back" type="button">Me connecter</button>`;
        card.querySelector("#back").onclick = () => renderLogin("signin");
      } else {
        await store.signIn(email, pass);
        go("home");
      }
    } catch (err) {
      btn.disabled = false;
      const m = String(err.message || "");
      toast(/invalid login/i.test(m) ? "E-mail ou mot de passe incorrect"
        : /not confirmed/i.test(m) ? "Confirme d'abord ton e-mail (lien reçu)"
        : /already registered/i.test(m) ? "Ce compte existe déjà, connecte-toi"
        : /signups not allowed/i.test(m) ? "Les inscriptions sont fermées"
        : m);
    }
  };
}

/* =========================================================
   Accueil
   ========================================================= */
async function renderHome() {
  if (!state.daily || state.key !== dayKey()) loading("Je prépare ta journée…");
  try { await ensureDaily(); } catch (e) { return errorView(e, renderHome); }
  const s = status();
  const done = Object.values(s).filter((v) => v === "done").length;
  const events = await store.listEvents().catch(() => []);
  const days = new Set(events.map((e) => e.day_key)).size;
  const hour = new Date().getHours();
  const hello = hour < 12 && hour >= 3 ? "Good morning" : hour < 18 && hour >= 3 ? "Good afternoon" : "Good evening";
  const badge = (v) => v === "done" ? `<span class="badge done">Fait ✓</span>` : v === "part" ? `<span class="badge part">En cours</span>` : `<span class="badge todo">À faire</span>`;
  const reviewCount = state.daily.review?.ids?.length || 0;

  app.innerHTML = `
    <div class="fade-in">
      <div class="topbar"><span class="brand">langue</span></div>
      ${demoBanner()}
      <p class="greeting">${hello} 👋</p>
      <h1 class="date-line">${prettyDate(state.key)}</h1>
      <div class="metrics">
        <div class="metric"><div class="metric-val">${done}/3</div><div class="metric-lbl">exos du jour</div></div>
        <div class="metric"><div class="metric-val">${state.words.length}</div><div class="metric-lbl">mots appris</div></div>
        <div class="metric"><div class="metric-val">${days}</div><div class="metric-lbl">jours actifs</div></div>
      </div>
      <div class="progress-ring mt12"><div class="progress-bar"><i style="width:${(done / 3) * 100}%"></i></div></div>
      <div class="section-label">Aujourd'hui</div>
      <div class="stack">
        <button class="exo" data-go="text">
          <div class="exo-icon" style="background:var(--blue-bg);color:var(--blue)">${icons.pen}</div>
          <div class="exo-body"><div class="exo-title">Texte du jour</div><div class="exo-sub">Écris ou raconte ce que tu veux</div></div>
          ${badge(s.text)}
        </button>
        <button class="exo" data-go="words">
          <div class="exo-icon" style="background:var(--amber-bg);color:var(--amber)">${icons.cards}</div>
          <div class="exo-body"><div class="exo-title">Mots du jour</div><div class="exo-sub">2 nouveaux mots${reviewCount ? ` + ${reviewCount} à retrouver` : ""}</div></div>
          ${badge(s.words)}
        </button>
        <button class="exo" data-go="questions">
          <div class="exo-icon" style="background:var(--green-bg);color:var(--green)">${icons.chat}</div>
          <div class="exo-body"><div class="exo-title">Questions du jour</div><div class="exo-sub">${state.daily.questions.length} questions ouvertes</div></div>
          ${badge(s.questions)}
        </button>
      </div>
      <p class="hint center mt24">${done === 3 ? "Bravo, tout est fait pour aujourd'hui ! " : ""}Nouveaux exercices chaque jour à 3h.</p>
    </div>`;
  app.querySelectorAll("[data-go]").forEach((b) => b.onclick = () => go(b.dataset.go));
}

/* =========================================================
   Affichage d'une correction
   ========================================================= */
function scoreColor(score) {
  return score >= 8 ? ["var(--green-bg)", "var(--green)"] : score >= 5 ? ["var(--amber-bg)", "var(--amber)"] : ["var(--red-bg)", "var(--red)"];
}
function feedbackHTML(fb, { original = null, compact = false } = {}) {
  const [bg, fg] = scoreColor(fb.score ?? 0);
  const errors = fb.errors || [];
  const improvements = fb.improvements || [];
  const positives = fb.positives || [];
  return `
    ${compact ? "" : `<div class="fb-score"><div class="score-circle" style="background:${bg};color:${fg}">${fb.score ?? "–"}<small style="font-size:12px;opacity:.7">/10</small></div><p class="fb-summary">${esc(fb.summary || "")}</p></div>`}
    ${compact && fb.summary ? `<p class="fb-summary">${esc(fb.summary)}</p>` : ""}
    ${errors.length ? `<div class="fb-block"><div class="fb-title"><span class="dot" style="background:var(--red)"></span>Fautes (${errors.length})</div>
      ${errors.map((e) => `<div class="fb-item"><div class="fb-change"><del>${esc(e.original)}</del> → <ins>${esc(e.correction)}</ins></div><div class="fb-expl">${esc(e.explanation)}</div></div>`).join("")}</div>`
      : `<div class="fb-block"><div class="fb-title"><span class="dot" style="background:var(--green)"></span>Aucune faute, bravo !</div></div>`}
    ${improvements.length ? `<div class="fb-block"><div class="fb-title"><span class="dot" style="background:var(--amber)"></span>Pour aller plus loin</div>
      ${improvements.map((e) => `<div class="fb-item"><div class="fb-change amber">${esc(e.original)} → <ins>${esc(e.suggestion)}</ins></div><div class="fb-expl">${esc(e.explanation)}</div></div>`).join("")}</div>` : ""}
    ${positives.length ? `<div class="fb-block"><div class="fb-title"><span class="dot" style="background:var(--green)"></span>Ce qui est bien</div>
      ${positives.map((p) => `<p class="fb-pos">✓ ${esc(p)}</p>`).join("")}</div>` : ""}
    ${fb.corrected_text && errors.length ? `<div class="fb-block"><div class="fb-title"><span class="dot" style="background:var(--blue)"></span>Version corrigée</div><div class="fb-item"><p class="corrected">${esc(fb.corrected_text)}</p></div></div>` : ""}
    ${original ? `<div class="fb-block"><details class="fold"><summary><span>Mon texte</span><span>▾</span></summary><p class="my-text mt8">${esc(original)}</p></details></div>` : ""}`;
}

/* =========================================================
   Texte du jour
   ========================================================= */
async function renderText() {
  try { await ensureDaily(); } catch (e) { return errorView(e, renderText); }
  const d = state.daily;

  if (d.text?.feedback) {
    app.innerHTML = `<div class="fade-in">
      ${header("Texte du jour")}
      <div class="card">${feedbackHTML(d.text.feedback, { original: d.text.content })}</div>
      <button class="btn secondary mt16" id="again">${icons.refresh}Écrire un nouveau texte</button>
    </div>`;
    bindBack();
    app.querySelector("#again").onclick = async () => {
      d.text = null; d.text_draft = "";
      await saveDaily(); renderText();
    };
    return;
  }

  app.innerHTML = `<div class="fade-in">
    ${header("Texte du jour")}
    ${demoBanner()}
    <p class="hint" style="margin-bottom:12px">Sujet libre : ta journée, une idée, une histoire… Écris en anglais ou appuie sur « Dicter » pour le raconter à l'oral. Touche un mot souligné en rouge pour voir la correction.</p>
    <div id="ed"></div>
    <button class="btn mt16" id="send">${icons.check}Corriger mon texte</button>
  </div>`;
  bindBack();
  let saveTimer;
  const ed = createEditor({
    value: d.text_draft || "",
    placeholder: "Today I…",
    onChange: (v) => { d.text_draft = v; clearTimeout(saveTimer); saveTimer = setTimeout(() => saveDaily().catch(() => {}), 1500); },
  });
  app.querySelector("#ed").appendChild(ed.el);
  app.querySelector("#send").onclick = async () => {
    const text = ed.value.trim();
    if (countWords(text) < 3) return toast("Écris au moins une phrase");
    ed.stop();
    clearTimeout(saveTimer);
    loading("Je relis ton texte…");
    try {
      const fb = await store.ai("correct_text", { text });
      d.text = { content: text, feedback: fb };
      await saveDaily();
      await store.addEvent({ kind: "text", day_key: state.key, errors: (fb.errors || []).length, score: fb.score });
      renderText();
    } catch (e) {
      d.text_draft = text;
      toast(e.message);
      renderText();
    }
  };
}

/* =========================================================
   Mots du jour : cartes mémo + révision de la veille
   ========================================================= */
function flashcardHTML(w, frontLang = "en") {
  const front = frontLang === "en"
    ? `<span class="tag">Anglais</span><button class="speak" data-speak="${esc(w.en)}" aria-label="Écouter">${icons.speaker}</button><div class="word">${esc(w.en)}</div><div class="pos">${esc(w.pos || "")}</div><span class="tap">Devine le sens, puis touche pour retourner</span>`
    : `<span class="tag">Français</span><div class="word" style="font-size:32px">${esc(w.fr)}</div><span class="tap">Touche pour voir l'anglais</span>`;
  const back = frontLang === "en"
    ? `<span class="tag">Français</span><div class="word" style="font-size:32px">${esc(w.fr)}</div>${w.example ? `<p class="ex">“${esc(w.example)}”</p><p class="ex-fr">${esc(w.example_fr || "")}</p>` : ""}`
    : `<span class="tag">Anglais</span><button class="speak" data-speak="${esc(w.en)}" aria-label="Écouter">${icons.speaker}</button><div class="word">${esc(w.en)}</div>${w.example ? `<p class="ex">“${esc(w.example)}”</p>` : ""}`;
  return `<div class="flip-wrap"><div class="flip"><div class="face f-front">${front}</div><div class="face f-back">${back}</div></div></div>`;
}
function bindFlip(root, onFlip) {
  const flip = root.querySelector(".flip");
  root.querySelectorAll("[data-speak]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); speak(b.dataset.speak); }));
  flip.addEventListener("click", () => { flip.classList.toggle("flipped"); onFlip?.(flip.classList.contains("flipped")); });
}

async function renderWords() {
  try { await ensureDaily(); } catch (e) { return errorView(e, renderWords); }
  const d = state.daily;
  const newWords = d.word_ids.map(wordById).filter(Boolean);
  const reviewWords = (d.review?.ids || []).map(wordById).filter(Boolean);

  if (!d.words_seen) return wordsCards(newWords, 0);
  if (reviewWords.length && !d.review.done) return wordsQuiz(reviewWords, d.review.answers.length);
  wordsSummary(newWords, reviewWords);
}

function wordsCards(words, i) {
  const d = state.daily;
  const w = words[i];
  app.innerHTML = `<div class="fade-in">
    ${header("Mots du jour")}
    <p class="quiz-label">Nouveau mot ${i + 1}/${words.length}</p>
    <div class="dots">${words.map((_, k) => `<i class="${k === i ? "on" : ""}"></i>`).join("")}</div>
    ${flashcardHTML(w, "en")}
    <button class="btn mt24" id="next" disabled>${i + 1 < words.length ? "Mot suivant" : (d.review?.ids?.length && !d.review.done ? "Passer aux mots d'hier" : "Terminer")}</button>
  </div>`;
  bindBack();
  const next = app.querySelector("#next");
  bindFlip(app, (flipped) => { if (flipped) next.disabled = false; });
  next.onclick = async () => {
    if (i + 1 < words.length) return wordsCards(words, i + 1);
    d.words_seen = true;
    await saveDaily();
    renderWords();
  };
}

function wordsQuiz(words, i) {
  const d = state.daily;
  const w = words[i];
  app.innerHTML = `<div class="fade-in">
    ${header("Mots d'hier")}
    <p class="quiz-label">Traduis en anglais · ${i + 1}/${words.length}</p>
    <div class="dots">${words.map((_, k) => `<i class="${k === i ? "on" : ""}"></i>`).join("")}</div>
    <div class="card" style="padding:28px 18px"><div class="quiz-word">${esc(w.fr)}</div></div>
    <input class="input mt16" id="ans" lang="en" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="En anglais…" enterkeyhint="done">
    <div id="res" class="mt12"></div>
    <button class="btn mt16" id="check">Vérifier</button>
  </div>`;
  bindBack();
  const input = app.querySelector("#ans");
  const btn = app.querySelector("#check");
  setTimeout(() => input.focus(), 300);
  let answered = false;
  const submit = async () => {
    if (answered) {
      if (i + 1 < words.length) return wordsQuiz(words, i + 1);
      d.review.done = true;
      const good = d.review.answers.filter((a) => a.ok).length;
      await saveDaily();
      await store.addEvent({ kind: "review", day_key: state.key, score: Math.round((good / words.length) * 10), errors: words.length - good });
      return renderWords();
    }
    const val = input.value.trim();
    if (!val) return toast("Écris ta réponse (ou « ? » si tu ne sais pas)");
    const res = checkAnswer(val, [w.en, ...(w.alternatives || [])]);
    answered = true;
    input.readOnly = true;
    d.review.answers.push({ id: w.id, answer: val, ok: !!res });
    await saveDaily();
    app.querySelector("#res").innerHTML = res
      ? `<div class="result ok">${res === "exact" ? "Exact !" : "Accepté, petite faute :"} <b>${esc(w.en)}</b>${w.example ? `<div class="fb-expl">“${esc(w.example)}”</div>` : ""}</div>`
      : `<div class="result ko">Pas tout à fait. La réponse : <b>${esc(w.en)}</b>${w.example ? `<div class="fb-expl">“${esc(w.example)}”</div>` : ""}</div>`;
    if (res) speak(w.en);
    btn.textContent = i + 1 < words.length ? "Mot suivant" : "Voir mon résultat";
  };
  btn.onclick = submit;
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
}

function wordsSummary(newWords, reviewWords) {
  const d = state.daily;
  const answers = d.review?.answers || [];
  const good = answers.filter((a) => a.ok).length;
  app.innerHTML = `<div class="fade-in">
    ${header("Mots du jour")}
    ${reviewWords.length ? `<div class="card center"><div class="metric-val" style="font-size:40px">${good}/${reviewWords.length}</div><p class="muted mt8">mots d'hier retrouvés</p></div>` : ""}
    <div class="section-label">Nouveaux mots d'aujourd'hui</div>
    <div class="card" style="padding:4px 16px">${newWords.map((w) => `
      <div class="word-row"><div><div class="word-en">${esc(w.en)}</div><div class="word-date">${esc(w.pos || "")}</div></div><div class="word-fr">${esc(w.fr)}</div></div>`).join("")}</div>
    ${!reviewWords.length ? `<p class="hint mt12">Demain, je te les donnerai en français et tu devras les retrouver en anglais.</p>` : ""}
    ${reviewWords.length ? `<div class="section-label">Mots d'hier</div>
    <div class="card" style="padding:4px 16px">${reviewWords.map((w) => {
      const a = answers.find((x) => x.id === w.id);
      return `<div class="word-row"><div><div class="word-en">${esc(w.en)}</div><div class="word-date">${a ? (a.ok ? "✓ trouvé" : `✗ tu as écrit « ${esc(a.answer)} »`) : ""}</div></div><div class="word-fr">${esc(w.fr)}</div></div>`;
    }).join("")}</div>` : ""}
    <div class="row mt24">
      <button class="btn secondary" id="replay">Revoir</button>
      <button class="btn secondary" id="reset">${icons.refresh}+2 mots</button>
    </div>
  </div>`;
  bindBack();
  app.querySelector("#replay").onclick = () => wordsCards(newWords, 0);
  app.querySelector("#reset").onclick = async () => {
    loading("Je choisis 2 nouveaux mots…");
    try {
      const gen = await store.ai("words", { exclude: state.words.map((w) => w.en) });
      const saved = await store.addWords(gen.words, state.key);
      state.words = [...saved, ...state.words];
      d.word_ids = saved.map((w) => w.id);
      d.all_ids = [...(d.all_ids || []), ...d.word_ids];
      d.words_seen = false;
      if (d.review) { d.review.done = false; d.review.answers = []; }
      await saveDaily();
      renderWords();
    } catch (e) { toast(e.message); renderWords(); }
  };
}

/* =========================================================
   Questions du jour
   ========================================================= */
async function renderQuestions() {
  try { await ensureDaily(); } catch (e) { return errorView(e, renderQuestions); }
  const d = state.daily;
  const qs = d.questions;

  if (d.answers?.feedback) {
    const fb = d.answers.feedback;
    app.innerHTML = `<div class="fade-in">
      ${header("Questions du jour")}
      ${fb.summary ? `<div class="card"><p class="fb-summary">${esc(fb.summary)}</p></div>` : ""}
      ${qs.map((q, i) => {
        const item = fb.items?.[i] || {};
        const [bg, fg] = scoreColor(item.score ?? 0);
        return `<div class="section-label">Question ${i + 1}</div>
        <div class="card">
          <div style="display:flex;gap:12px;align-items:flex-start"><p class="q-text" style="flex:1;font-size:18px">${esc(q.q)}</p><span class="badge" style="background:${bg};color:${fg}">${item.score ?? "–"}/10</span></div>
          <p class="my-text" style="margin-bottom:6px">${esc(d.answers.items[i] || "")}</p>
          ${feedbackHTML(item, { compact: true })}
        </div>`;
      }).join("")}
      <button class="btn secondary mt24" id="again">${icons.refresh}5 nouvelles questions</button>
    </div>`;
    bindBack();
    app.querySelector("#again").onclick = async () => {
      loading("Je prépare de nouvelles questions…");
      try {
        const gen = await store.ai("questions", {});
        d.questions = gen.questions; d.answers = null; d.answer_drafts = [];
        await saveDaily(); renderQuestions();
      } catch (e) { toast(e.message); renderQuestions(); }
    };
    return;
  }

  app.innerHTML = `<div class="fade-in">
    ${header("Questions du jour")}
    ${demoBanner()}
    <p class="hint" style="margin-bottom:4px">Réponds en anglais, à l'écrit ou avec « Dicter ». Quelques phrases suffisent.</p>
    <div id="qs"></div>
    <button class="btn mt24" id="send">${icons.check}Corriger mes réponses</button>
  </div>`;
  bindBack();
  const box = app.querySelector("#qs");
  d.answer_drafts = d.answer_drafts || [];
  let saveTimer;
  const editors = qs.map((q, i) => {
    const wrap = document.createElement("div");
    wrap.innerHTML = `<div class="section-label">Question ${i + 1}</div><span class="q-type">${esc(q.type || "")}</span><p class="q-text">${esc(q.q)}</p>`;
    const ed = createEditor({
      compact: true, value: d.answer_drafts[i] || "", placeholder: "Your answer…",
      onChange: (v) => { d.answer_drafts[i] = v; clearTimeout(saveTimer); saveTimer = setTimeout(() => saveDaily().catch(() => {}), 1500); },
    });
    wrap.appendChild(ed.el);
    box.appendChild(wrap);
    return ed;
  });
  app.querySelector("#send").onclick = async () => {
    const answers = editors.map((e) => e.value.trim());
    const missing = answers.findIndex((a) => countWords(a) < 2);
    if (missing >= 0) return toast(`Réponds à la question ${missing + 1}`);
    editors.forEach((e) => e.stop());
    clearTimeout(saveTimer);
    loading("Je corrige tes réponses…");
    try {
      const fb = await store.ai("correct_answers", { items: qs.map((q, i) => ({ question: q.q, answer: answers[i] })) });
      d.answers = { items: answers, feedback: fb };
      await saveDaily();
      const errs = (fb.items || []).reduce((n, it) => n + (it.errors || []).length, 0);
      const avg = (fb.items || []).reduce((n, it) => n + (it.score || 0), 0) / Math.max(1, (fb.items || []).length);
      await store.addEvent({ kind: "questions", day_key: state.key, errors: errs, score: Math.round(avg * 10) / 10 });
      renderQuestions();
    } catch (e) { toast(e.message); renderQuestions(); }
  };
}

/* =========================================================
   Mes mots : bibliothèque + révision libre
   ========================================================= */
const libState = { tab: "list", q: "", dir: "fr-en", count: "10", format: "write" };

async function renderLibrary() {
  loading("Chargement de tes mots…");
  try { state.words = await store.listWords(); } catch (e) { return errorView(e, renderLibrary); }
  const words = state.words;
  app.innerHTML = `<div class="fade-in">
    <div class="topbar"><h1>Mes mots</h1><span class="badge todo">${words.length} mot${words.length > 1 ? "s" : ""}</span></div>
    <div class="seg" id="tabs"><button data-t="list" class="${libState.tab === "list" ? "on" : ""}">Liste</button><button data-t="review" class="${libState.tab === "review" ? "on" : ""}">Réviser</button></div>
    <div id="lib" class="mt16"></div>
  </div>`;
  app.querySelector("#tabs").onclick = (e) => { const b = e.target.closest("[data-t]"); if (b) { libState.tab = b.dataset.t; renderLibrary(); } };
  const lib = app.querySelector("#lib");

  if (!words.length) {
    lib.innerHTML = `<div class="empty">Ta bibliothèque est vide pour l'instant.<br>Chaque jour, les 2 mots du jour s'ajoutent ici.</div>`;
    return;
  }

  if (libState.tab === "list") {
    lib.innerHTML = `<input class="search" id="q" type="search" placeholder="Chercher un mot…" value="${esc(libState.q)}" autocorrect="off" autocapitalize="off" spellcheck="false"><div class="card mt12" style="padding:4px 16px" id="list"></div>`;
    const list = lib.querySelector("#list");
    const draw = () => {
      const q = libState.q.toLowerCase().trim();
      const f = words.filter((w) => !q || w.en.toLowerCase().includes(q) || w.fr.toLowerCase().includes(q));
      list.innerHTML = f.length ? f.map((w) => `
        <div class="word-row" data-speak="${esc(w.en)}"><div><div class="word-en">${esc(w.en)}</div><div class="word-date">${shortDate(w.day_key || w.created_at)}</div></div><div class="word-fr">${esc(w.fr)}</div></div>`).join("")
        : `<div class="empty">Aucun mot trouvé.</div>`;
      list.querySelectorAll("[data-speak]").forEach((r) => r.onclick = () => speak(r.dataset.speak));
    };
    lib.querySelector("#q").oninput = (e) => { libState.q = e.target.value; draw(); };
    draw();
    return;
  }

  const opt = (name, val, label) => `<button data-${name}="${val}" class="${libState[name] === val ? "on" : ""}">${label}</button>`;
  lib.innerHTML = `
    <div class="card stack">
      <div><p class="hint" style="margin-bottom:8px">Sens</p><div class="seg" data-group="dir">${opt("dir", "fr-en", "Français → Anglais")}${opt("dir", "en-fr", "Anglais → Français")}</div></div>
      <div><p class="hint" style="margin-bottom:8px">Nombre de mots</p><div class="seg" data-group="count">${opt("count", "10", "10")}${opt("count", "20", "20")}${opt("count", "all", `Tous (${words.length})`)}</div></div>
      <div><p class="hint" style="margin-bottom:8px">Format</p><div class="seg" data-group="format">${opt("format", "write", "J'écris")}${opt("format", "cards", "Cartes mémo")}</div></div>
    </div>
    <button class="btn mt16" id="start">${icons.shuffle}Commencer la révision</button>`;
  lib.querySelectorAll("[data-group]").forEach((g) => g.onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    const k = g.dataset.group; libState[k] = b.dataset[k]; renderLibrary();
  });
  lib.querySelector("#start").onclick = () => {
    const n = libState.count === "all" ? words.length : Number(libState.count);
    startReview(shuffle(words).slice(0, n));
  };
}

function startReview(list) {
  const session = { list, i: 0, good: 0, results: [] };
  tabbar.hidden = true;
  app.classList.add("no-tabbar");
  reviewStep(session);
}

function reviewStep(s) {
  if (s.i >= s.list.length) return reviewEnd(s);
  const w = s.list[s.i];
  const fromFr = libState.dir === "fr-en";
  const top = `<div class="topbar"><button class="back" id="quit" aria-label="Quitter">${icons.back}</button><h2 class="page-title">Révision</h2><span class="badge todo">${s.i + 1}/${s.list.length}</span></div>
    <div class="progress-bar" style="margin-bottom:22px"><i style="width:${(s.i / s.list.length) * 100}%"></i></div>`;

  if (libState.format === "cards") {
    app.innerHTML = `<div class="fade-in">${top}${flashcardHTML(w, fromFr ? "fr" : "en")}
      <div class="row mt24" id="grade" style="visibility:hidden"><button class="btn secondary" data-ok="0">À revoir</button><button class="btn" data-ok="1">Je savais ✓</button></div></div>`;
    bindFlip(app, (f) => { if (f) app.querySelector("#grade").style.visibility = "visible"; });
    app.querySelector("#grade").onclick = (e) => {
      const b = e.target.closest("[data-ok]"); if (!b) return;
      const ok = b.dataset.ok === "1";
      if (ok) s.good++;
      s.results.push({ w, ok });
      s.i++; reviewStep(s);
    };
  } else {
    app.innerHTML = `<div class="fade-in">${top}
      <p class="quiz-label">${fromFr ? "Traduis en anglais" : "Traduis en français"}</p>
      <div class="card mt12" style="padding:28px 18px;position:relative">${!fromFr ? `<button class="speak" data-speak="${esc(w.en)}" aria-label="Écouter">${icons.speaker}</button>` : ""}<div class="quiz-word">${esc(fromFr ? w.fr : w.en)}</div></div>
      <input class="input mt16" id="ans" lang="${fromFr ? "en" : "fr"}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="${fromFr ? "En anglais…" : "En français…"}" enterkeyhint="done">
      <div id="res" class="mt12"></div>
      <button class="btn mt16" id="check">Vérifier</button></div>`;
    app.querySelector("[data-speak]")?.addEventListener("click", () => speak(w.en));
    const input = app.querySelector("#ans");
    setTimeout(() => input.focus(), 250);
    let done = false;
    const submit = () => {
      if (done) { s.i++; return reviewStep(s); }
      const val = input.value.trim();
      if (!val) return toast("Écris ta réponse");
      const res = checkAnswer(val, fromFr ? [w.en, ...(w.alternatives || [])] : [w.fr]);
      done = true; input.readOnly = true;
      if (res) s.good++;
      s.results.push({ w, ok: !!res, answer: val });
      const answer = fromFr ? w.en : w.fr;
      app.querySelector("#res").innerHTML = res
        ? `<div class="result ok">${res === "exact" ? "Exact !" : "Accepté :"} <b>${esc(answer)}</b></div>`
        : `<div class="result ko">La réponse : <b>${esc(answer)}</b></div>`;
      app.querySelector("#check").textContent = s.i + 1 < s.list.length ? "Suivant" : "Voir mon résultat";
    };
    app.querySelector("#check").onclick = submit;
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
  }
  app.querySelector("#quit").onclick = () => { s.list = s.list.slice(0, s.i); reviewEnd(s); };
}

async function reviewEnd(s) {
  const total = s.results.length;
  if (total) await store.addEvent({ kind: "library", day_key: dayKey(), score: Math.round((s.good / total) * 10), errors: total - s.good }).catch(() => {});
  const missed = s.results.filter((r) => !r.ok);
  app.innerHTML = `<div class="fade-in">
    <div class="topbar"><h2 class="page-title">Résultat</h2></div>
    <div class="card center"><div class="metric-val" style="font-size:44px">${s.good}/${total}</div><p class="muted mt8">${total && s.good === total ? "Parfait, tout est acquis !" : "mots trouvés"}</p></div>
    ${missed.length ? `<div class="section-label">À retravailler</div><div class="card" style="padding:4px 16px">${missed.map((r) => `<div class="word-row"><div class="word-en">${esc(r.w.en)}</div><div class="word-fr">${esc(r.w.fr)}</div></div>`).join("")}</div>` : ""}
    <div class="row mt24">
      ${missed.length ? `<button class="btn secondary" id="redo">Revoir ces ${missed.length}</button>` : ""}
      <button class="btn" id="done">Terminer</button>
    </div>
  </div>`;
  app.querySelector("#done").onclick = () => go("library");
  app.querySelector("#redo")?.addEventListener("click", () => startReview(shuffle(missed.map((r) => r.w))));
}

/* =========================================================
   Progrès
   ========================================================= */
function barChart(points, color) {
  if (!points.length) return `<p class="hint">Pas encore de données.</p>`;
  const W = 320, H = 130, max = Math.max(3, ...points.map((p) => p.v));
  const bw = Math.min(26, (W - 10) / points.length - 6);
  const step = (W - 10) / points.length;
  const bars = points.map((p, i) => {
    const h = Math.max(3, (p.v / max) * (H - 26));
    const x = 5 + i * step + (step - bw) / 2;
    return `<rect x="${x}" y="${H - 18 - h}" width="${bw}" height="${h}" rx="5" fill="${color}"/><text x="${x + bw / 2}" y="${H - 22 - h}" text-anchor="middle" font-size="10" fill="#b4b2a9">${p.v}</text><text x="${x + bw / 2}" y="${H - 4}" text-anchor="middle" font-size="9" fill="#7d7b74">${esc(p.l)}</text>`;
  }).join("");
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Graphique">${bars}</svg>`;
}

async function renderStats() {
  loading("Calcul de tes progrès…");
  let events, words;
  try { [events, words] = await Promise.all([store.listEvents(), store.listWords()]); } catch (e) { return errorView(e, renderStats); }
  const texts = events.filter((e) => e.kind === "text");
  const qsets = events.filter((e) => e.kind === "questions");
  const reviews = events.filter((e) => e.kind === "review" || e.kind === "library");
  const days = new Set(events.map((e) => e.day_key)).size;
  const avg = (arr) => arr.length ? Math.round((arr.reduce((n, e) => n + Number(e.score || 0), 0) / arr.length) * 10) / 10 : "–";
  const reviewRate = reviews.length ? Math.round((reviews.reduce((n, e) => n + Number(e.score || 0), 0) / (reviews.length * 10)) * 100) + "%" : "–";
  const pts = (arr) => arr.slice(-12).map((e) => ({ v: Number(e.errors || 0), l: shortDate(e.day_key).replace(".", "") }));

  app.innerHTML = `<div class="fade-in">
    <div class="topbar"><h1>Progrès</h1></div>
    <div class="metrics">
      <div class="metric"><div class="metric-val">${words.length}</div><div class="metric-lbl">mots appris</div></div>
      <div class="metric"><div class="metric-val">${days}</div><div class="metric-lbl">jours actifs</div></div>
      <div class="metric"><div class="metric-val">${reviewRate}</div><div class="metric-lbl">mots retrouvés</div></div>
    </div>
    <div class="metrics two mt12">
      <div class="metric"><div class="metric-val">${texts.length}</div><div class="metric-lbl">textes écrits · note moy. ${avg(texts)}</div></div>
      <div class="metric"><div class="metric-val">${qsets.length * 5}</div><div class="metric-lbl">réponses · note moy. ${avg(qsets)}</div></div>
    </div>
    <div class="section-label">Fautes par texte</div>
    <div class="card">${barChart(pts(texts), "#E24B4A")}<p class="chart-legend">Les barres doivent baisser avec le temps : moins de fautes = progrès.</p></div>
    <div class="section-label">Fautes par série de questions</div>
    <div class="card">${barChart(pts(qsets), "#EF9F27")}</div>
  </div>`;
}

/* =========================================================
   Réglages
   ========================================================= */
function urlB64ToUint8Array(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function renderSettings() {
  const cfg = window.LANGUE_CONFIG || {};
  const installed = window.navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
  const pushPossible = store.mode === "cloud" && "PushManager" in window && "Notification" in window && cfg.VAPID_PUBLIC_KEY;
  let push = null;
  if (store.mode === "cloud") push = await store.getPushSettings().catch(() => null);
  const enabled = !!push?.enabled && typeof Notification !== "undefined" && Notification.permission === "granted";
  const hour = push?.remind_hour ?? 20;

  app.innerHTML = `<div class="fade-in">
    <div class="topbar"><h1>Réglages</h1></div>
    ${demoBanner()}
    <div class="section-label">Rappels</div>
    <div class="card" style="padding:4px 18px">
      <div class="setting"><div><div class="setting-lbl">Notification de rappel</div><div class="setting-sub">Seulement si tes exercices ne sont pas finis</div></div><button class="switch ${enabled ? "on" : ""}" id="notif" aria-label="Activer les rappels"></button></div>
      <div class="setting"><div class="setting-lbl">Heure du rappel</div>
        <select class="input" id="hour">${Array.from({ length: 17 }, (_, k) => k + 7).map((h) => `<option value="${h}" ${h === hour ? "selected" : ""}>${h}h00</option>`).join("")}</select></div>
    </div>
    <p class="hint mt8">${!pushPossible ? (store.mode === "demo" ? "Les rappels marcheront une fois l'appli connectée au cloud." : "Les rappels ne sont pas encore configurés (voir GUIDE).") : !installed ? "Sur iPhone, ajoute d'abord Langue à l'écran d'accueil pour recevoir les rappels." : ""}</p>

    <div class="section-label">Installer sur l'iPhone</div>
    <div class="card"><p class="hint" style="color:var(--text-2)">${installed ? "✓ Langue est installée sur ton écran d'accueil." : "Dans Safari : bouton Partager ⬆︎ → « Sur l'écran d'accueil » → Ajouter. Langue s'ouvrira alors comme une vraie appli, en plein écran."}</p></div>

    <div class="section-label">Compte</div>
    <div class="card" style="padding:4px 18px">
      <div class="setting"><div><div class="setting-lbl">${store.mode === "demo" ? "Mode démo" : esc(store.user?.email || "")}</div><div class="setting-sub">${store.mode === "demo" ? "Données d'essai, à effacer quand tu veux" : "Tes données sont sauvegardées dans le cloud"}</div></div>
        <button class="btn small secondary" id="out">${store.mode === "demo" ? "Effacer" : "Déconnexion"}</button></div>
    </div>
    <p class="hint center mt24">Langue · v1.0 · nouvelle journée à 3h</p>
  </div>`;

  app.querySelector("#out").onclick = async () => {
    if (store.mode === "demo") {
      if (!confirm("Effacer toutes les données de démo ?")) return;
      localStorage.removeItem("langue-demo-v1");
      state.daily = null; state.words = [];
      toast("Données de démo effacées");
      return go("home");
    }
    await store.signOut(); state.daily = null; route();
  };

  const saveHour = async (row) => {
    await store.savePushSettings({ remind_hour: Number(app.querySelector("#hour").value), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, ...row });
  };
  app.querySelector("#hour").onchange = () => { if (push) saveHour({}).then(() => toast("Heure enregistrée")).catch((e) => toast(e.message)); };
  app.querySelector("#notif").onclick = async (e) => {
    const sw = e.currentTarget;
    if (!pushPossible) return toast(store.mode === "demo" ? "Disponible une fois connecté au cloud" : "Rappels pas encore configurés");
    if (!installed) return toast("Ajoute d'abord Langue à l'écran d'accueil");
    try {
      if (sw.classList.contains("on")) {
        await saveHour({ enabled: false }); sw.classList.remove("on"); toast("Rappels désactivés"); return;
      }
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return toast("Autorise les notifications dans les réglages de l'iPhone");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(cfg.VAPID_PUBLIC_KEY) });
      await saveHour({ enabled: true, subscription: sub.toJSON() });
      push = { enabled: true };
      sw.classList.add("on"); toast("Rappels activés");
    } catch (err) { toast(err.message || "Impossible d'activer les rappels"); }
  };
}

boot();
