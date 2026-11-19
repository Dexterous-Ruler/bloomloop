# Changelog

Newest first. Nothing below is deployed. The 18 November entries are committed as
`b4585a0` on branch `roadmap-phase0-evidence`, the Phase 1 entries of 19 November as
`05daf56` and the Phase 2 entries as `27559ca`. **Phase 3 is committed as `d162cc8`**
and Phase 4, its review fixes and `0019` to `0021` included, as `eedfd5e`. The
owner's decisions of 19 November (`0022`) are uncommitted, and so are Phase 5's
confidence tap and class question (`0023`), its misconception labels (`0024`), its
honest indicators and the fixes from its review (no migration).

## Unreleased: Phase 5 follow-ups (19 November 2026)

Server only, no migration; after `2f4fd2b`. `docs/API.md`, "Phase 5 follow-ups".

- **`under18Note` on a class's read.** `GET /api/classes/:id` (and every reply carrying
  the class body) has the decision 8 sentence whenever a student on the roster is
  marked under 18, so a fresh load or an HOD's read shows it.
- **`levelBands` on the staff dashboards and analytics** (`GET /api/dashboard`,
  `GET /api/analytics`, `GET /api/analytics/:id`): decision 6's three bands summed from
  the six levels by the attainment report's `LEVEL_BANDS`, each with its answers and a
  sentence. Not for a student reading themself; `bloom` unchanged.
- **Each phone's own `mine`** on `class:question` after a room is resumed and when a
  class question is paused, by the decision 7 rule a join uses; a phone that reloaded
  during a pause now shows the vote the server holds.
- **A room's close survives a store error** while closing its class question: logged,
  and the close still answers 200 and tells the phones and the projector (the Phase 5
  review finding).
- **Seven projector refusals** reworded so none names a field.
- **Students in roll order** in a professor's analytics; `?order=accuracy` for highest
  accuracy first; the insights read names `roll` as its default order. The room CSV's
  "Slow Learner" column is unchanged. Decided under the owner's delegation.
- **No machine path in the repository:** `CONTRACT.md` no longer names a home folder,
  and `integrity.mjs`, `resume.mjs` and `roundtrip.mjs` import the source tree beside
  them instead of a fixed `C:/Users/...` path.

## Unreleased: Phase 5 docs pass and contract amendments (19 November 2026)

- **`CONTRACT.md` Amendment 5**, dated and marked as decided under the owner's
  delegation, where the follow-up decisions of 19 November named it: section 3
  (`Question.source` may be `'teacher'`), section 4 (the regenerate row: an active
  question keeps serving until its replacement is approved), section 5 (`student:join`'s
  optional `token`; `session:accepted`'s `linked`, `linkNote`, `confidence`;
  `student:answer`'s `confidence`; the events `student:vote`, `class:question`,
  `class:vote`, `class:closed`, `teacher:class-question`) and section 6 rule 1 ("No
  image generation" means image-model output; a code-rendered graph question kind
  after Phase 6). `V2-CONTRACT.md` read against the decisions; unchanged.
- **`docs/PRODUCT_DECISIONS.md`**: decision 4's revision (a graph question kind after
  Phase 6), decision 7's fix, the builders' open questions as decided under the
  delegation, the rules the review fixes chose, and "Phase 5 in brief" (why a class
  question moves no level, the label matching rule, the translation threshold, and
  what is open).
- **`docs/API.md`**: one index of every Phase 5 endpoint and socket event, what the
  review fixes changed (with payloads captured after the fixes), a student's own
  history after the decision 7 fix, and the open issues.
- **`docs/IMPLEMENTATION_STATUS.md`**: one Phase 5 checklist by the directive's items
  (every screen unticked), the test table and the risks brought up to date.
- `docs/TESTING.md`, `docs/ARCHITECTURE.md`, `docs/DATABASE_SCHEMA.md` and
  `supabase/README.md` brought up to `0024` and the review fixes.
- Every suite through the offline runner: unit 719/719, migrations 752/752, and every
  end-to-end script at its figure (`docs/TESTING.md`, "Full rerun after Phase 5").

## Unreleased: Phase 5, fixes from the review (19 November 2026)

