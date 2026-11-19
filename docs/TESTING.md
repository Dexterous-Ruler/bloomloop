# Testing

Every suite runs offline on the in-process store or on PGlite, **when run through the
offline runner below**. None of them is meant to touch Supabase, Gemini or any other
network service.

## The offline runner (the rule since Phase 3)

`server/.env` on a development machine can hold live Supabase, Mongo and Gemini
settings, and `dotenv` loads it whenever `server/src/config.js` is imported. So every
suite is run with those settings blanked **in the environment** first: `dotenv` never
overwrites a variable that is already set, even to an empty string. The runner used
for Phase 3 is a small shell script kept outside the repository; this is all it does
(Git Bash):

```bash
export SUPABASE_URL= SUPABASE_SERVICE_ROLE_KEY= SUPABASE_ANON_KEY= MONGO_URI= GEMINI_API_KEY=
cd server; npm test; npm run migrations; cd ..
for s in liveloop security review evidence resume integrity roundtrip bank kinds media \
         items roster records modes insights; do node server/scripts/$s.mjs; done
```

It writes each suite's output to its own file and a summary of exit codes. To run one
script by hand, prefix it the same way:
`SUPABASE_URL= SUPABASE_SERVICE_ROLE_KEY= SUPABASE_ANON_KEY= MONGO_URI= GEMINI_API_KEY= node server/scripts/modes.mjs`
(in PowerShell 7, set each with `$env:X = ''` first).

The rules that go with it:

- **A new end-to-end script also blanks the settings itself**, as `bank.mjs`,
  `roster.mjs`, `records.mjs`, `modes.mjs` and `insights.mjs` do (they set
  `config.supabase.url`, `serviceKey`, `anonKey`, `config.mongoUri` and
  `config.gemini.apiKey` to `''` before the store starts), and **is added to the
  runner's list**. `resume.mjs` and `integrity.mjs` do not blank them yet, which is
  why the runner is the rule.
- **Each script starts its own server on a random port** (`listen(0)`); none uses
  the development servers on ports 5050 and 5173.
- **Signed-in callers without Supabase.** `roster.mjs`, `records.mjs`, `modes.mjs`
  and `insights.mjs` point the server at `http://supabase.invalid`, a name that never
  resolves, answer the server's three Auth calls (whose token, that account, the
  HOD's department) inside the script, and refuse and count any other request that
  would leave the machine. Each ends with a check that the count is 0.
- **Never run `server/scripts/smoke.mjs`** in this setup: it uses whatever
  `server/.env` configures, Gemini included, and fails for older reasons anyway (end
  of the Phase 2 results below).

