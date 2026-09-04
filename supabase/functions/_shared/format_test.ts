import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { doneKeyboard, keyboardWithout, renderAgenda } from "./format.ts";
import { sanitizeModelHtml } from "./telegram.ts";
import type { TaskOverview } from "./db.ts";

function task(over: Partial<TaskOverview>): TaskOverview {
  return {
    id: crypto.randomUUID(),
    title: "T",
    notes: null,
    every_n: 1,
    unit: "week",
    anchor: "completion",
    next_due: "2026-09-03",
    assigned_to: null,
    status: "active",
    assigned_to_name: null,
    last_done_on: null,
    last_done_by: null,
    updated_at: "2026-09-04T00:00:00Z",
    ...over,
  };
}

const today = "2026-09-03"; // giovedì

Deno.test("renderAgenda raggruppa e omette le sezioni vuote", () => {
  const tasks = [
    task({ title: "Piante", next_due: "2026-09-01" }),
    task({ title: "Lenzuola", next_due: today }),
    task({ title: "Pavimenti", next_due: "2026-09-05" }),
    task({ title: "Sale <25kg>", next_due: "2026-09-20" }),
  ];
  const out = renderAgenda(tasks, today, ["overdue", "today", "week", "month", "later"]);
  assertStringIncludes(out, "In ritardo</b>\n• Piante <i>(da 2 gg)</i>");
  assertStringIncludes(out, "Oggi</b>\n• Lenzuola");
  assertStringIncludes(out, "Questa settimana</b>\n• Pavimenti · sab 5 set");
  assertStringIncludes(out, "Sale &lt;25kg&gt; · dom 20 set");
  assertEquals(out.includes("Più avanti"), false);
  assertEquals(renderAgenda([], today, ["today"], "vuoto"), "vuoto");
});

Deno.test("doneKeyboard e keyboardWithout", () => {
  const a = task({ title: "A" });
  const b = task({ title: "B" });
  const kb = doneKeyboard([a, b])!;
  assertEquals(kb.inline_keyboard.length, 2);
  assertEquals(kb.inline_keyboard[0][0].callback_data, `d:${a.id}`);
  const without = keyboardWithout(kb, a.id)!;
  assertEquals(without.inline_keyboard.length, 1);
  assertEquals(without.inline_keyboard[0][0].callback_data, `d:${b.id}`);
  assertEquals(keyboardWithout(without, b.id), undefined);
  assertEquals(doneKeyboard([]), undefined);
});

Deno.test("sanitizeModelHtml tiene solo <b> e <i>", () => {
  assertEquals(
    sanitizeModelHtml("<b>Sale</b> & <i>x</i> <script>1<2</script>"),
    "<b>Sale</b> &amp; <i>x</i> &lt;script&gt;1&lt;2&lt;/script&gt;",
  );
});
