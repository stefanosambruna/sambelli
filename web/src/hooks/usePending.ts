import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.ts";
import { haptic, showAlert } from "../telegram.ts";
import type { Task } from "../types.ts";

export const UNDO_MS = 6000;

export interface Pending {
  key: string;
  task: Task;
  deadline: number;
}

/**
 * Coda "alla Gmail": l'azione parte dopo UNDO_MS, nel frattempo si può annullare e al
 * server non arriva nulla (quindi neanche la notifica all'altro). Se l'app viene chiusa
 * o messa in background, le azioni in sospeso partono subito con keepalive.
 */
export function usePending() {
  const qc = useQueryClient();
  const [items, setItems] = useState<Pending[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  const timers = useRef(new Map<string, number>());
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const send = useCallback(async (p: Pending, keepalive = false) => {
    try {
      await api.complete(p.task.id, keepalive);
    } catch (err) {
      console.error(err);
      // Se stiamo uscendo dall'app un dialogo non si vedrebbe: lo teniamo per il rientro.
      if (document.visibilityState === "hidden") setFailed(`Non sono riuscito a segnare "${p.task.title}".`);
      else showAlert(err instanceof Error ? err.message : "Errore");
    } finally {
      qc.invalidateQueries({ queryKey: ["agenda"] });
      qc.invalidateQueries({ queryKey: ["inactive"] });
    }
  }, [qc]);

  const commit = useCallback((key: string, keepalive = false) => {
    const p = itemsRef.current.find((x) => x.key === key);
    timers.current.delete(key);
    if (!p) return;
    setItems((xs) => xs.filter((x) => x.key !== key));
    void send(p, keepalive);
  }, [send]);

  const add = useCallback((task: Task) => {
    if (itemsRef.current.some((x) => x.task.id === task.id)) return;
    const key = `${task.id}:${Date.now()}`;
    const deadline = Date.now() + UNDO_MS;
    setItems((xs) => [...xs, { key, task, deadline }]);
    timers.current.set(key, window.setTimeout(() => commit(key), UNDO_MS));
    haptic.success();
  }, [commit]);

  const undo = useCallback((key: string) => {
    const t = timers.current.get(key);
    if (t) clearTimeout(t);
    timers.current.delete(key);
    setItems((xs) => xs.filter((x) => x.key !== key));
    haptic.tap();
  }, []);

  // Chiusura o background: niente attesa, si manda tutto.
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState !== "hidden") return;
      for (const p of itemsRef.current) {
        const t = timers.current.get(p.key);
        if (t) clearTimeout(t);
        commit(p.key, true);
      }
    };
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("pagehide", flush);
    };
  }, [commit]);

  const pendingTaskIds = new Set(items.map((p) => p.task.id));
  return { items, add, undo, pendingTaskIds, failed, clearFailed: () => setFailed(null) };
}