| What | Command (from the repo root unless noted) | Covers |
|---|---|---|
| Unit | `cd server && npm test` | Mastery ladder, selector, edits, integrity signals (including `level-jump`), accounts, the room archive (size, exact round trip, paging), reviews, and the evidence reads: the student redaction for all 16 kinds, the topic report, one student's answers across rooms on the in-process store, the three repos having the same methods (64 since Phase 3), and the query the Mongo and Supabase repos would send for the new filters (not a database test). Since Phases 2 and 3, also the unit files named in the rows below (Phase 3: `roster`, `wheel`, `records`, `modes`, `insights`) |
| Live loop | `node server/scripts/liveloop.mjs` | A real socket server: ownership on `teacher:watch`, evidence rows, idempotent answers, polls, retries, redemption and the mastery goal, pause/resume status, deleting a room into an archive |
| Security | `node server/scripts/security.mjs` | Auth and ownership on HTTP routes, with seeded owned and unowned rooms; a phone answering a question from another room's content is not marked, not sent its key, and nothing is stored |
| Migrations | `cd server && npm run migrations` | Every file in `supabase/migrations` on a fresh PGlite database: a second run, an upgrade from v1 with data, every column the server uses, constraints, RLS on every table, room archive limits; one roll number per department as a room reads it (`0011`, including a database that already holds a clash); the evidence and review-log guards (`0012`); the `draft` status, question provenance and approval columns and `contents.topic_slides`, with older rows left as they were (`0013`); uploaded images (`0014`): a PNG written in bytea's text form and read back byte for byte, the type, size, digest and alt rules, the bytes, type and chapter refused a change while the alt text takes one, the uploader's account deleted (image kept, owner cleared), the chapter deleted (images gone), and the two new indexes; a room's question set (`0015`): a set read back in order, null for a room without one (and for v1 rooms after the upgrade), an empty set, a null inside one, a two-dimensional one and a non-uuid refused, and a closed room keeping its set; classes, rosters and attendance (`0016`) and the teacher records (`0017`); room modes and projector links (`0018`): the defaults a room gets, settings read back, a Teacher-led room with no class and each value out of range refused, `waiting` taken and started into `open`, a link's unique token hash, its shape, revoking it and nothing else, and its deletion only with its room; v1 rooms upgraded to how they ran |
| Resume | `node server/scripts/resume.mjs` | A student resuming onto their pinned question; discarded questions are not served. **Reads `server/.env`**: unlike the scripts above it does not blank the store and model settings, so on a machine whose `.env` holds Supabase or Gemini keys it would use them. Run it through the offline runner (above) |
| Integrity | `node server/scripts/integrity.mjs` | The signals recorded from real socket traffic. **Reads `server/.env`**, as `resume.mjs` does; run it the same way |
| Question kinds | `node server/scripts/roundtrip.mjs` | All 16 kinds: valid, the right answer scores 1, a wrong one 0, and the phone's view carries no key (deep scan, `answers` included). 0 failures since Phase 2 wrote the five missing fixtures (`hottext`, `dropdown`, `table`, `grid`, `poll`; a poll's "wrong" answer is a position off its list, which records nothing) |
| Kinds per level (Phase 2) | `node server/scripts/kinds.mjs` | A real server on the in-process store, shared key, offline generation: the preview divides each level over its kinds with every count unchanged, a selected-response kind asked of Create refused out loud, a `kindMix` applied; the bank written has the plan's numbers and hot text, dropdown, table and grid drafts, each valid; those four approved, served through the socket with no key in the payload, the right answer scoring 1 and a wrong one 0 for each kind, the solution in the shape each phone widget reads, every attempt stored; `PATCH` on each kind, invalid refused with the validator's words and nothing changed, valid landing whole and tidied. 43 checks. Unit: `test/kindmix.test.js` (the default mix, the rotation, counts preserved across 36 plan requests, no Create selected-response however asked, the offline bank's numbers, `validateItems` on each new kind) and `test/newkinds.test.js` (each template built, valid, grounded in the source, keyless, scoring 1 and 0; a valid and an invalid edit per kind; the Mongo schema keeping each kind's payload) |
| Client build | `cd client && npx vite build --outDir <somewhere outside the repo>` | The client compiles |
| Review queue | `node server/scripts/review.mjs` | A real server on the in-process store: a written answer marked provisional and listed in the queue; the shared key refused (404) on another professor's room; confirm then override with the response and `auto_*` unchanged, the history entry, tallies, grid route, CSV and live grid push following the human mark, and every decision logged; repeats idempotent; bad input and paging refused (including any `offset`); a review racing a live answer from the same student (lock); a closed room reviewed; two students sending the same answer with no key, or with one key, kept as two rows and reviewed apart; a resend rebuilt from a reviewed row keeping the review and dropping the machine's detail; a review refused while its room is archived and deleted, and one already under way waited for and archived; walking the queue by its cursor while confirming reaches every answer. 83 checks |
| Approval gate (Phase 2) | `node server/scripts/bank.mjs` | A real server on the in-process store, shared key, offline generation (the Gemini key is blanked whatever `.env` says): a `.pptx` built in the script is uploaded and keeps each topic's slides; generation saves drafts with `model: offline-template`, the topic's slides and the rule checks, and pasted text gives no slides; the bank, the content list and `bankCount` count drafts apart; a room on a bank of drafts is refused (409) with its sentence; an edited draft stays a draft with its checks re-run; approve with a failing check allowed and named; approve twice changes nothing; reject; the older PATCH restore records an approval; approve-all with its flagged list; Harder, Easier and Harder from Evaluate (a written Create) as new drafts with the original untouched, both ends of the ladder refused, a plain regenerate still discarding; write-your-own active with `model` null, checks as advice, a poll, a cross-level kind and a malformed one refused; the room then serves only approved questions to a student until exhausted, never a draft or the rejected one, and an answer naming a draft is not marked or stored; another professor's bank gets the same 404, word for word, as a bank that does not exist, on every new route, and nothing of theirs changes. Since the Phase 2 review also: a plain regenerate of an active question says in `warnings` that it has left rooms; an answer naming a rejected draft is not marked or stored; an answer's snapshot keeps the model but not `approvedBy`/`approvedAt`; a replacing generate refused (409) while the room is open with nothing deleted, an appending one allowed, and a replacing one answering once the room is closed; split and merge of rejected drafts over HTTP giving drafts with no approval. 73 checks. Unit: `test/checks.test.js` (every check both ways, and on the offline generator's output) and `test/approval.test.js` (status transitions, split/merge/edit, write-your-own validation, slides from extraction to the question) |
| Images and passages (Phase 2) | `node server/scripts/media.mjs` | A real server on the in-process store, shared key, offline generation: PNG, JPEG and WebP uploaded and told by their bytes (a PNG sent as `photo.jpg` stored as a PNG); an SVG, the same SVG named and typed as a PNG, a page of script named `photo.jpg`, a GIF, one byte over the limit (413; exactly the limit is taken), no or blank or over-long description, no file, JSON instead of a form and no credentials, each refused; another professor's chapter, a missing one, a malformed id and none at all the same 404, before anything about the file is said; the teacher served the bytes with the type, nosniff, the private year-long cache, the sha256 ETag (a 304 on revalidation), the CSP, and by `?key=`; a phone refused (404, `no-store`) before any room, a wrong key judged as a phone; an upload attached to a question in any spelling of its url, stored canonical with the upload's alt, clearing the slide-only check; their upload, a missing one, the caller's other chapter's and a malformed url refused word for word with the question untouched; write-your-own and a draft carrying one; a passage with a citation shared by every approved question through the bulk action (over-long text and citation refused), each an equal copy; the room open, a phone served the passage without its citation, then the image, which it loads with no credential; an image only a draft shows, one replaced, one attached to nothing and another chapter's still refused; served while paused, refused once closed, the teacher still served; null taking a stimulus off. Since the Phase 2 review also: a JPEG carrying a location and a comment stored and served without them, its size and hash those of what was kept; their upload under four other spellings (dot segments, an absolute url) and through bulk `stimulus` refused; my own upload under another spelling stored canonical. 67 checks. Unit: `test/media.test.js` (the signatures, the url helpers and every spelling a browser resolves to the media route, `withoutMetadata` on hand-built JPEG, PNG and WebP files with nothing left of their metadata and the orientation kept, `withUpload` and `servedToPhones` on the in-process store, the citation's rules and its absence from the phone, the slide-only check with an upload, the three repos' media methods: in-process, the request the Supabase repo sends and how it decodes bytea's text form against a stubbed PostgREST, and the Mongo schema built without a database) |
| Item statistics and question sets (Phase 2) | `node server/scripts/items.mjs` | A real server on the in-process store, shared key: twelve phones answer six questions (mcq, a wrongly keyed mcq, true/false, match, categorise) through the socket, each choosing by the text on its own shuffled screen; `GET /api/session/:code/items` then equals a hand count of their choices per option in the question's own order, the hand proportions, mean scores and bands, and point-biserials worked here by the textbook formula from the same marks; the wrong key negative, flagged and first, nothing else flagged. Question sets: not a list, empty, over 500, a draft, a rejected question, another chapter's, a malformed and an unknown id each refused, the last five in one sentence; a set of one on a chapter too thin for a whole-bank room opens; the room list carries the set; a two-question room serves exactly those two, never a pin from outside the set, and an answer naming one outside it is neither marked nor stored; the phones' room read gives the set's count without the ids or the content id. `GET /api/bank/:contentId/stats` sums both rooms. A fewer-choices pick (supports set on the server's socket, as Supabase is out of reach) stored with `shownOptions` and counted on the option it was. Another professor's bank and room the same 404, word for word, as missing ones; no credentials 401. 49 checks. Unit: `test/itemstats.test.js` (Pearson, the point-biserial against hand values, the floors and cut points, `toOriginalResponse` for every kind against `forStudent` and `score`, a ten-student room worked by hand, what is and is not counted, the set in the selector, the image rule and the archive, the readers, and the three repos keeping the set: in-process, the Supabase request against a stub, the Mongo schema without a database) |
| Roster and attendance (Phase 3) | `node server/scripts/roster.mjs` | A real server on the in-process store, real sockets, and **signed-in callers**: the server's three Supabase Auth calls (whose token, that account, an HOD's department) are answered in-process for `http://supabase.invalid`, and any other request off the machine is refused and counted. A professor creates a class and adds a twelve-row list: five added in the room's form, seven refused each with its position and reason, `phone` and `dob` dropped and named, nothing but a roll number and a name stored; a duplicate refused; class and student edits; a roll-number clash 409. A room opened for the class; another professor's class and a missing one the same 404; a malformed id 400. Phones join with roster and off-roster roll numbers, nobody locked out; the teacher's live grid names rows from the roster and says "2 / 5 present"; nothing of it in any phone payload or the public room read. Attendance read: joined present, unmarked not absent, off-roster reported, the caveat. The professor marks many, a later join and a rejoin never undo a hand mark, a bad list changes nobody, "joined present, the rest absent" keeps hand marks; a room with no class 409. Another professor, an HOD elsewhere and the shared key get the 404 of nothing on every class and attendance route; the HOD of the department reads everything and every write is 403 with nothing changed; a student account 403, no credentials 401. Removing a student keeps their answers, marks and row, refuses a re-add with "restore", and restoring brings the same row back. The deleted room's archive keeps the class and every mark. A room with no class: grid payloads exactly as before. 80 checks. Unit: `test/roster.test.js` (roll numbers as the room reads them, `03` and `3` apart; names and class fields; every refusal of a bulk add; the attendance report, present count and marks; a join never over a professor's mark; the grid decoration and its failure path; the in-process repo; the archive; the Supabase requests against a stub; the Mongo schemas) |
| Teacher records (Phase 3) | `node server/scripts/records.mjs` | The same harness as `roster.mjs` (real server, real sockets, signed-in callers answered in-process, any other request off the machine refused and counted). A room for a class of six **with no phone joined**: the wheel empty with its reason until attendance is marked by hand, then four draws with no repeats giving each present student once (late counts, absent and unmarked never), stored in order with the pool each was drawn from, a fifth draw 409; present only off brings the absent and the unmarked on, "4 picked of 6"; a new round keeps round 1's picks; a round with repeats allowed. The pick's four responses with when and by whom, pending and anything else refused, who was drawn unchangeable; a bank ask naming the room's question (another professor's refused), a diagram with a question refused, a demo dropping it; Absent marking attendance absent as the professor's mark and taking the student off the present-only wheel, and not with `markAttendance: false`. Observations: set, replaced with the old one in the log, the same again writing nothing, cleared with all three kept; the room's read with counts; six bad requests refused with nothing written. The tally: increments, a decrement at 0 clamped, counts below 0 refused, "3 of 3 present responded" from attendance, more hands than present said in words, a bank mcq bringing its text, options and key. The five activities in order, groups not students, a quick check naming its tally, four bad ones refused. Insight actions kept in order, no route to edit or delete. A closed room draws nothing, but takes marks. A second room of the class the same day shares the day's mark; one student across two days. A room **with phones**: every event the phones receive is kept (`onAny`) and searched for every record written meanwhile (notes, labels, tally, picks, activities, flags, roster names): none; nor the public room read; a student's levels unchanged by a "Needs revision" and a pick. A room with no class keys records to joined roll numbers. Another professor the same 404 as no room on all 16 routes; the HOD reads all and every write is 403 with nothing changed; a student 403, no credentials 401. The deleted room's archive holds every record with the observation log, its size honest; a delete waits for a record being written, which lands in the archive, and one sent during the delete is refused. Since the Phase 3 review also: flag ids of the insights' shape only, and a free-text flag id or a phone number in a tally or a group's label refused with nothing kept. 97 checks. Unit: `test/wheel.test.js` (who is on the wheel; every random number naming one student and every student one number; crypto.randomInt as the default; 7000 real draws near even; a bad source an error; a round with no repeats giving everyone one turn; asks, statuses, settings; the projector's roll number and first name only) and `test/records.test.js` (the day in India's time; notes refusing an email or a mobile number but not a roll number; observation subjects, the mark in force and its log, the room's report and one student's days; tally inputs and the summary; groups and flag ids; the in-process repo's places and cascade; the archive round trip and its size; the Supabase requests against a stub; the Mongo schemas) |
| Room modes, the waiting room and the projector (Phase 3) | `node server/scripts/modes.mjs` | The same harness as `roster.mjs` (real server, real sockets, signed-in callers answered in-process, any other request off the machine refused and counted), with real projector connections. A room that sets nothing: open, the defaults in its settings, a phone served with no time on its question, both grids the same shape as before; each setting out of range a 400 naming it. Adapt: five right answers promote in a room that adapts and leave the student at Understand in one that does not, recorded all the same and the reason saying so; a room from Apply starts and serves at Apply. A cap of two: each question carries its 60 seconds, a late answer (served five minutes earlier) taken and marked, the third ask `server:exhausted` with its reason, and an answer to a question never served refused after it. The waiting room: waiting in the reply and the phones' read; a start with nobody joined 409; a phone told to wait, asked again and answering while waiting told to wait with nothing stored; the grid's waiting line; pause 409; an HOD 403 and another professor the 404 of no room; the start serving the waiting phone, `teacher:status` open, a late joiner served at once, a second start 409; a class room's "1 / 2 present"; closing a waiting room. Teacher-led: no class 400; a phone told it is teacher-led, its answer refused, no profile, answer or attendance; started with no phone; the wheel, an observation, a tally and an activity with no phone; the grid's feed labelled, with no digital answers, and nobody's level touched. Mixed: phones served and marked; the grid's feed with the digital answers and the records apart. The projector: an HOD 403 and another professor 404 on making a link; the owner's 43-character token stored only as its SHA-256; an HOD's read with no token in it; a made-up token refused; watching gives the screen; a projector connection sending `student:join` and `teacher:watch` heard nothing and made no profile; a bank question unrevealed then revealed; a question asked aloud likewise; a question with no stimulus refused as a diagram; an image diagram the projector loads with no credential; a passage; progress counts that move when a phone answers; a draw's pick with the first name, then the roll number alone; an HOD's change 403; revoking one link darkens its projector and not another link's, its token refused afterwards in the same words as a made-up one, a second revoke changing nothing; closing the room closes the rest, refuses the links, and refuses a new link or screen change; in a waiting room on another chapter, the diagram's image loads with no credential (404 before the room opened, 404 once it closes). Then the whitelist walk over every event every projector received (its own copy of the whitelist): only `projector:*` events, no key off the list, no surname, no first name outside the current pick's, no observation, score, accuracy or band word, no key before a reveal; and no phone received a projector event or a teacher record. Since the Phase 3 review also: one 404 sentence for another professor's room and no room on grid, pause, resume, close, integrity and delete; with 80 ms of latency on the store, a close during a start leaves the room closed and two starts give 200 and 409 with the phone served once; `fromJoins` refused in a Teacher-led room; a bank key revealed in a Teacher-led room and refused (409) in a Mixed one, a bank tally's too; progress with no counts per level under five students and with them at five; one connection sending `student:join` and `projector:watch` together is one role only, either way round; a link made 13 hours ago refused, and one running out while watched dropped at the next change. 101 checks. Unit: `test/modes.test.js` (the settings' defaults and fall-backs, the start level, five right answers held with adapt off, the below-40% ceiling holding with adapt off, the waiting line and the start rule, a Student-devices room's grid untouched, the Mixed feed's counts and labels, the archive keeping only changed settings, tokens and their hash, the in-process link methods, the whitelist dropping keys at every depth, a bank question's key only on reveal and never its rubric, the professor's changes refused when they do not fit the room, progress and the pick, the Supabase requests against a stub, the Mongo schemas) |
| Live insights, the student card and class analytics (Phase 3) | `node server/scripts/insights.mjs` | The same harness as `roster.mjs` (real server, real sockets, signed-in callers answered in-process, any other request off the machine refused and counted), with a teacher screen and a projector watching. A class of six; a Mixed room with attendance by hand (five present, one absent) and four phones answering a scripted run (5 of 5; 2 of 5; 0 of 3; 1 of 2), the levels each was served checked. Against hand counts: each band (40% exactly is Developing; two answers is no band), the counts and the three sort orders; the grid's working levels; Focus ("3 students are working at Understand ... 6 of the 13 Understand answers ... were right", "Ask Understand"), Support ("1 student is below 40% overall, 1 more than at the start", "Show them") and Participation (the one present student with no phone), no card predicting; class accuracy 47.5% from 15 answers with its start at the first answer (100%) and its change, the support count's start at the first band (0), participation's at attendance (0); the series. `teacher:insights` at watch, then throttled (fewer pushes than grid updates) and ending on what the route reads. Observations, a wheel pick answered, a tally of three hands and an activity counted under their own label, moving no band, card or tile. The student card: roster name, band, level, accuracy per level with the class's, the last five answers newest first in the professor's view, the planned next set ("1 Understand · 2 Remember review · 2 Apply stretch"), a Needs-support student's plan never above Understand and their observation, the picked student's pick, a roster student with no phone, a roll number in any case, an unknown one 404. Dismissing Support and Focus; a student entering Needs support brings Support back with a new id while Focus, whose bottleneck held, stays dismissed; "acted" ends a dismissal; the tiles move. A second room of the class by joins, and a room of no class: analytics with both rooms oldest first and not the third, accuracy per room with its answers, the trend, attendance by hand and by joining, participation, bands per room, the pooled histogram (buckets 1, 2, 5, 9 and one below the floor), six levels and three level bands, the hardest questions equal to a list worked here from the answer rows; `?last=8`; `?last=5` 400; a class with no rooms empty. Access on all three routes: another professor the 404 of nothing, word for word; the department's HOD reads; another HOD 404; a student 403; nobody 401; a bad `?last=` from an outsider still the 404. A Teacher-led room: no card or digital figure, its records counted, a roster student's card. Every event every phone and the projector received searched for the insights' labels, ids, keys and sentences: none; the public room read neither. 65 checks. Unit: `test/insights.test.js` (the cut points and the floor on every fraction to 60 answers, Needs support equal to the engine's band, the histogram's buckets and legend, the room's figures in class and no-class rooms, each card's text, its flag id and the dismissal rule, the series' starts, per-minute points and cap, the next set's clipping at Remember, at Create and in the band, the pin and the cap, the sort orders, `?last=`, the level bands, a room's report, a class with no rooms, the in-process `listSessionsForClass` and the Supabase request against a stub) |
| Evidence reads | `node server/scripts/evidence.mjs` | A real server on the in-process store, shared key: `GET /api/session/:code/answers` (every attempt including retried ones and polls, full snapshot, newest first, by roll number, pages without overlap, bad paging refused) and `/topics` (per topic × level equal to a hand count of what the phones were told; a room older than the store read from history, a mixed room counted once, an empty room `none`); another professor's room the same 404 word for word as no room; `/api/analytics/:id/answers` a 404 to the shared key. 37 checks. The signed-in account paths are not exercised (Supabase) |

## Results on 19 November 2026

After the fixes from the Phase 1 review, every suite was rerun to check the reported
numbers (Node 24.22.3). The numbers matched. The fixing session reports that every
check added for the fixes also failed on a copy of the tree with the fixes switched
off. That was not repeated in the rerun.

| Suite | Result |
|---|---|
| Unit | 172 / 172 |
| Live loop | 41 / 41 on each of 5 runs |
| Security | 13 / 13 |
| Migrations | 204 / 204 |
| Resume | pass (7 mandated steps, 0 failures) |
| Integrity | pass (6 mandated steps, 0 failures) |
| Review queue | 83 / 83 on each of 5 runs |
| Evidence reads | 37 / 37 on each of 5 runs |
| Question kinds | 5 failures, the same five as before this work: no fixtures for `hottext`, `dropdown`, `table`, `grid`, `poll` |

Phase 0 ended at 103 unit checks, 11 security checks and 142 migration checks.

After the Phase 2 approval gate (19 November 2026, Node 24.22.3): unit 226 / 226,
migrations 229 / 229, approval gate (`bank.mjs`) 63 / 63, and live loop 41, security
13, review 83, evidence 37, resume and integrity pass, question kinds the same 5
failures, each run once. The check that an answer naming a draft is refused was run
once more with its guard removed and failed, as it should. `scripts/smoke.mjs` was
updated (it now approves the generated drafts before opening its room) but **not
run**: it uses whatever `server/.env` configures, which includes a Gemini key.

After several kinds per level and the four kinds (19 November 2026, Node 24.22.3,
each run once unless noted): unit 279 / 279, `kinds.mjs` 43 / 43 (four runs), round
trip 0 failures, approval gate 63, live loop 41, security 13, migrations 229, review
83, evidence 37, resume and integrity pass (exit 0). Plan totals, per-level counts,
topic spreads and warnings were compared on 77 requests, and the offline banks'
per-level counts on the sample chapter, against snapshots taken before the change:
identical.

After images and passages as stimuli (19 November 2026, Node 24.22.3, each run
once): unit 298 / 298, migrations 253 / 253, `media.mjs` 63 / 63, approval gate 63,
kinds 43, live loop 41, security 13, review 83, evidence 37, round trip 0 failures,
resume and integrity pass. With the running-room condition removed from
`servedToPhones`, 7 checks in `media.mjs` and 1 unit test failed; with the
same-chapter condition removed from `withUpload`, 3 and 1. Both restored.

After item statistics and question sets (19 November 2026, Node 24.22.3): unit
329 / 329, migrations 270 / 270, `items.mjs` 49 / 49 (six runs), approval gate 63,
kinds 43, media 63, live loop 41, security 13, review 83, evidence 37, round trip 0
failures, resume and integrity pass. Each new guard was removed once and seen to
fail, then restored: the set check on the answer fallback (5 checks), the set
filter on the live loop's bank (9), the per-student seed in the option counts (2,
and 1 unit test), the set in the image rule (1 unit test) and the recording of
`shownOptions` (2).

