import { assertEquals } from "jsr:@std/assert@1";
import {
  addDays,
  bucketFor,
  diffDays,
  endOfMonth,
  endOfWeek,
  formatRelative,
  formatShort,
  hourAtHome,
  isIsoDate,
  todayAtHome,
} from "./dates.ts";

Deno.test("addDays attraversa mese e anno", () => {
  assertEquals(addDays("2026-09-30", 1), "2026-10-01");
  assertEquals(addDays("2026-12-31", 1), "2027-01-01");
  assertEquals(addDays("2026-03-01", -1), "2026-02-28");
});

Deno.test("diffDays", () => {
  assertEquals(diffDays("2026-09-03", "2026-09-10"), 7);
  assertEquals(diffDays("2026-09-10", "2026-09-03"), -7);
});

Deno.test("endOfWeek è la domenica, settimana lunedì-domenica", () => {
  assertEquals(endOfWeek("2026-09-03"), "2026-09-06"); // giovedì
  assertEquals(endOfWeek("2026-09-06"), "2026-09-06"); // domenica
  assertEquals(endOfWeek("2026-09-07"), "2026-09-13"); // lunedì
});

Deno.test("endOfMonth", () => {
  assertEquals(endOfMonth("2026-02-10"), "2026-02-28");
  assertEquals(endOfMonth("2028-02-10"), "2028-02-29");
  assertEquals(endOfMonth("2026-12-05"), "2026-12-31");
});

Deno.test("bucketFor", () => {
  const today = "2026-09-03";
  assertEquals(bucketFor("2026-09-01", today), "overdue");
  assertEquals(bucketFor("2026-09-03", today), "today");
  assertEquals(bucketFor("2026-09-06", today), "week");
  assertEquals(bucketFor("2026-09-07", today), "month");
  assertEquals(bucketFor("2026-09-30", today), "month");
  assertEquals(bucketFor("2026-10-01", today), "later");
});

Deno.test("formatShort e formatRelative", () => {
  assertEquals(formatShort("2026-09-03"), "gio 3 set");
  assertEquals(formatShort("2027-01-01", "2026-09-03"), "ven 1 gen 2027");
  assertEquals(formatRelative("2026-09-03", "2026-09-03"), "oggi");
  assertEquals(formatRelative("2026-09-04", "2026-09-03"), "domani");
  assertEquals(formatRelative("2026-09-02", "2026-09-03"), "da ieri");
  assertEquals(formatRelative("2026-08-31", "2026-09-03"), "da 3 gg");
  assertEquals(formatRelative("2026-09-08", "2026-09-03"), "tra 5 gg");
});

Deno.test("todayAtHome/hourAtHome usano il fuso di Roma", () => {
  // 2026-07-01 23:30 UTC = 2026-07-02 01:30 a Roma (ora legale)
  const summer = new Date("2026-07-01T23:30:00Z");
  assertEquals(todayAtHome(summer), "2026-07-02");
  assertEquals(hourAtHome(summer), 1);
  // 2026-01-15 07:00 UTC = 08:00 a Roma (ora solare)
  const winter = new Date("2026-01-15T07:00:00Z");
  assertEquals(hourAtHome(winter), 8);
});

Deno.test("isIsoDate accetta solo date esistenti nel formato YYYY-MM-DD", () => {
  assertEquals(isIsoDate("2026-09-03"), true);
  assertEquals(isIsoDate("2028-02-29"), true);
  for (const bad of ["2026-02-30", "2026-13-01", "2026-01-32", "2026-1-5", "ieri", 20260903, null, undefined]) {
    assertEquals(isIsoDate(bad), false, String(bad));
  }
});
