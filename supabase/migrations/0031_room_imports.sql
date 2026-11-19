-- 0031: room_imports - a room run on a professor's laptop in laptop mode
-- (Phase 7, decision O4), brought back to the cloud.
--
-- Apply in number order with the rest of supabase/migrations (see
-- supabase/README.md). Needs accounts (0001) and sessions (0000). Idempotent:
-- the table and its index are created only if missing, its checks are dropped
-- and added again with the same definitions, and its guard function and trigger
-- are replaced and recreated with the same definitions. One table, no backfill:
-- no existing row is read or rewritten.
--
-- WHAT IS ADDED, and why (docs/PRODUCT_DECISIONS.md, Phase 7):
--
--   room_imports   one row per room archive imported (server/src/services/
--                  roomImport.js). In a classroom with no internet the server
--                  runs on the professor's laptop and saves each room as its
--                  room archive (the JSON a deleted room is kept as, 0009) in a
--                  folder on the laptop. Back online, the professor uploads each
--                  file; it becomes an ordinary closed room they own, written to
--                  sessions, profiles, answers, answer_reviews, attendance and
--                  class_questions like any room, so every report reads it. This
--                  row says where that room came from:
--                    source_room_id  the room's id on the laptop. Unique: a
--                                    second import of the same room changes
--                                    nothing (the server answers that it was
--                                    imported already), and two imports racing
--                                    each other cannot both write a room.
--                    source_code     the room's code on the laptop (the imported
--                                    room keeps it)
--                    source          which run of the laptop server saved it:
--                                    { run, startedAt }, a random tag and a time,
--                                    never the machine's name
--                    session_id      the room it became; null once that room is
--                                    deleted (its own archive, 0009, keeps it)
--                    owner_id, imported_by   whose room it is and who imported it
--                    archived_at     when the laptop saved the file
--                    bytes, sha256   the file's size (at most 1 MiB, as an
--                                    archive's) and its hash, so a later upload
--                                    of a different file for the same room is
--                                    recognised as different, and refused
--                    summary         what the import made, in counts and plain
--                                    sentences, for the console
--                    data            the archive as uploaded (teacher-only, like
--                                    room_archives.data): what was not made into
--                                    rows (the laptop's teacher records, a mark
--                                    the class roster could not take) is kept
--                                    here, so nothing in the file is lost
--
-- WRITTEN ONCE. An import is a record of where evidence came from, so a row is
-- never edited: room_imports_written_once refuses every UPDATE except the three
-- columns a deleted room or account sets to null through their foreign keys
-- (session_id, owner_id, imported_by). A delete is allowed (erasure, decision 8).
--
-- WHAT IS NOT CHANGED. No existing table, column or check: the imported room's
-- rows are inserted like any room's, under every existing guard (0012's
-- append-only answers above all).
--
-- RE-RUNS. No earlier file touches room_imports, so re-running the whole set
-- never narrows anything added here.
--
-- PRIVACY. RLS is on, with no policies: only the server's service role reads or
-- writes. data holds answer keys, roll numbers and names, like room_archives.data.

create table if not exists public.room_imports (
  id              uuid        primary key default gen_random_uuid(),
  source_room_id  text        not null,
  source_code     text        not null,
  source          jsonb       not null default '{}'::jsonb,
  session_id      uuid        references public.sessions (id) on delete set null,
  owner_id        uuid        references public.accounts (id) on delete set null,
  imported_by     uuid        references public.accounts (id) on delete set null,
  imported_at     timestamptz not null default now(),
  archived_at     timestamptz,
  bytes           integer     not null,
  sha256          text        not null,
  summary         jsonb       not null default '{}'::jsonb,
  data            jsonb       not null,
  constraint room_imports_source_room_id_key unique (source_room_id),
  constraint room_imports_session_id_key unique (session_id)
);

-- The archive's own ceiling (0009): 1 MiB of JSON.
alter table public.room_imports drop constraint if exists room_imports_bytes_check;
alter table public.room_imports
  add constraint room_imports_bytes_check check (bytes > 0 and bytes <= 1048576);

alter table public.room_imports drop constraint if exists room_imports_sha256_check;
alter table public.room_imports
  add constraint room_imports_sha256_check check (sha256 ~ '^[0-9a-f]{64}$');

-- A laptop room id is the in-process store's (24 hex characters) or a uuid; a
-- code is the room's six characters. Bounded so nothing else is kept as one.
alter table public.room_imports drop constraint if exists room_imports_source_check;
alter table public.room_imports
  add constraint room_imports_source_check check (
    source_room_id ~ '^[A-Za-z0-9-]{1,64}$'
    and source_code ~ '^[A-Z0-9]{4,16}$'
    and jsonb_typeof(source) = 'object'
    and jsonb_typeof(summary) = 'object'
    and jsonb_typeof(data) = 'object'
  );

create index if not exists room_imports_owner_idx on public.room_imports (owner_id, imported_at desc);

-- Written once. The only UPDATE allowed is a foreign key's ON DELETE SET NULL
-- (pg_trigger_depth() above 1: it runs inside the referential action), and only
-- on session_id, owner_id and imported_by.
create or replace function public.room_imports_keep_record()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  nullable constant text[] := array['session_id', 'owner_id', 'imported_by'];
begin
  if pg_trigger_depth() > 1
     and (to_jsonb(new) - nullable) = (to_jsonb(old) - nullable)
     and (new.session_id is null or new.session_id = old.session_id)
     and (new.owner_id is null or new.owner_id = old.owner_id)
     and (new.imported_by is null or new.imported_by = old.imported_by) then
    return new;
  end if;
  raise exception 'room_imports is a record of where evidence came from: import % is never edited', old.id
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists room_imports_written_once on public.room_imports;
create trigger room_imports_written_once
  before update on public.room_imports
  for each row execute function public.room_imports_keep_record();

-- RLS on with no policies, like every other table.
alter table public.room_imports enable row level security;

comment on table public.room_imports is
  'One row per room archive imported from laptop mode (0031): the laptop''s room id (unique, so a second import changes nothing), the room it became, who imported it and when, and the archive as uploaded. Written once.';
comment on column public.room_imports.data is
  'The uploaded room archive (format bloomloop.room-archive v1, with the laptop''s run in `laptop`); see server/src/services/archive.js. Teacher-only data.';
