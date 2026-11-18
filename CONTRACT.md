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

`GridRow` (used by REST *and* the socket broadcast — one shape only):

```js
{ rollNo, name, workingLevel, reason, slowLearner:Boolean,
  levels: { remember:{seen,correct}, ... },   // all six, always present
  total: { seen, correct }, answered:Number, online:Boolean }
```

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

**Server → teacher** (room `teacher:<code>`)
- `teacher:grid` `{rows:[GridRow], code}` — broadcast on every join, answer and disconnect

Students are in room `session:<code>`. A student is keyed by `code + rollNo`;
a reconnect with the same roll number **resumes the same profile** (test TC-07)
and must not create a second row in the grid.

## 6. Hard rules from the mentor transcript

1. **No PPT/content generation, ever.** Ingest only. No image generation.
2. **The live loop makes zero LLM calls.** Generation happens before the session.
3. **No student accounts or passwords.** The credential is `room code + roll number`.
4. The slow-learner ceiling is real: a student inside the below-40% band is
   **never** served an item above Understand.
5. Any question item not produced by the LLM must carry `source:'fallback'` and be
   visibly labelled in the UI. Never present a template item as model output.

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
