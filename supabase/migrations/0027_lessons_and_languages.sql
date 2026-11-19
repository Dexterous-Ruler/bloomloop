-- 0027: lessons from a professor's own slides, and Hindi and Marathi versions
-- (Phase 6, decisions H11 and H12, under the owner's decisions 1 and 5).
--
-- Apply in number order with the rest of supabase/migrations (see
-- supabase/README.md). Needs contents (0000), accounts (0001) and chapter_topics
-- (0025). Idempotent: tables and indexes are created only if missing, constraints
-- are dropped by name and added again, functions are replaced and triggers
-- dropped and recreated. Adds three tables, four functions and two triggers;
-- changes no existing row and no existing constraint. No answer, question, room,
-- profile, ladder, attainment figure or marks register reads any of it.
--
-- WHY. Decision 1 lets a professor's own material become teaching content: cited
-- to the slide, an "AI draft" until the professor approves it, never new
-- syllabus. Decision H11 makes that a lesson per topic, and H12 adds Hindi and
-- Marathi versions of what a student reads, each approved before a student sees
-- it. Both are generated only on the professor's button (decision 5), so a
-- student never waits on a model.
--
-- WHAT IS ADDED.
--   topic_lessons    one row per version of a topic's lesson. `steps` is the
--                    lesson in order: a chunk of the professor's own slide text
--                    (cited by slide number), a worked example (an AI draft),
--                    the ids of 2 to 4 retrieval questions (drafts in the bank,
--                    through the normal approval gate), the next chunk, and so
--                    on. `source` is 'llm' (an AI draft; `model` names the model)
--                    or 'slides' (slides only: the professor's chunks and
--                    questions already approved, no generated prose; no model).
--                    `basis` says what the chunks were read from (each slide's
--                    own words, or the chapter's text cited by the topic's slide
--                    numbers, or pasted text). A lesson is written as a draft;
--                    approving it makes it what students read and moves the one
--                    approved before it to 'superseded' in the same statement
--                    (approve_topic_lesson), so regenerating keeps the approved
--                    lesson serving until the new one is approved. A draft may be
--                    discarded instead. One approved lesson per topic.
--
--   item_translations   a Hindi ('hi') or Marathi ('mr') version of one item a
--                    student reads, in one generic shape: `item_kind` names what
--                    it translates ('question' and 'lesson' now; 'explanation',
--                    'hint' and 'feedback' are reserved for the hub's tutor and
--                    explanations, H13 and H14) and `item_id` which one (no
--                    foreign key: it points into several tables). `fields` holds
--                    the translated text by field name, a string or a list of
--                    strings; `source_fields` and `source_hash` the English it
--                    was made from, so a translation whose English has changed
--                    since is never shown. Never a key: a question's text and
--                    options only. `provenance` 'ai' (made on the professor's
--                    button) or 'professor' (written or edited by the
--                    professor). `checks` is what the translation check found
--                    (formulas, numbers or a list's length that differ). Draft
--                    until approved; approving one moves the one approved before
--                    it to 'superseded' in the same statement
--                    (approve_item_translation). One approved per item and
--                    language.
--
--   student_language_choices   the language a student chose to read the hub in:
--                    'en' (the original), 'hi' or 'mr'. One row per account.
--
-- WHAT IS NOT ADDED. Nothing on answers, questions, sessions or profiles. A
-- lesson's retrieval questions are ordinary bank rows (questions, 0013), written
-- as drafts by the server. A student's answers inside a lesson are hub attempts,
-- kept in the hub's attempt store (H5), not here.
--
-- WRITTEN ONCE. A lesson's steps, source, model, basis, warnings, topic, chapter,
-- owner, version and creation are never changed: what a student read is kept as
-- they read it. A translation's text may change only while it is a draft. Only a
-- row's status moves on (draft -> approved -> superseded, or draft ->
-- discarded), with who decided and when, each written once. No row is deleted
-- except with its chapter or topic. Who wrote, edited or decided is cleared when
-- that account is deleted (ON DELETE SET NULL), and nothing else.
--
-- WHAT IS REFUSED. A status, source, provenance, language or item kind outside
-- its list; a version below 1; steps that are not a non-empty list of chunk,
-- example and questions steps; a model on a slides-only lesson or none on an AI
-- lesson; approval or retirement times that do not match the status; fields or
-- source fields that are not objects; a source hash that is not 64 hex digits
-- (23514). A second approved lesson for a topic, a second approved translation
-- for an item and language, a second version number for a topic (23505). A row
-- not written as a draft, a lesson of a topic outside its chapter, a row of
-- another owner than its chapter's, a status move outside the list (23514 or
-- 23503). Any other change or a delete (23001 restrict_violation).
--
-- RLS is on with no policies, like every table: only the server's service role
-- reads or writes, and the server decides who sees what (services/hubAccess.js).

