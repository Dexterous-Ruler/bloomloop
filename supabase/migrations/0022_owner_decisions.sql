-- 0022: the owner's decisions of 19 November 2026 that need the schema.
--
-- Apply in number order with the rest of supabase/migrations (see
-- supabase/README.md). Needs profiles (0000, 0005), questions (0000, 0013),
-- answers (0008) and class_students (0016). Idempotent: every column is added
-- only if missing, the one index only if missing, and the one check is dropped
-- and added again. Four columns, each with a default; one check widened. No row
-- is rewritten and nothing is backfilled beyond the columns' own defaults.
--
-- WHAT IS ADDED, and why (docs/PRODUCT_DECISIONS.md):
--
--   profiles.account_verified  decision 7. True only when the link in
--                       account_id was made because the phone presented that
--                       signed-in student's token when it joined the room. A
--                       room has no sign-in, so a link made from a roll number
--                       typed on a phone (every link before this file) proves
--                       nothing about who held the phone: such links are kept,
--                       and read here as false, unverified. The student's own
--                       history reads only verified links.
--   answers.account_verified   decision 7, for one answer: true only when the
--                       phone that sent it was signed in as the account the row
--                       is linked to. A classmate typing the roll number on
--                       another phone in a verified room writes rows that stay
--                       false, so they never reach the student's history. Set
--                       when the row is written and never changed. Every answer
--                       before this file reads false.
--   class_students.under_18    decision 8. The owner's optional mark on a roster
--                       student. Integrity signals (server/src/services/
--                       integrity.js) are neither recorded nor shown for a room
--                       profile tied to such a student. Default false. A yes or
--                       no, and nothing more: no date of birth is stored.
--   questions.replaces_id      the Phase 2 default the owner settled: a draft
--                       written by "regenerate" on an ACTIVE question names the
--                       question it would replace, which goes on serving until
--                       the draft is approved; the approval retires it. Null for
--                       every other question. ON DELETE SET NULL: a replacing
--                       generate deletes a whole bank, and a draft must not stop
--                       that.
--
-- WHAT IS WIDENED.
--   questions_source_check     adds 'teacher', for a question a professor wrote
--                       in the bank (CONTRACT.md section 6 rule 5, amended
--                       19 Nov 2026). 'llm' and 'fallback' are as they were.
--                       Existing rows are not rewritten: a professor's question
--                       stored as 'fallback' before this file cannot be told
--                       apart with certainty from a split or merge of an
--                       offline-template question written before 0013 (both
--                       have no model and a creator), so it stays 'fallback'.
--                       answers.question_source has no check to widen.
--
-- RE-RUNS. 0000 creates questions with the narrower inline check, but only when
-- the table does not exist, so re-running the whole set never puts the narrower
-- check back over this one. No earlier file touches questions_source_check.
--
-- PRIVACY. account_verified and under_18 are staff-side and server-only, like
-- every column here. RLS is on for every table already (this file adds none) and
-- has no policies: only the server's service role reads or writes.

alter table public.profiles add column if not exists account_verified boolean not null default false;

comment on column public.profiles.account_verified is
  'True only when account_id was linked because the phone presented that signed-in student''s token at join (decision 7, 0022). False for a link made from a typed roll number: kept, unverified, and never read into the student''s own history.';

alter table public.answers add column if not exists account_verified boolean not null default false;

comment on column public.answers.account_verified is
  'True only when the phone that sent this answer was signed in as the account in account_id (decision 7, 0022). A student''s own history reads only these rows. Written once.';

alter table public.class_students add column if not exists under_18 boolean not null default false;

comment on column public.class_students.under_18 is
  'The owner''s optional "under 18" mark (decision 8, 0022). Integrity signals are neither recorded nor shown for a room profile tied to this student. Not a legal determination.';

alter table public.questions
  add column if not exists replaces_id uuid references public.questions(id) on delete set null;

create index if not exists questions_replaces_idx on public.questions (replaces_id) where replaces_id is not null;

comment on column public.questions.replaces_id is
  'A regenerated draft''s link to the active question it would replace (0022). The old question keeps serving until this draft is approved; the approval retires it.';

alter table public.questions drop constraint if exists questions_source_check;
alter table public.questions
  add constraint questions_source_check check (source in ('llm', 'fallback', 'teacher'));
