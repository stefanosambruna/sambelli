import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { addDays } from "../../../supabase/functions/_shared/dates.ts";
import type { Member, RecurrenceAnchor, RecurrenceUnit, Task, TaskInput } from "../types.ts";

interface Props {
  task: Task | null; // null = nuovo
  members: Member[];
  today: string;
  busy: boolean;
  onSave: (input: TaskInput) => void;
  onPostpone: (task: Task, until: string) => void;
  onArchive: (task: Task) => void;
  onClose: () => void;
}

const UNITS: [RecurrenceUnit, string][] = [["day", "giorni"], ["week", "settimane"], ["month", "mesi"], ["year", "anni"]];

/** Pannello dal basso per creare o modificare un task. */
export function TaskSheet({ task, members, today, busy, onSave, onPostpone, onArchive, onClose }: Props) {
  const [title, setTitle] = useState(task?.title ?? "");
  const [notes, setNotes] = useState(task?.notes ?? "");
  const [recurring, setRecurring] = useState(!!task?.every_n);
  const [everyN, setEveryN] = useState(task?.every_n ?? 1);
  const [unit, setUnit] = useState<RecurrenceUnit>(task?.unit ?? "week");
  const [anchor, setAnchor] = useState<RecurrenceAnchor>(task?.anchor ?? "completion");
  const [due, setDue] = useState(task?.scheduled_due ?? today);
  const [assignee, setAssignee] = useState(task?.assigned_to_name ?? "");
  const [postponeTo, setPostponeTo] = useState(task?.postponed_until ?? addDays(today, 1));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    const input: TaskInput = {};
    if (!task || t !== task.title) input.title = t;
    if ((task?.notes ?? "") !== notes) input.notes = notes;
    if (recurring) {
      if (!task || task.every_n !== everyN || task.unit !== unit) {
        input.every_n = everyN;
        input.unit = unit;
      }
      if (!task || task.anchor !== anchor) input.anchor = anchor;
    } else if (task?.every_n) {
      input.clear_recurrence = true;
    }
    if (!task) input.first_due = due;
    else if (due !== task.scheduled_due) input.next_due = due;
    if ((task?.assigned_to_name ?? "") !== assignee) input.assigned_to = assignee;
    if (task && Object.keys(input).length === 0) return onClose();
    onSave(input);
  };

  const field = "block w-full min-w-0 max-w-full appearance-none rounded-xl bg-bg2 px-3 py-2.5 outline-none focus:ring-2 focus:ring-accent";
  const label = "mb-1 block text-[13px] text-hint";

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92dvh] w-full max-w-full overflow-x-hidden overflow-y-auto rounded-t-3xl bg-bg px-4 pb-[max(env(safe-area-inset-bottom),16px)] pt-3"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-hint/40" />
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[20px] font-semibold">{task ? "Modifica" : "Nuovo task"}</h2>
          <button type="button" onClick={onClose} className="rounded-full p-1 text-hint active:bg-bg2" aria-label="Chiudi">
            <X size={22} />
          </button>
        </div>

        <label className={label}>Cosa</label>
        <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Lavare lenzuola" autoFocus={!task} required />

        <label className={`${label} mt-3`}>Note</label>
        <input className={field} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="facoltative" />

        <div className="mt-4 flex items-center justify-between">
          <span className="text-[15px]">Ricorrente</span>
          <button
            type="button"
            role="switch"
            aria-checked={recurring}
            onClick={() => setRecurring(!recurring)}
            className={`h-7 w-12 rounded-full p-0.5 transition-colors ${recurring ? "bg-accent" : "bg-hint/40"}`}
          >
            <span className={`block h-6 w-6 rounded-full bg-white shadow transition-transform ${recurring ? "translate-x-5" : ""}`} />
          </button>
        </div>

        {recurring && (
          <div className="mt-3 rounded-xl bg-bg2 p-3">
            <div className="flex items-center gap-2">
              <span className="text-[15px]">ogni</span>
              <input
                type="number"
                min={1}
                inputMode="numeric"
                className="w-16 min-w-0 appearance-none rounded-lg bg-bg px-2 py-1.5 text-center"
                value={everyN}
                onChange={(e) => setEveryN(Math.max(1, Number(e.target.value) || 1))}
              />
              <select className="min-w-0 flex-1 appearance-none rounded-lg bg-bg px-2 py-1.5" value={unit} onChange={(e) => setUnit(e.target.value as RecurrenceUnit)}>
                {UNITS.map(([u, l]) => <option key={u} value={u}>{l}</option>)}
              </select>
            </div>
            <div className="mt-2 flex gap-2">
              {([["completion", "da quando lo fai"], ["schedule", "a calendario"]] as [RecurrenceAnchor, string][]).map(([a, l]) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAnchor(a)}
                  className={`flex-1 rounded-lg px-2 py-1.5 text-[14px] ${anchor === a ? "bg-accent text-accent-fg" : "bg-bg"}`}
                >
                  {l}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[12px] text-hint">
              {anchor === "completion"
                ? "La prossima scadenza parte dal giorno in cui lo completi (sale, lenzuola, piante)."
                : "La prossima scadenza avanza a date fisse, anche se lo fai prima o dopo (il primo del mese)."}
            </p>
          </div>
        )}

        <label className={`${label} mt-3`}>{task ? "Data base della scadenza" : "Prima scadenza"}</label>
        <input type="date" className={field} value={due} onChange={(e) => setDue(e.target.value)} required />
        {task && <p className="mt-1 text-[12px] text-hint">Cambiarla sposta la ricorrenza da ora in poi. Per rinviare una volta sola usa "Rimanda" qui sotto.</p>}

        <label className={`${label} mt-3`}>Assegnato a</label>
        <select className={field} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">Chi se lo prende</option>
          {members.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
        </select>

        <button type="submit" disabled={busy} className="mt-5 w-full rounded-xl bg-accent py-3 text-[17px] font-semibold text-accent-fg disabled:opacity-60">
          {task ? "Salva" : "Aggiungi"}
        </button>

        {task && (
          <div className="mt-6 border-t border-bg2 pt-4">
            <label className={label}>Rimanda solo questa volta a</label>
            <div className="flex min-w-0 gap-2">
              <input type="date" className={`${field} flex-1`} value={postponeTo} min={today} onChange={(e) => setPostponeTo(e.target.value)} />
              <button type="button" disabled={busy} onClick={() => onPostpone(task, postponeTo)} className="shrink-0 rounded-xl bg-bg2 px-4 py-2.5 font-medium text-link">
                Rimanda
              </button>
            </div>
            <button type="button" disabled={busy} onClick={() => onArchive(task)} className="mt-4 w-full rounded-xl py-3 text-[15px] text-danger active:bg-bg2">
              Archivia task
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
