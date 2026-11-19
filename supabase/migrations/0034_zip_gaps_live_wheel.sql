-- 0034: the design zip's server gaps for the live room and the wheel (Batch 8).
--
-- Apply in number order with the rest of supabase/migrations (see
-- supabase/README.md). Needs sessions, questions and accounts (0000, 0001),
-- 0017's wheel_picks, room_activities and its function teacher_records_guard(),
-- which keeps both new tables append-only as it keeps the observations.
-- Depends on nothing in 0018 to 0033. Idempotent: tables, columns and indexes
-- are created only if missing, checks and foreign keys are dropped by name and
-- added again, and triggers are dropped and recreated. Adds two tables and one
-- nullable column, widens one check, and changes no existing row.
--
-- WHY (docs/UI_ZIP_AUDIT.md gaps L1, C2, W2 and the older file's gap 9).
--   L1, C2  On the live screen a professor may press "Suggest a move": the
--           server asks the model, in the background (decision 5), for a
--           two-minute, no-device activity aimed at where the class is stuck,
--           from the room's AGGREGATE figures only and the chapter's own slides
--           (decision 1). Asked for one activity kind, the same call writes that
--           activity's prompt for the chapter. Each suggestion is kept, with the
--           figures it was built from, so it can be seen later, and "Use it"
--           records the move as an activity that points back at it.
--   W2      The wheel's "Question + student": the draw may also draw an approved
--           question of the room's set, with the same server randomness, and
--           "Another" draws the next one for the same pick. Every question the
--           server drew for a pick is kept, in order, so "Another" never repeats
--           one and the record shows what was drawn, not only what was kept.
--   gap 9   A fourth thing a picked student is asked: a verbal question the
--           professor makes up on the spot ("verbal"), with no bank question.
--
-- WHAT IS ADDED.
--   teaching_moves        one row per suggestion the model made in a room
--     session_id          the room; the row goes with it (on delete cascade)
--     purpose             'move' (L1, aimed at where the class is stuck) or
--                         'prompt' (C2, the prompt for one activity kind)
--     activity_kind       which of the room's five activities it is: check,
--                         think, group, diagram or real
--     title, body         the suggestion as the model wrote it (checked by the
--                         server first: no names, no judgement, no contact
--                         details), at most 80 and 600 characters
--     focus_level         the Bloom level it is aimed at, or null for a prompt
--                         asked with no graded answers in the room
--     topic               the chapter's topic it draws on
--     basis               the aggregate figures it was built from: counts per
--                         level, the support band count, the not-answered
--                         count, present; never a name or a roll number
--     source_ref          the slides (or the chapter text) it cites
--     model               the model that wrote it
--     asked_by, asked_at  who pressed the button, and when it was kept
--   wheel_question_draws  one row per question the server drew for a pick
--     pick_id             the pick (with session_id, its room); the row goes
--                         with the pick, and so with the room
--     draw_order          1 for the draw made with the pick, 2, 3, ... for each
--                         "Another"; unique per pick
--     question_id         the question drawn (set null if the question is ever
--                         deleted; the pick keeps its own copy of the id)
--     pool_size           how many questions it was drawn from: each had
--                         1 / pool_size
--     drawn_at, drawn_by  when and by whom
--   room_activities.suggestion_id
--                         the suggestion a recorded activity came from ("Use
--                         it"), or null. It must be a suggestion of the same
--                         room: a composite foreign key on (session_id,
--                         suggestion_id).
--
-- WHAT IS CHANGED. wheel_picks_ask_check now allows 'verbal' beside bank,
-- diagram and demo; a verbal ask names no bank question, like a diagram or a
-- demo. Every existing pick already satisfies it. 0017 is widened the same way,
-- so re-running it never narrows the check below what this file allows.
--
-- RETENTION. Both tables are append-only (teacher_records_guard: no update,
-- and a delete only inside the room's cascade) and kept for as long as the
-- room is. A suggestion is a few hundred characters; a draw is one row. They
-- are not in the room archive: a suggestion is not evidence about a student,
-- and the pick in the archive keeps the question it ended on.
--
-- PRIVACY. Staff-only. RLS on, no policies: only the server's service role
-- reads or writes them. A suggestion's basis holds counts only; the model is
-- never sent a name, a roll number or one student's figures.

-- ------------------------------------------------------------ the wheel ask --

alter table public.wheel_picks drop constraint if exists wheel_picks_ask_check;
alter table public.wheel_picks
  add constraint wheel_picks_ask_check
  check (ask in ('bank', 'diagram', 'demo', 'verbal') and (ask = 'bank' or question_id is null));

-- ---------------------------------------------------------- teaching_moves --

create table if not exists public.teaching_moves (
  id             uuid        primary key default gen_random_uuid(),
  session_id     uuid        not null references public.sessions (id) on delete cascade,
  purpose        text        not null,
  activity_kind  text        not null,
  title          text        not null default '',
  body           text        not null,
  focus_level    text,
  topic          text        not null default '',
  basis          jsonb       not null default '{}'::jsonb,
  source_ref     jsonb,
  model          text        not null,
  asked_by       uuid        references public.accounts (id) on delete set null,
  asked_at       timestamptz not null default now(),
  -- What an activity's composite foreign key points at: a suggestion of its room.
  constraint teaching_moves_session_id_key unique (session_id, id)
);

alter table public.teaching_moves enable row level security;

alter table public.teaching_moves drop constraint if exists teaching_moves_purpose_check;
alter table public.teaching_moves
  add constraint teaching_moves_purpose_check check (purpose in ('move', 'prompt'));
alter table public.teaching_moves drop constraint if exists teaching_moves_kind_check;
alter table public.teaching_moves
  add constraint teaching_moves_kind_check check (activity_kind in ('check', 'think', 'group', 'diagram', 'real'));
alter table public.teaching_moves drop constraint if exists teaching_moves_text_check;
alter table public.teaching_moves
  add constraint teaching_moves_text_check check (
    char_length(title) <= 80 and char_length(body) between 1 and 600 and char_length(topic) <= 200
  );
alter table public.teaching_moves drop constraint if exists teaching_moves_level_check;
alter table public.teaching_moves
  add constraint teaching_moves_level_check check (
    focus_level is null or focus_level in ('remember', 'understand', 'apply', 'analyse', 'evaluate', 'create')
  );
-- A move (L1) is aimed at a level; a prompt (C2) may be asked before any answer.
alter table public.teaching_moves drop constraint if exists teaching_moves_move_level_check;
alter table public.teaching_moves
  add constraint teaching_moves_move_level_check check (purpose = 'prompt' or focus_level is not null);
alter table public.teaching_moves drop constraint if exists teaching_moves_basis_check;
alter table public.teaching_moves
  add constraint teaching_moves_basis_check check (
    jsonb_typeof(basis) = 'object' and (source_ref is null or jsonb_typeof(source_ref) = 'object')
  );
alter table public.teaching_moves drop constraint if exists teaching_moves_model_check;
alter table public.teaching_moves
  add constraint teaching_moves_model_check check (char_length(model) between 1 and 120);

-- Also the index for reading a room's suggestions in the order they were kept.
create index if not exists teaching_moves_room_idx on public.teaching_moves (session_id, asked_at);
create index if not exists teaching_moves_asker_idx on public.teaching_moves (asked_by) where asked_by is not null;

drop trigger if exists teaching_moves_keep on public.teaching_moves;
create trigger teaching_moves_keep
  before update or delete on public.teaching_moves
  for each row execute function public.teacher_records_guard();

-- --------------------------------------------------- wheel_question_draws --

create table if not exists public.wheel_question_draws (
  id           uuid        primary key default gen_random_uuid(),
  session_id   uuid        not null references public.sessions (id) on delete cascade,
  pick_id      uuid        not null references public.wheel_picks (id) on delete cascade,
  draw_order   integer     not null,
  question_id  uuid        references public.questions (id) on delete set null,
  pool_size    integer     not null,
  drawn_at     timestamptz not null default now(),
  drawn_by     uuid        references public.accounts (id) on delete set null,
  -- One place per draw for a pick. Also the index for reading a pick's draws.
  constraint wheel_question_draws_pick_order_key unique (pick_id, draw_order)
);

alter table public.wheel_question_draws enable row level security;

alter table public.wheel_question_draws drop constraint if exists wheel_question_draws_order_check;
alter table public.wheel_question_draws
  add constraint wheel_question_draws_order_check check (draw_order >= 1 and pool_size >= 1);

create index if not exists wheel_question_draws_room_idx on public.wheel_question_draws (session_id);
create index if not exists wheel_question_draws_question_idx on public.wheel_question_draws (question_id) where question_id is not null;
create index if not exists wheel_question_draws_drawer_idx on public.wheel_question_draws (drawn_by) where drawn_by is not null;

-- A draw belongs to a pick of its own room.
create or replace function public.wheel_question_draws_same_room()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.wheel_picks p where p.id = new.pick_id and p.session_id = new.session_id
  ) then
    raise exception 'wheel_question_draws: pick % was not drawn in room %', new.pick_id, new.session_id
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists wheel_question_draws_same_room on public.wheel_question_draws;
create trigger wheel_question_draws_same_room
  before insert on public.wheel_question_draws
  for each row execute function public.wheel_question_draws_same_room();

drop trigger if exists wheel_question_draws_keep on public.wheel_question_draws;
create trigger wheel_question_draws_keep
  before update or delete on public.wheel_question_draws
  for each row execute function public.teacher_records_guard();

-- ---------------------------------------------- room_activities.suggestion_id --

alter table public.room_activities add column if not exists suggestion_id uuid;

-- The suggestion must be one of the activity's own room. A suggestion is never
-- deleted on its own (teacher_records_guard), so the cascade only ever runs
-- inside the room's own delete, which takes the activity anyway.
alter table public.room_activities drop constraint if exists room_activities_suggestion_fkey;
alter table public.room_activities
  add constraint room_activities_suggestion_fkey foreign key (session_id, suggestion_id)
  references public.teaching_moves (session_id, id) on delete cascade;

create index if not exists room_activities_suggestion_idx on public.room_activities (suggestion_id) where suggestion_id is not null;
