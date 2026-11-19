-- 0017: the teacher-record store. Observations, the wheel, the raised-hands
-- tally, no-device activities, and what a professor did about an insight.
--
-- Apply in number order with the rest of supabase/migrations (see
-- supabase/README.md). Needs sessions and questions (0000), accounts (0001),
-- classes and class_students (0016), and 0016's function
-- attendance_student_in_room_class(), which the wheel reuses. Idempotent:
-- tables and indexes are created only if missing, constraints are dropped by
-- name and added again, functions are replaced and triggers dropped and
-- recreated. Adds six tables, three functions and nine triggers; changes no row.
--
-- WHY.
-- A professor teaching without phones (or alongside them) still learns a great
-- deal about the class: who understood when asked, who needed help, which bench
-- worked the problem out, how many hands went up for each option. Until now none
-- of it was kept. This is the store for it (roadmap step 3, "a teacher-record
-- store"), and the first part of the product that needs no student phone: a room
-- opened for a class (0016) with nobody joined can use every table here, from
-- its roster.
--
-- WHAT IS ADDED.
--   observations    the four private marks a professor puts on a student:
--                   understood, participated, revision (needs revision), support
--                   (needs additional support), with an optional note of at most
--                   280 characters. APPEND-ONLY: setting a mark is a new row, and
--                   so is clearing one (kind null). The mark in force for a
--                   student on a day is the latest row, so nothing a professor
--                   saw is ever lost and "at most one per student per class per
--                   day" is a rule of reading, kept by the server.
--     class_student_id / class_id
--                   the roster student, in a room opened for a class. In a room
--                   opened for no class both are null and the student is the
--                   room's roll number (roll_no). roll_no is always the roll
--                   number at the time, so a later roster correction does not
--                   rewrite what was written.
--     day           the day the room was opened, in India's time zone (the
--                   server's roomDay). A mark is about a class meeting, so a
--                   correction made the next morning is still that day's.
--
--   wheel_rounds    a round of the wheel: its number and its two settings
--                   (present only, no repeats). "Start new round" is a new row;
--                   nothing is deleted.
--   wheel_picks     one row per pick, drawn on the server with crypto randomness
--                   BEFORE any wheel turns on a screen. Who (roll_no, and the
--                   roster student), the order in the round, how many were on the
--                   wheel (pool_size) and under which settings: all written once.
--                   What they were asked (ask: bank, with an optional question of
--                   the room's, diagram or demo) and how they responded (status:
--                   pending, then answered, passed, help, skipped or absent) may
--                   change, since a professor fills them in as the class goes.
--
--   hand_tallies    one row per question asked aloud: its text (always kept, even
--                   when it came from the bank, so a later edit or delete of the
--                   question does not lose what was asked), the question's id if
--                   it came from the room's bank, labels for options A to D,
--                   the count of hands per option (never below 0), whether the
--                   answer was revealed, and the correct option if known.
--
--   room_activities one row per no-device activity run in a room: check (a quick
--                   knowledge check, which is a tally: tally_id), think, group,
--                   diagram or real, with a short outcome. A group challenge
--                   records GROUPS ("Bench 3: got it"), never students: groups is
--                   a list of { label, gotIt: yes | partly | no }.
--
--   insight_actions APPEND-ONLY: a professor dismissed or acted on a flag the
--                   server raised about the room (flag_id), with a note, and when.
--                   So a flag can always say what was done about it.
--
-- PRIVACY. Every table here is staff-only. Nothing in them is sent to a
-- student's phone, to the projector or to any route a student can reach, and
-- none of them is read by the Bloom-level ladder or any accuracy figure: they
-- never move a level (decision 3's safe default, docs/PRODUCT_DECISIONS.md). A
-- roster still holds a roll number and a name only; nothing here adds to what is
-- known about a student beyond what a professor records about their learning.
--
-- WHAT IS REFUSED.
--   A kind, status, ask, activity or action outside its list; a note or outcome
--   over 280 characters; a cleared observation with a note; a question for an
--   ask other than bank; a group list on anything but a group challenge; a tally
--   that is not four options; a count below 0 (23514).
--   An observation or a pick naming a student who is not on the roster of the
--   class its room was opened for; an observation whose class is not its room's;
--   an activity whose tally is another room's (23503).
--   Deleting any row here, except with its room (23001). Changing an
--   observation or an insight action at all, the draw of a pick (who, which
--   round, which place, from how many, under which settings), or the number of
--   a round (23001). Deleting a room deletes its records with it, after the
--   server has written them into the room's archive (room_archives, 0009).
--
-- RLS is on with no policies, like every table: only the server's service role
-- reads or writes, and the server decides who sees what.

-- ----------------------------------------------------------- the guard --

-- One rule for every table here, with the columns that may change passed as the
-- trigger's arguments (none for an append-only table):
--   DELETE  only inside a foreign key's action (pg_trigger_depth() > 1): the
--           cascade from deleting the room. A DELETE sent directly is depth 1.
--   UPDATE  only of the named columns; and inside a foreign key's action, a
--           column set to null (an account or a question deleted, ON DELETE SET
--           NULL). Anything else is refused, whoever sends it.
create or replace function public.teacher_records_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  changeable constant text[] := coalesce(tg_argv, '{}'::text[]);
  fixed_new jsonb;
  fixed_old jsonb;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    raise exception '% row % is a record of its room: it goes only when the room is deleted', tg_table_name, old.id
      using errcode = 'restrict_violation';
  end if;
  fixed_new := to_jsonb(new) - changeable;
  fixed_old := to_jsonb(old) - changeable;
  if fixed_new is not distinct from fixed_old then
    return new;
  end if;
  if pg_trigger_depth() > 1 and not exists (
    select 1 from jsonb_each(fixed_new) n
     where n.value is distinct from fixed_old -> n.key and n.value <> 'null'::jsonb
  ) then
    return new;
  end if;
  raise exception '% row % is kept as written: only % may change', tg_table_name, old.id,
    coalesce(nullif(array_to_string(changeable, ', '), ''), 'nothing')
    using errcode = 'restrict_violation';
end;
$$;

-- ------------------------------------------------------------ observations --

create table if not exists public.observations (
  id                uuid        primary key default gen_random_uuid(),
  session_id        uuid        not null references public.sessions (id) on delete cascade,
  -- No ON DELETE action: no route deletes a class, and a roster row with
  -- records is removed (removed_at), never deleted.
  class_id          uuid        references public.classes (id),
  class_student_id  uuid        references public.class_students (id),
  roll_no           text        not null,
  day               date        not null,
  kind              text,
  note              text        not null default '',
  observed_by       uuid        references public.accounts (id) on delete set null,
  observed_at       timestamptz not null default now()
);

alter table public.observations enable row level security;

alter table public.observations drop constraint if exists observations_kind_check;
alter table public.observations
  add constraint observations_kind_check check (kind is null or kind in ('understood', 'participated', 'revision', 'support'));
-- A cleared mark carries no note: the note belongs to the mark.
alter table public.observations drop constraint if exists observations_note_check;
alter table public.observations
  add constraint observations_note_check check (char_length(note) <= 280 and (kind is not null or note = ''));
-- A roster student and their class, or neither (a room opened for no class).
alter table public.observations drop constraint if exists observations_subject_check;
alter table public.observations
  add constraint observations_subject_check check ((class_id is null) = (class_student_id is null));
-- The room's form of a roll number: trimmed, single-spaced, upper case, and a
-- shape a phone can join with (class_students_roll_check, 0016, word for word).
alter table public.observations drop constraint if exists observations_roll_check;
alter table public.observations
  add constraint observations_roll_check check (
    roll_no ~ '^[A-Z0-9][A-Z0-9 ._/-]{0,23}$'
    and roll_no = upper(regexp_replace(regexp_replace(roll_no, '^\s+|\s+$', '', 'g'), '\s+', ' ', 'g'))
  );

-- A room's records (the archive), a class's day (the room's read), one student
-- across days, and the marker's foreign key.
create index if not exists observations_session_idx on public.observations (session_id);
create index if not exists observations_class_day_idx on public.observations (class_id, day) where class_id is not null;
create index if not exists observations_student_idx on public.observations (class_student_id, day) where class_student_id is not null;
create index if not exists observations_observer_idx on public.observations (observed_by) where observed_by is not null;

-- An observation is about a student of the class its room was opened for, or,
-- in a room opened for no class, about nobody's roster.
create or replace function public.observations_in_room_class()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.class_id is distinct from (select s.class_id from public.sessions s where s.id = new.session_id) then
    raise exception 'observation names class % but room % was opened for another class or none', new.class_id, new.session_id
      using errcode = 'foreign_key_violation';
  end if;
  if new.class_student_id is not null and not exists (
    select 1 from public.class_students cs where cs.id = new.class_student_id and cs.class_id = new.class_id
  ) then
    raise exception 'student % is not on the roster of class %', new.class_student_id, new.class_id
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists observations_in_room_class on public.observations;
create trigger observations_in_room_class
  before insert on public.observations
  for each row execute function public.observations_in_room_class();

drop trigger if exists observations_append_only on public.observations;
create trigger observations_append_only
  before update or delete on public.observations
  for each row execute function public.teacher_records_guard();

-- ------------------------------------------------------------ wheel_rounds --

create table if not exists public.wheel_rounds (
  id            uuid        primary key default gen_random_uuid(),
  session_id    uuid        not null references public.sessions (id) on delete cascade,
  round         integer     not null,
  present_only  boolean     not null default true,
  no_repeat     boolean     not null default true,
  started_at    timestamptz not null default now(),
  started_by    uuid        references public.accounts (id) on delete set null,
  -- Also the index for reading a room's rounds, and what a pick's round points at.
  constraint wheel_rounds_session_round_key unique (session_id, round)
);

alter table public.wheel_rounds enable row level security;

alter table public.wheel_rounds drop constraint if exists wheel_rounds_round_check;
alter table public.wheel_rounds add constraint wheel_rounds_round_check check (round >= 1);

create index if not exists wheel_rounds_starter_idx on public.wheel_rounds (started_by) where started_by is not null;

drop trigger if exists wheel_rounds_keep_history on public.wheel_rounds;
create trigger wheel_rounds_keep_history
  before update or delete on public.wheel_rounds
  for each row execute function public.teacher_records_guard('present_only', 'no_repeat');

-- ------------------------------------------------------------- wheel_picks --

create table if not exists public.wheel_picks (
  id                uuid        primary key default gen_random_uuid(),
  session_id        uuid        not null references public.sessions (id) on delete cascade,
  round             integer     not null,
  pick_order        integer     not null,
  roll_no           text        not null,
  -- The roster student, in a room opened for a class; null for a phone that
  -- joined with a roll number off the roster, and in a room with no class.
  class_student_id  uuid        references public.class_students (id),
  -- How many were on the wheel when this pick was drawn: each had 1 / pool_size.
  pool_size         integer     not null,
  present_only      boolean     not null,
  no_repeat         boolean     not null,
  ask               text        not null default 'bank',
  question_id       uuid        references public.questions (id) on delete set null,
  status            text        not null default 'pending',
  picked_at         timestamptz not null default now(),
  picked_by         uuid        references public.accounts (id) on delete set null,
  status_at         timestamptz,
  status_by         uuid        references public.accounts (id) on delete set null,
  -- One place per pick in a round. Also the index for reading a room's picks.
  constraint wheel_picks_session_round_order_key unique (session_id, round, pick_order),
  constraint wheel_picks_round_fkey foreign key (session_id, round)
    references public.wheel_rounds (session_id, round) on delete cascade
);

alter table public.wheel_picks enable row level security;

alter table public.wheel_picks drop constraint if exists wheel_picks_order_check;
alter table public.wheel_picks
  add constraint wheel_picks_order_check check (round >= 1 and pick_order >= 1 and pool_size >= 1);
-- 'verbal' is 0034's (Batch 8). It is listed here too because re-running this
-- file must never narrow the check below what a later file allows: a re-run
-- with a verbal pick in the table would otherwise fail.
alter table public.wheel_picks drop constraint if exists wheel_picks_ask_check;
alter table public.wheel_picks
  add constraint wheel_picks_ask_check
  check (ask in ('bank', 'diagram', 'demo', 'verbal') and (ask = 'bank' or question_id is null));
alter table public.wheel_picks drop constraint if exists wheel_picks_status_check;
alter table public.wheel_picks
  add constraint wheel_picks_status_check check (
    status in ('pending', 'answered', 'passed', 'help', 'skipped', 'absent')
    and (status = 'pending') = (status_at is null)
  );
alter table public.wheel_picks drop constraint if exists wheel_picks_roll_check;
alter table public.wheel_picks
  add constraint wheel_picks_roll_check check (
    roll_no ~ '^[A-Z0-9][A-Z0-9 ._/-]{0,23}$'
    and roll_no = upper(regexp_replace(regexp_replace(roll_no, '^\s+|\s+$', '', 'g'), '\s+', ' ', 'g'))
  );

create index if not exists wheel_picks_student_idx on public.wheel_picks (class_student_id) where class_student_id is not null;
create index if not exists wheel_picks_question_idx on public.wheel_picks (question_id) where question_id is not null;
create index if not exists wheel_picks_picker_idx on public.wheel_picks (picked_by) where picked_by is not null;
create index if not exists wheel_picks_status_by_idx on public.wheel_picks (status_by) where status_by is not null;

-- A roster student on a pick is on the roster of the room's class: 0016's rule
-- for attendance, which reads the same two columns.
drop trigger if exists wheel_picks_student_in_room_class on public.wheel_picks;
create trigger wheel_picks_student_in_room_class
  before insert on public.wheel_picks
  for each row when (new.class_student_id is not null)
  execute function public.attendance_student_in_room_class();

drop trigger if exists wheel_picks_keep_draw on public.wheel_picks;
create trigger wheel_picks_keep_draw
  before update or delete on public.wheel_picks
  for each row execute function public.teacher_records_guard('ask', 'question_id', 'status', 'status_at', 'status_by');

-- ------------------------------------------------------------ hand_tallies --

create table if not exists public.hand_tallies (
  id              uuid        primary key default gen_random_uuid(),
  session_id      uuid        not null references public.sessions (id) on delete cascade,
  seq             integer     not null,
  question_id     uuid        references public.questions (id) on delete set null,
  question_text   text        not null,
  option_labels   text[]      not null default '{"","","",""}',
  counts          integer[]   not null default '{0,0,0,0}',
  revealed        boolean     not null default false,
  correct_option  smallint,
  created_at      timestamptz not null default now(),
  created_by      uuid        references public.accounts (id) on delete set null,
  updated_at      timestamptz not null default now(),
  -- The order a room's questions were asked in. Also the index for reading them.
  constraint hand_tallies_session_seq_key unique (session_id, seq)
);

alter table public.hand_tallies enable row level security;

alter table public.hand_tallies drop constraint if exists hand_tallies_seq_check;
alter table public.hand_tallies add constraint hand_tallies_seq_check check (seq >= 1);
alter table public.hand_tallies drop constraint if exists hand_tallies_text_check;
alter table public.hand_tallies
  add constraint hand_tallies_text_check check (char_length(btrim(question_text)) between 1 and 1000);
alter table public.hand_tallies drop constraint if exists hand_tallies_labels_check;
alter table public.hand_tallies
  add constraint hand_tallies_labels_check check (
    cardinality(option_labels) = 4 and array_position(option_labels, null) is null
    and char_length(array_to_string(option_labels, '')) <= 800
  );
-- Never below 0, whoever writes.
alter table public.hand_tallies drop constraint if exists hand_tallies_counts_check;
alter table public.hand_tallies
  add constraint hand_tallies_counts_check check (
    cardinality(counts) = 4 and array_position(counts, null) is null and 0 <= all (counts)
  );
alter table public.hand_tallies drop constraint if exists hand_tallies_correct_check;
alter table public.hand_tallies
  add constraint hand_tallies_correct_check check (correct_option is null or correct_option between 0 and 3);

create index if not exists hand_tallies_question_idx on public.hand_tallies (question_id) where question_id is not null;
create index if not exists hand_tallies_creator_idx on public.hand_tallies (created_by) where created_by is not null;

drop trigger if exists hand_tallies_keep_history on public.hand_tallies;
create trigger hand_tallies_keep_history
  before update or delete on public.hand_tallies
  for each row execute function public.teacher_records_guard(
    'question_id', 'question_text', 'option_labels', 'counts', 'revealed', 'correct_option', 'updated_at');

-- --------------------------------------------------------- room_activities --

create table if not exists public.room_activities (
  id          uuid        primary key default gen_random_uuid(),
  session_id  uuid        not null references public.sessions (id) on delete cascade,
  seq         integer     not null,
  kind        text        not null,
  outcome     text        not null default '',
  groups      jsonb       not null default '[]'::jsonb,
  tally_id    uuid        references public.hand_tallies (id) on delete set null,
  created_at  timestamptz not null default now(),
  created_by  uuid        references public.accounts (id) on delete set null,
  updated_at  timestamptz not null default now(),
  constraint room_activities_session_seq_key unique (session_id, seq)
);

alter table public.room_activities enable row level security;

alter table public.room_activities drop constraint if exists room_activities_seq_check;
alter table public.room_activities add constraint room_activities_seq_check check (seq >= 1);
alter table public.room_activities drop constraint if exists room_activities_kind_check;
alter table public.room_activities
  add constraint room_activities_kind_check check (kind in ('check', 'think', 'group', 'diagram', 'real'));
alter table public.room_activities drop constraint if exists room_activities_outcome_check;
alter table public.room_activities
  add constraint room_activities_outcome_check check (char_length(outcome) <= 280);
-- Groups, not students, and only on a group challenge.
alter table public.room_activities drop constraint if exists room_activities_groups_check;
alter table public.room_activities
  add constraint room_activities_groups_check check (
    jsonb_typeof(groups) = 'array' and jsonb_array_length(groups) <= 100
    and (kind = 'group' or groups = '[]'::jsonb)
  );
-- A quick knowledge check is recorded as a tally; nothing else points at one.
alter table public.room_activities drop constraint if exists room_activities_tally_check;
alter table public.room_activities
  add constraint room_activities_tally_check check (kind = 'check' or tally_id is null);

create index if not exists room_activities_tally_idx on public.room_activities (tally_id) where tally_id is not null;
create index if not exists room_activities_creator_idx on public.room_activities (created_by) where created_by is not null;

-- The tally a quick check points at was asked in the same room.
create or replace function public.room_activities_same_room()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tally_id is not null and not exists (
    select 1 from public.hand_tallies t where t.id = new.tally_id and t.session_id = new.session_id
  ) then
    raise exception 'room_activities: tally % was not asked in room %', new.tally_id, new.session_id
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists room_activities_same_room on public.room_activities;
create trigger room_activities_same_room
  before insert or update of tally_id on public.room_activities
  for each row execute function public.room_activities_same_room();

drop trigger if exists room_activities_keep_history on public.room_activities;
create trigger room_activities_keep_history
  before update or delete on public.room_activities
  for each row execute function public.teacher_records_guard('outcome', 'groups', 'tally_id', 'updated_at');

-- --------------------------------------------------------- insight_actions --

create table if not exists public.insight_actions (
  id          uuid        primary key default gen_random_uuid(),
  session_id  uuid        not null references public.sessions (id) on delete cascade,
  flag_id     text        not null,
  action      text        not null,
  note        text        not null default '',
  acted_by    uuid        references public.accounts (id) on delete set null,
  acted_at    timestamptz not null default now()
);

alter table public.insight_actions enable row level security;

alter table public.insight_actions drop constraint if exists insight_actions_flag_check;
alter table public.insight_actions
  add constraint insight_actions_flag_check check (
    char_length(btrim(flag_id)) between 1 and 120 and flag_id !~ '[[:cntrl:]]'
  );
alter table public.insight_actions drop constraint if exists insight_actions_action_check;
alter table public.insight_actions
  add constraint insight_actions_action_check check (action in ('dismissed', 'acted'));
alter table public.insight_actions drop constraint if exists insight_actions_note_check;
alter table public.insight_actions
  add constraint insight_actions_note_check check (char_length(note) <= 280);

create index if not exists insight_actions_session_idx on public.insight_actions (session_id, acted_at);
create index if not exists insight_actions_actor_idx on public.insight_actions (acted_by) where acted_by is not null;

drop trigger if exists insight_actions_append_only on public.insight_actions;
create trigger insight_actions_append_only
  before update or delete on public.insight_actions
  for each row execute function public.teacher_records_guard();

comment on table public.observations is
  'A professor''s private mark on a student (understood, participated, revision, support) with an optional note. Append-only: the mark in force for a student on a day is the latest row; kind null clears it. Staff-only; never moves a level.';
comment on table public.wheel_rounds is
  'A round of the wheel and its settings (present only, no repeats). A new round is a new row; nothing is deleted.';
comment on table public.wheel_picks is
  'One pick of the wheel, drawn on the server. Who, the round, the order and the pool are written once; ask and status are filled in as the class goes.';
comment on table public.hand_tallies is
  'One question asked aloud: its text, options A to D, hands per option (never below 0), revealed, the correct option if known.';
comment on table public.room_activities is
  'A no-device activity run in a room (check, think, group, diagram, real) with its outcome. A group challenge records groups, never students.';
comment on table public.insight_actions is
  'Append-only: a professor dismissed or acted on a flag about the room, and when.';
