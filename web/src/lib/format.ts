import type { Task } from "../types.ts";

const UNIT: Record<string, [string, string]> = {
  day: ["giorno", "giorni"],
  week: ["settimana", "settimane"],
  month: ["mese", "mesi"],
  year: ["anno", "anni"],
};

export function describeRecurrence(t: Pick<Task, "every_n" | "unit" | "anchor">): string {
  if (!t.every_n || !t.unit) return "una tantum";
  const [one, many] = UNIT[t.unit];
  const base = t.every_n === 1 ? `ogni ${one}` : `ogni ${t.every_n} ${many}`;
  return t.anchor === "completion" ? `${base} da quando lo fai` : `${base} a calendario`;
}