Server only, no migration. Each fix is checked by the new
`server/scripts/keysafety.mjs` (41 checks, added to the offline runner) or by
`decisions.mjs`, and by unit tests (`test/classQuestions.test.js` 20 to 24,
`test/decisions.test.js` 22 to 27).

- **A class question's key could reach a phone before the reveal.** Fixed four ways:
  - `class:question` named the bank question, an id a phone could send back as its own
    answer (here, or in another open room on the chapter) and be marked on. Its
    question is now named by the class question's id.
  - A vote's key sent again through `student:answer` was answered from the vote (its
    mark, the key, and a move on the ladder). Now it is re-keyed like another student's
    row, the answer kept with the class question and never counted, and the phone moved
    on with no result.
  - A resend of an answer sent to the asked question as a phone's own told the mark,
    one option at a time, before the reveal or after a close without one. Now it only
    moves the phone on.
  - A vote for a round not yet open was kept as "late"; it is now kept as early, with
    its own sentence.
- **A typed roll number could take a signed-in student's vote** (decision 7). A phone
  not signed in as her is no longer sent her vote or tap, and its vote stops counting
  once her phone has voted in the round (kept, with a sentence).
- **A vote while the room was paused counted.** Now kept and not counted, and the phone
  is told the room is paused (`session:paused`).
- **The professor is told how many phones answered the question on their own first**
  (`phones.answeredAlone`, `answeredAloneNote`), and such a student's round 1 vote is
  set aside in attainment, their own answer counting instead; every methodology says so.
- **A student's own dashboard and analytics read a whole linked profile** (decision
  7's residual): now only the history entries of their own verified answers, with the
  room's working level withheld when other answers helped set it; the `note` says so.
- **A deleted class room's archive** is served without the signals of a student the
  roster marks under 18 now (decision 8), whenever the mark was set.
- **A regenerate of a never-approved replacement lost its link**; it now passes it on.
- **Refusal sentences named fields** (`questionId`, `reveal`, three projector
  sentences); reworded.
- **Not acted on:** closing a room while a class question runs awaits that close with
  no catch, so a store error there could leave the phones uninformed (traced, not
  reproduced; `docs/API.md`, "Known open issues").

## Unreleased: Phase 5, honest indicators (19 November 2026)

Server only, no migration; every console and phone screen is the UI session's
(`docs/API.md`, "Phase 5: honest indicators", "What the screens need"). Audited first:
most counts already existed, and only what was missing was built. The defaults chosen
are in `docs/PRODUCT_DECISIONS.md`, "Phase 5: honest indicators". Every change is a
field added.

- **Who wrote a question, and whether it was let in** (`services/honesty.js`). Every
  bank question sent to staff carries `provenance` (AI-generated, professor-written,
  offline template, or the older rows nothing tells apart; the model; draft, approved,
  written, in use from before approvals, or discarded; "AI draft" on an unapproved AI
  question). Every misconception label carries `confirmed`. The phone's question, and a
  class question, carries `provenance.text` in a student's words, never "template" or a
  model's name, and only for a question the room serves (`CONTRACT.md` Amendment 4).
- **An uncertain Bloom level** (`levelCheck`, staff only): an AI question no professor
  approved, or a kind that does not ask for its level, with the reason; on every bank
  question and item.
