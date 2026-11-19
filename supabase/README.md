# Database migrations

`migrations/` is the only source of truth for the BloomLoop database. There are no
other SQL files to run.

## The files

Apply in this order. The last column is what the server's boot probe does when a
file has not been applied (`ROOM_SCHEMA` and `ROUTE_SCHEMA` in
`server/src/repo/supabaseRepo.js`): "stops" means it does not use Supabase at all and
its log names the file; "warns" means it keeps Supabase, logs the file and what fails
until it is applied; "not checked" means nothing at boot notices, so apply in order.
Full detail: `docs/DATABASE_SCHEMA.md`.

| File | What it adds | The boot probe |
|---|---|---|
| `0000_core_tables.sql` | `contents`, `questions`, `sessions`, `profiles` (v1) | Stops |
| `0001_accounts_ownership_question_kinds.sql` | Accounts and their hierarchy, owners, question kinds | Stops (the `accounts` table) |
| `0002_invites.sql` | Invites | Stops |
| `0003_student_google_link.sql` | A student's Google link | Not checked |
| `0004_invite_google_sub.sql` | An invite's Google identity | Not checked |
| `0005_sessions_and_profiles_v2.sql` | Paused rooms, the pin, signals, `profiles.account_id` | Not checked |
| `0006_accommodations.sql` | Accommodations on accounts | Not checked |
| `0007_mastery_settings.sql` | Room settings | Not checked |
| `0008_answers.sql` | `answers`, the evidence store | Stops |
| `0009_room_archives.sql` | A deleted room kept as JSON | Stops |
| `0010_answer_reviews.sql` | The review log | Stops |
| `0011_roll_no_normalised_unique.sql` | One roll number per department (warns and waits on a clash) | Not checked (an index) |
| `0012_evidence_guards.sql` | Evidence written once; reviews append-only | Not checked (triggers) |
| `0013_question_provenance_and_approval.sql` | Drafts, provenance and approval | Stops |
| `0014_media.sql` | Uploaded images | Stops |
| `0015_room_question_sets.sql` | A room's question set | Stops |
| `0016_classes_roster_attendance.sql` | Classes, rosters, attendance | Stops |
| `0017_teacher_records.sql` | The teacher-record store | Stops |
| `0018_room_modes_and_projector.sql` | Room modes, the waiting room, projector links | Stops |
| `0019_course_outcomes.sql` | Course outcomes and their mappings | Warns: the outcome and coverage routes fail |
| `0020_attainment_configs.sql` | Attainment formulas, by version | Warns: the attainment and register routes fail |
| `0021_attendance_roll.sql` | The roll number a mark was made under | Warns, but every attendance mark writes it: apply it before the server |
| `0022_owner_decisions.sql` | Verified links, the under-18 mark, `replaces_id`, `source` may be `teacher` | Stops |
| `0023_class_questions.sql` | Class questions; `answers.class_question_id` and `round` | Stops |
| `0024_misconception_labels.sql` | `questions.misconceptions` | Stops |
| `0025_hub_backbone.sql` | The Learning Hub's backbone: units, a class's chapters, topic records, prerequisite links; `contents.slide_texts` | Warns: the hub's units, chapters, topics and links cannot be read or saved; a deck uploaded keeps no per-slide text |
| `0026_hub_practice.sql` | Hub practice attempts (append-only) and explanations | Warns: no practice answer is saved, so practice, mastery, the error log and reviews fail; no explanation is shown |
| `0027_lessons_and_languages.sql` | Topic lessons, Hindi and Marathi versions, a student's language | Warns: no lesson or translation can be made, approved or shown; students read English |
| `0028_hub_paths_and_goals.sql` | Get Ready checks and self-tests (`hub_runs`, `hub_attempts.run_id`), goals | Warns: no Get Ready check, self-test or goal works; practice still saves |
| `0029_hub_tutor.sql` | Hints, feedback on wrong options, the hints a student opened; no hints in a self-test or Get Ready | Warns: no hint or feedback is offered; answers are still saved and marked |
| `0030_offline_packs.sql` | `question_packs` (Phase 7); `answers.device_answered_at`; `profiles.served_log` | Stops |
| `0031_room_imports.sql` | Rooms imported from laptop mode: where each came from (Phase 7) | Warns: importing a laptop's room file fails |
| `0032_record_write_keys.sql` | Replay keys of teacher-record writes from an offline console (Phase 7) | Warns: a record write sent with a replay key fails; one without a key works |

The next new file takes `0033`.

## Applying

Run every file in `migrations/`, in number order (`0000`, `0001`, ... `0032`).

