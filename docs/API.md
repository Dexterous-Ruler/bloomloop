# API reference: Phases 1, 2 and 3

Every HTTP endpoint and socket field added or changed in Phase 1 (the evidence store,
the review queue, the answer reads and the room archive), in Phase 2 (the
question bank's approval gate, several kinds per level, images and passages as
stimuli, and item statistics with a question set per room; an index of every Phase 2
endpoint opens the Phase 2 part) and in Phase 3 (classes and rosters, rooms opened
for a class, attendance, the teacher-record store, room modes with the waiting
room and the projector, and live insights with the student card and class analytics;
an index of every Phase 3 endpoint and socket event, with what phones, teacher
screens and the projector receive, opens the Phase 3 part). Older endpoints
are not listed here; `docs/ARCHITECTURE.md` says where they live.

Written 19 November 2026 from the code in `server/src`. Phase 1 is committed
(`05daf56`), Phase 2 too (`27559ca`); Phase 3 is not. The examples are real responses,
captured from a server running on the in-process store with offline generation, with
long arrays and long text shortened. Ids there are 24-character hex; on Supabase they
are uuids.

**Tested, and not.** Every route here was exercised over HTTP, and the socket
through a real client, on the in-process store with the shared teacher key:
Phase 1 by `server/scripts/review.mjs`, `evidence.mjs` and `liveloop.mjs`; Phase 2
by `bank.mjs`, `kinds.mjs`, `media.mjs` and `items.mjs` (all passing on 19 November
2026; numbers in `docs/TESTING.md`). Nothing in Phases 1 and 2 was run with a
signed-in account, against Supabase (unreachable from the development machine) or
Mongo, or with a Gemini key. So these paths are **untested**: a professor, HOD or
student calling with a bearer token (including an HOD's 403 on a review or on any
Phase 2 write), `GET /api/analytics/:id/answers` returning anything but a 404, the
`topicLevels` field of `GET /api/analytics/:id`, and anything Gemini writes. The
functions under them are unit tested on the in-process store.

Phase 3 is exercised by `roster.mjs`, `records.mjs`, `modes.mjs` and `insights.mjs`,
which run **signed-in callers** (a professor, a second professor, the HOD of the
department, an HOD of another department, a student account) by answering the
server's three Supabase Auth calls inside the script; no real Auth token, Supabase
database or Mongo was used for them either.

Which screens call what is the UI session's to say (`docs/UI_REBUILD.md`): it reports
Phase 1 screens (the review queue, a room's answers and topics, a student's answers)
in the Phase 2 commit, and Phase 2 screens (approval, the four kinds' editors, images,
item statistics, question sets) in its uncommitted work. Neither was re-checked for
this file. **No screen calls anything from Phase 3 yet**: `client/src` holds no call
to a Phase 3 route or event (searched on 19 November 2026). The room archive routes
are used by `/rooms`.

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
room after a review changes a student's numbers. Since Phase 3, a room opened for a
class adds `rosterName` to each row and `attendance` to the payload, and the grid is
also pushed after the professor marks attendance ("Phase 3" below). A room waiting to
start adds `waiting`, and a Mixed or Teacher-led room adds `feed` and is pushed after
each teacher record ("Phase 3: room modes" below).

### `teacher:insights` (server to teacher screens; Phase 3)

New. The body of `GET /api/session/:code/insights` ("Phase 3: live insights" below),
sent to a screen at once when it watches (after `teacher:grid` and `teacher:status`),
then to every screen watching the room after grid pushes, at most once every 2 seconds
per room, with one more after the last change. Teacher screens only (`teacher:<code>`):
never a phone or a projector. `teacher:grid` is unchanged by it.

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
| 404 | No such room, or not one the caller may read: `That session was not found.` for both, word for word (since the Phase 3 review; an unknown code used to get `No session with code <CODE>`). The same holds for `GET /:code/grid`, `POST /:code/pause`, `/resume`, `/close` and `GET /:code/integrity/:rollNo`. Only the phones' open `GET /api/session/:code` still names the code |
| 409 | `That room is being deleted. Nothing was changed.` for a start, pause, resume or close sent while this delete runs |
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

Added 19 November 2026 (committed in `27559ca`). A generated question is now saved as a
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
generation by Gemini (the model id path). The committed console does not know the
`draft` status; the UI session reports approval screens in its uncommitted work (see
`docs/IMPLEMENTATION_STATUS.md` and `docs/UI_REBUILD.md`).

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

Added 19 November 2026 (committed in `27559ca`). Server only; no screen sends the new field
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

Added 19 November 2026 (committed in `27559ca`). Server and database only; no screen uploads
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

Added 19 November 2026 (committed in `27559ca`). Server and database only; no screen calls
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

## Phase 3: every new and changed endpoint and socket event

An index. Each row points at the Phase 3 part that gives the full shapes. **New**
routes and events did not exist before Phase 3. **Changed** ones keep their old shape
and add to it. A room opened without `classId`, `mode`, `lobby` or the other new
settings runs exactly as before: its grids (`teacher:grid`, `GET /grid`) and its
archive are byte for byte what they were (`roster.mjs`, `modes.mjs`,
`test/modes.test.js`). Replies that carry a room's settings gain the new fields with
the old behaviour's values (`"mode": "devices", "adapt": true, "startLevel":
"understand", "questionsPerStudent": null, "timePerQuestion": null`), and the open and
the room list gain `classId: null`. Uncommitted on 19 November 2026.

**Who**, in the tables below:

- **read rule**: `ownership.js` `assertCanRead`. The owner; an HOD of the owner's
  department; the shared key for things nobody owns. Anyone else, and an id or code
  that names nothing, gets one 404, word for word.
- **owner**: the write rule (`assertCanWrite`). An HOD who may read it gets 403 and
  nothing changes; anyone else the same 404.
- Every Phase 3 route needs a teacher (`requireTeacher`): a student account is 403,
  no credentials 401. The phones' own `GET /api/session/:code` stays open and gains
  nothing staff-only.

### HTTP routes

| Route | | Who | What | Part |
|---|---|---|---|---|
| `GET /api/classes` | **new** | read rule | Every class the caller may read, newest first, without rosters | Classes, rosters and attendance |
| `POST /api/classes` | **new** | professor, shared key (an HOD 403) | Create a class: `courseName`, `section`, `termLabel?` | same |
| `GET /api/classes/:id` | **new** | read rule | The class, its roster (`students`) and removed students (`removed`) | same |
| `PATCH /api/classes/:id` | **new** | owner | Edit course, section or term | same |
| `POST /api/classes/:id/students` | **new** | owner | Add students from `[{ roll, name }]`; every refused row with its reason; other fields dropped and named | same |
| `PATCH /api/classes/:id/students/:studentId` | **new** | owner | Edit a name or roll number; `{ active }` removes or restores | same |
| `DELETE /api/classes/:id/students/:studentId` | **new** | owner | Remove softly (the row, answers and marks stay) | same |
| `GET /api/classes/:id/students/:studentId/observations` | **new** | read rule | One student's observations across days | The teacher-record store |
| `GET /api/classes/:id/analytics?last=4\|8` | **new** | read rule | The class across its last 4 or 8 rooms | Live insights, the student card and class analytics |
| `POST /api/session` | changed | chapter owner | Takes `classId`, `mode`, `adapt`, `startLevel`, `questionsPerStudent`, `timePerQuestion`, `lobby`. Reply gains `classId` and `status`; `settings` gains five fields | Classes...; Room modes |
| `GET /api/session` | changed | read rule | Each room gains `classId`; `settings` gains five fields; `status` may be `waiting` | same |
| `GET /api/session/:code` (the phones') | changed | anyone with the code | `settings` gains five fields; `status` may be `waiting`. Nothing else: no roster, attendance, record or insight | Room modes |
| `GET /api/session/:code/grid` | changed | read rule | Rows gain `rosterName` and the body `attendance` in a class room; `waiting` in a waiting room; `feed` in a Mixed or Teacher-led room. 404 now `That session was not found.` for a missing code too | Classes...; Room modes |
| `POST /api/session/:code/pause`, `/resume` | changed | owner | 409 on a waiting room; one status change at a time per room; a watching projector is pushed the new status; one 404 sentence | Room modes |
| `POST /api/session/:code/close` | changed | owner | Under the status lock; its projectors get `projector:closed`; one 404 sentence | same |
| `DELETE /api/session/:code?confirm=` | changed | owner | Waits for attendance, record and status writes under way; the archive gains the class, attendance, records and changed settings; its projectors get `projector:closed`; one 404 sentence | Classes...; The teacher-record store |
| `GET /api/session/:code/integrity/:rollNo` | changed | read rule | One 404 sentence for a missing code and another's room; nothing else | |
| `POST /api/session/:code/start` | **new** | owner | Start a waiting room | Room modes |
| `GET`, `POST /api/session/:code/attendance` | **new** | read rule; owner | The room's attendance against its class; mark it | Classes... |
| `GET`, `POST /api/session/:code/observations` | **new** | read rule; owner | The four private marks for the room's day | The teacher-record store |
| `GET`, `PATCH /api/session/:code/wheel` | **new** | read rule; owner | The round, who is on the wheel, every pick; change the round's settings | same |
| `POST /api/session/:code/wheel/draw`, `/wheel/rounds` | **new** | owner | Draw on the server; start a new round | same |
| `PATCH /api/session/:code/wheel/picks/:pickId` | **new** | owner | What the pick was asked and how they responded | same |
| `GET`, `POST /api/session/:code/tallies`; `PATCH .../tallies/:tallyId`; `POST .../increment`, `/decrement` | **new** | read rule; owner | The raised-hands tally | same |
| `GET`, `POST /api/session/:code/activities`; `PATCH .../activities/:activityId` | **new** | read rule; owner | The five no-device activities | same |
| `GET`, `POST /api/session/:code/insights/actions` | **new** | read rule; owner | What was done about a flag (append-only) | same; Live insights |
| `GET /api/session/:code/insights` | **new** | read rule | Bands, sort orders, the three cards, KPI tiles, the series, teacher records counted apart | Live insights |
| `GET /api/session/:code/students/:roll/card` | **new** | read rule | One student's card | same |
| `GET`, `PATCH /api/session/:code/projector` | **new** | read rule; owner | What the wall shows; change it | Room modes |
| `POST /api/session/:code/projector/links`; `DELETE .../links/:linkId` | **new** | owner | Make a link (its token in this reply only); revoke one | same |
| `GET /api/session/archives/:id` | changed | read rule | `room.classId` (a class room only), `room.mode` and the other new settings (only those a room changed), and the tables `attendance`, `observations`, `wheelRounds`, `wheelPicks`, `tallies`, `activities`, `insightActions` (only when the room has any), with their `counts` | Classes...; The teacher-record store |
| `GET /api/media/:id` | changed | open at the mount | A waiting room counts as running for the image rule, so its projector can load a diagram | Room modes |
| `POST /api/generate` | changed | chapter owner | A waiting room counts as running for the replacing-generate 409 | same |

### Socket events

| Event | Direction | | When, and what changed |
|---|---|---|---|
| `student:join` | phone to server | changed | Unchanged in shape. In a Teacher-led room the phone gets `session:teacher-led` and nothing else. In a waiting room it gets `session:accepted`, then `server:waiting`. In a class room a roster roll number marks the student present (the phone is not told). A new profile starts at the room's `startLevel` |
| `student:next`, `student:answer` | phone to server | changed | Unchanged in shape. While the room waits: `server:waiting` again and nothing stored. At the room's `questionsPerStudent`: `server:exhausted` with `reason`, and an answer to a question never served is not taken |
| `session:accepted` | to a phone | changed | `session.settings` gains `mode`, `adapt`, `startLevel`, `questionsPerStudent`, `timePerQuestion` |
| `server:waiting` | to a phone | **new** | The room waits for the professor's start |
| `session:teacher-led` | to a phone | **new** | The room takes no answers on phones |
| `server:question` | to a phone | changed | `timePerQuestion` (seconds) when the room set one; absent otherwise |
| `server:exhausted` | to a phone | changed | `reason` when the student reached the room's cap; absent otherwise |
| `server:result`, `session:rejected`, `session:paused`, `session:resumed`, `session:closed` | to a phone | unchanged | |
| `teacher:watch` | teacher screen to server | changed | Unchanged in shape. The screen now also gets `teacher:insights` at once, after `teacher:grid` and `teacher:status` |
| `teacher:grid` | to teacher screens | changed | `rosterName` per row and `attendance` in a class room; `waiting` while the room waits; `feed` in a Mixed or Teacher-led room. Also pushed after attendance is marked, after a start, after each record in a Mixed or Teacher-led room, and after Absent on a pick that marked attendance |
| `teacher:status` | to teacher screens | changed | Also `{ code, status: "open" }` after a start |
| `teacher:insights` | to teacher screens | **new** | The body of `GET /:code/insights`, at most once every 2 seconds per room |
| `projector:watch` | projector to server | **new** | `{ token }` of a projector link |
| `projector:state` | to the projector | **new** | The whole screen, at watch and whenever it changes |
| `projector:closed` | to the projector | **new** | The room closed or was deleted, the link was revoked or ran out; nothing follows |
| `projector:refused` | to the projector | **new** | The link does not work, or the connection is already a phone or a teacher's screen |

A connection is either a projector or not, decided by its first event and kept: the
first of `projector:watch` on one side, `student:*` or `teacher:watch` on the other
(`claimConnection`). A projector connection's `student:*` and `teacher:watch` are
ignored; `projector:watch` on a phone's or a teacher screen's connection is refused.

### What a phone receives

Captured from a Mixed class room opened with a waiting room and every new setting
(19 November 2026, in-process store, shared key), the phone joining as `" 21cs01 "`
with the name `asha`. The phone was sent `session:accepted`, `server:waiting`,
`server:question`, `server:result`, and in two other rooms `session:teacher-led`
and `server:exhausted`; no event, and no field of any event, carried a roster name,
attendance, a teacher record, an insight or a projector event.

`session:accepted`, the new settings (the `profile` is the grid row, unchanged,
without `rosterName`):

```json
{ "profile": { "rollNo": "21CS01", "name": "asha", "workingLevel": "understand", "...": "the grid row" },
  "session": { "code": "R8N4UR", "title": "Trees and traversals",
    "settings": { "masteryGoal": 0.8, "reattempts": 0, "redemption": false, "mode": "mixed", "adapt": true,
      "startLevel": "understand", "questionsPerStudent": 10, "timePerQuestion": 60 } },
  "bankCount": 6, "supports": { "...": "unchanged" } }
