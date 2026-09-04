// Descrizione della ricorrenza, condivisa tra bot e Mini App: è testo che l'utente legge,
// e deve essere identico nei due posti. Nessun import: la usa anche il bundle del browser.

export type RecurrenceUnit = "day" | "week" | "month" | "year";
export type RecurrenceAnchor = "completion" | "schedule";

const UNIT_LABEL: Record<RecurrenceUnit, [string, string]> = {
  day: ["giorno", "giorni"],
  week: ["settimana", "settimane"],
  month: ["mese", "mesi"],
  year: ["anno", "anni"],
};

export function describeRecurrence(
  t: { every_n: number | null; unit: RecurrenceUnit | null; anchor: RecurrenceAnchor },
): string {
  if (!t.every_n || !t.unit) return "una tantum";
  const [one, many] = UNIT_LABEL[t.unit];
  const base = t.every_n === 1 ? `ogni ${one}` : `ogni ${t.every_n} ${many}`;
  return t.anchor === "completion" ? `${base} da quando lo fai` : `${base} a calendario`;
}
