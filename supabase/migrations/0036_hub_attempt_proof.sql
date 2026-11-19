-- 0036: a hub answer kept without proof that the hub served its question
-- (Batch 8, the fixes from the review of the shared question bank's serve
-- tokens).
--
-- Apply in number order with the rest of supabase/migrations (see
-- supabase/README.md). Needs hub_attempts (0026). Depends on nothing in 0027 to
-- 0035. Idempotent: the column is added only if missing. Adds one column; no
-- row of any table changes meaning: every attempt already stored was taken
-- under the rule of its day and is counted as it always was (unproven false).
--
-- WHY. Practice and a lesson count an answer only to a question the hub served
-- to that student, proved by a token the serving reply carried
-- (server/src/services/serveTokens.js). Before this file an answer without one
-- was refused and nothing was stored, so every answer waiting in a phone's
-- outbox from before the tokens, or from a phone that had not yet learnt to
-- send them, was lost for good. Now it is kept, marked as unproven.
--
-- WHAT IS ADDED.
--   hub_attempts.unproven   boolean, default false. True for a practice or
--                           lesson answer that came without a token proving the
--                           question was served to this student (none, or one
--                           that does not check). Kept as evidence, counted
--                           nowhere (mastery, the error log, reviews, the
--                           by-language item figures), and its reply carries no
--                           mark, key, explanation or option feedback, now or
--                           when it is sent again: shown, they would give away
--                           the key of any question, one id at a time.
--
-- The column is written once, with the row; 0026's append-only guard already
-- refuses any later change to it. RLS stays on, with no policies: only the
-- server's service role reads or writes the table.

alter table public.hub_attempts add column if not exists unproven boolean not null default false;

comment on column public.hub_attempts.unproven is
  'Batch 8 (0036): kept without proof the hub served the question (no serve token, or one that does not check). Counted nowhere; its reply shows no mark or key.';

alter table public.hub_attempts enable row level security;
