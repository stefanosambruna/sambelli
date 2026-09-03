import { assertEquals } from "jsr:@std/assert@1";
import { allowedChatIds, isChatAllowed, sanitizeModelHtml } from "./telegram.ts";

Deno.test("allowlist vuota nega tutto; voci sporche ignorate", () => {
  Deno.env.delete("TELEGRAM_ALLOWED_CHAT_IDS");
  assertEquals(isChatAllowed(1), false);
  Deno.env.set("TELEGRAM_ALLOWED_CHAT_IDS", "");
  assertEquals(isChatAllowed(0), false);
  Deno.env.set("TELEGRAM_ALLOWED_CHAT_IDS", " 111, 222 ,abc,");
  assertEquals(allowedChatIds(), [111, 222]);
  assertEquals(isChatAllowed(111), true);
  assertEquals(isChatAllowed(333), false);
  Deno.env.delete("TELEGRAM_ALLOWED_CHAT_IDS");
});

Deno.test("sanitizeModelHtml: entità e tag annidati", () => {
  assertEquals(sanitizeModelHtml("a < b && c > d"), "a &lt; b &amp;&amp; c &gt; d");
  assertEquals(sanitizeModelHtml("<b><i>x</i></b> <u>y</u>"), "<b><i>x</i></b> &lt;u&gt;y&lt;/u&gt;");
  assertEquals(sanitizeModelHtml('<a href="x">l</a>'), '&lt;a href="x"&gt;l&lt;/a&gt;');
});
