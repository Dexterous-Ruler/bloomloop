# Database schema

BloomLoop's production store is Supabase Postgres. The SQL that builds it is
`supabase/migrations/`, applied in number order (how: `supabase/README.md`). Every
file is idempotent and safe on a database holding real records. The test is
`cd server && npm run migrations` (`server/scripts/migrations.mjs`, PGlite).

Every table has row level security **on with no policies**. Only the server's
service role key, which bypasses RLS, can read or write; the anon key sees nothing.
The server is the only place authorization is decided.

Last revised 19 November 2026, after the Phase 5 review fixes: the owner's decisions
(`0022`), class questions (`0023`) and misconception labels (`0024`). The honest
indicators and the Phase 5 review fixes added no migration. The full rerun after them
gave 752 of 752 migration checks on PGlite. The next free number is `0025`.

**Applying the owner's decisions and Phase 5: `0022`, then `0023`, then `0024`, all
before the server is deployed.** Unlike `0019` to `0021`, each of the three holds a
piece every room needs: every join and answer writes `0022`'s `account_verified`
columns and `0023`'s `class_question_id` and `round`, every room's bank reads
`class_questions`, and every question saved writes `replaces_id` (`0022`) and
`misconceptions` (`0024`). With any piece missing, the boot probe stops using Supabase
and its log names the file to apply. None of the three rewrites a row, narrows a check
or drops anything; each re-runs over data unchanged; none has run anywhere but PGlite
(`npm run migrations`: 633 checks with `0022`, 697 with `0023`, 752 with `0024`).