-- ------------------------------------------------------------ topic_lessons --

create table if not exists public.topic_lessons (
  id           uuid        primary key default gen_random_uuid(),
  topic_id     uuid        not null references public.chapter_topics (id) on delete cascade,
  content_id   uuid        not null references public.contents (id) on delete cascade,
  -- The professor who owns the chapter. Null only for a chapter made before
  -- accounts, which only the shared teacher key reaches.
  owner_id     uuid        references public.accounts (id),
  version      integer     not null,
  status       text        not null default 'draft',
  source       text        not null,
  model        text,
  steps        jsonb       not null,
  basis        jsonb       not null default '{}'::jsonb,
  warnings     jsonb       not null default '[]'::jsonb,
  created_at   timestamptz not null default now(),
  created_by   uuid        references public.accounts (id) on delete set null,
  approved_at  timestamptz,
  approved_by  uuid        references public.accounts (id) on delete set null,
  retired_at   timestamptz,
  retired_by   uuid        references public.accounts (id) on delete set null,
  constraint topic_lessons_topic_version_key unique (topic_id, version)
);

alter table public.topic_lessons enable row level security;

alter table public.topic_lessons drop constraint if exists topic_lessons_status_check;
alter table public.topic_lessons
  add constraint topic_lessons_status_check check (
    status in ('draft', 'approved', 'superseded', 'discarded')
    -- Approved exactly when a professor approved it (superseded lessons were).
    and ((status in ('approved', 'superseded')) = (approved_at is not null))
    -- Retired exactly when it stopped serving, or was discarded as a draft.
    and ((status in ('superseded', 'discarded')) = (retired_at is not null))
  );
alter table public.topic_lessons drop constraint if exists topic_lessons_source_check;
alter table public.topic_lessons
  add constraint topic_lessons_source_check check (
    source in ('llm', 'slides')
    -- An AI draft names its model; a slides-only lesson had none.
    and ((source = 'slides') = (model is null))
  );
alter table public.topic_lessons drop constraint if exists topic_lessons_version_check;
alter table public.topic_lessons add constraint topic_lessons_version_check check (version >= 1);
alter table public.topic_lessons drop constraint if exists topic_lessons_steps_check;
alter table public.topic_lessons
  add constraint topic_lessons_steps_check check (
    jsonb_typeof(steps) = 'array'
    and jsonb_array_length(steps) >= 1
    and not jsonb_path_exists(steps,
      '$[*] ? (@.type() != "object" || !(@."type" == "chunk" || @."type" == "example" || @."type" == "questions"))')
  );
alter table public.topic_lessons drop constraint if exists topic_lessons_shape_check;
alter table public.topic_lessons
  add constraint topic_lessons_shape_check check (
    jsonb_typeof(basis) = 'object' and jsonb_typeof(warnings) = 'array'
  );

-- One lesson serving per topic: the one students read.
create unique index if not exists topic_lessons_one_approved on public.topic_lessons (topic_id) where status = 'approved';
create index if not exists topic_lessons_content_idx on public.topic_lessons (content_id);

create or replace function public.topic_lessons_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  decided constant text[] := array['status', 'approved_at', 'approved_by', 'retired_at', 'retired_by'];
  cleared constant text[] := array['created_by', 'approved_by', 'retired_by'];
