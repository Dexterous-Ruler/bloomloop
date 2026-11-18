# Testing

Every suite runs offline on the in-process store or on PGlite. None of them touches
Supabase, Gemini or any other network service.

| What | Command (from the repo root unless noted) | Covers |
|---|---|---|
| Unit | `cd server && npm test` | Mastery ladder, selector, edits, integrity signals (including `level-jump`), accounts, the room archive (size, exact round trip, paging), reviews, and the evidence reads: the student redaction for all 16 kinds, the topic report, one student's answers across rooms on the in-process store, the three repos having the same methods, and the query the Mongo and Supabase repos would send for the new filters (not a database test) |
| Live loop | `node server/scripts/liveloop.mjs` | A real socket server: ownership on `teacher:watch`, evidence rows, idempotent answers, polls, retries, redemption and the mastery goal, pause/resume status, deleting a room into an archive |
| Security | `node server/scripts/security.mjs` | Auth and ownership on HTTP routes, with seeded owned and unowned rooms; a phone answering a question from another room's content is not marked, not sent its key, and nothing is stored |
| Migrations | `cd server && npm run migrations` | Every file in `supabase/migrations` on a fresh PGlite database: a second run, an upgrade from v1 with data, every column the server uses, constraints, RLS on every table, room archive limits; one roll number per department as a room reads it (`0011`, including a database that already holds a clash); the evidence and review-log guards (`0012`) |
| Resume | `node server/scripts/resume.mjs` | A student resuming onto their pinned question; discarded questions are not served |
| Integrity | `node server/scripts/integrity.mjs` | The signals recorded from real socket traffic |
| Question kinds | `node server/scripts/roundtrip.mjs` | All 16 kinds through serve, answer and score. **5 known failures** in its fixtures (Phase 2) |
| Client build | `cd client && npx vite build --outDir <somewhere outside the repo>` | The client compiles |
| Review queue | `node server/scripts/review.mjs` | A real server on the in-process store: a written answer marked provisional and listed in the queue; the shared key refused (404) on another professor's room; confirm then override with the response and `auto_*` unchanged, the history entry, tallies, grid route, CSV and live grid push following the human mark, and every decision logged; repeats idempotent; bad input and paging refused (including any `offset`); a review racing a live answer from the same student (lock); a closed room reviewed; two students sending the same answer with no key, or with one key, kept as two rows and reviewed apart; a resend rebuilt from a reviewed row keeping the review and dropping the machine's detail; a review refused while its room is archived and deleted, and one already under way waited for and archived; walking the queue by its cursor while confirming reaches every answer. 83 checks |
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
