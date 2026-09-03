import { Check, Clock } from "lucide-react";
import { useRef, useState } from "react";
import { formatRelative, formatShort } from "../../../supabase/functions/_shared/dates.ts";
import { describeRecurrence } from "../lib/format.ts";
import type { Task } from "../types.ts";

const THRESHOLD = 88; // px di trascinamento per far scattare l'azione

interface Props {
  task: Task;
  today: string;
  overdue: boolean;
  onComplete: (t: Task) => void;
  onPostpone: (t: Task) => void;
  onOpen: (t: Task) => void;
}

/** Riga con swipe: destra = fatto, sinistra = domani. Tap = apri. */
export function TaskRow({ task, today, overdue, onComplete, onPostpone, onOpen }: Props) {
  const [dx, setDx] = useState(0);
  const [animating, setAnimating] = useState(false);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const axis = useRef<"h" | "v" | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    axis.current = null;
    setAnimating(false);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!start.current) return;
    const mx = e.clientX - start.current.x;
    const my = e.clientY - start.current.y;
    if (!axis.current) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      axis.current = Math.abs(mx) > Math.abs(my) ? "h" : "v";
      if (axis.current === "h") (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    if (axis.current !== "h") return;
    // resistenza oltre la soglia
    const limited = Math.sign(mx) * Math.min(Math.abs(mx), THRESHOLD + (Math.abs(mx) - THRESHOLD) * 0.25);
    setDx(limited);
  };

  const finish = (e: React.PointerEvent) => {
    if (!start.current) return;
    const wasSwipe = axis.current === "h";
    const mx = e.clientX - start.current.x;
    start.current = null;
    axis.current = null;
    setAnimating(true);
    if (wasSwipe && Math.abs(mx) >= THRESHOLD) {
      setDx(Math.sign(mx) * window.innerWidth);
      window.setTimeout(() => {
        setDx(0);
        if (mx > 0) onComplete(task);
        else onPostpone(task);
      }, 180);
      return;
    }
    setDx(0);
    if (!wasSwipe && Math.abs(mx) < 8) onOpen(task);
  };

  const progress = Math.min(Math.abs(dx) / THRESHOLD, 1);
  const armed = progress >= 1;

  return (
    <div className="relative overflow-hidden bg-card select-none touch-pan-y">
      {/* sfondo azione */}
      <div
        className={`absolute inset-0 flex items-center justify-between px-5 text-white transition-colors ${
          dx > 0 ? "bg-done" : dx < 0 ? "bg-snooze" : "bg-transparent"
        }`}
        style={{ opacity: 0.35 + progress * 0.65 }}
      >
        <span className={`flex items-center gap-2 font-medium ${dx > 0 ? "" : "invisible"} ${armed ? "scale-110" : ""}`}>
          <Check size={22} /> Fatto
        </span>
        <span className={`flex items-center gap-2 font-medium ${dx < 0 ? "" : "invisible"} ${armed ? "scale-110" : ""}`}>
          Domani <Clock size={22} />
        </span>
      </div>

      <div
        className="relative bg-card px-4 py-3"
        style={{ transform: `translateX(${dx}px)`, transition: animating ? "transform 180ms ease-out" : "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
      >
        <div className="flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-[17px] leading-6">{task.title}</div>
            <div className="mt-0.5 truncate text-[13px] text-hint">
              {describeRecurrence(task)}
              {task.last_done_on && <> · ultima {formatShort(task.last_done_on, today)}{task.last_done_by ? ` (${task.last_done_by})` : ""}</>}
              {task.assigned_to_name && <> · → {task.assigned_to_name}</>}
            </div>
          </div>
          <div className={`shrink-0 text-[13px] ${overdue ? "font-semibold text-danger" : "text-hint"}`}>
            {task.postponed_until ? "⏭ " : ""}
            {formatRelative(task.next_due, today)}
          </div>
        </div>
      </div>
    </div>
  );
}
