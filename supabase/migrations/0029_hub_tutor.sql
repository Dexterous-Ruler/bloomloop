-- 0029: the hub's tutor - hint ladders, feedback on wrong options, and the hints
-- each student opened (Phase 6, decision H13, under the owner's decisions 1 and 5).
--
-- Apply in number order with the rest of supabase/migrations (see
-- supabase/README.md). Needs accounts (0001), questions and contents (0000),
-- chapter_topics (0025) and hub_attempts (0026). 0028 belongs to the Get Ready,
-- refresher paths and self-test build; this file needs nothing from it.
-- Idempotent: tables and indexes are created only if missing, constraints are
-- dropped by name and added again, the function is replaced and the trigger
-- dropped and recreated. Adds three tables, one function, one trigger and one
-- check on hub_attempts; changes no existing row. No answer, profile, room,
-- ladder, attainment figure or marks register reads any of it.
--
-- WHY. Decision H13 gives the hub a tutor with NO live model call (decision 5
-- stands, and it works offline and costs no quota): each question may carry an
-- approved ladder of up to three hints, and each wrong option its own feedback,
-- both made from the professor's own slides (decision 1) on the professor's
-- button or written by the professor, and both approved before any student
-- sees them. A student opens hints one at a time, before answering; each hint
-- opened is evidence of how the answer was reached, so it is kept, append-only,
-- and counted onto the attempt (hub_attempts.hints_used, 0026).
--
-- WHAT IS ADDED.
--   question_hints   one row per hint step of a question: step 1 a nudge, 2 a
--                    strategy, 3 a worked step that stops short of the answer.
--                    The text (at most 600 characters), the slides it cites
--                    (source_ref, { "kind": "slides", "slides": [..] }), who made
--                    it (provenance 'ai' on the professor's button, or
--                    'professor'), and its approval: an AI hint is a 'draft'
--                    until the professor approves it; one the professor writes or
--                    edits is approved as written (its author is its approver),
--                    as question_explanations (0026) are. One row per (question,
--                    step). The server refuses a hint that holds the answer
--                    (services/hubTutor.js, answerLeak) and checks again before
--                    showing one, because a question's key can change after.
--
--   option_feedback  one row per wrong option of a "Choose one", "Choose all
--                    that apply" or "True or false" question that has feedback:
--                    what a student who chose it most likely confused, and what
--                    to look at again. Keyed by the option's TEXT (option, and
--                    option_key: its words in lower case with runs of space made
--                    one, as the server compares options), not its position, as
--                    misconception labels are (0024): a reorder keeps it on its
--                    option, and a reworded option or one that became a right
--                    answer is simply not shown any more. The same provenance and
--                    approval as a hint. One row per (question, option_key).
--
--   hub_hint_views   one row per hint a student opened, before answering, in
--                    the hub's practice, review or lesson modes (never in a
--                    self-test or Get Ready: H10, H9). The client's attempt id
--                    the hint was opened for (the same idempotency key the
--                    attempt then carries, 0026), its place in the order shown
--                    (position 1 to 3), what it was (feedback, nudge, strategy
--                    or worked), the row it came from (hint_id: a question_hints
--                    or option_feedback id, no foreign key, since that row may be
--                    edited or removed later), the words shown, who wrote them
--                    (provenance), their language (and the approved translation
--                    shown, if any), the
--                    slides cited, and the plan the server chose for this
--                    attempt (plan: which hints, in which order, and the
--                    student's own sentence saying why). The attempt's
--                    hints_used is the number of these rows for its attempt id
--                    and question.
--
--   hub_attempts_hints_mode_check   an attempt in a self-test or in Get Ready
--                    carries no hints (H10: "no hints"; H13: hints in practice,
--                    review sets and lessons only). Added NOT VALID: every row
--                    written before this file has 0 hints, and a constraint that
--                    could fail to apply over old data must not stop the rest
--                    of this file; new rows are checked.
--
-- APPEND-ONLY EVIDENCE (the guard below, as 0012 guards answers and 0026 guards
-- hub_attempts). A hint view is written once. The database refuses any UPDATE
-- except a foreign key's own action clearing a link (question_id, topic_id,
-- content_id set to null when that row is deleted), and any DELETE except the
-- cascade from the student's account being deleted, whoever sends either.
--
-- DELETING. A student account's hint views go with it, as its hub attempts do
-- (0026). A deleted question takes its hints and feedback with it and clears
-- the link on the views, which keep the words that were shown.
--
-- WHAT IS REFUSED.
--   question_hints     a step outside 1 to 3; a text blank or over 600
--                      characters; a provenance other than 'ai' or 'professor'; a
--                      status other than 'draft' or 'approved'; a professor's hint
--                      left as a draft; an approval time on a draft or none on an
--                      approved one; a model on a professor's hint; a source_ref
--                      that is not a JSON object (23514). A second hint for one
--                      question and step (23505).
--   option_feedback    the same, and an option blank or over 1000 characters
--                      (23514). Second feedback for one question and option (23505).
--   hub_hint_views     a client attempt id that is not 8 to 64 letters, digits,
--                      '-' or '_'; a mode outside practice, review and lesson; a
--                      position outside 1 to 3; a kind outside feedback, nudge,
--                      strategy and worked; a text blank or over 4000 characters;
--                      a provenance other than 'ai' or 'professor';
--                      a language that is not a two- or three-letter code; a plan
--                      that is not a JSON object; a source_ref that is not a JSON
--                      object (23514). The same position twice for one account's
--                      attempt id (23505).
--   hub_attempts       hints on an attempt whose mode is exam or getready (23514).
--
-- RLS is on with no policies, like every table: only the server's service role
-- reads or writes, and the server decides who sees what (services/hubAccess.js).

