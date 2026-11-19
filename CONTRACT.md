# BloomLoop — frozen build contract

Every module below is written against **this file**. Do not change any signature here.
If something in this file looks wrong, flag it in your report — do not silently "fix" it.

Repo root: `C:\Users\tanis\wayground`. Node 20, ESM everywhere (`"type": "module"`),
2-space indent, single quotes, semicolons. No TypeScript. No new npm dependencies.

Installed and available: `express`, `cors`, `socket.io`, `mongoose`, `multer`, `adm-zip`,
`dotenv`, `@google/genai@0.14.1`, `@supabase/supabase-js@2`, `react@18`, `react-dom`,
`react-router-dom@6`, `socket.io-client`, `vite`, `@vitejs/plugin-react`.

> **Amendment 1 (after the parallel build).** The backend store moved to **Supabase**
> at the project owner's request. `@supabase/supabase-js` was added, `repo.kind` gained
> `'supabase'`, and `config.js` / `repo/index.js` were extended accordingly. The Mongo
> path is retained as a fallback. Record ids are therefore uuids or 24-char hex — always
> validate with `isRecordId` from `server/src/ids.js`.
>
> **Amendment 2.** Teacher and student share one origin, so teacher-only routes are now
> gated by `requireTeacher` from `server/src/teacherAuth.js` (header `x-teacher-key`, or
> `?key=` for plain links). Gated: all of `/api/content`, `/api/generate`, `/api/bank`,
> `/api/classroom` (except `/callback`), `POST /api/session`, `/api/session/:code/grid`,
> `/api/session/:code/close`, and the CSV export. **Ungated, and must stay that way:**
> `GET /api/health`, `GET /api/session/:code`, and the entire student socket flow —
> students have only a room code and a roll number, exactly as specified.
> `GET /api/session/:code` returns a trimmed session that **must never include
> `contentId`**, because that id is the route to the answer key.

---

## 1. Already written — import, never re-implement

| Module | Exports |
|---|---|
| `server/src/config.js` | `config`, `hasGemini()`, `hasMongo()`, `hasClassroom()`, `ROOT` |
| `server/src/bloom.js` | `LEVELS`, `FLOOR`, `CEILING`, `VERBS`, `LABEL`, `DEFAULT_MIX`, `levelIndex()`, `isLevel()`, `shiftLevel()`, `emptyLevels()`, `normaliseLevels()` |
| `server/src/repo/index.js` | `getRepo()`, `initStore()`, `closeStore()` |
| `server/src/ids.js` | `isRecordId(value)` — accepts a uuid **or** a 24-char hex id |
| `server/src/services/mastery.js` | `emptyProfile()`, `hydrate()`, `applyAnswer()`, `recomputeWorkingLevel()`, `eligibleLevels()`, `isSlowLearner()`, `rollingAccuracy()`, `overallAccuracy()`, `totals()`, `levelReport()`, and the constants `COLD_START_LEVEL`, `WINDOW`, `PROMOTE_AT`, `DEMOTE_AT`, `SLOW_LEARNER_BAND`, `MIN_EVIDENCE` |
| `server/src/services/selector.js` | `selectNext(profile, questions, opts?)`, `selectSet(profile, questions, count)` |
| `server/src/models/index.js` | `Content`, `Question`, `Session`, `Profile` (Mongoose) |
| `client/src/api.js` | `api.*` — the full REST client |
| `client/src/socket.js` | `connect()`, `EV` (event-name constants) |
| `client/src/styles.css` | all design tokens and classes — **use these classes, do not write new CSS files** |

`LEVELS` is exactly `['remember','understand','apply','analyse','evaluate','create']`.
Note the British spelling **`analyse`**. Never `analyze`, never capitalised, in any payload.

## 2. The repository interface (`getRepo()`)

Async, returns plain JSON objects with string `_id`. Three implementations exist
— **Supabase/Postgres (primary)**, MongoDB, and in-memory — chosen at boot in that
order; **your code must not care which**.

