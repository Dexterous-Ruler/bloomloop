-- 0018: how a room runs (its mode and the rest of its settings), the waiting
-- room, and projector links.
--
-- Apply in number order with the rest of supabase/migrations (see
-- supabase/README.md). Needs sessions (0000, 0005), accounts (0001),
-- sessions.class_id (0016) and 0017's function teacher_records_guard(), which
-- projector_links reuses. Idempotent: columns, the table and indexes are created
-- only if missing, constraints are dropped by name and added again, and the
-- trigger is dropped and recreated. Adds five columns, one table and one
-- trigger, and widens one constraint; changes no row. Every existing room gets
-- the values that reproduce exactly how it ran: Student devices, adapting, from
-- Understand, no cap on questions and no time per question. No existing room is
-- 'waiting', since the status could not hold that value before.
--
-- WHY.
-- A room had three settings (0007) and a question set (0015). The handoff's room
-- screen has more, and roadmap step 2 named them: how students answer (on their
-- phones, with no phones at all, or both), whether the level adapts, where it
-- starts, how many questions each student gets, how long each may take, and a
-- waiting room so a class can join before the first question is served. And a
-- classroom projector is often another machine with nobody signed in on it: it
-- needs a link of its own that shows the class only what is meant for a wall.
--
-- WHAT IS ADDED.
--   sessions.mode     'devices' (phones answer, as every room before this),
--                     'teacher-led' (no phone is served: the professor runs the
--                     class with the wheel, the tally, observations and the
--                     projector) or 'mixed' (phones answer, and teacher records
--                     come in beside them). Written once, when the room opens.
--                     A teacher-led room must have a class (class_id): it works
--                     from the roster, since no phone joins it.
--   sessions.adapt    true: the ladder moves students up and down as before.
--                     false: a student stays at the start level; accuracy is
--                     still recorded. The below-40% ceiling still applies
--                     (CONTRACT.md section 6 rule 4): it is not the ladder.
--   sessions.start_level
--                     the level every student starts at. 'understand' is the
--                     level every room has always started at.
--   sessions.questions_per_student
--                     null: no cap, as before. Otherwise the most questions one
--                     student is served in the room, 1 to 500.
--   sessions.time_per_question
--                     null: no limit, as before. Otherwise seconds, 10 to 600,
--                     sent to the phone with each question. The phone times it;
--                     the server refuses no answer for being late (phones are
--                     slow on hall wifi), and an answer's served_at and
--                     answered_at already say how long it took.
--   sessions.status   gains 'waiting': a room opened with a waiting room. Phones
--                     may join it and are served nothing until the professor
--                     starts it, which makes it 'open'.
--
--   projector_links   a link for a classroom projector, one room each. The token
--                     is random (256 bits) and handed to the professor once;
--                     only its SHA-256 is kept here (token_hash), so a database
--                     read cannot be turned into a working link. A link works
--                     only while its room is not closed and it is not revoked
--                     (the server checks both on every connection). A projector
--                     sees a whitelist of what is safe on a wall: never a
--                     student's score, accuracy, band, observation or answer
--                     key before it is revealed (server/src/services/projector.js).
--     revoked_at / revoked_by
--                     when and by whom it was revoked. A revoked link is kept, so
--                     a room can say which links were made and when.
--
-- WHAT IS REFUSED.
--   A mode, start level or status outside its list; a cap outside 1 to 500; a
--   time outside 10 to 600 seconds; a teacher-led room with no class; a token
--   hash that is not 64 lower-case hex characters; revoked_by without revoked_at
--   (23514). Two links with one token (23505).
--   Changing a link's room, token or creation, or deleting a link, except with
--   its room (23001, 0017's guard: only revoked_at and revoked_by may change).
--
-- RLS is on with no policies, like every table: only the server's service role
-- reads or writes, and the server decides who sees what.

-- --------------------------------------------------------------- sessions --

alter table public.sessions drop constraint if exists sessions_status_check;
alter table public.sessions
  add constraint sessions_status_check check (status in ('waiting', 'open', 'paused', 'closed'));

alter table public.sessions add column if not exists mode text not null default 'devices';
alter table public.sessions drop constraint if exists sessions_mode_check;
alter table public.sessions
  add constraint sessions_mode_check check (mode in ('devices', 'teacher-led', 'mixed'));
-- No phone joins a teacher-led room, so the roster is the only list of who is
-- in it: the wheel, attendance and observations all work from it.
alter table public.sessions drop constraint if exists sessions_teacher_led_class_check;
alter table public.sessions
  add constraint sessions_teacher_led_class_check check (mode <> 'teacher-led' or class_id is not null);

alter table public.sessions add column if not exists adapt boolean not null default true;

alter table public.sessions add column if not exists start_level text not null default 'understand';
alter table public.sessions drop constraint if exists sessions_start_level_check;
alter table public.sessions
  add constraint sessions_start_level_check check (
    start_level in ('remember', 'understand', 'apply', 'analyse', 'evaluate', 'create'));

alter table public.sessions add column if not exists questions_per_student smallint;
alter table public.sessions drop constraint if exists sessions_questions_per_student_check;
alter table public.sessions
  add constraint sessions_questions_per_student_check check (
    questions_per_student is null or questions_per_student between 1 and 500);

alter table public.sessions add column if not exists time_per_question smallint;
alter table public.sessions drop constraint if exists sessions_time_per_question_check;
alter table public.sessions
  add constraint sessions_time_per_question_check check (
    time_per_question is null or time_per_question between 10 and 600);

comment on column public.sessions.mode is
  'devices: phones answer. teacher-led: no phone is served; needs a class. mixed: phones answer and teacher records come in beside them. Written once.';
comment on column public.sessions.adapt is
  'false: students stay at start_level (the below-40% ceiling still applies). Accuracy is recorded either way. Written once.';
comment on column public.sessions.start_level is
  'The level every student starts at. understand is what every room started at before this column. Written once.';
comment on column public.sessions.questions_per_student is
  'The most questions one student is served in the room; null for no cap. Written once.';
comment on column public.sessions.time_per_question is
  'Seconds per question, sent to phones, which time it. Null for none. A late answer is never refused. Written once.';

-- --------------------------------------------------------- projector_links --

create table if not exists public.projector_links (
  id          uuid        primary key default gen_random_uuid(),
  session_id  uuid        not null references public.sessions (id) on delete cascade,
  -- Unique, which is also the index a projector's connection is looked up by.
  token_hash  text        not null,
  created_at  timestamptz not null default now(),
  created_by  uuid        references public.accounts (id) on delete set null,
  revoked_at  timestamptz,
  revoked_by  uuid        references public.accounts (id) on delete set null,
  constraint projector_links_token_hash_key unique (token_hash)
);

alter table public.projector_links enable row level security;

alter table public.projector_links drop constraint if exists projector_links_token_hash_check;
alter table public.projector_links
  add constraint projector_links_token_hash_check check (token_hash ~ '^[0-9a-f]{64}$');
alter table public.projector_links drop constraint if exists projector_links_revoked_check;
alter table public.projector_links
  add constraint projector_links_revoked_check check (revoked_by is null or revoked_at is not null);

-- A room's links, and the foreign keys' own indexes.
create index if not exists projector_links_session_idx on public.projector_links (session_id);
create index if not exists projector_links_creator_idx on public.projector_links (created_by) where created_by is not null;
create index if not exists projector_links_revoker_idx on public.projector_links (revoked_by) where revoked_by is not null;

drop trigger if exists projector_links_keep on public.projector_links;
create trigger projector_links_keep
  before update or delete on public.projector_links
  for each row execute function public.teacher_records_guard('revoked_at', 'revoked_by');

comment on table public.projector_links is
  'A read-only link for a classroom projector, one room each. Only the SHA-256 of the token is kept. Works while the room is not closed and the link is not revoked.';
