# Database schema

BloomLoop's production store is Supabase Postgres. The SQL that builds it is
`supabase/migrations/`, applied in number order (how: `supabase/README.md`). Every
file is idempotent and safe on a database holding real records. The test is
`cd server && npm run migrations` (`server/scripts/migrations.mjs`, PGlite).

Every table has row level security **on with no policies**. Only the server's
service role key, which bypasses RLS, can read or write; the anon key sees nothing.
The server is the only place authorization is decided.

Last revised 19 November 2026, after Phase 7, offline-first: question packs, the
phone's own answer time and the log of serves (`0030`), rooms imported from laptop mode
(`0031`) and replay keys for the console's record writes (`0032`). Before them came
Phase 6, the student Learning Hub (`0025` to `0029`, 1226 migration checks). The run
for the Phase 7 docs gave 1457 of 1457 on PGlite, offline with every network setting
blank, on Node 24.22.3. Nothing has been run against the hosted Supabase project. The
next free number is `0033`.

**Applying everything: `0000` to `0032`, in number order.** The numbering has no gap.

**Applying Phase 7: `0030` before the server is deployed; then `0031` and `0032`.**
- **`0030` is one rooms need: apply it before deploying the Phase 7 server.** The
  repo writes `answers.device_answered_at` with every answer, `profiles.served_log`
  with every profile save, and `question_packs` with every pack, and reads the packs
  for any answer not to the question on a phone's screen. So the boot probe checks
  all three in `ROOM_SCHEMA`: without `0030` the server does not use Supabase at all
  (it falls back to the in-process store, which saves nothing) and its boot log names
  `0030`. `0030` rewrites no row (a nullable column and a column with a constant
  default `'[]'`, which Postgres adds without touching rows).
- **`0031` and `0032` are route-only** (`ROUTE_SCHEMA`): without `0031` every room runs
  and importing a laptop's room file fails, naming `0031` (staff views then show no room
  as imported, and a closed room's deliveries work as for any room); without `0032` a
  record write sent with an `Idempotency-Key` fails, naming `0032`, and every write
  without a key works. Safe before or after the server, in number order.

None of the three rewrites a row, narrows a check or drops anything; each re-runs over
data unchanged; RLS is on with no policies on the three new tables. Run on PGlite only
(`npm run migrations`).

**Applying Phase 6: `0025` to `0029`, in order.** Every Phase 6 piece is route-only.
The boot probe checks each new table, and the two columns added to tables that
already existed (`contents.slide_texts`, `hub_attempts.run_id`), in `ROUTE_SCHEMA`,
never in `ROOM_SCHEMA`. With one missing, the server still uses Supabase and every
room runs; the boot log names the file to apply and what fails until it is:
- `0025`: a deck uploaded keeps no per-slide text (its topics still cite their slides
  by number); the hub's units, chapter placements, topic records and prerequisite
  links cannot be read or saved, so the hub shows no topics and no link can be made.
- `0026`: no practice answer can be saved or read, so practice, mastery, the error
  log and reviews in the hub fail; explanations cannot be written, generated or shown
  (a practice answer is still saved and marked).
- `0027`: no lesson can be made, approved or read; no Hindi or Marathi version can be
  made, approved or shown, and a student's choice of language cannot be saved, so
  students read English.
- `0028`: no Get Ready check or self-test can be started, read or answered, and goals
  cannot be set or read; practice answers still save, and the hub home shows the rest.
- `0029`: no hint or feedback on a wrong option can be written, generated, approved
  or shown, and no hint can be opened; every answer is still saved and marked.

So the five files are safe to apply before or after the server is deployed. They
must be applied in number order, because later files point at tables earlier ones
make: `0026`, `0027` and `0029` reference `0025`'s `chapter_topics`; `0028` adds a
column to `0026`'s `hub_attempts`, and `0029` adds a check to it. (`0029` needs
nothing from `0028`.) None rewrites a row, drops anything or changes an existing
check; `0029`'s new check on `hub_attempts` is added NOT VALID, so rows already there
are not checked. Each re-runs over data unchanged. RLS is on with no policies on all
fourteen new tables. None has run anywhere but PGlite (`npm run migrations`).

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
writes from `0000` to `0032`, each named with its file (not the columns of `0003` to
`0007`, nor `0011`'s index or `0012`'s triggers, which it does not look for;
`supabase/README.md` lists which file it checks). What rooms need (`0000` to
`0018`, `0022` to `0024`, and `0030`) stops Supabase being used when missing; what only some routes
need (`0019`, `0020`, `0021`'s `attendance.roll_no`, `0025` to `0029`, `0031` and `0032`) is logged at boot, one line
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
| `0025_hub_backbone.sql` | Phase 6, the hub's backbone: `contents.slide_texts` (nullable jsonb, each slide's own words, `contents_slide_texts_check`), `class_units`, `class_chapters` (trigger `class_chapters_in_class`), `chapter_topics` and `topic_links` (trigger `topic_links_guard`: one owner, no loop of confirmed links). Changes no row: every chapter before it has no slide texts, and the hub starts empty | new (Phase 6) |
| `0026_hub_practice.sql` | Phase 6, practice: `hub_attempts` (every attempt a student makes in the hub, append-only by trigger `hub_attempts_append_only`, one per account and client attempt id) and `question_explanations` (one per question, an AI draft or the professor's). Changes no row; nothing that reads `answers` reads them | new (Phase 6) |
| `0027_lessons_and_languages.sql` | Phase 6, lessons and languages: `topic_lessons` (a topic's lesson, one row per version; trigger `topic_lessons_guard`; function `approve_topic_lesson`), `item_translations` (Hindi and Marathi versions; trigger `item_translations_guard`; function `approve_item_translation`) and `student_language_choices`. Changes no row | new (Phase 6) |
| `0028_hub_paths_and_goals.sql` | Phase 6, Get Ready checks, self-tests and goals: `hub_runs` (written once, then ended once; trigger `hub_runs_written_once`), `hub_attempts.run_id` (nullable uuid, references `hub_runs(id)`, no delete action, partial index; trigger `hub_attempts_in_own_run`) and `hub_goals`. Changes no row: every attempt before it has no run | new (Phase 6) |
| `0029_hub_tutor.sql` | Phase 6, the tutor: `question_hints` (up to three steps per question), `option_feedback` (per wrong option, keyed by its words), `hub_hint_views` (each hint a student opened, append-only by trigger `hub_hint_views_append_only`) and `hub_attempts_hints_mode_check` (no hints in a self-test or Get Ready), added NOT VALID. Changes no row; an attempt written before it is not checked | new (Phase 6) |
| `0030_offline_packs.sql` | Phase 7, offline answers: `question_packs` (a pack of keyless questions sent to one phone; written once, gone only with its room, trigger `question_packs_written_once`), `answers.device_answered_at` (nullable; the phone's own time, for the record) and `profiles.served_log` (jsonb, not null, default `[]`; every question put on the phone's screen). **Rooms need it: apply before the server.** Changes no row | new (Phase 7) |
| `0031_room_imports.sql` | Phase 7, laptop mode: `room_imports` (one row per room file imported; unique laptop room id and room; written once, trigger `room_imports_written_once`, function `room_imports_keep_record`). Route-only. Changes no row | new (Phase 7) |
| `0032_record_write_keys.sql` | Phase 7, the console's outbox: `record_writes` (the first reply of each teacher-record write sent with a key; append-only through `0017`'s `teacher_records_guard`, trigger `record_writes_append_only`; gone with its room). Route-only. Changes no row | new (Phase 7) |

The SQL of every moved file is unchanged; only header comments were updated.

What the migration test holds `0030` to `0032` to (Phase 7; 1457 checks in all, 1226
before them). Each builds on a fresh database and again unchanged; each re-runs over a
database holding its own rows, and its guards still refuse after the re-run; each is
applied over existing data (`0030` over rooms, profiles and answers; `0031` over rooms,
answers and archives; `0032` over attendance and teacher records) and changes no row.
`0030`: a phone's time written once, a kept-after-close answer as the live loop writes
it, a pack of five read back in order, an empty pack, one of 21, one holding a null, a
non-flat one and one expiring when sent refused, no change and no delete but with its
room, `served_log` read back in order and refused when not a list or over 1000 entries.
`0031`: an import read back, the same laptop room twice and two imports of one room
refused, the file's size, hash, room id and code checked, the record never edited (the
file, the times, the room by hand), the room's and the account's deletion setting their
columns to null, the record deletable. `0032`: a key read back with its whole reply, the
same key twice from one writer refused and from another taken, the key, route, hash,
status (2xx only) and reply shapes checked, no edit, no delete but with its room. The
numbering check is strict: `0000` to `0032`, no gap. Run on PGlite only.

