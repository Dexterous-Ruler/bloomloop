-- 0025: the Learning Hub's content backbone (Phase 6, decisions H3 and H4).
--
-- Apply in number order with the rest of supabase/migrations (see
-- supabase/README.md). Needs contents (0000), accounts (0001) and classes
-- (0016). Idempotent: tables, indexes and the column are created only if
-- missing, constraints are dropped by name and added again, functions are
-- replaced and triggers dropped and recreated. Adds four tables, one column, two
-- functions and two triggers; changes no existing row and no existing
-- constraint, and no answer, question, room or attainment figure reads any of it.
--
-- WHY. The hub (for student accounts; rooms stay account-free, decision 7) has
-- to point at things a room never needed to name: a class's units, the chapters
-- a class covers, a chapter's topics as records, and which topic is needed
-- before which. Questions keep their topic text and are matched to a record by
-- name within their chapter (server/src/services/hubTopics.js); no question row
-- is rewritten.
--
-- WHAT IS ADDED.
--   contents.slide_texts  each slide's own words, [{ "slide": n, "text": "..." }],
--                    kept when a deck is uploaded from Phase 6 on (H4). Null for
--                    every chapter before this file and for pasted text: their
--                    topics still cite slide numbers through topic_slides only.
--                    Written by its own statement after the chapter is made, so
--                    a database without this column still takes uploads.
--
--   class_units      a class's units: a name (1 to 80 characters, trimmed and
--                    single-spaced, one per class ignoring case) and a position
--                    (the class's order; not unique, as for course outcomes, so a
--                    reorder is written row by row).
--
--   class_chapters   the chapters a class covers, one row per (class, chapter),
--                    each in a unit or in none ("Other chapters"), with a
--                    position within it. Removing a unit leaves its chapters on
--                    the class in no unit (ON DELETE SET NULL). A chapter is
--                    placed only on a class of the professor who owns it, and a
--                    unit only of the same class (trigger below).
--
--   chapter_topics   a chapter's topics as records (H3): name (1 to 300
--                    characters, trimmed and single-spaced), key (the name in
--                    lower case, what questions are matched by; one per
--                    chapter), position (the chapter's order), retired_at (a
--                    topic that left the chapter's list but has questions or
--                    links is retired, never deleted; null is in use).
--
--   topic_links      prerequisite links, topic -> topic, across any chapters
--                    one professor owns (H3): prerequisite_id is needed before
--                    topic_id. provenance 'ai' (proposed by the model on the
--                    professor's button) or 'professor' (added by hand);
--                    state 'proposed', 'confirmed' or 'rejected'. Only confirmed
--                    links are used; longer chains are computed from them, never
--                    stored. A professor's own link is never 'proposed'. One link
--                    per pair; never a topic before itself; never a loop of
--                    confirmed links (trigger below); both topics' chapters owned
--                    by the link's owner (trigger below). reason: one line, at
--                    most 300 characters. model: the model a proposal came from.
--
-- WHAT IS NOT ADDED. Nothing on answers, questions, sessions or profiles: the
-- hub's backbone moves no level, no mark and no attainment figure, and a room's
-- archive (0009) needs nothing from here. No student data: these tables
-- describe a professor's material.
--
-- DELETING. A chapter's placements and topic records go with the chapter (no
-- route deletes one), and a topic's links with the topic; the server deletes a
-- topic record only when nothing hangs off it. A class's units and placements
-- go with the class.
--
-- WHAT IS REFUSED. A unit name blank, over 80 characters or not single-spaced,
-- or a position below 1 (23514); two units of one name in a class (23505). A
-- chapter twice on a class (23505); a unit of another class, a class or chapter
-- that does not exist (23503); a chapter of another owner (23514). A topic name
-- blank, over 300 characters or not single-spaced, a blank key, a position below
-- 1 (23514); one key twice in a chapter (23505). A link from a topic to itself, a
-- provenance or state outside the lists, a professor's link left proposed, a
-- decision time on a proposal or none on a decision, a model on a professor's
-- link, a reason over 300 characters (23514); a pair twice (23505); a confirmed
-- link that closes a loop, or one between chapters of another owner (23514).
--
-- RLS is on with no policies, like every table: only the server's service role
-- reads or writes, and the server decides who sees what (services/hubAccess.js).

