// Le validazioni di executeTool sono l'unica barriera tra l'output del modello e il
// database: devono scattare PRIMA di toccarlo. Il test gira senza env e senza rete.
import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { type AgentContext, executeTool } from "./agent.ts";
import type { Member, TaskOverview } from "./db.ts";

const ste: Member = { id: "m-ste", name: "Ste", telegram_user_id: 1 };
const chiara: Member = { id: "m-chi", name: "Chiara", telegram_user_id: 2 };
const oneOff: TaskOverview = {
  id: "t-1",
  title: "Imbiancare",
  notes: null,
  every_n: null,
  unit: null,
  anchor: "completion",
  next_due: "2026-09-03",
  assigned_to: null,
  status: "active",
  assigned_to_name: null,
  last_done_on: null,
  last_done_by: null,
  updated_at: "2026-09-04T00:00:00Z",
};
const archived: TaskOverview = { ...oneOff, id: "t-2", title: "Cancello", status: "archived" };
const ctx = (): AgentContext => ({
  today: "2026-09-03",
  sender: ste,
  members: [ste, chiara],
  tasks: [oneOff, archived],
  events: [],
});

Deno.test("executeTool rifiuta input invalidi prima di scrivere", async (t) => {
  const cases: [string, string, Record<string, unknown>, string][] = [
    ["task sconosciuto", "complete_task", { task_id: "nope" }, "task_id sconosciuto"],
    ["membro sconosciuto", "complete_task", { task_id: "t-1", done_by: "Mario" }, 'Nessun membro chiamato "Mario"'],
    ["data non ISO", "complete_task", { task_id: "t-1", done_on: "ieri" }, "done_on non è una data ISO"],
    ["data inesistente", "complete_task", { task_id: "t-1", done_on: "2026-02-30" }, "done_on non è una data ISO"],
    ["create senza titolo", "create_task", {}, "title obbligatorio"],
    ["create con solo every_n", "create_task", { title: "X", every_n: 2 }, "every_n e unit vanno passati insieme"],
    ["ricorrenza su una tantum", "update_task", { task_id: "t-1", unit: "week" }, "è una tantum"],
    ["archivia un task ignoto", "archive_task", { task_id: "nope" }, "task_id sconosciuto"],
    ["update vuoto", "update_task", { task_id: "t-1" }, "Nessun campo da modificare"],
    ["modifica di un task fuori agenda", "update_task", { task_id: "t-2", title: "X" }, "non è in agenda"],
    ["archivio di un task fuori agenda", "archive_task", { task_id: "t-2" }, "non è in agenda"],
    ["rename vuoto", "rename_member", { name: "  " }, "name obbligatorio"],
    ["strumento ignoto", "boh", {}, "Strumento sconosciuto"],
  ];
  for (const [name, tool, input, msg] of cases) {
    await t.step(name, async () => {
      const c = ctx();
      await assertRejects(() => executeTool(c, tool, input), Error, msg);
      assertEquals(c.events, []);
    });
  }
});
