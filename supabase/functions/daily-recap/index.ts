// Recap mattutino. Chiamato da pg_cron (vedi supabase/cron.sql) o a mano.
//
//   POST /daily-recap            -> manda il recap se a casa sono le RECAP_HOUR
//   POST /daily-recap?force=1    -> manda comunque (per provare)
//
// Autenticazione: header  Authorization: Bearer <CRON_SECRET>

import { formatShort, hourAtHome, todayAtHome } from "../_shared/dates.ts";
import { listActiveTasks } from "../_shared/db.ts";
import { doneKeyboard, groupByBucket, renderAgenda } from "../_shared/format.ts";
import { allowedChatIds, escapeHtml, sendMessage } from "../_shared/telegram.ts";

// Ora di casa del recap. Se cambia, cambia anche la schedulazione in supabase/cron.sql
// (06 e 07 UTC coprono le 8 di Roma in ora legale e solare).
const RECAP_HOUR = 8;

Deno.serve(async (req) => {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("forbidden", { status: 403 });
  }

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  const hour = hourAtHome();
  if (!force && hour !== RECAP_HOUR) {
    return Response.json({ sent: false, reason: `ora locale ${hour}, recap alle ${RECAP_HOUR}` });
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

  // Un messaggio arriva sempre, anche a vuoto: così si sa che il giro funziona.
  let text: string;
  if (due.length) {
    text = `☀️ <b>Buongiorno!</b> Ecco la situazione:\n\n${renderAgenda(tasks, today, ["overdue", "today", "week"])}`;
  } else if (week.length) {
    text = `☀️ <b>Buongiorno!</b> Oggi niente di urgente. In settimana:\n\n${renderAgenda(tasks, today, ["week"])}`;
  } else {
    const next = tasks[0]; // già ordinati per scadenza
    const preview = next
      ? `Prossima cosa in agenda: ${escapeHtml(next.title)}, ${formatShort(next.next_due, today)}.`
      : "Non c'è nessun task in agenda: aggiungine uno scrivendomelo.";
    text = `☀️ <b>Buongiorno!</b> Niente da fare fino a domenica 🎉\n${preview}`;
  }
  const keyboard = doneKeyboard(due);

  const results = await Promise.allSettled(chats.map((id) => sendMessage(id, text, { replyMarkup: keyboard })));
  const failed = results.filter((r) => r.status === "rejected");
  for (const f of failed) console.error("recap", (f as PromiseRejectedResult).reason);

  return Response.json({ sent: true, chats: chats.length, failed: failed.length, due: due.length, week: week.length });
});
