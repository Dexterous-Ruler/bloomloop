# BloomLoop: end-of-session report, 19 November 2026

Branch `roadmap-phase0-evidence`, pushed to GitHub (not `main`; nothing merged to `main`).
Nothing was deployed. Every test below ran offline: Supabase was unreachable all session,
and no Gemini call was made by any test.

## What was inspected

- The whole server: routes, services, sockets, the three repositories and migrations.
- The rebuilt client.
- The owner's design zip, screen by screen (`docs/UI_ZIP_AUDIT.md`).
- Research on visuals for every subject (`reports/BloomLoop visuals research.md`): the
  libraries were measured, and the server-side drawing engines were prototyped and
  checked by eye.

## What was implemented

| Work | Commits |
|---|---|
| Phase 4: course outcomes, configurable attainment, marks register, CSV and printable reports | `eedfd5e` |
| UI: Phase 3 and 4 screens | `906317f` |
| The owner's 19 Nov decisions, plus Phase 5: class questions with confidence and pause-discuss-re-vote, misconception labels, honest indicators | `2f4fd2b` |
| Phase 5 follow-ups: the UI's asks, roll order, local paths removed, a team member's email withheld | `4c1df09` |
| The flaky class-question check fixed (a test bug; the server was right) | `191e74c` |
| UI: decisions, Phase 5 screens, offline phone (stage First), client-only design-zip gaps | `fdac198` |
| Phase 6, the student Learning Hub (server): backbone, practice, Elo, error log, FSRS, Get Ready, paths, self-tests, lessons, en/hi/mr, the hint tutor, server-rendered formulas and code | `646b4e6`, docs `d5619aa` |
| Phase 7, offline-first (server): question packs, late answers and the grace window, laptop mode, room import, replay-safe teacher records | `46bf6f9`, docs `d3a7308`, last fixes `b2c3f1b`, `25c706a` |
| UI: the Learning Hub (student and staff) and Phase 7's offline client | `eb397c5` |
| The client's eight server asks | `cebef97` |
| Batch 8: figures for every subject, interactive question kinds, the design-zip server gaps | IN PROGRESS, local branch `batch8`, NOT pushed (see below) |

Every phase went build → two independent reviewers → fix → docs, except where noted below.

- **Phase 5 reviewers:** 21 findings, 12 fixed. These included two ways to get a class
  question's key before the reveal.
- **Phase 6 reviewers:** 19 findings, 13 fixed. These included a key leak through hub
  practice of a live room's question.
- **Phase 7 reviewers:** 16 findings, all fixed. Four of them were in a follow-up, because the
  fix pass's input was cut off.

## Database migrations added this session (all additive)

`0019`–`0021` (Phase 4), `0022`–`0024` (decisions, Phase 5), `0025`–`0029` (Learning Hub),
`0030`–`0032` (offline). Batch 8's `0033`–`0036` exist only on its local branch.

**Deploy order matters:**
- `0022`, `0023`, `0024` and `0030` are needed by rooms. Without them, the boot probe stops
  using Supabase and names the file.
- The others warn.
- Apply all of them, in number order, BEFORE deploying the new server.
- None has run against the hosted project. They have run on PGlite only.

## Batch 8 status at the push

Built in four parts (figure engines; interaction kinds and figure generation; the live-room, wheel and analytics gaps; the material, bank, shared-bank and concept-panel gaps), each with green suites on its own branch, and being merged on the local branch `batch8` when the 23:00 deadline came. Its two reviewers and fix pass had not run, so it was NOT pushed: unreviewed code stays local. The workflow keeps running; it lands on `roadmap-phase0-evidence` with its docs once reviewed. Its screens are being built by the UI session on sample data.

## Tests executed (offline runner, every suite)

The last full run on `main` before batch 8 passed:
- unit 1057/1057, migrations 1457/1457;
- every end-to-end script (liveloop, security, review, evidence, resume, integrity,
  roundtrip, bank, kinds, media, items, roster, records, modes, insights, outcomes,
  attainment, acceptance4, decisions, classquestion, misconceptions, honesty, keysafety,
  hub, practice, paths, lessons, tutor, offline, laptop, recordsync).

## Remaining issues (honest list)

- **Never run:**
  - against real Supabase, Mongo, a real Supabase Auth token or a real Gemini output;
  - on a real phone or iOS;
  - with a screen reader;
  - with MathML on a low-end Android;
  - with two server processes.
- **Earlier in the project, a Phase 2 fix agent ran `smoke.mjs` with the live `.env`, which
  probably used some Gemini quota.**
- **Intermittent tests:**
  - `offline.mjs` timed out once (passed on rerun);
  - `laptop.mjs` raced its child server (fixed).
- **Deliberate leftovers:**
  - The old room CSV still accepts `?key=`.
  - `marksFromJoins` uses the current roster roll.
  - Supports follow a typed roll number.
  - Split or merge of a regenerated draft loses `replacesId`.
  - The status lock is per process.
  - No general per-socket rate limit.
  - `student:next` can browse questions.
- **Not built:**
  - archive erasure for DPDP;
  - a live chat tutor (owner option; conflicts with decision 5);
  - adaptive paper cards (the directive says last);
  - generated maps (Indian map law).
- **Public GitHub history on `main` still holds:**
  - the local folder path;
  - a team member's email.
  Both are fixed going forward. Removing them from history needs a force-push.
- **`V2-CONTRACT.md`'s student row** needs a line saying students now reach the hub.

## Decisions taken under your delegation (all recorded in docs/PRODUCT_DECISIONS.md)

- Decisions 1–8 and (a)/(b).
- Hub decisions H1–H18.
- Offline decisions O1–O5.
- The visuals plan (decision 4 revised: code-drawn figures, never image-model output).
- The design-zip gap choices.
- Roll order by default.
- The shared-bank rule ("rooms only" questions, serve tokens).
- The kept-answer cap of 100.
- The phone page ceiling of 166 KiB.

## Decisions that still need you

1. **Legal:** decision 8 (DPDP, the under-18 mark) and Indian maps need a lawyer before any
   college signs, by 13 May 2027.
2. **Deploying:** apply the migrations first, then the server. Nothing was deployed.
3. Whether to merge `roadmap-phase0-evidence` into `main`.
4. Whether to rewrite the public history to remove the old path and email (a force-push).
5. Whether you want a live chat tutor (cost, and a reversal of decision 5).
6. Laptop mode sends the shared key in clear over HTTP on a LAN. Do you accept this, or
   should we add certificates?

## Exact next implementation task

Finish batch 8: its merge, two reviewers and fix pass, then land it with its docs and wire its screens. Then run the first real-environment test:
1. Apply migrations 0019 onwards to a Supabase branch database.
2. Run the server against it with one real professor and one real student account.
3. Take one phone through a room, the hub and an offline outage.