```

`server:waiting` (also the answer to `student:next` and `student:answer` while the
room waits):

```json
{ "code": "R8N4UR", "title": "Trees and traversals", "message": "You are in. Your professor will start the questions soon - keep this page open." }
```

`server:question` once the professor starts (every field as before, plus the time):

```json
{ "question": { "_id": "955bf0717185ef275ef9710d", "text": "Which traversal visits the root first? (1)", "...": "..." },
  "reason": "Working level is Understand: serving an Understand item.", "index": 1, "bankCount": 6,
  "triesLeft": 1, "resumed": false, "timePerQuestion": 60 }
```

`session:teacher-led`, in place of `session:accepted`; nothing follows:

```json
{ "code": "ZKV3R3", "title": "Trees and traversals", "message": "This class is teacher-led: no answers are taken on phones today. Follow along on the board and answer when your professor asks." }
```

`server:exhausted` at the room's cap:

```json
{ "profile": { "...": "the grid row" }, "reason": "This room asks each student 1 question, and you have answered them all." }
```

**Never sent to a phone:** `rosterName`, the roster, attendance (a join that marks a
student present says nothing), observations, picks, tallies, activities, insight
actions, bands, cards, KPIs, the student card, the feed, the waiting room's "N / M
present" and any `projector:*` event. **Still sent, an open issue:** the phone's
`profile` is the teacher's grid row, so it carries `slowLearner` and an `integrity`
summary, and `reason` sentences can name the below-40% band (`CONTRACT.md` sections 4
and 5; "Known open issues" below).

### What the projector receives

Only `projector:state`, `projector:closed` and `projector:refused`, each passed
through the whitelist (`toProjector`, "The projector" below). Captured from the same
Mixed room, then a Teacher-led one.

At watch, before the professor puts anything up:

```json
{ "code": "R8N4UR", "title": "Trees and traversals", "status": "open", "mode": "question",
  "question": null, "diagram": null, "progress": null, "pick": null }
```

A bank question, unrevealed (`correct` null):

```json
{ "...": "...", "mode": "question",
  "question": { "source": "bank", "text": "Which traversal visits the root first? (0)", "kind": "mcq",
    "options": [ { "key": "A", "label": "Inorder" }, { "key": "B", "label": "Preorder" },
                 { "key": "C", "label": "Postorder" }, { "key": "D", "label": "Level-order" } ],
    "stimulus": null, "revealed": false, "correct": null } }
```

`PATCH /:code/projector { "revealed": true }` on it in this Mixed room is **409**, and
the wall does not change:

```json
{ "error": "That key cannot go on the wall: this room's phones may still be served this question, and a phone that has not answered it yet would have been shown its answer. A bank question's key is revealed on the projector only in a Teacher-led room; nothing was changed." }
```

In a Teacher-led room the same reveal is 200 and the wall gets
`"revealed": true, "correct": ["B"]`.

Progress with one student answered (no counts per level until 5 have), and the
wheel's pick after a draw:

```json
{ "...": "...", "mode": "progress",
  "progress": { "present": 1, "classSize": 3, "answered": 1, "levels": null, "minAnswered": 5 },
  "pick": { "rollNo": "21CS03", "firstName": "Chitra" } }
```

Revoking the link (`projector:closed`), then watching with the revoked token
(`projector:refused`, the same sentence as for a token that never existed):

```json
{ "code": "R8N4UR", "reason": "This projector link was turned off." }
{ "reason": "That projector link does not work: it may have been turned off. Ask your professor for a new one." }
```

**Never sent to the projector:** any score, accuracy, band, level of a student,
observation, attendance mark, roster name beyond the current pick's first name, a
tally's hands, the key of a bank question outside a Teacher-led room, or a key before
the professor reveals it.

### What teacher screens receive

`teacher:grid` for the same Mixed class room while it waited (one phone joined, the
join marking its student present), shortened:

```json
{ "rows": [ { "rollNo": "21CS01", "name": "asha", "workingLevel": "understand", "...": "the grid row as before",
              "rosterName": "Asha Rao" } ],
  "code": "R8N4UR",
  "attendance": { "present": 1, "classSize": 3, "summary": "1 / 3 present" },
  "waiting": { "joinedN": 1, "present": 1, "classSize": 3, "summary": "1 / 1 present", "canStart": true },
  "feed": { "mode": "mixed",
    "digital": { "label": "Digital answers", "joined": 1, "answered": 0, "answers": 0 },
    "teacher": { "label": "Teacher records",
      "observations": { "understood": 0, "participated": 0, "revision": 0, "support": 0, "observed": 0 },
      "wheel": { "picks": 0, "answered": 0, "pending": 0 }, "tallies": 0, "activities": 0,
      "privacy": "Teacher records are for staff only: never shown on a phone or the projector, and they never move a Bloom level." } } }
```

Two "present" sentences sit side by side and mean different things:
`attendance.summary` is students present (late included) of the class size;
`waiting.summary` is phones joined of students marked present. After an observation
in the started room, the next push had `feed.teacher.observations.participated: 1,
observed: 1` and the digital half unchanged.

`teacher:status` after `POST /:code/start`: `{ "code": "R8N4UR", "status": "open" }`.

`teacher:insights` at watch had the keys `room, thresholds, bands, students, counts,
sort, cards, kpis, series, teacherRecords, privacy` (`teacherRecords` only in a Mixed
or Teacher-led room; `cardsNote` in place of cards in a Teacher-led one); the shapes
are under `GET /api/session/:code/insights` below.

---

## Phase 3: classes, rosters and attendance

Written 19 November 2026 from `server/src/routes/classes.js`,
`server/src/routes/session.js`, `server/src/services/roster.js` and
`server/src/sockets/index.js`. Exercised by `server/scripts/roster.mjs` (80 checks)
over HTTP and real sockets on the in-process store, **with signed-in callers**: the
script answers the server's Supabase Auth calls itself (see its header), so a
professor, a second professor, an HOD of the department, an HOD of another and a
student account were all run. Not run against Supabase, Mongo or a real Auth token.
No screen uses any of it yet.

| Method + path | Who | What |
|---|---|---|
| `GET /api/classes` | teacher | Every class the caller may read, newest first |
| `POST /api/classes` | professor, shared key | Create a class (an HOD gets 403) |
| `GET /api/classes/:id` | read rule | The class and its roster |
| `PATCH /api/classes/:id` | owner | Edit course name, section or term |
| `POST /api/classes/:id/students` | owner | Add students from a JSON list |
| `PATCH /api/classes/:id/students/:studentId` | owner | Edit one student, or remove / restore one |
| `DELETE /api/classes/:id/students/:studentId` | owner | Remove one student (soft) |
| `POST /api/session` (changed) | owner | Takes `classId` |
| `GET /api/session/:code/attendance` | read rule | The room's attendance against its class |
| `POST /api/session/:code/attendance` | owner | Mark attendance |
| `teacher:grid`, `GET /api/session/:code/grid` (changed) | read rule | `rosterName` per row and `attendance` for a class room |

**Who.** `/api/classes` is mounted behind `requireTeacher`: a student token gets
403, no credentials 401. Inside, `ownership.js` as for chapters: the owner reads and
writes; an HOD reads the classes of their department's professors and gets 403 on
every write; the shared key reaches only classes nobody owns. Anything else, and an
id that names nothing, is one 404, word for word: `That class was not found.` (a
student id outside the class in the path: `That student was not found.`).

**Privacy.** A roster holds a roll number and a name per student, nothing else.
Roster names and attendance are teacher-only: they are never sent to a phone (not in
`session:accepted`, `server:question`, `server:result` or any other phone event) and
never in `GET /api/session/:code`, which anyone holding the code can read. A phone
told the name behind the roll number it typed would make the projected room code a
way to look a class list up one roll number at a time. Attendance never moves a Bloom
level or touches accuracy. A screen projected to the class should not show
`rosterName` or anyone's attendance status.

### The class and a student

```json
{ "class": { "id": "6fc2802e8bcc25b1479fd944", "courseName": "Computer Networks", "section": "TY-CSF B",
             "termLabel": "Sem V 2026", "ownerId": "a0000000-...-000000000002",
             "createdAt": "...", "updatedAt": "...", "size": 5, "canEdit": true },
  "students": [ { "id": "027f25a2d11ef75ef2afce7f", "rollNo": "21CS01", "name": "Asha Rao",
                  "active": true, "addedAt": "...", "removedAt": null } ],
  "removed": [] }
