// Webhook Telegram: comandi rapidi senza LLM, bottoni inline, e tutto il resto a Claude.

import { addDays, todayAtHome } from "../_shared/dates.ts";
import {
  appendMessage,
  completeTask,
  getOrCreateMember,
  getTask,
  listActiveTasks,
  listHistory,
  loadRecentMessages,
  postponeTask,
} from "../_shared/db.ts";
import {
  doneKeyboard,
  eventCompleted,
  eventPostponed,
  groupByBucket,
  HELP_TEXT,
  keyboardWithout,
  renderAgenda,
  renderCompleted,
  renderHistory,
  renderPostponed,
} from "../_shared/format.ts";
import {
  allowedChatIds,
  answerCallbackQuery,
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
  await Promise.all([
    appendMessage(chatId, "user", `${sender.name}: ${text}`, sender.id),
    appendMessage(chatId, "assistant", reply.text),
    broadcast(chatId, reply.events),
  ]);
  await sendMessage(chatId, sanitizeModelHtml(reply.text), {
    replyTo: msg.chat.type === "private" ? undefined : msg.message_id,
  });
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
// Bottoni inline: "d:<task_id>" = fatto, "p:<task_id>" = rimanda a domani

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
  const task = taskId ? await getTask(taskId) : null;
  const today = todayAtHome();

  const dropButtons = () =>
    editMessageReplyMarkup(chatId, msg.message_id, keyboardWithout(msg.reply_markup, taskId)).catch(() => {});

  if (!task || !task.active) {
    await answerCallbackQuery(cq.id, "Questo task non c'è più");
    await dropButtons();
    return;
  }

  // I bottoni esistono solo per task in ritardo o di oggi. Se la scadenza è già nel
  // futuro, qualcuno l'ha già fatto o rimandato da un altro messaggio: niente doppioni.
  if (task.next_due > today) {
    const by = task.last_done_by ? ` da ${task.last_done_by}` : "";
    await answerCallbackQuery(cq.id, task.last_done_on === today ? `Già fatto${by}` : "Già gestito");
    await dropButtons();
    return;
  }

  const who = await getOrCreateMember(cq.from.id, displayName(cq.from));

  if (action === "d") {
    const updated = await completeTask(task.id, who.id, today);
    await answerCallbackQuery(cq.id, "Segnato ✅");
    await dropButtons();
    await broadcast(chatId, [eventCompleted(who.name, updated, today)]);
    await sendMessage(chatId, renderCompleted(who.name, updated, today));
    return;
  }

  if (action === "p") {
    const until = addDays(today, 1);
    await postponeTask(task.id, until);
    await answerCallbackQuery(cq.id, "Rimandato a domani");
    await dropButtons();
    await broadcast(chatId, [eventPostponed(who.name, task.title, until, today)]);
    await sendMessage(chatId, renderPostponed(task.title, until, today));
    return;
  }

  await answerCallbackQuery(cq.id);
}

// ---------------------------------------------------------------------------
// Con più chat autorizzate (le due chat private), quello che succede in una viene
// annunciato nelle altre. Con una sola chat non fa nulla.

async function broadcast(fromChatId: number, events: string[]): Promise<void> {
  if (!events.length) return;
  const others = allowedChatIds().filter((id) => id !== fromChatId);
  if (!others.length) return;
  const text = events.map(escapeHtml).join("\n");
  await Promise.all(others.map((id) => sendMessage(id, text).catch((e) => console.error("broadcast", id, e))));
}