- **Every level move kept with its reason.** A promotion, a demotion, the move into the
  below-40% band and a hold at the top or the floor are kept on the answer's history
  entry (`move`: rule, from, to, window, share, answers, the professor's sentence),
  read on the student card (`serving.moves`). Staff-only: a student's own dashboard
  trail is sent without it. The Mongo schema declares it.
- **The count behind every estimate**, with a sentence: `levelBasis` and `masteryBasis`
  on the teacher's grid row, `masteryBasis` and `next.provisional` on the phone's
  (`CONTRACT.md` Amendment 4); `bandBasis` and `levelBasis` per student, a `sentence`
  per KPI and a `basis` per card in the insights; the card's `band.provisional`,
  `serving.basis`, `mastery`; each item's `basis` (provisional under 5 answers); class
  analytics' sentences; the dashboards' and a professor's analytics' room counts.
  Attainment already carried its counts (checked).
- **Translation warnings.** Each item splits its answers by language and warns when two
  languages with 5 or more answers each differ by more than 20 points; the student card
  says which answers were in another language; staff answer reads carry `language`.
  Every answer is `'en'` today, so this is tested on fixtures in two languages.
- **Labels audit**: nothing stigmatising or ranking reaches a phone or the projector; no
  coins, points, badges, leaderboards or streaks on the server.
- Tests: `server/test/honesty.test.js` (27) and `server/scripts/honesty.mjs` (59
  checks), added to the runner. Four existing assertions gained the new fields
  (`evidence.test.js`, `insights.test.js`, `misconceptions.test.js`,
  `decisions.test.js`) and `decisions.mjs`'s list of the phone row's keys gained
  `masteryBasis`; none changed what it checks.

## Unreleased: Phase 5, misconception labels on wrong options (19 November 2026)

Server and database only (`0024`); every console screen is the UI session's
(`docs/API.md`, "Phase 5: misconception labels on wrong options"), and the phone and
the projector change in nothing. The defaults chosen are in
`docs/PRODUCT_DECISIONS.md`, "Phase 5: misconception labels".

- **A label per wrong option** of a Choose one, Choose all that apply or True or false
  question: optional, at most 120 characters, no contact details, never on a poll or a
  right answer. Stored on the question by the option's words
  (`questions.misconceptions`, `0024`), with its provenance: `ai` ("AI draft") or
  `professor`.
- **The owner adds, edits, confirms and clears them**
  (`PATCH /api/bank/question/:id/misconceptions`), all or nothing; an HOD reads and is
  refused (403), anyone else gets the question's 404. A label changes no mark: the
  question keeps its status, approval and checks, so an approved question is not sent
  back to draft, and approving a question confirms no label.
- **Edits keep labels honest**: a reorder keeps each label on its option; rewording or
  removing a labelled option, or making it a right answer, removes its label and the
  reply names it (`misconceptionsRemoved`, `misconceptionsNote`, on `PATCH
  /question/:id` and a bulk retag); split and merge carry the labels they can.
- **The generator may propose labels** (professor-triggered, decision 5): a new prompt
  rule and response field, parsed by `validateItems` into AI drafts; a bad one is
  dropped and the question kept. The offline templates propose none.
- **Reports, staff only**: per room (`GET /api/session/:code/misconceptions`), per class
  (`GET /api/classes/:id/misconceptions`, with attainment's room filters) and per question
  (`GET /api/bank/question/:id/misconceptions`): "12 students chose the option linked to
  the misunderstanding ...", counted from each student's final answer (class-question
  votes left out), matched through the option's words in the answer's own snapshot to
  the question's current label, with "Label added after these answers" where true.
  Counts, never names.
- **Item statistics** show each option's label beside its count.
- **Never on a phone or the projector**; labels are left out of every stored answer
  snapshot (`snapshotOf`), and so of a room's archive.
- The Supabase boot probe checks `questions.misconceptions` as a piece rooms need.
- Tests: `server/test/misconceptions.test.js` (40) and `server/scripts/misconceptions.mjs`
  (54 checks), added to the runner; `migrations.mjs` gains `0024`'s section, its re-run
  check and `0024` over existing questions and answers. No existing assertion changed.

## Unreleased: Phase 5, the confidence tap and class questions (19 November 2026)

Server and database only (`0023`); every screen is the UI session's (`docs/API.md`,
"Phase 5"). The defaults chosen are in `docs/PRODUCT_DECISIONS.md`, "Phase 5".

- **The confidence tap.** `student:answer` (and a vote) takes an optional `confidence`:
  `sure`, `think_so` or `guessing`, stored on the answer row in the spellings `0008`
  already allows. It changes no mark, level, band, insight or attainment (proved by a
  unit test and end to end). Staff see counts by tap and by right and wrong: per room
  and per question (`GET /api/session/:code/confidence`), per class-question round, and
  on the student card. Never beside an answer, never a label. `session:accepted`
  carries the three taps.
- **Class questions with pause, discuss, re-vote.** The room's owner puts one approved
  `mcq`, `truefalse`, `poll` or `multi` question to every phone in a Student-devices or
  Mixed room (`/api/session/:code/class-questions`): round 1, the pause (the
  distribution, share right and taps are shown then, not while voting is open), the
  re-vote, and the close with or without revealing the key. Phones park their own
  question, vote with `student:vote`, and go back; `class:question`, `class:vote` and
  `class:closed` to phones, `teacher:class-question` to the professor's screens. The
  class-level changes (wrong to right, right to wrong, right both times, wrong both
  times on the same or another answer) are counted once round 2 closes. The state is
  stored (`class_questions`), so a phone that joins or reconnects is sent it.
