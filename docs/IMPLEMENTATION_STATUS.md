# Implementation status

Last revalidated: 19 November 2026, against the working tree on branch
`roadmap-phase0-evidence`. The last commit, `b4585a0`, holds Phase 0, the answers
table and the room archive. The Phase 1 review queue, the answer reads, the fixes and
migrations `0010` to `0012` are uncommitted. Every suite below was rerun on
19 November 2026.

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

## Partially implemented

| Area | What exists | What is missing |
|---|---|---|
| Kinds `hottext`, `dropdown`, `table`, `grid` | Server validation, scoring, student widgets | Generation, editor, roundtrip fixtures |
| `poll` | Server scoring and ungraded handling in `mastery.js` | Any way to create one; the live handler ignores the ungraded rule (defect 6) |
| Room settings | Server validation and storage | Applying them (defect 3); any UI |
| Accommodations | Catalogue and account column | Reading them on join, phone rendering, teacher UI |
| Cross-room student history | Analytics by account; topic × level; the actual responses (`/api/analytics/:id/answers`, server only) | Rows for students without accounts; any test with a real account; a screen |

## Absent (by roadmap phase)

- **Phase 1:** the model that wrote each item; each student's last answers in the
  live grid; every Phase 1 screen (the review queue, a student's answer history, the
  topic report, the phone's "provisional" label). See the checklist at the end.
- **Phase 2:** write-your-own question, approval gate for AI drafts, item statistics, per-room question sets.
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

Results, rerun on 19 November 2026 (Node 24.22.3, in-process store and PGlite; no
network service). Phase 0 ended at 103 unit, 11 security and 142 migration checks.

| Suite | Command | Result |
|---|---|---|
| Unit: mastery, selector, edits, integrity, accounts, archive, reviews (`applyReview`), evidence reads (redaction for all 16 kinds, topic report, one student's answers), the three repos | `cd server && npm test` | 172 / 172 |
| Live loop: ownership, evidence, idempotency, polls, retries, redemption, status, room archive | `node server/scripts/liveloop.mjs` | 41 / 41 on each of 5 runs |
| Security harness, including a phone answering another room's question | `node server/scripts/security.mjs` | 13 / 13 |
| Migrations on PGlite: fresh build, re-run, upgrade, constraints, `0010` to `0012` | `cd server && npm run migrations` | 204 / 204 |
| Review queue, end to end with the shared key | `node server/scripts/review.mjs` | 83 / 83 on each of 5 runs |
| Evidence reads, end to end with the shared key | `node server/scripts/evidence.mjs` | 37 / 37 on each of 5 runs |
| Resume, integrity | `node server/scripts/resume.mjs`, `integrity.mjs` | pass (7 and 6 mandated steps, no failures) |
| Question kinds round trip | `node server/scripts/roundtrip.mjs` | 5 failures, the same as the baseline: no fixtures for `hottext`, `dropdown`, `table`, `grid`, `poll` (Phase 2) |

Still missing: any automated client test; an account-path test for anything that
needs Supabase. That means account linking, accommodations from a real account, CSV
export with a bearer token, and the student redirect on `/`. From Phase 1 it also
means: a bearer-token caller on the review queue (including an HOD's 403),
`GET /api/analytics/:id/answers` and `topicLevels` for a real professor or student,
and the Mongo and Supabase repo methods against a real database (only the query
each would send is checked).

## Risks found while revalidating

- **Supabase unreachable.** The project's hostname does not resolve (checked against
  public DNS on 18 November 2026). Every account feature is untestable locally and
  broken on the deployed site until the project is restored.
- **Uncommitted work.** Phase 0 is committed (`b4585a0`, branch
  `roadmap-phase0-evidence`), but the Phase 1 server work and the UI rebuild in
  progress are not; one bad checkout loses both.
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
- [ ] The model that wrote each item. **Absent:** an answer records whether its
  question came from the model or the offline templates (`question_source`), but no
  model name is stored, on questions or on answers
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
