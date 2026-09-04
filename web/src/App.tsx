import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { type Bucket, bucketFor, formatShort } from "../../supabase/functions/_shared/dates.ts";
import { api, ApiError } from "./api.ts";
import { Avatar } from "./components/Avatar.tsx";
import { DoneList } from "./components/DoneList.tsx";
import { Section } from "./components/Section.tsx";
import { TaskRow } from "./components/TaskRow.tsx";
import { TaskSheet } from "./components/TaskSheet.tsx";
import { UndoBar } from "./components/UndoBar.tsx";
import { usePending } from "./hooks/usePending.ts";
import { haptic } from "./telegram.ts";
import type { Completion, Task, TaskInput } from "./types.ts";

const BUCKETS: [Bucket, string][] = [
  ["overdue", "In ritardo"],
  ["today", "Oggi"],
  ["week", "Questa settimana"],
  ["month", "Questo mese"],
  ["later", "Più avanti"],
];

export function App() {
  const qc = useQueryClient();
  const agenda = useQuery({ queryKey: ["agenda"], queryFn: api.agenda });
  const pending = usePending();
  const [query, setQuery] = useState("");
  const [sheet, setSheet] = useState<{ open: boolean; task: Task | null }>({ open: false, task: null });
  const [undoBusy, setUndoBusy] = useState<string | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["agenda"] });
  const fail = (err: unknown) => {
    haptic.warning();
    alert(err instanceof ApiError ? err.message : "Qualcosa è andato storto");
  };

  const save = useMutation({
    mutationFn: async ({ id, input }: { id: string | null; input: TaskInput }) => {
      if (id) await api.update(id, input);
      else await api.create(input);
    },
    onSuccess: () => {
      setSheet({ open: false, task: null });
      invalidate();
    },
    onError: fail,
  });
  const archive = useMutation({
    mutationFn: (id: string) => api.update(id, { active: false }),
    onSuccess: () => {
      setSheet({ open: false, task: null });
      invalidate();
    },
    onError: fail,
  });

  const undoDone = async (c: Completion) => {
    setUndoBusy(c.id);
    try {
      await api.undo(c.task_id);
      haptic.success();
      invalidate();
    } catch (err) {
      fail(err);
    } finally {
      setUndoBusy(null);
    }
  };

  const data = agenda.data;
  const today = data?.today ?? "";
  const q = query.trim().toLowerCase();

  const grouped = useMemo(() => {
    const out = new Map<Bucket, Task[]>();
    for (const t of data?.tasks ?? []) {
      if (pending.pendingTaskIds.has(t.id)) continue;
      if (q && !t.title.toLowerCase().includes(q)) continue;
      const b = bucketFor(t.next_due, today);
      if (!out.has(b)) out.set(b, []);
      out.get(b)!.push(t);
    }
    return out;
  }, [data, today, q, pending.pendingTaskIds]);

  const doneToday = (data?.history ?? []).filter((c) => c.done_on === today && (!q || c.task_title.toLowerCase().includes(q)));
  const visibleCount = [...grouped.values()].reduce((n, xs) => n + xs.length, 0);

  return (
    <div className="min-h-dvh pb-32">
      <header className="sticky top-0 z-30 bg-bg2/95 px-4 pt-[max(env(safe-area-inset-top),12px)] pb-2 backdrop-blur">
        <div className="flex items-baseline justify-between">
          <h1 className="flex items-center gap-2.5 text-[26px] font-bold tracking-tight">
            {data && <Avatar member={data.me} size="lg" />}
            {data ? `Ciao ${data.me.name}` : "Sambelli"}
          </h1>
          <button
            type="button"
            onClick={() => agenda.refetch()}
            className="rounded-full p-2 text-hint active:bg-bg"
            aria-label="Aggiorna"
          >
            <RefreshCw size={18} className={agenda.isFetching ? "animate-spin" : ""} />
          </button>
        </div>
        {today && <div className="text-[13px] text-hint">{formatShort(today)} · scorri a destra per segnare fatto</div>}
        <div className="relative mt-2">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-hint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cerca"
            className="w-full rounded-xl bg-bg py-2 pl-9 pr-9 outline-none placeholder:text-hint"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-hint" aria-label="Pulisci">
              <X size={16} />
            </button>
          )}
        </div>
      </header>

      <main className="pt-3">
        {agenda.isLoading && <p className="px-4 text-hint">Carico…</p>}
        {agenda.isError && (
          <div className="mx-3 rounded-2xl bg-card p-4">
            <p className="font-medium text-danger">Non riesco a caricare l'agenda.</p>
            <p className="mt-1 text-[14px] text-hint">{(agenda.error as Error).message}</p>
          </div>
        )}

        {data && q && visibleCount === 0 && doneToday.length === 0 && (
          <p className="px-4 py-8 text-center text-hint">Nessun task con questo nome.</p>
        )}

        {doneToday.length > 0 && (
          <Section title="Fatti oggi" count={doneToday.length}>
            <DoneList items={doneToday} members={data?.members ?? []} today={today} onUndo={undoDone} busyId={undoBusy} />
          </Section>
        )}

        {/* "Oggi" c'è sempre: vuota vuol dire che oggi non c'è niente da fare, e va detto. */}
        {data && !q && !grouped.get("overdue")?.length && !grouped.get("today")?.length && (
          <Section title="Oggi">
            <div className="px-4 py-5 text-center text-hint">
              Niente da fare oggi 🎉
              {doneToday.length > 0 && <div className="mt-1 text-[13px]">Già fatte {doneToday.length} cose, vedi sopra.</div>}
            </div>
          </Section>
        )}

        {BUCKETS.map(([b, label]) => {
          const items = grouped.get(b);
          if (!items?.length) return null;
          return (
            <Section key={b} title={label} count={items.length}>
              {items.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  members={data?.members ?? []}
                  today={today}
                  overdue={b === "overdue"}
                  onComplete={(task) => pending.add(task)}
                  onOpen={(task) => setSheet({ open: true, task })}
                />
              ))}
            </Section>
          );
        })}

      </main>

      <button
        type="button"
        onClick={() => setSheet({ open: true, task: null })}
        className="fixed bottom-[max(env(safe-area-inset-bottom),16px)] right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-fg shadow-lg active:scale-95"
        aria-label="Nuovo task"
      >
        <Plus size={26} />
      </button>

      <UndoBar items={pending.items} onUndo={pending.undo} />

      {sheet.open && data && (
        <TaskSheet
          key={sheet.task?.id ?? "new"}
          task={sheet.task}
          members={data.members}
          today={today}
          busy={save.isPending || archive.isPending}
          onSave={(input) => save.mutate({ id: sheet.task?.id ?? null, input })}
          onComplete={(task) => {
            setSheet({ open: false, task: null });
            pending.add(task);
          }}
          onArchive={(task) => confirm(`Archiviare "${task.title}"?`) && archive.mutate(task.id)}
          onClose={() => setSheet({ open: false, task: null })}
        />
      )}
    </div>
  );
}