```

- `size` is the class size: students on the roster now, the removed left out.
- `canEdit` follows the write rule (false for an HOD), as `canControl` does on rooms.
- `students` and `removed` are separate lists, so a screen cannot show a removed
  student as enrolled.
- `rollNo` is stored in the room's form: trimmed, single-spaced, upper case. A phone
  typing `" 21cs01 "` joins as `21CS01` and is that roster student. `03` and `3` are
  two roll numbers, as they are to a room.

`POST /api/classes` takes `{ courseName, section, termLabel? }` and answers 201 with
the shape above. `courseName` (at most 120 characters) and `section` (at most 40) are
required; `termLabel` at most 40. Any of the three holding an email address or a mobile
number is a 400 (`courseName holds an email address or a phone number; ...`).
`PATCH /api/classes/:id` takes any of the three and answers the same shape; it must
send one. `GET /api/classes` answers `{ classes: [ <class, without the roster> ] }`.

### `POST /api/classes/:id/students`

```json
{ "students": [ { "roll": "21CS01", "name": "Asha Rao" }, { "roll": " 21cs02 ", "name": "Bilal  Khan" },
                { "roll": "", "name": "No roll" }, { "roll": "21CS08", "name": "Esha", "phone": "98450 12345" } ] }
```

`rollNo` is accepted in place of `roll`. At most 500 rows (400 beyond, or for an
empty list or not a list). Every row is added or refused; nothing is half-added:

```json
{ "added": [ { "id": "...", "rollNo": "21CS01", "name": "Asha Rao", "active": true, "addedAt": "...", "removedAt": null } ],
  "refused": [ { "index": 2, "roll": "", "name": "No roll", "reason": "the roll number is missing" } ],
  "ignoredFields": ["phone"],
  "note": "A roster keeps a roll number and a name only. Not stored: phone.",
  "size": 3,
  "class": { "...": "the class, as above" } }
```

Refusal reasons: the roll number is missing; not one a phone can join with (letters,
digits, spaces and `. _ - /`, starting with a letter or digit, at most 24
characters); the name is missing or over 80 characters; the name holds an email
address or six or more digits (a phone number or a date of birth), or a short date
such as `12-5-04` (a date of birth); already on the
roster; removed earlier ("restore that student instead"); twice in this list (the
first is added); the class would pass 500; not an object. A row that passed the check
but lost a race with another request adding the same roll number is refused as
already on the roster.

### Editing, removing and restoring one student

`PATCH /api/classes/:id/students/:studentId` takes `{ name }`, `{ rollNo }` (or
`roll`) and `{ active }`, and answers `{ student }`. A roll number another row of the
class holds (removed included) is 409. `{ active: true }` restores a removed student
(the same row, so their attendance follows); `{ active: false }` removes, as DELETE
does.

`DELETE /api/classes/:id/students/:studentId` removes softly:

```json
{ "student": { "id": "...", "rollNo": "21CS01", "active": false, "removedAt": "2026-11-19T..." },
  "removed": true,
  "message": "Removed from the roster. Nothing they did is deleted: their answers in every room, their attendance and their records stay, and they can be put back on the roster (PATCH with { \"active\": true })." }
```

The row stays with `removedAt` set (the first removal's date, if sent twice). Their
answers under that roll number in every room, their attendance marks and the roster
row are all kept. They leave the class size and a join no longer marks them present;
a phone with their roll number still joins a room, as any roll number does, and is
listed as not on the roster (`removedFromRoster: true`).

### `POST /api/session` (changed): `classId`

The body takes `classId`, optional. Left out or null: a room with no class, exactly
as before. Otherwise it must be a class the caller may **change**; another
professor's, one an HOD may only read, and one that does not exist are one 404,
`That class was not found.`. A malformed id is 400. Checked before the question set
and before a room code is drawn. The reply gains `classId` (null for none), read
back from the stored room; `GET /api/session` returns it with each room. Written
once; no route changes it. A deleted room's archive keeps it (`room.classId`); a room
opened for no class archives with no `classId` key at all, exactly as before 0016, and
decodes as null.

### `GET /api/session/:code/attendance`

Read rule, with the same 404 as `/answers`. A room opened for no class answers 409.

```json
{ "room": { "code": "CUT33C", "title": "Transport layer", "startedAt": "...", "status": "open" },
  "class": { "id": "...", "courseName": "Computer Networks", "section": "TY-CSF B", "termLabel": "Sem V 2026" },
  "students": [
    { "studentId": "...", "rollNo": "21CS01", "name": "Asha Rao", "status": "present", "source": "joined",
      "markedAt": "...", "markedBy": null, "joined": true },
    { "studentId": "...", "rollNo": "21CS03", "name": "Chitra", "status": "unmarked", "source": null,
      "markedAt": null, "markedBy": null, "joined": false } ],
  "removed": [],
  "notOnRoster": [ { "rollNo": "GUEST99", "name": "Visitor", "removedFromRoster": false } ],
  "counts": { "present": 2, "late": 0, "absent": 0, "unmarked": 3, "classSize": 5, "joined": 2, "notOnRoster": 1 },
  "summary": "2 / 5 present",
  "caveat": "\"Joined\" means a phone joined this room with that roll number. A room has no sign-in, so a typed roll number is not proof of who was holding the phone." }
```

- `students`: everyone on the roster now, in roll-number order. `status` is
  `present`, `absent`, `late`, or **`unmarked`** when nobody has marked them, which
  is not absent.
- `source`: `joined` (a phone joined with that roll number and the server marked
  the student present) or `teacher`. `markedBy` is the professor's account id; null
  for a join and on the shared key.
- `joined`: whether a phone with that roll number is in the room, whatever the mark.
  A student marked absent who joins later shows `status: "absent", joined: true`.
- `removed`: students removed from the roster since, who have a mark in this room.
  Shown, not counted.
- `notOnRoster`: phones that joined with a roll number not on the roster now. They
  were let in. A professor can add them with `POST /api/classes/:id/students`.
- `summary`: "N / M present", where N counts present **and late** and M is the class
  size now.
- `caveat`: decision 7's known gap, sent with the data so no screen can show "joined"
  without it.

### `POST /api/session/:code/attendance`

Write rule: the room's owner (404 for anyone who may not read the room, 403 for an
HOD who may). A room opened for no class answers 409; a room being deleted, 409. A
closed room may still be marked: attendance is often corrected after the class.

Either of:

```json
{ "marks": [ { "studentId": "...", "status": "absent" }, { "studentId": "...", "status": "late" } ] }
{ "fromJoins": true }
```

- `marks`: one student or many, `status` one of `present`, `absent`, `late`.
  `studentId` is the roster id from the attendance read (any case). **All or
  nothing**: a bad status, a student named twice, or a student not on this class's
  roster (another class's, a removed one, an unknown id) is 400 and changes nobody.
- `fromJoins`: everyone with a phone in the room present, everyone else on the
  roster absent. **A student already marked by hand keeps that mark**; joins and
  unmarked students are written. In a **Teacher-led** room it is a 409 and nothing
  is written (`This room is Teacher-led, so no phone joins it: ...`): no phone joins
  one, so it would mark every student not yet marked absent.

Every mark written here is the teacher's (`source: "teacher"`, `markedBy` the
caller). **A professor's mark is never replaced by a later join**, nor by that
phone rejoining. The reply is the attendance read above plus `changed` (marks
written) and `kept` (hand marks `fromJoins` left alone). Every teacher screen
watching the room is sent a fresh `teacher:grid`.

### What a join does in a class room

When a phone joins a room opened for a class (`student:join`, unchanged in shape), a
roll number on the roster marks that student present with `source: "joined"`, unless
the student already has a mark; a rejoin adds nothing. A roll number not on the
roster joins exactly as before. The phone is told nothing of it. A failure to record
the mark is logged and never stops the join. **Known gap (decision 7):** the roll
number is typed, not proven, so a classmate's phone can mark someone present. Not
solved here.

### `teacher:grid` and `GET /api/session/:code/grid` (changed for class rooms)

For a room opened for a class only:

- each row gains `rosterName`: the roster's name for that roll number, or null for
  one not on the roster (or removed). `name` is still what the phone typed;
- the payload gains `attendance`: `{ "present": 3, "classSize": 5, "summary": "3 / 5 present" }`,
  by the same rule as the attendance read.

Students who never joined are not rows. No field is renamed or removed, and a room
with no class gets `{ rows, code }` and `{ rows, levels }` exactly as before. The
phone's own row (`profile` in `session:accepted` and `server:result`) does not gain
`rosterName`.

---

## Phase 3: the teacher-record store

Written 19 November 2026 from `server/src/routes/records.js`,
`server/src/services/records.js`, `server/src/services/wheel.js` and the one route
added to `server/src/routes/classes.js`. Migration `0017`. Exercised by
`server/scripts/records.mjs` (97 checks) with signed-in callers, as `roster.mjs`
does, on the in-process store; the examples below are real responses (shared key, so
`observedBy`, `pickedBy` and the like are null), shortened. Not run against Supabase,
Mongo or a real Auth token. No screen uses any of it yet.

| Method + path | Who | What |
|---|---|---|
| `GET /api/session/:code/observations` | read rule | Every student's mark for the room's day, with its log |
| `POST /api/session/:code/observations` | owner | Set or clear one student's mark |
| `GET /api/classes/:id/students/:studentId/observations` | read rule | One student across days |
| `GET /api/session/:code/wheel` | read rule | The round, its settings, who is on the wheel, every pick |
| `PATCH /api/session/:code/wheel` | owner | Change the round's settings |
| `POST /api/session/:code/wheel/draw` | owner | Draw the next student (server, crypto randomness) |
| `POST /api/session/:code/wheel/rounds` | owner | Start a new round |
| `PATCH /api/session/:code/wheel/picks/:pickId` | owner | What the pick was asked, and how they responded |
| `GET /api/session/:code/tallies` | read rule | Every question asked aloud, in order |
| `POST /api/session/:code/tallies` | owner | Record a question asked aloud |
| `PATCH /api/session/:code/tallies/:tallyId` | owner | Edit, set the counts, reveal |
| `POST /api/session/:code/tallies/:tallyId/increment`, `/decrement` | owner | One hand more or fewer for an option |
| `GET /api/session/:code/activities` | read rule | Every no-device activity run in the room |
| `POST /api/session/:code/activities` | owner | Record one |
| `PATCH /api/session/:code/activities/:activityId` | owner | Fill in its outcome, groups or tally |
| `GET /api/session/:code/insights/actions` | read rule | What was done about each flag |
| `POST /api/session/:code/insights/actions` | owner | Dismissed or acted on a flag (append-only) |

**Who.** Every route needs a teacher (`requireTeacher`): a student token is 403, no
credentials 401. Inside, `ownership.js` on the room: the read rule for reads (an HOD
reads the department's records), the write rule for writes (an HOD gets 403). A room
the caller may not read answers exactly like one that does not exist: `That room was
not found.` (404). A record id that is not this room's is a 404 of its own (`That
pick was not found.`, `That tally was not found.`, `That activity was not found.`).

**Staff-only.** Nothing here is sent to a phone: no socket event to `session:<code>`,
nothing in `session:accepted`, `server:question`, `server:result` or
`GET /api/session/:code`. Nothing here is for the projector either, except what
`pickForProjector` (below) gives the Modes work. No record moves a Bloom level or is
blended into accuracy (decision 3's safe default): the ladder never reads these
tables. Every read carries `privacy`, the sentence saying so, so no screen can show
the data without it.

**No phones needed.** In a room opened for a class every record works from the
roster, with nobody joined (Teacher-led). The wheel and the tally read attendance for
who is present, so a professor marks attendance by hand first.

**When.** Writes are allowed on a closed room (records are often filled in after the
class), except drawing, starting a round and changing the wheel's settings, which
answer 409 on a closed room. Every write is refused (409) while the room is being
deleted, and the delete waits for a write already under way, which is then in the
archive.

### Observations

The four private marks: `understood` ("Understood"), `participated`
("Participated"), `revision` ("Needs revision"), `support` ("Needs additional
support"), with an optional `note` of at most 280 characters. **One mark per student
per class per day**: the day is the day the room was opened, in India's time
(`roomDay`); in a class room the student is the roster student, so two rooms of one
class on one day share the mark. In a room opened for no class the student is a roll
number a phone joined with, and the room's day.

`POST /api/session/:code/observations`:

```json
{ "studentId": "fee8967db3231f6c0daa38b3", "kind": "understood", "note": "Explained inorder with a family tree" }
{ "rollNo": "21CS01", "kind": "revision" }
{ "rollNo": "21CS01", "kind": null }
```

`studentId` (from the roster, class rooms only) or `rollNo` names the student;
`kind` is required, and `null` clears the day's mark. Setting replaces the day's mark;
**every set and clear is kept** (the table is append-only), so the replaced mark is in
`history`. The same mark and note again writes nothing (`changed: false`). Refused
(400): a kind outside the four, no kind, a note over 280 characters or holding an
email address or a mobile number, a clear with a note, a roll number not on the
class's roster (in a class room) or no phone joined with (otherwise), a `studentId`
in a room with no class.

```json
{ "changed": true,
  "student": { "studentId": "fee8967db3231f6c0daa38b3", "rollNo": "21CS01", "name": "Asha Rao" },
  "day": "2026-11-19",
  "current": { "id": "93b6...", "kind": "revision", "label": "Needs revision", "note": "",
               "observedAt": "2026-11-18T23:25:48.582Z", "observedBy": null, "room": "2MVRZA" },
  "replaced": { "id": "d2b6...", "kind": "understood", "label": "Understood", "note": "Explained inorder with a family tree", "...": "..." },
  "history": [ { "kind": "understood", "...": "..." }, { "kind": "revision", "...": "..." } ],
  "privacy": "Teacher records are for staff only: never shown on a phone or the projector, and they never move a Bloom level." }
