# Implementation status

Last revalidated: 19 November 2026, against the working tree on branch
`roadmap-phase0-evidence`. Commit `b4585a0` holds Phase 0, the answers table and the
room archive; commit `05daf56` holds Phase 1 (the review queue, the answer reads, the
fixes and migrations `0010` to `0012`). **Phase 2 is uncommitted**: the approval
gate, several kinds per level, images and passages, item statistics, question sets,
the fixes from its review, and migrations `0013` to `0015`. Every suite below was
rerun on 19 November 2026 after the Phase 2 review fixes.

Source of truth for the plan: `reports/BloomLoop gap analysis and roadmap.md`.
Decisions that need the owner: `docs/PRODUCT_DECISIONS.md`.

Status words used below: **done** (works end to end and has a test), **partial**
(some layers exist), **absent**, **verified** (re-checked by running code, not only
by reading it).

## Baseline before Phase 0

| Check | Result |
|---|---|
| `node --test` in `server/` (unit) | 94 of 94 pass |
| `scripts/roundtrip.mjs` (every kind: valid, right, wrong, student view) | 5 failures: no fixtures for `hottext`, `dropdown`, `table`, `grid`, `poll` |
| `scripts/resume.mjs` (durable sessions) | pass |
| `scripts/integrity.mjs` (signals) | pass |
| `scripts/security.mjs` | 2 failures, both because it assumes a store that already holds a session; the in-memory store starts empty |
| `npm test` from the repo root | fails on Node 24: `node --test test/` no longer accepts a directory. `node --test` from `server/` works |

## The nine defects from the audit

| # | Defect | Revalidation |
|---|---|---|
| 1 | Teacher console route `/` has no role check in the client | Confirmed by reading `client/src/teach/TeachApp.jsx`. The server already refuses a student token on every teacher route (`requireTeacher` returns 403), so this is an exposure of screens, not of data |
| 2 | `teacher:watch` does not check room ownership | Confirmed (`server/src/sockets/index.js` `handleWatch` verifies a teacher but never calls `canRead`) |
| 3 | Mastery goal, reattempts and redemption stored but never applied | Confirmed. `handleAnswer` calls `applyAnswer` with neither `tries` nor `redemption`, never consults `retriesFor`, and the socket grid builds rows without the room's goal. The Room screen sends no settings |
| 4 | Topics view always empty | Confirmed. History entries carry no `topic` |
| 5 | Student download includes the whole teacher console; fonts from Google's CDN | Confirmed (`client/src/main.jsx` imports every screen eagerly; `client/index.html` links Google Fonts) |
| 6 | A poll would count toward mastery | Confirmed. `countsTowardMastery` and `recordUngraded` exist and are imported but unused in `handleAnswer` |
| 7 | CSV export breaks for account sign-in | Confirmed by reading: the export is a plain link carrying only `?key=`; an account-only professor has no key |
| 8 | No idempotency key on answers; drafts keyed by question only | Confirmed. Duplicate protection is "this question already in history", which cannot tell a retry from a resend; drafts are stored under `bloomloop:draft:<questionId>` |
| 9 | Schema drift | Confirmed. No SQL file creates `accounts`, `accounts_below()`, `questions.kind`, `questions.payload` or any `owner_id`; two files are numbered `006`; `profiles.account_id` is never written |

Also confirmed: the seven accommodations are defined in `server/src/accommodations.js`
and stored on accounts, but nothing applies them; the `level-jump` signal is declared
in `services/integrity.js` with no definition anywhere; the Live screen has no pause
or resume and does not hear the events.

## What works today

- Material: `.pptx` and syllabus upload with OCR, topic editing, chapter library.
- Question bank: planner, generation with progress, curation, editor for 11 of 16 kinds,
  split, merge, regenerate, bulk discard and retag.
- Live room: adaptive selection by Bloom level, one-sentence reasons, durable resume,
  integrity signals, projector with QR, fair draw, CSV export (key path only, see defect 7).
- Accounts (Supabase only): HOD, professor and student roles, invites, Google Classroom
  posting, student Google link, dashboards, analytics, rooms management.
- Client: rebuilt November 2026 with light and dark themes; not committed.
- Evidence (server only): every attempt stored, a review queue for written answers,
  and reads of the stored answers and per topic × level reports. Endpoints in
  `docs/API.md`. No screen uses them yet, except the room archive on `/rooms`.
