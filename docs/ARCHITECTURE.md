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
| Learning Hub: access and the content backbone (Phase 6) | `routes/hub.js`, `services/hubAccess.js`, `hubTopics.js`, `hubGraph.js`, `hubProposals.js`, `hubViews.js`; the topic sync and per-slide text in `routes/content.js`; `questionTopicFor` in `services/generate.js`; `0025` | The signed-in student's hub, outside any room (see "Learning Hub (Phase 6)" below). `app.js` mounts six routers at `/api/hub` (`hub.js`, `hubPractice.js`, `hubLessons.js`, `hubLanguages.js`, `hubPaths.js`, `hubTutor.js`), each behind `hubGate` in `routes/hub.js`: 503 without Supabase, then a signed-in account, never the teacher key. `hubAccess.js` is the one access rule every hub route uses. `hubTopics.js` keeps each chapter's topic records in step with its topic list; `routes/content.js` calls it on an upload, a paste and a topic edit, and keeps each slide's words for a deck uploaded now, by a write of its own after the chapter is made. `hubGraph.js` (pure) walks confirmed prerequisite links. `hubProposals.js` asks the model for direct links on the professor's button and holds its reply to a strict parser. `hubViews.js` builds the student and staff payloads field by field |
| Formulas and code (Phase 6) | `services/richText.js`; `phoneRich` in `sockets/index.js`, `phoneRichSync` in `services/classQuestions.js` | Turns a professor's text into HTML on the server: TeX to MathML (temml, with mhchem, trust off), fenced code highlighted (shiki, JavaScript regex engine, 18 languages), everything else escaped. Hub payloads carry `nameHtml`, `titleHtml` and `reasonHtml`; a room phone's question carries `rich` (below) |
| Hub practice, mastery, the error log and reviews (Phase 6) | `routes/hubPractice.js`, `services/hubPractice.js`, `hubElo.js`, `hubReview.js`, `hubErrors.js`, `hubProgress.js`, `hubExplanations.js`, `hubHintHook.js`; `0026` | Over REST, for a signed-in student: the next approved question on a topic and an attempt marked on the server and kept in `hub_attempts`, with feedback only after it. Elo per student and topic (`hubElo.js`), FSRS reviews (`hubReview.js`), the error log (`hubErrors.js`), the student's and staff's reads (`hubProgress.js`, roll order, never ranked), and one explanation per question (`hubExplanations.js`). `hubHintHook.js` is the only door from practice and lessons to the tutor. Nothing here is read by a room, attainment or the register |
| Lessons and languages (Phase 6) | `routes/hubLessons.js`, `routes/hubLanguages.js`, `services/hubLessons.js`, `hubLanguages.js`, `hubAttemptBridge.js`; `0027` | A lesson per topic from the professor's own slides, a draft until approved. Hindi and Marathi versions of what a student reads, shown only when approved and current. A lesson's answers go through `hubAttemptBridge.js` into practice's `hub_attempts` |
| Get Ready, self-tests, goals and the hub home (Phase 6) | `routes/hubPaths.js`, `services/hubRuns.js`, `hubGetReady.js`, `hubExam.js`, `hubHeld.js`, `hubGoals.js`; `0028` | Get Ready checks and refresher paths (`hubGetReady.js`), self-tests (`hubExam.js`) with the hold-back rule (`hubHeld.js`), and a student's goals and hub home (`hubGoals.js`). A check or a self-test is a run (`hub_runs`); its answers are hub attempts carrying its id |
| Tutor (Phase 6, H13) | `routes/hubTutor.js`, `services/hubTutor.js`, `hubHintHook.js`; `0029` | Approved hint ladders and feedback on wrong options, written by the professor or drafted on their button. No live model call. Hints open in practice, review sets and lessons only, and each one opened is a `hub_hint_views` row |
| Closed questions (Phase 6) | `services/hubClosed.js` | Which questions are closed to a student for now: being asked in a room, on one of their open self-tests, or the one an open Get Ready check of theirs is asking. Read by practice, lessons, the tutor, Get Ready, the self-test result and the error log. Nothing stored |
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
- **Hub attempts (Phase 6).** Every answer given in the Learning Hub (practice, a
  review set, a lesson's question, a Get Ready check, a self-test) is one row in
  `hub_attempts` (`0026`), its own append-only table, never in `answers`. It is
  marked on the server from the stored question, with the device's attempt id as its
  idempotency key (one row per student and id), the mode, the language shown, the
  hints used and the time the device measured (kept, never used for marking). A guard
  trigger refuses any change and any delete, except a deleted class, chapter, topic or
  question clearing its link and the student's account taking its rows with it. No
  room, the ladder, attainment or the marks register reads it.
- **Runs (Phase 6).** A Get Ready check or a self-test is a `hub_runs` row (`0028`),
  holding what was fixed when it started; it is written once and then ended once. Its
  answers are hub attempts carrying its id (`hub_attempts.run_id`), which a trigger
  files only under the same student's run, in the run's mode.
- **Hints opened (Phase 6).** Each hint a student opens is a `hub_hint_views` row
  (`0029`), written once and never changed, under the attempt id the answer will
  carry, with the words shown, their language, the slides and the plan. An attempt's
  `hints_used` is counted from those rows: the distinct hints opened on the question
  since the student's previous answer to it, under any attempt id, at most 3. A
  self-test or Get Ready attempt carries none (`0029`'s check on `hub_attempts`, added
  `NOT VALID`, so rows older than it are not checked).
- **Hub estimates (Phase 6).** Elo ratings, topic states, spaced reviews, the error
  log, Get Ready outcomes, refresher paths, goal progress and staff's hub reads are
  worked out per request from the hub attempts (the error log also from the student's
  own verified room answers). None is stored. A self-test's answers count only once it
  has ended (`services/hubHeld.js`).
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
| Phones | `session:<code>` | `student:join` (a typed roll number; optionally a signed-in student's token, which links the room to their account, decision 7) | Since Phase 5 also a class question (`class:question`, `class:vote`, `class:closed`): the question through `forStudent()`, its own vote back, never right or wrong, and the key only once the professor reveals it. Its own question, result and row: since 19 Nov 2026 a `PhoneRow` (`phoneRow` in `routes/session.js`, a student subset of the teacher's row with a neutral `next`), and sentences of its own that never name a band (decision (a)); the room's status, `server:waiting`, `session:teacher-led`. Since Phase 5's honest indicators its question carries `provenance` in a student's words, and its row `masteryBasis` and `next.provisional`. Since Phase 6 its question (`server:question`) and a class question's (`class:question`) also carry `rich`: HTML for each field of the question as shown that holds a formula or a code block, `{}` otherwise, with every other field as before (`phoneRich` and `phoneRichSync` in `services/richText.js`, H15). A phone holds no account token, so it reaches no `/api/hub` route. Never `slowLearner`, a signal, a roster name, attendance, a teacher record, an insight, a misconception label (Phase 5), a level check, a level move, a translation warning or anything for the projector |
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
POST …/:id/pause                    -> state paused; votes under way      -> class:question (paused, no voting), each phone its own vote
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
  the room sends it to every phone again, each with its own vote by the same rule
  (`sendClassQuestionToEach`); closing the room closes it unrevealed, and a store error
  in that step is logged without stopping the close.
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

## Learning Hub (Phase 6)

The Learning Hub is a signed-in student's own place to study their classes' material
outside any room: practice, lessons, reviews, Get Ready checks, self-tests and goals.
Staff build it (units, placed chapters, prerequisite links, lessons, explanations,
hints, translations) and read their students' progress. It is REST only, under
`/api/hub`, and shares nothing with a room's socket loop. This is a summary: every
route, request and reply is in `docs/API.md`, "Phase 6: the Learning Hub", and the
defaults chosen under the owner's delegation (H1 to H18) are in
`docs/PRODUCT_DECISIONS.md`. No client screen in this tree calls `/api/hub` yet.

```
practice, review set ── POST /practice/attempts ─────┐
lesson question ─────── POST /lessons/…/attempts ────┤  marked on the server from the stored
                        (services/hubAttemptBridge)  │  question (score()), never the device's verdict
Get Ready check ─────── POST /getready/:id/answers ──┤
self-test ───────────── POST /exams/:id/answers ─────┘
                                    │
                                    ▼
          hub_attempts (0026): append-only, one row per student and device attempt id,
          with its mode, the language shown, hints used and, for a run, run_id (0028)
                                    │
          countedAttempts (services/hubHeld.js): an open self-test's answers held back
                                    │
                                    ▼
          Elo and topic states · reviews · the error log · Get Ready and paths · goals ·
          staff reads, all worked out per request (nothing stored, nothing a room reads)
```

### Who reaches what (`services/hubAccess.js`, decision H1)

One rule, used by every hub route:

- **A student** reaches a class when its owner is the professor their account reports
  to (`reports_to`) and the class roster holds their roll number (compared by
  `rollKey`, as rooms and rosters compare them) on a row that is not removed. Through
  it they reach the chapters placed on the class, those chapters' topics that are not
  retired, and confirmed prerequisite links. Nothing else of the professor's (H2).
- **The owner** reads and writes. **The department's HOD** reads, and gets 403 on every
  write.
- **Everyone else**, and anything that does not exist, gets one 404 per kind of thing,
  word for word ("That class was not found.", and likewise for a unit, chapter, topic
  and link; each later router names its own kinds the same way). A student on a staff
  route, or staff on a student's route, gets 403 before anything is read.
- **Accounts only.** Without Supabase every hub route answers 503; with no token, or
  with the teacher key, 401. A room phone holds no token, so it never reaches the hub.
- **Students never call `/api/content`, `/api/classes` or `/api/bank`**, which answer a
  student 403. Everything a student's hub needs comes from `/api/hub`.

### The content backbone (`0025`, H2 to H4)

- **Units and placed chapters.** The owner adds, renames, reorders and removes a
  class's units, and places their own chapters on it, in a unit or in none ("Other
  chapters"). Nothing reaches a student's hub until it is placed, and only the class
  owner's own chapters can be placed (a trigger holds this in the database too).
- **Topic records.** Each chapter's topics become records (`chapter_topics`), synced
  from its topic list on an upload or paste, on a topic edit, when the chapter is first
  placed and on the owner's sync button; never on a read. A topic that leaves the list
  is **retired** (`retired_at`) when questions or links hang off it, and **deleted**
  otherwise; a retired topic comes back with its id if its name returns. Questions are
  matched to a record by name within the chapter (`topicKey`) or by the generator's
  clipped name (`questionTopicFor`); no question row is rewritten. A renamed topic is a
  new record. "Used" means questions or links only: in Postgres, deleting a record
  also deletes its lessons (`0027` cascades) and clears the topic on hub attempts and
  hint views (`0026`, `0029`); the in-process store removes only its links.
- **Per-slide text (H4).** A deck uploaded from Phase 6 on keeps each slide's words
  (`contents.slide_texts`); an older deck kept only slide numbers, and staff views say
  so. Slide text is staff and model material; a student reads it only inside an
  approved lesson.
- **Prerequisite links (H3).** One topic before another, across any chapters the same
  professor owns, each with a provenance (`ai`, `professor`) and a state (`proposed`,
  `confirmed`, `rejected`). Only confirmed links are used: chains (nearest first), what
  a topic leads to and dependency order are computed from them (`services/hubGraph.js`),
  never stored. A link that would close a loop among confirmed links is refused with a
  sentence naming the chain, by the route and by a trigger. A professor's link is
  confirmed at once; adding by hand a pair already proposed or rejected confirms that
  row. AI proposals come only from the professor's button (`services/hubProposals.js`):
  direct links over at most 60 topics of 1 to 10 of their chapters, each with a
  one-line reason; the parser drops self-links, pairs already linked in any state,
  loops and links a longer chain implies. Offline, none is proposed, and the reply says
  so.
- **A student's topic view** names confirmed prerequisites from the professor's
  chapters on none of the student's classes (an earlier semester's) by name and chapter
  title only, flagged `onYourClasses: false`; those chapters and topics still answer
  the student 404.

