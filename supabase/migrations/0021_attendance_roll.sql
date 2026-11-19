-- 0021: the roll number an attendance mark was made under.
--
-- Apply in number order with the rest of supabase/migrations (see
-- supabase/README.md). Needs attendance (0016). Idempotent: the column is added
-- only if missing. Adds one nullable column; changes no row, and backfills
-- nothing. A mark written before this file has no roll number, and the reports
-- read it exactly as before.
--
-- WHY.
-- A room's answers, its phones and its teacher records name a student by the
-- roll number typed into the phone; an attendance mark names the roster row
-- (class_student_id). A professor may correct a student's roll number on the
-- roster afterwards (PATCH /api/classes/:id/students/:studentId). The answers
-- already given keep the roll number they were given under, which the roster no
-- longer holds, so the attainment report and the marks register listed them as
-- "Not on the roster" and showed the student present with no answers. Answers
-- are evidence and are never rewritten (0012), so the tie between the old roll
-- number and the roster row has to be kept somewhere: here, on the mark.
--
-- WHAT IS ADDED.
--   attendance.roll_no  the roll number the mark was made under, in the room's
--                       form (as class_students.roll_no is):
--                       'joined': the roll number the phone joined with.
--                       'teacher': the student's roll number on the roster when
--                       the mark is made, unless the mark it replaces already
--                       carries one, which is kept: a professor correcting a
--                       room's attendance after a roll number changed must not
--                       cut the room's answers loose from the student.
--                       Null for a mark made before this file.
--   The reports (server/src/services/attainment.js) give a room's answers under
--   that roll number to the mark's student, whatever the roster holds now; a
--   roll number no mark of the room names, or a mark with no roll number, is
--   matched to the roster as it stands now.
--
-- WHAT IS NOT ADDED. No check on the roll number's shape: it is a copy of what
-- the server already accepted (the roster's rule, or the live room's), and a
-- check here could only ever refuse a mark the room has already let in. No
-- index: the reports read a room's marks by session_id, which
-- attendance_session_student_key already covers.
--
-- PRIVACY. Staff-only, like the rest of attendance. A roll number the roster
-- already held; nothing more about the student.
--
-- RLS is on with no policies, like every table (0016 turned it on for this
-- one): only the server's service role reads or writes.

alter table public.attendance add column if not exists roll_no text;

comment on column public.attendance.roll_no is
  'The roll number the mark was made under: the phone''s for a join, the roster''s for a teacher mark unless the mark it replaces carries one. Null before 0021. Ties a room''s answers to the student after a roll number is corrected.';