- Question bank, Phase 2 (server only, uncommitted): generated questions wait as
  drafts until a professor approves them, with the model, the slides and eight rule
  checks recorded; write-your-own; Harder / Easier; several kinds per level, with
  hot text, dropdown, table and grid generated offline and edited; image upload and
  passages as stimuli; item statistics per room and per bank; a question set per
  room. Endpoints in `docs/API.md`, "Phase 2". **No screen uses any of it, and the
  current console cannot approve a draft** (see the Phase 2 checklist and the risks).

## Partially implemented

| Area | What exists | What is missing |
|---|---|---|
| Kinds `hottext`, `dropdown`, `table`, `grid` | Server validation, scoring, student widgets; since Phase 2, offline generation, the Gemini prompt and schema (never run), `PATCH` validated whole, roundtrip fixtures | The console's editor for them (client); any Gemini run |
| `poll` | Server scoring; ungraded handling applied in the live loop since Phase 0 (defect 6); since Phase 2, a professor can write one (`POST /api/bank/:contentId/questions`, any level) | A screen to write one; the generator never writes one |
| Room settings | Validated, stored and applied in the live loop, with the Room screen to set them (Phase 0, item 3) | Nothing for roadmap step 2; listed here only because step 2 names them |
| Accommodations | Catalogue and account column | Reading them on join, phone rendering, teacher UI |
| Cross-room student history | Analytics by account; topic × level; the actual responses (`/api/analytics/:id/answers`, server only) | Rows for students without accounts; any test with a real account; a screen |

## Absent (by roadmap phase)

- **Phase 1:** each student's last answers in the live grid; every Phase 1 screen
  (the review queue, a student's answer history, the topic report, the phone's
  "provisional" label). The model that wrote each item is recorded since Phase 2
  for new questions only. See the checklist at the end.
- **Phase 2:** every screen. Approving, rejecting and approve-all; showing a
  draft's slides and check results; write-your-own; Harder / Easier; the editors
  for hot text, dropdown, table and grid; the kind mix in the planner; uploading and
  attaching images and passages; item statistics; picking a room's question set.
  The server side of all of these is in; see the Phase 2 checklist at the end.
- **Phase 3:** roster, attendance, observations, raised hands, Teacher-led and Mixed modes, waiting room, class analytics, projector modes.
- **Phase 4:** course outcomes and attainment exports.
- **Phase 5:** confidence taps, re-vote, misconception tags.
- **Phase 6:** the Learning Hub.
- **Phase 7:** offline outbox, service worker, laptop-server mode.

## Dependencies between features

- Answer store (Phase 1) needs the idempotency key (defect 8) and topic on history (defect 4).
- Review queue, item statistics, attainment and the Hub all read the answer store.
- Attainment needs the roster (Phase 3) and course-outcome tags on questions (Phase 4).
- The Hub needs a lasting student identity: `profiles.account_id` written on join (defect 9) or the decision in `PRODUCT_DECISIONS.md` §7.
- The offline outbox needs idempotency keys and a light student bundle (defects 5 and 8).

## Tests: existing and missing

Existing: unit tests for mastery, selector, edits, integrity, accounts; four end-to-end
scripts driving a real socket server on the in-memory store.

Missing before this pass: room settings in the live loop, poll handling, ownership on
`teacher:watch`, idempotent answer submission, migrations building a fresh database,
the client (no client tests exist).

Results after Phase 2 and the fixes from its review, every suite rerun once on
19 November 2026 (Node 24.22.3, in-process store and PGlite; no network service).
Each figure below is what the run printed. Phase 0 ended at 103 unit, 11 security
and 142 migration checks; Phase 1 at 172 unit, 13 security and 204 migration checks.

