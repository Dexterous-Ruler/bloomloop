# BloomLoop: end-of-session report, 19–20 November 2026

Branch `roadmap-phase0-evidence`, pushed to GitHub (`main` untouched; nothing merged to `main`).
Nothing was deployed. Every test below ran offline: Supabase was unreachable all session, and
no test made a Gemini call.

## What was inspected

- The whole server: routes, services, sockets, the three repositories and the migrations.
- The rebuilt client.
- The owner's design zip, screen by screen (`docs/UI_ZIP_AUDIT.md`).
- Visuals for every subject (`reports/BloomLoop visuals research.md`):
  - libraries measured;
  - server-side drawing engines prototyped and checked by eye.

## What was implemented

| Work | Commits |
|---|---|
| Phase 4: course outcomes, configurable attainment, marks register, CSV and printable reports | `eedfd5e`, UI `906317f` |
| The owner's 19 Nov decisions and Phase 5: class questions with confidence and pause-discuss-re-vote, misconception labels, honest indicators | `2f4fd2b`, follow-ups `4c1df09`, test fix `191e74c`, UI `fdac198` |
| Phase 6, the student Learning Hub: backbone, practice, Elo mastery, error log, FSRS reviews, Get Ready, paths, self-tests, lessons, English/Hindi/Marathi, hint tutor, server-rendered formulas and code | `646b4e6`, docs `d5619aa` |
| Phase 7, offline-first: question packs, late answers and a grace window, laptop mode, room import, replay-safe teacher records | `46bf6f9`, docs `d3a7308`, fixes `b2c3f1b`, `25c706a` |
| UI: the Learning Hub (student and staff) and Phase 7's offline client | `eb397c5`, server asks `cebef97` |
| Batch 8: figures for every subject, interactive question kinds, the design-zip gaps | UI `4384844`, server `ba0f59d`, docs `1cfc643`, review fixes `2b06016`, test fixes `72611c3`, `8b8d147` |

**Batch 8 covers:**
- **Figures, nine spec types drawn by the server:** plots, charts, number lines, geometry and
  optics, timelines, diagrams, molecules, patterns, call stacks. Each comes with a text
  description and a data table. Figures can step through on the projector and in lessons.
- **Slide pictures:** pictures kept from the professor's own slides, with regions marked on
  them.
- **New question kinds, marked on the server:** tap a part, label a diagram, plot, number line
  and bar chart.
- **The design-zip gaps:**
  - the AI teaching move;
  - the wheel's question mode;
  - per-room level figures;
  - the concept panel;
  - "rooms only" questions;
  - serve tokens;
  - and the rest listed in `docs/UI_ZIP_AUDIT.md`.

**Review:** every phase went build → two independent reviewers → fix → docs.

| Phase | Findings | Fixed | Notes |
|---|---|---|---|
| 5 | 21 | 12 | Two key leaks fixed |
| 6 | 19 | 13 | Includes a key leak through hub practice |
| 7 | 16 | 16 | |
| Batch 8 | 26 | 20 | 2 rejected; 7 left as owner decisions or known gaps |

## Database migrations (all additive)

| Files | Covers |
|---|---|
| `0019`–`0021` | Phase 4 |
| `0022`–`0024` | Decisions and Phase 5 |
| `0025`–`0029` | Learning Hub |
| `0030`–`0032` | Offline |
| `0033`–`0036` | Batch 8 |

**Deploy order:**
- Apply `0000`–`0036` in number order BEFORE deploying the new server.
- `0022`, `0023`, `0024` and `0030` are needed by rooms.
- Without `0036`, a hub answer sent without its serve token returns an error.
- None has run against the hosted project: they ran on PGlite only.

**Deploy settings:** set `HUB_SERVE_TOKEN_SECRET` (or `SERVER_SECRET`). A laptop-mode teacher key
must be at least 16 characters.

## Tests executed (offline runner, every suite)

The final run on the pushed tree before the last test-only fix passed:
- unit 1277/1277;
- migrations;
- all 37 end-to-end scripts, including the new ones:
  - hub, practice, paths, lessons, tutor (Phase 6);
  - offline, laptop, recordsync (Phase 7);
  - figures, figkinds, zipgaps1, zipgaps2 (Batch 8).

Three intermittent tests were found and fixed:
- `classquestion.mjs`: a row-ordering tie.
- `laptop.mjs` and `offline.mjs`: a server-start race and a clock jump against the socket
  heartbeat.
- `zipgaps1.mjs`: a random topic choice.

Each now passes 6 runs out of 6.

## Remaining issues

**Never run:**
- real Supabase, Mongo, a real sign-in token or real Gemini output;
- a real phone, iOS, or a screen reader;
- MathML on a low-end Android;
- two server processes.

**Batch 8 screens:** checked against the batch 8 servers before its review fixes. After the
fixes, only hub answers with serve tokens were re-checked. Figures, the projector steps, the
figure builder, teaching moves and the wheel should be re-checked against `2b06016`, especially
the tap and label kinds, whose tokens changed.

**Earlier in the project:** a Phase 2 fix agent ran `smoke.mjs` with the live `.env`, which
probably used some Gemini quota.

**Deliberate leftovers:**
- The old room CSV accepts `?key=`.
- Supports follow a typed roll number.
- Split/merge loses `replacesId`.
- The status lock is per process.
- No general per-socket rate limit.
- `student:next` can browse questions.
- Older shuffles use a seed a phone can compute.
- The projector diagram mode shows a tap/label figure's real part names.

**Not built:**
- DPDP archive erasure;
- a live chat tutor (owner option);
- adaptive paper cards (the directive says last);
- generated maps (Indian map law).

**Public GitHub history on `main`** still holds the local folder path and a team member's
email. Both are fixed going forward.

## Decisions taken under your delegation (recorded in docs/PRODUCT_DECISIONS.md)

- Decisions 1–8 and (a)/(b).
- Hub decisions H1–H18.
- Offline decisions O1–O5.
- The visuals plan: code-drawn figures only, never image-model output.
- The design-zip gap choices.
- Roll order by default.
- The shared-bank rules: rooms-only questions and serve tokens.
- The kept-answer cap of 100.
- The phone page ceiling of 166 KiB.

## Decisions that still need you

1. **Legal:** a lawyer must check decision 8 (DPDP, the under-18 mark) and Indian maps before
   any college signs, by 13 May 2027.
2. **Deploying:** migrations first, then the server, then the secrets above. Nothing has been
   deployed.
3. **Merging:** whether to merge `roadmap-phase0-evidence` into `main`.
4. **History:** whether to rewrite the public history to remove the old path and email (a
   force-push).
5. **Live chat tutor:** whether you want one (cost, and a reversal of decision 5).
6. **Laptop mode's key:** it travels in clear over HTTP on a LAN. Accept this, or add
   certificates?

## Exact next implementation task

1. Re-check the batch 8 screens against `2b06016`: tap and label kinds, figures, projector
   steps, figure builder, teaching moves.
2. Run the first real-environment test:
   - apply migrations `0000`–`0036` to a Supabase branch database;
   - run the server against it with one real professor and one real student account;
   - take one phone through a room, the hub and an offline outage.
