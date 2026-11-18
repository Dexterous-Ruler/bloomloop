# Testing

Every suite runs offline on the in-process store or on PGlite. None of them touches
Supabase, Gemini or any other network service.

| What | Command (from the repo root unless noted) | Covers |
|---|---|---|
| Unit | `cd server && npm test` | Mastery ladder, selector, edits, integrity signals (including `level-jump`), accounts, the room archive (size, exact round trip, paging), reviews, and the evidence reads: the student redaction for all 16 kinds, the topic report, one student's answers across rooms on the in-process store, the three repos having the same methods, and the query the Mongo and Supabase repos would send for the new filters (not a database test) |
| Live loop | `node server/scripts/liveloop.mjs` | A real socket server: ownership on `teacher:watch`, evidence rows, idempotent answers, polls, retries, redemption and the mastery goal, pause/resume status, deleting a room into an archive |
| Security | `node server/scripts/security.mjs` | Auth and ownership on HTTP routes, with seeded owned and unowned rooms; a phone answering a question from another room's content is not marked, not sent its key, and nothing is stored |
| Migrations | `cd server && npm run migrations` | Every file in `supabase/migrations` on a fresh PGlite database: a second run, an upgrade from v1 with data, every column the server uses, constraints, RLS on every table, room archive limits; one roll number per department as a room reads it (`0011`, including a database that already holds a clash); the evidence and review-log guards (`0012`); the `draft` status, question provenance and approval columns and `contents.topic_slides`, with older rows left as they were (`0013`); uploaded images (`0014`): a PNG written in bytea's text form and read back byte for byte, the type, size, digest and alt rules, the bytes, type and chapter refused a change while the alt text takes one, the uploader's account deleted (image kept, owner cleared), the chapter deleted (images gone), and the two new indexes; a room's question set (`0015`): a set read back in order, null for a room without one (and for v1 rooms after the upgrade), an empty set, a null inside one, a two-dimensional one and a non-uuid refused, and a closed room keeping its set |
| Resume | `node server/scripts/resume.mjs` | A student resuming onto their pinned question; discarded questions are not served. **Reads `server/.env`**: unlike the scripts above it does not blank the store and model settings, so on a machine whose `.env` holds Supabase or Gemini keys it would use them. Run it through a wrapper (below) |
| Integrity | `node server/scripts/integrity.mjs` | The signals recorded from real socket traffic. **Reads `server/.env`**, as `resume.mjs` does; run it the same way |
| Question kinds | `node server/scripts/roundtrip.mjs` | All 16 kinds: valid, the right answer scores 1, a wrong one 0, and the phone's view carries no key (deep scan, `answers` included). 0 failures since Phase 2 wrote the five missing fixtures (`hottext`, `dropdown`, `table`, `grid`, `poll`; a poll's "wrong" answer is a position off its list, which records nothing) |
| Kinds per level (Phase 2) | `node server/scripts/kinds.mjs` | A real server on the in-process store, shared key, offline generation: the preview divides each level over its kinds with every count unchanged, a selected-response kind asked of Create refused out loud, a `kindMix` applied; the bank written has the plan's numbers and hot text, dropdown, table and grid drafts, each valid; those four approved, served through the socket with no key in the payload, the right answer scoring 1 and a wrong one 0 for each kind, the solution in the shape each phone widget reads, every attempt stored; `PATCH` on each kind, invalid refused with the validator's words and nothing changed, valid landing whole and tidied. 43 checks. Unit: `test/kindmix.test.js` (the default mix, the rotation, counts preserved across 36 plan requests, no Create selected-response however asked, the offline bank's numbers, `validateItems` on each new kind) and `test/newkinds.test.js` (each template built, valid, grounded in the source, keyless, scoring 1 and 0; a valid and an invalid edit per kind; the Mongo schema keeping each kind's payload) |
| Client build | `cd client && npx vite build --outDir <somewhere outside the repo>` | The client compiles |
| Review queue | `node server/scripts/review.mjs` | A real server on the in-process store: a written answer marked provisional and listed in the queue; the shared key refused (404) on another professor's room; confirm then override with the response and `auto_*` unchanged, the history entry, tallies, grid route, CSV and live grid push following the human mark, and every decision logged; repeats idempotent; bad input and paging refused (including any `offset`); a review racing a live answer from the same student (lock); a closed room reviewed; two students sending the same answer with no key, or with one key, kept as two rows and reviewed apart; a resend rebuilt from a reviewed row keeping the review and dropping the machine's detail; a review refused while its room is archived and deleted, and one already under way waited for and archived; walking the queue by its cursor while confirming reaches every answer. 83 checks |
| Approval gate (Phase 2) | `node server/scripts/bank.mjs` | A real server on the in-process store, shared key, offline generation (the Gemini key is blanked whatever `.env` says): a `.pptx` built in the script is uploaded and keeps each topic's slides; generation saves drafts with `model: offline-template`, the topic's slides and the rule checks, and pasted text gives no slides; the bank, the content list and `bankCount` count drafts apart; a room on a bank of drafts is refused (409) with its sentence; an edited draft stays a draft with its checks re-run; approve with a failing check allowed and named; approve twice changes nothing; reject; the older PATCH restore records an approval; approve-all with its flagged list; Harder, Easier and Harder from Evaluate (a written Create) as new drafts with the original untouched, both ends of the ladder refused, a plain regenerate still discarding; write-your-own active with `model` null, checks as advice, a poll, a cross-level kind and a malformed one refused; the room then serves only approved questions to a student until exhausted, never a draft or the rejected one, and an answer naming a draft is not marked or stored; another professor's bank gets the same 404, word for word, as a bank that does not exist, on every new route, and nothing of theirs changes. Since the Phase 2 review also: a plain regenerate of an active question says in `warnings` that it has left rooms; an answer naming a rejected draft is not marked or stored; an answer's snapshot keeps the model but not `approvedBy`/`approvedAt`; a replacing generate refused (409) while the room is open with nothing deleted, an appending one allowed, and a replacing one answering once the room is closed; split and merge of rejected drafts over HTTP giving drafts with no approval. 73 checks. Unit: `test/checks.test.js` (every check both ways, and on the offline generator's output) and `test/approval.test.js` (status transitions, split/merge/edit, write-your-own validation, slides from extraction to the question) |
| Images and passages (Phase 2) | `node server/scripts/media.mjs` | A real server on the in-process store, shared key, offline generation: PNG, JPEG and WebP uploaded and told by their bytes (a PNG sent as `photo.jpg` stored as a PNG); an SVG, the same SVG named and typed as a PNG, a page of script named `photo.jpg`, a GIF, one byte over the limit (413; exactly the limit is taken), no or blank or over-long description, no file, JSON instead of a form and no credentials, each refused; another professor's chapter, a missing one, a malformed id and none at all the same 404, before anything about the file is said; the teacher served the bytes with the type, nosniff, the private year-long cache, the sha256 ETag (a 304 on revalidation), the CSP, and by `?key=`; a phone refused (404, `no-store`) before any room, a wrong key judged as a phone; an upload attached to a question in any spelling of its url, stored canonical with the upload's alt, clearing the slide-only check; their upload, a missing one, the caller's other chapter's and a malformed url refused word for word with the question untouched; write-your-own and a draft carrying one; a passage with a citation shared by every approved question through the bulk action (over-long text and citation refused), each an equal copy; the room open, a phone served the passage without its citation, then the image, which it loads with no credential; an image only a draft shows, one replaced, one attached to nothing and another chapter's still refused; served while paused, refused once closed, the teacher still served; null taking a stimulus off. Since the Phase 2 review also: a JPEG carrying a location and a comment stored and served without them, its size and hash those of what was kept; their upload under four other spellings (dot segments, an absolute url) and through bulk `stimulus` refused; my own upload under another spelling stored canonical. 67 checks. Unit: `test/media.test.js` (the signatures, the url helpers and every spelling a browser resolves to the media route, `withoutMetadata` on hand-built JPEG, PNG and WebP files with nothing left of their metadata and the orientation kept, `withUpload` and `servedToPhones` on the in-process store, the citation's rules and its absence from the phone, the slide-only check with an upload, the three repos' media methods: in-process, the request the Supabase repo sends and how it decodes bytea's text form against a stubbed PostgREST, and the Mongo schema built without a database) |
| Item statistics and question sets (Phase 2) | `node server/scripts/items.mjs` | A real server on the in-process store, shared key: twelve phones answer six questions (mcq, a wrongly keyed mcq, true/false, match, categorise) through the socket, each choosing by the text on its own shuffled screen; `GET /api/session/:code/items` then equals a hand count of their choices per option in the question's own order, the hand proportions, mean scores and bands, and point-biserials worked here by the textbook formula from the same marks; the wrong key negative, flagged and first, nothing else flagged. Question sets: not a list, empty, over 500, a draft, a rejected question, another chapter's, a malformed and an unknown id each refused, the last five in one sentence; a set of one on a chapter too thin for a whole-bank room opens; the room list carries the set; a two-question room serves exactly those two, never a pin from outside the set, and an answer naming one outside it is neither marked nor stored; the phones' room read gives the set's count without the ids or the content id. `GET /api/bank/:contentId/stats` sums both rooms. A fewer-choices pick (supports set on the server's socket, as Supabase is out of reach) stored with `shownOptions` and counted on the option it was. Another professor's bank and room the same 404, word for word, as missing ones; no credentials 401. 49 checks. Unit: `test/itemstats.test.js` (Pearson, the point-biserial against hand values, the floors and cut points, `toOriginalResponse` for every kind against `forStudent` and `score`, a ten-student room worked by hand, what is and is not counted, the set in the selector, the image rule and the archive, the readers, and the three repos keeping the set: in-process, the Supabase request against a stub, the Mongo schema without a database) |
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