| Suite | Command | Result |
|---|---|---|
| Unit: mastery, selector, edits, integrity, accounts, archive, reviews, evidence reads, the three repos; since Phase 2 also `checks` (32), `approval` (24), `kindmix` (27), `newkinds` (26), `media` (27), `itemstats` (34) | `cd server && npm test` | **343 / 343** (72 suites) |
| Live loop: ownership, evidence, idempotency, polls, retries, redemption, status, room archive | `node server/scripts/liveloop.mjs` | 41 / 41 |
| Security harness, including a phone answering another room's question | `node server/scripts/security.mjs` | 13 / 13 |
| Migrations on PGlite: fresh build, re-run, upgrade, constraints, `0010` to `0015` | `cd server && npm run migrations` | **270 / 270** |
| Review queue, end to end with the shared key | `node server/scripts/review.mjs` | 83 / 83 |
| Evidence reads, end to end with the shared key | `node server/scripts/evidence.mjs` | 37 / 37 |
| Resume, integrity (run through a wrapper that blanks the store and model settings first: both scripts read `server/.env`; see `docs/TESTING.md`) | `node server/scripts/resume.mjs`, `integrity.mjs` | pass: 7 and 6 mandated steps, 0 failures, 0 supporting failures, 0 known holes |
| Question kinds round trip | `node server/scripts/roundtrip.mjs` | **0 failures** (16 kinds, 64 checks). It had 5 until Phase 2 wrote the missing fixtures for `hottext`, `dropdown`, `table`, `grid`, `poll` |
| Approval gate (Phase 2) | `node server/scripts/bank.mjs` | **73 / 73** |
| Kinds per level and the four kinds (Phase 2) | `node server/scripts/kinds.mjs` | **43 / 43** |
| Images and passages (Phase 2) | `node server/scripts/media.mjs` | **67 / 67** |
| Item statistics and question sets (Phase 2) | `node server/scripts/items.mjs` | **49 / 49** |

`scripts/smoke.mjs` was not run in this pass. It fails for reasons older than
Phase 2 (an all-mcq check, and a teacher socket with no key), and run directly it
uses `server/.env`'s Supabase and Gemini settings (`docs/TESTING.md`).

How the numbers grew during Phase 2, as each piece of work reported them:

Phase 2 (approval gate), rerun on 19 November 2026 after that work: unit **226 / 226**
(172 plus `test/checks.test.js` 32 and `test/approval.test.js` 22), migrations
**229 / 229** (25 new checks for `0013`), the new `node server/scripts/bank.mjs`
**63 / 63**, and every other row above unchanged (liveloop 41, security 13, review
83, evidence 37, resume and integrity pass, round trip the same 5).

Phase 2 (several kinds per level; the four kinds generated and edited), each run
once on 19 November 2026 after that work: unit **279 / 279** (226 plus
`test/kindmix.test.js` 27 and `test/newkinds.test.js` 26), the new
`node server/scripts/kinds.mjs` **43 / 43** (four runs), round trip **0 failures**
(the five were missing fixtures), and liveloop 41, security 13, migrations 229,
review 83, evidence 37, approval gate 63, resume and integrity pass.

Phase 2 (images and passages as stimuli), each run once on 19 November 2026 after
that work: unit **298 / 298** (279 plus `test/media.test.js` 19), migrations
**253 / 253** (24 new checks for `0014`), the new `node server/scripts/media.mjs`
**63 / 63**, and liveloop 41, security 13, review 83, evidence 37, approval gate
63, kinds 43, round trip 0 failures, resume and integrity pass. Two of the new
checks were seen to fail with their rule removed: the running-room condition (7
checks in `media.mjs` and 1 unit test failed) and the same-chapter condition (3 and
1).

Phase 2 (item statistics; a question set per room), each run on 19 November 2026
after that work: unit **329 / 329** (298 plus `test/itemstats.test.js` 31),
migrations **270 / 270** (17 new checks for `0015`), the new
`node server/scripts/items.mjs` **49 / 49** (six runs), and liveloop 41, security
13, review 83, evidence 37, approval gate 63, kinds 43, media 63, round trip 0
failures, resume and integrity pass. Each new guard was removed once and its checks
seen to fail, then restored: the set check on the answer fallback (5 checks in
`items.mjs`), the set filter on the live loop's bank (9), the shuffle seed in the
item report (2, and 1 unit test), the set condition in the image rule (1 unit test)
and the recording of `shownOptions` (2).

Phase 2 review fixes, each run on 19 November 2026 after that work: unit **343 /
343** (three runs), approval gate **73 / 73**, media **67 / 67**, and migrations 270,
items 49, kinds 43, liveloop 41, security 13, review 83, evidence 37, round trip 0
failures, resume and integrity pass. Each new check was seen to fail before its fix
(`docs/TESTING.md`). `scripts/smoke.mjs` fails for older reasons (an all-mcq check,
and a teacher socket with no key); see `docs/TESTING.md`, which also records one
run of it made by mistake with `server/.env`'s Gemini and Supabase settings.

