# Sambelli

Bot Telegram per i lavori di casa di Stefano e Chiara. Gira interamente su Supabase
(Postgres + Edge Functions), capisce il linguaggio naturale con Claude e manda un
recap ogni mattina.

```
"cosa c'è da fare questa settimana?"      → agenda raggruppata
"ho fatto le lenzuola"                     → completa e calcola la prossima
"aggiungi cambiare filtro cappa ogni 3 mesi"
"sposta il sale a lunedì"
/oggi /settimana /mese /tutti /storico     → comandi rapidi senza LLM, con bottoni ✅
```

## Architettura

```
Telegram ──webhook──▶ Edge Function telegram-webhook ──▶ Postgres (tasks, completions, members)
                            │
                            └── Claude (tool use) per i messaggi in linguaggio naturale

pg_cron ──06/07 UTC──▶ Edge Function daily-recap ──▶ Telegram (recap con bottoni)
```

- `supabase/migrations/` — schema, vista `task_overview` (security invoker), funzione `complete_task`.
- `supabase/functions/_shared/` — `dates` (fuso Europe/Rome, raggruppamenti), `db` (accesso dati),
  `telegram` (Bot API), `format` (testi e tastiere), `prompt` + `agent` (Claude e strumenti).
- `supabase/functions/telegram-webhook/` — comandi, bottoni inline, delega a Claude.
- `supabase/functions/daily-recap/` — recap mattutino.
- `supabase/cron.sql` — schedulazione del recap (da eseguire una volta in produzione).

### Modello dei task

Ogni task ha una **prossima scadenza** (`next_due`), che è l'unica cosa usata per i raggruppamenti
(in ritardo / oggi / questa settimana / questo mese / più avanti). La ricorrenza è `every_n` + `unit`
(es. 2 + week) e ha due semantiche:

- `completion` (default): la prossima scadenza parte da quando lo fai. Sale addolcitore, lenzuola, piante.
- `schedule`: la prossima avanza a calendario, saltando gli arretrati. Il primo del mese, ogni settembre.

Senza ricorrenza il task è una tantum e si archivia quando lo completi. Rimandare un task scrive
`postponed_until` e non tocca `next_due`: un task a calendario rimandato non perde la sua ancora, e
il completamento successivo azzera il rinvio. La vista `task_overview` espone come `next_due` la
data effettiva. I task non hanno un proprietario di default: chi li fa li segna. L'assegnazione
esiste ma è l'eccezione.

## Setup

### 1. Bot Telegram

1. Su Telegram apri **@BotFather** → `/newbot`, salva il token.
2. Sempre in BotFather: `/setprivacy` → scegli il bot → **Disable**. Serve perché nel gruppo il bot
   legga tutti i messaggi, non solo i comandi.
3. Facoltativo: `/setcommands` e incolla

   ```
   oggi - In ritardo e oggi
   settimana - Fino a domenica
   mese - Fino a fine mese
   tutti - Tutto quello che c'è
   storico - Ultimi completamenti
   aiuto - Come funziona
   ```

4. Crea un gruppo con te, Chiara e il bot (oppure usa due chat private, vedi sotto).

### 2. Progetto Supabase

