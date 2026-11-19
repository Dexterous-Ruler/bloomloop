-- 0023: class questions (Phase 5): one approved bank question put to every
-- phone in a room at once, with a pause, a discussion and a re-vote.
--
-- Apply in number order with the rest of supabase/migrations (see
-- supabase/README.md). Needs sessions (0000), questions (0000, 0013), accounts
-- (0001) and answers (0008). Idempotent: the table, its indexes and the two
-- answer columns are created only if missing, and the three checks are dropped
-- and added again with the same definitions. One table, two nullable columns,
-- no backfill: no existing row is rewritten, and every answer before this file
-- reads as an ordinary answer (no class question, no round).
--
-- WHAT IS ADDED, and why (docs/PRODUCT_DECISIONS.md, Phase 5):
--
--   class_questions    one row per class question asked in a room: the bank
--                      question it was, the question as it was asked
--                      (question_snapshot, answer key included: staff-only, like
--                      answers.question_snapshot), where it is now (state), and
--                      whether its key was revealed when it closed. The state
--                      is kept here, not in the server's memory, so a restart
--                      loses none of it: a phone that reconnects is sent the
--                      question where it stands.
--                        open     round 1: phones vote
--                        paused   round 1 is closed; the class discusses
--                        revote   round 2: phones vote again
--                        closed   finished, its key revealed or not
--                      At most one class question per room is not closed
--                      (class_questions_one_running), and seq numbers them in
--                      the order they were asked.
--   answers.class_question_id, answers.round
--                      a vote is an answers row like any other answer, written
--                      once and never overwritten (0012's guard covers both new
--                      columns, as it covers every column it does not list).
--                      These two say which class question and which round (1 or
--                      2) it was a vote in; both are null on every other answer,
--                      and both or neither are set. No foreign key on
--                      class_question_id: deleting a room deletes its class
--                      questions and its answers together (both cascade from
--                      sessions), and an ON DELETE SET NULL would be refused by
--                      0012's guard, which lets no other column change.
--
-- WHAT IS NOT CHANGED.
--   answers.confidence keeps 0008's check (sure, think, guess). The phone's three
--   taps (Sure, Think so, Guessing) are stored as those three values
--   (server/src/services/confidence.js), so no check is widened and a database
--   without this file still takes every confidence tap.
--
-- RE-RUNS. No earlier file touches class_questions or these two columns, so
-- re-running the whole set never narrows anything added here.
--
-- PRIVACY. RLS is on, with no policies: only the server's service role reads or
-- writes. A class question's snapshot carries the answer key, and nothing that
-- reaches a phone or the projector is read from it without the server's own
-- whitelist (services/classQuestions.js, services/projector.js).

create table if not exists public.class_questions (
  id                uuid        primary key default gen_random_uuid(),
  session_id        uuid        not null references public.sessions (id) on delete cascade,
  seq               integer     not null check (seq >= 1),
  question_id       uuid        references public.questions (id) on delete set null,
  question_snapshot jsonb       not null,
  state             text        not null default 'open',
  revealed          boolean     not null default false,
  started_at        timestamptz not null default now(),
  started_by        uuid        references public.accounts (id) on delete set null,
  paused_at         timestamptz,
  revote_at         timestamptz,
  closed_at         timestamptz,
  closed_by         uuid        references public.accounts (id) on delete set null,
  constraint class_questions_session_seq_key unique (session_id, seq)
);

alter table public.class_questions drop constraint if exists class_questions_state_check;
alter table public.class_questions
  add constraint class_questions_state_check check (state in ('open', 'paused', 'revote', 'closed'));

-- A key is revealed only as the question closes.
alter table public.class_questions drop constraint if exists class_questions_revealed_check;
alter table public.class_questions
  add constraint class_questions_revealed_check check (not revealed or state = 'closed');

create unique index if not exists class_questions_one_running
  on public.class_questions (session_id) where state <> 'closed';
create index if not exists class_questions_question_idx
  on public.class_questions (question_id) where question_id is not null;
create index if not exists class_questions_started_by_idx
  on public.class_questions (started_by) where started_by is not null;
create index if not exists class_questions_closed_by_idx
  on public.class_questions (closed_by) where closed_by is not null;

alter table public.class_questions enable row level security;

comment on table public.class_questions is
  'A class question (0023): one approved bank question put to every phone in a room, round 1, a pause for discussion, and a re-vote. The votes are answers rows (class_question_id, round). State only; the votes are the evidence.';
comment on column public.class_questions.question_snapshot is
  'The question as it was asked, answer key included. Staff-only data, like answers.question_snapshot.';
comment on column public.class_questions.revealed is
  'True when the professor closed it with its key shown. A revealed question is never served adaptively in its room again.';

alter table public.answers add column if not exists class_question_id uuid;
alter table public.answers add column if not exists round smallint;

alter table public.answers drop constraint if exists answers_round_check;
-- Both or neither, and a round is 1 or 2. Written so that no part of it is
-- null for a row it must refuse (a check passes on null).
alter table public.answers
  add constraint answers_round_check check ((class_question_id is null) = (round is null)
    and (round is null or round in (1, 2)));

create index if not exists answers_class_question_idx
  on public.answers (class_question_id) where class_question_id is not null;

comment on column public.answers.class_question_id is
  'The class question this vote was given in (0023), or null for every other answer. Written once.';
comment on column public.answers.round is
  'The class question''s round this vote was given in: 1, or 2 for the re-vote after discussion (0023). Null for every other answer. Written once.';