begin
  -- pg_trigger_depth() is 1 for a statement sent directly, and above 1 inside a
  -- foreign key's own action: the cascade from a chapter or a topic, or an
  -- account's deletion clearing who wrote or decided.
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    raise exception 'topic_lessons is kept: lesson % goes only with its topic or its chapter', old.id
      using errcode = 'restrict_violation';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'a lesson is written as a draft; only approving it makes it what students read'
        using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.chapter_topics t where t.id = new.topic_id and t.content_id = new.content_id) then
      raise exception 'a lesson''s topic must be one of its chapter''s topics' using errcode = 'foreign_key_violation';
    end if;
    if exists (select 1 from public.contents c where c.id = new.content_id and c.owner_id is distinct from new.owner_id) then
      raise exception 'a lesson belongs to the professor who owns its chapter' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if pg_trigger_depth() > 1 and (to_jsonb(new) - cleared) = (to_jsonb(old) - cleared) then
    return new;
  end if;
  if (to_jsonb(new) - decided) is distinct from (to_jsonb(old) - decided) then
    raise exception 'lesson % is written once: only its status, and who approved or retired it and when, may change', old.id
      using errcode = 'restrict_violation';
  end if;
  if new.status = old.status then
    if (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
      raise exception 'lesson %: who approved or retired it, and when, are written once', old.id
        using errcode = 'restrict_violation';
    end if;
    return new;
  end if;
  if not ((old.status = 'draft' and new.status in ('approved', 'discarded'))
          or (old.status = 'approved' and new.status = 'superseded')) then
    raise exception 'a lesson goes from draft to approved or discarded, and from approved to superseded; not from % to %',
      old.status, new.status using errcode = 'check_violation';
  end if;
  if old.approved_at is not null
     and (new.approved_at is distinct from old.approved_at or new.approved_by is distinct from old.approved_by) then
    raise exception 'lesson %: who approved it, and when, are written once', old.id using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists topic_lessons_guard on public.topic_lessons;
create trigger topic_lessons_guard
  before insert or update or delete on public.topic_lessons
  for each row execute function public.topic_lessons_guard();

-- Approve a draft and retire the lesson it replaces, in one statement, so a
-- topic is never left with none serving between the two writes. Returns the
-- approved row, or no row when there is no such lesson.
create or replace function public.approve_topic_lesson(p_lesson uuid, p_by uuid)
returns setof public.topic_lessons
language plpgsql
set search_path = public
as $$
declare
  target public.topic_lessons;
begin
  select * into target from public.topic_lessons where id = p_lesson for update;
  if not found then
    return;
  end if;
  if target.status <> 'draft' then
    raise exception 'only a draft lesson can be approved; lesson % is %', p_lesson, target.status
      using errcode = 'check_violation';
  end if;
  update public.topic_lessons set status = 'superseded', retired_at = now(), retired_by = p_by
   where topic_id = target.topic_id and status = 'approved';
  return query
    update public.topic_lessons set status = 'approved', approved_at = now(), approved_by = p_by
     where id = p_lesson returning *;
end;
$$;

comment on table public.topic_lessons is
  'A topic''s lesson, one row per version (0027): the professor''s own slide text in chunks, cited by slide, with worked examples (AI drafts) and retrieval questions (bank drafts). Students read the approved one only.';

-- -------------------------------------------------------- item_translations --

create table if not exists public.item_translations (
  id             uuid        primary key default gen_random_uuid(),
  item_kind      text        not null,
  item_id        uuid        not null,
  content_id     uuid        not null references public.contents (id) on delete cascade,
  owner_id       uuid        references public.accounts (id),
  language       text        not null,
  fields         jsonb       not null,
  source_fields  jsonb       not null,
  source_hash    text        not null,
  status         text        not null default 'draft',
  provenance     text        not null,
  model          text,
  checks         jsonb       not null default '[]'::jsonb,
  created_at     timestamptz not null default now(),
  created_by     uuid        references public.accounts (id) on delete set null,
  -- No trigger maintains this; the server sets it on every edit of a draft.
  updated_at     timestamptz not null default now(),
  edited_by      uuid        references public.accounts (id) on delete set null,
  approved_at    timestamptz,
  approved_by    uuid        references public.accounts (id) on delete set null,
  retired_at     timestamptz,
  retired_by     uuid        references public.accounts (id) on delete set null
);

alter table public.item_translations enable row level security;

alter table public.item_translations drop constraint if exists item_translations_kind_check;
alter table public.item_translations
  add constraint item_translations_kind_check check (item_kind in ('question', 'lesson', 'explanation', 'hint', 'feedback'));
alter table public.item_translations drop constraint if exists item_translations_language_check;
alter table public.item_translations add constraint item_translations_language_check check (language in ('hi', 'mr'));
alter table public.item_translations drop constraint if exists item_translations_status_check;
alter table public.item_translations
  add constraint item_translations_status_check check (
    status in ('draft', 'approved', 'superseded', 'discarded')
    and ((status in ('approved', 'superseded')) = (approved_at is not null))
    and ((status in ('superseded', 'discarded')) = (retired_at is not null))
  );
alter table public.item_translations drop constraint if exists item_translations_provenance_check;
alter table public.item_translations add constraint item_translations_provenance_check check (provenance in ('ai', 'professor'));
alter table public.item_translations drop constraint if exists item_translations_shape_check;
alter table public.item_translations
  add constraint item_translations_shape_check check (
    jsonb_typeof(fields) = 'object' and jsonb_typeof(source_fields) = 'object' and jsonb_typeof(checks) = 'array'
    and source_hash ~ '^[0-9a-f]{64}$'
  );

create unique index if not exists item_translations_one_approved
  on public.item_translations (item_kind, item_id, language) where status = 'approved';
create index if not exists item_translations_item_idx on public.item_translations (item_kind, item_id);
create index if not exists item_translations_content_idx on public.item_translations (content_id);

create or replace function public.item_translations_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  editable constant text[] := array['fields', 'source_fields', 'source_hash', 'checks', 'provenance', 'updated_at', 'edited_by'];
  decided constant text[] := array['status', 'approved_at', 'approved_by', 'retired_at', 'retired_by'];
  cleared constant text[] := array['created_by', 'edited_by', 'approved_by', 'retired_by'];
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    raise exception 'item_translations is kept: translation % goes only with its chapter', old.id
      using errcode = 'restrict_violation';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'a translation is written as a draft; only approving it shows it to students'
        using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.contents c where c.id = new.content_id and c.owner_id is distinct from new.owner_id) then
      raise exception 'a translation belongs to the professor who owns its chapter' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if pg_trigger_depth() > 1 and (to_jsonb(new) - cleared) = (to_jsonb(old) - cleared) then
    return new;
  end if;
  if (to_jsonb(new) - editable - decided) is distinct from (to_jsonb(old) - editable - decided) then
    raise exception 'translation % is written once: only its text while a draft, and its status, may change', old.id
      using errcode = 'restrict_violation';
  end if;
  if (to_jsonb(new) - decided - 'updated_at') is distinct from (to_jsonb(old) - decided - 'updated_at')
     and not (old.status = 'draft' and new.status = 'draft') then
    raise exception 'translation % can be changed only while it is a draft', old.id using errcode = 'restrict_violation';
  end if;
  if new.status = old.status then
    if (jsonb_build_object('a', new.approved_at, 'b', new.approved_by, 'c', new.retired_at, 'd', new.retired_by))
       is distinct from (jsonb_build_object('a', old.approved_at, 'b', old.approved_by, 'c', old.retired_at, 'd', old.retired_by)) then
      raise exception 'translation %: who approved or retired it, and when, are written once', old.id
        using errcode = 'restrict_violation';
    end if;
    return new;
  end if;
  if not ((old.status = 'draft' and new.status in ('approved', 'discarded'))
          or (old.status = 'approved' and new.status = 'superseded')) then
    raise exception 'a translation goes from draft to approved or discarded, and from approved to superseded; not from % to %',
      old.status, new.status using errcode = 'check_violation';
  end if;
  if old.approved_at is not null
     and (new.approved_at is distinct from old.approved_at or new.approved_by is distinct from old.approved_by) then
    raise exception 'translation %: who approved it, and when, are written once', old.id using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists item_translations_guard on public.item_translations;