What the migration test holds `0025` to `0029` to (Phase 6; 1226 checks in all, 752
before them). Each builds on a fresh database as part of the set and builds again
unchanged; each re-runs over a database holding its own rows, which survive, and its
guards still refuse after the re-run; a v1 database upgrades through all five. Every
new table is in `COLUMNS_THE_SERVER_USES` and the RLS check. Run on PGlite only.

`0029`. Applied over a database that already holds hub attempts in every mode, a
question and a translation of kind `hint`, it adds, removes and changes no row: an
older self-test attempt holding a hint is left as it was, and a new one is refused.
Its checks refuse a hint at step 0 or 4, a blank text or one over 600 characters, a
professor's hint left a draft, an approved one with no approval time, a model on a
professor's hint, a provenance outside the two and a `source_ref` that is not an
object (23514), and a second hint at one step (23505); a blank option, feedback over
600 characters and a professor's feedback left a draft (23514), and second feedback on
one option, matched by `option_key` (23505); a hint view in a self-test or Get Ready,
at position 4, of a kind outside the four, with a short attempt id, a plan that is not
an object or a provenance outside the two (23514), and one position twice for an
attempt (23505); hints on a self-test or Get Ready attempt (23514). The guard refuses
changing the words shown, clearing a view's question by hand and deleting a view
(23001). Deleting a question takes its hints and feedback and leaves its views, their
question cleared and their words kept; deleting a student's sign-in takes their views.

`0028`. Applied over a database that already holds hub attempts (one in exam mode),
topic records, a question and a link, it adds, removes and changes no row, and every
attempt already there reads as one with no run. Its checks refuse a client run id too
short, a kind outside the two, a spec that is not an object, a time limit on a Get
Ready check, a deadline that is not the start plus the limit, a limit over three
hours, an end with no reason, a check handed in like a self-test, a self-test timed
out with no time limit and an end before the start (23514), and one client run id
twice for one student (23505; another student may use it). An answer filed under
another student's run, in a mode other than its run's, or under a run that does not
exist is refused by the trigger (23514); moving an answer to another run by `0026`'s
guard (23001). The guard on runs refuses ending a run twice, changing a self-test's
list or time, ending one while stretching its time, and deleting a run (23001). A goal
with a title over 80 characters, no topics, topics that are not a list or 61 topics is
refused (23514), and so is a day that does not exist; a goal can be changed and
deleted. Deleting a student's sign-in takes their runs, the answers filed under them
and their goals together.

`0027`. Applied over chapters, a topic record, a question and an answer, it touches
none of them and makes no lesson, translation or choice of language. Lessons: it
refuses a version number taken twice (23505); one written as approved, a source
outside the two, an AI lesson with no model, a slides-only lesson naming one, version
0, no steps and a step of another type (23514); a topic not of its chapter (23503);
an owner other than the chapter's (23514). Approving through `approve_topic_lesson`
retires the approved one in the same call, keeping when it was approved; approving it
again, or approving a discarded draft, is refused (23514); an unknown id returns no
row; a second approved lesson written directly is refused (23505,
`topic_lessons_one_approved`); bringing a retired lesson back is refused (23514). The
guard refuses changing an approved lesson's steps or a draft's, changing who approved
it, and deleting a lesson (23001); a draft can be discarded and not brought back.
Translations: a kind outside the five, a language outside `hi` and `mr`, fields that
are not an object, a source hash that is not 64 hex digits, a provenance outside the
two, one written approved and an owner other than the chapter's are refused (23514).
A draft's text can be edited; `approve_item_translation` retires the approved one;
editing an approved one's text or changing which item it is of is refused (23001),
approving a retired one (23514) and deleting one (23001). Deleting the account that
approved one clears `approved_by` and leaves it approved. A student's language is one
row, the latest choice; a language outside `en`, `hi` and `mr` is refused (23514).

`0026`. Applied over topic records, a link, a question and a room answer, it touches
none of them and makes no attempt or explanation. An attempt sent with only what it
needs gets no links, `en`, no hints and the server's time. It accepts all five modes,
a written answer's provisional mark and an attempt with no time taken; it refuses one
client attempt id twice for one student (23505; another student may use it), an id
too short or with a space, a level spelt `analyze`, a poll, a score over 1, a review
status other than `auto` and `provisional`, a mode outside the five, a language that
is not a short code, four hints and a negative time (23514). The guard refuses
changing an attempt's response or mark, clearing its question by hand and deleting it
(23001). Deleting a topic record clears the attempt's link and keeps its topic name and
snapshot; deleting a student's sign-in takes their attempts. Explanations: a second
for one question (23505); a professor's left a draft, an approved one with no approval
time, a draft with one, a model on a professor's, a blank text or one over 2000
characters, a provenance outside the two and a `source_ref` that is not an object
(23514). Approving a draft and the professor rewriting it as theirs are accepted.
Deleting a question takes its explanation and leaves the attempt, its question cleared
and its snapshot kept.

`0025`. Applied over chapters, a class, a question and an answer, it touches no
question or answer, a chapter keeps its topics and slide numbers and has no slide
texts, and the hub starts empty. Its checks refuse slide texts that are not a list, a
slide with no text and a slide numbered by text (23514); a unit name used twice in a
class in another case (23505; another class may use it), a blank or double-spaced
name and position 0 (23514); a chapter twice on a class (23505), in a unit of another
class, on insert or on update (23503), and on a class of another owner (23514);
removing a unit leaves its chapters on the class in no unit. A topic record's key
twice in a chapter is skipped by `on conflict do nothing` and refused without it
(23505); a name with spaces round it or over 300 characters is refused (23514);
retiring a topic and bringing it back are accepted. Links: the same pair twice
(23505); a topic before itself, a confirmed link that closes a loop, confirming a
proposal that would, a professor's link left proposed, a proposal with a decision
time, a decision with none, a model on a professor's link, a provenance outside the
two, a reason over 300 characters, a link to another owner's chapter and a link owned
by someone other than the chapters' owner (23514). The same loop as an AI proposal is
accepted (a proposal closes nothing) and can be rejected. Deleting a topic record
takes its links.

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

### contents (0000, 0001, 0025)

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
| `slide_texts` | jsonb | null; when set, an array of objects each with a number `slide` and a string `text` (`contents_slide_texts_check`), `[{"slide": 1, "text": "..."}]` (`0025`). Each slide's own words, kept for a deck uploaded from Phase 6 on (decision H4). Null for every chapter made before `0025` and for pasted text: their topics cite slides through `topic_slides` only. Staff and model input; it reaches a student only inside an approved lesson |

Written by: repo `createContent` from `routes/content.js` (upload; `topic_slides`
from `topicSlides()` in `services/extract.js`, since the deck itself is not kept)
and `seed.js`; `updateContent` (title, raw text, topics; never `topic_slides`, so a
topic renamed after upload loses its slides).

`slide_texts` (`0025`) is written by repo `setContentSlideTexts`, a statement of its
own after `createContent` on a deck upload (`keepSlideTexts` in `routes/content.js`),
so a database without the column still takes uploads: the write fails, is logged, and
the deck keeps no per-slide text. Read by the lessons (`services/hubLessons.js`), and
through `topicSlideText` in `services/hubTopics.js` by the prerequisite-link proposals
and the explanation drafts; `slidesNote` tells staff whether a deck kept them. An
upload, a pasted syllabus and an edit of the topic list also
bring the chapter's topic records in step (`chapter_topics`, below).

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

