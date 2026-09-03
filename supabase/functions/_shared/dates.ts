// Tutte le date del dominio sono stringhe ISO "YYYY-MM-DD" nel fuso di casa.
// Nessuna libreria: le operazioni che servono sono poche e si testano bene.

export const HOME_TZ = "Europe/Rome";

export type IsoDate = string; // "2026-09-03"

export type Bucket = "overdue" | "today" | "week" | "month" | "later";

const isoFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: HOME_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const hourFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: HOME_TZ,
  hour: "2-digit",
  hour12: false,
});

/** Data odierna nel fuso di casa. */
export function todayAtHome(now: Date = new Date()): IsoDate {
  return isoFormatter.format(now);
}

/** Ora locale (0-23) nel fuso di casa. */
export function hourAtHome(now: Date = new Date()): number {
  return Number(hourFormatter.format(now)) % 24;
}

export function isIsoDate(value: unknown): value is IsoDate {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function toUtc(iso: IsoDate): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function fromUtc(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  const d = toUtc(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtc(d);
}

/** b - a in giorni interi. */
export function diffDays(a: IsoDate, b: IsoDate): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86_400_000);
}

/** Domenica della settimana (lunedì-domenica) che contiene `iso`. */
export function endOfWeek(iso: IsoDate): IsoDate {
  const dow = toUtc(iso).getUTCDay(); // 0 = domenica
  const toSunday = dow === 0 ? 0 : 7 - dow;
  return addDays(iso, toSunday);
}

export function endOfMonth(iso: IsoDate): IsoDate {
  const d = toUtc(iso);
  d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return fromUtc(d);
}

/** In quale raggruppamento temporale cade una scadenza, visto da `today`. */
export function bucketFor(due: IsoDate, today: IsoDate): Bucket {
  if (due < today) return "overdue";
  if (due === today) return "today";
  if (due <= endOfWeek(today)) return "week";
  if (due <= endOfMonth(today)) return "month";
  return "later";
}

const WEEKDAYS = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];
const MONTHS = [
  "gen",
  "feb",
  "mar",
  "apr",
  "mag",
  "giu",
  "lug",
  "ago",
  "set",
  "ott",
  "nov",
  "dic",
];

/** "gio 3 set" oppure "gio 3 set 2027" se l'anno è diverso da quello di `today`. */
export function formatShort(iso: IsoDate, today?: IsoDate): string {
  const d = toUtc(iso);
  const base = `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  if (today && iso.slice(0, 4) !== today.slice(0, 4)) return `${base} ${d.getUTCFullYear()}`;
  return base;
}

/** "da 3 gg", "da 1 g", "tra 5 gg", "domani", "oggi". */
export function formatRelative(iso: IsoDate, today: IsoDate): string {
  const n = diffDays(today, iso);
  if (n === 0) return "oggi";
  if (n === 1) return "domani";
  if (n === -1) return "da ieri";
  if (n < 0) return `da ${-n} gg`;
  return `tra ${n} gg`;
}
