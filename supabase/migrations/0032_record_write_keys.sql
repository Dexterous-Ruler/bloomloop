-- 0032: replay keys for the teacher-record writes (Phase 7, an offline console).
--
-- Apply in number order with the rest of supabase/migrations (see
-- supabase/README.md). Needs sessions (0000) and 0017's function
-- teacher_records_guard(), which keeps this table append-only as it keeps the
-- observations. Depends on nothing in 0025 to 0031. Idempotent: the table and
-- its index are created only if missing, its checks are dropped by name and
-- added again, and its trigger is dropped and recreated. Adds one table and
-- changes no row of any other.
--
-- WHY (docs/UI_ZIP_AUDIT.md gap F1; decision O1 on the staff side).
-- When the network drops, the professor's console keeps each record she makes
-- (an attendance mark, an observation, a pick's response, a tally step, an
-- activity, what was done about an insight) in an outbox, and sends them again,
-- in order, when it reconnects. A write can then reach the server twice: the
-- reply lost on the way back, a retry after a timeout. A mark sent twice is the
-- same mark, but a tally step sent twice is a hand counted twice, and a new
-- activity sent twice is a second row. So the console gives every queued write
-- a key of its own (a UUID, sent as the Idempotency-Key header), and the server
-- keeps here the reply of the first write made with it. A write that comes again
-- with the key gets that reply and changes nothing (routes/recordSync.js).
--
-- WHAT IS ADDED.
--   record_writes     one row per write first made with a key in a room
--     session_id      the room; the row goes with it (on delete cascade)
--     writer          the account that wrote (its id), or 'shared-key' for the
--                     v1 teacher key, which has none. A key is the writer's own:
--                     unique on (session_id, writer, write_key)
--     write_key       the console's key: 8 to 64 letters, digits, - or _
--     route           which write it was (attendance, observation, wheel-pick,
--                     tally-increment, ...)
--     target          the record the path named (a pick's, a tally's or an
--                     activity's id, in lower case), '' for none
--     body_hash       SHA-256 of the route, the target and the request body, in
--                     a canonical form: the same key with other details is a 409
--     status, reply   the HTTP status (2xx only: a refusal is not kept, so the
--                     same write sent again is checked again) and the whole
--                     reply, given back unchanged to every replay, as the
--                     phone's answer_key gives back the stored answer
--     created_at      when the key was first met
--
-- RETENTION. A key is needed until the console's outbox has drained, which is
-- minutes to hours. Rows are append-only and kept for as long as the room is:
-- deleting the room deletes them (on delete cascade; teacher_records_guard
-- allows a delete only inside that cascade). A row is one reply: one record
-- for most writes, the class register for an attendance mark and the wheel for
-- a wheel write (tens of kilobytes at most, which Postgres compresses). Only
-- writes sent with a key make rows, so a room run online makes few. They are
-- receipts, not records: the room archive does not carry them, and nothing
-- reads them but the replay. Nothing prunes them sooner; if one ever must, it
-- is a migration that lifts the guard.
--
-- WHAT IS NOT CHANGED. No record table: a keyed write writes the same rows, in
-- the same tables, as one sent without a key, and a write without a key never
-- reads or writes this table. No answer row, no level, no mark.
--
-- PRIVACY. Staff-only, like the records it keys. RLS on, no policies: only the
-- server's service role reads or writes it. A kept reply holds what the reply
-- to the professor held (names and roll numbers of the room's class, at most),
-- and goes with the room.
--
-- RE-RUNS. No earlier file touches this table, so re-running the whole set
-- never narrows anything added here.

create table if not exists public.record_writes (
  id          uuid        primary key default gen_random_uuid(),
  session_id  uuid        not null references public.sessions (id) on delete cascade,
  writer      text        not null,
  write_key   text        not null,
  route       text        not null,
  target      text        not null default '',
  body_hash   text        not null,
  status      integer     not null,
  reply       jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  -- Also the index a replay reads the key by, and the room's (its first column).
  constraint record_writes_session_writer_key_key unique (session_id, writer, write_key)
);

alter table public.record_writes enable row level security;

alter table public.record_writes drop constraint if exists record_writes_key_check;
alter table public.record_writes
  add constraint record_writes_key_check check (write_key ~ '^[A-Za-z0-9_-]{8,64}$');
alter table public.record_writes drop constraint if exists record_writes_writer_check;
alter table public.record_writes
  add constraint record_writes_writer_check check (char_length(writer) between 1 and 64);
alter table public.record_writes drop constraint if exists record_writes_route_check;
alter table public.record_writes
  add constraint record_writes_route_check check (route ~ '^[a-z][a-z-]{0,39}$');
alter table public.record_writes drop constraint if exists record_writes_target_check;
alter table public.record_writes
  add constraint record_writes_target_check check (char_length(target) <= 64);
alter table public.record_writes drop constraint if exists record_writes_hash_check;
alter table public.record_writes
  add constraint record_writes_hash_check check (body_hash ~ '^[0-9a-f]{64}$');
alter table public.record_writes drop constraint if exists record_writes_status_check;
alter table public.record_writes
  add constraint record_writes_status_check check (status between 200 and 299);
alter table public.record_writes drop constraint if exists record_writes_reply_check;
alter table public.record_writes
  add constraint record_writes_reply_check check (jsonb_typeof(reply) = 'object');

-- Append-only: 0017's guard with no changeable columns. A row is never edited,
-- and goes only in the cascade from its room.
drop trigger if exists record_writes_append_only on public.record_writes;
create trigger record_writes_append_only
  before update or delete on public.record_writes
  for each row execute function public.teacher_records_guard();

comment on table public.record_writes is
  'Replay keys of teacher-record writes (0032): the reply of the first write made with a key in a room, so the console can send a write again after the network drops and have it done once. Append-only; goes with the room; not archived.';
