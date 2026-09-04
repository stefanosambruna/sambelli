import { ChevronLeft, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { formatShort } from "../../../supabase/functions/_shared/dates.ts";
import { describeRecurrence } from "../lib/format.ts";
import type { Member, Task, TaskStatus } from "../types.ts";
import { Avatar } from "./Avatar.tsx";

/** Vista a schermo intero per i task fuori agenda: completati oppure archiviati. */
export function InactiveView({ status, tasks, members, today, loading, onOpen, onBack }: {
  status: Exclude<TaskStatus, "active">;
  tasks: Task[];
  members: Member[];
  today: string;
  loading: boolean;
  onOpen: (t: Task) => void;
  onBack: () => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const title = status === "done" ? "Completati" : "Archiviati";
  const emptyText = status === "done" ? "Nessun task completato." : "Nessun task archiviato.";

  const items = useMemo(
    () => tasks.filter((t) => t.status === status && (!q || t.title.toLowerCase().includes(q))),
    [tasks, status, q],
  );

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-bg2">
      <header className="sticky top-0 z-10 bg-bg2/95 px-4 pt-[max(env(safe-area-inset-top),12px)] pb-2 backdrop-blur">
        <div className="flex items-center gap-1">
          <button type="button" onClick={onBack} className="-ml-2 rounded-full p-2 text-link active:bg-bg" aria-label="Indietro">
            <ChevronLeft size={24} />
          </button>
          <h1 className="text-[22px] font-bold tracking-tight">{title}</h1>
        </div>
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

      <main className="px-3 pb-[max(env(safe-area-inset-bottom),24px)] pt-3">
        {loading && <p className="px-1 text-hint">Carico…</p>}
        {!loading && items.length === 0 && (
          <p className="py-8 text-center text-hint">{q ? "Nessun task con questo nome." : emptyText}</p>
        )}
        <div className="overflow-hidden rounded-2xl bg-card divide-y divide-bg2">
          {items.map((t) => (
            <button key={t.id} type="button" onClick={() => onOpen(t)} className="block w-full px-4 py-3 text-left active:bg-bg2">
              <div className="break-words text-[17px] leading-6 text-hint">{t.title}</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[13px] text-hint">
                {t.last_done_on
                  ? (
                    <>
                      <Avatar member={members.find((m) => m.name === t.last_done_by)} />
                      <span>fatto {formatShort(t.last_done_on, today)}</span>
                    </>
                  )
                  : <span>{describeRecurrence(t)}</span>}
              </div>
            </button>
          ))}
        </div>
      </main>
    </div>
  );
}