After the fixes from the Phase 2 review (19 November 2026, Node 24.22.3, each run
once unless noted): unit **343 / 343** (three runs), migrations 270 / 270,
approval gate (`bank.mjs`) **73 / 73**, media **67 / 67**, items 49 / 49, kinds 43 /
43, live loop 41 / 41, security 13 / 13, review 83 / 83, evidence 37 / 37, round trip
0 failures, resume (7 mandated steps) and integrity (6) with 0 failures. Every new
check was first run against the code before its fix and seen to fail: split and
merge of a rejected draft (2 unit tests; the 3 HTTP checks in `bank.mjs` with the
rule switched back), the rejected draft's answer, the snapshot fields, the
replacing generate (2) and the regenerate warning (`bank.mjs`), the option counts
and versions (2 unit tests), the archive's copies (1), the url spellings (3 unit
tests) and the stored metadata (2 in `media.mjs`). The four url-spelling checks in
`media.mjs` were written after that fix and were not seen to fail.
`withoutMetadata` was also run on real files, outside the suites: a JPEG written by
Windows' GDI+ with GPS, camera make, model and serial in its Exif, and a GDI+ PNG
with text, time and Exif chunks added; GDI+ decoded both before and after with
every pixel equal, and the JPEG kept only its orientation (6). Two real 1x1 WebPs
(lossless and lossy) wrapped with EXIF and XMP chunks decoded the same before and
after through Windows' WebP codec. No phone browser was used.

