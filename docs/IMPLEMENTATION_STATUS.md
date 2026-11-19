# Implementation status

Last revalidated: 19 November 2026, against the working tree on branch
`roadmap-phase0-evidence`. Commit `b4585a0` holds Phase 0, the answers table and the
room archive; commit `05daf56` holds Phase 1 (the review queue, the answer reads, the
fixes and migrations `0010` to `0012`); commit `27559ca` holds Phase 2 (the approval
gate, several kinds per level, images and passages, item statistics, question sets,
the fixes from its review, migrations `0013` to `0015`, and the UI session's Phase 1
screens). Commit `d162cc8` holds Phase 3 (the roster, rooms for a class and
attendance, `0016`; the teacher-record store, `0017`; room modes, the waiting room and
the projector, `0018`; live insights, the student card and class analytics; the fixes
from the Phase 3 review; and the UI session's Phase 2 screens). Commit `eedfd5e`
holds Phase 4. Commit `2f4fd2b` holds the owner's decisions of 19 Nov 2026 (`0022`;
checklist at the end: "The owner's decisions of 19 Nov 2026") and Phase 5: the
confidence tap and class questions (`0023`), misconception labels on wrong options
(`0024`), the honest indicators and the fixes from the Phase 5 review (checklist at the
end: "Phase 5: distinctive classroom features"); `4c1df09` holds the Phase 5
follow-ups. **Commit `646b4e6` holds Phase 6, the Learning Hub, on the server only**
(`0025` to `0029`; checklist at the end: "Phase 6: the Learning Hub"); its docs are the
commit after it. Every suite passes through the offline runner after Phase 6 (the test
table below). Phase 4, as committed:
- course outcomes, their mappings and coverage, and the roster from CSV (`0019`);
- configurable attainment and the marks register (`0020`);
- CSV exports, printable reports and the acceptance run (no migration);
- the fixes from the Phase 4 review (`0021`: the roll number an attendance mark was
  made under).

Its checklist is at the end.

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
- Client: rebuilt November 2026 with light and dark themes, by another session; part
  of it committed with Phase 2 (`27559ca`), the rest in progress (`docs/UI_REBUILD.md`).
- Evidence: every attempt stored, a review queue for written answers, and reads of
  the stored answers and per topic × level reports. Endpoints in `docs/API.md`. The
  UI session reports screens for them (`docs/UI_REBUILD.md`, "Phase 1"; not
  re-checked in this pass).
- Question bank, Phase 2 (server, committed in `27559ca`): generated questions wait as
  drafts until a professor approves them, with the model, the slides and eight rule
  checks recorded; write-your-own; Harder / Easier; several kinds per level, with
  hot text, dropdown, table and grid generated offline and edited; image upload and
  passages as stimuli; item statistics per room and per bank; a question set per
  room. Endpoints in `docs/API.md`, "Phase 2". **The committed console cannot
  approve a draft**; the UI session reports Phase 2 screens, approval included, in
  its uncommitted work (`docs/UI_REBUILD.md`; see the risks).
- Classes and the teaching companion, Phase 3 (server only, committed in `d162cc8`): a class
  roster of roll numbers and names, rooms opened for a class, attendance;
  observations, the full wheel, the raised-hands tally, no-device activities and a
  record of what was done about each flag; Student devices, Teacher-led and Mixed
  rooms, the other room settings, a waiting room; a projector link with three
  screens; live bands, insight cards and KPI tiles, the student card and class
  analytics. A Teacher-led room runs with no phone at all. Endpoints in
  `docs/API.md`, "Phase 3". The UI session's uncommitted client now calls the class,
  roster, observation and class-analytics routes (`client/src/lib/api.js`; not
  re-checked beyond a search).
- Course-outcome attainment, Phase 4 (server only, committed in `eedfd5e`):
  - Course outcomes per class, mapped to topics with weights, with per-question
    overrides, coverage, and copying to another section.
  - A roster imported from a CSV file, with a dry run.
  - The attainment formula as data, saved per class in versions, with two examples
    shipped as data.
  - Student and class attainment per outcome, per Bloom level and per level band,
    split by evidence type and by who wrote the question, with a methodology
    paragraph in every report.
  - The marks register.
  - CSV sheets and printable pages of every report.
  - A room's answers kept with the student through a corrected roll number, by the
    roll number on that room's attendance mark (`0021`).

  Endpoints in `docs/API.md`, "Phase 4: every new and changed endpoint". The UI
  session's uncommitted client now calls these routes (`client/src/lib/api.js`, and
  new screens such as `client/src/account/Attainment.jsx`); not checked in this pass.
- Distinctive classroom features, Phase 5 (server only, uncommitted):
  - a confidence tap (Sure, Think so, Guessing) on every answer and vote, information
    only, counted for staff;
  - class questions: one approved question put to every phone, a pause for
    discussion, a re-vote, the class-level changes as counts, and the key only once
    revealed;
  - misconception labels on wrong options, edited by the owner, with "N students chose
    the option linked to the misunderstanding X" reports per room, class and question;
  - honest indicators: who wrote each question and whether it was approved, uncertain
    levels, the count behind every estimate, the reasons for level moves kept, and
    translation warnings (waiting for a second language).

  Endpoints in `docs/API.md`, "Phase 5: every new and changed endpoint and socket
  event". The UI session's uncommitted client has files for some of it
  (`client/src/learn/ClassVote.jsx`, `client/src/teach/ClassQuestions.jsx`); not
  checked in this pass.

## Partially implemented

| Area | What exists | What is missing |
|---|---|---|
| Kinds `hottext`, `dropdown`, `table`, `grid` | Server validation, scoring, student widgets; since Phase 2, offline generation, the Gemini prompt and schema (never run), `PATCH` validated whole, roundtrip fixtures | The console's editor for them (client); any Gemini run |
| `poll` | Server scoring; ungraded handling applied in the live loop since Phase 0 (defect 6); since Phase 2, a professor can write one (`POST /api/bank/:contentId/questions`, any level) | A screen to write one; the generator never writes one |
| Room settings | Validated, stored and applied in the live loop, with the Room screen to set them (Phase 0, item 3). Since Phase 3 the server also takes the mode, adapt on or off, the start level, questions per student, time per question and a waiting room (`0018`) | The Room screen's controls for the Phase 3 settings, and the phone's timer and waiting and teacher-led cards (client) |
| Accommodations | Catalogue and account column | Reading them on join, phone rendering, teacher UI |
| Cross-room student history | Analytics by account; topic × level; the actual responses (`/api/analytics/:id/answers`, server only) | Rows for students without accounts; any test with a real account; a screen |

## Absent (by roadmap phase)

- **Phase 1:** each student's last answers in the live grid. The model that wrote
  each item is recorded since Phase 2 for new questions only. The screens (the
  review queue, a student's answer history, the topic report, the phone's
  "provisional" label) are reported built by the UI session and committed in
  `27559ca` (`docs/UI_REBUILD.md`); not re-checked in this pass.
- **Phase 2:** in the committed client, every screen. The UI session reports them
  all in its uncommitted work (`docs/UI_REBUILD.md`, "Phase 2"): approving,
  rejecting and approve-all with the slides and check results; write-your-own;
  Harder / Easier; the editors for hot text, dropdown, table and grid; the kind mix
  in the planner; images and passages; item statistics; a room's question set. Not
  re-checked in this pass. The server side of all of these is in.
- **Phase 3:** every screen, and these server pieces:
  - Screens, none built (the client belongs to another session): classes and the
    roster; attendance; the Roster & activities view (observations, the wheel and
    its history, the tally, the five activities); the Room screen's mode, adapt,
    start level, questions per student, time per question and waiting-room
    controls; the waiting room and its Start button; the phone's waiting and
    teacher-led cards and its timer; the projector page, its link and its three
    screens; the live view's bands, cards, KPI tiles and sparklines; the student
    card; class analytics.
  - Not built on the server: a route to delete a
    class; a log of roster changes; the "AI teaching move" (decision 5, which
    `CONTRACT.md` forbids today); a "Next set" that serves the handoff's 3 + 1
    review + 1 stretch (the card shows what the selector serves instead).
  - The server pieces built are in the Phase 3 checklist at the end.
- **Phase 4:** every screen, and these pieces:
  - Screens, none checked against the server (the client belongs to another
    session). The UI session's uncommitted client has files for some of them
    (`client/src/account/Outcomes.jsx`, `RosterImport.jsx`, `Attainment.jsx`,
    `Register.jsx`, `ReportWindow.jsx`), which `docs/UI_REBUILD.md` does not describe
    yet. The screens the phase needs:
    - course outcomes and their mapping (topics, weights, per-question overrides,
      coverage, copy);
    - the roster import with its dry run;
    - attainment settings (presets, the formula's fields, saving a version);
    - the attainment report;
    - one student's report;
    - the marks register;
    - downloading a sheet and opening a page to print.
  - Not built on the server:
    - the roadmap's per-question attainment sheet (one column per question, with
      maximum marks, outcome and level header rows). A question has no maximum
      marks yet;
    - counting deleted rooms (their archives are not read);
    - a route to read an older version of a formula;
    - best n of m rooms and scaling to a college's maximum marks in the register;
    - indirect attainment (surveys) or a blend with examinations;
    - a department-wide or college-wide default formula (each class saves its own;
      `PRODUCT_DECISIONS.md`, open questions);
    - following a renamed topic;
    - a route to merge answers given under a corrected roll number in a room whose
      marks were made before `0021` (since `0021` the mark ties them).
  - The server pieces built are in the Phase 4 checklist at the end.
- **Phase 5:** every screen, none checked against the server: the phone's tap,
  class-question and provenance screens; the console's class question controls,
  confidence counts, misconception labels and reports, provenance chips, uncertain
  levels, counts beside estimates, the student card's level moves and translation
  warnings; the projector's class-question screen. The server side of all four
  directive items is in (checklist at the end), and since the follow-ups of 19 Nov
  2026 so are the UI session's three server asks (each phone's own `mine` after a
  resume and at a class question's pause, `under18Note` on a class read, `levelBands`
  on the staff dashboards and analytics).
- **Phase 6:** the Learning Hub. **Server done** (`646b4e6`, `0025` to `0029`): the
  content backbone and one access rule, practice with feedback, Elo, the error log,
  FSRS reviews, Get Ready and refresher paths, self-tests, goals and the hub home,
  lessons, English, Hindi and Marathi, and the hint tutor (checklist at the end).
  Absent: every hub screen, a live chat tutor (an owner option, not built), and the
  shared-bank changes decided for batch 8 (`docs/PRODUCT_DECISIONS.md`).
- **Phase 7:** offline outbox, service worker, laptop-server mode.

## Dependencies between features

- Answer store (Phase 1) needs the idempotency key (defect 8) and topic on history (defect 4).
- Review queue, item statistics, attainment and the Hub all read the answer store.
- Attainment needs the roster (Phase 3) and course outcomes mapped to topics or
  questions (Phase 4, built: an answer is traced to its outcomes when a report runs,
  so no tag is stored on a question or an answer).
- The Hub needs a lasting student identity: `profiles.account_id` written on join (defect 9) or the decision in `PRODUCT_DECISIONS.md` §7.
- The offline outbox needs idempotency keys and a light student bundle (defects 5 and 8).

## Tests: existing and missing

Existing: unit tests for mastery, selector, edits, integrity, accounts; four end-to-end
scripts driving a real socket server on the in-memory store.

Missing before this pass: room settings in the live loop, poll handling, ownership on
`teacher:watch`, idempotent answer submission, migrations building a fresh database,
the client (no client tests exist).

