-- 0010: answer_reviews - the professor's review log for written answers.
--
-- Apply in number order with the rest of supabase/migrations (see
-- supabase/README.md). Needs sessions, answers and accounts. Idempotent: a
-- no-op once the table and indexes exist. Adds a table and an index; changes
-- nothing that exists.
--
-- WHY A LOG AND NOT MORE COLUMNS ON answers.
-- answers already holds the mark in force (correct, score, review_status,
-- reviewed_by, reviewed_at, review_note), written beside the machine's own
-- (auto_*). Those columns can only say what the latest decision was. A professor
-- who confirms a mark and later overrides it, or overrides and then confirms,
-- would leave no trace of the first decision. So every review action inserts one
-- row here, and a later decision never erases an earlier one. The server only
-- ever inserts into this table (server/src/routes/review.js); nothing updates or
-- deletes a row except the cascade below.
--
-- WHAT A ROW SAYS.
-- decision is what the professor pressed. correct and score are the mark that
-- decision put in force: for 'confirm' that is the machine's mark, copied, so
-- the row can be read on its own without a join back to auto_*.
--
-- DELETING A ROOM.
-- session_id and answer_id cascade, like answers. The server writes the whole
-- room, this log included, to room_archives (0009) before it deletes a room, and
-- deletes nothing if that write fails (server/src/services/archive.js).
--
-- reviewed_by is null on the shared teacher-key path, which has no account, and
-- goes null if the reviewer's account is deleted; the decision itself stays.

create table if not exists public.answer_reviews (
  id           uuid         primary key default gen_random_uuid(),
  answer_id    uuid         not null references public.answers (id) on delete cascade,
  session_id   uuid         not null references public.sessions (id) on delete cascade,
  decision     text         not null,
  correct      boolean      not null,
  score        numeric(4, 3) not null,
  note         text         not null default '',
  reviewed_by  uuid         references public.accounts (id) on delete set null,
  reviewed_at  timestamptz  not null default now(),
  constraint answer_reviews_decision_check check (decision in ('confirm', 'override')),
  constraint answer_reviews_score_check check (score >= 0 and score <= 1),
  -- The server refuses a longer note with a 400 (MAX_NOTE in routes/review.js);
  -- this stops one arriving any other way.
  constraint answer_reviews_note_check check (char_length(note) <= 1000)
);

-- One answer's log, oldest first (GET /api/review/:answerId).
create index if not exists answer_reviews_answer_idx   on public.answer_reviews (answer_id, reviewed_at);
-- A room's log, for the archive written before a room is deleted.
create index if not exists answer_reviews_session_idx  on public.answer_reviews (session_id);
-- The foreign key's own index, so deleting an account does not scan the log.
create index if not exists answer_reviews_reviewer_idx on public.answer_reviews (reviewed_by);

-- The review queue reads final written answers across a teacher's rooms, newest
-- first, whatever their review status. answers_provisional_idx (0008) only
-- serves the 'provisional' view; this serves the rest.
create index if not exists answers_open_queue_idx
  on public.answers (session_id, answered_at desc) where kind = 'open' and final;

-- RLS on with no policies, like every other table: only the server's service
-- role key can read or write a review.
alter table public.answer_reviews enable row level security;

comment on table public.answer_reviews is
  'Append-only log of professor review decisions on answers. One row per action; a later decision never erases an earlier one.';
comment on column public.answer_reviews.decision is
  'confirm keeps the machine''s mark; override sets a new one. correct/score are the mark the decision put in force.';
comment on column public.answer_reviews.reviewed_by is
  'Null on the shared teacher-key path, or once the reviewer''s account is deleted.';