`scripts/smoke.mjs` fails, for reasons older than this work: it expects every
generated item to be a four-option mcq (untrue since several kinds per level), and
its teacher socket watches without a key, which `teacher:watch` has refused since
Phase 0, so it times out waiting for the grid. Run through a wrapper that blanks
the store and model settings first, it got that far and stopped there. **One run
was made by mistake without the wrapper**, so with `server/.env`'s Supabase and
Gemini settings: it took 100 seconds against 10 offline, so it most likely called
Gemini to generate from the built-in sample chapter and tried Supabase, whose
hostname does not resolve from here.

## Full rerun after Phase 2 (19 November 2026)

Every suite was run once more, in sequence, after the fixes from the Phase 2 review
(Node 24.22.3). The figures are what each run printed:

| Suite | Result |
|---|---|
| Unit (`npm test`) | 343 / 343, 72 suites. Per file: accounts 11, approval 24, archive 6, checks 32, edits 24, evidence 51, integrity 16, itemstats 34, kindmix 27, mastery 27, media 27, newkinds 26, review 17, selector 21 |
| Migrations | 270 / 270 |
| Live loop | 41 / 41 |
| Security | 13 / 13 |
| Review queue | 83 / 83 |
| Evidence reads | 37 / 37 |
| Resume | 7 mandated steps, 0 failures, 0 supporting failures, 0 known holes |
| Integrity | 6 mandated steps, 0 failures, 0 supporting failures, 0 known holes |
| Question kinds round trip | 16 kinds, 64 checks, 0 failures |
| Approval gate (`bank.mjs`) | 73 / 73 |
| Kinds (`kinds.mjs`) | 43 / 43 |
| Images and passages (`media.mjs`) | 67 / 67 |
| Item statistics and question sets (`items.mjs`) | 49 / 49 |

