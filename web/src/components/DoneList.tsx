import { Undo2 } from "lucide-react";
import type { Completion, Member } from "../types.ts";
import { Avatar } from "./Avatar.tsx";

export function DoneList({ items, members, onUndo, busyId }: {
  items: Completion[];
  members: Member[];
  onUndo: (c: Completion) => void;
  busyId: string | null;
}) {
  return (
    <>
      {items.map((c) => (
        <div key={c.id} className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <div className="text-[17px] leading-6 break-words line-through decoration-hint/60">{c.task_title}</div>
            <div className="flex items-center gap-1.5 text-[13px] text-hint">
              <Avatar member={members.find((m) => m.id === c.member_id)} />
              <span>{c.member_name ?? "?"}{c.note ? ` · ${c.note}` : ""}</span>
            </div>
          </div>
          {c.undoable && (
            <button
              type="button"
              disabled={busyId === c.id}
              onClick={() => onUndo(c)}
              className="-my-1.5 flex shrink-0 items-center gap-1 rounded-lg px-2 py-2.5 text-[15px] text-link active:bg-bg2 disabled:opacity-50"
            >
              <Undo2 size={16} /> Annulla
            </button>
          )}
        </div>
      ))}
    </>
  );
}