-- ----------------------------------------------------------- question_hints --

create table if not exists public.question_hints (
  id           uuid        primary key default gen_random_uuid(),
  question_id  uuid        not null references public.questions (id) on delete cascade,
  step         smallint    not null,
  text         text        not null,
  provenance   text        not null,
  status       text        not null default 'draft',
  model        text,
  source_ref   jsonb,
  created_by   uuid        references public.accounts (id) on delete set null,
  created_at   timestamptz not null default now(),
  -- No trigger maintains this; the server sets it on every update, as for explanations.
  updated_at   timestamptz not null default now(),
  approved_by  uuid        references public.accounts (id) on delete set null,
  approved_at  timestamptz,
  constraint question_hints_question_step_key unique (question_id, step)
);

alter table public.question_hints enable row level security;

alter table public.question_hints drop constraint if exists question_hints_step_check;
alter table public.question_hints add constraint question_hints_step_check check (step between 1 and 3);
alter table public.question_hints drop constraint if exists question_hints_text_check;
alter table public.question_hints
  add constraint question_hints_text_check check (char_length(btrim(text)) between 1 and 600);
alter table public.question_hints drop constraint if exists question_hints_provenance_check;
alter table public.question_hints
  add constraint question_hints_provenance_check check (provenance in ('ai', 'professor'));
alter table public.question_hints drop constraint if exists question_hints_status_check;
alter table public.question_hints
  add constraint question_hints_status_check check (
    status in ('draft', 'approved')
    -- A professor's own is approved when written.
    and (provenance = 'ai' or status = 'approved')
    -- Approved exactly when it carries an approval time.
    and ((status = 'approved') = (approved_at is not null))
  );
alter table public.question_hints drop constraint if exists question_hints_model_check;
alter table public.question_hints
  add constraint question_hints_model_check check (provenance = 'ai' or model is null);
alter table public.question_hints drop constraint if exists question_hints_source_ref_check;
alter table public.question_hints
  add constraint question_hints_source_ref_check check (source_ref is null or jsonb_typeof(source_ref) = 'object');

comment on table public.question_hints is
  'A question''s hint ladder (0029, H13): step 1 a nudge, 2 a strategy, 3 a worked step that stops short of the answer. Written by the professor, or drafted by the model on the professor''s button and shown only once approved. Never holds the answer.';

-- ---------------------------------------------------------- option_feedback --

