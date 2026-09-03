// Il cervello del bot: un messaggio entra, Claude sceglie cosa fare con gli
// strumenti, il codice esegue sul database, esce una risposta testuale.
//
// Loop manuale (non il tool runner beta): poche iterazioni, nessuna dipendenza
// dalle helper beta, e vediamo esattamente cosa succede a ogni giro.

import Anthropic from "npm:@anthropic-ai/sdk@0.123.0";
import { isIsoDate, type IsoDate, todayAtHome } from "./dates.ts";
import {
  type ChatMessage,
  completeTask,
  createTask,
  findMemberByName,
  listActiveTasks,
  listHistory,
  listMembers,
  type Member,
  postponeTask,
  type RecurrenceAnchor,
  type RecurrenceUnit,
  type TaskOverview,
  updateTask,
} from "./db.ts";
import { buildContext, SYSTEM_PROMPT } from "./prompt.ts";

const MODEL = "claude-opus-5";
/** Usato solo se Opus è sovraccarico o in errore lato server dopo i retry. */
const FALLBACK_MODEL = "claude-sonnet-5";
const MAX_ITERATIONS = 6;

/** Entrambi i modelli non disponibili: il webhook manda un messaggio dedicato. */
export class ModelUnavailableError extends Error {
  constructor(cause: unknown) {
    super(`modello non disponibile: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "ModelUnavailableError";
  }
}

type BetaTool = Anthropic.Beta.BetaTool;
type MessageParam = Anthropic.Beta.BetaMessageParam;
type ToolUseBlock = Anthropic.Beta.BetaToolUseBlock;
type ToolResultParam = Anthropic.Beta.BetaToolResultBlockParam;

const ISO_DATE = { type: "string", description: "Data ISO YYYY-MM-DD" } as const;
const UNIT = { type: "string", enum: ["day", "week", "month", "year"] } as const;
const ANCHOR = {
  type: "string",
  enum: ["completion", "schedule"],
  description: "completion = la prossima parte da quando lo fai; schedule = avanza a calendario",
} as const;

export const TOOLS: BetaTool[] = [
  {
    name: "complete_task",
    description:
      "Registra che un task è stato fatto e calcola la prossima scadenza. Usa l'id dall'elenco nel contesto.",
    input_schema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "id del task" },
        done_by: { type: "string", description: "Nome di chi lo ha fatto. Ometti se è chi scrive." },
        done_on: { ...ISO_DATE, description: "Quando è stato fatto. Ometti se oggi." },
        note: { type: "string", description: "Nota breve opzionale" },
      },
      required: ["task_id"],
      additionalProperties: false,
    },
  },
  {
    name: "postpone_task",
    description: "Sposta la prossima scadenza di un task a una data, senza segnarlo come fatto.",
    input_schema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        until: ISO_DATE,
      },
      required: ["task_id", "until"],
      additionalProperties: false,
    },
  },
  {
    name: "create_task",
    description:
      "Crea un nuovo task. Per un task ricorrente passa every_n e unit; senza, è una tantum. first_due è la prima scadenza (default oggi).",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Titolo breve, es. 'Lavare lenzuola'" },
        notes: { type: "string" },
        every_n: { type: "integer", description: "Intero >= 1" },
        unit: UNIT,
        anchor: ANCHOR,
        first_due: ISO_DATE,
        assigned_to: { type: "string", description: "Nome del membro, solo se esplicitamente richiesto" },
      },
      required: ["title"],
      additionalProperties: false,
    },
  },
  {
    name: "update_task",
    description:
      "Modifica un task esistente: titolo, note, ricorrenza, prossima scadenza, assegnazione, oppure archivialo con active=false. Passa solo i campi da cambiare.",
    input_schema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        title: { type: "string" },
        notes: { type: "string" },
        every_n: { type: "integer", description: "Intero >= 1" },
        unit: UNIT,
        anchor: ANCHOR,
        next_due: ISO_DATE,
        assigned_to: {
          type: "string",
          description: "Nome del membro, oppure stringa vuota per togliere l'assegnazione",
        },
        clear_recurrence: { type: "boolean", description: "true per renderlo una tantum" },
        active: { type: "boolean", description: "false per archiviare" },
      },
      required: ["task_id"],
      additionalProperties: false,
    },
  },
  {
    name: "get_history",
    description: "Elenca i completamenti passati: chi ha fatto cosa e quando. Filtra per task, persona o data.",
    input_schema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        member: { type: "string", description: "Nome del membro" },
        since: ISO_DATE,
        limit: { type: "integer", description: "Da 1 a 50" },
      },
      required: [],
      additionalProperties: false,
    },
  },
];

interface AgentContext {
  today: IsoDate;
  sender: Member;
  members: Member[];
  tasks: TaskOverview[];
  /** Eventi umani prodotti dagli strumenti, da inoltrare alle altre chat. */
  events: string[];
}

type ToolInput = Record<string, unknown>;

function str(input: ToolInput, key: string): string | undefined {
  const v = input[key];
  return typeof v === "string" && v.length ? v : undefined;
}

function num(input: ToolInput, key: string): number | undefined {
  const v = input[key];
  return typeof v === "number" ? v : undefined;
}

function date(input: ToolInput, key: string): IsoDate | undefined {
  const v = input[key];
  if (v === undefined || v === null || v === "") return undefined;
  if (!isIsoDate(v)) throw new Error(`${key} non è una data ISO valida: ${String(v)}`);
  return v;
}

function requireTask(ctx: AgentContext, id: string | undefined): TaskOverview {
  const t = id ? ctx.tasks.find((x) => x.id === id) : undefined;
  if (!t) throw new Error(`task_id sconosciuto: usa un id dall'elenco nel contesto`);
  return t;
}

function resolveMember(ctx: AgentContext, name: string | undefined): Member | undefined {
  if (!name) return undefined;
  const m = findMemberByName(ctx.members, name);
  if (!m) throw new Error(`Nessun membro chiamato "${name}". Membri: ${ctx.members.map((x) => x.name).join(", ")}`);
  return m;
}

async function executeTool(ctx: AgentContext, name: string, input: ToolInput): Promise<string> {
  switch (name) {
    case "complete_task": {
      const task = requireTask(ctx, str(input, "task_id"));
      const by = resolveMember(ctx, str(input, "done_by")) ?? ctx.sender;
      const updated = await completeTask(task.id, by.id, date(input, "done_on"), str(input, "note"));
      ctx.events.push(
        updated.active
          ? `✅ ${by.name} ha fatto: ${task.title} (prossima ${updated.next_due})`
          : `✅ ${by.name} ha fatto: ${task.title} (una tantum, archiviato)`,
      );
      return JSON.stringify({
        ok: true,
        title: task.title,
        done_by: by.name,
        next_due: updated.next_due,
        active: updated.active,
      });
    }
    case "postpone_task": {
      const task = requireTask(ctx, str(input, "task_id"));
      const until = date(input, "until");
      if (!until) throw new Error("until obbligatorio");
      const updated = await postponeTask(task.id, until);
      ctx.events.push(`⏭ ${ctx.sender.name} ha spostato "${task.title}" a ${updated.next_due}`);
      return JSON.stringify({ ok: true, title: task.title, next_due: updated.next_due });
    }
    case "create_task": {
      const title = str(input, "title");
      if (!title) throw new Error("title obbligatorio");
      const everyN = num(input, "every_n");
      const unit = str(input, "unit") as RecurrenceUnit | undefined;
      if ((everyN === undefined) !== (unit === undefined)) {
        throw new Error("every_n e unit vanno passati insieme (o nessuno dei due)");
      }
      const assignee = resolveMember(ctx, str(input, "assigned_to"));
      const created = await createTask({
        title,
        notes: str(input, "notes") ?? null,
        every_n: everyN ?? null,
        unit: unit ?? null,
        anchor: (str(input, "anchor") as RecurrenceAnchor | undefined) ?? "completion",
        next_due: date(input, "first_due") ?? ctx.today,
        assigned_to: assignee?.id ?? null,
        created_by: ctx.sender.id,
      });
      ctx.events.push(`➕ ${ctx.sender.name} ha aggiunto "${created.title}" (scade ${created.next_due})`);
      return JSON.stringify({ ok: true, id: created.id, title: created.title, next_due: created.next_due });
    }
    case "update_task": {
      const task = requireTask(ctx, str(input, "task_id"));
      const patch: Parameters<typeof updateTask>[1] = {};
      const title = str(input, "title");
      if (title) patch.title = title;
      if (typeof input.notes === "string") patch.notes = input.notes || null;
      if (input.clear_recurrence === true) {
        patch.every_n = null;
        patch.unit = null;
      } else {
        const everyN = num(input, "every_n");
        const unit = str(input, "unit") as RecurrenceUnit | undefined;
        if (everyN !== undefined) patch.every_n = everyN;
        if (unit) patch.unit = unit;
        // Se cambia solo uno dei due, completa con il valore attuale.
        if (patch.every_n !== undefined && patch.unit === undefined) patch.unit = task.unit ?? "week";
        if (patch.unit !== undefined && patch.every_n === undefined) patch.every_n = task.every_n ?? 1;
      }
      const anchor = str(input, "anchor") as RecurrenceAnchor | undefined;
      if (anchor) patch.anchor = anchor;
      const nextDue = date(input, "next_due");
      if (nextDue) patch.next_due = nextDue;
      if (typeof input.assigned_to === "string") {
        patch.assigned_to = input.assigned_to === "" ? null : resolveMember(ctx, input.assigned_to)!.id;
      }
      if (typeof input.active === "boolean") patch.active = input.active;
      if (Object.keys(patch).length === 0) throw new Error("Nessun campo da modificare");
      const updated = await updateTask(task.id, patch);
      ctx.events.push(
        patch.active === false
          ? `🗄 ${ctx.sender.name} ha archiviato "${task.title}"`
          : `✏️ ${ctx.sender.name} ha modificato "${updated.title}"`,
      );
      return JSON.stringify({ ok: true, task: updated });
    }
    case "get_history": {
      const taskId = str(input, "task_id");
      if (taskId) requireTask(ctx, taskId);
      const member = resolveMember(ctx, str(input, "member"));
      const rows = await listHistory({
        taskId,
        memberId: member?.id,
        since: date(input, "since"),
        limit: num(input, "limit"),
      });
      return JSON.stringify(rows);
    }
    default:
      throw new Error(`Strumento sconosciuto: ${name}`);
  }
}

export interface AgentReply {
  text: string;
  events: string[];
}

let client: Anthropic | undefined;
function anthropic(): Anthropic {
  // 4 retry con backoff esponenziale su 429/529/5xx e errori di rete (default SDK: 2).
  return client ??= new Anthropic({ maxRetries: 4 });
}

function serverSideFailureStatus(err: unknown): number | undefined {
  if (!(err instanceof Anthropic.APIError)) return undefined;
  const status = err.status ?? 0;
  return status === 529 || status === 429 || status >= 500 ? status : undefined;
}

function isServerSideFailure(err: unknown): boolean {
  return serverSideFailureStatus(err) !== undefined;
}

type CreateParams = Omit<Anthropic.Beta.MessageCreateParamsNonStreaming, "model" | "betas" | "fallbacks">;

/** Opus con fallback server-side; se dopo i retry è ancora giù, Sonnet. */
async function createMessage(params: CreateParams): Promise<Anthropic.Beta.BetaMessage> {
  try {
    return await anthropic().beta.messages.create({
      ...params,
      model: MODEL,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
  } catch (err) {
    if (!isServerSideFailure(err)) throw err;
    console.warn(`${MODEL} non disponibile (${serverSideFailureStatus(err)}), provo ${FALLBACK_MODEL}`);
    try {
      return await anthropic().beta.messages.create({ ...params, model: FALLBACK_MODEL });
    } catch (err2) {
      if (!isServerSideFailure(err2)) throw err2;
      throw new ModelUnavailableError(err2);
    }
  }
}

/**
 * Gestisce un messaggio in linguaggio naturale.
 * `history` sono gli ultimi scambi della chat (senza contesto), `text` il messaggio nuovo.
 */
export async function runAgent(sender: Member, text: string, history: ChatMessage[]): Promise<AgentReply> {
  const [members, tasks] = await Promise.all([listMembers(), listActiveTasks()]);
  const ctx: AgentContext = { today: todayAtHome(), sender, members, tasks, events: [] };

  const messages: MessageParam[] = [
    ...history.map((m): MessageParam => ({ role: m.role, content: m.content })),
    {
      role: "user",
      content: `${buildContext(ctx.today, members, tasks)}\n\n[Messaggio di ${sender.name}]\n${text}`,
    },
  ];

  let finalText = "";
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await createMessage({
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
      output_config: { effort: "low" },
    });

    if (response.stop_reason === "refusal") {
      return { text: "Su questo preferisco non rispondere.", events: ctx.events };
    }

    const texts = response.content.filter((b) => b.type === "text").map((b) => b.text.trim()).filter(Boolean);
    if (texts.length) finalText = texts.join("\n");

    const toolUses = response.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || toolUses.length === 0) break;

    messages.push({ role: "assistant", content: response.content });

    const results: ToolResultParam[] = [];
    for (const call of toolUses) {
      try {
        const out = await executeTool(ctx, call.name, (call.input ?? {}) as ToolInput);
        results.push({ type: "tool_result", tool_use_id: call.id, content: out });
      } catch (err) {
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: `Errore: ${err instanceof Error ? err.message : String(err)}`,
          is_error: true,
        });
      }
    }
    messages.push({ role: "user", content: results });

    // Le mutazioni cambiano l'elenco: ricarichiamo per gli strumenti successivi.
    ctx.tasks = await listActiveTasks();
  }

  return { text: finalText || "Fatto.", events: ctx.events };
}
