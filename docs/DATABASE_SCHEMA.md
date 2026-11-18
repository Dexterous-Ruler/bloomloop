# Database schema

BloomLoop's production store is Supabase Postgres. The SQL that builds it is
`supabase/migrations/`, applied in number order (how: `supabase/README.md`). Every
file is idempotent and safe on a database holding real records. The test is
`cd server && npm run migrations` (`server/scripts/migrations.mjs`, PGlite).

Every table has row level security **on with no policies**. Only the server's
service role key, which bypasses RLS, can read or write; the anon key sees nothing.
The server is the only place authorization is decided.

Last revised 18 November 2026.

## Migration order

| File | What it does | Origin |
|---|---|---|
| `0000_core_tables.sql` | `contents`, `questions`, `sessions`, `profiles` as v1 built them; RLS | was `schema.sql` |
| `0001_accounts_ownership_question_kinds.sql` | `app_role` type, `accounts`, hierarchy trigger, `accounts_below()`, `contents.owner_id`, `sessions.owner_id`, `questions.kind`, `questions.payload`, nullable `options`/`answer_idx` | **reconstructed from code** (see the last section) |
| `0002_invites.sql` | `invites` | was `002_invites.sql` |
| `0003_student_google_link.sql` | `accounts.google_*` columns, one Google identity per account | was `003_student_google_link.sql` |
| `0004_invite_google_sub.sql` | `invites.google_sub` | was `004_invite_google_sub.sql` |
| `0005_sessions_and_profiles_v2.sql` | paused rooms, the pin (`served_*`), `integrity`, `profiles.account_id` | was `005_sessions_and_profiles_v2.sql` |
| `0006_accommodations.sql` | `accounts.accommodations` | was the first `006` (`006_accommodations.sql`) |
| `0007_mastery_settings.sql` | room settings, `served_tries`, `served_last` | was the second `006` (`006_mastery_settings.sql`) |
| `0008_answers.sql` | `answers`, the per-answer evidence store | new |
| `0009_room_archives.sql` | `room_archives`, a deleted room kept as one JSON document (at most 1 MiB) | new |

The SQL of every moved file is unchanged; only header comments were updated.

## Tables

Types are Postgres types. "Repo" means `server/src/repo/supabaseRepo.js`, which maps
snake_case columns to the camelCase documents the rest of the server uses.

### contents (0000, 0001)

A chapter: an uploaded `.pptx` or a syllabus.

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | primary key, `gen_random_uuid()` |
| `title` | text | not null |
| `kind` | text | not null, `pptx` or `syllabus` |
| `raw_text` | text | not null, default `''` |
| `topics` | jsonb | not null, default `[]` |
| `owner_id` | uuid | null; references `accounts(id)`, no delete action. Null = made before accounts; only the legacy teacher-key path reaches it (`ownership.js`) |
| `created_at` | timestamptz | not null, default now() |

Written by: repo `createContent` from `routes/content.js` (upload) and `seed.js`;
`updateContent` (title, raw text, topics).

### questions (0000, 0001)

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | primary key |
| `content_id` | uuid | not null, references `contents(id)` on delete cascade |
| `topic` | text | not null, default `''` |
| `text` | text | not null |
| `kind` | text | not null, default `'mcq'`. No check: the vocabulary is `KINDS` in `questionTypes.js`, and a new kind needs no migration |
| `options` | jsonb | **null** for kinds without options; 4 for mcq, 4 to 6 for multi, 2 to 6 for poll |
| `answer_idx` | smallint | null; 0 to 3 when set (mcq only) |
| `bloom` | text | not null; `remember`, `understand`, `apply`, `analyse`, `evaluate`, `create` |
| `status` | text | not null, default `active`; `active` or `discarded` |
| `source` | text | not null, default `llm`; `llm` or `fallback` |
| `payload` | jsonb | not null, default `{}`. Every `PAYLOAD_FIELDS` entry (answers included): teacher-only data |
| `created_at` | timestamptz | not null, default now() |

Written by: repo `insertQuestions` from `routes/generate.js` (generation) and
`routes/bank.js` (split, merge, regenerate); `updateQuestion` from `routes/bank.js`
(edit, bulk discard, restore, retag); `deleteQuestions` from `routes/generate.js`
(replace mode).

### sessions (0000, 0001, 0005, 0007)

A room.

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | primary key |
| `code` | text | not null, unique |
| `content_id` | uuid | not null, references `contents(id)` on delete cascade |
| `title` | text | not null, default `''` |
| `status` | text | not null, default `open`; `open`, `paused`, `closed` |
| `owner_id` | uuid | null; references `accounts(id)`, no delete action |
| `started_at` | timestamptz | not null, default now() |
| `closed_at` | timestamptz | null |
| `paused_at` | timestamptz | null |
| `mastery_goal` | numeric(3,2) | not null, default 0.80; 0.80, 0.90 or 1.00 |
| `reattempts` | smallint | not null, default 0; 0 to 2 |
| `redemption` | boolean | not null, default false |

