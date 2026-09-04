// Dal dominio al testo Telegram (HTML). Nessuna logica di business qui.

import { type Bucket, bucketFor, formatRelative, formatShort, type IsoDate } from "./dates.ts";
import type { CompletionRecord, RecurrenceUnit, TaskOverview, TaskRow } from "./db.ts";
import { escapeHtml, type InlineKeyboardMarkup } from "./telegram.ts";

const BUCKET_TITLE: Record<Bucket, string> = {
  overdue: "🔴 In ritardo",
  today: "📅 Oggi",
  week: "🗓 Questa settimana",
  month: "📆 Questo mese",
  later: "⏭ Più avanti",
};

const UNIT_LABEL: Record<RecurrenceUnit, [string, string]> = {
  day: ["giorno", "giorni"],
  week: ["settimana", "settimane"],
  month: ["mese", "mesi"],
  year: ["anno", "anni"],
};

export function describeRecurrence(t: Pick<TaskRow, "every_n" | "unit" | "anchor">): string {
  if (!t.every_n || !t.unit) return "una tantum";
  const [one, many] = UNIT_LABEL[t.unit];
  const base = t.every_n === 1 ? `ogni ${one}` : `ogni ${t.every_n} ${many}`;
  return t.anchor === "completion" ? `${base} da quando lo fai` : `${base} a calendario`;
}

export function groupByBucket(tasks: TaskOverview[], today: IsoDate): Map<Bucket, TaskOverview[]> {
  const out = new Map<Bucket, TaskOverview[]>();
  for (const t of tasks) {
    const b = bucketFor(t.next_due, today);
    if (!out.has(b)) out.set(b, []);
    out.get(b)!.push(t);
  }
  return out;
}

function taskLine(t: TaskOverview, bucket: Bucket, today: IsoDate): string {
  let line = `• ${escapeHtml(t.title)}`;
  if (bucket === "overdue") line += ` <i>(${formatRelative(t.next_due, today)})</i>`;
  else if (bucket !== "today") line += ` · ${formatShort(t.next_due, today)}`;
  if (t.assigned_to_name) line += ` → ${escapeHtml(t.assigned_to_name)}`;
  return line;
}

/**
 * Agenda raggruppata. `buckets` decide quali sezioni mostrare, in quest'ordine.
 * Le sezioni vuote vengono omesse; se non resta nulla, torna `emptyText`.
 */
export function renderAgenda(
  tasks: TaskOverview[],
  today: IsoDate,
  buckets: Bucket[],
  emptyText = "Niente da fare 🎉",
): string {
  const grouped = groupByBucket(tasks, today);
  const sections: string[] = [];
  for (const b of buckets) {
    const items = grouped.get(b);
    if (!items?.length) continue;
    sections.push([`<b>${BUCKET_TITLE[b]}</b>`, ...items.map((t) => taskLine(t, b, today))].join("\n"));
  }
  return sections.length ? sections.join("\n\n") : emptyText;
}

/** Tastiera con un bottone "Fatto" per task (max `max`, per non allagare la chat). */
export function doneKeyboard(tasks: TaskOverview[], max = 10): InlineKeyboardMarkup | undefined {
  const rows = tasks.slice(0, max).map((t) => [
    { text: `✅ ${truncate(t.title, 36)}`, callback_data: `d:${t.id}` },
  ]);
  return rows.length ? { inline_keyboard: rows } : undefined;
}

/** Rimuove dalla tastiera le righe che riguardano `taskId`. */
export function keyboardWithout(
  kb: InlineKeyboardMarkup | undefined,
  taskId: string,
): InlineKeyboardMarkup | undefined {
  if (!kb) return undefined;
  const rows = kb.inline_keyboard.filter((row) => !row.some((b) => b.callback_data.endsWith(`:${taskId}`)));
  return rows.length ? { inline_keyboard: rows } : undefined;
}

export function renderHistory(rows: CompletionRecord[], today: IsoDate): string {
  if (!rows.length) return "Nessun completamento registrato.";
  return rows
    .map((r) => {
      const who = r.member_name ? ` — ${escapeHtml(r.member_name)}` : "";
      const note = r.note ? ` <i>(${escapeHtml(r.note)})</i>` : "";
      return `• ${formatShort(r.done_on, today)}: ${escapeHtml(r.task_title)}${who}${note}`;
    })
    .join("\n");
}

export function renderCompleted(who: string, t: TaskRow, today: IsoDate): string {
  const next = t.active ? `Prossima: ${formatShort(t.next_due, today)}.` : "Era una tantum: archiviato.";
  return `✅ <b>${escapeHtml(who)}</b> ha fatto: ${escapeHtml(t.title)}\n${next}`;
}

// Eventi in testo semplice, identici per bottoni e agente: vanno all'altra chat.
export function eventCompleted(who: string, t: TaskRow, today: IsoDate): string {
  return t.active
    ? `✅ ${who} ha fatto: ${t.title} (prossima ${formatShort(t.next_due, today)})`
    : `✅ ${who} ha fatto: ${t.title} (una tantum, archiviato)`;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

export const HELP_TEXT = [
  "<b>Sambelli</b> — i lavori di casa, senza pensarci.",
  "",
  "Scrivimi normalmente: «cosa c'è da fare oggi?», «ho fatto le lenzuola»,",
  "«aggiungi cambiare filtro cappa ogni 3 mesi», «sposta il sale a lunedì».",
  "",
  "Comandi rapidi:",
  "/oggi — in ritardo e oggi",
  "/settimana — fino a domenica",
  "/mese — fino a fine mese",
  "/tutti — tutto quello che c'è",
  "/storico — ultimi completamenti",
  "/aiuto — questo messaggio",
].join("\n");
