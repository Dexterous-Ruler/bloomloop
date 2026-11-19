-- 0028: Get Ready checks, self-tests and goals in the Learning Hub (Phase 6, decisions H9, H10, H16, H17).
--
-- Apply in number order with the rest of supabase/migrations (see
-- supabase/README.md). Needs accounts (0001) and hub_attempts (0026).
-- Idempotent: tables and indexes are created only if missing, the column is
-- added only if missing, constraints are dropped by name and added again, the
-- functions are replaced and the triggers dropped and recreated. Adds two
-- tables, one nullable column, two functions and two triggers; changes no
-- existing row and no existing constraint. No answer, profile, room, attainment
-- figure or marks register reads any of it.
--
-- WHY. A Get Ready check (H9) and a self-test (H10) are each a run of hub
-- attempts that belong together: the check asks at most 12 questions over a
-- target topic's prerequisites and stops early, and a self-test fixes its list of
-- questions when it starts and gives no feedback until it is handed in or its
-- time is up. Their answers are hub attempts like any other (hub_attempts, 0026,
-- mode 'getready' or 'exam'), so they are evidence kept the same way. What a run
-- adds is what the attempts alone cannot say: which target, which prerequisites,
-- which questions, the time limit, and when it ended. A goal (H16) is a
-- student's own plan: an exam date and the topics it covers.
--
-- WHAT IS ADDED.
--   hub_runs           one row per Get Ready check or self-test a signed-in
--                      student starts. client_run_id is the client's
--                      idempotency key: unique per account, so a resent start
--                      returns the stored run and never makes a second one.
--                      spec holds what was fixed at the start (a check's
--                      target and its prerequisites, nearest first; a
--                      self-test's topics, levels and its list of questions).
--                      A self-test may have a time limit: deadline_at is
--                      started_at plus it, exactly. ended_at and end_reason are
--                      written once: 'complete' when a check has asked what it
--                      needs, 'submitted' when a student hands a self-test in,
--                      'timed-out' when its time ran out.
--   hub_attempts.run_id
--                      the run an attempt was given in, or null (practice,
--                      review, lessons). Nullable, so every existing row reads
--                      exactly as before: an attempt with no run.
--   hub_goals          a student's goal: an optional title, the exam date they
--                      set, and the topic records it covers (1 to 60 ids).
--
-- APPEND-ONLY EVIDENCE. A run is written once, then only ended, once: the
-- database refuses any other UPDATE, and any DELETE except the cascade from the
-- student's account being deleted, whoever sends it (0012's rule, as 0026's
-- guard on hub_attempts). An attempt that names a run must be the run's own
-- student's, in the run's own mode (refused otherwise, 23514), so an answer can
-- never be filed under someone else's self-test. A goal is not evidence: the
-- student changes or removes it at will.
--
-- DELETING. A student account's runs and goals go with it (ON DELETE CASCADE),
-- as their attempts already do (0026). hub_attempts.run_id refers to hub_runs
-- with the default NO ACTION, checked at the end of the statement, so the
-- account's cascade removes both together, and a run is never deleted on its
-- own (the guard).
--
-- WHAT IS REFUSED.
--   hub_runs           a client run id that is not 8 to 64 letters, digits, '-'
--                      or '_'; a kind other than 'getready' or 'exam'; a spec
--                      that is not a JSON object; a time limit on a check, or
--                      one outside 1 minute to 3 hours, or a deadline that is
--                      not started_at plus the limit; an end time without a
--                      reason or a reason without one, an end before the
--                      start, a check ended other than 'complete', a self-test
--                      'complete', or 'timed-out' without a time limit (23514).
--                      The same client run id twice for one account (23505).
--   hub_attempts       a run_id of another student's run, or of a run of the
--                      other kind than the attempt's mode (23514).
--   hub_goals          a title over 80 characters; topic ids that are not a
--                      list of 1 to 60 (23514).
--
-- RLS is on with no policies, like every table: only the server's service role
-- reads or writes, and the server decides who sees what (services/hubAccess.js).

-- ---------------------------------------------------------------- hub_runs --

create table if not exists public.hub_runs (
  id                  uuid        primary key default gen_random_uuid(),
  account_id          uuid        not null references public.accounts (id) on delete cascade,
  client_run_id       text        not null,
  kind                text        not null,
  spec                jsonb       not null default '{}'::jsonb,
  time_limit_seconds  integer,
  started_at          timestamptz not null default now(),
  deadline_at         timestamptz,
  ended_at            timestamptz,
  end_reason          text,
  constraint hub_runs_account_run_key unique (account_id, client_run_id)
);

alter table public.hub_runs enable row level security;

alter table public.hub_runs drop constraint if exists hub_runs_client_run_id_check;
alter table public.hub_runs
  add constraint hub_runs_client_run_id_check check (client_run_id ~ '^[A-Za-z0-9_-]{8,64}$');