Written by: repo `createSession` from `routes/session.js` (the settings are written
here only, never updated); `updateSession` (status, title, closed/paused times);
`deleteSession`.

### profiles (0000, 0005, 0007)

One student in one room, keyed by roll number.

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | primary key |
| `session_id` | uuid | not null, references `sessions(id)` on delete cascade |
| `roll_no` | text | not null; unique with `session_id` |
| `name` | text | not null, default `''` |
| `levels` | jsonb | not null, default `{}` |
| `working_level` | text | not null, default `understand`; one of the six levels |
| `reason` | text | not null, default `''` |
| `history` | jsonb | not null, default `[]` |
| `served_id`, `served_at`, `served_why` | text, timestamptz, text | null; the pinned question |
| `served_tries` | smallint | not null, default 0 |
| `served_last` | text | null; a hash of the last submission, never the answer |
| `integrity` | jsonb | not null, default `[]`; append-only signals |
| `account_id` | uuid | null; references `accounts(id)` on delete set null |
| `updated_at` | timestamptz | not null, default now() |

Written by: repo `saveProfile` (upsert on `session_id, roll_no`) from
`sockets/index.js`: join (including the account link from `findStudentForRoll`),
the pin, integrity signals, every answer.

### answers (0008)

One row per submitted attempt; append-only evidence.

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | primary key |
| `session_id` | uuid | not null, references `sessions(id)` on delete cascade |
| `answer_key` | text | not null; the client's idempotency key; unique with `session_id` |
| `roll_no` | text | not null |
| `account_id` | uuid | null; references `accounts(id)` on delete set null |
| `question_id` | uuid | null; references `questions(id)` on delete set null |
| `content_id` | uuid | null, no foreign key |
| `topic` | text | not null, default `''` |
| `bloom` | text | not null; one of the six levels |
| `kind` | text | not null, default `mcq` |
| `question_snapshot` | jsonb | not null, default `{}`; the question as answered, answer key included (teacher-only) |
| `response` | jsonb | null; what the student sent, never discarded |
| `attempt` | smallint | not null, default 1 |
| `final` | boolean | not null, default true; false for a wrong attempt followed by a retry |
| `correct` | boolean | null |
| `score` | numeric(4,3) | null |
| `detail` | text | not null, default `''` |
| `ungraded` | boolean | not null, default false (polls) |
| `language` | text | not null, default `en` |
| `question_source` | text | not null, default `llm` |
| `served_at` | timestamptz | null |
| `answered_at` | timestamptz | not null, default now() |
| `review_status` | text | not null, default `auto`; `auto`, `provisional`, `confirmed`, `overridden` |
| `auto_correct`, `auto_score`, `auto_detail` | boolean, numeric(4,3), text | the machine's first assessment, never overwritten; `auto_detail` not null default `''` |
| `reviewed_by` | uuid | null; references `accounts(id)` on delete set null |
| `reviewed_at` | timestamptz | null |
| `review_note` | text | not null, default `''` |
| `confidence` | text | null; `sure`, `think`, `guess` (later phase) |

Indexes: unique `(session_id, answer_key)`; `session_id`; `(session_id, roll_no)`;
`account_id`; `question_id`; partial on `review_status` where `provisional`.

Written by: repo `recordAnswer` from `sockets/index.js` (`handleAnswer`: final
answers, wrong attempts before a retry, polls); a 23505 on the unique key returns
the stored row instead of a second one. `updateAnswer` changes review fields only
(`correct`, `score`, `review_status`, `reviewed_by`, `reviewed_at`, `review_note`,
`final`).

Deleting a room deletes its answers (cascade), but only after the server has
written the whole room to `room_archives` (below): `DELETE /api/session/:code`
archives first and deletes nothing if that write fails. Deleting a question keeps
answers, with `question_id` cleared and the snapshot intact.

### room_archives (0009)

One row per deleted room: the room, every student's profile and history, and every
stored answer with the question as shown, as one compact JSON document. The owner's
rule (18 Nov 2026): keep the room "in the form of json format so it is less than
even 1mb".

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, default `gen_random_uuid()` | |
| `session_id` | uuid, not null, **unique** | No foreign key: the session is deleted straight after. A retried delete replaces the row. |
| `code`, `title` | text | The room's code and title, for the list |
| `owner_id` | uuid -> `accounts` on delete set null | The room's owner; the same read rule as live rooms applies |
| `archived_by` | uuid -> `accounts` on delete set null | Null on the shared-key path |
| `archived_at` | timestamptz, default now() | |
| `bytes` | integer, check `0 < bytes <= 1048576` | Size of `data` as served |
| `data` | jsonb, not null | Format `bloomloop.room-archive` v1, see `server/src/services/archive.js` |