```

`room` is the code of the room the event was written in (another room of the class
the same day, possibly).

`GET /api/session/:code/observations` answers `{ room, class, day, kinds, students,
counts, privacy }`. `students`: in a class room, the roster now (plus a removed
student with a mark that day, `active: false`); otherwise the phones that joined.
Each is `{ studentId, rollNo, name, active, current, history }`. `counts` is
`{ understood, participated, revision, support, observed, students }` over the
active rows' marks in force, counted apart from anything else.

`GET /api/classes/:id/students/:studentId/observations` (read rule on the class, the
404s of `/api/classes`) answers `{ class, student, kinds, counts, days, privacy }`:
`days` newest first, each `{ day, current, history }`; `counts` the number of days
with each mark in force, and `days`. A removed student's are readable. Rooms deleted
since took theirs into their archives.

### The wheel

The server draws, with `crypto.randomInt`, from everyone on the wheel, each with the
same chance, and **stores the pick before it answers**, so a screen's spin only ever
animates a choice already made. Who is on the wheel:

- `presentOnly` on: the present students. In a class room, a roster student marked
  `present` or `late`; unmarked is not present, and a phone off the roster has no
  attendance. In a room opened for no class, every phone that joined.
- `presentOnly` off: everyone on the roster now, and every phone that joined (off
  the roster too).
- `noRepeat` on: less whoever was picked this round.

Both default to on (the handoff's defaults). A round starts at the first draw or
settings change (round 1), or by `POST .../wheel/rounds`; nothing is ever deleted.
Think time and the names toggle are the screen's own and are not stored.

`GET /api/session/:code/wheel`:

```json
{ "room": { "code": "2MVRZA", "title": "Trees, period 3", "startedAt": "...", "status": "open", "classId": "6ac2..." },
  "round": { "number": 1, "started": true, "startedAt": "...", "presentOnly": true, "noRepeat": true, "picks": 1 },
  "pool": { "total": 2, "left": 1, "picked": 1, "summary": "1 picked of 2",
            "onWheel": [ { "rollNo": "21CS01", "name": "Asha Rao" } ], "empty": null },
  "rounds": [ { "number": 1, "startedAt": "...", "presentOnly": true, "noRepeat": true } ],
  "picks": [ { "id": "32e3...", "round": 1, "order": 1, "rollNo": "21CS02", "name": "Bilal Khan",
               "classStudentId": "9dfb...", "poolSize": 2, "presentOnly": true, "noRepeat": true,
               "ask": "bank", "askLabel": "Bank", "questionId": null, "question": null,
               "status": "pending", "statusLabel": "Pending", "pickedAt": "...", "pickedBy": null,
               "statusAt": null, "statusBy": null } ],
  "asks": [ { "id": "bank", "label": "Bank", "hint": "..." }, { "id": "diagram", "...": "..." }, { "id": "demo", "...": "..." } ],
  "statuses": [ { "id": "answered", "label": "Answered" }, { "id": "passed", "label": "Passed to partner" },
                { "id": "help", "label": "Needs help" }, { "id": "skipped", "label": "Skipped" }, { "id": "absent", "label": "Absent" } ],
  "privacy": "..." }
```

- `pool.total` is the round's total (who the settings allow, repeats ignored);
  `picked` how many of them have had a turn this round; `summary` "N picked of M";
  `left` and `onWheel` who the next draw is from; `empty` the reason when nobody is
  (nobody marked present, everyone has had a turn, nobody at all), else null.
- `picks`: every pick of every round, in order. `poolSize` is how many were on the
  wheel when it was drawn, so each had 1 in `poolSize`. `name` is the roster's name
  (or what the phone typed, off the roster). `question` is a bank ask's text, level
  and kind.

`POST .../wheel/draw` (201) takes `{ presentOnly?, noRepeat? }`, applied to the round
first, and answers `{ pick, ...the wheel }`. An empty wheel is a 409 with `empty`'s
reason. `PATCH .../wheel` takes the same and answers the wheel. `POST .../wheel/rounds`
(201) starts the next round with the settings sent or the last round's.

`PATCH .../wheel/picks/:pickId` takes any of:

- `ask`: `bank`, `diagram` or `demo`. `questionId`: for a bank ask only, one of the
  room's approved questions (its set's, when it has one); `null` clears it. Turning a
  bank ask into a diagram or demo drops its question.
- `status`: `answered`, `passed`, `help`, `skipped` or `absent` (labels "Answered",
  "Passed to partner", "Needs help", "Skipped", "Absent"). `pending` is only where a
  pick starts. `statusAt` and `statusBy` are stamped.
- `markAttendance`: with `status: absent`, `false` leaves attendance alone. By
  default **Absent also marks the student absent in the room's attendance**, as the
  professor's mark (a class room, a student on its roster now); otherwise the reply
  says why nothing was marked. Changing the status away from Absent later does not
  change attendance back (docs/PRODUCT_DECISIONS.md).

```json
{ "pick": { "id": "79c8...", "rollNo": "21CS01", "status": "absent", "statusLabel": "Absent", "...": "..." },
  "attendance": { "marked": true, "status": "absent", "studentId": "fee8..." },
  "privacy": "..." }
```

Who was drawn, in which round and place, from how many and when cannot be changed:
no field of the route touches them, and the database refuses it (`0017`).

**For the projector** (the Modes work): `pickForProjector(pick, name, { showName })`
in `services/wheel.js` gives `{ rollNo, firstName }` and nothing else: no status, ask,
score or observation. `showName: false` leaves the name out.

### The raised-hands tally

`POST /api/session/:code/tallies` (201):

```json
{ "text": "Which traversal of a BST gives sorted output?", "labels": ["Inorder", "Preorder", "Postorder", "Level-order"] }
{ "questionId": "742cad70cb21955d9e94cedf" }
```

`text` (at most 1000 characters), or `questionId` of the room's approved questions,
or both. A bank mcq brings its text, its options as labels and its key as `correct`
unless they are sent; the text is always stored, so a later edit of the bank does not
change what was asked. Optional: `labels` (up to four, padded with `""`), `correct`
(`A` to `D`, or `null`), `counts` (four whole numbers), `revealed`.

```json
{ "tally": { "id": "faf5...", "seq": 1, "questionId": "742c...", "text": "Which traversal visits the root first? (1)",
             "options": [ { "key": "A", "label": "Inorder", "count": 0, "correct": false },
                          { "key": "B", "label": "Preorder", "count": 1, "correct": true }, "..." ],
             "total": 1, "revealed": false, "correct": "B", "present": 1, "summary": "1 of 1 present responded",
             "createdAt": "...", "createdBy": null, "updatedAt": "..." },
  "privacy": "..." }
```

- `present` is who is present by the wheel's rule (attendance in a class room, the
  phones that joined otherwise). `summary` is "N of M present responded"; with nobody
  marked present, "N responded (nobody is marked present)"; with more hands than
  students present, "N responded, more than the M marked present".
- `POST .../tallies/:tallyId/increment` and `/decrement` take `{ option: "A" }` (A to
  D, any case, or 0 to 3). **A count never goes below 0**: a decrement at 0 changes
  nothing and answers `clamped: true`. At most 1000 hands per option.
- `PATCH .../tallies/:tallyId` takes `text`, `labels`, `counts` (a count below 0 is
  400), `revealed`, `correct`.
- `text` or a label sent with an email address or a mobile number in it is a 400
  (`text holds an email address or a phone number; teacher records keep neither.`),
  as a note is. A bank question's own text and options are not screened.
- A tally's `revealed` is the teacher's own record. Putting its key on the projector
  is the projector's `revealed`, which refuses the key of a tally from the bank
  (`questionId` set) outside a Teacher-led room ("The projector" below).
- `GET .../tallies` answers `{ room, present, tallies, privacy }`, in the order asked.

### Activities

`POST /api/session/:code/activities` (201) records one run of the handoff's five:
`check` ("Quick knowledge check", which is a tally: `tallyId` names it), `think`
("Think and explain"), `group` ("Group challenge"), `diagram` ("Explain the
diagram"), `real` ("Real-world application"). `outcome` is at most 280 characters. A
group challenge records **groups, never students**:

```json
{ "kind": "group", "outcome": "Most benches found the postorder",
  "groups": [ { "label": "Bench 3", "gotIt": "yes" }, { "label": "Bench 4", "gotIt": "partly" } ] }