create trigger item_translations_guard
  before insert or update or delete on public.item_translations
  for each row execute function public.item_translations_guard();

-- Approve a draft translation and retire the one it replaces, in one statement.
create or replace function public.approve_item_translation(p_translation uuid, p_by uuid)
returns setof public.item_translations
language plpgsql
set search_path = public
as $$
declare
  target public.item_translations;
begin
  select * into target from public.item_translations where id = p_translation for update;
  if not found then
    return;
  end if;
  if target.status <> 'draft' then
    raise exception 'only a draft translation can be approved; translation % is %', p_translation, target.status
      using errcode = 'check_violation';
  end if;
  update public.item_translations set status = 'superseded', retired_at = now(), retired_by = p_by
   where item_kind = target.item_kind and item_id = target.item_id and language = target.language and status = 'approved';
  return query
    update public.item_translations set status = 'approved', approved_at = now(), approved_by = p_by
     where id = p_translation returning *;
end;
$$;

comment on table public.item_translations is
  'Hindi and Marathi versions of what a student reads (0027): a question''s text and options (never its key), a lesson, and later explanations and hints. Students see an approved one whose English has not changed since.';

-- ------------------------------------------------- student_language_choices --

create table if not exists public.student_language_choices (
  account_id  uuid        primary key references public.accounts (id) on delete cascade,
  language    text        not null,
  updated_at  timestamptz not null default now()
);

alter table public.student_language_choices enable row level security;

alter table public.student_language_choices drop constraint if exists student_language_choices_language_check;
alter table public.student_language_choices
  add constraint student_language_choices_language_check check (language in ('en', 'hi', 'mr'));

comment on table public.student_language_choices is
  'The language a student reads the hub in (0027): en (the original), hi or mr. A translation is shown only once approved; otherwise English, with a note.';