Still missing: any automated client test; an account-path test for anything that
needs Supabase. That means account linking, accommodations from a real account, CSV
export with a bearer token, and the student redirect on `/`. From Phase 1 it also
means: a bearer-token caller on the review queue (including an HOD's 403),
`GET /api/analytics/:id/answers` and `topicLevels` for a real professor or student,
and the Mongo and Supabase repo methods against a real database (only the query
each would send is checked). From Phase 2: `0013` to `0015` on the real database;
the Supabase and Mongo repos writing and reading the new question columns, the
`media` table (bytea as `\x` text, checked against a stubbed PostgREST only) and
`sessions.question_ids`; the boot probe's new checks; a professor or HOD bearer
token on every new route (`createdBy`/`approvedBy` set to an account, an HOD's 403
on writes, an HOD reading item statistics); anything sent to Gemini (the per-kind
prompt, the new schema fields, the model id recorded on a question); a deck read by
OCR keeping its slides; a phone browser loading an image (cache, revalidation,
orientation); the fewer-choices support reaching a phone through a real linked
account; and every Phase 2 screen, since none exists.

## Risks found while revalidating

- **Supabase unreachable.** The project's hostname does not resolve (checked against
  public DNS on 18 November 2026). Every account feature is untestable locally and
  broken on the deployed site until the project is restored.
- **Uncommitted work.** Phase 0 (`b4585a0`) and Phase 1 (`05daf56`) are committed
  on branch `roadmap-phase0-evidence`. Phase 2 (server, tests, docs and migrations
  `0013` to `0015`) and the UI rebuild in progress are not; one bad checkout loses
  both.
- **Deploying the Phase 2 server before a client that approves.** Every generated
  question is now a draft, and the current console has no approve, reject or
  approve-all, and does not read `drafts` / `draftCount`. A professor who generates
  a bank then cannot open a room on it (409), and the screen invites a second,
  replacing generate. The server must not be deployed until the client approves.
- **Migrations before the server.** `0013` to `0015` must be applied to Supabase
  before the Phase 2 server is deployed. Without them the boot probe falls back to
  the in-process store, which saves nothing. None of the three has run anywhere but
  PGlite.
- **Images in the database.** Uploads are bytea rows of up to 500 KB, sent through
  PostgREST as about twice that in hex text. Never seen against a real Supabase;
  there is no route to list or delete an upload, so the table only grows (a deleted
  chapter takes its images with it, and no route deletes a chapter).
- **The Gemini path for Phase 2 has never run.** The per-kind prompt, the new
  schema fields (`tokens`, `gaps`, `columns`, `tableRows`, `gridRows`, `answers`)
  and the model id recorded on each question were written and unit-tested against
  hand-made model output only. A schema the model API refuses would show up as the
  offline templates filling every slot, with `model: offline-template`.
- **Item statistics on one class are rough.** The point-biserial is shown from 10
  students and flagged at any value below 0; at 10 to 20 students a small negative
  figure can be chance. The flag is worded as a reason to look, not a verdict
  (`PRODUCT_DECISIONS.md`).
- **Who can load an image during a class.** While a room on the chapter runs and an
  approved question shows the image, anyone with its url gets it, as anyone could
  see a screenshot of the question. Ids are random. Chosen, not overlooked
  (`PRODUCT_DECISIONS.md`).
- **Two test scripts read `server/.env`.** `resume.mjs` and `integrity.mjs` call
  `initStore()` without blanking the settings, so run directly on a machine whose
  `.env` holds Supabase or Gemini keys they would try to use them. This pass ran
  them through a wrapper that blanks those settings first (`docs/TESTING.md`). The
  scripts themselves were not changed.
- **Phase 1 review findings on ids and paging: fixed.** Fixed on 19 November 2026: the Supabase repo answers a non-uuid id with "not found" (`isUuid` guard on every single-row read), and `offset` is capped at 100,000 (`MAX_OFFSET` in `services/evidence.js`, a 400 beyond it; unit-tested). The id guard is traced, not run against Supabase.
- **Answer keys and seeds.** The shuffle seed is `rollNo:questionId`, so anyone who
  knows a roll number and a question id can reproduce a board. Acceptable for a class
  activity; noted for any future high-stakes use.

