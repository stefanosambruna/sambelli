-- Stato applicativo minimo: oggi solo la data dell'ultimo recap inviato, così il cron
-- può girare più volte al mattino (retry) senza mandare doppioni.
create table app_state (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
alter table app_state enable row level security;
revoke all on app_state from anon, authenticated;
