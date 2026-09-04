import { Check, Pencil, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { addDays, formatRelative, formatShort } from "../../../supabase/functions/_shared/dates.ts";
import { describeRecurrence } from "../lib/format.ts";
import type { Member, RecurrenceAnchor, RecurrenceUnit, Task, TaskInput } from "../types.ts";

interface Props {
  task: Task | null; // null = nuovo
  members: Member[];
  today: string;
  busy: boolean;
  onSave: (input: TaskInput) => void;
  onComplete: (task: Task) => void;
  onPostpone: (task: Task, until: string) => void;
  onArchive: (task: Task) => void;
  onClose: () => void;
}

const UNITS: [RecurrenceUnit, string][] = [["day", "giorni"], ["week", "settimane"], ["month", "mesi"], ["year", "anni"]];

/** Pannello dal basso: dettaglio in sola lettura di un task, oppure form (nuovo / modifica). */
export function TaskSheet(props: Props) {
  const { task, onClose } = props;
  const [editing, setEditing] = useState(task === null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92dvh] w-full max-w-full overflow-x-hidden overflow-y-auto rounded-t-3xl bg-bg px-4 pb-[max(env(safe-area-inset-bottom),16px)] pt-3"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-hint/40" />
        {task && !editing ? <Detail {...props} task={task} onEdit={() => setEditing(true)} /> : <Form {...props} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Detail({ task, today, busy, onComplete, onPostpone, onEdit, onClose }: Props & { task: Task; onEdit: () => void }) {
  const [postponeTo, setPostponeTo] = useState(task.postponed_until ?? addDays(today, 1));
  const overdue = task.next_due < today;

  const row = (label: string, value: React.ReactNode) => (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <span className="shrink-0 text-[14px] text-hint">{label}</span>
      <span className="min-w-0 text-right text-[15px] break-words">{value}</span>
    </div>
  );

  return (
    <>
      <div className="mb-3 flex items-start justify-between gap-3">
        <h2 className="min-w-0 text-[22px] font-semibold leading-7 break-words">{task.title}</h2>
        <button type="button" onClick={onClose} className="shrink-0 rounded-full p-1 text-hint active:bg-bg2" aria-label="Chiudi">
          <X size={22} />
        </button>
      </div>

      {task.notes && (
        <p className="mb-4 rounded-xl bg-bg2 px-3 py-2.5 text-[15px] leading-6 whitespace-pre-wrap break-words">{task.notes}</p>
      )}

      <div className="divide-y divide-bg2 rounded-xl bg-card px-3">
        {row(
          "Scadenza",
          <span className={overdue ? "font-semibold text-danger" : ""}>
            {formatShort(task.next_due, today)} · {formatRelative(task.next_due, today)}
            {task.postponed_until && <span className="block text-[13px] font-normal text-hint">rinviato, era {formatShort(task.scheduled_due, today)}</span>}
          </span>,
        )}
        {row("Ricorrenza", describeRecurrence(task))}
        {row("Assegnato a", task.assigned_to_name ?? "chi se lo prende")}
        {row(
          "Ultima volta",
          task.last_done_on ? `${formatShort(task.last_done_on, today)}${task.last_done_by ? ` · ${task.last_done_by}` : ""}` : "mai",
        )}
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => onComplete(task)}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-done py-3 text-[17px] font-semibold text-white disabled:opacity-60"
        >
          <Check size={20} /> Fatto
        </button>
        <button type="button" onClick={onEdit} className="flex items-center justify-center gap-2 rounded-xl bg-bg2 px-4 py-3 text-[17px] font-medium">
          <Pencil size={18} /> Modifica
        </button>
      </div>

      <div className="mt-5 border-t border-bg2 pt-4">
        <label className="mb-1 block text-[13px] text-hint">Rimanda solo questa volta a</label>
        <div className="flex min-w-0 gap-2">
          <input
            type="date"
            className="block min-w-0 flex-1 appearance-none rounded-xl bg-bg2 px-3 py-2.5 outline-none focus:ring-2 focus:ring-accent"
            value={postponeTo}
            min={today}
            onChange={(e) => setPostponeTo(e.target.value)}
          />
          <button type="button" disabled={busy} onClick={() => onPostpone(task, postponeTo)} className="shrink-0 rounded-xl bg-bg2 px-4 py-2.5 font-medium text-link">
            Rimanda
          </button>
        </div>
        <p className="mt-1 text-[12px] text-hint">Non tocca la ricorrenza: al prossimo completamento si riparte dalla data originale.</p>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

function Form({ task, members, today, busy, onSave, onArchive, onClose }: Props) {
  const [title, setTitle] = useState(task?.title ?? "");
  const [notes, setNotes] = useState(task?.notes ?? "");
  const [recurring, setRecurring] = useState(!!task?.every_n);
  const [everyN, setEveryN] = useState(task?.every_n ?? 1);
  const [unit, setUnit] = useState<RecurrenceUnit>(task?.unit ?? "week");
  const [anchor, setAnchor] = useState<RecurrenceAnchor>(task?.anchor ?? "completion");
  const [due, setDue] = useState(task?.scheduled_due ?? today);
  const [assignee, setAssignee] = useState(task?.assigned_to_name ?? "");
  const notesRef = useRef<HTMLTextAreaElement>(null);

  // La textarea cresce con il contenuto: niente scroll interno su un telefono.
  useEffect(() => {
    const el = notesRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.max(el.scrollHeight, 88)}px`;
  }, [notes]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    const input: TaskInput = {};
    if (!task || t !== task.title) input.title = t;
    if ((task?.notes ?? "") !== notes.trim()) input.notes = notes.trim();
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
    <form onSubmit={submit}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[20px] font-semibold">{task ? "Modifica" : "Nuovo task"}</h2>
        <button type="button" onClick={onClose} className="rounded-full p-1 text-hint active:bg-bg2" aria-label="Chiudi">
          <X size={22} />
        </button>
      </div>

      <label className={label}>Cosa</label>
      <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Lenzuola" autoFocus={!task} required />
      <p className="mt-1 text-[12px] text-hint">Corto, è un gancio: i dettagli vanno nelle note.</p>

      <label className={`${label} mt-3`}>Note</label>
      <textarea
        ref={notesRef}
        className={`${field} resize-none leading-6`}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Dove, come, quantità, a cosa stare attenti…"
        rows={3}
      />

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
      {task && <p className="mt-1 text-[12px] text-hint">Cambiarla sposta la ricorrenza da ora in poi. Per un rinvio singolo usa "Rimanda" nel dettaglio.</p>}

      <label className={`${label} mt-3`}>Assegnato a</label>
      <select className={field} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
        <option value="">Chi se lo prende</option>
        {members.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
      </select>

      <button type="submit" disabled={busy} className="mt-5 w-full rounded-xl bg-accent py-3 text-[17px] font-semibold text-accent-fg disabled:opacity-60">
        {task ? "Salva" : "Aggiungi"}
      </button>

      {task && (
        <button type="button" disabled={busy} onClick={() => onArchive(task)} className="mt-3 w-full rounded-xl py-3 text-[15px] text-danger active:bg-bg2">
          Archivia task
        </button>
      )}
    </form>
  );
}
