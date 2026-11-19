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

The live view's accuracy bands (Phase 3) add a third number of their own, which is
neither promotion nor the mastery goal: a student is "Excelling" from 60% overall in
the room, the line the handoff's own histogram legend draws ("Above 60%"). "Needs
support" is below 40%, the engine's existing below-40% band. Both are defaults in the
table below; they change no level and no question.

**Waits on it.** Room settings screen copy, bands, analytics wording.

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

**Safe default in use (Phase 3 class analytics).** Both, undecided: every level
figure of `GET /api/classes/:id/analytics` comes as the six levels (`levels`) and as
these three level bands (`levelBands`, `LEVEL_BANDS` in
`server/src/services/classAnalytics.js`), per room and over the window, each with the
answers behind it. Which a screen shows first is the screen's choice, so deciding this
needs no server change. Not to be confused with the live view's three **accuracy**
bands (Needs support, Developing, Excelling), which place a student by accuracy and
are not about levels at all.

**Waits on it.** Phase 3 class analytics (now built both ways), Phase 4 reports.

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
| What a roster holds (Phase 3) | A roll number and a name per student. Any other field sent is dropped and named back; a name holding an `@` or six or more digits is refused as probably carrying an email, phone number or date of birth. The table has no other column, and the migration test fails if one is added | `services/roster.js`; `0016` |
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
"Known open issues"):

- **What a phone is told about the band.** The phone's row carries `slowLearner` and
  the integrity summary, and its `reason` sentences name the below-40% band, which the
  phone shows on purpose ("the same sentence the teacher sees"). The roadmap's rule
  says labels are staff-only; `CONTRACT.md` sections 4 and 5 make the phone's
  `profile` the one `GridRow`. Changing it needs a contract amendment, a sentence a
  student is shown instead, and the phone client.
- **Amending `0005`**: done, not waiting on the owner. `0005` now lists `'waiting'` in
  `sessions_status_check`, a widening that no row can fail, so re-running the set
  never narrows the check. Revert that one line if an applied file must never change.
- **Whether a class room's observations outlive the room.** Today they go with the
  room they were typed in, so deleting one room of a class-day changes the mark in
  force the class's other rooms show for that day. Keeping them (with no room, under
  the class and day) means a test room's marks could never be removed, since
  observations are append-only.