```

`gotIt` is `yes`, `partly` or `no` (shown "Got it", "Partly", "Not yet"); a label is
at most 40 characters, named once, and holds no email address or mobile number (400);
at most 100 groups. Groups on anything but a
group challenge, and a tally on anything but a quick check or from another room, are
400. `PATCH .../activities/:activityId` changes `outcome`, `groups` (the whole list)
or `tallyId`; the kind stays what was run. `GET .../activities` answers `{ room,
kinds, results, activities, privacy }`, each activity `{ id, seq, kind, label,
outcome, groups: [{ label, gotIt, result }], tallyId, createdAt, createdBy, updatedAt }`.

### Insight actions

`POST /api/session/:code/insights/actions` (201) records what a professor did about a
flag, for the Insights work to call: `{ flagId, action: "dismissed" | "acted", note? }`.
Since the live insights, `flagId` is an insight card's own `flagId` ("Phase 3: live
insights" below), and the teacher screens watching the room are sent fresh
`teacher:insights`.
`flagId` is the flag's own id, in the shape the insights give their cards and no
other: `focus:`, `support:` or `participation:` and then 1 to 64 lower-case letters,
digits or hyphens (`focus:analyse`, `support:fe76c26d8957b79f`,
`participation:nobody-present`). Anything else is a 400, so no free text about a
student rides in on a flag id. `note` at
most 280. **Append-only**: there is no route to edit or delete one, and the database
refuses both; a later action on the same flag is a new row. `GET` answers
`{ room, actions: [{ id, flagId, action, note, actedBy, actedAt }], privacy }`, oldest
first.

### In a deleted room's archive

Every record of the room is in its archive (`services/archive.js`), each as a table
when the room has any: `observations` (every set and clear, so the log is kept),
`wheelRounds`, `wheelPicks`, `tallies`, `activities`, `insightActions`, with their
counts in `counts`. A roster student's name is copied in, as for attendance. An
archive without them decodes with empty lists; the format version is unchanged. They
count towards the 1 MiB: a class of 60 with a mark each, 40 picks, 10 tallies, 5 group
challenges and 10 insight actions adds about 28 KB.

---

## Phase 3: room modes, the waiting room and the projector

Written 19 November 2026 from `server/src/routes/session.js`,
`server/src/routes/projector.js`, `server/src/services/modes.js`,
`server/src/services/projector.js` and `server/src/sockets/index.js`. Migration
`0018`. Exercised by `server/scripts/modes.mjs` (101 checks) with real phones, teacher
screens and projector connections and signed-in callers as `roster.mjs` does, on the
in-process store; the examples below are real responses (shared key), shortened. Not
run against Supabase, Mongo or a real Auth token. No screen uses any of it yet.

| Method + path / event | Who | What |
|---|---|---|
| `POST /api/session` (changed) | chapter owner | Takes `mode`, `adapt`, `startLevel`, `questionsPerStudent`, `timePerQuestion` and `lobby` |
| `POST /api/session/:code/start` | owner | Start a waiting room |
| `GET /api/session/:code/projector` | read rule | What the projector shows, and the room's links |
| `PATCH /api/session/:code/projector` | owner | Change what it shows |
| `POST /api/session/:code/projector/links` | owner | Make a projector link (the token is in this reply only) |
| `DELETE /api/session/:code/projector/links/:linkId` | owner | Revoke one |
| `server:waiting`, `session:teacher-led` | to a phone | New events |
| `server:question.timePerQuestion`, `server:exhausted.reason` | to a phone | New fields, present only when set |
| `teacher:grid` / `GET /grid`: `waiting`, `feed` | teacher screens | New fields, present only when they apply |
| `projector:watch` in; `projector:state`, `projector:closed`, `projector:refused` out | the projector | New |

**Who.** As for the records: `requireTeacher` on every route; the read rule for
`GET /projector` (an HOD sees what a department's projector shows), the write rule for
everything else (an HOD gets 403); a room the caller may not read is `That room was not
found.` (404), word for word as for a room that does not exist.

### The room's settings: `POST /api/session` (changed)

All optional. Left out, a room runs exactly as every room ran before. Each is written
once, when the room opens, like the three settings before them, and returned in
`settings` everywhere settings are returned: this reply, the room list, the phones'
`GET /api/session/:code` and `session:accepted`.

| Field | Values | Default | Effect |
|---|---|---|---|
| `mode` | `devices`, `teacher-led`, `mixed` | `devices` | How students answer (below) |
| `adapt` | `true`, `false` | `true` | `false`: every student stays at `startLevel`; answers are recorded and accuracy counted, but nobody is promoted or demoted. The below-40% ceiling still holds (CONTRACT section 6 rule 4): such a student is still served Remember and Understand only |
| `startLevel` | a Bloom level | `understand` | Where every student starts |
| `questionsPerStudent` | whole number 1 to 500, or null | null (no cap) | A student who has finished this many gets `server:exhausted` with a `reason`; an answer to a question they were never served is not taken after that |
| `timePerQuestion` | whole number of seconds 10 to 600, or null | null (none) | Sent with each `server:question`. The phone times it; the server refuses no answer for being late (each answer row's `servedAt` and `answeredAt` say how long it took) |
| `lobby` | `true`, `false` | `false` | `true`: the room opens `waiting` (below) |

Anything else is a 400 naming the field. A `teacher-led` room with no `classId` is a 400:
`A Teacher-led room needs a class: no phones join it, so the wheel, attendance and
observations work from the class roster. Send classId, or open the room for Student
devices or Mixed.` The reply gains `status`:

```json
{
  "code": "NE6T3F", "sessionId": "0d8cff28b596af73c59cd98d", "bankCount": 7,
  "settings": { "masteryGoal": 0.8, "reattempts": 0, "redemption": false, "mode": "mixed", "adapt": false,
    "startLevel": "understand", "questionsPerStudent": 10, "timePerQuestion": 60 },
  "questionIds": null, "classId": "eaa6ee6e107cde298416c324", "status": "waiting"
}
```

### The waiting room

A room opened with `lobby: true` is `waiting`. Phones may join it: they get
`session:accepted` as usual (and a class room marks them present as usual), then
`server:waiting` instead of a question. `student:next` and `student:answer` sent while
it waits are answered with `server:waiting` again and nothing is stored.

```json
{ "code": "NE6T3F", "title": "Trees and traversals", "message": "You are in. Your professor will start the questions soon - keep this page open." }
```

The teacher's grid carries the waiting room's line while it waits (`waiting`, on
`teacher:grid` and `GET /grid`): phones joined of students marked present (present or
late) in a class room, "N joined" in a room with no class. `canStart` and, when false,
`reason`:

```json
{ "joinedN": 1, "present": 3, "classSize": 3, "summary": "1 / 3 present", "canStart": true }
```

**`POST /api/session/:code/start`** (no body): `waiting` becomes `open`, every phone
waiting in the room gets its first question at once, the teacher screens get
`teacher:status` `open`, and a phone joining later is served as in any open room.
Answers `{ session, settings }`. A REST route rather than a teacher socket event, like
pause, resume and close: the same kind of act, the same write rule and honest 409s.

| Status | When |
|---|---|
| 409 `That room has already started.` | open or paused |
| 409 `That room is closed - it cannot be started.` | closed |
| 409 `No phone has joined this room yet, so there is nobody to start it for. ...` | a Student-devices or Mixed room nobody has joined (the handoff's Start button stays disabled too). A Teacher-led room starts with no phones |
| 409 `That room is being deleted. Nothing was changed.` | a delete of the room is under way |

**One change of status at a time.** Start, pause, resume and close each take the room's
status lock (in-process, like the student locks), read the status again under it and
only then write; a delete waits the lock out. Start holds it until every waiting phone
has been served. So a close sent while a start is at work waits, then closes the room:
it stays closed, and its phones hear `session:closed` after their first question,
never before it. Of two starts at once, one starts the room and the other is the 409
above. A start serves only the phones its waiting room told to wait (`server:waiting`),
so a phone whose own join found the room already open is not served a second time.
Before the Phase 3 review each of these read, checked and wrote with nothing held: a
close during a start was written back to open, and two starts both served every phone.

Pause and resume answer 409 on a waiting room (`That room has not started yet, so there
is nothing to pause or resume. Start it, or close it.`). Close and delete work as on any
room. A waiting room counts as running for the image rule and for a replacing
generate (both below).

### Teacher-led and Mixed

**Teacher-led** (`mode: "teacher-led"`, needs a class): no phone is served. A phone that
joins gets `session:teacher-led` and goes no further: no profile, no attendance mark,
no place on the wheel, never a question; an answer it sends is refused (`session:rejected`,
as from any socket that has not joined).

```json
{ "code": "VMSDWG", "title": "Trees and traversals", "message": "This class is teacher-led: no answers are taken on phones today. Follow along on the board and answer when your professor asks." }
```

The professor runs it with the records routes (attendance, the wheel, observations,
the tally, activities) and the projector. It may open with a waiting room too, and
starts with no phone joined. Attendance `{ fromJoins: true }` is a 409 in it (no phone
joins, so it would mark everyone absent); and it is the one mode in which a bank
question's key may go on the projector, since no phone can still be served it.

**Mixed** (`mode: "mixed"`): phones work exactly as on Student devices, and teacher
records come in beside them.

**The feed.** In a Mixed or Teacher-led room the teacher's grid (`teacher:grid` and
`GET /grid`) carries `feed`: the digital answers and the teacher records, each under
its own label and never added together (decision 3's safe default). `digital` is left
out of a Teacher-led room's feed. The grid is pushed to every teacher screen watching
the room after each observation, draw, pick response, tally and activity, as well as
after every join and answer. A Student-devices room has no feed and no such push: its
grid is what it was.

```json
{
  "mode": "mixed",
  "digital": { "label": "Digital answers", "joined": 1, "answered": 1, "answers": 1 },
  "teacher": {
    "label": "Teacher records",
    "observations": { "understood": 0, "participated": 1, "revision": 0, "support": 0, "observed": 1 },
    "wheel": { "picks": 0, "answered": 0, "pending": 0 },
    "tallies": 0, "activities": 0,
    "privacy": "Teacher records are for staff only: never shown on a phone or the projector, and they never move a Bloom level."
  }
}
```

`observations` counts the mark in force per student for the room's day (a cleared mark
is not counted), as the observations read does.

### The phone's new fields

`server:question` carries `timePerQuestion` (seconds) when the room set one, and is
otherwise unchanged:

```json
{ "question": { "_id": "cbf0bbda7f28eeeb0d5d28cb", "text": "Which traversal visits the root first? (2)", "...": "..." },
  "reason": "Working level is Understand: serving an Understand item.", "index": 1, "bankCount": 7, "triesLeft": 1,
  "resumed": false, "timePerQuestion": 60 }
```

`server:exhausted` carries `reason` when the student reached the room's
`questionsPerStudent` (and is otherwise `{ profile }`, as before):

```json
{ "profile": { "...": "the grid row" }, "reason": "This room asks each student 1 question, and you have answered them all." }
```

### The projector

A read-only screen for the classroom wall, often a second machine with nobody signed
in. The professor makes a link for one room; the projector connects over the socket
with the link's token and is sent `projector:*` events and nothing else.

**Links.** `POST /api/session/:code/projector/links` (no body) answers 201 with
`token` (32 random bytes, base64url: 43 characters), `link` and the projector body
(below). The token is in this reply and nowhere else: only its SHA-256 is stored
(`projector_links.token_hash`), and no read returns either. A link works while it is
not revoked, its room is not closed, and for **12 hours from when it was made**
(`PROJECTOR_LINK_HOURS`; `link.expiresAt` says when it stops, and `active` is false
once it has): a link left open on a shared classroom machine would otherwise show the
room's wall for as long as the room stays open. Making one on a closed room is a 409.
`DELETE /api/session/:code/projector/links/:linkId` revokes it: its projectors get
`projector:closed` and nothing more, and the link is kept, revoked. Revoking it again
changes nothing. A link of another room is `That projector link was not found.` (404).

```json
{ "token": "<43 characters>",
  "link": { "id": "0fdda679634821cc8c6ed09a", "createdAt": "2026-11-19T00:00:51.776Z", "createdBy": null,
    "expiresAt": "2026-11-19T12:00:51.776Z", "revokedAt": null, "revokedBy": null, "active": true },
  "...": "the projector body" }