### Formulas and code (`services/richText.js`, H15)

A phone runs no maths or highlighting library: the server sends finished markup.

- `$...$` and `$$...$$` (with `\ce{}` for chemistry) become MathML through temml's
  CommonJS build, which carries mhchem, with trust off (`maxSize` [20, 20], `maxExpand`
  300).
- A fenced code block is highlighted by shiki with its JavaScript regex engine (no
  WebAssembly) and a fixed list of 18 languages; a fence naming any other is shown as
  plain text. Shiki loads on first need, so `phoneRichSync` (a class question's
  payload, built synchronously) shows a code block escaped until it has loaded.
- Everything else is escaped character by character; a line break is `<br>`.
- A dollar sign follows pandoc's rule, so "$20 and $30" stays text, and `\$` is a
  literal dollar sign.
- Caps: 20,000 characters of input, 2,000 per formula, 200 formulas, 10,000 per code
  block. A formula that is malformed, too long or past the count is shown as its
  escaped source; nothing throws.
- `\label`, `\ref` and `\eqref` are shown as source, and so is any rendering that
  would carry an `id=` or `href=` attribute, so no id or link written by the input
  survives.
- Hub payloads carry `nameHtml`, `titleHtml` and `reasonHtml` beside the plain text;
  a room phone's question carries `rich` ("Who is sent what in a room", above).
  Pinned: temml 0.14.0, shiki 4.6.0.

