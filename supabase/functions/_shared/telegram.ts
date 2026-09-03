// Client minimale per la Bot API di Telegram. Solo ciò che usiamo.

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  reply_markup?: InlineKeyboardMarkup;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

function apiBase(): string {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN mancante");
  const host = Deno.env.get("TELEGRAM_API_BASE") ?? "https://api.telegram.org";
  return `${host}/bot${token}`;
}

async function call<T>(method: string, payload: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${apiBase()}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    // L'errore di rete porta con sé l'URL, e quindi il token: non lo propaghiamo.
    throw new Error(`Telegram ${method}: rete non raggiungibile (${err instanceof Error ? err.name : "errore"})`);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) {
    throw new Error(`Telegram ${method} fallito: ${res.status} ${JSON.stringify(body)}`);
  }
  return body.result as T;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Testo generato dal modello: escape di tutto, poi riammessi solo <b> e <i>.
 * Senza questo un titolo con "<" o "&" fa rifiutare il messaggio a Telegram.
 */
export function sanitizeModelHtml(s: string): string {
  return escapeHtml(s).replace(/&lt;(\/?)(b|i)&gt;/g, "<$1$2>");
}

export function sendMessage(
  chatId: number,
  html: string,
  opts: { replyMarkup?: InlineKeyboardMarkup; replyTo?: number } = {},
): Promise<TelegramMessage> {
  return call<TelegramMessage>("sendMessage", {
    chat_id: chatId,
    text: html,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(opts.replyMarkup ? { reply_markup: opts.replyMarkup } : {}),
    ...(opts.replyTo ? { reply_parameters: { message_id: opts.replyTo } } : {}),
  });
}

export function answerCallbackQuery(id: string, text?: string): Promise<boolean> {
  return call<boolean>("answerCallbackQuery", { callback_query_id: id, ...(text ? { text } : {}) });
}

export function editMessageReplyMarkup(
  chatId: number,
  messageId: number,
  replyMarkup: InlineKeyboardMarkup | undefined,
): Promise<unknown> {
  return call("editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: replyMarkup ?? { inline_keyboard: [] },
  });
}

export function displayName(u: TelegramUser): string {
  return u.first_name || u.username || `utente ${u.id}`;
}

/** Chat da cui accettiamo messaggi. Vuoto = nessuna: la lista è l'unica autorizzazione. */
export function allowedChatIds(): number[] {
  return (Deno.env.get("TELEGRAM_ALLOWED_CHAT_IDS") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n));
}

export function isChatAllowed(chatId: number): boolean {
  return allowedChatIds().includes(chatId);
}

/**
 * Con più chat autorizzate (le due chat private), quello che succede in una viene
 * annunciato nelle altre. Con una sola chat non fa nulla. Non lancia mai.
 */
export async function broadcast(fromChatId: number, events: string[]): Promise<void> {
  if (!events.length) return;
  const others = allowedChatIds().filter((id) => id !== fromChatId);
  if (!others.length) return;
  const text = events.map(escapeHtml).join("\n");
  await Promise.all(others.map((id) => sendMessage(id, text).catch((e) => console.error("broadcast", id, e))));
}
