# Database schema

BloomLoop's production store is Supabase Postgres. The SQL that builds it is
`supabase/migrations/`, applied in number order (how: `supabase/README.md`). Every
file is idempotent and safe on a database holding real records. The test is
`cd server && npm run migrations` (`server/scripts/migrations.mjs`, PGlite).

Every table has row level security **on with no policies**. Only the server's
service role key, which bypasses RLS, can read or write; the anon key sees nothing.
The server is the only place authorization is decided.

Last revised 19 November 2026.

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

The SQL of every moved file is unchanged; only header comments were updated.

`0010` to `0015` have run only on PGlite (`npm run migrations`, 270 of 270 on
19 November 2026, rerun after the Phase 2 review fixes). `0010` to `0012` are
committed with Phase 1 (`05daf56`); `0013` to `0015` are not yet committed. The
live project has been unreachable since 18 November, so whether it has any of them
could not be checked. Apply them in order before deploying the Phase 1 and 2
server: the boot probe falls back to the in-process store when `answer_reviews`,
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

### questions (0000, 0001, 0013)

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
| `source` | text | not null, default `llm`; `llm` or `fallback` |
| `payload` | jsonb | not null, default `{}`. Every `PAYLOAD_FIELDS` entry (answers included): teacher-only data. `stimulus` is here too: a passage (`text`, optional `sourceRef`) or an image (`url`, `alt`, optional `sourceRef`); an uploaded image's url is `/api/media/<id>` (`media`, `0014`). Hot text, dropdown, table and grid, generated since Phase 2, keep `tokens`, `blanks`, `columns`, `rows` and `answers` here, so they needed no migration. (The Mongo fallback's schema did drop them on save; fixed in `server/src/models/index.js`, not run against a Mongo database) |
| `created_at` | timestamptz | not null, default now() |
| `model` | text | null. The model id that wrote it, `offline-template` for the offline generator, null for a professor's own question **and every row older than `0013`** (`0013`) |
| `source_ref` | jsonb | null; an object when set (`questions_source_ref_object`). `{"kind": "slides", "slides": [3, 4]}`: the slides the topic was read from (`0013`) |
| `checks` | jsonb | null; an array when set (`questions_checks_array`). The rule checks, `[{id, ok, message}]`, advice only; null = never checked (`0013`) |
| `created_by` | uuid | null; references `accounts(id)` on delete set null. Who made the row; null on the shared key (`0013`) |
| `approved_by` | uuid | null; references `accounts(id)` on delete set null. Null on the shared key (`0013`) |
| `approved_at` | timestamptz | null. Set whenever `approved_by` is (`questions_approval_pair`) (`0013`) |

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

### sessions (0000, 0001, 0005, 0007, 0015)

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
| `question_ids` | uuid[] | null. The room's question set: the only questions it may serve. Null is the whole approved bank, which every room before `0015` keeps. When set: one dimension, at least one id, no null (`sessions_question_ids_shape`). No foreign key (Postgres has none for array elements): the server checks each id is an approved question of the room's chapter when the room opens, and a question discarded or deleted later simply stops being served (`0015`) |

Written by: repo `createSession` from `routes/session.js` (the settings and the
question set are written here only, never updated); `updateSession` (status, title,
closed/paused times); `deleteSession`. `question_ids` is read on every bank load of
the live loop (`servableFor` in `services/selector.js`) and by the image rule
(`servedToPhones`), and returned by `POST /api/session`, `GET /api/session` and
`GET /api/session/:code/items`, never by the phones' `GET /api/session/:code`.

Index `sessions_content_idx` on `content_id` (`0014`): `listSessionsForContent`,
which serving an image to a phone asks on every request (is a room running on this
chapter?), and the cascade from deleting a chapter.

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
`account_id`; `question_id`; partial on `review_status` where `provisional`;
`answers_open_queue_idx` on `(session_id, answered_at desc)` where `kind = 'open'`
and `final` (`0010`, for the review queue).

Written by: repo `recordAnswer` from `sockets/index.js` (`handleAnswer`: final
answers, wrong attempts before a retry, polls); a 23505 on the unique key returns
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
`timeBase`. A column is left out only when every row rebuilds it exactly; `derived`
names those columns. Measured: a class of 60 students with 30 answers each is about
267 KB; 80 students with 60 answers each, a third of them written, about 693 KB.
`decodeRoomArchive()` gives back every answer and history entry field for field
(tested in `server/test/archive.test.js`).

Read by `GET /api/session/archives` (list, no data) and
`GET /api/session/archives/:id` (the `.json` file), both under the same ownership
rule as rooms.

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
it and without it no room could open.
