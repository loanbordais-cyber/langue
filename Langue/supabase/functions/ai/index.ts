// Fonction serveur "ai" : appelle l'IA Google Gemini (offre gratuite) avec la clé gardée secrète côté serveur.
// Actions : daily (2 mots + 5 questions), words (2 mots), questions (5 questions),
//           correct_text (correction d'un texte), correct_answers (correction des réponses).
import { createClient } from "npm:@supabase/supabase-js@2";

// Modèles gratuits de l'API Gemini. Si le premier est saturé, on bascule sur le second.
const MODELS = [
  Deno.env.get("LANGUE_MODEL") ?? "gemini-3.6-flash",
  "gemini-3.1-flash-lite",
];
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/";

class AIError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}

async function callGemini(system: string, prompt: string, schema: unknown) {
  let lastError: AIError | null = null;
  for (const model of MODELS) {
    let res: Response;
    try {
      res = await fetch(`${ENDPOINT}${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseJsonSchema: schema,
            // Réflexion courte : réponse en quelques secondes (sinon Supabase coupe au bout d'une minute)
            thinkingConfig: { thinkingLevel: "low" },
          },
        }),
        signal: AbortSignal.timeout(30000),
      });
    } catch (e) {
      console.error(model, "timeout/réseau", String(e));
      lastError = new AIError("L'IA met trop de temps à répondre, réessaie.", 504);
      continue; // on essaie le modèle suivant
    }
    if (res.ok) {
      const data = await res.json();
      const cand = data.candidates?.[0];
      if (!cand || cand.finishReason === "SAFETY" || cand.finishReason === "PROHIBITED_CONTENT") {
        throw new AIError("L'IA n'a pas pu traiter cette demande.", 422);
      }
      if (cand.finishReason === "MAX_TOKENS") throw new AIError("Texte trop long pour être corrigé d'un coup.", 422);
      const text = (cand.content?.parts ?? []).filter((p: any) => !p.thought && p.text).map((p: any) => p.text).join("");
      return JSON.parse(text);
    }
    const body = await res.text();
    console.error(model, res.status, body.slice(0, 500));
    if (res.status === 400 && /API key/i.test(body)) throw new AIError("Clé Gemini invalide : vérifie GEMINI_API_KEY dans Supabase.", 500);
    if (res.status === 403) throw new AIError("Clé Gemini refusée : vérifie GEMINI_API_KEY dans Supabase.", 500);
    // 429 (quota gratuit atteint) ou 5xx (surcharge) : on essaie le modèle suivant
    lastError = res.status === 429
      ? new AIError("Limite gratuite atteinte pour le moment, réessaie dans une minute.", 429)
      : new AIError(`Erreur de l'IA (${res.status}). Réessaie.`, 502);
    if (res.status !== 429 && res.status < 500 && res.status !== 404) throw lastError;
  }
  throw lastError ?? new AIError("L'IA n'a pas répondu.");
}

// Diagnostic : vérifie que chaque modèle répond, et en combien de temps
async function diagnose() {
  const out: Record<string, unknown> = { keySet: GEMINI_KEY.length > 0 };
  for (const model of [...new Set([...MODELS, "gemini-3.6-flash", "gemini-2.5-flash"])]) {
    const t0 = Date.now();
    try {
      const res = await fetch(`${ENDPOINT}${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Say OK" }] }] }),
        signal: AbortSignal.timeout(12000),
      });
      const txt = await res.text();
      out[model] = { status: res.status, ms: Date.now() - t0, body: res.ok ? "ok" : txt.slice(0, 200) };
    } catch (e) {
      out[model] = { error: String(e), ms: Date.now() - t0 };
    }
  }
  return out;
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

/* ---------- Schémas de réponse (JSON garanti) ---------- */
const obj = (properties: Record<string, unknown>) => ({
  type: "object", properties, required: Object.keys(properties),
});
const str = { type: "string" };
const arr = (items: unknown) => ({ type: "array", items });

const WORD = obj({
  en: str, fr: str, pos: str, example: str, example_fr: str, alternatives: arr(str),
});
const QUESTION = obj({ q: str, type: { type: "string", enum: ["Perso", "Opinion", "Situation"] } });
const FEEDBACK = obj({
  score: { type: "integer" },
  summary: str,
  errors: arr(obj({ original: str, correction: str, explanation: str })),
  improvements: arr(obj({ original: str, suggestion: str, explanation: str })),
  positives: arr(str),
  corrected_text: str,
});

const SCHEMAS: Record<string, unknown> = {
  daily: obj({ words: arr(WORD), questions: arr(QUESTION) }),
  words: obj({ words: arr(WORD) }),
  questions: obj({ questions: arr(QUESTION) }),
  correct_text: FEEDBACK,
  correct_answers: obj({ summary: str, items: arr(FEEDBACK) }),
};

/* ---------- Consignes ---------- */
const WORDS_RULES = `Choisis des mots ou expressions anglais utiles pour un francophone de niveau B1-B2 :
du vocabulaire réellement employé par les anglophones, ni trop basique (pas "house", "car") ni rare.
Varie les thèmes d'un jour à l'autre : vie quotidienne, travail/business, voyage, expressions familières, tech, sport, émotions, etc.
Pour chaque mot :
- en : le mot ou l'expression en anglais (verbes avec "to", noms avec "a/an" si dénombrables)
- fr : la ou les traductions françaises naturelles (séparées par des virgules)
- pos : nature en français (verbe, nom, adjectif, expression, adverbe…)
- example : une phrase d'exemple naturelle en anglais
- example_fr : sa traduction française
- alternatives : 2 à 4 réponses anglaises acceptables si on demande la traduction du français (synonymes proches, forme sans "to"/"a")`;

const QUESTIONS_RULES = `Écris 5 questions ouvertes en anglais (niveau B1-B2), auxquelles on répond en quelques phrases :
2 questions "Perso" (sa vie, sa journée, ses goûts, ses souvenirs),
2 questions "Opinion" (réflexion sur un sujet de société, de travail, de tech, de sport…),
1 question "Situation" (mise en situation concrète : restaurant, voyage, travail, problème à régler).
Varie les sujets, évite les questions banales.`;

const CORRECTION_RULES = `Tu es un professeur d'anglais bienveillant et précis pour un francophone de niveau B1-B2.
Tu corriges ce qu'il a écrit (ou dicté, donc la ponctuation peut manquer : ne la compte pas comme faute grave).
Toutes tes explications sont en français, claires et courtes.
- errors : chaque vraie faute (grammaire, conjugaison, orthographe, mot faux, faux-ami, ordre des mots). "original" = l'extrait fautif tel qu'écrit, "correction" = l'extrait corrigé, "explanation" = pourquoi, en une ou deux phrases.
- improvements : ce qui est correct mais pourrait sonner plus naturel ou plus riche (meilleur mot, tournure plus native). Maximum 4, les plus utiles.
- positives : 1 à 3 points vraiment réussis (tournure, vocabulaire, structure), concrets.
- corrected_text : le texte entier corrigé, en gardant au maximum ses mots et son style.
- score : note sur 10 du niveau d'anglais de ce texte.
- summary : 1 à 2 phrases d'avis global, encourageant et honnête.
S'il n'y a aucune faute, renvoie errors vide.`;

function buildRequest(action: string, body: any) {
  const exclude: string[] = (body.exclude ?? []).slice(-800);
  const excludeTxt = exclude.length ? `\n\nNe propose AUCUN de ces mots déjà appris : ${exclude.join(", ")}` : "";
  switch (action) {
    case "daily":
      return {
        system: "Tu prépares les exercices quotidiens d'une appli d'apprentissage de l'anglais pour un francophone.",
        prompt: `${WORDS_RULES}\nDonne exactement 2 mots.${excludeTxt}\n\n${QUESTIONS_RULES}`,
      };
    case "words":
      return {
        system: "Tu prépares les mots du jour d'une appli d'apprentissage de l'anglais pour un francophone.",
        prompt: `${WORDS_RULES}\nDonne exactement 2 mots.${excludeTxt}`,
      };
    case "questions":
      return {
        system: "Tu prépares les questions du jour d'une appli d'apprentissage de l'anglais pour un francophone.",
        prompt: QUESTIONS_RULES,
      };
    case "correct_text": {
      const text = String(body.text ?? "").slice(0, 8000);
      if (!text.trim()) throw new Error("Texte vide");
      return { system: CORRECTION_RULES, prompt: `Voici le texte à corriger :\n<texte>\n${text}\n</texte>` };
    }
    case "correct_answers": {
      const items = (body.items ?? []).slice(0, 8);
      if (!items.length) throw new Error("Aucune réponse");
      const list = items.map((it: any, i: number) =>
        `<reponse numero="${i + 1}">\n<question>${String(it.question).slice(0, 500)}</question>\n<texte>${String(it.answer).slice(0, 3000)}</texte>\n</reponse>`).join("\n");
      return {
        system: CORRECTION_RULES + `\nIci, il a répondu à plusieurs questions : renvoie un élément dans "items" par réponse, dans le même ordre. Vérifie aussi que la réponse répond bien à la question (sinon, signale-le dans le summary de cet élément). Le "summary" global résume ses points forts et ses erreurs récurrentes.`,
        prompt: `Voici ses réponses :\n${list}`,
      };
    }
    default:
      throw new Error("Action inconnue");
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    // Seul un utilisateur connecté à Langue peut utiliser l'IA
    // Clé publique envoyée par l'appli (ou celle du projet), puis vérification de la session
    const publicKey = req.headers.get("apikey") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, publicKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({ error: "Connecte-toi pour utiliser l'IA." }, 401);

    const body = await req.json();
    const action = String(body.action ?? "");
    if (action === "diag") return json(await diagnose());
    const { system, prompt } = buildRequest(action, body);
    return json(await callGemini(system, prompt, SCHEMAS[action]));
  } catch (err) {
    console.error(err);
    if (err instanceof AIError) return json({ error: err.message }, err.status);
    if (err instanceof SyntaxError) return json({ error: "Réponse de l'IA illisible, réessaie." }, 502);
    return json({ error: (err as Error).message ?? "Erreur inconnue" }, 400);
  }
});