Index `(owner_id, archived_at desc)`. RLS on, no policies.

The format stores each list as `{ cols, rows }`, the question once (answers point at
it), the student once (answers and history point at them), and times as offsets from
`timeBase`. A column is left out only when every row rebuilds it exactly; `derived`
names those columns. Measured: a class of 60 students with 30 answers each is about
267 KB; 80 students with 60 answers each, a third of them written, about 693 KB.
`decodeRoomArchive()` gives back every answer and history entry field for field
(tested in `server/test/archive.test.js`).

Read by `GET /api/session/archives` (list, no data) and
`GET /api/session/archives/:id` (the `.json` file), both under the same ownership
rule as rooms.

### accounts (0001, 0003, 0006)

One per Supabase Auth user.

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | primary key; references `auth.users(id)` on delete cascade |
| `role` | `app_role` | not null; `hod`, `professor`, `student` |
| `full_name` | text | not null, default `''` |
| `email` | text | null, unique (`accounts_email_key`); stored lower-case |
| `code` | text | not null, unique (`accounts_code_key`); `BL-` + 6 Crockford base32 (`accounts_code_format`) |
| `department` | text | not null, default `''` |
| `reports_to` | uuid | null; references `accounts(id)`, no delete action; who may point where is the trigger |
| `roll_no` | text | null; students only; unique with `department` (`accounts_department_roll_no_key`) |
| `active` | boolean | not null, default true |
| `created_at`, `updated_at` | timestamptz | not null, default now(); no trigger maintains `updated_at` |
| `google_sub` | text | null; unique where not null (`accounts_google_sub_key`) |
| `google_email` | text | null |
| `google_linked_at` | timestamptz | null |
| `google_link_source` | text | null, `roster` or `student` |
| `accommodations` | jsonb | not null, default `{}`; must be an object |

Written by `server/src/services/accounts.js` only: `createAccount` (from
`routes/auth.js` `POST /signup` and `POST /bootstrap`), `updateAccount` (`PATCH
/account/:id`), `linkGoogle` / `unlinkGoogle` (`routes/classroom.js`),
`setAccommodations` (`PUT /students/:id/accommodations`). Read on every
authenticated request (`getAccount`), on room join (`findStudentForRoll`), and by
grade posting (`listLinkedStudents`).

### invites (0002, 0004)

| Column | Type | Rules |
|---|---|---|
| `code` | text | primary key (8 Crockford characters, made by the server) |
| `role` | `app_role` | not null |
| `department` | text | not null, default `''` |
| `reports_to` | uuid | references `accounts(id)` on delete cascade |
| `created_by` | uuid | references `accounts(id)` on delete set null |
| `email`, `roll_no` | text | null |
| `full_name` | text | not null, default `''` |
| `expires_at` | timestamptz | not null, default now() + 14 days |
| `used_by` | uuid | references `auth.users(id)` on delete set null |
| `used_at` | timestamptz | null |
| `created_at` | timestamptz | not null, default now() |
| `google_sub` | text | null, not unique |

Written by `routes/auth.js`: `insertInvite` (`POST /invite`), `claimInvite` (one
conditional update, so two racers cannot both win) and `releaseInvite` (`POST
/signup` rollback).

## Types, functions and triggers

- **`public.app_role`**: enum `hod`, `professor`, `student`. Used by `accounts.role`
  and `invites.role`.
- **`public.accounts_below(root uuid) returns setof public.accounts`**: every
  account below `root` at any depth, flat, root excluded. SQL, `stable`, security
  invoker, `search_path = ''`. Recursion over ids with `UNION`, so a cycle cannot
  loop. Called as `rpc('accounts_below', { root })` by `listBelow()` in
  `services/accounts.js`, which feeds `/team`, `canSeeAccount`, `scopeFor`, the HOD
  and professor dashboards and analytics.
- **`public.accounts_enforce_hierarchy()`** with trigger **`accounts_hierarchy`**,
  `before insert or update of role, reports_to on accounts`. Rules: an HOD reports
  to nobody; a professor reports to an HOD; a student reports to a professor.
  Raises SQLSTATE P0001 (the server answers 400 with the message), for example
  `a student must report to a professor, not hod`. A `reports_to` naming no account
  is left to the foreign key (23503).

## Reconstructed from code

