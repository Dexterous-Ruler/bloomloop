-- 0038: exam integrity, an opt-in room setting (Batch 9, decision E5).
--
-- Apply in number order with the rest of supabase/migrations (see
-- supabase/README.md). Needs sessions (0000). Depends on nothing in 0001 to
-- 0037. Idempotent: the column is added only if missing, and its check is
-- dropped by name and added again. Adds one nullable column; no existing row
-- changes, and every room already stored reads as it always did (null: no exam
-- mode, so nothing is enforced and nothing new is recorded).
--
-- WHY (decision E5 of 20 Nov 2026, decided under the owner's delegation). A
-- professor may open a room in exam mode, or turn it on while the room is not
-- closed. The phones are then told what to enforce: the copy guard and a faint
-- watermark of the roll number and room code (always), fullscreen on laptops,
-- whole-screen sharing on laptops with optional low-resolution pictures of the
-- screen, and Safe Exam Browser when the room requires it. New integrity signals
-- are recorded with the existing machinery (profiles.integrity, unchanged), and
-- shown to the room's staff only. Students the class roster marks under 18
-- (0022) are asked for nothing that watches, and nothing is recorded about them.
--
-- WHAT IS ADDED.
--   sessions.exam_mode   jsonb, null for none. When set, an object:
--     on                 boolean
--     fullscreen         boolean: laptops answer in fullscreen
--     screenShare        boolean: laptops share the whole screen to answer
--     snapshotSeconds    0, 30 or 60: how often a sharing laptop sends a picture
--     seb                { required: boolean, configKeyHashes: [64 hex chars] }:
--                        the Safe Exam Browser Config Keys the room accepts.
--                        Staff-only: the server never sends them to a phone or
--                        to the room's open route.
--                        The server checks the object's shape and values
--                        (services/examGuard.js examModeFrom) before it is
--                        written, and reads a stored one through the same rules;
--                        this file checks only that it is an object.
--
-- WHAT IS NOT ADDED, on purpose. No table for the screen pictures. They are
-- personal data (DPDP; on decision 8's list for a lawyer to confirm before any
-- college signs), so the server holds only the newest per student in its own
-- memory, purges them two hours after the room closes, at once when the room is
-- deleted, and on any restart, and never writes them to the database, the
-- room's archive, a CSV, a report or any export.
--
-- RLS stays on for sessions, with no policies: only the server's service role
-- reads or writes it.

alter table public.sessions add column if not exists exam_mode jsonb;

alter table public.sessions drop constraint if exists sessions_exam_mode_check;
alter table public.sessions add constraint sessions_exam_mode_check
  check (exam_mode is null or jsonb_typeof(exam_mode) = 'object');

comment on column public.sessions.exam_mode is
  'Batch 9 (0038): the room''s exam mode, { on, fullscreen, screenShare, snapshotSeconds, seb: { required, configKeyHashes } }, or null for none. Checked by the server before it is written. Screen pictures are never stored in the database.';

alter table public.sessions enable row level security;