---

## Phase checklist

Updated as work lands. A box is ticked only when the feature works end to end and a
test covers it.

### Phase 0

- [ ] 1 Role gate on the teacher console. **Partial:** a signed-in student is sent
  to `/me` before the console loads or calls the API. Not verified: it needs a
  student sign-in, which needs Supabase.
- [x] 2 Ownership on `teacher:watch` (live loop: shared key refused on an owned room,
  same message as an unknown code)
- [x] 3 Room settings applied in the live loop, with a Room screen to set them (live
  loop; Room screen checked in the browser: 90 %, one extra go, redemption on reached
  the server)
- [x] 4 Topic on every history entry (unit + live loop)
- [ ] 5 Student bundle separated; fonts self-hosted. **Done, measured, no automated
  check:** `/join` is 156 KiB gzipped JS (was 241), no Supabase or teacher code, no
  third-party request.
- [x] 6 Polls never count toward mastery (live loop)
- [ ] 7 CSV export works for account sign-in. **Partial:** `api.downloadExport`
  sends the bearer token; verified on the shared-key path only (Supabase down).
- [x] 8a Idempotency keys on answers (live loop: same key, and keyless resend, each
  stored and counted once; a retry is not spent by resending the same wrong answer)
- [ ] 8b Drafts scoped to room and roll number. **Code in place, untested.**
- [x] 9 Migrations build a fresh database (142 checks, `0000`-`0009`)
- [ ] Accommodations applied. **Partial:** server path, professor routes and the
  professor's Supports panel exist; the phone's support styles were checked by hand.
  Linking a room profile to an account needs Supabase, so the end-to-end path is
  untested.
- [x] `level-jump` signal defined and recorded (unit)
- [x] Pause and resume on the Live screen (live loop for the status events; checked in
  the browser: the teacher's chip and the phone's paused screen both follow)

### Phase 1 (in progress)

Roadmap step 1: keep the response, topic, time, language and item source with every
answer; an idempotency key; each student's last answers in the live grid; written
marks provisional, with a review queue for the professor. "End to end" below means
over HTTP or the socket on a real server, on the in-process store. Nothing here has
run against Supabase or with a signed-in account; where that matters, it is said.
Endpoints: `docs/API.md`.

- [x] Evidence store: every attempt kept in `answers` with the response, the question
  snapshot, topic, level, attempt, key, served and answered times, language and the
  question's source (`0008`; live loop). Language is always `en`, the only one there
  is
- [ ] The model that wrote each item. **Partial (Phase 2):** a question generated
  since `0013` stores `model` (the model id, or `offline-template`), and an answer's
  question snapshot carries it. Older questions and answers have none, and the
  Gemini path that writes the model id has not been run (no network here)
- [ ] Each student's last answers in the live grid. **Absent:** the grid row carries
  none. `GET /api/session/:code/answers?rollNo=` returns them over HTTP
  (`scripts/evidence.mjs`), with no screen
- [x] Written answers stored as `provisional`, with the machine's mark kept beside any
  review (`auto_*` columns; migration test). The phone's result says
  `provisional: true` (`scripts/review.mjs`); the phone does not show it yet
- [x] Deleting a room keeps it as a JSON archive under 1 MB, by the owner's decision
  (decision 9; `0009`; unit + live loop; the review log is archived with the room,
  unit + `scripts/review.mjs`)
- [ ] Teacher review queue for written answers. **Server done and tested end to end
  with the shared key; UI absent.** `GET /api/review` (paged by a `before` cursor;
  `offset` refused), `GET` and `POST /api/review/:answerId` (`routes/review.js`), the
  `answer_reviews` log (`0010`, append-only in the database since `0012`), and the
  profile adjustment (`applyReview`, unit). `scripts/review.mjs`, 83 checks, covers
  confirm and override, the log, idempotent repeats, the grid and CSV following the
  human mark, a review racing a live answer, and a review during a room delete. The
  review note is shown to the student; the UI must say so. **Not tested:** any
  bearer-token caller, including an HOD's 403, and the Supabase and Mongo repo
  methods against a database. A non-uuid id on Supabase is now a 404 (fixed 19 Nov; traced, not run). **Differs from the roadmap:** the roadmap says
  keyword marks stop moving levels until confirmed. Here they count at once and a
  review moves the numbers by the difference. That is a default awaiting the owner
  (`PRODUCT_DECISIONS.md`)
