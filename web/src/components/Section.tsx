import type { ReactNode } from "react";

export function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="mb-5">
      <h2 className="mb-1.5 px-4 text-[13px] font-semibold uppercase tracking-wide text-hint">
        {title}
        {count !== undefined && <span className="ml-1.5 font-normal">{count}</span>}
      </h2>
      <div className="mx-3 overflow-hidden rounded-2xl bg-card divide-y divide-bg2">{children}</div>
    </section>
  );
}
