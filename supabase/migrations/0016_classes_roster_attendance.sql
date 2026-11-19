-- 0016: classes, their rosters, rooms opened for a class, and attendance.
--
-- Apply in number order with the rest of supabase/migrations (see
-- supabase/README.md). Needs accounts (0001) and sessions (0000). Idempotent:
-- tables, the column and indexes are created only if missing, constraints are
-- dropped by name and added again, the function is replaced and the trigger
-- dropped and recreated. Adds three tables, one column, one function and one
-- trigger; changes no row. Every existing room gets class_id null, which is a
-- room with no class: it behaves exactly as before.
--
-- WHY.
-- A room has only ever known the phones that joined it. A professor teaches a
-- class: a course and a section with a list of students, most of whom join and
-- some of whom do not. Without that list the product cannot say "36 / 40
-- present", cannot tell a student who stayed away from one who was never
-- enrolled, and has nothing to hang attendance, the wheel or class analytics on
-- (roadmap step 3, "the roster and teacher-record store").
--
-- WHAT IS ADDED.
--   classes           a professor's class: course name, section ('TY-CSF B') and
--                     an optional term label. owner_id is the professor; null on
--                     the shared teacher key, which then is the only path that
--                     reaches it (server/src/ownership.js, as for contents).
--
--   class_students    the roster. A roll number and a name, and NOTHING else: no
--                     phone number, email, date of birth or photo, here or in any
--                     later migration, without the owner deciding so. The server
--                     refuses a name that looks like it carries an email address
--                     or a phone number (services/roster.js).
--     roll_no         stored in the room's form: trimmed, single-spaced, upper
--                     case, and a shape a phone can join with (ROLL_SHAPE in
--                     services/roster.js, the same rule the live loop applies).
--                     So a phone typing ' 21cs01 ' is this roster's '21CS01', and
--                     one roll number is one student per class
--                     (class_students_class_roll_key). '03' and '3' stay two roll
--                     numbers, as they are to the live room.
--     removed_at      a student is never deleted from a roster, only removed:
--                     their answers live under their roll number in each room and
--                     their attendance rows point here, and both must outlive a
--                     correction to the list. Null is on the roster.
--
--   sessions.class_id the class a room was opened for, or null. Written once, when
--                     the room is opened (POST /api/session), never updated.
--
--   attendance        one row per (room, roster student): present, absent or late.
--     source          'joined': a phone joined the room with that roll number, so
--                     the server marked the student present. A typed roll number
--                     is not proof of who is holding the phone (decision 7's
--                     known gap, docs/PRODUCT_DECISIONS.md): 'joined' says what
--                     happened, not who was there.
--                     'teacher': the professor marked it. A professor's mark is
--                     never replaced by a later join.
--     marked_by       the professor's account; null for a join and on the shared
--                     key, and cleared if that account is deleted.
--     A student with no row is UNMARKED, which is not the same as absent.
--
-- WHAT IS REFUSED.
--   A roll number not in the room's form, or not a shape a phone can send (23514).
--   A name that is blank or over 80 characters (23514).
--   A 'joined' row that is anything but present, or that names a marker (23514).
--   Attendance for a student who is not on the roster of the class the room was
--   opened for, or in a room opened for no class (23503,
--   attendance_student_in_room_class).
--   Deleting a roster row that has attendance (23503): remove it instead
--   (removed_at). Deleting a room deletes its attendance with it, after the
--   server has written the room, attendance included, to room_archives (0009).
--
-- RLS is on with no policies, like every table: only the server's service role
-- reads or writes, and the server decides who sees what.

-- ----------------------------------------------------------------- classes --

create table if not exists public.classes (
  id           uuid        primary key default gen_random_uuid(),
  -- No ON DELETE action: an account that owns a class cannot be deleted out from
  -- under it, as for contents and sessions (0001).
  owner_id     uuid        references public.accounts (id),
  course_name  text        not null,
  section      text        not null,
  term_label   text        not null default '',
  created_at   timestamptz not null default now(),
  -- No trigger maintains this; the server sets it on every update.
  updated_at   timestamptz not null default now()
);

alter table public.classes enable row level security;

alter table public.classes drop constraint if exists classes_course_name_check;
alter table public.classes
  add constraint classes_course_name_check check (char_length(btrim(course_name)) between 1 and 120);
alter table public.classes drop constraint if exists classes_section_check;
alter table public.classes
  add constraint classes_section_check check (char_length(btrim(section)) between 1 and 40);
