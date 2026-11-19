-- 0019: course outcomes, what they are mapped to, and per-question overrides.
--
-- Apply in number order with the rest of supabase/migrations (see
-- supabase/README.md). Needs contents (0000), accounts (0001) and classes
-- (0016). Idempotent: tables and indexes are created only if missing,
-- constraints are dropped by name and added again, functions are replaced and
-- triggers dropped and recreated. Adds three tables, two functions and two
-- triggers; changes no row, and no existing table.
--
-- WHY.
-- Colleges report course-outcome (CO) attainment: the share of students meeting
-- each outcome of a course, which accreditation asks for and which is compiled by
-- hand today. A quiz answer is evidence for an outcome only if something says
-- which outcome its question serves. This is that something (roadmap step 4,
-- "course-outcome tagging"); the attainment report reads it.
--
-- WHAT IS ADDED.
--   course_outcomes   a class's outcomes ("CO1: Explain how TCP recovers from
--                     loss"). A class is a course and a section, and attainment is
--                     reported per class, so outcomes belong to a class; a second
--                     section copies them (new rows, nothing linked).
--     code            short, upper case, single-spaced, at most 16 characters
--                     ('CO1', 'CS301.2'); one per class among outcomes not
--                     archived (course_outcomes_class_code_key).
--     statement       at most 300 characters.
--     target_level    optional: the Bloom level the outcome is written at.
--     position        the class's order. Not unique: a reorder writes it row by
--                     row, and ties are broken by created_at.
--     archived_at     an outcome with evidence is archived, not deleted: it keeps
--                     its mappings, evidence still reaches it, and a later report
--                     still names it. Null is in use.
--
--   outcome_topics    an outcome mapped to a topic of a chapter, with a weight
--                     (default 1: how much that topic's evidence counts beside the
--                     outcome's other topics). A topic may map to several
--                     outcomes. Topics are text, as contents.topics,
--                     questions.topic and answers.topic carry them; one per
--                     chapter per outcome, compared in lower case.
--     class_id        the outcome's class, kept beside it so a class's mappings
--                     are one read; the foreign key on (outcome_id, class_id)
--                     makes it the outcome's own.
--     content_id      No ON DELETE action: a chapter mapped to an outcome is not
--                     deleted out from under the mapping (no route deletes a
--                     chapter today).
--
--   question_outcome_overrides
--                     one per (class, question): the question mapped straight to
--                     some outcomes in place of its topic's (outcome_ids), or kept
--                     out of every outcome (excluded).
--     question_id     NO foreign key, on purpose. An answer keeps its question's
--                     id in its snapshot after the question is deleted (0008 sets
--                     answers.question_id null), and the professor's decision
--                     about that question still applies to the answers given to
--                     it. A foreign key would delete the decision with the
--                     question.
--     outcome_ids     an array, like sessions.question_ids (0015): an override is
--                     one decision, written and read whole. Every id is an outcome
--                     of the same class (trigger below).
--
-- WHAT IS NOT ADDED. No column on answers, questions or sessions: an answer is
-- traced to its outcomes when a report runs, from the question id, chapter and
-- topic it already carries (server/src/services/outcomes.js resolveAnswer). So
-- a room's archive (0009) needs nothing from here either.
--
-- PRIVACY. Staff-only, like every class table: nothing here reaches a phone or
-- the projector. Nothing here is about a student.
--
-- WHAT IS REFUSED.
--   A code not upper case and single-spaced, or not a short label; a blank or
--   over-long statement; a target level outside the six (British spelling); a
--   position below 1; a topic not trimmed and single-spaced, blank or over 160
--   characters; a weight of 0 or less, or over 100; an override that both maps
--   and excludes, or does neither, or names more than 50 outcomes or a null
--   (23514). Two outcomes of one class with one code, neither archived; one
--   topic twice for one outcome and chapter; two overrides for one question in
--   one class (23505). A mapping whose class is not its outcome's; a chapter that
--   does not exist; an override naming an outcome of another class; deleting an
--   outcome an override still names, except with its class (23503). An override
--   naming one outcome twice (23514). Moving an outcome to another class (23001).
--
-- RLS is on with no policies, like every table: only the server's service role
-- reads or writes, and the server decides who sees what.

-- --------------------------------------------------------- course_outcomes --

create table if not exists public.course_outcomes (
  id            uuid        primary key default gen_random_uuid(),
  class_id      uuid        not null references public.classes (id) on delete cascade,
  code          text        not null,
  statement     text        not null,
  target_level  text,
  position      integer     not null default 1,
  created_at    timestamptz not null default now(),
  -- No trigger maintains this; the server sets it on every update, as for classes.
  updated_at    timestamptz not null default now(),
  archived_at   timestamptz,
  -- The target of outcome_topics' foreign key on (outcome_id, class_id).
  constraint course_outcomes_id_class_key unique (id, class_id)
);

alter table public.course_outcomes enable row level security;

alter table public.course_outcomes drop constraint if exists course_outcomes_code_check;
alter table public.course_outcomes
  add constraint course_outcomes_code_check check (
    code ~ '^[A-Z0-9][A-Z0-9 ._/-]{0,15}$'
    and code = upper(regexp_replace(regexp_replace(code, '^\s+|\s+$', '', 'g'), '\s+', ' ', 'g'))
  );
alter table public.course_outcomes drop constraint if exists course_outcomes_statement_check;
alter table public.course_outcomes
  add constraint course_outcomes_statement_check check (char_length(btrim(statement)) between 1 and 300);
alter table public.course_outcomes drop constraint if exists course_outcomes_target_level_check;
alter table public.course_outcomes
  add constraint course_outcomes_target_level_check check (
    target_level is null
    or target_level in ('remember', 'understand', 'apply', 'analyse', 'evaluate', 'create')
  );
alter table public.course_outcomes drop constraint if exists course_outcomes_position_check;
alter table public.course_outcomes
  add constraint course_outcomes_position_check check (position >= 1);

-- One code per class among outcomes in use. An archived CO3 leaves its code free
-- for a new CO3, and keeps its own.
create unique index if not exists course_outcomes_class_code_key
  on public.course_outcomes (class_id, code) where archived_at is null;
-- A class's outcomes in its order, archived ones included.
create index if not exists course_outcomes_class_idx on public.course_outcomes (class_id, position);

-- ---------------------------------------------------------- outcome_topics --

create table if not exists public.outcome_topics (
  id          uuid          primary key default gen_random_uuid(),
  outcome_id  uuid          not null,
  class_id    uuid          not null,
  content_id  uuid          not null references public.contents (id),
  topic       text          not null,
  weight      numeric(6, 3) not null default 1,
  created_at  timestamptz   not null default now(),
  constraint outcome_topics_outcome_fkey foreign key (outcome_id, class_id)
    references public.course_outcomes (id, class_id) on delete cascade
);

alter table public.outcome_topics enable row level security;

-- As every topic writer leaves a topic: trimmed and single-spaced (cleanTopic in
-- services/outcomes.js), and as long as a topic may be anywhere else.
alter table public.outcome_topics drop constraint if exists outcome_topics_topic_check;
alter table public.outcome_topics
  add constraint outcome_topics_topic_check check (
    char_length(topic) between 1 and 160
    and topic = regexp_replace(regexp_replace(topic, '^\s+|\s+$', '', 'g'), '\s+', ' ', 'g')
  );
alter table public.outcome_topics drop constraint if exists outcome_topics_weight_check;
alter table public.outcome_topics
  add constraint outcome_topics_weight_check check (weight > 0 and weight <= 100);

-- One topic per chapter per outcome, compared as the server compares topics
-- (topicKey: lower case). Also the index for reading one outcome's topics.
create unique index if not exists outcome_topics_outcome_topic_key
  on public.outcome_topics (outcome_id, content_id, lower(topic));
create index if not exists outcome_topics_class_idx on public.outcome_topics (class_id);
-- The chapter's foreign key's own index.
create index if not exists outcome_topics_content_idx on public.outcome_topics (content_id);

-- ---------------------------------------------- question_outcome_overrides --

create table if not exists public.question_outcome_overrides (
  id           uuid        primary key default gen_random_uuid(),
  class_id     uuid        not null references public.classes (id) on delete cascade,
  question_id  uuid        not null,
  outcome_ids  uuid[]      not null default '{}',
  excluded     boolean     not null default false,
  updated_at   timestamptz not null default now(),
  updated_by   uuid        references public.accounts (id) on delete set null,
  -- One per question per class: what the server upserts on. Also the index for
  -- reading a class's overrides.
  constraint question_outcome_overrides_class_question_key unique (class_id, question_id)
);

alter table public.question_outcome_overrides enable row level security;

alter table public.question_outcome_overrides drop constraint if exists question_outcome_overrides_shape;
alter table public.question_outcome_overrides
  add constraint question_outcome_overrides_shape check (
    (excluded and cardinality(outcome_ids) = 0)
    or (not excluded
        and array_ndims(outcome_ids) = 1
        and cardinality(outcome_ids) between 1 and 50
        and array_position(outcome_ids, null) is null)
  );

create index if not exists question_outcome_overrides_updated_by_idx
  on public.question_outcome_overrides (updated_by) where updated_by is not null;

-- ------------------------------------------------------------- the guards --

-- An override names outcomes of its own class, each once. Postgres cannot put
-- a foreign key on array elements, so this does what one would.
create or replace function public.question_outcome_overrides_in_class()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- A null in the list is the shape check's to refuse (it runs after this).
  if array_position(new.outcome_ids, null) is not null then
    return new;
  end if;
  if exists (
    select 1
      from unnest(new.outcome_ids) as x(id)
     where not exists (select 1 from public.course_outcomes o where o.id = x.id and o.class_id = new.class_id)
  ) then
    raise exception 'the override of question % names a course outcome that is not one of class %', new.question_id, new.class_id
      using errcode = 'foreign_key_violation';
  end if;
  if cardinality(new.outcome_ids) <> (select count(distinct x) from unnest(new.outcome_ids) as x) then
    raise exception 'the override of question % names a course outcome twice', new.question_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists question_outcome_overrides_in_class on public.question_outcome_overrides;
create trigger question_outcome_overrides_in_class
  before insert or update of class_id, outcome_ids on public.question_outcome_overrides
  for each row execute function public.question_outcome_overrides_in_class();

-- An outcome stays in its class, and is not deleted while an override names it
-- (the server takes it off the override first, and says so). Deleting the class
-- takes its outcomes and overrides together: inside that cascade
-- (pg_trigger_depth() > 1) the delete goes ahead, as 0017's guard allows.
create or replace function public.course_outcomes_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.class_id is distinct from old.class_id then
      raise exception 'course outcome % belongs to its class and cannot be moved to another', old.id
        using errcode = 'restrict_violation';
    end if;
    return new;
  end if;
  if pg_trigger_depth() = 1 and exists (
    select 1 from public.question_outcome_overrides q where q.class_id = old.class_id and old.id = any (q.outcome_ids)
  ) then
    raise exception 'course outcome % is named by a question override: take it off the override first', old.id
      using errcode = 'foreign_key_violation';
  end if;
  return old;
end;
$$;

drop trigger if exists course_outcomes_guard on public.course_outcomes;
create trigger course_outcomes_guard
  before update of class_id or delete on public.course_outcomes
  for each row execute function public.course_outcomes_guard();

comment on table public.course_outcomes is
  'A class''s course outcomes (code, statement, optional target Bloom level, order). Archived (archived_at), not deleted, once evidence reaches them.';
comment on table public.outcome_topics is
  'A course outcome mapped to a topic of a chapter, with a weight. Topics compared in lower case; one per chapter per outcome.';
comment on table public.question_outcome_overrides is
  'One question''s outcomes in one class, in place of its topic''s: outcome_ids, or excluded from every outcome. question_id has no foreign key: the decision outlives the question for the answers given to it.';
