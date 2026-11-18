# Implementation status

Last revalidated: 18 November 2026, against the working tree (the November client
rebuild is uncommitted on `main`; the last commit is `a5590e5`).

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

## Partially implemented

| Area | What exists | What is missing |
|---|---|---|
| Kinds `hottext`, `dropdown`, `table`, `grid` | Server validation, scoring, student widgets | Generation, editor, roundtrip fixtures |
| `poll` | Server scoring and ungraded handling in `mastery.js` | Any way to create one; the live handler ignores the ungraded rule (defect 6) |
| Room settings | Server validation and storage | Applying them (defect 3); any UI |
| Accommodations | Catalogue and account column | Reading them on join, phone rendering, teacher UI |
| Cross-room student history | Analytics by account | Rows for students without accounts; topic; the actual responses |

## Absent (by roadmap phase)

- **Phase 1:** an answer store that keeps the response; a teacher review queue for written answers.
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

Added in this pass (all passing on 18 Nov 2026):

| Suite | Command | Result |
|---|---|---|
| Unit (adds `archive.test.js`, level-jump, history topic) | `cd server && npm test` | 103 / 103 |
| Live loop: ownership, evidence, idempotency, polls, retries, redemption, status, room archive | `node server/scripts/liveloop.mjs` | 41 / 41 (15 clean runs in a row: 12 before the archive checks were added, 3 after) |
| Security harness | `node server/scripts/security.mjs` | 11 / 11 |
| Migrations on PGlite: fresh build, re-run, upgrade, constraints | `cd server && npm run migrations` | 142 / 142 |
| Resume, integrity | `node server/scripts/resume.mjs`, `integrity.mjs` | pass |
| Question kinds round trip | `node server/scripts/roundtrip.mjs` | 5 failures, unchanged from baseline (fixtures; Phase 2) |

Still missing: any automated client test; an account-path test for anything that
needs Supabase (account linking, accommodations from a real account, CSV export
with a bearer token, the student redirect on `/`).

## Risks found while revalidating

- **Supabase unreachable.** The project's hostname does not resolve (checked against
  public DNS on 18 November 2026). Every account feature is untestable locally and
  broken on the deployed site until the project is restored.
- **Uncommitted rebuild.** The whole client rebuild and this work sit uncommitted on
  `main`; one bad checkout loses both.
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

### Phase 1 (started)

- [x] Evidence store: every attempt kept in `answers` with response, question
  snapshot, topic, level, attempt, key, timestamps (`0008`; live loop)
- [x] Written answers stored as `provisional`, machine mark kept beside any review
  (`auto_*` columns; migration test)
- [x] Deleting a room keeps it as a JSON archive under 1 MB, by the owner's decision
  (decision 9; `0009`; unit + live loop)
- [ ] Teacher review queue for written answers (absent)
- [ ] Student profile across sessions, with the actual answers (absent)
- [ ] Retrieval APIs over `answers` (absent)
