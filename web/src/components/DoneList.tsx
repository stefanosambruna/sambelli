import { Undo2 } from "lucide-react";
import { formatShort } from "../../../supabase/functions/_shared/dates.ts";
import type { Completion } from "../types.ts";

export function DoneList({ items, today, showDate, onUndo, busyId }: {
  items: Completion[];
  today: string;
  showDate?: boolean;
  onUndo: (c: Completion) => void;
  busyId: string | null;
}) {
  return (
    <>
      {items.map((c) => (
        <div key={c.id} className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-[17px] leading-6 line-through decoration-hint/60">{c.task_title}</div>
            <div className="text-[13px] text-hint">
              {c.member_name ?? "?"}{showDate ? ` · ${formatShort(c.done_on, today)}` : ""}{c.note ? ` · ${c.note}` : ""}
            </div>
          </div>
          {c.undoable && (
            <button
              type="button"
              disabled={busyId === c.id}
              onClick={() => onUndo(c)}
              className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[15px] text-link active:bg-bg2 disabled:opacity-50"
            >
              <Undo2 size={16} /> Annulla
            </button>
          )}
        </div>
      ))}
    </>
  );
}
