// API della Mini App Telegram. Ogni richiesta porta i dati utente firmati da Telegram
// (initData) in un header; li verifichiamo con il token del bot e da lì sappiamo chi è.
// Le mutazioni passano dagli stessi strumenti dell'agente (executeTool), quindi validazione,
// eventi e notifiche all'altra persona sono identici a quelli del bot.
//
//   GET   /agenda                      task attivi, membri, storico ultimi 7 giorni
//   POST  /tasks                       crea (body = input di create_task)
//   PATCH /tasks/:id                   modifica (body = input di update_task senza task_id)
//   POST  /tasks/:id/complete          segna fatto oggi
//   POST  /tasks/:id/postpone          { until: "YYYY-MM-DD" }
//   POST  /tasks/:id/undo              annulla l'ultimo completamento

import { type AgentContext, executeTool } from "../_shared/agent.ts";
import { addDays, todayAtHome } from "../_shared/dates.ts";
import {
  getOrCreateMember,
  latestCompletion,
  listActiveTasks,
  listHistory,
  listMembers,
  type Member,
} from "../_shared/db.ts";
import { broadcast, isChatAllowed } from "../_shared/telegram.ts";

const INIT_DATA_MAX_AGE_S = 24 * 3600;

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// CORS

function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get("origin") ?? "";
  const allowed = (Deno.env.get("APP_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return {
    "access-control-allow-origin": allowed.includes(origin) ? origin : allowed[0] ?? "",
    "access-control-allow-methods": "GET, POST, PATCH, OPTIONS",
    "access-control-allow-headers": "content-type, x-telegram-init-data, x-dev-user-id",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "content-type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Verifica di initData (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)

async function hmacSha256(key: BufferSource, message: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, new TextEncoder().encode(message));
}

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface TelegramWebAppUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}

export async function verifyInitData(initData: string, botToken: string): Promise<TelegramWebAppUser> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw new HttpError(401, "initData senza hash");
  params.delete("hash");
  const dataCheck = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = await hmacSha256(new TextEncoder().encode("WebAppData"), botToken);
  const expected = hex(await hmacSha256(secret, dataCheck));
  if (expected.length !== hash.length || !timingSafeEqual(expected, hash)) {
    throw new HttpError(401, "initData non valida");
  }
  const authDate = Number(params.get("auth_date") ?? 0);
  if (!authDate || Date.now() / 1000 - authDate > INIT_DATA_MAX_AGE_S) {
    throw new HttpError(401, "initData scaduta: riapri l'app");
  }
  const user = params.get("user");
  if (!user) throw new HttpError(401, "initData senza utente");
  return JSON.parse(user) as TelegramWebAppUser;
}

function timingSafeEqual(a: string, b: string): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function authenticate(req: Request): Promise<Member> {
  let telegramId: number;
  let name: string;

  const devId = Deno.env.get("APP_DEV_USER_ID");
  if (devId && req.headers.get("x-dev-user-id") === devId) {
    telegramId = Number(devId);
    name = "Dev";
  } else {
    const initData = req.headers.get("x-telegram-init-data");
    if (!initData) throw new HttpError(401, "Apri l'app da Telegram");
    const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!token) throw new HttpError(500, "TELEGRAM_BOT_TOKEN mancante");
    const user = await verifyInitData(initData, token);
    telegramId = user.id;
    name = user.first_name || user.username || `utente ${user.id}`;
  }

  // In chat privata l'id della chat è l'id utente: vale la stessa allowlist del bot.
  if (!isChatAllowed(telegramId)) throw new HttpError(403, "Non sei tra i membri della casa");
  return getOrCreateMember(telegramId, name);
}

// ---------------------------------------------------------------------------
// Mutazioni: stesso percorso dell'agente, così eventi e notifiche coincidono.

async function mutate(me: Member, tool: string, input: Record<string, unknown>): Promise<unknown> {
  const [members, tasks] = await Promise.all([listMembers(), listActiveTasks()]);
  const ctx: AgentContext = { today: todayAtHome(), sender: me, members, tasks, events: [] };
  let out: string;
  try {
    out = await executeTool(ctx, tool, input);
  } catch (err) {
    throw new HttpError(400, err instanceof Error ? err.message : String(err));
  }
  if (me.telegram_user_id !== null) await broadcast(me.telegram_user_id, ctx.events);
  return JSON.parse(out);
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  if (req.headers.get("content-length") === "0") return {};
  try {
    const b = await req.json();
    return b && typeof b === "object" ? b as Record<string, unknown> : {};
  } catch {
    throw new HttpError(400, "body JSON non valido");
  }
}

// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });

  try {
    const me = await authenticate(req);
    const path = new URL(req.url).pathname.replace(/^\/app-api/, "").replace(/\/$/, "") || "/";
    const seg = path.split("/").filter(Boolean); // es. ["tasks", "<id>", "complete"]

    if (req.method === "GET" && path === "/agenda") {
      const today = todayAtHome();
      const [tasks, members, history] = await Promise.all([
        listActiveTasks(),
        listMembers(),
        listHistory({ since: addDays(today, -7), limit: 100 }),
      ]);
      return json(req, { today, me, members, tasks, history });
    }

    if (req.method === "POST" && path === "/tasks") {
      return json(req, await mutate(me, "create_task", await readBody(req)), 201);
    }

    if (seg[0] === "tasks" && seg[1]) {
      const id = seg[1];
      if (req.method === "PATCH" && seg.length === 2) {
        return json(req, await mutate(me, "update_task", { ...(await readBody(req)), task_id: id }));
      }
      if (req.method === "POST" && seg[2] === "complete") {
        const result = await mutate(me, "complete_task", { task_id: id }) as Record<string, unknown>;
        const completion = await latestCompletion(id);
        return json(req, { ...result, completion_id: completion?.id ?? null });
      }
      if (req.method === "POST" && seg[2] === "postpone") {
        const { until } = await readBody(req);
        return json(req, await mutate(me, "postpone_task", { task_id: id, until }));
      }
      if (req.method === "POST" && seg[2] === "undo") {
        return json(req, await mutate(me, "undo_completion", { task_id: id }));
      }
    }

    throw new HttpError(404, "rotta sconosciuta");
  } catch (err) {
    if (err instanceof HttpError) return json(req, { error: err.message }, err.status);
    console.error(err);
    return json(req, { error: "errore interno" }, 500);
  }
});
