import { Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { Pending } from "../hooks/usePending.ts";
import { UNDO_MS } from "../hooks/usePending.ts";

export function UndoBar({ items, onUndo }: { items: Pending[]; onUndo: (key: string) => void }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!items.length) return;
    const id = window.setInterval(() => tick((n) => n + 1), 100);
    return () => clearInterval(id);
  }, [items.length]);
  if (!items.length) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex flex-col items-stretch gap-2 px-3 pb-[max(env(safe-area-inset-bottom),12px)]">
      {items.slice(-3).map((p) => {
        const left = Math.max(0, p.deadline - Date.now()) / UNDO_MS;
        const label = p.kind === "complete" ? "fatto" : "rimandato a domani";
        return (
          <button
            key={p.key}
            type="button"
            onClick={() => onUndo(p.key)}
            className="pointer-events-auto relative flex items-center justify-between overflow-hidden rounded-xl bg-[#1c1c1e] px-4 py-3 text-left text-white shadow-lg active:opacity-90"
          >
            <span className="min-w-0 truncate text-[15px]">
              <b>{p.task.title}</b> {label}
            </span>
            <span className="ml-3 flex shrink-0 items-center gap-1 text-[15px] font-semibold text-[#6ab0f3]">
              <Undo2 size={18} /> Annulla
            </span>
            <span className="absolute inset-x-0 bottom-0 h-0.5 bg-[#6ab0f3]" style={{ width: `${left * 100}%` }} />
          </button>
        );
      })}
    </div>
  );
}
