-- Pulizia dopo la rimozione del rinvio e la review:
--   1. via postponed_until e prev_postponed_until: nessun codice li scrive più, ma un
--      valore residuo rendeva invisibili le modifiche alla scadenza (la vista lo preferiva).
--   2. undo_completion non deve resuscitare un task archiviato dopo il completamento.
--   3. bucket privato degli avatar dichiarato qui, non solo a mano nella dashboard.

drop view if exists task_overview;
alter table tasks drop column postponed_until;
alter table completions drop column prev_postponed_until;

create view task_overview with (security_invoker = true) as
select
  t.id,
  t.title,
  t.notes,
  t.every_n,
  t.unit,
  t.anchor,
  t.next_due,
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

  insert into completions (task_id, member_id, done_on, note, prev_next_due, prev_status)
  values (p_task_id, p_member_id, p_done_on, p_note, t.next_due, t.status);

  if t.every_n is null then
    update tasks set status = 'done' where id = p_task_id returning * into t;
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

  update tasks set next_due = new_due where id = p_task_id returning * into t;
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

  select * into t from tasks where id = c.task_id for update;
  if t.status = 'archived' then
    -- Archiviato dopo il completamento: annullare non deve riportarlo in agenda.
    raise exception 'il task "%" è archiviato: riattivalo prima di annullare il completamento', t.title;
  end if;

  update tasks
     set next_due = c.prev_next_due,
         status = c.prev_status
   where id = c.task_id
  returning * into t;

  delete from completions where id = c.id;
  return t;
end $$;

revoke execute on function complete_task(uuid, uuid, date, text) from anon, authenticated, public;
revoke execute on function undo_completion(uuid) from anon, authenticated, public;

-- Avatar: bucket privato, un file <telegram_user_id>.jpg per membro.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false;