alter table public.classes drop constraint if exists classes_term_label_check;
alter table public.classes
  add constraint classes_term_label_check check (char_length(term_label) <= 40);

create index if not exists classes_owner_idx on public.classes (owner_id);

-- ---------------------------------------------------------- class_students --

create table if not exists public.class_students (
  id          uuid        primary key default gen_random_uuid(),
  class_id    uuid        not null references public.classes (id) on delete cascade,
  roll_no     text        not null,
  name        text        not null,
  added_at    timestamptz not null default now(),
  removed_at  timestamptz,
  -- Also the index for reading one class's roster.
  constraint class_students_class_roll_key unique (class_id, roll_no)
);

alter table public.class_students enable row level security;

-- The room's form (normaliseRoll in server/src/sockets/index.js, rollKey in
-- services/accounts.js), and a shape a phone can join with. Postgres's \s is
-- ASCII whitespace; the shape admits only the space, so the two agree.
alter table public.class_students drop constraint if exists class_students_roll_check;
alter table public.class_students
  add constraint class_students_roll_check check (
    roll_no ~ '^[A-Z0-9][A-Z0-9 ._/-]{0,23}$'
    and roll_no = upper(regexp_replace(regexp_replace(roll_no, '^\s+|\s+$', '', 'g'), '\s+', ' ', 'g'))
  );
alter table public.class_students drop constraint if exists class_students_name_check;
alter table public.class_students
  add constraint class_students_name_check check (char_length(btrim(name)) between 1 and 80);

-- ------------------------------------------------------- sessions.class_id --

alter table public.sessions add column if not exists class_id uuid references public.classes (id);

-- A class's rooms, and the foreign key's own index so a class row is never
-- checked against every room.
create index if not exists sessions_class_idx on public.sessions (class_id) where class_id is not null;

-- -------------------------------------------------------------- attendance --

create table if not exists public.attendance (
  id                uuid        primary key default gen_random_uuid(),
  session_id        uuid        not null references public.sessions (id) on delete cascade,
  -- No ON DELETE action: a roster row with attendance is removed, never deleted.
  class_student_id  uuid        not null references public.class_students (id),
  status            text        not null,
  source            text        not null,
  marked_at         timestamptz not null default now(),
  marked_by         uuid        references public.accounts (id) on delete set null,
  -- One mark per student per room. Also the index for reading a room's marks.
  constraint attendance_session_student_key unique (session_id, class_student_id)
);

alter table public.attendance enable row level security;

alter table public.attendance drop constraint if exists attendance_status_check;
alter table public.attendance
  add constraint attendance_status_check check (status in ('present', 'absent', 'late'));
alter table public.attendance drop constraint if exists attendance_source_check;
alter table public.attendance
  add constraint attendance_source_check check (source in ('joined', 'teacher'));
-- A join only ever marks a student present, and nobody marked it.
alter table public.attendance drop constraint if exists attendance_joined_check;
alter table public.attendance
  add constraint attendance_joined_check check (source = 'teacher' or (status = 'present' and marked_by is null));

-- The foreign keys' own indexes, so removing a marker's account or checking a
-- roster row does not scan every room's attendance.
create index if not exists attendance_student_idx on public.attendance (class_student_id);
create index if not exists attendance_marker_idx on public.attendance (marked_by) where marked_by is not null;

-- A mark belongs to a student on the roster of the class the room was opened
-- for. The server only ever writes such marks; this stops any other kind
-- arriving from anywhere else, including a room opened for no class.
create or replace function public.attendance_student_in_room_class()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
      from public.sessions s
      join public.class_students cs on cs.class_id = s.class_id
     where s.id = new.session_id and cs.id = new.class_student_id
  ) then
    raise exception 'student % is not on the roster of the class room % was opened for', new.class_student_id, new.session_id
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists attendance_student_in_room_class on public.attendance;
create trigger attendance_student_in_room_class
  before insert or update of session_id, class_student_id on public.attendance
  for each row execute function public.attendance_student_in_room_class();

comment on table public.classes is
  'A professor''s class: course, section, optional term. Its roster is class_students.';
comment on table public.class_students is
  'A class roster: a roll number (in the room''s form) and a name only. Removed, never deleted (removed_at).';
comment on column public.sessions.class_id is
  'The class this room was opened for, or null. Written once, when the room is opened.';
comment on table public.attendance is
  'One mark per (room, roster student). source joined: a phone joined with that roll number (not proof of identity); teacher: the professor marked it, and a later join never replaces it. No row: unmarked.';