- **Every vote is an answer row**, never overwritten (`answers.class_question_id`,
  `round`); a changed vote and a late one are kept, not counted. **No vote moves a
  level.** A question asked to the class is never served on its own in that room again.
- **Attainment: a fourth evidence type, `revote`** (the re-vote after discussion),
  shown in the JSON, CSV and HTML and never counted; round 1 is a digital answer. Every
  methodology says so.
- **The projector** may show a class question (`PATCH …/projector`
  `{ question: { classQuestionId }, showCounts }`): a count of votes, and only when the
  professor chooses, each closed round's counts from 5 votes; the key, share right and
  changes only once revealed.
- **Readers of a student's own work leave votes out**: topics, item statistics, class
  analytics, the student card's last answers, a student's own history. The room's
  record labels each vote (`classQuestion: { id, round }`).
- **A deleted room's archive** keeps its class questions and every vote.
- Tests: `server/test/classQuestions.test.js` (20) and `server/scripts/classquestion.mjs`
  (70 checks, eight phones), added to the runner; `migrations.mjs` gains `0023`'s
  checks. Four assertions changed where the new evidence type is now listed
  (`test/attainment.test.js` twice, `scripts/acceptance4.mjs`, `scripts/attainment.mjs`),
  and one where an answer item gained `classQuestion` (`test/evidence.test.js`).

## Unreleased: the owner's decisions of 19 November 2026

The owner delegated the eight open product decisions, the two Phase 3 questions and
the Phase 2 defaults. Each is recorded in `docs/PRODUCT_DECISIONS.md` as decided under
the owner's delegation, with what was built; server and database only, one migration
(`0022`). Decision 8 is a working posture, not a legal decision: a lawyer must confirm
it before any college signs or before 13 May 2027.

- **Decision 7, the identity gap closed.** A room profile is linked to a student
  account only when the phone presents that signed-in student's token at
  `student:join` (verified as the student routes verify one). The link and every
  answer that phone sends are marked verified (`profiles.account_verified`,
  `answers.account_verified`). A student's own history (`/api/analytics/:id/answers`,
  `/api/analytics`, `/api/dashboard`) reads verified rows only, so a typed roll
  number, and every link made that way before, exposes nothing; those links are kept,
  unverified. `session:accepted` gains `linked` and `linkNote`. Attendance from a
  typed roll number stays `joined`.
- **Decision 8, the under-18 mark.** `class_students.under_18`, set by the owner (the
  student edit, a pasted list, an `Under 18` CSV column). No integrity signal is
  recorded for such a student in the class's rooms, and none is shown: grid, trail,
  room CSV, archive.
- **Labels are staff-only (Phase 3 question (a)).** The phone gets a `PhoneRow` (no
  `slowLearner`, signals or professor's `reason`; a neutral `next`) and sentences of
  its own; `CONTRACT.md` sections 4 and 5 amended. A student account's own dashboard
  and analytics no longer carry `banded`.
- **A professor's own question is `source: 'teacher'`** (contract §6 rule 5 amended;
  check widened). Older ones stay `fallback`. Attainment labels follow.
- **The slide-only check** passes with a passage attached.
- **Regenerating an active question keeps it serving** until the replacement is
  approved (`questions.replaces_id`); every approval route retires it.
- **`GET /api/classes` carries `canCreate`; `projector:state` carries `roomMode`.**
- **Four people-facing sentences** no longer name an API path, field or verb.
- **The boot probe** checks every table and column written from `0016` to `0022` and
  names the migration to apply: `0019` to `0021` as warnings that keep Supabase,
  `0022` as one rooms need. It now probes with a GET: a HEAD could not see a missing
  table.
- **`best` attempts:** a professor-reviewed attempt always beats a provisional machine
  mark at the same question, whatever the scores and rooms; the methodology says so.
- `CONTRACT.md` section 6 rule 1 amended per decision 1. Decisions 1 to 6 recorded.