alter table public.hub_runs drop constraint if exists hub_runs_kind_check;
alter table public.hub_runs add constraint hub_runs_kind_check check (kind in ('getready', 'exam'));
alter table public.hub_runs drop constraint if exists hub_runs_spec_check;
alter table public.hub_runs add constraint hub_runs_spec_check check (jsonb_typeof(spec) = 'object');
alter table public.hub_runs drop constraint if exists hub_runs_time_limit_check;
alter table public.hub_runs
  add constraint hub_runs_time_limit_check check (
    (time_limit_seconds is null and deadline_at is null)
    or (kind = 'exam'
        and time_limit_seconds between 60 and 10800
        and deadline_at = started_at + time_limit_seconds * interval '1 second')
  );
alter table public.hub_runs drop constraint if exists hub_runs_end_check;
alter table public.hub_runs
  add constraint hub_runs_end_check check (
    (ended_at is null) = (end_reason is null)
    and (ended_at is null or ended_at >= started_at)
    and (end_reason is null
         -- 'ended' (a check the student ended early) is added by 0035. It is
         -- listed here too because re-running this file must never narrow the
         -- check below what a later file allows: a re-run over a check ended
         -- early would otherwise fail.
         or (kind = 'getready' and end_reason in ('complete', 'ended'))
         or (kind = 'exam' and (end_reason = 'submitted' or (end_reason = 'timed-out' and deadline_at is not null))))
  );

-- A student's own lists (their checks, their self-tests), newest first.
create index if not exists hub_runs_account_idx on public.hub_runs (account_id, started_at);

-- The guard. pg_trigger_depth() is 1 for a statement sent directly, and above 1
-- inside a foreign key's own action (0012's rule): here only the cascade from
-- the student's account.
create or replace function public.hub_runs_written_once()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  ending constant text[] := array['ended_at', 'end_reason'];
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    raise exception 'hub_runs is evidence: run % goes only with its student''s account', old.id
      using errcode = 'restrict_violation';
  end if;
  if old.ended_at is null and new.ended_at is not null
     and (to_jsonb(new) - ending) = (to_jsonb(old) - ending) then
    return new;
  end if;
  raise exception 'hub_runs % is written once: only its end is added, once', old.id
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists hub_runs_written_once on public.hub_runs;
create trigger hub_runs_written_once
  before update or delete on public.hub_runs
  for each row execute function public.hub_runs_written_once();

comment on table public.hub_runs is
  'One row per Get Ready check or self-test a signed-in student starts in the Learning Hub (0028). Written once, then ended once. Never read by rooms, attainment or the marks register.';
comment on column public.hub_runs.spec is
  'What was fixed when the run started: a check''s target and prerequisites (nearest first), a self-test''s topics, levels and questions.';

-- ------------------------------------------------------ hub_attempts.run_id --

alter table public.hub_attempts add column if not exists run_id uuid;

alter table public.hub_attempts drop constraint if exists hub_attempts_run_id_fkey;
alter table public.hub_attempts
  add constraint hub_attempts_run_id_fkey foreign key (run_id) references public.hub_runs (id);

create index if not exists hub_attempts_run_idx on public.hub_attempts (run_id) where run_id is not null;

-- An attempt filed under a run is the run's student's, in the run's mode.
create or replace function public.hub_attempts_in_own_run()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  owner_id uuid;
  run_kind text;
begin
  if new.run_id is null then
    return new;
  end if;
  select r.account_id, r.kind into owner_id, run_kind from public.hub_runs r where r.id = new.run_id;
  if owner_id is distinct from new.account_id then
    raise exception 'hub_attempts: an attempt can be filed only under its own student''s run'
      using errcode = 'check_violation';
  end if;
  if run_kind is distinct from new.mode then
    raise exception 'hub_attempts: an attempt in a % run must have that mode, not %', run_kind, new.mode
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists hub_attempts_in_own_run on public.hub_attempts;
create trigger hub_attempts_in_own_run
  before insert on public.hub_attempts
  for each row execute function public.hub_attempts_in_own_run();

comment on column public.hub_attempts.run_id is
  'The Get Ready check or self-test this attempt was given in (0028), or null.';

-- --------------------------------------------------------------- hub_goals --

create table if not exists public.hub_goals (
  id          uuid        primary key default gen_random_uuid(),
  account_id  uuid        not null references public.accounts (id) on delete cascade,
  title       text        not null default '',
  exam_date   date        not null,
  topic_ids   jsonb       not null,
  created_at  timestamptz not null default now(),
  -- No trigger maintains this; the server sets it on every update, as for classes.
  updated_at  timestamptz not null default now()
);

alter table public.hub_goals enable row level security;

alter table public.hub_goals drop constraint if exists hub_goals_title_check;
alter table public.hub_goals add constraint hub_goals_title_check check (char_length(title) <= 80);
alter table public.hub_goals drop constraint if exists hub_goals_topic_ids_check;
alter table public.hub_goals
  add constraint hub_goals_topic_ids_check check (
    -- A CASE, because AND does not promise to test the type first, and the
    -- length of something that is not an array is an error, not a false.
    case when jsonb_typeof(topic_ids) = 'array' then jsonb_array_length(topic_ids) between 1 and 60 else false end
  );

create index if not exists hub_goals_account_idx on public.hub_goals (account_id);

comment on table public.hub_goals is
  'A student''s own goal in the Learning Hub (0028, H16): an exam date and the topics it covers. Shown only to that student.';
