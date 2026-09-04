// Webhook Telegram: comandi rapidi senza LLM, bottoni inline, e tutto il resto a Claude.

import { todayAtHome } from "../_shared/dates.ts";
import {
  appendMessage,
  completeTask,
  getOrCreateMember,
  getTask,
  listActiveTasks,
  listHistory,
  loadRecentMessages,
} from "../_shared/db.ts";
import {
  doneKeyboard,
  eventCompleted,
  groupByBucket,
  HELP_TEXT,
  keyboardWithout,
  renderAgenda,
  renderCompleted,
  renderHistory,
} from "../_shared/format.ts";
import {
  allowedChatIds,
  answerCallbackQuery,
  broadcast,
  displayName,
  editMessageReplyMarkup,
  escapeHtml,
  isChatAllowed,
  sanitizeModelHtml,
  sendMessage,
  type TelegramCallbackQuery,
  type TelegramMessage,
  type TelegramUpdate,
} from "../_shared/telegram.ts";
import { ModelUnavailableError, runAgent } from "../_shared/agent.ts";

const ok = () => new Response("ok", { status: 200 });

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Sambelli webhook", { status: 200 });

  // Fail closed: senza secret configurato il webhook non accetta nulla.
  const expected = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
  if (!expected || req.headers.get("x-telegram-bot-api-secret-token") !== expected) {
    return new Response("forbidden", { status: 403 });
  }

  let update: TelegramUpdate;
  try {
    update = await req.json();
  } catch {
    return new Response("bad request", { status: 400 });
  }

  // Telegram riprova finché non riceve 200: gli errori li logghiamo e rispondiamo 200
  // comunque, altrimenti un messaggio "rotto" blocca la coda per sempre.
  try {
    if (update.callback_query) await handleCallback(update.callback_query);
    else if (update.message?.text) await handleMessage(update.message);
  } catch (err) {
    console.error("update", update.update_id, err);
    if (update.callback_query) {
      await answerCallbackQuery(update.callback_query.id, "Errore, riprova").catch(() => {});
    }
    const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
    if (chatId && isChatAllowed(chatId)) {
      const text = err instanceof ModelUnavailableError
        ? "Il modello è sovraccarico in questo momento. Riprova tra un minuto, oppure usa /oggi e i bottoni."
        : "Ops, qualcosa è andato storto. Riprova tra un attimo.";
      await sendMessage(chatId, text).catch(() => {});
    }
  }
  return ok();
});

// ---------------------------------------------------------------------------

async function handleMessage(msg: TelegramMessage): Promise<void> {
  const chatId = msg.chat.id;
  const text = msg.text!.trim();
  if (!msg.from || msg.from.is_bot) return;

  if (!isChatAllowed(chatId)) {
    // Unica cosa che facciamo con una chat sconosciuta: dirle il suo id, così si può
    // aggiungere a TELEGRAM_ALLOWED_CHAT_IDS. Nessun accesso a DB o modello.
    if (text.startsWith("/start") || text.startsWith("/id")) {
      await sendMessage(chatId, `Questa chat ha id <code>${chatId}</code>. Aggiungilo a TELEGRAM_ALLOWED_CHAT_IDS.`);
    }
    return;
  }

  const sender = await getOrCreateMember(msg.from.id, displayName(msg.from));

  if (text.startsWith("/")) {
    await handleCommand(chatId, text);
    return;
  }

  const history = await loadRecentMessages(chatId);
  const reply = await runAgent(sender, text, history);

  // Prima memoria e notifica all'altro, poi la risposta: se Telegram rifiuta il messaggio
  // di risposta, quello che è stato fatto non deve sparire.
  // La memoria è comodità, non deve far fallire il turno: se si rompe lo logghiamo e basta.
  const side = await Promise.allSettled([
    appendMessage(chatId, "user", `${sender.name}: ${text}`, sender.id),
    appendMessage(chatId, "assistant", reply.text),
    broadcast(chatId, reply.events),
  ]);
  for (const r of side) if (r.status === "rejected") console.error("side effect", r.reason);

  const opts = { replyTo: msg.chat.type === "private" ? undefined : msg.message_id };
  try {
    await sendMessage(chatId, sanitizeModelHtml(reply.text), opts);
  } catch (err) {
    // Un <b> non chiuso dal modello fa rifiutare l'HTML: meglio in chiaro che niente.
    console.error("risposta HTML rifiutata, rimando in chiaro", err);
    await sendMessage(chatId, escapeHtml(reply.text), opts);
  }
}