Because of that, ids are **either** a uuid (Supabase) **or** 24-char hex (Mongo,
in-memory). Never validate an id with a hand-written regex — import `isRecordId`
from `server/src/ids.js`. The Supabase adapter maps snake_case columns and `id`
to the camelCase / `_id` document shape below, so the shape is identical
whichever store is live.

```
kind                                      -> 'mongo' | 'memory'
createContent(doc)                        -> content
getContent(id)                            -> content | null
listContents()                            -> content[]      (newest first)
updateContent(id, patch)                  -> content | null
insertQuestions(docs)                     -> question[]
listQuestions(contentId, {includeDiscarded=false}) -> question[]
getQuestion(id)                           -> question | null
updateQuestion(id, patch)                 -> question | null
countQuestions(contentId)                 -> number          (active only)
createSession(doc)                        -> session
getSession(id) / getSessionByCode(code)   -> session | null
updateSession(id, patch)                  -> session | null
listSessions()                            -> session[]
getProfile(sessionId, rollNo)             -> profile | null
saveProfile(profile)                      -> profile         (upsert on sessionId+rollNo)
listProfiles(sessionId)                   -> profile[]       (sorted by rollNo, numeric)
```

## 3. Documents

```js
Content  { _id, title, kind:'pptx'|'syllabus', rawText, topics:[String], createdAt }
Question { _id, contentId, topic, text, options:[4 strings], answerIdx:0..3,
           bloom:<one of LEVELS>, status:'active'|'discarded', source:'llm'|'fallback' }
Session  { _id, code, contentId, title, status:'open'|'closed', startedAt, closedAt }
Profile  { _id, sessionId, rollNo, name, levels:{<level>:{seen,correct}} x6,
           workingLevel, reason, history:[{questionId, bloom, correct, at}] }
```

