-- Correzioni dalla review del 2026-09-03.
--
-- 1. postponed_until: rimandare un task non tocca più next_due. Per i task "a calendario"
--    next_due resta l'ancora (il primo del mese rimandato al 3 resta "il primo del mese").
--    La vista espone come next_due la data effettiva: coalesce(postponed_until, next_due).
-- 2. complete_task: avanza sempre dalla data base con un moltiplicatore (niente deriva
--    verso il 28 per i mensili), azzera il rinvio, e richiede p_done_on esplicito
--    (il "oggi" lo decide la funzione nel fuso di casa, non il server in UTC).
-- 3. postpone_task rimossa: è un UPDATE su una colonna, lo fa il client.
-- 4. task_overview con security_invoker e revoca dei grant: una vista con i privilegi del
--    proprietario aggirava la RLS delle tabelle sottostanti.

alter table tasks add column postponed_until date;

drop function if exists postpone_task(uuid, date);

drop view if exists task_overview;

create view task_overview with (security_invoker = true) as
select
  t.id,
  t.title,
  t.notes,
  t.every_n,
  t.unit,
  t.anchor,
  coalesce(t.postponed_until, t.next_due) as next_due,
  t.next_due      as scheduled_due,
  t.postponed_until,
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

-- Il default di p_done_on sparisce: serve drop + create (create or replace non lo permette).
drop function complete_task(uuid, uuid, date, text);

create function complete_task(
  p_task_id   uuid,
  p_member_id uuid,
  p_done_on   date,
  p_note      text default null
) returns tasks
language plpgsql as $$
declare
  t        tasks;
  step     interval;
  k        integer := 1;
  new_due  date;
begin
  select * into t from tasks where id = p_task_id for update;
  if not found then
    raise exception 'task % non trovato', p_task_id;
  end if;

  insert into completions (task_id, member_id, done_on, note)
  values (p_task_id, p_member_id, p_done_on, p_note);

  if t.every_n is null then
    update tasks set active = false, postponed_until = null where id = p_task_id returning * into t;
    return t;
  end if;

  step := recurrence_interval(t.every_n, t.unit);

  if t.anchor = 'completion' then
    new_due := (p_done_on + step)::date;
  else
    -- Sempre dalla data base, mai dal risultato intermedio: 31 gen + 2 mesi = 31 mar.
    new_due := (t.next_due + step * k)::date;
    while new_due <= p_done_on loop
      k := k + 1;
      new_due := (t.next_due + step * k)::date;
    end loop;
  end if;

  update tasks
     set next_due = new_due, postponed_until = null, active = true
   where id = p_task_id
  returning * into t;
  return t;
end $$;

-- Solo il service role usa queste superfici.
revoke all on task_overview from anon, authenticated;
revoke all on members, tasks, completions, chat_messages from anon, authenticated;
revoke execute on function complete_task(uuid, uuid, date, text) from anon, authenticated, public;
revoke execute on function recurrence_interval(integer, recurrence_unit) from anon, authenticated, public;
