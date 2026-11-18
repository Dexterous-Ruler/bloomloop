-- v2 phase 7: the Google identity on an ACCOUNT, and the student's own way of
-- putting it there.
--
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste ->
-- Run. It is idempotent, so re-running it is safe. Run this before 004, which
-- adds the invite-side column that feeds accounts.google_sub on sign-up.
--
-- WHY THIS EXISTS
-- Posting session results to Google Classroom has to decide which Google student
-- a BloomLoop roll number belongs to, and until now it guessed: rosterIndex() in
-- server/src/routes/classroom.js compares normalised names, email local parts and
-- the digit runs inside them. That is the best anyone can do for a roster a human
-- typed, and it writes the wrong student's mark whenever two people normalise
-- alike - which is why it refuses to act on an ambiguous key at all. With a
-- stored subject the join stops being a comparison of strings somebody chose and
-- becomes equality on an opaque id nobody types.
--
-- WHY 'google_sub' AND NOT 'google_user_id'
-- Named after what the value IS - the OpenID Connect subject claim - rather than
-- after one API that happens to return it. Two paths write this column: a student
-- signing into Google from their own BloomLoop account, and a roster imported
-- from Classroom. They are the same identifier, so there is exactly one column;
-- two columns holding one id is how a grade poster reading one of them silently
-- misses every student who arrived by the other path.
--
-- WHAT IS NOT HERE
-- No tokens. The student consent flow asks for identity scopes only (openid,
-- email, profile), reads the id_token once for its subject claim, and revokes the
-- access token before it answers. There is nothing in these columns to refresh,
-- nothing to expire, and nothing worth stealing: google_sub is an identifier,
-- never a credential.
--
-- NOTHING HERE IS REQUIRED
-- Every column is nullable and null means "not linked", never "unknown". An
-- account with all four null behaves exactly as it did before this migration, a
-- deployment with no Google credentials at all is supported, and a student with
-- no Google account sits every session unchanged.

alter table public.accounts add column if not exists google_sub text;

-- The address that came back, so a student can see WHICH Google account they
-- connected. Two accounts on one phone is the normal case, not the exotic one.
alter table public.accounts add column if not exists google_email text;

alter table public.accounts add column if not exists google_linked_at timestamptz;

-- How the subject got here, which is a different question from what it is.
--
--   'roster'   an imported Classroom roster asserted it. As good as the
--              spreadsheet and the person who exported it, and the student never
--              confirmed they are that person.
--   'student'  the student signed into Google from their own BloomLoop account
--              and Google told us directly. Nobody typed anything.
--
-- Both are exact joins and both beat matching names against a roster, but they
-- are not the same evidence and must not render as the same confident tick. The
-- codebase already takes this stance everywhere else - see REPORTED vs OBSERVED
-- in server/src/services/integrity.js - so provenance travels with the claim.
alter table public.accounts
  add column if not exists google_link_source text
    check (google_link_source is null or google_link_source in ('roster', 'student'));

-- One Google student, one BloomLoop account.
--
-- Two accounts carrying the same subject would put two roll numbers on one
-- Classroom submission and let whichever was written second overwrite the first
-- student's mark - the exact silent mis-assignment this column exists to remove,
-- reintroduced one layer down. Partial, because null is "not linked" and any
-- number of accounts may be.
create unique index if not exists accounts_google_sub_key
  on public.accounts (google_sub) where google_sub is not null;

comment on column public.accounts.google_sub is
  'OpenID Connect subject claim from Google, which is also the Classroom API userId. An identifier, never a credential.';
comment on column public.accounts.google_email is
  'The address that came back with a student-confirmed link, shown to the student so they can see which account they connected.';
comment on column public.accounts.google_linked_at is
  'When the link was made. Null for a row whose subject arrived by roster import.';
comment on column public.accounts.google_link_source is
  'How google_sub got here: imported from a roster, or proved by the student signing into Google.';
