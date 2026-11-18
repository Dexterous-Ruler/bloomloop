# Product decisions

Eight decisions the gap analysis said cannot be assumed, plus one the owner has since made (9). Each has a recommendation,
its consequences, and what waits on it. **None of the eight is approved yet.** Work that
does not depend on a decision goes ahead; work that does uses the "safe default"
column, chosen so it can be reversed without a data migration.

`CONTRACT.md` and `V2-CONTRACT.md` are not changed by this file. If a recommendation
is approved, the contract is amended in the same change and the approval date recorded
here.

| # | Decision | Status |
|---|---|---|
| 1 | Generated teaching content in the Hub | Awaiting owner |
| 2 | Which mastery threshold is authoritative | Awaiting owner (safe default in use) |
| 3 | Do observations and spoken answers move a level | Awaiting owner (safe default in use) |
| 4 | Does "no image generation" cover plotted diagrams | Awaiting owner |
| 5 | AI calls for professor-triggered actions | Awaiting owner |
| 6 | Six levels or three bands by default | Awaiting owner |
| 7 | Hub identity: accounts or roll number | Awaiting owner (safe default in use) |
| 8 | DPDP role and students under 18 | Needs legal review |
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

**Waits on it.** Room settings screen copy, bands, analytics wording.

## 3. Do observations and spoken answers move a Bloom level?

**Conflict.** The handoff keeps teacher records separate from accuracy, but its
Analytics view speaks of "evidence from digital answers and teacher records".

**Recommendation.** They never move the working level (the ladder reads digital
answers only), but they are evidence in reports, labelled by type. Attainment reports
show them in their own column with their own count, never blended into accuracy.

**Safe default in use.** Separate. Nothing built so far mixes them.

**Waits on it.** Phase 3 observations, Phase 4 attainment.

## 4. Does "no image generation" cover plots and diagrams drawn from data?

**Conflict.** `CONTRACT.md:159` forbids image generation. Graph and pattern questions
for maths need figures.

**Recommendation.** The rule means no image-model output. Figures rendered
deterministically from data (an SVG plot of `y = 2x + 1`, a labelled diagram drawn
from coordinates) are allowed, because they are code, reproducible and checkable.

**Consequences.** Visual questions use code-rendered SVG (Mafs or JSXGraph, both
MIT), never a generated bitmap.

**Waits on it.** Graph, pattern and visual question kinds.

## 5. May professor-triggered actions call a model, given "zero LLM calls in the live loop"?

**Conflict.** `CONTRACT.md:160` says the live loop makes no model calls. Written-answer
marking and the handoff's "AI teaching move" would need one.

**Recommendation.** Keep the rule for anything a student waits on. Allow model calls
only when a professor presses a button (mark written answers now, suggest a teaching
move), run them asynchronously, and never let their result move a level before the
professor confirms it.

**Waits on it.** Phase 1 review queue (AI pre-marking is optional on top of it),
Phase 3 insight cards.

## 6. Six levels or three bands by default?

**Conflict.** The product is built on six levels; raters agree poorly at six
(reliability about 0.25 in one study) and much better at three bands (about 82%).

**Recommendation.** Keep six levels everywhere the student's next question is chosen
and in the professor's detail views. Default class-level summaries and attainment to
three bands (lower: Remember, Understand; middle: Apply, Analyse; higher: Evaluate,
Create), with the six-level breakdown one click away.

**Waits on it.** Phase 3 class analytics, Phase 4 reports.

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

**Waits on it.** The Hub, cross-room history for students without accounts.

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
| Which answers are "this student's" across rooms | Rooms owned by the professor they report to (the analytics scope). For the **professor** reading a student: rows linked to the student's account, plus rows under their roll number linked to no account. For the **student** reading themself: rows linked to their account only, because a roll number is typed on a phone with no sign-in, so an unlinked row under it may be a guest's, a mistyped classmate's, or a second account's whose roll number differs only in case. A row linked to a **different** account is never theirs. Roll numbers are compared upper case and single-spaced, as the room stores them, and since `0011` two accounts in one department cannot hold the same roll number in that form | `listStudentAnswers` in `server/src/services/evidence.js`; `listAnswers` `student` filter in all three repos; `studentScope` in `server/src/services/analytics.js` |
| A phone that sends no answer key | The key is derived from the roll number, the question and the answer. It used to leave out the roll number, so two students giving the same answer to the same question shared one row and the second was never stored. A key that another student's row already holds is filed under `<key>@<roll number>` and never answered from that row | `handleAnswer` in `server/src/sockets/index.js` |
| Paging the review queue | By cursor: each page's `next` goes back as `?before=`. `offset` is refused with a 400, since reviewing answers takes them out of the default view and an offset then skips the ones that move up | `server/src/routes/review.js` |
| Writing into a room while it is deleted | Refused. The delete marks the room, waits out any write already under way, archives, deletes. A review sent meanwhile gets 409 ("Nothing was changed"); a live answer gets the phone's "did not save" notice and is resent, which a deleted room then answers as closed | `holdRoomForDelete` in `server/src/sockets/index.js`; `DELETE /api/session/:code` |
| Who may list a student's answers | Exactly whoever `subjectsFor()` lets see that student, as for the analytics detail: their professor, and the student themself. An HOD's subject list holds professors, so an HOD gets no student's answers (a professor's id answers 400; anyone outside the list, 404) | `answersFor` in `server/src/services/analytics.js` |
| Where topic numbers come from | Final, graded answer rows (retried attempts and polls left out). A history entry with no `answerId` predates the answers table and is counted from the profile instead; every later entry has a row, so nothing counts twice. Each report names its `source`: `answers`, `history`, `mixed` or `none`. Answers with no topic are counted as `untagged`, not as a topic. The professor-level topic list (still read from history) now skips polls too; before, a poll counted as a wrong answer on its topic | `server/src/services/evidence.js`; `topicBreakdown` in `server/src/services/analytics.js` |
| Options "as shown" with the fewer-choices support | Not reproduced. Which options the support removed is not stored on the answer, so for a student who had it, an mcq or multi is listed in full and their response is a position in the shorter list they saw. Storing it would need a column; not done | `shownQuestion` in `server/src/services/evidence.js` |
