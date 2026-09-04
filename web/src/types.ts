// Speculari ai tipi di supabase/functions/_shared/db.ts (che non si può importare: usa npm:).
export type IsoDate = string;
export type RecurrenceUnit = "day" | "week" | "month" | "year";
export type RecurrenceAnchor = "completion" | "schedule";
/** active = in agenda · done = una tantum completata · archived = archiviata a mano */
export type TaskStatus = "active" | "done" | "archived";

export interface Member {
  id: string;
  name: string;
  telegram_user_id: number | null;
  avatar_url: string | null;
}

export interface Task {
  id: string;
  title: string;
  notes: string | null;
  every_n: number | null;
  unit: RecurrenceUnit | null;
  anchor: RecurrenceAnchor;
  next_due: IsoDate;
  assigned_to: string | null;
  assigned_to_name: string | null;
  status: TaskStatus;
  last_done_on: IsoDate | null;
  last_done_by: string | null;
}

export interface Completion {
  id: string;
  task_id: string;
  member_id: string | null;
  done_on: IsoDate;
  note: string | null;
  task_title: string;
  member_name: string | null;
  undoable: boolean;
}

export interface Agenda {
  today: IsoDate;
  me: Member;
  members: Member[];
  tasks: Task[];
  history: Completion[];
}

export interface TaskInput {
  title?: string;
  notes?: string;
  every_n?: number;
  unit?: RecurrenceUnit;
  anchor?: RecurrenceAnchor;
  first_due?: IsoDate;
  next_due?: IsoDate;
  assigned_to?: string;
}

export interface Inactive {
  today: IsoDate;
  tasks: Task[];
  members: Member[];
}
