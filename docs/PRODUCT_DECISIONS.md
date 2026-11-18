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