```

**The projector's socket.** It sends `projector:watch` `{ token }`. A token that is
malformed, unknown, revoked or past its 12 hours, or whose room was deleted, gets
`projector:refused` with one sentence for all of them (`That projector link does not
work: it may have been turned off. Ask your professor for a new one.`), so a token
cannot be probed; a closed room's, `That room is closed, so its projector link no
longer works.` Accepted, it gets `projector:state` at once and whenever the screen
changes. When the room closes or is deleted, or its link is revoked, it gets
`projector:closed` `{ code, reason }` and nothing after; a projector whose link runs
out while it watches gets `projector:closed` (`This projector link no longer works: a
link works for 12 hours. ...`) at the next change of screen, instead of that change.
A connection is a projector or a phone / teacher's screen, decided by the first of
`projector:watch`, `student:*` or `teacher:watch` it sends, at once and for good: a
connection that has asked to watch as a projector has every `student:*` and
`teacher:watch` ignored, and one that has sent any of those is refused as a projector
(`This connection is already a phone or a teacher's screen. ...`). The decision is
made before either handler reads the store, so one connection sending `student:join`
and `projector:watch` together is one or the other, never both (before the Phase 3
review it could become both).

**What the professor controls**, `PATCH /api/session/:code/projector`, any of:

| Field | Values |
|---|---|
| `mode` | `question`, `diagram`, `progress` |
| `question` | `{ "questionId" }` of a question the room serves, `{ "tallyId" }` of a question asked aloud in the room, or `null`. A new question goes up unrevealed |
| `revealed` | `true` puts the key up; `false` takes it down. A bank question's key, or that of a question asked aloud from the bank (a tally with a `questionId`), goes up **only in a Teacher-led room**: elsewhere it is a 409 and nothing changes (below) |
| `diagram` | `{ "questionId" }` of a question the room serves that carries a stimulus (an image or a passage), or `null` |
| `showNames` | `false`: the pick shows its roll number alone. Default `true` (the handoff's) for a room opened since the server last started; `false` for one opened before it (below) |
| `pick` | `null` takes the pick down; `{ "pickId" }` puts one of the room's picks up |

Each is checked against the room (400 otherwise); an empty body is a 400; a closed room
is a 409. **A key the room's phones could still be served** is a 409: in a
Student-devices, Mixed or waiting room a phone that has not answered a bank question
yet may still be served it, and the wall would have shown the class its answer
(`That key cannot go on the wall: this room's phones may still be served this
question, ... A bank question's key is revealed on the projector only in a Teacher-led
room; nothing was changed.`). A question the professor typed in as a tally (no
`questionId`) is no bank question and its key may go up in any room. A draw on the
wheel puts its pick up by itself. `GET` and `PATCH` answer the
projector body: the screen as set (ids), exactly what a projector is sent for it now
(`shows`, through the same whitelist), how many projectors are watching, the links (never
a token) and `rule`, the sentence saying what a wall may show.

```json
{ "room": { "code": "NE6T3F", "title": "Trees and traversals", "status": "open" },
  "modes": ["question", "diagram", "progress"],
  "screen": { "mode": "question", "question": { "source": "bank", "id": "0930d30c193a8d9f889cc6a1" }, "revealed": true,
    "diagram": null, "pickId": null, "showNames": true },
  "shows": { "...": "the projector:state below" },
  "watching": 1, "links": [{ "id": "0fdda679634821cc8c6ed09a", "active": true, "...": "..." }],
  "rule": "The projector shows the question (its key only once you reveal it, and a bank question's key only in a Teacher-led room, where no phone can still be served it), a diagram, counts for the class (per level only once 5 students have answered), and the wheel's pick as a roll number and first name. Never a score, accuracy, band, observation or any other name. A projector link works for 12 hours from when it is made." }
```

**`projector:state`**, the whole screen every time. Only the current mode's object is
filled; `pick` in any mode (the revealed bank key below is a Teacher-led room's):

```json
{ "code": "NE6T3F", "title": "Trees and traversals", "status": "open", "mode": "question",
  "question": { "source": "bank", "text": "Which traversal visits the root first? (0)", "kind": "mcq",
    "options": [{ "key": "A", "label": "Inorder" }, { "key": "B", "label": "Preorder" },
      { "key": "C", "label": "Postorder" }, { "key": "D", "label": "Level-order" }],
    "stimulus": null, "revealed": true, "correct": ["B"] },
  "diagram": null, "progress": null, "pick": null }
```

```json
{ "mode": "diagram", "question": null,
  "diagram": { "stimulus": { "kind": "image", "url": "/api/media/278c246a141417933bab55f4", "alt": "A binary tree with seven nodes" } },
  "...": "..." }
```

```json
{ "mode": "progress",
  "progress": { "present": 3, "classSize": 3, "answered": 1, "levels": null, "minAnswered": 5 },
  "pick": { "rollNo": "21CS02", "firstName": "Bilal" }, "...": "..." }
{ "mode": "progress",
  "progress": { "present": 6, "classSize": null, "answered": 5, "minAnswered": 5,
    "levels": [{ "level": "remember", "label": "Remember", "answers": 0 }, { "level": "understand", "label": "Understand", "answers": 5 },
      { "level": "apply", "label": "Apply", "answers": 0 }, "..."] }, "...": "..." }
```

- **question**: a question of the room's set, through `forStudent()` (the one place
  that decides what a student may see), with `options` for the kinds whose options
  are a plain list (mcq, multi, poll, true/false); any other kind goes up as its stem.
  `correct` is `null` until revealed, then the options' letters (mcq, multi,
  true/false; `null` for kinds without options). A question asked aloud
  (`source: "tally"`) goes up with its text and A to D, never its hands, and its
  correct option once revealed if the tally has one. The stimulus is the picture
  and its description or the passage, never the professor's citation.
- **diagram**: a stimulus of a question the room serves. An uploaded image loads on
  the projector with no credential under the image rule, which now counts a waiting
  room as running too (`servedToPhones` in `services/media.js`): from the moment the
  room opens until it closes.
- **progress**: answers given at each level (graded; polls left out), how many
  students have answered at all, and how many are present: attendance (present or
  late) of the roster in a class room, the phones joined otherwise (`classSize`
  null). Counts only: never a person, a score, an accuracy or a band. **`levels` is
  `null` until `minAnswered` (5) students have answered**: with one or two phones
  answering, the counts per level are those students' own answers (and, over time,
  which levels they are held to), shown to the whole class. `present` and `answered`
  are always shown. Pushed again after every join and answer while on this screen.
- **pick**: the wheel's latest pick, as a roll number and a first name
  (`pickForProjector`), or the roll number alone with `showNames: false`.

**The whitelist.** Every projector payload is built field by field and then passed
through `toProjector()` (`services/projector.js`), which drops any key its whitelist
(`PROJECTOR_FIELDS`) does not name, at every depth: `projector:state` may carry
`code, title, status, mode, question, diagram, progress, pick`; `question` its
`source, text, kind, options, stimulus, revealed, correct`; an option `key, label`; a
stimulus `kind, url, alt, text`; `diagram` its `stimulus`; `progress` its `present,
classSize, answered, levels, minAnswered`, each level `level, label, answers`; `pick` its `rollNo,
firstName`; `projector:closed` `code, reason`; `projector:refused` `reason`.
`modes.mjs` walks every event every projector received in a whole run against its own
copy of this list, and fails on any other key, a surname, a first name outside the
current pick's, an observation, a score, accuracy or band, or a key before the reveal;
a deliberate leak (a name on the pick and an early key) was put into the server to
check the walk fails, and it did.

**Where the screen lives.** What the projector shows is kept in the server's memory,
like the live loop's presence map. After a restart a projector that reconnects shows an
empty question screen until the professor picks again; links are in the store and keep
working (for their 12 hours). The names toggle is forgotten with the rest, so for a
room opened before the restart it reads **off** (`screen.showNames: false` in `GET
/projector`) until the professor turns it on: the next draw puts up the roll number
alone, never a first name the professor had turned off. A room opened since the
restart starts with names on, the handoff's default.

---

## Phase 3: live insights, the student card and class analytics

Written 19 November 2026 from `server/src/services/insights.js`,
`server/src/services/classAnalytics.js`, `server/src/routes/insights.js` and the one
route added to `server/src/routes/classes.js`. No migration: everything here is read
from what is already stored (profiles, answers, attendance, records, insight actions).
Exercised by `server/scripts/insights.mjs` (65 checks) with real phones, a teacher
screen and a projector, and signed-in callers as `roster.mjs` does, on the in-process
store; the examples below are real responses (shared key, so `actedBy` is null),
shortened. Not run against Supabase, Mongo or a real Auth token. No screen uses any of
it yet.

| Method + path / event | Who | What |
|---|---|---|
| `GET /api/session/:code/insights` | read rule | Bands, sort orders, the three insight cards, KPI tiles with their change since the start, the series, and a Mixed or Teacher-led room's teacher records |
| `teacher:insights` | teacher screens | The same body, pushed (above) |
| `GET /api/session/:code/students/:roll/card` | read rule | One student's card |
| `GET /api/classes/:id/analytics?last=4\|8` | read rule on the class | The class across its last 4 (default) or 8 rooms |
| `POST /api/session/:code/insights/actions` (changed) | owner | Unchanged in shape; a dismissal is recorded against a card's `flagId`, and teacher screens are pushed fresh insights |

