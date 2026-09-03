// Server Telegram finto per prove locali: accetta qualsiasi metodo della Bot API,
// stampa cosa avrebbe mandato e risponde ok. Uso:
//   deno run --allow-net scripts/fake-telegram.ts        (porta 9999)
// e nel .env delle funzioni:  TELEGRAM_API_BASE=http://host.docker.internal:9999
let nextId = 1000;
Deno.serve({ port: 9999 }, async (req) => {
  const method = new URL(req.url).pathname.split("/").pop();
  const body = await req.json().catch(() => ({}));
  console.log(`\n▶ ${method}`);
  if (body.text) console.log(body.text);
  if (body.reply_markup) console.log(JSON.stringify(body.reply_markup));
  const result = method === "sendMessage"
    ? { message_id: nextId++, chat: { id: body.chat_id, type: "group" }, date: 0, text: body.text, reply_markup: body.reply_markup }
    : true;
  return Response.json({ ok: true, result });
});
