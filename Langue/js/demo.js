// Contenu et IA simulés pour le mode démo (avant la configuration de Supabase et de la clé API).
import { shuffle } from "./util.js";
import { spellReport } from "./editor.js";

export const WORD_POOL = [
  { en: "to cope with", fr: "faire face à, gérer", pos: "verbe", example: "I had to cope with a lot of stress last week.", example_fr: "J'ai dû gérer beaucoup de stress la semaine dernière.", alternatives: ["to deal with", "to handle", "cope with"] },
  { en: "a deadline", fr: "une date limite, une échéance", pos: "nom", example: "The deadline for the project is Friday.", example_fr: "La date limite du projet est vendredi.", alternatives: ["deadline", "due date"] },
  { en: "to wander", fr: "errer, flâner", pos: "verbe", example: "We wandered around the old town all afternoon.", example_fr: "Nous avons flâné dans la vieille ville tout l'après-midi.", alternatives: ["wander", "to stroll", "to roam"] },
  { en: "a layover", fr: "une escale", pos: "nom", example: "We have a three-hour layover in Dubai.", example_fr: "Nous avons une escale de trois heures à Dubaï.", alternatives: ["layover", "stopover"] },
  { en: "to bother", fr: "déranger, embêter", pos: "verbe", example: "Sorry to bother you, but can I ask a question?", example_fr: "Désolé de te déranger, mais je peux poser une question ?", alternatives: ["bother", "to disturb", "to annoy"] },
  { en: "a hunch", fr: "une intuition, un pressentiment", pos: "nom", example: "I have a hunch that she will say yes.", example_fr: "J'ai le pressentiment qu'elle va dire oui.", alternatives: ["hunch", "a gut feeling", "a feeling"] },
  { en: "to sweat", fr: "transpirer", pos: "verbe", example: "I always sweat a lot when I run in summer.", example_fr: "Je transpire toujours beaucoup quand je cours en été.", alternatives: ["sweat", "to perspire"] },
  { en: "a workout", fr: "une séance de sport, un entraînement", pos: "nom", example: "My morning workout takes about forty minutes.", example_fr: "Ma séance de sport du matin dure environ quarante minutes.", alternatives: ["workout", "a training session", "training"] },
  { en: "to postpone", fr: "reporter, remettre à plus tard", pos: "verbe", example: "They postponed the meeting until next Monday.", example_fr: "Ils ont reporté la réunion à lundi prochain.", alternatives: ["postpone", "to put off", "to delay"] },
  { en: "a bargain", fr: "une bonne affaire", pos: "nom", example: "This jacket was a real bargain at twenty euros.", example_fr: "Cette veste était une vraie bonne affaire à vingt euros.", alternatives: ["bargain", "a good deal", "a deal"] },
  { en: "to figure out", fr: "comprendre, trouver (une solution)", pos: "verbe", example: "I can't figure out how this app works.", example_fr: "Je n'arrive pas à comprendre comment marche cette appli.", alternatives: ["figure out", "to work out"] },
  { en: "a skill", fr: "une compétence", pos: "nom", example: "Communication is an important skill at work.", example_fr: "La communication est une compétence importante au travail.", alternatives: ["skill", "an ability"] },
  { en: "to be up for", fr: "être partant pour", pos: "expression", example: "Are you up for a movie tonight?", example_fr: "Tu es partant pour un film ce soir ?", alternatives: ["up for", "be up for", "to be in"] },
  { en: "a tip", fr: "un conseil, un pourboire", pos: "nom", example: "Here's a tip: book your train tickets early.", example_fr: "Un conseil : réserve tes billets de train tôt.", alternatives: ["tip", "advice"] },
  { en: "to upgrade", fr: "améliorer, mettre à niveau", pos: "verbe", example: "I need to upgrade my phone, it's too slow.", example_fr: "Je dois changer de téléphone, il est trop lent.", alternatives: ["upgrade", "to update"] },
  { en: "a referee", fr: "un arbitre", pos: "nom", example: "The referee gave him a yellow card.", example_fr: "L'arbitre lui a donné un carton jaune.", alternatives: ["referee", "umpire", "ref"] },
];

export const QUESTION_POOL = [
  { q: "What did you do yesterday evening, and did you enjoy it?", type: "Perso" },
  { q: "Describe your ideal weekend from morning to night.", type: "Perso" },
  { q: "What is a habit you would like to change, and why?", type: "Perso" },
  { q: "Do you think working from home is better than working in an office? Why?", type: "Opinion" },
  { q: "Should social media be forbidden for children under 15? Explain your view.", type: "Opinion" },
  { q: "Is it better to travel alone or with friends?", type: "Opinion" },
  { q: "You're at a restaurant and the waiter brings you the wrong dish. What do you say?", type: "Situation" },
  { q: "Your flight has been cancelled. Explain the situation to the airline agent and ask for a solution.", type: "Situation" },
  { q: "A colleague asks you to explain your job to a new intern. What do you tell them?", type: "Situation" },
  { q: "What sport do you like to watch or play, and what do you like about it?", type: "Perso" },
];

export function demoDaily(excludeEn = []) {
  const words = shuffle(WORD_POOL.filter((w) => !excludeEn.includes(w.en))).slice(0, 2);
  const picks = [
    ...shuffle(QUESTION_POOL.filter((q) => q.type === "Perso")).slice(0, 2),
    ...shuffle(QUESTION_POOL.filter((q) => q.type === "Opinion")).slice(0, 2),
    ...shuffle(QUESTION_POOL.filter((q) => q.type === "Situation")).slice(0, 1),
  ];
  return { words: words.length ? words : shuffle(WORD_POOL).slice(0, 2), questions: picks };
}

async function fakeFeedback(text) {
  const report = await spellReport(text);
  const errors = report.map((r) => ({
    original: r.word,
    correction: r.suggestion || r.word,
    explanation: "Faute d'orthographe (en mode démo, seule l'orthographe est vérifiée).",
  }));
  let corrected = text;
  report.forEach((r) => { if (r.suggestion) corrected = corrected.replace(r.word, r.suggestion); });
  const improvements = /\bvery good\b/i.test(text)
    ? [{ original: "very good", suggestion: "great / excellent", explanation: "Plus naturel et plus varié." }]
    : [];
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return {
    score: Math.max(3, 10 - errors.length),
    summary: "Mode démo : l'IA est simulée. Une fois la clé API configurée, tu auras une vraie correction (grammaire, vocabulaire, tournures).",
    errors,
    improvements,
    positives: words > 30 ? ["Bonne longueur de texte, continue comme ça."] : ["Tu as osé écrire, c'est l'essentiel."],
    corrected_text: corrected,
  };
}

export async function demoAI(action, payload) {
  await new Promise((r) => setTimeout(r, 900));
  if (action === "daily") return demoDaily(payload.exclude || []);
  if (action === "words") return { words: demoDaily(payload.exclude || []).words };
  if (action === "questions") return { questions: demoDaily().questions };
  if (action === "correct_text") return fakeFeedback(payload.text);
  if (action === "correct_answers") {
    const items = [];
    for (const it of payload.items) items.push(await fakeFeedback(it.answer));
    return { items, summary: "Mode démo : correction simulée." };
  }
  throw new Error("Action inconnue");
}
