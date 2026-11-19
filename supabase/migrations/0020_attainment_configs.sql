-- 0020: a class's attainment formula, kept version by version.
--
-- Apply in number order with the rest of supabase/migrations (see
-- supabase/README.md). Needs accounts (0001) and classes (0016). Idempotent:
-- the table and indexes are created only if missing, constraints are dropped by
-- name and added again, the function is replaced and the trigger dropped and
-- recreated. Adds one table, one function and one trigger; changes no row, and
-- no existing table.
--
-- WHY.
-- Colleges compute course-outcome attainment by formulas of their own: the
-- share of marks a student needs, the share of students that makes level 1, 2 or
-- 3, which evidence counts. So the formula is data, not code
-- (server/src/services/attainment.js validates it; attainmentPresets.js ships
-- named EXAMPLES, none of them presented as an institutional standard), and a
-- class keeps the one its professor chose. Every attainment report states the
-- formula and the version it used; this table is what that version number
-- points at.
--
-- WHAT IS ADDED.
--   attainment_configs   one row per saved version of a class's formula.
--     version            1, 2, 3 ... per class. The one in force is the highest.
--                        Saving a change inserts the next version; nothing is
--                        updated, so a report printed under version 2 can always
--                        be checked against what version 2 said
--                        (attainment_configs_class_version_key also refuses two
--                        saves racing for one number).
--     config             the formula as the server validated it: studentThreshold,
--                        minAnswers, levels, evidence, attempts, roomWeights.
--                        Shape and ranges are the server's check; here, an object
--                        of at most 32 KB.
--     created_by         who saved it; null on the shared teacher-key path, or
--                        once that account is deleted.
--   A class with no row uses the default example (DEFAULT_PRESET), and its
--   reports say so.
--
-- WHAT IS NOT ADDED. Nothing on answers, sessions or classes. A deleted room's
-- archive (0009) needs nothing from here: the formula is the class's, and
-- outlives its rooms.
--
-- PRIVACY. Staff-only, like every class table. Nothing here is about a student.
--
-- WHAT IS REFUSED.
--   A version below 1; a config that is not a JSON object, or over 32 KB
--   (23514). Two rows of one class with one version (23505). A class that does
--   not exist (23503). Changing or deleting a row (23001), except inside a
--   foreign key's action: the class deleted (its versions go with it) or the
--   saving account deleted (created_by set null).
--
-- RLS is on with no policies, like every table: only the server's service role
-- reads or writes, and the server decides who sees what.

create table if not exists public.attainment_configs (
  id          uuid        primary key default gen_random_uuid(),
  class_id    uuid        not null references public.classes (id) on delete cascade,
  version     integer     not null,
  config      jsonb       not null,
  created_at  timestamptz not null default now(),
  created_by  uuid        references public.accounts (id) on delete set null,
  -- One row per version per class; also the index the latest version is read by.
  constraint attainment_configs_class_version_key unique (class_id, version)
);

alter table public.attainment_configs enable row level security;

alter table public.attainment_configs drop constraint if exists attainment_configs_version_check;
alter table public.attainment_configs
  add constraint attainment_configs_version_check check (version >= 1);
alter table public.attainment_configs drop constraint if exists attainment_configs_config_check;
alter table public.attainment_configs
  add constraint attainment_configs_config_check check (
    jsonb_typeof(config) = 'object' and octet_length(config::text) <= 32768
  );

-- The foreign key's own index, so deleting an account does not scan the table.
create index if not exists attainment_configs_created_by_idx
  on public.attainment_configs (created_by) where created_by is not null;

-- A saved version is kept as it was saved: a change is a new version. Inside a
-- foreign key's action (pg_trigger_depth() > 1, as 0017's guard reads it) the
-- class's delete takes its versions with it, and an account's delete sets
-- created_by null and nothing else.
create or replace function public.attainment_configs_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then
    if tg_op = 'DELETE' then
      return old;
    end if;
    if new.created_by is null and (to_jsonb(new) - 'created_by') = (to_jsonb(old) - 'created_by') then
      return new;
    end if;
  end if;
  raise exception 'attainment formula version % of class % is kept as it was saved: save a change as a new version',
    old.version, old.class_id
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists attainment_configs_guard on public.attainment_configs;
create trigger attainment_configs_guard
  before update or delete on public.attainment_configs
  for each row execute function public.attainment_configs_guard();

comment on table public.attainment_configs is
  'A class''s attainment formula, one row per saved version (the highest is in force). Append-only: a change is a new version.';
comment on column public.attainment_configs.config is
  'The formula as the server validated it (services/attainment.js): studentThreshold, minAnswers, levels, evidence, attempts, roomWeights.';
