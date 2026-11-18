-- 0014: images a professor uploads to hang a question off.
--
-- Apply in number order with the rest of supabase/migrations (see
-- supabase/README.md). Needs contents (0000) and accounts (0001). Idempotent: the
-- table and indexes are created only if missing, constraints are dropped by name
-- and added again, the function is replaced and the trigger dropped and
-- recreated. Adds one table, one index on sessions, one function and one
-- trigger; changes no row.
--
-- WHY.
-- A question may carry an image stimulus, and the phone already draws one from
-- its url, but nothing could create one: an image had to live somewhere else on
-- the internet, where the professor does not control it and every phone that
-- loads it tells a third party it did. Uploads now live in the database, so all
-- three of the server's stores take them with no new service (Mongo keeps a
-- Buffer, the in-process store keeps memory), and a question's image is served
-- by this server at /api/media/<id> (server/src/routes/media.js).
--
-- WHAT IS ADDED.
--   media             one uploaded image: PNG, JPEG or WebP, as its own bytes say
--                     (the server reads the signature; the file name and the
--                     browser's type are not trusted), at most the server's limit
--                     (500 KB by default, config.media.maxBytes; not repeated here,
--                     so the limit can change without a migration).
--     id              uuid, random. A phone loads an image by its url alone, so
--                     the id must not be guessable from another one.
--     owner_id        the professor who uploaded it; null on the shared teacher
--                     key. Who may read it is decided by its chapter's owner.
--     content_id      the chapter it belongs to. A question may only show an
--                     image of its own chapter.
--     mime, bytes, sha256, data
--                     the image. sha256 is the hex digest of data and must be
--                     (media_sha256_check): it is the ETag phones cache under.
--     alt             the description a student who cannot see the image gets.
--                     Required, as the validator requires it of an image
--                     stimulus.
--   sessions_content_idx
--                     rooms by chapter. Serving an image to a phone asks whether
--                     a room is running on its chapter (services/media.js).
--
-- WHAT IS REFUSED (SQLSTATE 23001 restrict_violation).
--   An UPDATE that changes an image's bytes, type, size, digest or chapter. A url
--   is cached by phones for a year as the same bytes; changing them under it
--   would leave every phone that has it showing the old picture. Upload a new
--   image instead. The alt text may still change, and owner_id may be cleared
--   when the uploader's account is deleted.
--
-- RLS is on with no policies, like every table: only the server's service role
-- reads or writes, and the server decides who sees what.

create table if not exists public.media (
  id          uuid        primary key default gen_random_uuid(),
  owner_id    uuid        references public.accounts (id) on delete set null,
  content_id  uuid        not null references public.contents (id) on delete cascade,
  mime        text        not null,
  bytes       integer     not null,
  sha256      text        not null,
  data        bytea       not null,
  alt         text        not null,
  created_at  timestamptz not null default now()
);

alter table public.media enable row level security;

alter table public.media drop constraint if exists media_mime_check;
alter table public.media
  add constraint media_mime_check check (mime in ('image/png', 'image/jpeg', 'image/webp'));

alter table public.media drop constraint if exists media_bytes_check;
alter table public.media
  add constraint media_bytes_check check (bytes > 0 and bytes = octet_length(data));

alter table public.media drop constraint if exists media_sha256_check;
alter table public.media
  add constraint media_sha256_check check (sha256 = encode(sha256(data), 'hex'));

alter table public.media drop constraint if exists media_alt_check;
alter table public.media
  add constraint media_alt_check check (length(btrim(alt)) > 0);

create index if not exists media_content_idx on public.media (content_id);
-- The foreign key's own index, so deleting an account does not scan the table.
create index if not exists media_owner_idx on public.media (owner_id) where owner_id is not null;

create index if not exists sessions_content_idx on public.sessions (content_id);

create or replace function public.media_bytes_written_once()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.data, new.mime, new.bytes, new.sha256, new.content_id)
     is distinct from (old.data, old.mime, old.bytes, old.sha256, old.content_id) then
    raise exception 'media % is cached by phones as these exact bytes: upload a new image instead of changing this one', old.id
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists media_bytes_written_once on public.media;
create trigger media_bytes_written_once
  before update on public.media
  for each row execute function public.media_bytes_written_once();

comment on table public.media is
  'Images uploaded for question stimuli, served at /api/media/<id>. Bytes written once (media_bytes_written_once).';
comment on column public.media.sha256 is
  'Hex SHA-256 of data; the ETag phones cache the image under.';
comment on column public.media.alt is
  'What a student who cannot see the image needs to know. Required.';