-- ------------------------------------------------------ contents.slide_texts --

alter table public.contents add column if not exists slide_texts jsonb;

alter table public.contents drop constraint if exists contents_slide_texts_check;
alter table public.contents
  add constraint contents_slide_texts_check check (
    slide_texts is null
    or (jsonb_typeof(slide_texts) = 'array'
        and not jsonb_path_exists(slide_texts,
          '$[*] ? (@.type() != "object" || !exists(@.slide) || !exists(@.text) || @.slide.type() != "number"
                   || @.text.type() != "string")'))
  );

comment on column public.contents.slide_texts is
  'Each slide''s own words, [{ slide, text }], kept for decks uploaded from Phase 6 on (0025). Null for older decks and pasted text. Staff and model input only; never sent to a student except inside an approved lesson.';

-- ------------------------------------------------------------- class_units --

create table if not exists public.class_units (
  id          uuid        primary key default gen_random_uuid(),
  class_id    uuid        not null references public.classes (id) on delete cascade,
  name        text        not null,
  position    integer     not null default 1,
  created_at  timestamptz not null default now(),
  -- No trigger maintains this; the server sets it on every update, as for classes.
  updated_at  timestamptz not null default now(),
  created_by  uuid        references public.accounts (id) on delete set null
);

alter table public.class_units enable row level security;

alter table public.class_units drop constraint if exists class_units_name_check;
alter table public.class_units
  add constraint class_units_name_check check (
    char_length(name) between 1 and 80
    and name = regexp_replace(regexp_replace(name, '^\s+|\s+$', '', 'g'), '\s+', ' ', 'g')
  );
alter table public.class_units drop constraint if exists class_units_position_check;
alter table public.class_units add constraint class_units_position_check check (position >= 1);

create unique index if not exists class_units_class_name_key on public.class_units (class_id, lower(name));
create index if not exists class_units_class_idx on public.class_units (class_id, position);

-- ---------------------------------------------------------- class_chapters --

create table if not exists public.class_chapters (
  id          uuid        primary key default gen_random_uuid(),
  class_id    uuid        not null references public.classes (id) on delete cascade,
  content_id  uuid        not null references public.contents (id) on delete cascade,
  unit_id     uuid        references public.class_units (id) on delete set null,
  position    integer     not null default 1,
  added_at    timestamptz not null default now(),
  added_by    uuid        references public.accounts (id) on delete set null,
  constraint class_chapters_class_content_key unique (class_id, content_id)
);

alter table public.class_chapters enable row level security;

alter table public.class_chapters drop constraint if exists class_chapters_position_check;
alter table public.class_chapters add constraint class_chapters_position_check check (position >= 1);

create index if not exists class_chapters_content_idx on public.class_chapters (content_id);
create index if not exists class_chapters_unit_idx on public.class_chapters (unit_id) where unit_id is not null;

-- A unit of the same class, and a chapter of the class's own professor. A
-- foreign key cannot say either: the unit's class and the two owners are on
-- other rows.
create or replace function public.class_chapters_in_class()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.unit_id is not null
     and not exists (select 1 from public.class_units u where u.id = new.unit_id and u.class_id = new.class_id) then
    raise exception 'that unit is not one of this class''s units' using errcode = 'foreign_key_violation';
  end if;
  if exists (
    select 1 from public.classes c, public.contents ct
     where c.id = new.class_id and ct.id = new.content_id and c.owner_id is distinct from ct.owner_id
  ) then
    raise exception 'a chapter can only be placed on a class of the professor who owns it' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists class_chapters_in_class on public.class_chapters;
create trigger class_chapters_in_class
  before insert or update on public.class_chapters
  for each row execute function public.class_chapters_in_class();

-- ---------------------------------------------------------- chapter_topics --

create table if not exists public.chapter_topics (
  id          uuid        primary key default gen_random_uuid(),
  content_id  uuid        not null references public.contents (id) on delete cascade,
  name        text        not null,
  key         text        not null,
  position    integer     not null default 1,
  retired_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- One record per topic of a chapter; what the server's insert skips on.
  constraint chapter_topics_content_key_key unique (content_id, key)
);

alter table public.chapter_topics enable row level security;

alter table public.chapter_topics drop constraint if exists chapter_topics_name_check;
alter table public.chapter_topics
  add constraint chapter_topics_name_check check (
    char_length(name) between 1 and 300
    and name = regexp_replace(regexp_replace(name, '^\s+|\s+$', '', 'g'), '\s+', ' ', 'g')
  );
-- The key is the name in lower case, as the server computes it (topicKey). Its
-- case folding is the server's, not the database's, so only its length is checked.
alter table public.chapter_topics drop constraint if exists chapter_topics_key_check;
alter table public.chapter_topics add constraint chapter_topics_key_check check (char_length(key) between 1 and 300);
alter table public.chapter_topics drop constraint if exists chapter_topics_position_check;
alter table public.chapter_topics add constraint chapter_topics_position_check check (position >= 1);

-- ------------------------------------------------------------- topic_links --

create table if not exists public.topic_links (
  id               uuid        primary key default gen_random_uuid(),
  -- The professor who owns both topics' chapters. Null only for chapters made
  -- before accounts, which only the shared teacher key reaches.
  owner_id         uuid        references public.accounts (id),
  prerequisite_id  uuid        not null references public.chapter_topics (id) on delete cascade,
  topic_id         uuid        not null references public.chapter_topics (id) on delete cascade,
  provenance       text        not null,
  state            text        not null default 'proposed',
  reason           text        not null default '',
  model            text,
  created_at       timestamptz not null default now(),
  created_by       uuid        references public.accounts (id) on delete set null,
  decided_at       timestamptz,
  decided_by       uuid        references public.accounts (id) on delete set null,
  constraint topic_links_pair_key unique (prerequisite_id, topic_id)
);

alter table public.topic_links enable row level security;

alter table public.topic_links drop constraint if exists topic_links_not_self;
alter table public.topic_links add constraint topic_links_not_self check (prerequisite_id <> topic_id);
alter table public.topic_links drop constraint if exists topic_links_provenance_check;
alter table public.topic_links add constraint topic_links_provenance_check check (provenance in ('ai', 'professor'));
alter table public.topic_links drop constraint if exists topic_links_state_check;
alter table public.topic_links
  add constraint topic_links_state_check check (
    state in ('proposed', 'confirmed', 'rejected')
    -- A professor's own link is a decision when it is made.
    and (provenance = 'ai' or state <> 'proposed')
    -- Decided exactly when it is no longer a proposal.
    and ((state = 'proposed') = (decided_at is null))
  );
alter table public.topic_links drop constraint if exists topic_links_model_check;
alter table public.topic_links add constraint topic_links_model_check check (provenance = 'ai' or model is null);
alter table public.topic_links drop constraint if exists topic_links_reason_check;
alter table public.topic_links add constraint topic_links_reason_check check (char_length(reason) <= 300);

create index if not exists topic_links_owner_idx on public.topic_links (owner_id);
create index if not exists topic_links_topic_idx on public.topic_links (topic_id);

-- Both topics' chapters are the link owner's, and a confirmed link closes no
-- loop: walking "is needed before" from the topic along confirmed links must not
-- reach the prerequisite. The server refuses both first, with a sentence naming
-- the topics; this is the guard behind it.
create or replace function public.topic_links_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (
    select 1 from public.chapter_topics t join public.contents c on c.id = t.content_id
     where t.id in (new.prerequisite_id, new.topic_id) and c.owner_id is distinct from new.owner_id
  ) then
    raise exception 'a prerequisite link joins topics of its own professor''s chapters only' using errcode = 'check_violation';
  end if;
  if new.state = 'confirmed' and exists (
    with recursive after_topic(id) as (
      select l.topic_id from public.topic_links l
       where l.prerequisite_id = new.topic_id and l.state = 'confirmed' and l.id <> new.id
      union
      select l.topic_id from public.topic_links l join after_topic a on l.prerequisite_id = a.id
       where l.state = 'confirmed' and l.id <> new.id
    )
    select 1 from after_topic where id = new.prerequisite_id
  ) then
    raise exception 'that prerequisite link would make a loop' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists topic_links_guard on public.topic_links;
create trigger topic_links_guard
  before insert or update on public.topic_links
  for each row execute function public.topic_links_guard();

comment on table public.topic_links is
  'Prerequisite links between topic records (0025): prerequisite_id is needed before topic_id. Only confirmed links are used; chains are computed from them. Staff-managed; a student sees confirmed links only.';
