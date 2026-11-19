-- 0026: the Learning Hub's practice evidence and explanations (Phase 6, decisions H5, H6, H7, H8, H14).
--
-- Apply in number order with the rest of supabase/migrations (see
-- supabase/README.md). Needs accounts (0001), questions (0000), classes (0016)
-- and chapter_topics (0025). Idempotent: tables and indexes are created only if
-- missing, constraints are dropped by name and added again, the function is
-- replaced and the trigger dropped and recreated. Adds two tables, one function
-- and one trigger; changes no existing row and no existing constraint. No
-- answer, profile, room, attainment figure or marks register reads any of it.
--
-- WHY. A student account practises outside rooms (H5). A room's evidence is the
-- answers table, whose session_id is NOT NULL: an answer there is always an
-- answer in a room, and attainment and the register read every one of them. So a
-- hub attempt gets a table of its own, and nothing that reads answers ever sees
-- it. Mastery (Elo, H6), the error log (H7) and spaced review (H8) are worked
-- out from these rows when they are asked for (services/hubElo.js,
-- services/hubReview.js, services/hubErrors.js), as attainment is worked out
-- from answers: nothing derived is stored, so nothing can drift from the
-- evidence it came from.
--
-- WHAT IS ADDED.
--   hub_attempts       one row per attempt a signed-in student makes in the hub,
--                      every one kept (H5). The question as it was asked
--                      (question_snapshot, key included: staff and server data,
--                      exactly like answers.question_snapshot), the response,
--                      the mark from the server's own marking (correct, score,
--                      detail), whether that mark is a written answer's
--                      provisional machine mark (review_status 'provisional'),
--                      the mode (practice, exam, getready, review, lesson), the
--                      language the question was shown in (default 'en', H12),
--                      the hints used (0 until the tutor's hints are built,
--                      H13: at most 3) and the time taken as the device reported
--                      it (never trusted for marking). client_attempt_id is the
--                      client's idempotency key: unique per account, so a resent
--                      attempt is answered with the stored row and never makes a
--                      second one. created_at is the server's clock, the only one
--                      used for ordering, sessions and due dates.
--
--   question_explanations
--                      one explanation per question (H14): why the right answer
--                      is right, shown to a student only after they have
--                      attempted the question, and only once approved. Written
--                      by the professor (provenance 'professor', approved when
--                      written: its author is its approver) or drafted by the
--                      model on the professor's button (provenance 'ai', status
--                      'draft' until the professor approves it). source_ref names
--                      the slides it cites ({ "kind": "slides", "slides": [..] }).
--
-- APPEND-ONLY EVIDENCE (the guard below, as 0012 guards answers). A hub attempt
-- is written once. The database refuses any UPDATE except the foreign keys'
-- own actions clearing a link (class_id, content_id, topic_id, question_id set
-- to null when that row is deleted), and any DELETE except the cascade from the
-- student's account being deleted, whoever sends it.
--
-- DELETING. A student account's attempts go with it (ON DELETE CASCADE): an
-- attempt carries no roll number, so kept without its account it would be
-- nobody's and could only leak. Room answers keep theirs under the roll number
-- (0008); whether erasure should work the same way for both waits on the legal
-- review (PRODUCT_DECISIONS.md, decisions 8 and 9). A deleted class, chapter,
-- topic or question clears the link and leaves the attempt and its snapshot. An
-- explanation goes with its question.
--
-- WHAT IS REFUSED.
--   hub_attempts       a client attempt id that is not 8 to 64 letters, digits,
--                      '-' or '_'; a Bloom level outside the six (spelt
--                      'analyse'); a poll (it assesses nothing and is never
--                      practised); a score outside 0 to 1; a review status other
--                      than 'auto' or 'provisional'; a mode outside the five; a
--                      language that is not a two- or three-letter code; hints
--                      outside 0 to 3; a time taken below 0 or over a day (23514).
--                      The same client attempt id twice for one account (23505).
--   question_explanations
--                      a text blank or over 2000 characters; a provenance other
--                      than 'ai' or 'professor'; a status other than 'draft' or
--                      'approved'; a professor's explanation left as a draft; an
--                      approval time on a draft or none on an approved one; a
--                      model on a professor's explanation; a source_ref that is
--                      not a JSON object (23514). A second explanation for one
--                      question (23505).
--
-- RLS is on with no policies, like every table: only the server's service role
-- reads or writes, and the server decides who sees what (services/hubAccess.js).

