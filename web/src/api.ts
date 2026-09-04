import { initData } from "./telegram.ts";
import type { Agenda, Completion, Inactive, Task, TaskInput } from "./types.ts";

const BASE = import.meta.env.VITE_API_URL as string;
const DEV_USER = import.meta.env.VITE_DEV_USER_ID as string | undefined;

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown, opts: { keepalive?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const data = initData();
  if (data) headers["x-telegram-init-data"] = data;
  else if (DEV_USER) headers["x-dev-user-id"] = DEV_USER;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    keepalive: opts.keepalive,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (json as { error?: string }).error ?? `HTTP ${res.status}`);
  return json as T;
}

export const api = {
  agenda: () => call<Agenda>("GET", "/agenda"),
  inactive: () => call<Inactive>("GET", "/inactive"),
  history: (id: string) => call<{ history: Completion[] }>("GET", `/tasks/${id}/history`),
  archive: (id: string) => call<{ ok: true }>("POST", `/tasks/${id}/archive`),
  unarchive: (id: string) => call<{ ok: true }>("POST", `/tasks/${id}/unarchive`),
  complete: (id: string, keepalive = false) =>
    call<{ ok: true; next_due: string; active: boolean; completion_id: string | null }>("POST", `/tasks/${id}/complete`, {}, { keepalive }),
  undo: (id: string) => call<{ ok: true; next_due: string; active: boolean }>("POST", `/tasks/${id}/undo`),
  create: (input: TaskInput) => call<{ ok: true; id: string }>("POST", "/tasks", input),
  update: (id: string, input: TaskInput) => call<{ ok: true; task: Task }>("PATCH", `/tasks/${id}`, input),
};
