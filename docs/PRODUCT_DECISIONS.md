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
| What happens to a generated question (Phase 2) | Saved as a `draft`, which no room serves, until a professor approves it (one, or every draft in a bank). Drafts, offline-template ones included, all wait: the roadmap's "kept out of rooms until approved" draws no line between the model and the templates. A room on a bank with fewer than 6 approved questions and some drafts is refused with 409 and a sentence saying to approve them | `routes/generate.js`; `routes/bank.js`; `POST /api/session` |
| Failing rule checks | Advice only. Approval is allowed whatever they say; the reply to approve and approve-all names each failed check. The longest-option check fires only when the answer is over 20% longer than every wrong option, because "strictly longest" fires on a quarter of honest four-option items by chance | `server/src/services/checks.js` |
| The older "restore" on a draft | `PATCH status: active` (the console's restore) and bulk restore are kept. On model output nobody approved they are the approval and record `approved_by`/`approved_at`; on every other question they are the plain status change they were. So no route makes model output active without an approval on record | `activatePatch` in `services/edits.js` |
| A plain regenerate | Unchanged in shape (`CONTRACT.md` §4: a new item, the old one discarded), but the new item is a draft. Regenerating an **active** question therefore takes that slot out of rooms until the replacement is approved, and the reply says so in `warnings` (a bank at the floor of 6 then stops opening rooms). The alternative, keeping the old question active until its replacement is approved, needs a stored link from the draft to the question it replaces (a new column); owner's call | `POST /api/bank/question/:id/regenerate` |
| A replacing generate while a room runs (Phase 2 review) | Refused with 409 while a room on the chapter is open or paused, before anything is generated. Replacing deletes the approved bank the room is serving and writes only drafts, so every phone in it would get "nothing left". `mode: 'append'` is still allowed. Before the approval gate the replacements were active, so this was never an issue | `POST /api/generate` |
| Harder / Easier | A new draft one level up or down at that level's default kind (so Create is always a written answer), same topic and slides; the original is untouched. Refused at the ends of the ladder and on a poll | same route, `direction` |
| A professor's own question | Created active. Any kind **at its own level** (the editor's rule: the level chooses the kind), except a poll, which may sit at any level. `model` null, `created_by` the account. `source` is `'fallback'`, because `CONTRACT.md` §6 rule 5 says every item not produced by the model must carry it; the console labels `fallback` as template text, which misdescribes a professor's question. Needs a contract amendment (a third value such as `teacher`) to label it truthfully; not done here | `POST /api/bank/:contentId/questions`; `authorQuestion` in `services/edits.js` |
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
| The slide-only check with a stimulus | Unchanged. The task for this work asked that it pass when an image **or a passage** is attached. It passes when an image is attached, an upload included, and when any stimulus is attached to a stem that says "as shown above" or "on the slide". A stem naming a figure, diagram, graph or coloured curve with only a **passage** attached still fails: a passage cannot show the picture, so the question is still unanswerable on the phone, and the existing unit test already asserts that. The owner may decide otherwise; the change is one condition in `slideOnlyReference` | `server/src/services/checks.js` |
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

### Phase 2 defaults the owner should look at

Each row above is in use and reversible. These are the ones where the safe default
may not be what the owner wants, or where a contract is involved:

| Default | The question for the owner | Cost of changing it |
|---|---|---|
| Offline-template questions wait for approval like model ones | Should template output be trusted without review? The roadmap's "kept out of rooms until approved" draws no line, so none is drawn | A condition in generation; no data change |
| A plain regenerate takes an active question out of rooms until its replacement is approved | Keep the old one serving until then? | A new column linking a draft to what it replaces |
| A professor's own question is stored as `source: 'fallback'` | Amend `CONTRACT.md` §6 rule 5 with a third value (such as `teacher`), so the console stops labelling it template text? | A contract amendment, then one value in the route |
| The slide-only check still fails a picture reference with only a passage attached | Should a passage clear it, as the task asked? | One condition in `slideOnlyReference` |
| The negative point-biserial flag fires at any value below 0 | Add a margin (say below -0.1) for small classes? | One constant |
| The point-biserial is shown from 10 students; bands from 5 answers at 0.8 and 0.4 | Different floors or cut points (for example per room, from its own mastery goal)? | Constants; per room needs the bank report to stop pooling rooms |
| During a running class, anyone with an image's url can load it | Acceptable for a class activity? Signed urls are the alternative, with the costs given above | A new serving rule and a secret that survives restarts |
| Uploads live in the database, at most 500 KB, never deleted | A storage bucket, a different limit, or a delete route with a retention rule (decision 8)? | A move of the bytes; the url can stay the same |
