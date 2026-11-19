# Changelog

Newest first. Nothing below is deployed. The 18 November entries are committed as
`b4585a0` on branch `roadmap-phase0-evidence`, the Phase 1 entries of 19 November as
`05daf56` and the Phase 2 entries as `27559ca`. The Phase 3 entries of 19 November are
uncommitted.

## Unreleased: 19 November 2026

Server and database only; the client is the UI session's (`docs/UI_REBUILD.md`), and
no screen uses anything from Phase 3. At the end of Phase 1
every suite was rerun: unit 172/172, live loop 41/41, security 13/13, migrations
204/204, review 83/83, evidence 37/37, resume and integrity pass, and the
question-kind round trip had its 5 known failures. After Phase 2 and its review
fixes, the rerun gave unit 343/343, migrations 270/270, approval gate 73/73, kinds
43/43, media 67/67, items 49/49, live loop 41/41, security 13/13, review 83/83,
evidence 37/37, resume and integrity pass, and the round trip 0 failures. After
Phase 3 and its review fixes, the rerun through the offline runner gave unit
475/475, migrations 451/451, roster 80/80, records 97/97, modes 101/101, insights
65/65, and every earlier suite as before. Nothing was run against Supabase, Mongo,
Gemini or with a real Auth token (the Phase 3 suites answer the Auth calls
themselves).

### Phase 3: full rerun and docs

No code change. Every suite was run again through the offline runner after the
Phase 3 review fixes; each number above is what the run printed (`docs/TESTING.md`).
The new examples in `docs/API.md` were captured from a real server on the in-process
store with the network settings blanked.

- `docs/API.md`: an index of every new and changed Phase 3 endpoint and socket event,
  with who may call each, and what phones, teacher screens and the projector receive,
  with captured examples (the phone's new events and fields, the projector's three
  events and its 409 on revealing a bank key in a Mixed room, the teacher's grid with
  `rosterName`, `attendance`, `waiting` and `feed`). Two findings of the Phase 3 review
  not acted on, and a tally's increment and decrement pushing nothing, added to the
  open issues. Commit status and the client's status brought up to date.
- `docs/IMPLEMENTATION_STATUS.md`: one Phase 3 checklist by the roadmap's step 3
  items, in place of the four per-part lists; a box ticked only where an end-to-end
  test covers it, every screen unticked, and unticked lines for the phone's row
  still carrying the band, decision 7's attendance gap, the observations that go with
  their room, the "AI teaching move", and the absence of leaderboards (checked by
  reading only). "Absent (by roadmap phase)", the test table (475, 451, 80, 97, 101,
  65) and the risks updated: migrations `0013` to `0018` before the server, re-running
  `0005` once a room waits, the band on the phone, state held in one process, a
  deleted room's teacher channel, the Supabase row cap.
- `docs/TESTING.md`: the offline runner as the rule, with what it does and what a new
  script must do; the four Phase 3 scripts' newer checks; the full rerun.
- `docs/ARCHITECTURE.md`: who is sent what in a room (phones, teacher screens,
  projectors), the room locks, and the state held in memory.
- `docs/DATABASE_SCHEMA.md`: the `0005` re-run issue; the server-side text rules on
  classes, roster names, tallies, groups and flag ids; the roster read's row cap.
- `docs/PRODUCT_DECISIONS.md`: the defaults gathered for the owner (band cut points
  and minimum, Absent on the wheel, attendance, the waiting room, projector links,
  a dismissed card's "evidence changed", the KPI sampling, six levels and level bands
  side by side while decision 6 is open), with the projector rows brought up to date.

### Phase 3: fixes from the review

Server and docs only (uncommitted); no migration, no repo method and no new
dependency. Each fix has a check that failed before it. Suites after, all through the
offline runner: unit 475/475 (8 new), migrations 451/451, modes 101/101 (17 new, 1
replaced; five runs), records 97/97 (1 new), insights 65/65, roster 80/80, live loop
41/41, security 13/13, review 83/83, evidence 37/37, resume and integrity 0 failures,
round trip 0 failures, approval gate 73/73, kinds 43/43, media 67/67, items 49/49.

