-- Per-student accommodations.
--
-- Run order for a fresh project:
--   schema.sql -> 002_invites -> 003_student_google_link -> 004_invite_google_sub
--   -> 005_sessions_and_profiles_v2 -> 006 (this file)
--
-- Idempotent, so it is a no-op against the live project and does the work against
-- a new one. Same rule as 005: a migration applied through tooling and never
-- committed is undocumented drift that happens to work on one machine.
--
-- WHY THIS HANGS OFF accounts AND NOT OFF A SESSION, A QUESTION OR A CLASS.
--
-- A support is a fact about a person, not about a piece of work. Put it on the
-- assessment and a teacher sets it again on every bank, every room and every
-- term - which in practice means they set it on the first one, forget it on the
-- fourth, and the student who needed larger type sits an exam without it. Put it
-- on the account and it is set once, by the professor the student reports to, and
-- every room that student ever walks into reads it on the way in. That is the one
-- design decision worth copying wholesale from the competitor, and it is why this
-- is a column here rather than a table keyed by (student, session).
--
-- WHY jsonb AND NOT SEVEN BOOLEAN COLUMNS.
--
-- The set of supports is going to grow - speech-to-text, translation, a
-- calculator - and each of those is a migration, a repo mapping and a deploy if
-- it is a column. The vocabulary lives in server/src/accommodations.js, which is
-- the only thing allowed to decide what a support IS; this column stores whatever
-- that file says is on. The check below is the whole of the database's opinion on
-- the matter: it must be an object, so that a['largerText'] is always a legal
-- read and never an error against an array or a scalar somebody stored here.
--
-- WHAT IS DELIBERATELY NOT HERE.
--
-- No column, index, view or flag anywhere records that a student HAS supports in
-- a place a report, an export or a live grid would pick up. Everything that is
-- read about a student in front of other people - profiles, the grid row, the CSV
-- - is untouched by this file on purpose. A support that shows up in a roster is
-- a support that has singled out the person it was meant to help.

alter table public.accounts
  add column if not exists accommodations jsonb not null default '{}'::jsonb;

-- Dropped first so re-running this file against a project that already has the
-- constraint does not fail on the duplicate name.
alter table public.accounts drop constraint if exists accounts_accommodations_object;
alter table public.accounts
  add constraint accounts_accommodations_object
  check (jsonb_typeof(accommodations) = 'object');

comment on column public.accounts.accommodations is
  'Per-student learning supports, as {supportKey: true}. Absence is off, so this '
  'object holds only what is switched on. The vocabulary - which keys exist and '
  'what each one does - is server/src/accommodations.js and nowhere else; this '
  'column stores the answer, never the question. Applied silently: nothing about '
  'it may appear on a grid, an export or a screen a classmate can see.';
