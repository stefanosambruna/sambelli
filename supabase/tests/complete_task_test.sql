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

  -- rinvio: la vista mostra la data effettiva, l'ancora resta; il completamento azzera il rinvio
  update tasks set next_due = '2026-09-01', postponed_until = '2026-09-03' where id = tid;
  select * into v from task_overview where id = tid;
  assert v.next_due = '2026-09-03', 'vista: data effettiva col rinvio';
  t := complete_task(tid, ste, '2026-09-03');
  assert t.next_due = '2026-10-01' and t.postponed_until is null, 'completamento dopo rinvio -> 1 ott e rinvio azzerato';

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
  insert into tasks (title, every_n, unit, anchor, next_due, postponed_until) values ('Piante', 3, 'day', 'completion', '2026-09-01', '2026-09-04') returning id into tid;
  t := complete_task(tid, ste, '2026-09-03');
  assert t.next_due = '2026-09-06' and t.postponed_until is null, 'piante completate -> 6 set';
  t := undo_completion((select id from completions where task_id = tid order by created_at desc limit 1));
  assert t.next_due = '2026-09-01' and t.postponed_until = '2026-09-04' and t.status = 'active', 'undo ripristina stato, ancora e rinvio';
  assert (select count(*) from completions where task_id = tid) = 0, 'undo cancella il completamento';
  -- undo di un completamento non ultimo: rifiutato
  t := complete_task(tid, ste, '2026-09-03');
  t := complete_task(tid, ste, '2026-09-06');
  begin
    perform undo_completion((select id from completions where task_id = tid order by created_at asc limit 1));
    raise exception 'atteso errore: non ultimo';
  exception when others then
    if sqlerrm not like '%solo l''ultimo%' then raise; end if;
  end;

  -- una tantum: done -> undo -> torna active
  t := complete_task((select id from tasks where title = 'Imbiancare ripostiglio'), ste, '2026-09-04');
  assert t.status = 'done', 'una tantum -> done';
  t := undo_completion((select id from completions where task_id = t.id order by created_at desc limit 1));
  assert t.status = 'active', 'undo di una tantum -> active';

  -- completare un task non attivo è un errore
  update tasks set status = 'archived' where title = 'Imbiancare ripostiglio';
  begin
    perform complete_task((select id from tasks where title = 'Imbiancare ripostiglio'), ste, '2026-09-04');
    raise exception 'atteso errore: task non attivo';
  exception when others then
    if sqlerrm not like '%non è attivo%' then raise; end if;
  end;
  update tasks set status = 'active' where title = 'Imbiancare ripostiglio';

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
