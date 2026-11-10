// Couche de données : Supabase (cloud, mode réel) ou mode démo (si config.js n'est pas rempli).
import { demoAI } from "./demo.js";

const cfg = window.LANGUE_CONFIG || {};
export const mode = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY ? "cloud" : "demo";

let sb = null;
export let user = null;

/* ---------- Mode démo : données gardées le temps des tests ---------- */
const DEMO_KEY = "langue-demo-v1";
function demoLoad() {
  try { return JSON.parse(localStorage.getItem(DEMO_KEY)) || { daily: {}, words: [], events: [] }; }
  catch { return { daily: {}, words: [], events: [] }; }
}
function demoSave(db) { try { localStorage.setItem(DEMO_KEY, JSON.stringify(db)); } catch {} }
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));

/* ---------- Initialisation / connexion ---------- */
export async function init() {
  if (mode === "demo") { user = { email: "démo" }; return user; }
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.118.0");
  sb = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  const { data } = await sb.auth.getSession();
  user = data.session?.user || null;
  return user;
}

// Connexion par e-mail + mot de passe (fonctionne dans l'appli installée sur l'écran d'accueil)
export async function signUp(email, password) {
  const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
  if (error) throw error;
  if (data.session) user = data.user;
  return !!data.session; // false = il faut d'abord confirmer l'e-mail
}
export async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  user = data.user;
  return user;
}
export async function resetPassword(email) {
  const { error } = await sb.auth.resetPasswordForEmail(email);
  if (error) throw error;
}
export async function signOut() {
  if (sb) await sb.auth.signOut();
  user = null;
}

/* ---------- Journée ---------- */
export async function getDaily(dayKey) {
  if (mode === "demo") return demoLoad().daily[dayKey] || null;
  const { data, error } = await sb.from("daily").select("data").eq("day_key", dayKey).maybeSingle();
  if (error) throw error;
  return data ? data.data : null;
}

export async function saveDaily(dayKey, value) {
  if (mode === "demo") { const db = demoLoad(); db.daily[dayKey] = value; demoSave(db); return value; }
  const { error } = await sb.from("daily").upsert({ user_id: user.id, day_key: dayKey, data: value, updated_at: new Date().toISOString() });
  if (error) throw error;
  return value;
}

// Dernière journée (avant aujourd'hui) où des mots ont été appris
export async function previousDailyWithWords(dayKey) {
  if (mode === "demo") {
    const db = demoLoad();
    const keys = Object.keys(db.daily).filter((k) => k < dayKey && db.daily[k].word_ids?.length).sort();
    const k = keys.pop();
    return k ? { day_key: k, ...db.daily[k] } : null;
  }
  const { data, error } = await sb.from("daily").select("day_key,data").lt("day_key", dayKey).order("day_key", { ascending: false }).limit(10);
  if (error) throw error;
  const row = (data || []).find((r) => r.data?.word_ids?.length);
  return row ? { day_key: row.day_key, ...row.data } : null;
}

/* ---------- Mots ---------- */
export async function listWords() {
  if (mode === "demo") return [...demoLoad().words].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const { data, error } = await sb.from("words").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function addWords(words, dayKey) {
  const rows = words.map((w) => ({
    en: w.en, fr: w.fr, pos: w.pos || "", example: w.example || "", example_fr: w.example_fr || "",
    alternatives: w.alternatives || [], day_key: dayKey,
  }));
  if (mode === "demo") {
    const db = demoLoad();
    const now = Date.now();
    const saved = rows.map((r, i) => ({ ...r, id: uid(), created_at: new Date(now + i).toISOString() }));
    db.words.push(...saved);
    demoSave(db);
    return saved;
  }
  const { data, error } = await sb.from("words").insert(rows.map((r) => ({ ...r, user_id: user.id }))).select();
  if (error) throw error;
  return data;
}

/* ---------- Historique (stats) ---------- */
export async function addEvent(ev) {
  const row = { kind: ev.kind, day_key: ev.day_key, errors: ev.errors ?? null, score: ev.score ?? null, detail: ev.detail || null };
  if (mode === "demo") {
    const db = demoLoad();
    db.events.push({ ...row, id: uid(), created_at: new Date().toISOString() });
    demoSave(db);
    return;
  }
  const { error } = await sb.from("events").insert({ ...row, user_id: user.id });
  if (error) throw error;
}

export async function listEvents() {
  if (mode === "demo") return demoLoad().events;
  const { data, error } = await sb.from("events").select("*").order("created_at", { ascending: true }).limit(2000);
  if (error) throw error;
  return data;
}

/* ---------- Notifications ---------- */
export async function getPushSettings() {
  if (mode === "demo") return null;
  const { data } = await sb.from("push_subscriptions").select("*").maybeSingle();
  return data;
}
export async function savePushSettings(row) {
  if (mode === "demo") return;
  const { error } = await sb.from("push_subscriptions").upsert({ user_id: user.id, ...row, updated_at: new Date().toISOString() });
  if (error) throw error;
}

/* ---------- IA (via la fonction serveur qui garde la clé API secrète) ---------- */
export async function ai(action, payload = {}) {
  if (mode === "demo") return demoAI(action, payload);
  const { data, error } = await sb.functions.invoke("ai", { body: { action, ...payload } });
  if (error) {
    let msg = "L'IA n'a pas répondu. Vérifie ta connexion et réessaie.";
    try { const body = await error.context.json(); if (body?.error) msg = body.error; } catch {}
    throw new Error(msg);
  }
  return data;
}
