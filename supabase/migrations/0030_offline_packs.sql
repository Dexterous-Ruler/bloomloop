-- 0030: question packs, the phone's own answer time and the log of serves
-- (Phase 7, stage "Next").
--
-- Apply in number order with the rest of supabase/migrations (see
-- supabase/README.md). Needs sessions (0000), profiles (0000) and answers
-- (0008, 0012). 0025 to 0029 belong to Phase 6 (the Learning Hub), built beside
-- this; nothing here reads or touches anything of theirs. Idempotent: the
-- table, its index, its guard and the two columns are created only if missing,
-- and the checks and the trigger are dropped and added again with the same
-- definitions. One table, one nullable column and one column with a constant
-- default, no backfill: no existing row is rewritten (Postgres keeps a constant
-- default without touching the rows), every answer before this file reads as
-- one whose phone sent no time of its own, and every profile before it as one
-- with no serves logged.
--
-- WHAT IS ADDED, and why (decisions O2 and O3 of 19 Nov 2026, taken under the
-- owner's delegation; docs/OFFLINE_SELECTION.md):
--
--   question_packs     one row each time the server hands a phone a pack of the
--                      questions it would be served next, for use while its
--                      connection is down: the room, the roll number, the
--                      questions (ids only: the questions as shown are the
--                      bank's, sent without their keys), when it was sent and
--                      when the phone should stop working from it. An answer to
--                      a question in a pack this phone was sent is an answer to
--                      a question the server served it: it is taken as served
--                      in an open room, and counts when it arrives within the
--                      grace window after the room closed. Written once: a new
--                      pack is a new row, never an edit (question_packs_written_once),
--                      and a row goes only with its room.
--   answers.device_answered_at
--                      the time the phone says the student answered, sent with
--                      an answer that waited on the phone. Kept for the record
--                      only: the server never trusts a device's clock, so the
--                      order answers are marked in, and whether one counts, are
--                      read from when the server received it (answered_at).
--                      Null for every answer whose phone sent no time. Written
--                      once, like every answer column 0012 does not list.
--   profiles.served_log
--                      every question the server put on this phone's screen,
--                      the first time each: [{ questionId, at }], at most 500
--                      (added by the review fixes of 19 Nov 2026). The pin
--                      (served_id, served_at) says only what is on the screen
--                      now and moves on without the old question being answered
--                      (a failed save and "Next question", a pin no longer
--                      servable at a rejoin), so an answer to the old question
--                      arriving after the close was taken for one the phone was
--                      never given, and not counted. Written with the pin, in
--                      the same profile write.
--
-- WHAT IS NOT CHANGED. No answer is rewritten, and 0012's guard is not
-- touched: it already refuses a change to any answer column it does not list,
-- which now includes device_answered_at. An answer that arrives after its room
-- closed and does not count is an ordinary answers row with final = false and
-- a detail that says so (server/src/services/offline.js); no column marks it.
--
-- RE-RUNS. No earlier file touches question_packs or this column, so re-running
-- the whole set never narrows anything added here.
--
-- PRIVACY. RLS is on, with no policies: only the server's service role reads or
-- writes. A pack row holds question ids and a roll number, nothing else; no
-- key, no answer, no mark.

create table if not exists public.question_packs (
  id           uuid        primary key default gen_random_uuid(),
  session_id   uuid        not null references public.sessions (id) on delete cascade,
  roll_no      text        not null,
  question_ids uuid[]      not null,
  issued_at    timestamptz not null default now(),
  expires_at   timestamptz not null
);

-- At least one question (an empty pack is not recorded), a plain list with no
-- null in it, and at most 20 (the server sends 5; the room has room to grow
-- the size without a migration).
alter table public.question_packs drop constraint if exists question_packs_questions_check;
alter table public.question_packs
  add constraint question_packs_questions_check check (
    array_ndims(question_ids) = 1
    and cardinality(question_ids) between 1 and 20
    and array_position(question_ids, null) is null);

alter table public.question_packs drop constraint if exists question_packs_expiry_check;
alter table public.question_packs
  add constraint question_packs_expiry_check check (expires_at > issued_at);

create index if not exists question_packs_room_roll_idx
  on public.question_packs (session_id, roll_no, issued_at);

-- Written once. A delete is allowed only inside a foreign key's own action
-- (pg_trigger_depth() > 1): the cascade from the room it belongs to.
create or replace function public.question_packs_written_once()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'question_packs is written once: pack % goes only with its room, and a new pack is a new row', old.id
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists question_packs_written_once on public.question_packs;
create trigger question_packs_written_once
  before update or delete on public.question_packs
  for each row execute function public.question_packs_written_once();

alter table public.question_packs enable row level security;

comment on table public.question_packs is
  'A pack of the questions a phone would be served next, sent for use while its connection is down (0030, Phase 7). Question ids only, no key. An answer to a packed question is taken as served, and counts within the grace window after its room closed. Written once.';
comment on column public.question_packs.expires_at is
  'When the phone should stop working from this pack: 6 hours after it was sent. The room closing ends it sooner.';

alter table public.answers add column if not exists device_answered_at timestamptz;

comment on column public.answers.device_answered_at is
  'When the phone says the student answered (0030), sent with an answer that waited on the phone. For the record only: never read for the order of marking or for whether an answer counts. Null when the phone sent none. Written once.';

-- The log of serves. A JSON array, as profiles.history is; the server keeps it
-- to at most 500 entries, and the check bounds it a little above that.
alter table public.profiles add column if not exists served_log jsonb not null default '[]'::jsonb;

alter table public.profiles drop constraint if exists profiles_served_log_check;
alter table public.profiles
  add constraint profiles_served_log_check check (
    jsonb_typeof(served_log) = 'array' and jsonb_array_length(served_log) <= 1000);

comment on column public.profiles.served_log is
  'Every question the server put on this phone''s screen, the first time each: [{ questionId, at }] (0030, Phase 7). The pin moves on; this says which questions the phone was given before its room closed. At most 500 entries.';
