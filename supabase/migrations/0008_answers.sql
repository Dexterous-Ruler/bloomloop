-- 0008: answers - one row per submitted attempt. The per-answer evidence store.
--
-- Apply in number order with the rest of supabase/migrations (see
-- supabase/README.md). Needs sessions, questions and accounts. Idempotent: a
-- no-op once the table exists.
--
-- WHY A TABLE AND NOT MORE JSON ON THE PROFILE.
-- profiles.history keeps what the selector needs (level, right or wrong) and
-- throws the response away. A professor reviewing a written answer, an item
-- statistic, an attainment report and the Learning Hub all need the response
-- itself and the question as it stood when it was answered, kept for good and
-- queryable across rooms. That is a row per attempt.
--
-- APPEND-ONLY EVIDENCE.
-- The response and the machine's assessment (auto_correct, auto_score,
-- auto_detail) are written once and never overwritten. A professor's review is
-- written BESIDE them: correct/score/detail carry the mark that counts,
-- review_status says how it got there, reviewed_by/reviewed_at/review_note say
-- who and why. A wrong attempt followed by a retry stays, with final = false.
--
-- IDEMPOTENT SUBMISSION.
-- answer_key is the client's idempotency key. The phone re-sends a submission it
-- has no result for, so the same attempt can arrive twice; the unique key on
-- (session_id, answer_key) turns the second insert into a 23505 that the server
-- answers with the row it already holds, never a second row.
--
-- question_snapshot holds the question as it was answered, answer key included,
-- so it is teacher-only data exactly like questions.payload, and the evidence
-- survives the question being edited or deleted (question_id then goes null).

create table if not exists public.answers (
  id                uuid        primary key default gen_random_uuid(),
  session_id        uuid        not null references public.sessions (id) on delete cascade,
  answer_key        text        not null,
  roll_no           text        not null,
  account_id        uuid        references public.accounts (id) on delete set null,
  question_id       uuid        references public.questions (id) on delete set null,
  content_id        uuid,
  topic             text        not null default '',
  bloom             text        not null check (
                      bloom in ('remember','understand','apply','analyse','evaluate','create')),
  kind              text        not null default 'mcq',
  question_snapshot jsonb       not null default '{}'::jsonb,
  response          jsonb,
  attempt           smallint    not null default 1,
  final             boolean     not null default true,
  correct           boolean,
  score             numeric(4, 3),
  detail            text        not null default '',
  ungraded          boolean     not null default false,
  language          text        not null default 'en',
  question_source   text        not null default 'llm',
  served_at         timestamptz,
  answered_at       timestamptz not null default now(),
  review_status     text        not null default 'auto' check (
                      review_status in ('auto','provisional','confirmed','overridden')),
  auto_correct      boolean,
  auto_score        numeric(4, 3),
  auto_detail       text        not null default '',
  reviewed_by       uuid        references public.accounts (id) on delete set null,
  reviewed_at       timestamptz,
  review_note       text        not null default '',
  -- For a later phase (confidence taps). Nullable until then.
  confidence        text        check (confidence in ('sure','think','guess')),
  constraint answers_session_answer_key_key unique (session_id, answer_key)
);

create index if not exists answers_session_idx      on public.answers (session_id);
create index if not exists answers_session_roll_idx on public.answers (session_id, roll_no);
create index if not exists answers_account_idx      on public.answers (account_id);
create index if not exists answers_question_idx     on public.answers (question_id);
-- The review queue reads only the answers still waiting for a professor.
create index if not exists answers_provisional_idx
  on public.answers (review_status) where review_status = 'provisional';

-- RLS on with no policies, like every other table: only the server's service
-- role key can read or write an answer.
alter table public.answers enable row level security;

comment on table public.answers is
  'One row per submitted attempt. Append-only evidence: the response and the auto_* assessment are never overwritten; a review is written beside them.';
comment on column public.answers.answer_key is
  'Client idempotency key. Unique with session_id, so a re-sent submission is one row.';
comment on column public.answers.question_snapshot is
  'The question as it was when answered, including its answer key. Teacher-only data.';
comment on column public.answers.final is
  'False for a wrong attempt that was followed by a retry.';
comment on column public.answers.auto_correct is
  'The machine''s original assessment. Never overwritten by a review.';