### profiles (0000, 0005, 0007, 0022, 0030)

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
| `served_log` | jsonb | not null, default `[]` (`0030`); `profiles_served_log_check`: an array of at most 1000 entries. Every question the server put on this phone's screen, the first time each: `[{ questionId, at }]`, in the order served. The server keeps at most 500 (`SERVED_LOG_LIMIT`). Written with the pin, in the same profile save (`logServed` in `services/offline.js`). Read only to decide whether an answer arriving after the room's close was to a question the phone was given (`servedAtFor`). Left out of the room archive. A profile before `0030` reads as having logged nothing |

Written by: repo `saveProfile` (upsert on `session_id, roll_no`) from
`sockets/index.js`: join (including, since `0022`, the verified link a signed-in
phone's token makes; a typed roll number links nothing),
the pin, integrity signals, every answer; and from `POST /api/review/:answerId`,
which sets the reviewed mark on the matching `history` entry (marked `review`:
`confirmed` or `overridden`) and moves `levels` by the difference
(`applyReview` in `services/mastery.js`). Every one of these writes takes an
in-process per-student lock first (`lockProfile` in `sockets/index.js`), because
each reads the whole row and writes it back.

### answers (0008, 0012, 0022, 0023, 0030)

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
| `device_answered_at` | timestamptz | null (`0030`); no default. When the phone says the student answered, sent with an answer that waited on the phone (`deviceAnsweredAt`; kept only when it is a date from 2000 to 2099). For the record only: the order answers are marked in, and whether one counts, are read from `answered_at`, when the server received it. Written once: `0012`'s guard refuses a change to every column it does not list as changeable, this one included. In the room archive; not yet on the staff answer list |

**Kept, not counted (Phase 7, no new column).** An answer the live loop stores and never
counts has `final` false, `correct` and `score` null (the machine's reading in
`auto_*`), and one of three `detail` values (`services/offline.js`): "Arrived after the
room closed: kept, not counted." (`AFTER_CLOSE_DETAIL`: after the close, and not given to
that phone before it, or after the 10-minute window), "Arrived after the student had
answered every question the room asks: kept, not counted." (`OVER_CAP_DETAIL`: past the
room's cap, to a question served or packed to the phone) and "Arrived after the student
had already been marked on this question: kept, not counted." (`ANSWERED_AGAIN_DETAIL`).
No profile, level or report counts them (`keptNotCounted`); attainment sets them aside
with a note of their own. The server stores at most 100 kept answers per student per
room, these and a student's own answers to a question put to the class together
(`KEPT_LIMIT`; a server rule, not a database check).

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

### The Learning Hub's backbone (0025)

Four tables that describe a professor's material for the hub (Phase 6, decisions H3
and H4): a class's units, the chapters a class covers, a chapter's topics as records,
and which topic is needed before which. No student data. Nothing is added to
`answers`, `questions`, `sessions` or `profiles`: a question keeps its topic text and
is matched to a record by name within its chapter when read, ignoring case and runs of
spaces (`services/hubTopics.js`), so no question row is rewritten, and a room's
archive needs nothing from here. Who reaches which class, chapter and topic is the
server's rule (`services/hubAccess.js`). RLS on, no policies, on all four.

#### class_units

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | primary key, `gen_random_uuid()` |
| `class_id` | uuid | not null; references `classes(id)` on delete cascade |
| `name` | text | not null; 1 to 80 characters, trimmed and single-spaced (`class_units_name_check`). One per class ignoring case (`class_units_class_name_key`, a unique index on `(class_id, lower(name))`) |
| `position` | integer | not null, default 1, at least 1 (`class_units_position_check`). The class's order; not unique (a reorder is written row by row, as for course outcomes) |
| `created_at`, `updated_at` | timestamptz | not null, default now(); no trigger maintains `updated_at`, the repo sets it |
| `created_by` | uuid | null; references `accounts(id)` on delete set null |

Index `class_units_class_idx` on `(class_id, position)`.

Written by repo `createClassUnit` (a 23505 becomes a 409 naming the unit),
`updateClassUnit` (name, position) and `deleteClassUnit`, from `routes/hub.js`
(`POST /api/hub/classes/:classId/units`, `PUT .../units/order`, `PATCH` and `DELETE
.../units/:unitId`). Read by `listClassUnits` and `getClassUnit` (`routes/hub.js`,
`services/hubViews.js`, `services/hubProgress.js`).

#### class_chapters

The chapters a class covers, each in a unit or in none.

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | primary key |
| `class_id` | uuid | not null; references `classes(id)` on delete cascade |
| `content_id` | uuid | not null; references `contents(id)` on delete cascade. Once per class (`class_chapters_class_content_key`, unique `(class_id, content_id)`) |
| `unit_id` | uuid | null; references `class_units(id)` on delete set null. Null is no unit ("Other chapters"): removing a unit leaves its chapters on the class. A unit of the same class (trigger) |
| `position` | integer | not null, default 1, at least 1 (`class_chapters_position_check`); the order within its unit, not unique |
| `added_at` | timestamptz | not null, default now() |
| `added_by` | uuid | null; references `accounts(id)` on delete set null |

Indexes: the unique `(class_id, content_id)`; `class_chapters_content_idx`
(`content_id`); `class_chapters_unit_idx` (`unit_id`, where not null).

Trigger `class_chapters_in_class` (function of the same name), `before insert or
update`: refuses a unit of another class (23503), and a chapter whose owner is not the
class's owner (23514; two null owners match, as for the shared key).

Written by repo `placeClassChapter` (a 23505 becomes a 409), `updateClassChapter`
(unit, position) and `removeClassChapter`, from `routes/hub.js` (`PUT` and `DELETE
/api/hub/classes/:classId/chapters/:contentId`; deleting a unit moves its chapters to
no unit, after the others). Placing a chapter on a class (not moving one already on
it) also brings its topic records in step. Read by `listClassChapters` (`routes/hub.js`, `services/hubAccess.js`,
`services/hubViews.js`, `services/hubProgress.js`).

#### chapter_topics

A chapter's topics as records (H3), kept in step with `contents.topics`.

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | primary key |
| `content_id` | uuid | not null; references `contents(id)` on delete cascade |
| `name` | text | not null; 1 to 300 characters, trimmed and single-spaced (`chapter_topics_name_check`). As the chapter's topic list spells it |
| `key` | text | not null; 1 to 300 characters (`chapter_topics_key_check`). The name in lower case, as the server computes it (`topicKey`); its case folding is the server's, so the database checks only the length. One per chapter (`chapter_topics_content_key_key`, unique `(content_id, key)`), what the server's insert skips on |
| `position` | integer | not null, default 1, at least 1 (`chapter_topics_position_check`); the chapter's order |
| `retired_at` | timestamptz | null: in use. Set when the topic has left the chapter's list but questions or links hang off it: kept, not deleted, and in use again, with its id, if the name comes back |
| `created_at`, `updated_at` | timestamptz | not null, default now(); the repo sets `updated_at` |

No index but the unique `(content_id, key)`.

Written by `syncTopics` in `services/hubTopics.js` only, through repo
`addChapterTopics` (`on conflict (content_id, key) do nothing`: only the rows added
come back), `updateChapterTopic` (name and its key, position, `retired_at`) and
`deleteChapterTopic`. It runs on a deck upload, a pasted syllabus and an edit of the
topic list (`routes/content.js`, where a failure is logged and the next write tries
again), when a chapter is placed on a class, before link proposals, and on
`POST /api/hub/chapters/:contentId/topics/sync` (`routes/hub.js`). A topic that left
the list is deleted only when no question of the chapter (discarded ones included) and
no link names it (`topicUsage`); otherwise it is retired. That check counts questions
and links only: deleting a record also takes its lessons (`topic_lessons`, cascade)
and clears it on hub attempts, which keep the topic's name, and on hint views. A
renamed topic is a new record; the old one is retired with its questions and links.
Read by `listChapterTopics`, `getChapterTopic` and `listChapterTopicsByIds` (the hub's
routes and services).

#### topic_links

