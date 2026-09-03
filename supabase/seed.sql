-- Dati di esempio per sviluppo locale. I membri si registrano da soli al primo messaggio.
-- Le scadenze sono relative a oggi così l'agenda ha qualcosa in ogni raggruppamento.

insert into tasks (title, notes, every_n, unit, anchor, next_due) values
  ('Lavare lenzuola',        null,                       2, 'week',  'completion', current_date),
  ('Lavare asciugamani',     null,                       1, 'week',  'completion', current_date),
  ('Pulire pavimenti',       null,                       1, 'week',  'completion', current_date + 2),
  ('Acqua alle piante',      'Quelle del terrazzo bevono di più', 3, 'day', 'completion', current_date - 1),
  ('Sale addolcitore',       'Sacco da 25 kg in garage', 2, 'month', 'completion', current_date + 12),
  ('Togliere ragnatele',     null,                       1, 'month', 'completion', current_date + 20),
  ('Manutenzione cancello',  'Ingrassare cremagliera e controllare fotocellule', 6, 'month', 'schedule', current_date + 45),
  ('Imbiancare ripostiglio', 'Prendere la pittura antimuffa', null, null, 'completion', current_date + 60);
