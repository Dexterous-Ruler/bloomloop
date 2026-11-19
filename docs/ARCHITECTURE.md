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
| Signals | `services/integrity.js` | Behavioural signals such as tab-away, too-fast and `level-jump`. Each is phrased as a prompt to look, never a finding |
| Supports | `accommodations.js` | The seven accommodations. Only the rendering switches reach the phone |
| Content and questions | `services/extract.js`, `ocr.js`, `generate.js`, `plan.js`, `edits.js`, `checks.js`, `questionTypes.js` | Turning a pptx or pasted syllabus into topics, then a question bank. Generation uses Gemini when a key is set and offline templates otherwise; offline questions are labelled as such. Since Phase 2 every generated question is a `draft` that no room serves until a professor approves it (`routes/bank.js`), carrying the model that wrote it, the slides its topic came from and the rule checks (`checks.js`, advice only). The plan (`plan.js`) also divides each level over several kinds of that level's own set, never changing a count |
| Stimuli | `routes/media.js`, `services/media.js` | Images a professor uploads for a question stimulus: PNG, JPEG or WebP by their bytes, at most 500 KB (`config.media.maxBytes`), with the metadata a camera writes (Exif GPS and the like) taken out without re-encoding (`withoutMetadata`), stored in the database (`media`, `0014`) and served at `/api/media/<id>`. That GET is open at the mount, because a phone's `<img>` carries no credential: a teacher who may read the chapter always gets the image, anyone else only while a room runs on the chapter and an approved question shows it (`servedToPhones`). A passage is text on the question (at most 4000 characters, an optional `sourceRef` citation kept from the phone). Questions share a stimulus by each carrying an equal copy; `POST /api/bank/bulk` with `action: 'stimulus'` attaches one to many |
| Accounts | `services/accounts.js`, `routes/auth.js` | The HOD → professor → student hierarchy, invites, Google link, accommodations |
| Rooms | `routes/session.js` | Open (on the whole approved bank, or on a question set, optionally for a class), list, pause, resume, close and delete. Delete writes a JSON archive first (`services/archive.js`) |
| Classes and attendance (Phase 3) | `routes/classes.js`, `services/roster.js`, attendance routes in `routes/session.js` | A professor's classes (course, section, term) and their rosters: a roll number and a name per student, nothing else, kept in the room's form (`ROLL_SHAPE`, which the live loop imports), removed softly so answers and marks outlive a correction. A room opened for a class (`sessions.class_id`, `0016`) takes attendance: a join with a roster roll number marks the student present (`markJoined`, called from the live loop's join under the student's lock) unless the professor has marked them; the professor's marks are written under a lock of the room's own that a room delete waits for. The teacher's grid gains each row's roster name and the present count (`classGrid`, used by both the REST and the socket grid, after `buildGridRow` so none of it reaches a phone). Ownership as for chapters. Attendance never moves a level |
| Teacher records (Phase 3) | `routes/records.js`, `services/records.js`, `services/wheel.js` | What a professor records in class, with or without phones (`0017`): observations (four private marks, one per student per class per day, every change kept), the wheel (a fair draw on the server with crypto randomness, stored before any screen spins: rounds, picks, what each was asked and how they responded; Absent also marks attendance absent), the raised-hands tally (counts per option, never below 0, "N of M present responded"), the five no-device activities (a group challenge records groups, never students) and insight actions (what was done about a flag, append-only). Every route is teacher-only, mounted at `/api/session` after the room router and gated per route; every write takes the room's `RECORDS_LOCK`, which a room delete waits out. In a class room everything works from the roster with no phone joined. Nothing reaches a phone, and the projector only a draw's pick (`pickForProjector`: a roll number and a first name) and a question asked aloud the professor puts up (never its hands); nothing is read by the ladder |
| Room modes and the waiting room (Phase 3) | `services/mastery.js` (`sessionSettings`), `services/modes.js`, the start route in `routes/session.js`, `sockets/index.js` | How a room runs (`0018`), chosen when it opens and never changed: Student devices, Teacher-led (no phone is served; needs a class) or Mixed; adapt on or off (off holds every student at the start level, though the below-40% ceiling still applies); the start level; a cap on questions per student (`server:exhausted` with a reason); seconds per question (sent to the phone, never enforced). A room opened with a waiting room is `waiting`: phones join and are told to wait, and `POST /:code/start` makes it `open` and serves every waiting phone (`startRoom`, each under its student's lock; a join reads the status again once it is in the room, so none is missed). The teacher's grid gains the waiting room's "N / M present" line and, in a Mixed or Teacher-led room, a feed of the teacher records beside the digital answers, each labelled (`roomFeed`, used by both grids) |
| Projector (Phase 3) | `routes/projector.js`, `services/projector.js` | A read-only screen for the classroom wall. The professor makes a link per room; its token (256 random bits) is shown once and stored as a SHA-256 (`projector_links`, `0018`), works while the room is not closed and for 12 hours from when it is made (`PROJECTOR_LINK_HOURS`), and can be revoked. The projector watches with it over the socket (`projector:watch`) and gets `projector:state`: a question of the room's set or a question asked aloud (no key until revealed, and a bank question's key only in a Teacher-led room, where no phone can still be served it), a diagram (a stimulus; an uploaded image loads with no credential under the image rule, which counts a waiting room as running), or the class's progress as counts (per level only once 5 students have answered); and the wheel's pick as a roll number and first name. Every payload goes through `toProjector()`, a whitelist of keys at every depth. A projector connection is never also a phone or a teacher screen: the first event decides, before any await (`claimConnection`). What the wall shows is held in memory |
| Live insights, the student card and class analytics (Phase 3) | `services/insights.js`, `services/classAnalytics.js`, `routes/insights.js`, the analytics route in `routes/classes.js` | Staff-only reads built from the evidence already stored, with nothing new written. Each student's accuracy band in a room (Needs support below 0.4, Developing, Excelling from 0.6; none under 3 graded answers: `BAND_CUTS`, so Needs support is exactly the engine's below-40% band); the handoff's three insight cards (Focus, Support, Participation), each saying what the answers show and ending in an action, with a flag id built from its evidence that the insight-actions store records a dismissal against; KPI tiles with the change since each one's first value; the sort orders. `GET /api/session/:code/insights`, and the same body pushed as `teacher:insights` to the room's teacher screens after grid pushes, at most once every 2 seconds per room (`scheduleInsights`, from `broadcastGrid`). The KPI series for sparklines is sampled per minute from every grid push (`sampleFromGrid`, from what the grid already read) and held in memory like the projector's screen. The student card (`/students/:roll/card`): band, level being served, accuracy per level with the class's, the last ten final answers through `answerItem`, the next set as the selector itself would serve it if the level held (`selectSet`, marked as a plan), and this room's records about them. Class analytics over the class's last 4 or 8 rooms: trend, histogram, six levels and decision 6's three level bands side by side, attendance, and the hardest questions through `itemAnalysis`. Teacher records are counted beside the digital answers under their own label, never into a band or accuracy. Nothing here reaches a phone, the projector or `buildGridRow` |
| Item statistics | `services/itemStats.js` | How each question did: attempts, proportion correct, how many chose each option (mapped back through each student's shuffle with `toOriginalResponse` in `questionTypes.js`), mean score, a band for the class, the point-biserial and its negative flag. From final, graded answer rows; `GET /api/session/:code/items` for a room, `GET /api/bank/:contentId/stats` across a bank's rooms |
| Reports | `services/dashboard.js`, `analytics.js`, `csv.js`, `routes/export.js`, `routes/classroom.js` | Dashboards, analytics, the CSV export, and Google Classroom posting |
| Storage | `repo/memoryRepo.js`, `mongoRepo.js`, `supabaseRepo.js` | Three implementations with the same methods. The rest of the server never asks which one it got |

## Evidence

- **Answers.** Every submitted attempt is one row in `answers` (`0008`). It holds the
  response, the question as shown, topic, level, attempt number and the client's
  idempotency key, and it is never overwritten. A professor's review is written beside
  the machine's mark (`auto_*`).
- **History.** The profile's `history` is the engine's working record. Each entry
  points at its answer row by `answerId` and shares that row's timestamp.
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
  and accuracy. A deleted class room's archive carries its marks.
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
- **Reference.** Every Phase 1, Phase 2 and Phase 3 endpoint and socket field, with
  request and response shapes: `docs/API.md`.

## The question bank's approval gate (Phase 2)

A question reaches a phone only once a professor has let it in. The rule is
enforced at every point that could serve one, not only at the first:

```
generate / regenerate / Harder-Easier ──> draft ──approve──> active ──> served
                                            │                  ▲
                                         reject             restore
                                            ▼                  │
                                        discarded ─────────────┘
write-your-own ───────────────────────────────────────> active (model null)
```

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

## Who is sent what in a room (Phase 3)

Since Phase 3 a room has three audiences, each on its own Socket.io channel, and what
is staff-only never leaves the teacher's channel or the teacher's routes:

| Audience | Channel | Joined by | Gets |
|---|---|---|---|
| Phones | `session:<code>` | `student:join` (no credential; a typed roll number) | Its own question, result and row (`buildGridRow`), the room's status, `server:waiting`, `session:teacher-led`. Never a roster name, attendance, a teacher record, an insight or anything for the projector |
| Teacher screens | `teacher:<code>` | `teacher:watch` with a teacher's credential, under the read rule | `teacher:grid` (with `rosterName`, `attendance`, `waiting` and `feed` added after `buildGridRow`, in `classGrid` and `roomFeed`), `teacher:status`, `teacher:insights` |
| Projectors | `projector:<code>` | `projector:watch` with a link's token (no account) | `projector:state`, `projector:closed`, `projector:refused`, every one through the `toProjector()` whitelist |

- **One role per connection.** The first of `projector:watch` and `student:*` /
  `teacher:watch` decides, synchronously, before any handler awaits the store
  (`claimConnection` in `services/projector.js`).
- **The teacher's routes carry the rest**: attendance, the records, the insights,
  the student card and class analytics are HTTP reads under `ownership.js`, and the
  phones' `GET /api/session/:code` is kept to what a phone may know.
- **Room locks.** Besides each student's lock (`lockProfile`), a room has three of
  its own, taken through the same function under names no roll number can have:
  `#status` (start, pause, resume, close, each reading the status again under it),
  `#attendance` (the professor's marks) and `#records` (every teacher-record write).
  A room delete waits all of them out before it archives, then refuses new writes
  until the rows are gone. All are in-process.
- **Held in memory, in one process**: what each projector shows (`screens` in
  `services/projector.js`), the insights' KPI series, their first values and the push
  throttle (`services/insights.js`), and the presence map the live loop already had.
  A restart loses them (the projector shows an empty question screen, with first
  names off for a room opened before the restart; the series starts again); a second
  server process would share none of them.
- **The ladder reads none of it.** Attendance, observations, picks, tallies,
  activities and insight actions are their own tables; the mastery ladder, the
  bands, the cards and the KPI tiles are computed from digital answers only, and the
  teacher records are counted beside them under their own label (decision 3's safe
  default).

## Client (`client/src`)

| Area | Role |
|---|---|
| `main.jsx` | Routes. `/join` (the student) is the only eager screen; every other screen is lazy-loaded with the stylesheets only it uses |
| `learn/` | The student's phone: join, every question kind, results, retries, supports |
| `teach/` | The teacher's console: material → questions → room → live class → projector. As committed it does not know the Phase 2 `draft` status; the UI session's uncommitted work adds the Phase 2 screens (`docs/UI_REBUILD.md`). Nothing in `client/src` calls a Phase 3 route or event yet: the projector screen there is the older one, not the Phase 3 projector link (`docs/IMPLEMENTATION_STATUS.md`) |
| `account/` | HOD, professor and student dashboards; rooms; analytics |
| `lib/` | The data layer: `api.js`, `auth.js` (Supabase, loaded only off `/join`), `socket.js`, `draft.js`, `teacherKey.js` |
| `ui/`, `shell/`, `fx/`, `styles/` | Components, frame, motion and physics pieces, and tokens. The UI is being rebuilt; see `docs/UI_REBUILD.md` |
| `dev/` | `/__gallery`: account screens drawn with sample data, for development only |

## Database

Defined only by `supabase/migrations/` and described in `docs/DATABASE_SCHEMA.md`.
Row-level security is on for every table, with no policies, so only the server's
service-role key gets in. Uploaded images are rows too (`media`, bytea), so there is
no storage bucket and no second service.
