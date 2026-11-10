// Fonction serveur "reminders" : appelée chaque heure par Supabase (pg_cron).
// Envoie une notification si c'est l'heure choisie et que les exercices du jour ne sont pas finis.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") ?? "mailto:langue@example.com",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

function localParts(tz: string) {
  const now = new Date();
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).format(now)) % 24;
  // La journée Langue commence à 3h
  const shifted = new Date(now.getTime() - 3 * 3600 * 1000);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(shifted);
  return { hour, day };
}

function remaining(d: any): string[] {
  if (!d) return ["ton texte", "tes mots", "tes questions"];
  const left: string[] = [];
  if (!d.text?.feedback) left.push("ton texte");
  const reviewNeeded = d.review?.ids?.length && !d.review.done;
  if (!d.words_seen || reviewNeeded) left.push("tes mots");
  if (!d.answers?.feedback) left.push("tes questions");
  return left;
}

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) return new Response("forbidden", { status: 403 });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: subs } = await db.from("push_subscriptions").select("*").eq("enabled", true);
  let sent = 0;
  for (const s of subs ?? []) {
    const { hour, day } = localParts(s.timezone || "Europe/Paris");
    if (hour !== s.remind_hour || s.last_sent_day === day || !s.subscription) continue;
    const { data: row } = await db.from("daily").select("data").eq("user_id", s.user_id).eq("day_key", day).maybeSingle();
    const left = remaining(row?.data);
    if (!left.length) continue;
    const body = left.length === 3
      ? "Tes exercices d'anglais du jour t'attendent. 10 minutes suffisent !"
      : `Il te reste ${left.join(" et ")} pour aujourd'hui.`;
    try {
      await webpush.sendNotification(s.subscription, JSON.stringify({ title: "Langue", body }));
      sent++;
    } catch (err: any) {
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        await db.from("push_subscriptions").update({ enabled: false }).eq("user_id", s.user_id);
      }
    }
    await db.from("push_subscriptions").update({ last_sent_day: day }).eq("user_id", s.user_id);
  }
  return new Response(JSON.stringify({ sent }), { headers: { "Content-Type": "application/json" } });
});
