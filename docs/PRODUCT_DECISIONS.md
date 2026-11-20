# Product decisions

Eight decisions the gap analysis said cannot be assumed, plus one the owner has since made (9). Each has a recommendation,
its consequences, and what waits on it.

**19 November 2026.** The owner delegated the eight ("decide the best outcomes
yourself"). Each is now **decided under the owner's delegation, 19 Nov 2026**, and
each section below says what was decided and what was built. The same batch settled
the two Phase 3 questions ("Phase 3: the two questions, decided" below) and the Phase 2
defaults the owner was asked to look at. Decision 8 is a working posture, **not a legal
decision**: a lawyer must confirm it before any college signs or before 13 May 2027.

The Phase 6 decisions (the student Learning Hub, H1 to H18) were taken under the same
delegation that day. They are recorded from "Phase 6 in brief" on, with a new decision on
the question bank that rooms and the hub share, to be built in batch 8.

Where a decision moved a contract, the contract was amended and the date recorded:
`CONTRACT.md` section 6 rule 1 (decision 1), sections 4 and 5 (Phase 3 question (a):
the phone's row; Amendment 3) and section 6 rule 5 (`source: 'teacher'`). The
amendments the follow-up decisions of that day named were made in the Phase 5 docs
pass (Amendment 5, dated): section 3 (`Question.source` may be `'teacher'`), section 4
(the regenerate row: an active question is retired at the approval), section 5
(`student:join`'s optional `token`; `session:accepted`'s `linked`, `linkNote` and
`confidence`; `student:answer`'s optional `confidence`; the new events `student:vote`,
`class:question`, `class:vote`, `class:closed` and `teacher:class-question`) and
section 6 rule 1 ("No image generation" means image-model output; decision 4 and its
revision). `V2-CONTRACT.md` was read against the decisions and still holds: a profile's
`account_id` is still the student's account or null, guest join still works, and a
student still reads only their own results; it was not changed. Phase 6 made
Amendment 6 (dated): the Learning Hub is an account-only surface outside the frozen room
contract; three new dependencies; the repository's Phase 6 methods (section 2);
`Content.slideTexts` (section 3); the phone's additive `question.rich` (section 5); and
how the hub applies section 6's rules 1 to 3.

The Phase 7 decisions (offline-first, O1 to O5) were taken under the same delegation
that day, and are recorded from "Phase 7 in brief" on, with the defaults chosen and the
items left for the owner. Phase 7 made Amendment 7 (dated): the new socket events and
fields (packs, `server:kept`, `server:refused`, deliver joins) and the
`Idempotency-Key` header.

The Batch 9 decisions (the owner's asks of 20 Nov 2026: E1 to E7) were taken under the
same delegation that day, and are recorded from "Batch 9 in brief" on, with what a
website cannot do, the DPDP note on screen pictures, the defaults chosen and the items
left for the owner. Batch 9 made Amendment 9 (dated): the drawing kind, the written
answer's `length`, and exam mode's socket events and fields.

| # | Decision | Status |
|---|---|---|
| 1 | Generated teaching content in the Hub | **Decided under the owner's delegation, 19 Nov 2026**: as recommended; contract amended; Phase 6's lessons, explanations, hints and translations are built under it |
| 2 | Which mastery threshold is authoritative | **Decided under the owner's delegation, 19 Nov 2026**: as recommended (already built) |
| 3 | Do observations and spoken answers move a level | **Decided under the owner's delegation, 19 Nov 2026**: never (already built) |
| 4 | Does "no image generation" cover plotted diagrams | **Decided under the owner's delegation, 19 Nov 2026**: code-rendered figures allowed; revised the same day: a code-rendered graph question kind is built after Phase 6; contract amended |
| 5 | AI calls for professor-triggered actions | **Decided under the owner's delegation, 19 Nov 2026**: as recommended; Phase 6's AI buttons follow it, and no live chat tutor is built |
| 6 | Six levels or three bands by default | **Decided under the owner's delegation, 19 Nov 2026**: as recommended (server already returns both) |
| 7 | Hub identity: accounts or roll number | **Decided under the owner's delegation, 19 Nov 2026**: rooms account-free; a link only by a signed-in phone (built, `0022`); the Hub needs an account (built, Phase 6, H1) |
| 8 | DPDP role and students under 18 | **Decided under the owner's delegation, 19 Nov 2026, as a working posture. Not a legal decision: a lawyer must confirm it before any college signs or before 13 May 2027.** The under-18 mark is built (`0022`). Exam mode's screen pictures (Batch 9, E5) join the list the lawyer must confirm |
| 9 | What deleting a room does to the evidence | **Decided by owner, 18 Nov 2026** |

---

## 1. May BloomLoop generate teaching content?

**Conflict.** `CONTRACT.md:159` says "No PPT/content generation, ever. Ingest only."
The v4 handoff's Learning Hub shows explanations, worked code and translations, and
the owner asked for students to "learn from scratch".

**Recommendation.** Allow generated explanations only when they are (a) derived from
the professor's uploaded material and cite the slide or line they came from, (b) shown
with an "AI draft" mark until the professor approves them, and (c) never used to
create new syllabus content the professor did not teach. "Learn from scratch" means
starting from the prerequisites of this professor's own material, not open-ended
generation.

**Consequences.** Needs a source-reference field on every generated item (also needed
for questions in Phase 2) and an approval state. Keeps the contract's intent (the
professor's material is the ground truth) while making the Hub possible.

**Waits on it.** Hub steps 9 to 11 (lessons, language switch, tutor).

**Status: decided under the owner's delegation, 19 Nov 2026.** Approved as
recommended. Generated teaching content comes only from the professor's own material
and cites the slide or line it came from; it is marked "AI draft" until the professor
approves it; it never adds syllabus the professor did not teach. "Learn from scratch"
starts from the prerequisites of this professor's own material.

**What was built.** Nothing yet: no lesson generation exists, so there is nothing to
change. `CONTRACT.md` section 6 rule 1 (it read "No PPT/content generation, ever.
Ingest only.") now says exactly the rule above, dated. It unblocks the Hub's lessons
(Phase 6), which must carry a source reference and an approval state as questions do
(`sourceRef`, `approvedBy`/`approvedAt`, `0013`).

**Phase 6 (19 Nov 2026).** Built under this rule: a lesson's text is the professor's own
slide text, cited; its worked examples, the AI's retrieval questions, explanations, hints,
option feedback and translations are AI drafts until the professor approves them; a
lesson made without a model is "slides only". See "Phase 6: lessons and languages".

## 2. Which mastery threshold is authoritative?

**Conflict.** The handoff says "moves up after 3 correct at 60% or more". The engine
promotes at 70% over a five-answer window (`PROMOTE_AT`). Rooms store a mastery goal
of 80, 90 or 100%, which the grid shows at a fixed 80%.

**Recommendation.** Keep these as two different numbers, as `mastery.js` already
documents: **promotion** (what to ask next) stays at 70% over five with three answers
minimum, and **mastery goal** (what the professor signs off as mastered) is the room
setting, 80% by default. Correct the handoff copy to 70%. Do not make promotion a room
setting: one ladder across the department keeps "why did this student get this
question" answerable.

**Safe default in use.** Exactly the above; Phase 0 applies the stored room goal,
reattempts and redemption, which were already validated and saved.

The live view's accuracy bands (Phase 3) add a third number of their own, which is
neither promotion nor the mastery goal: a student is "Excelling" from 60% overall in
the room, the line the handoff's own histogram legend draws ("Above 60%"). "Needs
support" is below 40%, the engine's existing below-40% band. Both are defaults in the
table below; they change no level and no question.

Phase 4's attainment adds a fourth number, again not promotion and not the mastery
goal: the share of the marks a student needs on a course outcome to attain it. It is
part of each class's formula, chosen by the college. The shipped example uses 60%,
named as an example. It moves no level and changes no question.

**Waits on it.** Room settings screen copy, bands, analytics wording.

**Status: decided under the owner's delegation, 19 Nov 2026.** Approved as
recommended: promotion at 70% over a five-answer window with at least three answers
at the level; the mastery goal is the room's setting, 80% by default; the accuracy
bands' 0.4 and 0.6 stay, for display only.

**What was built.** Nothing new on the server: this is how it already ran
(`PROMOTE_AT`, `WINDOW`, `MIN_LEVEL_EVIDENCE` in `services/mastery.js`; the room's
goal; `BAND_CUTS`). The handoff's copy that says "60% / 3" is the client's to correct
(`docs/IMPLEMENTATION_STATUS.md`, client work).

## 3. Do observations and spoken answers move a Bloom level?

**Conflict.** The handoff keeps teacher records separate from accuracy, but its
Analytics view speaks of "evidence from digital answers and teacher records".

**Recommendation.** They never move the working level (the ladder reads digital
answers only), but they are evidence in reports, labelled by type. Attainment reports
show them in their own column with their own count, never blended into accuracy.

**Safe default in use.** Separate. Nothing built so far mixes them. Attendance
(Phase 3) follows it: a mark is its own record, never read by the ladder or by any
accuracy figure. So do the teacher records (Phase 3, `0017`): observations, wheel
picks and their responses, tallies and activities are kept in their own tables,
labelled by type, counted apart, and never read by the ladder; a "Needs revision"
leaves a student's level exactly where it was (`server/scripts/records.mjs`). The
Mixed and Teacher-led modes (`0018`) keep them apart too: the teacher's grid shows the
digital answers and the teacher records under their own labels, never summed, and
nothing a professor records reaches the projector but a pick's roll number and first
name (`server/scripts/modes.mjs`). The live insights follow it too: bands, cards and
KPI tiles are counted from digital answers only, and a Mixed or Teacher-led room's
records come beside them as their own counts (hands raised, answered aloud,
observations by kind), never added in; recording a "Needs additional support" moves
no band, card or tile (`server/scripts/insights.mjs`).

**Waits on it.** Phase 3 observations, Phase 4 attainment. Phase 4's course outcomes
follow the safe default too: teacher records are never mapped to an outcome or counted
in its coverage, which reads digital answers only (`services/outcomes.js`). So does
Phase 4's attainment: a formula cannot count teacher records (asking is a 400), and
every report summarises observations, picks, tallies and activities in a labelled
section of their own that moves no figure (`services/attainment.js`;
`server/scripts/attainment.mjs` records an observation and a tally and checks that
every figure is unchanged).

**Status: decided under the owner's delegation, 19 Nov 2026.** Approved: teacher
records never move a level, and are reported in their own labelled column, never
blended into accuracy. **What was built:** nothing new; the safe default above was
already exactly this.

## 4. Does "no image generation" cover plots and diagrams drawn from data?

**Conflict.** `CONTRACT.md:159` forbids image generation. Graph and pattern questions
for maths need figures.

**Recommendation.** The rule means no image-model output. Figures rendered
deterministically from data (an SVG plot of `y = 2x + 1`, a labelled diagram drawn
from coordinates) are allowed, because they are code, reproducible and checkable.

**Consequences.** Visual questions use code-rendered SVG (Mafs or JSXGraph, both
MIT), never a generated bitmap.

**Waits on it.** Graph, pattern and visual question kinds.

**Status: decided under the owner's delegation, 19 Nov 2026.** Approved: figures
rendered deterministically from data (code-rendered SVG plots and diagrams) are
allowed; image-model output is not. **What was built:** nothing yet. **Built in Batch 8 (`ba0f59d`, 19 Nov 2026):** the
figure engines, five interaction kinds and figure generation ("Batch 8: the visuals
decisions", at the end).

**Revised the same day (about 13:00), under the delegation, when the owner asked again
for "graphical patterns like in maths".** The half that said no graph question kind
would be built is reversed: a code-rendered graph question kind is built as its own
batch **after Phase 6 and before Phase 7**. The rule is unchanged: drawn by code from
data (SVG), never image-model output; generated from the professor's material and
approval-gated like every kind. Candidate shapes: read a value off a plotted graph,
plot points or pick the matching graph, continue a number or shape pattern. The
research behind it, widened by the owner to every subject, is in
`reports/BloomLoop visuals research.md`. `CONTRACT.md` section 6 rule 1 now says what
"No image generation" means and that this batch comes after Phase 6 (Amendment 5's
dated note).

## 5. May professor-triggered actions call a model, given "zero LLM calls in the live loop"?

**Conflict.** `CONTRACT.md:160` says the live loop makes no model calls. Written-answer
marking and the handoff's "AI teaching move" would need one.

**Recommendation.** Keep the rule for anything a student waits on. Allow model calls
only when a professor presses a button (mark written answers now, suggest a teaching
move), run them asynchronously, and never let their result move a level before the
professor confirms it.

**Waits on it.** Phase 1 review queue (AI pre-marking is optional on top of it),
Phase 3 insight cards.

**Status: decided under the owner's delegation, 19 Nov 2026.** Approved as
recommended: model calls only when a professor presses a button, asynchronously,
never in anything a student waits on, and never moving a level before the professor
confirms. **What was built:** nothing new; no such call exists yet. The live loop
makes none (`CONTRACT.md` section 6 rule 2, unchanged), and the keyword marker of
written answers is not a model.

**Phase 6 (19 Nov 2026).** Five new professor buttons call a model, each writing drafts
only: prerequisite proposals, lessons, explanations, translations, and hints with option
feedback. Nothing a student waits on calls one, so the hub's practice loop, Get Ready,
self-tests, lessons and hints need no model key and cost no quota while students use
them. A live chat tutor is not built: it would need this decision reversed ("Phase 6:
owner option, a live chat tutor").

## 6. Six levels or three bands by default?

**Conflict.** The product is built on six levels; raters agree poorly at six
(reliability about 0.25 in one study) and much better at three bands (about 82%).

**Recommendation.** Keep six levels everywhere the student's next question is chosen
and in the professor's detail views. Default class-level summaries and attainment to
three bands (lower: Remember, Understand; middle: Apply, Analyse; higher: Evaluate,
Create), with the six-level breakdown one click away.

**Safe default in use (Phase 3 class analytics).** Both, undecided: every level
figure of `GET /api/classes/:id/analytics` comes as the six levels (`levels`) and as
these three level bands (`levelBands`, `LEVEL_BANDS` in
`server/src/services/classAnalytics.js`), per room and over the window, each with the
answers behind it. Which a screen shows first is the screen's choice, so deciding this
needs no server change. Not to be confused with the live view's three **accuracy**
bands (Needs support, Developing, Excelling), which place a student by accuracy and
are not about levels at all.

**Waits on it.** Phase 3 class analytics (now built both ways), Phase 4 reports. Phase
4's Bloom attainment is built both ways too: per level (`bloom.levels`) and per level
band (`bloom.bands`), with the same rules.

**Status: decided under the owner's delegation, 19 Nov 2026.** Approved: six levels
where the next question is chosen and in detail views; class summaries and attainment
show the three level bands first, with the six one click away. **What was built:**
nothing on the server, which already returns both; which to show first is the
client's (client work). Since the Phase 5 follow-ups (19 Nov 2026) the staff
dashboards and staff analytics send the three bands too (`levelBands`, summed from
their six levels by the same `LEVEL_BANDS`), so no screen sums them itself; a student
reading their own is sent the six levels only.

## 7. Must the Hub require student accounts?

**Conflict.** `CONTRACT.md:161` says joining a room needs no account. The Hub needs an
identity that lasts across rooms and devices.

**Recommendation.** Rooms stay account-free. The Hub requires an account, but a
student who joins rooms with a roll number keeps that history: when a professor's
roster maps a roll number to an invited student account, the room profile is linked
(`profiles.account_id`) and their earlier answers follow them.

**Safe default in use.** Phase 0 links a room profile to a student account when the
room owner has exactly one active student with that roll number; nothing else changes.

**Known gap (19 Nov 2026).** That link rests on the roll number typed on the phone,
with no sign-in. A student who types a classmate's roll number in that professor's
room is linked to the classmate's account, and since Phase 1 the classmate can read
those written answers in their own history (`GET /api/analytics/:id/answers`).
Closing it needs the phone to present a signed-in student's token when it joins,
and the link to be made only from that: a client change, and part of this decision.
Not built.

The same gap reaches attendance (Phase 3): a phone joining a class room with a
roster roll number marks that student present, so a classmate's phone can mark
someone present who is not there. The mark records it as `source: joined`, and every
attendance read carries a sentence saying a typed roll number is not proof of
identity. A professor's own mark always wins. Not solved; it closes with the rest of
this decision.

**Waits on it.** The Hub, cross-room history for students without accounts.

**Status: decided under the owner's delegation, 19 Nov 2026.** Rooms stay
account-free; the Hub requires a student account. The safe default changes to close
the known gap: **a room profile is linked to a student account only when the phone
presents that signed-in student's token when it joins.** A link made from a typed roll
number alone no longer exposes anything in the student's own history. Attendance from
a typed roll number stays `joined`, with the existing sentence.

**What was built** (`0022`; `server/scripts/decisions.mjs` checks it end to end):
- **The join.** `student:join` takes an optional `token`. The server verifies it as
  the student's own routes verify a bearer token (`verifyAccountToken` in `auth.js`:
  Supabase Auth, then the account, which must be active). It links the room profile
  only when the account is a student of the room's owner with the roll number typed
  (compared in the room's form). The profile then carries `accountVerified: true`
  (`profiles.account_verified`). Without a token, or with one that does not
  qualify (expired, another student's, another professor's student, a professor's),
  the phone joins as a guest exactly as before and is told in one sentence that the
  room is not linked (`linked: false`, `linkNote`). A typed roll number never links
  anything. A join without a token never unlinks a verified profile.
- **Each answer.** `answers.account_verified` is true only when the phone that sent it
  presented the token of the account the row is linked to. A classmate typing the roll
  number into a verified room writes rows under that account, unverified.
- **The student's own history.** Every student-facing read of their own history
  reads verified rows only: `GET /api/analytics/:id/answers`, `GET /api/analytics` and
  `/:id` (the timeline, levels and topics), and `GET /api/dashboard`. A profile counts
  only when it is linked to the student and verified; an answer only when it is
  verified. Each carries a sentence (`note`) saying only rooms joined while signed in
  appear.
- **Links made the old way** (from a typed roll number, before 0022) are kept, marked
  unverified by the column's default, and expose nothing to the student. Nothing was
  deleted or rewritten. A professor's reads are unchanged: they see their students'
  answers by account or by unlinked roll number, verified or not.
- **Supports** (accommodations) still follow the typed roll number to the room owner's
  roster, as before, when no sign-in is presented: they change how a question renders,
  reveal nothing and link nothing. A sign-in brings the signed-in student's own.
- Attendance is unchanged: a join from a typed roll number marks `joined`, with the
  caveat.

The phone has to send the token (client work); until it does, no room links, and a
student's own history shows nothing new.

**Fixed under the owner's delegation, 19 Nov 2026 (the Phase 5 review fixes).** A
profile verified by a sign-in can still hold attempts a classmate typed under the same
roll number before or after. Everything a student reads about themself now comes from
their verified answers only, not the profile's totals: inside each linked room, the
history entries whose answer is one of their own verified final rows, with the level
tallies, counts, accuracy, timeline, Bloom tally and history trail counted from those
(`verifiedView` in `services/evidence.js`). The room's working level is not shown to
them when other answers helped set it. The `note` says so. A class question follows
the same rule: a phone not signed in as the student is never sent her vote or her
confidence tap, and its vote stops counting once her own phone has voted in that round
(kept, with a sentence saying why).

**Kept, as a known gap (19 Nov 2026, under the delegation):** supports follow a typed
roll number when no sign-in is presented. Rooms are account-free, so a token cannot be
required for them.

**Phase 6 (19 Nov 2026).** The Hub needs a signed-in student account (H1): a student
reaches a class's hub when the class's owner is their professor and its roster holds
their roll number, not removed. A room phone with a typed roll number reaches nothing
there, and only a student's verified room answers enter their hub error log (H7).

## 8. DPDP Act: processor or fiduciary, and students under 18

**Conflict.** From 13 May 2027 the Act's notice, consent, children's-data and rights
provisions apply. Some first-year students are under 18. It is not settled whether
BloomLoop acts for colleges (a processor under a contract) or decides purposes itself
(a fiduciary).

**Recommendation.** Operate as a processor for each college under a data-processing
agreement; the college is the fiduciary that gives notice and collects consent. Build
the technical pieces the college will need: notice text per institution, consent and
withdrawal records, export and deletion of one student's data, retention limits, an
audit log of who read whose records. Do not enable behavioural signals (integrity
events) for students marked under 18 until a legal opinion says the education
exemption covers them.

**This needs a lawyer.** Technical controls do not make the product compliant on
their own, and nothing here should be presented as compliance.

**Waits on it.** Sign-up, notices, integrity signals for minors, contracts.

**Status: decided under the owner's delegation, 19 Nov 2026, as a working posture.
This is NOT a legal decision. A lawyer must confirm it before any college signs and
before 13 May 2027.** The recommendation is adopted: BloomLoop operates as a processor
under a data-processing agreement with each college, the college being the fiduciary
that gives notice and collects consent. The notice, consent, export, erasure,
retention and audit pieces are built when the Hub gets accounts; erasure must include
room archives (decision 9).

**What was built now** (`0022`; `server/scripts/decisions.mjs`):
- **An optional "under 18" mark on a roster student** (`class_students.under_18`,
  boolean, default false; `under18` on every roster row a teacher's screen gets). Only
  the class's owner sets it: through the student edit (`PATCH
  /api/classes/:id/students/:studentId` with `under18`), in a pasted list, or from a
  CSV import whose file has an `Under 18` (or `under18`, `minor`, `below 18`) column,
  read as yes or no. A row that says anything else is refused with a reason. No date
  of birth is read or kept; a date-of-birth column stays unread, as every other column
  does. An import only adds, so a student already on the roster keeps their mark, and
  the reply says so when the file disagrees. Each reply that sets the mark carries the
  sentence that this is a working default and a lawyer must confirm it.
- **Integrity signals are neither recorded nor shown** for a room profile tied to such
  a student. Tied means a room opened for the student's class, under the roll number
  the roster holds for them, or under one an attendance mark of that room was made
  under for them (`0021`). Recorded: none of the browser's reports, too-fast,
  second-socket or level-jump is written to their profile (checked when a signal is
  about to be recorded, so other rooms pay nothing). Shown: the teacher's grid row
  carries `integrity: null`, the signal trail is empty with `signalsOff: true`, the
  room's CSV leaves the cell empty, and a deleted room's archive keeps none. Signals
  recorded before the mark was set are shown nowhere from then on; they stay in the
  stored profile until the room is deleted (its archive drops them).
- A room opened **without a class** has no roster to read, so the mark cannot reach
  it: signals there are recorded as before. Opening rooms for the class is how the
  mark applies (open, `docs/IMPLEMENTATION_STATUS.md`).

**Phase 6 (19 Nov 2026).** The Hub now holds student-account data: hub attempts, the hints
a student opened, Get Ready checks and self-tests, goals and their language choice. Each
is deleted with the student's account, while room answers keep their roll number; the
legal review should confirm this. None of the notice, consent, export, erasure, retention
or audit pieces above was built in Phase 6 (open items, "Phase 6: open items for the
owner").

**Batch 9 (20 Nov 2026).** Exam mode (E5) can take low-resolution pictures of a laptop's
shared screen. **Screen pictures are personal data under the DPDP Act, and join this
decision's list: a lawyer must confirm them before any college signs or uses them.**
Until then the server keeps them as narrowly as it can: in memory only, the newest per
student, to the room's staff only, purged two hours after the room closes (or after
arrival, whatever the room's state), at once when the room is deleted, and on any
restart; never in a table, the archive, the CSV or any export. Students marked under 18
are asked for no fullscreen, screen share or picture, and no exam signal is recorded or
shown about them. A room opened without a class has no list to mark anyone under 18,
so it cannot ask for fullscreen, screen sharing or pictures at all. The phone shows a
consent notice before joining an exam room, and a phone already in a room when exam
mode is turned on is recorded as before until it says it has shown the new notice.
Whether that notice is enough consent, and who gives it (the college as fiduciary), is
for the lawyer.

---

## 9. What deleting a room does to the evidence

**Conflict.** The directive says never discard responses. The existing room delete
(typed code to confirm) removed the room, its profiles and its answers for good.

**Owner's decision (18 Nov 2026), in his words:** "just save the room and other data
in the form of json format so it is less than even 1mb".

**What was built.** `DELETE /api/session/:code` first writes the whole room (room,
settings, every profile and history entry, every stored answer with the question as
shown) to `room_archives` as one compact JSON document, then deletes the live rows.
If the archive cannot be written, or would be over 1 MiB, nothing is deleted (413).
Teachers can list archives of rooms they may read and download each as a `.json`
file. Details in `docs/DATABASE_SCHEMA.md` (`room_archives`).

**Consequences.** Deleted rooms leave every screen and report but their evidence is
kept. That makes a deleted room personal data that is still held: a real erasure
request under the DPDP Act (decision 8) must also remove the archive, and there is no
route for that yet. Recorded as a follow-up; it needs the retention rules from the
legal review before it is built.

---

## Defaults chosen during implementation

Smaller choices made so work could proceed. Each is reversible.

The Phase 3 defaults the owner is most likely to want to look at, each a row of the
table below: the three accuracy bands' cut points and the
fewest answers for a band; "Absent" on a wheel pick; the attendance rules (what
"N / M present" counts, a join against the professor's mark, "joined present, the
rest absent", a list with one bad row, a closed room); what puts a room in the
waiting room, and starting it; the projector token rules, and a bank question's key
on the projector; when a dismissed card comes back ("its evidence changes"); the KPI
series and how it is sampled, and "since the start"; and six levels with three level
bands side by side while decision 6 is open.

| Choice | Default | Where |
|---|---|---|
| Definition of the `level-jump` signal (declared, never defined) | Recorded when a student's last five graded answers in a room are all right straight after five or more of which at most one was right. Shown as something to look at, not a finding | `server/src/services/integrity.js` |
| Dyslexia-friendly typeface | Atkinson Hyperlegible (OFL), plus wider letter, word and line spacing | client |
| Self-hosted fonts | Fontsource packages for Geist, Geist Mono, Noto Sans Devanagari (all OFL 1.1) | client |
| Migration test database | PGlite (Apache 2.0), a dev-only dependency | `server/scripts/` |
| What a professor's review of a written answer does to the student's numbers | The machine's provisional mark counts the moment the answer arrives. A review changes the matching history entry (found by `answerId`) to the reviewed mark, marks it `review: confirmed` or `overridden`, and moves the level's `correct` tally by the difference (`seen` never moves), so the grid, analytics and the CSV all show the human decision. The working level is **not** rewound: decisions already made stand, and the ladder's next decision reads the corrected history. In a room with redemption, that level's pairings are redone by the room's own rule so no answer set aside is a right one. The live grid is pushed to anyone watching the room. **This differs from the roadmap** (step 1: "keyword marks stop moving levels until confirmed"). It was chosen so a class never waits on a professor; the owner should say which is wanted. Switching for future answers needs no data change. Rooms already run keep the levels that were decided with the provisional marks counted | `applyReview` in `server/src/services/mastery.js`; `server/src/routes/review.js` |
| The mark an override sets | Send `correct`, `score`, or both. `score` alone: right if score is at least 0.7 (`PASS_MARK`, the rubric matcher's own bar). `correct` alone: score 1 or 0. Both: taken as given, so a professor can give partial credit they still count as right. A `confirm` keeps the machine's mark and a confirm that also sends a mark is refused (400) | `server/src/routes/review.js` |
| Sending the same review twice | A decision already in force (same status, same mark, same note) writes nothing: no log row, no change. Anything that differs, the note included, is a new decision and is logged. The profile is checked either way, so a review whose profile write failed is finished by sending it again | `server/src/routes/review.js` |
| What can be reviewed | Final written answers (`kind = 'open'`) only. Other kinds answer 400. A written attempt followed by a retry never counted, so it answers 400 too and stays out of the queue | `server/src/routes/review.js` |
| What a student sees of their own past answers | The question as their phone showed it (rebuilt from the snapshot by `forStudent()`, same seed), their response, `correct` and `score` in force, the review status, note and date, attempt, final, room and time. Never the snapshot, any answer key, rubric or model answer, the solution, `auto_*`, or `detail` (the machine's reading in words, which on an overridden written answer would contradict the mark). Built field by field, so a new column stays hidden until added on purpose. This rule is for this read of stored answers; the live phone has its own (next row) | `redactForStudent` in `server/src/services/evidence.js` |
| What the live phone is told when an answer is final | The mark, and the solution to the question it has just finished: for a written answer that is the rubric, which the phone shows as "Points a full answer makes". So a student does see the rubric of a question they have answered, once, at that moment, as every kind shows its answer then. The machine's `detail` is sent only while the machine's mark is the one in force: a resend after a professor's override gets none, since "1/2 rubric points" beside the professor's mark contradicts it. The stored-answer read above never re-serves any of it | `server:result` in `server/src/sockets/index.js` |
| Who reads the professor's review note | The student. It is shown word for word beside the mark in their answer history. It is a comment to the student, not a private remark, and the screen that takes it must say so. A private note would need its own field; not built | `server/src/routes/review.js`; `redactForStudent` |
| Which answers are "this student's" across rooms | Rooms owned by the professor they report to (the analytics scope). For the **professor** reading a student: rows linked to the student's account, plus rows under their roll number linked to no account. For the **student** reading themself: rows linked to their account only, because a roll number is typed on a phone with no sign-in, so an unlinked row under it may be a guest's, a mistyped classmate's, or a second account's whose roll number differs only in case; **and since decision 7 (19 Nov 2026) only rows a phone signed in as them sent** (`accountVerified`, `0022`), so a link made from a typed roll number exposes nothing. A row linked to a **different** account is never theirs. Roll numbers are compared upper case and single-spaced, as the room stores them, and since `0011` two accounts in one department cannot hold the same roll number in that form | `listStudentAnswers` in `server/src/services/evidence.js`; `listAnswers` `student` filter in all three repos; `studentScope` in `server/src/services/analytics.js` |
| A phone that sends no answer key | The key is derived from the roll number, the question and the answer. It used to leave out the roll number, so two students giving the same answer to the same question shared one row and the second was never stored. A key that another student's row already holds is filed under `<key>@<roll number>` and never answered from that row | `handleAnswer` in `server/src/sockets/index.js` |
| Paging the review queue | By cursor: each page's `next` goes back as `?before=`. `offset` is refused with a 400, since reviewing answers takes them out of the default view and an offset then skips the ones that move up | `server/src/routes/review.js` |
| Writing into a room while it is deleted | Refused. The delete marks the room, waits out any write already under way, archives, deletes. A review sent meanwhile gets 409 ("Nothing was changed"); a live answer gets the phone's "did not save" notice and is resent, which a deleted room then answers as closed | `holdRoomForDelete` in `server/src/sockets/index.js`; `DELETE /api/session/:code` |
| Who may list a student's answers | Exactly whoever `subjectsFor()` lets see that student, as for the analytics detail: their professor, and the student themself. An HOD's subject list holds professors, so an HOD gets no student's answers (a professor's id answers 400; anyone outside the list, 404) | `answersFor` in `server/src/services/analytics.js` |
| Where topic numbers come from | Final, graded answer rows (retried attempts and polls left out). A history entry with no `answerId` predates the answers table and is counted from the profile instead; every later entry has a row, so nothing counts twice. Each report names its `source`: `answers`, `history`, `mixed` or `none`. Answers with no topic are counted as `untagged`, not as a topic. The professor-level topic list (still read from history) now skips polls too; before, a poll counted as a wrong answer on its topic | `server/src/services/evidence.js`; `topicBreakdown` in `server/src/services/analytics.js` |
| What happens to a generated question (Phase 2) | Saved as a `draft`, which no room serves, until a professor approves it (one, or every draft in a bank). Drafts, offline-template ones included, all wait: the roadmap's "kept out of rooms until approved" draws no line between the model and the templates. A room on a bank with fewer than 6 approved questions and some drafts is refused with 409 and a sentence saying to approve them | `routes/generate.js`; `routes/bank.js`; `POST /api/session` |
| Failing rule checks | Advice only. Approval is allowed whatever they say; the reply to approve and approve-all names each failed check. The longest-option check fires only when the answer is over 20% longer than every wrong option, because "strictly longest" fires on a quarter of honest four-option items by chance | `server/src/services/checks.js` |
| The older "restore" on a draft | `PATCH status: active` (the console's restore) and bulk restore are kept. On model output nobody approved they are the approval and record `approved_by`/`approved_at`; on every other question they are the plain status change they were. So no route makes model output active without an approval on record | `activatePatch` in `services/edits.js` |
| A plain regenerate | **Settled 19 Nov 2026 (owner's delegation): the old question keeps serving until its replacement is approved.** The new item is a draft naming the active question it replaces (`replacesId`, `questions.replaces_id`, `0022`), and the reply says the old one stays in rooms (`replaces`, `note`). Approving the draft by any route (approve, approve-all, the older restore by `PATCH status: active` or bulk restore) retires the old one, set discarded, and the reply names it (`retired`); rejecting the draft leaves the old one as it is. A draft or rejected question being regenerated is discarded at once, as before, since it served nothing. Before: the old question was discarded at once and its slot left rooms until the replacement was approved | `POST /api/bank/question/:id/regenerate`; `retireReplaced` in `routes/bank.js` |
| A replacing generate while a room runs (Phase 2 review) | Refused with 409 while a room on the chapter is open or paused, before anything is generated. Replacing deletes the approved bank the room is serving and writes only drafts, so every phone in it would get "nothing left". `mode: 'append'` is still allowed. Before the approval gate the replacements were active, so this was never an issue | `POST /api/generate` |
| Harder / Easier | A new draft one level up or down at that level's default kind (so Create is always a written answer), same topic and slides; the original is untouched. Refused at the ends of the ladder and on a poll | same route, `direction` |
| A professor's own question | Created active. Any kind **at its own level** (the editor's rule: the level chooses the kind), except a poll, which may sit at any level. `model` null, `created_by` the account. **`source` is `'teacher'` since 19 Nov 2026** (owner's delegation; `CONTRACT.md` §6 rule 5 amended; `0022` widened `questions_source_check`), and every answer to it carries `question_source: 'teacher'`. Questions written before then stay `'fallback'`: not rewritten, because they cannot be told apart with certainty from a split or merge of an offline-template question older than `0013` (both have no model and a creator). A merge takes the least model-like source of its two parents: template, else the professor's, else the model's | `POST /api/bank/:contentId/questions`; `authorQuestion`, `mergeQuestions` in `services/edits.js` |
| Slide reference | The slides the question's **topic** was read from, not the sentence the item was built from: the generator works from the topic's part of the whole chapter, so the topic's slides are what the source supports honestly. Kept on the content at upload (`topic_slides`), because the deck is discarded | `topicSlides` in `services/extract.js`; `sourceRefFor` in `services/generate.js` |
| Split, merge and edit of a draft | Stay drafts. A **rejected** draft (discarded, model set, never approved) counts as a draft here: its halves, and a merge with it on either side, are drafts with no approval, and one parent's approval is never copied onto the other's unreviewed text. An edit of an active question stays active and keeps its approval | `unreviewed`, `inherit` in `services/edits.js` |
| `npm run seed` | Still writes active questions (it is the demo bootstrap and opens its room straight from the repository), now with `model` recorded | `server/src/seed.js` (unchanged) |
| How a level is divided over its kinds by default (Phase 2) | Remember mcq 2 : true/false 1; Understand match 1 : categorise 1; Apply blank, cloze, dropdown, table 1 each; Analyse multi, hot text, grid 1 each; Evaluate order 1 : rank 1; Create written answer only. Left out on purpose: numeric (a chapter with no figures would push the model into inventing one) and categorise at Analyse (Understand already asks it). Each level's first kind is its default, so regenerate, Harder and Easier still get it. The mix never changes how many questions a topic or a level gets. A teacher's `kinds` (one kind) or `kindMix` (weights) replaces it per level | `DEFAULT_KIND_MIX` in `server/src/questionTypes.js`; `planBank` in `services/plan.js` |
| No selected-response kind at Create | Refused wherever a kind is chosen (plan, generator, the model's output), not only advised by the rule check. Today Create's set holds only the written answer, so this refuses nothing yet; it stops a wider set from ever putting an mcq under a Create tag. The report's rule that "the format only limits the level" is applied as each level's own set of kinds: no kind was added to a level's set | `kindAllowedAt` in `services/plan.js` |
| What a shared reading may be asked as | Only the kinds the plan asked of that level. A passage is short; on a level with one question it used to turn the plan's "Rank them" into the "Put these in order" the passage happened to carry, every time | `fallbackForTopic` in `services/generate.js` |
| A model item whose kind the plan did not ask | Where the plan asks a level as one kind, the item is judged as that kind whatever it claims (as before). Where it asks several, an item declaring another is refused, not guessed at, and the slot is asked for again or filled by a template | `validateItems` in `services/generate.js` |
| What the four new offline templates ask | Hot text: pick every word naming a term the source defines outright ("X is ..."). Dropdown: the cloze line with each gap offering the right term and terms the line never mentions. Table and grid: whether the source discusses a term alongside an idea, meaning the two are in one sentence, the rule the categorise template already used. Each is checkable by reading the source; none is a claim about what a term *is*. The table's given column quotes a source line; it does not use the miner's gloss, which can come from a line about something else ("connection" inside "connectionless") | `buildNonMcq` in `services/generate.js` |
| Who may load an uploaded image (Phase 2) | A teacher who may read its chapter, always (`x-teacher-key`, `?key=` or a bearer token). Anyone else only while a room on the chapter is running (open or paused) **and** an approved question of that chapter shows the image; otherwise 404, the same as an id that does not exist. Chosen over a bare unguessable url (which would work for anyone with the link, for ever) and over signed urls (which expire inside the answer snapshots and the year-long cache, and need a secret that survives restarts). The phone carries no credential, so the rule ties the image to the question rather than to the student: it is served exactly while some phone could be shown it. Ids are random as well (a uuid on Supabase, 96 random bits elsewhere; Mongo's default ObjectId, a timestamp and a counter, is replaced). Cost: a student reviewing an answer after the class sees the alt text instead of the picture, which the phone already shows for an image that fails to load | `servedToPhones` in `server/src/services/media.js`; `GET /api/media/:id` |
| What an upload may be | PNG, JPEG or WebP, told by the file's first bytes; the name and the browser's type are ignored, so a PNG called `photo.jpg` is stored as the PNG it is and a page of script called `photo.jpg` is refused. SVG is refused outright: it can carry script. At most 500 KB (`config.media.maxBytes`, env `MEDIA_MAX_BYTES`): every phone downloads it over the same hall wifi. A description (`alt`) is required at upload and copied onto each question that shows the image without its own | `server/src/routes/media.js` |
| Where uploads are kept | In the database (`media.data`, bytea), not on disk or in a storage bucket: that is what lets Supabase, Mongo and the in-process store all take uploads with no new service. Bytes are written once (the database refuses a change), because phones cache each url for a year. No route lists, changes or deletes an upload yet | `supabase/migrations/0014_media.sql` |
| Which questions may show an upload | Only questions of the chapter it was uploaded to. Another professor's upload, a missing one and one from the caller's own other chapter are one 404. A url is judged by where a browser would send it (dot segments, percent-escapes, repeated slashes, case), not by its text, so `/api/./media/<id>` is checked like `/api/media/<id>` (Phase 2 review; such spellings used to be stored as given). A url resolving under `/api/media/` on **any host** counts as ours: this server answers to names it cannot list (its own host, a custom domain, a tunnel), and another site's image at exactly that path is refused with them, which costs nothing real. A site-relative url anywhere else under `/api/` is refused: nothing there is an image | `withUpload`, `pointsAtMedia` in `server/src/services/media.js` |
| Metadata inside an upload (Phase 2 review) | Taken out before the file is stored, without decoding the picture (the server has no image library, and none was added). JPEG keeps JFIF, the ICC profile, Adobe's segment and everything that is not an APPn; Exif, XMP, IPTC, MPF, comments and whatever follows the end of the image go. The Exif **orientation** is written back alone, because without it an upright phone photo shows on its side. PNG loses `eXIf`, `tEXt`, `zTXt`, `iTXt`, `tIME` and anything after `IEND`; WebP its `EXIF` and `XMP ` chunks and anything after the container. Why: an upload reaches every phone in the room and anyone a student passes the url to, and a phone camera writes where the photo was taken. A file that cannot be walked keeps the rest as sent from where it stops making sense: refusing it would refuse pictures browsers draw, and camera files walk. Uploads stored before this keep their bytes (no data migration) | `withoutMetadata` in `server/src/services/media.js`; `POST /api/media` |
| How several questions share a passage or image | Each question carries an equal copy, never a reference to a shared row: a question is served, snapshotted into the evidence and archived on its own, and a passage edited later must not change what answers already given were answers to. The offline generator already wrote its shared readings this way. One press attaches the same stimulus to many questions (`POST /api/bank/bulk`, `action: 'stimulus'`); sending it again with an edited passage changes them all. Questions sharing a passage are the ones whose stimuli are equal | `POST /api/bank/bulk` |
| A passage's source | Optional `sourceRef` on the stimulus: text the professor types (a textbook and chapter, a slide range), at most 300 characters, also accepted on an image. Teacher-side only: the phone has nowhere to show it, so `forStudent()` leaves it out | `stimulusReason` in `server/src/questionTypes.js` |
| The slide-only check with a stimulus | **Settled 19 Nov 2026 (owner's delegation): an attached passage clears it, as the original task asked.** It passes when an image or a passage is attached, whatever the stem names, and fails a stem naming a figure, diagram, graph or coloured curve, or saying "as shown above" or "on the slide", with nothing attached; the message now says a picture or a passage would do. Before: a figure reference with only a passage attached still failed | `slideOnlyReference` in `server/src/services/checks.js` |
| Options "as shown" with the fewer-choices support | Recorded, not yet shown. Since the item statistics, the live loop keeps which options the support left on the answer's snapshot (`shownOptions`, original indices in shown order; no column needed, it is part of "the question as answered"), because it depends on the student's supports at serving time, which can change. The item report reads it. The answer read still lists an mcq or multi in full for such a student, with their response a position in the shorter list; reading `shownOptions` there is a small follow-up. Answers stored before this have no record. In a deleted room's archive it sits on the answer row, not in the archived question, so a question is stored once however many such students answered it | `snapshotOf` in `server/src/sockets/index.js`; `shownQuestion` in `server/src/services/evidence.js`; `buildRoomArchive` in `server/src/services/archive.js` |
| What an answer's snapshot leaves out (Phase 2 review) | `checks` (advice, not what was asked) and, since the review, `approvedBy` and `approvedAt`: they describe the bank's row and change without the question changing (an older question approved during a class), so kept they made one unchanged question look like two versions in the item report and two copies in the archive. `model`, `sourceRef` and `createdBy` stay: they say where the question came from and never change on a row. Answers already stored keep what they have | `snapshotOf` in `server/src/sockets/index.js` |
| What item statistics count (Phase 2) | Final, graded answer rows only, with the mark in force (a professor's review included). A retried attempt, a poll and a room older than the answers table count for nothing; that room's history has no responses, so it could give a proportion but never a count per option. A second final row for the same student and question (possible only after a failed profile write) replaces the first | `gradedAnswers` in `server/src/services/itemStats.js` |
| Who is "a student" in item statistics | A roll number **in a room**. Across a bank's rooms the same roll number is counted as two students, since two sections may both have a `21CS01` and an unlinked roll number proves nothing about a person | `studentOf` in `server/src/services/itemStats.js` |
| The point-biserial's "total" | Each student's **mean** mark (0 to 1) over their **other** graded answers in the same room: the rest score, not the total. With ten questions the total is a tenth this very question, which pulls every item's figure up, a wrong key's included; and a count of right answers would measure speed, since an adaptive room gives a quick student more questions. Students with no other answer are left out | `pointBiserial`, `itemFor` in `server/src/services/itemStats.js` |
| The point-biserial's floor | 10 students (with another answer to compare). Its standard error is roughly (1 - r^2) / sqrt(n - 1): a third at 10 students near zero, a half at 5, so under 10 the sign is close to a coin toss. Higher would be safer and useless: an adaptive room shows each question to part of a 30 to 60 student class, so a floor of 30 would withhold it from almost every question. At 10 to 20 it is still rough, and the flag is worded as a reason to look | `MIN_STUDENTS_FOR_PB` |
| The negative point-biserial flag | Raised at any value below 0, as asked. At 10 to 20 students a slightly negative figure can be chance; the message says to check the key first, then the wording, and is never a finding. Owner may want a margin (say below -0.1) | `NEGATIVE_POINT_BISERIAL` |
| The difficulty band's cut points | Easy at a proportion correct of 0.8 or more, hard below 0.4, medium between: the product's own numbers, the room's default mastery goal (`DEFAULT_MASTERY_GOAL`) and the ladder's demotion line (`DEMOTE_AT`), so the band says what the grid and the ladder already say. No band under 5 answers, the ladder's own window (`WINDOW`). Fixed, not per room: a bank's report pools rooms that may have different goals. "For this class": an adaptive room shows a question to the students the ladder thought ready for it | `EASY_AT`, `HARD_BELOW`, `MIN_ANSWERS_FOR_BAND` |
| Which options are counted | Kinds where the student chooses among offered options: mcq, multi, true/false, hot text, dropdown (per gap), match (per left item), categorise (per item), grid (per row). Not typed answers (blank, cloze, numeric, open, table) nor arrangements (order, rank), where an arrangement is one answer among many and not a choice of options. Labels and keys are the last version answered; answers to an earlier version whose options differ, in number or in wording, are kept out of the counts (`otherVersions`) but still counted as attempts. Matching on the number alone (until the Phase 2 review) put right answers to a reworded list on whatever option now sat at their index. A key moved over the same options is not a difference: every pick stays on the option it was. `versions` compares what was asked (wording, level, kind, the kind's fields) and nothing else, so the model, slides, approval and a shorter list never make a version | `choiceRows`, `distributionOf`, `versionOf` in `server/src/services/itemStats.js` |
| A room's question set (Phase 2) | Optional, chosen when the room opens, never changed afterwards (like the settings: what a room could serve is part of what its answers mean). Every id must be an approved question of the room's chapter. No floor of 6 for a set: the floor stops a whole-bank room adapting over too little, and a professor who picks two questions has decided the room is those two. A question discarded later stops being served; one deleted later (a replacing generate, which since the Phase 2 review waits until no room on the chapter is open or paused) leaves the set shorter; a question approved later does not join it | `questionSetFrom` in `server/src/routes/session.js`; `servableFor` in `server/src/services/selector.js` |
| Who sees a room's set | The teacher's routes (`POST /api/session`, the room list, `/items`). Not the phones' `GET /api/session/:code`, which anyone with the code can read: a list of question ids is a list of things to try answering, since the live loop accepts an answer to any question the room may serve. Its `bankCount` is the set's servable size instead | `GET /api/session/:code` |
| What a roster holds (Phase 3) | A roll number and a name per student, and since 19 Nov 2026 the owner's yes-or-no "under 18" mark (decision 8; `under_18`, `0022`). Any other field sent is dropped and named back; a name holding an `@` or six or more digits is refused as probably carrying an email, phone number or date of birth. The table has no other column, and the migration test fails if one is added | `services/roster.js`; `0016`; `0022` |
| Which roll numbers are one student | Those equal in the room's form (trimmed, single-spaced, upper case: `rollKey`), as the live loop compares them. `03` and `3` are two students, because the room treats them as two; stripping zeros would mark the wrong student present | `rosterRoll` in `services/roster.js` |
| Removing a student | Soft: `removed_at` is set and the row stays, so their answers (under their roll number in each room), attendance and record are kept and they can be restored as the same row. Adding a removed student's roll number again is refused with "restore them instead", since a second row would split their history | `routes/classes.js` |
| Class size, and the cap | The roster now, removed students left out. At most 500 students per class and per request (far over a section; the most profiles one room's grid reads back from Supabase) | `MAX_CLASS_SIZE` |
| Who may open a room for a class | Only someone who may change the class (its owner, or the shared key for an unowned one). Any other class is the same 404 as one that does not exist. An HOD may not create a class, as they write nothing | `POST /api/session`; `POST /api/classes` |
| What "N / M present" counts | N: present **and late**, since a late student was there. M: the class size now. A student nobody marked is `unmarked`, never counted as absent | `attendanceReport`, `presentCount` |
| A join and the professor's mark | A join marks a roster student present only when they have no mark; the professor's mark (any status) is never replaced by a later join or a rejoin. A student marked absent who joins later stays absent and shows `joined: true`, for the professor to correct | `markJoined`; `addAttendanceIfAbsent` |
| "Joined present, the rest absent" | Students already marked by hand keep that mark (someone marked late stays late); every other student on the roster is marked present if a phone joined with their roll number, absent otherwise, as the professor's marks. The alternative, overwriting hand marks, would undo a correction the professor just made | `marksFromJoins` |
| A list of marks with one bad row | Refused whole (400), nobody changed, so a professor never has to work out which half went through | `marksFrom` |
| Attendance on a closed room | Allowed: attendance is often corrected after the class. Refused while the room is being deleted, as for reviews | `POST /api/session/:code/attendance` |
| Where roster names and attendance appear | The teacher's routes and the teacher's grid only. Never in a phone payload or `GET /api/session/:code`: a phone told the real name behind the roll number it typed would turn the projected room code into a class-list lookup. `rosterName` is added to the teacher's grid after `buildGridRow`, which also feeds the phone | `classGrid` in `services/roster.js` |
| A roll number change on the roster | Allowed (typos are common). The student's attendance follows (it points at the row); rooms already run keep the roll number the answers were given under, so the grid of an older room no longer names that row | `PATCH /api/classes/:id/students/:studentId` |
| Which day an observation belongs to (Phase 3 records) | The day its room was opened, in India's time (UTC+5:30, fixed: India keeps no daylight saving), so a correction made the next morning is still that class meeting's. A room left open past midnight writes under its first day | `roomDay` in `services/records.js` |
| "One per student per class per day" | Kept by reading, not by overwriting: every set and every clear is a row (append-only) and the mark in force is the latest, so nothing a professor saw is lost. In a class room the slot is the roster student's day, so two rooms of one class on one day share one mark; in a room with no class, the room's roll number. The same mark and note again writes nothing | `observations` (`0017`); `POST /api/session/:code/observations` |
| Who an observation may be about in a class room | A student on its roster now. A phone off the roster, or a removed student, is refused with "add them to the roster first": the record is kept per class student | `observationSubject` |
| A note on an observation or an action | At most 280 characters, staff-only. Refused when it holds an email address or an Indian mobile number (ten digits from 6 to 9, spaced or not, `+91` or not), the usual way what a roster must not hold arrives. Narrow on purpose: a note may name a roll number, and many roll numbers are long runs of digits | `noteFrom` |
| Who is "present" for the wheel and the tally | A class room: a roster student marked present or late (unmarked is not present; a phone off the roster has no attendance, so it is not on a present-only wheel). A room with no class has no attendance, and every phone that joined counts | `roomPeople` |
| The wheel's defaults | Present only and no repeats, both on, as in the handoff. Round 1 begins at the first draw or settings change | `DEFAULT_SETTINGS` in `services/wheel.js` |
| "N picked of M" | M: who the settings allow now, repeats ignored. N: how many of them have had a turn this round. A student picked and then marked absent leaves both, so the figure never says "1 picked of 2" for someone no longer on the wheel | `wheelPool` |
| **"Absent" on a wheel pick** (asked to decide) | **Also marks the student absent in that room's attendance**, as the professor's mark, unless the request sends `markAttendance: false`. Only in a class room, for a student on its roster now; otherwise the reply says why nothing was marked. Changing the response away from Absent later does **not** change attendance back: attendance is its own record and is corrected on its own screen. Why: a present-only wheel draws from students marked present, so a professor saying "absent" means that mark was wrong; leaving it would keep the student on the next round's wheel and in "N / M present". The other way (opt-in) leaves those two wrong until someone notices | `PATCH /api/session/:code/wheel/picks/:pickId`; `markPickAbsent` in `routes/records.js` |
| What a closed room takes | Observations, pick responses, tallies, activities and insight actions: records are often completed after the class. Not a draw, a new round or a wheel setting (409): there is nobody left to call on | `routes/records.js` |
| A tally's question | Its text is always stored, copied from the bank when a question of the room's bank is named, so a later edit or delete of that question does not change what was asked. A bank mcq also brings its options as labels and its key as the correct option, unless they are sent | `POST /api/session/:code/tallies` |
| Hands per option | Never below 0: a decrement at 0 changes nothing and says so (`clamped`), and the database refuses a negative count. At most 1000 per option. "N of M present responded" says in words when nobody is marked present, or when there are more hands than students present (usually attendance not yet taken) | `stepTally`, `tallySummary` |
| A quick knowledge check | Is a tally. Its activity row may point at the tally (`tallyId`); the tally is not made for it automatically | `room_activities.tally_id` |
| What an insight action holds | The flag's id as the Insights work names it, `dismissed` or `acted`, a note, who and when. Append-only: a later action is a new row | `insight_actions` |
| A pick on the projector | A roll number and a first name (`pickForProjector`), put up by every draw, or the roll number alone with the names toggle off; no status, ask, score or observation. Nothing else in the record store reaches the projector except a question asked aloud the professor puts up (its text and options, never its hands) | `services/wheel.js`; `services/projector.js` |
| Room settings' defaults (Phase 3 modes) | Each of `mode`, `adapt`, `startLevel`, `questionsPerStudent`, `timePerQuestion` defaults to how every room ran before (Student devices, adapting, from Understand, no cap, no time), so a caller that sends none gets the old room. Written once at opening, like the mastery settings. Ranges: 1 to 500 questions (the handoff offers 3 to 30), 10 to 600 seconds (it offers 30, 60, 90); any start level of the six (it offers the first three) | `sessionSettings` in `services/mastery.js`; `0018` |
| **Adapt off and the below-40% ceiling** (asked to decide) | "Adapt off" stops the ladder (nobody is promoted or demoted, answers still recorded), but **the ceiling still applies**: a student inside the below-40% band is served Remember and Understand only, whatever the start level. `CONTRACT.md` section 6 rule 4 says the ceiling is real, and the contract wins over the task's "students stay at the start level". The working level shown stays the start level and the reason sentence says both things | `applyAnswer` (`adapt`) in `services/mastery.js`; `selectNext` unchanged |
| What questions per student counts | Questions finished (one history entry each, polls included), so a question still being retried is under the cap. At the cap the phone gets `server:exhausted` with a reason, and an answer to a question it was never served is refused the same way; a resend of the answer that reached the cap is still answered from what was stored | `dispatchNext`, `handleAnswer` in `sockets/index.js` |
| Time per question | Sent to the phone; never enforced. A late answer is taken and marked like any other (phones on hall wifi are late through no fault of the student's), and the answer row's `servedAt` and `answeredAt` already say how long it took. Nothing extra is stored | `dispatchNext` |
| **What puts a room in the waiting room** | Only the professor asking for it when the room opens: `lobby: true` on `POST /api/session`. Left out (the default), a room opens `open` and serves at once, as every room did before, so no existing caller meets a waiting room it did not ask for. It is a status (`waiting`, `0018`), not a setting: written at opening, moved to `open` only by the start, and a waiting room can still be closed or deleted. Any mode may wait; a Teacher-led room that waits starts with no phone joined. A room is never put back into waiting, and nothing (a time, a count of phones) starts it by itself: the professor starts it | `POST /api/session` (`lobby`); `routes/session.js` |
| Starting a waiting room | `POST /api/session/:code/start`, a REST route like pause and close, not a teacher socket event. A Student-devices or Mixed room nobody has joined cannot start (409): the handoff's Start button is disabled until someone has (`canStart`). A Teacher-led room starts with nobody. Pause and resume refuse a waiting room (resuming would start it without the start's checks). The time it started is not stored; `started_at` stays the time it opened. Start, pause, resume and close take one lock per room and read the status again under it (Phase 3 review), so a close during a start leaves the room closed, of two starts one is a 409, and a start serves only phones it told to wait | `routes/session.js` |
| "12 / 36 present" in the waiting room | Phones joined / students marked present or late, as the handoff's line reads; "12 joined" in a room with no class. The phone joining a class room marks its student present as in any room, so the second number can move as phones join | `waitingLine` in `services/modes.js` |
| A phone in a Teacher-led room | Told (`session:teacher-led`) and stopped: no profile, no attendance mark, no place on the wheel. The professor takes attendance in a room where no phone is expected; a typed roll number marking someone present there would be the decision 7 gap with nothing gained | `handleJoin` |
| A Teacher-led room's bank | Still needs 6 approved questions (or a question set), like any room: the floor was left as it is. No phone is served from it, so the owner may want it waived | `POST /api/session` |
| The Mixed feed | The teacher's grid carries counts of the teacher records (marks in force today, picks, tallies, activities) beside counts of the digital answers, each labelled, never added together (decision 3). Pushed after each record in Mixed and Teacher-led rooms only; a Student-devices room's grid and its pushes are as before | `roomFeed` in `services/modes.js`; `afterRecord` in `routes/records.js` |
| What the projector's class progress shows | Answers given at each level (graded answers; a poll is at a level only by position), how many students have answered, how many are present (attendance in a class room, phones joined otherwise) and the class size. Not how many students are working at each level: on a wall that groups people into levels, which is close to a band. **The counts per level wait for 5 students to have answered** (`levels: null`, `minAnswered: 5` until then; Phase 3 review): with one or two phones answering, they are those students' own answers on the wall | `progressForWall`, `MIN_ANSWERED_FOR_LEVELS` in `services/projector.js` |
| Which question kinds show options on the projector | mcq, multi, poll and true/false (a plain list); any other kind is shown as its stem for the class to answer aloud. The key on reveal is the options' letters, so kinds without options reveal none | `bankQuestionForWall` |
| **The projector token rules** | A link is for one room; several are allowed (two screens in a hall), and only the room's owner makes or revokes one (an HOD reads the links, never a token). Its token is 32 random bytes (256 bits, base64url, 43 characters), shown once in the reply that makes it and stored only as its SHA-256 (no salt: there is nothing to guess). It works while all three hold, checked on every connection: the link is not revoked, its room is not closed, and it is **under 12 hours old** (Phase 3 review; `link.expiresAt` says when it stops). A link that runs out while its projector watches is dropped at the next change of screen with a sentence saying why. A refusal says the same sentence for an unknown, malformed, revoked or expired token, or one whose room was deleted, so a token cannot be probed; only a closed room's link gets a sentence of its own. Revoked links are kept, revoked; a room's links are deleted with it. Why 12 hours: a link left open on a shared classroom machine would otherwise show the wall to whoever sat down at it for as long as the room stays open, which can be days; long enough for a teaching day. What the wall shows is held in memory, not stored | `routes/projector.js`; `services/projector.js` (`PROJECTOR_LINK_HOURS`); `0018` |
| A bank question's key on the projector (Phase 3 review) | Only in a Teacher-led room. In any other room (Student devices, Mixed, a waiting room) a phone that has not answered the question may still be served it, so `revealed: true` is a 409 and nothing changes; the same for a question asked aloud from the bank. A question the professor typed in as a tally is no bank question, and its key may go up anywhere | `screenChangeFrom` in `services/projector.js` |
| Images in a waiting room | The image rule counts a waiting room as running, so its projector can load a diagram before any phone is served. The url still answers only while an approved question of the room's set shows the image, and is unguessable; the extra exposure is from the room opening to its start | `servedToPhones` in `services/media.js` |
| **The three accuracy bands' cut points** (Phase 3 insights; decisions 2 and 6 open) | Needs support below **0.4**, Developing from 0.4, Excelling from **0.6**, in one constant. 0.4 is the engine's own line (`SLOW_LEARNER_BAND`, equal to `DEMOTE_AT`); 0.6 is where the handoff's histogram legend puts it ("Below 40%", "40-60%", "Above 60%"), not the handoff's own code, which cut at 0.62 and so disagreed with its chart. Both cuts fall on the edges of the 10-point histogram buckets, so each band is whole bars. Exactly 40% is Developing and exactly 60% Excelling, compared as a quotient so 6 of 15 is 40% | `BAND_CUTS` in `services/insights.js` |
| The fewest answers for a band | **3** graded answers (`MIN_EVIDENCE`, the engine's own floor for the below-40% band); fewer is `null`, "not enough answers yet", never a guess. With the same figure (the counted one: a professor's reviews in, redemption's set-asides out, polls never) and the same floor, "Needs support" is exactly the set of students the engine is holding to Remember and Understand (unit-tested on every right/wrong count up to 12), so the band's note "the engine serves Remember and Understand questions only" is true by construction. A higher floor would leave a student under the ceiling with no band saying so | `MIN_BAND_ANSWERS` |
| Class accuracy (the KPI tile and per room in class analytics) | The mean of each student's accuracy, over students with at least one graded answer, as the room list and the dashboards already count it: a student with forty answers does not outvote one with four. The tile also says how many answers and students it rests on | `roomFigures` |
| Participation | Present students who have answered at least once (a poll counts: it is participation, not accuracy), out of those present. Present is attendance (present or late) in a class room, so a phone off the roster is not counted there; in a room with no class, every phone that joined. Null in a Teacher-led room, where no phone answers, rather than a 0% that reads as a class that did nothing | `roomFigures` |
| **"Since the start"** | Each KPI's start is the first value it ever had in this server process, frozen with its time and the evidence under it: class accuracy at the first graded answer, the support count when the first student reached a band, participation when the first student was present. A fresh room has no earlier value to compare with (each room starts with empty profiles), so an early start rests on little, and the reply says how little (`start.answers`, `start.students`, `start.present`) | `noteSample` in `services/insights.js` |
| The KPI series | Sampled **per minute**: every grid push and every insights read writes the room's figures into the current minute's point, so a point is the room as it stood at the minute's last change. At most 180 points (three hours) per room, oldest dropped, the start kept; at most 200 rooms, the least recently sampled dropped. **In memory**: a server restart loses every series and start; the next update begins a new one, and each start's `at` says when. The figures for now are always counted from the store. Per minute rather than per answer so a long class stays small; sampled from what the grid push already read, so it costs no read | `SERIES_POINTS`, `SERIES_ROOMS` |
| **The insight cards and their flag ids** | Focus (the level most students with a graded answer are working at, ties to the lower level, with the class's right and total at that level; "Ask {level}"), Support (how many are below 40% now against the first count; "Show them", which sorts lowest first) and Participation (present students who have not answered; "Spin the wheel"), as the handoff has them. Each card's text says what the answers show and never predicts ("below 40% overall", never "at risk"). Its `flagId` is `<kind>:<evidence key>`: the bottleneck level for Focus, a 16-hex digest of the roll numbers in Needs support for Support, and of the present students who have not answered for Participation | `focusCard`, `supportCard`, `participationCard` |
| **When a dismissed card comes back ("its evidence changes")** | A card is dismissed while the latest insight action on its **current** flag id is `dismissed`. So it comes back when the id changes: Focus when the bottleneck moves to another level; Support when a student enters or leaves Needs support; Participation when a present student answers for the first time or a silent student is marked present. Counts moving without that (more answers at the same bottleneck; the support count's change since the start) do not bring it back. An `acted` after a dismissal ends it: the latest action wins. The alternative, a card coming back only when its list **grows**, needs the dismissed list stored with the action (a column), and was not built; owner's call | `withActions`, `rollsDigest` |
| The push to teacher screens | `teacher:insights`, the same body as the route, to `teacher:<code>` only, after every grid push (joins, answers, reviews, attendance, records in Mixed and Teacher-led rooms) and after an insight action, at most once every **2 seconds** per room with one more after the last change, read fresh when it fires; also at once to a screen that starts watching. Nothing is pushed for a room nobody watches | `scheduleInsights`, `INSIGHTS_PUSH_MS` |
| **The student card's "Next set"** | **Not** the handoff's fixed "3 at the level, 1 review below, 1 stretch above": the selector schedules no review or stretch. It serves the working level until its unseen questions run out, then the level below, then further down and only then up; inside the below-40% band, Remember and Understand in turn, never above. A preview promising a stretch it never serves would be false, so the card runs the selector itself (`selectSet`, level held) over the room's servable questions, after the question on the student's screen, and within the room's questions-per-student cap, and reports the levels it gave in the handoff's words (a lower level "review", a higher one "stretch"). Marked `planned: true` with a sentence: which question is random, and any answer can move the level. Making the engine actually serve 3/1/1 is a selector change, not made | `plannedNextSet` |
| The student card's last answers | The last ten **final** answers (an attempt followed by a retry never counted), newest first, in the professor's view (`answerItem`, as `/answers` gives them, snapshot and key included). Every attempt is in `GET /api/session/:code/answers?rollNo=` | `studentCard` |
| Who has a card | A roll number a phone joined the room with, or in a class room a student on its roster, so a Teacher-led room's student has one with no phone (no band, level or plan; their records). Anyone else is 404 `That student was not found.`, after the room's own 404 | `studentCard` |
| Class analytics' rooms | The class's newest 4 (default) or 8 rooms by when they opened, whatever their status (open, paused, waiting or closed; a deleted room's figures live only in its archive), reported oldest first, and only rooms the caller may read. Rooms opened for no class are never counted. A class with no rooms answers empty lists | `classAnalytics`, `windowFrom` |
| A student across the window | Pooled by roll number over the window's rooms (a class's rooms share its roster's roll numbers): counted right over counted answers, so a student who missed a room has fewer answers, not a zero. The histogram counts students with at least 3 such answers; the rest are `notEnough` | `classAnalytics` |
| Class size in class analytics | The roster **now**, as everywhere else attendance is counted: a student added or removed since a room ran changes that room's "N / M present". Not stored per room | `roomReport` |
| The hardest questions | The item report's own reading over the window's final graded answers (`itemAnalysis`): questions with at least 5 answers (its floor for calling a question hard), flagged ones first, then the lowest share right, more answers first on a tie; ten at most, without their option counts (those are on `/items`). Rooms older than the answers table add none | `classAnalytics` |
| **Six levels and three level bands, both, while decision 6 is open** | Every level figure of class analytics comes twice, per room and over the window: the six levels (`levels`) and decision 6's three level bands (`levelBands`: Remember and Understand; Apply and Analyse; Evaluate and Create), each with the answers behind it. The server does not choose a default view: the screen decides which to show first, so settling decision 6 needs no server change and no data change. The live view and the student card keep the six levels, where the next question is chosen | `LEVEL_BANDS` in `services/classAnalytics.js` |
| Where class analytics' figures come from | Accuracy, bands and levels: the room profiles' counted level tallies (so rooms older than the answers table count). Attendance: the marks against the roster now. Hardest questions: answer rows. Teacher records are not read (decision 3); every figure carries the number of answers it rests on | `services/classAnalytics.js` |

### Phase 2 defaults the owner should look at

Each row above is in use and reversible. These are the ones where the safe default
may not be what the owner wants, or where a contract is involved. **19 Nov 2026,
under the owner's delegation: every default kept as built, except the three marked
settled below.**

| Default | The question for the owner | Cost of changing it |
|---|---|---|
| Offline-template questions wait for approval like model ones | Should template output be trusted without review? The roadmap's "kept out of rooms until approved" draws no line, so none is drawn | Kept as built (19 Nov 2026) |
| A plain regenerate takes an active question out of rooms until its replacement is approved | Keep the old one serving until then? | **Settled 19 Nov 2026: yes**, built with `questions.replaces_id` (`0022`) |
| A professor's own question is stored as `source: 'fallback'` | Amend `CONTRACT.md` §6 rule 5 with a third value (such as `teacher`), so the console stops labelling it template text? | **Settled 19 Nov 2026: `'teacher'`**, contract amended, check widened (`0022`) |
| The slide-only check still fails a picture reference with only a passage attached | Should a passage clear it, as the task asked? | **Settled 19 Nov 2026: yes**, one condition in `slideOnlyReference` |
| The negative point-biserial flag fires at any value below 0 | Add a margin (say below -0.1) for small classes? | One constant |
| The point-biserial is shown from 10 students; bands from 5 answers at 0.8 and 0.4 | Different floors or cut points (for example per room, from its own mastery goal)? | Constants; per room needs the bank report to stop pooling rooms |
| During a running class, anyone with an image's url can load it | Acceptable for a class activity? Signed urls are the alternative, with the costs given above | A new serving rule and a secret that survives restarts |
| Uploads live in the database, at most 500 KB, never deleted | A storage bucket, a different limit, or a delete route with a retention rule (decision 8)? | A move of the bytes; the url can stay the same |

### Phase 3 insight defaults the owner should look at

Each is in use and reversible without a data migration (nothing here is stored but
the insight actions, which `0017` already had):

| Default | The question for the owner | Cost of changing it |
|---|---|---|
| Accuracy bands cut at 0.4 and 0.6, from 3 graded answers | Other cut points (the handoff's code had 0.62), or a higher floor? A floor above 3 leaves a student under the engine's ceiling with no band saying so | Two constants in `BAND_CUTS` and `MIN_BAND_ANSWERS` |
| A dismissed card comes back when its list of students changes in any way | Come back only when the list grows (a new student needing support; someone newly silent)? | A column on `insight_actions` for the dismissed list, and a subset test |
| "Next set" shows what the selector will serve, not the handoff's 3 + 1 review + 1 stretch | Should the selector itself serve a review and a stretch in each five? | A change to `selectNext`, which changes what students are asked |
| "Since the start" is each figure's first value in a fresh room, from little evidence | Compare with the student's previous room instead (needs a lasting identity, decision 7)? | A read of the class's previous room per student |
| The KPI series is in memory | Keep it across restarts? | A table, or rebuilding the series from answer timestamps (reviews made later would then rewrite the past) |
| Class analytics count rooms of any status | Leave out rooms still waiting to start, or open ones? | One filter |

### Phase 3 review: defaults chosen, and three questions for the owner

The fixes to the Phase 3 review needed four defaults. Each is in use, said in
`docs/API.md`, and reversible with no data change:

| Default | The question for the owner | Cost of changing it |
|---|---|---|
| A bank question's key goes on the projector only in a Teacher-led room (409 in any room whose phones may still be served it, a tally from the bank included) | Allow it in a Mixed room once every phone present has answered it, or take the question out of the room once revealed? | The first needs the room's answers read on each reveal; the second a stored list of revealed questions per room, which the selector would skip |
| The projector's progress screen shows counts per level only from 5 students who have answered | Another floor? | One constant (`MIN_ANSWERED_FOR_LEVELS`) |
| A projector link works for 12 hours from when it is made | The day the room was opened instead, or another length? | One constant (`PROJECTOR_LINK_HOURS`) |
| After a restart, first names on the projector are off for a room opened before it (the handoff's default, on, for a room opened since) | Keep the toggle across restarts? | A column on the room or the link |

Three findings were not fixed, because each needs the owner (all in `docs/API.md`,
"Known open issues"). The first and third were decided on 19 Nov 2026 (below,
"Phase 3: the two questions, decided"):

- **What a phone is told about the band.** The phone's row carries `slowLearner` and
  the integrity summary, and its `reason` sentences name the below-40% band, which the
  phone shows on purpose ("the same sentence the teacher sees"). The roadmap's rule
  says labels are staff-only; `CONTRACT.md` sections 4 and 5 make the phone's
  `profile` the one `GridRow`. Changing it needs a contract amendment, a sentence a
  student is shown instead, and the phone client. *Decided and built, 19 Nov 2026.*
- **Amending `0005`**: done, not waiting on the owner. `0005` now lists `'waiting'` in
  `sessions_status_check`, a widening that no row can fail, so re-running the set
  never narrows the check. Revert that one line if an applied file must never change.
- **Whether a class room's observations outlive the room.** Today they go with the
  room they were typed in, so deleting one room of a class-day changes the mark in
  force the class's other rooms show for that day. Keeping them (with no room, under
  the class and day) means a test room's marks could never be removed, since
  observations are append-only. *Decided 19 Nov 2026: kept as it is.*

### Phase 3: the two questions, decided

Both decided under the owner's delegation, 19 Nov 2026.

**(a) What the phone is told: labels are staff-only.** The phone's own row stops
carrying `slowLearner`, the integrity summary and any sentence that names a band. It
gets a neutral reason instead: which level comes next and why, in plain words, with
the number of answers it rests on. The teacher's rows are unchanged.

*What was built.* `phoneRow` in `routes/session.js` builds the phone's `profile`
field by field from the teacher's row: `rollNo`, `name`, `workingLevel`, `levels`,
`total`, `answered`, `online`, `counted`, `withdrawn`, `mastered`, `masteryGoal`, and
`next: { levels, why, answers }` (`nextStep` in `services/mastery.js`). Every
`session:accepted`, `server:result` and `server:exhausted` carries it. The phone's
`reason` is its own sentence too: in `server:result` it is `next.why`, and in
`server:question` it says why this question (`reasonForPhone` in
`services/selector.js`), never the band. Inside the below-40% band a phone is told
"From your N answers so far, your next questions are at Remember and Understand, to
build a firm base before the levels above." The professor's sentences (`reason` on the
profile, the pin's reason) are unchanged and stay on the teacher's side. `CONTRACT.md`
sections 4 and 5 are amended (Amendment 3, dated). A unit test walks a thousand
random rooms and finds no phone sentence naming a band, a cut-off or a percentage.
Under the same rule a student account's own dashboard and analytics no longer carry
`banded` (the directive: no label like "slow learner" anywhere a student can see it);
a professor's view of them still does.

**(b) Observations of a deleted room: kept as they are.** They leave the live views
with the room and are kept in its JSON archive (decision 9). The class page should say
that a deleted room's records are in its archive (client work). Nothing built.

### Settled on 19 Nov 2026, beside the decisions

Asked for by the UI session and settled in the same batch, under the owner's
delegation:

| What | Settled | Where |
|---|---|---|
| The class list says whether the viewer may create a class | `GET /api/classes` carries `canCreate` (false for an HOD, as `POST /api/classes` refuses one) | `routes/classes.js` |
| The wall knows how the room runs | `projector:state` carries `roomMode` (`devices`, `teacher-led` or `mixed`) beside `mode` (what the screen shows), so the wall can hide the join code in a Teacher-led room | `projectorPayload` in `services/projector.js`; the whitelist |
| People-facing sentences name no API detail | The remove message ("put back on the roster at any time"), the Teacher-led cards note ("counted on their own, beside this"), the presets' note and the import's restore sentence no longer name a path, a field or a verb | `routes/classes.js`, `services/insights.js`, `routes/attainment.js` |
| The boot probe checks every table and column the server writes, `0016` to `0022` | Missing what rooms need (`0022`'s columns included) stops Supabase being used, naming the file to apply; missing what only some routes need (`0019`, `0020`, `0021`'s `attendance.roll_no`) keeps Supabase and logs one line per piece naming the file and what fails until it is applied. The probe now asks for no rows with a GET, not a HEAD: the client read a missing table's 404 to a HEAD as "no content", so a missing table was never caught | `ROOM_SCHEMA`, `ROUTE_SCHEMA`, `probeSupabase` in `repo/supabaseRepo.js`; `initStore` |
| `best` attempts: a review always wins | For the same question, a professor-reviewed attempt always beats a provisional machine mark, whatever the scores and whichever room each came from, as "a professor's review replaces the machine's mark" says; the methodology sentence and the formula's field description say so | `chooseAnswers`, `methodologyText`, `registerMethodologyText` in `services/attainment.js` |

### Phase 4: course outcomes, their mappings, and the roster from CSV

Chosen so the work could go ahead; each is in use, said in `docs/API.md` ("Phase 4"),
and reversible with no data migration unless the last column says otherwise.
Decision 3 holds throughout: teacher records are never mapped to an outcome or counted
in coverage. Decision 8's data minimisation holds for the import: a CSV's other
columns are never read into a row, let alone stored.

| Default | Why | Cost of changing it |
|---|---|---|
| Outcomes belong to a **class** (a course and a section), not to a course across sections or to a chapter | Attainment is reported per class; a second section copies them (`POST .../outcomes/copy`), as new rows with nothing linked, so an edit in one section never moves the other's report | Sharing outcomes across sections needs a course table and a migration |
| Topics are matched by text, **within their chapter, ignoring case and runs of spaces** (`topicKey`) | The rule the chapter's own topic list already de-duplicates by (`tidyTopics` in `routes/content.js`). The same name in two chapters is two topics | One function; looser matching (punctuation, accents) could join topics a professor keeps apart |
| A mapping may name any topic the chapter's evidence carries: its list, its questions' topics, or a topic answers in the class's rooms were given under; any other is a 400 that lists them | Stops a typo making a mapping that catches nothing, while still letting a professor map an old name after a rename | None |
| **A renamed topic is not followed.** Renaming it in the chapter's list leaves questions and answers under the old name; that evidence is counted as unmapped under the old name (`inChapter: false`) until the old name is mapped too | Nothing records that one name became another (the chapter's list is replaced whole), so guessing would risk joining two topics. Never dropping it, and saying so, is the safe direction | Recording renames needs the content edit to say which name became which |
| Which topic decides: the **question's current topic while the question exists**, then the topic frozen on the answer | The task's rule. A question's topic is not editable today, so the two agree; if it becomes editable, the bank's current topic wins for answers to questions that still exist | One function (`resolveAnswer`) |
| A per-question override **replaces** its topic's outcomes (it does not add to them), or excludes the question from every outcome | "Map one question directly to specific COs" reads as instead of; adding would make an override unable to take a question away from a wrong topic mapping | One function |
| An override is kept by the question's id with **no foreign key**, and still applies to answers given to a deleted question (their snapshot keeps the id) | The professor's decision is about that question's evidence, which outlives the question | A foreign key would delete it with the question |
| "Has evidence", for removing an outcome: **any counted answer** (final, graded, digital) from any of the class's live rooms reaches it. Approved questions mapped to it are not evidence; deleted rooms' archived answers are not read | Archiving keeps what was measured; an outcome nothing was measured against can go | Counting archives needs reading `room_archives` |
| An outcome with evidence is **archived, keeping its mappings**, so evidence (later answers too) keeps reaching it and reports name it, marked archived. It cannot be edited or remapped until restored; restoring puts it last | "A report run later still names it." Freezing its mappings at archive time would need a copy of them | Stopping new evidence reaching an archived outcome is one condition in the resolver |
| Deleting an outcome with no evidence takes it off every override; an override left naming nothing is removed and its question follows its topic again, which the reply says | The alternative, refusing the delete, would leave the professor to undo overrides by hand first | None |
| Codes are upper-cased, one per class among outcomes in use; an archived code may be reused | "co1" and "CO1" are one outcome to a reader; reusing an archived code lets a professor start a revised CO3 | One check |
| Weights are per topic (above 0, at most 100, default 1); an override counts with weight 1. Coverage counts unweighted | The task asked weights on topic mappings only; how a weight enters a figure is the attainment formula's, which colleges configure | A per-override weight would be a column |
| Coverage counts **final, graded** answers (polls and retried attempts out), from the class's rooms the caller may read | As item statistics and the topic report count | One filter (`countsAsEvidence`) |
| The CSV import is **owner only, dry run included** | The task's "owner only"; an HOD writes nothing, and a dry run is a write's rehearsal | One guard |
| The CSV import reads one roll number column and one name column, found by header (`roll`, `roll no`, `roll number`, `rollno`; `name`, `student name`, any case, `.`, `_`, `-` as spaces). A file without such a header is refused, not guessed at. Since 19 Nov 2026 it also reads an optional under-18 column (`under 18`, `under18`, `minor`, `below 18`) as yes or no (decision 8); a date-of-birth column is never read | Guessing a header-less file's columns could put a phone number in the name | A list of words |
| A CSV may hold **2,000 rows and 1 MB**; the class still stops at 500 students, rows past it refused one by one with their lines | A sheet exported for a whole year may hold several sections; reading it all and saying what was not added beats refusing the file | Constants |
| A roll number matching a **removed** student is reported and **not restored** | Restoring is a decision about one person; a file is not the place to make it | None |
| The boot probe does **not** check `0019`'s tables | No room needs them: a server deployed before `0019` keeps its rooms on Supabase and only the outcome routes fail, instead of every room falling back to the in-process store. **Since 19 Nov 2026 it checks them without failing**: a missing table is a boot-log line naming `0019` and what fails, and Supabase is still used | `ROUTE_SCHEMA` in `repo/supabaseRepo.js` |

### Phase 4: configurable attainment and the marks register

The directive's rule is that no single institutional formula is hardcoded as correct.
So the formula is data (`0020`), and these are the defaults around it. Each is in use,
said in `docs/API.md` ("Phase 4: configurable attainment"), and reversible with no data
migration unless the last column says otherwise. The owner should look at the first
four.

| Default | Why | Cost of changing it |
|---|---|---|
| **A class with no saved formula uses "Example: 60% of marks; levels at 50 / 60 / 70% of students"** (60% of the marks, from 3 answers; class levels at 50, 60 and 70% of students; digital and reviewed answers; final attempts; rooms equal), and every report says it is an example, not an institutional standard. A second example ships: levels at 60 / 70 / 85% | A report has to use some formula before a professor chooses one; the numbers are the task's own example, and 60% is the line a published university handbook draws, without naming it. Neither preset is called NAAC or NBA | Data: `DEFAULT_PRESET` and `PRESETS` in `services/attainmentPresets.js` |
| **Provisional machine marks (written answers the keyword marker marked, not yet reviewed) do not count by default** | The task's default. Note that the live ladder does count them at once (the review default above); attainment is a report a college files, where a keyword match is not yet a mark. A professor who reviews the queue moves them into `humanReviewed`, which counts | One field of the formula (`evidence.aiProvisional`), per class |
| **The class figure counts the roster now**; removed students and roll numbers not on the roster are listed after it, labelled, and never counted (their evidence is in `outside`) | A mistyped or visiting roll number is not a student of the class, and a removed student has left it. An empty roster gives no class figure, and the summary says to import one | One filter in `classFigure` |
| **Below `minAnswers` counted answers, a student is "not enough evidence"**, including with none at all; such students are not counted in the class's share | The task's rule: never "not attained" without the evidence. The class figure's `notEnoughEvidence` and `withNoAnswers` say how many | None |
| Evidence types are read from `review_status` and `ungraded`: `auto` digital, `provisional` the keyword marker's (a provisional machine mark, not AI), `confirmed` / `overridden` a professor's; a poll counts only as a number | How Phase 1 writes them; no column needed | One function (`evidenceTypeOf`) |
| One answer is one mark (the score in force, 0 to 1), times the topic's weight in the outcome (1 for a question mapped by an override) times the room's weight; Bloom attainment weighs by room only | Weights on topics were asked for in the mapping, and on rooms in the formula; a question has no maximum marks of its own yet | A per-question mark would be a column on questions |
| **Final attempts**: every final attempt counts; a question answered in two rooms counts in both; a second final row for one question in one room (only after a failed profile write) replaces the first, as item statistics read it. **Best**: one attempt per student and question across attempts and rooms, the highest mark among the counted types first, ties to a final attempt and then the later one; since the review, a written answer's attempt followed by a retry never counts under best | "Best attempt per question" read as per student and question; choosing among counted types first stops a provisional 1 hiding a reviewed 0.4; only a final written attempt can be reviewed, so an earlier one could never be checked. **Since 19 Nov 2026 (owner's delegation) a reviewed attempt always beats a provisional machine mark at the same question, whatever the scores and whichever room**, also when a formula counts provisional marks | One function (`chooseAnswers`) |
| Bloom attainment counts every counted answer at its level, mapped to an outcome or not, and an answer excluded from outcomes by an override still counts at its level | An override is about outcomes; the level is the question's own. Both the six levels and decision 6's three bands are given | One filter |
| **Deleted rooms are not counted** | An archive's class is inside its JSON, so a report would read and decode every archive in full; no `includeArchived` option was built. Every report says so | Reading `room_archives` (a class column on archives would make it cheap) |
| `from` and `to` select rooms by the day each opened, in India's time (`roomDay`), as observations are dated; `rooms` names codes of the class's rooms | One rule for "which class meetings", not for when each answer was given | One filter in `roomsWindow` |
| A saved formula is **never changed**: a save is the next version, a save equal to the one in force writes nothing, and the first save is version 1 even when it equals the default example (the professor chose it) | A report printed under version 2 must be checkable later; the database refuses edits (`0020`) | A route to read old versions is not built |
| A room weight is stored by the room's id (a code may be sent); a room deleted since is ignored and shown `found: false`; in a report, `inReport` says whether the room is among those counted | Codes are freed when a room is deleted and may be drawn again | None |
| **The register** applies the formula's evidence types and attempts rule (best within a room), not outcomes, thresholds or room weights; one question is one mark; no answers in a room is 0 of 0 with the attendance mark beside it, **never a zero** | The roadmap's "absent versus zero"; weights belong to attainment | Scaling to a college's marks and best n of m rooms are not built |
| States and levels are decided in exact integer arithmetic | 0.7 + 0.7 + 0.7 is not 2.1 in floating point; a student at exactly the threshold attains | None |
| Students are listed in roll order: the roster, then removed students with evidence, then roll numbers off the roster; never by any mark, never numbered | No ranks (the roadmap's "Labels and leaderboards") | None |
| Teacher records in a report: observations in force per student and day in the rooms counted, picks by response, questions asked aloud with their hands, activities by kind; never a mark | Decision 3's safe default | None |

### Phase 4: CSV exports and printable reports

Each is in use, said in `docs/API.md` ("Phase 4: CSV exports, printable reports and the
acceptance run"), and reversible with no data migration.

| Default | Why | Cost of changing it |
|---|---|---|
| Files come from **the JSON routes themselves** (`?format=csv`, `?format=html`), not from separate `/export` or `/print` routes | One place reads a query, so a file is always the JSON of the same rooms, formula and filters | New routes calling the same writers |
| The **method rides in the sheet**: leading rows (label, value), a blank row, then each table with a title row; not a second file | A sheet mailed on its own still says which formula, version and rooms made it. Spreadsheets open leading rows as they are | A second file, or a header-only sheet, from the same writer |
| The guard: a text cell starting with `= + - @`, tab or CR gets an apostrophe **and is always quoted**; since the review, the same after a semicolon or a tab inside a cell, and every cell holding one quoted; numbers are never guarded | The OWASP list; quoting makes the neutralised cell plain in the file. A negative number is a number. A spreadsheet that splits on semicolons or tabs would otherwise start a new cell mid-name | Two regular expressions |
| Teacher records in a sheet **at class level only**; a student's are in their own printable report | A sheet is filtered and mailed a row at a time, and "Needs additional support: 2" beside a name is the label the roadmap's "Labels and leaderboards" warns against | One table |
| The register's page has a teacher-records section that says they are **not in the register** and where they are | The register is marks; decision 3 keeps records out of every mark | None |
| A filename names the class's course, section, **the first 8 characters of its id** (a class has no code) and India's day; never a student, even for one student's report | A file may be forwarded; the class's own words are already on it | One function |
| The attainment sheet is **student by outcome**, as the task asks; the roadmap's per-question sheet (maximum marks, outcome and level header rows) is not built | A question has no maximum marks yet (one answer is one mark) | A new sheet from the student report's answers, and a marks column for questions |
| The printable page holds its **own Content-Security-Policy** (`<meta>`) as well as the header's | The console opens it from a blob or `srcdoc`, where no header reaches it | None |

### Phase 4: the defaults the owner should look at

The tables above hold every Phase 4 default. These eight are the ones the owner is
most likely to want to look at, gathered here with where each is said. Each is in use
and reversible with no data migration. The formula defaults change by data (a preset)
or per class (a saved version), never by code.

| Default | What is in use | Why | Cost of changing it |
|---|---|---|---|
| **The evidence types** | Four types, read off the answer row as Phase 1 writes it (`evidenceTypeOf`). **Digital**: `review_status` `auto`, an objective answer marked from the stored key. **Provisional machine mark** (the API's `aiProvisional`): `provisional`, a written answer marked by the keyword (rubric) marker, or by a model marker if one is ever added, and not reviewed. **Reviewed**: `confirmed` or `overridden`, the professor's mark. **Poll**: `ungraded`, a count only, never a mark. Teacher records are **not** an evidence type; a formula cannot count them (400) and every report gives them a section of their own. These are the directive's four kinds of evidence: digital answers; teacher observations; "AI-generated assessments", which is the provisional type, a machine's mark nobody has reviewed; and human-reviewed assessments | No column is needed, and each type says what a person can trust about a mark. No model marks written answers today, so "AI" names a type that so far holds keyword marks only. The API key `aiProvisional` keeps the directive's word (and saved formulas use it); since the review every label and methodology calls it a "provisional machine mark", "not AI", and the sheets' columns "provisional written answers", so no report claims a model marked anything | One function. A separate type per marker needs a column on `answers` saying which marker made the provisional mark |
| **The default formula and the presets, as examples** | A class with no saved formula uses **"Example: 60% of marks; levels at 50 / 60 / 70% of students"**: a student attains an outcome with 60% of its marks from at least 3 counted answers; the class reaches level 1, 2 or 3 when 50, 60 or 70% of the students counted attain; digital and reviewed answers count; final attempts; rooms equal. A second example ships, "Example: 60% of marks; levels at 60 / 70 / 85% of students". Every report says which it used, that it is an example to start from and not an institutional standard, and gives its exact parameters. Neither is called NAAC, NBA or any body's formula | The directive forbids one formula hard-coded as correct. A report still needs some formula before a professor picks one, and an example labelled as an example is honest about that | Data: `PRESETS` and `DEFAULT_PRESET` in `services/attainmentPresets.js`; or each class saves its own |
| **Provisional machine marks are left out by default** | `evidence.aiProvisional: false` in both examples. Since the review a save may count them only together with reviewed marks (400 otherwise), since a review replaces the machine's mark; a formula stored otherwise before still reads. Provisional marks are shown in every figure, with their answers and marks, and marked "not counted". A professor who reviews them in the queue moves them into the reviewed type, which counts. A class may switch them on in its own formula. The live ladder does count them at once (the review default above), so a student's level and their attainment can rest on different evidence, and the methodology paragraph says which attainment used | A college files attainment; a keyword match is not yet a mark anyone stands behind | One field per class |
| **Deleted ("archived") rooms** | Not counted in attainment, coverage, the register or the outcome remove check. A deleted room's answers are kept in `room_archives` (decision 9), but an archive's class is inside its JSON, and every report says deleted rooms are left out. An **archived course outcome** is a different thing: one with evidence is archived rather than deleted, keeps its mappings, and is still named and computed in every report, marked archived | Reading every archive in full on every report costs too much, and a class column on archives would be a migration of its own. Most deletions are test rooms | A class column on `room_archives`, then an `includeArchived` option |
| **Renamed topics** | Not followed. Renaming a topic in a chapter's list leaves its questions and answers under the old name, so that evidence counts as **unmapped** under the old name (`inChapter: false`) until the old name is mapped too. It is never dropped, and coverage and every report list it | Nothing records which name became which, and guessing could join two topics a professor keeps apart | The content edit would need to record renames, and the resolver would follow them |
| **The CSV import rules** | Owner only, the dry run included. The file is `text/csv` or JSON `{ csv }`, at most 1 MB and 2,000 rows (the class still stops at 500). It may carry a BOM, CRLF, LF or CR, quoted fields, and comma, semicolon or tab, told from the header line. The header must name one roll number column and one name column; a file without one is refused, never guessed. An under-18 column, when the file has one, is read as yes or no (decision 8, 19 Nov 2026). **Every other column is never read into a row** and is listed back (a phone, email or date-of-birth column included). A name holding an `@` or a long number is refused. A removed student's roll number is reported, never restored. The rows go through the JSON list's own check (`addToRoster`). A body is read as UTF-8 | Decision 8's data minimisation, and the roster rule of roll number and name only | Constants and a word list in `services/roster.js` |
| **The formula-injection guard** | In every CSV sheet, a text cell starting with `=`, `+`, `-`, `@`, a tab or a CR gets an apostrophe in front **and is always quoted**. Numbers are never guarded. Every sheet says so in its `Formula guard` row. Since the Phase 4 review the guard also works after a semicolon or a tab inside a cell, and every cell holding one is quoted, so a spreadsheet set to split on semicolons (Excel in many European locales) cannot start a cell with `=` from the middle of a name. Of the two fixes the review offered, this one was chosen: names are not narrowed | The OWASP rule for CSV injection, for the comma-separated sheets Indian installs of Excel open by default and for a semicolon locale | Two regular expressions in `services/csv.js`. The Phase 0 room CSV keeps its older guard (`docs/API.md`, "Known open issues") |
| **Print delivery** | A printable report is a self-contained HTML page from the same route (`?format=html`), served inline with `no-store`. It has no script, font, image or link, its own Content-Security-Policy in the header and the page, and A4 print rules. Readers print with the browser's own Print. No PDF is made on the server (it would need a headless browser or a PDF library). The console fetches with the sign-in header (or the `x-teacher-key` header) and opens the page from a blob or `srcdoc`. Since the review a page or a sheet asked for with `?key=` in its address is a 400, so the shared key is never printed in a page's footer or kept with a download | No new dependency. The page is the report's own words and figures, and the reader's browser prints it | A short-lived link without the key, or a server-side PDF (a new dependency) |

### Phase 4 review: the rules the fixes chose

The fixes from the Phase 4 review (19 November 2026) chose these rules. Each is in
use, said in `docs/API.md` ("Phase 4: every new and changed endpoint"), and
reversible with no data migration unless the last column says otherwise.

| Rule | What is in use | Why | Cost of changing it |
|---|---|---|---|
| **Whose answers: through the attendance mark** | An attendance mark keeps the roll number it was made under (`0021`): a join the phone's, in the roster's form; a professor's mark (and a wheel pick's Absent) the roster's at that moment, unless the mark it replaces already carries one, which is kept. A report gives a room's answers to the student whose mark in that room carries the roll number they were given under, filed under their roll number now; otherwise the roster as it stands decides. **Nothing is inferred**: a roll number two marks of one room carry is tied to neither, and a mark made before `0021` ties nothing. `rollNotes` says, for every roll number left off the roster, where its answers are and whom a mark under it was made for | A professor who corrects a roll number on the roster must not lose the student's earlier answers to "not on the roster". Answers are evidence and are never rewritten (`0012`), so the tie is kept on the mark. Guessing from names or timing could give one student's answers to another | The column is a migration (`0021`); the rule is one function (`rollResolver`) |
| **Question provenance beside the evidence type** | Every figure's counted marks are split again by who wrote the question, from the answer row's `question_source`: AI-generated (`llm`), professor-written (`teacher`, stored since 19 Nov 2026), and offline-template (`fallback`, which also holds a professor's own questions written before then, labelled so) | The directive's "AI-generated assessments" can mean an AI-written question as well as an AI-marked answer. The evidence type says who marked; this says who wrote | One function (`questionSourceOf`); the `teacher` value is stored since `0022` |
| **The class figure rests on the students counted** | A figure's `marks` are the answers of the students attained or not attained. Roster students with too few counted answers are outside the share, with their evidence in `outside.notEnoughEvidence`, and the summary says so | Counting their answers in made a figure look better supported than it was | One filter in `classFigure` |
| **Rounding down for display** | A share is cut to 4 decimals, rounded down; obtained marks to 3 decimals down, possible marks up. States and levels are decided exactly, never from these | A share of 59.996% printed as 60% beside "Not attained" under a 60% threshold reads as a mistake; a printed figure should never read higher than it is | Three functions |
| **A weighted room outside the window is "not in this report"** | Room weights are named from every room of the class the caller may read, and each carries `inReport`. Only a room the class no longer has reads "since deleted" | `?rooms=` or the dates leaving a room out is not its deletion | None |
| **No key in a file's address** | A sheet or a page asked for with `?key=` is a 400 that says to send the `x-teacher-key` header; JSON with `?key=` is still taken. The Phase 0 room CSV is left as it was | A browser prints a page's address in its footer and keeps it in its history, and a download keeps its address, so the shared key would leave the room on paper | One check in `reportFormat` |
| **Provisional marks only with reviewed ones** | A save counting `aiProvisional` without `humanReviewed` is a 400; a formula stored that way before still reads, and its methodology says what it does | A review replaces the machine's mark, so such a formula would take every reviewed answer out of the count | One check in `configFrom` |
| **Only rooms opened for the class** | A report counts only rooms opened for the class (`sessions.class_id`), and every methodology and `definitions.rooms` now say so | A room opened without choosing the class may hold anyone's answers | None: it was already so; only the words are new |
| **A restore counts towards the 50** | Restoring an archived outcome while 50 are in use is a 409, as creating one is | The cap was meant for outcomes in use, however they get there | One check |
| **A formula's day is India's** | The day a formula was saved, in its label and methodology, is India's day | Every other day in a report is | None |

Left alone on purpose by the fixes, and open in `docs/API.md`: the Phase 0 room CSV
still takes `?key=` (its header must stay on row 1 for the Classroom import); "everyone
who joined" (`fromJoins`) decides by each student's roll number on the roster now; and
a roll number reused within a class after a correction can send answers in rooms
without a tying mark to its current holder.

### Phase 4: open questions for the owner

These are questions, not decisions. Nothing is built that settles them; each says what
is in use meanwhile.

1. **A department-wide or college-wide default formula.** Each class now saves its own
   formula, starting from a shipped example. Should an HOD (or a college
   administrator, a role that does not exist) set a default that every class in the
   department starts from? Or one every class must use? If so, may a professor depart
   from it, and must a report say so? Meanwhile there is none: each class uses the
   shipped example until its professor saves one. Building it needs a department-level
   table and a rule for who may write it (an HOD writes nothing today).
2. **Indirect attainment.** Many colleges blend direct attainment with indirect
   attainment, such as course-exit surveys, and with university examination results,
   at weights of their own. Is that needed? If so, does BloomLoop collect the surveys,
   or does it only take the figures in? Meanwhile every report says it is direct
   attainment only, from the class's answers.
3. **Maximum marks per question, and the per-question attainment sheet.** One answer
   is one mark today. The roadmap's sheet (one column per question, with maximum
   marks, outcome and level header rows) needs a question to carry its own maximum.
   Is that wanted, and should it scale to a college's examination marks?
4. **Should deleted rooms count?** Today they do not (above).
5. **Provisional marks, and a model marking written answers.** Should a class be able
   to count provisional marks at all? It can today, by its own formula, and since the
   review only together with reviewed marks. If a model ever marks written answers
   (decision 5), should its marks be a type of their own, apart from the keyword
   marker's?
6. **Students under 18 and attainment records** (decision 8). Attainment reports and
   their files are personal data about students. Who may receive a printed or
   exported report, and for how long may it be kept? Nothing limits either today
   beyond staff-only access.
7. **Semicolon locales.** The guard now also covers a spreadsheet that splits on
   semicolons (the review fix above). The sheets are still written with commas, so a
   reader in such a locale imports them rather than opening them. Is a
   semicolon-separated download wanted?
8. **Decisions 3 and 6, as attainment applies them.**
   - Decision 3: teacher records never count in attainment and are reported beside
     it.
   - Decision 6: both the six levels and the three level bands are given.

   Settling either decision needs no data change: it is the formula's rule or the
   screen's choice.
9. **Archived outcomes and new evidence.** An outcome archived because evidence
   reached it keeps its mappings, so answers given later still reach it and every
   report names it, marked archived. Should an archived outcome stop taking new
   evidence from the day it was archived? That is one condition in the resolver.
10. **What the target Bloom level is for.** An outcome may carry a target level. It is
    stored and shown in the outcome list, the sheets and the pages, and enters no
    figure. Should attainment use it (for example, count only answers at or above it),
    or is it a label?
11. **An HOD's reports across classes.** An HOD reads each class of their department
    one at a time; no route reports across classes or sections. Is a department view
    wanted, and with which figures?
12. **Older formula versions.** Every saved version is kept and every report names
    the one it used, but only the version in force is served. Should a report be
    re-run under an older version, or should the old versions be readable?
13. **Course outcomes to programme outcomes.** Accreditation reports map course
    outcomes to programme outcomes (CO to PO). BloomLoop has no programme outcomes.
    Is that mapping wanted here, or is it done elsewhere from the exported sheet?

### Phase 5 in brief: the three defaults to read first, and what is open

Phase 5 is three parts, each with its own table below (class questions with the
confidence tap; misconception labels; honest indicators), and the review fixes of
19 November 2026. Every default is in use and reversible with no data migration.
Three matter most:

- **Why a class question moves no level.** The ladder moves a student on answers to
  questions chosen for that student's level (`selectNext`), one at a time and on their
  own. A class question is the same question for the whole room, chosen by the
  professor whatever each student's level; its round 2 follows the class's discussion,
  so it measures what the group talked through, not what one student knew; and a
  student who answered it on their own earlier has seen its key. Counting any of it
  would move a level on evidence that is not the student's own work at that level. So
  no vote touches a profile, round 1 counts in attainment only as one digital answer
  (and not at all for a student who had seen the key), and round 2 is shown and never
  counted. Staff see the class's before and after as counts.
- **The label matching rule.** A misconception report counts each student's final
  graded answer under the question's **current** label for the option they chose,
  matched through the option's **words** in the question as that student saw it (the
  answer's own snapshot), not its place. So a reorder never moves a count, an answer
  given before a label was written counts under it (the report says "Label added after
  these answers"), and an answer to an option reworded since matches no label (counted
  as `otherWording`). Keeping each label's history and the label in force at the time
  is not built (open question 4 of the labels).
- **The translation threshold.** A question's answers are split by the language they
  were given in, and a warning is raised when two languages each have at least **5**
  counted answers and their shares right are **more than 20 percentage points** apart,
  compared in whole numbers (80% against 60% is no warning). Five is the item report's
  own floor for a difficulty band; at five answers one answer is exactly 20 points, so
  a single answer either way can never raise it. Every answer is English today, so it
  cannot fire on a live room until the Hub's language switch records another language.

Open, from Phase 5 (each also in `docs/API.md`, "Known open issues"):
- Confidence stays information only; whether it should ever inform a level estimate
  is the owner's question (class questions, open question 3).
- The labels' open questions 1 to 5 and the honest indicators' 1 and 2, below.
- Built in the follow-ups of 19 Nov 2026, so no longer open: a store failure while a
  room's close closes its class question (logged; the phones and the projector are
  still told), and the UI session's three server asks (each phone's own `mine` after a
  room is resumed and when a class question is paused, `under18Note` on a class's
  roster read, `levelBands` on the staff dashboards and analytics).

### Phase 5: confidence taps and class questions (pause, discuss, re-vote)

Built from the directive's Phase 5 words ("Confidence should be informational and must
not automatically deduct marks"; "First response. Confidence recording. Professor
pauses the question. Students discuss. Students vote again. Display class-level
changes."). Server and database only, one migration (`0023`); every screen is the UI
session's (`docs/API.md`, "Phase 5"). The rules the directive set are built as given:
confidence never changes a mark, a level, a band, an insight or attainment; a class
question moves no level; every vote is stored and none is overwritten; round 2 is its
own evidence type, shown and never counted; once revealed, a question is never served
on its own in that room again; only the room's owner runs one.

The defaults below were chosen so the work could go ahead. Each is in use, said in
`docs/API.md`, and reversible with no data migration unless its last column says
otherwise. **The owner should look at the first two.**

| Default | Why | Cost of changing it |
|---|---|---|
| **A question asked to the class leaves the room's bank from the moment it is asked**, not only once its key is revealed (`askedQuestionIds` in `services/classQuestions.js`) | The directive's rule is "once revealed, never served adaptively again". A question discussed without a reveal is no longer a student's own work either (the class has talked it through), and serving it afterwards would move a level on it, which "a class question moves no level" rules out. So the stricter rule, which includes the directive's | One filter (`withoutAsked`); reveal-only would serve a discussed question again |
| **The professor sees how many have voted, not what, while a round is open**; the distribution, the share right and the taps come when the round closes | "The professor pauses: round 1 closes, and the professor sees the distribution." A console is often on the classroom screen, and a distribution shown while voting is open steers the votes | One condition (`roundView`) |
| The taps are stored in the spellings `0008`'s check already allows (`sure`, `think`, `guess`); the server sends and reads `sure`, `think_so`, `guessing` | No check is widened, so a database without `0023` still takes every tap; nothing ever wrote the column before | A widening migration and a backfill if the stored spellings should change |
| A phone may **change its vote while a round is open**; the latest counts and every earlier one is kept with `final` false | Clicker practice; "never discard a response" | None |
| A vote that arrives **after its round closed is kept, never counted** (`detail` says so), and the phone is told | Every response is stored; counting it would change counts the professor has already seen | None |
| An answer a phone sends to the question **as its own question** after it was put to the class (a phone that held it on its screen) is kept with the class question, `final` false, never counted; the phone is sent a question of its own | Every response is stored; by then the question may have been discussed or its key shown | None |
| **Every phone sees the full option list in the same order**, the fewer-choices support not applied | The class discusses options by letter ("I said B"); a shortened list would make the letters differ between neighbours. Rendering supports still apply | Passing the student's supports through `forStudent` and mapping votes back (`toOriginalResponse`) |
| One class question runs in a room at a time; a question is asked to the class **once per room**; it may be closed from any round (no re-vote, or no pause) | Votes in a second asking would follow the first's discussion | Two checks |
| A room's **pause** leaves a class question as it is; resuming the room sends it to the phones again. **Closing** the room closes it, without a reveal | A room pause is the professor's; the class question has its own pause | None |
| **Round 1 is ordinary digital evidence in attainment** (as the directive says). **Changed by the review fixes, 19 Nov 2026:** a round 1 vote from a student who had already given a final answer of their own to the question in the same room is set aside, under either attempts rule, and their own answer counts; the professor is told how many such students there are when the question starts (`answeredAlone`) | That student was shown the key with their own result, so their vote is not evidence of what they knew; their own answer came first and is. Before the fix, under `final`, the vote replaced it | One rule in `chooseAnswers` (`knewKey`) |
| A **poll** may be a class question: its changes are "kept" and "changed", it has no key to reveal, and a reveal is refused | A class's view before and after discussion is a natural use; it has no right answer | None |
| The projector shows a class question's counts **only when the professor chooses** (`showCounts`, off by default and after a restart), only for a closed round, and only once **5** have voted in it (the progress screen's floor); the share right and the changes only once revealed (a poll's changes, which tell no key, once round 2 closed) | "If the professor chooses, as counts"; under five votes the counts could be a few students' own; the share right tells the key | Constants |
| Staff see confidence **as counts only**: per room and per question (`/confidence`), per class-question round, and on the student card. No answer carries its tap on a staff screen (`answerItem` leaves it out); the raw rows and a deleted room's archive keep it | "With no student labelled"; "on the student card, counts only" | One field |
| A student's own history (the Hub) **leaves out their class-question votes** | A vote's mark would tell the key before the reveal, and a vote is not their own work at a level | Showing them after the reveal needs the class question's state per row |
| Confidence counts cover the room's **final answers to the students' own questions**; a class question counts its own taps, round by round | The two answer different questions; mixing them would count one student twice for one question | One filter |

**The rules the review fixes chose (19 Nov 2026).** Each is in use, checked by
`server/scripts/keysafety.mjs`, and reversible with no data migration:

| Rule | Why | Cost of changing it |
|---|---|---|
| A phone's class question is **named by the class question's id**, never the bank question's | The bank id was one a phone could send back as its own answer, here or in another room on the chapter, and be marked on, key and all, before the reveal | None |
| **Nothing kept with a class question is answered back** through `student:answer`: a vote's key sent as an answer is filed under a scoped key and the answer kept, never counted; a resend of an answer sent as the phone's own after the question was asked only moves the phone on | Answering from the stored row told a phone the key one option at a time, before the reveal or after a close without one, and put a vote into the ladder | None |
| A vote **for a round not yet open** is kept and not counted, and says so ("had not opened"), not "late" | It is no vote in any round there was, and "after this round closed" would be untrue | None |
| A vote **while the room is paused** is kept and not counted, and the phone is told the room is paused | An answer sent then is refused; the pause holds the class question too | None |
| Under a roll number a signed-in phone linked, a phone **not signed in as her** is never sent her vote or tap, and its vote stops counting once her phone has voted in the round | Decision 7: a typed roll number proves nothing, and her vote is hers | None |
| The professor is told **how many phones answered the question on their own** in the room before it was asked (a count and a sentence, never who) | They were shown its key; the professor may want to close the question | None |
| Refusals a professor can see **name no field** | The directive's rule for people-facing sentences | Sentences |

**Decided under the owner's delegation, 19 Nov 2026 (about 12:50), on the builders'
open questions:**

1. **Reveal-only exclusion: kept as built.** A question asked to the class leaves that
   room's adaptive bank at once, not only after the reveal: a discussed question is no
   longer the student's own work.
2. **A student's own class votes: kept out** of their own history. Showing them after
   the reveal needs the class question's state per row; to be revisited with the Hub
   (Phase 6).
3. **Confidence in the ladder.** Still an open question for the owner: the research
   behind Phase 5 suggests a tap can separate a lucky guess from knowledge when
   estimating a level. It is information only, as the directive says; using it would
   be a product decision and a change to `services/mastery.js`.
4. **The contract's socket list: amended.** `CONTRACT.md` section 5 now lists
   `student:join`'s `token`, `session:accepted`'s `linked`, `linkNote` and `confidence`,
   `student:answer`'s `confidence`, and `student:vote`, `class:question`, `class:vote`,
   `class:closed` and `teacher:class-question` (Amendment 5, dated).
5. **A student's own dashboard and analytics drop `banded`: confirmed** (the directive:
   no label a student can see).
6. **Splitting or merging a regenerated draft loses its `replacesId`: a known gap.**
   The old question keeps serving until it is retired by hand.

### Phase 5: misconception labels on wrong options

Built from the directive's Phase 5 words ("Associate incorrect answer options with
specific misunderstandings. Generate reports such as: '12 students selected the option
associated with misunderstanding X.' Allow professors to review and edit misconception
labels."). Server and database only, one migration (`0024`); every console screen is
the UI session's (`docs/API.md`, "Phase 5: misconception labels on wrong options"); the
phone and the projector are never sent a label. The rules the task set are built as
given: a label (at most 120 characters, no contact details, optional) only on a wrong
option of a question with options, never on a poll or a right answer; provenance `ai`
(proposed by the generator, which only a professor's press runs, decision 5) or
`professor` (written, edited or confirmed); the offline templates propose none; only
the owner edits; editing a label on an approved question does not send it back to
draft; the reports are staff-only.

The defaults below were chosen so the work could go ahead. Each is in use, said in
`docs/API.md`, and reversible with no data migration unless its last column says
otherwise. **The owner should look at the first three.**

| Default | Why | Cost of changing it |
|---|---|---|
| **An answer counts under the question's current label** for the option it chose, matched by the option's words in the answer's own snapshot; a report says "Label added after these answers" (or "after 4 of these 12") and "Label reworded after N of these answers" where that is true | The task's recommendation. A label names what choosing an option means, which does not depend on when the label was written, and matching by words survives the options being reordered. Keeping the label in force at the time would need every label's history | A label history (a table or an array of versions) and a second matching rule |
| **AI draft labels are counted in the reports**, each sentence marked "(an AI draft label, not yet confirmed by the professor)", with the number of drafts in `counted.aiDrafts` | Leaving them out would hide what the generator proposed until someone confirms it, and the professor reads the report to decide whether a label is right | One filter |
| **Counts of students, never who.** No report lists the students who chose a labelled option | The directive's report is a count; a list of names under a misunderstanding is a label on students, which the product avoids everywhere a student could be singled out. A professor regrouping for reteaching would want the names (open question 1) | A field per option, staff-only |
| A label is kept **by the option's text**, not its place. Reordering options keeps every label on its option; rewording or removing a labelled option, or making it a right answer, removes its label with that edit (and a retag that changes the kind removes all), and the reply names each removed label | A label is about what the option says. A label left on a reworded option may no longer fit, and one on what is now a right answer would break the rule; saying so lets the professor add it back | Carrying a label across a rewording by its place, with a rule for telling a rewording from a reorder |
| **Approving a question does not confirm its labels**, and a label edit never touches the approval, status or checks | A label changes no mark, so it needs no approval gate; and the professor reviews a question and its labels separately, so an AI label stays visibly a draft until they confirm or rewrite it | One line in each approve route |
| Labelled kinds: **Choose one, Choose all that apply, True or false** (its one wrong answer, `True` or `False`) | The kinds with a list of options and one key over the whole list. Dropdown, match, categorise and grid have options per gap or row (open question 3) | Per-gap and per-row labels and their matching |
| **Counted answer**: each student's final answer to the question in a room, graded; retried attempts, polls and **a class question's votes** are left out | The item report's own reading, so the counts sit beside its option counts; a class question's votes are counted round by round in its own results (open question 2) | One filter |
| A **choose-all** answer counts every labelled option the student ticked, even when the answer as a whole passed | The report is about which options were chosen | One rule |
| Who is one student: **a roll number** in a room and in a class (pooled across the class's rooms, as class analytics pools them); **a roll number in a room** across a chapter's rooms (two classes may share a roll number) | A class's rooms share its roster; a chapter's may not. The attainment reports' attendance-based roll resolver was not used: these are counts, not marks. The cost is that a student whose roll number was corrected between two rooms counts as two students in the class figure | Using `rollResolver` from `services/attainment.js` |
| Contact details refused: an email address, a web address (`http://`, `https://`, `www.`), an `@handle`, a run of ten or more digits | No misconception about a chapter needs one; ten digits is an Indian mobile | A pattern |
| Labels are **left out of every answer snapshot**, and so of a deleted room's archive | They are staff commentary that changes without the question changing, and the reports read the current ones from the question | Adding them back to `snapshotOf` |
| **Not in the live insights.** The item report shows each option's label beside its count instead | The insights are rebuilt from the profiles at most every two seconds; these counts need every answer row and the bank, and would be a second heavy read on the live screen. The task said not to force it | A reader in `roomInsights` |
| A label the model proposes that breaks a rule (on a right answer, off the list, too long, with contact details, a second for one option) is **dropped, and the question kept** | A label is advice beside the question; refusing the question for it would cost a good item | Refusing the item, as the question's own rules do |

Open questions for the owner (nothing is built that settles them):

1. **Who chose it.** Should the professor be able to see which students chose a
   labelled option (staff-only), to regroup them for reteaching? Today the reports are
   counts only.
2. **Class questions.** Should a class question's rounds show the labelled options'
   counts before and after discussion ("8 chose the option linked to X; after
   discussion, 2")? Today a class question's own results count options by letter, and
   the misconception reports leave its votes out.
3. **More kinds.** Labels per gap (dropdown) or per row (match, categorise, grid).
4. **Label history.** Keep every version of a label, and report each answer under the
   label in force when it was given, as well as under today's.
5. **The contract's Question document.** `CONTRACT.md` section 3 lists the v1 fields of
   a question; `misconceptions` is not in it, as no field added since Phase 1 is. The
   contract was not amended (no decision names it).

### Phase 5: honest indicators

Built from the directive's Phase 5 words ("Show: AI draft labels. Reasons for mastery
movements. Number of responses supporting an estimate. Uncertain classifications.
Translation-related difficulty warnings. Do not use stigmatizing labels such as 'slow
learner' in the student interface. Do not introduce coins, competitive leaderboards or
punitive streak systems."). Server only, no migration; `docs/API.md`, "Phase 5: honest
indicators". The defaults below were chosen so the work could go ahead. Each is in use
and reversible with no data migration. **The owner should look at the first two.**

| Default | Why | Cost of changing it |
|---|---|---|
| **The translation warning**: at least 5 counted answers in each of two languages, and the highest and lowest shares right **more than 20 percentage points** apart (`TRANSLATION_WARNING` in `services/honesty.js`) | 5 is the item report's own floor for a difficulty band (the ladder's window). At 5 answers one answer is exactly 20 points, so a single answer either way can never raise it: it takes two. Compared in whole numbers, so 80% against 60% is no warning | Two numbers |
| **A question's language is taken as English** until one is recorded | No question records its language, and the generator is told to write English. A professor's own question in another language would be misread; none can be told apart today | A `language` on the question (a column), which Phase 6's language switch needs anyway |
| **What the phone is told about who wrote a question**: "Written by your professor." / "Written with AI help and checked by your professor." / "... and chosen by your professor." (no approval recorded, which a class question's snapshot never keeps) / "Made without AI from your professor's material[, and checked by your professor]." / "Made without AI, by your professor or from their material." (older rows nothing tells apart) | True in each case, in a student's words, never "template", "fallback" or a model's name; "checked" only where an approval is recorded | Six sentences |
| **A level is provisional** while the ladder has no decision behind it: fewer than 3 answers at it (`MIN_LEVEL_EVIDENCE`) and no move into it. A level reached by a move is firm on that move's answers, however few answers at the new level since. With adapt off the level is the room's, not an estimate, and never provisional | The ladder's own minimum; a move needed 3 answers to happen, so the placement rests on them | One rule in `levelEvidence` |
| **The moves kept** are promotions, demotions, the move into the below-40% band's Understand, and holds at the top and the floor; not a hold in the middle (every other answer) | The directive's "promote, demote, hold at the edge"; the profile's `reason` already says the latest | One list (`KEPT_RULES`) |
| **A move's share is kept to four places**; its window is 5, or null for the band (every counted answer) | Enough to tell 2 of 3 from 0.67; never shown without its answers | One rounding |
| **An uncertain level**: an AI question no professor has approved (approval is the confirmation; an older AI question in use with no approval recorded counts as unconfirmed), or a kind not in its level's set. A poll never | The gap analysis's "a third of model-written items miss the level"; the kinds per level are the product's own rule | Two rules in `levelCheck` |
| **Mastery sentences carry no percentage and no band**, so the phone and the professor are told the same words ("3 of 4 right at Apply: at or above this room's goal ...") | The phone's rule since decision (a) is no band and no percentage; one set of words cannot drift | Two sets of sentences |
| **Moves are staff-only**; a student's own dashboard trail is sent without them | The band's sentence names the band (decision (a)); the phone's own reason is `next.why` | A phone-safe sentence per move |

Open questions for the owner (nothing is built that settles them):

1. **Staff lists ordered by score.** The insights' "By band" and "Lowest first" sorts
   (behind the Support card's "Show them") and a professor's analytics list of
   students (highest accuracy first) order students by score, on staff screens only.
   The directive says students are listed in roll order, never ordered by score. Keep,
   or roll order only? The room CSV's "Slow Learner" column (staff) likewise.
   **Decided under the owner's delegation, 19 Nov 2026:** students are listed in roll
   order by default. A professor's analytics list of students (`GET /api/analytics/:id`)
   is now in roll order, and highest accuracy first only when asked for
   (`?order=accuracy`, new); the live insights' students were already in roll order
   and the read now names `roll` as its default order (`sort.default`), with "By band"
   and "Lowest first" kept as orders a professor chooses (the Support card's "Show
   them" chooses Lowest first). The room CSV's staff-only "Slow Learner" column keeps
   its name, because the Classroom import and the NAAC reports read that column.
2. **The question's language.** Record it per question (a column) before the Hub's
   language switch, so the warning compares with the language a question was written
   in, not English by default.

### Phase 6 in brief: the Learning Hub, what to read first, and what is open

Phase 6 is the student Learning Hub: a place outside rooms where a signed-in student
practises their professor's approved questions, reads approved lessons, gets ready for a
topic, sets self-tests and goals, and sees their own progress. Server and database only:
five migrations (`0025` to `0029`) and three new dependencies. Every screen is the UI
session's (`docs/API.md`, "Phase 6: the Learning Hub"). The owner said "decide the best
outcomes yourself", so the eighteen decisions H1 to H18 below were **decided under the
owner's delegation, 19 Nov 2026**, in the directive's order: the backbone, practice and
feedback, Elo, the error log, FSRS, Get Ready, refresher paths, practice and exam modes,
lessons, the English, Hindi and Marathi switch, and the tutor. `CONTRACT.md` records the
contract side as Amendment 6. Five rules hold throughout:

- **Accounts only.** Rooms stay account-free (decision 7). The hub needs a signed-in
  account, and answers 503 on a server without Supabase.
- **Approved material only.** A student reads only what the professor approved. Every AI
  output is a draft until then (decision 1).
- **Evidence kept apart.** Hub attempts have their own append-only table (`hub_attempts`,
  `0026`). They never move a room ladder and never count in attainment or the marks
  register (H5). Ratings, states, the error log and reviews are not stored: they are
  worked out from the attempts on every read, as attainment is from answers.
- **No model in anything a student waits on** (decision 5). Models run only on a
  professor's button. The tutor is approved hint ladders, not a chat.
- **Personal progress only.** No rank, average, streak, coins or band name on any student
  payload (H16).

**Read these first:**
1. **The shared question bank** ("Phase 6: the shared question bank"). Rooms and the hub
   draw on one bank, and practice shows the key of every approved question after one try.
   The review fix closes only the questions a room is asking right now. A new decision,
   to be built in batch 8, closes the rest of the gap.
2. **Closed questions** ("Phase 6: closed questions"). A question is closed to a student
   while a room is asking it, while it is on their open self-test, or while their open
   Get Ready check is asking it.
3. **A live chat tutor is not built** ("Phase 6: owner option, a live chat tutor"). It is
   the owner's option, and it needs decision 5 reversed.
4. **Earlier-semester prerequisites** (H3). A student's topic view names confirmed
   prerequisites from the professor's chapters that are on none of the student's classes,
   marked as such. The owner may want them left out.

**Not tested.** Nothing in Phase 6 ran against a real Supabase, PostgREST, Postgres or
MongoDB. The SQL ran in PGlite; the Supabase methods ran only through stubs and the boot
probe; the Mongo methods are covered only by the test that every store has the same
method names. No real model call was made: every prompt is unverified against the live
API, and replies were tested as fixtures through the real parsers. No client exists for
any hub screen, so nothing was rendered in a browser or on a phone: how MathML, shiki's
colours and Devanagari look on a low-end Android phone is unknown. Two server processes
were not tested (every lock is per process). Speed with a semester of attempts was not
measured.

### Phase 6: who reaches the hub, the backbone, formulas and code (H1 to H4, H15)

**H1. Who.** Decided under the owner's delegation, 19 Nov 2026. The hub is for student
accounts only; rooms stay account-free (decision 7). A student reaches a class's hub when
the class's owner is the professor they report to (`accounts.reports_to`) and the roster
holds their roll number (`rollKey`), not removed. The owner reads their students' hub
data; the department's HOD reads it and writes nothing; anyone else gets the usual
same 404.

*What was built.* One access rule, used by every hub route (`services/hubAccess.js`), and
the routes under `/api/hub` (`routes/hub.js` and the other `routes/hub*.js` files).

*Defaults chosen:*
- Without Supabase every hub route answers 503. With it, a bearer token is needed, so the
  teacher key and a room phone get 401.
- **One 404 sentence per kind of thing** ("That class was not found.", and the same for a
  unit, chapter, topic, link, lesson, question, check, self-test or goal) for "not there"
  and "not yours" alike, so no id can be probed. A student on a staff route gets 403
  before anything is read. An HOD writing to a class they may read gets 403, since they
  know it exists. Another professor gets 404 on reads and writes alike.

**H2. What a student reads: approved material only.** Decided under the owner's
delegation, 19 Nov 2026. Approved questions through `forStudent()` (no key before an
attempt), approved lessons, translations, hints, feedback and explanations, and the
chapter's units and topics. Never drafts, never misconception labels, never the raw deck:
slide text reaches a student only inside an approved lesson.

*What was built.* The student payloads (`services/hubViews.js` and each hub service).
`/api/content`, `/api/classes` and `/api/bank` still answer 403 to a student. A student is
sent their classes' units, the titles of placed chapters, and topic names that are not
retired; on a topic, its confirmed prerequisite chain. Never slide text, proposed or
rejected links, retired topics, other classes or unplaced chapters.

**H3. The content backbone.** Decided under the owner's delegation, 19 Nov 2026. Units per
class, ordered and named; chapters in no unit show under "Other chapters". Topics become
records per chapter, made from `contents.topics`; questions keep their topic string and
are matched to a record by name, and no question row is rewritten. Prerequisite links go
topic to topic, across any chapters the same professor owns, with provenance `ai` or
`professor` and state proposed, confirmed or rejected. Only confirmed links are used,
loops are refused, and longer chains are computed from the direct links. The AI proposes
direct links only, on the professor's button (decision 5); the offline generator proposes
none.

*What was built.* `0025` (`class_units`, `class_chapters`, `chapter_topics`,
`topic_links`); `services/hubTopics.js`, `services/hubGraph.js`, `services/hubProposals.js`
and `routes/hub.js`.

*Defaults chosen:*
- **A chapter reaches a class's hub only when the owner places it.** Nothing is placed
  automatically. Only the class owner's own chapters can be placed: **placing another
  owner's chapter is refused** (the route's 404, and a database trigger).
- Topic records are made on upload, on a paste, on a topic edit, when a chapter is first
  placed, and on the owner's sync, never on a read. A question is matched by `topicKey`,
  or by the shortened name the generator stamps on a long topic.
- **A topic that leaves a chapter's list is retired when it is used** (questions or links
  hang off it), **and deleted otherwise.** A retired topic comes back with the same id if
  its name returns. A renamed topic is a new record: the old one is retired with its
  questions and links, which are not moved, so practice on the new name has no questions
  until the professor retags them (as course outcomes treat renamed topics).
- **Adding by hand a link the AI proposed, or one rejected before, confirms that row.** A
  professor's own link is confirmed at once. A loop is refused with a sentence naming the
  chain it would close, checked against confirmed links under an in-process lock per
  professor and a database trigger (which takes no lock across processes: open items).
- **AI proposals** run on the professor's button as a run the console polls, like
  question generation. They ask for direct links only, over at most 60 topics from 1 to
  10 of the professor's own chapters, each with at most 500 characters of its slide text.
  The strict parser keeps only the topics offered and a one-line reason (at most 160
  characters, no contact details). It **holds back loops, repeats, previously rejected
  pairs and links implied by a longer chain**, and self-links. A proposed link is an AI
  draft, used only once confirmed.
- **A student's topic view names confirmed prerequisites from earlier-semester
  chapters**: the professor's chapters that are on none of the student's classes. Only
  the topic's name and its chapter's title are sent, flagged `onYourClasses: false`; that
  chapter and topic still answer 404 to the student. The builder read H3, H7 and H9 as
  intending this. If the owner reads strictly the rule that a student sees only material
  of classes they are on, it is one filter on `onYourClasses` in `topicView`
  (`services/hubViews.js`).

**H4. Per-slide text.** Decided under the owner's delegation, 19 Nov 2026. A deck uploaded
from Phase 6 on keeps each slide's own words (`contents.slide_texts`, `0025`). Older
chapters cite slide numbers through `topic_slides` only, and every staff view that shows
slides says so.

*What was built.* The slide texts are written by their own repository call after the
chapter is made (`routes/content.js`), so an upload still succeeds without `0025` and its
reply is unchanged. `slidesNote` in `services/hubTopics.js` gives the staff sentence. At
most 400 slides of 4,000 characters each are kept, empty slides left out. Pasted text has
no slides, and says so.

**H15. Formulas and code.** Decided under the owner's delegation, 19 Nov 2026. `$...$` and
`$$...$$` (with `\ce{}`) are rendered on the server to MathML with temml (its `temml.cjs`
build carries mhchem); fenced code is highlighted with shiki; TeX runs with trust off and
all other text is escaped. Applied to hub payloads, and to room phone payloads as an
additive field.

*What was built.* `services/richText.js`. Hub payloads carry `nameHtml`, `titleHtml` and
the like beside the plain text; `server:question` and `class:question` gain
`question.rich` (`CONTRACT.md` Amendment 6, section 5).

*Defaults chosen:*
- **Pandoc's dollar rule**, so prices survive: an opening `$` needs a non-space character
  after it, and the closing `$` a non-space character before it and no digit after it.
  "$20 and $30" stays text. **`\$` is a literal dollar sign** anywhere.
- **Caps:** 20,000 characters of input (the rest is dropped, and the result says so),
  2,000 characters per formula, 200 formulas per input, and 10,000 characters per
  highlighted code block. temml runs with trust off, a largest size of 20 em and at most
  300 macro expansions. A formula that cannot be read, or is over a cap, is shown as its
  escaped source, marked with a class; nothing throws.
- **No id and no link from the input** (the review fix): a formula using `\label`, `\ref`
  or `\eqref` is shown as its source, because temml writes an id or a link for them even
  with trust off, and so is any rendering that comes out holding an `id=` or `href=`
  attribute.
- Code: shiki with its JavaScript regex engine (no WebAssembly) and a fixed list of 18
  languages; a fence naming any other is shown as plain text. Light colours by default,
  the dark ones beside them as CSS variables.
- The phone's `rich` holds only fields whose HTML says more than their plain text, so it
  is `{}` for ordinary questions, prices included, which saves phone bandwidth. A code
  block in a class question is highlighted only once shiki has loaded in the server's
  process; `server:question` waits for it (about 300 ms the first time).
- **Corrected from the reports, by the code:** the reports say `rich` holds a field only
  when it has a formula or code. `phoneRichSync` also includes a field whose formula could
  not be read (shown as its source) and a field holding an escaped dollar sign, since
  their HTML differs from the plain text too.

### Phase 6: practice, mastery, the error log and spaced review (H5 to H8)

**H5. Practice outside rooms.** Decided under the owner's delegation, 19 Nov 2026. Hub
attempts go to their own append-only table; `answers` stays room evidence. Every attempt
is kept. Each carries the client's attempt id as an idempotency key (for Phase 7's
outbox), the language shown, the mode (practice, exam, Get Ready, review or lesson), the
hints used and the time taken. Hub attempts never move a room ladder and never count in
attainment or the marks register.

*What was built.* `hub_attempts` (`0026`: one row per account and client attempt id,
append-only by a guard trigger), `services/hubPractice.js` and `routes/hubPractice.js`.
The server marks every attempt from the stored question and never reads a client's own
verdict. A resent attempt id returns the stored result and adds no row. The unit tests
and `server/scripts/practice.mjs` check that a room's answers, profiles and attendance,
attainment, the student report and the register are byte-identical before and after hub
practice.

*Defaults chosen:*
- **A hub attempt is deleted with the student's account** (cascade, as are their checks,
  self-tests, goals, hint views and language choice), **while room answers keep their
  roll number.** The legal review of decision 8 should confirm this.
- An answer is taken for a question practice could have served: active, or discarded
  after it was once approved (or the professor's own). Never a draft, a rejected draft, a
  poll or a question showing an uploaded image.
- **Image questions are left out of hub practice for now.** The image rule
  (`services/media.js`) serves an upload only through a running room, and an `<img>` sends
  no token. Serving them needs a hub-aware image rule.
- **The fewer-choices support is not applied in the hub for now:** every student is shown
  the full list and marked on it, in practice, lessons, Get Ready and self-tests. Applying
  it needs the account's supports read when a question is served and when it is marked.
- One shuffle seed for the whole hub, the student and the question (`hubSeed`), so the
  server rebuilds what was shown when the answer comes, and the error log redraws a
  lesson's answer the same way.
- An answer over 20,000 characters is refused (400) and not stored. The time taken is the
  device's, may be missing, and is never used for marking.

**H6. Mastery: Elo.** Decided under the owner's delegation, 19 Nov 2026. An Elo rating per
(student, topic) and per question difficulty, item ratings seeded from the Bloom level,
with an uncertainty-based K (Pelánek 2016). Topic states: Not started (no attempt); Not
sure yet (fewer than 3, provisional, with N); In progress; Mastered (the estimated chance
on the topic's typical question at least 0.8, the decision-2 goal, from at least 5);
Needs review (spaced review is due). Every state carries N and a plain sentence, never a
rank. The room ladder is separate and unchanged.

*What was built.* `services/hubElo.js` (pure), `stateFrom` in `services/hubPractice.js`
and `services/hubProgress.js`. Nothing is stored: every rating is replayed on each read
from every hub attempt on the topic, by every student, in the server's order.

*Defaults chosen:*
- **Verified room answers do not seed or move a hub rating.** A room serves each student
  questions at the ladder's level, with retries and class discussion, so its right or
  wrong is not the same measurement. The estimate rests on hub practice alone, and every
  progress reply says so. Wrong verified room answers do enter the error log (H7).
- **Only a student's first attempt at each question moves a rating** (the student's and
  the question's), as in Pelánek's systems: a second attempt after the key was shown
  measures memory of that answer. Every attempt still counts as practice and activity.
  Since the merge, a lesson's answers count like practice.
- **The model:** P(right) = 1 / (1 + e^-(skill - difficulty)), and **K(n) = 1 / (1 +
  0.05n)** (`ALPHA` 1, `BETA` 0.05), of the size the paper reports, not yet tuned to
  BloomLoop's data. Skill starts at 0. **Item seeds by Bloom level: Remember -1.25,
  Understand -0.75, Apply -0.25, Analyse 0.25, Evaluate 0.75, Create 1.25.**
- **The typical question** is the median difficulty of the topic's practisable questions
  (0 when there are none).
- **Shown chances round down** ("about 7 in 10"), so an estimate never reads higher than
  it is. No figure is shown while a state is Not sure yet.
- **Needs review takes precedence** over the estimate's state once the topic has any
  answer (N > 0) and its review is due.
- **The thresholds count answers to DIFFERENT questions** (first attempts), not every
  attempt, because a repeat after the key was shown is not new evidence (the review fix;
  H6 says "attempts"). So a topic with fewer approved questions than a threshold cannot
  reach it however much it is practised. Then the state carries **`bankShort`**, and its
  sentence says the topic needs more approved questions instead of promising that more
  practice will get there.
- **Selection:** a question the student has not met, the one whose estimated chance is
  **nearest 0.7** (`TARGET_RIGHT`), so a new student starts at Understand, as in a room.
  Once every question has been met: the one answered wrong last, then the one met longest
  ago; never the question just answered unless it is the only one.

**H7. The error log, built automatically.** Decided under the owner's delegation, 19 Nov
2026. Its sources are wrong hub attempts and the student's own verified room answers
(marked "From class"). Each entry has the question, topic, Bloom level, confirmed
prerequisites, the student's response, and what was right (only after the attempt). It
is open or cleared; it clears when a later question on that topic, at that level or
above, is answered right.

*What was built.* `services/hubErrors.js` (pure), `errorLogFor` in
`services/hubProgress.js`, `GET /api/hub/errors`.

*Defaults chosen:*
- Room entries are the student's verified, final, marked answers: a wrong attempt
  followed by a retry, a poll and a class question's vote are left out.
- **One open entry per question:** the same question wrong again before it clears adds to
  it ("2 times", with the latest response). Once cleared, a new wrong answer opens a new
  one.
- **An entry clears only on a right answer to a DIFFERENT question** on the topic, at the
  entry's level or above, in the hub or in class: the same question right after its key
  was shown measures memory of the key. A provisional machine mark (a written answer)
  clears it, and the entry says so.
- **The error log never shows a room key that practice would not show anyway** (the
  review fix, which reconciles H7's "what was right" with the rule that keeps keys out of
  a student's answer history, `services/evidence.js`). What was right, and the
  explanation, are held back (`keyHeld`, with a sentence) on an entry whose question a
  room is asking now, and on a "From class" entry whose question is still active in the
  bank (a room may ask it again) but which practice cannot serve this student (it shows
  an uploaded image, say). A question retired or deleted since shows its key: no room
  serves it again. Staff views are unchanged.
- Known limits: entries and their explanations are shown in English, including those
  from a lesson or a translated question, and a lesson's entries read "From your
  practice".

**H8. Spaced review.** Decided under the owner's delegation, 19 Nov 2026. ts-fsrs (MIT)
with default parameters, one card per (student, topic). A review is a short practice set
on the topic, and the session's result maps to a rating, documented here. A "due for
review" list. No streaks: weekly consistency with rest days, from the student's own data
only.

*What was built.* `services/hubReview.js` (pure), `GET /api/hub/review/due` and
`GET /api/hub/consistency`.

*Defaults chosen:*
- ts-fsrs 6.0.0 with `generatorParameters()` defaults: request retention 0.9, the
  published default weights, no fuzz, learning steps of 1 and 10 minutes. A review set
  asks 5 questions.
- **A session is a run of the student's attempts on the topic, in any mode, with gaps
  under 10 minutes**, rated as one review at its last attempt. 10 minutes is FSRS's
  longest default learning step.
- **The rating:** each question's first attempt in the session counts once, and the share
  right maps to **Again under 0.4, Hard under 0.7, otherwise Good, and Easy at 0.9 or more
  from at least 5 answers with no hint** used in the session. 0.4 and 0.7 are the room
  ladder's own lines (decision 2). One right answer is Good; one wrong, Again.
- FSRS's learning steps mean a topic practised a few minutes ago shows "Needs review" 1 to
  10 minutes later. That is how FSRS works; the student's screens should say that a short
  second session soon after the first is part of learning.
- Weekly consistency: Monday to Sunday in India's time, the days practised and the days
  rested, from the student's own attempts. Rest days are named as rest. No streak is
  counted, kept or shown.

### Phase 6: Get Ready and refresher paths (H9)

**H9. Get Ready.** Decided under the owner's delegation, 19 Nov 2026. A short adaptive
check of at most 12 questions for a target topic the student chooses. It covers the
target's confirmed prerequisites, nearest first, and stops early when the evidence
suffices. Each prerequisite ends Ready, Needs review or Not sure yet. Then a refresher
path: the prerequisites that need review, in dependency order, each with "why this is on
your path" in the student's own counts, ending at the target.

*What was built.* `services/hubGetReady.js` and `routes/hubPaths.js`. A check is a
`hub_runs` row (`0028`), written once and then ended once; its answers are hub attempts in
mode `getready`, filed under it.

*Defaults chosen:*
- **The stopping rule, per prerequisite:** two right is Ready and two wrong is Needs
  review; after one of each, a third question decides, and two of three right is Ready.
  At most 12 questions in all, nearest prerequisite first. The check stops when every
  prerequisite is decided or the 12 are used. Each answer counted is the first to a
  different question.
- **Mastered in practice:** a prerequisite the student had already mastered in practice
  when the check started (and not due for review) is Ready without asking, citing its N.
  This is fixed on the run at the start, with the prerequisites and their names.
- **Not sure yet**, each with its own sentence and counts, when: the 12 questions ran out
  on it; they ran out before the check reached it; the professor approved too few
  questions on it to decide; the professor approved none; it is in material on none of
  the student's classes; or **the check ended before deciding it** (`ended`, the review
  fix). The builder's report lists five reasons; the code has these six.
- **Feedback after each answer**, as in practice: right or wrong, the right answer, the
  explanation and the feedback on a wrong option chosen. H9 does not forbid it, and the
  answers count in mastery and the error log at once. No hints.
- The next question: one the student has never answered in the hub first, then any other,
  in an order seeded by the check (not by Elo, so a reload shows the same question). Never
  one already asked in this check, and never one closed by a room or an open self-test:
  when only closed ones are left, the check waits and says why.
- **A refresher step is done** when the student's answers on it since the check are two
  right in a row, or two right of their last three. **A question counts once per round**
  (the review fix): answered again, it counts only once every practisable question on the
  topic has been answered since, so a key just shown is not evidence, and a topic with
  few questions can still be finished. The path follows `dependencyOrder` over the
  professor's confirmed links and ends at the target.
- **An ended check stays ended** (the review fix). Once its end is written it takes no
  answer (409), a prerequisite it had not decided reads Not sure yet whatever changes
  later, and its refresher path stays.
- A student may have several checks open at once. A student cannot end a check they have
  left: its current question stays closed to practice and lessons until they finish it
  ("Phase 6: the shared question bank", item 4).

### Phase 6: practice and self-tests (H10)

**H10. Modes.** Decided under the owner's delegation, 19 Nov 2026. Practice: feedback
after each item, hints available. Exam (a self-test builder): chosen topics and levels, at
most 30 questions, an optional time limit, mixed; no hints and no feedback until it is
handed in; kept as evidence, counted nowhere official. Written answers get provisional
machine marks, labelled as such.

*What was built.* Practice in `services/hubPractice.js`; self-tests in
`services/hubExam.js` and `routes/hubPaths.js`, each a `hub_runs` row (`0028`); the rule
that holds a self-test's answers back in `services/hubHeld.js`.

*Defaults chosen:*
- A self-test takes 1 to 20 topics, any of the six levels (all by default), 1 to 30
  questions (10 by default) and an optional limit of 1 to 180 minutes. The list is fixed
  at the start: one question from each topic in turn, those the student has not met
  first, in an order seeded by the self-test, then shuffled. If fewer match, it has those
  and says so.
- While it is open: no hints and no feedback; an answer's reply says only that it was
  saved. Changing an answer is a new attempt, every attempt is kept, and the last one
  before the end counts.
- **The 30-second grace:** a timed self-test ends at its deadline plus 30 seconds on the
  server's clock. The device's clock is never trusted.
- **Late answers are kept, marked late, and not counted.**
- **Unanswered questions keep their keys hidden** (and their explanations) after
  hand-in, so an empty self-test cannot be used to read the bank's answers.
- **Final answers count in personal progress after hand-in:** the student's own mastery,
  error log and reviews. Until then they are held back. "Counted nowhere official" means
  no room, attainment figure or register.
- **Several self-tests may be open at once**, and Get Ready checks beside them.
- **Questions on an open self-test keep their hints closed everywhere** (practice, review
  sets, lessons) until it is handed in or times out (the merge). Since the review fix they
  are not served or taken in practice or lessons either ("Phase 6: closed questions").
- **The professor's option feedback is shown in the result, after the end**, like the
  explanation (H14), for answered questions only (the merge).
- A student who no longer reaches a question's topic (removed from the roster, chapter
  taken off the class, topic retired) does not see it while the self-test is open; in the
  result an unanswered one is not shown, and an answered one shows from the student's own
  attempt (the review fix).
- An open self-test's answers are left out of the staff activity counts until it ends.
  The student's weekly consistency counts them at once, since it says nothing about right
  or wrong.

### Phase 6: lessons and languages (H11, H12)

**H11. Lessons.** Decided under the owner's delegation, 19 Nov 2026. Per topic, generated
on the professor's button from that topic's slides (decision 1): a slide chunk (the
professor's own text, cited), then one worked example (an AI draft), then 2 to 4
retrieval questions (drafts, through the normal approval gate), then the next chunk. A
lesson is "AI draft" until approved; regenerating keeps the approved lesson until the new
one is approved. The offline form is slide chunks plus questions already approved, no
generated prose, labelled "slides only".

*What was built.* `topic_lessons` (`0027`), `services/hubLessons.js` and
`routes/hubLessons.js`. A lesson's answers go into practice's attempt store
(`services/hubAttemptBridge.js`, connected at the merge), once per attempt id, in mode
`lesson`.

*Defaults chosen:*
- **A slides-only lesson also needs the professor's approval**, because the chunking is
  the machine's. A student never sees an unapproved lesson of either kind.
- **Retrieval questions are Remember-level "Choose one" or "True or false" only**
  (recall). They pass the generator's own validator, are written into the bank as drafts
  (source `llm`, the model named, cited to their chunk's slides, rule checks run), and are
  approved only in the bank. Approving a lesson approves none of its questions.
- A slides-only lesson uses the topic's active questions except polls and written
  answers, lowest level first, at most 4 per chunk.
- A lesson is cut at 8 chunks of at most 900 characters and 3 slides each, and a warning
  names the slides left out. A topic with no text is refused (409) before any run starts.
  One lesson run per topic at a time.
- **A lesson cannot be edited, only regenerated or discarded.** It is written once (the
  `0027` guard), so what a student read is kept. An approved lesson cannot be withdrawn
  without approving a replacement. Lessons and translations are never deleted, only
  discarded or superseded.
- An answer to a lesson superseded while the student had it open is still taken; an
  answer to a draft or discarded lesson gets the lesson's 404. Only a question that was
  once approved can be answered in a lesson: a rejected AI draft gives 404 (the review
  fix).
- Since the merge a lesson's answers count in the student's mastery, error log, reviews
  and staff activity, like practice, and in no room, attainment figure or register.
- The text comes from the topic's slides on a deck that kept them; on an older deck, from
  the chapter's text between the topic's heading and the next topic's, citing the topic's
  slides together and saying so; from pasted text with no slide cited, saying so.
- Known limits: a bank generate in "replace" mode deletes a lesson's questions too, and
  the staff view counts them as gone; a restart mid-run can leave a lesson's bank drafts
  with no lesson (ordinary drafts the professor can reject).

**H12. Languages.** Decided under the owner's delegation, 19 Nov 2026. English is the
original. Hindi and Marathi versions of questions, explanations, hints and lessons are
generated on the professor's button, stored per item and language as draft or approved
with who approved. A student sees a translation only once it is approved, otherwise
English with a plain note. Technical terms stay in English. The language shown is
recorded on every hub attempt, and by-language item statistics feed Phase 5's
translation warning.

*What was built.* `item_translations` and `student_language_choices` (`0027`),
`services/hubLanguages.js` and `routes/hubLanguages.js`.

*Defaults chosen:*
- One generic store for every kind of item. **Questions, explanations, lessons, hints and
  feedback are translatable** (explanations since the merge, hints and feedback since the
  tutor). **Only a question's wording and its options** ("Choose one", "Choose all that
  apply", polls) are translated, positions unchanged, so marking and the solution are the
  same in every language. Pairs, groups, sequences, passages and typed answers stay in
  English, and the staff view says so per question.
- **Blocking findings and flags.** A missing field (`missing`), a list of another length
  (`count`) or a different number of `____` gaps (`blanks`, the review fix) blocks
  approval outright. Changed numbers, formulas or code, or a sentence of four or more
  English words with no Devanagari at all, are flags: approval then needs a second,
  confirming press, because a Hindi ordinal can legitimately drop a digit.
- **A translation is stale once its English changes** (each keeps the English it was made
  from, and its hash). A stale translation is never shown, and approving a stale draft is
  refused until it is edited against the current English.
- **A translation with any blocking finding is never served**, even one approved before
  the rule existed (the review fix).
- Hand-written translations are allowed, which matters offline, and stay drafts until
  approved. Editing an AI draft makes it the professor's.
- **Every hub attempt records the language shown:** the screen's echo when that
  translation is of this item and language and was approved at some point, otherwise what
  would be shown now.
- **Language statistics use each student's first graded hub attempt** per question, with
  Phase 5's thresholds (at least 5 answers in each of two languages, more than 20 points
  apart).
- Translations of a draft lesson may be made and approved; a student sees them only once
  that lesson version serves. Choosing a language is for students only; staff may preview
  a lesson in any language.

### Phase 6: the hint tutor and explanations (H13, H14)

**H13. A tutor with no live model call.** Decided under the owner's delegation, 19 Nov
2026. Decision 5 stands, so the tutor needs no model while students use it and costs no
quota. Each question may carry an approved hint ladder of up to 3 steps (a nudge, a
strategy, and a worked step that stops short of the answer), and each wrong option its
own feedback, both generated on the professor's button and cited to slides. In practice,
hints may be asked for at any time; the explanation and the answer come only after an
attempt. Which hint comes first uses the student's recent attempts, the wrong option they
chose and their topic state. Hints used are recorded. A live chat tutor is not built.

*What was built.* `question_hints`, `option_feedback` and `hub_hint_views` (`0029`);
`services/hubTutor.js`, `services/hubHintHook.js` and `routes/hubTutor.js`.

*Defaults chosen:*
- **Hints in practice, review sets and lessons only; never in a self-test or Get Ready.**
  Review sets are practice sets (H8), and their Easy rating already depends on hints. The
  routes answer 400 in those two modes, the database refuses a hint there, and their
  attempts record 0 hints.
- **The first hint, as built:** approved feedback on the wrong option the student chose
  last time comes first, in place of the nudge, and the ladder goes on from the strategy.
  Wrong after k hints last time starts the ladder at step k + 1. More than half of their
  last five answers on the topic wrong (from at least three), or an estimate that is not
  provisional and under an even chance on the topic's typical question, starts it at the
  strategy. Otherwise the nudge comes first. A ladder too short offers its deepest step.
  Only attempts whose results the student has already seen (practice, review, lesson) are
  read; a self-test's and a Get Ready check's never are.
- **Hints are tied to the client's attempt id:** one question per id, the plan fixed at
  the first hint, at most 3 per attempt. Once the attempt exists its hints are closed
  (409). Asking again for a step already opened returns it and records nothing
  (idempotent per step). Hints opened for an attempt never answered are kept.
- **`hints_used` counts the distinct hints the student opened on the question since their
  previous answer to it, under any attempt id**, capped at 3, and 0 in a self-test or Get
  Ready (the review fix: before, only hints under the attempt id sent with the answer
  counted).
- **The leak check** refuses a hint or feedback holding the right option's words, letter
  or number; a numeric answer within its tolerance; an accepted typed answer; a statement
  that a true-or-false claim is true or false; a whole pairing, grouping or order; the
  words a hot-text question asks for; or a rubric point word for word. It runs when a
  professor writes, when the model's reply is parsed, at approval, and again before
  serving, since a key can change. **It is lexical only:** a hint that gives the answer
  away in other words passes, and the professor's approval is the real safeguard.
- **A translated hint or feedback that fails the check is shown in English**, with a
  plain note, and the language actually shown is recorded. Open: the check reads the
  translation against the English question only (open items).
- **The professor's own hints and feedback are approved as written**, as explanations
  are. AI drafts wait for approval, per question, each leak-checked again first.
- **Drafts only for approved questions that are not polls and show no uploaded image**,
  and only for the steps and options they lack. **None offline:** a hint cannot honestly
  come from a template.
- **Feedback is keyed by the option's words**, as misconception labels are, so a reorder
  keeps it and a reworded option no longer shows it (it is kept, and listed for staff).
  It is shown after a wrong attempt in practice, lessons and Get Ready, in a self-test's
  result after the end, and offered as the first hint the next time the student meets
  the question.
- A hint cites the question's own slides by default, else its topic's; a pasted-text
  chapter has none.
- Known gaps: hints and feedback do not follow a regenerated question; option letters are
  checked because the hub shows choice options in their stored order, so the letter check
  needs revisiting if they are ever shuffled.

**H14. Explanations.** Decided under the owner's delegation, 19 Nov 2026. An approved
explanation per question, drafted by the AI on the professor's button or written by the
professor; shown after an attempt in practice, and after hand-in in a self-test.

*What was built.* `question_explanations` (`0026`), `services/hubExplanations.js`, and
their routes in `routes/hubPractice.js`.

*Defaults chosen:*
- **A professor's explanation is approved as written** (provenance `professor`, no
  model).
- **Approving an AI draft keeps provenance `ai`**, shown to the student as "Written with
  AI help and checked by your professor." A professor's edit makes it theirs.
- Drafting fills only questions with no explanation, at most 60 per press; with no model
  it drafts none and says so.
- Shown after an attempt in practice, review sets, lessons and Get Ready, and in a
  self-test's result for answered questions only. Translatable since the merge; a
  translation stops showing when the explanation is rewritten.

### Phase 6: what students and staff see (H16, H17)

**H16. The student's view: personal progress only.** Decided under the owner's
delegation, 19 Nov 2026. A mastery map by unit and topic, goals tied to an exam date the
student sets, due reviews, and weekly consistency with rest days; their own past only.
No ranks, coins, streaks, leaderboards or class averages.

*What was built.* `GET /api/hub/home` and goals (`services/hubGoals.js`, `hub_goals` in
`0028`), and `GET /api/hub/progress`.

*Defaults chosen:*
- **No rank, average, streak, coins or band name on any student payload.** The unit tests
  and `server/scripts/paths.mjs` check the hub home for them.
- **Goals are private to the student**: no staff route reads them. At most 10 goals, each
  of 1 to 60 of the student's own topics, with an exam date of today or later when it is
  set or changed (an unchanged past date may stay). A goal's progress gives counts per
  state, N per topic, the days left and what to do first.
- The home still renders when goals or refresher paths cannot be read (a database without
  `0028`): that part carries a sentence instead.

**H17. The staff view.** Decided under the owner's delegation, 19 Nov 2026. Per student:
topic states with N, recent activity counts, open errors per topic, Get Ready results.
Per class: students per topic state, in roll order, no ranking. The student's hub page
says plainly that their professor can see their progress.

*What was built.* `services/hubProgress.js`, `studentsByState` in `services/hubGoals.js`
and `checksForStaff` in `services/hubGetReady.js`, through `routes/hubPractice.js` and
`routes/hubPaths.js`. The class's owner and the department's HOD read; a student gets 403.

*Defaults chosen:*
- **The student's hub page says the professor can see their progress:** "Your professor
  can see your progress in the hub: the topics you practise and how you are doing on
  them." It is on the hub's first read, the hub home and the progress read.
- **Staff views list students in roll order**, never by a figure. A roster row is tied to
  a student account by the access rule's terms; a roll number held by no account, or by
  two, shows no data and says why.
- **Hints opened are shown to staff as counts** (hints used, and attempts with hints), so
  the student's note that their professor can see how many they used is true. Which
  hints a student opened on each attempt is stored but shown on no staff screen.
- **Staff reads write nothing.** The staff Get Ready read works out a complete check's
  end without storing it.

### Phase 6: the three new dependencies (H18)

Decided under the owner's delegation, 19 Nov 2026: three server dependencies, each MIT
and free, pinned exactly in `server/package.json`. `CONTRACT.md`'s "No new npm
dependencies" is amended for these three (Amendment 6). No client dependency was added.

| Dependency | What for | Alternatives |
|---|---|---|
| `ts-fsrs` 6.0.0 (MIT) | Spaced review (H8), with its default parameters | The older SM-2 algorithm, which FSRS beat at predicting recall for 99.6% of 9,999 Anki users' collections (the gap analysis, citing the srs-benchmark). No other FSRS implementation or scheduler was evaluated. The gap analysis notes that ts-fsrs suits single facts; the hub keeps one card per topic and turns a short practice set into its one rating (H8) |
| `temml` 0.14.0 (MIT) | Formulas to MathML on the server, with mhchem's `\ce{}` (H15) | **KaTeX, run on the server** (MIT), is the named fallback if native MathML looks poor on a low-end Android phone, which has not been tried. Its output needs KaTeX's fonts on the phone (`reports/BloomLoop visuals research.md` measured KaTeX at 75.8 KB plus fonts). No other formula renderer was evaluated |
| `shiki` 4.6.0 (MIT) | Code highlighting on the server (H15) | None was evaluated. Shiki's JavaScript regex engine is used, not its WebAssembly one. Without shiki, code blocks would be shown escaped and uncoloured, which is what the server already does when the highlighter cannot load |

### Phase 6: closed questions (the review fix)

**Widened by Batch 9's E1 (20 Nov 2026):** a room not yet closed now closes its whole
question set, not only the question a phone is on ("Batch 9: E1 to E7", below). The
rest of this section still holds.

Decided under the owner's delegation, 19 Nov 2026, in the review fixes, within H9, H10,
H13 and H14 and the room's own rule that a question's answer is never shown while it is
being asked. Practice, a lesson and the tutor show a question's key, explanation and
hints to anyone they may serve it to. So `services/hubClosed.js` works out on every
request, writing nothing, which questions are **closed** to a student now:

- **A room is asking it:** a phone in a room on its chapter that is not closed (open,
  paused or waiting) has been served it and not finished it, or the room's class question
  on it is still running. Any phone counts, not only this student's: rooms need no
  sign-in (decision 7), so a phone in the room may be this student under any roll number.
- **It is on one of the student's open self-tests** (a timed self-test is over once its
  deadline and 30-second grace have passed).
- **One of the student's open Get Ready checks is asking it.**

While a question is closed: practice and review sets never serve it, and say so when
nothing else is left; an answer to it in practice, a review set or a lesson is refused
with a 409 naming the reason, and nothing is stored (the device keeps it and sends it
again later); no hint opens on it. Get Ready skips questions closed by a room or a
self-test and refuses an answer to one. A self-test's result keeps back the key, the
explanation and the option feedback of a question a room is asking now (right or wrong
is still shown), and the error log does the same (H7). Checked by
`server/test/hubFixes.test.js`, and by `server/scripts/practice.mjs` over a real socket
room.

**Corrected from the reports, by the code.** The Get Ready builder and the merge report
listed as not fixed that practice could serve and mark a question on the student's open
self-test, showing its answer before hand-in; the closed-questions rule now refuses it.
The merge report also said the practice route answered a reused lesson or Get Ready
attempt id with the self-test sentence; the code now answers "That attempt id was used
for another answer. Send this one with a new id." and keeps the self-test sentence for an
id a self-test holds.

### Phase 6: owner option, a live chat tutor (not built)

H13 says a live chat tutor is not built, and that the owner may turn one on later, with
its cost. What it would take:

- **A model call per student message**, all day in term time. One class of 60 students at
  20 messages a day is about 1,200 calls a day per class, so quota and cost grow with
  use, not with professor presses.
- **A connection**, so it does not work offline (Phase 7).
- **No approval before a student reads it:** a reply cannot be checked by the professor
  first.
- **Guardrails** against giving the answer away and against answers off the professor's
  syllabus (decision 1), and **a DPDP review of student chat logs** (decision 8).
- **It conflicts directly with decision 5** (no model call in anything a student waits
  on, and no model output a professor has not approved reaches a student). It needs the
  owner to reverse decision 5 explicitly.

The approved hint ladders, option feedback and explanations built in Phase 6 give
step-by-step help without any of these costs. Nothing is built towards a chat.

### Phase 6: the shared question bank (decided, to be built in batch 8)

**The problem.** Rooms and the hub share one question bank. Practice (H5, H14) shows the
key of every approved question after a single try, so a student can collect, before
class, the keys of questions a graded room will later ask. The review fix closes only the
questions a room is asking right now (and a running class question). Any approved
question in the student's scope can still be answered in practice by its id, which is the
same exposure as practising it.

**Decided under the owner's delegation, 19 Nov 2026, to be built in batch 8:**
1. **"Rooms only".** A professor can mark a question "rooms only", and the hub never uses
   it.
2. **The room avoids what was practised.** A room does not serve a student a question
   they have already practised when another question of that level exists.
3. **Practice marks only what practice served.** An answer is taken only for a question
   practice actually served to that student. The fix's report named two ways to do it:
   a store of served questions (a new table and migration), or a server-signed serve
   token that the device sends back (client work and an API change). Batch 8 chooses.
4. **A student can end a Get Ready check.** Today a check has no end if the student
   leaves it, so an abandoned check keeps the question it is asking closed to practice,
   lessons and hints until the student finishes it, and each open check adds a few reads
   to every practice request.

None of the four is built. Until they are, the exposure above stands. **Built in Batch 8 (`ba0f59d`, 19 Nov 2026)**, with
serve tokens for item 3 ("Batch 8: the shared-bank rules", at the end).

### Phase 6: open items for the owner

From the review fixes and the verification findings. Nothing is built that settles them.

1. **A resent practice attempt id is still answered with the stored key**, even if the
   question has since become closed. The student was shown that key when the attempt was
   first stored, so it is not a new leak; it was left as it is.
2. **Nothing was run against Supabase or Mongo** ("Not tested", above). The reads the
   review fix added already existed in all three stores and their filters were read in
   the code, but only the in-memory store ran. Response times with many open rooms or
   many open checks were not measured either.
3. **The `0025` loop guard takes no lock across two server processes.** Two processes
   confirming one link and its reverse at the same moment can both pass (under READ
   COMMITTED), leaving a loop among confirmed links; the in-process lock covers one
   process only. A low, unconfirmed verification finding, not acted on.
4. **The translated-hint leak check uses the English question.** A Hindi or Marathi hint
   or feedback that names the right option in its translated words, which the student
   sees beside the approved translated options, would pass. It is approval-gated, but
   the promise that a translated hint giving the answer away is never shown does not
   hold in the student's language. A low, unconfirmed verification finding, not acted on.
5. **Practice hints on a topic an open Get Ready check is asking about.** Since the
   review fix the question the check is asking now is closed, its hints included; the
   topic's other questions and their hints stay open. (The merge report listed the whole
   topic as open; the code closes that one question.) Closing the whole topic would shut
   it for as long as a check is left unfinished, so batch 8's "end a check" comes first.
6. **The self-test 409 wording on a lesson or Get Ready id: fixed, not open** (see the
   correction under "Phase 6: closed questions").
7. **`hub_attempts` keeps no lesson id, lesson version or translation id.** A lesson
   attempt keeps mode `lesson` and the language shown, not which lesson version or which
   translation; keeping them needs a migration.
8. **Decision 8 and the hub.** Each hub table holding a student's data is deleted with
   their account, while room answers keep their roll number: the legal review should
   confirm this. None of decision 8's notice, consent, export, erasure, retention or
   audit pieces was built in Phase 6.
9. **Scaling.** Every progress, due list, next question and class read replays every
   attempt on the topics involved, so a large class over a semester means thousands of
   rows per read on Supabase, where PostgREST pages at 1,000 rows. If it gets slow: a
   per-topic cache, or stored ratings with the replay kept to rebuild them.
10. **Earlier-semester prerequisites** shown to a student by name (H3): keep, or filter
    on `onYourClasses`.
11. **Left out of the hub for now** (H5): image questions, and the fewer-choices
    support.

### Phase 7 in brief: offline-first, what to read first, and what is open

Phase 7 makes a class work when the network does not: the phone keeps answers it could
not send and takes a few questions ahead, and the server marks them when they arrive; a
professor's console keeps its records the same way; and a laptop can be the whole server
in a room with no internet. The owner said "continue with phase 7"; O1 to O5 below were
**decided under the owner's delegation, 19 Nov 2026**, in the directive's three stages
(First, Next, Then). Server and database: `0030` to `0032`, committed as `46bf6f9`. The
phone's stage-First pieces are the UI session's (`docs/UI_REBUILD.md`). `CONTRACT.md`
Amendment 7 records the contract side. Rules that hold throughout:

- **The server is the source of truth for order and marking.** Answers are marked in the
  order they arrive; a device's clock is stored for the record and never read.
- **Keys never go to a device.** A pack holds questions without their keys; an answer
  made offline is "saved, will be marked when you reconnect".
- **Nothing that reaches the server is dropped silently.** An answer is stored and
  counted, stored and not counted (and the phone is told), or refused for good (told,
  and kept on the phone).
- **No paid service** (O5).

**Read these first:**
1. **The owner's items** ("Phase 7: items for the owner"): the shared key over plain
   HTTP on a LAN, no general rate limit per socket, `student:next` browsing, and the
   deployed server's `trust proxy`.
2. **Imported rooms are labelled, not authenticated** (O4, below).
3. **Answers after the grace window are stored, not refused** (O2, below).

**Not tested.** Nothing in Phase 7 ran against a real Supabase, PostgREST, Postgres or
MongoDB (PGlite for the SQL, stubs for the Supabase requests, the parity test for Mongo).
No real phone, hotspot or travel router was used; time-based rules were tested by moving
the process clock. The phone's outbox and service worker were checked by the UI session
in headless Chrome only; the console's outbox, the import screen and the laptop banner do
not exist yet.

### Phase 7: O1 to O5, as built

**O1. Stage "First": the phone keeps working offline.** Decided under the owner's
delegation, 19 Nov 2026. A service worker with app-shell caching for `/join`; an
IndexedDB append-only outbox of answers and votes; reconnection with retry and backoff;
"saved on this phone / sent / marked" indicators. The outbox replays in order and never
drops an item; one the server refuses for good is kept and shown.

*What was built.* The phone's pieces, by the UI session (`fdac198`; `docs/UI_REBUILD.md`,
"Phase 7, stage First"). On the server, every answer reply now names the phone's
`questionId` and `answerId`, so the outbox matches replies by key (the UI session's ask),
and two new replies settle an item, `server:kept` and `server:refused`. **On the staff
side** (the console's records, gap F1), O1 applies too: every teacher-record and
attendance write takes an optional `Idempotency-Key`; a write sent again is done once and
answered with the kept reply; a key reused with other details is refused. A write made
from a record that has since moved on (`basedOn`) is refused with the record as it
stands, and the professor decides. Tally steps from two devices add up and are never
stale. Device clocks are never compared, only the server's own stamps, for equality. No
batch route: the outbox sends one write at a time, through the same code as a live
write.

**O2. Conflicts and late answers.** Decided under the owner's delegation, 19 Nov 2026.
Evidence is append-only, so the only conflicts are duplicates (the idempotency key) and
late arrivals. The server decides order and marking.

*What was built, and the defaults.*
- **The grace window is 10 minutes** after the close (`GRACE_MINUTES`, the edge
  included), judged by the server's clock when the answer arrived. An answer to a
  question served or packed to that phone before the close, arriving in it, counts.
- **Every other late answer is stored, marked as arriving after the close, and not
  counted**, one arriving long after the window included (a phone may deliver to a
  closed room at any time while the room exists). Its row carries **no mark** (the
  machine's reading beside it for staff), so a phone's own answer list never becomes a
  key oracle after the close; the phone is told it is saved and does not count.
- **Past the room's cap**, an answer to a question served or packed to the phone is
  stored, not counted; one to a question never given is not taken (`0018`'s rule).
- **A second answer to a question already marked** is stored, not counted; the same
  answer again (a double-tap) is told its mark.
- **An answer to a question this room never asks is refused for good** and not stored,
  so another chapter's question never enters the room's record.
- **At most 100 kept answers per student per room** (`KEPT_LIMIT`); past that,
  `server:refused` and nothing stored.
- **The phone's own time is stored**, never read for order or counting.

**O3. Stage "Next": question packs.** Decided under the owner's delegation, 19 Nov 2026.
After joining, a phone may take a small pack of keyless, approved questions; offline it
works through them by a tiny fixed rule, and the server marks them when they arrive.

*What was built, and the defaults.* **A pack holds 5 questions** (`PACK_SIZE`): 3 at the
working level, 1 below, 1 above (`PACK_SHARE`); inside the below-40% band, Remember and
Understand only. **It lasts 6 hours** (`PACK_HOURS`) or until the room closes; an answer
to a question of an expired pack still counts as served. It is recorded before it is
sent, at most 50 records per phone per room. **One go per packed question**, and per any
answer not to the question on the screen: there is no screen to retry on, and retries
would let a phone probe a key. Client-side selection was evaluated and not built
(`docs/OFFLINE_SELECTION.md`: selection needs marks, marks need keys, and keys never go
to a device; the integrity trade-offs accepted are listed there).

**O4. Stage "Then": the laptop as the server, and imports back.** Decided under the
owner's delegation, 19 Nov 2026.

*What was built, and the defaults.*
- **Laptop mode** (`npm --workspace server run laptop`) turns every network service off,
  whatever `.env` says, and runs on the in-process store.
- **The teacher key is at least 16 characters**; unset, the laptop draws a random key of
  24 characters at every start. A shorter one stops the start with a sentence.
- **10 different wrong keys from one address within 10 minutes** shut that address out
  of the key for 10 minutes (laptop mode only).
- **Pages are accepted only from the laptop's own addresses** on its port.
- **Rooms are saved to disk every 60 seconds** (`LAPTOP_ARCHIVE_SECONDS`, 1 to 3600)
  while they change, at once when closed or deleted, and at a normal stop. Each write is
  atomic, confined to the folder, and readable by the laptop's user only.
- **Imports accept only files laptop mode saved** (the laptop mark), idempotent by the
  laptop's room id. The professor chooses the cloud chapter and class; the laptop's own
  ids are used only if they name hers. A room saved while running is imported closed as
  of when it was saved. Attendance marks for roll numbers not on the roster, and the
  laptop's teacher records, stay in the stored file. A later save of an imported room is
  never merged. An HOD reads the import list and imports nothing.
- **Imported rooms are labelled, not authenticated.** Anyone can write the laptop mark,
  so every staff view and report says a room was imported, with a note that the file was
  checked for its shape, not that it is unchanged; attainment and the register can leave
  imported rooms out (`?imported=leave-out`).
- **A room code already taken online gets a fresh code** at import; only a clash of room
  id refuses.
- **A room imported from laptop mode takes no deliveries from phones**, inside the grace
  window too: its phones answered on the laptop, and its file is its whole record. An
  imported answer keeps the phone's own time for the record.
- **The travel-router guide** is `docs/TRAVEL_ROUTER.md` (router, power, address,
  steps). Its phone counts and battery life are typical figures, not measured.

**O5. No paid service.** Decided under the owner's delegation, 19 Nov 2026. Workbox is
not added: the service worker is hand-written. Phase 7 adds no server dependency; any
library the client adds must be MIT-class and named.

### Phase 7: items for the owner

Nothing is built that settles these.

1. **The shared key over plain HTTP on a LAN.** In laptop mode the key travels in clear
   on a Wi-Fi the whole class has joined; anyone with the Wi-Fi password can read it if
   the console is opened from another device. The guide says to open the console on the
   laptop only. One option would close it: accept the key in laptop mode only from the
   laptop's own addresses, which would stop a tablet console. HTTPS would need a
   certificate on every phone, or a public name with a certificate.
2. **No general rate limit per socket.** Only pack requests are folded (one in flight per
   connection). Answers, joins and `student:next` can be sent without limit; kept answers
   are capped at 100 per student per room.
3. **`student:next` browsing.** Each `student:next` puts a fresh question on the screen
   (before Phase 7 too), so a phone can read questions at its working level one at a time
   without answering, keys withheld.
4. **The deployed server's `trust proxy`.** It sets none, so it sees one address for
   everyone, and the wrong-key counter runs in laptop mode only. Setting it to match the
   host's proxy would let the counter run online too.

Also open, lower: an answer past the room's cap to a question never given is still not
stored (the owner may want it stored as kept); the grace window is a constant, a room
setting later (O2 says so); no fresh pack is pushed when a class question starts; the
laptop loses chapters, questions, classes and rosters at a restart (a "take a chapter and
class to the laptop" export and import, keeping cloud ids, would also let imported
answers keep their question ids).

### Phase 7: adaptive paper cards (deferred)

The directive says to consider adaptive paper cards last. They are not built and not
designed; nothing in Phase 7 depends on them.

### Batch 8 in brief: figures, interaction kinds and the design-zip gaps

Server and database committed as `ba0f59d` (`0033` to `0035`); the screens are the UI
session's (`4384844`), checked against local servers only, never on a real phone. Every
choice below was **decided under the owner's delegation, 19 Nov 2026**. The research
behind the visuals is `reports/BloomLoop visuals research.md`; the gaps are
`docs/UI_ZIP_AUDIT.md`. Batch 8's two reviewers were still running when it landed, so
their fixes follow.

### Batch 8: the visuals decisions

- **Code-drawn figures only, never image-model output** (decision 4 as revised). The
  model and the professor describe a figure as data; the server checks it and draws it.
  No code, raw SVG or expression is accepted from anyone: functions come only from fixed
  families with numeric parameters, so there is no expression evaluator.
- **Maps are not generated.** Indian law makes publishing a map of India that does not
  match the Survey of India's punishable (Criminal Law Amendment Act, 1961). Maps come
  only from the professor's own pictures. Generated maps wait for a compliant boundary
  source **and a lawyer's confirmation**.
- What code cannot draw (anatomy, apparatus, artworks, maps) is the professor's own
  picture, for example one kept from their slides. A slide picture keeps the alt
  "Picture from slide N (not yet described)" and must be described before use. At most
  60 pictures per deck, each once at the first slide showing it.
- The model may draw only a plot, a chart or a number line, the types whose answers the
  server can read. Its figure is never repaired: one that fails is dropped with a
  sentence. A key read off a figure is used and the disagreement flagged; chart values
  that disagree with the stem's numbers are flagged, not changed.
- The molecule's stated formula must match RDKit's (condensed forms such as `C2H5OH`
  are accepted). Graphviz boxes are sized from our own grapheme measurement, so Hindi
  and Marathi fit. Figure labels are not translated.
- A lesson figure is stored as a `chunk` step carrying `figure`, because re-running
  `0027` re-adds its step-type check. The room archive keeps drawings only within 1 MiB.
  The render cache holds 400 entries.
- Image regions are staff-only except as the zones of a tap or label question.

**The five interaction kinds.** Levels: `hotspot` at Remember, Understand and Analyse;
`label` at Remember and Understand; `plot` at Apply, and at Create only with conditions
that leave more than one line; `numberline` and `chart` at Apply. None is in the default
mix, as for `numeric`: a chapter with no figure would push the model into drawing one.
"Within a grid step" means strictly less than one step; a stated tolerance is inclusive.
Hotspot and plot points are marked like choose-all; label and conditions get partial
credit; a number line's interval ends are worth half each and extra marks cost one each;
a chart is marked per bar. Zone tokens are shuffled per student, so no part name reaches
a phone.

### Batch 8: the shared-bank rules (the Phase 6 decision, as built)

- **Rooms only** is a per-question switch the owner sets. The hub never serves, shows or
  explains such a question (practice, reviews, lessons, self-tests, Get Ready, hints and
  the student's own error log); staff still see it. Rooms are unaffected.
- **Rooms avoid practised questions.** For a signed-in student, the selector avoids, at
  the level it chose, a question they practised in the hub while another of that level
  is left. Such an answer still counts; staff see a neutral note, never a label on the
  student.
- **Serve tokens**, chosen over a table of served questions: practice and lesson answers
  are taken only with the server's signed token from the serving reply. A 7-day expiry,
  because offline outboxes replay late; a resend of a stored answer needs none. The
  secret is `SERVER_SECRET`; its fixed dev default means a restart does not
  refuse answers waiting on phones, so **a deployment must set its own**.
- **A student can end a Get Ready check.** Undecided prerequisites become Not sure yet
  and the question it was asking is released. Ending a check already complete settles it
  as complete.

### Batch 8: the design-zip choices

- **Teaching moves and activity prompts (L1, C2), under decisions 1 and 5.** Only on the
  professor's button, in the background. Built from the room's counts (never a name or
  an answer) and the professor's own slides; it cites its slide, is labelled "AI
  suggestion, your call", and is refused whole if it breaks a rule. It is never repaired
  or invented, and with no model the server says so instead of offering a template. A
  move needs graded answers; a prompt can be asked at any time in an open room.
- **The wheel's "Question + student" (W2)** draws on the server, preferring questions not
  yet asked in the room, never repeating within a pick, polls left out.
- **`verbal` is a fourth wheel ask**, with no bank question.
- **Support against the previous room (gap 6)** is like for like: only students below
  40% now who answered in the class's previous room, pooled right of answered on both
  sides. The class comparison (A1) is the newest two rooms.
- **Insights' threshold** is the room's own mastery goal, not a fixed 60%.
- **Supported levels (M2)** are the built-in templates' honest-fit reading; the AI writer
  may manage a level it marks unsupported, and the note says so.
- **The concept panel (H9)** is the model's sections (introduction, facts, explanation,
  code example, mistakes), each citing the lesson parts it came from or dropped, an AI
  draft exactly while its lesson is, plus a Visual that points at the professor's own
  stepped figure. The figure is never written by the model and is sent once.

### Batch 8: open items

- **Maps:** a lawyer must confirm before any generated map, and a compliant boundary
  source is needed.
- **`SERVER_SECRET`** must be set on the deployed server.
- **The reviewers' fixes** were not in `ba0f59d`.
- Regenerating a rooms-only question does not copy the switch; regenerating a lesson
  drops a figure the professor added; concept sections are approved or discarded only
  with their whole lesson.
- A self-test or lesson built before a question went rooms-only stops showing it, and an
  answer to it then cannot be sent.
- The practised set is read when a phone joins a room, so practice during the room is
  not seen until it joins again.
- "Question + student" may draw plot, number-line, chart, tap or label questions, which
  are hard to answer aloud; whether to leave them out is open. A drawn figure question
  shows as text on the console until it is put on the projector.
- The hint leak check and item statistics do not cover the five new kinds; class
  questions do not offer them.
- Teaching moves and wheel draws are not in a deleted room's archive or a laptop import.
- Not tested: a live model, Supabase, Mongo, a real phone or a low-end Android device,
  and Hindi or Marathi diagram boxes on a device.

### Batch 9 in brief: the hub during a class, written and drawn answers, exam mode

The owner asked, on 20 Nov 2026: where a student finds the Learning Hub after a room;
whether the hub stays shut until every student has finished and the room is closed; for
questions that cannot be copied, right-clicked, screenshotted or read by Google Lens;
for a better wheel; for short and long written answers and a whiteboard; and for a
locked tab, screen sharing on laptops and live cheating signals. Every answer below was
**decided under the owner's delegation, 20 Nov 2026** (E1 to E7). The server is built
on branch `batch9` (`0037`, `0038`); E2 and E6, and every screen, are the client's and
are not part of it. Shapes: `docs/API.md`, "Batch 9".

### Batch 9: E1 to E7, as decided and built

- **E1, the hub during a class.** The hub is never shut as a whole, and it does not wait
  for every student to finish. While a room is open, waiting or paused, **every question
  of its set** (its question set, or the chapter's servable questions for a room on the
  whole bank) is closed in the hub for every student: not served in practice, lessons,
  self-tests or Get Ready, and no key, explanation or hint. It opens when the professor
  closes the room. This replaces the narrower rule of the question on screen now. The
  sentence: "That question is part of a class that is still running, so it stays closed
  here. It opens when your professor closes the class." Built.
- **E2, after a room.** The phone's finish screen links to the Learning Hub for a
  signed-in student, and tells a student who was not signed in, in one line, that
  signing in keeps a history and opens the hub. **Client only; not built here.**
- **E3, short and long written answers.** The written kind gains `length`: short (at
  most 60 words, a small box) or long (at most 600 words, a large editor with a word
  count). No `length` is short, so no stored question changes and marking is as before:
  rubric-marked, provisional, human-reviewed. The generator may ask for either; the
  professor picks in the editor. Labels "Short answer" and "Long answer". Built.
- **E4, whiteboard answers.** A new kind, `drawing`: the student draws (pen, eraser,
  colours, undo) and may add words. The phone sends a PNG or WebP through the room's own
  socket, size-capped with its metadata stripped, and answers `{ mediaId, text }`.
  **Never machine-marked**: it goes to the professor's review queue, and attainment
  counts it only once a professor has marked it. The archive keeps the reference, never
  the picture, within its 1 MiB. Allowed at Apply, Analyse, Evaluate and Create (Create
  most of all), never at Remember or Understand. Built (the whiteboard itself is the
  client's).
- **E5, exam integrity.** An opt-in room setting `examMode`, off by default: a copy
  guard, blur and watermark (always, with exam mode); fullscreen on laptops; whole-screen
  sharing on laptops with optional low-resolution pictures every 30 or 60 seconds; new
  signals (fullscreen exit, copy or menu attempts, focus or visibility lost, sharing
  stopped, a missing picture, a second device, answer timing); a staff-only collusion
  check worded "signals worth a look, not proof"; a live `teacher:integrity` feed;
  optional Safe Exam Browser (free, MPL). Under 18: nothing that watches, no signal;
  the copy guard and watermark still apply. Built on the server.
- **E6, the wheel.** Rebuilt by the client as a real SVG wheel with segments, a smooth
  ease and a pointer, in the Forest style, with reduced motion. **Client only; not built
  here.**
- **E7, screenshot attempts.** On a laptop, PrintScreen, the snipping shortcut and the
  Mac shortcuts are recorded as `screenshot_attempt` with how (`printscreen`,
  `snip_shortcut`, `mac_shortcut`) and the question blurs at once; on a phone, Lens,
  Circle to Search, the assistant or the app switcher make the page lose focus, recorded
  as such and worded "Page left: possibly Google Lens, a screenshot tool or another
  app". Same rules as every signal: staff-only, a signal not proof, none for under 18,
  rate-limited. Built on the server; the key listeners are the client's.

### Batch 9: what a website cannot do, said plainly

Every help text and notice says it, and nothing in the product claims otherwise:
- **No website can stop a screenshot or Google Lens.** A phone's hardware buttons, any
  screenshot on an iPhone, a screen recording started outside the page and a photo
  taken with a second device cannot be seen at all. The faint roll number and room code
  across the question are the deterrent, and the trace on any photo that circulates.
- **No website can truly lock a tab.** Fullscreen, screen sharing and the copy guard are
  enforced by the student's own browser: a browser someone has changed can skip them,
  claim a share it never started and send pictures of anything, without leaving a
  signal.
- **Safe Exam Browser is a strong deterrent, not a lock.** Its values are worked out
  from the page address and a key, so anyone holding the configuration file can compute
  one, and a value seen once can be sent again from another browser. A fresh
  configuration per exam, and a Browser Exam Key, narrow this.
- **A signal is a prompt to look, never proof.** A notification, a slow connection or a
  sleeping laptop leaves the same trace as cheating; students who sit and revise
  together share wrong answers honestly. Nothing ranks, labels or scores a student on
  signals.

### Batch 9: screen pictures and the DPDP Act

Screen pictures are personal data. They join decision 8's list: **a lawyer must confirm
them before any college signs or uses them**, along with the consent notice that covers
them. What the server does until then is under decision 8, "Batch 9".

### Batch 9: the defaults chosen while building

- **Limits.** Written answers: 60 and 600 words, and 15 characters a word as a cap
  beside each; any answer at most 20,000 characters as JSON. Drawings: PNG or WebP only
  (JPEG smears thin pen lines, and a drawing has no photograph's reason to be one), at
  most 400 KB, 10 per student per question, 1,500 and 100 MB per room, 12 a minute per
  connection. Screen pictures: a whole JPEG of at most 80 KB (the decision said about
  60 KB; the cap leaves room), one per interval less 2 seconds, the newest per student,
  64 MB in all and 24 MB per room, past which a new picture is refused rather than one
  of another room's pushed out.
- **Signals.** At most 30 in any 60 seconds and one of a kind a second per student. A
  missing picture after two intervals and 10 seconds, once per gap. An answer is too
  quick when it arrives before its text could be read at 25 characters a second (never
  under 0.9 s), counting a passage only on the first question a student is served from
  it. One screenshot shortcut, or three of the other reported exam kinds, puts a student
  at "note"; a declined share is recorded once and raises nothing, because declining is
  the student's choice.
- **Collusion** lists a pair with the same wrong answer to at least 3 questions, each
  within 60 seconds (by the earlier of the phone's answer time and its arrival); a wrong
  answer given by half or more of those who got the question wrong, when at least 5 did,
  is a common misconception and not counted. Exam rooms only, because only their
  students were told their answers might be compared. Roll order, never ranked.
- **Where exam mode may run.** Not in a Teacher-led room (no phone joins one).
  Fullscreen, screen sharing and pictures only in a room opened for a class, because
  only a class list can mark a student under 18. The setting can change while the room
  is not closed; turning Safe Exam Browser on mid-room turns away phones not in it.
- **Consent.** A phone joining an exam room has seen the notice (the screen shows it
  before the join); a phone already in the room when exam mode is turned on is recorded
  as any room records it until it says it has shown the new notice.
- **Answers the phone cannot shorten.** An over-limit written answer from an outbox, a
  pack or after the close is kept and not counted, never refused, so nothing a student
  wrote offline is lost. On the question on screen in an open room it is refused, so
  the student can shorten it there.
- **Drawings** can only be marked in the review queue, never confirmed (there is no
  machine mark). Laptop mode does not serve them, because its archive cannot carry the
  pictures. Lessons, self-tests and Get Ready never ask one.

### Batch 9: open items

- **A lawyer must confirm screen pictures and the consent notice** before any college
  uses exam mode's pictures (decision 8).
- **Every existing written question is now a short answer of at most 60 words.**
  Answers students used to give at greater length are refused on screen until a
  professor marks such questions long. The owner may want existing questions reviewed.
- **No screen is built**: E2, E6 and every Batch 9 screen are the client's.
- **Safe Exam Browser** was never run: whether it sends its header on the socket's
  opening request is not known (its JavaScript value is the fallback), and
  `PUBLIC_ORIGIN` must be set on a deployment.
- **Screen pictures live in one process.** A second server process has its own store; a
  console reaching another process sees no picture.
- **Long answers and the archive: decided 20 Nov 2026 (migration `0039`).** A full
  class of long answers took a room's archive past its 1 MiB, so it could not be
  deleted, and a laptop room that size could not be imported. Of the three options
  (gzip, a higher limit, long text kept outside the limit), the limit is now **4 MiB**.
  The archive stays plain JSON, which is what the owner asked for ("save the room and
  other data in the form of json format", 18 Nov 2026). Postgres compresses large jsonb
  on disk anyway. 4 MiB holds about 1,100 long answers beside everything else. Gzip
  would have turned the archive into a blob nobody can read without a tool, and text
  kept elsewhere would split one room across two places. Reversing this is one constant
  (`ARCHIVE_LIMIT_BYTES`) and one migration. The close still warns when a room is
  near the limit.
- **Before a room opens**, practice can still show a question's key; the rooms-only
  switch is the professor's tool for that.
- The repository's offline runner (`scripts/test-offline.sh`) and the README do not yet
  list the two Batch 9 scripts and migrations `0037` and `0038`.
- Not tested: Supabase, Mongo, a model, a real phone, a laptop browser, a proxy, Safe
  Exam Browser, the picture store under a full class's load; `mac_shortcut` is sent by
  no test.
