import { Archive, CheckCircle2, MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/** Menu ⋯ nell'intestazione: porta alle viste fuori agenda. */
export function Menu({ onDone, onArchived }: { onDone: () => void; onArchived: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const item = "flex w-full items-center gap-2.5 px-4 py-3 text-left text-[16px] active:bg-bg2";

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="rounded-full p-2 text-hint active:bg-bg" aria-label="Altro">
        <MoreHorizontal size={20} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-52 overflow-hidden rounded-xl bg-card shadow-lg ring-1 ring-black/10">
          <button type="button" className={item} onClick={() => { setOpen(false); onDone(); }}>
            <CheckCircle2 size={18} className="text-hint" /> Completati
          </button>
          <button type="button" className={item} onClick={() => { setOpen(false); onArchived(); }}>
            <Archive size={18} className="text-hint" /> Archiviati
          </button>
        </div>
      )}
    </div>
  );
}
