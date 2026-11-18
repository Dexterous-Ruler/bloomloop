# API reference: Phase 1

Every HTTP endpoint and socket field added or changed in Phase 1 (the evidence store,
the review queue, the answer reads and the room archive). Older endpoints are not
listed here; `docs/ARCHITECTURE.md` says where they live.

Written 19 November 2026 from the code in `server/src` (uncommitted). The examples
are real responses, captured from a server running on the in-process store, with
long arrays shortened. Ids there are 24-character hex; on Supabase they are uuids.

**Tested, and not.** Every route here was exercised over HTTP on the in-process
store with the shared teacher key (`server/scripts/review.mjs`, `evidence.mjs`,
`liveloop.mjs`). Nothing was run with a signed-in account or against Supabase, which
cannot be reached from the development machine. So these paths are **untested**:
a professor, HOD or student calling with a bearer token (including an HOD's 403 on a
review), `GET /api/analytics/:id/answers` returning anything but a 404, and the
`topicLevels` field of `GET /api/analytics/:id`. The functions under them are unit
tested on the in-process store.

No screen uses the review queue, the answer lists, the topic report or the
`provisional` flag yet. The room archive routes are already used by `/rooms`.

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
| 413 | A room too large to archive (over 1 MiB) |

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

## Known open issues

Reported by the Phase 1 review, now fixed:

- **A 24-character hex id on Supabase** (`/api/review/:answerId`, `/api/session/archives/:id`) used to be a 500; it is now a 404.
- **`offset` is capped** at 100,000 on `GET /api/session/:code/answers` and `GET /api/analytics/:id/answers`; beyond it, 400.

Fixed on 19 November 2026: the Supabase repo answers a non-uuid id with "not found" (`isUuid` guard on every single-row read), and `offset` is capped at 100,000 (`MAX_OFFSET` in `services/evidence.js`, a 400 beyond it; unit-tested). The id guard is traced, not run against Supabase.
