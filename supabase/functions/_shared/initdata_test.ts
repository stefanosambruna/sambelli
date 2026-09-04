import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { InitDataError, signInitData, verifyInitData } from "./initdata.ts";

const TOKEN = "123456:TEST-token";
const NOW = new Date("2026-09-04T10:00:00Z");

async function makeInitData(over: Record<string, string> = {}): Promise<string> {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(NOW.getTime() / 1000) - 60),
    query_id: "AAA",
    user: JSON.stringify({ id: 70907359, first_name: "Ste" }),
    ...over,
  });
  params.set("hash", await signInitData(params.toString(), TOKEN));
  return params.toString();
}

Deno.test("initData valida: torna l'utente", async () => {
  const user = await verifyInitData(await makeInitData(), TOKEN, { now: NOW });
  assertEquals(user.id, 70907359);
  assertEquals(user.first_name, "Ste");
});

Deno.test("firma sbagliata o manomessa: rifiutata", async () => {
  const good = await makeInitData();
  await assertRejects(() => verifyInitData(good, "altro-token", { now: NOW }), InitDataError, "non valida");

  // stesso hash, utente cambiato: deve saltare
  const tampered = new URLSearchParams(good);
  tampered.set("user", JSON.stringify({ id: 999, first_name: "Mallory" }));
  await assertRejects(() => verifyInitData(tampered.toString(), TOKEN, { now: NOW }), InitDataError, "non valida");

  const noHash = new URLSearchParams(good);
  noHash.delete("hash");
  await assertRejects(() => verifyInitData(noHash.toString(), TOKEN, { now: NOW }), InitDataError, "senza hash");
});

Deno.test("initData vecchia: rifiutata", async () => {
  const old = await makeInitData({ auth_date: String(Math.floor(NOW.getTime() / 1000) - 25 * 3600) });
  await assertRejects(() => verifyInitData(old, TOKEN, { now: NOW }), InitDataError, "scaduta");
  const noDate = await makeInitData({ auth_date: "0" });
  await assertRejects(() => verifyInitData(noDate, TOKEN, { now: NOW }), InitDataError, "scaduta");
});

Deno.test("utente mancante o malformato: rifiutato", async () => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(NOW.getTime() / 1000)) });
  params.set("hash", await signInitData(params.toString(), TOKEN));
  await assertRejects(() => verifyInitData(params.toString(), TOKEN, { now: NOW }), InitDataError, "senza utente");

  const bad = await makeInitData({ user: "non-json" });
  await assertRejects(() => verifyInitData(bad, TOKEN, { now: NOW }), InitDataError, "illeggibile");

  const noId = await makeInitData({ user: JSON.stringify({ first_name: "X" }) });
  await assertRejects(() => verifyInitData(noId, TOKEN, { now: NOW }), InitDataError, "senza id");
});