Tests: `server/test/decisions.test.js` (22) and `server/scripts/decisions.mjs` (64,
added to the offline runner); existing suites updated where a decision changed what
they assert. Full run through the offline runner: unit 623/623, migrations 633/633,
decisions 64/64, and every earlier suite at its earlier figure. Nothing was run
against Supabase, Mongo, Gemini or a real Auth token.

## Unreleased: 19 November 2026

Server and database only; the client is the UI session's (`docs/UI_REBUILD.md`). Its
uncommitted client calls the Phase 3 class routes and now the Phase 4 routes too (not
checked here). At the end of Phase 1
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
themselves). After Phase 4's attainment work: unit 558/558, migrations 533/533,
outcomes 86/86, attainment 65/65, and every earlier suite as before. After Phase 4's
exports: unit 573/573, migrations 533/533, acceptance4 73/73, and every earlier suite
as before. After the fixes from the Phase 4 review, the full rerun through the offline
runner gave unit 598/598, migrations 573/573, outcomes 87/87, attainment 73/73,
acceptance4 76/76, and every earlier suite as before.

### Phase 4: full rerun and docs

No code change in this pass. Every suite was run through the offline runner after
the review fixes, twice (the fix's own run and a rerun), with the same figures: unit
598/598, migrations 573/573, outcomes 87/87, attainment 73/73, acceptance4 76/76, and
every earlier suite as before (`docs/TESTING.md`, "Full rerun after Phase 4"). The
examples in `docs/API.md` were captured again after the fixes, from a one-off copy of
the acceptance run on the in-process store with the network settings blanked.

An earlier docs pass, made before the review fixes, ran every suite on a tree where a
change to the class figure was half done and recorded three suites failing (unit
583/584, attainment 64/66, acceptance4 70/73). The fixes finished that change; this
pass replaces those figures and the text that described the half-done change.

- `docs/API.md`:
  - the "Phase 4: every new and changed endpoint" index: the reports' query with the
    `key` rule, the Phase 4 status codes, what every report carries, whose answers
    they are (`0021`, `rollNotes`, `givenAs`), the evidence types with the machine
    mark, the question sources, a class figure captured after the fixes, the files as
    they now look, and a list of the review fixes;
  - the outcome, attainment and export parts brought up to date: the restore at 50,
    the linear import, the save rule for provisional marks, `best` and written
    retries, room weights and `inReport`, rounding down, the student report's
    `givenAs` and `questionSourceType`, the register's `rollNotes`, the sheets' new
    rows and columns (30 leading rows; "behind the share", outside the share and the
    nine question-source columns), the semicolon guard, no key in a file's address,
    the pages' new sections;
  - the attendance write and the archive's `markedRollNo` under Phase 3 and "Deleted
    rooms";
  - "Known open issues": the semicolon guard and the key printed on a page moved to
    "now fixed"; added the deliberate leftovers (the Phase 0 room CSV still takes
    `?key=`; "everyone who joined" decides by the roster roll now; a roll number
    reused after a correction), roll numbers corrected before `0021`, `best` across
    rooms with provisional marks counted, and deploying before `0021`;
  - the UI session's uncommitted client noted as calling the Phase 4 routes.
- `docs/IMPLEMENTATION_STATUS.md`: the test table; how the numbers grew; the risks
  (`0021` before the server; the two fixed review findings and the half-done change
  removed); the Phase 4 checklist by the directive's items, with class attainment,
  the course-outcome sheet, the guard, no key in a file's address, question sources,
  the roll-number tie and the acceptance criterion now ticked, and every screen
  unticked.
- `docs/TESTING.md`: the Phase 4 script rows, the migrations row for `0021`, "Phase 4
  review fixes", "Full rerun after Phase 4" and "Not covered".
- `docs/ARCHITECTURE.md`: the course-outcome attainment section brought up to date
  (the roll resolver, question sources, display rounding, what can and cannot be
  configured), and the client row.
- `docs/DATABASE_SCHEMA.md` and `supabase/README.md`: `0021`, its column and the apply
  order `0019`, `0020`, `0021`, with why `0021` must come before the server.
- `docs/PRODUCT_DECISIONS.md`: the defaults the review fixes chose, and the Phase 4
  questions for the owner brought up to date.

### Phase 4: fixes from the review

Server, tests and database (uncommitted). One migration, `0021`. No new dependency. Every finding of the Phase 4 review is fixed, each with a
check in the unit tests or the three Phase 4 scripts.

- **The class figure rests on the students counted.** A figure's `marks` (an outcome,
  a Bloom level or a band) holds only the answers of the students counted, attained or
  not attained. Roster students with too few counted answers are outside the share:
  `outside.notEnoughEvidence` gives `{ students, answers, marks }`. The summary reads
  "Rests on N counted answers from the M students counted: ..." and, when any answers
  are outside, adds "Outside the share: X counted answers from Y students with not
  enough evidence."