-- ------------------------------------------------------------ hub_attempts --

create table if not exists public.hub_attempts (
  id                 uuid        primary key default gen_random_uuid(),
  account_id         uuid        not null references public.accounts (id) on delete cascade,
  client_attempt_id  text        not null,
  -- The class through which the student reached the chapter (one of theirs it
  -- is placed on), the chapter and the topic record. Cleared, never cascaded,
  -- when that row goes: the attempt stays evidence.
  class_id           uuid        references public.classes (id) on delete set null,
  content_id         uuid        references public.contents (id) on delete set null,
  topic_id           uuid        references public.chapter_topics (id) on delete set null,
  -- The topic's name when the attempt was made, kept for good.
  topic              text        not null default '',
  question_id        uuid        references public.questions (id) on delete set null,
  bloom              text        not null,
  kind               text        not null default 'mcq',
  question_snapshot  jsonb       not null default '{}'::jsonb,
  question_source    text        not null default 'llm',
  response           jsonb,
  correct            boolean     not null,
  score              numeric(4, 3) not null,
  detail             text        not null default '',
  review_status      text        not null default 'auto',
  mode               text        not null,
  language           text        not null default 'en',
  hints_used         smallint    not null default 0,
  time_taken_ms      integer,
  created_at         timestamptz not null default now(),
  constraint hub_attempts_account_attempt_key unique (account_id, client_attempt_id)
);

alter table public.hub_attempts enable row level security;

alter table public.hub_attempts drop constraint if exists hub_attempts_client_attempt_id_check;
alter table public.hub_attempts
  add constraint hub_attempts_client_attempt_id_check check (client_attempt_id ~ '^[A-Za-z0-9_-]{8,64}$');
alter table public.hub_attempts drop constraint if exists hub_attempts_bloom_check;
alter table public.hub_attempts
  add constraint hub_attempts_bloom_check check (bloom in ('remember', 'understand', 'apply', 'analyse', 'evaluate', 'create'));
alter table public.hub_attempts drop constraint if exists hub_attempts_kind_check;
alter table public.hub_attempts
  add constraint hub_attempts_kind_check check (char_length(kind) between 1 and 40 and kind <> 'poll');
alter table public.hub_attempts drop constraint if exists hub_attempts_score_check;
alter table public.hub_attempts add constraint hub_attempts_score_check check (score between 0 and 1);
alter table public.hub_attempts drop constraint if exists hub_attempts_review_status_check;
alter table public.hub_attempts
  add constraint hub_attempts_review_status_check check (review_status in ('auto', 'provisional'));
alter table public.hub_attempts drop constraint if exists hub_attempts_mode_check;
alter table public.hub_attempts
  add constraint hub_attempts_mode_check check (mode in ('practice', 'exam', 'getready', 'review', 'lesson'));
alter table public.hub_attempts drop constraint if exists hub_attempts_language_check;
alter table public.hub_attempts add constraint hub_attempts_language_check check (language ~ '^[a-z]{2,3}$');
alter table public.hub_attempts drop constraint if exists hub_attempts_hints_used_check;
alter table public.hub_attempts add constraint hub_attempts_hints_used_check check (hints_used between 0 and 3);
alter table public.hub_attempts drop constraint if exists hub_attempts_time_taken_check;
alter table public.hub_attempts
  add constraint hub_attempts_time_taken_check check (time_taken_ms is null or time_taken_ms between 0 and 86400000);

