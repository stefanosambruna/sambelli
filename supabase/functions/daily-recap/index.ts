// Recap mattutino. Chiamato da pg_cron (vedi supabase/cron.sql) o a mano.
//
//   POST /daily-recap            -> manda il recap una volta al giorno, dalle RECAP_HOUR in poi
//   POST /daily-recap?force=1    -> manda comunque (per provare)
//
// Autenticazione: header  Authorization: Bearer <CRON_SECRET>

import { diffDays, endOfWeek, formatShort, hourAtHome, todayAtHome } from "../_shared/dates.ts";
import { getAppState, listActiveTasks, listMembers, setAppState } from "../_shared/db.ts";
import { doneKeyboard, groupByBucket, renderAgenda } from "../_shared/format.ts";
import { allowedChatIds, escapeHtml, sendMessage } from "../_shared/telegram.ts";

// Ora di casa del recap. Se cambia, cambia anche la schedulazione in supabase/cron.sql
// (06 e 07 UTC coprono le 8 di Roma in ora legale e solare).
const RECAP_HOUR = 8;
/** Ore dopo RECAP_HOUR in cui si riprova se non è ancora partito (cron.sql: ogni 15 min, 6-9 UTC). */
const RETRY_HOURS = 2;
const LAST_SENT_KEY = "recap_last_sent_on";

Deno.serve(async (req) => {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("forbidden", { status: 403 });
  }

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  // Il cron chiama ogni 15 minuti nella finestra: si manda una volta sola al giorno, ma se
  // l'invio fallisce si riprova al giro dopo invece di saltare la giornata.
  const hour = hourAtHome();
  const today = todayAtHome();
  if (!force) {
    if (hour < RECAP_HOUR || hour > RECAP_HOUR + RETRY_HOURS) {
      return Response.json({
        sent: false,
        reason: `ora locale ${hour}, finestra ${RECAP_HOUR}-${RECAP_HOUR + RETRY_HOURS}`,
      });
    }
    if ((await getAppState(LAST_SENT_KEY)) === today) {
      return Response.json({ sent: false, reason: "già inviato oggi" });
    }
  }

  const chats = allowedChatIds();
  if (!chats.length) {
    return Response.json({ sent: false, reason: "TELEGRAM_ALLOWED_CHAT_IDS vuoto" }, { status: 400 });
  }

  const [tasks, members] = await Promise.all([listActiveTasks(), listMembers()]);
  // In chat privata l'id della chat coincide con l'id utente Telegram: così sappiamo chi saluta.
  const greet = (chatId: number) => {
    const m = members.find((x) => x.telegram_user_id === chatId);
    return m ? `☀️ <b>Buongiorno ${escapeHtml(m.name)}!</b>` : "☀️ <b>Buongiorno!</b>";
  };
  const grouped = groupByBucket(tasks, today);
  const due = [...(grouped.get("overdue") ?? []), ...(grouped.get("today") ?? [])];
  const week = grouped.get("week") ?? [];

  // Un messaggio arriva sempre, anche a vuoto: così si sa che il giro funziona.
  let body: string;
  if (due.length) {
    body = `Ecco la situazione:\n\n${renderAgenda(tasks, today, ["overdue", "today", "week"])}`;
  } else if (week.length) {
    body = `Oggi niente di urgente. In settimana:\n\n${renderAgenda(tasks, today, ["week"])}`;
  } else {
    const next = tasks[0]; // già ordinati per scadenza
    const preview = next
      ? `Prossima cosa in agenda: ${escapeHtml(next.title)}, ${formatShort(next.next_due, today)}.`
      : "Non c'è nessun task in agenda: aggiungine uno scrivendomelo.";
    const left = diffDays(today, endOfWeek(today));
    const span = left === 0 ? "oggi" : left === 1 ? "né oggi né domani" : "fino a domenica";
    body = `Niente da fare ${span} 🎉\n${preview}`;
  }
  const keyboard = doneKeyboard(due);

  const results = await Promise.allSettled(
    chats.map((id) => sendMessage(id, `${greet(id)} ${body}`, { replyMarkup: keyboard })),
  );
  const failed = results.filter((r) => r.status === "rejected");
  for (const f of failed) console.error("recap", (f as PromiseRejectedResult).reason);
  if (failed.length < results.length) {
    await setAppState(LAST_SENT_KEY, today).catch((e) => console.error("app_state", e));
  }

  return Response.json({ sent: true, chats: chats.length, failed: failed.length, due: due.length, week: week.length });
});
