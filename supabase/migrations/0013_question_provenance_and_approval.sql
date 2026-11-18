-- 0013: where each question came from, what the rule checks said about it, and
-- who let it into rooms.
--
-- Apply in number order with the rest of supabase/migrations (see
-- supabase/README.md). Needs questions (0000, 0001), contents and accounts
-- (0001). Idempotent: columns and indexes are added only if missing, and the
-- constraints are dropped by name and added again. Adds columns, constraints and
-- indexes; changes no row. Every existing question keeps its status: an active
-- one stays active and keeps being served.
--
-- WHY.
-- Generated questions used to go straight into rooms. The evidence says they
-- should not: in one expert study about a third of model-written items missed
-- the Bloom level asked for, and half of the unreviewed multiple-choice items in
-- another had item-writing flaws (reports/BloomLoop gap analysis and roadmap.md,
-- "Questions from uploaded units need a review gate"). So a generated question
-- is now written as a 'draft', which no room serves, and a professor approves it.
--
-- WHAT IS ADDED.
--   questions.status     may now also be 'draft': written by the model or the
--                        offline templates and not yet approved. The partial
--                        index questions_active_idx (0000) already leaves
--                        drafts out of what a room reads.
--   questions.model      the model id that wrote the text, 'offline-template'
--                        for the offline generator, null for a question a
--                        professor wrote. Null on every row written before this
--                        file too, so null alone does not mean "a professor's":
--                        it means "no model is recorded".
--   questions.source_ref where in the uploaded material the question's topic was
--                        read from, as an object: {"kind": "slides", "slides":
--                        [3, 4]} for a deck. Null for pasted text, a professor's
--                        own question, and every older row.
--   questions.checks     the cheap rule checks (server/src/services/checks.js)
--                        as an array of {id, ok, message}. Advice for the
--                        professor; nothing refuses a question for them. Null
--                        means never checked.
--   questions.created_by the account that made the row exist (generated it,
--                        wrote it, split or merged it). Null on the shared
--                        teacher-key path and on older rows.
--   questions.approved_by, approved_at
--                        who let a question into rooms, and when. approved_by is
--                        null on the shared-key path; approved_at is still set.
--   contents.topic_slides
--                        for a deck: each extracted topic and the slides it was
--                        read from, {"<topic>": [3, 4]}, so a question generated
--                        later on that topic can carry its slides. '{}' for
--                        pasted text and every older row.

-- ---------------------------------------------------------------- questions --

-- Widened, never narrowed: every row already holds 'active' or 'discarded'. The
-- inline check from 0000 is named questions_status_check by Postgres.
alter table public.questions drop constraint if exists questions_status_check;
alter table public.questions
  add constraint questions_status_check check (status in ('active', 'discarded', 'draft'));

alter table public.questions add column if not exists model       text;
alter table public.questions add column if not exists source_ref  jsonb;
alter table public.questions add column if not exists checks      jsonb;
alter table public.questions add column if not exists created_by  uuid
  references public.accounts (id) on delete set null;
alter table public.questions add column if not exists approved_by uuid
  references public.accounts (id) on delete set null;
alter table public.questions add column if not exists approved_at timestamptz;

alter table public.questions drop constraint if exists questions_source_ref_object;
alter table public.questions
  add constraint questions_source_ref_object check (source_ref is null or jsonb_typeof(source_ref) = 'object');

alter table public.questions drop constraint if exists questions_checks_array;
alter table public.questions
  add constraint questions_checks_array check (checks is null or jsonb_typeof(checks) = 'array');

-- An approver without a time is a half-written approval. The reverse is allowed:
-- the shared teacher key approves with no account behind it.
alter table public.questions drop constraint if exists questions_approval_pair;
alter table public.questions
  add constraint questions_approval_pair check (approved_by is null or approved_at is not null);

-- A bank's drafts, for the review screen and for the room's "waiting for
-- approval" refusal.
create index if not exists questions_draft_idx on public.questions (content_id) where status = 'draft';
-- The foreign keys' own indexes, so deleting an account does not scan the bank.
create index if not exists questions_created_by_idx  on public.questions (created_by) where created_by is not null;
create index if not exists questions_approved_by_idx on public.questions (approved_by) where approved_by is not null;

comment on column public.questions.status is
  'active: served in rooms. draft: generated, waiting for a professor''s approval, never served. discarded: rejected or replaced.';
comment on column public.questions.model is
  'Model id that wrote the question; ''offline-template'' for the offline generator; null for a professor''s own question and for rows older than 0013.';
comment on column public.questions.source_ref is
  'Where the question''s topic was read from, e.g. {"kind": "slides", "slides": [3, 4]}. Null when unknown.';
comment on column public.questions.checks is
  'Rule-check results (server/src/services/checks.js): [{id, ok, message}]. Advice only. Null means never checked.';

-- ---------------------------------------------------------------- contents --

alter table public.contents add column if not exists topic_slides jsonb not null default '{}'::jsonb;

alter table public.contents drop constraint if exists contents_topic_slides_object;
alter table public.contents
  add constraint contents_topic_slides_object check (jsonb_typeof(topic_slides) = 'object');

comment on column public.contents.topic_slides is
  'Deck only: each extracted topic and the slide numbers it was read from, {"<topic>": [3, 4]}.';
