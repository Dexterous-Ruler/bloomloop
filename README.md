# BloomLoop

**Adaptive, Bloom's-taxonomy-aligned assessment for mixed-ability classrooms.**

A teacher uploads the chapter they already teach. BloomLoop turns it into a question
bank where every item is tagged to one of the six levels of Bloom's revised taxonomy,
then runs a live room-code session in which **each student is served questions at the
level they have actually reached** — and re-plans after every single answer.

Content authoring stays with the teacher and with NotebookLM. Making it adaptive is
the job.

> Rudrakash Bharti (ADT24SOCB0934) · Tanishq Aryan (ADT24SOCB1286)
> Guide: Prof. Harshad Lokhande · MIT School of Computing, TY-CSF

---

## Quickstart

```bash
npm install
```

```bash
cp .env.example server/.env
```

Fill in `GEMINI_API_KEY`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. **All are
optional** — see [Running without keys](#running-without-keys).

### Supabase setup (one time)

1. Create a project at [supabase.com](https://supabase.com).
2. **SQL Editor → New query →** run every file in [`supabase/migrations/`](supabase/migrations/)
   in number order (`0000` … `0008`). Each file is safe to re-run; see
   [`supabase/README.md`](supabase/README.md).
3. **Project Settings → Data API →** copy the *Project URL* into `SUPABASE_URL`.
4. **Project Settings → API Keys →** copy the **`service_role`** key into
   `SUPABASE_SERVICE_ROLE_KEY`.

The schema turns row level security **on with no policies**, so anon and authenticated
requests are denied outright and only the server's service-role key gets through. That
key is secret: it stays in `server/.env`, never in the client bundle.

> **`@supabase/supabase-js` is pinned to exactly `2.45.4` — do not let it float.**
> From ~2.11x the SDK requires a native `WebSocket`, which means Node 22+. This project
> targets Node 20 (report section 5.6), and on Node 20 the newer SDK fails at connect
> with *"native WebSocket not found"* — the server then falls back to the in-process
> store and the demo silently runs without persistence. We never use Realtime, so the
> requirement is incidental. Either keep the pin, or move the whole project to Node 22.

Development (two processes, hot reload):

```bash
npm run dev
```

Demo mode — builds the client and serves everything from **one origin on one port**,
which is what phones on a hotspot need:

```bash
npm run demo
```

The server prints the LAN URL students should type. It looks like
`http://192.168.x.x:5050/join`.

## Live

**https://bloomloop-goodfor-c4dd406d.koyeb.app**

| | |
|---|---|
| Teacher console | `…koyeb.app/?key=<TEACHER_KEY>` |
| Students | `…koyeb.app/join` |
| Projector, straight to a room | `…koyeb.app/?key=<TEACHER_KEY>&session=<CODE>&view=session` |

Hosted on Koyeb — app `bloomloop`, service `web`, **eco-micro in Singapore** (the
lowest-latency region Koyeb offers from Pune; Chennai is still "coming soon"). Built
from [`Dockerfile`](Dockerfile) — Node 20, client compiled at build time, server-only
runtime deps in the final image.

Secrets live as Koyeb environment variables and are **not** in the image: `.dockerignore`
excludes every `.env`, and `config.js` falls through to `process.env` when no file exists.

To redeploy after changing code:

```bash
tar -czf bloomloop.tar.gz --exclude=node_modules --exclude=.git --exclude=client/dist --exclude=*/.env .
```

Then upload the archive and roll the service (Koyeb API: `POST /v1/archives` with the exact
byte `size`, `PUT` the tarball with `Content-Type: application/octet-stream` **and**
`x-goog-content-length-range: <size>,<size>` — the signature covers both headers — then
`PUT /v1/services/<id>` with the new archive id).

## Verify it works

```bash
npm test
```

Unit tests for the mastery model and the adaptive selector — the promote/demote table
and the below-30–40% branch.

```bash
npm run smoke
```

End-to-end: boots the server, ingests a chapter, generates a bank, opens a session,
joins **ten simulated devices**, drives 80 answers through the live loop, asserts that
weak and strong students receive different Bloom levels in the same session, drops and
rejoins a device, and exports the CSV. Every check maps to an acceptance criterion.

```bash
npm run seed
```

Seeds a session that already contains one student inside the below-40% band and one at
the top of the ladder, then prints the room code and the two roll numbers. Join those
two roll numbers from two phones and the divergence is on screen immediately.

---

## The six features

| | Feature | Accepted when |
|---|---|---|
| **F1** | Upload a `.pptx`, or paste syllabus text | Real class deck → topic list in < 10 s |
| **F2** | Bloom-tagged question generation | ≥ 40 schema-valid tagged items from one chapter in < 2 min |
| **F3** | **Slow-learner differentiation** | Two phones, one session, visibly different questions |
| **F4** | Room-code live session | 10 devices join one code; rejoin resumes the same profile |
| **F5** | Interactive delivery + evaluation model | An answer moves the teacher grid in < 2 s |
| **F6** | Results to the teacher | CSV with per-level columns; Classroom post when configured |

F3 is the one that does not exist anywhere else, and it is the one to lead the demo with.

### How F3 actually decides

All of it lives in [`server/src/services/mastery.js`](server/src/services/mastery.js) as
pure functions, so it is unit-testable and explainable in one sentence — which is the
point, because a teacher will ask.

- No history → start at **Understand**, not Remember.
- Overall accuracy below **40%** (the mentor's own 30–40% band), after at least 3
  attempts → **Remember + Understand items only**. This ceiling is hard: the selector
  will return nothing before it breaks it.
- Rolling accuracy over the last **5** answers *at the current level*: **≥ 70% promotes**
  one level, **< 40% demotes** one level. Clamped to Remember…Create.
- Every decision carries a `reason` string, shown in the teacher grid.

## Architecture

```
React (Vite)                    Node 20 + Express            Supabase (Postgres)
┌────────────────┐   REST   ┌──────────────────────────┐      ┌──────────────────┐
│ Teacher console│ ──────── │ /content /generate /bank │ ──── │ contents,questions│
│ Student view   │  socket  │ /session /export         │      │ sessions,profiles│
└────────────────┘ ─────────│ Socket.io rooms          │      └──────────────────┘
        ▲                   └───────────┬──────────────┘
        │                               │  before class only
   phone browsers              Gemini 2.5 Flash — structured output
```

The store sits behind a repository interface (`server/src/repo/`) with three
implementations — Supabase, MongoDB, in-process — selected at boot in that order.
Nothing above that layer knows which one is live, which is what made moving from
Mongo to Supabase a one-file change.

**The live loop makes zero LLM calls.** All generation happens before the session, which
is what keeps a class of sixty inside free-tier quota and off the critical path.

The API and socket contract is frozen in [`CONTRACT.md`](CONTRACT.md).

## Running without keys

Neither key is required to run or demo, and the server tells you loudly which mode it
is in — at boot, on `/api/health`, and in the teacher console's top bar.

| Missing | What happens |
|---|---|
| `GEMINI_API_KEY` | Questions come from a deterministic offline template generator instead. Every item is stamped `source: "fallback"` and **labelled as such in the UI**. Never present these as model output. |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Falls through to `MONGO_URI`, then to an in-process store. Everything works; nothing survives a restart. A *configured but unreachable* Supabase also falls through, and says so at boot rather than failing on the first student join. |
| `GOOGLE_CLIENT_ID` / `SECRET` | F6 Tier 1 (CSV) only. The Classroom button stays visible and explains why it is disabled. |

### A classroom with no internet (laptop mode)

`npm --workspace server run laptop` runs the same server on a professor's laptop for
phones on its hotspot or a travel router. It refuses a teacher key shorter than 16
characters, saves each room to a local folder as it runs, and the room files are
imported back once online. Sign-in, the Learning Hub and AI generation are not
available in this mode. The step-by-step guide is
[docs/TRAVEL_ROUTER.md](docs/TRAVEL_ROUTER.md); the trade-offs of questions held on a
phone are in [docs/OFFLINE_SELECTION.md](docs/OFFLINE_SELECTION.md).

## Demo runbook

1. `npm run demo`, then read the LAN URL off the console.
2. Teacher console → upload the class PPT → topic list appears **(F1)**.
3. Generate → tagged bank, grouped by level. Discard one weak item **(F2)**.
4. Start session → code on the projector **(F4)**.
5. Ten classmates join on their phones.
6. **Point the camera at two phones — weak profile vs strong profile, different
   questions, same moment (F3).** Lead with this.
7. Answers flow → the teacher grid moves **(F5)**.
8. End session → export lands with per-level columns **(F6)**.
9. Close with: *"Content creation stays with the teacher and NotebookLM — making it
   adaptive is our job."*

Have `npm run seed` run beforehand as the backup path: if live joining is slow, the
seeded weak/strong pair already proves the claim.

## Layout

```
server/src/
  bloom.js              the six levels, Krathwohl verbs, the ladder
  config.js             env + capability flags
  ids.js                uuid-or-ObjectId validation, store-agnostic
  models/               Mongoose schemas (the MongoDB path)
  repo/                 store interface + supabase / mongo / in-process adapters
  services/
    extract.js          F1  pptx / syllabus -> topics
    generate.js         F2  Gemini structured output + validation + fallback
    mastery.js          F3  the mastery model (pure)
    selector.js         F3  adaptive selection (pure)
    csv.js              F6  export
  routes/               REST
  sockets/              F4/F5 live loop
  seed.js               demo seeding
  scripts/smoke.mjs     end-to-end driver
client/src/
  lib/                  data layer: api, auth, socket, drafts, theme, motion
  styles/               tokens.css is the palette and the direction; one file per area
  ui/                   component set (Radix behaviour, lucide icons) and level charts
  shell/                the frame: top strip, bottom dock
  fx/                   Tubes (liquid), Marbles (Rapier 2D), Drum (ammo.js + three.js), Mark (Lottie)
  teach/                console: material, questions, room, projector, live class
  learn/                phone view: join, question, level change, finish
  account/              sign-in, dashboards, rooms, analytics, profile
  dev/                  /__gallery: account screens with sample data (dev builds only)
```

The interface was audited with the unslop passes by Damir Sokolovsky
([@heydamir](https://x.com/heydamir)), CC BY 4.0.