### Hub attempts and their idempotency (`0026`, H5)

- **Marked once, kept once.** The device's attempt id (8 to 64 letters, digits, `-` or
  `_`) is the idempotency key: a resend gets the stored result back (200,
  `duplicate: true`) and never makes a second row. An id already kept for another
  question, or another kind of answer, is refused with 409 rather than answered from
  that row.
- **Five modes**: `practice`, `review`, `lesson`, `getready`, `exam`. `recordAttempt`
  in `services/hubPractice.js` takes all five; a Get Ready check and a self-test write
  through it with their run's id. A lesson's answer goes through
  `services/hubAttemptBridge.js`, now connected to practice's store, so it counts in
  mastery, the error log, reviews and staff activity like any hub attempt. (Tests can
  disconnect the bridge; with no store an answer is refused with 503, never taken and
  lost.) `hub_attempts` has no column for a lesson's id or version or the translation
  shown, so a lesson attempt keeps its mode and language only.
- **One shuffle seed** for the whole hub: `hubSeed`, `hub:<account id>:<question id>`.
  The server re-derives a student's option order when the answer comes, and the error
  log redraws an answer as the student saw it.
- **Feedback only after an attempt.** Right or wrong, the right answer in the
  positions shown, the approved explanation, feedback on a wrong option chosen and the
  topic's state exist only once the attempt does. A written answer carries a labelled
  provisional machine mark.