**Who.** `requireTeacher` on every route: a student token is 403, no credentials 401.
Inside, `ownership.js`: the read rule, so an HOD reads the department's; the room
routes answer `That room was not found.` (404) for a room the caller may not read,
word for word as for one that does not exist, and the class route `That class was not
found.` likewise, checked before `?last=` so an outsider learns nothing from a 400. A
roll number neither joined to the room nor on its class's roster is `That student was
not found.` (404).

**Staff-only.** None of it is sent to a phone (no event to `session:<code>`, nothing in
`GET /api/session/:code`, nothing added to `buildGridRow`, which also feeds the phone),
or to the projector (no event to `projector:<code>`; `toProjector()` would drop it
anyway). Every body carries `privacy`. Each card's text says what the answers show and
never predicts. No leaderboard: students are listed for the professor in three orders,
never ranked on any screen a student sees.

### Bands

Each student's accuracy band in this room, from their graded digital answers (the
profile's counted tallies: a professor's reviews in, redemption's set-asides out, polls
never):

| Band | `id` | From |
|---|---|---|
| Needs support | `needs-support` | below 0.4 overall: the engine's own below-40% band, so these are exactly the students it serves Remember and Understand only |
| Developing | `developing` | 0.4 up to 0.6 |
| Excelling | `excelling` | 0.6 or more |
| (none) | `null` | fewer than 3 graded answers: "not enough answers yet" |

The cut points and the floor come with every read as `thresholds`
(`{ "needsSupportBelow": 0.4, "excellingFrom": 0.6, "minAnswers": 3 }`) and each band's
note as `bands`. Exactly 40% is Developing and exactly 60% Excelling.

### `GET /api/session/:code/insights`

```json
{ "room": { "code": "K5ARGW", "title": "Trees, period 3", "status": "open", "startedAt": "...", "classId": "7922...", "mode": "mixed" },
  "thresholds": { "needsSupportBelow": 0.4, "excellingFrom": 0.6, "minAnswers": 3 },
  "bands": [ { "id": "needs-support", "label": "Needs support", "note": "Below 40% overall: the engine serves Remember and Understand questions only." }, "..." ],
  "students": [
    { "rollNo": "21CS02", "name": "21CS02", "rosterName": "Bilal Khan", "present": true, "workingLevel": "understand",
      "answers": 5, "correct": 2, "accuracy": 0.4, "band": "developing", "bandLabel": "Developing",
      "reason": "2 of 5 graded answers right (40%): Developing.", "answered": 5 }, "..." ],
  "counts": { "needs-support": 1, "developing": 1, "excelling": 1, "notEnough": 0, "students": 3 },
  "sort": {
    "keys": [ { "id": "band", "label": "By band", "rule": "..." }, { "id": "lowest", "label": "Lowest first", "rule": "..." },
              { "id": "roll", "label": "Roll", "rule": "Roll-number order, numerically." } ],
    "orders": { "band": ["21CS03", "21CS02", "21CS01"], "lowest": ["21CS03", "21CS02", "21CS01"], "roll": ["21CS01", "21CS02", "21CS03"] } },
  "cards": [
    { "kind": "focus", "title": "Focus", "flagId": "focus:understand",
      "text": "2 students are working at Understand, the most at any level. 5 of the 11 Understand answers in this room were right.",
      "evidence": "Working levels of students with at least one graded answer; graded answers in this room.",
      "action": { "label": "Ask Understand", "do": "ask", "level": "understand" },
      "figures": { "level": "understand", "students": 2, "answers": 11, "correct": 5 }, "dismissed": false, "lastAction": null },
    { "kind": "support", "title": "Support", "flagId": "support:fe76c26d8957b79f",
      "text": "1 student is below 40% overall, 1 more than at the start.",
      "evidence": "Overall accuracy from at least 3 graded answers each; \"the start\" is the first count in this room.",
      "action": { "label": "Show them", "do": "sort", "sort": "lowest" },
      "figures": { "now": 1, "start": 0, "change": 1, "banded": 3 },
      "dismissed": true, "lastAction": { "action": "dismissed", "note": "Talked to Chitra after class", "actedAt": "...", "actedBy": null } },
    { "kind": "participation", "title": "Participation", "flagId": "participation:f2e469ca53bd1431",
      "text": "1 present student has not answered yet in this room.", "evidence": "4 present · room K5ARGW",
      "action": { "label": "Spin the wheel", "do": "wheel" },
      "figures": { "present": 4, "answered": 3, "notAnswered": 1 }, "dismissed": false, "lastAction": null } ],
  "kpis": {
    "accuracy": { "label": "Class accuracy", "value": 0.4667, "answers": 13, "students": 3,
                  "start": { "value": 1, "at": "...", "answers": 1, "students": 1 }, "change": -0.5333 },
    "support": { "label": "Needs support", "value": 1, "banded": 3, "start": { "value": 0, "at": "...", "students": 1 }, "change": 1 },
    "participation": { "label": "Participation", "value": 0.75, "answered": 3, "present": 4,
                       "start": { "value": 0, "at": "...", "present": 4 }, "change": 0.75 } },
  "series": { "since": "...", "interval": "minute", "points": [ { "at": "...", "accuracy": 0.4667, "support": 1, "participation": 0.75 } ] },
  "teacherRecords": { "label": "Teacher records", "handsRaised": { "questions": 1, "hands": 3 }, "answeredAloud": 0,
    "wheel": { "picks": 0, "answered": 0, "passed": 0, "help": 0, "skipped": 0, "absent": 0, "pending": 0 },
    "observations": { "understood": 0, "participated": 0, "revision": 0, "support": 1, "observed": 1 }, "activities": 0,
    "note": "Counted apart from the digital answers: never added to accuracy, a band or a card.", "privacy": "..." },
  "privacy": "Bands, insight cards and the student card are for staff only: never shown on a phone or the projector. They describe answers already given and predict nothing." }
```

- `students`: everyone a phone joined the room with. `name` is what the phone typed;
  `rosterName` the roster's name in a class room (null off the roster or with no
  class). `present`: attendance (present or late) in a class room, every phone in a
  room with no class. `answers` and `correct` are graded answers; `answered` counts
  every answer, polls included.
- `sort.orders`: the handoff's three orders as roll numbers. By band: Needs support,
  Developing, Excelling, then no band; lowest accuracy first within each. Lowest
  first: by accuracy, no graded answer last. Roll: numerically.
- `cards`: Focus, Support and Participation, in that order (none in a Teacher-led
  room, which carries `cardsNote` instead). Focus counts students with at least one
  graded answer by the level the ladder has them on, ties to the lower level; with no
  graded answer it is `focus:none` with no action. Support is `null`-counted ("Nobody
  has 3 graded answers yet...") until someone has a band. Participation with nobody
  present says so (`participation:nobody-present`). `figures` are the numbers in the
  text.
- **Dismissing.** `POST /api/session/:code/insights/actions` with the card's `flagId`
  and `action: "dismissed"` (or `"acted"`). A card is `dismissed` while the latest
  action on its **current** `flagId` is a dismissal; `lastAction` is that latest
  action. The id is the card's evidence: the bottleneck level for Focus, a digest of
  the roll numbers in Needs support for Support, and of the present students who have
  not answered for Participation. So a dismissed card comes back when that changes
  (another level becomes the bottleneck; a student enters or leaves Needs support; a
  present student answers for the first time, or a silent one is marked present), and
  stays dismissed while only its counts move. An `acted` after a dismissal ends it.
  Dismissed cards are still sent, marked, so a screen can offer them again.
- `kpis`: `value` now; `start` the first value it had in this server process (with
  the evidence under it); `change` = `value - start.value`, or null. Class accuracy is
  the mean of each student's accuracy (students with a graded answer), as the room
  list counts it. Support counts Needs support, null until someone has a band.
  Participation is present students who answered at least once, null with nobody
  present and in a Teacher-led room. Ratios are 0 to 1.
- `series`: per minute, each point the room as it stood at that minute's last change,
  at most 180 points. **Held in memory**: after a server restart it starts again, and
  so does every `start` (its `at` says when).
- `teacherRecords`: in a Mixed or Teacher-led room only. Hands raised (questions asked
  aloud and the hands counted), answered aloud (wheel picks marked Answered), the
  wheel's picks by response, the marks in force today by kind, activities. Never added
  to accuracy, a band or a card.

### `GET /api/session/:code/students/:roll/card`

`:roll` is the roll number, URL-encoded (it may hold a space or a `/`), matched as the
room stores it (`" 21cs02 "` is `21CS02`).

```json
{ "room": { "code": "K5ARGW", "...": "as above" },
  "student": { "rollNo": "21CS02", "name": "Bilal Khan", "display": "Bilal Khan", "studentId": "5206...",
               "onRoster": true, "joined": true, "attendance": "present" },
  "band": { "id": "developing", "label": "Developing", "accuracy": 0.4, "answers": 5, "correct": 2,
            "reason": "2 of 5 graded answers right (40%): Developing." },
  "serving": { "level": "understand", "label": "Understand", "reason": "40% at Understand over the last 5 - holding at Understand.",
               "eligible": ["remember", "understand"], "ceiling": false, "adapt": true },
  "levels": [ { "level": "understand", "label": "Understand", "answers": 5, "correct": 2, "accuracy": 0.4, "withdrawn": 0,
                "class": { "answers": 11, "correct": 5, "accuracy": 0.4545 } }, "...all six, in ladder order" ],
  "lastAnswers": { "items": [ { "answerId": "33fe...", "level": "understand", "response": 0, "correct": false, "final": true,
                                "student": { "rollNo": "21CS02", "name": "Bilal Khan", "accountId": null },
                                "snapshot": { "...": "as stored, key included" }, "...": "the answer item of /answers" } ],
                   "limit": 10, "final": true },
  "nextSet": { "planned": true, "size": 5,
               "levels": [ { "level": "understand", "label": "Understand", "count": 1, "role": "current" },
                           { "level": "remember", "label": "Remember", "count": 2, "role": "review" },
                           { "level": "apply", "label": "Apply", "count": 2, "role": "stretch" } ],
               "summary": "1 Understand · 2 Remember review · 2 Apply stretch", "onScreen": null, "empty": null,
               "note": "A plan, not a promise. ..." },
  "records": { "day": "2026-11-19", "observation": { "current": null, "history": [] }, "picks": [], "privacy": "..." },
  "thresholds": { "...": "as above" }, "privacy": "..." }
```

- `student`: the roster's name in a class room, else what the phone typed; `display`
  falls back to the roll number. A roster student with no phone in the room has a
  card: `joined: false`, a `null` band, `serving: null`, `nextSet: null`, no answers.
  `attendance` is their mark (`unmarked` when none), null in a room with no class.
- `serving`: the working level and its reason sentence, the levels the selector may
  serve now (`eligible`), and `ceiling: true` inside the below-40% band (Remember and
  Understand only, whatever the level). Null with no phone in the room.
- `levels`: accuracy at each of the six levels with the answers behind it
  (`withdrawn` is what redemption set aside), and the class's own at that level in
  this room, for a radar.
- `lastAnswers`: the last ten **final** answers, newest first, each the answer item of
  `GET /api/session/:code/answers` (the professor's view). Every attempt is there.
- `nextSet`: **a plan, not a promise**, and not the handoff's fixed "3 + 1 review + 1
  stretch". The selector is run (`selectSet`, the level held) over what the room
  serves, after the question on the student's screen (`onScreen`) and within the
  room's questions-per-student cap; `levels` are what it gave, in order of first
  appearance, each named against the working level (`current`, a lower `review`, a
  higher `stretch`). So it has a stretch only once the levels at and below the working
  level have run dry, never inside the below-40% band, nothing below Remember or
  above Create. `empty` says why there is none (the cap reached, nothing unseen left).
  Null in a Teacher-led or closed room, or with no phone.
- `records`: this room's teacher records about them: the day's observation and its
  log (in a class room the day's mark is the class's, so `room` names where each was
  set) and their wheel picks. Staff-only.

### `GET /api/classes/:id/analytics?last=4|8`

The class's newest 4 (the default) or 8 rooms by when they opened, whatever their
status, reported **oldest first**; only rooms the caller may read; rooms opened for no
class are never counted. Anything but 4 or 8 is a 400 (`last must be 4 or 8: ...`). A
class with no rooms answers 200 with empty lists.

```json
{ "class": { "id": "7922...", "courseName": "Data Structures", "section": "SY-CS A", "termLabel": "Sem III 2026" },
  "last": 4,
  "rooms": [
    { "code": "K5ARGW", "title": "Trees, period 3", "status": "open", "startedAt": "...", "closedAt": null, "mode": "mixed",
      "accuracy": { "value": 0.4667, "students": 3, "answers": 13 },
      "participation": { "value": 0.75, "present": 4, "answered": 3, "notAnswered": 1 },
      "attendance": { "present": 4, "late": 0, "absent": 0, "unmarked": 0, "classSize": 4, "summary": "4 / 4 present" },
      "bands": { "needs-support": 1, "developing": 1, "excelling": 1, "notEnough": 0 },
      "levels": [ { "level": "understand", "label": "Understand", "answers": 11, "correct": 5, "accuracy": 0.4545 }, "...six" ],
      "levelBands": [ { "id": "lower", "label": "Remember and Understand", "levels": ["remember", "understand"], "answers": 11, "correct": 5, "accuracy": 0.4545 },
                      { "id": "middle", "label": "Apply and Analyse", "...": "..." }, { "id": "higher", "label": "Evaluate and Create", "...": "..." } ] },
    { "code": "...", "...": "the second room" } ],
  "trend": { "accuracy": { "first": 0.4667, "last": 0.75, "change": 0.2833, "rooms": 2 },
             "participation": { "first": 0.75, "last": 1, "change": 0.25, "rooms": 2 } },
  "histogram": { "buckets": [ { "from": 0, "to": 10, "students": 0 }, "...ten" ],
                 "legend": [ { "band": "needs-support", "label": "Below 40%", "students": 1 }, { "band": "developing", "label": "40-60%", "students": 1 },
                             { "band": "excelling", "label": "60% and above", "students": 2 } ],
                 "students": 4, "answers": 25, "notEnough": 0 },
  "levels": [ "...six, over the window" ], "levelBands": [ "...three, over the window" ],
  "hardest": { "items": [ { "questionId": "ab11...", "text": "Which traversal visits the root first? (3)", "kind": "mcq", "bloom": "understand",
                            "topic": "Trees", "status": "active", "attempts": 6, "correct": 2, "proportionCorrect": 0.3333, "band": "hard",
                            "pointBiserial": null, "pointBiserialN": 6, "pointBiserialNote": "Fewer than 10 students ...", "flags": [], "versions": 1 } ],
               "minAttempts": 5, "answers": 25, "questions": 8, "belowFloor": 5 },
  "definitions": { "thresholds": { "...": "..." }, "accuracyBands": [ "..." ], "levelBands": [ "..." ], "display": "...", "classSize": "..." },
  "privacy": "..." }