-- A student's own reads (progress, the error log, reviews) and a topic's
-- (mastery is worked out over everyone's attempts on it).
create index if not exists hub_attempts_account_idx on public.hub_attempts (account_id, created_at);
create index if not exists hub_attempts_topic_idx on public.hub_attempts (topic_id, created_at);
create index if not exists hub_attempts_question_idx on public.hub_attempts (question_id);

-- The guard. pg_trigger_depth() is 1 for a statement sent directly, and above 1
-- inside a foreign key's own action (0012's rule): the cascade from the
-- account, or a link cleared when its class, chapter, topic or question goes.
create or replace function public.hub_attempts_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  links constant text[] := array['class_id', 'content_id', 'topic_id', 'question_id'];
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    raise exception 'hub_attempts is append-only: attempt % goes only with its student''s account', old.id
      using errcode = 'restrict_violation';
  end if;
  if pg_trigger_depth() > 1
     and (to_jsonb(new) - links) = (to_jsonb(old) - links)
     and (new.class_id is null or new.class_id = old.class_id)
     and (new.content_id is null or new.content_id = old.content_id)
     and (new.topic_id is null or new.topic_id = old.topic_id)
     and (new.question_id is null or new.question_id = old.question_id) then
    return new;
  end if;
  raise exception 'hub_attempts % is evidence: it is written once, and only a deleted class, chapter, topic or question clears its link', old.id
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists hub_attempts_append_only on public.hub_attempts;
create trigger hub_attempts_append_only
  before update or delete on public.hub_attempts
  for each row execute function public.hub_attempts_append_only();

comment on table public.hub_attempts is
  'One row per attempt a signed-in student makes in the Learning Hub (0026). Append-only evidence, never read by rooms, attainment or the marks register. Unique per (account_id, client_attempt_id): a resend returns the stored row.';
comment on column public.hub_attempts.question_snapshot is
  'The question as it was when attempted, including its answer key. Staff and server data only.';
comment on column public.hub_attempts.time_taken_ms is
  'As the device reported it. Stored for the record, never used for marking or ordering.';

-- --------------------------------------------------- question_explanations --

create table if not exists public.question_explanations (
  id           uuid        primary key default gen_random_uuid(),
  question_id  uuid        not null references public.questions (id) on delete cascade,
  text         text        not null,
  provenance   text        not null,
  status       text        not null default 'draft',
  model        text,
  source_ref   jsonb,
  created_by   uuid        references public.accounts (id) on delete set null,
  created_at   timestamptz not null default now(),
  -- No trigger maintains this; the server sets it on every update, as for classes.
  updated_at   timestamptz not null default now(),
  approved_by  uuid        references public.accounts (id) on delete set null,
  approved_at  timestamptz,
  constraint question_explanations_question_key unique (question_id)
);

alter table public.question_explanations enable row level security;

alter table public.question_explanations drop constraint if exists question_explanations_text_check;
alter table public.question_explanations
  add constraint question_explanations_text_check check (char_length(btrim(text)) between 1 and 2000);
alter table public.question_explanations drop constraint if exists question_explanations_provenance_check;
alter table public.question_explanations
  add constraint question_explanations_provenance_check check (provenance in ('ai', 'professor'));
alter table public.question_explanations drop constraint if exists question_explanations_status_check;
alter table public.question_explanations
  add constraint question_explanations_status_check check (
    status in ('draft', 'approved')
    -- A professor's own is approved when written.
    and (provenance = 'ai' or status = 'approved')
    -- Approved exactly when it carries an approval time.
    and ((status = 'approved') = (approved_at is not null))
  );
alter table public.question_explanations drop constraint if exists question_explanations_model_check;
alter table public.question_explanations
  add constraint question_explanations_model_check check (provenance = 'ai' or model is null);
alter table public.question_explanations drop constraint if exists question_explanations_source_ref_check;
alter table public.question_explanations
  add constraint question_explanations_source_ref_check check (source_ref is null or jsonb_typeof(source_ref) = 'object');

comment on table public.question_explanations is
  'One explanation per question (0026, H14): written by the professor, or drafted by the model on the professor''s button and used only once approved. A student sees an approved one, and only after attempting the question.';
