-- 0004 (formerly 004_invite_google_sub.sql). v2 phase 7: the Google identity on
-- the INVITE, so a roster imported from Google Classroom survives the gap
-- between "the professor invited them" and "they signed up".
--
-- Apply in number order with the rest of supabase/migrations (see
-- supabase/README.md). It is idempotent, so re-running it is safe. Run 0003
-- first - this column exists to feed accounts.google_sub, which that migration
-- adds.
--
-- Same value, same name, one column: 0003 defines accounts.google_sub as the
-- OpenID subject claim, "which is also the Classroom API userId". A roster
-- imported from Classroom hands us that id directly, so an invite issued from
-- the import carries it and POST /api/auth/signup copies it onto the account it
-- creates. There is deliberately no second column for the roster-imported case:
-- two columns holding the same identifier is how a grade poster reading one of
-- them silently misses every student who arrived by the other path.
--
-- What it buys, concretely: without it, grade posting has to work out which
-- Google student a BloomLoop roll number belongs to by comparing normalised
-- names, email local parts and the digit runs inside them (rosterIndex in
-- server/src/routes/classroom.js). That is the best anyone can do for a roster
-- somebody typed by hand, and it writes the wrong student's mark whenever two
-- names normalise alike - silently, because a draft grade looks the same either
-- way. With it, the join is equality on an id nobody typed.
--
-- Nullable, and it stays nullable: the manual invite flow never touches Google
-- and must keep working exactly as it does today, so a null here means "this
-- invite was not imported from a roster", never "unknown".

alter table public.invites add column if not exists google_sub text;

-- Deliberately NOT unique, unlike accounts.google_sub. An invite can lapse
-- unspent, and issuing a fresh code for the same student is the normal repair
-- for that; a unique index here would make the repair impossible without first
-- deleting the evidence of the attempt that failed. Uniqueness belongs on the
-- account, where it stops two BloomLoop students claiming one Classroom
-- submission, and 0003 already puts it there.
create index if not exists invites_google_sub_idx
  on public.invites (google_sub) where google_sub is not null;

comment on column public.invites.google_sub is
  'The Google Classroom userId of the student this invite was imported for, copied onto accounts.google_sub when the invite is redeemed. Deliberately not unique: an invite may lapse unspent and be reissued.';
