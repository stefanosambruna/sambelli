-- Stato esplicito del task: 'active' | 'done' | 'archived'.
--   done     = una tantum completata (automatico)
--   archived = azione esplicita di archiviazione
-- Sostituisce il booleano `active`, che confondeva i due casi.
-- Il tipo (una tantum / ricorrente) è fisso dalla creazione: lo garantisce l'applicazione.

alter table tasks add column status text not null default 'active'
  check (status in ('active', 'done', 'archived'));

update tasks set status = case
  when active then 'active'
  when every_n is null and exists (select 1 from completions c where c.task_id = tasks.id) then 'done'
  else 'archived'
end;

alter table completions add column prev_status text check (prev_status in ('active', 'done', 'archived'));
update completions set prev_status = case when prev_active then 'active' when prev_active = false then 'archived' end;

drop view if exists task_overview;
drop index if exists tasks_active_next_due_idx;
alter table tasks drop column active;
alter table completions drop column prev_active;

create index tasks_status_next_due_idx on tasks (status, next_due);

create view task_overview with (security_invoker = true) as
select
  t.id,
  t.title,
  t.notes,
  t.every_n,
  t.unit,
  t.anchor,
  coalesce(t.postponed_until, t.next_due) as next_due,
  t.status,
  t.assigned_to,
  a.name  as assigned_to_name,
  c.done_on as last_done_on,
  m.name  as last_done_by,
  t.updated_at
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

revoke all on task_overview from anon, authenticated;

create or replace function complete_task(
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
  if t.status <> 'active' then
    raise exception 'il task "%" non è attivo (%)', t.title, t.status;
  end if;

  insert into completions (task_id, member_id, done_on, note, prev_next_due, prev_postponed_until, prev_status)
  values (p_task_id, p_member_id, p_done_on, p_note, t.next_due, t.postponed_until, t.status);

  if t.every_n is null then
    update tasks set status = 'done', postponed_until = null where id = p_task_id returning * into t;
    return t;
  end if;

  step := recurrence_interval(t.every_n, t.unit);
  if t.anchor = 'completion' then
    new_due := (p_done_on + step)::date;
  else
    new_due := (t.next_due + step * k)::date;
    while new_due <= p_done_on loop
      k := k + 1;
      new_due := (t.next_due + step * k)::date;
    end loop;
  end if;

  update tasks set next_due = new_due, postponed_until = null where id = p_task_id returning * into t;
  return t;
end $$;

create or replace function undo_completion(p_completion_id uuid) returns tasks
language plpgsql as $$
declare
  c completions;
  t tasks;
begin
  select * into c from completions where id = p_completion_id for update;
  if not found then
    raise exception 'completamento % non trovato', p_completion_id;
  end if;
  if c.prev_next_due is null or c.prev_status is null then
    raise exception 'completamento % non annullabile', p_completion_id;
  end if;
  if c.id <> (
    select id from completions where task_id = c.task_id
    order by done_on desc, created_at desc limit 1
  ) then
    raise exception 'si può annullare solo l''ultimo completamento del task';
  end if;

  update tasks
     set next_due = c.prev_next_due,
         postponed_until = c.prev_postponed_until,
         status = c.prev_status
   where id = c.task_id
  returning * into t;

  delete from completions where id = c.id;
  return t;
end $$;

revoke execute on function complete_task(uuid, uuid, date, text) from anon, authenticated, public;
revoke execute on function undo_completion(uuid) from anon, authenticated, public;