- [x] Fixes from the Phase 1 review (19 Nov 2026): a student's own answer list is
  matched by account only; one roll number per department in the room's form
  (`0011`); keyless answers keyed per student; `student:answer` refuses a question
  from another room's content; a resend rebuilt from a reviewed row keeps the
  review; nothing is written into a room while it is archived and deleted; the
  queue pages by cursor; the evidence and the review log are guarded by the
  database (`0012`). Each has a check, and every one of those checks passes. The
  fixing session reported that each check also fails with its fix switched off; that
  was not repeated in this pass
- [ ] Linking a room profile to an account from a typed roll number lets a student
  who types a classmate's roll number put answers in the classmate's history.
  Needs a signed-in join (client) and decision 7. Not built
- [ ] Student profile across sessions, with the actual answers. **Server done,
  account path untested, UI absent:** `GET /api/analytics/:id/answers` (paged,
  newest first, `?topic=&level=&code=`; matched by account or by an unlinked roll
  number for a professor, by account only for the student themself; a student gets
  their own answers redacted) and a per topic × per level
  `topicLevels` on `GET /api/analytics/:id`. Tested: the redaction for all 16
  kinds, the lister and the topic report on the in-process store
  (`test/evidence.test.js`), the shared key's 404 (`scripts/evidence.mjs`), and
  the filter each of the Mongo and Supabase repos would send. Not tested: a real
  professor or student account calling it, which needs Supabase. `offset` is capped
  at 100,000 (fixed 19 Nov; unit-tested)
- [x] Retrieval APIs over `answers` for a room: `GET /api/session/:code/answers`
  (every attempt, full snapshot, paged, `?rollNo=`) and
  `GET /api/session/:code/topics` (per topic × level, from answers, falling back to
  history for rooms older than the store, with the source named)
  (`scripts/evidence.mjs`, 37 checks). Ticked as APIs: no screen calls them yet.
  `offset` is capped at 100,000 (fixed 19 Nov; unit-tested)

### Phase 2: server done, every screen absent

Roadmap step 2: several kinds per level; generating and editing hot text, dropdown,
table and grid; write-your-own; image and passage authoring; an approval gate
showing the source and check results; Harder / Easier; per-question statistics and
item analysis; room settings and a question set per room.

A box is ticked only when the feature works **end to end with a test**. Here that
means over HTTP and the socket on a real server (the same `createApp` and
`attachSockets` as production), on the in-process store, with the shared key and
offline generation, plus PGlite for the migrations. Nothing in Phase 2 has run
against Supabase, Mongo, Gemini, a signed-in account or a phone browser. **No
screen exists for any of it**, so every UI line is unticked. Endpoints:
`docs/API.md`, "Phase 2". Rerun on 19 November 2026 after the review fixes: unit
343, migrations 270, `bank.mjs` 73, `kinds.mjs` 43, `media.mjs` 67, `items.mjs` 49,
round trip 0 failures, and every Phase 0 and Phase 1 suite unchanged.

**Do not deploy this server before a client that approves.** Every generated
question is now a draft, and the current console cannot approve one (last item of
the approval gate below).

The approval gate

- [x] Provenance and review state on questions (`0013`: the `draft` status,
  `model`, `source_ref`, `checks`, `created_by`, `approved_by`, `approved_at`;
  `contents.topic_slides`). Migration test: fresh build, re-run, and an upgrade from
  v1 in which older questions stay active with nothing recorded. `scripts/bank.mjs`
- [x] Every generated or regenerated question is saved as a draft. It carries its
  model (`offline-template` here), the slides its topic was read from (a `.pptx`
  built by the script; pasted text gives null), its rule checks and its creator
  (`scripts/bank.mjs`). **Not tested:** the Gemini path, which records the model id
- [x] Drafts are never served. The selector and `listQuestions` serve active only
  (unchanged, checked). A phone naming a draft's id, or a rejected draft's, is not
  marked or stored and is moved on (seen to fail with the guard removed). A room on
  a bank with fewer than 6 approved questions and some drafts is refused with 409
  and a sentence saying what to do. The content list, the bank's counts, the
  professor dashboard and the generate reply count drafts apart from approved
  questions (`scripts/bank.mjs`)
