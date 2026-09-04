import { useState } from "react";
import type { Member } from "../types.ts";

const SIZES = { sm: "h-5 w-5 text-[10px]", md: "h-7 w-7 text-[12px]", lg: "h-10 w-10 text-[15px]" } as const;

/** Faccia del membro; senza immagine, un cerchietto con l'iniziale. */
export function Avatar({ member, size = "sm", className = "" }: { member: Member | undefined; size?: keyof typeof SIZES; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (!member) return null;
  const cls = `inline-block shrink-0 rounded-full object-cover align-middle ${SIZES[size]} ${className}`;
  if (member.avatar_url && !broken) {
    return <img src={member.avatar_url} alt={member.name} title={member.name} className={cls} onError={() => setBroken(true)} />;
  }
  return (
    <span className={`${cls} inline-flex items-center justify-center bg-accent font-semibold text-accent-fg`} title={member.name}>
      {member.name.slice(0, 1).toUpperCase()}
    </span>
  );
}
