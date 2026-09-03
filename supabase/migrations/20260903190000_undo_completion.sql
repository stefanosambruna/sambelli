-- Annullamento di un completamento (dalla Mini App o dal bot: "annulla le lenzuola").
-- La riga di completions ricorda com'era il task prima, così si può ripristinare.

alter table completions
  add column prev_next_due        date,
  add column prev_postponed_until date,
  add column prev_active          boolean;

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

  insert into completions (task_id, member_id, done_on, note, prev_next_due, prev_postponed_until, prev_active)
  values (p_task_id, p_member_id, p_done_on, p_note, t.next_due, t.postponed_until, t.active);

  if t.every_n is null then
    update tasks set active = false, postponed_until = null where id = p_task_id returning * into t;
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

  update tasks
     set next_due = new_due, postponed_until = null, active = true
   where id = p_task_id
  returning * into t;
  return t;
end $$;

-- Annulla SOLO l'ultimo completamento del task (quelli precedenti hanno uno stato "prima"
-- che non corrisponde più al presente). Ripristina il task e cancella la riga.
create function undo_completion(p_completion_id uuid) returns tasks
language plpgsql as $$
declare
  c completions;
  t tasks;
begin
  select * into c from completions where id = p_completion_id for update;
  if not found then
    raise exception 'completamento % non trovato', p_completion_id;
  end if;
  if c.prev_next_due is null then
    raise exception 'completamento % non annullabile (registrato prima di questa funzione)', p_completion_id;
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
         active = c.prev_active
   where id = c.task_id
  returning * into t;

  delete from completions where id = c.id;
  return t;
end $$;

revoke execute on function complete_task(uuid, uuid, date, text) from anon, authenticated, public;
revoke execute on function undo_completion(uuid) from anon, authenticated, public;
