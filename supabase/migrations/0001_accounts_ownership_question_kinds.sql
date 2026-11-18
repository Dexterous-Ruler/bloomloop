-- 0001: accounts, the hierarchy trigger, accounts_below(), ownership columns and
-- question kinds.
--
-- RECONSTRUCTED FROM CODE, NOT COPIED FROM THE LIVE PROJECT.
--
-- Everything in this file was applied to the live project by hand during the v2
-- work and never written down, which left the repository unable to build a
-- database the server can run against. The live project was unreachable when
-- this file was written, so each statement is rebuilt from what the server
-- reads and writes:
--
--   accounts            server/src/services/accounts.js (every read and write),
--                       server/src/routes/auth.js, V2-CONTRACT.md section 1
--   accounts_below()    server/src/services/accounts.js listBelow(), auth.js
--   hierarchy trigger   comments in services/accounts.js and V2-CONTRACT.md
--   owner_id columns    server/src/repo/supabaseRepo.js, server/src/ownership.js
--   questions.kind,
--   questions.payload   server/src/repo/supabaseRepo.js inQuestion/outQuestion
--
-- docs/DATABASE_SCHEMA.md lists every choice the code left open. Compare this
-- file with the live project once it is reachable.
--
-- Idempotent throughout. Against the live project the CREATE ... IF NOT EXISTS
-- and ADD COLUMN IF NOT EXISTS statements are no-ops; the functions and the
-- trigger are replaced with the versions below.

-- -------------------------------------------------------------------- role --

-- One type for the three roles, shared by accounts.role and invites.role, so a
-- role that exists on an invite always exists on the account it turns into.
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'app_role'
  ) then
    create type public.app_role as enum ('hod', 'professor', 'student');
  end if;
end
$$;

-- ---------------------------------------------------------------- accounts --

create table if not exists public.accounts (
  -- The Supabase Auth user IS the account: one sign-in, one row. Deleting the
  -- sign-in removes the row, which is how routes/auth.js undoes a sign-up that
  -- failed half way (discardAuthUser).
  id          uuid        primary key references auth.users (id) on delete cascade,
  role        public.app_role not null,
  full_name   text        not null default '',
  -- Stored lower-cased by the server, because Supabase Auth lower-cases the
  -- address it issues the token for and getAccountByEmail has to find it again.
  -- Null is allowed and is never a duplicate of another null.
  email       text,
  -- 'BL-' plus six Crockford base32 characters (no I, L, O or U). An identifier
  -- printed on rosters, never a secret. The constraint name matters: the server
  -- retries a code collision only when the error names accounts_code_key.
  code        text        not null,
  department  text        not null default '',
  -- The one edge of the hierarchy: student -> professor -> hod -> null. Which
  -- role may point at which is the trigger below, not this foreign key. No
  -- ON DELETE action: an account somebody reports to cannot be deleted.
  reports_to  uuid        references public.accounts (id),
  -- Students only. Unique within a department (index below).
  roll_no     text,
  -- Deactivated rather than deleted, so the results earned under an account
  -- survive it.
  active      boolean     not null default true,
  created_at  timestamptz not null default now(),
  -- No trigger maintains this; the server sets it on every update.
  updated_at  timestamptz not null default now(),
  constraint accounts_code_key unique (code),
  constraint accounts_email_key unique (email),
  constraint accounts_code_format check (code ~ '^BL-[0-9A-HJKMNP-TV-Z]{6}$')
);

-- A roll number identifies one student inside one department and nowhere wider.
-- services/accounts.js tells this 23505 apart from a code collision so that a
-- genuine duplicate roll number is reported instead of retried.
create unique index if not exists accounts_department_roll_no_key
  on public.accounts (department, roll_no) where roll_no is not null;

create index if not exists accounts_reports_to_idx on public.accounts (reports_to);

-- RLS on with no policies, like every other table: only the server's service
-- role key can read or write an account.
alter table public.accounts enable row level security;

-- -------------------------------------------------------- hierarchy trigger --

-- The hierarchy is one edge: a student reports to a professor, a professor to an
-- HOD, and an HOD to nobody. The server does not re-check this; it surfaces the
-- message raised here (SQLSTATE P0001, answered as a 400 by
-- services/accounts.js). A reports_to that points at no account is left to the
-- foreign key, which reports it as 23503.
create or replace function public.accounts_enforce_hierarchy()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_role public.app_role;
  wanted      text;
  wanted_with text;
  role_with   text;
