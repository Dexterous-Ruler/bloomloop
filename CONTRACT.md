# BloomLoop — frozen build contract

Every module below is written against **this file**. Do not change any signature here.
If something in this file looks wrong, flag it in your report — do not silently "fix" it.

Paths below are from the repository root. Node 20, ESM everywhere (`"type": "module"`),
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
>
> **Amendment 6 (19 Nov 2026, Phase 6, decided under the owner's delegation; decisions 1,
> 5 and 7 and the Phase 6 decisions H1 to H18 in `docs/PRODUCT_DECISIONS.md`).** Additive
> only; nothing above changes. This note is the amendment's main part; its other pieces
> sit beside the sections they amend: section 2 (the repository's Phase 6 methods),
> section 3 (`Content.slideTexts`), section 5 (`question.rich`) and section 6 (rules 1 to 3
> as the hub applies them).
> - **The Learning Hub (`/api/hub`) is an account-only surface, separate from this frozen
>   room contract.** Rooms stay account-free: section 6 rule 3 stands for rooms, the phone
>   and every event in section 5 (decision 7). A room phone, which carries no token, never
>   reaches the hub.
> - The hub needs a signed-in account: it answers 503 on a server without Supabase (there
>   are no accounts then), and 401 to a request with no bearer token or with only the
>   teacher key. Who reaches what is one rule (`server/src/services/hubAccess.js`): a
>   student whose professor (`accounts.reports_to`) owns the class and whose roll number is
>   on its roster, not removed; the owner reads and writes; the department's HOD reads
>   only; anyone else gets the same 404 as for something that does not exist.
> - **Its shapes are documented in `docs/API.md`, "Phase 6: the Learning Hub", and are not
>   frozen here.**
> - **Hub attempts are their own table** (`hub_attempts`, `0026`), never `answers`. They
>   never move a room's ladder or a profile, and attainment and the marks register never
>   read them.
> - **Three new server dependencies**, pinned exactly and MIT: `ts-fsrs@6.0.0` (spaced
>   review), `temml@0.14.0` (formulas to MathML, with mhchem) and `shiki@4.6.0` (code
>   highlighting). "No new npm dependencies" above is amended for these three only
>   (decision H18). No client dependency was added.

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

> **Amendment 6 (19 Nov 2026, Phase 6), section 2.** Additive only; every method above
> is unchanged and `kind` is untouched. All three stores (Supabase, MongoDB, in-memory)
> gain the Phase 6 methods, in one block per migration, each headed in the store's code:
> - `0025`, the hub's backbone: create, read, update and delete for class units, class
>   chapters (placed, moved, removed), chapter topics and topic links, and
>   `setContentSlideTexts(contentId, slideTexts)`.
> - `0026`, practice: hub attempts (`addHubAttempt` returns `{ attempt, duplicate }`,
>   idempotent by account and client attempt id; a read by that key; a filtered list) and
>   question explanations.
> - `0027`, lessons and languages: topic lessons and item translations (create, read,
>   list, approve, discard; a translation is edited only while a draft), and a student's
>   language choice.
> - `0028`, Get Ready, self-tests and goals: hub runs (add, read, read by key, list, end
>   once) and hub goals.
> - `0029`, the tutor: question hints and option feedback (each with add, read, list,
>   update, delete) and hint views (add, list).
>
> Their signatures are the code's (`server/src/repo/memoryRepo.js`), not frozen here. A
> store whose database lacks one of these migrations keeps serving rooms: only the
> routes that need it fail, and the boot log names the file.

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
>
> **Amendment 6 (19 Nov 2026, Phase 6, decision H4), section 3.** Additive only.
> `Content` gains `slideTexts: [{ slide, text }]`: each slide's own words, kept for a deck
> uploaded from Phase 6 on (slide numbers as the deck numbers them, empty slides left
> out, at most 400 slides of 4,000 characters each; `contents.slide_texts`, `0025`). It is
> null (or absent) for an older deck, which cites slide numbers through `topicSlides`
> only, and for pasted text. It is written by its own repository call after
> `createContent`, so `createContent` and the upload's response are unchanged and an
> upload still succeeds without `0025`. No route sends it to a student: slide text
> reaches a student only inside an approved lesson.

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
>
> **Amendment 6 (19 Nov 2026, Phase 6, decision H15), section 5.** Additive only; every
> field above keeps its meaning. `server:question`'s `question`, and `class:question`'s
> `question`, gain `rich`: an object of HTML for each field of the question **as the
> phone was sent it** (after `forStudent()`, so never a key) whose HTML says more than
> its plain text: a formula (`$...$` or `$$...$$`, with `\ce{}` for chemistry), a fenced
> code block, a formula shown as its escaped source because it could not be read, or an
> escaped dollar sign (`\$`). A question with none of these gets `rich: {}`; a price such
> as "$20 and $30" is plain text.
> - Its keys, each present only when it qualifies: `text`, `criterion`; the lists
>   `options`, `left`, `right`, `items`, `groups` and `columns`, each sent whole, item for
>   item, when any item qualifies; `rows` (a grid's row labels); `passage` (a passage
>   stimulus's text); and `gaps` (`[{ options: [html] }]`, every gap of a dropdown).
> - Indices and order are those of the plain fields, which are unchanged and are still
>   what is answered and seeded.
> - The HTML is made on the server: MathML by temml with trust off (a formula using
>   `\label`, `\ref` or `\eqref`, or any rendering holding an `id=` or `href=`, is shown as
>   its escaped source), code highlighted by shiki (a fixed list of languages; any other
>   fence is plain text), and every other character escaped. It carries inline `style`
>   attributes and no script, so a page's Content-Security-Policy must allow style
>   attributes.
> - In `class:question` a code block is highlighted only once the server has loaded
>   shiki; before that it is sent escaped, uncoloured. `server:question` waits for it.

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

> **Amendment 6 (19 Nov 2026, Phase 6, decided under the owner's delegation), section 6,
> as the Learning Hub applies these rules.** Additive only; every rule stands.
> - Rule 1: a hub lesson's text is the professor's own slide text, word for word, cited
>   by slide (an older deck cites the topic's slides together; pasted text cites none,
>   and says so). Its worked examples and retrieval questions, and the AI's explanations,
>   hints, option feedback, translations and proposed prerequisite links, are AI drafts
>   until the professor approves them; a student sees only what was approved. A lesson
>   made without a model is "slides only": the professor's chunks and questions already
>   approved, no generated prose, and it too waits for approval.
> - Rule 2, in its spirit: the hub's practice loop, review sets, Get Ready, self-tests,
>   lessons and hints make zero model calls too. A model runs only when a professor
>   presses a button (decision 5). No live chat tutor is built.
> - Rule 3 stands for rooms. The hub is a separate surface for signed-in accounts
>   (decision 7; Amendment 6 after Amendment 2).

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