`0001` was written while the live project was unreachable (its hostname did not
resolve on 18 November 2026). Accounts, `accounts_below()`, the trigger, the
`owner_id` columns and the question kind columns had been applied to the live
project by hand and never committed. Each piece below is rebuilt from what the
server does at runtime. **Once the live project is reachable, compare it with
this section** (queries at the end).

| Item | Evidence | Choice made where the code is silent |
|---|---|---|
| `app_role` enum | `002` already used `public.app_role`; V2-CONTRACT §1 | Created only if missing |
| `accounts.id` → `auth.users` on delete cascade | `routes/auth.js` `discardAuthUser`: "accounts.id cascades from auth.users" | |
| Column set | `outAccount`, `createAccount`, `updateAccount` in `services/accounts.js`; V2-CONTRACT §1 | |
| `full_name`, `department` not null default `''` | `services/accounts.js`: "The three text columns are NOT NULL with a '' default", and `text()` is applied to exactly these two | The comment says three; only two are written that way, so only two are made so. `code` is not null with no default |
| `email` nullable, unique | `normaliseEmail` returns null for blank; task brief | Constraint named `accounts_email_key` |
| `code` unique as `accounts_code_key` | `isCodeCollision` matches that name in the error | |
| `code` format check | `makeCode`, V2-CONTRACT §4 | Added as `accounts_code_format`; may not exist live |
| Unique `(department, roll_no)` | `isCodeCollision` and `listLinkedStudents` comments | Name `accounts_department_roll_no_key` and the `where roll_no is not null` are mine |
| `reports_to` foreign key | V2-CONTRACT §1 | No delete action: an account others report to cannot be deleted |
| `updated_at` not null default now() | `updateAccount`: no trigger, server sets it | Not null with a default |
| Hierarchy trigger | V2-CONTRACT §1; `services/accounts.js` (P0001 → 400, sample message) | Names are mine. Professors and students with no `reports_to` are refused (the contract's "student → professor → hod → null"). Not checked: that the parent is in the same department or active, and changing the role of an account others report to |
| `accounts_below` return shape | `listBelow` maps rows with `outAccount`; "the root itself is not in the result" | `setof public.accounts`. Dropped and recreated each run, because `create or replace` cannot change a return type if the live one declares its columns |
| `contents.owner_id`, `sessions.owner_id` | repo `inContent`, `createSession`; `ownership.js`; V2-CONTRACT §1 | Reference `accounts(id)` with no delete action; indexes `contents_owner_idx`, `sessions_owner_idx` are mine |
| `questions.kind` | repo `inQuestion` / `outQuestion` (`?? 'mcq'`) | Not null default `'mcq'`; no check |
| `questions.payload` | repo `inQuestion` always writes an object | Not null default `{}` (the reader also copes with null) |
| `options`, `answer_idx` nullable; `questions_four_options` dropped | repo writes null for kinds without options; multi has 4 to 6; an edit can save `[]` | `answer_idx` keeps its 0 to 3 check |
| `accounts_reports_to_idx` | `findStudentForRoll` filters by `reports_to` | Mine |

What running the set does to the live project: every `create ... if not exists` and
`add column if not exists` is skipped; nothing is rewritten. `0001` replaces
`accounts_below()`, installs `accounts_hierarchy` (if the live trigger has another
name, both will then run the same rule; drop the old one after comparing), and
creates `accounts_department_roll_no_key` (a second copy if the live index has
another name; if the live data had duplicate roll numbers within a department,
`0001` fails and, run with `--single-transaction`, changes nothing).

Queries for the comparison:

```sql
select table_name, column_name, data_type, udt_name, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public' and table_name in ('accounts', 'contents', 'sessions', 'questions')
 order by table_name, ordinal_position;

select conrelid::regclass, conname, pg_get_constraintdef(oid)
  from pg_constraint where conrelid in ('public.accounts'::regclass, 'public.questions'::regclass,
                                        'public.contents'::regclass, 'public.sessions'::regclass);

select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = 'accounts';

select tgname, pg_get_triggerdef(oid) from pg_trigger
 where tgrelid = 'public.accounts'::regclass and not tgisinternal;

select p.oid::regprocedure, pg_get_functiondef(p.oid)
  from pg_proc p where p.pronamespace = 'public'::regnamespace;
```

## Stale references outside this folder

Fixed on 18 Nov 2026: `README.md`, `.env.example`, `server/src/repo/supabaseRepo.js`,
`server/src/repo/index.js`, `server/src/services/accounts.js` and
`server/src/accommodations.js` now point at `supabase/migrations/`. The boot probe
(`probeSupabase`) now checks every table the server writes, not only `contents`, and
names the migration that creates any that is missing.
