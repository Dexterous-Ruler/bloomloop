-- 0002 (formerly 002_invites.sql). v2: invites - one row per person somebody
-- with the authority to do so has decided to let in.
--
-- Apply in number order with the rest of supabase/migrations (see
-- supabase/README.md). Needs public.app_role and public.accounts from 0001. It
-- is idempotent, so re-running it is safe.
--
-- After the first HOD exists, an invite is the only way to get an account. It
-- carries the role, department and reporting line, so the sign-up form never has
-- to be believed about any of them - the browser sends an email, a password and
-- a code, and the server takes everything else from here. Single use, eight
-- Crockford base32 characters, fourteen days.

create table if not exists public.invites (
  code        text primary key,
  role        public.app_role not null,
  department  text        not null default '',
  -- Who the new account will report to, and who issued the invite. The same
  -- person today; kept as two columns so "invited on behalf of" would not need
  -- a migration. A pending invite dies with the account that wrote it, because
  -- its reporting line would otherwise point at nobody.
  reports_to  uuid        references public.accounts (id) on delete cascade,
  created_by  uuid        references public.accounts (id) on delete set null,
  -- Roster hints, all optional: the person may sign up with a different address,
  -- and only students carry a roll number.
  email       text,
  roll_no     text,
  full_name   text        not null default '',
  expires_at  timestamptz not null default (now() + interval '14 days'),
  -- Both stamped by the single UPDATE that redeems the invite, which is what
  -- stops two students racing on one code from both winning. This points at
  -- auth.users rather than accounts because the sign-in exists a moment before
  -- the account row does.
  used_by     uuid        references auth.users (id) on delete set null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists invites_reports_to_idx on public.invites (reports_to);
-- "What have I handed out that nobody has spent yet" is the only listing query
-- an invite ever gets.
create index if not exists invites_open_idx
  on public.invites (created_by, expires_at) where used_by is null;

-- RLS on with no policies, exactly like every other table here: the API server
-- holds the service role key and is the only thing that can read or write an
-- invite, so a leaked anon key cannot enumerate codes.
alter table public.invites enable row level security;
