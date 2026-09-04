-- Test delle funzioni SQL, in una transazione che viene annullata.
-- Uso (stack locale avviato):
--   docker exec -i supabase_db_sambelli psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/complete_task_test.sql
begin;
do $$
declare
  ste uuid;
  tid uuid;
  t   tasks;
  v   task_overview;
begin
  insert into members (name) values ('Ste') returning id into ste;

  -- schedule mensile: sempre dalla base, niente deriva verso il 28
  insert into tasks (title, every_n, unit, anchor, next_due) values ('Affitto', 1, 'month', 'schedule', '2026-01-31') returning id into tid;
  t := complete_task(tid, ste, '2026-02-05');
  assert t.next_due = '2026-02-28', 'schedule 31 gen fatto 5 feb -> 28 feb, ottenuto ' || t.next_due;
  update tasks set next_due = '2026-01-31' where id = tid;
  t := complete_task(tid, ste, '2026-03-10');
  assert t.next_due = '2026-03-31', 'schedule salta gli arretrati dalla base -> 31 mar, ottenuto ' || t.next_due;

  -- schedule in anticipo: avanza comunque di un periodo
  update tasks set next_due = '2026-10-01' where id = tid;
  t := complete_task(tid, ste, '2026-09-20');
  assert t.next_due = '2026-11-01', 'schedule in anticipo -> 1 nov, ottenuto ' || t.next_due;

  -- la vista espone la scadenza corrente
  update tasks set next_due = '2026-09-01' where id = tid;
  select * into v from task_overview where id = tid;
  assert v.next_due = '2026-09-01' and v.status = 'active', 'vista: scadenza e stato';
  t := complete_task(tid, ste, '2026-09-03');
  assert t.next_due = '2026-10-01', 'schedule dopo completamento -> 1 ott';

  -- completion: dalla data del completamento
  insert into tasks (title, every_n, unit, anchor, next_due) values ('Lenzuola', 2, 'week', 'completion', '2026-09-01') returning id into tid;
  t := complete_task(tid, ste, '2026-09-10');
  assert t.next_due = '2026-09-24', 'completion 10 set + 2 settimane -> 24 set, ottenuto ' || t.next_due;

  -- una tantum: si archivia
  insert into tasks (title, next_due) values ('Imbiancare', '2026-09-01') returning id into tid;
  t := complete_task(tid, null, '2026-09-03');
  assert t.status = 'done', 'una tantum completata -> done';
  assert (select count(*) from completions where task_id = tid) = 1, 'completamento registrato';

  -- annullamento: torna com'era, riga cancellata; poi non è più annullabile
  insert into tasks (title, every_n, unit, anchor, next_due) values ('Piante', 3, 'day', 'completion', '2026-09-01') returning id into tid;
  t := complete_task(tid, ste, '2026-09-03');
  assert t.next_due = '2026-09-06', 'piante completate -> 6 set';
  t := undo_completion((select id from completions where task_id = tid order by done_on desc limit 1));
  assert t.next_due = '2026-09-01' and t.status = 'active', 'undo ripristina scadenza e stato';
  assert (select count(*) from completions where task_id = tid) = 0, 'undo cancella il completamento';
  -- undo di un completamento non ultimo: rifiutato
  t := complete_task(tid, ste, '2026-09-03');
  t := complete_task(tid, ste, '2026-09-06');
  begin
    perform undo_completion((select id from completions where task_id = tid order by done_on asc limit 1));
    raise exception 'atteso errore: non ultimo';
  exception when others then
    if sqlerrm not like '%solo l''ultimo%' then raise; end if;
  end;

  -- una tantum: done -> undo -> torna active
  insert into tasks (title, next_due) values ('Tinteggiare', '2026-09-01') returning id into tid;
  t := complete_task(tid, ste, '2026-09-04');
  assert t.status = 'done', 'una tantum -> done';
  t := undo_completion((select id from completions where task_id = tid order by done_on desc limit 1));
  assert t.status = 'active', 'undo di una tantum -> active';

  -- completare un task non attivo è un errore
  update tasks set status = 'archived' where id = tid;
  begin
    perform complete_task(tid, ste, '2026-09-04');
    raise exception 'atteso errore: task non attivo';
  exception when others then
    if sqlerrm not like '%non è attivo%' then raise; end if;
  end;

  -- archiviato dopo il completamento: l'annullamento è rifiutato
  update tasks set status = 'active' where id = tid;
  t := complete_task(tid, ste, '2026-09-04');
  update tasks set status = 'archived' where id = tid;
  begin
    perform undo_completion((select id from completions where task_id = tid order by done_on desc limit 1));
    raise exception 'atteso errore: task archiviato';
  exception when others then
    if sqlerrm not like '%archiviato%' then raise; end if;
  end;

  -- task inesistente
  begin
    perform complete_task(gen_random_uuid(), ste, '2026-09-03');
    raise exception 'atteso errore per task inesistente';
  exception when others then
    if sqlerrm not like '%non trovato%' then raise; end if;
  end;

  raise notice 'complete_task_test: ok';
end $$;
rollback;
