-- 0015: a question set per room.
--
-- Apply in number order with the rest of supabase/migrations (see
-- supabase/README.md). Needs sessions (0000). Idempotent: the column is added
-- only if missing, and the constraint is dropped by name and added again. Adds
-- one column and one constraint; changes no row. Every existing room gets null,
-- which is the whole approved bank, exactly what it served before.
--
-- WHY.
-- A room has always served every approved question of its chapter. A professor
-- who wants Tuesday's quiz to be the eight questions on Tuesday's slides, or a
-- re-run of the two questions the class got wrong, had no way to say so short of
-- a second chapter holding copies, whose answers could then never be read beside
-- the first's. Now a room can name the questions it may serve.
--
-- WHAT IS ADDED.
--   sessions.question_ids
--                     the only questions this room may serve, as question ids.
--                     Null: the whole approved bank, as before. Written once,
--                     when the room is opened (POST /api/session), like the
--                     mastery settings (0007), and never updated: which questions
--                     a room served is part of what its answers mean.
--
--                     The server checks every id is an approved (active) question
--                     of the room's chapter when the room is opened. A question
--                     discarded later stops being served, and one deleted later
--                     (a replacing generate deletes the bank) leaves an id that
--                     names nothing; the room serves what is left of the set, and
--                     never anything outside it (servableFor in
--                     server/src/services/selector.js).
--
--                     An array, not a join table. Postgres cannot put a foreign
--                     key on array elements, so nothing here says an id exists;
--                     but the set is read whole on every bank load and never
--                     queried by question, and a join table would need its own
--                     writes, RLS and archive handling for that.
--
--   sessions_question_ids_shape
--                     null, or a one-dimensional list of at least one id with no
--                     null in it. An empty set would be a room that can serve
--                     nothing at all.

alter table public.sessions add column if not exists question_ids uuid[];

alter table public.sessions drop constraint if exists sessions_question_ids_shape;
alter table public.sessions
  add constraint sessions_question_ids_shape check (
    question_ids is null
    or (array_ndims(question_ids) = 1
        and cardinality(question_ids) >= 1
        and array_position(question_ids, null) is null)
  );

comment on column public.sessions.question_ids is
  'The only questions this room may serve (approved questions of its chapter when it was opened). Null: the whole approved bank.';