async function handleCommand(chatId: number, text: string): Promise<void> {
  const cmd = text.split(/[\s@]/)[0].toLowerCase();
  const today = todayAtHome();

  switch (cmd) {
    case "/start":
    case "/aiuto":
    case "/help":
      await sendMessage(chatId, HELP_TEXT);
      return;
    case "/id":
      await sendMessage(chatId, `Chat id: <code>${chatId}</code>`);
      return;
    case "/oggi": {
      const tasks = await listActiveTasks();
      const grouped = groupByBucket(tasks, today);
      const due = [...(grouped.get("overdue") ?? []), ...(grouped.get("today") ?? [])];
      await sendMessage(chatId, renderAgenda(tasks, today, ["overdue", "today"], "Oggi niente da fare 🎉"), {
        replyMarkup: doneKeyboard(due),
      });
      return;
    }
    case "/settimana":
      await sendMessage(chatId, renderAgenda(await listActiveTasks(), today, ["overdue", "today", "week"]));
      return;
    case "/mese":
      await sendMessage(chatId, renderAgenda(await listActiveTasks(), today, ["overdue", "today", "week", "month"]));
      return;
    case "/tutti":
      await sendMessage(
        chatId,
        renderAgenda(
          await listActiveTasks(),
          today,
          ["overdue", "today", "week", "month", "later"],
          "Nessun task attivo.",
        ),
      );
      return;
    case "/storico":
      await sendMessage(chatId, renderHistory(await listHistory({ limit: 15 }), today));
      return;
    default:
      await sendMessage(chatId, `Non conosco ${escapeHtml(cmd)}. Prova /aiuto.`);
  }
}

// ---------------------------------------------------------------------------
// Bottoni inline: "d:<task_id>" = fatto

async function handleCallback(cq: TelegramCallbackQuery): Promise<void> {
  const msg = cq.message;
  const data = cq.data ?? "";
  if (!msg) {
    await answerCallbackQuery(cq.id);
    return;
  }
  const chatId = msg.chat.id;
  if (!isChatAllowed(chatId)) {
    await answerCallbackQuery(cq.id, "Chat non autorizzata");
    return;
  }

  const [action, taskId] = data.split(":");
  const today = todayAtHome();

  const dropButtons = () =>
    editMessageReplyMarkup(chatId, msg.message_id, keyboardWithout(msg.reply_markup, taskId)).catch(() => {});

  // Messaggi vecchi possono avere bottoni di funzioni rimosse (es. "domani"): via senza fare nulla.
  if (action !== "d") {
    await answerCallbackQuery(cq.id, "Questo bottone non c'è più");
    await dropButtons();
    return;
  }

  const task = taskId ? await getTask(taskId) : null;

  if (!task || task.status !== "active") {
    await answerCallbackQuery(cq.id, "Questo task non c'è più");
    await dropButtons();
    return;
  }

  // I bottoni esistono solo per task in ritardo o di oggi. Se la scadenza è già nel
  // futuro, qualcuno l'ha già fatto da un altro messaggio: niente doppioni.
  if (task.next_due > today) {
    const by = task.last_done_by ? ` da ${task.last_done_by}` : "";
    await answerCallbackQuery(cq.id, task.last_done_on === today ? `Già fatto${by}` : "Già gestito");
    await dropButtons();
    return;
  }

  const who = await getOrCreateMember(cq.from.id, displayName(cq.from));

  const updated = await completeTask(task.id, who.id, today);
  await answerCallbackQuery(cq.id, "Segnato ✅");
  await dropButtons();
  await broadcast(chatId, [eventCompleted(who.name, updated, today)]);
  await sendMessage(chatId, renderCompleted(who.name, updated, today));
}
