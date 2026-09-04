import { Archive, Check, Pencil, RotateCcw, Undo2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatRelative, formatShort } from "../../../supabase/functions/_shared/dates.ts";
import { describeRecurrence } from "../lib/format.ts";
import type { Completion, Member, RecurrenceAnchor, RecurrenceUnit, Task, TaskInput } from "../types.ts";
import { Avatar } from "./Avatar.tsx";

interface Props {
  task: Task | null; // null = nuovo
  members: Member[];
  today: string;
  busy: boolean;
  history: Completion[] | undefined; // undefined = ancora in caricamento
  onSave: (input: TaskInput) => void;
  onComplete: (task: Task) => void;
  onArchive: (task: Task) => void;
  onUnarchive: (task: Task) => void;
  onUndo: (completion: Completion) => void;
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
        {task && !editing
          ? <Detail {...props} task={task} onEdit={() => setEditing(true)} />
          : <Form {...props} onCancel={task ? () => setEditing(false) : onClose} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

const STATUS_LABEL = {
  done: { text: "Completato", className: "bg-done/15 text-done" },
  archived: { text: "Archiviato", className: "bg-hint/20 text-hint" },
} as const;

function Detail(
  { task, members, today, busy, history, onComplete, onArchive, onUnarchive, onUndo, onEdit, onClose }:
    & Props
    & { task: Task; onEdit: () => void },
) {
  const byName = (name: string | null) => (name ? members.find((m) => m.name === name) : undefined);
  const who = (name: string | null) => (
    <span className="inline-flex items-center gap-1.5">
      <Avatar member={byName(name)} size="md" />
      {name}
    </span>
  );
  const overdue = task.status === "active" && task.next_due < today;
  const badge = task.status !== "active" ? STATUS_LABEL[task.status] : null;

  const row = (label: string, value: React.ReactNode) => (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <span className="shrink-0 text-[14px] text-hint">{label}</span>
      <span className="min-w-0 break-words text-right text-[15px]">{value}</span>
    </div>
  );

  return (
    <>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          {badge && (
            <span className={`mb-1.5 inline-block rounded-md px-2 py-0.5 text-[12px] font-medium ${badge.className}`}>{badge.text}</span>
          )}
          <h2 className="min-w-0 break-words text-[22px] font-semibold leading-7">{task.title}</h2>
        </div>
        <button type="button" onClick={onClose} className="shrink-0 rounded-full p-1 text-hint active:bg-bg2" aria-label="Chiudi">
          <X size={22} />
        </button>
      </div>

      {task.notes && (
        <p className="mb-4 whitespace-pre-wrap break-words rounded-xl bg-bg2 px-3 py-2.5 text-[15px] leading-6">{task.notes}</p>
      )}

      <div className="divide-y divide-bg2 rounded-xl bg-card px-3">
        {task.status === "active" &&
          row(
            "Scadenza",
            <span className={overdue ? "font-semibold text-danger" : ""}>
              {formatShort(task.next_due, today)} · {formatRelative(task.next_due, today)}
            </span>,
          )}
        {row("Ricorrenza", describeRecurrence(task))}
        {row("Assegnato a", task.assigned_to_name ? who(task.assigned_to_name) : "chi se lo prende")}
      </div>

      {task.status === "active"
        ? (
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
        )
        : task.status === "archived"
        ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onUnarchive(task)}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3 text-[17px] font-semibold text-accent-fg disabled:opacity-60"
          >
            <RotateCcw size={20} /> Riattiva
          </button>
        )
        : (
          <button
            type="button"
            disabled={busy || !history?.[0]?.undoable}
            onClick={() => history?.[0] && onUndo(history[0])}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3 text-[17px] font-semibold text-accent-fg disabled:opacity-60"
          >
            <Undo2 size={20} /> Ripristina
          </button>
        )}

      {task.status === "active" && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onArchive(task)}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[15px] text-hint active:bg-bg2"
        >
          <Archive size={16} /> Archivia
        </button>
      )}

      <div className="mt-6">
        <h3 className="mb-1.5 text-[13px] font-semibold uppercase tracking-wide text-hint">Storico</h3>
        {history === undefined
          ? <p className="py-2 text-[15px] text-hint">Carico…</p>
          : history.length === 0
          ? <p className="py-2 text-[15px] text-hint">Mai completato.</p>
          : (
            <div className="divide-y divide-bg2 rounded-xl bg-card px-3">
              {history.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="flex min-w-0 items-center gap-2 text-[15px]">
                    <Avatar member={members.find((m) => m.id === c.member_id)} />
                    <span className="truncate">
                      {formatShort(c.done_on, today)}
                      {c.member_name ? ` · ${c.member_name}` : ""}
                    </span>
                  </span>
                  {c.undoable && task.status === "active" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onUndo(c)}
                      className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[14px] text-link active:bg-bg2 disabled:opacity-50"
                    >
                      <Undo2 size={15} /> Annulla
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

function Form({ task, members, today, busy, onSave, onCancel }: Props & { onCancel: () => void }) {
  const [title, setTitle] = useState(task?.title ?? "");
  const [notes, setNotes] = useState(task?.notes ?? "");
  // Il tipo (una tantum / ricorrente) si sceglie alla creazione e non cambia più.
  const [recurring, setRecurring] = useState(!!task?.every_n);
  const [everyN, setEveryN] = useState(task?.every_n ?? 1);
  const [unit, setUnit] = useState<RecurrenceUnit>(task?.unit ?? "week");
  const [anchor, setAnchor] = useState<RecurrenceAnchor>(task?.anchor ?? "completion");
  const [due, setDue] = useState(task?.next_due ?? today);
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
    }
    if (!task) input.first_due = due;
    else if (due !== task.next_due) input.next_due = due;
    if ((task?.assigned_to_name ?? "") !== assignee) input.assigned_to = assignee;
    if (task && Object.keys(input).length === 0) return onCancel();
    onSave(input);
  };

  const field = "block w-full min-w-0 max-w-full appearance-none rounded-xl bg-bg2 px-3 py-2.5 outline-none focus:ring-2 focus:ring-accent";
  const label = "mb-1 block text-[13px] text-hint";

  return (
    <form onSubmit={submit}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[20px] font-semibold">{task ? "Modifica" : "Nuovo task"}</h2>
        <button type="button" onClick={onCancel} className="rounded-full p-1 text-hint active:bg-bg2" aria-label={task ? "Annulla modifica" : "Chiudi"}>
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

      {task
        ? recurring && (
          <div className="mt-4 rounded-xl bg-bg2 p-3">
            <Recurrence everyN={everyN} setEveryN={setEveryN} unit={unit} setUnit={setUnit} anchor={anchor} setAnchor={setAnchor} />
          </div>
        )
        : (
          <>
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
                <Recurrence everyN={everyN} setEveryN={setEveryN} unit={unit} setUnit={setUnit} anchor={anchor} setAnchor={setAnchor} />
              </div>
            )}
            <p className="mt-2 text-[12px] text-hint">
              Il tipo non si cambia più dopo: per trasformare un task si archivia e se ne crea uno nuovo.
            </p>
          </>
        )}

      <label className={`${label} mt-3`}>{task ? "Scadenza" : "Prima scadenza"}</label>
      <input type="date" className={field} value={due} onChange={(e) => setDue(e.target.value)} required />

      <label className={`${label} mt-3`}>Assegnato a</label>
      <select className={field} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
        <option value="">Chi se lo prende</option>
        {members.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
      </select>

      <button type="submit" disabled={busy} className="mt-5 w-full rounded-xl bg-accent py-3 text-[17px] font-semibold text-accent-fg disabled:opacity-60">
        {task ? "Salva" : "Aggiungi"}
      </button>
    </form>
  );
}

function Recurrence({ everyN, setEveryN, unit, setUnit, anchor, setAnchor }: {
  everyN: number;
  setEveryN: (n: number) => void;
  unit: RecurrenceUnit;
  setUnit: (u: RecurrenceUnit) => void;
  anchor: RecurrenceAnchor;
  setAnchor: (a: RecurrenceAnchor) => void;
}) {
  return (
    <>
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
    </>
  );
}
