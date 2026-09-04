// Verifica dei dati utente firmati da Telegram per le Mini App.
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
// Modulo puro (nessun Deno.serve, nessuna env): così è testabile.

export interface TelegramWebAppUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}

export class InitDataError extends Error {}

async function hmacSha256(key: BufferSource, message: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, new TextEncoder().encode(message));
}

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Stringa da firmare: tutte le coppie tranne `hash`, ordinate per chiave. */
export function dataCheckString(params: URLSearchParams): string {
  return [...params.entries()]
    .filter(([k]) => k !== "hash")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

/** Firma di un initData, usata dalla verifica e dai test. */
export async function signInitData(initData: string, botToken: string): Promise<string> {
  const secret = await hmacSha256(new TextEncoder().encode("WebAppData"), botToken);
  return hex(await hmacSha256(secret, dataCheckString(new URLSearchParams(initData))));
}

export async function verifyInitData(
  initData: string,
  botToken: string,
  opts: { maxAgeSeconds?: number; now?: Date } = {},
): Promise<TelegramWebAppUser> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw new InitDataError("initData senza hash");
  if (!timingSafeEqual(await signInitData(initData, botToken), hash)) {
    throw new InitDataError("initData non valida");
  }

  const maxAge = opts.maxAgeSeconds ?? 24 * 3600;
  const authDate = Number(params.get("auth_date") ?? 0);
  const nowS = (opts.now ?? new Date()).getTime() / 1000;
  if (!Number.isFinite(authDate) || authDate <= 0 || nowS - authDate > maxAge) {
    throw new InitDataError("initData scaduta: riapri l'app");
  }

  const raw = params.get("user");
  if (!raw) throw new InitDataError("initData senza utente");
  let user: unknown;
  try {
    user = JSON.parse(raw);
  } catch {
    throw new InitDataError("initData con utente illeggibile");
  }
  const u = user as Partial<TelegramWebAppUser>;
  if (typeof u?.id !== "number" || !Number.isFinite(u.id)) throw new InitDataError("initData senza id utente");
  return u as TelegramWebAppUser;
}