```

- Per room: class accuracy (the mean of each student's) with the students and answers
  behind it; participation (present students who answered at least once, of those
  present); attendance against the roster **as it is now** ("N / M present", N
  counting late); the accuracy bands' counts; accuracy at each level and in decision
  6's three level bands, each with its answers. A Teacher-led room's accuracy and
  participation are null.
- `trend`: the first and last room with a value, and the change between them.
- `histogram`: each student pooled over the window's rooms by roll number (their
  graded answers in every room), in 10-point buckets, with the three accuracy bands'
  counts in `legend` (buckets 0-3, 4-5, 6-9); students under 3 graded answers are
  `notEnough`, outside the buckets. `answers` is what the buckets rest on.
- `levels`, `levelBands`: over the window. Decision 6 is open, so both come every time
  and the screen picks which to show first.
- `hardest`: the item report (`services/itemStats.js`) over the window's final graded
  answers, questions with at least `minAttempts` (5) answers only, flagged first, then
  the lowest share right; at most ten, without the option counts (those are on
  `GET /api/session/:code/items`). `questions` answered and `belowFloor` say what was
  left out.

---

## Known open issues

Phase 2, open (none is a failing test; each is a gap or a default awaiting the owner):

- **The committed console cannot approve.** Generation now writes drafts, and the
  client as committed calls neither approve, reject nor approve-all. A room on a
  freshly generated bank is a 409. The UI session's uncommitted client does call
  them (`docs/UI_REBUILD.md`, "Phase 2"; not re-checked here). Do not deploy the
  Phase 2 or Phase 3 server without that client (`docs/IMPLEMENTATION_STATUS.md`).
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

Phase 3, open:

- **A typed roll number is not proof of identity** (decision 7): a `joined` mark
  says a phone claimed the student. The attendance read carries this as `caveat`.
- **The phone's own row still carries `slowLearner` and an `integrity` summary, and
  the phone is told the band in words.** `buildGridRow` feeds `session:accepted`,
  `server:result` and `server:exhausted` (the questionsPerStudent cap's two sends
  included) as well as the teacher's grid, so these staff-only fields reach the
  student's phone; and `reason` names the band ("Overall 30% is inside the below-40%
  band - ...", `server:question`'s "Below-40% band: serving ..."), which the current
  phone shows under the question and on the level screen on purpose ("the same one
  the teacher sees on the grid"). It breaks the roadmap's rule that labels are
  staff-only, but `CONTRACT.md` sections 4 and 5 fix the phone's `profile` as the one
  `GridRow` shape with `slowLearner` in it, so a phone-only row needs a contract
  amendment, an owner decision on what a phone is told about the band, and the phone
  client's agreement. Not changed. Confirmed again by the Phase 3 review: a classmate
  who types your roll number into a room you joined is sent your row, `slowLearner`
  and integrity summary included (decision 7's gap).
- **Re-running every migration failed at 0005 once a room was `waiting`. Fixed.**
  0005 now lists `'waiting'` in `sessions_status_check` too, so a re-run never
  narrows the check below what 0018 allows. A widening only: no row can fail it. The
  migration test re-runs the whole set with a room left waiting.
  Reported by the Phase 3 review (reproduced with PGlite).
- **Deleting one room of a class rewrites that class-day's marks in its other rooms.**
  In a class room an observation is the class's mark for the student for the day, and
  every room of the class that day reads it; but the row goes with the room it was
  typed in (`observations.session_id ... on delete cascade`). Delete room A, and room
  B of the same class and day shows the mark in force before A's, and the student's
  history across days loses A's events (they survive only in A's archive). Whether a
  class room's observations should outlive the room (kept with no room, under the
  class and day) or go with it is the owner's call: keeping them means a test room's
  marks could never be removed, since observations are append-only. Reported by the
  Phase 3 review.
- **No route deletes a class**, and a roster's change history (who renamed or
  removed whom) is not logged; an attendance row keeps only its latest mark.
- **The present count costs two reads** (roster and marks) on every grid push of a
  class room, that is after every answer. Fine at class size on the in-process store;
  not measured on Supabase.
- **Teacher records reach a teacher screen live only in a Mixed or Teacher-led room**,
  as counts in the grid's `feed`. In a Student-devices room no socket event tells a
  second teacher screen that a mark, pick or tally changed (only the present count is
  pushed, after Absent on a pick); a screen reads the routes again. A draw's pick
  reaches the projector (`projector:state`).
- **The projector's screen is in memory.** A server restart leaves it on an empty
  question screen until the professor picks again, with first names off for any room
  opened before the restart (so a name the professor had turned off never comes back
  by itself). A second server process would not share it, as it would not share the
  live loop's presence map.
- **`adapt: false` cannot hold a student in the below-40% band at the start level's
  questions**: `CONTRACT.md` section 6 rule 4 (the ceiling is real) wins, so they are
  served Remember and Understand as in any room. Owner's call whether "adapt off"
  should mean something else for them.
- **A Teacher-led room still needs a chapter with at least 6 approved questions** (or
  a question set), like any room, though no phone is served from it.
- **The waiting room records no start time.** `started_at` is when the room opened;
  when it was started is not kept.
- **A record names a student, not a person.** A roster student is one row of one
  class: the same person in two classes has two rows and two separate records, as
  attendance does.
- **The day of a record is the day its room was opened** (India's time). A room left
  open past midnight writes the next day's marks under the first day.
- **The insights' series and every "since the start" are in memory.** A server
  restart starts them again; a second server process would not share them. The
  figures for now are always counted from the store.
- **"Since the start" in a fresh room compares with very little.** Each room begins
  with empty profiles, so class accuracy's start is the first graded answer (100% or
  0%) and the support count's is usually 0. `start` says how much evidence it rests on.
- **"Next set" is the selector's plan, not the handoff's 3 + 1 review + 1 stretch**,
  which the selector does not serve. Owner's call whether the selector should
  (`docs/PRODUCT_DECISIONS.md`).
- **A dismissed card comes back when its list of students changes at all**, a student
  leaving Needs support or answering for the first time included; "comes back only
  when the list grows" needs the dismissed list stored (a column). Not built.
- **Participation in a class room counts attendance**, so a phone that joined with a
  roll number off the roster is not in it; and class analytics measure every room's
  attendance against the roster as it is now.
- **A deleted room's teacher screens stay subscribed to its code.** Deleting (or
  closing) a room never takes teacher sockets out of the `teacher:<code>` channel,
  and a deleted room's code is free again (`allocateCode` checks only live rooms). If
  a new room, possibly another professor's, ever draws the same code, a teacher screen
  still open on the deleted room would be sent its `teacher:grid` and
  `teacher:insights` (roster names, attendance, bands) with no read check. Traced by
  the Phase 3 review, not reproduced: it needs a code collision (for any one deleted
  code, about 1 in 31^6 per new room). The fix is `socketsLeave` on delete and close, or channels keyed by the
  room's id. Not fixed.
- **A roster or a room's attendance over 1000 rows would be read short on
  Supabase.** `listClassStudents` and `listAttendance` in `supabaseRepo.js` ask for
  `.limit(5000)`, and their comment says that avoids PostgREST's 1000-row default; but
  PostgREST's `max-rows` caps every response whatever is asked, as the same file's
  `allRecords` says. Active students are capped at 500, but removed rows are kept for
  ever, so a class with turnover can pass 1000 rows. From then on the attendance read,
  the wheel's pool, the grid's `rosterName` and the duplicate check of a bulk add
  would read part of the roster and say nothing. Traced, not run (no Supabase). The
  fix is to page these reads as `allRecords` does. Not fixed.
- **A tally's increment and decrement push nothing.** The grid's `feed` counts
  tallies, not hands, so it is right; but `teacher:insights`' `handsRaised` and a
  second teacher screen's view of the counts catch up only at the next grid push or
  read.

Reported by the Phase 3 review, now fixed (each with a check that failed before the
fix, in `server/test/` or `server/scripts/modes.mjs` / `records.mjs`):

- **A bank question's key on the projector** could be revealed in a room whose phones
  could still be served that question; now only in a Teacher-led room (409 otherwise).
- **The projector's progress screen** showed one student's own answers per level when
  only one had answered; per-level counts now wait for 5 students.
- **One connection could be a phone and a projector at once** by sending both events
  together; the first ask now decides, before any await.
- **Grid, pause, resume, close, delete and integrity** answered a missing code and
  another professor's room with different 404 sentences; now one.
- **Free text beside the notes** (a flag id, a tally's text and labels, a group's label,
  a class's course, section and term) took email addresses and phone numbers; a flag id
  took any text; a roster name took a short date of birth (`12-5-04`). All refused now.
- **The names toggle** came back on after a restart; now off for an older room.
- **Projector links never expired** while their room was open; now 12 hours.
- **Start racing close** wrote a closed room back to open; **two starts** both
  succeeded and served each waiting phone twice. Now one status change at a time.
- **A room opened for no class archived with `classId: null`**; now no key, as before.
- **"Everyone who joined" in a Teacher-led room** marked the whole class absent; now 409.

Reported by the Phase 1 review, now fixed:

- **A 24-character hex id on Supabase** (`/api/review/:answerId`, `/api/session/archives/:id`) used to be a 500; it is now a 404.
- **`offset` is capped** at 100,000 on `GET /api/session/:code/answers` and `GET /api/analytics/:id/answers`; beyond it, 400.

Fixed on 19 November 2026: the Supabase repo answers a non-uuid id with "not found" (`isUuid` guard on every single-row read), and `offset` is capped at 100,000 (`MAX_OFFSET` in `services/evidence.js`, a 400 beyond it; unit-tested). The id guard is traced, not run against Supabase.