- [x] Eight rule checks (`services/checks.js`), advice only: the longest option is
  the key, absolute words, all/none of the above, duplicate or near-duplicate
  options, a wrong option equal to the key, an empty or unmatchable rubric, a stem
  pointing at something only the slide shows, and a selected-response item tagged
  Create. Each is tested both ways (`test/checks.test.js`, 32)
- [x] Approve one, reject one, approve-all. Approval is allowed with failing
  checks, and the reply names them. An edit keeps the status. Split, merge and the
  older restore cannot make model output active without an approval on record
  (`test/approval.test.js`, 24; `scripts/bank.mjs`). **Fixed in the Phase 2
  review:** a rejected draft used to split or merge into active questions; it now
  counts as a draft
- [ ] The gate **showing the source** beside each draft. **Partial:** the server
  returns the slide numbers the draft's topic was read from (`sourceRef`) and the
  check results (`checks`, re-run on every change). It cannot return the passage
  itself: the generator works from the topic's share of the chapter
  (`contextForTopic`), no route returns that share, and the stored raw text keeps
  no slide boundaries. So a screen can say "slides 3 and 4", not show what they say
- [ ] Approval screen. **Absent, and the current console does not know the
  `draft` status.** Traced in the current client during the Phase 2 review, not run
  in a browser. `teach/Bank.jsx` and `teach/Material.jsx` count anything not
  discarded as kept, so drafts look ready. `Material.jsx` shows "no questions yet"
  because `questionCount` leaves drafts out, which invites a second, replacing
  generate that deletes them. `POST /api/session` then answers 409 with no button to
  resolve it. No `approve`, `approve-all` or `draftCount` appears anywhere in
  `client/src`. The client needs approve, reject and approve-all, and must read
  `drafts` / `draftCount` and show `sourceRef` and `checks`

Write-your-own and Harder / Easier

- [x] Write-your-own (`POST /api/bank/:contentId/questions`): any kind at its own
  level (a poll at any), validated by `questionTypes.js`, created active with
  `model` null and the checks as advice. A cross-level kind and a malformed one are
  refused (`scripts/bank.mjs`). **Open:** `source` is `fallback`, by `CONTRACT.md`
  §6 rule 5, and the console labels that as template text; labelling it truthfully
  needs a contract amendment (`PRODUCT_DECISIONS.md`)
- [x] Harder / Easier (`direction` on `POST /api/bank/question/:id/regenerate`): a
  new draft one level up or down, on the same topic and slides, with the original
  untouched. Refused at the ends of the ladder and on a poll; Create is always a
  written answer (`scripts/bank.mjs`). **Not tested:** the Gemini path
- [ ] Write-your-own form, Harder and Easier buttons. **Absent**

Kinds

- [x] Several kinds per level. The plan divides each level over its kinds
  (`kindMix`, or the default: every level with two or more kinds spread over at
  least two, Create a written answer only) without changing any count. Checked on
  77 plan requests and the offline banks, against the code before: unchanged. No
  selected-response kind is planned, generated or accepted at Create
  (`test/kindmix.test.js`, 27; `scripts/kinds.mjs`). **Not tested:** the Gemini
  path (the prompt per kind and count, the per-kind top-up)
- [x] Generating hot text, dropdown, table and grid offline. Each template is
  valid, grounded in the source and keyless on the phone. Each scores 1 for the
  right answer and 0 for a wrong one through the real socket, and is stored as
  evidence (`test/newkinds.test.js`, 26; `scripts/kinds.mjs`, 43). The round trip's
  five failures were missing fixtures, now written: 0 failures. **Not tested:** any
  of the four written by Gemini (the new schema fields have never been sent)
- [x] Editing them over `PATCH`: the whole payload is validated, a bad edit is
  refused with the validator's words and nothing changes, and whitespace is tidied
  without dropping an entry (`scripts/kinds.mjs`). The Mongo fallback's schema used
  to drop these kinds' payloads on save; fixed, and checked without a database
- [ ] Editors for the four kinds, and the kind mix in the planner. **Absent**

Images and passages