- **The projector never shows the key of a question a phone may still be served.**
  `PATCH /:code/projector { revealed: true }` on a bank question, or on a question asked
  aloud from the bank, is a 409 outside a Teacher-led room. A typed-in question's key
  may still go up anywhere.
- **The projector's progress screen** shows counts per level only once 5 students have
  answered (`levels: null` and `minAnswered: 5` before that): with one phone, the
  counts were that student's own answers.
- **A socket connection is a projector or a phone / teacher screen, never both.** The
  first of `projector:watch`, `student:*`, `teacher:watch` decides, before any await.
- **One 404 sentence** for a missing code and another professor's room on `GET /grid`,
  pause, resume, close, delete and the integrity read (`That session was not found.`).
- **Free text keeps no contact details**: a tally's text and labels, a group's label
  and a class's course, section and term refuse an email address or a mobile number,
  as notes did; a flag id must have the insights' shape (`focus:`, `support:`,
  `participation:`); a roster name with a short date (`12-5-04`) is refused.
- **First names on the projector stay off after a restart** for a room opened before
  it, rather than coming back on by themselves.
- **Projector links work for 12 hours** (`link.expiresAt`); a projector whose link
  runs out is dropped at the next change of screen.
- **Start, pause, resume and close take one status lock per room** and read the status
  again under it; a delete waits it out. A close during a start leaves the room closed
  (it used to be written back to open, its phones served after `session:closed`); of
  two starts one is a 409; a start serves only phones told to wait, so none is served
  twice. Each of these is a 409 while the room is being deleted.
- **A room opened for no class archives with no `classId` key**, byte for byte as before.
- **Attendance `fromJoins` is a 409 in a Teacher-led room**, where it marked the whole
  class absent.
- **Not fixed, for the owner** (`docs/PRODUCT_DECISIONS.md`): the phone's row and its
  band sentences (a `CONTRACT.md` conflict), re-running `0005` once a room is waiting
  (a one-line edit to an applied migration; `supabase/README.md` says how to re-run
  until then), and a class room's observations going with the room they were typed in.

### Phase 3: live insights, the student card and class analytics

Server only (uncommitted); no migration and no new dependency. One repo method,
`listSessionsForClass`, in all three repos. Suites after this work, all through the
offline runner: unit 467/467 (33 new), insights 65/65 (new; seven runs), migrations 451/451 (unchanged: no migration), modes 85, records 96, roster 80, and every other suite unchanged (live loop 41, security 13, review 83, evidence 37, resume and integrity 0 failures, round trip 0 failures, approval gate 73, kinds 43, media 67, items 49).

- **Three accuracy bands** for the live view: Needs support below 0.4 (exactly the
  engine's below-40% band), Developing, Excelling from 0.6, in one constant
  (`BAND_CUTS`), from 3 graded answers and null below. A default
  (`docs/PRODUCT_DECISIONS.md`): the handoff's code cut at 0.62, its own legend at 60%.
- **`GET /api/session/:code/insights`** (read rule): each student's band and why, the
  three sort orders (By band, Lowest first, Roll), the Focus, Support and Participation
  cards (evidence in the text, an action at the end, a flag id built from the
  evidence), KPI tiles for class accuracy, Needs support and participation with each
  one's start and change, a per-minute series for sparklines (in memory; lost on a
  restart), and a Mixed or Teacher-led room's teacher records counted apart (hands
  raised, answered aloud, observations by kind). Pushed as **`teacher:insights`** to the
  room's teacher screens only, at most once every 2 seconds per room.
- **Dismissing a card** is an insight action against its `flagId`; it stays dismissed
  until its evidence changes (another bottleneck level; a student entering or leaving
  Needs support; a present student answering for the first time, or a silent one
  marked present), and an "acted" ends it.
