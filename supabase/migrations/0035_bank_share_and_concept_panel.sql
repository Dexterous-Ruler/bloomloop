-- 0035: the shared question bank's "rooms only" switch, the hub's concept panel,
-- and ending a Get Ready check early (Batch 8, the design-zip gaps for material,
-- the bank and the hub; docs/UI_ZIP_AUDIT.md M1-M5, H9a, H9b, older H5).
--
-- Apply in number order with the rest of supabase/migrations (see
-- supabase/README.md). Needs questions (0000), topic_lessons (0027) and hub_runs
-- (0028). Depends on nothing in 0029 to 0034. Idempotent: columns are added only
-- if missing, and each check is dropped by name and added again. Adds two
-- columns and widens one check; no row of any table changes meaning: every
-- existing question stays shared (rooms_only false), every existing lesson has
-- no sections (null), and every existing Get Ready end stays 'complete'.
--
-- WHAT IS ADDED.
--   questions.rooms_only    boolean, default false. The owner keeps a question
--                           for rooms: the Learning Hub never serves, shows or
--                           explains it (practice, lessons, self-tests, Get Ready,
--                           the error log). Rooms serve it as before.
--   topic_lessons.sections  jsonb or null. The concept panel written with a
--                           lesson on the professor's button (services/hubConcept.js):
--                           an introduction, up to three facts, explanation steps,
--                           a code example kept as text, common mistakes; each
--                           piece cites the lesson parts (and so the slides) it
--                           came from. Written once with its lesson (0027's guard
--                           already refuses any later change to a lesson's
--                           content), and an AI draft exactly while the lesson is.
--   hub_runs end_reason     a Get Ready check may now end 'ended' (the student
--                           ended it early) as well as 'complete'. Its undecided
--                           prerequisites then read Not sure yet, and the
--                           question it was asking is no longer closed to the
--                           student elsewhere in the hub. 0028 lists 'ended' in
--                           the same check, so re-running the whole set over a
--                           check ended early never narrows it again.
--
-- No table is added: practice's serve tokens are signed by the server and kept
-- nowhere (services/serveTokens.js). RLS stays on for every table touched, with
-- no policies: only the server's service role reads or writes them.

-- ------------------------------------------------------------- questions --

alter table public.questions add column if not exists rooms_only boolean not null default false;

-- ---------------------------------------------------------- topic_lessons --

alter table public.topic_lessons add column if not exists sections jsonb;

alter table public.topic_lessons drop constraint if exists topic_lessons_sections_check;
alter table public.topic_lessons
  add constraint topic_lessons_sections_check check (
    sections is null
    or (jsonb_typeof(sections) = 'object'
        -- Generated text: only a lesson the model wrote may carry it.
        and source = 'llm')
  );

-- --------------------------------------------------------------- hub_runs --

alter table public.hub_runs drop constraint if exists hub_runs_end_check;
alter table public.hub_runs
  add constraint hub_runs_end_check check (
    (ended_at is null) = (end_reason is null)
    and (ended_at is null or ended_at >= started_at)
    and (end_reason is null
         or (kind = 'getready' and end_reason in ('complete', 'ended'))
         or (kind = 'exam' and (end_reason = 'submitted' or (end_reason = 'timed-out' and deadline_at is not null))))
  );

alter table public.questions enable row level security;
alter table public.topic_lessons enable row level security;
alter table public.hub_runs enable row level security;