`0013` must be in place before the Phase 2 server is deployed: every generated
question is saved with columns it adds, and the server's boot probe falls back to
the in-process store (nothing saved) when they are missing. The same goes for
`0014`: the probe also checks the `media` table that image uploads are kept in. And
for `0015`: every room is opened with `sessions.question_ids`, so the probe checks
that column too. `0015` changes no row; existing rooms keep serving their whole
approved bank. And for `0016` (classes, rosters and attendance): every room is
opened with `sessions.class_id`, and the probe checks it and the three new tables.
`0016` changes no row; existing rooms are opened for no class and behave as before.
And for `0017` (the teacher-record store): the probe checks its six tables. `0017`
changes no row, and from it on the database refuses to edit an observation or an
insight action, to change who a wheel pick drew, and to delete any teacher record
except with its room. And for `0018` (room modes, the waiting room and projector
links): every room is opened with its five new `sessions` columns, so the probe
checks them and the `projector_links` table. `0018` changes no row; existing rooms
get the values that reproduce how they ran (Student devices, adapting, from
Understand, no cap, no time per question), and `sessions.status` now also allows
`waiting`.

Phase 4 adds three files, applied in this order: `0019` (course outcomes and their
mappings), `0020` (attainment formulas) and `0021` (the roll number an attendance mark
was made under). Since 19 November 2026 the boot probe checks all three without
failing: a missing one is a boot-log line naming its file and what fails until it is
applied, and Supabase is still used.
- `0019` and `0020` add tables no room needs: a server deployed before them keeps every
  room working, and only the outcome and attainment routes fail, naming the missing
  table. Apply them before anyone uses those routes.
- **`0021` must be applied before the server is deployed.** The server writes
  `attendance.roll_no` with every attendance mark, so without it every mark would be
  refused: a phone's join would mark nobody, and a professor's marks would fail.
  `0021` adds one nullable column, changes no row and backfills nothing; a mark made
  before it has no roll number.

None of the three has run anywhere but PGlite (`npm run migrations`).