No output held a failing line. `smoke.mjs` was not run (see above).

**How `resume.mjs` and `integrity.mjs` were run.** Both call `initStore()` with
whatever `server/.env` configures, and the development machine's `.env` holds
Supabase and Gemini keys. In this pass each was started through a small wrapper
outside the repository. The wrapper imports `server/src/config.js`, sets
`config.supabase.url`, `serviceKey`, `anonKey`, `config.mongoUri` and
`config.gemini.apiKey` to `''`, then imports the script. Both share the one config
module, so the script ran on the in-process store with offline generation.

Blanking the variables on the command line should do the same:
`SUPABASE_URL= SUPABASE_SERVICE_ROLE_KEY= MONGO_URI= GEMINI_API_KEY= node server/scripts/resume.mjs`
from Git Bash, or `$env:X = ''` for each in PowerShell 7. `dotenv` never overwrites
a variable that is present, even when it is empty. That was checked for
`SUPABASE_URL` in both shells. The suites themselves were not run that way.

The scripts were not changed. Changing them is a small follow-up: the same four
lines the other scripts start with.

Also checked in this pass, by hand: the routes and reply shapes in `docs/API.md`
against the code, and against responses captured from a real server on the
in-process store (the content list's `draftCount`, the bank's `drafts`, the
dashboard's `drafts`, `existingDrafts` in the preview, the 409 on a bank of drafts,
reject, approve-all, bulk `stimulus`, a room with a set and its refusal, the room
list's and the phones' room read, Harder, and a phone answering a draft's id, which
gets the next `server:question` and no `server:result`).