1. Crea un progetto su [supabase.com](https://supabase.com) e annota il `PROJECT_REF` (è nell'URL).
2. Collega la cartella e applica lo schema:

   ```bash
   supabase login
   supabase link --project-ref <PROJECT_REF>
   supabase db push
   ```

3. Configura i segreti:

   ```bash
   cp supabase/functions/.env.example supabase/functions/.env
   # compila TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, ANTHROPIC_API_KEY, CRON_SECRET
   supabase secrets set --env-file supabase/functions/.env
   ```

4. Deploy delle funzioni e registrazione del webhook:

   ```bash
   supabase functions deploy telegram-webhook
   supabase functions deploy daily-recap
   scripts/set-webhook.sh <PROJECT_REF>
   ```

5. Scopri gli id delle chat: ognuno apre il bot e preme Avvia (o scrive `/start`). Finché la
   chat non è autorizzata il bot risponde solo con il suo id. Mettili in `TELEGRAM_ALLOWED_CHAT_IDS`
   nel `.env`, separati da virgola, e rilancia `supabase secrets set`. Con la lista vuota il bot
   non risponde a nessuno; con la lista piena ignora chiunque non ci sia.

6. Recap mattutino: apri `supabase/cron.sql`, sostituisci `<PROJECT_REF>` e `<CRON_SECRET>`, ed
   eseguilo nel **SQL Editor** del progetto. Per provarlo subito senza aspettare le 8:

   ```bash
   curl -X POST "https://<PROJECT_REF>.supabase.co/functions/v1/daily-recap?force=1" \
     -H "Authorization: Bearer <CRON_SECRET>"
   ```

I membri si registrano da soli: il primo messaggio di ciascuno in una chat ammessa crea la riga
in `members` con il nome Telegram. Il bot usa quel nome per salutare e nelle notifiche. Per cambiarlo
basta dirglielo: «chiamami Ste».

### Gruppo o chat private?

`TELEGRAM_ALLOWED_CHAT_IDS` accetta più id separati da virgola. Con un solo gruppo tutto avviene lì.
Con due chat private (una a testa), ogni azione fatta in una viene annunciata nell'altra
("✅ Chiara ha fatto: Lavare lenzuola"). Il recap arriva in tutte le chat configurate.

## Deploy automatico (GitHub Actions)

Ogni push su `main` esegue `.github/workflows/deploy.yml`: `supabase db push` e deploy delle due
funzioni. Le pull request girano `.github/workflows/ci.yml` (formato, typecheck, test).

Segreti da impostare nel repo GitHub, in Settings → Secrets and variables → Actions:

| Segreto | Dove si trova |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | [Account → Access Tokens](https://supabase.com/dashboard/account/tokens) |
| `SUPABASE_PROJECT_ID` | il ref del progetto, nell'URL della dashboard |
| `SUPABASE_DB_PASSWORD` | Project Settings → Database (quella scelta alla creazione) |

I passi 2 e 4 del setup (`db push`, `functions deploy`) diventano quindi automatici. Restano manuali
`supabase secrets set` e `scripts/set-webhook.sh`, da fare una volta sola.

## Sviluppo locale

Serve Docker. Deno e Supabase CLI: `brew install deno supabase/tap/supabase`.

```bash
supabase start                      # Postgres + tutto lo stack, applica migrazioni e seed
cd supabase/functions
deno task check                     # typecheck
deno task test                      # test unitari (date, formattazione, allowlist, validazioni agente)
docker exec -i supabase_db_sambelli psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  < supabase/tests/complete_task_test.sql   # test delle funzioni SQL, in rollback
cd ../..
supabase functions serve --env-file supabase/functions/.env
```

Le funzioni locali rispondono su `http://localhost:54321/functions/v1/<nome>`. Per simulare
un messaggio Telegram senza esporre il webhook:

```bash
curl -s http://localhost:54321/functions/v1/telegram-webhook \
  -H "x-telegram-bot-api-secret-token: $TELEGRAM_WEBHOOK_SECRET" \
  -H 'content-type: application/json' \
  -d '{"update_id":1,"message":{"message_id":1,"date":0,"chat":{"id":-100123,"type":"group"},
       "from":{"id":42,"is_bot":false,"first_name":"Stefano"},"text":"/oggi"}}'
```

Con un token vero il bot risponde nella chat indicata. Per testare senza toccare Telegram, imposta
`TELEGRAM_API_BASE` verso un server finto che risponde `{"ok":true,"result":{}}`.

Per il database locale: `supabase db reset` riapplica migrazioni e seed; `psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')"` apre una shell.

## Prossimi passi

- Web app minimale sopra lo stesso database (vista temporale + editor delle ricorrenze).
- Notifica serale per quello che è rimasto in ritardo.
- Statistiche: chi ha fatto cosa nel mese.