- **`GET /api/session/:code/students/:roll/card`** (read rule): band, the level being
  served and the ceiling, accuracy per level with the answers behind it and the
  class's, the last ten final answers in the professor's view, the next set as the
  selector itself would serve it (marked as a plan, not the handoff's fixed 3 + 1 + 1),
  and this room's records about the student. A roster student with no phone has one.
- **`GET /api/classes/:id/analytics?last=4|8`** (read rule on the class): the class's
  last rooms with accuracy, participation, attendance, band counts, six levels and
  decision 6's three level bands side by side, the trend, the histogram pooled per
  student, and the hardest questions through the item report; every figure with the
  answers it rests on. Empty lists for a class with no room.
- Nothing of it reaches a phone or the projector (searched over a whole run in
  `scripts/insights.mjs`); `buildGridRow` is unchanged.

### Phase 3: room modes, the waiting room and the projector

Server and database only (uncommitted); no new dependency. Migration `0018`. Suites
after this work, all through the offline runner: unit 434/434 (17 new), migrations
451/451 (37 new), modes 85/85 (new; five runs), records 96/96, roster 80/80, and every
other suite unchanged (live loop 41, security 13, review 83, evidence 37, resume and
integrity 0 failures, round trip 0 failures, approval gate 73, kinds 43, media 67,
items 49).

- **Room settings** on `POST /api/session`, all optional, today's behaviour by default
  and returned wherever settings are: `mode` (`devices`, `teacher-led`, `mixed`),
  `adapt` (off holds every student at the start level; the below-40% ceiling still
  applies, as the contract requires), `startLevel`, `questionsPerStudent` (then
  `server:exhausted` with a `reason`) and `timePerQuestion` (sent with each question;
  a late answer is never refused). Kept in a deleted room's archive when changed.
- **The waiting room**: `lobby: true` opens a room `waiting`; phones join and get
  `server:waiting`; `POST /api/session/:code/start` serves every waiting phone and
  opens the room; the teacher's grid has "N / M present". Every reader of a room's
  status handles `waiting` (pause and resume refuse it; the image rule and a
  replacing generate count it as running).
- **Teacher-led** needs a class; a phone that joins gets `session:teacher-led` and is
  never served, profiled or marked present; the records routes run the class.
  **Mixed** works as Student devices; in both, the teacher's grid carries `feed`, the
  digital answers and the teacher records each labelled, pushed after each record.
- **The projector**: a link per room (`/api/session/:code/projector/links`), its token
  stored as a SHA-256, revocable, dead once the room closes; `projector:watch` over the
  socket, then `projector:state` only. Question (no key until revealed), diagram (an
  image loadable with no credential, in a waiting room too) and class progress
  (counts); the wheel's pick as roll number and first name. Every payload passes one
  whitelist (`toProjector`), and `modes.mjs` walks every projector event of a run
  against its own copy.

### Phase 3: the teacher-record store

Server and database only (uncommitted); no new dependency. Migration `0017`. Suites
after this work, all through the offline runner: unit 417/417 (43 new), migrations
414/414 (88 new), records 96/96 (new), roster 80/80, and every other suite unchanged
(live loop 41, security 13, review 83, evidence 37, resume and integrity 0 failures,
round trip 0 failures, approval gate 73, kinds 43, media 67, items 49).

- **Observations** (`GET`, `POST /api/session/:code/observations`;
  `GET /api/classes/:id/students/:studentId/observations`): Understood,
  Participated, Needs revision, Needs additional support, with a short note. One per
  student per class per day, kept as an append-only log so a replaced or cleared mark
  is never lost.
- **The wheel** (`/api/session/:code/wheel`, `/draw`, `/rounds`, `/picks/:id`): a fair
  draw on the server with crypto randomness, stored before any screen spins; present
  only, no repeats, rounds, "N picked of M"; each pick's ask and response. Absent also
  marks attendance absent unless told not to. `pickForProjector` for the Modes work.
- **The raised-hands tally** (`/api/session/:code/tallies`): counts per option that
  never go below 0, revealed, the correct option, "N of M present responded".
- **No-device activities** (`/api/session/:code/activities`): the handoff's five; a
  group challenge records groups, never students.
- **Insight actions** (`/api/session/:code/insights/actions`): what a professor did
  about a flag, append-only, for the Insights work.
- All teacher-only, all working in a class room with no phone joined, none reaching a
  phone or the projector, none moving a level. A deleted room's archive keeps every
  record; a delete waits for a record being written.

### Phase 3: the roster, rooms opened for a class, and attendance

Server and database only (uncommitted); no new dependency. Migration `0016`.
Suites after this work, all through the offline runner: unit 374/374 (31 new),
migrations 326/326 (56 new), roster 80/80 (new), and every other suite unchanged
(live loop 41, security 13, review 83, evidence 37, resume and integrity 0 failures,
round trip 0 failures, approval gate 73, kinds 43, media 67, items 49).

- **Classes and rosters** (`routes/classes.js`, `services/roster.js`, `0016`): a
  professor's classes (course, section, optional term) with a roster of roll numbers
  and names, nothing else. Bulk add from a JSON list with each refused row and its
  reason, and any other field dropped and named; edit, remove (soft, `removed_at`)
  and restore one student. Ownership as for chapters: an HOD reads, never writes;
  anyone else gets the same 404 as for nothing.
- **A room opened for a class**: `POST /api/session` takes `classId` (a class the
  caller may change, else 404) and returns it; the room list and the archive keep it.
- **Attendance** (`GET` and `POST /api/session/:code/attendance`): a phone joining
  with a roster roll number marks the student present, unless the professor has;
  the professor marks one, many, or "joined present, the rest absent" (hand marks
  kept); unmarked stays unmarked; "N / M present". Teacher-only. A typed roll number
  is not proof of identity (decision 7), said in the reply.
- **The live grid** of a class room carries `rosterName` per row and `attendance`
  in the payload, on `teacher:grid` and `GET /grid`. Nothing renamed; rooms without
  a class unchanged; the phone's own row unchanged.
- **The room archive** keeps `room.classId` and a class room's marks.
- `ROLL_SHAPE` moved from `sockets/index.js` to `services/roster.js` (same rule), so
  the roster and the live loop cannot disagree on what a roll number may be.
- `server/scripts/roster.mjs`: the first suite to run signed-in callers. It answers
  the server's three Supabase Auth calls in-process from `http://supabase.invalid`
  and refuses any other request off the machine.

### Phase 2: full rerun and docs

No code change. Every suite was run again after the review fixes; each number
above is what the run printed (`docs/TESTING.md`). `resume.mjs` and
`integrity.mjs` read `server/.env`, so they were run through a wrapper that blanks
the store and model settings; the scripts were not changed. The reply shapes in
`docs/API.md` were checked against the code and against responses captured from a
real server on the in-process store.

- `docs/API.md`: an index of every new and changed Phase 2 endpoint, with captured
  examples for the routes that had none (content list, content, dashboard,
  preview, bank, reject, room list, the phones' room read); 415 and 502 in the
  error table; the socket's silence on an answer to a question the room may not
  serve; Phase 2's open issues; test counts brought up to date.
- `docs/IMPLEMENTATION_STATUS.md`: the Phase 2 checklist, by the roadmap's step 2
  items. A server item is ticked only where an end-to-end test covers it; every
  screen is unticked. The gate's "showing the source" is partial: slide numbers,
  not the slides' text. Also the current test table, and new risks: deploying
  before a client that approves, migrations before the server, images in the
  database, the untried Gemini path, small-class statistics, and two scripts that
  read `.env`.
- `docs/TESTING.md`: this rerun, per-file unit counts, how the two `.env`-reading
  scripts were run, and what item statistics and question sets leave untested.
- `docs/ARCHITECTURE.md`, `docs/DATABASE_SCHEMA.md`, `docs/PRODUCT_DECISIONS.md`:
  the approval gate's path through the server; which migrations are committed; the
  Phase 2 defaults that wait on the owner.

### Phase 2: fixes from the review

Server only; no migration, no new dependency. Suites after this work: unit 343/343,
approval gate 73/73, media 67/67, every other suite unchanged (migrations 270,
items 49, kinds 43, liveloop 41, security 13, review 83, evidence 37, round trip 0
failures, resume and integrity pass). Each new check was seen to fail before its
fix. Nothing run against Supabase, Mongo, Gemini or a phone browser.

- **A rejected draft stays unapproved.** It is `discarded` with its model set and
  no approval, and split and merge used to make its halves (or a merge with it)
  **active**, served by rooms with no approval on record; a merge with an approved
  question even carried that question's approval. They are now drafts with no
  approval (`unreviewed` in `services/edits.js`). The live loop's fallback for a
  question discarded after it was served no longer marks or stores an answer
  naming a rejected draft, and no longer sends its key back.
- **Image urls are judged as a browser resolves them.** `/api/./media/<id>`,
  `/api/x/../media/<id>` and `http://<host>/api/media/<id>` skipped the
  same-chapter check and were stored as given; any url resolving under
  `/api/media/`, on any host, is now checked and stored canonical, and a
  site-relative url elsewhere under `/api/` is refused.
- **Uploads lose their metadata** before they are stored: Exif (GPS, camera,
  serial), XMP, IPTC, comments and PNG text chunks, and anything appended after the
  image. The JPEG orientation is kept. Nothing is re-encoded. Size and hash are of
  what is kept. Uploads already stored are unchanged.
- **Option counts no longer move old picks onto reworded options.** An earlier
  version counts towards an item's options only when its options read the same,
  not merely number the same. `versions` compares what was asked, so the model,
  slides, approval and a fewer-choices student's shorter list no longer make one
  unchanged question look like several.
- **Answer snapshots leave out `approvedBy`/`approvedAt`**, and a deleted room's
  archive keeps a fewer-choices student's `shownOptions` on the answer row, so a
  question is archived once rather than once per such student.
- **A replacing generate waits for the room.** While a room on the chapter is open
  or paused, `POST /api/generate` in `replace` mode is a 409 (before generating);
  it would have deleted the bank the room serves and left only drafts. `append`
  still works.
- **A plain regenerate of an active question says so** in `warnings`: the old one
  has left rooms and the new draft joins them when approved.
- **Not fixed: the current client cannot approve.** Deploying this server before a
  client with approve, reject and approve-all leaves every new bank unable to open
  a room (`IMPLEMENTATION_STATUS.md`).

### Phase 2: item statistics and a question set per room

Server and database only; no screen calls any of it yet. Suites after this work:
unit 329/329, migrations 270/270, the new `scripts/items.mjs` 49/49, and every
other suite unchanged (round trip still 0 failures). Nothing run against Supabase,
Mongo or with a signed-in account. No new dependency.

- **Item statistics** (`services/itemStats.js`). Per question, from final, graded
  answer rows: attempts, proportion correct, how many chose each option in the
  question's own order, mean score for partial-credit kinds, an easy / medium /
  hard band for the class (0.8 and 0.4; none under 5 answers), the point-biserial
  against each student's mean on their other answers in the room (none under 10
  students, with the reason), and a `negative-point-biserial` flag, the strongest
  sign of a wrong key. `GET /api/session/:code/items` for one room,
  `GET /api/bank/:contentId/stats` across every room on a bank the caller may read.
  Read rule; missing and not yours are one 404.
- **The shuffle undone.** `toOriginalResponse` in `questionTypes.js` reads a
  response back into the question's own indices through the same per-student
  permutations the phone was shown (match, categorise, dropdown) and the shorter
  list of the fewer-choices support. The live loop now keeps that shorter list on
  the answer's snapshot (`shownOptions`); before, it was not stored anywhere.
- **A question set per room** (`0015`, `sessions.question_ids`). `POST
  /api/session` takes `questionIds`; each must be an approved question of the
  chapter, or 400. The live loop's bank, a resumed pin, the phone's bank count and
  the image rule all stay inside the set, and an answer naming a question outside
  it is neither marked nor stored. Returned with the room on the teacher's routes,
  kept off the phones' room read, archived with a deleted room. A room opened
  without a set serves the whole approved bank exactly as before.

### Phase 2: images and passages as question stimuli

Server and database only; no screen uploads or attaches anything yet. Suites after
this work: unit 298/298, migrations 253/253, the new `scripts/media.mjs` 63/63, and
every other suite unchanged (round trip still 0 failures). Nothing run against
Supabase, Mongo or with a signed-in account. No new dependency: uploads use the
`multer` already installed.

- **Image upload** (`POST /api/media`, `0014`). PNG, JPEG or WebP, recognised by
  the file's first bytes, never its name or the browser's type; SVG refused (it can
  carry script); at most 500 KB (`config.media.maxBytes`); a description required.
  The caller must be able to write the chapter; another professor's is the same
  404 as none. Stored in the database (`media`, bytea), so every store takes
  uploads with no new service; the database refuses any change to an image's bytes.
- **Image serving** (`GET /api/media/:id`), open at the mount because a phone's
  `<img>` carries no credential. A teacher who may read the chapter always gets
  it; anyone else only while a room runs on that chapter and an approved question
  shows the image. Random ids; `nosniff`; a private year-long cache under the
  image's sha256 ETag; refusals are not cached.
- **Attaching**: an image stimulus may name an upload of its own chapter
  (`/api/media/<id>`), checked on edit, write-your-own and the new bulk action; its
  description is copied in when the question gives none. Attaching the picture a
  stem points at clears the slide-only check.
- **Passages**: an optional `sourceRef` citation (text, at most 300 characters),
  kept from the phone. Several questions share a passage or image as equal copies;
  `POST /api/bank/bulk` with `action: 'stimulus'` puts one on many questions at
  once (null takes it off).
- The slide-only check is unchanged: a picture reference with only a passage
  attached still fails (`PRODUCT_DECISIONS.md`).

### Phase 2: several kinds per level; hot text, dropdown, table and grid generated and edited

Server only; no screen sends the new plan field yet. Suites after this work: unit
279/279, the new `scripts/kinds.mjs` 43/43, the round trip 0 failures (was 5),
and every other suite unchanged. Nothing run against Gemini, Supabase or Mongo.

- **A kind mix per level.** The plan (`services/plan.js`) divides each level's
  questions over the kinds in that level's own set: `kindMix` weights from the
  caller, `kinds` (one kind) as before, or the default, which spreads every level
  with two or more kinds over at least two. Counts never change: plan totals,
  levels and topic spreads are identical to before on 77 requests. Each topic in
  the plan now carries `kinds`; the plan adds `perLevelKind` and `kindMix`.
- **No selected-response kind at Create**, refused in the plan, the generator and
  the model's output, not only advised by the rule check.
- **Generation follows the mix**, offline and in the Gemini prompt (which now
  states each kind's count and rules, with new schema fields `tokens`, `gaps`,
  `columns`, `tableRows`, `gridRows`, `answers`). The model path is untested.
- **Offline templates for hot text, dropdown, table and grid**, each grounded in
  the source text and checkable against it. A shared reading now only uses the
  kinds the plan asked of a level.
- **Editing them**: `PATCH` already validated the whole payload; whitespace is now
  tidied in the new kinds' fields, and each kind has a valid and an invalid edit
  under test.
- **Round trip fixed**: its five failures were missing fixtures for `hottext`,
  `dropdown`, `table`, `grid` and `poll`, not server faults. Its leak scan now also
  looks for `answers`, a grid's key.
- **Mongo fallback**: the question schema dropped `tokens`, `columns`, `rows`,
  `answers` and `stimulus`, and turned every dropdown gap into `{accept: []}`, on
  save. Fixed; checked without a database.

### Phase 2: the approval gate, write-your-own and Harder / Easier

Server and database only; no screen uses it yet. Suites after this work: unit
226/226, migrations 229/229, the new approval-gate script 63/63, and every other
suite as above. Nothing run against Supabase, Mongo, Gemini or with a signed-in
account.

- **Generated questions are drafts** (`0013`). Generation, regenerate and Harder /
  Easier save every new question as `draft`, which no room serves, with the model
  that wrote it (`offline-template` offline), the slides its topic was read from
  (a `.pptx` now keeps them on the content), its rule checks and its creator.
  Existing questions are untouched and stay active.
- **Approve, reject, approve-all** on the bank. Failing checks do not block an
  approval; the reply names them. The older restore (`PATCH status: active`, bulk
  restore) records an approval when it makes model output active. Split, merge and
  edit keep a draft a draft.
- **A room refuses a bank of drafts** with 409 and a sentence saying to approve
  them. The content list, the bank's counts and the professor dashboard count
  drafts apart from approved questions.
- **Rule checks** (`services/checks.js`): longest option is the key, absolute
  words, all/none of the above, duplicate options, a wrong option equal to the key,
  an empty rubric, a stem pointing at the slide, a selected-response item at
  Create. Advice only.
- **Write your own** (`POST /api/bank/:contentId/questions`): any kind at its own
  level, created active with no model. Stored with `source: 'fallback'` because
  `CONTRACT.md` requires it of everything the model did not write; this needs a
  contract amendment to be labelled truthfully.
- **Harder / Easier** (`direction` on the regenerate route): a new draft one level
  up or down, the original untouched.
- A phone answering a draft's id is not marked or stored. A missing question id on
  the bank routes now gets the same 404 sentence as another teacher's question.

### Phase 1: fixes from the review of the review queue and retrieval

- **A student's own answers are matched by account only.** Unlinked rows under their
  roll number may have been typed by anyone and are no longer shown to them. A
  professor's view still gathers them.
- **One roll number per department, as a room reads it** (`0011`). `21CS01` and
  `21cs01` can no longer be two accounts in one department.
- **Keyless answers are keyed per student.** Two students sending the same answer to
  the same question were one stored row. A key another student's row holds is never
  answered from that row.
- **`student:answer` refuses a question from another room's content**, which used to
  be marked, sent its key, and stored with its rubric in the wrong room.
- **A resend rebuilt from a reviewed row keeps the review**, and the phone no longer
  gets the machine's detail beside a professor's override.
- **Nothing is written into a room while it is archived and deleted.** A review sent
  then is refused (409); one already under way is waited for and archived.
- **The review queue pages by cursor** (`?before=` the previous page's `next`).
  `offset` is refused.
- **The database guards the evidence** (`0012`): an answer's response, snapshot and
  machine assessment are written once, and the review log is append-only.
- **The review note is documented as student-visible**, and the live phone's
  rubric reveal is documented as intended.
- **Non-uuid ids and deep offsets.** A 24-character hex id on Supabase is a 404, not a
  500, and `offset` is capped at 100,000 on the two answer lists.

### Phase 1: reading the evidence back

- **`GET /api/session/:code/answers`.** Every stored attempt in a room, newest first,
  paged, with the full question snapshot and the machine's reading. `?rollNo=` narrows
  it to one student.
- **`GET /api/session/:code/topics`.** Per topic × per level for a room, from final
  graded answers. Rooms older than the answers table are read from their history,
  and the reply names its `source`.
- **`GET /api/analytics/:id/answers`.** One student's answers across their
  professor's rooms. Who may call it is the analytics subject list. A student gets
  their own answers with the key, rubric and machine reading taken out.
- **`topicLevels` on `GET /api/analytics/:id`** for a student. The existing `topics`
  list is now read from the same rows.
- **New `listAnswers` filters** in all three repos: `kind`, `final` and `order` for
  the queue; `student`, `topic` and `bloom` for these reads; and the queue's `before`
  cursor.

### Phase 1: review queue for written answers

- **`answer_reviews`** (`0010`). One row per decision, never updated. A later decision
  never erases an earlier one.
- **`GET /api/review`, `GET` and `POST /api/review/:answerId`.** A professor reads
  each written answer with its rubric, response and machine mark, and confirms or
  overrides it with an optional note. The response and the machine's mark are never
  changed.
- **The student's numbers follow the decision** (`applyReview`). The history entry
  takes the human mark, and the level tally moves by the difference. The working
  level is not rewound. Teacher screens get the corrected grid.
- **`provisional: true` on `server:result`** for a written answer's machine mark.
- **A lock per student.** Each profile write reads the whole row, so it takes this
  lock first. Without it, a review landing between a live answer's read and write was
  lost.
- **Room archives include the review log.** Archives made without it still read.

### Docs

- New: `docs/API.md`, the reference for every Phase 1 endpoint and the `provisional`
  flag.
- Updated: `IMPLEMENTATION_STATUS.md` (Phase 1 checklist and test table),
  `TESTING.md`, `ARCHITECTURE.md`, `DATABASE_SCHEMA.md`, `PRODUCT_DECISIONS.md` and
  this file.

## Unreleased: 18 November 2026

### Phase 0: defects and accommodations

- **Teacher watch ownership.** `teacher:watch` checks ownership like the HTTP routes.
  Watching another teacher's room gets the same answer as an unknown code.
- **Room settings in the live loop.** The mastery goal, extra goes (0–2) and
  redemption are applied by the server. The Room screen sets them when a room opens.
  The phone is told how many goes it has, and a wrong answer with a go left reopens
  the question without revealing the answer.
- **Topic, kind and answer key on every history entry.**
- **Polls never count toward mastery.** They are still recorded, so they are never
  served twice.
- **Idempotent answers.** Every attempt carries a client key (`answerId`). A resend,
  with or without a key, is stored and counted once. Resending the same wrong answer
  does not spend a retry.
- **Drafts.** Scoped to one room and one roll number, and cleared when the student
  leaves.
- **Accommodations.**
  - The seven supports are applied: read aloud, dyslexia-friendly text, larger text,
    high contrast, extra time, no timer, and fewer choices (done on the server).
  - A professor sets them per student from the inspector on `/home`.
  - The phone is told only how to draw a question, never why.
- **`level-jump` signal.** Defined and recorded: five right straight after five with at
  most one right. It is shown as a prompt to look, not a finding.
- **Pause and resume on the Live screen.** Pause, resume and close reach the teacher's
  screen from anywhere (`teacher:status`).
- **CSV export with an account sign-in.** Uses `api.downloadExport`, which sends the
  bearer token.
- **Student bundle split.** `/join` loads 156 KiB of gzipped JS (was 241 KiB), with no
  Supabase or teacher code. Fonts are self-hosted through Fontsource, so there is no
  Google Fonts request.
- **Migrations.**
  - `supabase/migrations/0000`–`0009` build a fresh database and are safe to re-run.
  - `0001` was reconstructed from code.
  - The loose files are gone.
- **Boot probe.** Checks every table the server writes and names the migration that
  creates any table that is missing.

### Phase 1: evidence (started)

- **`answers` table** (`0008`). One row per attempt: the response, the question as
  shown, topic, level, attempt, key and timestamps. A written answer is stored as
  `provisional`, and the machine's mark is kept beside any later review.
- **Answer and history timestamps.** Each answer's row and its history entry now share
  one timestamp.
- **Room archive** (`0009`, decision 9).
  - Deleting a room first saves the whole room as one compact JSON document under
    1 MB, then deletes the live rows. If that save fails, nothing is deleted.
  - `GET /api/session/archives` lists archives and `GET /api/session/archives/:id`
    downloads one, both under the same ownership rule as rooms.
  - Measured: a class of 60 with 30 answers each is 267 KB.
- **`listAnswers` takes `offset`.** Supabase caps a request at 1,000 rows.

### Docs

- `IMPLEMENTATION_STATUS.md`
- `PRODUCT_DECISIONS.md`
- `DATABASE_SCHEMA.md`
- `TESTING.md`
- `ARCHITECTURE.md`
- this file

### In progress elsewhere

- **UI rebuild.** A from-scratch rebuild of the client UI runs in its own session.
  Notes go to `docs/UI_REBUILD.md`.
