import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.113.0";
import { type IsoDate, todayAtHome } from "./dates.ts";

export type RecurrenceUnit = "day" | "week" | "month" | "year";
export type RecurrenceAnchor = "completion" | "schedule";
/** active = in agenda · done = una tantum completata · archived = spenta a mano */
export type TaskStatus = "active" | "done" | "archived";

export interface Member {
  id: string;
  name: string;
  telegram_user_id: number | null;
}

export interface TaskRow {
  id: string;
  title: string;
  notes: string | null;
  every_n: number | null;
  unit: RecurrenceUnit | null;
  anchor: RecurrenceAnchor;
  next_due: IsoDate;
  postponed_until: IsoDate | null;
  assigned_to: string | null;
  status: TaskStatus;
}

/** Riga della vista task_overview: next_due è già la data effettiva. */
export interface TaskOverview extends Omit<TaskRow, "postponed_until"> {
  assigned_to_name: string | null;
  last_done_on: IsoDate | null;
  last_done_by: string | null;
}

export interface CompletionRecord {
  id: string;
  task_id: string;
  member_id: string | null;
  done_on: IsoDate;
  note: string | null;
  task_title: string;
  member_name: string | null;
  /** true se è l'ultimo completamento del task e si può annullare */
  undoable: boolean;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface TaskInput {
  title: string;
  notes?: string | null;
  every_n?: number | null;
  unit?: RecurrenceUnit | null;
  anchor?: RecurrenceAnchor;
  next_due?: IsoDate;
  assigned_to?: string | null;
  created_by?: string | null;
}

export type TaskPatch = Partial<Omit<TaskInput, "created_by">> & { status?: TaskStatus };

let cached: SupabaseClient | undefined;

/** Client con service role: le Edge Functions sono l'unico accesso al DB. */
export function db(): SupabaseClient {
  if (cached) return cached;
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY mancanti");
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

function unwrap<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  if (res.data === null) throw new Error(`${what}: nessun dato`);
  return res.data;
}

// ---------------------------------------------------------------------------
// Membri
// ---------------------------------------------------------------------------

export async function listMembers(): Promise<Member[]> {
  const res = await db().from("members").select("id, name, telegram_user_id").order("name");
  return unwrap(res, "listMembers");
}

/** Primo contatto: chi scrive in una chat ammessa viene registrato col suo nome Telegram. */
export async function getOrCreateMember(telegramUserId: number, displayName: string): Promise<Member> {
  const found = await db()
    .from("members")
    .select("id, name, telegram_user_id")
    .eq("telegram_user_id", telegramUserId)
    .maybeSingle();
  if (found.error) throw new Error(`getOrCreateMember: ${found.error.message}`);
  if (found.data) return found.data as Member;

  const created = await db()
    .from("members")
    .insert({ telegram_user_id: telegramUserId, name: displayName })
    .select("id, name, telegram_user_id")
    .single();
  return unwrap(created, "getOrCreateMember.insert") as Member;
}

export async function renameMember(id: string, name: string): Promise<Member> {
  const res = await db().from("members").update({ name }).eq("id", id).select("id, name, telegram_user_id").single();
  return unwrap(res, "renameMember") as Member;
}

// ---------------------------------------------------------------------------
// Stato applicativo minimo (es. data dell'ultimo recap inviato)
// ---------------------------------------------------------------------------

export async function getAppState(key: string): Promise<string | null> {
  const res = await db().from("app_state").select("value").eq("key", key).maybeSingle();
  if (res.error) throw new Error(`getAppState: ${res.error.message}`);
  return (res.data as { value: string } | null)?.value ?? null;
}

export async function setAppState(key: string, value: string): Promise<void> {
  const res = await db().from("app_state").upsert({ key, value, updated_at: new Date().toISOString() });
  if (res.error) throw new Error(`setAppState: ${res.error.message}`);
}

export function findMemberByName(members: Member[], name: string): Member | undefined {
  const needle = name.trim().toLowerCase();
  return members.find((m) => m.name.toLowerCase() === needle) ??
    members.find((m) => m.name.toLowerCase().startsWith(needle));
}

// ---------------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------------

const OVERVIEW_COLUMNS =
  "id, title, notes, every_n, unit, anchor, next_due, status, assigned_to, assigned_to_name, last_done_on, last_done_by, updated_at";

export async function listActiveTasks(): Promise<TaskOverview[]> {
  const res = await db()
    .from("task_overview")
    .select(OVERVIEW_COLUMNS)
    .eq("status", "active")
    .order("next_due")
    .order("title");
  return unwrap(res, "listActiveTasks") as TaskOverview[];
}

/** Completati e archiviati, dal più recente: vivono fuori dall'agenda. */
export async function listInactiveTasks(): Promise<TaskOverview[]> {
  const res = await db()
    .from("task_overview")
    .select(OVERVIEW_COLUMNS)
    .neq("status", "active")
    .order("updated_at", { ascending: false });
  return unwrap(res, "listInactiveTasks") as TaskOverview[];
}

export async function getTask(id: string): Promise<TaskOverview | null> {
  const res = await db().from("task_overview").select(OVERVIEW_COLUMNS).eq("id", id).maybeSingle();
  if (res.error) throw new Error(`getTask: ${res.error.message}`);
  return (res.data as TaskOverview | null) ?? null;
}

export async function createTask(input: TaskInput): Promise<TaskRow> {
  const res = await db().from("tasks").insert(input).select("*").single();
  return unwrap(res, "createTask") as TaskRow;
}

export async function updateTask(id: string, patch: TaskPatch): Promise<TaskRow> {
  const res = await db().from("tasks").update(patch).eq("id", id).select("*").single();
  return unwrap(res, "updateTask") as TaskRow;
}

/** Registra il completamento; "oggi" è sempre nel fuso di casa, mai il current_date del server. */
export async function completeTask(
  taskId: string,
  memberId: string | null,
  doneOn: IsoDate = todayAtHome(),
  note?: string | null,
): Promise<TaskRow> {
  const res = await db().rpc("complete_task", {
    p_task_id: taskId,
    p_member_id: memberId,
    p_done_on: doneOn,
    p_note: note ?? null,
  });
  return unwrap(res, "completeTask") as TaskRow;
}

export async function listHistory(opts: {
  taskId?: string;
  memberId?: string;
  since?: IsoDate;
  limit?: number;
}): Promise<CompletionRecord[]> {
  let q = db()
    .from("completions")
    .select("id, task_id, member_id, done_on, note, prev_next_due, tasks!inner(title), members(name)")
    .order("done_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 20);
  if (opts.taskId) q = q.eq("task_id", opts.taskId);
  if (opts.memberId) q = q.eq("member_id", opts.memberId);
  if (opts.since) q = q.gte("done_on", opts.since);
  const res = await q;
  const rows = unwrap(res, "listHistory") as unknown as Array<{
    id: string;
    task_id: string;
    member_id: string | null;
    done_on: IsoDate;
    note: string | null;
    prev_next_due: IsoDate | null;
    tasks: { title: string } | { title: string }[];
    members: { name: string } | { name: string }[] | null;
  }>;
  const first = <T>(v: T | T[] | null): T | null => Array.isArray(v) ? v[0] ?? null : v;
  // Le righe sono ordinate dalla più recente: la prima che vediamo per un task è l'ultima fatta.
  const seen = new Set<string>();
  return rows.map((r) => {
    const latest = !seen.has(r.task_id);
    seen.add(r.task_id);
    return {
      id: r.id,
      task_id: r.task_id,
      member_id: r.member_id,
      done_on: r.done_on,
      note: r.note,
      task_title: first(r.tasks)?.title ?? "?",
      member_name: first(r.members)?.name ?? null,
      undoable: latest && r.prev_next_due !== null,
    };
  });
}

export async function latestCompletion(taskId: string): Promise<CompletionRecord | null> {
  const rows = await listHistory({ taskId, limit: 1 });
  return rows[0] ?? null;
}

export async function undoCompletion(completionId: string): Promise<TaskRow> {
  const res = await db().rpc("undo_completion", { p_completion_id: completionId });
  return unwrap(res, "undoCompletion") as TaskRow;
}

// ---------------------------------------------------------------------------
// Memoria breve delle chat
// ---------------------------------------------------------------------------

export async function loadRecentMessages(chatId: number, limit = 12, withinMinutes = 180): Promise<ChatMessage[]> {
  const since = new Date(Date.now() - withinMinutes * 60_000).toISOString();
  const res = await db()
    .from("chat_messages")
    .select("role, content")
    .eq("chat_id", chatId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(limit);
  const rows = unwrap(res, "loadRecentMessages") as ChatMessage[];
  return rows.reverse();
}

export async function appendMessage(
  chatId: number,
  role: ChatMessage["role"],
  content: string,
  memberId?: string,
): Promise<void> {
  const res = await db().from("chat_messages").insert({ chat_id: chatId, role, content, member_id: memberId ?? null });
  if (res.error) throw new Error(`appendMessage: ${res.error.message}`);
}