- **Rounded down for display.** A share is cut to 4 decimals, rounded down (2 of 3 is
  0.6666, "66.66%"; 59.996% reads 59.99, never 60 beside "Not attained" under a 60%
  threshold). Obtained marks are rounded down and possible marks up, to 3 decimals.
  States and levels are still decided exactly.
- **Room weights in a report** are named from every room of the class the caller may
  read, and each carries `inReport`. A weighted room the dates or `?rooms=` leave out
  is "a room not in this report", never "since deleted", in the methodology, the
  parameters and the files.
- **A corrected roll number keeps a student's answers** (`0021`). An attendance mark
  keeps the roll number it was made under (`attendance.roll_no`): a join the phone's,
  in the roster's form; a professor's mark (and a wheel pick's Absent) the roster's at
  that moment, unless the mark it replaces already carries one, which is kept. A
  report gives a room's answers to the student whose mark there carries their roll
  number, else matches them to the roster as it stands; nothing is inferred, and a
  roll number two marks of one room carry is tied to neither. The class report and the
  register gain `rollNotes` (every roll number off the roster: its rooms, and whom a
  mark under it was made for), with `note` on each row off the roster; a student
  report's answers gain `givenAs` and a sentence in `note`; a deleted class room's
  archive gains `markedRollNo` on each attendance row (null in older archives).
- **Who wrote the question.** Every `marks` gains `questionSources` (`aiGenerated`,
  `professorWritten`, `offlineTemplate`, each `{ answers, obtained, possible,
  notCounted }`), the class report `answers.bySource`, the student report
  `answerCounts.bySource` and `questionSourceType` on each answer, and all three
  reports `questionSources`. A `fallback` question is labelled "Offline-template or
  professor-written questions", since a professor's own question is stored that way;
  `teacher` maps to professor-written. It moves no mark.
- **Provisional marks called what they are.** `aiProvisional` is labelled
  "Provisional machine marks" and described as a keyword match against the rubric, not
  AI, in every report, sheet and page; the stored key is unchanged.
- **A save may not count `aiProvisional` without `humanReviewed`** (400): a review
  replaces the machine's mark, so such a formula would drop every reviewed answer. A
  formula stored that way still reads, and its methodology says what it does.
- **`best` attempts** never count a written answer's attempt followed by a retry: only
  a final attempt can be reviewed, so a provisional mark on an earlier attempt no
  longer beats the professor's mark on the final one.
- **A formula's saved day** is India's day, as every other day in a report.
- **No "level 0 below 0%"** in the parameters when the first level starts at 0%.
- **Only rooms opened for the class** are counted, and the methodology, the register's
  methodology and `definitions.rooms` say so.
- **CSV sheets.** The class table's evidence columns are "<Type> behind the share
  (counted)" or "(not counted)" with ": marks obtained" and ": marks possible", then
  nine question-source columns, "Polls behind the share (not marked)", and two
  outside-the-share columns before the removed students' (39 columns in all). New
  leading rows: "Question sources", "Roll numbers not on the roster" and "Roll
  numbers" (how to keep them exactly: import as text). The register gains "Total
  counted answers on <source>" three times.
- **The CSV guard** also puts an apostrophe after a semicolon or a tab inside a cell
  where a formula would start, and quotes every cell holding a semicolon or a tab.
- **No key in a file's address.** `?format=csv` or `html` with `?key=` on
  `/attainment`, `/attainment/students/:studentId`, `/register` and
  `/outcomes?format=csv` is a 400 that says to send the `x-teacher-key` header. JSON
  with `?key=` is still 200. The Phase 0 room CSV (`routes/export.js`) is unchanged.
- **Restoring an outcome** (`PATCH .../outcomes/:outcomeId` with `{ "archived":
  false }`) while 50 are in use is a 409, as creating one is.
- **The CSV import reads in linear time**; a crafted file near the 1 MB limit used to
  take seconds. A unit test reads such files.
- **Printable pages**: a question-source table, "Who wrote the questions behind each
  share", an "Outside the share" column, the roll numbers off the roster with their
  notes, and the question's source under each answer on the student page.
- Left alone on purpose: the Phase 0 room CSV still takes `?key=` (its header must
  stay on row 1 for the Classroom import); "everyone who joined" (`marksFromJoins`)
  decides by the roster's roll number now; a roll number reused within a class after a
  correction can send answers to its current holder (`docs/API.md`, "Known open
  issues").
- Tests: unit 598 (25 more: `outcomes` 44, `attainment` 56, `exports` 21, `roster`
  35), migrations 573 (40 more, for `0021`), `outcomes.mjs` 87, `attainment.mjs` 73,
  `acceptance4.mjs` 76; every earlier suite unchanged.

### Phase 4: CSV exports, printable reports and the acceptance run

Server, tests and docs (uncommitted); no client change. No migration, no repo method,
no new dependency.

- **The reports as files, from the same routes** (`?format=csv`, `?format=html`; JSON
  stays the default): the course-outcome attainment sheet and, with `&sheet=bloom`, the
  Bloom sheet (`GET /api/classes/:id/attainment`); the marks register
  (`.../register`); the outcome list with its mappings (`.../outcomes`, CSV only);
  printable pages for the class's attainment, one student
  (`.../attainment/students/:studentId`, HTML only) and the register. Each file is the
  JSON report of the same request handed to a writer that computes nothing
  (`services/exports.js`, `services/printable.js`).
- **A CSV writer** (`csvCell`, `toCsv` in `services/csv.js`): BOM, CRLF, RFC 4180
  quoting, numbers unquoted, and a formula-injection guard (a text cell starting with
  `= + - @`, a tab or a CR gets an apostrophe and is quoted), said in every sheet.
  Every sheet starts with rows giving the class, period, rooms, formula, its exact
  parameters, the methodology paragraph and the evidence types, then its tables.
  Teacher records appear at class level only.
- **Printable pages**: self-contained HTML (inline CSS, no script, font, image or
  link; a Content-Security-Policy in the header and the page), every value escaped
  through one tagged template, A4 print rules with page breaks, repeated table headers
  and landscape matrices, state and level badges that carry their words, and a
  separate teacher-records section.
- ASCII filenames from the class's course, section and id prefix and India's day,
  never a student's name; `no-store`. Ownership as for the JSON route; a bad `format`
  or `sheet` is a 400 after the class's 404; `?key=` works exactly as for an image.
- The class report's outcomes now carry `topics` and `directQuestions` (what each is
  mapped to), additively.
- **`server/scripts/acceptance4.mjs`**: the directive's acceptance criterion end to
  end (73 checks), added to the offline runner; `server/test/exports.test.js` (15).

### Phase 4: configurable attainment and the marks register

Server, database and docs (uncommitted); no client change. One migration, `0020`. No
new dependency.

- **The attainment formula is data** (`0020` `attainment_configs`; `services/attainment.js`
  `validateConfig`, `configFrom`): a student threshold, a minimum number of counted
  answers, class levels (strictly increasing), which evidence types count, final or
  best attempts, room weights. Stored per class as numbered versions that are never
  changed (the database refuses an edit); `GET` (read rule) and `PUT` (owner)
  `/api/classes/:id/attainment/config`, from a preset or by named fields; a bad field,
  an unknown key, a room not of the class or counting teacher records is a 400 that
  saves nothing.
- **Presets as data, named as examples** (`services/attainmentPresets.js`,
  `GET /api/attainment/presets`): "Example: 60% of marks; levels at 50 / 60 / 70% of
  students" (the default until a class saves its own) and "... 60 / 70 / 85% ...".
  Neither is called NAAC or NBA; every report says when it used one.
- **Evidence types** read off the answer row (`evidenceTypeOf`): digital (`auto`),
  provisional written marks (`provisional`: the keyword, or a model, marker, not
  reviewed), professor-reviewed (`confirmed`, `overridden`); polls a count only. Every
  figure is split by them, with the answers it rests on; provisional marks are shown
  and, by default, not counted.
- **Course-outcome and Bloom attainment** (`GET /api/classes/:id/attainment`,
  `?from=&to=&rooms=`): per student and outcome, marks obtained and possible by type,
  the counted share and a state (attained, not attained, not enough evidence); per
  outcome, the roster counted, attained and share, the class's level, the evidence and
  the students outside the count (removed, off the roster); the same per Bloom level and
  per decision 6's three bands; every answer mapped, excluded or unmapped, adding up;
  teacher records in their own section, moving no figure; the formula, its version and
  a methodology paragraph written from it. Decided in exact integer arithmetic.
- **One student's report** (`.../attainment/students/:studentId`), with every answer
  behind it in the teacher's view, its type, whether it counted and why, and the
  outcomes it reached.
- **The marks register** (`GET /api/classes/:id/register`): students in roll order by
  rooms in date order, marks obtained of possible by evidence type, the attendance mark
  and a total; no answers in a room is 0 of 0 beside its attendance mark, never a zero.
- Staff-only throughout; students listed in roll order, never ranked. Deleted rooms
  are not counted (their archives are not read), and every report says so.

### Phase 4: course outcomes, their mappings, and the roster from CSV

Server, database and docs (uncommitted); no client change. One migration, `0019`.
No new dependency: the CSV reader is written in `services/csv.js`.

- **Course outcomes** (`0019` `course_outcomes`; `routes/outcomes.js`,
  `services/outcomes.js`): a class's outcomes, each a code, a statement of at most
  300 characters, an optional target level and a place in the order. List, create,
  edit, reorder, remove, and copy from another class the caller may read (new rows,
  nothing linked). Removing one that any counted answer reaches archives it instead,
  keeping its mappings, so later reports still name it; one with none is deleted and
  taken off any override. Ownership follows the class.
- **Mappings** (`outcome_topics`, `question_outcome_overrides`): an outcome to topics
  of chapters the caller may read, each with a weight (default 1), a topic to any
  number of outcomes; a per-question override mapping one question straight to some
  outcomes, or excluding it, kept by the question's id so it outlives edits and, for
  the answers given to it, the question itself.
- **`resolveAnswer`**, the one pure rule from an answer row to its outcomes and why
  (`question`, `topic`, `excluded`, `unmapped`), for the coverage and the attainment
  report alike: the override first, then the topic in its chapter (the question's
  while it exists, then the answer's frozen one). A topic renamed after answers were
  given keeps its answers counted, as unmapped under the old name, until it is
  mapped.
- **Coverage** (`GET /api/classes/:id/outcomes/coverage`): per outcome and topic, the
  approved questions and counted answers, what an override sends it, the students
  behind it, and whether it has evidence, in words; every counted answer is mapped,
  excluded or unmapped, and the three add up.
- **Roster import from CSV** (`POST /api/classes/:id/students/import`, owner only): a
  file or JSON, at most 1 MB and 2,000 rows; a BOM, CRLF, quoted fields, comma,
  semicolon or tab; the roll number and name columns found by their header. A dry run
  says exactly what would be added and refused (with lines and reasons), the
  duplicates in the file and on the roster, the removed students (reported, never
  restored) and the columns not read (a phone or email column is never read into a
  row). The real import adds through `addToRoster`, which `POST /:id/students` now
  uses too, answering exactly as before.
- `validateRoster` gives each refusal a `code` beside its sentence and takes a
  longer request when the caller says so; the JSON list's reply leaves the code out.
- The room archive is unchanged: no answer stores an outcome, and the class's
  outcomes outlive its rooms (said in `services/archive.js`).
- The boot probe does not check `0019`'s tables, so a server deployed before it keeps
  its rooms on Supabase; only the outcome routes fail.
- Tests: `test/outcomes.test.js` (43), `scripts/outcomes.mjs` (86, added to the
  offline runner), 57 new checks in `npm run migrations` (509 in all). Every earlier
  suite unchanged (`docs/TESTING.md`).
- Docs: `API.md` ("Phase 4" and its open issues), `DATABASE_SCHEMA.md`,
  `ARCHITECTURE.md`, `PRODUCT_DECISIONS.md` (the defaults this part chose),
  `IMPLEMENTATION_STATUS.md` (a Phase 4 checklist), `TESTING.md`.

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
