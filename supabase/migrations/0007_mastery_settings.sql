-- 0007 (formerly the second of two files numbered 006: 006_mastery_settings.sql).
-- Phase 7: the mastery goal, reattempts and redemption - chosen per room by the
-- teacher who opens it.
--
-- WHY THESE LIVE ON THE SESSION AND NOT ON THE ACCOUNT OR THE CONTENT:
-- they change what a student's answers MEAN, so they have to be fixed for the
-- length of one room and identical for everyone in it. A teacher-level default
-- that drifted, or a setting editable mid-class, would mean two students in the
-- same room sat two different assessments and their rows in the same grid could
-- not be read against each other. There is deliberately no UPDATE path for these
-- three columns anywhere in the server: they are written once, when the room is
-- opened, and the room is the unit.
--
-- Every column is NOT NULL with a default, so the ten sessions already in this
-- project - and every profile in them - carry the settings that reproduce
-- exactly the behaviour they were run under: an 80% goal that nothing reads yet,
-- no retries, and no redemption. Nothing recorded before today changes meaning.
--
-- Idempotent throughout: a no-op against the live project, the work against a
-- fresh one.
--
-- Apply in number order with the rest of supabase/migrations (see
-- supabase/README.md).

-- ------------------------------------------------------------------ sessions

-- The accuracy AT A LEVEL that this class calls mastered. Not the promotion
-- threshold - promotion is 70% over a rolling five, it is tuned, it is tested,
-- and it is the same in every room. This is the teacher's own standard, the bar
-- they would sign their name under, and it is reported rather than acted on.
--
-- numeric(3,2) rather than a percentage integer because the whole server works
-- in 0..1 accuracies; storing 80 here and dividing on the way out is how a
-- comparison eventually gets written against the wrong scale.
alter table public.sessions
  add column if not exists mastery_goal numeric(3, 2) not null default 0.80;

alter table public.sessions drop constraint if exists sessions_mastery_goal_check;
alter table public.sessions
  add constraint sessions_mastery_goal_check check (mastery_goal in (0.80, 0.90, 1.00));

-- Extra goes at a question answered wrong, before the answer counts.
--
-- Capped at two in the database as well as in the server, because every retry
-- shrinks the answer space and the server refuses outright the retries that
-- would hand the answer over - a true/false gets none at any setting. A column
-- that accepted 5 would be an invitation to set it from a SQL console and
-- quietly turn a bank of true/false items into free marks.
alter table public.sessions
  add column if not exists reattempts smallint not null default 0;

alter table public.sessions drop constraint if exists sessions_reattempts_check;
alter table public.sessions
  add constraint sessions_reattempts_check check (reattempts between 0 and 2);

-- Redemption: a question answered right first time at some level sets aside the
-- earliest question answered wrong at that same level, which then stops counting
-- towards the average. One set aside per one got right, oldest first, nothing
-- deleted. See REDEMPTION_RULE in server/src/services/mastery.js - that string is
-- the specification and it is the text the teacher and the student are both
-- shown, so this column and that sentence have to be changed together.
--
-- Off by default and off in every existing room: it can only ever raise an
-- accuracy figure, so off is the side to be wrong on.
alter table public.sessions
  add column if not exists redemption boolean not null default false;

comment on column public.sessions.mastery_goal is
  'Accuracy at a level for this room to call that level mastered. Reported, never fed to the promote/demote ladder.';
comment on column public.sessions.reattempts is
  'Extra goes at a wrong answer before it counts. The server refuses retries that would leave one option standing, so true/false gets none.';
comment on column public.sessions.redemption is
  'See REDEMPTION_RULE in server/src/services/mastery.js. Right first time at a level withdraws the earliest wrong answer at that level, one for one, oldest first.';

-- ------------------------------------------------------------------ profiles

-- The retry counter for the question this student is currently pinned to.
--
-- It belongs on the pin and nowhere else: the pin is already the record of what
-- this student is looking at, it is already written before the phone can answer,
-- and it is already cleared the moment the answer counts. A counter kept in its
-- own row would need clearing in all the same places and would eventually not be.
--
-- NOT NULL with a default for the same reason `integrity` is: every read path
-- does arithmetic on it, and a null would need a guard at each one.
alter table public.profiles
  add column if not exists served_tries smallint not null default 0;

-- A fingerprint of the last answer submitted against the current pin.
--
-- The same answer arriving twice is one attempt, not two: the phone holds its
-- submission until a result comes back and re-sends it on reconnect, so a result
-- lost to hall wifi would otherwise cost a student a retry they never chose to
-- spend. This is the double-tap guard for the attempts before the last one.
--
-- A hash, never the answer. This column exists only to compare one submission
-- with the one before it, and a student's answers stored somewhere nothing needs
-- to read them are answers waiting to come out of a query somebody writes later.
alter table public.profiles add column if not exists served_last text;

comment on column public.profiles.served_tries is
  'Attempts already spent on the pinned question. Cleared with the pin the moment the answer counts.';
comment on column public.profiles.served_last is
  'Hash of the last answer submitted against the pin, so a re-sent submission is one attempt rather than two. Never the answer itself.';
