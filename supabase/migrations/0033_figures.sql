-- 0033: figures (Batch 8): the pictures kept from a deck's slides.
--
-- Apply in number order with the rest of supabase/migrations (see
-- supabase/README.md). Needs media (0014) and contents (0000). Idempotent:
-- columns and the index are added only if missing, checks are dropped by name
-- and added again. Adds two columns, one index and two checks, and changes no row.
--
-- WHY.
-- A figure is drawn by the server from a JSON spec (server/src/figures) and is
-- stored inside a question's stimulus, which is already JSON (questions.stimulus),
-- so a figure on a question needs nothing here. Nor does a figure in a lesson:
-- it is a "chunk" step carrying a `figure` beside its text, which 0027's
-- topic_lessons_steps_check already allows. (A new step type was not used on
-- purpose: re-running 0027 re-adds that check with its own list, which would
-- then fail over any lesson holding the new type.)
--
-- What does need a column is slide pictures. For what code cannot draw
-- (anatomy, apparatus, maps, specimens), the figure is the professor's own
-- picture. A deck already carries them, so an upload now keeps each PNG, JPEG
-- or WebP picture on its slides as an ordinary upload of that chapter (media),
-- with the slide it was on, its metadata stripped like any upload. Other kinds
-- of picture (EMF, WMF, GIF, TIFF, SVG) are skipped and counted.
--
-- WHAT IS ADDED.
--   media.slide_no         the slide a picture was kept from, counted from 1 in
--                          the deck's own order; null for a picture uploaded on
--                          its own, which is every row from before this file.
--   contents.slide_pictures what the upload kept: { kept, skippedType,
--                          skippedLarge, skippedOver, slides }. Null for a chapter
--                          uploaded before this file (or pasted as text): such a
--                          chapter kept no pictures, and the server says so.
--   media_content_slide_idx a chapter's slide pictures, in slide order.
--
-- WHAT IS REFUSED (23514). A slide number below 1; slide_pictures that is not a
-- JSON object.
--
-- RLS stays on with no policies, like every table: only the server's service
-- role reads or writes.

alter table public.media add column if not exists slide_no integer;
alter table public.media drop constraint if exists media_slide_no_check;
alter table public.media add constraint media_slide_no_check check (slide_no is null or slide_no >= 1);
create index if not exists media_content_slide_idx on public.media (content_id, slide_no) where slide_no is not null;
comment on column public.media.slide_no is
  'The slide of the uploaded deck this picture was kept from (0033); null for a picture uploaded on its own.';

alter table public.contents add column if not exists slide_pictures jsonb;
alter table public.contents drop constraint if exists contents_slide_pictures_check;
alter table public.contents
  add constraint contents_slide_pictures_check check (slide_pictures is null or jsonb_typeof(slide_pictures) = 'object');
comment on column public.contents.slide_pictures is
  'What the deck upload kept of its slide pictures (0033); null for a chapter from before, which kept none.';

alter table public.media enable row level security;
alter table public.contents enable row level security;