**`0022` (the owner's decisions of 19 November 2026) must be applied before the server
that writes it is deployed.** It adds `profiles.account_verified` and
`answers.account_verified` (a room is linked to a student only by a signed-in phone),
`class_students.under_18`, `questions.replaces_id`, and widens `questions.source` to
`teacher`. The server writes these on every join, answer, question saved and roster
row added, so the boot probe treats them as pieces rooms need: without `0022` the
server does not use Supabase at all and its boot log names `0022` to apply. `0022`
rewrites no row; every existing link reads as unverified. Run only on PGlite.

**`0023` (Phase 5: class questions) must be applied before the server that writes it
is deployed.** It adds the `class_questions` table (one approved question put to every
phone in a room, round 1, a pause, a re-vote) and two nullable columns on `answers`,
`class_question_id` and `round`, which every vote carries and every other answer
leaves null. The server writes both columns with every answer and reads the table
with every room's bank, so the boot probe treats them as pieces rooms need: without
`0023` the server does not use Supabase at all and its boot log names `0023` to apply.
`0023` rewrites no row and backfills nothing; every existing answer reads as an
ordinary answer. It widens no check: the confidence taps are stored in the spellings
`0008` already allows (`sure`, `think`, `guess`). Run only on PGlite.

**`0024` (Phase 5: misconception labels) must be applied before the server that writes
it is deployed.** It adds one column, `questions.misconceptions` (jsonb, default `[]`):
the labels a professor or the generator put on a question's wrong options, each with
its provenance (`ai` or `professor`). The server writes it with every question it
saves, so the boot probe treats it as a piece rooms need: without `0024` the server
does not use Supabase at all and its boot log names `0024` to apply. `0024` rewrites no
row and adds nothing to `answers`; every existing question reads as having no labels.
Run only on PGlite.

**Phase 6 (the student Learning Hub) adds five files, applied in this order:** `0025`
(the hub's backbone: units, the chapters a class covers, topic records, prerequisite
links, each slide's own words), `0026` (practice attempts and explanations), `0027`
(lessons, Hindi and Marathi versions, a student's language), `0028` (Get Ready checks,
self-tests and goals) and `0029` (the tutor: hints, feedback on wrong options, the
hints a student opened). All five are route-only: the boot probe checks them in
`ROUTE_SCHEMA`, so a missing one is a boot-log line naming its file and what fails
until it is applied, Supabase is still used and every room runs. So they are safe to
apply before or after the server is deployed. Apply them in number order: later files
point at tables earlier ones make (`0026`, `0027` and `0029` at `0025`'s
`chapter_topics`; `0028` adds `hub_attempts.run_id` and `0029` a check to `0026`'s
`hub_attempts`). None rewrites a row or drops anything; `0029`'s check is added NOT
VALID, so attempts already stored are not checked. None has run anywhere but PGlite
(`npm run migrations`, 1226 of 1226 on 19 November 2026); nothing was run against the
hosted project.

**`0030` (Phase 7: question packs and the phone's own answer time) must be applied
before the server that writes it is deployed.** It adds the `question_packs` table (the
few questions a phone is sent for use while its connection is down, ids only, no key;
written once, gone with its room) and one nullable column, `answers.device_answered_at`
(when the phone says an answer that waited on it was given, kept for the record and
never read for order or counting). The server writes the column with every answer and
the table with every pack, and reads the table for an answer that is not to the
question on the phone's screen, so the boot probe treats both as pieces rooms need:
without `0030` the server does not use Supabase at all and its boot log names `0030` to
apply. `0030` rewrites no row and backfills nothing; every existing answer reads as one
whose phone sent no time. It also adds `profiles.served_log` (added by the review fixes
of 19 Nov 2026): every question the server put on a phone's screen, the first time each,
so an answer that waited on the phone past the room's close is still known for one the
phone was given after the pin moved on. It is written with every profile, so it is in
the boot probe too; a constant default (`'[]'`), so no profile row is rewritten. Run only
on PGlite.

`0031` (Phase 7: rooms imported from laptop mode) adds one table, `room_imports`: one
row per room file a professor imports after running a class on their laptop with no
internet (`docs/TRAVEL_ROUTER.md`). It records the laptop's room id (unique, so the
same room imported twice changes nothing), the room it became, who imported it and
when, and the file as uploaded. The room itself is written to the existing tables like
any room. A row is written once: the database refuses every edit except the room or
account it names being set to null when that room or account is deleted. Only the
import writes it, so the boot probe warns rather than stops: without `0031` every room
runs, and importing a laptop's room file fails, naming `0031`. The live loop also reads
it when a phone asks to send saved answers to a closed room, since a room imported from
a laptop takes none; without `0031` there is no import to find, and that works as
before. `0031` changes no existing row. Run only on PGlite.

`0032` (Phase 7: replay keys for the teacher-record writes) adds one table,
`record_writes`. When the network drops, the professor's console keeps each record she
makes (an attendance mark, an observation, a pick's response, a hand count, an activity,
what was done about an insight) and sends it again when it reconnects, with a key of its
own. The server keeps the reply of the first write made with each key, so a write sent
twice is done once: a hand is never counted twice. A row is written once and goes with
its room; it is not part of the room's archive. Only a write that carries a key reads or
writes it, so the boot probe warns rather than stops: without `0032` a write sent with a
key fails, naming `0032`, and every write sent without one works as before. `0032`
changes no existing row. Run only on PGlite.

`0011` creates its index only if no two accounts in one department hold the same
roll number once trimmed, single-spaced and upper-cased. If some do, it raises a
WARNING, creates nothing and changes nothing; the file has the query that lists
them. Correct those accounts, then run `0011` again.

From `0012` on, the database itself refuses to rewrite an answer's evidence (the
response, the question as asked, the machine's assessment) and to edit or delete a
review decision, from any connection, the service role included. See
`docs/DATABASE_SCHEMA.md`.

**Supabase SQL editor:** SQL Editor, New query, paste one file, Run. Then the next
file, in order.

**psql:**

```bash
for f in supabase/migrations/*.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f "$f" || break
done
```

`--single-transaction` makes each file all-or-nothing. The connection string comes
from the Supabase dashboard (Project Settings, Database); keep it out of the
repository.

## Every file is safe to re-run

Each file can be run any number of times, against a new project or against the live
one. Nothing in the set drops a table or a column, deletes or rewrites a row, or
narrows a type. On a database that already has a table or column, its `create` /
`add column` is skipped; constraints are dropped by name and added again; functions
and triggers are replaced. So after pulling new migrations, run the whole set again
rather than working out which files are new.

`0005` re-adds `sessions_status_check`, and it lists `'waiting'` (added by `0018`)
as well, so a re-run never narrows the check below what a later file allows. The
migration test re-runs the set with a room left waiting.

The set needs Supabase's `auth.users` table (accounts and invites point at it). On
plain Postgres, create `auth.users (id uuid primary key)` first.

## Checking

```bash
cd server && npm run migrations
```

Builds the set twice in an in-memory Postgres (PGlite), uses the result the way the
server does, re-runs it over data, and upgrades a v1 database. Prints PASS or FAIL
per check and exits non-zero on any failure.

## Adding a migration

Add the next number (`0009_what_it_does.sql`), written to the same rules: `if not
exists` on every create and add, `drop ... if exists` before every constraint or
trigger you add, `create or replace` for functions. Never renumber or edit the
meaning of an applied file. Add any column the server reads or writes to
`COLUMNS_THE_SERVER_USES` in `server/scripts/migrations.mjs`, and to
`docs/DATABASE_SCHEMA.md`.

`0001` was reconstructed from the server code while the live project was
unreachable. See `docs/DATABASE_SCHEMA.md` for what to compare against the live
project.