Prerequisite links, topic to topic, across any chapters one professor owns (H3).

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | primary key |
| `owner_id` | uuid | null; references `accounts(id)`, no delete action. The professor who owns both topics' chapters (trigger); null only for chapters made before accounts, which only the shared key reaches |
| `prerequisite_id` | uuid | not null; references `chapter_topics(id)` on delete cascade. Needed before `topic_id` |
| `topic_id` | uuid | not null; references `chapter_topics(id)` on delete cascade. Never the prerequisite itself (`topic_links_not_self`). One link per pair (`topic_links_pair_key`, unique `(prerequisite_id, topic_id)`) |
| `provenance` | text | not null; `ai` (proposed by the model on the professor's button) or `professor` (added by hand) (`topic_links_provenance_check`) |
| `state` | text | not null, default `proposed`; `proposed`, `confirmed` or `rejected`. A professor's own link is never `proposed`, and `decided_at` is set exactly when the link is not a proposal (`topic_links_state_check`). Only confirmed links are used; longer chains are computed from them, never stored |
| `reason` | text | not null, default `''`; at most 300 characters (`topic_links_reason_check`). One line |
| `model` | text | null; only on an `ai` link (`topic_links_model_check`) |
| `created_at` | timestamptz | not null, default now() |
| `created_by`, `decided_by` | uuid | null; reference `accounts(id)` on delete set null |
| `decided_at` | timestamptz | null |

Indexes: the unique pair; `topic_links_owner_idx` (`owner_id`);
`topic_links_topic_idx` (`topic_id`).

Trigger `topic_links_guard` (function of the same name), `before insert or update`:
both topics' chapters must be the link owner's, and a confirmed link must not close a
loop of confirmed links (both 23514). The server refuses both first, with a sentence
naming the topics, under an in-process lock per professor; the trigger is the guard
behind it. A proposal or a rejected link closes nothing.

Written by repo `addTopicLink` (a 23505 becomes a 409), `updateTopicLink` (state and
decision only) and `deleteTopicLink`, from `routes/hub.js`: `POST /api/hub/links` (a
professor's link, confirmed at once; a pair already held as proposed or rejected is
confirmed in place), `POST /api/hub/links/propose` (the model's proposals, a
background run, each `ai` and `proposed`), `PATCH` and `DELETE
/api/hub/links/:linkId`. Read by `listTopicLinks` (by owner, or touching given
topics) from the hub's routes and `services/hubTopics.js`, `hubViews.js`,
`hubProgress.js` and `hubGetReady.js`. A student sees confirmed links only.

### Hub practice and explanations (0026)

A student account's practice outside rooms (Phase 6, decisions H5 to H8 and H14).
**Not `answers`**: `answers.session_id` is not null, every answer there is an answer in
a room, and attainment and the register read every one. A hub attempt has its own
table, which no room, attainment figure or marks register reads. Mastery (Elo), the
error log and spaced review are worked out from these rows when asked for
(`services/hubElo.js`, `hubErrors.js`, `hubReview.js`); nothing derived is stored.
RLS on, no policies, on both.

#### hub_attempts (0026, 0028, 0029)

One row per attempt a signed-in student makes in the hub, every one kept.
**Append-only evidence**, guarded as `0012` guards answers.

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | primary key, `gen_random_uuid()` |
| `account_id` | uuid | not null; references `accounts(id)` on delete cascade. An attempt carries no roll number, so kept without its account it would be nobody's. (Room answers keep theirs under the roll number; whether erasure should work the same way for both waits on the legal review, `docs/PRODUCT_DECISIONS.md`, decisions 8 and 9) |
| `client_attempt_id` | text | not null; 8 to 64 letters, digits, `-` or `_` (`hub_attempts_client_attempt_id_check`). The client's idempotency key: unique per account (`hub_attempts_account_attempt_key`), so a resent attempt gets the stored row back, never a second |
| `class_id` | uuid | null; references `classes(id)` on delete set null. The class through which the student reached the chapter |
| `content_id` | uuid | null; references `contents(id)` on delete set null |
| `topic_id` | uuid | null; references `chapter_topics(id)` on delete set null |
| `topic` | text | not null, default `''`. The topic's name when the attempt was made, kept for good |
| `question_id` | uuid | null; references `questions(id)` on delete set null |
| `bloom` | text | not null; one of the six levels, spelt `analyse` (`hub_attempts_bloom_check`) |
| `kind` | text | not null, default `mcq`; 1 to 40 characters, never `poll` (`hub_attempts_kind_check`): a poll assesses nothing |
| `question_snapshot` | jsonb | not null, default `{}`. The question as asked, answer key included: staff and server data, like `answers.question_snapshot` |
| `question_source` | text | not null, default `llm`; no check |
| `response` | jsonb | null; what the student sent |
| `correct` | boolean | not null |
| `score` | numeric(4,3) | not null; 0 to 1 (`hub_attempts_score_check`) |
| `detail` | text | not null, default `''` |
| `review_status` | text | not null, default `auto`; `auto`, or `provisional` for a written answer's machine mark (`hub_attempts_review_status_check`). `confirmed` and `overridden` are refused |
| `mode` | text | not null; `practice`, `exam` (a self-test), `getready`, `review` or `lesson` (`hub_attempts_mode_check`) |
| `language` | text | not null, default `en`; two or three lower-case letters (`hub_attempts_language_check`). The language the question was shown in |
| `hints_used` | smallint | not null, default 0; 0 to 3 (`hub_attempts_hints_used_check`), and 0 unless the mode is `practice`, `review` or `lesson` (`hub_attempts_hints_mode_check`, `0029`). How it is counted is the server's (below) |
| `time_taken_ms` | integer | null, or 0 to 86400000, a day (`hub_attempts_time_taken_check`). As the device reported it; never used for marking or ordering |
| `created_at` | timestamptz | not null, default now(). The server's clock (the repo sends it), the only one used for ordering, sessions and due dates |
| `run_id` | uuid | null (`0028`); references `hub_runs(id)`, no delete action (`hub_attempts_run_id_fkey`). The Get Ready check or self-test the attempt was given in; null for practice, review and lessons, and for every attempt before `0028` |

Indexes: the unique `(account_id, client_attempt_id)`; `hub_attempts_account_idx` on
`(account_id, created_at)` (a student's own reads); `hub_attempts_topic_idx` on
`(topic_id, created_at)` (mastery is worked out over everyone's attempts on a topic);
`hub_attempts_question_idx` (`question_id`); `hub_attempts_run_idx` on `run_id` where
not null (`0028`). None on `class_id` or `content_id`.

Trigger `hub_attempts_append_only` (function of the same name, `0026`), `before update
or delete`: refuses (23001) any UPDATE except inside a foreign key's own action that
only clears `class_id`, `content_id`, `topic_id` or `question_id` (that row deleted),
and any DELETE except the cascade from the student's account, whoever sends it. So
`run_id` never changes once written.

Trigger `hub_attempts_in_own_run` (function of the same name, `0028`), `before
insert`: an attempt with a `run_id` must be the run's own student's, and its `mode`
the run's `kind` (`getready` or `exam`); otherwise 23514, so an answer is never filed
under someone else's self-test. A `run_id` naming no run is refused the same way.

Check `hub_attempts_hints_mode_check` (`0029`): `hints_used = 0 or mode in
('practice', 'review', 'lesson')`, so a self-test or Get Ready attempt carries no
hints (H10, H13). **Added NOT VALID**: rows written before `0029` are not checked, so
no old row can stop the file; every new row is.

`hints_used` is counted by the server, not the database (`hintsUsedFor` in
`services/hubTutor.js`, through the hint hook `services/hubHintHook.js`): the distinct
hints the account opened on the question since its previous answer to that question,
under any attempt id (those opened under the answer's own attempt id always count), at
most 3, and always 0 in `exam` and `getready`. The database holds only the range and
the mode check. (`0029`'s comments say the count is of the hint views under the
attempt's own id; the server's rule is the one above.)

Written by repo `addHubAttempt` (a 23505 on the key returns the stored row, marked a
duplicate) from `recordAttempt` in `services/hubPractice.js`: practice and review
(`POST /api/hub/practice/attempts`), Get Ready answers (`services/hubGetReady.js`) and
self-test answers (`services/hubExam.js`), each of the last two with its `run_id`; and
from `services/hubAttemptBridge.js` with mode `lesson` (`POST
/api/hub/lessons/:lessonId/questions/:questionId/attempts`). Lesson answers are written
now and count in the student's mastery, error log and reviews like practice; the table
has no column for the lesson, its version or the translation shown. `run_id` is sent
only when there is one, so practice still saves on a database without `0028`. Read by
`getHubAttemptByKey` and `listHubAttempts` (by account, accounts, topics, questions,
runs, since a time; long id lists in chunks of 100) from `services/hubPractice.js`,
`hubProgress.js`, `hubGetReady.js`, `hubExam.js`, `hubTutor.js`,
`hubAttemptBridge.js`, `routes/hubPaths.js`, `routes/hubLessons.js` and
`routes/hubLanguages.js` (attempts by language).

#### question_explanations (0026)

One explanation per question (H14): why the right answer is right, shown to a student
only after they have attempted the question, and only once approved.

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | primary key |
| `question_id` | uuid | not null; references `questions(id)` on delete cascade. One per question (`question_explanations_question_key`) |
| `text` | text | not null; 1 to 2000 characters once trimmed (`question_explanations_text_check`) |
| `provenance` | text | not null; `ai` (drafted by the model on the professor's button) or `professor` (`question_explanations_provenance_check`) |
| `status` | text | not null, default `draft`; `draft` or `approved`. A professor's is approved when written (its author is its approver); approved exactly when `approved_at` is set (`question_explanations_status_check`) |
| `model` | text | null; only on an `ai` one (`question_explanations_model_check`) |
| `source_ref` | jsonb | null; an object when set (`question_explanations_source_ref_check`): the slides it cites, `{"kind": "slides", "slides": [2]}` |
| `created_by`, `approved_by` | uuid | null; reference `accounts(id)` on delete set null |
| `created_at`, `updated_at` | timestamptz | not null, default now(); the repo sets `updated_at` |
| `approved_at` | timestamptz | null |

No trigger and no index but the unique `question_id`: an explanation is not evidence,
and may be rewritten (a professor's edit makes it theirs: provenance `professor`, no
model) or deleted. Approving an AI draft keeps provenance `ai`.

Written by repo `addQuestionExplanation` (a 23505 becomes a 409),
`updateQuestionExplanation` and `deleteQuestionExplanation`, from
`routes/hubPractice.js` (`PUT` and `DELETE /api/hub/questions/:questionId/explanation`,
`POST .../explanation/approve`, and the drafts of `POST /api/hub/explanations/generate`,
which fills only questions with none). Read by `getQuestionExplanation` and
`listQuestionExplanations` (`routes/hubPractice.js`, `routes/hubLanguages.js`,
`services/hubExplanations.js`, `services/hubLanguages.js`). Its Hindi and Marathi
versions are `item_translations` rows of kind `explanation`, whose `item_id` is the
question's id.

### Lessons and languages (0027)

A topic's lesson from the professor's own slides (H11), and Hindi and Marathi versions
of what a student reads (H12), each generated only on the professor's button
(decision 5) and approved before a student sees it (decision 1). Nothing is added to
`answers`, `questions`, `sessions` or `profiles`: a lesson's retrieval questions are
ordinary bank rows written as drafts, and a student's answers inside a lesson are
`hub_attempts` rows (mode `lesson`). RLS on, no policies, on all three.

#### topic_lessons

One row per version of a topic's lesson. **Written once**: what a student read is kept
as they read it; only the status moves on.

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | primary key |
| `topic_id` | uuid | not null; references `chapter_topics(id)` on delete cascade; a topic of the lesson's own chapter (trigger) |
| `content_id` | uuid | not null; references `contents(id)` on delete cascade |
| `owner_id` | uuid | null; references `accounts(id)`, no delete action. The chapter's owner (trigger); null only for a chapter made before accounts |
| `version` | integer | not null, at least 1 (`topic_lessons_version_check`); unique with `topic_id` (`topic_lessons_topic_version_key`) |
| `status` | text | not null, default `draft`; `draft`, `approved`, `superseded` or `discarded`. `approved_at` is set exactly when approved or superseded, `retired_at` exactly when superseded or discarded (`topic_lessons_status_check`) |
| `source` | text | not null; `llm` (an AI draft) or `slides` (slides only: the professor's chunks and questions already approved, no generated prose). `model` is null exactly when `source` is `slides` (`topic_lessons_source_check`) |
| `model` | text | null; the model an AI draft came from |
| `steps` | jsonb | not null; a non-empty array of objects whose `type` is `chunk`, `example` or `questions` (`topic_lessons_steps_check`). The lesson in order: a chunk of the professor's own slide text cited by slide number, a worked example (an AI draft), the ids of the retrieval questions (bank drafts, through the normal approval gate), the next chunk. How many questions is the server's rule |
| `basis` | jsonb | not null, default `{}`; an object (`topic_lessons_shape_check`). What the chunks were read from: each slide's own words, the chapter's text cited by the topic's slide numbers, or pasted text |
| `warnings` | jsonb | not null, default `[]`; an array (`topic_lessons_shape_check`) |
| `created_at` | timestamptz | not null, default now() |
| `created_by`, `approved_by`, `retired_by` | uuid | null; reference `accounts(id)` on delete set null |
| `approved_at`, `retired_at` | timestamptz | null |

Indexes: `topic_lessons_one_approved`, unique on `topic_id` where `status =
'approved'` (one lesson serving per topic); `topic_lessons_content_idx`
(`content_id`); the unique `(topic_id, version)`.

Trigger `topic_lessons_guard` (function of the same name), `before insert or update or
delete`. An INSERT must be a draft (23514), of a topic of its chapter (23503), owned
by the chapter's owner (23514). An UPDATE may change only `status` and who approved or
retired it and when (23001); the status moves from draft to approved or discarded,
and from approved to superseded, nothing else (23514); who approved it and when,
once set, never change (23001). Inside a foreign key's action only `created_by`,
`approved_by` and `retired_by` may be cleared. A DELETE only inside a foreign key's
action, the cascade from its topic or chapter (23001).

Written by repo `createTopicLesson` (a 23505 on the version becomes a 409, try again)
from `services/hubLessons.js` (the background run of `POST
/api/hub/topics/:topicId/lessons/generate`); `approveTopicLesson`
(`approve_topic_lesson`, below; `POST /api/hub/lessons/:lessonId/approve`), so
regenerating keeps the approved lesson serving until the new one is approved; and
`discardTopicLesson` (an update where it is still a draft; `POST .../discard`), from
`routes/hubLessons.js`. Read by `getTopicLesson` and `listTopicLessons`
(`routes/hubLessons.js`, `routes/hubLanguages.js`, `routes/hubTutor.js`,
`services/hubLessons.js`, `services/hubLanguages.js`). A student reads the approved
lesson only.

#### item_translations

A Hindi or Marathi version of one item a student reads, in one generic shape.

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | primary key |
| `item_kind` | text | not null; `question`, `lesson`, `explanation`, `hint` or `feedback` (`item_translations_kind_check`). All five are in use: `hint` and `feedback` by the tutor (`0029`) |
| `item_id` | uuid | not null. **No foreign key**: it points into several tables. The question's id for `question`, and for `explanation` too (an explanation is one per question); the `topic_lessons` id for `lesson`; the `question_hints` id for `hint`; the `option_feedback` id for `feedback` |
| `content_id` | uuid | not null; references `contents(id)` on delete cascade. The item's chapter |
| `owner_id` | uuid | null; references `accounts(id)`, no delete action. The chapter's owner (trigger) |
| `language` | text | not null; `hi` or `mr` (`item_translations_language_check`) |
| `fields` | jsonb | not null; an object: the translated text by field name, a string or a list of strings. `text` and `options` for a question (never its key), `steps.<n>.text` and the like for a lesson, `explanation`, `hint` and `feedback` for those kinds |
| `source_fields` | jsonb | not null; an object: the English it was made from |
| `source_hash` | text | not null; 64 lower-case hex digits. A translation whose English has changed since is never shown. `fields`, `source_fields`, `checks` and the hash are checked together (`item_translations_shape_check`) |
| `status` | text | not null, default `draft`; as `topic_lessons` (`item_translations_status_check`) |
| `provenance` | text | not null; `ai` (made on the professor's button) or `professor` (written or edited by the professor) (`item_translations_provenance_check`) |
| `model` | text | null; no check ties it to `provenance` |
| `checks` | jsonb | not null, default `[]`; an array: what the translation check found (formulas, numbers or a list's length that differ) |
| `created_at`, `updated_at` | timestamptz | not null, default now(); the repo sets `updated_at` on every edit of a draft |
| `created_by`, `edited_by`, `approved_by`, `retired_by` | uuid | null; reference `accounts(id)` on delete set null |
| `approved_at`, `retired_at` | timestamptz | null |

Indexes: `item_translations_one_approved`, unique on `(item_kind, item_id, language)`
where approved; `item_translations_item_idx` on `(item_kind, item_id)`;
`item_translations_content_idx` (`content_id`).

Trigger `item_translations_guard` (function of the same name), `before insert or
update or delete`. An INSERT must be a draft and owned by the chapter's owner (23514).
`fields`, `source_fields`, `source_hash`, `checks`, `provenance`, `updated_at` and
`edited_by` may change only while the row is a draft and stays one; the item, chapter,
owner, language, model and creation never (23001). The status moves as a lesson's
(23514), and who approved it and when are written once (23001). Inside a foreign key's
action only the four account columns may be cleared. A DELETE only inside a foreign
key's action, the cascade from its chapter (23001): with no foreign key on `item_id`, a
translation outlives its item (a deleted question, hint or feedback row, or a lesson
that went with its topic) and goes only with its chapter.

Written by repo `addItemTranslation`, `editItemTranslation` (where still a draft,
else a 409), `approveItemTranslation` (`approve_item_translation`, below) and
`discardItemTranslation`, from `routes/hubLanguages.js` (`POST /api/hub/translations`,
`POST /api/hub/chapters/:contentId/translations/generate`, `PATCH`, `.../approve` and
`.../discard` under `/api/hub/translations/:translationId`). Read by
`getItemTranslation` and `listItemTranslations` (`routes/hubLanguages.js`,
`services/hubLanguages.js`, whose `servableTranslations` every student read of a
question, lesson, explanation, hint or feedback goes through).

#### student_language_choices

| Column | Type | Rules |
|---|---|---|
| `account_id` | uuid | primary key; references `accounts(id)` on delete cascade. One row per student |
| `language` | text | not null; `en` (the original), `hi` or `mr` (`student_language_choices_language_check`) |
| `updated_at` | timestamptz | not null, default now() |

Written by repo `setLanguageChoice` (an upsert on `account_id`) from `PUT
/api/hub/language` (students only); read by `getLanguageChoice`
(`services/hubLanguages.js`). A translation is shown only once approved; otherwise
English, with a note.

### Get Ready checks, self-tests and goals (0028)

A Get Ready check (H9) and a self-test (H10) are each a run of hub attempts that
belong together. Their answers are `hub_attempts` rows (mode `getready` or `exam`)
with the run's `run_id` (above); a run adds what the attempts alone cannot say. A goal
(H16) is a student's own plan. RLS on, no policies, on both.

#### hub_runs

One row per Get Ready check or self-test a signed-in student starts. **Written once,
then ended once.**

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | primary key |
| `account_id` | uuid | not null; references `accounts(id)` on delete cascade |
| `client_run_id` | text | not null; 8 to 64 letters, digits, `-` or `_` (`hub_runs_client_run_id_check`). The client's idempotency key: unique per account (`hub_runs_account_run_key`), so a resent start returns the stored run |
| `kind` | text | not null; `getready` or `exam` (a self-test) (`hub_runs_kind_check`) |
| `spec` | jsonb | not null, default `{}`; an object (`hub_runs_spec_check`). What was fixed at the start: a check's target and its prerequisites, nearest first; a self-test's topics, levels and list of questions |
| `time_limit_seconds` | integer | null, or on a self-test only 60 to 10800 (one minute to three hours) |
| `started_at` | timestamptz | not null, default now() |
| `deadline_at` | timestamptz | null; set exactly with a time limit, to `started_at` plus it (`hub_runs_time_limit_check`, with the limit) |
| `ended_at` | timestamptz | null; not before `started_at` |
| `end_reason` | text | null; set exactly with `ended_at`. A check ends `complete`; a self-test `submitted`, or `timed-out` only with a time limit (`hub_runs_end_check`) |

Index `hub_runs_account_idx` on `(account_id, started_at)`.

Trigger `hub_runs_written_once` (function of the same name), `before update or
delete`: the only UPDATE is ending an open run, setting `ended_at` and `end_reason`
and nothing else; a DELETE only inside a foreign key's action, the cascade from the
student's account (both 23001). `hub_attempts.run_id` has no delete action and is
checked at the end of the statement, so an account's cascade removes its runs and
their attempts together, and a run is never deleted on its own.

Written by repo `addHubRun` (a 23505 on the key returns the stored run, marked a
duplicate) and `endHubRun` (an update where `ended_at` is still null, then the run as
it stands), from `services/hubGetReady.js` (`POST /api/hub/getready`) and
`services/hubExam.js` (`POST /api/hub/exams`, `POST /api/hub/exams/:examId/submit`).
Read by `getHubRun`, `getHubRunByKey` and `listHubRuns` (`services/hubGetReady.js`,
`hubExam.js`, `hubHeld.js`, `hubRuns.js`, `routes/hubPaths.js`). A timed self-test
ends at its deadline plus a grace of 30 seconds on the server's clock
(`EXAM_GRACE_SECONDS`), written on the next request about it.

#### hub_goals

A student's goal: an exam date and the topics it covers. **Not evidence**: the student
changes or removes it at will, and no trigger guards it. Shown only to that student.

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | primary key |
| `account_id` | uuid | not null; references `accounts(id)` on delete cascade |
| `title` | text | not null, default `''`; at most 80 characters (`hub_goals_title_check`) |
| `exam_date` | date | not null |
| `topic_ids` | jsonb | not null; an array of 1 to 60 (`hub_goals_topic_ids_check`): the topic records it covers. Not foreign keys: a deleted or unplaced topic shows in the goal as no longer on the student's classes |
| `created_at`, `updated_at` | timestamptz | not null, default now(); the repo sets `updated_at` |

Index `hub_goals_account_idx` (`account_id`).

Written by repo `addHubGoal`, `updateHubGoal` and `deleteHubGoal` from
`services/hubGoals.js` (`POST`, `PATCH` and `DELETE /api/hub/goals...`); read by
`listHubGoals` and `getHubGoal`. The server allows at most 10 goals per student and an
exam date not in the past when it is set or changed (India's day); the database checks
neither.

### The tutor (0029)

Hint ladders and feedback on wrong options (H13), with **no live model call**: each is
made from the professor's own slides on the professor's button, or written by the
professor, and approved before any student sees it. Each hint a student opens is kept.
RLS on, no policies, on all three.

#### question_hints

One row per hint step of a question.

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | primary key |
| `question_id` | uuid | not null; references `questions(id)` on delete cascade |
| `step` | smallint | not null; 1 (a nudge), 2 (a strategy) or 3 (a worked step that stops short of the answer) (`question_hints_step_check`). Unique with `question_id` (`question_hints_question_step_key`) |
| `text` | text | not null; 1 to 600 characters once trimmed (`question_hints_text_check`) |
| `provenance` | text | not null; `ai` or `professor` (`question_hints_provenance_check`) |
| `status` | text | not null, default `draft`; `draft` or `approved`. A professor's is approved as written; approved exactly when `approved_at` is set (`question_hints_status_check`) |
| `model` | text | null; only on an `ai` hint (`question_hints_model_check`) |
| `source_ref` | jsonb | null; an object when set (`question_hints_source_ref_check`): the slides it cites |
| `created_by`, `approved_by` | uuid | null; reference `accounts(id)` on delete set null |
| `created_at`, `updated_at` | timestamptz | not null, default now(); the repo sets `updated_at` |
| `approved_at` | timestamptz | null |

No trigger. The server refuses a hint that holds the answer (`answerLeak` in
`services/hubTutor.js`) and checks again before showing one, because a question's key
can change after; the database does not.

#### option_feedback

One row per wrong option of a choose-one, choose-all-that-apply or true-or-false
question that has feedback: what a student who chose it most likely confused, and what
to look at again. Keyed by the option's **words**, not its position, as misconception
labels are (`0024`): a reorder keeps it on its option, and a reworded option or one
that became a right answer is simply not shown any more.

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | primary key |
| `question_id` | uuid | not null; references `questions(id)` on delete cascade |
| `option` | text | not null; the option's words when the feedback was written |
| `option_key` | text | not null; those words in lower case with runs of space made one, as the server compares options. Both 1 to 1000 characters once trimmed (`option_feedback_option_check`). Unique with `question_id` (`option_feedback_question_option_key`) |
| `text` | text | not null; 1 to 600 characters once trimmed (`option_feedback_text_check`) |
| `provenance`, `status`, `model`, `source_ref`, `created_by`, `created_at`, `updated_at`, `approved_by`, `approved_at` | | as `question_hints` (`option_feedback_provenance_check`, `_status_check`, `_model_check`, `_source_ref_check`) |

No trigger. Shown after a student chooses that option, and offered as the first hint
when they meet the question again.

`question_hints` and `option_feedback` are written by repo `addQuestionHint` and
`addOptionFeedback` (a 23505 becomes a 409) from `routes/hubTutor.js` (the
professor's own, approved as written: `PUT /api/hub/questions/:questionId/hints/:step`
and `PUT .../feedback/:option`) and `services/hubTutor.js` (AI drafts from `POST
/api/hub/chapters/:contentId/hints/generate`); by `updateQuestionHint` and
`updateOptionFeedback` (an edit, and `POST /api/hub/questions/:questionId/hints/approve`);
and by `deleteQuestionHint` and `deleteOptionFeedback` (`DELETE` on the same paths).
Read by `listQuestionHints`, `getQuestionHint`, `listOptionFeedback` and
`getOptionFeedback`. Their Hindi and Marathi versions are `item_translations` rows of
kind `hint` and `feedback`, keyed by the row's own id.

#### hub_hint_views

One row per hint a student opened, before answering, in practice, a review set or a
lesson (never in a self-test or Get Ready). **Append-only evidence** of how the answer
was reached.

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | primary key |
| `account_id` | uuid | not null; references `accounts(id)` on delete cascade |
| `client_attempt_id` | text | not null; 8 to 64 letters, digits, `-` or `_` (`hub_hint_views_client_attempt_id_check`). The attempt id the hint was opened for, the idempotency key the attempt then carries |
| `question_id` | uuid | null; references `questions(id)` on delete set null |
| `topic_id` | uuid | null; references `chapter_topics(id)` on delete set null |
| `content_id` | uuid | null; references `contents(id)` on delete set null |
| `mode` | text | not null; `practice`, `review` or `lesson` (`hub_hint_views_mode_check`) |
| `position` | smallint | not null; 1 to 3, its place in the order shown (`hub_hint_views_position_check`). Unique with `(account_id, client_attempt_id)` (`hub_hint_views_attempt_position_key`) |
| `kind` | text | not null; `feedback`, `nudge`, `strategy` or `worked` (`hub_hint_views_kind_check`) |
| `hint_id` | uuid | null. The `question_hints` or `option_feedback` row it came from; no foreign key, since that row may be edited or removed later |
| `text` | text | not null; 1 to 4000 characters once trimmed (`hub_hint_views_text_check`). The words shown |
| `provenance` | text | not null; `ai` or `professor`: who wrote what was shown (`hub_hint_views_provenance_check`) |
| `language` | text | not null, default `en`; two or three lower-case letters (`hub_hint_views_language_check`) |
| `translation_id` | uuid | null; the approved translation shown, if any. No foreign key |
| `source_ref` | jsonb | null; an object when set: the slides cited |
| `plan` | jsonb | not null, default `{}`; an object (`hub_hint_views_shape_check`, with `source_ref`). The plan the server chose for this attempt: which hints, in which order, and the student's own sentence saying why |
| `created_at` | timestamptz | not null, default now() |

Indexes: the unique `(account_id, client_attempt_id, position)`;
`hub_hint_views_attempt_idx` on `(account_id, client_attempt_id)`;
`hub_hint_views_question_idx` (`question_id`).

Trigger `hub_hint_views_append_only` (function of the same name), `before update or
delete`, as `hub_attempts`' guard: refuses (23001) any UPDATE except a foreign key's
own action clearing `question_id`, `topic_id` or `content_id`, and any DELETE except
the cascade from the student's account. A deleted question takes its hints and
feedback and leaves the views, with the words that were shown.

Written by repo `addHintView` (a 23505 on the position returns the stored row, marked
a duplicate) from `services/hubTutor.js` (`POST /api/hub/practice/hints` and `POST
/api/hub/lessons/:lessonId/questions/:questionId/hints`). Read by `listHintViews` (by
account, attempt id, questions) from `services/hubTutor.js` (a reload's hints, and
`hints_used`, above) and `routes/hubTutor.js` (staff: how often each hint was opened).

### question_packs (0030)

One row each time the server hands a phone a pack of the questions it would be served
next, for use while its connection is down (decision O3). Ids only: the questions as
shown are the bank's, sent without their keys. **Written once**; a new pack is a new
row. In `ROOM_SCHEMA`: rooms need it.

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | primary key |
| `session_id` | uuid | not null; references `sessions(id)` on delete cascade |
| `roll_no` | text | not null; the phone's roll number as the room keeps it |
| `question_ids` | uuid[] | not null; `question_packs_questions_check`: one dimension, 1 to 20 ids (the server sends at most 5), no null. In the order the phone works through them |
| `issued_at` | timestamptz | not null, default now(). When the pack was recorded, just before it was sent; an answer to one of its questions is taken as served from then |
| `expires_at` | timestamptz | not null; after `issued_at` (`question_packs_expiry_check`). Six hours after it (`PACK_HOURS`); the room's close ends it sooner. Expiry only tells the phone to stop offering it |

Index `question_packs_room_roll_idx` on `(session_id, roll_no, issued_at)`. Trigger
`question_packs_written_once` (function of the same name), `before update or delete`:
refuses every UPDATE, and every DELETE except inside a foreign key's own action
(`pg_trigger_depth() > 1`, the cascade from the room). RLS on, no policies.

Written by repo `addQuestionPack` from `packOnce` (`sockets/index.js`), at most 50 per
phone per room (`PACK_RECORD_LIMIT`; a row is written only when the pack gains a
question the live one lacks). Read by `listQuestionPacks(sessionId, rollNo)`, oldest
first: by `packOnce` (the live pack) and by `handleAnswer` for an answer not to the
pinned question (when, if ever, it was given). Not in the room archive.

### room_imports (0031)

One row per room file imported from laptop mode (decision O4,
`services/roomImport.js`). The room itself is written to `sessions`, `profiles`,
`answers`, `answer_reviews`, `attendance` and `class_questions` like any room; this row
says where it came from. **Written once.** In `ROUTE_SCHEMA`: without it, imports fail
naming `0031`, staff views show no room as imported, and the live loop treats every room
as not imported.

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | primary key |
| `source_room_id` | text | not null, unique (`room_imports_source_room_id_key`); the room's id on the laptop, `^[A-Za-z0-9-]{1,64}$`. The import is idempotent by it |
| `source_code` | text | not null; the room's code on the laptop, `^[A-Z0-9]{4,16}$`. The imported room keeps it unless that code is taken here, when it gets a fresh one (the column's comment in `0031` predates that rule) |
| `source` | jsonb | not null, default `{}`, an object: `{ run, startedAt }`, which run of the laptop server saved the file (a random tag, never the machine's name) |
| `session_id` | uuid | null, unique (`room_imports_session_id_key`); references `sessions(id)` on delete set null. The room it became |
| `owner_id`, `imported_by` | uuid | null; reference `accounts(id)` on delete set null. Null under the shared key |
| `imported_at` | timestamptz | not null, default now() |
| `archived_at` | timestamptz | null; when the laptop saved the file |
| `bytes` | integer | not null; 1 to 1048576 (`room_imports_bytes_check`) |
| `sha256` | text | not null; 64 lower-case hex (`room_imports_sha256_check`); a later file for the same room is recognised as different |
| `summary` | jsonb | not null, default `{}`, an object: what the import made, in counts and sentences |
| `data` | jsonb | not null, an object: the archive as uploaded (with no integrity signal for a student the roster marks under 18). Teacher-only, like `room_archives.data`: it holds answer keys, names and roll numbers, and what was not made into rows (the laptop's teacher records, marks the roster could not take) |

`room_imports_source_check` holds the id, code and object shapes above. Index
`room_imports_owner_idx` on `(owner_id, imported_at desc)`. Trigger
`room_imports_written_once` (function `room_imports_keep_record`), `before update`:
refuses every UPDATE except a foreign key's ON DELETE SET NULL on `session_id`,
`owner_id` or `imported_by`. A delete is allowed (erasure, decision 8). RLS on, no
policies.

Written by repo `importRoom` (with the room's rows, in one call; on Supabase table by
table, deleting the session on a failure after it). Read by `getRoomImportBySource` (the
idempotency check), `listRoomImports` (`GET /api/imports/rooms`; on Supabase the newest
1000, without `data`) and `listRoomImportsForSessions` (by room id: `importedFrom` on
staff views, and the live loop's refusal of deliveries to an imported room).

### record_writes (0032)

One row per teacher-record or attendance write first made with an `Idempotency-Key` in a
room (`routes/recordSync.js`): the reply of that first write, given back unchanged to
every replay. Receipts, not records. In `ROUTE_SCHEMA`: without it, a write sent with a
key fails naming `0032`; one without a key works.

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | primary key |
| `session_id` | uuid | not null; references `sessions(id)` on delete cascade |
| `writer` | text | not null, 1 to 64 characters: the account id, or `shared-key` for the v1 teacher key |
| `write_key` | text | not null; `^[A-Za-z0-9_-]{8,64}$`. Unique with `(session_id, writer)` (`record_writes_session_writer_key_key`, also the index a replay reads by) |
| `route` | text | not null; `^[a-z][a-z-]{0,39}$`: `attendance`, `observation`, `wheel-settings`, `wheel-draw`, `wheel-round`, `wheel-pick`, `tally`, `tally-edit`, `tally-increment`, `tally-decrement`, `activity`, `activity-edit`, `insight-action` |
| `target` | text | not null, default `''`, at most 64: the record the path names (a pick's, tally's or activity's id, lower case), `''` for none |
| `body_hash` | text | not null; 64 hex: SHA-256 of the route, the target and the body in a canonical form. The same key with another hash is a 409 |
| `status` | integer | not null; 200 to 299 only: a refusal is never kept |
| `reply` | jsonb | not null, default `{}`, an object: the whole first reply (one record for most writes; the class register for attendance, the wheel for a wheel write; tens of kilobytes at most) |
| `created_at` | timestamptz | not null, default now() |

Trigger `record_writes_append_only`, `before update or delete`, runs `0017`'s
`teacher_records_guard()` with no changeable column: never edited, deleted only in the
cascade from its room. RLS on, no policies. **Retention**: as long as the room; not in
its archive; nothing prunes rows sooner. Written by repo `addRecordWrite` (a 23505 on the
unique key means it is held already), read by `getRecordWrite({ sessionId, writer, key
})`.

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

Phase 6 (`0025` to `0029`); each table's section above has the detail. Every function
is plpgsql and security invoker.
- **`public.class_chapters_in_class()`** with trigger **`class_chapters_in_class`**,
  `before insert or update on class_chapters` (`0025`): the unit is one of the
  class's (23503), and the chapter's owner is the class's owner (23514).
- **`public.topic_links_guard()`** with trigger **`topic_links_guard`**, `before
  insert or update on topic_links` (`0025`): both topics' chapters are the link
  owner's, and a `confirmed` link closes no loop: walking confirmed links on from its
  topic, leaving itself out, must not reach its prerequisite (a recursive query).
  Both 23514.
- **`public.hub_attempts_append_only()`** with trigger **`hub_attempts_append_only`**,
  `before update or delete on hub_attempts` (`0026`): written once; only a foreign
  key's action may clear `class_id`, `content_id`, `topic_id` or `question_id`, and
  only the account's cascade may delete (23001).
- **`public.topic_lessons_guard()`** with trigger **`topic_lessons_guard`**, `before
  insert or update or delete on topic_lessons` (`0027`): a lesson is inserted as a
  draft of its own chapter's topic and owner; afterwards only its status moves (draft
  to approved or discarded, approved to superseded), with who decided and when
  written once; deleted only with its topic or chapter.
- **`public.approve_topic_lesson(p_lesson uuid, p_by uuid) returns setof
  public.topic_lessons`** (`0027`), `search_path = public`. Locks the lesson (`for
  update`); returns no row when there is none; raises 23514 (`only a draft lesson can
  be approved; lesson <id> is <status>`) when it is not a draft, which the repo
  answers as a 409. Otherwise, in one call, moves the topic's approved lesson to
  `superseded` (`retired_at` now, `retired_by` `p_by`) and approves this one
  (`approved_at` now, `approved_by` `p_by`), returning it, so a topic is never left
  with none serving between two writes. Called as `rpc('approve_topic_lesson', {
  p_lesson, p_by })` by `approveTopicLesson` (`POST /api/hub/lessons/:lessonId/approve`).
- **`public.item_translations_guard()`** with trigger **`item_translations_guard`**,
  `before insert or update or delete on item_translations` (`0027`): inserted as a
  draft with its chapter's owner; its text may change only while it is a draft; its
  status moves as a lesson's, with who decided and when written once; deleted only
  with its chapter.
- **`public.approve_item_translation(p_translation uuid, p_by uuid) returns setof
  public.item_translations`** (`0027`), as `approve_topic_lesson`: the approved
  translation of the same item and language is superseded and this draft approved in
  one call. Called as `rpc('approve_item_translation', { p_translation, p_by })` by
  `approveItemTranslation` (`POST /api/hub/translations/:translationId/approve`).
- **`public.hub_runs_written_once()`** with trigger **`hub_runs_written_once`**,
  `before update or delete on hub_runs` (`0028`): the only change is ending an open
  run, once; deleted only by the account's cascade (23001).
- **`public.hub_attempts_in_own_run()`** with trigger **`hub_attempts_in_own_run`**,
  `before insert on hub_attempts` (`0028`): an attempt with a `run_id` is the run's
  student's, in the run's kind as its mode (23514).
- **`public.hub_hint_views_append_only()`** with trigger
  **`hub_hint_views_append_only`**, `before update or delete on hub_hint_views`
  (`0029`): as `hub_attempts_append_only`, for `question_id`, `topic_id` and
  `content_id`.

Phase 7 (`0030` to `0032`); each table's section above has the detail. Every function is
plpgsql, `search_path = ''`.
- **`public.question_packs_written_once()`** with trigger of the same name, `before
  update or delete on question_packs` (`0030`): no update; a delete only inside the
  room's cascade (`restrict_violation`).
- **`public.room_imports_keep_record()`** with trigger **`room_imports_written_once`**,
  `before update on room_imports` (`0031`): only a foreign key's set-null on
  `session_id`, `owner_id` or `imported_by` (`restrict_violation`).
- **`record_writes_append_only`**, `before update or delete on record_writes` (`0032`),
  runs `0017`'s `teacher_records_guard()` with no changeable column.

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
`insertQuestions` writes `misconceptions` with every question saved. Phase 6 adds
`0025` to `0029` to `ROUTE_SCHEMA` only (its fourteen tables, `contents.slide_texts`
and `hub_attempts.run_id`): a missing one is a boot-log line naming its file and what
fails, and rooms keep Supabase; the probe does not look for their functions, triggers
or `hub_attempts_hints_mode_check`.
