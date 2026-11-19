# Architecture

BloomLoop has one Node server (Express plus Socket.io) and one React client built with
Vite. The server is the only thing that talks to the database. The browser never holds
a database key.

```
phone (/join) ──socket──┐
projector ──────socket──┤
                        ├── server ── repo ── Supabase Postgres  (primary)
teacher console (/) ────┤                  └─ MongoDB            (fallback)
account screens ──HTTP──┘                  └─ in-process store   (last resort; nothing saved)
```

The projector (Phase 3, `0018`) holds no account: it connects with a link's token
and is sent `projector:*` events only.

## Server (`server/src`)

| Area | Files | Role |
|---|---|---|
| Boot | `index.js`, `app.js`, `config.js` | `app.js` mounts the routes; `index.js` picks the store (`repo/index.js`) and prints the console link |
| Auth | `auth.js`, `teacherAuth.js`, `ownership.js` | Two ways in: a Supabase bearer token (an HOD, professor or student account), or the v1 shared `TEACHER_KEY`. `ownership.js` holds the single read/write rule; every route and the socket use it. Anything the caller may not read answers 404, the same as something that does not exist |
| Live loop | `sockets/index.js` | Join, serve, answer, retry, poll, pause, teacher watch. Scoring happens here, from the stored item. Every attempt is written to `answers` before the profile changes. Every profile write, from the socket or from a review, first takes an in-process lock per student (`lockProfile`), because each one reads the whole row and writes it back |
| Review | `routes/review.js` | The queue of written answers. A professor confirms or overrides the machine's mark; each decision is a row in `answer_reviews`, and the student's numbers follow (`applyReview` in `services/mastery.js`) |
| Adaptive engine | `services/mastery.js`, `services/selector.js` | The level ladder (promote at 70%, demote at 40%, a window of 5), the room's mastery goal, retries and redemption, and question choice. `servableFor` in `selector.js` is what a room may serve: approved questions, and only its question set's when it has one (`sessions.question_ids`, `0015`); the live loop's bank and the image rule both read it |
| Signals | `services/integrity.js` | Behavioural signals such as tab-away, too-fast and `level-jump`. Each is phrased as a prompt to look, never a finding. Since 19 Nov 2026 (decision 8, `0022`) none is recorded or shown for a student their class roster marks under 18: the live loop asks `signalsOff` in `services/roster.js` only when a signal is about to be recorded, and the grid, the trail, the room's CSV and the archive hide what was recorded before the mark |
| Supports | `accommodations.js` | The seven accommodations. Only the rendering switches reach the phone |
| Content and questions | `services/extract.js`, `ocr.js`, `generate.js`, `plan.js`, `edits.js`, `checks.js`, `questionTypes.js` | Turning a pptx or pasted syllabus into topics, then a question bank. Generation uses Gemini when a key is set and offline templates otherwise; offline questions are labelled as such. Since Phase 2 every generated question is a `draft` that no room serves until a professor approves it (`routes/bank.js`), carrying the model that wrote it, the slides its topic came from and the rule checks (`checks.js`, advice only). The plan (`plan.js`) also divides each level over several kinds of that level's own set, never changing a count |
| Stimuli | `routes/media.js`, `services/media.js` | Images a professor uploads for a question stimulus: PNG, JPEG or WebP by their bytes, at most 500 KB (`config.media.maxBytes`), with the metadata a camera writes (Exif GPS and the like) taken out without re-encoding (`withoutMetadata`), stored in the database (`media`, `0014`) and served at `/api/media/<id>`. That GET is open at the mount, because a phone's `<img>` carries no credential: a teacher who may read the chapter always gets the image, anyone else only while a room runs on the chapter and an approved question shows it (`servedToPhones`). A passage is text on the question (at most 4000 characters, an optional `sourceRef` citation kept from the phone). Questions share a stimulus by each carrying an equal copy; `POST /api/bank/bulk` with `action: 'stimulus'` attaches one to many |
| Accounts | `services/accounts.js`, `routes/auth.js` | The HOD → professor → student hierarchy, invites, Google link, accommodations. Since 19 Nov 2026 (decision 7) a room profile is linked to a student account only when the phone presents that signed-in student's token at `student:join` (`verifyAccountToken` in `auth.js`); the link and every answer that phone sends are marked verified (`account_verified`, `0022`), and a student's own history reads verified rows only. A typed roll number links nothing |
| Rooms | `routes/session.js` | Open (on the whole approved bank, or on a question set, optionally for a class), list, pause, resume, close and delete. Delete writes a JSON archive first (`services/archive.js`) |
| Classes and attendance (Phase 3) | `routes/classes.js`, `services/roster.js`, attendance routes in `routes/session.js` | A professor's classes (course, section, term) and their rosters: a roll number and a name per student, nothing else, kept in the room's form (`ROLL_SHAPE`, which the live loop imports), removed softly so answers and marks outlive a correction. A room opened for a class (`sessions.class_id`, `0016`) takes attendance: a join with a roster roll number marks the student present (`markJoined`, called from the live loop's join under the student's lock) unless the professor has marked them; the professor's marks are written under a lock of the room's own that a room delete waits for. The teacher's grid gains each row's roster name and the present count (`classGrid`, used by both the REST and the socket grid, after `buildGridRow` so none of it reaches a phone). Ownership as for chapters. Attendance never moves a level |
| Teacher records (Phase 3) | `routes/records.js`, `services/records.js`, `services/wheel.js` | What a professor records in class, with or without phones (`0017`): observations (four private marks, one per student per class per day, every change kept), the wheel (a fair draw on the server with crypto randomness, stored before any screen spins: rounds, picks, what each was asked and how they responded; Absent also marks attendance absent), the raised-hands tally (counts per option, never below 0, "N of M present responded"), the five no-device activities (a group challenge records groups, never students) and insight actions (what was done about a flag, append-only). Every route is teacher-only, mounted at `/api/session` after the room router and gated per route; every write takes the room's `RECORDS_LOCK`, which a room delete waits out. In a class room everything works from the roster with no phone joined. Nothing reaches a phone, and the projector only a draw's pick (`pickForProjector`: a roll number and a first name) and a question asked aloud the professor puts up (never its hands); nothing is read by the ladder |
| Room modes and the waiting room (Phase 3) | `services/mastery.js` (`sessionSettings`), `services/modes.js`, the start route in `routes/session.js`, `sockets/index.js` | How a room runs (`0018`), chosen when it opens and never changed: Student devices, Teacher-led (no phone is served; needs a class) or Mixed; adapt on or off (off holds every student at the start level, though the below-40% ceiling still applies); the start level; a cap on questions per student (`server:exhausted` with a reason); seconds per question (sent to the phone, never enforced). A room opened with a waiting room is `waiting`: phones join and are told to wait, and `POST /:code/start` makes it `open` and serves every waiting phone (`startRoom`, each under its student's lock; a join reads the status again once it is in the room, so none is missed). The teacher's grid gains the waiting room's "N / M present" line and, in a Mixed or Teacher-led room, a feed of the teacher records beside the digital answers, each labelled (`roomFeed`, used by both grids) |
| Projector (Phase 3) | `routes/projector.js`, `services/projector.js` | A read-only screen for the classroom wall. The professor makes a link per room; its token (256 random bits) is shown once and stored as a SHA-256 (`projector_links`, `0018`), works while the room is not closed and for 12 hours from when it is made (`PROJECTOR_LINK_HOURS`), and can be revoked. The projector watches with it over the socket (`projector:watch`) and gets `projector:state`: a question of the room's set or a question asked aloud (no key until revealed, and a bank question's key only in a Teacher-led room, where no phone can still be served it), a diagram (a stimulus; an uploaded image loads with no credential under the image rule, which counts a waiting room as running), or the class's progress as counts (per level only once 5 students have answered); and the wheel's pick as a roll number and first name. Every payload goes through `toProjector()`, a whitelist of keys at every depth. A projector connection is never also a phone or a teacher screen: the first event decides, before any await (`claimConnection`). What the wall shows is held in memory |
| Live insights, the student card and class analytics (Phase 3) | `services/insights.js`, `services/classAnalytics.js`, `routes/insights.js`, the analytics route in `routes/classes.js` | Staff-only reads built from the evidence already stored, with nothing new written. Each student's accuracy band in a room (Needs support below 0.4, Developing, Excelling from 0.6; none under 3 graded answers: `BAND_CUTS`, so Needs support is exactly the engine's below-40% band); the handoff's three insight cards (Focus, Support, Participation), each saying what the answers show and ending in an action, with a flag id built from its evidence that the insight-actions store records a dismissal against; KPI tiles with the change since each one's first value; the sort orders. `GET /api/session/:code/insights`, and the same body pushed as `teacher:insights` to the room's teacher screens after grid pushes, at most once every 2 seconds per room (`scheduleInsights`, from `broadcastGrid`). The KPI series for sparklines is sampled per minute from every grid push (`sampleFromGrid`, from what the grid already read) and held in memory like the projector's screen. The student card (`/students/:roll/card`): band, level being served, accuracy per level with the class's, the last ten final answers through `answerItem`, the next set as the selector itself would serve it if the level held (`selectSet`, marked as a plan), and this room's records about them. Class analytics over the class's last 4 or 8 rooms: trend, histogram, six levels and decision 6's three level bands side by side, attendance, and the hardest questions through `itemAnalysis`. Teacher records are counted beside the digital answers under their own label, never into a band or accuracy. Nothing here reaches a phone, the projector or `buildGridRow` |
| Course outcomes (Phase 4) | `routes/outcomes.js`, `services/outcomes.js`; the CSV import in `routes/classes.js` and `services/roster.js`; `parseCsv` in `services/csv.js` | A class's course outcomes (`0019`: code, statement, optional target level, order; archived rather than deleted once evidence reaches one), each mapped to topics of chapters with a weight, and per-question overrides (a question mapped straight to outcomes, or excluded), copied between classes as new rows. `resolveAnswer` is the one rule tracing an answer to its outcomes (override, then topic, else unmapped, never dropped), pure, for the coverage route and the attainment report alike; nothing is stored on an answer, so a room's archive needs none of it. The roster import reads a CSV file's roll number and name columns only and adds through `addToRoster`, the JSON list's own path. Staff-only, ownership as for the class |
| Attainment and the marks register (Phase 4) | `routes/attainment.js`, `services/attainment.js`, `services/attainmentPresets.js` | Course-outcome and Bloom attainment computed when asked, from what is already stored: the class's rooms' answer rows, its roster, its outcome mappings (through `resolveAnswer`) and a **formula that is data** (`0020`, one row per saved version): a student threshold, a minimum number of answers, class levels, which evidence types count, final or best attempts, room weights. No formula is written in code as the correct one: the examples ship as data in `attainmentPresets.js`, and every report returns the formula and version it used and a methodology paragraph generated from it. Each answer is one of four evidence types read off the row (`evidenceTypeOf`: digital, provisional machine mark, professor-reviewed, poll), and every figure is split by them with the answers it rests on, and again by who wrote the question (`questionSourceOf`). A room's answers are given to the student whose attendance mark in that room was made under their roll number (`rollResolver`, `0021`), else matched to the roster as it stands. The pure part (`classAttainment`, `studentAttainment`, `marksRegister`) decides states and levels in exact integer arithmetic, and rounds only what it shows, never upwards in a share. Teacher records are summarised beside the figures, never in them (decision 3). Students are listed in roll order, never ranked. Staff-only; ownership as for the class |
| Report files (Phase 4) | `services/exports.js`, `services/printable.js`, the writer in `services/csv.js` (`csvCell`, `toCsv`) | The attainment reports as files, from the same routes with `?format=csv` or `?format=html`: the route builds the JSON report exactly as for JSON and hands it over, so a file is never a second reckoning. CSV sheets (the course-outcome attainment sheet, the Bloom sheet, the marks register, the outcome list) start with rows giving the class, period, rooms, formula, its exact parameters and the methodology, then their tables; RFC 4180 with a BOM and CRLF, numbers unquoted, a text cell starting with `= + - @`, tab or CR prefixed with an apostrophe and quoted, likewise after a semicolon or a tab inside a cell, and every cell holding one quoted. A file asked for with the shared key in its address (`?key=`) is refused (`reportFormat`), so the key is never printed on a page or saved with a download. Printable pages (the class's attainment, the register, one student's report) are self-contained HTML: inline CSS with A4 print rules, no script, font, image or link, a Content-Security-Policy in the page and the header, every value escaped through one tagged template (`html`). Filenames are ASCII from the class's course, section and id, never a student's name. Staff-only; teacher records only at class level in a sheet |
| Confidence taps (Phase 5) | `services/confidence.js`, the confidence route in `routes/classQuestions.js` | A phone may send `sure`, `think_so` or `guessing` with any answer or vote. It is stored on the answer row in the spellings `0008`'s check allows (`sure`, `think`, `guess`) and read by nothing that marks or moves anything: the score, `correct`, the ladder, the bands, the insights and attainment are the same with or without it. Staff read it as counts by tap and by right and wrong (`confidenceCounts`): per room and per question (`GET /:code/confidence`, `roomConfidence`), per class-question round, and on the student card. Never beside one answer, never a label |
| Class questions (Phase 5) | `services/classQuestions.js`, `routes/classQuestions.js`, `startClassQuestion` / `changeClassQuestion` / `handleVote` in `sockets/index.js`; `0023` | The room's owner puts one approved `mcq`, `truefalse`, `poll` or `multi` question of the room to every phone in a Student-devices or Mixed room: round 1 (`open`), a pause for discussion (`paused`), a re-vote (`revote`), and a close with or without revealing the key. The state is a `class_questions` row, so a restart loses none of it; a phone that joins or reconnects is sent the question where it stands. Every vote is an `answers` row (`class_question_id`, `round`), never overwritten; a changed vote and a late one are kept with `final` false. No vote touches a profile, so a class question moves no level. A question asked to the class leaves the live loop's bank for that room (`withoutAsked`). Votes are written under each student's lock and a change of state under the room's `CLASS_LOCK`, which then takes and drops every student's lock (`sweepVotes`), so a round's counts are whole when the professor sees them. The professor's screens get `teacher:class-question` (counts, never a name); the projector gets the question through its whitelist, with counts only when the professor chooses and the key only once revealed |
| Misconception labels (Phase 5) | `services/misconceptions.js` (pure), its readers in `services/itemStats.js`, the label routes in `routes/bank.js`, `routes/misconceptions.js`; `0024` | A short label on a wrong option of an `mcq`, `multi` or `truefalse` question naming the misunderstanding a student who picks it most likely holds (at most 120 characters, no contact details; never on a poll or a right answer). Stored on the question (`questions.misconceptions`) by the option's **text**, so a reorder keeps it on its option and a rewording, or a key change that makes it a right answer, removes it with the edit (`keptLabels`; the reply names it). Provenance `ai` (the generator proposed it, professor-triggered; an "AI draft") or `professor` (written, edited or confirmed). Only the owner writes them, and a label changes no mark: the question keeps its status and approval, and approving a question confirms no label. The reports count, per labelled option, the distinct students whose counted answer (final, graded, no class-question vote) chose it, matched through the option's words in the answer's own snapshot to the question's current label, and say when a label was added or reworded after the answers: per room, per class (its rooms, a roll number pooled across them) and per question (its chapter's rooms, a roll number per room). Item statistics show each option's label beside its count. Staff-only: never on a phone or the projector, and left out of every answer snapshot (`snapshotOf`). The live insights do not carry them: they are built from profiles every two seconds, and these counts need every answer row and the bank |
| Honest indicators (Phase 5) | `services/honesty.js` (pure); `levelEvidence`, `levelMoves`, `masteryBasis` and the `move` record in `services/mastery.js`; their readers in the grid rows (`routes/session.js`), the live loop's question, `services/insights.js`, `services/itemStats.js`, `services/classAnalytics.js`, the dashboards and the bank routes | Each indicator sent as data with a plain sentence, nothing stored but the move record. **Provenance**: every bank question sent to staff carries who wrote it and where it stands at the approval gate (`questionProvenance`: an unapproved AI question is an "AI draft"), every misconception label whether a professor confirmed it; a phone's question carries a student's wording (`phoneProvenance`, never "template" or a model's name), only ever for a question its room serves. **Uncertain levels** (`levelCheck`, staff only): a level the model chose that no professor approved, or a kind that does not ask for its level. **Counts**: every level, band, mastery figure, item difficulty, KPI, card and class figure carries the answers it rests on and a sentence; one under the engine's own minimum is `provisional`, never a firm state (the phone's `next.provisional` included). **Moves**: every promotion, demotion, move into the below-40% band and hold at either end keeps its rule, window, share, answers and the professor's sentence on the answer's history entry (`move`), read back on the student card; staff-only, so a student's own dashboard trail is sent without it. **Languages** (`languageSplit`, `studentLanguages`): per question, the share right in each language the answers came in and a warning when two languages with at least 5 answers each differ by more than 20 points; per student, which answers were in another language. Every answer is `'en'` today, so this waits for the Hub's language switch |
| Item statistics | `services/itemStats.js` | How each question did: attempts, proportion correct, how many chose each option (mapped back through each student's shuffle with `toOriginalResponse` in `questionTypes.js`), mean score, a band for the class, the point-biserial and its negative flag. From final, graded answer rows; `GET /api/session/:code/items` for a room, `GET /api/bank/:contentId/stats` across a bank's rooms. Since Phase 5 each option also carries its misconception label, or null |
| Reports | `services/dashboard.js`, `analytics.js`, `csv.js`, `routes/export.js`, `routes/classroom.js` | Dashboards, analytics, the CSV export, and Google Classroom posting |
| Storage | `repo/memoryRepo.js`, `mongoRepo.js`, `supabaseRepo.js` | Three implementations with the same methods. The rest of the server never asks which one it got |

## Evidence

- **Answers.** Every submitted attempt is one row in `answers` (`0008`). It holds the
  response, the question as shown, topic, level, attempt number and the client's
  idempotency key, and it is never overwritten. A professor's review is written beside
  the machine's mark (`auto_*`). Since `0022` a row also says whether the phone that
  sent it was signed in as the account it is linked to (`account_verified`).
- **History.** The profile's `history` is the engine's working record. Each entry
  points at its answer row by `answerId` and shares that row's timestamp. Since Phase 5
  an entry whose answer moved the student, or held them at either end of the ladder,
  also keeps the decision (`move`: rule, from, to, window, share, answers and the
  professor's sentence), because the profile's `reason` is overwritten by the next
  answer. Staff-only: the band's sentence names the band.
- **Reviews.** A written answer's machine mark is stored as `provisional` and
  counts at once. A professor's confirm or override is written beside it on the
  answer row and appended to `answer_reviews` (`0010`). The phone is told
  `provisional: true` on its result.
- **Guards in the database.** Since `0012`, triggers refuse any change to an
  answer's evidence (the response, snapshot and `auto_*`) and any edit or delete of
  a review row, whoever sends it.
- **Deleted rooms.** A room's rows are deleted only after the whole room has been
  written to `room_archives` (`0009`), as JSON under 1 MiB, its review log included.
  While that runs, the room takes no answer and no review.
- **Reading it back.** `services/evidence.js` builds every answer a screen gets:
  in full for a teacher, through `redactForStudent` for the student who gave it,
  and the per topic × level report. Routes: `GET /api/session/:code/answers` and
  `/topics` (room, read rule), `GET /api/analytics/:id/answers` (one student
  across rooms, analytics scope). Item statistics read the same rows
  (`services/itemStats.js`); an answer given on the fewer-choices support keeps
  which options were shown (`shownOptions` on its snapshot).
- **Attendance (Phase 3).** One mark per room and roster student (`attendance`,
  `0016`): `joined` when a phone joined with that roll number, `teacher` when the
  professor marked it, which a later join never replaces. Kept apart from answers
  and accuracy. Since `0021` a mark also keeps the roll number it was made under
  (`markRollNo` in `services/roster.js`; a replaced mark's is kept), which the
  attainment reports use to tie a room's answers to the student. A deleted class
  room's archive carries its marks, each with that roll number (`markedRollNo`).
- **Teacher records (Phase 3).** Observations, wheel rounds and picks, tallies,
  activities and insight actions (`0017`), each a room's record and kept apart from
  answers and accuracy: the ladder never reads them (decision 3's safe default).
  Observations and insight actions are append-only, so a replaced or cleared mark
  stays in the log; a pick's draw (who, round, place, pool) is written once; the
  database refuses deleting any of them except with the room. A deleted room's
  archive carries them all.
- **Insights (Phase 3).** Bands, cards, KPI tiles, the student card and class
  analytics are read from the profiles' counted tallies, the answer rows, attendance
  and the records; none is stored. A dismissal or an action on a card is an
  `insight_actions` row (`0017`). The KPI series behind the sparklines is held in
  memory; a restart starts it again.
- **Course outcomes (Phase 4).** An answer is evidence for the outcomes its
  question's override names, else its topic's in its chapter (the question's topic
  while it exists, then the one frozen on the answer). Resolved when a report runs,
  never stored on the answer; what reaches no outcome is counted as unmapped. Teacher
  records are never mapped to an outcome (decision 3).
- **Class questions and confidence (Phase 5).** A class question's votes are answer
  rows like any other, each with its class question and round (`0023`), written once;
  the class question itself is a `class_questions` row holding its state and the
  question as asked. The readers of a student's own work leave the votes out: the
  topic report, item statistics, class analytics' hardest questions, the student
  card's last answers and a student's own history (where a vote's mark would tell the
  key early). The room's record (`/answers`), a teacher's read of a student, the
  archive and attainment keep them. A confidence tap is a column on the answer row,
  read only into counts.
- **Misconception labels (Phase 5).** A label is a note on the question
  (`questions.misconceptions`, `0024`), never on an answer, and is left out of the
  snapshot stored with each answer. A report matches each counted answer to the
  question's current label through the option's words in that answer's snapshot, so
  an answer given before a label was written counts under it (and the report says
  so), and one given to an option reworded since matches nothing. A label moves no
  mark, level, band or attainment figure.
- **Attainment (Phase 4).** Computed per request from the answer rows of the class's
  live rooms, never stored. An answer's evidence type is read from the row as Phase 1
  writes it: `review_status` `auto` is digital, `provisional` a written answer's
  keyword-marker mark that no professor has reviewed (a machine mark, not AI),
  `confirmed` or `overridden` a professor's; the `ungraded` flag is a poll. Who wrote
  the question is read from `question_source`. The class's formula (`0020`)
  says which of them count. Deleted rooms' archives are not read. Nothing is written
  but a saved formula. The CSV sheets and printable pages are drawn from the same
  JSON report per request and never stored either.
- **Reference.** Every Phase 1 to Phase 4 endpoint and socket field, with request
  and response shapes: `docs/API.md`.

## The question bank's approval gate (Phase 2)

A question reaches a phone only once a professor has let it in. The rule is
enforced at every point that could serve one, not only at the first:

```
generate / regenerate / Harder-Easier ──> draft ──approve──> active ──> served
                                            │                  ▲
                                         reject             restore
                                            ▼                  │
                                        discarded ─────────────┘
write-your-own ───────────────────────────────────────> active (model null, source teacher)
```

Since 19 Nov 2026 a plain regenerate of an **active** question leaves it active and
serving: the draft names it (`replaces_id`, `0022`), and whichever route approves the
draft retires it (`retireReplaced` in `routes/bank.js`). Rejecting the draft leaves
it serving.

- **Writing.** `routes/generate.js` and the regenerate route in `routes/bank.js`
  insert every generated row as `draft`, with `model`, `sourceRef`, `checks` and
  `createdBy`. Write-your-own inserts `active`: its author is its approver.
- **Becoming active.** Approve, approve-all, and the older restore (`PATCH status:
  'active'`, bulk `restore`) all go through `approvePatch` / `activatePatch` in
  `services/edits.js`, which stamp `approvedBy` / `approvedAt` on model output
  nobody approved. Split, merge and edit keep a draft a draft (`unreviewed`,
  `inherit`), and a rejected draft counts as one.
- **Serving.** The live loop's bank is `servableFor` in `services/selector.js`:
  active questions only, and only the room's set when it has one. The selector, a
  resumed pin and the bank count read it. The answer handler's fallback, for a
  question discarded after it was served, refuses a draft, a rejected draft and
  anything outside the set (`sockets/index.js`). `POST /api/session` refuses a bank
  of drafts with 409.
- **Images follow the same rule.** `servedToPhones` in `services/media.js` serves
  an upload to a phone (or a room's projector) only while a running room's servable
  questions show it; since `0018` a waiting room counts as running.
- **Checks are advice.** `services/checks.js` runs eight rules when a question is
  generated or written and on every edit, split, merge, retag, stimulus change and
  approval. Nothing is refused for failing one; the reply names the failures.
- **Misconception labels sit outside the gate (Phase 5).** A label changes no mark,
  so adding, editing, confirming or clearing one (`PATCH
  /api/bank/question/:id/misconceptions`) writes the labels alone: an active question
  stays active, a draft stays a draft, and nothing is re-approved. Approving a
  question does not confirm its labels either: a label the generator proposed stays
  an "AI draft" until the professor confirms or rewrites it.

## Who is sent what in a room (Phase 3)

Since Phase 3 a room has three audiences, each on its own Socket.io channel, and what
is staff-only never leaves the teacher's channel or the teacher's routes:

| Audience | Channel | Joined by | Gets |
|---|---|---|---|
| Phones | `session:<code>` | `student:join` (a typed roll number; optionally a signed-in student's token, which links the room to their account, decision 7) | Since Phase 5 also a class question (`class:question`, `class:vote`, `class:closed`): the question through `forStudent()`, its own vote back, never right or wrong, and the key only once the professor reveals it. Its own question, result and row: since 19 Nov 2026 a `PhoneRow` (`phoneRow` in `routes/session.js`, a student subset of the teacher's row with a neutral `next`), and sentences of its own that never name a band (decision (a)); the room's status, `server:waiting`, `session:teacher-led`. Since Phase 5's honest indicators its question carries `provenance` in a student's words, and its row `masteryBasis` and `next.provisional`. Never `slowLearner`, a signal, a roster name, attendance, a teacher record, an insight, a misconception label (Phase 5), a level check, a level move, a translation warning or anything for the projector |
| Teacher screens | `teacher:<code>` | `teacher:watch` with a teacher's credential, under the read rule | `teacher:grid` (with `rosterName`, `attendance`, `waiting` and `feed` added after `buildGridRow`, in `classGrid` and `roomFeed`), `teacher:status`, `teacher:insights`, and since Phase 5 `teacher:class-question` (counts, never a name) |
| Projectors | `projector:<code>` | `projector:watch` with a link's token (no account) | `projector:state`, `projector:closed`, `projector:refused`, every one through the `toProjector()` whitelist |

- **One role per connection.** The first of `projector:watch` and `student:*` /
  `teacher:watch` decides, synchronously, before any handler awaits the store
  (`claimConnection` in `services/projector.js`).
- **The teacher's routes carry the rest**: attendance, the records, the insights,
  the student card and class analytics are HTTP reads under `ownership.js`, and the
  phones' `GET /api/session/:code` is kept to what a phone may know.
- **Room locks.** Besides each student's lock (`lockProfile`), a room has four of
  its own, taken through the same function under names no roll number can have:
  `#status` (start, pause, resume, close, each reading the status again under it),
  `#attendance` (the professor's marks), `#records` (every teacher-record write) and,
  since Phase 5, `#class` (every change to a class question).
  A room delete waits all of them out before it archives, then refuses new writes
  until the rows are gone. All are in-process.
- **Held in memory, in one process**: what each projector shows (`screens` in
  `services/projector.js`), the insights' KPI series, their first values and the push
  throttle (`services/insights.js`), and the presence map the live loop already had;
  since Phase 5 also the class question's push throttle and the projector's
  `showCounts` (a class question's state is stored).
  A restart loses them (the projector shows an empty question screen, with first
  names off for a room opened before the restart; the series starts again); a second
  server process would share none of them.
- **The ladder reads none of it.** Attendance, observations, picks, tallies,
  activities and insight actions are their own tables; the mastery ladder, the
  bands, the cards and the KPI tiles are computed from digital answers only, and the
  teacher records are counted beside them under their own label (decision 3's safe
  default).

## Course-outcome attainment (Phase 4)

Attainment is computed when a report is asked for, from evidence already stored.
Nothing is written but a class's outcomes, their mappings and a saved formula (and,
since `0021`, the roll number on each attendance mark), and no answer, question or
room carries an outcome.

```
answers (0008) ──────────────────────> every attempt in the class's live rooms
                                       │  (only rooms opened for the class)
attendance (0016, roll_no 0021) ───────┤  rollResolver → whose answer it is
                                       │
course_outcomes, outcome_topics,       │  resolveAnswer(answer, outcomeIndex(...))
question_outcome_overrides (0019) ─────┤  → via question | topic | excluded | unmapped,
questions (their current topic)        │    with each outcome's weight
                                       │
answer row's review_status, ungraded, ─┤  evidenceTypeOf → digital | aiProvisional |
question_source                        │                   humanReviewed | ungraded
                                       │  questionSourceOf → aiGenerated |
                                       │                   professorWritten | offlineTemplate
attainment_configs (0020), else the ───┤  formulaOf → the class's formula, or the
default example (attainmentPresets.js) │              default example, version 0
                                       ▼
            chooseAnswers (the attempts rule), then
            classAttainment / studentAttainment / marksRegister  (pure, exact integers)
                                       │
                        JSON report ───┼──> exports.js   (?format=csv)
                                       └──> printable.js (?format=html)
```

**Which rooms.** The route reads the class's rooms the caller may read
(`listSessionsForClass` through `readable`, in `roomsFor` in `routes/attainment.js`),
narrowed by `roomsWindow` (`from`, `to`, `rooms`). Only rooms opened for the class are
counted; a deleted room is not (its answers are in
`room_archives`, whose class is inside the JSON). Room weights are named from all the
class's readable rooms, so a weighted room the window leaves out is marked
`inReport: false`, not taken for a deleted one.

**Whose answers.** `rollResolver` builds, per room, a map from the roll number each
attendance mark was made under (`0021`) to the mark's roster row. An answer given in
that room under that roll number is filed under the student's roll number now; any
other answer, and every answer in a room whose marks carry none, keeps its roll
number and is matched to the roster as it stands. A roll number two marks of one room
carry maps to nobody: nothing is inferred. `rollNotes` explains every roll number
left off the roster. The class report, the student report and the register all use
the same resolver, so a corrected roll number keeps a student's earlier answers in
their row everywhere.

**The resolver.** `resolveAnswer` in `services/outcomes.js` is the one rule from an
answer to its outcomes. Coverage, the outcome remove check and every attainment
figure call it.
1. The question's override in this class comes first. The question is found by id,
   or by the id in the answer's snapshot once the question is deleted. The override
   either names outcomes (weight 1) or excludes the question.
2. Otherwise the topic in its chapter: the question's current topic while the question
   exists, then the topic frozen on the answer. Each outcome mapped to that topic
   comes with the mapping's weight.
3. Otherwise the answer is unmapped.

Every counted answer is in exactly one of mapped, excluded and unmapped, and reports
say how many of each. `readOutcomeMap(repo, classId)` loads the inputs, and
`outcomeIndex` builds the lookup once per report. Topics are matched within their
chapter, ignoring case and runs of spaces (`topicKey`). A renamed topic is not
followed.

**The evidence types.** `evidenceTypeOf` reads the type off the answer row as Phase 1
writes it:

| The row | Type |
|---|---|
| `ungraded` (a poll) | `ungraded`: counted, never marked |
| a class question's `round` 2 (Phase 5, `0023`) | `revote`: the re-vote after discussion, shown under its own label and never counted by any formula. Its round 1 reads as any other row |
| `review_status` `confirmed` or `overridden` | `humanReviewed` |
| `review_status` `provisional` | `aiProvisional`: the keyword marker's mark, not reviewed. Reports call it a provisional machine mark, not AI; the key keeps its stored name because saved formulas use it |
| `review_status` `auto`, or none | `digital` |

Each figure keeps a breakdown per type, and the formula says which types count.
Teacher records are not a type. `recordsSummary` reports them in their own section,
and a formula that asks to count them is refused (decision 3).

**Who wrote the question.** `questionSourceOf` reads `question_source` off the same
row: `llm` (and none, the column's default) is `aiGenerated`, `teacher`
`professorWritten`, `fallback` `offlineTemplate`. A professor's own question is
stored as `teacher` since 19 Nov 2026 (`0022`); one written before then stays
`fallback`, so that source's label says it holds professor-written questions from
before that day. Every breakdown also sums each source's marks per type
(`addAnswer`), and `breakdownView` shows each source's counted marks and how many of
its answers were of a type not counted. It moves no figure.

**The attainment module** (`services/attainment.js`) is pure, apart from
`readAttainmentInputs`, which reads, for the rooms counted, every answer row (all
attempts), the profiles, the attendance marks and the records, and the class's roster,
outcome map and chapters.
- `chooseAnswers` applies the attempts rule: final attempts, or the best attempt per
  student and question (among the counted types first). Under `best` a written
  answer's attempt followed by a retry is set aside, since only a final attempt can
  be reviewed, and (since 19 Nov 2026) a professor-reviewed attempt always beats a
  provisional machine mark at the same question, whatever the scores and rooms.
- `classAttainment`, `studentAttainment` and `marksRegister` build the reports.
- Marks are summed as exact integers. One mark is 10^9 units: a score in thousandths,
  times a topic weight in thousandths, times a room weight in thousandths. Thresholds
  and levels are compared in BigInt, so a student at exactly the threshold attains
  and 3 of 5 is 60%.
- What is shown is rounded so that it never reads higher than it is: obtained marks
  down and possible marks up to 3 decimals (`marksDown`, `marksUp`), shares down to 4
  (`shareDown`). No state or level is decided from these.
- A student is `attained`, `not-attained`, or `not-enough-evidence` below
  `minAnswers`.
- The class figure (`classFigure`) counts the roster now. Its `marks` are the counted
  students' answers only. Roster students with too few answers are outside the share
  (`outside.notEnoughEvidence`, with their own breakdown); removed students and roll
  numbers off the roster are listed beside it and never counted.
- Students are always in roll order.
- `methodologyText` (and `registerMethodologyText`) writes the paragraph every report
  carries from the formula itself: the formula and version, the saved day in India's
  time, the threshold, attempts, evidence and what a review does, weights, levels,
  who is counted, whose answers they are, who wrote the questions, and that only rooms
  opened for the class count.

**Where a college's formula lives.**
- **Per class, as data.** The formula is `attainment_configs` (`0020`), one row per
  saved version, never changed. The highest version is in force. It holds:
  - `studentThreshold`;
  - `minAnswers`;
  - the class `levels`;
  - which `evidence` types count;
  - `attempts`;
  - `roomWeights`.

  `validateConfig` checks a formula whole: every field required, every range, levels
  strictly increasing, no key beyond the six and no evidence key beyond the three
  types, room weights by id. It is what every stored formula and preset must pass.
  `configFrom` applies a save made from a preset and/or named fields, checks the
  result with `validateConfig` (room weights may then name a room by code), and adds
  one rule for a save only: `aiProvisional` needs `humanReviewed`. That rule is not in
  `validateConfig`, so a formula stored before it still reads. A college that computes
  attainment its own way saves that formula (`PUT /api/classes/:id/attainment/config`),
  and every report names the version it used.
- **Examples, as data.** `PRESETS` in `services/attainmentPresets.js` holds named
  examples, and `DEFAULT_PRESET` is the one a class uses until it saves its own.
  Adding a college's example is a data entry there; the unit tests check every entry
  with `validateConfig`. Nothing in code treats any formula as the correct one, and
  no preset is named after NAAC or NBA.
- **What is not configurable** (code, by design):
  - the four evidence types and how a row maps to one;
  - the question-source split, which moves no mark;
  - one answer as one mark (a question has no maximum marks yet);
  - exact arithmetic, and display rounding that never rounds a share up;
  - whose answers they are (the attendance marks' roll numbers, then the roster);
  - only rooms opened for the class, and never deleted rooms;
  - roll order;
  - teacher records never counting.

  A department-wide default, indirect attainment (surveys) and per-question maximum
  marks are open questions for the owner (`docs/PRODUCT_DECISIONS.md`).

**Files.** `?format=csv` and `?format=html` on the same routes build the same JSON
report, then hand it to `services/exports.js` (`attainmentCsv`, `bloomCsv`,
`registerCsv`, `outcomesCsv`, with `toCsv` / `csvCell` in `services/csv.js`) or
`services/printable.js` (`attainmentHtml`, `studentHtml`, `registerHtml`, through the
escaping `html` tag). Neither computes a figure, so a file can never disagree with the
JSON of the same query. `reportFormat` refuses a file asked for with `?key=` in its
address, after the class's 404; the console fetches with a header and opens a blob.

**Staff-only.** All of it is behind `requireTeacher` and the class's ownership rule,
never on a phone's or the projector's channel. Deleted rooms are not read: their
answers live in `room_archives`, whose class is inside the JSON.

## Class questions, misconception matching and honest indicators (Phase 5)

### A class question, from the start to the close

```
professor (HTTP, owner only)           server                               phones (socket)
POST …/class-questions {questionId} -> startClassQuestion, under #class  -> class:question (open, round 1)
                                       class_questions row (state open)     each parks its own question
                                                                         <- student:vote {classQuestionId, round, response, confidence?}
                                       handleVote, under the student's lock: an answers row, class_question_id + round
                                                                         -> class:vote (its own vote; counted or not, why)
POST …/:id/pause                    -> state paused; votes under way      -> class:question (paused, no voting)
                                       swept first, so round 1 is whole
POST …/:id/revote                   -> state revote (round 2)             -> class:question (revote)
POST …/:id/close {reveal?}          -> state closed, revealed or not      -> class:closed (key only if revealed)
                                                                             then server:question to a phone whose
                                                                             own question was the class question
teacher screens: teacher:class-question after each change and, at most once a second, after votes
projector: projector:state through toProjector(), counts only when the professor chose them
```

- **Where the state lives.** A `class_questions` row (`0023`) holds where the question
  stands and the question as asked (key included, staff-only). A restart loses none of
  it: a phone that joins or reconnects is sent it where it stands, with its own vote in
  the current round (`sendClassState`). A room's pause leaves it alone and resuming
  the room sends it to every phone again; closing the room closes it unrevealed.
- **Locks.** A change of state runs under the room's `#class` lock, which then takes
  and drops every student's lock (`sweepVotes`) so the round's counts are whole when
  the professor sees them; a vote is written under its student's lock.
- **The bank.** A question asked to the class leaves the live loop's bank for that
  room at once (`withoutAsked`), so it is never again served to a phone on its own
  there and never moves a level.
- **Key safety** (tightened by the review fixes). A phone's class question goes
  through `forStudent()` and is named by the class question's own id, never the bank
  question's. Nothing kept with a class question is ever answered back through
  `student:answer`: a vote's key sent as an answer is re-keyed (`<key>@<roll number>`)
  and the answer kept with the class question, and a resend of an answer to the asked
  question only moves the phone on (`dispatchNext`), never telling a mark. The phone
  hears the key only in `class:closed` after a reveal. The projector gets the key, the
  share right and the changes only once revealed, and a round's counts only when the
  professor turns them on and 5 or more voted.

### Votes as evidence, round by round

Every vote is an `answers` row like any answer, written once (`0012`'s guard), with
`class_question_id` and `round`; `final` marks the vote in force, the one field a vote
ever changes after it is written. A vote is kept and not counted, with a `detail`
saying why, in this order:

| Why | `detail` |
|---|---|
| Sent for a round that has not opened | `EARLY_DETAIL` |
| Sent after its round closed | `LATE_DETAIL` |
| Sent while the room is paused (the phone is also sent `session:paused`) | `PAUSED_DETAIL` |
| From a phone not signed in, after the signed-in student's own phone voted in that round (decision 7) | `UNVERIFIED_DETAIL` |
| An answer sent to the asked question as the phone's own | `OWN_QUESTION_DETAIL` |
| Replaced by the same phone's later vote in the round | none (`final` false) |

All in `services/classQuestions.js`. No vote touches a profile: no level, no band, no
history entry. The readers of a student's own work (the topic report, item statistics,
class analytics' hardest questions, the student card's last answers, a student's own
history, the misconception reports) leave every vote out; the room's record, a
teacher's read of a student, the archive and attainment keep them. In attainment
(`chooseAnswers`) round 1 is a digital answer, except a vote from a student who had
already given a final answer of their own to the question in that room (`knewKey`:
they were shown its key; their own answer counts); round 2 is the `revote` evidence
type, shown and never counted.

### Misconception matching

A label lives on the question (`questions.misconceptions`, `0024`) keyed by its
option's **text**, never on an answer, and is left out of every answer snapshot. When a
report runs (`services/misconceptions.js`):

1. Each student's counted answer is taken: final, graded, not a class vote.
2. The option or options it chose are read as **words** from the question as that
   student saw it, the answer's own snapshot (so a reorder or the fewer-choices
   support does not move it).
3. Those words are looked up among the question's **current** labels. A match counts
   the student under that label; an answer given before the label was added or last
   reworded counts too, and says so (`beforeLabel`, `beforeChange`). Words matching no
   current option count as `otherWording`.
4. Students are counted once per option: a roll number in a room or a class (pooled
   across its rooms), a roll number in a room across a chapter's rooms. Counts only.

### Honest indicators

Computed on the way out, nothing stored but the level move (`services/honesty.js`,
and `levelEvidence`, `levelMoves`, `masteryBasis` in `services/mastery.js`):

- **Provenance** from the question row (`source`, `model`, `status`, `approvedAt`):
  the staff chip and sentence, and the phone's own wording, only for a question its
  room serves.
- **Uncertain levels** (`levelCheck`): an AI question no professor approved, or a kind
  that does not ask for its level. Staff only.
- **Counts behind estimates**: every level, band, mastery figure, item difficulty,
  insight and class figure carries its answers and a sentence, `provisional` below
  the engine's own minimum.
- **Level moves**: the ladder's decision kept on the answer's history entry (`move`),
  read by the student card; a student's own reads strip it.
- **Languages**: the share right per language an answer was given in, and a warning
  above a 20-point gap with 5 answers each (`TRANSLATION_WARNING`). The live loop
  writes `'en'` on every answer, so it waits for a second language.

### A student's own view of a linked room (decision 7, the review fix)

`verifiedKeys` reads a student's own verified final answer rows per room;
`verifiedView` keeps only the history entries whose `answerId` is one of them,
recounts the level tallies from those, and withholds the room's working level when any
entry is not theirs. The dashboard and analytics read a student's own rooms through
it; a professor's reads take the profile whole.

## Client (`client/src`)

| Area | Role |
|---|---|
| `main.jsx` | Routes. `/join` (the student) is the only eager screen; every other screen is lazy-loaded with the stylesheets only it uses |
| `learn/` | The student's phone: join, every question kind, results, retries, supports |
| `teach/` | The teacher's console: material → questions → room → live class → projector. The UI session's Phase 2 screens are committed with Phase 3 (`d162cc8`), and its uncommitted work adds class screens that call the Phase 3 class routes (`lib/api.js`; `docs/UI_REBUILD.md`). It now also calls the Phase 4 routes (`lib/api.js`, and files such as `account/Attainment.jsx`; searched 19 November 2026, not run) |
| `account/` | HOD, professor and student dashboards; rooms; analytics |
| `lib/` | The data layer: `api.js`, `auth.js` (Supabase, loaded only off `/join`), `socket.js`, `draft.js`, `teacherKey.js` |
| `ui/`, `shell/`, `fx/`, `styles/` | Components, frame, motion and physics pieces, and tokens. The UI is being rebuilt; see `docs/UI_REBUILD.md` |
| `dev/` | `/__gallery`: account screens drawn with sample data, for development only |

## Database

Defined only by `supabase/migrations/` and described in `docs/DATABASE_SCHEMA.md`.
Row-level security is on for every table, with no policies, so only the server's
service-role key gets in. Uploaded images are rows too (`media`, bytea), so there is
no storage bucket and no second service.
