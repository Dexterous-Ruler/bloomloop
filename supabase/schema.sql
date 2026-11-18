-- BloomLoop schema for Supabase / Postgres.
--
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- It is idempotent, so re-running it is safe.
--
-- Mirrors the four collections in the project report section 5 exactly:
-- contents, questions, sessions, profiles. Column names are snake_case here and
-- are mapped to the camelCase document shape in server/src/repo/supabaseRepo.js,
-- so nothing above the repository layer changes.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- contents --
create table if not exists public.contents (
  id          uuid primary key default gen_random_uuid(),
  title       text        not null,
  kind        text        not null check (kind in ('pptx', 'syllabus')),
  raw_text    text        not null default '',
  topics      jsonb       not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);

-- --------------------------------------------------------------- questions --
create table if not exists public.questions (
  id          uuid primary key default gen_random_uuid(),
  content_id  uuid        not null references public.contents (id) on delete cascade,
  topic       text        not null default '',
  text        text        not null,
  options     jsonb       not null,
  answer_idx  smallint    not null check (answer_idx between 0 and 3),
  bloom       text        not null check (
                bloom in ('remember','understand','apply','analyse','evaluate','create')),
  status      text        not null default 'active' check (status in ('active','discarded')),
  -- provenance: 'fallback' items came from the offline template generator and
  -- must be labelled as such in the UI. Never present them as model output.
  source      text        not null default 'llm' check (source in ('llm','fallback')),
  created_at  timestamptz not null default now(),
  constraint questions_four_options check (jsonb_array_length(options) = 4)
);

create index if not exists questions_content_idx on public.questions (content_id);
create index if not exists questions_active_idx  on public.questions (content_id) where status = 'active';

-- ---------------------------------------------------------------- sessions --
create table if not exists public.sessions (
  id          uuid primary key default gen_random_uuid(),
  code        text        not null unique,
  content_id  uuid        not null references public.contents (id) on delete cascade,
  title       text        not null default '',
  status      text        not null default 'open' check (status in ('open','closed')),
  started_at  timestamptz not null default now(),
  closed_at   timestamptz
);

create index if not exists sessions_code_idx on public.sessions (code);

-- ---------------------------------------------------------------- profiles --
create table if not exists public.profiles (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid        not null references public.sessions (id) on delete cascade,
  -- roll number is the student's whole identity: no accounts, no passwords.
  -- The unique constraint below is what makes a reconnect resume the same row
  -- instead of creating a duplicate student (test TC-07).
  roll_no       text        not null,
  name          text        not null default '',
  levels        jsonb       not null default '{}'::jsonb,
  working_level text        not null default 'understand' check (
                  working_level in ('remember','understand','apply','analyse','evaluate','create')),
  reason        text        not null default '',
  history       jsonb       not null default '[]'::jsonb,
  updated_at    timestamptz not null default now(),
  unique (session_id, roll_no)
);

create index if not exists profiles_session_idx on public.profiles (session_id);

-- -------------------------------------------------------------------- RLS --
-- Row level security is ON with no policies, which denies every anon and
-- authenticated request. The BloomLoop server connects with the service role
-- key, which bypasses RLS by design. Net effect: only our backend can read or
-- write, and a leaked anon key gives an attacker nothing.
--
-- Consequence: never put the service role key in the client bundle.

alter table public.contents  enable row level security;
alter table public.questions enable row level security;
alter table public.sessions  enable row level security;
alter table public.profiles  enable row level security;