> **Amendment 5 (19 Nov 2026, decided under the owner's delegation).** Additive only.
> `Question.source` may also be `'teacher'`: a question a professor wrote in the bank
> (section 6 rule 5). A professor's question written before this date stays
> `'fallback'`; no stored row is rewritten.

Profiles are only ever built/changed through `mastery.js`. Never hand-edit `levels`
or `workingLevel` anywhere else — that is the whole point of having a pure module.

## 4. REST — exact paths and shapes

Mounted in `server/src/app.js`; each router is `export default router`.

| File | Method + path (after mount) | Body | Response |
|---|---|---|---|
| `routes/content.js` mounted at `/api/content` | `POST /` multipart `file` (.pptx) **or** JSON `{title,text}` | | `{contentId, title, kind, topics[], slideCount?, chars}` |
| | `GET /` | | `{contents:[{_id,title,kind,topics,createdAt,questionCount}]}` |
| | `GET /:id` | | `{content}` |
| | `PATCH /:id` | `{topics[]}` | `{content}` |
| `routes/generate.js` at `/api/generate` | `POST /` | `{contentId, topics[], perTopic?}` | `{bankCount, generated, source:'llm'\|'fallback'\|'mixed', perLevel:{...}, warnings[]}` |
| `routes/bank.js` at `/api/bank` | `GET /:contentId` | | `{questions[], counts:{<level>:n}, total, active}` |
| | `PATCH /question/:id` | `{status}` or `{text,options,answerIdx,bloom}` | `{question}` |
| | `POST /question/:id/regenerate` | | `{question}` (new item, same topic+level; old one set to `discarded`) |
| `routes/session.js` at `/api/session` | `POST /` | `{contentId, title?}` | `{code, sessionId, bankCount}` |
| | `GET /:code` | | `{session, content:{title}, bankCount, studentCount}` |
| | `GET /:code/grid` | | `{rows:[GridRow], levels:LEVELS}` |
| | `POST /:code/close` | | `{session}` |
| `routes/export.js` at `/api` | `GET /session/:code/export` | | `text/csv` attachment |
| `routes/classroom.js` at `/api/classroom` | `GET /status` | | `{configured, connected, reason}` |
| | `GET /auth` | | 302 to Google consent |
| | `GET /callback` | | HTML "you can close this tab" |
| | `GET /courses` | | `{courses:[{id,name}]}` |
| | `POST /post` | `{code, courseId}` | `{ok, courseWorkId, posted, skipped[]}` |

> **Amendment 5 (19 Nov 2026, decided under the owner's delegation), the regenerate
> row.** On an **active** question, `POST /question/:id/regenerate` no longer discards
> the old question: it stays active and serving, the new draft names it
> (`replacesId`), and the reply adds `replaces` and a `note`. Whichever route approves
> the draft (approve, approve-all, `PATCH` with `status: 'active'`, a bulk restore)
> sets the old one `discarded` and says so (`retired`). Rejecting the draft leaves the
> old one as it is. On a draft or a rejected question the old row is discarded at
> once, as before.

`GridRow` (used by REST *and* the socket broadcast — one shape only):

```js
{ rollNo, name, workingLevel, reason, slowLearner:Boolean,
  levels: { remember:{seen,correct}, ... },   // all six, always present
  total: { seen, correct }, answered:Number, online:Boolean }
```

> **Amendment 3 (19 Nov 2026, the owner's decision (a), taken under his delegation).**
> Labels are staff-only. `GridRow` is the **teacher's** row (`GET /:code/grid`,
> `teacher:grid`) and is unchanged. A phone gets `PhoneRow`, a student subset of it,
> built field by field (`phoneRow` in `server/src/routes/session.js`): never
> `slowLearner`, the integrity summary or the professor's `reason`, which can name the
> below-40% band. In their place `next` says, in plain words and with no band, which
> level comes next, why, and how many answers that rests on:
>
> ```js
> PhoneRow = { rollNo, name, workingLevel, levels, total, answered, online,
>              counted, withdrawn, mastered, masteryGoal,
>              next: { levels:[<level>], why:String, answers:Number } }
> ```
>
> **Amendment 4 (19 Nov 2026, Phase 5 honest indicators; the honesty fields the owner's
> decisions of that day approved, under his delegation).** Additive only. `GridRow`
> gains `levelBasis: { answers, provisional, sentence }` (what the working level rests
> on) and `masteryBasis: [{ level, answers, correct, mastered, provisional, sentence }]`
> (per level answered at). `PhoneRow` gains the same `masteryBasis` (its sentences name
> no band and no percentage) and `next.provisional: Boolean` (the level is a starting
> point, not yet an estimate). Nothing is removed.

Error style: `next(Object.assign(new Error('message'), {status: 400}))`.

## 5. Socket.io — exact event names

Client constants live in `client/src/socket.js` (`EV`). Server must match verbatim.

**Student → server**
- `student:join` `{code, rollNo, name?}`
- `student:answer` `{questionId, answerIdx}`
- `student:next` `{}` — request the next item

**Teacher → server**
- `teacher:watch` `{code}`

**Server → student**
- `session:accepted` `{profile: GridRow, session:{code,title}, bankCount}`
- `session:rejected` `{reason}`
- `server:question` `{question:{_id, text, options[], bloom, topic}, reason, index, bankCount}` — **never includes `answerIdx`**
- `server:result` `{correct, answerIdx, workingLevel, reason, levelChanged, profile: GridRow}`
- `server:exhausted` `{profile: GridRow}`
- `session:closed` `{}`

> **Amendment 3 (19 Nov 2026), for the phone's events.** Every `profile` sent to a
> phone (`session:accepted`, `server:result`, `server:exhausted`) is a `PhoneRow`
> (section 4), not a `GridRow`. The `reason` a phone is sent (`server:question`,
> `server:result`) is the phone's own sentence: why this question, or what comes next
> and why, never naming the band. The teacher's events below are unchanged.
>
> **Amendment 4 (19 Nov 2026, Phase 5 honest indicators, as above).** `server:question`'s
> `question`, and a class question's on `class:question`, gain `provenance: { by:
> 'professor'|'ai'|'not-ai', checked: Boolean, text: String }`: who wrote it, in a
> student's words ("Written with AI help and checked by your professor."), never
> naming a template, a fallback or a model. `question.source` stays as it was. Section
> 6 rule 5's visible label is `text`.
>
> **Amendment 5 (19 Nov 2026, decided under the owner's delegation; decision 7 and
> Phase 5).** Additive only; every event above keeps its fields.
> - `student:join` may carry `token`: a signed-in student's access token. It only
>   links the room profile to that student's account (when the account is a student
>   of the room's owner with the roll number typed); it never admits or refuses a
>   phone. The credential stays room code + roll number (section 6 rule 3).
> - `session:accepted` adds `linked: Boolean`, `linkNote?: String` (only when a token
>   was sent and could not link) and `confidence: [{id, label}]`, the three taps.
> - `student:answer` may carry `confidence`: `'sure' | 'think_so' | 'guessing'`. It is
>   stored and read by nothing that marks or moves anything.
> - New, student → server: `student:vote` `{classQuestionId, round, response,
>   confidence?, answerId}`, a vote in the class question the professor is running.
> - New, server → student: `class:question` `{id, seq, round, state, voting, question,
>   options, confidence, mine, message}` (the question through `forStudent()`, named by
>   the class question's id, never with its key); `class:vote` `{id, round, counted,
>   mine, message}` (never whether it was right); `class:closed` `{id, revealed,
>   answer, correct, message}` (`answer` and `correct` null unless revealed).
> - New, server → teacher: `teacher:class-question`, a class question as the
>   professor's screens get it (counts, never a student's name).
> - A misconception label is never sent on any socket event.

**Server → teacher** (room `teacher:<code>`)
- `teacher:grid` `{rows:[GridRow], code}` — broadcast on every join, answer and disconnect

Students are in room `session:<code>`. A student is keyed by `code + rollNo`;
a reconnect with the same roll number **resumes the same profile** (test TC-07)
and must not create a second row in the grid.

## 6. Hard rules from the mentor transcript

1. **Generated teaching content only from the professor's own material.** It cites
   the slide or line it came from, is marked "AI draft" until the professor approves
   it, and never adds syllabus content the professor did not teach. No image
   generation. *(Amended 19 Nov 2026, the owner's decision 1, taken under his
   delegation; it read "No PPT/content generation, ever. Ingest only.")*
   "No image generation" means no image-model output. A figure drawn by code from
   data (an SVG plot, a labelled diagram from coordinates) is allowed, being
   reproducible and checkable; a code-rendered graph question kind is to be built as
   its own batch after Phase 6. *(Amended 19 Nov 2026, the owner's decision 4 and its
   revision that day, taken under his delegation.)*
2. **The live loop makes zero LLM calls.** Generation happens before the session.
3. **No student accounts or passwords.** The credential is `room code + roll number`.
4. The slow-learner ceiling is real: a student inside the below-40% band is
   **never** served an item above Understand.
5. Any question item not produced by the LLM must say so in `source` and be visibly
   labelled in the UI: `'fallback'` for an offline-template item, `'teacher'` for a
   question a professor wrote. Never present a template item, or a professor's, as
   model output. *(Amended 19 Nov 2026, under the owner's delegation: `'teacher'` is
   new, and a professor's own questions written before it stay `'fallback'`.)*

## 7. Style notes for UI agents

- **Do not edit `client/src/styles.css`** — it is shared by both UI agents and edits
  will collide. Use the classes it already defines; for a genuine one-off, use an
  inline `style={{ ... }}` prop.
- `client/src/bloom.js` already exists and exports `LEVELS`, `LABEL`, `tagClass(level)`,
  `cellClass(seen, correct)`, `pct(seen, correct)`. Use it; do not re-create it.
  Bloom tag markup: `<span className={tagClass(level)}>{LABEL[level]}</span>`.
- All React component files must be `.jsx`. Plain `.js` files must contain no JSX.
- The student view is the phone view. Tap targets >= 48px, one question per screen,
  no horizontal scrolling, works at 320px wide.
- The teacher view will be on a projector. The room code must be readable from the
  back of a lecture hall (`.code-hero`).
