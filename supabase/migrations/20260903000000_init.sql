-- Sambelli: task di casa condivisi tra Stefano e Chiara.
-- Schema minimo: chi siamo, cosa c'è da fare, chi ha fatto cosa, memoria breve delle chat.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Membri della casa
-- ---------------------------------------------------------------------------
create table members (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  telegram_user_id bigint unique,
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Task
--   every_n + unit   : ricorrenza ("ogni 2 settimane"); entrambi null = una tantum
--   anchor           : 'completion' -> la prossima scadenza parte da quando lo fai
--                      ('sale addolcitore', 'lavare lenzuola')
--                      'schedule'   -> la prossima scadenza avanza a calendario
--                      ('il primo del mese', 'ogni settembre')
--   next_due         : prossima scadenza, unica fonte per i raggruppamenti temporali
--   assigned_to      : opzionale; di default il task è di chi se lo prende
-- ---------------------------------------------------------------------------
create type recurrence_unit as enum ('day', 'week', 'month', 'year');
create type recurrence_anchor as enum ('completion', 'schedule');

create table tasks (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  notes       text,
  every_n     integer,
  unit        recurrence_unit,
  anchor      recurrence_anchor not null default 'completion',
  next_due    date not null default current_date,
  assigned_to uuid references members (id) on delete set null,
  active      boolean not null default true,
  created_by  uuid references members (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint tasks_recurrence_consistent check (
    (every_n is null and unit is null) or (every_n > 0 and unit is not null)
  )
);

create index tasks_active_next_due_idx on tasks (next_due) where active;

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger tasks_set_updated_at
  before update on tasks
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Completamenti (storico: chi ha fatto cosa e quando)
-- ---------------------------------------------------------------------------
create table completions (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references tasks (id) on delete cascade,
  member_id  uuid references members (id) on delete set null,
  done_on    date not null default current_date,
  note       text,
  created_at timestamptz not null default now()
);

create index completions_task_done_idx on completions (task_id, done_on desc);
create index completions_member_done_idx on completions (member_id, done_on desc);

-- ---------------------------------------------------------------------------
-- Memoria breve delle conversazioni Telegram (per i "quale?" e i follow-up)
-- ---------------------------------------------------------------------------
create table chat_messages (
  id         bigserial primary key,
  chat_id    bigint not null,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null,
  member_id  uuid references members (id) on delete set null,
  created_at timestamptz not null default now()
);

create index chat_messages_chat_created_idx on chat_messages (chat_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Vista: task attivi con ultimo completamento
-- ---------------------------------------------------------------------------
create view task_overview as
select
  t.id,
  t.title,
  t.notes,
  t.every_n,
  t.unit,
  t.anchor,
  t.next_due,
  t.active,
  t.assigned_to,
  a.name  as assigned_to_name,
  c.done_on as last_done_on,
  m.name  as last_done_by
from tasks t
left join members a on a.id = t.assigned_to
left join lateral (
  select done_on, member_id
  from completions
  where task_id = t.id
  order by done_on desc, created_at desc
  limit 1
) c on true
left join members m on m.id = c.member_id;

-- ---------------------------------------------------------------------------
-- Ricorrenza: intervallo Postgres da (every_n, unit)
-- ---------------------------------------------------------------------------
create or replace function recurrence_interval(p_every_n integer, p_unit recurrence_unit)
returns interval
language sql immutable as $$
  select case p_unit
    when 'day'   then make_interval(days   => p_every_n)
    when 'week'  then make_interval(weeks  => p_every_n)
    when 'month' then make_interval(months => p_every_n)
    when 'year'  then make_interval(years  => p_every_n)
  end
$$;

-- ---------------------------------------------------------------------------
-- complete_task: registra il completamento e calcola la prossima scadenza.
--   una tantum            -> il task si disattiva
--   anchor = 'completion' -> next_due = done_on + intervallo
--   anchor = 'schedule'   -> next_due avanza di almeno un periodo, e comunque
--                            finché supera done_on (se hai saltato due mesi non ti
--                            ripropone gli arretrati; se lo fai in anticipo non te lo
--                            ripropone alla vecchia data)
-- Ritorna la riga aggiornata del task.
-- ---------------------------------------------------------------------------
create or replace function complete_task(
  p_task_id   uuid,
  p_member_id uuid,
  p_done_on   date default current_date,
  p_note      text default null
) returns tasks
language plpgsql as $$
declare
  t        tasks;
  step     interval;
  new_due  date;
begin
  select * into t from tasks where id = p_task_id for update;
  if not found then
    raise exception 'task % non trovato', p_task_id;
  end if;

  insert into completions (task_id, member_id, done_on, note)
  values (p_task_id, p_member_id, p_done_on, p_note);

  if t.every_n is null then
    update tasks set active = false where id = p_task_id returning * into t;
    return t;
  end if;

  step := recurrence_interval(t.every_n, t.unit);

  if t.anchor = 'completion' then
    new_due := (p_done_on + step)::date;
  else
    new_due := (t.next_due + step)::date;
    while new_due <= p_done_on loop
      new_due := (new_due + step)::date;
    end loop;
  end if;

  update tasks set next_due = new_due, active = true where id = p_task_id returning * into t;
  return t;
end $$;

-- ---------------------------------------------------------------------------
-- postpone_task: sposta la prossima scadenza senza registrare un completamento
-- ---------------------------------------------------------------------------
create or replace function postpone_task(p_task_id uuid, p_until date)
returns tasks
language plpgsql as $$
declare
  t tasks;
begin
  update tasks set next_due = p_until where id = p_task_id returning * into t;
  if not found then
    raise exception 'task % non trovato', p_task_id;
  end if;
  return t;
end $$;

-- ---------------------------------------------------------------------------
-- Sicurezza: solo il service role (usato dalle Edge Functions) tocca queste tabelle.
-- RLS attivo senza policy = nessun accesso da anon/authenticated.
-- Quando arriverà la web app aggiungeremo policy per gli utenti autenticati.
-- ---------------------------------------------------------------------------
alter table members       enable row level security;
alter table tasks         enable row level security;
alter table completions   enable row level security;
alter table chat_messages enable row level security;
