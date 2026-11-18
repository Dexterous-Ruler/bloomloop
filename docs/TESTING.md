# Testing

Every suite runs offline on the in-process store or on PGlite. None of them touches
Supabase, Gemini or any other network service.

| What | Command (from the repo root unless noted) | Covers |
|---|---|---|
| Unit | `cd server && npm test` | Mastery ladder, selector, edits, integrity signals (including `level-jump`), accounts, the room archive (size, exact round trip, paging) |
| Live loop | `node server/scripts/liveloop.mjs` | A real socket server: ownership on `teacher:watch`, evidence rows, idempotent answers, polls, retries, redemption and the mastery goal, pause/resume status, deleting a room into an archive |
| Security | `node server/scripts/security.mjs` | Auth and ownership on HTTP routes, with seeded owned and unowned rooms |
| Migrations | `cd server && npm run migrations` | Every file in `supabase/migrations` on a fresh PGlite database: a second run, an upgrade from v1 with data, every column the server uses, constraints, RLS on every table, room archive limits |
| Resume | `node server/scripts/resume.mjs` | A student resuming onto their pinned question; discarded questions are not served |
| Integrity | `node server/scripts/integrity.mjs` | The signals recorded from real socket traffic |
| Question kinds | `node server/scripts/roundtrip.mjs` | All 16 kinds through serve, answer and score. **5 known failures** in its fixtures (Phase 2) |
| Client build | `cd client && npx vite build --outDir <somewhere outside the repo>` | The client compiles |

## Results on 18 November 2026

| Suite | Result |
|---|---|
| Unit | 103 / 103 |
| Live loop | 41 / 41, 15 clean runs in a row |
| Security | 11 / 11 |
| Migrations | 142 / 142 |
| Resume | pass |
| Integrity | pass |
| Question kinds | 5 failures, the same as before this work |

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
  - the deployed site
