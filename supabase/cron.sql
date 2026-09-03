-- Recap mattutino con pg_cron + pg_net. Da eseguire UNA volta nel SQL Editor del
-- progetto Supabase (non è una migrazione: contiene URL e segreti del progetto).
--
-- 1. Sostituisci <PROJECT_REF> e <CRON_SECRET> (lo stesso impostato nei secrets della funzione).
-- 2. pg_cron gira in UTC: ogni 15 minuti tra le 06 e le 09 UTC copre la finestra 8-10 di Roma
--    sia con ora legale che solare. La funzione manda il recap una volta sola al giorno
--    (tabella app_state) e, se un invio fallisce, riprova al giro successivo.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('https://<PROJECT_REF>.supabase.co/functions/v1/daily-recap', 'sambelli_recap_url');
select vault.create_secret('<CRON_SECRET>', 'sambelli_cron_secret');

select cron.schedule(
  'sambelli-daily-recap',
  '*/15 6-9 * * *',
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'sambelli_recap_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'sambelli_cron_secret')
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Per controllare:  select * from cron.job;   select * from cron.job_run_details order by start_time desc limit 10;
-- Per rimuovere:    select cron.unschedule('sambelli-daily-recap');