**19 November 2026, the owner's decisions: `0022`.** One file for everything the
decisions of 19 Nov 2026 needed (`docs/PRODUCT_DECISIONS.md`):
`profiles.account_verified` and `answers.account_verified` (decision 7: a link counts
in a student's own history only when a signed-in phone made it),
`class_students.under_18` (decision 8), `questions.replaces_id` (a regenerated draft's
link to the active question it would replace), and `questions_source_check` widened
to `'teacher'`. **Apply `0022` before deploying the server that writes them**: the
repo writes `account_verified` on every join and answer, `replaces_id` on every
question saved and `under_18` on every roster row added, so the boot probe treats
`0022` as one rooms need, and without it the server does not use Supabase and says
which file to apply. Run on PGlite only (`npm run migrations`, 633 of 633 on
19 November 2026); not applied to the live project by this work.

**Phase 5: `0023`, class questions.** One table, `class_questions` (a class question's
state and the question as it was asked), and two nullable columns on `answers`,
`class_question_id` and `round`, which every vote in a class question carries and every
other answer leaves null. No check is widened: a confidence tap is stored in the
spellings `0008`'s check already allows. **Apply `0023` before deploying the server
that writes it**: the repo writes both columns with every answer and the live loop
reads `class_questions` with every room's bank, so the boot probe treats `0023` as one
rooms need. `0023` rewrites no row; every answer before it reads as an ordinary answer.
Run on PGlite only (`npm run migrations`, 697 of 697 on 19 November 2026).

**Phase 5: `0024`, misconception labels.** One column, `questions.misconceptions`
(jsonb, not null, default `[]`): the labels on a question's wrong options, each with
its option's text, the label, its provenance (`ai` or `professor`) and when it was
added and last changed. Nothing is added to `answers`: a report matches each answer to
the question's current label through the option's words in that answer's own snapshot.
**Apply `0024` before deploying the server that writes it**: the repo writes the
column with every question it saves, so the boot probe treats it as one rooms need,
and without it the server does not use Supabase and says to apply `0024`. `0024`
rewrites no row; every existing question reads as having no labels. Run on PGlite only
(`npm run migrations`, 752 of 752 on 19 November 2026).

**The boot probe, since 19 November 2026**, checks the tables and columns the server
writes from `0000` to `0024`, each named with its file (not the columns of `0003` to
`0007`, nor `0011`'s index or `0012`'s triggers, which it does not look for;
`supabase/README.md` lists which file it checks). What rooms need (`0000` to
`0018`, and `0022` to `0024`) stops Supabase being used when missing; what only some routes
need (`0019`, `0020`, and `0021`'s `attendance.roll_no`) is logged at boot, one line
per missing piece, naming the file to apply and what fails until it is, and Supabase
is still used (`ROOM_SCHEMA`, `ROUTE_SCHEMA` in `server/src/repo/supabaseRepo.js`).
Before this, `0019` to `0021` were not checked at all.

**Applying Phase 4: `0019`, then `0020`, then `0021`.** None of the three stops the
boot probe (since 19 November 2026 each is checked and a missing one logged, naming
its file), but they differ in what a missing one breaks:
- **`0019` and `0020`.** A server deployed before they are applied keeps every room
  on Supabase. Only the outcome, coverage, attainment, config and register routes
  fail, with a 500 naming the missing table. Apply both before anyone uses those
  routes. The CSV roster import needs only `0016`.
- **`0021` must be applied before the server is deployed.** The repo writes
  `attendance.roll_no` on every attendance mark (`inAttendance` in
  `server/src/repo/supabaseRepo.js`), so without the column PostgREST would refuse
  every mark: a phone's join would be let in but mark nobody (the failure is only
  logged), and a professor's marks and the Absent mark of a wheel pick would fail.
  Traced from the code; not run against Supabase.

None of the three changes an existing row. `0019` and `0020` add tables only and no
column to `answers`, `sessions`, `classes` or `room_archives`: a course outcome, its
mappings and a formula belong to a class and are never stored on an answer. `0021`
adds one nullable column to `attendance` and backfills nothing. The exports and
printable pages read what these tables and the Phase 1 to 3 tables already hold.

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
| `0010_answer_reviews.sql` | `answer_reviews`, the append-only log of professor review decisions; index `answers_open_queue_idx` for the review queue | new |
| `0011_roll_no_normalised_unique.sql` | `accounts_department_roll_key`: one roll number per department as a room reads it (trimmed, single-spaced, upper case). Not created, with a WARNING, while existing accounts clash; re-run once they are corrected | new |
| `0012_evidence_guards.sql` | Triggers: an answer's evidence is written once, `answer_reviews` is append-only, a review names its answer's room | new |
| `0013_question_provenance_and_approval.sql` | `questions.status` may be `draft`; `questions.model`, `source_ref`, `checks`, `created_by`, `approved_by`, `approved_at`; `contents.topic_slides`; their checks and indexes. Changes no row | new (Phase 2) |
| `0014_media.sql` | `media`, images uploaded for question stimuli (bytea, at most the server's limit); `sessions_content_idx`; trigger `media_bytes_written_once`. Changes no row | new (Phase 2) |
| `0015_room_question_sets.sql` | `sessions.question_ids` (nullable `uuid[]`): the only questions a room may serve, null for the whole approved bank; check `sessions_question_ids_shape`. Changes no row: every existing room gets null | new (Phase 2) |
| `0016_classes_roster_attendance.sql` | `classes`, `class_students` (the roster: a roll number and a name only), nullable `sessions.class_id`, `attendance` (one mark per room and roster student); trigger `attendance_student_in_room_class`. Changes no row: every existing room gets `class_id` null | new (Phase 3) |
| `0017_teacher_records.sql` | The teacher-record store: `observations` (append-only), `wheel_rounds`, `wheel_picks`, `hand_tallies`, `room_activities`, `insight_actions` (append-only); functions `teacher_records_guard`, `observations_in_room_class`, `room_activities_same_room`; nine triggers (one reuses `0016`'s `attendance_student_in_room_class`). Changes no row | new (Phase 3) |
| `0018_room_modes_and_projector.sql` | How a room runs: `sessions.mode`, `adapt`, `start_level`, `questions_per_student`, `time_per_question`, a Teacher-led room needs a class; `sessions.status` may be `waiting`; `projector_links` (a projector's token, kept as its SHA-256) with trigger `projector_links_keep` (`0017`'s guard). Changes no row: every existing room gets the values it ran under | new (Phase 3) |
| `0019_course_outcomes.sql` | `course_outcomes` (a class's outcomes, archived rather than deleted once evidence reaches them), `outcome_topics` (an outcome mapped to a topic of a chapter, with a weight), `question_outcome_overrides` (one question's outcomes in one class, or excluded); functions and triggers `question_outcome_overrides_in_class` and `course_outcomes_guard`. Changes no row and no existing table | new (Phase 4) |
| `0020_attainment_configs.sql` | `attainment_configs`: a class's attainment formula, one row per saved version (append-only; the highest is in force); function and trigger `attainment_configs_guard`. Changes no row and no existing table | new (Phase 4) |
| `0021_attendance_roll.sql` | `attendance.roll_no` (nullable text): the roll number an attendance mark was made under. No default, no check, no index, nothing backfilled; a mark from before it reads as null. Changes no row | new (Phase 4 review) |
| `0022_owner_decisions.sql` | The owner's decisions of 19 Nov 2026: `profiles.account_verified` and `answers.account_verified` (boolean, not null, default false: a link made by a signed-in phone, decision 7), `class_students.under_18` (boolean, not null, default false, decision 8), `questions.replaces_id` (nullable uuid, references `questions(id)` on delete set null, partial index `questions_replaces_idx`), and `questions_source_check` widened to `llm`, `fallback`, `teacher`. Every link made before it reads unverified; no row is rewritten (a professor's question stored as `fallback` stays so) | new (19 Nov 2026) |
| `0023_class_questions.sql` | Phase 5, class questions: the `class_questions` table (a class question's state, `revealed`, its times and the question as asked; one not closed per room, `class_questions_one_running`; RLS on) and `answers.class_question_id` (uuid, no foreign key) and `answers.round` (smallint, 1 or 2, set with `class_question_id` or not at all, `answers_round_check`), with a partial index on `class_question_id`. No check widened: confidence taps use `0008`'s spellings. No row rewritten | new (19 Nov 2026) |
| `0024_misconception_labels.sql` | Phase 5, misconception labels: `questions.misconceptions` (jsonb, not null, default `[]`), the labels on a question's wrong options, each `{option, label, provenance, addedAt, changedAt, by}`, with `questions_misconceptions_check` (an array of objects, each with text `option` and `label` and a `provenance` of `ai` or `professor`). No answer column: a label is matched to answers when a report runs. No row rewritten; every existing question reads as having none | new (19 Nov 2026) |

The SQL of every moved file is unchanged; only header comments were updated.

`0021` has run only on PGlite (`npm run migrations`, 573 of 573 on 19 November 2026;
the suite grew by 40 checks with it). It builds on a fresh database, runs again
unchanged (a mark's roll number survives the re-run), and upgrades a v1 database. The
checks read `attendance.roll_no` back as text, nullable, with no default; a join's
roll number and a teacher mark's read back; a mark with none reads as null; any text
the server accepted is taken (no shape check); correcting the roster's roll number
leaves the mark's as it was made. Applied over a database that already holds marks
(built up to `0020`), it changes no row: each reads back with no roll number. Apply it
before deploying the server (above).

`0020` has run only on PGlite (`npm run migrations`, 533 of 533 on 19 November 2026;
24 checks are new with it). It builds on a fresh database, runs again unchanged (also
over saved versions), and a v1 database is upgraded with the table empty. Its checks
refuse version 0, a config that is a JSON list, and one over 32 KB (23514); two rows of
one class with one version (23505); a class that does not exist (23503); and changing,
renumbering or deleting a saved version (23001). Deleting the account that saved a
version sets `created_by` null and keeps the version; deleting a class takes its
versions. Apply it before using the attainment routes; the server boots without it,
like `0019`.

`0019` has run only on PGlite (`npm run migrations`, 509 of 509 on 19 November 2026;
57 checks are new with it). It builds on a fresh database, runs again unchanged
(also over rows in all three tables), and a v1 database is upgraded with the three
tables empty. Its checks refuse a code in lower case, with a trailing space, with two
spaces or over 16 characters, a blank or over-long statement, a target level spelt
`analyze`, a position of 0, an outcome of a class that does not exist, a weight of 0 or
over 100, a topic with two spaces or blank, and an override that both maps and
excludes, does neither or holds a null (23514); a second outcome with a code in use, one
topic twice for an outcome and chapter in another case, and a second override for one
question (23505); a mapping whose class is not its outcome's, a chapter that does not
exist, an override naming another class's outcome or one that does not exist, deleting
an outcome an override names, and deleting a mapped chapter (23503); naming an outcome
twice (23514); moving an outcome to another class (23001). It accepts an archived
outcome's code for a new one and refuses restoring the old one over it; deleting an
outcome takes its mappings, and deleting a class its outcomes, mappings and overrides.
Apply it before using the outcome routes; the server boots without it.

`0018` has run only on PGlite (`npm run migrations`, 451 of 451 on 19 November 2026;
37 checks are new with it). It builds on a fresh database, runs again unchanged, and
a v1 database is upgraded with its room on Student devices, adapting, from
Understand, with no cap and no time, and its status kept. Its checks refuse a mode
outside the three, a Teacher-led room with no class, a start level spelt `analyze`, a
cap of 0 or 501, 5 or 601 seconds, and a status outside the four (23514); a second
link with one token (23505); a token hash that is not 64 lower-case hex characters, a
revoker with no revocation time (23514); and changing a link's token or room, or
deleting a link except with its room (23001), while letting a link be revoked. A room
can be created `waiting` and started into `open`. Deleting a room deletes its links.
Apply it before deploying the server that has the modes and the projector: the boot
probe now checks the five columns and `projector_links`.

**Re-running the whole set once a room is waiting (fixed).** `0005` drops and
re-adds `sessions_status_check`, and now lists `'waiting'` with `'open'`, `'paused'`
and `'closed'`, so a re-run never narrows the check below what `0018` allows. It was
reproduced on PGlite by the Phase 3 review. The migration test now leaves a room
waiting before it re-runs the set (failed before the change, passes after).

`0017` has run only on PGlite (`npm run migrations`, 414 of 414 on 19 November 2026;
88 checks are new with it). It builds on a fresh database, runs again unchanged, and
a v1 database is upgraded with empty record tables. Its checks refuse an observation
kind outside the four, a note over 280 characters, a cleared mark with a note, a class
with no roster student, a roll number not in the room's form, a student of another
class and a class that is not the room's (23503); a round below 1 and a round twice;
a pick in a round never started, in a place already taken, from an empty wheel, with
an ask outside the three, a question on a diagram ask, a status outside the six or a
response with no time, a student of another class; a tally count below 0 (on insert
and on update), three counts, a missing count, five labels, a correct option past D,
no question text, a tally twice in one place; groups on anything but a group
challenge, a tally on anything but a quick check or from another room, an activity
outside the five, an outcome over 280 characters; an insight action outside the two,
a blank flag or one with a control character. The guard refuses editing an
observation or an insight action, changing who a pick drew or from how many, a
round's number or a tally's place, and deleting any record except with its room
(23001), while letting a round's settings, a pick's ask and response, a tally's counts
and an activity's outcome change, and an account or question deleted clear its
column. Deleting a room deletes its records and leaves the roster. Apply it before
deploying the server that has the record routes: the boot probe now checks the six
tables.

`0016` has run only on PGlite (`npm run migrations`, 326 of 326 on 19 November 2026;
56 checks are new with it). It builds on a fresh database and runs again unchanged;
a v1 database is upgraded with its room opened for no class. Its checks refuse a
roll number not in the room's form or not a shape a phone can send (lower case, two
spaces, a trailing space, `#`, over 24 characters), a blank or over-long name, a
blank course name, a missing or over-long section, a status or source outside the
lists, a `joined` mark that is not present or names a marker, a mark for another
class's student, a mark in a room opened for no class, a second mark for one student
in one room, and deleting a roster row that has attendance. Apply it before deploying
the Phase 3 server: the boot probe now checks the three tables and `sessions.class_id`.

`0010` to `0015` have run only on PGlite (`npm run migrations`, 270 of 270 on
19 November 2026, rerun after the Phase 2 review fixes, and part of the 451 since).
`0010` to `0012` are committed with Phase 1 (`05daf56`), `0013` to `0015` with Phase
2 (`27559ca`), `0016` to `0018` with Phase 3 (`d162cc8`); `0019` to `0021` (Phase 4)
are not committed yet. The live project has been
unreachable since 18 November, so whether it has any of them could not be checked.
Apply them in order before deploying the Phase 1, 2 and 3 server: the boot probe falls back to the in-process store when `answer_reviews`,
any `0013` column, the `media` table or `sessions.question_ids` is missing (last
section).

What the migration test holds `0013` to `0015` to (the suite grew by 25, 24 and 17
checks with them). Each builds on a fresh database and runs again unchanged. A v1
database holding data is upgraded with every existing question still `active` and
nothing recorded on it, and every existing room's `question_ids` null. Each new
check constraint refuses what it should: a status outside the three, a non-object
`source_ref` or `topic_slides`, `checks` that are not an array, an approver with no
approval time, an SVG, a size or digest that does not match the bytes, a blank or
missing alt, and an empty, two-dimensional, null-holding or non-uuid set. The
`media` trigger refuses a change to an image's bytes, type or chapter (the three
tested; it covers size and digest too) while letting its alt change.

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
| `topic_slides` | jsonb | not null, default `{}`; must be an object (`contents_topic_slides_object`). Deck only: each extracted topic and the slide numbers it was read from, `{"<topic>": [3, 4]}` (`0013`) |

Written by: repo `createContent` from `routes/content.js` (upload; `topic_slides`
from `topicSlides()` in `services/extract.js`, since the deck itself is not kept)
and `seed.js`; `updateContent` (title, raw text, topics; never `topic_slides`, so a
topic renamed after upload loses its slides).

### questions (0000, 0001, 0013, 0022, 0024)

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
| `status` | text | not null, default `active`; `active`, `discarded` or (since `0013`) `draft` (`questions_status_check`). Only `active` is served |
| `source` | text | not null, default `llm`; `llm`, `fallback` or (since `0022`) `teacher`, a question a professor wrote in the bank (`questions_source_check`). A professor's question written before `0022` stays `fallback` |
| `payload` | jsonb | not null, default `{}`. Every `PAYLOAD_FIELDS` entry (answers included): teacher-only data. `stimulus` is here too: a passage (`text`, optional `sourceRef`) or an image (`url`, `alt`, optional `sourceRef`); an uploaded image's url is `/api/media/<id>` (`media`, `0014`). Hot text, dropdown, table and grid, generated since Phase 2, keep `tokens`, `blanks`, `columns`, `rows` and `answers` here, so they needed no migration. (The Mongo fallback's schema did drop them on save; fixed in `server/src/models/index.js`, not run against a Mongo database) |
| `created_at` | timestamptz | not null, default now() |
| `model` | text | null. The model id that wrote it, `offline-template` for the offline generator, null for a professor's own question **and every row older than `0013`** (`0013`) |
| `source_ref` | jsonb | null; an object when set (`questions_source_ref_object`). `{"kind": "slides", "slides": [3, 4]}`: the slides the topic was read from (`0013`) |
| `checks` | jsonb | null; an array when set (`questions_checks_array`). The rule checks, `[{id, ok, message}]`, advice only; null = never checked (`0013`) |
| `created_by` | uuid | null; references `accounts(id)` on delete set null. Who made the row; null on the shared key (`0013`) |
| `approved_by` | uuid | null; references `accounts(id)` on delete set null. Null on the shared key (`0013`) |
| `approved_at` | timestamptz | null. Set whenever `approved_by` is (`questions_approval_pair`) (`0013`) |
| `replaces_id` | uuid | null; references `questions(id)` on delete set null (`0022`). On a draft a plain regenerate wrote for an ACTIVE question: that question, which goes on serving until this draft is approved; the approval (any route that makes it active) sets it discarded. Partial index `questions_replaces_idx` where not null |
| `misconceptions` | jsonb | not null, default `[]` (`0024`). The misconception labels on the question's wrong options: `[{"option": "TCP", "label": "Thinks TCP is connectionless", "provenance": "ai" \| "professor", "addedAt", "changedAt", "by"}]`, one per labelled option, keyed by the option's **text** (`True` or `False` on a true/false question), so reordering options keeps each label on its option. `questions_misconceptions_check`: an array of objects, each with text `option` and `label` and a `provenance` of `ai` (the generator proposed it; an AI draft) or `professor` (written, edited or confirmed by the professor). The server holds the rest (`services/misconceptions.js`): only on a wrong option of an `mcq`, `multi` or `truefalse` question, at most 120 characters, no contact details. Staff-only: never sent to a phone or the projector, and left out of `answers.question_snapshot`. Changes no mark |

Indexes: `questions_content_idx`; partial `questions_active_idx` (`status =
'active'`, what a room reads); partial `questions_draft_idx` (`status = 'draft'`);
`questions_created_by_idx` and `questions_approved_by_idx` (where not null, for the
foreign keys).

Written by: repo `insertQuestions` from `routes/generate.js` (generation: every row
a `draft` with `model`, `source_ref`, `checks`, `created_by`) and `routes/bank.js`
(split and merge keep the parent's status and provenance, and a rejected draft's
halves or merge are drafts; regenerate and Harder/Easier write drafts;
write-your-own writes `active` with `model` null); `updateQuestion` from
`routes/bank.js` (edit, bulk discard, restore, retag, approve, approve-all,
reject); `deleteQuestions` from `routes/generate.js` (replace mode, which deletes
drafts too, and is refused while a room on the chapter is open or paused). Every way to `active` records an approval on model
output nobody approved (`approvePatch`, `activatePatch` in `services/edits.js`).
`0013` changed no row: every question already there kept its status.

`misconceptions` (`0024`) is written by `insertQuestions` with every question (empty
unless the model proposed labels, or a split or merge carried its parent's), and by
`updateQuestion` on its own from the label route (`PATCH
/api/bank/question/:id/misconceptions`), which changes no other column: a label edit
leaves the status, the approval and the checks as they were. An edit or a retag that
rewords or removes a labelled option, or makes it a right answer, writes the shorter
list with the edit. `0024` changed no row.

### sessions (0000, 0001, 0005, 0007, 0015, 0016, 0018)

A room.

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | primary key |
| `code` | text | not null, unique |
| `content_id` | uuid | not null, references `contents(id)` on delete cascade |
| `title` | text | not null, default `''` |
| `status` | text | not null, default `open`; `waiting` (`0018`: opened with a waiting room, nothing served until started), `open`, `paused`, `closed` |
| `owner_id` | uuid | null; references `accounts(id)`, no delete action |
| `started_at` | timestamptz | not null, default now() |
| `closed_at` | timestamptz | null |
| `paused_at` | timestamptz | null |
| `mastery_goal` | numeric(3,2) | not null, default 0.80; 0.80, 0.90 or 1.00 |
| `reattempts` | smallint | not null, default 0; 0 to 2 |
| `redemption` | boolean | not null, default false |
| `question_ids` | uuid[] | null. The room's question set: the only questions it may serve. Null is the whole approved bank, which every room before `0015` keeps. When set: one dimension, at least one id, no null (`sessions_question_ids_shape`). No foreign key (Postgres has none for array elements): the server checks each id is an approved question of the room's chapter when the room opens, and a question discarded or deleted later simply stops being served (`0015`) |
| `class_id` | uuid | null; references `classes(id)`, no delete action. The class the room was opened for; null for none, which every room before `0016` keeps and which behaves exactly as before. The server accepts only a class the caller may change (`0016`) |
| `mode` | text | not null, default `devices`; `devices`, `teacher-led`, `mixed`. A `teacher-led` room must have a `class_id` (`sessions_teacher_led_class_check`) (`0018`) |
| `adapt` | boolean | not null, default true. False: students stay at `start_level`; answers are recorded; the below-40% ceiling still applies (`0018`) |
| `start_level` | text | not null, default `understand`; one of the six levels (`0018`) |
| `questions_per_student` | smallint | null (no cap), or 1 to 500 (`0018`) |
| `time_per_question` | smallint | null (none), or 10 to 600 seconds. Sent to phones; no answer is refused for being late (`0018`) |

Written by: repo `createSession` from `routes/session.js` (the settings, the
question set, the class and how the room runs are written here only, never updated); `updateSession` (status, title,
closed/paused times; `waiting` to `open` by `POST /api/session/:code/start`); `deleteSession`. `question_ids` is read on every bank load of
the live loop (`servableFor` in `services/selector.js`) and by the image rule
(`servedToPhones`), and returned by `POST /api/session`, `GET /api/session` and
`GET /api/session/:code/items`, never by the phones' `GET /api/session/:code`.

Index `sessions_content_idx` on `content_id` (`0014`): `listSessionsForContent`,
which serving an image to a phone asks on every request (is a room running on this
chapter?), and the cascade from deleting a chapter. Partial index
`sessions_class_idx` on `class_id` where not null (`0016`): since the Phase 3 class
analytics also `listSessionsForClass` (a class's rooms, newest first,
`GET /api/classes/:id/analytics`). No column was added for it.

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
| `history` | jsonb | not null, default `[]`; one entry per finished question. Since Phase 5 (no migration) an entry whose answer moved the student, or held them at either end of the ladder, also carries `move`: `{ rule: 'promote'\|'demote'\|'band'\|'top'\|'floor', from, to, window, share, answers, reason }` (`moveRecord` in `services/mastery.js`). Staff-only: `reason` is the professor's sentence. Entries written before carry none |
| `served_id`, `served_at`, `served_why` | text, timestamptz, text | null; the pinned question |
| `served_tries` | smallint | not null, default 0 |
| `served_last` | text | null; a hash of the last submission, never the answer |
| `integrity` | jsonb | not null, default `[]`; append-only signals. Nothing is appended for a student their class roster marks under 18 (`0022`, decision 8) |
| `account_id` | uuid | null; references `accounts(id)` on delete set null |
| `updated_at` | timestamptz | not null, default now() |
| `account_verified` | boolean | not null, default false (`0022`). True only when `account_id` was linked because the phone presented that signed-in student's token at join (decision 7). Every link made before `0022`, from a typed roll number, reads false: kept, unverified, never read into the student's own history |

Written by: repo `saveProfile` (upsert on `session_id, roll_no`) from
`sockets/index.js`: join (including, since `0022`, the verified link a signed-in
phone's token makes; a typed roll number links nothing),
the pin, integrity signals, every answer; and from `POST /api/review/:answerId`,
which sets the reviewed mark on the matching `history` entry (marked `review`:
`confirmed` or `overridden`) and moves `levels` by the difference
(`applyReview` in `services/mastery.js`). Every one of these writes takes an
in-process per-student lock first (`lockProfile` in `sockets/index.js`), because
each reads the whole row and writes it back.

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
| `question_snapshot` | jsonb | not null, default `{}`; the question as answered, answer key included (teacher-only). Since `0013` it also carries the question's `model`, `sourceRef` and `createdBy`, but not its `checks`; rows stored before the Phase 2 review also carry `approvedBy`/`approvedAt`, which later rows leave out (they change without the question changing). Since the item statistics (Phase 2, no migration) it carries `shownOptions` when the fewer-choices support shortened an mcq or multi for that student: the original indices of the options shown, in shown order. Absent for a full list and on every older row |
| `response` | jsonb | null; what the student sent, never discarded |
| `attempt` | smallint | not null, default 1 |
| `final` | boolean | not null, default true; false for a wrong attempt followed by a retry |
| `correct` | boolean | null |
| `score` | numeric(4,3) | null |
| `detail` | text | not null, default `''` |
| `ungraded` | boolean | not null, default false (polls) |
| `language` | text | not null, default `en`. Written by the live loop as `'en'` on every answer and vote (`sockets/index.js`): no phone shows a translated question yet. Read since Phase 5 (no migration) by the item statistics' translation warning and the student card's language note (`services/honesty.js`) |
| `question_source` | text | not null, default `llm` |
| `served_at` | timestamptz | null |
| `answered_at` | timestamptz | not null, default now() |
| `review_status` | text | not null, default `auto`; `auto`, `provisional`, `confirmed`, `overridden` |
| `auto_correct`, `auto_score`, `auto_detail` | boolean, numeric(4,3), text | the machine's first assessment, never overwritten; `auto_detail` not null default `''` |
| `reviewed_by` | uuid | null; references `accounts(id)` on delete set null |
| `reviewed_at` | timestamptz | null |
| `review_note` | text | not null, default `''` |
| `confidence` | text | null; `sure`, `think`, `guess`. Written since Phase 5 (no migration): the phone's Sure, Think so and Guessing tap (`think_so` is stored as `think`, `guessing` as `guess`; `server/src/services/confidence.js`), null for no tap or one the server does not know. Information only: nothing that marks, moves a level or computes attainment reads it. Staff read it as counts |
| `account_verified` | boolean | not null, default false (`0022`). True only when the phone that sent the answer was signed in as the account in `account_id` (decision 7). A student's own history reads only these rows. Written once: `0012`'s guard allows no change to it |
| `class_question_id` | uuid | null (`0023`); the class question a vote was given in. No foreign key: a room's class questions and answers are deleted together (both cascade from `sessions`), and an `on delete set null` would trip `0012`'s guard. Written once |
| `round` | smallint | null (`0023`); 1, or 2 for the re-vote after discussion. Set with `class_question_id` or not at all (`answers_round_check`). Written once |

Indexes: unique `(session_id, answer_key)`; `session_id`; `(session_id, roll_no)`;
`account_id`; `question_id`; partial on `class_question_id` where not null (`0023`);
partial on `review_status` where `provisional`;
`answers_open_queue_idx` on `(session_id, answered_at desc)` where `kind = 'open'`
and `final` (`0010`, for the review queue).

Written by: repo `recordAnswer` from `sockets/index.js` (`handleAnswer`: final
answers, wrong attempts before a retry, polls; since Phase 5 `handleVote`: every vote
in a class question, with its round, `final` true for the vote in force and false for
one that came after its round closed, and, since the Phase 5 review fixes, one sent for
a round not yet open, one sent while the room was paused, and one from a phone not
signed in after the signed-in student's own phone voted in that round, each with a
`detail` saying why; and `handleAnswer` again for an answer a phone sent to a class
question as its own question afterwards, kept with the class question, `final` false).
A vote a phone replaces in the same round is set `final` false by `updateAnswer`, the
one change a vote takes. A vote's key sent through `student:answer` is never answered
from the vote: the answer is filed under `<key>@<roll number>`, as for another
student's key. A 23505 on the unique key returns
the stored row instead of a second one. `answer_key` is the phone's key; a phone
that sends none gets `legacy-<roll number>-<question id>-<answer hash>`, and a key
already held by another student's row is filed as `<key>@<roll number>`, so no
two students ever share one row. `updateAnswer` changes review fields only
(`correct`, `score`, `review_status`, `reviewed_by`, `reviewed_at`, `review_note`,
`final`); its one caller is `POST /api/review/:answerId` (`routes/review.js`).
Since `0012` the database refuses any other change too (`answers_evidence_written_once`,
SQLSTATE 23001): the response, the snapshot, `auto_*`, the room, the student, the
key and the time are written once. `question_id` and `account_id` may still change
(the foreign keys clear them).

Read by repo `listAnswers`, whose filters are ANDed: `sessionId` / `sessionIds`,
`rollNo`, `accountId`, `reviewStatus`, `kind`, `final`, `topic`, `bloom`,
`classQuestionId` (one class question's votes) and `classVotes: false` (no vote at all,
`class_question_id is null`; Phase 5: the topic report, item statistics, class
analytics, the student card and a student's own history read this way),
`student: { accountId, rollNo }`, which matches `account_id` = that account OR
(`roll_no` = that roll number AND `account_id` is null), and `before: { answeredAt,
id }`, a page cursor: rows earlier than it in `(answered_at, id)` order. A row
linked to a different account is never matched by its roll number. Readers
(`services/evidence.js` builds every item; request and response shapes in
`docs/API.md`):
- `GET /api/review?code=&status=&limit=&before=`: the queue, final written answers,
  newest first. Paged by cursor: each page's `next` goes back as `before`.
  `offset` is refused (400), because reviewing an answer takes it out of the
  default view and an offset then skips answers.
- `GET /api/analytics/:id/answers`: one student's answers across the rooms their
  professor owns, newest first, paged. A student calling it for themself gets only
  the rows linked to their account (an unlinked row under their roll number may
  have been typed by anyone), each through `redactForStudent`: the question as
  shown (rebuilt from the snapshot by `forStudent()`, the phone's own function),
  their response, the mark in force, the review status and the professor's note;
  never the snapshot, `auto_*`, `detail` or any answer key. A professor gets the
  full row, matched by account or by unlinked roll number.
- `GET /api/analytics/:id` (the student detail's `topicLevels` and `topics`) and
  `GET /api/session/:code/topics`: per topic × per level from final, graded rows
  (`final` and not `ungraded`). History entries with no `answerId` predate this
  table and are counted from `profiles.history` instead; the reply's `source` says
  `answers`, `history`, `mixed` or `none`.
- `GET /api/session/:code/answers`: every row in one room, full snapshot, paged.
- `GET /api/session/:code/items` and `GET /api/bank/:contentId/stats` (Phase 2):
  item statistics from final, graded rows of one room, or of every room on a
  chapter the caller may read (`services/itemStats.js`), each response read back in
  the question's own option order through the student's seed and `shownOptions`.
  They read whole rooms in pages of 1000 (`allAnswers`, `final` filter), using
  `answers_session_idx`; no index was added.

No index was added for these: the student query uses `answers_account_idx` and
`answers_session_roll_idx`, and the room query `answers_session_idx`.

Deleting a room deletes its answers (cascade), but only after the server has
written the whole room to `room_archives` (below): `DELETE /api/session/:code`
archives first and deletes nothing if that write fails. While it runs the room is
held (`holdRoomForDelete` in `sockets/index.js`): a live answer, a signal or a
review sent then is refused (a review with 409), and one already under way is
waited for, so nothing lands between the archive and the delete. Deleting a
question keeps answers, with `question_id` cleared and the snapshot intact.

### answer_reviews (0010)

One row per professor review decision on an answer. Append-only: the server only
inserts (repo `addAnswerReview`), so a later decision never erases an earlier one,
and since `0012` the database enforces it whoever asks: any UPDATE is refused
except `reviewed_by` cleared when the reviewer's account is deleted, a DELETE is
refused except the cascade from its answer or its room, and a row whose
`session_id` is not its answer's room is refused (23503).
The decision in force is also on the answer row (`correct`, `score`,
`review_status`, `reviewed_*`, `review_note`); this table keeps every one before it.

The `note` is not private: the student reads it, word for word, beside the mark in
their own answer history (`redactForStudent`). A screen that takes a note must say
so.

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | primary key, `gen_random_uuid()` |
| `answer_id` | uuid | not null, references `answers(id)` on delete cascade |
| `session_id` | uuid | not null, references `sessions(id)` on delete cascade |
| `decision` | text | not null; `confirm` or `override` (`answer_reviews_decision_check`) |
| `correct` | boolean | not null; the mark the decision put in force (for `confirm`, the machine's, copied) |
| `score` | numeric(4,3) | not null; 0 to 1 (`answer_reviews_score_check`) |
| `note` | text | not null, default `''`; at most 1000 characters (`answer_reviews_note_check`) |
| `reviewed_by` | uuid | null; references `accounts(id)` on delete set null. Null on the shared-key path |
| `reviewed_at` | timestamptz | not null, default now() |

Indexes: `(answer_id, reviewed_at)`; `session_id`; `reviewed_by`. RLS on, no
policies.

Written by: repo `addAnswerReview` from `POST /api/review/:answerId`. Read by
`listAnswerReviews` (`GET /api/review/:answerId`, the POST's reply, and the room
archive). Deleting a room deletes its reviews (cascade), after the server has
written them into the room's archive.

### room_archives (0009)

One row per deleted room: the room, every student's profile and history, every
stored answer with the question as shown, and every review decision, as one
compact JSON document. The owner's
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
it), the student once (answers and history point at them), review decisions
pointing at their answer (`reviews`, added after v1 shipped; an archive without the
table had no reviews, so the version stays 1), and times as offsets from
`timeBase`. Since Phase 3 a room opened for a class carries `classId` (a room with no
class has no `classId` key, so it archives byte for byte as before; it decodes as null),
and a room opened for a class carries an `attendance` table: every mark, with the
roll number and name its roster row held when the room was deleted, since the roster
outlives the room (`server/test/roster.test.js`, `server/scripts/roster.mjs`). Since
`0021` each mark also carries `markedRollNo`, the roll number the mark itself was made
under (null for a mark from before `0021`, and in an older archive). An archive from
before decodes with `classId` null and no marks, so the version stays 1.
A room with teacher records (`0017`) also carries `observations` (every set and
clear), `wheelRounds`, `wheelPicks`, `tallies`, `activities` and `insightActions`,
each only when it has any, a roster student's name copied in; without them the
archive is exactly what it was, and an older one decodes with empty lists
(`server/test/records.test.js`, `server/scripts/records.mjs`). They count towards the
1 MiB; a class of 60 with a mark each, 40 picks, 10 tallies, 5 group challenges and
10 insight actions adds about 28 KB.
`room.settings` gains `mode`, `adapt`, `startLevel`, `questionsPerStudent` and
`timePerQuestion` (`0018`) only where the room changed them from how every room ran
before, so a room on the defaults archives exactly as it did; a missing one ran on
its default (`server/test/modes.test.js`). A room's projector links are not archived.
A column is left out only when every row rebuilds it exactly; `derived`
names those columns. Measured: a class of 60 students with 30 answers each is about
267 KB; 80 students with 60 answers each, a third of them written, about 693 KB.
`decodeRoomArchive()` gives back every answer and history entry field for field
(tested in `server/test/archive.test.js`).

Read by `GET /api/session/archives` (list, no data) and
`GET /api/session/archives/:id` (the `.json` file), both under the same ownership
rule as rooms.

Since `0022` a class room's archive keeps no integrity signal of a student the roster
marks under 18 when the room is deleted (decision 8). Since the Phase 5 review fixes
the file is also **served** without the signals of a student the roster marks under
18 now (`servedArchive` in `services/archive.js`), so a mark set after the delete, or
an archive written before `0022`, still hides them; the stored row is not rewritten.
Since `0023` an archive carries `classQuestions` (each class question's state,
`revealed`, times and the question as asked) and keeps every vote among its answers.

### media (0014)

One image a professor uploaded to hang a question off, served at
`/api/media/<id>` (`server/src/routes/media.js`; the rule for who may load it is
`servedToPhones` in `server/src/services/media.js`, and `docs/API.md` says it in
full). The bytes are in the row, so all three stores take uploads with no new
service.

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | primary key, `gen_random_uuid()`. Random on purpose: a phone loads an image by its url alone |
| `owner_id` | uuid | null; references `accounts(id)` on delete set null. Who uploaded it; null on the shared key. Who may read it is decided by the chapter's owner |
| `content_id` | uuid | not null, references `contents(id)` on delete cascade. A question may only show an image of its own chapter |
| `mime` | text | not null; `image/png`, `image/jpeg` or `image/webp` (`media_mime_check`), as the bytes' signature says |
| `bytes` | integer | not null; above 0 and equal to `octet_length(data)` (`media_bytes_check`). The ceiling is the server's (`config.media.maxBytes`, 500 KB by default), not repeated here |
| `sha256` | text | not null; the hex SHA-256 of `data`, and must be (`media_sha256_check`). The ETag phones cache under |
| `data` | bytea | not null. PostgREST reads and writes it as text, `\x` and hex; the repo converts. The upload with its metadata (Exif, XMP, text chunks, comments) taken out by the server before it is written, the JPEG orientation kept; rows written before that change hold the bytes as sent |
| `alt` | text | not null and not blank (`media_alt_check`). Copied onto a question that shows the image with no alt text of its own |
| `created_at` | timestamptz | not null, default now() |

Indexes: `media_content_idx` (`content_id`); `media_owner_idx` (`owner_id`, where
not null, for the foreign key). RLS on, no policies.

Trigger `media_bytes_written_once` (function `media_bytes_written_once()`), `before
update`: refuses (23001) any change to `data`, `mime`, `bytes`, `sha256` or
`content_id`, from any connection. Phones cache an image under its url for a year,
so the bytes under a url must never change; a new picture is a new upload. `alt`
may change, and `owner_id` is cleared when the uploader's account is deleted.

Written by: repo `createMedia` from `POST /api/media` only. There is no update or
delete in the server. Read by `getMedia` (without `data` for the permission
checks, with it to serve the bytes) from `GET /api/media/:id`, and from
`withUpload` when a question is given an image stimulus (`routes/bank.js`).
Deleting a chapter deletes its images (cascade); no route deletes a chapter today.

Questions refer to an image by its url in `questions.payload.stimulus.url`
(`/api/media/<id>`), not by a foreign key: the stimulus lives in the payload like
every other kind-specific field, and an answer's `question_snapshot` keeps the url
as it was shown.

### classes (0016)

A professor's class: a course and a section, with a roster (`class_students`).

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | primary key, `gen_random_uuid()` |
| `owner_id` | uuid | null; references `accounts(id)`, no delete action. The professor; null on the shared key, which is then the only path that reaches it (`ownership.js`, as for `contents`) |
| `course_name` | text | not null; 1 to 120 characters once trimmed (`classes_course_name_check`) |
| `section` | text | not null; 1 to 40 characters once trimmed (`classes_section_check`), such as `TY-CSF B` |
| `term_label` | text | not null, default `''`; at most 40 characters (`classes_term_label_check`) |
| `created_at`, `updated_at` | timestamptz | not null, default now(); no trigger maintains `updated_at`, the repo sets it |

Index `classes_owner_idx`. RLS on, no policies. Written by repo `createClass` and
`updateClass` from `routes/classes.js`; no route deletes a class. The server refuses
a course name, section or term holding an email address or a mobile number
(`withoutContact` in `services/roster.js`); the database does not check that.

### class_students (0016)

A class's roster. **A roll number and a name, and nothing else** but the owner's
yes-or-no under-18 mark (`0022`, decision 8): no phone number, email, date of birth
or photo. `server/scripts/migrations.mjs` fails if a column is added here, so that
adding one is a decision; `under_18` was one (19 Nov 2026).

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | primary key |
| `class_id` | uuid | not null, references `classes(id)` on delete cascade |
| `roll_no` | text | not null. In the room's form, trimmed, single-spaced, upper case, and a shape a phone can join with: `^[A-Z0-9][A-Z0-9 ._/-]{0,23}$` (`class_students_roll_check`, `ROLL_SHAPE` in `services/roster.js`, which the live loop imports). Unique per class (`class_students_class_roll_key`): one roll number is one student. `03` and `3` are two roll numbers, as they are to a room |
| `name` | text | not null; 1 to 80 characters once trimmed (`class_students_name_check`). The server also refuses a name holding an `@`, six or more digits, or a short date such as `12-5-04` (a date of birth) |
| `added_at` | timestamptz | not null, default now() |
| `removed_at` | timestamptz | null. Set when a student is taken off the roster. **Never deleted**: their answers live under their roll number in each room, and their attendance points here |
| `under_18` | boolean | not null, default false (`0022`). The owner's optional mark (decision 8): integrity signals are neither recorded nor shown for a room profile tied to this student in the class's rooms. A yes or no only; no date of birth. Not a legal determination |

Written by repo `addClassStudents` (`insert ... on conflict (class_id, roll_no) do
nothing`, so only the rows added come back; `under_18` as the list or the CSV says,
else false) and `updateClassStudent` (name, roll number, `removed_at`, `under_18`)
from `routes/classes.js`. Read whole by `listClassStudents`,
which on Supabase asks for `.limit(5000)` in one request; PostgREST's `max-rows`
caps a response whatever is asked (1000 by default), so a roster over that many rows,
removed ones included, would be read short (open, `docs/API.md`; `listAttendance`
reads a room's marks the same way).

### attendance (0016)

One mark per room and roster student. A student with no row is **unmarked**, which
is not absent.

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | primary key |
| `session_id` | uuid | not null, references `sessions(id)` on delete cascade. The server writes the room's attendance into its archive (`room_archives`) first |
| `class_student_id` | uuid | not null, references `class_students(id)`, no delete action: a roster row with marks is removed, never deleted |
| `status` | text | not null; `present`, `absent` or `late` (`attendance_status_check`) |
| `source` | text | not null; `joined` (a phone joined with that roll number; the server marked it) or `teacher` (`attendance_source_check`). A `joined` row is always `present` with no `marked_by` (`attendance_joined_check`). A typed roll number is not proof of identity (decision 7's known gap) |
| `marked_at` | timestamptz | not null, default now() |
| `marked_by` | uuid | null; references `accounts(id)` on delete set null. The professor; null for a join and on the shared key |
| `roll_no` | text | null; no default, no check (`0021`). The roll number the mark was made under, in the room's form: for a `joined` mark the one the phone joined with; for a `teacher` mark the student's roll number on the roster at that moment, unless the mark it replaces already carries one, which is kept (`markRollNo` in `services/roster.js`). Null for a mark made before `0021`. The attainment reports give a room's answers given under it to this mark's student, whatever the roster holds now; a roll number two marks of one room carry is tied to neither |

Unique `(session_id, class_student_id)` (`attendance_session_student_key`), also
the index for reading a room's marks. Indexes `attendance_student_idx` and
`attendance_marker_idx` (where not null) for the foreign keys.

Trigger `attendance_student_in_room_class` (function of the same name), `before
insert or update of session_id, class_student_id`: refuses (23503) a mark for a
student who is not on the roster of the class the room was opened for, including in
a room opened for no class.

Written by repo `addAttendanceIfAbsent` (`on conflict do nothing`: a join, which
never replaces a mark already there) from the live loop's join, and
`saveAttendance` (`on conflict ... do update`: the professor's mark replaces
whatever was there) from `POST /api/session/:code/attendance`, and from a wheel pick
set to Absent (`PATCH /api/session/:code/wheel/picks/:pickId`, unless
`markAttendance: false`). Both send `roll_no` since `0021`. Read by
`GET /api/session/:code/attendance` (which does not show `roll_no`), the teacher's
grid (present count), the wheel and the tally (who is present), the attainment
reports and the register (whose each room's answers are), and the room archive.

### The teacher-record store (0017)

Six tables, each a room's record (`session_id` not null, `on delete cascade`: they go
with the room, after the server has written them into its archive). Staff-only:
nothing in them reaches a phone or the projector, and the Bloom-level ladder reads
none of them. RLS on, no policies, on all six.

**One guard for all six**, function `teacher_records_guard()`, `before update or
delete`, with the columns that may change as the trigger's arguments: a DELETE only
inside a foreign key's action (`pg_trigger_depth() > 1`, the cascade from the room);
an UPDATE only of the named columns, and inside a foreign key's action a column set
to null (an account or a question deleted). Anything else is refused with 23001,
whoever sends it.

#### observations

A professor's private mark on a student. **Append-only** (guard with no columns):
setting a mark is a row, and so is clearing it (`kind` null). The mark in force for a
student on a day is the latest row; "one per student per class per day" is the
server's rule of reading (`services/records.js`).

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | primary key |
| `session_id` | uuid | not null, references `sessions(id)` on delete cascade. The room it was written in |
| `class_id` | uuid | null; references `classes(id)`, no delete action. The room's class (trigger `observations_in_room_class`), null for a room with no class |
| `class_student_id` | uuid | null; references `class_students(id)`, no delete action (a roster row with records is removed, never deleted). Null exactly when `class_id` is (`observations_subject_check`); on the room's class's roster (the trigger) |
| `roll_no` | text | not null; the room's form (`observations_roll_check`, as `class_students_roll_check`). The roll number at the time; the key in a room with no class |
| `day` | date | not null. The day the room was opened, in India's time (`roomDay`) |
| `kind` | text | null (a clear) or `understood`, `participated`, `revision`, `support` (`observations_kind_check`) |
| `note` | text | not null, default `''`; at most 280 characters, and `''` on a clear (`observations_note_check`). The server also refuses an email address or a mobile number |
| `observed_by` | uuid | null; references `accounts(id)` on delete set null |
| `observed_at` | timestamptz | not null, default now(). The server writes each strictly after the last of that student's day |

Indexes: `observations_session_idx` (`session_id`), `observations_class_day_idx`
(`class_id, day`), `observations_student_idx` (`class_student_id, day`),
`observations_observer_idx` (`observed_by`); the last three where not null.

#### wheel_rounds

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | primary key |
| `session_id` | uuid | not null, references `sessions(id)` on delete cascade |
| `round` | integer | not null, at least 1. Unique with `session_id` (`wheel_rounds_session_round_key`) |
| `present_only`, `no_repeat` | boolean | not null, default true. The only columns that may change |
| `started_at` | timestamptz | not null, default now() |
| `started_by` | uuid | null; references `accounts(id)` on delete set null |

#### wheel_picks

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | primary key |
| `session_id`, `round` | uuid, integer | not null; `(session_id, round)` references `wheel_rounds` on delete cascade (`wheel_picks_round_fkey`) |
| `pick_order` | integer | not null, at least 1; unique with `(session_id, round)` (`wheel_picks_session_round_order_key`) |
| `roll_no` | text | not null; the room's form (`wheel_picks_roll_check`) |
| `class_student_id` | uuid | null; references `class_students(id)`, no delete action; on the room's class's roster (trigger `wheel_picks_student_in_room_class`, `0016`'s function) |
| `pool_size` | integer | not null, at least 1. How many were on the wheel: each had 1 in `pool_size` |
| `present_only`, `no_repeat` | boolean | not null. The settings it was drawn under |
| `ask` | text | not null, default `bank`; `bank`, `diagram` or `demo`, and `question_id` only on `bank` (`wheel_picks_ask_check`) |
| `question_id` | uuid | null; references `questions(id)` on delete set null |
| `status` | text | not null, default `pending`; `pending`, `answered`, `passed`, `help`, `skipped` or `absent`, and `status_at` set exactly when it is not pending (`wheel_picks_status_check`) |
| `picked_at` | timestamptz | not null, default now() |
| `picked_by`, `status_by` | uuid | null; reference `accounts(id)` on delete set null |
| `status_at` | timestamptz | null |

Only `ask`, `question_id`, `status`, `status_at` and `status_by` may change (trigger
`wheel_picks_keep_draw`): who was drawn, in which round and place, from how many and
under which settings is written once.

#### hand_tallies

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | primary key |
| `session_id` | uuid | not null, references `sessions(id)` on delete cascade |
| `seq` | integer | not null, at least 1; unique with `session_id`: the order asked |
| `question_id` | uuid | null; references `questions(id)` on delete set null. A question of the room's bank |
| `question_text` | text | not null, 1 to 1000 characters once trimmed. Always stored, from the bank when a question is named |
| `option_labels` | text[] | not null, default four `''`; exactly four, none null (`hand_tallies_labels_check`) |
| `counts` | integer[] | not null, default `{0,0,0,0}`; exactly four, none null, **none below 0** (`hand_tallies_counts_check`) |
| `revealed` | boolean | not null, default false |
| `correct_option` | smallint | null, or 0 to 3 |
| `created_at`, `updated_at` | timestamptz | not null, default now() |
| `created_by` | uuid | null; references `accounts(id)` on delete set null |

`seq`, `created_at` and `created_by` are written once (trigger `hand_tallies_keep_history`).
The server refuses a typed question or label holding an email address or a mobile
number (a bank question's own text and options are not screened); the database does
not check that.

#### room_activities

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | primary key |
| `session_id` | uuid | not null, references `sessions(id)` on delete cascade |
| `seq` | integer | not null, at least 1; unique with `session_id` |
| `kind` | text | not null; `check`, `think`, `group`, `diagram` or `real` |
| `outcome` | text | not null, default `''`; at most 280 characters |
| `groups` | jsonb | not null, default `[]`; an array of at most 100, and `[]` unless `kind` is `group` (`room_activities_groups_check`). `[{ label, gotIt }]`: groups, never students |
| `tally_id` | uuid | null; references `hand_tallies(id)` on delete set null; only on a `check` (`room_activities_tally_check`), and a tally of the same room (trigger `room_activities_same_room`, 23503) |
| `created_at`, `updated_at` | timestamptz | not null, default now() |
| `created_by` | uuid | null; references `accounts(id)` on delete set null |

Only `outcome`, `groups`, `tally_id` and `updated_at` may change (trigger
`room_activities_keep_history`). The server keeps a group's label to 40 characters,
each label once, and refuses one holding an email address or a mobile number.

#### insight_actions

**Append-only** (guard with no columns): a professor dismissed or acted on a flag.

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | primary key |
| `session_id` | uuid | not null, references `sessions(id)` on delete cascade |
| `flag_id` | text | not null; 1 to 120 characters once trimmed, no control characters. The Insights code's own id for the flag: since the live insights, an insight card's `flagId`, `<kind>:<evidence key>` (`focus:analyse`, `support:<16 hex>`, `participation:<16 hex>`; `services/insights.js`). Since the Phase 3 review the server takes only that shape, `^(focus\|support\|participation):[a-z0-9-]{1,64}$`, so no free text about a student rides in on a flag id; the database still allows any 1 to 120 characters. A card is dismissed while the latest row for its current id says `dismissed` |
| `action` | text | not null; `dismissed` or `acted` |
| `note` | text | not null, default `''`; at most 280 characters |
| `acted_by` | uuid | null; references `accounts(id)` on delete set null |
| `acted_at` | timestamptz | not null, default now() |

Index `insight_actions_session_idx` (`session_id, acted_at`).

All six are written by the repo methods `addObservation`, `addWheelRound`,
`updateWheelRound`, `addWheelPick`, `updateWheelPick`, `addTally`, `updateTally`,
`addActivity`, `updateActivity` and `addInsightAction`, from `routes/records.js`
only, and read by the matching `list*` methods there, by
`GET /api/classes/:id/students/:studentId/observations`, and by the room archive.
Every foreign key to an account, a question, a class student and a tally has its own
partial index.

### class_questions (0023)

A class question: one approved bank question the room's owner put to every phone in a
room (Phase 5). State only: its votes are `answers` rows (`class_question_id`,
`round`), which are the evidence. RLS on, no policies.

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | primary key |
| `session_id` | uuid | not null; references `sessions(id)` on delete cascade |
| `seq` | integer | not null, at least 1; its place among the room's class questions; unique with `session_id` (`class_questions_session_seq_key`) |
| `question_id` | uuid | null; references `questions(id)` on delete set null |
| `question_snapshot` | jsonb | not null; the question as asked, answer key included (staff-only, like `answers.question_snapshot`). Every vote is marked against this, not the bank's row |
| `state` | text | not null, default `open`; `open` (round 1), `paused` (round 1 closed, discussion), `revote` (round 2), `closed` (`class_questions_state_check`) |
| `revealed` | boolean | not null, default false; true only once closed (`class_questions_revealed_check`) |
| `started_at` | timestamptz | not null, default now() |
| `started_by`, `closed_by` | uuid | null; reference `accounts(id)` on delete set null |
| `paused_at`, `revote_at`, `closed_at` | timestamptz | null until it gets there |

Indexes: `class_questions_one_running`, unique on `session_id` where `state <> 'closed'`
(one running per room); `question_id`, `started_by` and `closed_by` where not null.

Written by the repo methods `addClassQuestion` and `updateClassQuestion` (which
changes `state`, `revealed`, `paused_at`, `revote_at`, `closed_at` and `closed_by`
only) from `sockets/index.js` (`startClassQuestion`, `changeClassQuestion`,
`closeClassQuestionWithRoom`), each under the room's `#class` lock. Read by
`getClassQuestion` and `listClassQuestions`: the live loop's bank leaves out every
question a room has asked to the class, a phone's join sends the running one, and the
staff routes and the projector read the votes beside it. A deleted room's archive keeps
its class questions (`classQuestions`, the question as asked by position) and every
vote. Not guarded by a trigger: it holds where a class question stands, and the
evidence is in `answers`, which `0012` guards.

### projector_links (0018)

A read-only link for a classroom projector, one room each. The projector is often a
second machine with nobody signed in, so it connects over the socket with the
link's token (`projector:watch`) instead of a professor's credentials. Not evidence,
and not archived: a room's links are deleted with it. RLS on, no policies.

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | primary key |
| `session_id` | uuid | not null; references `sessions(id)` on delete cascade |
| `token_hash` | text | not null, unique (`projector_links_token_hash_key`, also the lookup index); 64 lower-case hex characters. The SHA-256 of the token; the token itself (32 random bytes, base64url) is handed to the professor once and stored nowhere |
| `created_at` | timestamptz | not null, default now(). The link works for 12 hours from this (the server's `PROJECTOR_LINK_HOURS`; no column) |
| `created_by` | uuid | null; references `accounts(id)` on delete set null |
| `revoked_at` | timestamptz | null: the link works (while its room is not closed and it is under 12 hours old) |
| `revoked_by` | uuid | null; references `accounts(id)` on delete set null; only with `revoked_at` (`projector_links_revoked_check`) |

Trigger `projector_links_keep` is `0017`'s `teacher_records_guard('revoked_at',
'revoked_by')`: only the revocation may change, and a link is deleted only with its
room. Indexes on `session_id`, and on `created_by` and `revoked_by` where not null.

Written by the repo methods `addProjectorLink` and `revokeProjectorLink` from
`routes/projector.js`; read by `getProjectorLinkByHash` (the projector's socket,
`services/projector.js`) and `listProjectorLinks`. The server checks on every
connection that the link is not revoked, is under 12 hours old and its room is not
closed. What the
projector shows is held in the server's memory, not here.

### Course outcomes (0019)

Three tables: a class's outcomes, what each is mapped to, and per-question
overrides. Staff-only; nothing in them is about a student. **No answer, question or
room stores an outcome**: an answer is traced to its outcomes when a report runs,
from the question id, chapter and topic it already carries (`resolveAnswer` in
`server/src/services/outcomes.js`). So a room's archive (`room_archives`) carries
none of this, and deleting a room changes none of it. RLS on, no policies, on all
three.

#### course_outcomes

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | primary key. Unique with `class_id` too (`course_outcomes_id_class_key`), the target of `outcome_topics`' foreign key |
| `class_id` | uuid | not null; references `classes(id)` on delete cascade. Outcomes belong to a class (a course and a section): attainment is per class, and a second section copies them |
| `code` | text | not null; trimmed, single-spaced, upper case, `^[A-Z0-9][A-Z0-9 ._/-]{0,15}$` (`course_outcomes_code_check`). One per class among outcomes not archived (`course_outcomes_class_code_key`, a partial unique index), so an archived CO3 leaves the code free |
| `statement` | text | not null; 1 to 300 characters once trimmed (`course_outcomes_statement_check`). The server also refuses one holding an email address or a mobile number |
| `target_level` | text | null, or one of the six levels in British spelling (`course_outcomes_target_level_check`) |
| `position` | integer | not null, default 1, at least 1 (`course_outcomes_position_check`). The class's order; not unique (a reorder writes row by row), ties broken by `created_at` |
| `created_at`, `updated_at` | timestamptz | not null, default now(); no trigger maintains `updated_at`, the repo sets it |
| `archived_at` | timestamptz | null: in use. Set instead of deleting once evidence reaches the outcome: its mappings stay, evidence still reaches it, reports still name it |

Index `course_outcomes_class_idx` on `(class_id, position)`. Trigger
`course_outcomes_guard` (function of the same name), `before update of class_id or
delete`: an outcome cannot move to another class (23001), and is not deleted while an
override names it (23503), except inside the cascade from deleting its class.

#### outcome_topics

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | primary key |
| `outcome_id`, `class_id` | uuid | not null; together reference `course_outcomes(id, class_id)` on delete cascade (`outcome_topics_outcome_fkey`), so a mapping is always its outcome's class's |
| `content_id` | uuid | not null; references `contents(id)`, no delete action: a mapped chapter is not deleted out from under the mapping |
| `topic` | text | not null; 1 to 160 characters, trimmed and single-spaced (`outcome_topics_topic_check`), as the chapter spells it |
| `weight` | numeric(6,3) | not null, default 1; above 0 and at most 100 (`outcome_topics_weight_check`). How much that topic's evidence counts beside the outcome's other topics; read back as a number |
| `created_at` | timestamptz | not null, default now() |

Unique `(outcome_id, content_id, lower(topic))` (`outcome_topics_outcome_topic_key`):
a topic once per chapter per outcome, compared in lower case as the server compares
topics. Indexes on `class_id` and `content_id`.

#### question_outcome_overrides

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | primary key |
| `class_id` | uuid | not null; references `classes(id)` on delete cascade |
| `question_id` | uuid | not null. **No foreign key**, on purpose: an answer keeps its question's id in its snapshot after the question is deleted (`0008` sets `answers.question_id` null), and the decision still applies to the answers given to it |
| `outcome_ids` | uuid[] | not null, default `{}`; every id an outcome of `class_id`, each once (trigger `question_outcome_overrides_in_class`, 23503 / 23514) |
| `excluded` | boolean | not null, default false. Excluded with no outcomes, or mapped to 1 to 50 with no null (`question_outcome_overrides_shape`) |
| `updated_at` | timestamptz | not null, default now() |
| `updated_by` | uuid | null; references `accounts(id)` on delete set null |

Unique `(class_id, question_id)` (`question_outcome_overrides_class_question_key`),
what the repo upserts on. Index on `updated_by` where not null.

Written by the repo methods `createOutcome`, `updateOutcome`, `deleteOutcome`,
`setOutcomeTopics` (a read, then updates, inserts and deletes: not one statement),
`setQuestionOverride` (`on conflict (class_id, question_id) do update`) and
`deleteQuestionOverride`, from `routes/outcomes.js`; read by `listOutcomes`,
`getOutcome`, `listOutcomeTopics` and `listQuestionOverrides`, each paged like the
teacher records. The boot probe does not check these tables, on purpose (a server
deployed before `0019` keeps its rooms on Supabase; only the outcome routes fail).

### attainment_configs (0020)

A class's attainment formula, one row per saved version. The formula is data, not
code: colleges compute attainment by their own rules, so the server validates a
formula (`validateConfig` in `server/src/services/attainment.js`) and stores it per
class, and every attainment report states the version it used. Named examples ship
as data in `server/src/services/attainmentPresets.js`; a class with no row uses the
default example, and its reports say so. Staff-only; nothing here is about a
student. RLS on, no policies.

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | primary key |
| `class_id` | uuid | not null; references `classes(id)` on delete cascade |
| `version` | integer | not null, at least 1 (`attainment_configs_version_check`). 1, 2, 3 ... per class; the highest is in force. Unique with `class_id` (`attainment_configs_class_version_key`), so two saves racing for one number are a 23505 (the repo's 409) |
| `config` | jsonb | not null; a JSON object of at most 32 KB (`attainment_configs_config_check`). The shape (`studentThreshold`, `minAnswers`, `levels`, `evidence`, `attempts`, `roomWeights`) and every range are the server's check |
| `created_at` | timestamptz | not null, default now() |
| `created_by` | uuid | null; references `accounts(id)` on delete set null. Null on the shared teacher-key path |

Index on `created_by` where not null. Trigger `attainment_configs_guard` (function of
the same name), `before update or delete`: a saved version is never changed or
deleted (23001), so a report printed under version 2 can always be checked against
it; a change is a new version. Inside a foreign key's action it lets the class's
delete take its versions and an account's delete set `created_by` null.

Written by the repo method `addAttainmentConfig` (an insert of the next version,
from `PUT /api/classes/:id/attainment/config`); read by `getAttainmentConfig` (the
highest version: `order by version desc limit 1`). No column is added to answers,
rooms or classes, and a room's archive carries none of it: the formula is the
class's. The boot probe does not check the table, as for `0019`.

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
| `roll_no` | text | null; students only; unique with `department` as typed (`accounts_department_roll_no_key`) and as a room reads it, trimmed, single-spaced, upper case (`accounts_department_roll_key`, `0011`) |
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
names the migration that creates any that is missing. Since `0010` that includes
`answer_reviews`: a server deployed before `0010` has been applied falls back to the
in-process store at boot, so apply the migration first. Since `0013` it also probes
the new `questions` and `contents` columns, because without them every generated
question would fail to save; the same fallback applies. Since `0014` it also probes
the `media` table, so apply `0014` before deploying a server that serves uploads.
Since `0015` it also probes `sessions.question_ids`, because `createSession` writes
it and without it no room could open. Since `0016` it also probes `classes`,
`class_students`, `attendance` and `sessions.class_id`, for the same reason:
`createSession` writes `class_id` on every room. Since `0017` it also probes the six
teacher-record tables. Since `0018` it also probes `projector_links` and the five
new `sessions` columns (`mode`, `adapt`, `start_level`, `questions_per_student`,
`time_per_question`), which `createSession` writes on every room. Since 19 November
2026 it probes `0019`, `0020` and `0021`'s `attendance.roll_no` too, without failing:
a missing one is a boot-log line naming its file and what fails until it is applied,
and Supabase is still used. It probes `0022`'s four columns as pieces rooms need. It
asks for no rows with a GET rather than a HEAD, since a missing table's 404 to a HEAD
carries no body and the client read it as no error. Phase 5 adds `0023`'s table and
two `answers` columns and `0024`'s `questions.misconceptions` to the pieces rooms need:
`insertQuestions` writes `misconceptions` with every question saved.
