-- v2 catch-up: everything phases 4, 5 and 6 added to sessions and profiles.
--
-- WHY THIS FILE EXISTS, because it is worth not repeating:
--
-- These columns were applied straight to the live project through tooling while
-- the phases were being built. That worked, and it left the repository lying:
-- schema.sql plus 002-004 describes a database that no longer matches the one
-- the code expects. Anyone setting up a fresh project from this repo - a second
-- environment, a teammate, a marker rebuilding it in six months - would get a
-- database where the first saveProfile() of the first session fails, because
-- served_id does not exist.
--
-- A migration applied but never committed is not a migration; it is undocumented
-- production drift that happens to work on one machine. This file closes that.
--
-- Idempotent throughout, so it is safe to run against the live project (where it
-- is a no-op) and against a brand-new one (where it does the work).
--
-- Run order for a fresh project:
--   schema.sql -> 002_invites -> 003_student_google_link -> 004_invite_google_sub -> 005 (this file)

-- ------------------------------------------------------------------ sessions

-- Phase 4/5: a room can be paused. 'paused' keeps every student connected and
-- resumes them exactly where they stopped; 'closed' is final and cannot reopen.
-- Before this the only way to interrupt a class was to end it.
alter table public.sessions drop constraint if exists sessions_status_check;
alter table public.sessions
  add constraint sessions_status_check check (status in ('open', 'paused', 'closed'));

alter table public.sessions add column if not exists paused_at timestamptz;

-- The rooms management screen lists newest first, on every load.
create index if not exists sessions_started_idx on public.sessions (started_at desc);

-- ------------------------------------------------------------------ profiles

-- Phase 5: WHICH question this student is currently on.
--
-- Their levels and history already survived a closed tab; the question in front
-- of them did not. On reconnect the selector simply chose again, so a student
-- who lost their browser mid-question came back to a DIFFERENT one - the
-- half-finished answer was not merely lost, it was unanswerable.
--
-- Deliberately server-side. A phone that died is a phone whose local storage we
-- will never see again, and the whole point of the requirement was that the
-- server is the thing that remembers.
alter table public.profiles add column if not exists served_id  text;
alter table public.profiles add column if not exists served_at  timestamptz;
alter table public.profiles add column if not exists served_why text;

-- Phase 6: the integrity event list.
--
-- Append-only, so a teacher can always see WHAT happened and WHEN rather than a
-- score with no way to check it. NOT NULL with a default because every read path
-- treats it as an array; a null here would mean every summarise() call needed a
-- guard it does not have.
alter table public.profiles add column if not exists integrity jsonb not null default '[]'::jsonb;

-- The signed-in student behind a roll number, where there is one.
--
-- Nullable on purpose and permanently: a live session identifies a student by
-- the number they type on a phone, and joining a room has never required an
-- account. This links the two when both exist, and costs nothing when they do
-- not. ON DELETE SET NULL because deleting an account must not delete the marks
-- that were earned under that roll number.
alter table public.profiles add column if not exists account_id uuid
  references public.accounts (id) on delete set null;

create index if not exists profiles_account_idx on public.profiles (account_id);

comment on column public.profiles.served_id is
  'The question this student is currently on, so a closed tab resumes the same item rather than a fresh one.';
comment on column public.profiles.integrity is
  'Append-only integrity signals. See server/src/services/integrity.js - these are signals, never proof.';
