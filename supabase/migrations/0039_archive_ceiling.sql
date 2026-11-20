-- 0039: a room archive may be up to 4 MiB of JSON (was 1 MiB).
--
-- Apply in number order with the rest of supabase/migrations (see
-- supabase/README.md). Needs room_archives (0009) and room_imports (0031).
-- Idempotent: each check is dropped by name and added again. No row changes:
-- every archive already stored is at most 1 MiB, so it passes the wider check.
--
-- WHY (20 Nov 2026, decided under the owner's delegation). The owner asked for a
-- deleted room to be kept as JSON "less than even 1mb" (18 Nov 2026), before
-- written answers could be long. Batch 9's long answers (up to 600 words) make
-- an ordinary exam room's record pass 1 MiB: 60 students with 5 long answers
-- each is about 1.4 MB. Past the ceiling such a room cannot be deleted, and a
-- laptop room of that size cannot be imported, so its answers stay on the
-- laptop. 4 MiB holds about 1,100 long answers beside everything else. The
-- archive stays plain JSON, as the owner asked, and Postgres compresses large
-- jsonb values on disk, so a full archive takes far less than 4 MiB stored.

alter table public.room_archives drop constraint if exists room_archives_bytes_check;
alter table public.room_archives
  add constraint room_archives_bytes_check check (bytes > 0 and bytes <= 4194304);

alter table public.room_imports drop constraint if exists room_imports_bytes_check;
alter table public.room_imports
  add constraint room_imports_bytes_check check (bytes > 0 and bytes <= 4194304);

comment on table public.room_archives is
  'One row per deleted room: the room, its students and every answer, as compact JSON (at most 4 MiB, 0039). Written before the room is deleted.';
