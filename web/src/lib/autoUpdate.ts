// GitHub Pages serve index.html con cache di 10 minuti e la WebView di Telegram la
// trattiene volentieri: dopo un deploy si rischia di girare a lungo sulla versione vecchia.
// Confrontiamo il bundle referenziato dall'index pubblicato con quello in esecuzione e,
// se differisce, ricarichiamo. Gira all'avvio e a ogni ritorno in primo piano.

const current = () => document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]')?.getAttribute("src");

async function check(): Promise<void> {
  const running = current();
  if (!running) return;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}index.html?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return;
    const html = await res.text();
    const m = html.match(/script[^>]+src="([^"]*\/assets\/[^"]+\.js)"/);
    if (m && m[1] !== running) location.reload();
  } catch {
    // offline o simili: pazienza
  }
}

export function startAutoUpdate(): void {
  if (import.meta.env.DEV) return;
  void check();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void check();
  });
}