begin
  if new.role = 'hod' then
    if new.reports_to is not null then
      raise exception 'an hod must not report to anyone';
    end if;
    return new;
  end if;

  if new.role = 'professor' then
    wanted := 'hod';
    wanted_with := 'an hod';
    role_with := 'a professor';
  else
    wanted := 'professor';
    wanted_with := 'a professor';
    role_with := 'a student';
  end if;

  if new.reports_to is null then
    raise exception '% must report to %', role_with, wanted_with;
  end if;

  select a.role into parent_role from public.accounts a where a.id = new.reports_to;
  if not found then
    return new;
  end if;

  if parent_role::text <> wanted then
    raise exception '% must report to %, not %', role_with, wanted_with, parent_role;
  end if;

  return new;
end;
$$;

drop trigger if exists accounts_hierarchy on public.accounts;
create trigger accounts_hierarchy
  before insert or update of role, reports_to on public.accounts
  for each row execute function public.accounts_enforce_hierarchy();

-- ----------------------------------------------------------- accounts_below --

-- Every account below `root` at any depth, flat, without the root itself. Called
-- over RPC as accounts_below({ root }) by services/accounts.js listBelow(), which
-- maps each row with the same mapper as a plain select, so it returns whole
-- account rows. The recursion runs over ids with UNION, which ends even if a
-- cycle ever got into the table.
--
-- Dropped before it is created because CREATE OR REPLACE cannot change a return
-- type, and the hand-applied version on the live project may have declared its
-- columns differently. Nothing else depends on it. SECURITY INVOKER (the
-- default), so a caller without the service role sees nothing through it.
drop function if exists public.accounts_below(uuid);
create function public.accounts_below(root uuid)
returns setof public.accounts
language sql
stable
set search_path = ''
as $$
  with recursive below (id) as (
    select a.id from public.accounts a where a.reports_to = root
    union
    select c.id from public.accounts c join below b on c.reports_to = b.id
  )
  select a.*
  from public.accounts a
  join below b on b.id = a.id
  where a.id <> root;
$$;

comment on function public.accounts_below(uuid) is
  'Every account below root at any depth, flat, root excluded. Read by services/accounts.js listBelow().';

-- --------------------------------------------------------------- ownership --

-- The professor who created a chapter or opened a room. Null marks a row made
-- before accounts existed, which only the legacy teacher-key path may reach
-- (server/src/ownership.js) - so null is meaningful and must not be backfilled
-- without replacing that path first. No ON DELETE action: an account that owns
-- material cannot be deleted out from under it.
alter table public.contents add column if not exists owner_id uuid
  references public.accounts (id);
alter table public.sessions add column if not exists owner_id uuid
  references public.accounts (id);

create index if not exists contents_owner_idx on public.contents (owner_id);
create index if not exists sessions_owner_idx on public.sessions (owner_id);

-- ---------------------------------------------------------- question kinds --

-- Which interaction a question is (mcq, truefalse, match, ... poll; the list is
-- KINDS in server/src/questionTypes.js). Deliberately no CHECK: a new kind must
-- not need a migration. Every row written before kinds existed was an mcq.
alter table public.questions add column if not exists kind text not null default 'mcq';

-- Everything kind-specific (PAYLOAD_FIELDS in questionTypes.js: pairs, blanks,
-- answerIdxs, stimulus and the rest) in one object, spread back onto the
-- question by the repository on read.
alter table public.questions add column if not exists payload jsonb not null default '{}'::jsonb;

-- options and answer_idx stay real columns because mcq and multi use them and
-- the v1 rows depend on them, but only those kinds carry them: the repository
-- writes null for every other kind. A multi has four to six options and an
-- edited question may carry an empty list, so the v1 "exactly four" rule goes.
-- Both are widenings; no row changes. answer_idx keeps its 0..3 check, which
-- only an mcq (always four options) ever exercises.
alter table public.questions alter column options drop not null;
alter table public.questions alter column answer_idx drop not null;
alter table public.questions drop constraint if exists questions_four_options;

comment on column public.questions.kind is
  'Interaction kind; the vocabulary is KINDS in server/src/questionTypes.js. No check, so a new kind needs no migration.';
comment on column public.questions.payload is
  'Kind-specific fields (PAYLOAD_FIELDS in server/src/questionTypes.js), including the answer. Teacher-only data.';