## Phase 3: the roster, rooms for a class and attendance (19 November 2026)

Every suite was run through the offline runner, which blanks `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `MONGO_URI` and `GEMINI_API_KEY` in
the environment (`dotenv` never overwrites a variable that is present, even empty),
so `resume.mjs` and `integrity.mjs` also ran on the in-process store. Node 24.22.3.

| Suite | Result |
|---|---|
| Unit (`npm test`) | 374 / 374 (roster 31 new) |
| Migrations | 326 / 326 (56 new for `0016`) |
| Roster and attendance (`roster.mjs`) | 80 / 80 |
| Live loop | 41 / 41 |
| Security | 13 / 13 |
| Review queue | 83 / 83 |
| Evidence reads | 37 / 37 |
| Resume | 7 mandated steps, 0 failures |
| Integrity | 6 mandated steps, 0 failures |
| Question kinds round trip | 16 kinds, 64 checks, 0 failures |
| Approval gate (`bank.mjs`) | 73 / 73 |
| Kinds (`kinds.mjs`) | 43 / 43 |
| Images and passages (`media.mjs`) | 67 / 67 |
| Item statistics and question sets (`items.mjs`) | 49 / 49 |

Also checked: the three repos expose the same 43 methods (a script outside the
repository built each repo and compared their method names). **Not run:** the new
checks against the code before the change (they were written with it); `0016` and
the Supabase and Mongo roster methods against a real database (the Supabase requests
against a stub, the Mongo schemas by building documents); a real Supabase Auth
token; the attendance lock racing a room delete; any browser or phone.

## Phase 3: the teacher-record store (19 November 2026)

The same offline runner, with `records.mjs` added to its list. Node 24.22.3.

| Suite | Result |
|---|---|
| Unit (`npm test`) | 417 / 417 (wheel 19 and records 24 new) |
| Migrations | 414 / 414 (88 new for `0017`) |
| Teacher records (`records.mjs`) | 96 / 96 |
| Roster and attendance (`roster.mjs`) | 80 / 80 |
| Live loop | 41 / 41 |
| Security | 13 / 13 |
| Review queue | 83 / 83 |
| Evidence reads | 37 / 37 |
| Resume | 7 mandated steps, 0 failures |
| Integrity | 6 mandated steps, 0 failures |
| Question kinds round trip | 16 kinds, 64 checks, 0 failures |
| Approval gate (`bank.mjs`) | 73 / 73 |
| Kinds (`kinds.mjs`) | 43 / 43 |
| Images and passages (`media.mjs`) | 67 / 67 |
| Item statistics and question sets (`items.mjs`) | 49 / 49 |

Also checked: the three repos expose the same 60 methods (built and compared by a
one-off script). Measured: a realistic class of 60 (a mark each, 40 picks, 10
tallies, 5 group challenges, 10 insight actions) adds about 28 KB to a room's
archive. **Not run:** the new checks against the code before the change (written
with it); `0017` and the Supabase and Mongo record methods against a real database
(the Supabase requests against a stub, the Mongo schemas by building documents); the
paging of `allRecords` past 1000 rows; a real Supabase Auth token; two server
processes drawing at once (the unique place in a round is the database's guard,
tested on PGlite, not under a race); any browser or phone.

## Phase 3: room modes, the waiting room and the projector (19 November 2026)

The same offline runner, with `modes.mjs` added to its list. Node 24.22.3.

| Suite | Result |
|---|---|
| Unit (`npm test`) | 434 / 434 (17 new in `test/modes.test.js`) |
| Migrations | 451 / 451 (37 new for `0018`) |
| Modes and projector (`modes.mjs`) | 85 / 85, on each of 5 runs |
| Teacher records (`records.mjs`) | 96 / 96 |
| Roster and attendance (`roster.mjs`) | 80 / 80 |
| Live loop | 41 / 41 |
| Security | 13 / 13 |
| Review queue | 83 / 83 |
| Evidence reads | 37 / 37 |
| Resume | 7 mandated steps, 0 failures |
| Integrity | 6 mandated steps, 0 failures |
| Question kinds round trip | 16 kinds, 64 checks, 0 failures |
| Approval gate (`bank.mjs`) | 73 / 73 |
| Kinds (`kinds.mjs`) | 43 / 43 |
| Images and passages (`media.mjs`) | 67 / 67 |
| Item statistics and question sets (`items.mjs`) | 49 / 49 |

Also checked: the whitelist walk was shown to fail. A leak was put into the server by
hand (the pick's full name, allowed through the server's own whitelist, and the key
on an unrevealed question), `modes.mjs` run, and the walk failed naming the extra key,
the surname, a first name outside the pick and the early key, as did the
unrevealed-question check; the server was then restored. That run also showed one of
the cap checks could pick a question the student had already answered (a test fault,
not the server's); it was fixed, and the suite then passed five runs in a row. The repo parity unit test passes with the four new link methods in all
three repos. **Not run:** `0018` and the Supabase and Mongo link and settings methods
against a real database (the Supabase requests against a stub, the Mongo schemas by
building documents); a real Supabase Auth token; a phone or projector browser (the
projector page does not exist yet); two server processes (the projector's screen is
in one process's memory); a start racing a join under real network timing (the order
that makes it safe is reasoned in the code, and exercised only as the suite's
sequence happens to run).

## Phase 3: live insights, the student card and class analytics (19 November 2026)

The same offline runner, with `insights.mjs` added to its list. Node 24.22.3.

| Suite | Result |
|---|---|
| Unit (`npm test`) | 467 / 467 (33 new in `test/insights.test.js`) |
| Migrations | 451 / 451 (no migration in this part) |
| Insights (`insights.mjs`) | 65 / 65, on each of 7 runs |
| Modes and projector (`modes.mjs`) | 85 / 85 |
| Teacher records (`records.mjs`) | 96 / 96 |
| Roster and attendance (`roster.mjs`) | 80 / 80 |
| Live loop | 41 / 41 |
| Security | 13 / 13 |
| Review queue | 83 / 83 |
| Evidence reads | 37 / 37 |
| Resume | 7 mandated steps, 0 failures |
| Integrity | 6 mandated steps, 0 failures |
| Question kinds round trip | 16 kinds, 64 checks, 0 failures |
| Approval gate (`bank.mjs`) | 73 / 73 |
| Kinds (`kinds.mjs`) | 43 / 43 |
| Images and passages (`media.mjs`) | 67 / 67 |
| Item statistics and question sets (`items.mjs`) | 49 / 49 |

The repo parity unit test passes with `listSessionsForClass` in all three repos. The privacy check was shown to fail: the server was made to send the cards to the phones' room as well, `insights.mjs` run, and the phone check failed naming the leaked labels and ids; the file was then restored byte for byte.
**Not run:** `listSessionsForClass` against a real Supabase (the request against a
stub) or Mongo; a real Supabase Auth token; two server processes (the series and the
push throttle live in one process); a server restart with a room running (the series
is lost by design; not exercised); any browser, since no screen uses any of it yet.

## Phase 3 review fixes (19 November 2026)

Every check added for a finding was run against the unfixed code first and failed for
the finding's reason (10 unit tests, 14 checks in `modes.mjs`, 1 in `records.mjs`;
that `modes.mjs` run then stopped on the join timeout described below, before its last
two link checks), then passed after the fix. The same offline runner, unchanged list. Node 24.22.3.

| Suite | Result |
|---|---|
| Unit (`npm test`) | 475 / 475 (8 new: the archive's `classId`, a link's lifetime, the reveal rule, the names toggle after a restart, the flag id's shape, contact details in tally, label and group text, a short date in a name, contact details in a class's fields; the progress test now also checks counts per level from 5) |
| Migrations | 451 / 451 (no migration) |
| Modes and projector (`modes.mjs`) | 101 / 101 (17 new, 1 replaced), on each of 5 runs |
| Teacher records (`records.mjs`) | 97 / 97 (1 new) |
| Insights (`insights.mjs`) | 65 / 65 |
| Roster and attendance (`roster.mjs`) | 80 / 80 |
| Live loop | 41 / 41 |
| Security | 13 / 13 |
| Review queue | 83 / 83 |
| Evidence reads | 37 / 37 |
| Resume | 7 mandated steps, 0 failures |
| Integrity | 6 mandated steps, 0 failures |
| Question kinds round trip | 16 kinds, 64 checks, 0 failures |
| Approval gate (`bank.mjs`) | 73 / 73 |
| Kinds (`kinds.mjs`) | 43 / 43 |
| Images and passages (`media.mjs`) | 67 / 67 |
| Item statistics and question sets (`items.mjs`) | 49 / 49 |

New in `modes.mjs`: one 404 sentence for another professor's room and no room on grid,
pause, resume, close, integrity and delete; with 80 ms of latency put on `listProfiles`
(standing in for a Supabase round trip), a close sent 20 ms into a start leaves the
room closed and no question reaches the phone after `session:closed`, and two starts
at once give 200 and 409 with the waiting phone served once; `fromJoins` refused in a
Teacher-led room; a bank question's key revealed there and refused (409) in a Mixed
room, as is a tally's from the bank; progress with no counts per level under five
students answered and with them at five; one connection sending `student:join` and
`projector:watch` together is the phone (and the other way round the projector, with
nothing else sent to it); a link made 13 hours ago refused in the made-up token's words,
and one that runs out while watching dropped at the next change, both shown inactive
with `expiresAt`. `records.mjs` now uses flag ids of the insights' shape, and checks
that a free-text flag id and a phone number in a tally or a group's label are refused
and not kept. Three tests pinned the old behaviour and were changed with it: the
modes unit test of a revealed bank key (now in a Teacher-led room), the progress unit
test, and `roster.test.js`'s archive of a room with no class (no `classId` key now).
`modes.mjs`'s `join()` helper now catches the wait for a first item that a refused
phone never gets: the run had ended within its 4 seconds before, and the new checks
made it longer, so the unread wait ended the run.
**Not run:** the status lock and the link lifetime against Supabase or Mongo, or with
two server processes (the lock is in-process, like the student locks); a real
Supabase round trip rather than injected latency; any browser.

## Full rerun after Phase 3 (19 November 2026)

Every suite was run once more, in sequence, through the offline runner, after the
Phase 3 review fixes and with no code change since (Node 24.22.3). The figures are
what each run printed; no output held a failing line, and every exit code was 0.

| Suite | Result |
|---|---|
| Unit (`npm test`) | 475 / 475, 113 suites |
| Migrations | 451 / 451 |
| Live loop | 41 / 41 |
| Security | 13 / 13 |
| Review queue | 83 / 83 |
| Evidence reads | 37 / 37 |
| Resume | 7 mandated steps, 0 failures, 0 supporting failures, 0 known holes |
| Integrity | 6 mandated steps, 0 failures, 0 supporting failures, 0 known holes |
| Question kinds round trip | 16 kinds, 64 checks, 0 failures |
| Approval gate (`bank.mjs`) | 73 / 73 |
| Kinds (`kinds.mjs`) | 43 / 43 |
| Images and passages (`media.mjs`) | 67 / 67 |
| Item statistics and question sets (`items.mjs`) | 49 / 49 |
| Roster and attendance (`roster.mjs`) | 80 / 80, 0 requests refused off the machine |
| Teacher records (`records.mjs`) | 97 / 97, 0 refused |
| Modes and projector (`modes.mjs`) | 101 / 101, 0 refused |
| Insights (`insights.mjs`) | 65 / 65, 0 refused |

Also checked in this pass:

- **The three repos' methods**, by a one-off script outside the repository that
  builds each repo and compares the names: 64, the same in all three.
- **The Phase 3 index in `docs/API.md`** against a real server: a one-off capture
  script (outside the repository, settings blanked the same way, its own server on a
  random port) opened a Mixed class room with a waiting room and every new setting,
  joined a phone, started the room, answered, recorded an observation, made a
  projector link and drove its screens, revoked it, opened a Teacher-led room and a
  room with a cap of one. The examples there are its output. The phones were sent
  only `session:accepted`, `server:waiting`, `server:question`, `server:result`,
  `session:teacher-led` and `server:exhausted`, and none carried a roster name,
  "attendance", an observation kind, `teacher:insights` or a projector event; the
  projector only `projector:state` and `projector:closed` (and, on a second
  connection, `projector:refused`).
- **No client file calls a Phase 3 route or event** (searched `client/src`).

**Not run:** anything against Supabase, Mongo or a real Auth token; two server
processes; a server restart with a room running; any browser. The two review
findings not acted on (a deleted room's teacher screens left in its channel;
PostgREST's row cap on the roster reads) have no test.

## Checked by hand in the browser

These were checked on a local server with `--env-file` holding a generated teacher key,
blank Supabase and Gemini keys, and offline question generation:
- the Room settings card
- a retry after a wrong answer
- pause and resume reaching both screens
- the Supports panel (in `/__gallery`)
- the phone's support styles
- deleting a room from `/rooms` and downloading its archive

## Not covered

- **The client has no automated tests.**
- **Nothing that needs Supabase.** The Supabase project is unreachable, so these are
  untested:
  - linking a room profile to a student account
  - accommodations from a real account
  - the student redirect on `/`
  - CSV export with a bearer token
  - `GET /api/analytics/:id/answers` and the student detail's `topicLevels` called
    by a real professor or student (the functions under them are unit-tested on
    the in-process store)
  - the Mongo and Supabase `listAnswers` filters against a real database (only the
    query each would send is checked), including the queue's `before` cursor and
    whether PostgREST ANDs it with a `student` filter (no caller combines them)
  - `0011` and `0012` on the real database: whether any accounts there already
    clash (then `0011` warns and leaves its index uncreated), and the triggers
    under the real service role
  - the review queue with a bearer token: a professor's own rooms, and an HOD's
    403 on a decision
  - the two open findings from the Phase 1 review, which only show on Supabase: a
    24-character hex id answered with a 500, and an `offset` too large for
    PostgREST (`docs/API.md`, "Known open issues"). Neither has a test. On the
    in-process store, `?offset=1e21` on the room's answer list returns 200
  - the deployed site
- **The client's use of the Phase 1 endpoints.** No screen calls them yet.
- **Phase 2, several kinds per level and the four kinds**, untested: anything sent
  to Gemini (the per-kind prompt, the new schema fields, the per-kind top-up); the
  Mongo schema fix against a Mongo database (checked by building documents without
  one); the client's editor for the four kinds, which does not exist yet.
- **Phase 2, images and passages**, untested: `0014` and the Supabase repo's
  media methods against a real database (PostgREST's handling of a bytea sent and
  read as `\x` text, and of a 500 KB image as about 1 MB of JSON, is assumed, not
  seen); the Mongo media methods against a Mongo database; the boot probe's new
  table check; a signed-in professor uploading or reading an image (an HOD's 403,
  a bearer token on `GET /api/media/:id`); any browser, so an `<img>` on a real
  phone, its cache and its revalidation were not seen; and every screen, since
  none uploads or attaches anything yet. Metadata removal: never run on a photo
  from a real phone camera (only on GDI+ files and hand-built ones), and whether a
  phone browser applies the kept JPEG orientation was not seen.
- **Phase 2, item statistics and question sets**, untested: `0015` and the
  Supabase and Mongo repos storing `question_ids` against a real database (checked
  against a stubbed PostgREST and by building a Mongo document); a bearer-token
  caller on `/items` and `/stats`, including an HOD reading a professor's; the
  fewer-choices support reaching a phone through a real linked account (the script
  sets it on the server's socket); and every screen, since none exists.
- **Phase 2, the approval gate**, untested: `0013` on the real database; the
  Supabase and Mongo repos writing and reading the new question columns and
  `topic_slides`; the boot probe's new column check; a professor or HOD bearer
  token on the new routes (`created_by`/`approved_by` set to an account, an HOD's
  403); generation by Gemini recording its model id; a deck read by OCR keeping its
  slides; and every screen, since none calls these routes yet.
- **Phase 3, the teacher-record store**, untested: `0017` on the real database
  (its guard trigger under the real service role, PostgREST reading `integer[]`,
  `text[]` and `date` as the repo expects); the Mongo record methods against Mongo;
  the boot probe's six new tables; and every screen, since none calls these routes
  yet. `pickForProjector` is now used by the projector's `projector:state`
  (`modes.mjs`).
- **Phase 3, room modes, the waiting room and the projector**, untested: `0018` on the
  real database and its guard under the real service role; the Supabase and Mongo
  link methods against a real store; the boot probe's new column and table checks; a
  real bearer token; every screen, since no phone, console or projector page uses any
  of it yet; a server restart with a projector connected (its screen is in memory).
- **Phase 3, live insights, the student card and class analytics**, untested:
  `listSessionsForClass` on a real Supabase or Mongo; a real bearer token; a server
  restart mid-room (the KPI series and every "since the start" are lost by design);
  two server processes; the throttle under a real class's answer rate (the script's
  burst is tens of milliseconds); every screen, since none reads any of it yet.
- **Phase 3, the roster, rooms for a class and attendance**, untested: `0016` on the
  real database; the Supabase and Mongo class, roster and attendance methods against
  a real store; a roster or a room's marks over 1000 rows on Supabase (PostgREST's
  row cap; open in `docs/API.md`); the attendance lock racing a room delete; any
  browser.
- **Phase 3, across the phase**: no suite runs a real Supabase Auth token (the four
  Phase 3 scripts answer the Auth calls themselves); none runs two server processes;
  none covers a deleted room's code being drawn again while a teacher screen of the
  deleted room is still open (open in `docs/API.md`).
