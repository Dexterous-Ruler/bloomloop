# API reference: Phases 1 and 2

Every HTTP endpoint and socket field added or changed in Phase 1 (the evidence store,
the review queue, the answer reads and the room archive) and in Phase 2 (the
question bank's approval gate, several kinds per level, images and passages as
stimuli, and item statistics with a question set per room; an index of every Phase 2
endpoint opens the Phase 2 part). Older endpoints are not listed here;
`docs/ARCHITECTURE.md` says where they live.

Written 19 November 2026 from the code in `server/src`. Phase 1 is committed
(`05daf56`); Phase 2 is not. The examples are real responses, captured from a server
running on the in-process store with offline generation, with long arrays and long
text shortened. Ids there are 24-character hex; on Supabase they are uuids.

**Tested, and not.** Every route here was exercised over HTTP, and the socket
through a real client, on the in-process store with the shared teacher key:
Phase 1 by `server/scripts/review.mjs`, `evidence.mjs` and `liveloop.mjs`; Phase 2
by `bank.mjs`, `kinds.mjs`, `media.mjs` and `items.mjs` (all passing on 19 November
2026; numbers in `docs/TESTING.md`). Nothing was run with a signed-in account,
against Supabase (unreachable from the development machine) or Mongo, or with a
Gemini key. So these paths are **untested**: a professor, HOD or student calling
with a bearer token (including an HOD's 403 on a review or on any Phase 2 write),
`GET /api/analytics/:id/answers` returning anything but a 404, the `topicLevels`
field of `GET /api/analytics/:id`, and anything Gemini writes. The functions under
them are unit tested on the in-process store.

No screen uses the review queue, the answer lists, the topic report, the
`provisional` flag or anything from Phase 2 yet. The room archive routes are
already used by `/rooms`.

## Conventions

**Credentials.** One of:
- `Authorization: Bearer <Supabase access token>` for an HOD, professor or student
  account. Accounts need Supabase.
- `x-teacher-key: <TEACHER_KEY>` (or `?key=`) for the shared teacher key. It acts as
  a professor with no account, and reaches only rooms nobody owns.

**Errors.** Every error is `{ "error": "<a sentence a person can read>" }` with the
status code. The common ones:

| Status | Means |
|---|---|
| 400 | Bad input. The message says what was wrong |
| 401 | No credentials, or an expired sign-in |
| 403 | Signed in, but this role may not do it (a student on a teacher route; an HOD trying to change something) |
| 404 | Not found, **or not yours to read**. The two are one reply, word for word, so ids and room codes cannot be probed |
| 409 | Refused because of the state of something (see each route) |
| 413 | A room too large to archive (over 1 MiB); an image upload over the limit (Phase 2) |
| 415 | An upload that is not PNG, JPEG or WebP by its bytes (Phase 2) |
| 502 | The generator could not write the question asked for (regenerate, Harder / Easier) |

**Bloom levels** are spelled the British way everywhere: `remember`, `understand`,
`apply`, `analyse`, `evaluate`, `create`. A filter spelled `analyze` is a 400.

**Paging.** `limit` is a whole number from 1 to 200 (default 50). Lists that take
`offset` want a whole number of 0 or more. The review queue does not take `offset`;
it pages by cursor (below). Every list says `hasMore`.

---

## Socket: the phone

### `student:answer` (phone to server)

Unchanged in shape since Phase 0. Shown because the reply changed.

```json
{ "questionId": "02dda8085d74b5d85fe8424d", "response": "photosynthesis converts light into sugar.", "answerId": "doc-key-0001" }
```

- `response`: whatever the question kind needs (a number, an array, or text).
- `answerId`: the attempt's idempotency key, 8 to 64 of `A-Z a-z 0-9 _ -`. Make a new
  one per attempt and resend the same one if no result came back. The server stores
  and counts an attempt once, however often it is sent.

**Changed in Phase 2:** an answer naming a question the room may not serve is not
marked or stored, and no `server:result` is sent: the phone gets the next
`server:question` (or `server:exhausted`) instead. That covers a draft, a rejected
draft, a question outside the room's question set, and (since Phase 1) another
room's question. A phone only answers what it was served, so the screen needs
nothing new; it must simply not wait for a result that will not come.

### `server:result` (server to phone): the `provisional` flag

**New in Phase 1:** `provisional: true` is present when the mark is a written answer's
(`kind: "open"`) first, machine reading, matched against rubric words, and a professor
has not yet confirmed or overridden it. The field is **absent** otherwise: other
kinds, and a written answer a professor has reviewed. Never `false`.

The screen should say that the mark may change. It counts toward the student's level
now; a professor's later review moves the numbers by the difference.

A final answer:

```json
{
  "correct": false,
  "score": 0.5,
  "provisional": true,
  "solution": ["photosynthesis converts light", "chlorophyll absorbs energy"],
  "detail": "1/2 rubric points",
  "kind": "open",
  "attempts": 1,
  "redeemed": null,
  "workingLevel": "understand",
  "reason": "No answers yet at Understand - holding level.",
  "levelChanged": false,
  "profile": { "rollNo": "21CS01", "name": "Asha Rao", "...": "the grid row" }
}
```

- `solution` for a written answer is the rubric. Show it as the points a full answer
  makes.
- `detail` is the machine's reading in words. It is `""` when the server replays a
  stored answer that a professor overrode, because it would contradict the mark.
- `score` is the mark in force: on a replay of a reviewed answer, the professor's.

When `provisional` can appear, by reply:

| Reply | `provisional` |
|---|---|
| A final written answer, just marked | `true` |
| A resend of a stored final answer (same `answerId`) | `true` only while that row is still provisional |
| A double tap (same question, new `answerId`) | `true` if written and its history entry has no review |
| `retry: true` (wrong, with goes left) | never: the attempt did not count |
| `ungraded: true` (a poll) | never |

**The phone is not told when a professor reviews.** No socket event goes to the
student. A signed-in student sees the reviewed mark and note in
`GET /api/analytics/:id/answers`; a phone without an account sees it only if it
resends that answer.

### `teacher:grid` (server to teacher screens)

Unchanged in shape (`{ rows, code }`). New: it is also pushed to everyone watching a
room after a review changes a student's numbers.

---

## Review queue (`/api/review`)

For written answers. Mounted behind `requireTeacher`: a professor or HOD bearer token,
or the shared key. A student token gets 403, no credentials 401.

- **Reading** (both GET routes) needs a room the caller may read: a professor's own
  rooms, an HOD's department, or for the shared key the rooms nobody owns.
- **Deciding** (POST) needs a room the caller may write: its owner, or the shared key
  on a room nobody owns. An HOD may read but gets **403** on POST.

### Queue item

Used by all three routes.

```json
{
  "answerId": "bbb81ae6d0e6a5f080882179",
  "room": { "code": "PLNTSA", "title": "Written answers", "status": "open" },
  "student": { "rollNo": "21CS01", "name": "Asha Rao" },
  "topic": "Plants",
  "bloom": "create",
  "kind": "open",
  "question": {
    "id": "02dda8085d74b5d85fe8424d",
    "text": "Explain idea 5 about plants in your own words.",
    "rubric": ["photosynthesis converts light", "chlorophyll absorbs energy"],
    "modelAnswer": null,
    "stimulus": null
  },
  "response": "photosynthesis converts light into sugar.",
  "autoCorrect": false,
  "autoScore": 0.5,
  "autoDetail": "1/2 rubric points",
  "correct": false,
  "score": 0.5,
  "reviewStatus": "provisional",
  "reviewedBy": null,
  "reviewedAt": null,
  "reviewNote": "",
  "attempt": 1,
  "servedAt": "2026-11-18T19:10:47.386Z",
  "answeredAt": "2026-11-18T19:10:47.389Z"
}
```

- `question` comes from the snapshot stored with the answer, not the bank, so a later
  edit to the question does not change what is shown.
- `modelAnswer` is always `null` today: no question kind stores one.
- `auto*` is the machine's first reading and never changes. `correct`, `score` and
  `reviewStatus` are what is in force now. `reviewStatus` is `provisional`,
  `confirmed` or `overridden`.
- `reviewedBy` is an account id, or `null` on the shared-key path.
- **`reviewNote` is shown to the student**, word for word, in their own answer
  history. The screen that takes a note must say so.

### `GET /api/review`

The queue: final written answers in every room the caller may read, newest first.

| Query | Default | Rule |
|---|---|---|
| `status` | `provisional` | `provisional`, `confirmed`, `overridden` or `all` |
| `code` | all readable rooms | One room. A code that does not exist, or one the caller may not read, is the same 404 |
| `limit` | 50 | 1 to 200 |
| `before` | first page | The `next` value of the previous page |
| `offset` | | **Refused with 400.** Reviewing an answer takes it out of the default view, so an offset skips answers |

Response:

```json
{
  "items": [ "queue item", "..." ],
  "status": "provisional",
  "limit": 1,
  "hasMore": true,
  "next": "WyIyMDI2LTExLTE4VDE5OjEwOjQ3LjQ3M1oiLCI5ZmY3YjMzOTg0MjRmMGY3NzQ4MDdiMzEiXQ"
}
```

`next` is an opaque cursor, safe in a URL, and `null` on the last page. Send it back
as `?before=` for the next page. A cursor the server did not issue is a 400. Not in
the queue at all: other kinds (marked automatically) and a written attempt followed by
a retry (it never counted).

### `GET /api/review/:answerId`

One answer and its whole review log, oldest decision first. Any answer in a room the
caller may read. An unknown id, a malformed id and a room the caller may not read are
the same 404: `That answer was not found.`

```json
{
  "item": { "...": "queue item" },
  "log": [
    {
      "id": "84e26254c2cec0c9dcd0516d",
      "decision": "confirm",
      "correct": false,
      "score": 0.5,
      "note": "",
      "reviewedBy": null,
      "reviewedAt": "2026-11-18T19:10:47.447Z"
    }
  ]
}
```

A log row's `correct` and `score` are the mark that decision put in force. For a
confirm that is the machine's mark, copied.

### `POST /api/review/:answerId`

Confirm or override one written answer. A closed room can still be reviewed.

Request body:

| Field | Rule |
|---|---|
| `decision` | `"confirm"` or `"override"`. Required |
| `correct` | `true` or `false`. Override only |
| `score` | A number from 0 to 1. Override only. Stored to 3 decimal places |
| `note` | Text, at most 1000 characters after trimming. Optional. **The student reads it** |

The override rule, which the screen should state:
- `score` alone: right if the score is at least 0.7, the rubric matcher's own pass
  mark.
- `correct` alone: the score is 1 for right, 0 for wrong.
- Both: taken as given, so partial credit can still count as right.
- A confirm keeps the machine's mark. A confirm that sends `correct` or `score` is a
  400.

```json
{ "decision": "override", "score": 0.8, "note": "Good - the second point is implied." }
```

Response:

```json
{
  "item": {
    "...": "queue item",
    "correct": true,
    "score": 0.8,
    "reviewStatus": "overridden",
    "reviewedAt": "2026-11-18T19:10:47.454Z",
    "reviewNote": "Good - the second point is implied."
  },
  "changed": true,
  "logged": true,
  "profile": { "found": true, "adjusted": true },
  "log": [
    { "id": "84e26254c2cec0c9dcd0516d", "decision": "confirm", "correct": false, "score": 0.5, "note": "", "reviewedBy": null, "reviewedAt": "2026-11-18T19:10:47.447Z" },
    { "id": "63135109ef8ee404719c6b37", "decision": "override", "correct": true, "score": 0.8, "note": "Good - the second point is implied.", "reviewedBy": null, "reviewedAt": "2026-11-18T19:10:47.454Z" }
  ]
}
```

- `logged`: this request added a log row. `profile.found`: the student's row in that
  room was found. `profile.adjusted`: their numbers moved. `changed` is true if
  either `logged` or `profile.adjusted` is.
- **Idempotent.** Sending a decision already in force (same status, same mark, same
  note) writes nothing and returns `changed: false`. A different note is a new
  decision and is logged. Retrying after a network error is safe.
- What moves: the student's history entry takes the reviewed mark, and that level's
  `correct` tally moves by the difference (`seen` never moves). The working level is
  not rewound. Watching teacher screens get a `teacher:grid` push.
- What never moves: the response and `auto*`. The database refuses that too (`0012`).

Errors:

| Status | When |
|---|---|
| 400 | A bad `decision`, `correct`, `score` or `note`; an override with no mark; a confirm with a mark; an answer of another kind; a written attempt followed by a retry |
| 403 | An HOD (may read, not decide); a student token |
| 404 | `That answer was not found.`: unknown, malformed, or in a room the caller may not read |
| 409 | A confirm on an answer with no machine mark to keep (override it instead); the room is being deleted right now (`Nothing was changed.`) |

---

## A room's evidence (`/api/session/:code/...`)

Both routes need a teacher (`requireTeacher`) who may read the room. A code that does
not exist and a room the caller may not read are the same 404: `That room was not
found.` A closed room still answers.

### Answer item (teacher's view)

Used by `GET /api/session/:code/answers` and by a professor's
`GET /api/analytics/:id/answers`. It is the student's view (below) plus who answered,
the stored snapshot with its answer key, and the machine's reading.

```json
{
  "answerId": "9ff7b3398424f0f774807b31",
  "room": { "code": "PLNTSA", "title": "Written answers", "startedAt": "2026-11-18T19:10:47.352Z" },
  "topic": "Plants",
  "level": "create",
  "kind": "open",
  "question": { "text": "Explain idea 4 about plants in your own words.", "bloom": "create", "topic": "Plants", "kind": "open", "source": "llm", "hint": "2 points to cover" },
  "response": "no idea",
  "correct": false,
  "score": 0,
  "ungraded": false,
  "review": { "status": "provisional", "note": "", "reviewedAt": null, "reviewedBy": null },
  "attempt": 1,
  "final": true,
  "answeredAt": "2026-11-18T19:10:47.473Z",
  "student": { "rollNo": "21CS01", "name": "Asha Rao", "accountId": null },
  "questionId": "2ea6b7eb9864e9a3424445a8",
  "snapshot": { "id": "2ea6b7eb9864e9a3424445a8", "text": "Explain idea 4 about plants in your own words.", "kind": "open", "rubric": ["photosynthesis converts light", "chlorophyll absorbs energy"], "bloom": "create", "topic": "Plants", "source": "llm" },
  "detail": "0/2 rubric points",
  "auto": { "correct": false, "score": 0, "detail": "0/2 rubric points" },
  "servedAt": "2026-11-18T19:10:47.471Z",
  "questionSource": "llm"
}
```

- `question` is the question as the student's phone showed it, rebuilt from the
  snapshot with the phone's own function and seed. Match, order, rank, categorise and
  dropdown responses are positions in that shown order.
- `snapshot` is the question as stored, answer key included. Teacher-only.
- `review.status` is `auto` for kinds marked automatically.
- `final: false` is a wrong attempt followed by a retry; it did not count.
- `ungraded: true` is a poll: `correct` and `score` are `null`.
- One known limit: for a student who had the fewer-choices support, `question` lists
  all the options, not the shorter list they saw.

### `GET /api/session/:code/answers`

Every stored attempt in the room, newest first: final answers, retried attempts and
polls alike. This is the record, not a report.

| Query | Default | Rule |
|---|---|---|
| `rollNo` | everyone | One student. Matched as the room stored it: trimmed, single-spaced, upper case, so `21cs01` finds `21CS01` |
| `limit` | 50 | 1 to 200 |
| `offset` | 0 | A whole number, 0 or more |

```json
{
  "room": { "code": "PLNTSA", "title": "Written answers", "startedAt": "2026-11-18T19:10:47.352Z", "status": "open" },
  "rollNo": null,
  "items": [ "answer item (teacher's view)", "..." ],
  "limit": 1,
  "offset": 0,
  "hasMore": true
}
```

### `GET /api/session/:code/topics`

Per topic and per level for the room: seen, correct, accuracy, and how many students.

```json
{
  "room": { "code": "PLNTSA", "title": "Written answers", "startedAt": "2026-11-18T19:10:47.352Z", "status": "open" },
  "source": "answers",
  "counted": { "answers": 2, "history": 0 },
  "students": 1,
  "untagged": 0,
  "topics": [
    {
      "topic": "Plants",
      "seen": 2,
      "correct": 1,
      "accuracy": 0.5,
      "students": 1,
      "levels": [
        { "level": "remember", "seen": 0, "correct": 0, "accuracy": null },
        { "level": "understand", "seen": 0, "correct": 0, "accuracy": null },
        { "level": "apply", "seen": 0, "correct": 0, "accuracy": null },
        { "level": "analyse", "seen": 0, "correct": 0, "accuracy": null },
        { "level": "evaluate", "seen": 0, "correct": 0, "accuracy": null },
        { "level": "create", "seen": 2, "correct": 1, "accuracy": 0.5 }
      ]
    }
  ]
}
```

This is the **topic report**, the same shape wherever it appears:
- Counted from final, graded answers only. Retried attempts and polls are left out.
- `source` says where the numbers came from. `answers` means the answers table.
  `history` means a room run before the table existed, read from its profiles.
  `mixed` means both, with nothing counted twice. `none` means no graded evidence.
  `counted` gives how many rows came from each.
- Every topic carries all six levels, in ladder order. `accuracy` is `null` where
  `seen` is 0.
- Topics are sorted by `seen`, most first. Answers with no topic are counted in
  `untagged`, not as a topic.

---

## One student across rooms (`/api/analytics/...`)

Behind "an account, or else the shared key". The id must be in the caller's own subject
list, exactly as for the analytics detail. Anything outside it is a 404: `No such
person, or not one you can see.`

| Caller | Subject list |
|---|---|
| Professor | Their own students |
| Student | Themself |
| HOD | Their professors only, so an HOD reaches no student's answers |
| Shared key | Empty: every id is a 404 |

The rooms read are those owned by the professor the student reports to.

**Untested with a real account** (needs Supabase). With the shared key, the only
reply that can be checked here is the 404.

### `GET /api/analytics/:id/answers`

One student's answers across those rooms, newest first.

| Query | Default | Rule |
|---|---|---|
| `limit` | 50 | 1 to 200 |
| `offset` | 0 | A whole number, 0 or more |
| `topic` | all | The topic text exactly as stored |
| `level` | all | One of the six levels, British spelling, else 400 |
| `code` | all rooms | One room. A code outside the student's rooms returns no items (not a 404) |

Shape only: this one was not captured, because it needs an account.

```json
{
  "subject": { "id": "<account id>", "name": "<full name>", "code": "<BL- account code>", "rollNo": "21CS01" },
  "view": "teacher",
  "filters": { "topic": null, "level": null, "code": null },
  "items": [ "..." ],
  "limit": 50,
  "offset": 0,
  "hasMore": false
}
```

- An id that is visible but is a professor (an HOD calling with a professor's id) is a
  400: answers are listed per student.
- `view` is `"student"` when the caller is the student, else `"teacher"`.
- **Teacher view:** items are the teacher's answer item above. Rows match the
  student's account, or carry their roll number and are linked to no account. A row
  linked to a different account never matches. `student.name` is empty on these
  items; use `subject.name`.
- **Student view:** items are the student's answer item below, and only rows linked to
  their own account. An unlinked row under their roll number may have been typed by
  anyone, so it is not shown to them.

Student's answer item. No answer key, rubric, snapshot, machine reading or `detail`
ever reaches a student here:

```json
{
  "answerId": "9ff7b3398424f0f774807b31",
  "room": { "code": "PLNTSA", "title": "Written answers", "startedAt": "2026-11-18T19:10:47.352Z" },
  "topic": "Plants",
  "level": "create",
  "kind": "open",
  "question": { "text": "Explain idea 4 about plants in your own words.", "bloom": "create", "topic": "Plants", "kind": "open", "source": "llm", "hint": "2 points to cover" },
  "response": "no idea",
  "correct": false,
  "score": 0,
  "ungraded": false,
  "review": { "status": "provisional", "note": "", "reviewedAt": null },
  "attempt": 1,
  "final": true,
  "answeredAt": "2026-11-18T19:10:47.473Z"
}
```

`review.note` is the professor's note, shown to the student as written.

### `GET /api/analytics/:id`: new field `topicLevels`

The response keeps its shape. When the subject is a **student**, it gains
`topicLevels`: the topic report (above), across the student's rooms, read from the
same rows as the answer list. The existing `topics` field is now taken from it (the
first 12 topics, as `{ topic, seen, correct, accuracy }`), so the two always agree. A
student with no roll number on their account gets an empty report (`source: "none"`).
The professor detail (an HOD's view) is unchanged and has no `topicLevels`.

---

## Deleted rooms (`/api/session`)

All three need a teacher (`requireTeacher`). These are already used by `/rooms`.

### `DELETE /api/session/:code?confirm=<CODE>`

Changed in Phase 1. The whole room is written to an archive first, and the live rows
are deleted only if that succeeds. Needs a room the caller may write.

```json
{ "ok": true, "code": "PLNTSA", "deletedProfiles": 1, "archive": { "id": "84628016ff5f441513525b4d", "bytes": 2626, "archivedAt": "2026-11-18T19:10:47.493Z" } }
```

| Status | When |
|---|---|
| 400 | `confirm` missing or not the room's code |
| 403 | A room the caller may read but not write |
| 404 | No such room, or not one the caller may read. The wording differs: an unknown code gets `No session with code <CODE>`, another teacher's room `That session was not found.` This is older than Phase 1, and unlike the evidence routes |
| 413 | The archive would be over 1 MiB. Nothing was deleted |

While the delete runs, a review of an answer in that room gets 409, and a live answer
gets the phone's "did not save" notice.

### `GET /api/session/archives`

Archives of deleted rooms the caller may read, newest first, without their data.

```json
{
  "archives": [
    { "_id": "84628016ff5f441513525b4d", "sessionId": "d1501632f31271987f19414b", "code": "PLNTSA", "title": "Written answers", "ownerId": null, "archivedBy": null, "archivedAt": "2026-11-18T19:10:47.493Z", "bytes": 2626 }
  ],
  "limitBytes": 1048576
}
```

### `GET /api/session/archives/:id`

One archive as a `.json` download (`Content-Disposition: attachment;
filename="bloomloop-<code>-archive-<date>.json"`). The format is
`bloomloop.room-archive` version 1 (`server/src/services/archive.js`): the room, every
profile and history entry, every stored answer with the question as shown, and every
review decision. An archive the caller may not read is a 404.

---

## Phase 2: every new and changed endpoint

An index; each row points at the section that gives the shapes. **New** routes did
not exist before Phase 2. **Changed** routes keep their old shape and add to it,
except where the row says a meaning changed.

| Route | | What changed | Section |
|---|---|---|---|
| `POST /api/content` | changed | A `.pptx` keeps each topic's slide numbers on the content (`topicSlides`) | Older routes that now meet drafts |
| `GET /api/content` | changed | Each row gains `draftCount`. **`questionCount` now means approved questions** | same |
| `GET /api/content/:id` | changed | `content.topicSlides`: `{ "<topic>": [1, 2] }`, `{}` for pasted text | same |
| `GET /api/dashboard` | changed | Each content row gains `drafts`. **`questions` (and `counts.questions`) now mean approved questions** | same |
| `POST /api/generate/preview` | changed | Body: `plan.kindMix`. Reply: `existingDrafts`; the plan gains `topics[].kinds`, `perLevelKind`, `kindMix` | The plan: a kind mix per level |
| `POST /api/generate` | changed | Writes **drafts**. Reply gains `drafts`, `flagged`. **409** on a replacing generate while a room on the chapter runs | `POST /api/generate` (changed) |
| `GET /api/bank/:contentId` | changed | Gains `drafts`. **`counts` and `active` now count approved questions only.** Each question carries `model`, `sourceRef`, `checks`, `createdBy`, `approvedBy`, `approvedAt` | The question document: new fields |
| `POST /api/bank/question/:id/approve` | **new** | Approve one draft | |
| `POST /api/bank/question/:id/reject` | **new** | Reject one (the `discarded` status) | |
| `POST /api/bank/:contentId/approve-all` | **new** | Approve every draft in a bank; lists the flagged ones | |
| `POST /api/bank/:contentId/questions` | **new** | Write your own question, created active | |
| `POST /api/bank/question/:id/regenerate` | changed | The replacement is a **draft**; `direction: harder / easier` adds a new draft beside the original; `warnings` | Harder / Easier |
| `PATCH /api/bank/question/:id` | changed | `status: 'active'` on unapproved model output records an approval; `status: 'draft'` refused; checks re-run on every edit; image urls checked against the chapter's uploads; the four new kinds validated whole | Older routes that now meet drafts; Attaching a stimulus |
| `POST /api/bank/question/:id/split`, `POST /api/bank/merge` | changed | A draft's (or rejected draft's) halves and merges are drafts | Older routes that now meet drafts |
| `POST /api/bank/bulk` | changed | New `action: 'stimulus'`; `restore` on unapproved model output records an approval | Attaching a stimulus |
| `GET /api/bank/:contentId/stats` | **new** | Item statistics across every room on a bank | Item statistics |
| `POST /api/media` | **new** | Upload an image for a stimulus | Images and passages |
| `GET /api/media/:id` | **new** | Serve an image (open at the mount, with its own rule) | Images and passages |
| `POST /api/session` | changed | **409** on a bank of drafts; optional `questionIds`, returned in the reply | A question set per room |
| `GET /api/session` | changed | Each room gains `questionIds` | same |
| `GET /api/session/:code` | changed | `bankCount` is what the room serves (the set's size for a set room); the set itself is not returned | same |
| `GET /api/session/:code/items` | **new** | Item statistics for one room | Item statistics |
| `GET /api/session/:code/answers` | changed | The snapshot may carry `shownOptions`; it keeps `model`, `sourceRef`, `createdBy` and leaves out `checks`, `approvedBy`, `approvedAt` | The answer's snapshot |
| `GET /api/session/archives/:id` | changed | `room.questionIds`; `shownOptions` on answer rows | same |
| socket `student:answer` | changed | An answer to a question the room may not serve gets no result, only the next question | Socket: the phone |

Example replies captured for this index (offline generation, the shared key, a
six-topic deck of twelve slides):

`GET /api/content`, one row, after generating 36 questions:

```json
{ "_id": "cdcfa97824e6141390283870", "title": "Transport layer", "kind": "pptx",
  "topics": ["Transport layer services", "User Datagram Protocol", "..."],
  "createdAt": "2026-11-18T22:14:11.160Z", "questionCount": 0, "draftCount": 36 }
```

`GET /api/content/:id`, the new field only:

```json
{ "content": { "...": "as before", "topicSlides": { "Transport layer services": [1, 2], "User Datagram Protocol": [3, 4] } } }
```

`GET /api/dashboard`, a content row:

```json
{ "id": "ef5db1d21dc27f7f14c46e71", "title": "Transport layer", "kind": "pptx", "topics": 6,
  "questions": 0, "drafts": 36, "ownerId": null, "createdAt": "2026-11-18T22:14:17.397Z", "sessions": 0 }
```

`POST /api/generate/preview`, the end of the reply, before and after a generate:

```json
{ "plan": { "...": "see the kind mix section" }, "describe": { "...": "..." }, "existing": 0, "existingDrafts": 0 }
{ "plan": { "...": "see the kind mix section" }, "describe": { "...": "..." }, "existing": 0, "existingDrafts": 36 }
```

`GET /api/bank/:contentId`, everything but `questions`, after generating:

```json
{ "counts": { "remember": 0, "understand": 0, "apply": 0, "analyse": 0, "evaluate": 0, "create": 0 },
  "total": 36, "active": 0, "drafts": 36,
  "kinds": { "forLevel": { "remember": ["mcq", "truefalse"], "...": "..." }, "label": { "mcq": "Choose one", "...": "..." } } }
```

`GET /api/session`, one room opened on a set of two:

```json
{ "code": "GGJWF6", "title": "Transport layer", "status": "open",
  "settings": { "masteryGoal": 0.8, "reattempts": 0, "redemption": false },
  "questionIds": ["e7223772320bf3cb39425880", "a4c00981a361528c0018e2e1"],
  "withdrawn": 0, "startedAt": "2026-11-18T22:14:25.805Z", "pausedAt": null, "closedAt": null,
  "joined": 0, "online": 0, "answered": 0, "banded": 0, "accuracy": null, "canControl": true }
```

`GET /api/session/:code` with no credentials (a phone), the same room. No
`questionIds`; `bankCount` is the set's size:

```json
{ "session": { "code": "GGJWF6", "title": "Transport layer", "status": "open", "startedAt": "...", "closedAt": null,
    "settings": { "masteryGoal": 0.8, "reattempts": 0, "redemption": false } },
  "redemptionRule": "...", "content": { "title": "Transport layer" }, "bankCount": 2, "studentCount": 0 }
```

## Phase 2: the question bank's approval gate (`/api/bank`, `/api/generate`)

Added 19 November 2026 (uncommitted). A generated question is now saved as a
**draft**, which no room serves, and a professor approves or rejects it. A
professor can also write a question outright, and ask for one a Bloom level harder
or easier. Every route below is behind `requireTeacher` and needs a bank the caller
may **write**: its owner, or the shared key on a bank nobody owns. A question or
bank that does not exist and one that is another teacher's answer the same 404,
word for word: `That question was not found.` / `That content was not found.`
(the existing `forWrite` used to say `Question not found.` for a missing id; it now
says the same as for another teacher's). An HOD reading a professor's bank gets
403 on every write, as before.

Tested end to end with the shared key on the in-process store and offline
generation (`server/scripts/bank.mjs`, 73 checks; `test/checks.test.js` 32 and
`test/approval.test.js` 24). **Not tested:** a bearer-token
caller, an HOD's 403, Supabase and Mongo (the columns are new in `0013`), and
generation by Gemini (the model id path). No screen uses any of this yet; the
console being rebuilt does not know the `draft` status (see `docs/IMPLEMENTATION_STATUS.md`).

### The question document: new fields

Every question the bank returns now carries these (null on rows older than `0013`):

```json
{
  "_id": "73ce8f775dbb7c0860f59429",
  "status": "draft",
  "source": "fallback",
  "model": "offline-template",
  "sourceRef": { "kind": "slides", "slides": [1, 2] },
  "checks": [
    { "id": "longest-option-is-key", "ok": true, "message": "The answer does not stand out by its length." },
    { "id": "all-none-of-the-above", "ok": true, "message": "No option refers to the other options." },
    { "id": "create-selected-response", "ok": true, "message": "A \"Choose one\" at Remember is a level picking can reach." }
  ],
  "createdBy": null,
  "approvedBy": null,
  "approvedAt": null,
  "topic": "Transport layer services",
  "text": "Which of the following best identifies ...",
  "kind": "mcq",
  "bloom": "remember",
  "...": "options, answerIdx and the kind's payload, as before"
}
```

- `status`: `active` (served), `draft` (generated, waiting for approval, never
  served) or `discarded` (rejected or replaced).
- `model`: the model id that wrote it (`config.gemini.model`, `gemini-2.5-flash`
  by default), `offline-template` for the offline generator, `null` for a
  professor's own question **and** for every row older than `0013`.
- `sourceRef`: the slides the question's topic was read from, for a `.pptx`. It is
  the topic's slides, not the sentence the item was built from. `null` for pasted
  text, a professor's own question, a topic renamed after upload, and older decks.
- `checks`: the rule checks (below), `{ id, ok, message }` each, only those that
  apply to the kind. Advice: nothing is refused for failing one. `null` = never
  checked. Re-run on every edit, split, merge, retag and approval.
- `createdBy`: the account that made the row (generated, wrote, split or merged
  it). `null` on the shared key.
- `approvedBy`, `approvedAt`: who let it into rooms and when. `approvedBy` is
  `null` on the shared key; `approvedAt` is still set.

The rule checks (`server/src/services/checks.js`):

| id | Applies to | Fails when |
|---|---|---|
| `longest-option-is-key` | mcq, multi | the answer (every correct option, for a multi) is longer than every wrong option by more than 20% |
| `absolute-words` | mcq, multi (options), truefalse (statement) | *always*, *never*, *all* or *none* as a whole word; "all that apply" and "of the above" phrases are not counted |
| `all-none-of-the-above` | mcq, multi, dropdown | an option such as *none of the above*, *all of these*, *both of them* |
| `duplicate-options` | mcq, multi, dropdown, match (each column), poll | two options equal once case, punctuation and a leading article are set aside, or sharing three quarters of their content words (one-word options only when equal, so a scale is not flagged) |
| `several-keys` | mcq, multi, dropdown | a wrong option says the same as a correct one |
| `empty-rubric` | open | no rubric, or a point with no word over three letters (the marker's own rule, so it could never be found) |
| `slide-only-reference` | every kind | the stem or an option names a figure, diagram, graph, a coloured curve or *Fig. 3* with no image stimulus, or says *shown above* / *on the slide* with no stimulus at all |
| `create-selected-response` | every graded kind | a selected-response kind (anything but blank, cloze, numeric, open, table) tagged Create |

### `POST /api/generate` (changed)

Every generated question is saved as a draft, with `model`, `sourceRef`, `checks`
and `createdBy`. New in the reply: `drafts` (drafts in the bank now) and `flagged`
(new drafts with at least one failed check). `bankCount` is still the approved
bank, what a room can serve, so it is 0 after a replacing generate.

```json
{ "runId": "b7bb7a56-9785-4149-b805-4825af7c98a3",
  "bankCount": 0, "drafts": 36, "flagged": 1, "generated": 36, "removed": 0, "mode": "replace", "source": "fallback",
  "perLevel": { "remember": 9, "understand": 9, "apply": 6, "analyse": 6, "evaluate": 3, "create": 3 },
  "plan": { "total": 36, "perLevel": { "...": "as above" }, "perKind": { "mcq": 6, "truefalse": 3, "match": 5, "...": "..." } },
  "warnings": ["GEMINI_API_KEY is not set - questions came from the offline template bank."] }
```

`POST /api/generate/preview` gains `existingDrafts`: a replacing generate deletes
drafts too.

**409** on a replacing generate (`mode: 'replace'`, the default) while a room on
the chapter is open or paused, before anything is generated: `A room on "<title>"
is running (<codes>), and replacing its questions now would leave every phone in it
with nothing to answer: new questions wait for your approval. Close the room first,
or add these to the bank with mode 'append'.` Replacing deletes the approved bank
the room is serving and writes only drafts. `mode: 'append'` is still allowed.

### `GET /api/bank/:contentId` (changed)

`counts` and `active` now cover active questions only; before, anything not
discarded was counted. New: `drafts`. `questions` still lists everything, drafts and
discarded included.

### `POST /api/bank/question/:id/approve`

No body. Sets `status: active`, `approvedBy`, `approvedAt`, and stores the checks
run again. Allowed whatever the checks say; the reply names each failed one.
Approving a question already approved changes nothing (`changed: false`).
Approving an active question with no approval recorded (an older one) records one;
approving a discarded one brings it back.

```json
{ "question": { "...": "the question, status active" }, "changed": true,
  "failedChecks": [ { "id": "all-none-of-the-above", "message": "option 1 (\"None of the above.\") refers to the other options. ..." } ] }
```

### `POST /api/bank/question/:id/reject`

No body. Sets the existing `discarded` status, so the older restore still works.
`changed: false` if already discarded. A rejected draft keeps `model` and has no
`approvedAt`, which is how split, merge and the live loop tell it from an approved
question discarded later.

```json
{ "question": { "_id": "eb3f1b10a5c62f4e65662604", "status": "discarded", "source": "fallback", "model": "offline-template",
    "sourceRef": { "kind": "slides", "slides": [1, 2] }, "checks": [ "..." ],
    "createdBy": null, "approvedBy": null, "approvedAt": null, "topic": "Transport layer services", "kind": "mcq", "...": "..." },
  "changed": true }
```

Not found and not yours, on every Phase 2 bank route: approve, reject,
regenerate, split, merge and `PATCH` answer 404 `That question was not found.` for
an id that does not exist and for another teacher's, word for word. Approve-all and
write-your-own answer 404 `That content was not found.` the same way. Bulk does not
fail the request; it lists such an id in `refused` with that sentence. An HOD on a
professor's bank gets 403 on all of them (by `assertCanWrite`; not run, since it
needs a bearer token).

### `POST /api/bank/:contentId/approve-all`

No body. Approves every **draft** in the bank; active and discarded questions are
left alone. `flagged` lists each approved question that failed a check, so an
approve-all never hides a flag.

```json
{ "approved": 33, "questions": [ "..." ], "flagged": [ { "id": "...", "text": "...", "failedChecks": [ { "id": "...", "message": "..." } ] } ],
  "bankCount": 35 }
```

### `POST /api/bank/:contentId/questions` (write your own)

Body: `text`, `bloom`, `kind` (optional: the level's default), `topic` (optional,
at most 160 characters), `stimulus` and the kind's fields (`options`, `answerIdx`,
`pairs`, `rubric`, ...), exactly as an edit takes them. Validated by
`questionTypes.js`, and **the level still chooses the kind**: a kind from another
level's set is a 400 with the editor's explanation. A `poll` may sit at any level
(its tag is positional). Created **active**, `model: null`, `sourceRef: null`,
`createdBy` the account (null on the shared key), `source: 'fallback'` (see
`PRODUCT_DECISIONS.md`). 201:

```json
{ "question": { "status": "active", "model": null, "sourceRef": null, "createdBy": null, "source": "fallback", "...": "..." },
  "failedChecks": [ { "id": "all-none-of-the-above", "message": "option 3 (\"All of the above.\") refers to the other options. ..." } ] }
```

### `POST /api/bank/question/:id/regenerate` (changed): Harder / Easier

Body (optional): `{ "direction": "harder" }` or `{ "direction": "easier" }`.

- **No direction**: as before, a replacement at the same level, and the old question
  is discarded (`CONTRACT.md` §4). The replacement is now a **draft**, so
  regenerating an active question takes that slot out of rooms until the
  replacement is approved. When it was active, the reply says so in `warnings`:
  `["The question this replaces was in use, so it has left rooms now. Its
  replacement is a draft, and joins them when you approve it."]`. No `warnings` key
  otherwise.
- **`harder` / `easier`**: a new draft one level up or down, on the same topic, with
  the same `sourceRef` (looked up from the topic if the original has none). The
  original is not touched. Each level is asked through its default kind, so Create
  is always a written answer; a selected-response item at Create is refused (502)
  if the generator ever offers one.
- 400: `easier` on Remember, `harder` on Create, any other `direction`, a poll.
- 502: the material could not carry a question at that level.

```json
{ "question": { "status": "draft", "bloom": "understand", "kind": "categorise", "topic": "Transport layer services",
  "model": "offline-template", "sourceRef": { "kind": "slides", "slides": [1, 2] }, "...": "..." },
  "direction": "harder", "from": "bf91e51c74882606a54c7f4b" }
```

### Older routes that now meet drafts

- `PATCH /api/bank/question/:id` with `status: 'active'` (the console's restore), and
  `POST /api/bank/bulk` with `action: 'restore'`: on model output nobody approved,
  this **is** the approval and stamps `approvedBy`/`approvedAt`. On anything else it
  is the plain status change it was. `status: 'draft'` is refused (400). An edit
  keeps the status (active stays active, a draft stays a draft) and re-runs the
  checks.
- Split and merge: the halves of a draft are drafts; a draft merged with anything
  is a draft. A **rejected** draft (discarded, model set, never approved) counts as
  a draft here: its halves, and any merge with it, are drafts with no approval. A
  merge never copies one parent's approval onto the other's unreviewed text. Model,
  slides and approval otherwise carry over.
- `POST /api/session` on a bank with fewer than 6 active questions **and** at least
  one draft: **409** `"<title>" has N generated questions waiting for your approval
  and M approved. A room serves approved questions only and needs at least 6:
  approve them in the question bank first.` With no drafts the old 400 stands.
- `GET /api/content`: each row gains `draftCount`; `questionCount` is approved
  questions. `GET /api/dashboard` (professor): each content row gains `drafts`.
- `POST /api/content` with a `.pptx`: the content keeps `topicSlides`,
  `{ "<topic>": [1, 2] }`, so later generation can stamp `sourceRef`.
- The live loop serves active questions only (unchanged: `listQuestions` and the
  selector both filter to active). New: `student:answer` naming a draft's id, or a
  rejected draft's, is not marked or stored, the same as a question from another
  room. The answer's stored question snapshot no longer copies `checks`, nor
  `approvedBy`/`approvedAt` (they describe the bank's row, and change without the
  question changing); it keeps `model`, `sourceRef` and `createdBy`.

## Phase 2: several kinds per level; hot text, dropdown, table and grid

Added 19 November 2026 (uncommitted). Server only; no screen sends the new field
yet. Tested end to end with the shared key, the in-process store and offline
generation (`server/scripts/kinds.mjs`, 43 checks) and in unit tests
(`test/kindmix.test.js`, `test/newkinds.test.js`). **Not tested:** generation by
Gemini (the new schema fields and prompt have never been sent to the model),
Supabase, and Mongo against a database (the schema fix is checked by building
documents without one).

### The plan: a kind mix per level (`POST /api/generate/preview`, `POST /api/generate`)

The `plan` body takes one new field. Everything else is as before.

| Field | Shape | Meaning |
|---|---|---|
| `kinds` (unchanged) | `{ "<level>": "<kind>" }` | the whole level asked as that one kind |
| `kindMix` (new) | `{ "<level>": { "<kind>": weight } }` | the level divided over these kinds in proportion; wins over `kinds` for the same level |

A level named in neither gets the default (`DEFAULT_KIND_MIX` in
`server/src/questionTypes.js`): Remember mcq 2 : truefalse 1, Understand match :
categorise, Apply blank : cloze : dropdown : table, Analyse multi : hottext : grid,
Evaluate order : rank, Create open. Each level's first kind is its default, so a
one-question request still gets it. A kind outside the level's set, a
selected-response kind at Create, or a negative weight is left out with a warning;
a level left with no kind keeps its default, with a warning.

**The mix never changes a count.** `total`, `perLevel`, every topic's `count` and
`mix`, the warnings and `needsConfirm` are exactly what they were before the mix
for the same request (checked on 77 requests against the previous code). New in
the resolved plan:

```json
{
  "topics": [ { "topic": "Transport layer services", "count": 12,
    "mix": { "remember": 3, "understand": 3, "apply": 2, "analyse": 2, "evaluate": 1, "create": 1 },
    "kinds": { "remember": { "mcq": 2, "truefalse": 1 }, "understand": { "match": 2, "categorise": 1 },
               "apply": { "blank": 1, "cloze": 1 }, "analyse": { "multi": 1, "hottext": 1 },
               "evaluate": { "order": 1 }, "create": { "open": 1 } } } ],
  "perKind": { "mcq": 6, "truefalse": 3, "match": 5, "categorise": 4, "...": "kind -> count, over the bank" },
  "perLevelKind": { "remember": { "mcq": 6, "truefalse": 3 }, "...": "level -> kind -> count" },
  "kindMix": { "remember": { "mcq": 2, "truefalse": 1 }, "...": "the weights applied, per level" },
  "kinds": { "remember": "mcq", "...": "per level, the kind with the most questions (as before: one kind per level)" }
}
```

A level's questions are handed out by a weighted rotation that continues from one
topic to the next, so a level with one question a topic alternates its kinds
across topics. `POST /api/generate` writes the bank to the plan's per-topic
`kinds`. The offline generator honours them where the material can carry the kind,
and otherwise gives the slot to another kind **of the same level** (never another
level's), as it always has; the level count holds either way. `POST /api/generate`
replies with the plan's `perKind` as before.

### The four kinds

Shapes are unchanged (`server/src/questionTypes.js`); the offline generator now
writes them, and so may Gemini:

| Kind | Level | Offline template |
|---|---|---|
| `hottext` | Analyse | One line of the source; pick every word that names a term the source defines outright ("X is ..."). Single words only; a line with a multi-word term, or a word that half-carries a defined term ("TCP's", "UDP-based"), is not used |
| `dropdown` | Apply | A source line with 2 or 3 named terms taken out; each gap offers the term that was there and 2 or 3 named terms the line never mentions |
| `table` | Apply | Rows are terms; the student writes which of two ideas the source discusses each term alongside (in the same sentence). First row worked; both ideas among the rows left to do. The given column quotes a source line naming the term and neither idea |
| `grid` | Analyse | Rows are terms, columns 2 or 3 ideas; tick where the source discusses the two in one sentence. No row or column all ticks or all blanks |

Gemini is sent new schema fields with their own names where a shared one would
need two shapes: `gaps` (dropdown; stored as `blanks`), `tableRows` (stored as
`rows`), `gridRows` (stored as `rows`), plus `tokens`, `columns`, `answers`.
`validateItems` keeps positional lists as sent (an empty token is refused, never
dropped, so indices cannot slide), and accepts an item whose declared `kind` is
one the plan asked of its level. Where the plan names one kind for a level, an item
is judged as that kind whatever it claims, as before; where it names several, an
item declaring another is refused.

### `PATCH /api/bank/question/:id` on the four kinds

Unchanged route; the whole merged payload is validated, so a hand edit of a hot
text, dropdown, table or grid is refused with the validator's words when any part
of it is wrong (an index off the sentence, a gap's answer off its list, a cell both
given and blank, a board of all ticks), and nothing is written. Whitespace is now
tidied in `tokens`, `columns`, grid row labels, table headings and cells, and
dropdown options, without dropping any entry.

## Phase 2: images and passages as question stimuli (`/api/media`, `/api/bank`)

Added 19 November 2026 (uncommitted). Server and database only; no screen uploads
or attaches anything yet. Tested end to end with the shared key, the in-process
store and offline generation (`server/scripts/media.mjs`, 67 checks) and in unit
tests (`test/media.test.js`, 27). **Not tested:** Supabase (`0014` has run on
PGlite only; the repo's bytea encoding is checked against a stubbed PostgREST,
not a real one), Mongo against a database (the schema is checked by building
documents), a bearer-token caller (a professor's own chapter, an HOD's 403, a
signed-in teacher's `<img>`), and any browser.

### The stimulus a question carries

Unchanged in shape except for one optional field. A stimulus rides on any kind and
reaches the phone through `forStudent()`, which rebuilds it field by field.

| Kind | Stored | The phone gets |
|---|---|---|
| Passage | `{ "kind": "passage", "text": "...", "sourceRef": "NCERT Biology XI, ch. 13" }` | `{ "kind": "passage", "text": "..." }` |
| Image | `{ "kind": "image", "url": "/api/media/<id>", "alt": "...", "sourceRef": "Fig. 13.2" }` | `{ "kind": "image", "url": "/api/media/<id>", "alt": "..." }` |

- `text`: at most 4000 characters (`MAX_STIMULUS_TEXT`), as before.
- `sourceRef` (new, optional, either kind): where it was taken from, as text the
  professor types, at most 300 characters (`MAX_STIMULUS_SOURCE`). `""` and `null`
  mean not given. **Never sent to the phone**: the renderer has nowhere to show it.
  Not the same thing as the question's own `sourceRef` (`{kind: 'slides',
  slides}`), which says which slides the generator read.
- `url`: an uploaded image is `/api/media/<id>`. Outside `http(s)` urls are still
  accepted, as before. A url is judged by where a browser would send it, not by
  its text: dot segments resolved, percent-escapes undone, repeated slashes
  collapsed, any case. One whose path is then under `/api/media/`, **on any host**
  (this server cannot know every name it answers to), must name an upload of
  **the question's own chapter** and is stored as `/api/media/<id>`; so must a
  site-relative url anywhere under `/api/`. Anything else there is refused (below).
  So `/api/./media/<id>`, `/api/x/../media/<id>` and `http://<host>/api/media/<id>`
  are checked exactly like `/api/media/<id>`.
- `alt`: required on an image. Left out when attaching an upload, the upload's own
  description is copied in.

**Sharing one passage or image.** Several questions share a stimulus by each
carrying an equal copy, never a reference to a shared row: each question is
served, snapshotted into the evidence and archived on its own, and editing a
passage must not change what answers already given were answers to. The offline
generator already writes its shared readings this way. To attach (or replace)
one stimulus on many questions at once, use the bulk action below; questions that
share a passage are the ones whose `stimulus` is equal.

### `POST /api/media` (upload)

Behind `requireTeacher`. `multipart/form-data` with three fields:

| Field | Rule |
|---|---|
| `file` | One image, at most `config.media.maxBytes` (500 KB, 512,000 bytes, by default; env `MEDIA_MAX_BYTES`). PNG, JPEG or WebP **by its first bytes**; the file name and the browser's type are ignored |
| `contentId` | A chapter the caller may **write**. Checked before anything about the file is said |
| `alt` | Required. What a student who cannot see the image needs, at most 1000 characters; whitespace is collapsed |

201:

```json
{ "media": { "_id": "03c70f8abab9a8ed1b87b551", "ownerId": null, "contentId": "7a1c...", "mime": "image/png",
  "bytes": 70, "sha256": "4977909...1581", "alt": "A labelled diagram of a leaf", "createdAt": "2026-11-19T...",
  "url": "/api/media/03c70f8abab9a8ed1b87b551" } }
```

| Status | When |
|---|---|
| 400 | Not multipart; no `file`; more than one file; no or blank `alt`; `alt` over 1000 |
| 401 | No credentials |
| 403 | An HOD on a professor's chapter (may read, not write) |
| 404 | `That content was not found.`: no `contentId`, a malformed one, one that does not exist, or another professor's, all word for word |
| 413 | Over the limit. The message names it |
| 415 | Not PNG, JPEG or WebP by its bytes. An SVG gets its own sentence (it can carry script); anything else is told it was checked by its contents, not its name |

A PNG sent as `photo.jpg` with type `image/jpeg` is stored, and served, as
`image/png`. There is no route to list, change or delete an upload.

**Metadata is taken out before the file is stored** (`withoutMetadata` in
`services/media.js`), without decoding or re-encoding the picture. JPEG: every APPn
segment except JFIF, the ICC colour profile and Adobe's, so Exif, XMP, IPTC and MPF
go, with comments and anything after the end of the image. The Exif orientation
is written back on its own, so an upright phone photo is not shown on its side.
PNG: `eXIf`, `tEXt`, `zTXt`, `iTXt`, `tIME` and anything after `IEND`. WebP: the
`EXIF` and `XMP ` chunks (their VP8X flags cleared) and anything after the
container. `bytes` and `sha256` in the reply, and so the ETag, are of what is
kept. A file with nothing to take out is stored as sent, byte for byte; one that
cannot be walked to its end keeps the rest as sent from where it stops making
sense.

### `GET /api/media/:id` (serve)

**Open at the mount**: the phone's `<img>` sends no credential. Each request is let
through by one of two rules, and refused otherwise:

1. **A teacher** who may read the image's chapter, by `x-teacher-key`, `?key=` or a
   bearer token. Always, whatever the rooms are doing.
2. **Anyone**, while a room on the image's chapter is **running** (`open` or
   `paused`) **and** an **approved** (`active`) question of that chapter shows the
   image. Before the room opens, after it closes, while the image is only on a
   draft, a discarded question or nothing, it is a 404.

A credential that fails (a wrong key, a student token) is not an error here: the
request is judged by rule 2, like any other without one. An unknown id, a malformed
one and a refused one are the same 404, `That image was not found.`, with
`Cache-Control: no-store`, since the same url answers 404 before a room opens and
the picture once it has. Ids are random (a uuid on Supabase, 96 random bits on the
other stores), so during a class the picture reaches the phones shown the
question and whoever they pass the link to; that is no more than a screenshot of
the question would reach. Why this rule: `PRODUCT_DECISIONS.md`.

200 headers:

| Header | Value |
|---|---|
| `Content-Type` | The type the bytes were checked to be at upload |
| `X-Content-Type-Options` | `nosniff` |
| `Cache-Control` | `private, max-age=31536000, immutable`. An upload's bytes never change (no update path; `0014` refuses one in the database), so a phone keeps it; `private` keeps it out of shared caches, which would go on serving it after the room closes |
| `ETag` | `"<sha256>"`, the hex SHA-256 of the bytes. A request with `If-None-Match` set to it gets a 304 with no body |
| `Content-Security-Policy` | `default-src 'none'; sandbox`: opened on its own, it runs nothing |

### Attaching a stimulus (`/api/bank`)

- `PATCH /api/bank/question/:id` and `POST /api/bank/:contentId/questions` take
  `stimulus` as before (null removes it). New: an image url that resolves under
  `/api/media/` (any spelling, any host; see `url` above) is looked up, must
  belong to the same chapter, and is stored in its canonical spelling with the
  upload's `alt` when none is given. Their upload, a missing one,
  one from the caller's own other chapter and a malformed id are one 404, `That
  image was not found.`, and nothing is written. The checks re-run, so attaching
  the picture a stem points at clears `slide-only-reference`.
- `POST /api/bank/bulk` gains `action: "stimulus"`:

```json
{ "ids": ["...", "..."], "action": "stimulus",
  "stimulus": { "kind": "passage", "text": "The transport layer ...", "sourceRef": "Kurose and Ross, ch. 3" } }
```

  Puts the same stimulus on every question named (`null` takes it off), each through
  the editor's whole validation, with the checks re-run; a draft stays a draft and
  an approved question stays approved. A question that cannot take it is listed in
  `refused` with the reason, as for the other bulk actions. `stimulus` missing is a
  400. The reply is the usual `{ action, questions, changed, refused }`.

### The rule check

`slide-only-reference` is unchanged: a stem naming a figure, diagram, graph or
coloured curve passes once an **image** is attached, an uploaded one included; a
stem saying "as shown above" or "on the slide" passes once **any** stimulus is. A
picture reference with only a **passage** attached still fails, because a passage
cannot show the picture (`PRODUCT_DECISIONS.md`).

### What the phone and the console need (for the UI session)

The phone's renderer (`client/src/learn/Stimulus.jsx`, read, not changed) handles
everything above as it stands: an upload's url is site-relative, so its `<img>`
loads it from the same origin; it already shows the alt text when an image fails
to load, which is what a student sees after the room has closed; and its stylesheet
keeps a passage's line breaks (`white-space: pre-wrap`). Things it or the console
would need:

- **A citation line**, if wanted: `sourceRef` is not sent to the phone. Showing it
  needs `forStudent()` to add it (one line in `stimulusForStudent`) and the
  renderer to draw it.
- **Previews in the console.** A signed-in professor's `<img src="/api/media/<id>">`
  carries no bearer token, so before a room opens it gets the 404. Fetch the image
  with the `Authorization` header and show it from a blob url. On the shared key,
  `?key=` on the url works.
- **Upload form:** `multipart/form-data` to `POST /api/media` with `file`,
  `contentId`, `alt`; show the 400/413/415 sentence as it comes. Then attach the
  returned `url` with `PATCH` (one question) or bulk `stimulus` (several).
- The renderer shows the `book` icon for an image as well as a passage.

---

## Phase 2: item statistics and a question set per room

Added 19 November 2026 (uncommitted). Server and database only; no screen calls
any of this yet. Tested end to end with the shared key on the in-process store
(`server/scripts/items.mjs`, 49 checks) and in unit tests (`test/itemstats.test.js`,
34). **Not tested:** a bearer-token caller (a professor, an HOD reading a
professor's bank or room), Supabase and Mongo against a database (`0015` has run on
PGlite only; the Supabase repo's request is checked against a stubbed PostgREST and
the Mongo schema by building documents), and the fewer-choices support reaching a
phone through a real linked account (the script sets it on the server's socket).

### The item report

Both routes below return the same shape. The figures come from the answers store
(`0008`) only: **final, graded** answer rows, with the mark in force (a professor's
review included). A wrong attempt followed by a retry is left out (it never
counted), and so is a poll (it assesses nothing). A room run before the answers
table existed contributes nothing: its profile history holds no responses.

```json
{
  "counted": { "answers": 72, "students": 12 },
  "thresholds": { "easyAt": 0.8, "hardBelow": 0.4, "minAnswersForBand": 5, "minStudentsForPointBiserial": 10 },
  "items": [
    {
      "questionId": "1f0c...", "text": "Which protocol is connectionless?", "kind": "mcq", "bloom": "remember",
      "topic": "Transport", "status": "active",
      "attempts": 12, "correct": 6, "proportionCorrect": 0.5, "meanScore": null, "band": "medium",
      "pointBiserial": -0.9356, "pointBiserialN": 12, "pointBiserialNote": null,
      "flags": [ { "id": "negative-point-biserial", "message": "Students who did well on their other answers got this one wrong more often than those who did not. The usual cause is a wrong answer key: check the key first, then the wording." } ],
      "distribution": {
        "answers": 12, "otherVersions": 0,
        "rows": [ { "label": null, "select": "one", "unanswered": 0, "options": [
          { "index": 0, "text": "TCP", "count": 6, "key": true },
          { "index": 1, "text": "SCTP", "count": 0, "key": false },
          { "index": 2, "text": "UDP", "count": 6, "key": false },
          { "index": 3, "text": "QUIC", "count": 0, "key": false } ] } ]
      },
      "versions": 1
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `counted` | Answer rows counted and students behind them. A **student is a roll number in a room**: the same roll number in two rooms is two students (two sections may share `21CS01`) |
| `attempts`, `correct`, `proportionCorrect` | Final graded answers to the question; how many were right (`correct` in force, so a partial-credit kind counts as right at a score of 0.7 or more); `correct / attempts`, `null` at 0 attempts |
| `meanScore` | The mean mark (0 to 1) for partial-credit kinds (every graded kind except mcq, true/false, blank and numeric); `null` for those four, where it would equal `proportionCorrect` |
| `band` | `easy` (`proportionCorrect` at or above 0.8), `hard` (below 0.4) or `medium`, **for this class**. `null` under 5 answers. Why these numbers: `PRODUCT_DECISIONS.md` |
| `pointBiserial` | Pearson's r between "right on this question" (1/0) and the student's **mean mark on every other graded answer in the same room** (the rest score, not the total). `null` with fewer than 10 such students, when everyone had the same mark on it, or when everyone's other answers came to the same mark; `pointBiserialNote` says which. `pointBiserialN` is how many students went into it |
| `flags` | `negative-point-biserial` when `pointBiserial` is below 0: the strongest single sign of a wrong answer key. A reason to look, worded so, never a verdict |
| `distribution` | How many chose each option, **in the question's own option order**, every response translated back from the order that student's phone showed it in (match, categorise and dropdown are shuffled per student) and from the shorter list a fewer-choices student saw. `null` for kinds with nothing to choose from: typed answers (blank, cloze, numeric, open, table) and arrangements (order, rank) |
| `distribution.rows` | One row per choice point: one for mcq, multi, true/false and hot text; one per gap (dropdown), per left-hand item (match), per item to sort (categorise) and per grid row. `select: "many"` rows (multi, hot text, grid) count every tick, so their counts add up to more than the answers. `unanswered` is how many chose nothing there. `key` marks what the key says |
| `distribution.otherVersions` | Answers left out of the counts because they were given to an earlier version of the question whose options differ, in number or in wording (counted by position they would land on the wrong option). A key moved over the same options does not count as different: each pick is still on the option it was. They still count in `attempts` |
| `versions` | How many different versions of the question the answers were given to, compared on what was asked (wording, level, kind and the kind's fields, key included) and nothing else: the model, the slides, the approval and a fewer-choices student's shorter list do not make a version. Over 1 means it was edited while in use; option texts and keys are the **last version answered**, while `text`, `kind`, `bloom`, `topic` and `status` are the bank's question as it stands |
| `status` | The bank's status now, or `deleted` when the question row is gone (a replacing generate deletes the bank); such a question is still reported from its answers' snapshots |

Items are sorted flagged first, then by ladder level, topic and text.

### `GET /api/session/:code/items`

Behind `requireTeacher`; the caller must **read** the room (an HOD may read their
department's). A code that does not exist and a room the caller may not read are
the same 404, `That room was not found.`, as on `/answers` and `/topics`. Two
segments deep, so `GET /api/session/:code` (open to phones) never answers it.

Every question answered in the room, plus every question of its set even if
nobody reached it (at zero attempts). The point-biserial compares each student
with their other answers in this room.

```json
{ "room": { "code": "7AWF9K", "title": "Two questions", "startedAt": "...", "status": "open" },
  "questionIds": ["f0c6...", "1984..."],
  "counted": { "...": "..." }, "thresholds": { "...": "..." }, "items": [ "..." ] }
```

### `GET /api/bank/:contentId/stats`

Behind `requireTeacher`; the caller must **read** the bank. A missing bank, a
malformed id and another teacher's are the same 404, `That content was not found.`
Two segments deep, so `GET /api/bank/:contentId` never answers it.

Across every room run on the chapter that the caller may read (deleted rooms are
not counted; their answers live on only in the archive). Every question answered
in any of them is listed, plus every approved question, answered or not. Each
student is compared with their own room's other answers; the rooms are pooled.

```json
{ "content": { "_id": "...", "title": "Transport layer" },
  "rooms": [ { "code": "ZQ4UQ6", "title": "Two questions", "status": "open", "startedAt": "..." } ],
  "counted": { "answers": 74, "students": 13 }, "thresholds": { "...": "..." }, "items": [ "..." ] }
```

### A question set per room: `POST /api/session` (changed)

The body takes one new field, `questionIds`:

| `questionIds` | The room serves |
|---|---|
| absent or `null` | the whole approved bank, as before (and the old floor of 6 approved questions stands) |
| a list of ids | only those questions. **Every id must be an approved (`active`) question of this chapter, or 400.** No floor: a set of one is a room |

The 400s: not a list; an empty list; more than 500 ids; any id that is not an
approved question of this chapter. A draft, a rejected question, another chapter's,
another teacher's, a malformed id and one that names nothing all get the same
sentence (`N of the M questions picked are not an approved question of "<title>".
...`), so a set cannot be used to ask which ids exist. Ids are matched in any case,
stored once each, as the bank spells them, in the order given. The set is checked
before a room code is drawn.

The reply gains `questionIds`, read back from the stored room (null for the whole
bank), and `bankCount` is the set's size for a set room:

```json
{ "code": "ZQ4UQ6", "sessionId": "...", "bankCount": 2,
  "settings": { "masteryGoal": 0.8, "reattempts": 0, "redemption": false },
  "questionIds": ["f0c6aafdcf3fa68e1ef1c883", "198485a9ee7466e4e073f538"] }
```

The set is written once and never changed (like the settings): no route updates
it. What follows from it:

- **Every serving path honours it.** The live loop's bank for the room is its
  set's approved questions (`servableFor` in `services/selector.js`), so the
  selector, a resumed pin and the bank count the phone is told all stay inside it;
  a pin on a question outside the set is not resumed. `student:answer` naming a
  question outside the set is neither marked nor stored, and the phone is moved on,
  exactly as for a draft or another room's question. An image is served to phones
  only while a running room could show its question (`servedToPhones` asks each
  running room's set).
- A question in the set that is later discarded stops being served; one deleted
  later leaves an id that names nothing. The room serves what is left of its set,
  never anything outside it. A question approved after the room opened does not
  join a set room (it does join a whole-bank room, as before).
- `GET /api/session` (the teacher's room list) returns `questionIds` with each
  room. `GET /api/session/:code/items` returns it too.
- `GET /api/session/:code` (open to phones) does **not** return the set: a list of
  question ids is a list of questions to try answering. Its `bankCount` is now what
  the room serves: the set's approved questions for a set room, the approved bank
  otherwise.
- A deleted room's archive keeps `room.questionIds`.

### The answer's snapshot: `shownOptions`

New on answers stored from now on: when the fewer-choices support shortened an mcq
or multi for that student, the stored `questionSnapshot` carries `shownOptions`,
the original indices of the options the phone showed, in shown order. Absent for
everyone shown the full list. The support's choice depends on the student's
supports at the moment of serving, which can change later, so it is kept rather
than recomputed. The item report reads it. `GET /api/session/:code/answers` returns
it inside `snapshot` (teacher-only), but the rebuilt `question` there still lists
every option (`services/evidence.js` does not read it yet). Answers stored before
this change have no record, and on the in-process and Mongo stores no student has
the support (it arrives through a Supabase account link).

In a deleted room's archive, `shownOptions` is kept on the answer row, not in the
archived question, so a question is stored once however many fewer-choices
students answered it (it differs per student). Decoding the archive puts it back
into each answer's `questionSnapshot`. The format version is unchanged: an archive
without the column had no such answers.

---

## Known open issues

Phase 2, open (none is a failing test; each is a gap or a default awaiting the owner):

- **The current console cannot approve.** Generation now writes drafts, and no
  screen calls approve, reject or approve-all or reads `drafts` / `draftCount`. A
  room on a freshly generated bank is a 409. Do not deploy the Phase 2 server before
  a client that approves (`docs/IMPLEMENTATION_STATUS.md`).
- **The gate can show a draft's slides, not their text.** `sourceRef` names the
  slides the topic was read from. No route returns the passage the generator
  worked from, and the stored raw text keeps no slide boundaries.
- **A professor's own question is stored as `source: 'fallback'`**, which the
  console labels as template text. `model: null` is what says a person wrote it.
  Labelling it truthfully needs a contract amendment (`PRODUCT_DECISIONS.md`).
- **`GET /api/session/:code/answers` lists every option** of an mcq or multi
  answered on the fewer-choices support, while the response is a position in the
  shorter list; `shownOptions` in the snapshot says which were shown. The item
  report reads it; this read does not yet.
- **No route lists, changes or deletes an upload.**
- **Rooms older than the answers table** add nothing to item statistics.

Reported by the Phase 1 review, now fixed:

- **A 24-character hex id on Supabase** (`/api/review/:answerId`, `/api/session/archives/:id`) used to be a 500; it is now a 404.
- **`offset` is capped** at 100,000 on `GET /api/session/:code/answers` and `GET /api/analytics/:id/answers`; beyond it, 400.

Fixed on 19 November 2026: the Supabase repo answers a non-uuid id with "not found" (`isUuid` guard on every single-row read), and `offset` is capped at 100,000 (`MAX_OFFSET` in `services/evidence.js`, a 400 beyond it; unit-tested). The id guard is traced, not run against Supabase.