- **Approved questions only.** Never a draft, a poll or a question showing an uploaded
  image (the image rule serves an upload only through a running room).

### Mastery, reviews and the error log (H6 to H8, H14, H17)

- **Elo (`services/hubElo.js`, pure).** One skill per student and topic, one difficulty
  per question, after Pelánek (2016): the chance of a right answer is the logistic of
  skill minus difficulty, and each update is scaled by K(n) = 1 / (1 + 0.05n), so a
  rating resting on more answers moves less. A question's difficulty starts from its
  Bloom level (−1.25 for Remember to 1.25 for Create) and is corrected by the answers
  given. Only a student's first attempt at each question moves either rating; N is
  those first attempts. Room answers do not seed or move a hub rating, and the
  estimate says it rests on hub practice alone.
- **Topic states (H6).** Not started; Not sure yet (under 3 answers: provisional, no
  figure); In progress; Mastered (a chance of at least 0.8 on the topic's typical
  question, the median difficulty of its practisable questions, from at least 5
  answers); Needs review (a review is due, which comes first once there is any answer).
  Each carries N and a sentence. A topic with too few approved questions to reach the
  next state says so (`bankShort`) instead of promising that more practice will.
- **Reviews (`services/hubReview.js`, ts-fsrs 6.0.0 with its default parameters).**
  One card per student and topic. A session is a run of attempts on the topic with no
  gap of 10 minutes or more; its share right is the rating: under 0.4 Again, under 0.7
  Hard, otherwise Good, and Easy at 0.9 or more from at least 5 answers with no hint.
  Weekly consistency names days practised and rested (India's time) and counts no
  streak.
- **The error log (`services/hubErrors.js`, pure).** From the student's wrong hub
  attempts and their own verified room answers (marked "From class"; a typed roll
  number's never). One open entry per question. It clears on a later right answer, in
  the hub or in class, to a different question on the same topic at its Bloom level or
  above. What was right is held back (`keyHeld`) while a room is asking the question,
  and on a "From class" entry whose question a room may still ask but practice cannot
  serve this student; elsewhere it is an answer practice would show after a try anyway.
- **Explanations (`services/hubExplanations.js`, H14).** One per question. The
  professor's own is approved as written; an AI draft waits for approval. A student
  reads an approved one only, after an attempt.
- **Staff reads (`services/hubProgress.js`, H17).** Per class and per student, in roll
  order and never ranked: states with N, open errors and activity counts (hints opened
  among them). A roster row is tied to an account by the access rule's own terms; a
  roll number no account carries, or two do, shows no data and says why. Nothing is
  written.

### Lessons (`services/hubLessons.js`, H11)

- Made per topic on the professor's button, in the background (202 and a run to poll).
  With a model: the professor's own text in chunks, word for word and cited by slide;
  one worked example per chunk (an AI draft); and 2 to 4 recall questions (Remember,
  Choose one or True or false) written into the bank as drafts, so they pass the
  normal approval gate. Offline, or when the model fails, a "slides only" lesson: the
  chunks and the topic's questions already approved.
- Either kind is a draft until the professor approves it. Each version is written once
  (`topic_lessons`, `0027`); approving one retires the one serving in the same
  statement (`approve_topic_lesson`), so a regenerated lesson leaves the approved one
  serving until then.
- The text comes from each slide's kept words; for an older deck, the chapter's text
  between the topic's heading and the next topic's, citing the topic's slides together;
  for pasted text, the same with no slide. Each says which.
- A student reads only the approved lesson, its approved questions as the phone shows
  them (no key), each marked `closed` while closed to them. An answer to a version
  superseded while they had it open is still taken.

### Languages (`services/hubLanguages.js`, H12)

- English is the original. Hindi (`hi`) and Marathi (`mr`) versions are made on the
  professor's button (in the background) or written by hand, and kept per item and
  language (`item_translations`, `0027`) as drafts until approved, one approved per
  item and language.
- **The translatable registry** (`registerTranslatable`): a kind says how to load an
  item, its chapter and the fields a student reads. Registered: `question` (its
  wording, and its options for mcq, multi and poll, item for item; never the key, and
  positions never move, so marking is the same in every language; pairs, groups,
  sequences, passages and typed answers stay in English), `lesson`, `explanation`
  (keyed by the question's id), and the tutor's `hint` and `feedback`.
- **The check** (`checkTranslation`), on every translation made, edited or approved: a
  missing field, a list of another length or another number of `____` gaps blocks
  approval; changed numbers, formulas or code, or a sentence of four or more English
  words with no Devanagari, are flags that need a second, confirming press. A
  translation with a blocking finding against the current English is never served,
  even if approved earlier.
- **Staleness by source hash.** A translation keeps the English it was made from and
  its hash; once the English changes it is not shown until edited against the new
  English or made again.
- **What is shown and recorded.** A student chooses a language
  (`student_language_choices`); per item they see an approved, current translation, or
  English with a plain note. `languageShown()` gives the language one item is shown in
  now; `attemptLanguage()` what an attempt records, believing the screen's echo only
  when it can have been true. Hub attempts record it, and `languageItemStats()` splits
  them by it for Phase 5's translation warning.

### Get Ready and refresher paths (`services/hubGetReady.js`, H9)

- A student picks a target topic. The check covers its confirmed prerequisites,
  nearest first, fixed when it starts (kept on the run), and asks at most 12 questions.
- Per prerequisite: two right is Ready, two wrong is Needs review, and after one of
  each a third question decides (two of three right is Ready). One already Mastered in
  practice when the check started is Ready on that evidence, citing its N. Otherwise
  Not sure yet, with its counts and the reason: the questions ran out, the check never
  reached it, too few or no approved questions, material on none of the student's
  classes, or the check ended first.
- Each answer is a hub attempt (mode `getready`, under the check's id) with practice's
  feedback after it, and no hints. Unmet questions come first, in an order seeded by
  the check; never one already asked in it, nor one a room or a self-test has closed
  (with none left, the check waits and says why). Once its end is written a check stays
  as it ended: it takes no answer (409) and keeps its path.
- The refresher path: the Needs-review prerequisites in dependency order over the
  confirmed links, each saying why in the student's own counts, ending at the target. A
  step is done when, among the student's answers on it since the check, the last two
  are right or two of the last three are. Each question counts once per round, so a key
  just shown is not taken as evidence and a topic with few questions can still be
  finished.
- Staff read a student's checks through the class (`checksForStaff`), which writes
  nothing.

### Self-tests and the hold-back rule (`services/hubExam.js`, `services/hubHeld.js`, H10)

- The student picks topics, levels, up to 30 questions and an optional time limit (1
  to 180 minutes). The server fixes the list at the start, on the run: approved
  questions practice could serve, one from each topic in turn, unmet ones first, in an
  order seeded by the self-test, then shuffled.
- While it is open: no hints, no feedback. Each answer is marked and kept at once
  (mode `exam`, under the self-test's id), and the reply says only that it was saved. A
  changed answer is a new attempt.
- It ends when handed in, or at its deadline plus a 30-second grace
  (`EXAM_GRACE_SECONDS`) on the server's clock. The end is written on the next request
  about it; the hold-back rule already treats it as ended once the grace has passed. An
  answer after the end is kept, marked late, and not counted.
- **The hold-back rule** (`countedAttempts`): every read that marks or estimates (Elo
  and states, the error log, reviews) leaves out an open self-test's answers. Once it
  has ended, only the final answer to each question before the end counts; changed and
  late answers are kept and never counted. Get Ready answers are never held back.
- **The result**: per question, right or wrong, the right answer, the approved
  explanation and the feedback on a wrong option chosen, and a written answer's
  provisional machine mark, labelled; then a summary by topic and by level, with
  counts. An unanswered question keeps its key and explanation back, so an empty
  self-test cannot read the bank; so does a question a room is asking now (`held`,
  `heldNote`). A question whose topic the student no longer reaches is not shown while
  it is open, nor in the result if unanswered.
- `openSelfTestQuestions` (in `hubHeld.js`) lists the questions on a student's open
  self-tests for the closed-questions rule below. A self-test counts in no room,
  attainment figure or register.

### Goals and the hub home (`services/hubGoals.js`, H16, H17)

- A goal is the student's own: an optional title, an exam date of today or later, and
  1 to 60 of their topics; at most 10 goals. Its progress is their topic states over
  those topics, with N, the days left and what to do first. Staff never see goals.
- `GET /api/hub/home`: the mastery map by class, unit, chapter and topic, reviews due
  and coming up, goals, refresher paths, four weeks with rest days, and the sentence
  that their professor can see their progress. Never a rank, an average, a streak,
  coins or a band name. A part that cannot be read (goals or paths without `0028`) says
  so in its place.
- Staff see, per class, the students in each topic state, in roll order, with N
  (`studentsByState`).

### The tutor (`services/hubTutor.js`, `services/hubHintHook.js`, H13)

- **No live model call.** A hint is written before any student asks: by the professor
  (approved as written) or by the model on the professor's button, in the background
  (an AI draft until approved). A live chat tutor is not built.
- **What a question may carry** (`0029`): a ladder of up to three hints (a nudge, a
  strategy, a worked step stopping short of the answer), each citing slides; and
  feedback on each wrong option of a Choose one, Choose all or True or false, keyed by
  the option's words.
- **The leak check** (`answerLeak`) refuses a hint or feedback holding the answer: the
  right option's words, letter or number; a numeric answer within its tolerance; an
  accepted typed answer; a true-or-false verdict; a whole pairing, grouping or order; a
  rubric point word for word. It runs when a professor writes, when the model's reply
  is parsed, at approval and again before anything is shown; a translated hint that
  fails it is shown in English. It is lexical and reads the English question: a
  paraphrase, or a translation naming the right option in its translated words, is not
  caught (the second a review finding not acted on). The professor's approval is the
  gate.
- **The first-hint plan** (`planHints`, pure), from the student's attempts whose
  results they have seen (practice, review, lesson; never a self-test or Get Ready):
  approved feedback on the wrong option they chose last time first, in place of the
  nudge; wrong after k hints, the ladder starts at step k + 1; most of the last five
  answers on the topic wrong, or a non-provisional estimate under an even chance, it
  starts at the strategy; otherwise the nudge.
- **Where hints open.** Practice, review sets and lessons only, one at a time, at most
  three per attempt, each recorded. Never in a self-test or Get Ready (400, and the
  database refuses such a view), nor on a closed question (409). Asking again for a
  step returns it and records nothing. Once the attempt exists its hints are closed.
- **The hint hook** (`hintsOffered`, `hintsUsedOn`, `feedbackAfter`) is the only way
  practice and lessons reach the tutor, and never throws: without `0029`'s tables no
  hint is offered and an attempt records 0. Feedback on a wrong option reaches a student
  after an attempt in practice, lessons and Get Ready (through practice's
  `feedbackFor`), and in a self-test's result after the end (`hubExam.js`, through
  `feedbackAfter`).

### Closed questions (`services/hubClosed.js`)

Practice, a lesson and the tutor show a question's answer, explanation and hints to
anyone who may be served it. So a question that is otherwise practisable is
**closed** to a student while:

- a room on its chapter that is not closed is asking it: a phone there was served it
  and has not finished it, or it is the room's class question and that is not closed.
  Any phone counts, not only this student's: rooms are account-free (decision 7), so a
  phone may be this student under any roll number;
- it is on one of the student's open self-tests (`openSelfTestQuestions`);
- one of their open Get Ready checks is asking it.

While it is closed, practice and review sets never serve it (with nothing else left,
the reply says so); an answer to it in practice, a review set or a lesson is refused
with 409 before anything is stored, saying why, so the device can keep it and send it
later; no hint opens on it (409), and the next question's hints say 0 with the reason;
a Get Ready check skips one closed by a room or a self-test and refuses an answer to
it; and a self-test's result (`held`, `heldNote`) and the error log (`keyHeld`) keep
back the key and explanation of a question a room is asking now. Nothing is written:
the set is worked out from the rooms, self-tests and checks on every request.

What it does not close: rooms and the hub share one bank, and practice shows a
question's key after one try, so a student can see before class the key of a question
a graded room will ask later. Only a question being asked now is closed; the rest is
the owner's decision (`docs/PRODUCT_DECISIONS.md`). A Get Ready check cannot be
abandoned, so the question an open check is asking stays closed until it is answered.

### Model calls

Every model call in the hub runs only on a professor's button, never in anything a
student waits on (decision 5): link proposals, lessons (with their worked examples and
recall questions), translations, explanations, and hints and feedback. Lessons,
translations and hints answer 202 and run in the background; link proposals and
explanation drafts run inside the professor's request, with a run to poll, as
generation does. With no model key none is made: no link, translation, explanation,
hint or feedback is drafted, each reply says so, and a lesson is "slides only". Each
service holds the model's reply to a strict parser, tested with fixture replies; no
test calls a real model.

### In-process only

- **Locks**, in this process: per class (units and placements), per professor (links),
  per topic (lessons), per item (translations), per question (explanations, hints), per
  student and attempt (opening a hint), per run (a check's or self-test's answers) and
  per student (starting a check or self-test, goals). A second server process shares
  none of them. Across processes the database's unique keys and triggers are the
  guard, except that `0025`'s loop trigger takes no lock: two processes confirming A
  before B and B before A at the same moment could both pass (a review finding not
  acted on).
- **Runs** (`services/runs.js`) are held in memory: a restart loses a run's progress
  and any background work under way. A lesson run cut off between writing its bank
  drafts and its lesson leaves ordinary drafts the professor can reject.
- **Estimates** replay every hub attempt on the topics involved, by every student, on
  each request; this was not measured at a semester's scale (`docs/TESTING.md`).

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
