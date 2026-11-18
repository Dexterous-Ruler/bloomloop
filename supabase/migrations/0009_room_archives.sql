-- 0009: room_archives - a deleted room, kept as one compact JSON document.
--
-- Apply in number order with the rest of supabase/migrations (see
-- supabase/README.md). Needs accounts. Idempotent: a no-op once the table
-- exists. Adds a table; changes nothing that exists.
--
-- WHY.
-- Deleting a room removes its session row, and with it (on delete cascade) its
-- profiles and answers, so the room stops appearing in lists and dashboards.
-- The owner's rule is that what students answered is not thrown away with it:
-- "just save the room and other data in the form of json format so it is less
-- than even 1mb" (18 Nov 2026). So before the delete, the server writes the
-- whole room here (server/src/services/archive.js), and only deletes once this
-- row exists. One row per room: a retried delete replaces the archive it wrote
-- the first time.
--
-- data holds the room, every student's profile and history, and every stored
-- answer with the question as it was shown, answer key included. It is
-- teacher-only data, like answers.question_snapshot.
--
-- session_id has no foreign key on purpose: the session it names is deleted
-- straight after this row is written.

create table if not exists public.room_archives (
  id           uuid        primary key default gen_random_uuid(),
  session_id   uuid        not null,
  code         text        not null,
  title        text        not null default '',
  owner_id     uuid        references public.accounts (id) on delete set null,
  archived_by  uuid        references public.accounts (id) on delete set null,
  archived_at  timestamptz not null default now(),
  bytes        integer     not null,
  data         jsonb       not null,
  constraint room_archives_session_id_key unique (session_id),
  -- The owner's ceiling: 1 MiB of JSON. The server refuses the delete before a
  -- larger archive would be written; this stops one arriving any other way.
  constraint room_archives_bytes_check check (bytes > 0 and bytes <= 1048576)
);

create index if not exists room_archives_owner_idx on public.room_archives (owner_id, archived_at desc);

-- RLS on with no policies, like every other table: only the server's service
-- role key can read or write an archive.
alter table public.room_archives enable row level security;

comment on table public.room_archives is
  'One row per deleted room: the room, its students and every answer, as compact JSON (at most 1 MiB). Written before the room is deleted.';
comment on column public.room_archives.data is
  'format bloomloop.room-archive v1; see server/src/services/archive.js. Teacher-only data.';