Results after Phase 6. Every suite was run through the offline runner
(`docs/TESTING.md`) on 19 November 2026, on commit `646b4e6`, which first blanks these
in the environment: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`,
`MONGO_URI`, `GEMINI_API_KEY`. Node 24.22.3, the in-process store and PGlite; no
network service. Each figure below is what that run printed (the Phase 6 docs pass's
own run); every exit code was 0, and every script that answers the Auth calls itself
ended with no request off the machine.

Earlier phases ended at:

| Phase | Unit | Security | Migrations |
|---|---|---|---|
| 0 | 103 | 11 | 142 |
| 1 | 172 | 13 | 204 |
| 2 | 343 | | 270 |
| 3 | 475 | | 451 |
| 4 | 598 | 13 | 573 |
| 5 (after its follow-ups) | 721 | 13 | 752 |

How Phase 6 grew, as each piece reported it through the offline runner. The builders
worked from an earlier snapshot (unit 710, migrations 752), so their figures do not
add up to this run's; the last row is this run, on `646b4e6`:

| Piece | Unit | Migrations | New script |
|---|---|---|---|
| The content backbone (`0025`) | 763 | 847 | `hub.mjs` 78 |
| Practice, Elo, the error log, reviews (`0026`) | 802 | 934 | `practice.mjs` 74 |
| Lessons and languages (`0027`) | 802 | 948 | `lessons.mjs` 84 |
| The two merged and wired | 847 | 1037 | `lessons.mjs` 93 |
| Get Ready, self-tests, goals (`0028`) | 871 | 1130 | `paths.mjs` 85 |
| The tutor (`0029`) | 883 | 1131 | `tutor.mjs` 82 |
| The two merged and wired | 911 | 1226 | |
| The fixes from the review, landed on `fdac198` (this run) | 940 | 1226 | `hub.mjs` 78, `practice.mjs` 78, `paths.mjs` 88, `lessons.mjs` 100, `tutor.mjs` 84 |

How Phase 5 grew, each through the offline runner as each piece reported it:

| Piece | Unit | Migrations | New script |
|---|---|---|---|
| The owner's decisions (`0022`) | 623 | 633 | `decisions.mjs` 64 |
| Confidence taps and class questions (`0023`) | 643 | 697 | `classquestion.mjs` 70 |
| Misconception labels (`0024`) | 683 | 752 | `misconceptions.mjs` 54 |
| Honest indicators | 710 | 752 | `honesty.mjs` 59 |
| The review fixes | 719 | 752 | `keysafety.mjs` 41; `decisions.mjs` 78 |

| Suite | Command | Result |
|---|---|---|
| Unit: mastery, selector, edits, integrity, accounts, archive, reviews, evidence reads, the three repos (144 methods each); since Phase 2 also `checks`, `approval`, `kindmix`, `newkinds`, `media`, `itemstats`; since Phase 3 also `roster`, `wheel`, `records`, `modes`, `insights`; since Phase 4 also `outcomes`, `attainment`, `exports`; since 19 Nov 2026 also `decisions`, `classQuestions`, `misconceptions`, `honesty`; since Phase 6 also `hubBackbone` (34), `richText` (19), `hubPractice` (39), `hubLessons` (39), `hubSeams` (6), `hubPaths` (24), `hubTutor` (36), `hubPathsTutor` (4), `hubFixes` (18) | `cd server && npm test` | **940 / 940** (219 suites) |
| Live loop: ownership, evidence, idempotency, polls, retries, redemption, status, room archive | `node server/scripts/liveloop.mjs` | 41 / 41 |
| Security harness, including a phone answering another room's question | `node server/scripts/security.mjs` | 13 / 13 |
| Migrations on PGlite: fresh build, re-run, upgrade, constraints, `0010` to `0029` | `cd server && npm run migrations` | **1226 / 1226** |
| Review queue, end to end with the shared key | `node server/scripts/review.mjs` | 83 / 83 |
| Evidence reads, end to end with the shared key | `node server/scripts/evidence.mjs` | 37 / 37 |
| Resume, integrity (both read `server/.env`; the runner blanks the network settings first) | `node server/scripts/resume.mjs`, `integrity.mjs` | pass: 7 and 6 mandated steps, 0 failures, 0 supporting failures, 0 known holes |
| Question kinds round trip | `node server/scripts/roundtrip.mjs` | **0 failures** (16 kinds, 64 checks) |
| Approval gate (Phase 2) | `node server/scripts/bank.mjs` | 73 / 73 |
| Kinds per level and the four kinds (Phase 2) | `node server/scripts/kinds.mjs` | 43 / 43 |
| Images and passages (Phase 2) | `node server/scripts/media.mjs` | 67 / 67 |
| Item statistics and question sets (Phase 2) | `node server/scripts/items.mjs` | 49 / 49 |
| Roster, rooms for a class and attendance (Phase 3), signed-in callers | `node server/scripts/roster.mjs` | **80 / 80** |
| Teacher records (Phase 3), signed-in callers | `node server/scripts/records.mjs` | **97 / 97** |
| Room modes, the waiting room and the projector (Phase 3), signed-in callers | `node server/scripts/modes.mjs` | **101 / 101** |
| Live insights, the student card and class analytics (Phase 3), signed-in callers | `node server/scripts/insights.mjs` | **66 / 66** |
| Course outcomes, their mappings and coverage, the roster from CSV (Phase 4), signed-in callers | `node server/scripts/outcomes.mjs` | **87 / 87** |
| Attainment and the marks register (Phase 4), signed-in callers | `node server/scripts/attainment.mjs` | **73 / 73** |
| The directive's acceptance criterion: exports and printable pages (Phase 4), signed-in callers | `node server/scripts/acceptance4.mjs` | **76 / 76** |
| The owner's decisions of 19 Nov 2026, the decision 7 fix included, signed-in callers | `node server/scripts/decisions.mjs` | **79 / 79** |
| Confidence taps and class questions (Phase 5), eight phones, signed-in callers | `node server/scripts/classquestion.mjs` | **76 / 76** |
| Misconception labels (Phase 5), signed-in callers | `node server/scripts/misconceptions.mjs` | **54 / 54** |
| Honest indicators (Phase 5), signed-in callers | `node server/scripts/honesty.mjs` | **66 / 66** |
| A class question's key and whose vote counts (the Phase 5 review fixes), signed-in callers | `node server/scripts/keysafety.mjs` | **43 / 43** |
| The hub's content backbone, access rule and `rich` (Phase 6), signed-in callers | `node server/scripts/hub.mjs` | **78 / 78** |
| Hub practice, Elo, the error log, reviews, explanations, closed questions (Phase 6), signed-in callers, fixed clock | `node server/scripts/practice.mjs` | **78 / 78** |
| Get Ready, refresher paths, self-tests, goals, the hub home (Phase 6), signed-in callers | `node server/scripts/paths.mjs` | **88 / 88** |
| Lessons and languages (Phase 6), signed-in callers | `node server/scripts/lessons.mjs` | **100 / 100** |
| The hint tutor (Phase 6), signed-in callers | `node server/scripts/tutor.mjs` | **84 / 84** |

The older scripts' figures above (`insights.mjs` 66, `decisions.mjs` 79,
`classquestion.mjs` 76, `honesty.mjs` 66, `keysafety.mjs` 43) are what they printed
after the Phase 5 follow-ups (`4c1df09`); Phase 6 changed none of them.

"Signed-in callers" means the script answers the server's three Supabase Auth calls
itself, for a host that cannot resolve, and refuses and counts any other request off
the machine (0 in every run): a real professor, HOD or student token was never used.

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

How the numbers grew during Phase 3, each through the offline runner on 19 November
2026 as each piece of work reported them (`docs/TESTING.md` has every table): the
roster, unit 374, migrations 326, `roster.mjs` 80; the teacher records, unit 417,
migrations 414, `records.mjs` 96; the modes, unit 434, migrations 451, `modes.mjs` 85;
the insights, unit 467, `insights.mjs` 65; the review fixes, unit 475, `modes.mjs`
101, `records.mjs` 97. Every Phase 0 to 2 suite gave the same figure after each piece
as before it. The rerun for this table matched the last of these.

How the numbers grew during Phase 4, each through the offline runner on 19 November
2026 as each piece of work reported it:

| Piece | Unit | Migrations | New script |
|---|---|---|---|
| Course outcomes and the CSV import | 518 | 509 | `outcomes.mjs` 86 |
| Attainment and the register | 558 | 533 | `attainment.mjs` 65 |
| Exports and printable pages | 573 | 533 | `acceptance4.mjs` 73 |
| The fixes from the review (`0021`) | 598 | 573 | `outcomes.mjs` 87, `attainment.mjs` 73, `acceptance4.mjs` 76 |

Every Phase 0 to 3 suite gave the same figure after each piece as before it, and again
in the runs for the table above. The review fixes added 25 unit tests (`outcomes` 44,
`attainment` 56, `exports` 21, `roster` 35, from 43, 40, 15 and 33), 40 migration
checks for `0021`, and checks to the three Phase 4 scripts. A docs pass between the
exports and the fixes found three suites failing on a half-finished change to the
class figure (unit 583 / 584, `attainment.mjs` 64 / 66, `acceptance4.mjs` 70 / 73);
the fixes finished that change, and those figures no longer hold.

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
account; and every Phase 2 screen against the server (the UI session reports its own
checks in `docs/UI_REBUILD.md`). From Phase 3: `0016` to `0018` on the real database
(their guard triggers under the real service role); the Supabase and Mongo methods
for classes, attendance, records, links and `listSessionsForClass` against a real
store (requests checked against a stubbed PostgREST, Mongo schemas by building
documents); a real Supabase Auth token (the scripts answer the Auth calls
themselves); a roster or attendance over 1000 rows on Supabase; two server processes
(the projector's screen, the insights' series and push throttle, and the status,
attendance and records locks are in one process's memory); a server restart with a
room running; any phone, console or projector browser, since no Phase 3 screen
exists.

From Phase 4:
- `0019`, `0020` and `0021` on the real database: their triggers under the real
  service role, PostgREST's partial unique index, `uuid[]`,
  `order=version.desc&limit=1`, and `attendance.roll_no` written by an upsert.
- The twelve new repo methods, and the attendance methods writing a mark's roll
  number, against a real Supabase or Mongo. The requests are checked against a stubbed
  PostgREST, and the Mongo schemas by building documents.
- A real Supabase Auth token.
- Two screens editing one class's outcomes at once, and two formula saves racing on
  Supabase.
- A copy or a topic set failing part way on Supabase.
- Coverage and the reports over thousands of answers on Supabase.
- A CSV export from a real spreadsheet in another encoding.
- Any spreadsheet program opening a sheet, including one that splits on semicolons
  (the guard after a semicolon is checked by bytes only).
- Printing on paper, or in Firefox or Safari. Only a headless Edge printed the pages,
  to PDF, and before the review fixes.
- A console fetching a page and opening it from a blob or `srcdoc`.
- Any screen. The UI session's uncommitted client calls the Phase 4 routes; its
  screens were not checked against the server here.

From the owner's decisions and Phase 5:
- `0022`, `0023` and `0024` on the real database, and the four class-question repo
  methods, the `classQuestionId` / `classVotes` / `verifiedOnly` filters and the
  `misconceptions` column against a real Supabase or Mongo (their request shapes were
  read, not run against a database).
- A real Supabase Auth token at `student:join`, or anywhere: every signed-in caller,
  the student who links a room included, was answered in-process.
- A model proposing misconception labels (a fixture response was parsed) and any other
  model call.
- A language other than English from a real phone: none sends one, so the
  translation warning was tested on fixture rows only.
- Two server processes: the class question's locks, push throttle and the projector's
  `showCounts` are in one process's memory. A restart was stood in for by a second
  server over the same in-process store.
- Closing a room when the store fails while closing its class question: since the
  follow-ups, run on the in-process store with the update made to fail
  (`classquestion.mjs`), not against a real store's failure.
- Any phone, console or projector screen for any of it.

From Phase 6 (the Learning Hub):
- `0025` to `0029` on the real database: their triggers (the topic-link loop guard, the
  written-once guards on lessons, runs and hint views, the run and hints checks on hub
  attempts) under the real service role, and the two approve functions called through
  PostgREST's `rpc`. Only PGlite ran them.
- About 70 new repo methods against a real Supabase or Mongo. The parity test shows
  all three stores have the same 144 methods; a few Supabase request shapes were
  checked against a stubbed fetch; no Mongo method ran.
- **A real Supabase Auth token.** The hub is for accounts only, and every hub caller
  in every script was answered in-process: accounts work only through that shim.
- Any model call: link proposals, lessons, translations, explanations and hint drafts
  were tested with fixture replies through the real parsers, or a stand-in model.
- Hindi or Marathi through Get Ready or a self-test; the quality of any translation.
- How MathML, shiki's colours and Devanagari look in a browser or on a phone.
- Two server processes (every hub lock and background run is in one process), a
  restart in the middle of a run, and a semester's attempts on Supabase.
- Any hub screen: none exists.

## Risks found while revalidating

- **Supabase unreachable.** The project's hostname does not resolve (checked against
  public DNS on 18 November 2026). Every account feature is untestable locally and
  broken on the deployed site until the project is restored. **The whole Learning Hub
  is an account feature**: nothing of it has run against Supabase or with a real Auth
  token, and it answers 503 on any server without Supabase.
- **Committed, not deployed.** Phases 0 to 5 are committed on branch
  `roadmap-phase0-evidence` (`b4585a0`, `05daf56`, `27559ca`, `d162cc8`, `eedfd5e`,
  `2f4fd2b`, `4c1df09`). Phase 6 (`646b4e6` and its docs) is on a branch of its own,
  built on that one and not yet merged into it. Nothing of Phase 6 is deployed or
  pushed.
- **Phase 6 migrations.** `0025` to `0029` are route-only: a server deployed without
  them keeps Supabase and every room, logs the file and what fails, and only the hub's
  routes fail. Apply them in number order, before or after the server. None has run
  anywhere but PGlite.
- **The shared question bank** (Phase 6 review, owner's call decided for batch 8).
  Practice shows the key of every approved question after one try, so a student can
  collect the keys of questions a graded room will ask later. Only questions a room is
  asking right now are closed in the hub. The batch 8 changes ("rooms only" questions,
  rooms avoiding what a student practised, practice marking only what it served, ending
  a Get Ready check) are decided and not built (`docs/PRODUCT_DECISIONS.md`).
- **A topic record with a lesson but no questions or links** is deleted, with its
  lessons, when it leaves its chapter's topic list (`0027` cascades; the sync counts only
  questions and links as use). Found while writing the Phase 6 docs; traced, not run.
- **Hub estimates are replayed per request** from every attempt on the topics involved
  (as attainment is), and each practice request also reads the open rooms on the
  chapter, the student's self-tests and checks. Not measured on Supabase.
- **Deploying the server before a client that approves.** Every generated question
  is a draft since Phase 2, and the committed console has no approve, reject or
  approve-all. A professor who generates a bank then cannot open a room on it (409),
  and the screen invites a second, replacing generate. The UI session's uncommitted
  client approves (`docs/UI_REBUILD.md`); the server must not be deployed without it.
- **Migrations before the server.** `0013` to `0018` must be applied to Supabase, in
  order, before the Phase 3 server is deployed. Without them the boot probe falls
  back to the in-process store, which saves nothing. None of the six has run
  anywhere but PGlite. `0019` and `0020` (Phase 4) are different. The boot probe does
  not check them, on purpose: a server deployed without them keeps every room working
  and answers the outcome and attainment routes with a 500 naming the missing table.
  Apply them before anyone uses those routes. **`0021` must be applied before this
  server is deployed**, and the boot probe does not check it either: the repo writes
  `attendance.roll_no` on every attendance mark, so on a database without it every
  mark would be refused (traced from the code, not run on Supabase). A join would be
  let in and mark nobody, with the failure only logged; a professor's marks would fail.
  None of the three has run anywhere but PGlite. Apply order: `0019`, `0020`, `0021`.
  **`0022`, `0023` and `0024` must be applied, in that order, before the server of the
  owner's decisions and Phase 5 is deployed.** Every join and answer writes `0022`'s
  and `0023`'s columns, every room's bank reads `class_questions`, and every question
  saved writes `0024`'s column, so the boot probe treats all three as pieces rooms
  need: missing any one, the server does not use Supabase at all and its log names the
  file to apply. None of the three has run anywhere but PGlite.
- **Attainment leaves out deleted rooms.** An archive's class is inside its JSON, so a
  report does not read archives, and every report says so. A professor who deletes a
  room loses its answers from attainment, though they are kept in the archive.
- **The reports read every answer of the class's rooms on each request** (all
  attempts, for the best-attempt rule), as coverage and the remove check do. This is
  fine at class size on the in-process store, but was not measured on Supabase.
- **Re-running every migration once a room is waiting** (Phase 3 review, fixed).
  `0005` now lists `'waiting'` too; the migration test re-runs the set with a room
  left waiting.
- **The phone is still told the band, by the committed client** (Phase 3 review).
  Fixed on the server on 19 Nov 2026 (decision (a), `CONTRACT.md` Amendment 3): the
  phone gets a `PhoneRow` with no `slowLearner`, signals or band sentence. The phone
  client must stop showing the old fields; until it does, no screen should show them
  to a student.
- **A typed roll number marks attendance and gets a student's supports** (decision
  7). A classmate's phone can mark someone present in a class room, and is given the
  roster student's supports. The mark says `source: joined`, every attendance read
  carries the caveat, and a professor's own mark always wins. Kept by decision (rooms
  stay account-free); a typed roll number no longer exposes anything in the student's
  own history, nor takes a signed-in student's class vote.
- **Closing a room while a class question runs** (Phase 5 review, fixed in the
  follow-ups). The close awaited the class question's close inside the status lock
  with no catch; a store error there answered 500 for a room already closed and the
  phones were not told `session:closed`. Reproduced with the store's update made to
  fail, then fixed: the error is logged and the close goes on (`classquestion.mjs`).
  The class question is then left running in the store, and can be closed by hand.
- **A class question's key before the reveal** (Phase 5 review, fixed). Four routes
  by which a phone could learn it (the bank id on `class:question`, a vote's key sent
  as an answer, a resend of an answer to the asked question, an early vote) are
  closed and checked over every event the phones heard (`keysafety.mjs`). A phone
  that answered the question on its own before it was asked was shown its key then;
  the professor is told how many, and their votes do not count in attainment.
- **State held in one process's memory** (Phase 3): what the projector shows, the
  insights' KPI series and their "since the start", the insights' push throttle, and
  the status, attendance and records locks; since Phase 5 also the class question's
  vote and state locks, its push throttle and the projector's `showCounts` (the class
  question's state itself is stored). A restart loses the first three (the
  projector shows an empty question screen, first names off for older rooms; the
  series starts again); a second server process would share none of it, and two
  processes could interleave writes the locks keep apart in one. Fine for one
  process; not for scaling out.
- **A deleted room's teacher screens stay subscribed to its code** (Phase 3 review,
  not acted on). Delete and close never take sockets out of `teacher:<code>`, and the
  code is free again; a new room drawing the same code would send its grid and
  insights to a stale screen of the deleted room. Needs a code collision; traced, not
  reproduced (`docs/API.md`, "Known open issues").
- **Rosters over 1000 rows on Supabase** (Phase 3 review, not acted on).
  `listClassStudents` and `listAttendance` rely on `.limit(5000)`, which PostgREST's
  `max-rows` overrides; removed students are kept for ever, so a class with turnover
  can pass 1000 rows and every attendance figure, the wheel's pool and the grid's
  names would then rest on part of the roster, silently. Traced, not run.
- **Observations of a class room go with the room they were typed in** (Phase 3
  review, open). Deleting one room of a class-day changes the mark in force the
  class's other rooms show for that day. Owner's call (`docs/PRODUCT_DECISIONS.md`).
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
  `.env` holds Supabase or Gemini keys they would try to use them. Every run since
  Phase 3 began goes through the offline runner, which blanks those settings in the
  environment first (`docs/TESTING.md`). The scripts themselves were not changed.
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
Endpoints: `docs/API.md`. Since this list was written the UI session has built the
Phase 1 screens, committed in `27559ca` (`docs/UI_REBUILD.md`, "Phase 1"); the
"UI absent" notes below are left as written and were not re-checked in the Phase 3
pass.

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
question is now a draft, and the committed console cannot approve one (last item of
the approval gate below). Since this list was written the UI session reports every
Phase 2 screen in its uncommitted work (`docs/UI_REBUILD.md`, "Phase 2"); the screen
lines below are left as written and were not re-checked in the Phase 3 pass.

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

### Phase 3: server done, every screen absent

Roadmap step 3: "the roster and teacher-record store: class and section, attendance,
observations, the full wheel, the hands tally, Teacher-led and Mixed modes, the
waiting room, insight cards, three bands, the student card, class analytics,
projector modes". It restores the handoff's teaching companion, and a Teacher-led
room is the first mode that needs no student phone.

A box is ticked only when the feature works **end to end with a test**. Here that
means over HTTP and the socket on a real server (the same `createApp` and
`attachSockets` as production) on the in-process store, **with signed-in callers**:
`roster.mjs`, `records.mjs`, `modes.mjs` and `insights.mjs` answer the server's three
Supabase Auth calls (whose token, that account, an HOD's department) in-process for a
host that cannot resolve, so a professor, a second professor, an HOD of the
department, an HOD of another department and a student account all go through
`requireTeacher`, `scopeFor` and `ownership.js` as written; any other request off the
machine is refused and counted (none in any run). Plus PGlite for `0016` to `0018`.
Nothing in Phase 3 has run against Supabase, Mongo, a real Auth token or any browser.
**No screen exists for any of it**, so every screen line is unticked. Endpoints:
`docs/API.md`, "Phase 3: every new and changed endpoint and socket event". Rerun on
19 November 2026 after the review fixes, all through the offline runner: unit 475,
migrations 451, `roster.mjs` 80, `records.mjs` 97, `modes.mjs` 101, `insights.mjs`
65, and every Phase 0 to 2 suite unchanged. No new dependency.

**Do not deploy this server** before `0013` to `0018` are applied and a client that
approves drafts is in place (risks, above).

Class and section, and the roster

- [x] Classes (`0016`): course name, section, optional term, owned like a chapter.
  The owner reads and writes; an HOD of the department reads and gets 403 on every
  write (and may not create one); another professor, an HOD elsewhere and the shared
  key get the same 404 as for an id that does not exist. Course, section and term
  holding an email address or a mobile number are refused (`scripts/roster.mjs`,
  `test/roster.test.js`)
- [x] The roster: a roll number and a name per student, nothing else (the migration
  test fails if a column is added). Added in bulk from a JSON list; every refused row
  comes back with its position and a reason (missing or unjoinable roll number,
  missing or over-long name, a name holding an email, a long number or a short date,
  already on the roster, removed earlier, twice in the list, class full at 500).
  Fields other than `roll`, `rollNo` and `name` are dropped and named in
  `ignoredFields`. Roll numbers are kept in the room's form, so `" 21cs01 "` typed on
  a phone is the roster's `21CS01`; `03` and `3` stay two students, as they are to
  `rollKey` and the room. Edit one student, remove one (soft: `removed_at`), restore
  one (`test/roster.test.js`, `scripts/roster.mjs`, migrations)
- [x] Removal keeps history: the removed student's answers, attendance and roster row
  stay; they leave the class size and are no longer marked present by a join; adding
  their roll number again is refused with "restore" (`scripts/roster.mjs`)
- [x] A room opened for a class (`POST /api/session` `classId`): only a class the
  caller may change, otherwise the same 404 as a missing one. `classId` is returned
  by the open and the room list and kept in the archive; a room opened for no class
  archives with no `classId` key, byte for byte as before. A room without one behaves
  exactly as before: its grids have no new field (`scripts/roster.mjs`)
- [ ] Classes and roster screens. **Absent** (the client is being rebuilt by another
  session)
- [x] Roster import from CSV: built in Phase 4 (its checklist, below). No route
  deletes a class, and roster changes (who renamed or removed whom) are not logged

Attendance

- [x] Attendance (`0016`): a phone joining with a roster roll number marks the
  student present (`source: joined`) unless the professor already marked them; a
  roll number off the roster joins as always and is reported as not on the roster.
  The professor marks one or many (present, absent, late) or "joined present, the
  rest absent", which keeps every hand mark and is a 409 in a Teacher-led room. A
  list with one bad row changes nobody. The professor's mark is never replaced by a
  later join or rejoin. Unmarked is reported as unmarked, not absent; the summary is
  "N / M present", late counted as there. Teacher-only; nothing reaches a phone or
  `GET /api/session/:code` (`scripts/roster.mjs`, `scripts/modes.mjs`,
  `test/roster.test.js`)
- [x] The live grid for a class room: each row's `rosterName` (null off the roster)
  and `attendance` ({ present, classSize, summary }) on `teacher:grid` and
  `GET /grid`, pushed after a teacher marks; students who never joined are not rows.
  Nothing renamed; the phone's own row (`buildGridRow`) is unchanged
- [x] The archive of a deleted class room keeps every mark with the roll number and
  name the roster held (`test/roster.test.js`, `scripts/roster.mjs`)
- [ ] **A typed roll number is not proof of identity** (decision 7): a classmate's
  phone can mark someone present. Said in every attendance read (`caveat`); not
  solved
- [ ] Attendance screen. **Absent**

Observations

- [x] Observations (`0017`): Understood, Participated, Needs revision, Needs
  additional support, with an optional note of at most 280 characters (no email
  address or mobile number). One per student per class per day, the day the room was
  opened in India's time; setting replaces the day's mark, clearing is allowed, and
  every set and clear is a row of an append-only table, so the replaced mark stays in
  the day's log. Keyed to the roster student in a class room (two rooms of the class
  on one day share the mark), to the room and roll number otherwise. Read per room and
  per class student across days, with nobody joined (`scripts/records.mjs`,
  `test/records.test.js`, migrations)
- [ ] **Open, for the owner:** a class room's observations go with the room they were
  typed in, so deleting one room of a class-day changes the mark the class's other
  rooms show for that day (`docs/PRODUCT_DECISIONS.md`)

The full wheel

- [x] A fair draw on the server with `crypto.randomInt`, stored before the reply, so a
  screen's spin only animates a choice already made; present only (attendance in a
  class room, the phones that joined otherwise), no repeats, rounds that never delete
  a pick, "N picked of M" and the pool size of every pick. Who was drawn, in which
  round and place and from how many is written once (the database refuses a change).
  Each pick's ask (bank with one of the room's approved questions, diagram, demo) and
  response (Answered, Passed to partner, Needs help, Skipped, Absent; it starts
  Pending). Absent also marks attendance absent unless `markAttendance: false` (a
  default, `docs/PRODUCT_DECISIONS.md`). A closed room draws nothing
  (`scripts/records.mjs`; `test/wheel.test.js` drives the draw with an injected
  source, and 7000 real draws come out near even)

The hands tally, and the no-device activities

- [x] The raised-hands tally: a question asked aloud (text, or a question of the
  room's bank with its text kept), options A to D with labels, counts that never go
  below 0 (a decrement at 0 answers `clamped`; the database refuses a negative),
  revealed, the correct option, "N of M present responded" from attendance, and in
  words when nobody is present or there are more hands than students present
  (`scripts/records.mjs`)
- [x] The five no-device activities (check, think, group, diagram, real) with an
  outcome; a group challenge records groups with yes / partly / no, never students; a
  quick check points at its tally (`scripts/records.mjs`)
- [ ] The Roster & activities view (observations, the wheel and its history, the
  tally, the activities). **Absent**

Teacher-led and Mixed modes, and the room's other settings

- [x] Room settings (`0018`) on `POST /api/session`, all optional with how rooms ran
  before as the default, written once and returned wherever settings are (the open,
  the room list, the phones' room read, `session:accepted`): `mode`, `adapt`,
  `startLevel`, `questionsPerStudent`, `timePerQuestion`. Each out of range is a 400
  naming it. A deleted room's archive keeps only the ones a room changed
  (`scripts/modes.mjs`, `test/modes.test.js`, migrations)
- [x] Adapt off: answers recorded and counted, nobody promoted or demoted, the reason
  saying so; the below-40% ceiling still holds (`CONTRACT.md` section 6 rule 4). Start
  level: a new student starts and is served there. Questions per student: at the cap,
  `server:exhausted` with a reason, and an answer to a question never served is not
  taken. Time per question: sent with every question; a late answer is taken and
  marked (`scripts/modes.mjs`, `test/modes.test.js`)
- [x] Teacher-led: needs a class (400, and the database refuses it too); a phone is
  sent `session:teacher-led` and is never served, profiled or marked present; the
  wheel, observations, the tally, activities and the projector run it with no phone;
  a bank question's key may go on the wall only here (`scripts/modes.mjs`,
  `scripts/insights.mjs`)
- [x] Mixed: phones as on Student devices; the teacher's grid carries `feed`, the
  digital answers and the teacher records each under its own label and never added
  together, pushed after each record (in Teacher-led rooms too, without the digital
  half). A Student-devices room's grid and pushes are as before (`scripts/modes.mjs`)
- [ ] **Open, for the owner:** whether adapt off should hold a below-40% student at the
  start level (the contract says no today); a Teacher-led room still needs 6 approved
  questions like any room
- [ ] The Room screen's controls for these, and the phone's teacher-led card and
  timer. **Absent**

The waiting room

- [x] `lobby: true` opens a room `waiting`: phones join and get `server:waiting`;
  asking or answering while waiting is told to wait and stores nothing; the
  teacher's grid has the waiting line ("N / M present", `canStart`);
  `POST /api/session/:code/start` (owner only; 409 when nobody has joined a
  Student-devices or Mixed room, when already started, or closed) serves every
  waiting phone once and late joiners as usual; pause and resume refuse a waiting
  room; the image rule and a replacing generate count it as running. Start, pause,
  resume and close take one status lock per room and re-read the status under it: a
  close during a start leaves the room closed, two starts give 200 and 409, a delete
  waits the lock out (`scripts/modes.mjs`, with 80 ms of latency put on the store to
  widen the race)
- [ ] The waiting room screen with its Start button, and the phone's waiting card.
  **Absent**

Three bands and insight cards

- [x] Three accuracy bands (Needs support below 0.4, Developing, Excelling from 0.6),
  in one constant, from 3 graded answers, null below ("not enough answers yet");
  Needs support equal to the engine's below-40% band (`test/insights.test.js` checks
  every right/wrong count to 12 and every fraction to 60 answers)
- [x] `GET /api/session/:code/insights`: each student's band and reason, the three
  sort orders, the counts; the Focus, Support and Participation cards, each with its
  evidence in the text, an action, and a flag id built from its evidence; KPI tiles
  (class accuracy, Needs support, participation) with each one's start and change;
  the series per minute; a Mixed or Teacher-led room's teacher records counted apart
  (`scripts/insights.mjs` checks every figure against hand counts)
- [x] The roadmap's five rules for flags, each with its test: they describe evidence
  and predict nothing (each card's figures checked against hand counts, and no card
  holding "risk", "fail", "likely", "will", "slow" or "predict"); staff-only (no phone event
  or public read carries one); dismissible (an insight action; back when its evidence
  changes, an "acted" ends it); never on the projector (every projector event
  searched); and what was done is recorded (`insight_actions`, append-only, a flag id
  of the cards' own shape only) (`scripts/insights.mjs`, `scripts/records.mjs`)
- [x] `teacher:insights` to the room's teacher screens only, at once on watching and
  after grid pushes and insight actions, at most once every 2 seconds per room with
  one more after the last change (`scripts/insights.mjs`)
- [ ] The live view's bands, cards, tiles and sparklines. **Absent**
- [ ] The "AI teaching move". **Not built**: it needs a model call during class, which
  `CONTRACT.md` forbids today (decision 5)
- [ ] **In memory, by design:** the series and every "since the start" are lost on a
  restart (not exercised) and not shared between server processes

The student card

- [x] Name, band, the level being served and the ceiling, accuracy per level with the
  answers behind it and the class's beside it, the last ten final answers in the
  professor's view, the next set as the selector would serve it (marked as a plan;
  clipped at the ends and by the band), and this room's records about them; a roster
  student with no phone has one; any other roll number is 404 (`scripts/insights.mjs`,
  `test/insights.test.js`). **Differs from the handoff:** "Next set" is not its fixed
  3 + 1 review + 1 stretch, which the selector does not serve (`PRODUCT_DECISIONS.md`)
- [ ] The student card screen. **Absent**

Class analytics

- [x] `GET /api/classes/:id/analytics?last=4|8`: per room accuracy, participation,
  attendance, band counts, six levels and three level bands (decision 6 open, so both
  come every time), each with its answers; the trend; the histogram pooled per
  student; the hardest questions through the item report, equal to a list worked from
  the answer rows; empty for a class with no room; rooms with no class never counted
  (`scripts/insights.mjs`)
- [ ] The class analytics screen. **Absent**

Projector modes

- [x] A link per room: a random 256-bit token shown once and stored as its SHA-256,
  working while the room is not closed, for 12 hours from when it is made, and until
  revoked; a revoked, expired, made-up or deleted room's token refused in one sentence
  (`scripts/modes.mjs`, `test/modes.test.js`, migrations)
- [x] `projector:watch`, then `projector:state` only (and `projector:closed`,
  `projector:refused`). Three screens the professor switches: a question of the
  room's set or one asked aloud, with no key until revealed and a bank question's key
  only in a Teacher-led room (409 elsewhere); a diagram (an image the projector loads
  with no credential, in a waiting room too, or a passage); class progress as counts,
  per level only once 5 students have answered. The wheel's pick as roll number and
  first name, or roll number alone; first names off after a restart for an older
  room. One whitelist serializer for every payload, and a walk of every projector
  event of a whole run against its own copy of it, shown to fail on a deliberate leak
  (`scripts/modes.mjs`)
- [x] A connection is a projector or a phone / teacher's screen, never both, decided
  at its first event before any await (`scripts/modes.mjs`)
- [ ] The projector page and its link screen. **Absent**

Across the phase

- [x] One 404, word for word, for "not there" and "not yours" on every Phase 3 route,
  and since the review on grid, pause, resume, close, delete and the integrity read;
  an HOD of the department reads and every write is 403 with nothing changed; a
  student account 403; no credentials 401 (`roster.mjs`, `records.mjs`, `modes.mjs`,
  `insights.mjs`)
- [x] Teacher records never move a level and are never added to accuracy, a band, a
  card or a tile: a "Needs revision", a pick and a "Needs additional support" leave
  every level, band and tile where it was (`scripts/records.mjs`,
  `scripts/insights.mjs`)
- [x] Nothing staff-only reaches a phone or the projector: every event the test
  phones and projectors receive in whole runs is kept and searched for roster names,
  attendance, notes, labels, picks, tallies, activities, flags, bands, cards and
  insight sentences, and the phones' public room read with them (`records.mjs`,
  `modes.mjs`, `insights.mjs`; the insights check was shown to fail on a deliberate
  leak)
- [ ] **No label a student can see: not met for the phone's own row.** The phone's
  `profile` is the teacher's grid row (`CONTRACT.md` sections 4 and 5), so it carries
  `slowLearner` and the integrity summary, and `reason` can name the below-40% band,
  which today's phone shows. Needs a contract amendment and the owner; not changed
- [ ] No leaderboards, coins, ranks or streaks: none exists in the server, and the
  three sort orders are for the professor's screen. Checked by reading; no test can
  show an absence
- [x] A deleted room's archive keeps its class, every attendance mark and every
  record (the observation log included) with the names the roster held, and only the
  settings a room changed; a delete waits for an attendance, record or status write
  under way, which lands in the archive, and one sent during the delete is refused
  (`scripts/records.mjs`, `scripts/roster.mjs`, `test/modes.test.js`)
- [x] Every reader of a room's status handles `waiting`: the archive, media,
  generate, pause, resume, close, delete, the room list, dashboards and analytics,
  the records (a waiting room draws) and the live loop; the CSV export reads none
  (`scripts/modes.mjs`, `test/modes.test.js`; the list was made by reading every
  status read)
- [x] The three repos expose the same 64 methods (unit test); `0016` to `0018` are
  additive and idempotent, with RLS on and no policies on every new table, and change
  no existing row's meaning (`npm run migrations`, PGlite only)
- [x] Fixes from the Phase 3 review, each with a check that failed before it: a bank
  question's key on the wall only in a Teacher-led room; progress per level from 5
  students; one role per connection; one 404 sentence on the older room routes;
  contact details refused in a tally's text and labels, a group's label and a class's
  fields, a flag id of the cards' shape only, a short date refused in a roster name;
  first names off after a restart; links for 12 hours; one status change at a time;
  no `classId` key for a room with no class; `fromJoins` refused in a Teacher-led room
  (`test/modes.test.js`, `test/records.test.js`, `test/roster.test.js`,
  `scripts/modes.mjs`, `scripts/records.mjs`)
- [ ] **Not fixed, for the owner:** the phone's row (above); `0005` narrowing the
  status check on a re-run once a room is waiting (a one-line edit to an applied
  file); observations going with their room (above). All in `docs/API.md`, "Known
  open issues"
- [ ] **Not acted on, from the review:** a deleted room's teacher screens stay in its
  `teacher:<code>` channel, so a new room drawing the same code would reach them;
  Supabase's 1000-row cap on `listClassStudents` and `listAttendance`. Both traced,
  neither reproduced (`docs/API.md`, "Known open issues")
- [ ] **Not tested:** `0016` to `0018` and every Phase 3 repo method against a real
  Supabase or Mongo (requests checked against a stubbed PostgREST, Mongo schemas by
  building documents); a real Supabase Auth token; the attendance lock racing a room
  delete; the status lock, the link lifetime and the draw's unique place under two
  server processes; a start racing a join under real network timing; a server
  restart with a room running; the insights' throttle at a real class's answer rate;
  any phone, console or projector browser

### Phase 4: server done, every screen unticked

The owner's directive for Phase 4 is "Course outcome attainment and institutional
reporting". It asks for course outcomes, outcome-to-topic and topic-to-question
mapping, configurable attainment thresholds, student-level and class-level
attainment, a marks register, attainment sheets, CSV exports and printable reports.
Reports must keep four kinds of evidence apart: digital answers, teacher
observations, AI-generated assessments and human-reviewed assessments. No single
institutional formula may be hard-coded as correct. Acceptance: "a professor can
conduct multiple sessions and generate a meaningful course-outcome attainment report
without manually compiling quiz results". The roadmap's step 4 adds "roster import
from CSV".

A box is ticked only when the feature works **end to end with a test** on the tree
this file describes. As for Phase 3, that means over HTTP and the socket on a real
server (the production `createApp` and `attachSockets`), on the in-process store,
**with signed-in callers** answered in-process:
- `outcomes.mjs`, 87 checks;
- `attainment.mjs`, 73;
- `acceptance4.mjs`, 76: the acceptance criterion end to end, with real phone and
  projector sockets.

Plus the unit tests (`test/outcomes.test.js` 44, `test/attainment.test.js` 56,
`test/exports.test.js` 21, and the `0021` tests in `test/roster.test.js`) and PGlite
for `0019`, `0020` and `0021`.

Nothing in Phase 4 has run against Supabase, Mongo, a real Auth token, any
spreadsheet program or any browser but a headless Edge printing to PDF (before the
review fixes). **No screen was checked against any of it**, so every screen line is
unticked; the UI session's uncommitted client calls these routes. Endpoints:
`docs/API.md`, "Phase 4: every new and changed endpoint". No new dependency: the CSV
reader and writer are written in `services/csv.js`.

The fix's run and a rerun after it, both through the offline runner on 19 November
2026, gave the same figures:

| Suite | Result |
|---|---|
| Unit | 598 / 598 |
| Migrations | 573 / 573 |
| `outcomes.mjs` | 87 / 87 |
| `attainment.mjs` | 73 / 73 |
| `acceptance4.mjs` | 76 / 76 |
| Every Phase 0 to 3 suite | its old figure |

**Do not deploy this server** until `0019`, `0020` and `0021` are applied (`0021`
before the server, since every attendance mark writes its column) and a client that
approves drafts is in place (risks, above).

Course outcomes and their mappings (the directive's "Course outcomes",
"Outcome-to-topic mapping", "Topic-to-question mapping")

- [x] Course outcomes per class (`0019`): a code (upper-cased, one per class among
  outcomes in use), a statement of at most 300 characters (no email or phone number),
  an optional target Bloom level and an order. Create, edit and reorder. At most 50 in
  use, by creating, restoring or copying (409; the restore since the review). The
  owner writes; an HOD of the department reads and gets 403 on every write; anyone
  else gets the class's 404 word for word (`scripts/outcomes.mjs`,
  `test/outcomes.test.js`, migrations)
- [x] Removing an outcome. One that any counted answer reaches is archived, not
  deleted: it keeps its mappings, is still named in every report and can be restored.
  One with no answers is deleted and taken off every override. Copying to another
  section makes new rows; nothing stays linked, and a code clash copies nothing
  (`scripts/outcomes.mjs`)
- [x] Outcome-to-topic mapping: (chapter, topic) pairs, each with a weight (default 1).
  The chapters must be ones the caller may read. A topic may map to several outcomes.
  Only topics the chapter's evidence carries are accepted, and an unknown one is a 400
  that lists the chapter's topics (`scripts/outcomes.mjs`, `test/outcomes.test.js`)
- [x] Topic-to-question mapping. By default a question belongs to its topic's
  outcomes. A per-question override maps it straight to some outcomes (in place of its
  topic's) or excludes it from all. The override is kept by the question's id, so it
  holds through edits and, for the answers given to it, after the question is deleted
  (`test/outcomes.test.js`, `scripts/outcomes.mjs`)
- [x] `resolveAnswer`, the one rule from an answer to its outcomes:
  - the override first;
  - then the topic in its chapter: the question's topic while the question exists,
    then the one frozen on the answer;
  - otherwise unmapped. Nothing is dropped.

  Coverage and every attainment figure use it. Coverage gives per outcome and topic
  the approved questions, the counted answers and the students. The counted answers
  are mapped, excluded or unmapped, and the three add up (`test/outcomes.test.js`,
  `scripts/outcomes.mjs`)
- [ ] **A renamed topic is not followed.** Renaming a topic in a chapter's list leaves
  its evidence counted as unmapped under the old name (`inChapter: false`) until the
  old name is mapped too. This is said in coverage and the reports, never dropped
  (`scripts/outcomes.mjs` checks it). Following renames is not built: nothing
  records which name became which
- [ ] Course outcomes and mapping screens. **Not checked** (the UI session's
  uncommitted client has `Outcomes.jsx`)

The roster from CSV (the roadmap's step 4)

- [x] `POST /api/classes/:id/students/import`, owner only, a dry run included:
  - `text/csv` or JSON, at most 1 MB and 2,000 rows;
  - a byte-order mark, CRLF, LF or CR, quoted fields, comma, semicolon or tab;
  - the roll number and name columns found by their header;
  - read in time proportional to the file (since the review; a unit test reads
    crafted files near 1 MB in well under a second).

  The dry run writes nothing. It gives what would be added, every refused row with its
  line, code and reason, the duplicates in the file and on the roster, the removed
  students (reported, never restored) and the columns not read. The real import goes
  through `addToRoster`, the JSON list's own path, and stores a roll number and a name
  only: a `Phone`, `Mobile` or `Email` column is never read into a row, and is named
  back. The JSON list answers exactly as before (`test/outcomes.test.js`,
  `scripts/outcomes.mjs`, `scripts/roster.mjs`, `scripts/acceptance4.mjs`)
- [ ] The import screen with its dry run. **Not checked** (`RosterImport.jsx` in the
  UI session's uncommitted client). **Not tested:** a file exported by a real
  spreadsheet in another encoding (a body is read as UTF-8)

Configurable attainment thresholds, and colleges' own formulas

- [x] The formula is data (`0020`), one row per class per saved version, never changed
  (the database refuses an edit). It holds:
  - a student threshold;
  - the minimum counted answers;
  - class levels (1 to 10, strictly increasing);
  - which evidence types count;
  - final or best attempts;
  - room weights.

  The formula is checked whole. A bad field, an unknown key, a room not of the class,
  asking to count teacher records, or (since the review) counting provisional marks
  without reviewed ones is each a 400 that saves nothing. A save equal to the formula
  in force writes nothing. `GET`/`PUT .../attainment/config` and
  `GET /api/attainment/presets` (`test/attainment.test.js`, `scripts/attainment.mjs`,
  migrations)
- [x] No institutional formula in code. Two examples ship as data
  (`services/attainmentPresets.js`), each named "Example: ...". Neither is called NAAC
  or NBA. A class with no saved formula uses the first and every report says so.
  Every report returns the formula, its version and a methodology paragraph generated
  from it, and the paragraph follows each change of field: a saved day in India's
  time, no "level 0 below 0%", a weighted room outside the report named as such
  (`test/attainment.test.js`, `test/exports.test.js`, `scripts/attainment.mjs`,
  `scripts/acceptance4.mjs`)
- [ ] **A department-wide or college-wide default formula.** Not built: each class
  saves its own, starting from an example. An owner's question
  (`PRODUCT_DECISIONS.md`)
- [ ] A route to read an older version of a formula. Not built: they are kept, and
  every report names the version it used
- [ ] The attainment settings screen. **Not checked**

Evidence types kept apart, and never combined without saying how

- [x] Four evidence types read off the answer row (`evidenceTypeOf`), every figure
  split by them with the answers and marks behind it:
  - digital (`auto`);
  - provisional machine marks (`provisional`: the keyword marker; the type the API
    calls `aiProvisional`, labelled since the review as a machine mark, not AI);
  - professor-reviewed (`confirmed`, `overridden`);
  - polls, a count only.

  Provisional marks are shown and, by default, not counted. A review through the
  queue moves an answer into the reviewed type (`attainment.mjs` and
  `acceptance4.mjs` review one and check the figure move)
- [x] Who wrote the question, a second split of every figure (since the review):
  AI-generated, professor-written, and offline-template or professor-written (a
  professor's own question is stored as the template's today), each with its counted
  answers and marks and what was not counted. It moves no mark. In the JSON, every
  sheet and every page (`test/attainment.test.js`, `test/exports.test.js`;
  `acceptance4.mjs` reads the sheet's source columns back against the JSON and checks
  `bySource`)
- [x] Teacher observations (and picks, tallies, activities) in their own labelled
  section of every report and page, moving no figure. A formula cannot count them
  (decision 3). An observation and a tally were recorded, and every figure was
  checked unchanged (`scripts/attainment.mjs`, `scripts/acceptance4.mjs`)
- [x] Never combined without saying how. Every report, sheet and page states the
  formula, its parameters, which types it counted and which it showed but did not
  count, the question sources, and the methodology paragraph (`scripts/acceptance4.mjs`
  reads them from each sheet and page)
- [ ] **No model marks written answers yet.** If one is added, its marks fall in the
  provisional type unless a column records which marker made them

Student-level and class-level attainment

- [x] Student attainment per outcome:
  - marks obtained and possible, by evidence type and by question source;
  - the counted share;
  - attained, not attained, or not enough evidence below the minimum answers (never
    not attained);
  - exact at the threshold (3 of 5 is 60%).

  One student's report lists every answer behind each figure, with its type, its
  question source, whether it counted and why (`test/attainment.test.js`,
  `scripts/attainment.mjs`, `scripts/acceptance4.mjs`)
- [x] Class attainment per outcome. The figure gives:
  - the roster counted, attained and not attained;
  - not enough evidence, and how many had no answers;
  - the share (4 decimals, rounded down for display) and the class level;
  - the evidence behind the share, from the students counted only;
  - the evidence of roster students with too few answers, outside the share
    (`outside.notEnoughEvidence`), and removed and off-roster students beside it,
    never counted;
  - a summary that says what the share rests on and what is outside it.

  Finished by the review fixes (`test/attainment.test.js`, `scripts/attainment.mjs`,
  `scripts/acceptance4.mjs`, each against hand counts)
- [x] A student's answers stay theirs when their roll number is corrected on the
  roster (`0021`, since the review): a report ties a room's answers to the student
  whose attendance mark there was made under the roll number they were given under,
  and says so (`givenAs`, `rollNotes`). Nothing is inferred: a roll number two marks
  of one room carry is tied to neither (`test/attainment.test.js`,
  `test/roster.test.js`, `scripts/attainment.mjs`, migrations)
- [ ] **A roll number corrected before `0021`.** A mark made before it carries no roll
  number, so such a room's answers under the old roll number stay apart, as a roll
  number off the roster, with a note. No route merges them
- [x] Bloom attainment per level and per decision 6's three bands, per student and for
  the class, by the same rules (`attainment.mjs`, `acceptance4.mjs`)
- [x] `?from=&to=&rooms=` on every report. Rooms are counted oldest first; only rooms
  opened for the class. A bad code or date is a 400 (`scripts/attainment.mjs`,
  `scripts/acceptance4.mjs`)
- [ ] Deleted rooms counted. **Not built**: their answers are in the room archive,
  which a report does not read, and every report says so
- [ ] The attainment report and student report screens. **Not checked**
  (`Attainment.jsx` in the UI session's uncommitted client)

The marks register

- [x] `GET /api/classes/:id/register`:
  - students in roll order by rooms in date order;
  - marks obtained of possible, by evidence type and by question source;
  - the attendance mark;
  - a total;
  - the roll numbers off the roster, each with its note.

  A room with no answers is 0 of 0 with its attendance mark, never a zero
  (`test/attainment.test.js`, `scripts/attainment.mjs`, `scripts/acceptance4.mjs`)
- [ ] Best n of m rooms, and scaling to a college's maximum marks. **Not built**
- [ ] The register screen. **Not checked** (`Register.jsx` in the UI session's
  uncommitted client)

Attainment sheets, CSV exports and printable reports

- [x] The files come from the same routes (`?format=csv`, `?format=html`), each the
  JSON report of the same query handed to a writer that computes nothing. Four CSVs
  are read back cell by cell against the JSON of the same query:
  - the course-outcome sheet, its "behind the share", outside-the-share and
    question-source columns included;
  - the Bloom sheet;
  - the register;
  - the outcome list.

  The queries are the default example, a saved 50% threshold, `?rooms=`, `?from=` and
  `?to=` (`scripts/acceptance4.mjs`, `test/exports.test.js`)
- [x] The CSV writer:
  - a BOM, CRLF, RFC 4180 quoting, numbers unquoted;
  - the formula-injection guard on a leading `= + - @`, tab or CR (an apostrophe, and
    always quoted), stated in every sheet;
  - since the review, the same guard after a semicolon or a tab inside a cell, and
    every cell holding one quoted;
  - a name beginning with `=` and a Devanagari name through a real import;
  - a leading row saying how to keep roll numbers exactly (import as text).

  (`test/exports.test.js`, `scripts/acceptance4.mjs`; the semicolon rule by the unit
  test only. No spreadsheet program was used)
- [x] Printable pages for the class report, one student and the register. They are
  self-contained (no script, font, image or link; a CSP in the header and the page).
  Every value is escaped through one tagged template. A4 print rules, repeated table
  headers, landscape matrices, and badges that carry their words. The method, the
  evidence types, the question sources, the share's evidence and what is outside it,
  the roll numbers off the roster and the teacher records each have a place
  (`scripts/acceptance4.mjs`, `test/exports.test.js`; printed to PDF by a headless
  Edge by hand before the review fixes)
- [x] No key in a file's address (since the review). A sheet or a page asked for with
  `?key=` is a 400 that says to send the header, and no file is sent; JSON is not
  refused (`scripts/acceptance4.mjs`, `test/exports.test.js`). The Phase 0 room CSV
  still takes `?key=`, on purpose (`docs/API.md`, "Known open issues")
- [x] ASCII filenames from the class's course, section and id prefix and India's day,
  never a student's name. CSVs are an attachment, pages inline, and both `no-store`.
  Who may fetch each format: as for the JSON route (`scripts/acceptance4.mjs`)
- [ ] The roadmap's per-question attainment sheet (one column per question, with
  maximum marks, outcome and level header rows). **Not built**: a question has no
  maximum marks yet
- [ ] Download and print screens. **Not checked** (`ReportWindow.jsx` and
  `downloadCsv` / `openReport` in the UI session's uncommitted client). **Not
  tested:** any spreadsheet program; paper; Firefox or Safari; a console opening a page
  from a blob or `srcdoc`

The acceptance criterion

- [x] **A professor conducts several sessions and gets a meaningful course-outcome
  attainment report without compiling quiz results by hand.** `acceptance4.mjs` runs
  it end to end over HTTP and the socket:
  1. a bank written and approved;
  2. a class with its roster imported from a CSV;
  3. three outcomes mapped to topics;
  4. three rooms on three days, with absences, a visitor and a reviewed written answer;
  5. the report, sheets and pages, checked against hand-worked numbers.

  76 / 76 after the review fixes, in both runs. On the server only: no screen was
  part of it

Privacy and labels

- [x] Staff-only. No phone payload, no projector payload and no public room read in
  any of the three scripts carries an outcome, a mark, a state, a formula or a report.
  One phone and the projector stay connected through the acceptance run
  (`outcomes.mjs`, `attainment.mjs`, `acceptance4.mjs`)
- [x] Students in roll order, never ranked or numbered by score. States describe
  evidence, and no label like "slow learner" appears in any report, sheet or page
  (`attainment.mjs`, `acceptance4.mjs` search for ranks and labels)
- [x] A roster holds a roll number and a name only, from a CSV too. Other columns are
  dropped and named back (`outcomes.mjs`, `acceptance4.mjs`, migrations). An
  attendance mark adds only the roll number it was made under (`0021`)
- [ ] No leaderboards, coins or streaks: none exists. Checked by reading, and by the
  scripts' search for ranks; no test can show an absence

Across the phase

- [x] Ownership on every route and format. Another professor gets the class's 404
  word for word, an HOD of the department reads and gets 403 on every write, another
  HOD gets 404, a student account 403 and nobody 401 (all three scripts)
- [x] Existing behaviour kept:
  - the JSON roster add answers as before;
  - every room route and socket event is unchanged in shape, the attendance read
    included;
  - the room archive gains one field, `markedRollNo` on a class room's attendance
    rows (`0021`; an older archive decodes with null), and nothing about outcomes;
  - every Phase 0 to 3 suite gives its old figure.
- [x] The three repos expose the same 76 methods (unit test). `0019`, `0020` and
  `0021` are additive and idempotent, re-run over rows in their tables, with RLS on and
  no policies, and they change no existing row (`npm run migrations`, PGlite only)
- [ ] **Not tested:**
  - `0019`, `0020`, `0021` and the twelve new repo methods against a real Supabase or
    Mongo;
  - a server deployed before `0021` (traced: every attendance write would fail);
  - a real Auth token;
  - two screens editing one class's outcomes at once (last write wins) or two formula
    saves racing on Supabase;
  - a copy or topic set failing part way on Supabase (not atomic);
  - the reports' cost over thousands of answers on Supabase;
  - every screen.

### The owner's decisions of 19 Nov 2026: server done, screens absent

On 19 November 2026 the owner delegated the eight open decisions, the two Phase 3
questions and the Phase 2 defaults ("decide the best outcomes yourself"). Each is
recorded in `docs/PRODUCT_DECISIONS.md` as decided under the owner's delegation, with
what was built. Everything that needed the schema is in one migration, `0022`.
Decision 8 is a working posture, **not a legal decision: a lawyer must confirm it
before any college signs or before 13 May 2027.**

Ticked only with a test on this tree, over HTTP and the socket on a real server on the
in-process store, with signed-in callers answered in-process (`decisions.mjs`, 64
checks), plus `test/decisions.test.js` (22 unit tests) and PGlite for `0022`.

| Suite | Before (`eedfd5e`) | After, offline runner, 19 Nov 2026 |
|---|---|---|
| Unit | 598 / 598 | 623 / 623 |
| Migrations | 573 / 573 | 633 / 633 |
| `decisions.mjs` (new) | none | 64 / 64 |
| `bank.mjs` | 73 / 73 | 73 / 73 (two checks rewritten for the decisions) |
| `media.mjs` | 67 / 67 | 67 / 67 (one check now clears a stem's passage first) |
| `roster.mjs`, `modes.mjs`, `outcomes.mjs`, `acceptance4.mjs` | 80, 101, 87, 76 | the same (expected fields updated: `under18`, `roomMode`, the source label) |
| Every other suite | its figure | the same |

Decision 7: a link only by a sign-in
- [x] A room profile is linked to a student account only when the phone presents
  that signed-in student's token at `student:join`, verified as the student routes
  verify one; the account must be a student of the room's owner with the roll number
  typed (`decisions.mjs`)
- [x] A typed roll number links nothing, and a token that does not qualify (expired,
  another student's, another professor's student, a professor's) joins as a guest
  with one sentence saying why (`decisions.mjs`)
- [x] Nothing from a typed roll number reaches the student's own history: the answer
  list, analytics and the dashboard read verified profiles and verified answers only
  (`decisions.mjs`, `test/evidence.test.js`, `test/decisions.test.js`)
- [x] Links made the old way are kept, read as unverified, and expose nothing; nothing
  deleted or rewritten (`decisions.mjs`; `0022` over existing rows, migrations)
- [x] A classmate typing the roll number into a verified room writes unverified rows,
  which never reach the student (`decisions.mjs`)
- [x] Attendance from a typed roll number stays `joined` with its caveat (unchanged;
  `roster.mjs`)
- [ ] The phone sending the token: **client work**, not built. Until it is, no room
  links and a student's own history shows nothing new

Decision 8: the under-18 mark
- [x] `class_students.under_18`, set by the owner through the student edit, a pasted
  list or a CSV column; an HOD 403, another professor 404, a non-boolean 400; a
  date-of-birth column never read (`decisions.mjs`, `outcomes.test.js`)
- [x] No integrity signal recorded for a student so marked in a class room: reports,
  too-fast, second-socket, level-jump (`decisions.mjs`)
- [x] None shown: the grid, the signal trail, the room's CSV and a deleted room's
  archive, including signals recorded before the mark (`decisions.mjs`,
  `test/decisions.test.js`, `test/roster.test.js`)
- [ ] A room opened **without a class** cannot know the mark (no roster): signals are
  recorded there as before. Open

Phase 3 question (a): labels are staff-only
- [x] The phone's row (`session:accepted`, `server:result`, `server:exhausted`) is a
  `PhoneRow` with no `slowLearner`, signals or professor's `reason`, and a neutral
  `next`; the phone's `reason` sentences never name a band; the teacher's rows are
  unchanged (`decisions.mjs`; a unit test over a thousand random rooms)
- [x] A student account's own dashboard and analytics carry no `banded`
  (`decisions.mjs`)
- [x] `CONTRACT.md` sections 4 and 5 amended, dated
- [ ] The phone client still shows the old fields: **client work**

The rest
- [x] A professor's own question is `source: 'teacher'`, and its answers
  `question_source: 'teacher'`; `0022` widens the check, and a re-run never narrows it
  (`decisions.mjs`, `bank.mjs`, migrations). Existing rows not rewritten
- [x] Attainment maps `teacher` to `professorWritten`; the `fallback` label says it holds
  professor-written questions from before 19 Nov 2026 (`attainment.test.js`,
  `acceptance4.mjs`)
- [x] The slide-only check: an attached passage clears it (`checks.test.js`,
  `media.test.js`)
- [x] Regenerating an active question keeps it serving until the replacement is
  approved; approve, approve-all and the older restore retire it; reject keeps it
  (`decisions.mjs`, `bank.mjs`; `questions.replaces_id`)
- [x] `GET /api/classes` carries `canCreate`; `projector:state` carries `roomMode`
  (`decisions.mjs`, `modes.mjs`'s whitelist walk)
- [x] Four people-facing sentences no longer name a path, field or verb
  (`decisions.mjs`)
- [x] The boot probe checks `0016` to `0022` and names the file to apply; `0019` to
  `0021` are warnings that keep Supabase, `0022` stops it (`decisions.mjs`,
  `test/decisions.test.js`). It now asks with a GET, since a HEAD could not see a
  missing table
- [x] `best`: a reviewed attempt always beats a provisional machine mark at the same
  question, whatever the scores and rooms; methodology updated (`attainment.test.js`)
- [x] Decisions 1, 4, 5 recorded; `CONTRACT.md` section 6 rule 1 amended (decision 1)
- [x] The three repos expose the same methods (unit test); no new repo method, three
  changed (`listAnswers`' `student.verifiedOnly`, `addClassStudents` and
  `updateClassStudent`'s `under18`) and four new columns mapped in all three
- [ ] **Not tested:** `0022` and the new columns against a real Supabase or Mongo; a
  real Supabase Auth token at join; a server deployed before `0022` against a real
  project (the probe names it, traced and tested only against a stand-in); every
  screen

Fixed since, by the Phase 5 review fixes (`decisions.mjs` 78 checks,
`test/decisions.test.js` 27):
- [x] A profile linked by a sign-in can hold attempts a classmate typed under the same
  roll number. Everything a student reads about themself (level tallies, counts,
  timeline, Bloom tally, history trail) now comes from the history entries of their own
  verified answers; the room's working level is withheld when other answers helped
  set it (`decisions.mjs`: a classmate after the sign-in and a guest before it, five
  checks that failed before the fix)
- [x] A deleted class room's archive is served without the signals of a student the
  roster marks under 18 now, whenever the mark was set (`test/decisions.test.js`)
- [x] A regenerate of a never-approved replacement keeps its link, so approving the
  new draft still retires the active question (`decisions.mjs`)
- [x] `CONTRACT.md` amended where the follow-up decisions named it (Amendment 5,
  dated): section 3's `source`, section 4's regenerate row, section 5's `token`,
  `linked`, `linkNote`, `confidence` and the class-question events, section 6 rule 1's
  "No image generation" (decision 4 and its revision)
- [x] `GET /api/classes/:id` carries `under18Note` whenever a student on the roster is
  marked, for the owner and the HOD alike (the UI session's ask; Phase 5 follow-ups,
  `decisions.mjs`)

Open, from this batch:
- Supports (accommodations) still follow a typed roll number to the room owner's
  roster when no sign-in is presented (as before): a classmate typing the roll number
  gets that student's supports, the fewer-choices support included. Kept under the
  delegation as a known gap: rooms are account-free.
- The under-18 mark does not reach a room opened without a class.
- Splitting or merging a regenerated draft loses its `replacesId`, so the old question
  keeps serving until retired by hand (a known gap, recorded under the delegation).

**Client work** (the UI session's; nothing in `client/` was touched):
- The phone sends the signed-in student's access token in `student:join` as `token`
  when one exists, and shows `linkNote` when present.
- The phone reads `PhoneRow`: it stops showing `slowLearner`, the integrity summary
  and the band sentence, and shows `next.why` (with `next.levels`, `next.answers`) and
  the new `reason` sentences.
- The student's own dashboard and analytics (`account/Me.jsx`) stop using `banded`
  ("in the support band"), and show the `note`.
- The roster screen shows and edits `under18`, with `under18Note`; the CSV import
  screen shows `read.columns.under18`, `wouldAdd[].under18` and the `under18` sentence.
- The live grid shows "no signals" for a row whose `integrity` is null; the signal
  trail shows `message` when `signalsOff`.
- The bank labels `source: 'teacher'` as the professor's own question (and `fallback`
  as template text, which still covers older professor questions); shows a draft's
  `replacesId` ("replaces ..."), the regenerate `note`, and `retired` after approve,
  approve-all, a restore or bulk restore; drops the old regenerate `warnings`.
- The class list uses `canCreate` from the server instead of `role !== 'hod'`.
- The wall hides the join code when `projector:state.roomMode` is `teacher-led`.
- Decision 2: correct the handoff copy that says "60% / 3" to 70% over five, three at
  least. Decision 6: class summaries and attainment show the three level bands first,
  the six levels one click away. Phase 3 question (b): the class page says a deleted
  room's records are in its archive.

**Do not deploy this server** until `0022` is applied: every join, answer, saved
question and roster add writes its columns, and without them the boot probe falls
back to the in-process store (it names `0022` in the log).

### Phase 5: distinctive classroom features: server done, every screen unticked

The owner's directive for Phase 5 is "Distinctive classroom features": confidence
voting (Sure, Think so, Guessing; informational, never deducting marks);
pause-discuss-re-vote (first response, confidence recording, the professor pauses,
students discuss, students vote again, class-level changes displayed);
misconception-tagged distractors (wrong options tied to misunderstandings, reports
such as "12 students selected the option associated with misunderstanding X", labels
the professor reviews and edits); honest AI indicators (AI draft labels, reasons for
mastery movements, the number of responses behind an estimate, uncertain
classifications, translation-related difficulty warnings); no stigmatising label in
the student interface; no coins, competitive leaderboards or punitive streaks.

Uncommitted, server and database only: `0023` (class questions), `0024`
(misconception labels); the honest indicators and the review fixes need no migration.
Endpoints: `docs/API.md`, "Phase 5: every new and changed endpoint and socket event".
The defaults chosen and the owner's open questions: `docs/PRODUCT_DECISIONS.md`,
"Phase 5 in brief" and the three Phase 5 sections after it.

A box is ticked only when the feature works **end to end with a test** on this tree:
over HTTP and the socket on a real server (the production `createApp` and
`attachSockets`), on the in-process store, **with signed-in callers** answered
in-process, plus unit tests and PGlite for the migrations. **No screen was checked
against any of it, so every screen line is unticked.** The UI session's uncommitted
client has files for some of it (`client/src/learn/ClassVote.jsx`,
`client/src/teach/ClassQuestions.jsx`); not checked here.

The Phase 5 docs pass's run through the offline runner, after the review fixes:

| Suite | Result |
|---|---|
| Unit | 719 / 719 (162 suites); `classQuestions` 24, `misconceptions` 40, `honesty` 27, `decisions` 27 |
| Migrations | 752 / 752 |
| `classquestion.mjs` | 70 / 70 |
| `misconceptions.mjs` | 54 / 54 |
| `honesty.mjs` | 59 / 59 |
| `keysafety.mjs` (the review fixes) | 41 / 41 |
| `decisions.mjs` | 78 / 78 |
| Every Phase 0 to 4 suite | its old figure |

**Do not deploy this server** until `0022`, `0023` and `0024` are applied, in that
order: every join and answer writes `0022`'s and `0023`'s columns, every room's bank
reads `class_questions`, and every question saved writes `0024`'s column. Missing any,
the boot probe falls back to the in-process store and names the file to apply.

Confidence voting

- [x] **The tap**: `sure`, `think_so`, `guessing` on every phone answer and vote,
  optional; a missing or unknown one is stored as none (`services/confidence.js`).
  Stored in `answers.confidence` in `0008`'s own spellings (no check widened)
  (`classquestion.mjs`, `test/classQuestions.test.js`)
- [x] **Informational, never deducting.** Read by nothing that marks or moves
  anything: the same answers with and without taps give identical ladders, topic and
  item reports and attainment (unit test), and two phones giving the same answers, one
  tapping, got identical results and levels (`classquestion.mjs`)
- [x] **Staff see counts only**, by tap and by right and wrong: per room and per
  question (`GET /api/session/:code/confidence`), per class-question round, and on the
  student card. No answer carries its tap on a staff screen; no student is labelled
  (`classquestion.mjs`)
- [ ] The phone's tap and the console's confidence counts. **Not checked**

Pause-discuss-re-vote

- [x] **First response**: the room's owner puts one approved `mcq`, `truefalse`, `poll`
  or `multi` question to every phone in a Student-devices or Mixed room; each phone
  parks its own question and goes back to it; a phone that joins or reconnects is sent
  it where it stands. Other kinds, Teacher-led rooms, rooms not open, a second running
  one and a question asked before are refused, each with a sentence naming no field
  (`classquestion.mjs`, `keysafety.mjs`)
- [x] **Confidence recording** on every vote, counted per round (`classquestion.mjs`)
- [x] **The professor pauses the question**: round 1 closes and its distribution, share
  right and taps appear then, not while voting is open; every vote under way is waited
  for, so the counts are whole (`classquestion.mjs`)
- [x] **Students discuss**: the phones are told to talk it over; no vote counts until
  the re-vote (`classquestion.mjs`)
- [x] **Students vote again**: round 2; a phone that missed round 1 may vote; the close
  with or without revealing the key, from any round (`classquestion.mjs`)
- [x] **Class-level changes displayed**, as counts: distribution per option, share
  right and taps before and after; wrong to right, right to wrong, right both times,
  wrong both times on the same or another answer. Staff always; the projector only
  when the professor chooses, per closed round, from 5 votes, and the key, share right
  and changes only once revealed (`classquestion.mjs`, `test/classQuestions.test.js`)
- [x] **Every vote stored, never overwritten** (`answers.class_question_id`, `round`,
  `0023`): a changed, late or early vote, one sent while the room is paused, one from a
  phone not signed in after the signed-in student's, and an answer sent as a phone's
  own question are each kept with `final` false and a `detail` saying why, never
  counted (`classquestion.mjs`, `keysafety.mjs`)
- [x] **No level moves**: no vote touches a profile; the readers of a student's own
  work leave votes out (`classquestion.mjs`, `keysafety.mjs`)
- [x] **Attainment**: round 1 a digital answer, except from a student who had answered
  the question on their own in that room first (set aside, their own answer counts);
  round 2 its own type, `revote`, shown and never counted, in the JSON, CSV and HTML
  (`test/classQuestions.test.js`, `test/attainment.test.js`)
- [x] **The key before the reveal** (review fixes): the phone's class question is named
  by its own id, not the bank question's; nothing kept with a class question is
  answered back through `student:answer`; no phone or projector event carries the key
  before the reveal (`keysafety.mjs` over every event the phones heard;
  `classquestion.mjs`)
- [x] **The professor is told who saw the key first**, as a count and a sentence
  (`answeredAlone`) (`keysafety.mjs`, `test/classQuestions.test.js`)
- [x] **Whose vote counts** (decision 7, review fix): a phone typing a signed-in
  student's roll number is not sent her vote and never displaces it (`keysafety.mjs`)
- [x] **Ownership**: only the room's owner runs one; an HOD reads and gets 403 on
  every write; another professor gets the room's 404, word for word; no credentials,
  401; a phone only votes (`classquestion.mjs`)
- [x] **Stored state**: a `class_questions` row; a second server over the same store
  sends a joining phone the question as it stands. The archive keeps the class
  questions and every vote (`classquestion.mjs`)
- [x] **Each phone's own vote after the room is resumed** (the UI session's ask, Phase
  5 follow-ups): the resume, and the pause of a class question, send each phone the
  class question with its own vote in force, by the decision 7 rule a join uses; a
  phone that reloaded while the room was paused gets its vote at the resume
  (`keysafety.mjs`: a signed-in student's phone, a phone typing her roll number, a
  reloaded phone and phones with no counted vote; `classquestion.mjs`: seven phones at
  the pause, and a store read failing, which falls back to `mine: null`). A phone that
  joins while the room is paused is still sent no class question until the resume
- [x] **Closing a room when the store fails** while closing its class question (the
  Phase 5 review finding): logged, and the close answers 200 and tells the phones and
  the projector; reproduced first (a 500 and nobody told) with the store's update made
  to fail, then fixed (`classquestion.mjs`)
- [ ] The phone's class-question screen, the console's controls and before-and-after
  view, the projector's class-question screen. **Not checked**

Misconception-tagged distractors

- [x] **Incorrect options tied to misunderstandings**: a label per wrong option of a
  Choose one, Choose all that apply or True or false question, at most 120 characters,
  no contact details, never on a poll or a right answer, kept by the option's words
  with its provenance (`questions.misconceptions`, `0024`; `misconceptions.mjs`,
  `test/misconceptions.test.js`, migrations)
- [x] **Reports such as "12 students selected the option associated with
  misunderstanding X"**: per room, per class (with attainment's filters) and per
  question across its chapter, counting the distinct students whose counted answer
  chose each labelled option, matched through the option's words in each answer's own
  snapshot, saying when a label was added or reworded after the answers; AI drafts
  marked; counts, never names (`misconceptions.mjs` against hand counts)
- [x] **Professors review and edit labels**: add, edit, confirm, clear, all or
  nothing, owner only (an HOD 403, anyone else the question's 404); a label edit never
  touches the question's approval, and approving a question confirms no label;
  rewording, removing or keying a labelled option removes its label and the reply
  names it; split and merge carry the labels they can (`misconceptions.mjs`)
- [x] **Generated labels as AI drafts**, on the professor's press only; a bad proposal
  dropped and the question kept (parsed from a fixture response; the model was never
  called) (`test/misconceptions.test.js`)
- [x] **Item statistics** show each option's label beside its count; labels never
  reach a phone or the projector, nor any stored answer snapshot or archive; no mark,
  level or attainment figure reads one (`misconceptions.mjs`, unit tests)
- [ ] Not in the live insights, on purpose (built from profiles every two seconds;
  these counts need every answer and the bank)
- [ ] The bank's label boxes and the report panels. **Not checked**

Honest AI indicators

- [x] **AI draft labels**: every bank question sent to staff carries `provenance`
  (who wrote it, the model, its approval state, "AI draft" on an unapproved AI
  question); every misconception label carries `confirmed`; the phone's question, and
  a class question, carries `provenance.text` in a student's words, only for questions
  the room serves (`honesty.mjs`, `test/honesty.test.js`)
- [x] **Reasons for mastery movements**: every promotion, demotion, move into the
  below-40% band and hold at either end is kept on its answer's history entry
  (`move`) and listed on the student card; staff-only (`honesty.mjs`)
- [x] **The number of responses behind an estimate**, with a sentence: levels, bands,
  mastery, item difficulty, insight cards and KPIs, class analytics, dashboards
  (`honesty.mjs`, `test/honesty.test.js`)
- [x] **Uncertain classifications**: a level or band under the engine's own minimum
  is `provisional` (the phone's `next.provisional` too); `levelCheck` marks a level
  the model chose that no professor approved, or a kind that does not ask for its
  level; staff only (`honesty.mjs`)
- [x] **Translation-related difficulty warnings**, computed and served end to end on
  fixture answers in two languages: the share right per language, a warning above a
  20-point gap with 5 answers each, the student card's language note (`honesty.mjs`)
- [ ] **A second language from a phone.** Every answer the live loop writes is `'en'`
  and no question records its language, so the warning cannot fire in a real room
  until the Hub's language switch (Phase 6)
- [ ] The phone's provenance line and provisional note; the console's chips, uncertain
  marks, counts, level moves and warnings. **Not checked**

Labels, ranks and gamification

- [x] **No stigmatising label in the student interface.** The phone's row and
  sentences name no band (decision (a)); a student's own dashboard and analytics carry
  no `banded` and no level move; every event the phones heard in `honesty.mjs` was
  searched for band words, staff fields, ranking and gamification words: none
  (`decisions.mjs`, `honesty.mjs`)
- [ ] **No coins, leaderboards or streaks**: none exists on the server (searched); no
  test can show an absence
- [x] **Staff lists in roll order by default** (decided under the owner's delegation,
  19 Nov 2026): a professor's analytics list of students is in roll order, highest
  accuracy first only with `?order=accuracy` (`honesty.mjs`); the insights' students
  are in roll order and the read names `roll` as the default, "By band" and "Lowest
  first" kept as orders a professor chooses (`insights.mjs`). The room CSV's staff-only
  "Slow Learner" column keeps its name (the Classroom import and NAAC reports read it)

Across the phase

- [x] **The live loop makes no model call** (decision 5): every script refuses and
  counts any request off the machine, 0 in every run; a misconception proposal comes
  only from generation, which a professor's press starts
- [x] **Existing behaviour kept**: every Phase 0 to 4 suite gives its old figure;
  every change to an existing payload is a field added or a sentence reworded
- [x] **The three repos expose the same 80 methods** (unit test; four class-question
  methods new). `0023` and `0024` are additive and idempotent, re-run over rows, RLS
  on and no policies, and change no existing row (`npm run migrations`, PGlite only)
- [ ] **Not tested:** `0023`, `0024` and the class-question and label repo methods
  against a real Supabase or Mongo; a real Auth token; a model call; a real phone in
  another language; two server processes; every screen

**Client work** (the UI session's; nothing in `client/` was touched): `docs/API.md`,
"What the screens need" in each of the three Phase 5 parts. The three server asks are
built (`docs/API.md`, "Phase 5 follow-ups"): the phone can show `mine` after a resume,
the roster can show `under18Note` on a fresh load, and the dashboards and analytics
can read `levelBands` instead of summing the six levels.

### Phase 6: the Learning Hub: server done, every screen unticked

The directive's order for Phase 6, kept by the owner's delegation of 19 Nov 2026: the
content backbone; adaptive practice with feedback; Elo; the error log; FSRS; Get
Ready; refresher paths; practice and exam modes; lessons; the English, Hindi and
Marathi switch; the hint tutor. Decided under the delegation as H1 to H18
(`docs/PRODUCT_DECISIONS.md`, Phase 6), with two more lines checked here: the
language recorded per question, and personal progress with no rankings.

Committed as `646b4e6`, server and database only: `0025` (the backbone), `0026`
(practice and explanations), `0027` (lessons and languages), `0028` (Get Ready,
self-tests and goals), `0029` (the tutor). Endpoints: `docs/API.md`, "Phase 6: the
Learning Hub". The hub is for accounts only, so **every line below rests on signed-in
callers answered in-process** by the scripts' stand-in for Supabase Auth: no real Auth
token, Supabase database, Mongo or model was used.

A box is ticked only when the feature works **end to end with a test** on this tree:
over HTTP on a real server (the production `createApp` and `attachSockets`), on the
in-process store, with signed-in callers answered in-process, plus unit tests and
PGlite for the migrations. **No screen exists, so every screen line is unticked.**

The Phase 6 docs pass's run through the offline runner (19 November 2026):

| Suite | Result |
|---|---|
| Unit | 940 / 940 (219 suites); the nine Phase 6 files: `hubBackbone` 34, `richText` 19, `hubPractice` 39, `hubLessons` 39, `hubSeams` 6, `hubPaths` 24, `hubTutor` 36, `hubPathsTutor` 4, `hubFixes` 18 |
| Migrations | 1226 / 1226 |
| `hub.mjs` | 78 / 78 |
| `practice.mjs` | 78 / 78 |
| `paths.mjs` | 88 / 88 |
| `lessons.mjs` | 100 / 100 |
| `tutor.mjs` | 84 / 84 |
| Every Phase 0 to 5 suite | its figure after the Phase 5 follow-ups |

**Deploying.** `0025` to `0029` are route-only: the boot probe checks each and, when one
is missing, keeps Supabase, runs every room and logs the file and what fails until it
is applied. Apply them in number order, before or after the server. None has run
anywhere but PGlite.

Content backbone (H1 to H4, H15)

- [x] **One access rule** (`services/hubAccess.js`): a student reaches a class when its
  owner is their professor and the roster holds their roll number, not removed; the
  owner reads and writes; the department's HOD reads and gets 403 on every write;
  another professor, a removed student, another professor's student and a student
  not on the roster get the same 404 as a class that does not exist; 503 without
  Supabase; 401 for no token and for the teacher key (`hub.mjs`,
  `test/hubBackbone.test.js`)
- [x] **Units and placed chapters**: add, rename, reorder, remove; chapters placed and
  moved by the owner only, their own chapters only; "Other chapters" (`hub.mjs`)
- [x] **Topic records** made on upload, a topic edit, first placement and the owner's
  sync, never on a read; a used topic retired, an unused one deleted; no question row
  rewritten (`hub.mjs`)
- [x] **Prerequisite links**: provenance and state; a loop refused with a sentence
  naming the chain; chains nearest first from confirmed links only (`hub.mjs`, unit)
- [x] **AI proposals on the professor's button**: the strict parser on fixture
  replies; offline proposes none and says so (`hub.mjs`, unit). The live model call
  never ran
- [x] **Per-slide text** kept for new uploads; older decks say they cite slide numbers
  only (`hub.mjs`)
- [x] **Formulas and code** as server-made HTML, escaped otherwise, capped; the
  additive `rich` on the room phone's question, every other field as before
  (`test/richText.test.js`, `hub.mjs`, `test/hubFixes.test.js`)
- [ ] How MathML and shiki's output look in a browser or on a low-end Android. **Not
  checked**
- [ ] The class hub editor, chapter panel, link editor and the student's hub. **Not
  checked**

Adaptive practice with feedback (H5, H14)

- [x] **Approved questions only**, through `forStudent`, no key before an attempt;
  never a poll, a draft or an image question (`practice.mjs`)
- [x] **Marked on the server**; the reply gives right or wrong, the answer in the
  positions shown, the approved explanation, option feedback and the topic's state
  (`practice.mjs`, `tutor.mjs`)
- [x] **Its own append-only store**, idempotent by the device's attempt id; rooms,
  attainment and the register byte-identical before and after (`practice.mjs`, unit)
- [x] **Closed questions** (the review fix): a question a room is asking now, one on
  an open self-test, or the one an open Get Ready check is asking is not served,
  answered (409, nothing stored) or hinted (`practice.mjs` over a real socket room,
  `lessons.mjs`, `test/hubFixes.test.js`)
- [x] **Explanations**: one per question, written and approved by the professor, or
  drafted on the button and approved (offline: none, with a sentence); students see
  approved ones only (`practice.mjs`). The model's drafting never ran
- [ ] **Image-stimulus questions and the fewer-choices support** are left out of hub
  practice
- [ ] The practice screen. **Not checked**

Elo (H6)

- [x] **A rating per student and topic and per question**: first attempts only, items
  seeded by Bloom level, K shrinking with answers; the typical question's chance
  (`test/hubPractice.test.js`, `practice.mjs`)
- [x] **Five topic states**, each with N and a sentence, provisional marked; Mastered
  at a chance of 0.8 from 5 answers; honest sentences when a topic has too few
  questions (`bankShort`) (`practice.mjs`, `test/hubFixes.test.js`)
- [x] **Verified room answers do not seed it**, and every progress reply says so
  (`practice.mjs`)
- [ ] Item ratings are not shown to staff yet
- [ ] The mastery map. **Not checked**

Error log (H7)

- [x] **Built automatically** from wrong hub attempts and verified room answers ("From
  class"); one open entry per question; cleared by a different question on the topic
  at its level or above; prerequisites listed (`practice.mjs`, unit)
- [x] **No room key it would not show anyway** (`keyHeld`) (`test/hubFixes.test.js`)
- [ ] The error-log screen. **Not checked**

FSRS (H8)

- [x] **One ts-fsrs card per student and topic**, default parameters; sessions split at a
  10-minute gap; the rating mapping; a due list; weekly consistency with rest days and
  no streak (`test/hubPractice.test.js`, `practice.mjs` on a fixed clock)
- [ ] The review and consistency screens. **Not checked**

Get Ready (H9)

- [x] **A check of at most 12 questions** over the target's confirmed prerequisites,
  nearest first, with the stopping rule; a topic mastered in practice is Ready without
  asking; Not sure yet with its reasons; feedback after each answer; an ended check
  stays ended (`paths.mjs`, `test/hubPaths.test.js`, `test/hubFixes.test.js`)
- [ ] The Get Ready screen. **Not checked**

Refresher paths (H9)

- [x] **The Needs-review prerequisites in dependency order**, each with why it is on
  the path in the student's own counts, ending at the target; a step done by two right
  in a row or two of the last three, a repeat counting once per round (`paths.mjs`,
  `test/hubFixes.test.js`)
- [ ] The path screen. **Not checked**

Practice and exam modes (H10)

- [x] **Practice**: feedback after each item; hints available (`practice.mjs`,
  `tutor.mjs`)
- [x] **Self-tests**: chosen topics and levels, up to 30 questions, an optional time
  limit with a 30-second grace on the server's clock; no hints and no feedback until
  hand-in; late answers kept and not counted; unanswered questions keep their keys;
  counted nowhere official; held back from the estimates until the end (`paths.mjs`,
  `test/hubPaths.test.js`, `test/hubPathsTutor.test.js`)
- [ ] **Written answers** get labelled provisional machine marks: built and
  unit-tested (`test/hubPractice.test.js`, `test/hubPaths.test.js`), but no written
  answer was sent over HTTP
- [ ] The self-test builder and result screens. **Not checked**

Lessons (H11)

- [x] **A "slides only" lesson through the routes**: chunks of the professor's own text,
  cited by slide (or saying it cites none), with approved questions; a draft until
  approved; regenerating keeps the approved one serving; students read the approved
  one only, with no key before an attempt; its answers land in the attempts store
  (`lessons.mjs`, `test/hubLessons.test.js`, `test/hubSeams.test.js`)
- [x] **The AI-draft lesson** (worked example, retrieval questions as bank drafts) with a
  stand-in model, in-process (`lessons.mjs`, unit). Never with a real model, nor
  through the route with one
- [ ] The lesson screen and the staff lesson panel. **Not checked**

English, Hindi and Marathi (H12)

- [x] **Translations per item and language** (questions, lessons, explanations, hints,
  option feedback): made on the button or by hand, checked (blocking findings and
  flags), approved, out of date once the English changes; a student sees an approved,
  current one or English with a note (`lessons.mjs`, `test/hubLessons.test.js`,
  `test/hubSeams.test.js`)
- [x] **The student's choice** of language, saved and read (`lessons.mjs`)
- [ ] Hindi or Marathi through Get Ready or a self-test (only English was run there);
  the quality of any translation; Devanagari rendered anywhere. **Not checked**
- [ ] The language switch and the translations screen. **Not checked**

The hint tutor (H13)

- [x] **Approved hint ladders and option feedback**, the professor's approved as
  written, AI drafts approved per question; the answer-leak check at writing, parsing,
  approval and serving; the first-hint plan from the student's own recent answers;
  each hint opened recorded; hints used counted per question since the last answer;
  never in a self-test or Get Ready (`tutor.mjs`, `test/hubTutor.test.js`,
  `test/hubFixes.test.js`)
- [x] **No live model call**: drafting only on the professor's button, from fixture
  replies and a stand-in model; offline drafts none (`tutor.mjs`)
- [ ] A live chat tutor: not built (an owner option, `docs/PRODUCT_DECISIONS.md`)
- [ ] The hint button and the staff hints screen. **Not checked**

Language recorded per question

- [x] **Every hub attempt records the language actually shown**, believing the
  screen's echo only when it can have been true (`test/hubSeams.test.js`,
  `lessons.mjs`)
- [x] **By-language item statistics** from each student's first graded hub attempt,
  through Phase 5's warning (`lessons.mjs`, unit)
- [ ] Room answers are still all `'en'`: no room phone sends a language

Personal progress, no rankings (H16, H17)

- [x] **No rank, class average, streak, coins or band name** on any student payload,
  the hub home included (`paths.mjs`, `test/hubPaths.test.js`); the student's hub says
  their professor can see their progress (`hub.mjs`, `paths.mjs`)
- [x] **Goals** with an exam date, private to the student (`paths.mjs`)
- [x] **Staff views in roll order**, never ranked: per class by topic state, per
  student with N, activity counts (hints as counts), open errors and Get Ready results;
  the HOD reads only (`practice.mjs`, `paths.mjs`, `tutor.mjs`)
- [ ] The hub home, goals and the staff class and student pages. **Not checked**

Across the phase

- [x] **No model call in anything a student waits on** (decision 5): every script
  refuses and counts any request off the machine, 0 in every run
- [x] **Rooms, the ladder, attainment, the register and the answers table untouched**:
  checked byte for byte before and after hub work (`practice.mjs`, `tutor.mjs`)
- [x] **The three repos expose the same 144 methods** (the parity unit test). `0025` to
  `0029` are additive and idempotent, re-run over data, RLS on and no policies, and
  change no existing row (`npm run migrations`, PGlite only)
- [ ] **Not tested:** `0025` to `0029` and every new repo method against a real Supabase
  or Mongo; a real Auth token (accounts work only through the shim); any model call;
  two server processes; a semester's data; every screen

**Client work** (the UI session's; nothing in `client/` was touched): `docs/API.md`,
"Phase 6: the Learning Hub", "What the screens need".