- [x] Image upload (`POST /api/media`, `0014`): PNG, JPEG and WebP told by their
  bytes, at most 500 KB, with a required description. SVG, a mislabelled file and
  an oversized one are refused, and another professor's chapter gets the same 404
  as none. Camera metadata is taken out without re-encoding, with the JPEG
  orientation kept (`scripts/media.mjs`, 67; `test/media.test.js`, 27; migrations).
  **Not tested:** Supabase (the bytea encoding is checked against a stubbed
  PostgREST only), Mongo against a database, a bearer-token caller, and a photo
  from a real phone camera
- [x] Image serving (`GET /api/media/:id`): to a teacher always, and to a phone
  only while a room runs on the chapter and an approved question in the room's set
  shows the image. Otherwise the same 404 as an unknown id. Served with its type,
  nosniff, a year's private cache and a sha256 ETag (304 on revalidation)
  (`scripts/media.mjs`). **Not seen:** an `<img>` on a real phone
- [x] Attaching and sharing: an upload goes on a question of its own chapter only,
  judged by where a browser would send the url. The alt is filled from the upload,
  and the slide-only check clears. A passage takes an optional citation
  (`sourceRef`, kept from the phone). One stimulus goes on many questions as equal
  copies through bulk `action: 'stimulus'`. A phone is served both through the
  socket (`scripts/media.mjs`). **Differs from the task:** a figure reference with
  only a passage attached still fails the slide-only check (`PRODUCT_DECISIONS.md`)
- [ ] Upload, attach and share screens; previews in the console. **Absent.** The
  phone's renderer already draws both kinds of stimulus (read, not run in a
  browser)

Item statistics

- [x] Per question, from final, graded answer rows: attempts, proportion correct,
  how many chose each option in the question's own order, mean score for
  partial-credit kinds, an easy / medium / hard band for the class (0.8 and 0.4;
  none under 5 answers), the point-biserial against each student's other answers
  in the room (none under 10 students), and a flag when it is negative. Responses
  are mapped back through each student's shuffle and the fewer-choices list (now
  recorded as `shownOptions`). Served by `GET /api/session/:code/items` and
  `GET /api/bank/:contentId/stats` under the read rule, with the same 404 for
  missing and not yours. Tested in `test/itemstats.test.js` (34, against values
  worked by hand) and `scripts/items.mjs` (49, against a hand count of twelve
  phones' choices). **Not tested:** a bearer-token caller or an HOD; Supabase and
  Mongo against a database; the fewer-choices support reaching a phone through a
  real linked account. Rooms older than the answers table contribute nothing.
- [ ] An Elo-style difficulty per item that corrects the Bloom tag over time
  (roadmap, same section). **Not built**
- [ ] Item statistics screen. **Absent**

Room settings and a question set per room

- [x] Room settings: done in Phase 0 (item 3), unchanged here
- [x] A question set per room (`0015`, `sessions.question_ids`).
  `POST /api/session` takes `questionIds`. Each must be an approved question of the
  chapter, or 400 with one sentence for every kind of refusal; a set has no floor of
  6. The live loop's bank holds only the set, so the selector, a resumed pin and the
  count the phone is told do too. An answer naming a question outside the set is
  not marked or stored. Phones are served an image only through a running room
  whose set can show it. The set is returned by the teacher's routes, kept from the
  phones' room read, and archived with a deleted room. Written once; no route edits
  it. All three repos store it: the in-process store was run, Supabase was checked
  against a stubbed PostgREST, and Mongo by building a document (`scripts/items.mjs`;
  migrations)
- [ ] Picking a room's question set on the Room screen. **Absent**

Fixes from the Phase 2 review (19 November 2026)

- [x] A rejected draft stays unapproved through split, merge and the live loop's
  fallback; image urls are judged as a browser resolves them; uploads lose their
  metadata; option counts no longer move old picks onto reworded options; answer
  snapshots leave out `approvedBy`/`approvedAt`; a replacing generate waits while a
  room on the chapter runs; a plain regenerate of an active question warns that the
  question left rooms. Each has a check, all passing in this rerun. The fixing
  session reported that each failed before its fix (four url-spelling checks in
  `media.mjs` excepted, written after it); that was not repeated in this pass

From the same roadmap sections, not part of this build

- [ ] PDF and Word upload; keeping the unit and lesson structure; no questions from
  title, agenda and transition slides. **Not built**
- [ ] Label-an-image and hotspot kinds (upload now exists; the kinds do not).
  **Not built**
