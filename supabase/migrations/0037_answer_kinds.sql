-- 0037: whiteboard answers (Batch 9, decision E4).
--
-- Apply in number order with the rest of supabase/migrations (see
-- supabase/README.md). Needs media (0014, 0033), sessions (0005), accounts
-- (0001) and hub_attempts (0026, 0028, 0036). Idempotent: columns and indexes
-- are added only if missing, checks are dropped by name and added again, the
-- function is replaced and the trigger dropped and recreated, and dropping a
-- NOT NULL that is already gone does nothing. Adds six columns, two unique
-- indexes, one index, two checks, one function and one trigger, and loosens two
-- NOT NULLs; no row of any table changes meaning.
--
-- WHY.
-- A question of the new kind 'drawing' is answered with a picture the student
-- draws on their phone or laptop, and may carry their words beside it. The
-- picture is sent before the answer that names it, and is kept like any other
-- upload: as a row of `media`, its bytes checked (PNG or WebP, by their own
-- signature), its metadata stripped and its size capped by the server
-- (server/src/services/drawings.js; the cap is not repeated here, so it can
-- change without a migration). The answer's response is { mediaId, text }.
-- A drawing is never marked by the machine: it waits for the professor's
-- review, in the room's queue.
--
-- The short and long written answers of the same batch (E3) need nothing here:
-- the 'open' kind's `length` is one more field of questions.payload (0001), and
-- a question without it is a short answer, as every question before it was.
--
-- WHAT IS ADDED.
--   media.drawing       true for a student's drawing; false for every upload
--                       before this file and every professor's picture (a
--                       question's stimulus, a slide picture).
--   media.session_id    the room a phone drew it in. The drawing belongs to the
--                       room and goes with it when the room is deleted (its
--                       archive keeps the answer's reference, never the bytes).
--   media.roll_no       the roll number of the phone that sent it in that room.
--   media.account_id    for a Learning Hub practice drawing: the signed-in
--                       student it belongs to. Goes with their account.
--   media.question_id   the question it was drawn for. No foreign key: the
--                       evidence of what was drawn for what outlives an edit or
--                       a delete of the question, as answers.question_snapshot
--                       does.
--   media.answer_key    the device's own id for it (8 to 64 letters, digits, -
--                       or _): a resend finds the drawing it already sent.
--   media_room_drawing_key   one drawing per (room, roll number, device id).
--   media_hub_drawing_key    one drawing per (student account, device id).
--   media_session_idx        a room's drawings, for its delete.
--   hub_attempts.correct, hub_attempts.score
--                       may be null, for a practice drawing only: the hub has
--                       nobody to mark it (hub_attempts_mark_check).
--
-- WHAT IS REFUSED.
--   23514  a drawing without a question or a device id, of a type other than
--          PNG or WebP, kept from a slide, or belonging to neither exactly one
--          room-and-roll-number nor exactly one student account; any of the
--          drawing columns set on a row that is not a drawing
--          (media_drawing_check). A hub attempt with no mark that is not a
--          drawing, or a drawing's hub attempt with a mark
--          (hub_attempts_mark_check).
--   23505  a second drawing under the same device id (the indexes above).
--   23001  changing any drawing column once written
--          (media_drawing_written_once): who drew what, for which question, is
--          evidence. 0014's guard already refuses a change to the bytes.
--
-- RLS stays on with no policies, like every table: only the server's service
-- role reads or writes, and the server decides who sees a drawing (staff of the
-- room or chapter, and in the hub the student who drew it; never a phone).

alter table public.media add column if not exists drawing boolean not null default false;
alter table public.media add column if not exists session_id uuid references public.sessions (id) on delete cascade;
alter table public.media add column if not exists roll_no text;
alter table public.media add column if not exists account_id uuid references public.accounts (id) on delete cascade;
alter table public.media add column if not exists question_id uuid;
alter table public.media add column if not exists answer_key text;

alter table public.media drop constraint if exists media_drawing_check;
alter table public.media
  add constraint media_drawing_check check (
    (not drawing and session_id is null and roll_no is null and account_id is null and question_id is null and answer_key is null)
    or (drawing
        and question_id is not null
        and answer_key ~ '^[A-Za-z0-9_-]{8,64}$'
        and mime in ('image/png', 'image/webp')
        and slide_no is null
        and ((session_id is not null and roll_no is not null and length(btrim(roll_no)) > 0 and account_id is null)
             or (session_id is null and roll_no is null and account_id is not null)))
  );

create unique index if not exists media_room_drawing_key
  on public.media (session_id, roll_no, answer_key) where drawing and session_id is not null;
create unique index if not exists media_hub_drawing_key
  on public.media (account_id, answer_key) where drawing and account_id is not null;
create index if not exists media_session_idx on public.media (session_id) where session_id is not null;

create or replace function public.media_drawing_written_once()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.drawing, new.session_id, new.roll_no, new.account_id, new.question_id, new.answer_key)
     is distinct from (old.drawing, old.session_id, old.roll_no, old.account_id, old.question_id, old.answer_key) then
    raise exception 'media % records who drew it, where and for which question: that is written once', old.id
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists media_drawing_written_once on public.media;
create trigger media_drawing_written_once
  before update on public.media
  for each row execute function public.media_drawing_written_once();

comment on column public.media.drawing is
  'Batch 9 (0037): a student''s drawing given as an answer (kind ''drawing''); false for a professor''s picture. Staff-only.';
comment on column public.media.session_id is
  'Batch 9 (0037): the room a phone drew it in; it goes with the room. Null for a professor''s picture and a hub drawing.';
comment on column public.media.roll_no is
  'Batch 9 (0037): the roll number of the phone that sent the drawing in its room.';
comment on column public.media.account_id is
  'Batch 9 (0037): the student account a Learning Hub practice drawing belongs to; it goes with the account.';
comment on column public.media.question_id is
  'Batch 9 (0037): the question the drawing answers, kept without a foreign key so it outlives the question.';
comment on column public.media.answer_key is
  'Batch 9 (0037): the device''s own id for the drawing; a resend returns the drawing already kept.';

-- A practice drawing in the hub carries no mark: nobody reviews hub practice.
alter table public.hub_attempts alter column correct drop not null;
alter table public.hub_attempts alter column score drop not null;
alter table public.hub_attempts drop constraint if exists hub_attempts_mark_check;
alter table public.hub_attempts
  add constraint hub_attempts_mark_check check (
    (correct is not null and score is not null and kind <> 'drawing')
    or (kind = 'drawing' and correct is null and score is null)
  );
comment on column public.hub_attempts.correct is
  'The server''s mark. Null only for a drawing (0037), which the machine never marks.';

alter table public.media enable row level security;
alter table public.hub_attempts enable row level security;
