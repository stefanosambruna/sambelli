// API della Mini App Telegram. Ogni richiesta porta i dati utente firmati da Telegram
// (initData) in un header; li verifichiamo con il token del bot e da lì sappiamo chi è.
// Le mutazioni passano dagli stessi strumenti dell'agente (executeTool), quindi validazione,
// eventi e notifiche all'altra persona sono identici a quelli del bot.
//
//   GET   /agenda                      task attivi, membri, completamenti di oggi
//   GET   /inactive                    task completati e archiviati
//   GET   /tasks/:id/history           completamenti di un task, dal più recente
//   POST  /tasks                       crea (body = input di create_task)
//   PATCH /tasks/:id                   modifica (body = input di update_task senza task_id)
//   POST  /tasks/:id/complete          segna fatto oggi
//   POST  /tasks/:id/undo              ripristina: annulla l'ultimo completamento
//   POST  /tasks/:id/archive           archivia
//   POST  /tasks/:id/unarchive         riporta in agenda un archiviato

import { type AgentContext, executeTool } from "../_shared/agent.ts";
import { todayAtHome } from "../_shared/dates.ts";
import {
  getOrCreateMember,
  getTask,
  listActiveTasks,
  listHistory,
  listInactiveTasks,
  listMembers,
  type Member,
} from "../_shared/db.ts";
import { broadcast, isChatAllowed } from "../_shared/telegram.ts";
import { InitDataError, verifyInitData } from "../_shared/initdata.ts";
import { db } from "../_shared/db.ts";

const AVATAR_TTL_S = 6 * 3600;

/** URL firmati (bucket privato "avatars", file <telegram_user_id>.jpg). Manca il file = null. */
async function withAvatars<T extends Member>(members: T[]): Promise<(T & { avatar_url: string | null })[]> {
  return Promise.all(members.map(async (m) => {
    if (m.telegram_user_id === null) return { ...m, avatar_url: null };
    const { data } = await db().storage.from("avatars").createSignedUrl(`${m.telegram_user_id}.jpg`, AVATAR_TTL_S);
    return { ...m, avatar_url: data?.signedUrl ?? null };
  }));
}

const INIT_DATA_MAX_AGE_S = 24 * 3600;

/** In produzione SUPABASE_URL è *.supabase.co: la scorciatoia di sviluppo non deve esistere lì. */
function isHosted(): boolean {
  return (Deno.env.get("SUPABASE_URL") ?? "").includes(".supabase.co");
}

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

async function authenticate(req: Request): Promise<Member> {
  let telegramId: number;
  let name: string;

  const devId = Deno.env.get("APP_DEV_USER_ID");
  if (devId && !isHosted() && req.headers.get("x-dev-user-id") === devId) {
    console.warn("app-api: autenticazione di sviluppo (APP_DEV_USER_ID)");
    telegramId = Number(devId);
    name = "Dev";
  } else {
    const initData = req.headers.get("x-telegram-init-data");
    if (!initData) throw new HttpError(401, "Apri l'app da Telegram");
    const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!token) throw new HttpError(500, "TELEGRAM_BOT_TOKEN mancante");
    let user;
    try {
      user = await verifyInitData(initData, token, { maxAgeSeconds: INIT_DATA_MAX_AGE_S });
    } catch (err) {
      throw new HttpError(401, err instanceof InitDataError ? err.message : "initData non valida");
    }
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
  // Il contesto include anche i task fuori agenda: l'app agisce anche su quelli.
  const [members, active, inactive] = await Promise.all([listMembers(), listActiveTasks(), listInactiveTasks()]);
  const ctx: AgentContext = { today: todayAtHome(), sender: me, members, tasks: [...active, ...inactive], events: [] };
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
        listHistory({ since: today, limit: 100 }),
      ]);
      const withPics = await withAvatars(members);
      return json(req, {
        today,
        me: withPics.find((m) => m.id === me.id) ?? { ...me, avatar_url: null },
        members: withPics,
        tasks,
        history,
      });
    }

    if (req.method === "GET" && path === "/inactive") {
      const [tasks, members] = await Promise.all([listInactiveTasks(), listMembers()]);
      return json(req, { today: todayAtHome(), tasks, members: await withAvatars(members) });
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
        // L'agenda del client può essere vecchia di minuti: se l'altro l'ha già fatto oggi
        // non registriamo un doppione, diciamo solo com'è adesso.
        const fresh = await getTask(id);
        if (fresh && fresh.last_done_on === todayAtHome()) {
          return json(req, {
            ok: true,
            already: true,
            title: fresh.title,
            next_due: fresh.next_due,
            status: fresh.status,
          });
        }
        const result = await mutate(me, "complete_task", { task_id: id }) as Record<string, unknown>;
        return json(req, result);
      }
      if (req.method === "POST" && seg[2] === "undo") {
        return json(req, await mutate(me, "undo_completion", { task_id: id }));
      }
      if (req.method === "POST" && seg[2] === "archive") {
        return json(req, await mutate(me, "archive_task", { task_id: id }));
      }
      if (req.method === "POST" && seg[2] === "unarchive") {
        return json(req, await mutate(me, "unarchive_task", { task_id: id }));
      }
      if (req.method === "GET" && seg[2] === "history") {
        return json(req, { history: await listHistory({ taskId: id, limit: 50 }) });
      }
    }

    throw new HttpError(404, "rotta sconosciuta");
  } catch (err) {
    if (err instanceof HttpError) return json(req, { error: err.message }, err.status);
    console.error(err);
    return json(req, { error: "errore interno" }, 500);
  }
});