create table if not exists public.option_feedback (
  id           uuid        primary key default gen_random_uuid(),
  question_id  uuid        not null references public.questions (id) on delete cascade,
  -- The option's words when the feedback was written, and how the server
  -- compares them (lower case, runs of space made one).
  option       text        not null,
  option_key   text        not null,
  text         text        not null,
  provenance   text        not null,
  status       text        not null default 'draft',
  model        text,
  source_ref   jsonb,
  created_by   uuid        references public.accounts (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  approved_by  uuid        references public.accounts (id) on delete set null,
  approved_at  timestamptz,
  constraint option_feedback_question_option_key unique (question_id, option_key)
);

alter table public.option_feedback enable row level security;

alter table public.option_feedback drop constraint if exists option_feedback_option_check;
alter table public.option_feedback
  add constraint option_feedback_option_check check (
    char_length(btrim(option)) between 1 and 1000 and char_length(btrim(option_key)) between 1 and 1000
  );
alter table public.option_feedback drop constraint if exists option_feedback_text_check;
alter table public.option_feedback
  add constraint option_feedback_text_check check (char_length(btrim(text)) between 1 and 600);
alter table public.option_feedback drop constraint if exists option_feedback_provenance_check;
alter table public.option_feedback
  add constraint option_feedback_provenance_check check (provenance in ('ai', 'professor'));
alter table public.option_feedback drop constraint if exists option_feedback_status_check;
alter table public.option_feedback
  add constraint option_feedback_status_check check (
    status in ('draft', 'approved')
    and (provenance = 'ai' or status = 'approved')
    and ((status = 'approved') = (approved_at is not null))
  );
alter table public.option_feedback drop constraint if exists option_feedback_model_check;
alter table public.option_feedback
  add constraint option_feedback_model_check check (provenance = 'ai' or model is null);
alter table public.option_feedback drop constraint if exists option_feedback_source_ref_check;
alter table public.option_feedback
  add constraint option_feedback_source_ref_check check (source_ref is null or jsonb_typeof(source_ref) = 'object');

comment on table public.option_feedback is
  'Feedback on one wrong option of a choice question (0029, H13), keyed by the option''s words: shown after a student chooses it, and as the first hint when they meet the question again. Approved before any student sees it.';

-- ---------------------------------------------------------- hub_hint_views --

create table if not exists public.hub_hint_views (
  id                 uuid        primary key default gen_random_uuid(),
  account_id         uuid        not null references public.accounts (id) on delete cascade,
  client_attempt_id  text        not null,
  -- Cleared, never cascaded, when that row goes: the view stays evidence.
  question_id        uuid        references public.questions (id) on delete set null,
  topic_id           uuid        references public.chapter_topics (id) on delete set null,
  content_id         uuid        references public.contents (id) on delete set null,
  mode               text        not null,
  position           smallint    not null,
  kind               text        not null,
  -- A question_hints or option_feedback id: no foreign key, the row may be edited or removed later.
  hint_id            uuid,
  text               text        not null,
  -- Who wrote what was shown: 'professor', or 'ai' (drafted, then approved by the professor).
  provenance         text        not null,
  language           text        not null default 'en',
  translation_id     uuid,
  source_ref         jsonb,
  plan               jsonb       not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  constraint hub_hint_views_attempt_position_key unique (account_id, client_attempt_id, position)
);

alter table public.hub_hint_views enable row level security;

alter table public.hub_hint_views drop constraint if exists hub_hint_views_client_attempt_id_check;
alter table public.hub_hint_views
  add constraint hub_hint_views_client_attempt_id_check check (client_attempt_id ~ '^[A-Za-z0-9_-]{8,64}$');
alter table public.hub_hint_views drop constraint if exists hub_hint_views_mode_check;
alter table public.hub_hint_views
  add constraint hub_hint_views_mode_check check (mode in ('practice', 'review', 'lesson'));
alter table public.hub_hint_views drop constraint if exists hub_hint_views_position_check;
alter table public.hub_hint_views add constraint hub_hint_views_position_check check (position between 1 and 3);
alter table public.hub_hint_views drop constraint if exists hub_hint_views_kind_check;
alter table public.hub_hint_views
  add constraint hub_hint_views_kind_check check (kind in ('feedback', 'nudge', 'strategy', 'worked'));
alter table public.hub_hint_views drop constraint if exists hub_hint_views_provenance_check;
alter table public.hub_hint_views
  add constraint hub_hint_views_provenance_check check (provenance in ('ai', 'professor'));
alter table public.hub_hint_views drop constraint if exists hub_hint_views_text_check;
alter table public.hub_hint_views
  add constraint hub_hint_views_text_check check (char_length(btrim(text)) between 1 and 4000);
alter table public.hub_hint_views drop constraint if exists hub_hint_views_language_check;
alter table public.hub_hint_views add constraint hub_hint_views_language_check check (language ~ '^[a-z]{2,3}$');
alter table public.hub_hint_views drop constraint if exists hub_hint_views_shape_check;
alter table public.hub_hint_views
  add constraint hub_hint_views_shape_check check (
    jsonb_typeof(plan) = 'object' and (source_ref is null or jsonb_typeof(source_ref) = 'object')
  );

-- The attempt's count (its attempt id) and a question's staff read (how often each hint was opened).
create index if not exists hub_hint_views_attempt_idx on public.hub_hint_views (account_id, client_attempt_id);
create index if not exists hub_hint_views_question_idx on public.hub_hint_views (question_id);

-- The guard, as 0026's: pg_trigger_depth() is 1 for a statement sent directly,
-- and above 1 inside a foreign key's own action (the cascade from the account,
-- or a link cleared when its question, topic or chapter goes).
create or replace function public.hub_hint_views_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  links constant text[] := array['question_id', 'topic_id', 'content_id'];
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    raise exception 'hub_hint_views is append-only: hint view % goes only with its student''s account', old.id
      using errcode = 'restrict_violation';
  end if;
  if pg_trigger_depth() > 1
     and (to_jsonb(new) - links) = (to_jsonb(old) - links)
     and (new.question_id is null or new.question_id = old.question_id)
     and (new.topic_id is null or new.topic_id = old.topic_id)
     and (new.content_id is null or new.content_id = old.content_id) then
    return new;
  end if;
  raise exception 'hub_hint_views % is evidence: it is written once, and only a deleted question, topic or chapter clears its link', old.id
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists hub_hint_views_append_only on public.hub_hint_views;
create trigger hub_hint_views_append_only
  before update or delete on public.hub_hint_views
  for each row execute function public.hub_hint_views_append_only();

comment on table public.hub_hint_views is
  'One row per hint a student opened before answering, in hub practice, review or lessons (0029, H13). Append-only evidence; an attempt''s hints_used counts these rows for its attempt id. Never read by rooms, attainment or the marks register.';

-- ------------------------------------------------- hub_attempts: no hints in a self-test or Get Ready --

alter table public.hub_attempts drop constraint if exists hub_attempts_hints_mode_check;
alter table public.hub_attempts
  add constraint hub_attempts_hints_mode_check check (hints_used = 0 or mode in ('practice', 'review', 'lesson')) not valid;
