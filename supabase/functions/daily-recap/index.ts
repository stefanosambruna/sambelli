// Recap mattutino. Chiamato da pg_cron (vedi supabase/cron.sql) o a mano.
//
//   POST /daily-recap            -> manda il recap se a casa sono le RECAP_HOUR (default 8)
//   POST /daily-recap?force=1    -> manda comunque (per provare)
//
// Autenticazione: header  Authorization: Bearer <CRON_SECRET>

import { hourAtHome, todayAtHome } from "../_shared/dates.ts";
import { listActiveTasks } from "../_shared/db.ts";
import { doneKeyboard, groupByBucket, renderAgenda } from "../_shared/format.ts";
import { allowedChatIds, sendMessage } from "../_shared/telegram.ts";

Deno.serve(async (req) => {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("forbidden", { status: 403 });
  }

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  const recapHour = Number(Deno.env.get("RECAP_HOUR") ?? "8");
  const hour = hourAtHome();

  if (!force && hour !== recapHour) {
    return Response.json({ sent: false, reason: `ora locale ${hour}, recap alle ${recapHour}` });
  }

  const chats = allowedChatIds();
  if (!chats.length) {
    return Response.json({ sent: false, reason: "TELEGRAM_ALLOWED_CHAT_IDS vuoto" }, { status: 400 });
  }

  const today = todayAtHome();
  const tasks = await listActiveTasks();
  const grouped = groupByBucket(tasks, today);
  const due = [...(grouped.get("overdue") ?? []), ...(grouped.get("today") ?? [])];
  const week = grouped.get("week") ?? [];

  if (!due.length && !week.length) {
    return Response.json({ sent: false, reason: "niente in scadenza questa settimana" });
  }

  const header = due.length
    ? "☀️ <b>Buongiorno!</b> Ecco la situazione:"
    : "☀️ <b>Buongiorno!</b> Oggi niente di urgente. In settimana:";
  const body = renderAgenda(tasks, today, ["overdue", "today", "week"]);
  const text = `${header}\n\n${body}`;
  const keyboard = doneKeyboard(due);

  const results = await Promise.allSettled(chats.map((id) => sendMessage(id, text, { replyMarkup: keyboard })));
  const failed = results.filter((r) => r.status === "rejected");
  for (const f of failed) console.error("recap", (f as PromiseRejectedResult).reason);

  return Response.json({ sent: true, chats: chats.length, failed: failed.length, due: due.length, week: week.length });
});
