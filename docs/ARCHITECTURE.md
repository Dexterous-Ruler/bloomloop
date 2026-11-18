# Architecture

BloomLoop has one Node server (Express plus Socket.io) and one React client built with
Vite. The server is the only thing that talks to the database. The browser never holds
a database key.

```
phone (/join) ──socket──┐
                        ├── server ── repo ── Supabase Postgres  (primary)
teacher console (/) ────┤                  └─ MongoDB            (fallback)
account screens ──HTTP──┘                  └─ in-process store   (last resort; nothing saved)
```

## Server (`server/src`)

| Area | Files | Role |
|---|---|---|
| Boot | `index.js`, `app.js`, `config.js` | `app.js` mounts the routes; `index.js` picks the store (`repo/index.js`) and prints the console link |
| Auth | `auth.js`, `teacherAuth.js`, `ownership.js` | Two ways in: a Supabase bearer token (an HOD, professor or student account), or the v1 shared `TEACHER_KEY`. `ownership.js` holds the single read/write rule; every route and the socket use it. Anything the caller may not read answers 404, the same as something that does not exist |
| Live loop | `sockets/index.js` | Join, serve, answer, retry, poll, pause, teacher watch. Scoring happens here, from the stored item. Every attempt is written to `answers` before the profile changes. Every profile write, from the socket or from a review, first takes an in-process lock per student (`lockProfile`), because each one reads the whole row and writes it back |
| Review | `routes/review.js` | The queue of written answers. A professor confirms or overrides the machine's mark; each decision is a row in `answer_reviews`, and the student's numbers follow (`applyReview` in `services/mastery.js`) |
| Adaptive engine | `services/mastery.js`, `services/selector.js` | The level ladder (promote at 70%, demote at 40%, a window of 5), the room's mastery goal, retries and redemption, and question choice. `servableFor` in `selector.js` is what a room may serve: approved questions, and only its question set's when it has one (`sessions.question_ids`, `0015`); the live loop's bank and the image rule both read it |
| Signals | `services/integrity.js` | Behavioural signals such as tab-away, too-fast and `level-jump`. Each is phrased as a prompt to look, never a finding |
| Supports | `accommodations.js` | The seven accommodations. Only the rendering switches reach the phone |
| Content and questions | `services/extract.js`, `ocr.js`, `generate.js`, `plan.js`, `edits.js`, `checks.js`, `questionTypes.js` | Turning a pptx or pasted syllabus into topics, then a question bank. Generation uses Gemini when a key is set and offline templates otherwise; offline questions are labelled as such. Since Phase 2 every generated question is a `draft` that no room serves until a professor approves it (`routes/bank.js`), carrying the model that wrote it, the slides its topic came from and the rule checks (`checks.js`, advice only). The plan (`plan.js`) also divides each level over several kinds of that level's own set, never changing a count |
| Stimuli | `routes/media.js`, `services/media.js` | Images a professor uploads for a question stimulus: PNG, JPEG or WebP by their bytes, at most 500 KB (`config.media.maxBytes`), with the metadata a camera writes (Exif GPS and the like) taken out without re-encoding (`withoutMetadata`), stored in the database (`media`, `0014`) and served at `/api/media/<id>`. That GET is open at the mount, because a phone's `<img>` carries no credential: a teacher who may read the chapter always gets the image, anyone else only while a room runs on the chapter and an approved question shows it (`servedToPhones`). A passage is text on the question (at most 4000 characters, an optional `sourceRef` citation kept from the phone). Questions share a stimulus by each carrying an equal copy; `POST /api/bank/bulk` with `action: 'stimulus'` attaches one to many |
| Accounts | `services/accounts.js`, `routes/auth.js` | The HOD → professor → student hierarchy, invites, Google link, accommodations |
| Rooms | `routes/session.js` | Open (on the whole approved bank, or on a question set), list, pause, resume, close and delete. Delete writes a JSON archive first (`services/archive.js`) |
| Item statistics | `services/itemStats.js` | How each question did: attempts, proportion correct, how many chose each option (mapped back through each student's shuffle with `toOriginalResponse` in `questionTypes.js`), mean score, a band for the class, the point-biserial and its negative flag. From final, graded answer rows; `GET /api/session/:code/items` for a room, `GET /api/bank/:contentId/stats` across a bank's rooms |
| Reports | `services/dashboard.js`, `analytics.js`, `csv.js`, `routes/export.js`, `routes/classroom.js` | Dashboards, analytics, the CSV export, and Google Classroom posting |
| Storage | `repo/memoryRepo.js`, `mongoRepo.js`, `supabaseRepo.js` | Three implementations with the same methods. The rest of the server never asks which one it got |

## Evidence

- **Answers.** Every submitted attempt is one row in `answers` (`0008`). It holds the
  response, the question as shown, topic, level, attempt number and the client's
  idempotency key, and it is never overwritten. A professor's review is written beside
  the machine's mark (`auto_*`).
- **History.** The profile's `history` is the engine's working record. Each entry
  points at its answer row by `answerId` and shares that row's timestamp.
- **Reviews.** A written answer's machine mark is stored as `provisional` and
  counts at once. A professor's confirm or override is written beside it on the
  answer row and appended to `answer_reviews` (`0010`). The phone is told
  `provisional: true` on its result.
- **Guards in the database.** Since `0012`, triggers refuse any change to an
  answer's evidence (the response, snapshot and `auto_*`) and any edit or delete of
  a review row, whoever sends it.
- **Deleted rooms.** A room's rows are deleted only after the whole room has been
  written to `room_archives` (`0009`), as JSON under 1 MiB, its review log included.
  While that runs, the room takes no answer and no review.
- **Reading it back.** `services/evidence.js` builds every answer a screen gets:
  in full for a teacher, through `redactForStudent` for the student who gave it,
  and the per topic × level report. Routes: `GET /api/session/:code/answers` and
  `/topics` (room, read rule), `GET /api/analytics/:id/answers` (one student
  across rooms, analytics scope). Item statistics read the same rows
  (`services/itemStats.js`); an answer given on the fewer-choices support keeps
  which options were shown (`shownOptions` on its snapshot).
- **Reference.** Every Phase 1 and Phase 2 endpoint and socket field, with request
  and response shapes: `docs/API.md`.

## The question bank's approval gate (Phase 2)

A question reaches a phone only once a professor has let it in. The rule is
enforced at every point that could serve one, not only at the first:

```
generate / regenerate / Harder-Easier ──> draft ──approve──> active ──> served
                                            │                  ▲
                                         reject             restore
                                            ▼                  │
                                        discarded ─────────────┘
write-your-own ───────────────────────────────────────> active (model null)
```

- **Writing.** `routes/generate.js` and the regenerate route in `routes/bank.js`
  insert every generated row as `draft`, with `model`, `sourceRef`, `checks` and
  `createdBy`. Write-your-own inserts `active`: its author is its approver.
- **Becoming active.** Approve, approve-all, and the older restore (`PATCH status:
  'active'`, bulk `restore`) all go through `approvePatch` / `activatePatch` in
  `services/edits.js`, which stamp `approvedBy` / `approvedAt` on model output
  nobody approved. Split, merge and edit keep a draft a draft (`unreviewed`,
  `inherit`), and a rejected draft counts as one.
- **Serving.** The live loop's bank is `servableFor` in `services/selector.js`:
  active questions only, and only the room's set when it has one. The selector, a
  resumed pin and the bank count read it. The answer handler's fallback, for a
  question discarded after it was served, refuses a draft, a rejected draft and
  anything outside the set (`sockets/index.js`). `POST /api/session` refuses a bank
  of drafts with 409.
- **Images follow the same rule.** `servedToPhones` in `services/media.js` serves
  an upload to a phone only while a running room's servable questions show it.
- **Checks are advice.** `services/checks.js` runs eight rules when a question is
  generated or written and on every edit, split, merge, retag, stimulus change and
  approval. Nothing is refused for failing one; the reply names the failures.

## Client (`client/src`)

| Area | Role |
|---|---|
| `main.jsx` | Routes. `/join` (the student) is the only eager screen; every other screen is lazy-loaded with the stylesheets only it uses |
| `learn/` | The student's phone: join, every question kind, results, retries, supports |
| `teach/` | The teacher's console: material → questions → room → live class → projector. It does not yet know the Phase 2 `draft` status or call any Phase 2 route (`docs/IMPLEMENTATION_STATUS.md`) |
| `account/` | HOD, professor and student dashboards; rooms; analytics |
| `lib/` | The data layer: `api.js`, `auth.js` (Supabase, loaded only off `/join`), `socket.js`, `draft.js`, `teacherKey.js` |
| `ui/`, `shell/`, `fx/`, `styles/` | Components, frame, motion and physics pieces, and tokens. The UI is being rebuilt; see `docs/UI_REBUILD.md` |
| `dev/` | `/__gallery`: account screens drawn with sample data, for development only |

## Database

Defined only by `supabase/migrations/` and described in `docs/DATABASE_SCHEMA.md`.
Row-level security is on for every table, with no policies, so only the server's
service-role key gets in. Uploaded images are rows too (`media`, bytea), so there is
no storage bucket and no second service.
