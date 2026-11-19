# API reference: Phases 1 to 7

**Batch 9** (20 Nov 2026; `0037`, `0038`) is one part, "Batch 9: the hub during a class,
written and drawn answers, exam mode", just before "Known open issues": the hub closing
a running room's whole set, short and long written answers, whiteboard answers, exam
mode (its routes, phone and staff events, Safe Exam Browser, screen pictures and the
collusion check), and what each screen needs. Batch 8 sits just before it.

**Phase 7** (committed as `46bf6f9`; `0030` to `0032`) is one part, "Phase 7:
offline-first", just before "Known open issues": an index of every new and changed
endpoint and socket event, question packs, which reply to an outbox answer means what,
delivering to a closed room and the grace window, laptop mode, room imports, replay keys
and `basedOn` on the console's record writes, captured examples, and what each screen
needs. Its open issues are under "Known open issues", "Phase 7 (offline-first), open".

**Phase 6** (committed as `646b4e6`; `0025` to `0029`) is one part, "Phase 6: the
Learning Hub", just before "Known open issues": who may call the hub, every new
endpoint under `/api/hub` grouped by piece (the backbone, practice, Get Ready and
self-tests, lessons, languages, the tutor), the additive `question.rich` on the room
phone's questions, captured examples, and what each screen needs. Its open issues are
listed under "Known open issues", "Phase 6 (the Learning Hub), open".

**Phase 5** (uncommitted; `0023`, `0024`) opens with one index of every new and
changed endpoint and socket event, "Phase 5: every new and changed endpoint and socket
event", which also lists what the review fixes of 19 November 2026 changed. Its three
parts follow, each with what the phone, the console and the projector need: "Phase 5:
confidence taps and class questions" (the confidence tap, and class questions with a
pause, a discussion and a re-vote), "Phase 5: misconception labels on wrong options",
and "Phase 5: honest indicators". All four come just before "Known open issues".

**19 November 2026.** The owner's decisions of that day changed some endpoints and
socket fields: they are listed in one place, "The owner's decisions of 19 Nov 2026",
just before Phase 5, and the sections below that they made untrue were corrected in
place. `CONTRACT.md` records the contract side (Amendments 3 to 5).

Phase 4 (course outcomes, their mappings and coverage, the roster from a CSV file,
configurable attainment, the marks register, CSV exports and printable reports;
uncommitted) is its own part, before "Known open issues", and opens with an index of
every Phase 4 endpoint ("Phase 4: every new and changed endpoint"). Every HTTP
endpoint and socket field added or changed in Phase 1 (the evidence store,
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
(`05daf56`), Phase 2 (`27559ca`), Phase 3 (`d162cc8`) and Phase 4 (`eedfd5e`) too;
the owner's decisions and Phase 5 are not. The examples are real responses,
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
database or Mongo was used for them either. Phase 4 is exercised the same way by
`outcomes.mjs`, `attainment.mjs` and `acceptance4.mjs` (the directive's acceptance
criterion end to end). All three passed after the fixes from the Phase 4 review
(19 November 2026, offline runner; `docs/TESTING.md`, "Full rerun after Phase 4").

Which screens call what is the UI session's to say (`docs/UI_REBUILD.md`): it reports
Phase 1 screens (the review queue, a room's answers and topics, a student's answers)
in the Phase 2 commit, and Phase 2 screens (approval, the four kinds' editors, images,
item statistics, question sets) in its uncommitted work. Neither was re-checked for
this file. The UI session's uncommitted client now calls the Phase 3 class routes
(`client/src/lib/api.js`: classes, the roster, a student's observations, class
analytics); not re-checked beyond a search. It now calls the Phase 4 routes too
(`client/src/lib/api.js`: the outcomes, the import, the formula, the three reports,
and their files fetched with the sign-in header and opened from a blob). Those
screens were not checked for this file, and `docs/UI_REBUILD.md` does not describe
them yet. The room archive routes are used by `/rooms`.

## Conventions

**Credentials.** One of:
- `Authorization: Bearer <Supabase access token>` for an HOD, professor or student
  account. Accounts need Supabase.
- `x-teacher-key: <TEACHER_KEY>` (or `?key=`) for the shared teacher key. It acts as
  a professor with no account, and reaches only rooms nobody owns. Since the Phase 4
  review a sheet or a printable page (`?format=csv` or `html`) asked for with `?key=`
  is a 400: send the header.

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
- **`detail` on the teacher view** (confirmed 19 Nov 2026; it has been there since
  Phase 1): every teacher item carries `detail`, so an answer kept and not counted
  (Phase 7) can be marked here as on the room's answer list: `final: false`, `correct`
  and `score` null, the machine's reading in `auto`, and `detail` ending "kept, not
  counted." (the three values are under "What staff see" in Phase 7). The student view
  never carries `detail`, `auto` or `snapshot` (`server/test/evidence.test.js`).
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

A class room's archive (Phase 3) also holds its attendance marks, each with the roll
number and name its roster row held when the room was deleted. Since `0021` (Phase 4
review) each mark also carries `markedRollNo`: the roll number the mark itself was
made under (below, "Phase 4: every new and changed endpoint"). It is null for a mark
made before `0021`, and an older archive decodes with null. The format version is
unchanged.

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

### `GET /api/bank/question/:id` (new, 19 Nov 2026): one question

One question of a bank, read on its own, so a screen elsewhere can link to it: an error
log entry's `questionId`, a lesson's retrieval question, a row of item statistics. Any
status: a draft or a discarded question is read too. The bank's own rule, since the
question carries its answer key: the owner reads, with `canEdit: true`; the department's
HOD reads, with `canEdit: false`; another professor, the shared key on a chapter someone
owns, a malformed id and an id that does not exist all get 404 `That question was not
found.`, word for word. A student gets the bank's 403. The question is in the bank
list's staff shape (`provenance`, `levelCheck`). Shape, from
`server/test/bankQuestion.test.js` (not captured from a running server):

```json
{ "question": { "_id": "…", "text": "What splits bits?", "kind": "mcq", "options": ["framing", "routing", "naming", "paging"], "answerIdx": 0,
                "status": "active", "source": "teacher", "provenance": { "source": "professor", "…": "…" },
                "levelCheck": { "uncertain": false, "reasons": [], "sentence": null }, "…": "as the bank lists it" },
  "content": { "_id": "…", "title": "Layers" },
  "canEdit": true }
```

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
`createdBy` the account (null on the shared key), `source: 'teacher'` (since 19 Nov
2026, `0022`; it was `'fallback'`, and questions written before then keep it; see
`PRODUCT_DECISIONS.md`). 201:

```json
{ "question": { "status": "active", "model": null, "sourceRef": null, "createdBy": null, "source": "teacher", "...": "..." },
  "failedChecks": [ { "id": "all-none-of-the-above", "message": "option 3 (\"All of the above.\") refers to the other options. ..." } ] }
```

**Line breaks in `text` (19 Nov 2026).** A question's `text` keeps its lines, here and
in every edit (`PATCH /api/bank/question/:id`, split, merge, a bulk retag): a fenced
code block or a passage set out in paragraphs is stored as written, so its `rich` and
`textHtml` render the code. Only Windows line ends (stored as `\n`), spaces and tabs at
the end of a line, and blank lines before and after the text are tidied; spaces inside
a line are kept. Every other text field (options, pairs, groups, items, rubric points
and the rest) is still collapsed to single spaces. Before, the whole text was run onto
one line, so a fence came back as raw backticks and `rich` was `{}`. Splitting a stem of
several lines puts "(part 1)" and "(part 2)" on a line of their own, since on a code
block's closing fence they would stop it closing; a merge takes them off as before.
Questions saved before the change keep the one line they were stored as.

### `POST /api/bank/question/:id/regenerate` (changed): Harder / Easier

Body (optional): `{ "direction": "harder" }` or `{ "direction": "easier" }`.

- **No direction**: a replacement at the same level, as a **draft**. Since 19 Nov
  2026 (the owner's delegation), regenerating an **active** question leaves it
  active and serving: the draft carries `replacesId` (the old question's id, `0022`),
  and the reply adds `replaces` (the same id) and a `note` ("The question this
  replaces stays in rooms until you approve its replacement. ..."). Approving the
  draft by any route retires the old question (set discarded; the reply's
  `retired`); rejecting it leaves the old one as it is. A draft or rejected question
  being regenerated is discarded at once, as before, with no link. Before 19 Nov 2026
  the old question was discarded at once and the reply carried `warnings` saying it
  had left rooms; there is no `warnings` key now.
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
present" and any `projector:*` event. **Since 19 Nov 2026** (decision (a)) the
phone's `profile` is no longer the teacher's grid row: it is `PhoneRow`, with no
`slowLearner`, `integrity` or `reason`, and a neutral `next`; the `reason` of
`server:question` and `server:result` is the phone's own sentence and never names a
band (the captures above predate it; "The owner's decisions of 19 Nov 2026" below).

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
  "message": "Removed from the roster. Nothing they did is deleted: their answers in every room, their attendance and their records stay, and they can be put back on the roster at any time." }
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
- `caveat`: a typed roll number is not proof of identity, sent with the data so no
  screen can show "joined" without it. Decision 7 (19 Nov 2026) keeps attendance this
  way: a phone's sign-in links the room to the student's history, not to their
  attendance.

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

Since `0021` (Phase 4 review) each mark also stores the roll number it was made
under: the one the student's mark in this room already carries, else their roll
number on the roster now. A join stores the roll number the phone joined with, in the
roster's form. Neither reply shows it; the attainment reports and the register use
it ("Phase 4: every new and changed endpoint", "Whose answers they are").
`fromJoins` still decides who joined by each student's roll number on the roster
now (an open issue below).

### What a join does in a class room

When a phone joins a room opened for a class (`student:join`, unchanged in shape), a
roll number on the roster marks that student present with `source: "joined"`, unless
the student already has a mark; a rejoin adds nothing. A roll number not on the
roster joins exactly as before. The phone is told nothing of it. A failure to record
the mark is logged and never stops the join. The roll number is typed, not proven,
so a classmate's phone can mark someone present; decision 7 (19 Nov 2026) keeps it
`joined`, with the caveat. A signed-in phone's token links the room profile to the
student's account, not their attendance.

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

## Phase 4: every new and changed endpoint

Phase 4 is the owner's "Course outcome attainment and institutional reporting", with
the roadmap's step 4 ("roster import from CSV"). This is an index. Each row points at
the Phase 4 part below that gives the full shapes. Written 19 November 2026 from the
working tree, which is uncommitted, and revised after the fixes from the Phase 4
review ("The fixes from the Phase 4 review", below).

**New** routes did not exist before Phase 4. **Changed** ones keep their old shape.

**Nothing a phone or the projector receives is new or changed.** Phase 4 is HTTP
reads and writes about a class, for staff only, and adds no socket event and no room
route. These are exactly what Phase 3 made them:
- the phones' `GET /api/session/:code`;
- every `student:*`, `server:*`, `teacher:*` and `projector:*` event.

`outcomes.mjs`, `attainment.mjs` and `acceptance4.mjs` keep every phone payload of
their runs, and `acceptance4.mjs` the projector's too, and search them.

**Two Phase 3 stores gain one field each** (`0021`, from the review), and no phone sees
either:
- **An attendance mark keeps the roll number it was made under**
  (`attendance.roll_no`). A join stores the roll number the phone joined with, in the
  roster's form. A professor's mark (`POST /api/session/:code/attendance`, or a wheel
  pick set to Absent) stores the student's roll number on the roster at that moment,
  unless the mark it replaces already carries one, which is kept. A mark made before
  `0021` has none. No reply shows it: `GET /api/session/:code/attendance` is unchanged.
- **A deleted class room's archive**: each attendance row gains `markedRollNo`, that
  roll number (null for a mark from before `0021`, and in an older archive). The
  format version is unchanged. The archive gains nothing about outcomes or formulas:
  no answer stores an outcome, and a class's outcomes and formula outlive its rooms
  (`services/archive.js` says why).

**Who**, in the tables below, as for Phase 3:
- **read rule**: `assertCanRead` through `readableClass`. The owner, or an HOD of the
  owner's department; the shared key reaches a class nobody owns. Anyone else, and an
  id that names nothing, gets `That class was not found.` word for word.
- **owner**: `writableClass`. An HOD who may read the class gets 403 and nothing
  changes; anyone else gets the same 404.
- Every route is behind `requireTeacher`, at `/api/classes` or `/api/attainment`: a
  student account is 403, and no credentials is 401.

| Route | | Who | What | Part |
|---|---|---|---|---|
| `POST /api/classes/:id/students/import` | **new** | owner (a dry run too) | A roster from a CSV file (`text/csv`, or JSON `{ csv }`), at most 1 MB and 2,000 rows; `?dryRun=true` writes nothing and says what it would do | Course outcomes, their mappings, and the roster from CSV |
| `POST /api/classes/:id/students` | changed (inside only) | owner | Now adds through `addToRoster`, the import's own path. The reply is exactly as before (`refused` rows `{ index, roll, name, reason }`, no `code`) | same |
| `GET /api/classes/:id/outcomes` | **new** | read rule | The class's course outcomes in order, archived ones after and marked, each with its topics; every per-question override; `canEdit`, `limits`. `?format=csv`: the outcome list with its mappings | same; CSV exports |
| `POST /api/classes/:id/outcomes` | **new** | owner | Create one: `{ code, statement, targetLevel? }` (201) | same |
| `PATCH /api/classes/:id/outcomes/:outcomeId` | **new** | owner | Edit `code`, `statement`, `targetLevel`; `{ "archived": false }` restores, and is a 409 while 50 outcomes are in use | same |
| `POST /api/classes/:id/outcomes/reorder` | **new** | owner | `{ ids }`: every outcome in use, in the new order | same |
| `DELETE /api/classes/:id/outcomes/:outcomeId` | **new** | owner | Archives an outcome any counted answer reaches; deletes one no answer reaches | same |
| `PUT /api/classes/:id/outcomes/:outcomeId/topics` | **new** | owner | `{ topics: [{ contentId, topic, weight? }] }`, the outcome's whole set | same |
| `PUT /api/classes/:id/outcomes/questions/:questionId` | **new** | owner | `{ outcomeIds }` (in place of its topic's) or `{ exclude: true }` for one question in this class | same |
| `DELETE /api/classes/:id/outcomes/questions/:questionId` | **new** | owner | Remove that override: the question follows its topic again | same |
| `POST /api/classes/:id/outcomes/copy` | **new** | owner here; read rule on the other | `{ fromClassId }`: copy its outcomes, mappings and overrides as new rows | same |
| `GET /api/classes/:id/outcomes/coverage` | **new** | read rule | Approved questions and counted answers per outcome and topic; what reaches no outcome; mapped + excluded + unmapped = counted | same |
| `GET /api/attainment/presets` | **new** | any teacher | The example formulas, each with its methodology; field and state definitions | Configurable attainment |
| `GET /api/classes/:id/attainment/config` | **new** | read rule | The formula in force (`source: example` or `saved`), its version and methodology | same |
| `PUT /api/classes/:id/attainment/config` | **new** | owner | Save a formula as the next version: `{ preset }`, `{ config }` or both | same |
| `GET /api/classes/:id/attainment` | **new** | read rule | Course-outcome and Bloom attainment, per student and for the class. `?from=&to=&rooms=`. `?format=csv` gives the course-outcome sheet (`&sheet=bloom` the Bloom sheet); `?format=html` the printable report | Configurable attainment; CSV exports |
| `GET /api/classes/:id/attainment/students/:studentId` | **new** | read rule | One roster student (active or removed), with every answer behind each figure. The same query; `?format=html` | same |
| `GET /api/classes/:id/register` | **new** | read rule | The marks register: students by rooms, marks by evidence type, the attendance mark, a total. The same query; `?format=csv`, `?format=html` | same |
| `POST /api/session/:code/attendance`, a wheel pick set to Absent, a join | changed (inside only) | as in Phase 3 | Each mark also stores the roll number it was made under (`0021`). Replies unchanged | Phase 3: classes, rosters and attendance |
| `GET /api/session/archives/:id` | changed | read rule | A class room's attendance rows gain `markedRollNo` | Deleted rooms |

**The reports' query.**

| Parameter | Rule | Wrong |
|---|---|---|
| `from`, `to` | `YYYY-MM-DD`: rooms opened on or after `from` and on or before `to`, by the day each room opened in India's time | 400 |
| `rooms` | Comma-separated codes of the class's rooms the caller may read | 400 for a code that is not one |
| `format` | `json` (the default), plus `csv` and/or `html` where the table above lists them | 400, read after the class's 404 |
| `sheet` | `outcomes` (the default) or `bloom`; only with `format=csv` on `/attainment` | 400, read after the class's 404 |
| `key` | The shared teacher key in the address. With `format=json` (or none) it works as on any teacher route. With `format=csv` or `html`, on all four file routes (`/outcomes?format=csv` included), it is refused, so a key is never printed on a page or saved with a download: `A printable page or a sheet cannot be opened with the teacher key in its address: the browser prints the address on the page and keeps it in its history, and a sheet's address is saved with the download. Send the key in the x-teacher-key header instead.` | 400, read after the class's 404 |

Rooms are counted oldest first. **Only rooms opened for the class are counted**
(`sessions.class_id`): a room opened without choosing the class is not, whoever
answered in it. A deleted room is never counted; its answers are in its archive.

**Status codes** on the Phase 4 routes:

| Status | When |
|---|---|
| 400 | A bad field, body, date, room code, `format` or `sheet`; `?key=` with a file format; a formula that fails the check (nothing saved); a CSV with no roll number and name header, more than 2,000 rows or an unclosed quote |
| 401 | No credentials |
| 403 | A student account; an HOD's write (the dry-run import and a formula save included) |
| 404 | `That class was not found.` for a class the caller may not read, word for word as for none; likewise a student, an outcome, a chapter or a question the caller may not read |
| 409 | A code already in use in the class; a 51st outcome in use, by creating, restoring or copying; an archived outcome edited or remapped; a copy whose codes clash, or from a class with none; a formula save racing another for the version number |
| 413 | A CSV import over 1 MB |
| 500 | `0019` or `0020` not applied on Supabase: the route names the missing table (the boot probe does not check them) |

**Every report carries:**
- the formula it used, its version and `source`;
- the `methodology` paragraph generated from that formula;
- `evidenceTypes`, `questionSources` and `definitions`;
- `rollNotes` (the class report and the register; below);
- `privacy`, which says that attainment, marks and every report here are staff-only.

**Students** come in roll-number order:
1. the roster;
2. removed students with evidence;
3. roll numbers with evidence that no roster row holds. Each such row carries
   `note`, the sentence of its `rollNotes` entry.

They are never ranked or numbered by any mark. **States** describe evidence:
`attained`, `not-attained`, `not-enough-evidence`.

### Whose answers they are (`0021`)

A room's answers carry the roll number typed into the phone; an attendance mark names
the roster row and, since `0021`, the roll number it was made under. A report
(`rollResolver` in `services/attainment.js`) gives an answer to the roster student
whose mark **in that room** was made under the roll number the answer was given
under, and files it under that student's roll number now. Any other answer, and every
answer in a room whose marks carry no roll number (made before `0021`), is matched to
the roster as it stands now. Nothing is inferred: a roll number two marks of one room
carry is tied to neither.

So a professor who corrects a roll number on the roster
(`PATCH /api/classes/:id/students/:studentId`) keeps the student's earlier answers in
their row, in every figure and in the register. In the student report each such
answer carries `givenAs` (the roll number it was given under, only when it differs)
and its `note` ends "Given under roll number 21CS03, which this room's attendance
mark for the student was made under."

`rollNotes` names every roll number listed off the roster: which rooms its answers
are in, and, where a room's mark was made under it for a roster student whose roll
number has changed since, who that is (captured, the acceptance run's visitor):

```json
"rollNotes": [ { "rollNo": "VISIT9", "rooms": ["6Z4HVA"], "tiedTo": [],
                 "note": "VISIT9 is not on the class roster, so its answers in 6Z4HVA are listed apart and counted in no class figure." } ]
```

A tie is `tiedTo: [{ studentId, rollNo, name, rooms }]`, and the note adds "The
attendance mark in <rooms> was made under it for <name> (now <roll>); answers under it
are theirs only in a room whose mark carries it."

### The evidence types every figure is split by

Read off the answer row as Phase 1 writes it (`evidenceTypeOf` in
`services/attainment.js`). Every class figure, student cell and register cell gives
each type's answers, marks obtained and marks possible, and says whether this
formula counts it:

| Type | The answer row | Counted by the default example |
|---|---|---|
| `digital` | `review_status` `auto` (or none, its default): an objective answer marked by the server from the stored key | yes |
| `aiProvisional` | `provisional`: a written answer marked by the keyword marker, which matches the rubric's words in the answer, and not reviewed by a professor. Labelled **"Provisional machine marks"**: no model marks answers, so it is not AI. The key keeps its stored name because saved formulas use it | **no**: shown, not counted |
| `humanReviewed` | `confirmed` or `overridden`: the professor's mark | yes |
| `ungraded` | the row's `ungraded` flag: a poll | never: a count only |

A save that counts `aiProvisional` without `humanReviewed` is a 400: a review replaces
the machine's mark, so such a formula would drop every answer from the count once it
is reviewed. A formula stored that way before the rule still reads, and its
methodology says so.

Teacher records (observations, wheel picks, hand tallies, activities) are not an
evidence type. A formula cannot count them: asking is a 400. Every report gives them
a section of their own that moves no figure (decision 3).

### Who wrote the question (`questionSources`)

A second split of the same answers, by who wrote the question rather than who marked
the answer, from the `question_source` each answer row keeps (`0008`;
`questionSourceOf`). It moves no mark.

| Key | `question_source` | Label |
|---|---|---|
| `aiGenerated` | `llm`, and a row with none (the column's default) | AI-generated questions |
| `professorWritten` | `teacher` | Professor-written questions |
| `offlineTemplate` | `fallback` | Offline-template or professor-written questions |

A professor's own question is stored as `fallback` today, so an answer row cannot
tell it from the offline template's; the label says both. No row holds `teacher` yet.

- Every `marks` (class figures, `outside.notEnoughEvidence.marks`, student cells,
  register cells and totals) carries `questionSources`: per source
  `{ answers, obtained, possible, notCounted }`. The first three are the counted types
  only, and the three sources add up to them; `notCounted` is that source's answers of
  a type the formula does not count.
- `answers.bySource` (class report) and `answerCounts.bySource` (student report): the
  marked answers per source.
- `questionSources` on all three reports: each `{ id, label, description }`.
- Each answer in the student report carries `questionSourceType`.

### What the class report returns (captured)

Captured on 19 November 2026, after the review fixes, from the acceptance run's
class, in which:
- five students are on the roster, and a visitor's roll number is not;
- three course outcomes are mapped to three topics, one with weight 2;
- there are three rooms on three days;
- every question was written by the professor, so every answer is on
  `offlineTemplate`;
- the formula is the default example.

The JSON is from a one-off copy of `acceptance4.mjs` kept outside the repository,
which only also saved each JSON reply it fetched (76 of 76 checks passed in that run).
The CSV and HTML files are from the same run's `ACCEPTANCE4_DUMP`. Network settings
blanked. Ids are shortened.

`GET /api/classes/:id/attainment` has these top-level keys: `class, window, rooms,
formula, methodology, evidenceTypes, states, answers, unmapped, outcomes, bloom,
students, rollNotes, questionSources, teacherRecords, definitions, privacy`.

```json
{ "answers": { "rows": 44, "setAside": 0, "chosen": 44, "ungraded": 0, "graded": 44,
               "byType": { "digital": 41, "aiProvisional": 2, "humanReviewed": 1 }, "mapped": 41, "excluded": 0, "unmapped": 3,
               "bySource": { "aiGenerated": 0, "professorWritten": 0, "offlineTemplate": 44 } } }
```

One outcome's class figure (CO2):

```json
{ "code": "CO2",
  "topics": [ { "contentId": "8526...", "chapter": "Operating Systems: Unit 1", "topic": "Scheduling", "weight": 1, "inChapter": true } ],
  "directQuestions": 0,
  "students": { "roster": 5, "counted": 3, "attained": 1, "notAttained": 2, "notEnoughEvidence": 2, "withNoAnswers": 1 },
  "share": 0.3333, "attainmentLevel": 0,
  "marks": { "digital": { "answers": 9, "obtained": 4, "possible": 9, "counted": true },
             "aiProvisional": { "answers": 0, "obtained": 0, "possible": 0, "counted": false },
             "humanReviewed": { "answers": 0, "obtained": 0, "possible": 0, "counted": true },
             "ungraded": { "answers": 0, "counted": false },
             "questionSources": { "aiGenerated": { "answers": 0, "obtained": 0, "possible": 0, "notCounted": 0 },
                                  "professorWritten": { "answers": 0, "obtained": 0, "possible": 0, "notCounted": 0 },
                                  "offlineTemplate": { "answers": 9, "obtained": 4, "possible": 9, "notCounted": 0 } } },
  "outside": { "notEnoughEvidence": { "students": 1, "answers": 1,
                                      "marks": { "digital": { "answers": 1, "obtained": 1, "possible": 1, "counted": true }, "...": "the same shape as marks" } },
               "removed": { "students": 0, "answers": 0 }, "notOnRoster": { "students": 1, "answers": 1 } },
  "summary": "1 of 3 students counted attained CO2 (33.33%): level 0. 2 on the roster have not enough evidence (fewer than 3 counted answers). Rests on 9 counted answers from the 3 students counted: 9 digital. Outside the share: 1 counted answer from 1 student with not enough evidence." }
```

- `marks` holds the answers of **the students counted** (attained or not attained)
  and nobody else's. A roster student with fewer than `minAnswers` counted answers is
  outside the share; their answers are in `outside.notEnoughEvidence`, with their own
  `marks`, since one more answer or one review can bring them in.
  `outside.removed` and `outside.notOnRoster` give `{ students, answers }`.
- `share` is attained of counted, **cut to 4 decimals and rounded down**: 2 of 3 is
  `0.6666`, shown as "66.66%". Obtained marks are rounded down and possible marks up,
  to 3 decimals. So a figure never reads higher than it is: a share of 59.996% prints
  as 59.99%, never as 60% beside "Not attained" under a 60% threshold. States and
  levels are decided exactly, never from these numbers.
- The summary says what the share rests on and, when any answers are outside it,
  "Outside the share: N counted answers from M students with not enough evidence."
- `formula.roomWeights[]` names each weighted room from **every** room of the class
  the caller may read (`code`, `found`) and carries `inReport`: whether the room is
  among those counted. A weighted room the dates or `?rooms=` leave out reads "(a room
  not in this report)" in the methodology, the parameters and the files; only a room
  the class no longer has reads "a room since deleted".

### What the files look like (captured)

The course-outcome sheet (`/attainment?format=csv`). It opens with the 30 leading rows
shown under "The CSV sheets" below: class, period, rooms, formula, parameters,
methodology, evidence types, question sources, the roll numbers off the roster,
privacy, how to read the file, how to keep roll numbers, the guard, the answer totals
and what is unmapped. Then the class table, here with its header and one row, long
cells cut:

```
Course outcomes: the class
Course outcome,Statement,Target Bloom level,Archived,Mapped to,Students on the roster,Counted (attained or not attained),Attained,Not attained,Not enough evidence,Not enough evidence: no counted answer at all,% of counted who attained,Attainment level,Digital answers behind the share (counted),Digital answers behind the share: marks obtained,Digital answers behind the share: marks possible,Provisional written answers behind the share (not counted),Provisional written answers behind the share: marks obtained,Provisional written answers behind the share: marks possible,Reviewed written answers behind the share (counted),Reviewed written answers behind the share: marks obtained,Reviewed written answers behind the share: marks possible,Counted answers behind the share on AI-generated questions,Marks obtained behind the share on AI-generated questions,Marks possible behind the share on AI-generated questions,Counted answers behind the share on professor-written questions,Marks obtained behind the share on professor-written questions,Marks possible behind the share on professor-written questions,Counted answers behind the share on offline-template or professor-written questions,Marks obtained behind the share on offline-template or professor-written questions,Marks possible behind the share on offline-template or professor-written questions,Polls behind the share (not marked),Roster students with not enough evidence who have counted answers (outside the share),Their counted answers,Removed students with evidence (not counted),Their answers,Roll numbers not on the roster with evidence (not counted),Their answers,Summary
CO1,Explain how an operating system manages processes.,,no,Operating Systems: Unit 1 / Processes,5,4,3,1,1,1,75,3,15,10,15,2,1,2,1,1,1,0,0,0,0,0,0,16,11,16,0,0,0,0,0,1,3,3 of 4 students counted attained CO1 (75%): level 3. ...
```

Then the students, in roll order. A name that begins with `=` is guarded, and a
Devanagari name is kept as written:

```
"Students by course outcome, in roll-number order (never ranked)"
Roll No,Name,Status,CO1 state,CO1 answers counted,CO1 marks obtained,CO1 marks possible,CO1 %,CO1 digital answers (counted),CO1 provisional written answers (not counted),CO1 reviewed written answers (counted),CO2 state,...
21CS02,Bilal Khan,On the roster,Attained,5,3,5,60,4,0,1,Not attained,3,1,3,33.33,3,0,0,Attained,3,4,6,66.66,3,0,0
21CS04,"'=HYPERLINK(""http://evil.invalid"",""Dev"")",On the roster,Attained,3,2,3,66.66,3,0,0,Not attained,3,1,3,33.33,3,0,0,Not enough evidence,2,2,4,50,2,0,0
21CS05,मीरा जोशी,On the roster,Not enough evidence,0,0,0,,0,0,0,Not enough evidence,0,0,0,,0,0,0,Not enough evidence,0,0,0,,0,0,0
VISIT9,Visitor,Not on the roster,Attained,3,3,3,100,3,0,0,Not enough evidence,1,1,1,100,1,0,0,Not enough evidence,0,0,0,,0,0,0
```

The register (`/register?format=csv`). A room with no answer is `0`, `0` and an
empty `%`, with the attendance mark beside it, never a zero mark. After the totals
come the answers by type, then by question source:

```
"Marks register, in roll-number order (never ranked)"
21CS03,Chitra Iyer,On the roster,Present,3,4,75,Absent,0,0,,Present,1,2,50,4,6,66.66,6,1,0,0,0,6,0,2,0,1,0
21CS05,मीरा जोशी,On the roster,Absent,0,0,,Absent,0,0,,Absent,0,0,,0,0,,0,0,0,0,0,0,0,0,0,3,0
VISIT9,Visitor,Not on the roster,,4,4,100,,0,0,,,0,0,,4,4,100,4,0,0,0,0,4,0,,,,
```

The printable attainment report (`/attainment?format=html`). It is one 38 KB
document, with excerpts below. Every value is escaped: the `<script>` in CO2's
statement is text. The state and level badges carry their words:

```html
<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; img-src &#39;none&#39;; base-uri &#39;none&#39;; form-action &#39;none&#39;">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex, nofollow">
<title>Course-outcome attainment: Operating Systems, TY-CS A, Sem V</title>
...
<p class="staff">Staff only</p>
<h1>Course-outcome attainment</h1>
...
<h2>How this report was made</h2>
<dt>Formula</dt><dd>&quot;Example: 60% of marks; levels at 50 / 60 / 70% of students&quot;. No formula has been saved for this class, so the default example is used: an example to start from, not an institutional standard</dd>
...
<tr><td>CO2</td><td>Apply &lt;script&gt;alert(&quot;co2&quot;)&lt;/script&gt; scheduling policies to a set of jobs.</td>...
<td class="n">2<small>1 with no answers</small></td>
<td class="n">33.33%</td><td><span class="badge lv-0">Level 0</span></td>
...
<th class="n">Outside the share<small>counted answers of roster students with not enough evidence</small></th>
...
<section class="page wide">
<h2>Students by course outcome</h2>
<p class="note">In roll-number order: the roster, then removed students with evidence, then roll numbers not on the roster; never ranked. ...</p>
<tr><td>21CS02</td><td>Bilal Khan</td><td>On the roster</td><td><span class="badge st-attained">Attained</span><small>3 / 5 (60%), 5 answers</small></td><td><span class="badge st-not-attained">Not attained</span><small>1 / 3 (33.33%), 3 answers</small></td>...
...
<h3>Roll numbers not on the roster</h3>
```

The report's sections, in order, are:
1. How this report was made (its parameters, methodology, evidence types and
   question sources)
2. Course outcomes: the class (with "Who wrote the questions behind each share" and
   what is not mapped)
3. Bloom attainment: the class (with "Who wrote the questions behind each share")
4. Students by course outcome (with the roll numbers not on the roster)
5. Students by Bloom level band and level
6. Teacher records
7. Definitions

### The fixes from the Phase 4 review

Every finding of the review was fixed on 19 November 2026, each with a check in
`server/test/` or the three Phase 4 scripts. What a caller sees differently:

- **The class figure** (above): `marks` holds the counted students only, with
  `outside.notEnoughEvidence`, and the summary says so. Before, `marks` held every
  roster student's answers, so a figure looked better supported than it was.
- **Shares rounded down** to 4 decimals for display (above). Before, a share was
  rounded to the nearest, so 59.996% could print as 60% beside "Not attained".
- **Room weights** named from all the class's rooms, with `inReport` (above). Before,
  a weighted room the window left out was called deleted.
- **Whose answers they are**: resolved through the attendance mark's roll number
  (`0021`), with `rollNotes`, `note` and `givenAs` (above). Before, a corrected roll
  number left a student's earlier answers as a roll number off the roster, and the
  student present with no answers.
- **Question sources** on every `marks`, with `bySource` and `questionSources`
  (above).
- **`aiProvisional` called a provisional machine mark**, never AI, in every label,
  description and methodology.
- **A save may not count `aiProvisional` without `humanReviewed`** (400).
- **`best` attempts**: a written answer's attempt followed by a retry never counts,
  since only a final attempt can be reviewed. So the professor's mark on the final
  attempt is what counts for that room, not an earlier provisional mark.
- **A formula's saved day** is India's day in its label and methodology, as every other
  day in a report.
- **No "level 0 below 0%"** in the parameters when the first level starts at 0%.
- **Only rooms opened for the class** are counted, and the methodology, the register's
  methodology and `definitions.rooms` now say so.
- **`?key=` on a file** is a 400 (the query, above). JSON with `?key=` is still 200.
- **Restoring an outcome at 50 in use** is a 409, as creating one is.
- **The CSV guard** also works after a semicolon or a tab inside a cell, and quotes
  every cell holding one ("The CSV sheets", below).
- **The CSV import reads in linear time.** A crafted file near the 1 MB limit used to
  hold the server for seconds; a unit test now reads such files in well under one.

### Tests

Every suite passes. The fix's run and a rerun after it, both through the offline
runner on 19 November 2026, gave the same figures: unit 598, migrations 573,
`outcomes.mjs` 87, `attainment.mjs` 73, `acceptance4.mjs` 76, and every Phase 0 to 3
suite its old figure (`docs/TESTING.md`, "Full rerun after Phase 4").

---

## Phase 4: course outcomes, their mappings, and the roster from CSV

Written 19 November 2026 from `server/src/routes/outcomes.js`,
`server/src/services/outcomes.js`, the import route in `server/src/routes/classes.js`
and `server/src/services/roster.js`. Uncommitted. Exercised by
`server/scripts/outcomes.mjs` (87 checks since the review fixes) over HTTP and a real
phone socket on the in-process store, **with signed-in callers** answered in-process
as in `roster.mjs` (a professor, a second professor, the HOD of the department, an
HOD of another, a student account); the Supabase repo's requests are pinned in
`server/test/outcomes.test.js` (44 tests) against a stubbed PostgREST. Not run against
Supabase, Mongo or a real Auth token. No screen was checked against it (the UI
session's uncommitted client calls it; see the top of this file). The examples below were
captured from a real server on the in-process store with the shared key; ids
shortened.

| Method + path | Who | What |
|---|---|---|
| `POST /api/classes/:id/students/import` | owner | A roster from a CSV file; `?dryRun=true` says what it would do and writes nothing |
| `GET /api/classes/:id/outcomes` | read rule | The class's course outcomes (archived ones after, marked), each with its topics, and every per-question override |
| `GET /api/classes/:id/outcomes/coverage` | read rule | Approved questions and answers per outcome and topic; what reaches no outcome |
| `POST /api/classes/:id/outcomes` | owner | Create one: `{ code, statement, targetLevel? }` |
| `PATCH /api/classes/:id/outcomes/:outcomeId` | owner | Edit `code`, `statement`, `targetLevel`; `{ "archived": false }` restores |
| `POST /api/classes/:id/outcomes/reorder` | owner | `{ ids }`: every outcome in use, in the new order |
| `DELETE /api/classes/:id/outcomes/:outcomeId` | owner | Archive one with evidence; delete one without |
| `PUT /api/classes/:id/outcomes/:outcomeId/topics` | owner | `{ topics: [{ contentId, topic, weight? }] }`, the whole set |
| `PUT /api/classes/:id/outcomes/questions/:questionId` | owner | `{ outcomeIds }` or `{ exclude: true }` for one question in this class |
| `DELETE /api/classes/:id/outcomes/questions/:questionId` | owner | Remove that override: the question follows its topic again |
| `POST /api/classes/:id/outcomes/copy` | owner of this class; read rule on the other | `{ fromClassId }`: copy its outcomes and their mappings |

**Who.** Mounted at `/api/classes` behind `requireTeacher` (a student account 403, no
credentials 401). Ownership follows the class (`readableClass` / `writableClass` in
`routes/classes.js`): the owner reads and writes; an HOD of the department reads and
gets 403 on every write, the dry-run import included; anyone else, and an id that
names nothing, gets `That class was not found.` word for word. A chapter named in a
mapping must be one the caller may read (`That chapter (topics[0]) was not found.` for
"not there" and "not yours" alike), a question named in an override likewise (`That
question was not found.`), and an outcome id in a path must be this class's (`That
course outcome was not found.`).

**Privacy.** Staff-only. Nothing here is sent to a phone, the projector or a
student-facing route (`outcomes.mjs` checks the phone's payloads and the room's public
read). Coverage counts students; it names none. Teacher records are never mapped to an
outcome or counted. Every body carries `privacy`.

### `POST /api/classes/:id/students/import`

The body is the file (`Content-Type: text/csv`, `text/plain` or `application/csv`) or
JSON `{ "csv": "...", "dryRun": true }`. `?dryRun=true` works with either; either one
saying `true` is a dry run. At most 1 MB (413, in a sentence) and 2,000 rows under the
header (400). The reader takes time in proportion to the file (since the review: a
crafted file of blank lines or quotes was quadratic and held the server for seconds).

Read as spreadsheets write: a UTF-8 byte-order mark dropped; CRLF, LF or CR line ends;
quoted fields holding commas, line breaks and `""`; comma, semicolon or tab, told from
the header line. The first non-blank line must name **one** roll number column (`roll`,
`roll no`, `roll number`, `rollno`) and **one** name column (`name`, `student name`), in
any case, with `.`, `_` and `-` read as spaces (`Roll No.`, `ROLL_NO`). Otherwise 400,
naming what the line holds. A quote that never closes is a 400 naming its line. Every
other column is **never read into a row**, never stored, and named back in
`ignoredColumns` (a column with no header as `column 4 (no header)`; cells past the
last named column once, as `cells past the last named column`). Blank lines are skipped
and counted.

The rows then go through the same check and the same write as
`POST /api/classes/:id/students` (`addToRoster` in `services/roster.js`), with room
for 2,000 rows in one request; rows past the class's 500 are refused one by one.
`?dryRun=true` (captured; a roster of `21CS01` and a removed `21CS02`):

```json
{ "dryRun": true,
  "read": { "delimiter": "comma", "columns": { "roll": "Roll No.", "name": "Student Name" }, "rows": 5, "blankLines": 0 },
  "wouldAdd": [ { "line": 4, "rollNo": "21CS03", "name": "Rao, Chitra" } ],
  "refused": [
    { "line": 2, "roll": "21CS01", "name": "Asha Rao", "code": "on-roster", "reason": "roll number 21CS01 is already on this class's roster" },
    { "line": 3, "roll": "21CS02", "name": "Bilal Khan", "code": "removed", "reason": "roll number 21CS02 was removed from this class; restore that student instead of adding them again" },
    { "line": 5, "roll": "21CS03", "name": "Chitra again", "code": "repeated", "reason": "roll number 21CS03 appears more than once in this list" },
    { "line": 6, "roll": "21CS09", "name": "Ravi 98450 12345", "code": "bad-name", "reason": "the name holds a long number (a phone number or a date of birth?); a roster keeps a roll number and a name only" } ],
  "duplicates": {
    "inFile": [ { "line": 5, "rollNo": "21CS03", "firstLine": 4 } ],
    "onRoster": [ { "line": 2, "rollNo": "21CS01", "onRoster": { "id": "d818...", "rollNo": "21CS01", "name": "Asha Rao", "active": true, "...": "..." } } ] },
  "removed": [ { "line": 3, "rollNo": "21CS02", "student": { "id": "2bea...", "rollNo": "21CS02", "name": "Bilal Khan", "active": false, "removedAt": "..." } } ],
  "ignoredColumns": ["Phone"],
  "note": "A roster keeps a roll number and a name only. Not read from the file: Phone.",
  "restore": "Removed students are not restored by an import. To bring one back, restore them on the class's roster.",
  "message": "Nothing was changed: this is what importing the file would do.",
  "size": 1, "sizeAfter": 2,
  "class": { "...": "the class, as GET /api/classes/:id gives it" } }
```

- `line` is the line in the file (1 is the header's, blank lines counted), where the
  record starts when a quoted cell spans lines.
- `refused` is every row not added; `code` is one of `not-a-row`, `no-roll`,
  `bad-roll`, `bad-name`, `on-roster`, `removed`, `repeated`, `class-full`.
  `duplicates` and `removed` are the same rows sorted out, with the first line of a
  repeat and the roster row it matches.
- **A removed student is reported, never restored**; restoring is a decision about one
  student.
- Without the dry run the reply is the same with `added` (each roster row with its
  `line`) in place of `wouldAdd`, no `message` or `sizeAfter`, and `size` after the
  write. A row that passed the check but lost a race with another add is refused as
  `on-roster`.
- `POST /api/classes/:id/students` (Phase 3) answers exactly as before: its `refused`
  rows are `{ index, roll, name, reason }`, without `code`.

### The outcomes: `GET /api/classes/:id/outcomes`

Also the body of every write below, after the one outcome written as `outcome`
(captured after `PUT .../topics` on CO1 and an override):

```json
{ "outcome": { "id": "c89e...", "code": "CO1", "...": "as in the list" },
  "class": { "id": "02f0...", "courseName": "Computer Networks", "section": "TY-CS A", "termLabel": "" },
  "canEdit": true,
  "outcomes": [
    { "id": "c89e...", "code": "CO1", "statement": "Explain the layered model of a network.", "targetLevel": "understand",
      "position": 1, "archived": false, "archivedAt": null, "createdAt": "...", "updatedAt": "...",
      "topics": [ { "contentId": "3769...", "chapter": "Computer Networks: Unit 2", "topic": "Layers", "weight": 2, "inChapter": true } ] },
    { "id": "9974...", "code": "CO2", "...": "...", "topics": [ "{ Layers, weight 1 }", "{ Routing, weight 1 }" ] },
    { "id": "416b...", "code": "CO3", "statement": "Describe switching.", "targetLevel": null, "position": 3, "topics": [] } ],
  "overrides": [
    { "questionId": "d9e3...", "excluded": false, "outcomes": [ { "id": "416b...", "code": "CO3", "archived": false } ],
      "question": { "text": "Routing question 1?", "topic": "Routing", "level": "understand", "kind": "mcq", "status": "active",
                    "contentId": "3769...", "chapter": "Computer Networks: Unit 2" },
      "updatedAt": "..." } ],
  "limits": { "outcomes": 50, "code": 16, "statement": 300, "topicsPerOutcome": 100, "weight": 100 },
  "privacy": "Course outcomes, their coverage and attainment are for staff only: never shown on a phone or the projector, and never sent to a student-facing route." }
```

- `outcomes`: in the class's order, archived ones after (still named, with their
  mappings). `canEdit` follows the write rule (false for an HOD).
- `topics[].inChapter`: whether the topic is in the chapter's own list now. A mapping
  to a name the chapter has since renamed shows `false`.
- An override whose question has been deleted has `question: null` and a `note`: it
  still applies to the answers given to that question.

**Fields.** `code`: required, stored trimmed, single-spaced and upper case (`co1` is
`CO1`); letters, digits, spaces and `. _ - /`, starting with a letter or digit, at most
16 characters; one per class among outcomes in use (409 otherwise). `statement`:
required, at most 300 characters, single-spaced; holding an email address or a mobile
number is a 400. `targetLevel`: one of the six levels in British spelling, any case
(`Analyse` is `analyse`, `analyze` is a 400), or null. At most 50 outcomes in use per
class (409).

- `POST /api/classes/:id/outcomes` answers 201; the new one goes last.
- `PATCH .../:outcomeId` takes any of the three fields (one at least) and answers 200.
  An archived outcome is refused (409) until restored: `{ "archived": false }` (which
  may carry edits too) puts it back last in the order, and is a 409 while another
  outcome in use holds its code, or while 50 outcomes are in use (`This class already
  has 50 course outcomes, the most it may hold. Archive one before restoring CO3.`;
  since the review, so a restore can no longer pass the cap). `archived: true` is a
  400: removing is `DELETE`.
- `POST .../reorder` `{ ids }`: every outcome in use, each once (400 otherwise); the
  positions become 1, 2, 3 ... in that order.

### `DELETE /api/classes/:id/outcomes/:outcomeId`

An outcome that **any counted answer from any of the class's rooms** reaches (the
coverage below, over every room of the class) is **archived, not deleted**: it keeps its
mappings, so its evidence is still traced to it and every later report still names it.
Captured:

```json
{ "removed": "archived",
  "evidence": { "answers": 2, "students": 2 },
  "message": "CO1 has 2 answers from 2 students mapped to it, so it was archived, not deleted: its mappings and evidence are kept, and later reports still name it. Restore it with { \"archived\": false }.",
  "outcome": { "id": "9740...", "code": "CO1", "archived": true, "archivedAt": "...", "topics": [ "{ Layers, weight 2 }" ], "...": "..." },
  "...": "the list, as GET gives it" }
```

One that no answer reaches is deleted with its topic mappings (`removed: "deleted"`,
`topicsRemoved`), and taken off every override naming it: an override left naming
nothing is removed, and its question follows its topic again
(`overridesChanged: { narrowed: [questionId], removed: [questionId] }`, said in
`message`). Its code is then free. Removing an archived outcome again answers
`removed: "archived"` and changes nothing. Approved questions mapped to it are not
evidence; answers are.

### Mappings: `PUT .../:outcomeId/topics`

`{ "topics": [ { "contentId": "...", "topic": "layers", "weight": 2 } ] }` replaces the
outcome's whole set (`[]` maps none). Each chapter must be one the caller may read
(404 otherwise, as for one that does not exist). Each topic must be one the chapter's
evidence carries: its own list (`contents.topics`), its questions' topics (any status),
or a topic answers in this class's rooms were given under; otherwise a 400 listing the
chapter's topics:

```json
{ "error": "topics[0]: \"Transport\" is not a topic of \"Computer Networks: Unit 2\". Its topics are: Layers; Routing; Switching." }
```

Topics are compared within their chapter ignoring case and runs of spaces, and stored
as the chapter spells them. A topic may map to several outcomes; one outcome takes a
topic once per chapter (400 for a repeat). `weight`: a number above 0 and at most 100,
kept to three decimals, 1 when left out: how much that topic's evidence counts beside
the outcome's other topics, for the attainment report to apply. At most 100 topics per
outcome. An archived outcome is a 409.

### Overrides: `PUT .../questions/:questionId`

`{ "outcomeIds": [...] }` maps one question, in this class, straight to those outcomes
(of this class, in use; 400 otherwise) **in place of** its topic's; `{ "exclude": true }`
keeps it out of every outcome. One of the two (400 for both or neither); sent again,
it replaces the last. Kept by the question's id, so it holds through every edit of the
question and, once the question is deleted, for the answers given to it (their
snapshot keeps the id). The question must be one the caller may read.
`DELETE .../questions/:questionId` removes it (404 when there is none). Both answer
with the list.

### `GET /api/classes/:id/outcomes/coverage`

Over the class's rooms the caller may read (any status). Captured with three outcomes,
an override sending a Routing question to CO3, and four answers:

```json
{ "class": { "...": "..." },
  "rooms": { "counted": 1, "codes": ["C3344T"] },
  "outcomes": [
    { "id": "9740...", "code": "CO1", "...": "the outcome as in the list",
      "topics": [ { "contentId": "cf75...", "chapter": "Computer Networks: Unit 2", "topic": "Layers", "weight": 2, "inChapter": true,
                    "questions": 3, "answers": 2 } ],
      "direct": { "questions": 0, "answers": 0 },
      "questions": 3, "answers": 2, "students": 2, "evidence": "answers", "summary": "2 answers from 2 students." },
    { "code": "CO2", "topics": [ "{ Layers: questions 3, answers 2 }", "{ Routing: questions 1, answers 0 }" ],
      "questions": 4, "answers": 2, "students": 2, "evidence": "answers", "...": "..." },
    { "code": "CO3", "topics": [], "direct": { "questions": 1, "answers": 1 },
      "questions": 1, "answers": 1, "students": 1, "evidence": "answers", "summary": "1 answer from 1 student." } ],
  "answers": { "counted": 4, "mapped": 3, "excluded": 0, "unmapped": 1 },
  "unmapped": [ { "contentId": "cf75...", "chapter": "Computer Networks: Unit 2", "topic": "Switching", "inChapter": true, "questions": 1, "answers": 1 } ],
  "excluded": { "questions": 0, "answers": 0 },
  "definitions": { "answers": "...", "questions": "...", "resolution": "...", "topics": "...", "renamedTopics": "...",
                   "weights": "...", "archived": "...", "evidence": "..." },
  "privacy": "..." }
```

- **Counted answers**: final, graded answers from the rooms (polls and attempts
  followed by a retry left out), digital answers only. Every one is in exactly one of
  `mapped`, `excluded` and `unmapped`, so the three add up to `counted`: **nothing is
  dropped**. An answer reaching two outcomes is counted under each, and once in
  `mapped`.
- **Questions**: approved ones, of every chapter a mapping names, a room used or an
  overridden question sits in.
- Per outcome: under each topic, what reaches it through that topic; `direct`, what an
  override sends it; the totals and the students behind the answers. `evidence` is
  `answers`, `questions` (approved questions, no answer yet) or `none`, with
  `summary` in words ("No evidence: no topic or question is mapped to it yet.").
- `unmapped`: what reaches no outcome, by chapter and topic, most answers first, with
  `inChapter` saying whether the chapter still lists that topic. A topic renamed in the
  chapter's list after answers were given shows here under its **old** name with
  `inChapter: false` until that name is mapped too.
- Coverage counts; it does not weigh or score. Attainment (thresholds, formulas, marks)
  is the attainment report's, built on the same resolution.

**How an answer reaches its outcomes** (`resolveAnswer` in `services/outcomes.js`, the
one function the coverage and the attainment report both call):

1. Its question's override in this class, found by `questionId`, or by the id in the
   answer's snapshot once the question is deleted: `via: "question"` (its outcomes,
   weight 1) or `via: "excluded"` (none).
2. Its topic in its chapter (the chapter frozen on the answer, else the question's):
   the question's current topic while the question exists, then the topic frozen on
   the answer: `via: "topic"`, each outcome with its mapping's weight, `topicFrom`
   saying whose topic it was.
3. Otherwise `via: "unmapped"`, with the topic it carries.

### `POST /api/classes/:id/outcomes/copy`

`{ "fromClassId": "..." }`, any class the caller may read (404 otherwise, as for none);
the class itself is a 400. Its outcomes in use are created here, in order after this
class's own, with their topic mappings and its overrides (remapped to the new outcomes),
as **new rows: nothing stays linked**. Captured:

```json
{ "copied": { "outcomes": 2, "topics": 2, "overrides": 1 },
  "skipped": { "archivedOutcomes": 1, "topics": [], "overrides": [] },
  "from": { "id": "fcec...", "courseName": "Computer Networks", "section": "TY-CS A", "termLabel": "" },
  "message": "Copied 2 course outcomes with their mappings. Nothing is linked: a later change in either class does not change the other.",
  "...": "this class's list, as GET gives it" }
```

Archived outcomes are not copied. Skipped and listed with a reason: a topic of a
chapter the caller may not read; an override of a question that is gone or that they
may not read; an override naming only archived outcomes (one naming some is copied
without them, and listed). **409, nothing copied**, when this class already has one of
the codes in use, or would pass 50 outcomes; 409 when the other class has none to copy.

---

## Phase 4: configurable attainment and the marks register

Written 19 November 2026 from `server/src/routes/attainment.js`,
`server/src/services/attainment.js` and `server/src/services/attainmentPresets.js`.
Uncommitted. Exercised by `server/scripts/attainment.mjs` (73 checks since the review
fixes): three class rooms with scripted phones over Socket.io, a written answer
reviewed through `POST /api/review`, a roll number corrected after the student
answered, every figure checked against hand counts, **with signed-in callers**
answered in-process as in `roster.mjs`; the pure computation by
`server/test/attainment.test.js` (56 tests, fixtures worked out by hand). Not run
against Supabase, Mongo or a real Auth token. No screen was checked against it (the
UI session's uncommitted client calls it). The examples below were captured from a
real server on the in-process store with the shared key (a class of two, one room)
before the review fixes; each says what has changed since. Ids shortened.

| Method + path | Who | What |
|---|---|---|
| `GET /api/attainment/presets` | any teacher | The example formulas, each with its methodology |
| `GET /api/classes/:id/attainment/config` | read rule | The formula in force, its version and methodology |
| `PUT /api/classes/:id/attainment/config` | owner | Save a formula as the next version: `{ preset }`, `{ config }` or both |
| `GET /api/classes/:id/attainment` | read rule | Course-outcome and Bloom attainment, per student and for the class; `?from=&to=&rooms=` |
| `GET /api/classes/:id/attainment/students/:studentId` | read rule | One roster student's attainment, with every answer behind it; the same query |
| `GET /api/classes/:id/register` | read rule | The marks register: students by rooms, with attendance; the same query |

**Who.** `/api/classes/...` is mounted behind `requireTeacher` (a student account 403,
no credentials 401), ownership following the class as for the outcome routes: the
owner reads and saves; an HOD of the department reads and gets 403 on a save; anyone
else, and an id that names nothing, `That class was not found.` word for word. A
student id that is not a roster row of this class (removed rows are) is `That student
was not found.` `/api/attainment/presets` is behind `requireTeacher` too. Only the
class's rooms the caller may read are counted.

**Privacy.** Staff-only. Nothing here is sent to a phone, the projector or a
student-facing route (`attainment.mjs` checks every phone payload and the rooms'
public read). Students are listed in roll-number order and never ranked or numbered by
score. States describe evidence: `attained`, `not-attained`, `not-enough-evidence`.
Every body carries `privacy`.

### The formula

A formula is data, never code. Every field is required in a stored formula:

| Field | Rule |
|---|---|
| `studentThreshold` | A share above 0 and at most 1, at most 3 decimals (`0.6` for 60%). A student attains an outcome when their counted marks on it reach this share of the marks possible |
| `minAnswers` | A whole number, 1 to 100. Below it, counted answers on an outcome make a student `not-enough-evidence`, never `not-attained` |
| `levels` | 1 to 10 `{ level, minShare }`: the class reaches `level` when at least `minShare` of the students counted attained the outcome; 0 below the first. Levels are whole numbers from 1, and both levels and shares strictly increase |
| `evidence` | `{ digital, aiProvisional, humanReviewed }`, each `true` or `false`, one at least `true`. Any other key (`observations`) is a 400: teacher records never count (decision 3). On a save, `aiProvisional` only with `humanReviewed` (400 otherwise; a formula stored that way before this rule still reads) |
| `attempts` | `"final"`: every final attempt counts (an attempt followed by a retry does not; a question answered in two rooms counts in both). `"best"`: one attempt per student and question, across attempts and rooms, the highest mark among the counted types (among all when none of its attempts is of a counted type); a tie goes to a final attempt, then the later. A written answer's attempt followed by a retry never counts under `best` either: only a final attempt can be reviewed. An objective retried attempt, marked from the key, still can |
| `roomWeights` | Up to 100 `{ roomId, weight }`, weight above 0 and at most 100, 3 decimals; rooms not listed weigh 1. On a save a room may be named by `code` instead, and must be one of the class's rooms; it is stored by id. Named back from every room of the class the caller may read: a room the class no longer has is ignored and shown `found: false`; in a report, `inReport` says whether the room is among those counted |

**Evidence types**, read from the answer row as Phase 1 writes it (`evidenceTypeOf`):
`digital` is `review_status` `auto` (an objective answer marked from the key);
`aiProvisional` is `provisional` (a written answer the keyword marker marked and no
professor has reviewed; labelled "Provisional machine marks", since no model marks
answers); `humanReviewed` is `confirmed` or `overridden`; a poll (`ungraded`) is a
count only. Every figure is also split by who wrote the question
(`questionSources`, in the index above).

**Marks.** One answer is one mark, scored 0 to 1 as marked (the professor's mark once
reviewed), times its topic's weight in the outcome (1 for a question mapped directly
by an override) and its room's weight. Bloom attainment weighs by room only. States
and levels are decided exactly (integer arithmetic): 3 of 5 is 60%, and three
answers of 0.7 are 70%. Only what is shown is rounded, and always downwards for what
could flatter: obtained marks to 3 decimals down, possible marks up, shares to 4
decimals down.

**Who is counted.** The class figure counts students on the roster now who are
attained or not attained, and its `marks` are theirs. Roster students with too few
counted answers are outside the share (`outside.notEnoughEvidence`). Removed students
with evidence, and roll numbers no roster row holds, are listed after them, labelled,
with their evidence in `outside`, never counted. Whose each answer is follows the
room's attendance marks ("Whose answers they are", in the index above).

### `GET /api/attainment/presets`

```json
{ "presets": [
    { "id": "example-60-50-60-70", "name": "Example: 60% of marks; levels at 50 / 60 / 70% of students",
      "description": "A student attains an outcome with 60% of the marks on its questions, from at least 3 answers. ...",
      "config": { "studentThreshold": 0.6, "minAnswers": 3,
                  "levels": [ { "level": 1, "minShare": 0.5 }, { "level": 2, "minShare": 0.6 }, { "level": 3, "minShare": 0.7 } ],
                  "evidence": { "digital": true, "aiProvisional": false, "humanReviewed": true },
                  "attempts": "final", "roomWeights": [] },
      "methodology": "Formula: \"Example: 60% of marks; levels at 50 / 60 / 70% of students\", which ships with BloomLoop as an example to start from, not as an institutional standard. ..." },
    { "id": "example-60-60-70-85", "name": "Example: 60% of marks; levels at 60 / 70 / 85% of students", "...": "..." } ],
  "default": "example-60-50-60-70",
  "fields": { "studentThreshold": "...", "...": "what each field means" },
  "evidenceTypes": [ { "id": "digital", "label": "Digital answers", "description": "..." }, "..." ],
  "states": [ { "id": "attained", "label": "Attained" }, { "id": "not-attained", "label": "Not attained" },
              { "id": "not-enough-evidence", "label": "Not enough evidence" } ],
  "note": "These are examples to start from, not an institutional standard. ..." }
```

The list lives in `attainmentPresets.js`: a college's own example is a data change
there (each entry is checked by the unit tests), or simply a saved formula.

### `GET` and `PUT /api/classes/:id/attainment/config`

```json
{ "class": { "id": "02f0...", "courseName": "Operating Systems", "section": "TY-CS A", "termLabel": "Sem V" },
  "canEdit": true,
  "formula": { "source": "example", "version": 0, "savedAt": null, "savedBy": null,
               "preset": { "id": "example-60-50-60-70", "name": "Example: 60% of marks; levels at 50 / 60 / 70% of students" },
               "config": { "...": "as above" }, "roomWeights": [] },
  "methodology": "No formula has been saved for this class, so this report uses \"Example: ...\" ...",
  "presets": [ { "id": "example-60-50-60-70", "name": "..." }, { "id": "example-60-60-70-85", "name": "..." } ],
  "fields": { "...": "..." }, "privacy": "..." }
```

`formula.source` is `example` (nothing saved: the default example, version 0) or
`saved`; `preset` names the example a saved formula equals exactly, else `null`;
`formula.roomWeights` repeats the weights with each room's `code` and `found`, from
every room of the class the caller may read (no `inReport` here: that is a report's).

`PUT` takes `{ "preset": "<id>" }` (start from that example), `{ "config": { ... } }`
(change the fields named, of the formula in force, `evidence` key by key) or both
(change fields of the preset). The result is checked whole and saved as the next
version; **a saved version is never changed** (the database refuses it, `0020`), so a
report printed under version 2 can be checked against it. A save equal to the
formula already saved writes nothing. Captured (`{ "preset": "example-60-50-60-70",
"config": { "minAnswers": 2, "attempts": "best" } }`):

```json
{ "changed": true,
  "message": "Saved as version 1. Every report from now on uses it and says so; earlier versions are kept.",
  "formula": { "source": "saved", "version": 1, "savedAt": "2026-11-19T03:03:42.643Z", "savedBy": null, "preset": null,
               "config": { "studentThreshold": 0.6, "minAnswers": 2, "...": "...", "attempts": "best", "roomWeights": [] } },
  "methodology": "Formula: version 1 of this class's own formula, saved 2026-11-19. A student attains a course outcome when they score at least 60% of the marks on the questions mapped to it, counting only their best attempt at each question, across attempts and rooms, from ...",
  "...": "as GET" }
```

Since the review, the best-attempts clause also says "(a written answer's attempt
followed by a retry is left out, since only a final attempt can be reviewed)", and
the saved day is the day in India's time (a formula saved at 01:30 in India is that
day's, not the UTC day before).

Errors: 400 with a sentence for any bad field, an unknown key or preset, a room not
of the class, or `aiProvisional` counted without `humanReviewed`
(`{"error":"levels must strictly increase: levels[1] (level 2 at 0.6) does not come
above levels[0] (level 1 at 0.7) in both level and minShare."}`), and nothing is
saved; 403 for an HOD; 409 when another save took the version number first.

**The methodology paragraph** is generated from the formula: which formula and
version, the threshold, the attempts rule, the evidence counted and what is shown but
not counted, what a review does to a mark, the minimum answers, the weights (a weighted
room outside the report said so), every level (no "level 0" when the first level
starts at 0%), who is counted, whose answers they are (the attendance marks' roll
numbers), who wrote the questions, Bloom attainment, adaptive serving ("a student's
share is of the marks on the questions they were actually given"), polls and teacher
records, that only rooms opened for the class are counted, deleted rooms, and that
this is direct attainment only. Every report carries it.

### `GET /api/classes/:id/attainment`

Query: `from`, `to` (`YYYY-MM-DD`: the day each room opened, in India's time) and
`rooms` (comma-separated codes of the class's rooms; another code is a 400). Rooms are
counted oldest first. Captured before the exports and the review fixes (one room, two
students, both counted, so `marks` held the same answers then as now; written answers:
one reviewed, one provisional; minAnswers 2, best attempts). Since this capture:
- every `marks` also holds `questionSources`, and `answers` holds `bySource`;
- `outside` also holds `notEnoughEvidence`;
- the summary reads "Rests on 7 counted answers from the 2 students counted: ...";
- each outcome holds `topics` and `directQuestions` (the exports, below);
- the body also holds `rollNotes` and `questionSources` (after `students`), a row off
  the roster holds `note`, and `definitions` holds `questionSources`, `mapping` and
  `rolls`.

The index above has a capture of the current shape.

```json
{ "class": { "...": "..." }, "window": { "from": null, "to": null, "rooms": null },
  "rooms": [ { "roomId": "2619...", "code": "4F5YEK", "title": "Week 1", "day": "2026-11-19", "startedAt": "...", "status": "open", "weight": 1 } ],
  "formula": { "...": "as the config route" }, "methodology": "...",
  "evidenceTypes": [ "..." ], "states": [ "..." ],
  "answers": { "rows": 12, "setAside": 0, "chosen": 12, "ungraded": 0, "graded": 12,
               "byType": { "digital": 10, "aiProvisional": 1, "humanReviewed": 1 }, "mapped": 8, "excluded": 0, "unmapped": 4 },
  "unmapped": [ { "contentId": "8e16...", "chapter": "Operating Systems: Unit 1", "topic": "Memory", "inChapter": true, "answers": 2 }, "..." ],
  "outcomes": [
    { "id": "7ba4...", "code": "CO1", "statement": "Explain how an operating system manages processes.", "targetLevel": null, "archived": false,
      "students": { "roster": 2, "counted": 2, "attained": 1, "notAttained": 1, "notEnoughEvidence": 0, "withNoAnswers": 0 },
      "share": 0.5, "attainmentLevel": 1,
      "marks": { "digital": { "answers": 6, "obtained": 3, "possible": 6, "counted": true },
                 "aiProvisional": { "answers": 1, "obtained": 0, "possible": 1, "counted": false },
                 "humanReviewed": { "answers": 1, "obtained": 0.5, "possible": 1, "counted": true },
                 "ungraded": { "answers": 0, "counted": false } },
      "outside": { "removed": { "students": 0, "answers": 0 }, "notOnRoster": { "students": 0, "answers": 0 } },
      "summary": "1 of 2 students counted attained CO1 (50%): level 1. Rests on 7 counted answers: 6 digital and 1 reviewed written. 1 provisional written answer is shown but not counted." } ],
  "bloom": { "levels": [ { "level": "understand", "label": "Understand", "students": { "...": "..." }, "share": 0.5, "attainmentLevel": 1, "marks": { "...": "..." }, "summary": "..." }, "...six" ],
             "bands": [ { "id": "lower", "label": "Remember and Understand", "levels": ["remember", "understand"], "...": "..." }, "...three" ] },
  "students": [
    { "studentId": "afee...", "rollNo": "21CS01", "name": "Asha Rao", "status": "active", "statusLabel": "On the roster",
      "outcomes": [ { "id": "7ba4...", "code": "CO1", "state": "attained", "stateLabel": "Attained", "answers": 4, "obtained": 2.5, "possible": 4, "share": 0.625,
                      "marks": { "digital": { "answers": 3, "obtained": 2, "possible": 3, "counted": true },
                                 "humanReviewed": { "answers": 1, "obtained": 0.5, "possible": 1, "counted": true }, "...": "..." } } ],
      "bloom": { "levels": [ "...six, as for an outcome" ], "bands": [ "...three" ] },
      "records": { "observations": { "understood": 0, "participated": 0, "revision": 0, "support": 0 },
                   "picks": { "pending": 0, "answered": 0, "passed": 0, "help": 0, "skipped": 0, "absent": 0 } } },
    "..." ],
  "teacherRecords": { "label": "Teacher records: reported beside the marks, never part of one",
                      "observations": { "kinds": [ "..." ], "counts": { "understood": 0, "...": 0 }, "studentDays": 0 },
                      "picks": { "statuses": [ "..." ], "counts": { "...": 0 }, "total": 0, "answeredAloud": 0 },
                      "tallies": { "questions": 0, "hands": 0 }, "activities": { "kinds": [ "..." ], "counts": { "...": 0 }, "total": 0 },
                      "note": "Counted from the rooms in this report. They never enter a mark, a share, a state or a level (decision 3), ..." },
  "definitions": { "evidenceTypes": "...", "marks": "...", "states": "...", "classFigure": "...", "answers": "...", "bloom": "...", "rooms": "...", "order": "..." },
  "privacy": "..." }
```

- Per student and outcome: the counted `answers`, `obtained` and `possible` (3
  decimals), `share`, `state`; and `marks` by every evidence type, counted or not.
- Per outcome: the roster students by state, `share` of those counted (4 decimals,
  rounded down), the `attainmentLevel` (`null` with nobody counted), the evidence of
  the students counted in `marks`, and in `outside` that of roster students with not
  enough evidence (`notEnoughEvidence`, with its own `marks`), removed students and
  roll numbers off the roster, and a `summary` sentence. (Before the review fixes,
  `marks` held every roster student's answers and `outside` had no
  `notEnoughEvidence`.) Archived outcomes come last, marked; every outcome is listed,
  with or without evidence. Since the
  exports (below), each also carries what it is mapped to now: `topics` (as in the
  outcome list: `contentId`, `chapter`, `topic`, `weight`, `inChapter`) and
  `directQuestions` (how many questions an override maps straight to it), so a sheet
  or a printed page says what each figure was measured on. Additive; nothing else
  changed.
- `answers`: every attempt stored in the rooms (`rows`), those the attempts rule left
  out (`setAside`), polls, and the graded answers by type, by question source
  (`bySource`) and by `mapped`, `excluded` (an override keeps the question out of every
  outcome) and `unmapped`, which add up. What is unmapped is listed by chapter and
  topic, as in the coverage.
- `rollNotes`: one entry per roll number listed off the roster ("Whose answers they
  are", in the index above).
- `bloom`: the same per Bloom level and per decision 6's three level bands, over every
  counted answer at that level whether mapped to an outcome or not.
- `teacherRecords`: observations in force per student and day by kind, wheel picks by
  response, questions asked aloud and their hands, activities by kind; per student in
  `students[].records`. Never part of a figure.
- Deleted rooms are not counted (their answers are in the room archive).

### `GET /api/classes/:id/attainment/students/:studentId`

A roster student (active or removed) of the class: their `outcomes` and `bloom` as in
the class report, `student` (the roster row with `status`), `answerCounts` (their
totals as `answers` above, `bySource` included), `questionSources`, and every answer
they gave in the rooms counted, oldest first, in the teacher's view
(`GET /api/session/:code/answers`'s item: the snapshot with its key, `auto`, the
review). Their answers are found as the class report finds them: through each room's
attendance marks, so answers given under an earlier roll number are here. Each answer
adds (captured before the review fixes, which added `questionSourceType`):

```json
{ "evidenceType": "humanReviewed", "chosen": true, "counts": true, "note": "Counted.", "via": "topic",
  "outcomes": [ { "id": "7ba4...", "code": "CO1", "weight": 1 } ] }
```

`chosen` is whether the attempts rule kept it; `counts`, whether it counted; `note`
says why not ("Not counted: an attempt followed by a retry.", "Not counted: a written
attempt followed by a retry. Only a final attempt can be reviewed by a professor, so
only final written attempts count.", "Shown, not counted: the formula does not count
provisional machine marks.", "Counted. No course outcome is mapped to its topic
(\"Memory\")."). `questionSourceType` is `aiGenerated`, `professorWritten` or
`offlineTemplate`. An answer given under another roll number than the student's now
carries `givenAs` (that roll number), and its `note` ends "Given under roll number
<roll>, which this room's attendance mark for the student was made under."
`teacherRecords` holds their observation days (mark and note) and picks. The same
`from`, `to` and `rooms`.

### `GET /api/classes/:id/register`

Students (as above, in roll order: the roster, removed students with an answer or a
mark, roll numbers off the roster with an answer or a phone) by rooms (oldest first),
with the same `from`, `to` and `rooms`. Captured row:

```json
{ "studentId": "afee...", "rollNo": "21CS01", "name": "Asha Rao", "status": "active", "statusLabel": "On the roster",
  "rooms": [ { "code": "4F5YEK", "attendance": "present", "joined": true, "answered": true,
               "counted": { "answers": 6, "obtained": 4.5, "possible": 6, "share": 0.75 },
               "marks": { "digital": { "answers": 5, "obtained": 4, "possible": 5, "counted": true },
                          "humanReviewed": { "answers": 1, "obtained": 0.5, "possible": 1, "counted": true }, "...": "..." } } ],
  "total": { "counted": { "answers": 6, "obtained": 4.5, "possible": 6, "share": 0.75 }, "marks": { "...": "..." },
             "attendance": { "present": 1, "late": 0, "absent": 0, "unmarked": 0 } } }
```

One question is one mark; the formula's evidence types and attempts rule apply (the
best attempt within each room); outcomes, thresholds and room weights do not.
`attendance` is the room's mark (`present`, `late`, `absent`, `unmarked`) for a
roster student and `null` off the roster. **No marks is not a zero**: a student who
answered nothing in a room has 0 of 0 there (`share: null`) and the attendance mark
says why. The body also carries `rooms`, `formula`, a `methodology` of its own,
`evidenceTypes`, `answers` (`rows`, `setAside`, `chosen`), `rollNotes`,
`questionSources` and `definitions` (`cell`, `absent`, `order`, `rooms`, `rolls`,
`questionSources`). Since the review fixes:
- every `marks` (each room and the total) holds `questionSources`;
- a row off the roster holds `note`;
- whose each answer and phone is follows the room's attendance marks, so a student
  whose roll number was corrected keeps their earlier rooms in their own row, under
  their roll number now ("Whose answers they are", in the index above).

---

## Phase 4: CSV exports, printable reports and the acceptance run

Written 19 November 2026 from `server/src/services/exports.js`,
`server/src/services/printable.js`, the writer in `server/src/services/csv.js`
(`csvCell`, `toCsv`) and the format handling in `routes/attainment.js` and
`routes/outcomes.js`. Uncommitted. Exercised by `server/scripts/acceptance4.mjs` (76
checks since the review fixes, the directive's acceptance criterion end to end, below)
and `server/test/exports.test.js` (21). Not run against Supabase, Mongo or a real Auth
token, and **never opened in Excel, LibreOffice or Google Sheets**; the printable pages
were printed to PDF by a headless Edge, not on paper, and before the review fixes. No
screen was checked against them (the UI session's uncommitted client fetches them).
The excerpts below are from the acceptance run's own files
(`ACCEPTANCE4_DUMP=<folder>` keeps them), captured after the review fixes.

| Route | Who | `?format=` |
|---|---|---|
| `GET /api/classes/:id/attainment` | read rule | `json` (left out), `csv` (the course-outcome attainment sheet; with `&sheet=bloom` the Bloom attainment sheet), `html` (the printable attainment report) |
| `GET /api/classes/:id/attainment/students/:studentId` | read rule | `json`, `html` (one student's printable report) |
| `GET /api/classes/:id/register` | read rule | `json`, `csv` (the marks register), `html` (the printable register) |
| `GET /api/classes/:id/outcomes` | read rule | `json`, `csv` (the course outcomes with their mappings) |

**The same routes, not `/print` routes.** A file is the JSON report of the same
request: the route reads the same rooms (`from`, `to`, `rooms`), applies the same
formula and builds the same report, then hands it to the CSV or HTML writer, which
computes nothing. So a sheet can never disagree with the screen that showed the same
query, and there is one place where a query is read. `acceptance4.mjs` reads every
sheet back and compares it, cell by cell, with the JSON of the same query, under the
default example, a saved formula and three narrower queries.

`format` other than the route's own is a 400 (`format must be one of json, csv, html
(json when left out).`); `sheet` is `outcomes` (the default) or `bloom`, and only with
`format=csv` (400 otherwise). Both are read **after** the class's 404, so an outsider
learns nothing from them.

**No key in a file's address.** `format=csv` or `html` with `?key=` in the query is a
400 on all four routes, after the class's 404, and no file is sent: a browser prints
a page's address in its footer and keeps it in its history, and a download keeps its
address. The message says to send the `x-teacher-key` header instead. JSON with
`?key=` is still 200. (Since the Phase 4 review. The Phase 0 room CSV,
`GET /api/session/:code/export`, still takes `?key=`: an open issue below.)

**Who.** Exactly as the JSON route: the owner and an HOD of the department; another
professor and an id that names nothing get `That class was not found.` word for word;
a student account 403; no credentials 401. Staff-only: nothing here is sent to a phone,
the projector or a student-facing route.

**Headers.**

| Header | CSV | HTML |
|---|---|---|
| `Content-Type` | `text/csv; charset=utf-8` | `text/html; charset=utf-8` |
| `Content-Disposition` | `attachment; filename="..."` | `inline; filename="..."` |
| `Cache-Control` | `no-store` | `no-store` |
| `X-Content-Type-Options` | `nosniff` | `nosniff` |
| `Referrer-Policy` | `no-referrer` | `no-referrer` |
| `Content-Security-Policy` | | `default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'` |

**Filenames** are ASCII only, so they need no encoding and nothing in them can break
the header: `bloomloop-<report>-<course>-<section>-<class>-<YYYY-MM-DD>.<csv|html>`,
for example `bloomloop-attainment-operating-systems-ty-cs-a-4da2434c-2026-11-19.csv`.
`<report>` is `attainment`, `bloom-attainment`, `register`, `outcomes` or
`student-report`; the course and section are lower-cased, accents dropped and every
other run of characters one hyphen (a Devanagari course name drops out entirely);
`<class>` is the first 8 characters of the class's id, since a class has no code of its
own; the day is today in India's time. **No student's name or roll number**, even in
one student's report's name.

### The CSV sheets

RFC 4180: a UTF-8 byte-order mark first (Excel then reads Devanagari names as
UTF-8), CRLF after every row, `""` for a quote inside a quoted field. A field is
quoted when it holds a quote, a comma, a line break, **a semicolon or a tab**, or when
the guard below changed it. **Numbers are written as numbers**, unquoted, so a
spreadsheet sums them; an empty cell is "none" (a percentage with nothing counted, a
level with nobody counted).

**The formula-injection guard** (`csvCell` in `services/csv.js`). A text cell that
begins with `=`, `+`, `-`, `@`, a tab or a carriage return is written with an
apostrophe in front of it, and quoted. Since the Phase 4 review the same is done
**after a semicolon or a tab inside a cell**, where a spreadsheet that splits on them
(Excel where the list separator is `;`, a paste into Sheets) would start a new cell,
and any cell holding a semicolon or a tab is always quoted, so such a program keeps it
whole. A roster name `=HYPERLINK("http://evil.invalid","Dev")` comes out as
`"'=HYPERLINK(""http://evil.invalid"",""Dev"")"`, and a name `Asha;=1+1` as
`"Asha;'=1+1"`. Every sheet says so in its `Formula guard` row. The apostrophe is the
export's, not part of the value; a spreadsheet may show it. Numbers are never guarded
(a negative number is a number).

**Leading rows, not a second file.** Every sheet starts with rows describing it, a
label in column A and its value in column B; then a blank row; then each table as its
title on one row and its column names on the next, tables separated by a blank row
(the `How to read this file` row says so). One file, so the method can never be
separated from the numbers it explains; spreadsheets open such a file as it is, and a
program wanting one table reads from its title row. The course-outcome sheet's 30
leading rows (captured after the review fixes; long values cut here):

```
BloomLoop,Course-outcome attainment sheet
Class,Operating Systems
Section,TY-CS A
Term,Sem V
Generated,2026-11-19 10:38 (India time)
Period,Every room of the class (no dates or rooms chosen)
Rooms counted,3
Rooms,"6Z4HVA, opened 2026-11-03, ""Week A""; P43QYA, opened 2026-11-10, ""Week B""; JEZJRD, opened 2026-11-17, ""Week C"""
Formula,"""Example: 60% of marks; levels at 50 / 60 / 70% of students"". No formula has been saved for this class, so the default example is used: an example to start from, not an institutional standard"
Formula version,0
Formula: Student threshold,60% of the marks possible
Formula: Minimum counted answers,"3, per outcome or level; fewer is ""not enough evidence"", never ""not attained"""
Formula: Class levels,"level 1 from 50%, level 2 from 60%, level 3 from 70% of the students counted; level 0 below 50%"
Formula: Evidence counted,"digital answers; reviewed written answers"
"Formula: Evidence shown, not counted",provisional written answers
Formula: Teacher records,never counted (decision 3)
Formula: Attempts,final attempts (an attempt followed by a retry is left out)
Formula: Room weights,none: every room counts 1
"Formula, exactly as stored","{""studentThreshold"":0.6,""minAnswers"":3,""levels"":[...],""evidence"":{...},""attempts"":""final"",""roomWeights"":[]}"
Methodology,"No formula has been saved for this class, so this report uses ... (the report's methodology, word for word)"
Evidence types,"Digital answers: ... Provisional machine marks: ... Reviewed by a professor: ..."
Question sources,"AI-generated questions: ... Professor-written questions: ... Offline-template or professor-written questions: ..."
Roll numbers not on the roster,"VISIT9 is not on the class roster, so its answers in 6Z4HVA are listed apart and counted in no class figure."
Privacy,"Attainment, marks and every report here are for staff only: ..."
How to read this file,"These first rows describe the report: ..."
Roll numbers,"Roll numbers are text. A spreadsheet that opens this file directly may drop a leading zero (0042 becomes 42) or show a long roll number in scientific notation. To keep them exactly, import the file instead: Data > From Text/CSV, then set the Roll No column's type to Text."
Formula guard,"A text cell that begins with =, +, -, @, a tab or a carriage return is written with an apostrophe (') in front of it, and quoted, ... The same is done after a semicolon or a tab inside a cell, ... and a cell holding a semicolon or a tab is always quoted. ..."
Answers,"44 attempts stored in these rooms; 0 set aside by the attempts rule; 44 marked answers (41 digital, 1 reviewed written, 2 provisional written), of which 41 reach a course outcome, 0 are excluded from every outcome by an override and 3 reach none; by who wrote the question, 0 on AI-generated questions, 0 on professor-written questions and 44 on offline-template or professor-written questions; 0 polls (not marked)."
Not mapped to any outcome,Operating Systems: Unit 1 / Deadlock: 3 answers
Teacher records,"Observations, wheel picks, hand tallies and activities are listed in their own table at the end, at class level. ..."
```

`Formula: Evidence counted` is quoted because it holds a semicolon. `Question sources`,
`Roll numbers not on the roster` and `Roll numbers` are new with the review fixes;
every sheet that lists students carries them (the three report sheets, not the outcome
list).

**The course-outcome attainment sheet** (`/attainment?format=csv`), three tables:

1. `Course outcomes: the class`, one row per outcome (each with its class row and
   level):
   - `Course outcome`, `Statement`, `Target Bloom level`, `Archived`, `Mapped to` (its
     topics with their weights, and questions mapped to it directly);
   - `Students on the roster`, `Counted (attained or not attained)`, `Attained`, `Not
     attained`, `Not enough evidence`, `Not enough evidence: no counted answer at all`,
     `% of counted who attained`, `Attainment level`;
   - the share's evidence, the answers of the students counted: for each evidence
     type `<Type> behind the share (counted)` or `(not counted)`, then `<Type> behind
     the share: marks obtained` and `: marks possible` (`Digital answers`,
     `Provisional written answers`, `Reviewed written answers`);
   - the same counted marks by who wrote the question, nine columns: `Counted answers
     behind the share on <source>`, `Marks obtained behind the share on <source>`,
     `Marks possible behind the share on <source>`, for `AI-generated questions`,
     `professor-written questions` and `offline-template or professor-written
     questions`;
   - `Polls behind the share (not marked)`;
   - outside the share: `Roster students with not enough evidence who have counted
     answers (outside the share)` and `Their counted answers`; then the removed
     students and roll numbers off the roster with evidence and their answers (never
     counted);
   - the `Summary` sentence.

   Captured (the full header is under "What the files look like", in the index above):

   ```
   CO1,Explain how an operating system manages processes.,,no,Operating Systems: Unit 1 / Processes,5,4,3,1,1,1,75,3,15,10,15,2,1,2,1,1,1,0,0,0,0,0,0,16,11,16,0,0,0,0,0,1,3,3 of 4 students counted attained CO1 (75%): level 3. ...
   CO3,Analyse memory allocation with paging.,Analyse,no,Operating Systems: Unit 1 / Memory (weight 2),5,2,2,0,3,1,100,3,6,10,12,0,0,0,0,0,0,0,0,0,0,0,0,6,10,12,0,2,3,0,0,0,0,2 of 2 students counted attained CO3 (100%): level 3. ...
   ```

   CO3's share rests on the two students counted (6 answers, 10 of 12 marks); the
   two on the roster with too few answers have 3 counted answers outside it.

2. `Students by course outcome, in roll-number order (never ranked)`: `Roll No`,
   `Name`, `Status`, then per outcome (`CO1 (archived)` for an archived one) its
   `state`, `answers counted`, `marks obtained`, `marks possible`, `%`, and the answers
   of each evidence type, counted or not. Captured:

   ```
   21CS01,Asha Rao,On the roster,Attained,4,4,4,100,4,1,0,Attained,3,2,3,66.66,3,0,0,Attained,3,6,6,100,3,0,0
   21CS04,"'=HYPERLINK(""http://evil.invalid"",""Dev"")",On the roster,Attained,3,2,3,66.66,3,0,0,Not attained,...
   21CS05,मीरा जोशी,On the roster,Not enough evidence,0,0,0,,0,0,0,...
   VISIT9,Visitor,Not on the roster,Attained,3,3,3,100,3,0,0,...
   ```

3. `Teacher records: reported beside the marks, never part of one`: `Record`, `Kind`,
   `Count` (observations by kind in student-days, wheel picks by response, questions
   asked aloud and hands raised, activities by kind) and the note. **Class level
   only, by design**: a sheet is filtered and mailed a row at a time, and a "Needs
   additional support" count beside a name is the label the product refuses to print.
   A student's own records are in their printable report (and the JSON).

**The Bloom attainment sheet** (`&sheet=bloom`): the same leading rows, then `Bloom
level bands and levels: the class` (decision 6's three bands first, then the six
levels; `Levels included` names a band's levels) with the same figure columns as
above, students by band and level with the same columns per group, and the teacher
records table.

**The marks register** (`/register?format=csv`): its leading rows carry the register's
own methodology and only the parameters that apply to it (`Formula: Not applied in
the register` names the rest), the question sources and roll-number rows as above,
plus `No answers in a room` (the definition: not a zero). Then `Marks register, in
roll-number order (never ranked)`: per room (`<code> <day> attendance`, `marks
obtained`, `marks possible`, `%`), then `Total marks obtained`, `Total marks
possible`, `Total %`, the answers of each type (`Total digital answers (counted)`,
...), `Total counted answers on <source>` for the three question sources, `Polls (not
marked)` and the attendance counts (`Present`, `Late`, `Absent`, `Unmarked`). A room
with no answer is `0`, `0` and an empty `%` with its attendance mark beside it,
exactly as the JSON gives it. A roll number off the roster has an empty attendance
mark. Captured:

```
21CS03,Chitra Iyer,On the roster,Present,3,4,75,Absent,0,0,,Present,1,2,50,4,6,66.66,6,1,0,0,0,6,0,2,0,1,0
VISIT9,Visitor,Not on the roster,,4,4,100,,0,0,,,0,0,,4,4,100,4,0,0,0,0,4,0,,,,
```

**The outcome list** (`/outcomes?format=csv`): leading rows with how an answer reaches
an outcome (the coverage's definitions), the topic-weight rule, the formula in force
(which the reports apply to these mappings; this list counts nothing) and its
methodology. Then `Course outcomes and what they are mapped to`: one row per outcome
and topic (`Mapped by` `Topic`, with the chapter, topic, weight and whether the
chapter still lists it), per question an override maps to it (`Question (override)`,
with the question's text, topic, level, kind, status and id; a deleted question says
so), one `Nothing mapped yet` row for an outcome with nothing, and the excluded
questions last.

### The printable pages

`?format=html` answers one complete HTML document, built on the server from the same
JSON report:

- **Self-contained.** Inline CSS only: no script, no external font, stylesheet or
  image, no link. A `<meta http-equiv="Content-Security-Policy">` in the page repeats
  the header's policy (less `frame-ancestors`, which a meta tag cannot carry), so the
  page stays inert when the console opens it from a blob or `srcdoc`, where no
  response header reaches it.
- **Every value escaped.** The page is made with one tagged template (`html` in
  `services/printable.js`) that escapes everything put into it unless it is a fragment
  the tag itself made. A course-outcome statement `Apply <script>alert("co2")</script>
  ...` prints as text (`&lt;script&gt;alert(&quot;co2&quot;)...`).
- **Print rules.** `@page { size: A4 }`; each part from a new page
  (`break-before: page`); table headers repeated on every page (`thead { display:
  table-header-group }`); rows never split; the student matrices on landscape pages
  (`@page wide`), six outcomes or levels to a table. Printed by a headless Edge before
  the review fixes, the acceptance run's attainment report was 8 A4 pages, 6 portrait
  and 2 landscape; the page has grown since (question sources, roll notes) and was not
  printed again. A browser without named pages prints the matrices portrait.
- **Levels and states carry text.** A state is a badge reading `Attained`, `Not
  attained` or `Not enough evidence`; a class level reads `Level 2`, or `No level:
  nobody counted`. The colour only repeats the words, so a black-and-white print loses
  nothing (`print-color-adjust: exact` keeps the colour on paper where it can).

What each shows:

| Page | Sections |
|---|---|
| Attainment (`/attainment?format=html`) | Staff only; the class; **How this report was made**: the period, the rooms (code, title, day, status, weight), the formula with its parameters and as stored, the methodology paragraph, the **evidence types** (digital, provisional machine marks, reviewed, polls, teacher records), each with its answers in this report and whether it counts, and a **question sources** table (each source, what it is, its marked answers here); **Course outcomes**: statements and mappings, then the class figures (on the roster, counted, attained, not attained, **not enough evidence** with how many had no answers, % attained, the level, the answers behind the share by type, and an **Outside the share** column: counted answers of roster students with not enough evidence), **Who wrote the questions behind each share** (each figure's counted answers and marks by source), and each outcome's summary sentence; what reaches no outcome; **Bloom** bands then levels, likewise; students by outcome, then the **roll numbers not on the roster** with their notes, and students by band and level (roll order, never ranked; each cell a state badge with marks, answers and how many were not counted); **Teacher records** in their own section; definitions and the privacy line |
| One student (`/attainment/students/:id?format=html`) | Their roll number, name and roster status, and their outcomes' states counted ("0 attained, 1 not attained, 2 not enough evidence"); how it was made, as above, question sources included; their outcomes and Bloom bands and levels; every answer behind it (room, day, question, what they typed, level, mark, evidence type with **who wrote the question** under it, counted or not and why, outcomes); **Teacher records**: their observation days with the note, and their wheel picks |
| Register (`/register?format=html`) | How it was made (the register's own methodology and parameters, the evidence types and question sources); the register (per room the marks or "No answers", with the attendance mark under it), then the **roll numbers not on the roster** with their notes; the totals; a **Teacher records** section saying they are not in the register and where they are; definitions |

### Opening a file or a page from the console (for the UI session)

An `<a href>`, an `<img>` and a new tab send **no bearer token**, so a signed-in
professor's plain link gets the 401. As for images (Phase 2, `GET /api/media/:id`):

- **Fetch with the `Authorization` header**, then:
  - a CSV: make a blob (`new Blob([text], { type: 'text/csv' })`), give it to an `<a
    download>` named from the response's `Content-Disposition`, and click it;
  - a page: open it from a blob url (`URL.createObjectURL(new Blob([text], { type:
    'text/html' }))`) in a new tab, where the reader prints with the browser's own
    Print, or put the text in an iframe's `srcdoc`. The page runs nothing either way
    (its own policy forbids script). Calling `print()` on such an iframe from a console
    button needs the iframe to be same-origin (`sandbox="allow-same-origin
    allow-modals"`); not tried in a browser.
- **On the shared key, fetch with the `x-teacher-key` header** and open a blob, as
  for a bearer token. `?key=` in a file's url is a 400 since the Phase 4 review
  ("No key in a file's address", above): a browser prints a page's url in its default
  footer, so a page opened by such a url could print the shared key on every sheet,
  and the url stays in the browser's history and a download's record. The header
  reaches only classes nobody owns, as the key always did (`acceptance4.mjs`: a
  shared-key class's page by the header 200; `?key=` on a page or a sheet 400 with no
  file, on JSON 200; a wrong key 401; a professor's class the class's 404). No token
  is ever read from a url. The UI session's uncommitted client fetches files this way
  (`downloadCsv` and `openReport` in `client/src/lib/api.js`; not tried in a browser
  for this file).

### The acceptance run: `server/scripts/acceptance4.mjs`

The directive's criterion, "a professor can conduct multiple sessions and generate a
meaningful course-outcome attainment report without manually compiling quiz results",
end to end on a real server (in-process store, signed-in callers answered in-process,
real phone and projector sockets), over HTTP and Socket.io only except one step said
where it happens (each room's opening day moved back through the store, since no
route opens a room in the past):

1. The professor writes a chapter's bank (ten questions of five kinds, approved as
   written), makes a class and imports its roster from a CSV file with a byte-order
   mark, a `Mobile` column (never read), a name beginning with `=` and a name in
   Devanagari; the dry run first.
2. Three course outcomes, one statement holding `<script>`, mapped to three topics of
   the bank (one with weight 2); a fourth topic left unmapped.
3. Three rooms on three days, each on its own question set; scripted phones: one
   student absent from a room, one from another, one from all three, a roll number off
   the roster, three written answers left provisional, one of them reviewed through the
   review queue; a projector watching the last room on its progress screen.
4. The attainment report (before and after the review: Bilal's CO1 moves from 2 of 4,
   not attained, to exactly 60%, attained), the Bloom sheet, the register, the outcome
   list and one student's report, as JSON, CSV and HTML.

It checks every figure against numbers worked out by hand in its comments (no figure
is computed there from the answers); each CSV against the JSON of the same query,
under the default example, a saved 50% threshold and three narrower queries; the
methodology paragraph (only rooms opened for the class counted, provisional marks
called machine marks, not AI); the BOM, CRLF, unquoted numbers, the guard on the `=`
name, the Devanagari name and the roll-numbers-as-text row; each page's headers,
policy, escaping (`<script>` in a statement, `<b>` in an observation note),
self-containment, print rules and badges; the filenames; every format for another
professor (the class's 404), the department's HOD (200), another HOD (404), a student
(403) and nobody (401); the key in the header, and `?key=` on a file refused (400, no
file) but not on JSON; and that no phone payload (one phone still connected), no
projector payload (still connected) and no public room read ever carries any of it.
Since the review fixes it also checks each outcome's figure against the counted
students only (`outside.notEnoughEvidence`, the summary's words) and that every answer
is on the professor's questions (`bySource`). 76 checks.

---

## The owner's decisions of 19 Nov 2026: every changed endpoint and socket field

Built from the decisions the owner delegated on 19 November 2026
(`docs/PRODUCT_DECISIONS.md`), with one migration, `0022`. Exercised end to end by
`server/scripts/decisions.mjs` (signed-in callers answered in-process, as
`roster.mjs` does) and by `server/test/decisions.test.js`; the existing suites were
updated where a decision changed what they assert (`bank.mjs`, `media.mjs`,
`roster.mjs`, `modes.mjs`, `outcomes.mjs`, `acceptance4.mjs`). Not run against
Supabase, Mongo or a real Supabase Auth token.

| Where | What changed | Why |
|---|---|---|
| `student:join` (phone to server) | Takes an optional `token`: the signed-in student's access token. Verified as the student routes verify one; it links the room profile only for a student account of the room's owner with the roll number typed | Decision 7 |
| `session:accepted` | `profile` is a `PhoneRow`. New `linked` (true when this phone's answers go into the signed-in student's history) and, when a token was sent but could not link, `linkNote` (one sentence, whatever the reason) | Decisions 7, (a) |
| `server:question` | `reason` is the phone's own sentence (`reasonForPhone`): "This question is at Apply, the level you are working at.", "No questions are left for you at Apply, so this one is at Understand.", or inside the band "This question is at Remember, to build a firm base before the levels above." Never the band | (a) |
| `server:result`, `server:exhausted` | `profile` is a `PhoneRow`; `server:result`'s `reason` is `profile.next.why` | (a) |
| `teacher:grid`, `GET /api/session/:code/grid` | Unchanged, except a class room's row for a student marked under 18: `integrity: null`. A failed roster read gives every row `integrity: null` for that push | Decision 8 |
| `GET /api/session/:code/integrity/:rollNo` | For a student marked under 18: `summary: null`, `events: []`, `signalsOff: true`, a `message` | Decision 8 |
| `GET /api/session/:code/export` | The signals cell is empty for a student marked under 18 | Decision 8 |
| `DELETE /api/session/:code` | The archive keeps no signal of a student marked under 18 (`integrity: []` on their row) | Decision 8 |
| `GET /api/analytics/:id/answers` (a student, themself) | Only rows a phone signed in as them sent (`accountVerified`). A professor's read is unchanged | Decision 7 |
| `GET /api/analytics`, `GET /api/analytics/:id` (a student, themself) | Only rooms whose profile a signed-in phone linked to them, and only verified answers in the topics; no `banded` in the timeline; a `note` saying only rooms joined while signed in appear. Since the Phase 5 review fixes, inside a linked room too: the level tallies, counts, accuracy, timeline and Bloom tally come from the history entries of her own verified answers only (below). A professor's read is unchanged | Decisions 7, (a) |
| `GET /api/dashboard` (a student) | The same rule; no `banded`, top level or per room; a `note` | Decisions 7, (a) |
| `GET /api/session/archives/:id` | A class room's archive is served without the integrity signals of a student the class's roster marks under 18 **now** (also one marked after the room was deleted, and an archive written before `0022`). The stored archive is not rewritten. A failed read of the roster is an error, never an archive that might show a minor's signals | Decision 8 (Phase 5 review) |
| `GET /api/classes` | `canCreate` (false for an HOD) | UI ask |
| Roster rows everywhere (`GET /api/classes/:id`, adds, the import, the student edit) | `under18` (boolean) | Decision 8 |
| `POST /api/classes/:id/students` | A row may carry `under18` (true / false, or yes / no text); anything else refuses the row. `under18Note` when any row added is marked | Decision 8 |
| `POST /api/classes/:id/students/import` | Reads an optional under-18 column (`Under 18`, `under18`, `minor`, `below 18`) as yes or no; `read.columns.under18` names it or is null; each `wouldAdd` row carries `under18`; `under18` (a sentence) when the file marks a student already on the roster who is not marked; `under18Note` when the file has the column; the `restore` sentence no longer names a path | Decision 8; UI ask |
| `PATCH /api/classes/:id/students/:studentId` | Takes `under18` (boolean; 400 otherwise), owner only; `under18Note` in the reply. "Send name, rollNo, active or under18 to change." | Decision 8 |
| `DELETE /api/classes/:id/students/:studentId` | The `message` no longer names a verb or a body | UI ask |
| `projector:state` | `roomMode`: `devices`, `teacher-led` or `mixed` (beside `mode`, what the screen shows); on the whitelist | UI ask |
| `GET /api/session/:code/insights` (Teacher-led) | `cardsNote` no longer names a field | UI ask |
| `GET /api/attainment/presets` | `note` no longer names a path | UI ask |
| `POST /api/bank/:contentId/questions` | `source: 'teacher'` | `CONTRACT.md` §6 rule 5, amended |
| `POST /api/bank/question/:id/regenerate` | On an active question: `question.replacesId`, `replaces`, `note`; the old question stays active. No `warnings`. Since the Phase 5 review fixes, a plain regenerate of a replacement draft that was never approved (a draft, or one rejected) passes its link on: the new draft carries the same `replacesId`, `replaces` and `note`, so approving it still retires the active question | Phase 2 default settled |
| `POST /api/bank/question/:id/approve`, `PATCH /api/bank/question/:id` (`status: active`) | `retired`: the id of the question the approved draft replaced, now discarded | Phase 2 default settled |
| `POST /api/bank/:contentId/approve-all`, `POST /api/bank/bulk` (`restore`) | `retired`: a list of those ids (always on approve-all; on bulk only when there are any) | Phase 2 default settled |
| The question document | `replacesId` (null unless a regenerated draft of an active question) | Phase 2 default settled |
| `checks` on a question | `slide-only-reference` passes with a passage attached too; its message says a picture or a passage | Phase 2 default settled |
| Attainment reports and the register | `best`: a reviewed attempt always beats a provisional machine mark at the same question; the methodology and `fields.attempts` say so. The `offlineTemplate` source's label and description say it holds professor-written questions from before 19 Nov 2026; the sheets' column is renamed to match | UI ask; teacher source |
| Boot | The probe checks `0016` to `0022`; logs `[store] WARNING: ... apply supabase/migrations/<file> ... Until it is applied, ...` for `0019` to `0021`; stops using Supabase, naming the file, for `0022` | UI ask (deploy safety) |

### `PhoneRow`

What a phone is told about itself, in every `session:accepted`, `server:result` and
`server:exhausted` (`CONTRACT.md` sections 4 and 5, Amendment 3). Captured
(19 Nov 2026, in-process store, shared key) from a student's fourth `server:result`
in a room, four answers, all wrong:

```json
{ "rollNo": "P1", "name": "Pia", "workingLevel": "understand",
  "levels": { "remember": { "seen": 0, "correct": 0 }, "understand": { "seen": 4, "correct": 0 }, "...": "all six" },
  "total": { "seen": 4, "correct": 0 }, "answered": 4, "online": true,
  "counted": { "seen": 4, "correct": 0 }, "withdrawn": 0, "mastered": [], "masteryGoal": 0.8,
  "next": { "levels": ["remember", "understand"],
            "why": "From your 4 answers so far, your next questions are at Remember and Understand, to build a firm base before the levels above.",
            "answers": 4 } }
```

`next.why` outside the band, by case: "Your first questions are at Understand."
(`answers: 0`); "Your last 3 answers at Understand were mostly right, so your next
questions are at Apply."; "Your last 3 answers at Analyse were mostly wrong, so your
next questions step back to Apply."; "Your next questions are at Apply. You have 1
answer there so far, and your level can change once you have 3."; "Your next questions
are at Understand, from your last 4 answers there."; at the top, "Your last 4 answers
at Create were mostly right. Create is the highest level, so your next questions stay
there."; in a room that does not adapt, "This room keeps every student at Apply, so
your next questions are at Apply." The teacher's `GridRow` keeps `slowLearner`,
`integrity` and `reason` exactly as before.

Since Phase 5's honest indicators (Amendment 4) the row also carries `masteryBasis`
(per level answered at: answers, right, mastered, provisional and a sentence with no
percentage) and `next.provisional`. For the student above: `"masteryBasis": [{ "level":
"understand", "answers": 4, "correct": 0, "mastered": false, "provisional": false,
"sentence": "0 of 4 right at Understand: not yet at this room's goal." }]` and
`"provisional": false` (the band rests on all 4 answers). See "Phase 5: honest
indicators".

### `session:accepted`: `linked` and `linkNote`

```json
{ "profile": { "...": "PhoneRow" }, "session": { "...": "unchanged" }, "bankCount": 10, "supports": {},
  "linked": false,
  "linkNote": "This room is not linked to your account, so your answers here will not appear in your history. Check that you are signed in and typed your own roll number." }
```

`linkNote` only when the phone sent a `token` that could not link: expired or not a
token, an account that is not a student, another student's, a student of another
professor, or a roll number other than the account's. A phone that sends no token
gets `linked: false` and no note; a phone whose token links gets `linked: true`. The
join itself never fails on a token.

### The under-18 mark on the roster

```json
{ "student": { "id": "...", "rollNo": "M01", "name": "Meera", "active": true, "addedAt": "...", "removedAt": null, "under18": true },
  "under18Note": "Integrity signals are neither recorded nor shown for a student marked under 18, in any room opened for this class. The mark is a yes or no; no date of birth is kept. This is a working default, not legal advice: a lawyer must confirm it before any college signs or before 13 May 2027." }
```

Integrity signals in the class's rooms: none of the browser's reports, too-fast,
second-socket or level-jump is recorded for the student (checked when a signal is
about to be recorded), and none already recorded is shown (grid `integrity: null`,
the trail's `signalsOff`, the CSV's empty cell, the archive's `integrity: []`, and
since the Phase 5 review an archive served by `GET /api/session/archives/:id` read
against the roster as it stands). A room opened without a class has no roster, so the
mark does not reach it.

The roster read of a class (`GET /api/classes/:id`) carries each student's `under18`
and, since the Phase 5 follow-ups, `under18Note` whenever a student on the roster is
marked, so a screen opened fresh, or an HOD's, has the sentence too ("Phase 5
follow-ups", below). The writes that set the mark (an add, the import, the student
edit) carry it as before.

### A student's own history, inside a linked room (the decision 7 fix)

A sign-in links a room profile, but the profile is the room's record of a roll number:
a phone that typed it before her sign-in, or a classmate's phone after, answered into
the same history and tallies. Since the Phase 5 review fixes, a student reading
themself (`GET /api/dashboard`, `GET /api/analytics`, `GET /api/analytics/:id`) is
shown, inside each linked room, only the history entries whose answer is one of her
own verified final rows in that room (`verifiedView` and `verifiedKeys` in
`services/evidence.js`). Level tallies, counts, accuracy, the timeline, the Bloom
tally and the history trail are all counted from those entries; a redemption pairing
with an entry that is not hers is left off. When any entry in the room is not hers,
the room's working level (and `workingLevel` / `currentLevel` derived from it) is
`null`, since other answers helped set it. A profile whose entries are all hers comes
back unchanged. The professor's view is unchanged. The `note` now reads:

> "Only rooms you joined while signed in on your phone appear here, and in them only
> the answers that phone sent. A roll number typed without signing in is not proof
> that it was you, so those answers, and a room level they helped set, stay with your
> professor."

Tested by `decisions.mjs` (a classmate typing her roll number after her sign-in, and a
guest before her first sign-in) and `test/decisions.test.js`; with accounts answered
in-process, never a real Supabase Auth token.

## Phase 5: every new and changed endpoint and socket event

Uncommitted, server and database only (`0023`, `0024`; the honest indicators need no
migration). Three parts, each detailed in its own section below, and the review fixes
of 19 November 2026, which changed some payloads and sentences (marked "review" here,
detailed under "What the review fixes changed"). Exercised end to end on a real server
over HTTP and Socket.io, on the in-process store, with signed-in callers answered
in-process as `roster.mjs` does: `classquestion.mjs`, `misconceptions.mjs`,
`honesty.mjs`, `keysafety.mjs` (the review fixes) and, for the decision 7 fix,
`decisions.mjs`; unit-tested in `test/classQuestions.test.js`,
`test/misconceptions.test.js`, `test/honesty.test.js` and `test/decisions.test.js`.
Nothing was run against Supabase, Mongo, a real Auth token or a model.

**New routes.** Every one is staff-only (`requireTeacher`): a phone has no
credential and reaches none. Another professor's room, class or question gets the
same 404 as one that does not exist, word for word; an HOD reads under the read rule
and gets 403 on every write; no credentials, 401.

| Route | Who | What | Section |
|---|---|---|---|
| `GET /api/session/:code/class-questions` | read rule | Every class question of the room, oldest first, each as it stands; which one is running | Class questions |
| `POST /api/session/:code/class-questions` | the room's owner | `{ questionId }`: put one approved `mcq`, `truefalse`, `poll` or `multi` question to every phone | Class questions |
| `GET /api/session/:code/class-questions/:id` | read rule | One class question as it stands | Class questions |
| `POST /api/session/:code/class-questions/:id/pause` | owner | Round 1 closes; the class discusses | Class questions |
| `POST /api/session/:code/class-questions/:id/revote` | owner | Round 2 opens | Class questions |
| `POST /api/session/:code/class-questions/:id/close` | owner | `{ reveal? }`: it ends, its key revealed or not | Class questions |
| `GET /api/session/:code/confidence` | read rule | The room's confidence taps, counted by tap and by right and wrong | Class questions |
| `GET /api/bank/question/:id/misconceptions` | read rule | A question's labels, which options take one, `canEdit`, and its counts in every room on its chapter the caller may read | Misconceptions |
| `PATCH /api/bank/question/:id/misconceptions` | the question's owner | Add, edit, confirm or clear labels, all or nothing | Misconceptions |
| `GET /api/session/:code/misconceptions` | read rule | One room's misconception counts | Misconceptions |
| `GET /api/classes/:id/misconceptions?from=&to=&rooms=` | read rule | One class's counts over its rooms, filtered as the attainment reports are | Misconceptions |

**Changed routes.** Every change is a field added or a sentence reworded; nothing was
removed or renamed.

| Route | What changed | Section |
|---|---|---|
| `GET /api/session/:code/students/:roll/card` | `confidence: { counts, choices, note }`; `lastAnswers` leaves out class votes; `band.provisional`, `serving.basis`, `serving.moves`, `mastery`, `languages`, each last answer's `language` | Class questions; honest indicators |
| `GET /api/session/:code/answers`, a teacher's `GET /api/analytics/:id/answers`, the attainment student report | Each item: `classQuestion: { id, round }` or null, and `language`. No item carries a confidence tap | Class questions; honest indicators |
| `GET /api/session/:code/topics`, `/items`, `GET /api/bank/:contentId/stats`, class analytics' hardest questions, a student's own history | Leave every class vote out | Class questions |
| `GET /api/session/:code/items`, `GET /api/bank/:contentId/stats` | Each item: `provenance`, `levelCheck`, `basis`, `languages`; each option: `misconception` (`label`, `provenance`, `provenanceLabel`, `confirmed`) or null; the report: `translation` | Misconceptions; honest indicators |
| `GET /api/bank/:contentId` and every bank reply carrying a question | Each question: `misconceptions`, `provenance`, `levelCheck`; the bank: `misconceptionLabels` | Misconceptions; honest indicators |
| `PATCH /api/bank/question/:id`, `POST /api/bank/bulk` (`bloom`) | `misconceptionsRemoved`, `misconceptionsNote` when an edit removes a label | Misconceptions |
| `POST /api/bank/question/:id/split`, `POST /api/bank/merge` | Each new question keeps the labels of the wrong options it carries over | Misconceptions |
| `POST /api/generate`, `POST /api/bank/question/:id/regenerate` | A model item may carry proposed labels, saved as `provenance: 'ai'` | Misconceptions |
| `GET /api/session/:code/grid` | Each row: `levelBasis`, `masteryBasis` | Honest indicators |
| `GET /api/session/:code/insights` | Each student: `bandBasis`, `levelBasis`; each KPI: `sentence`; each card: `basis` | Honest indicators |
| `GET /api/classes/:id/analytics` | `sentence` beside room accuracy, levels, level bands and the histogram; hardest items as items above | Honest indicators |
| `GET /api/dashboard`, `GET /api/analytics/:id` (staff) | Room rows' `answers`, `students`; an HOD's professor rows' `answers` | Honest indicators |
| `GET /api/classes/:id/outcomes/coverage` | Leaves out round 2; round 1 counts as any answer | Class questions |
| Attainment reports, the register, their CSV and HTML | A fourth evidence type, `revote`, never counted. **Review:** a round 1 vote from a student who had already answered the question on their own in that room is set aside, and their own answer counts | Class questions; review |
| `PATCH /api/session/:code/projector`, `GET /api/session/:code/projector` | `question` may be `{ classQuestionId }`; `showCounts`; `screen.showCounts`. **Review:** the refusals reworded | Class questions; review |

**Socket events.**

| Event | Direction | What | Section |
|---|---|---|---|
| `student:answer` | phone to server | Optional `confidence`: `sure`, `think_so`, `guessing` | Class questions |
| `student:vote` | phone to server | **New.** A vote in the running class question | Class questions |
| `session:accepted` | to a phone | `confidence: [{ id, label }]`; the `PhoneRow` gains `masteryBasis`, `next.provisional` | Class questions; honest indicators |
| `server:question` | to a phone | `question.provenance: { by, checked, text }`; also sent after a class question closes, to a phone whose own question was the class question | Class questions; honest indicators |
| `server:result`, `server:exhausted` | to a phone | The `PhoneRow` gains `masteryBasis`, `next.provisional` | Honest indicators |
| `class:question` | to a phone | **New.** The class question as it stands, with `question.provenance`. **Review:** `question._id` is the class question's id, never the bank question's | Class questions; review |
| `class:vote` | to a phone | **New.** Its own vote back, never right or wrong. **Review:** four reasons a vote is kept and not counted, each with its own sentence | Class questions; review |
| `class:closed` | to a phone | **New.** It ended; the key only when revealed | Class questions |
| `session:paused` | to a phone | **Review:** also sent to a phone that votes while the room is paused | Review |
| `teacher:class-question` | to teacher screens | **New.** The staff body of a class question. **Review:** `phones.answeredAlone`, `answeredAloneNote` | Class questions; review |
| `teacher:grid`, `teacher:insights` | to teacher screens | As their routes above | Honest indicators |
| `projector:state` | to the projector | `question.source: 'class'` with its counts when chosen (through the whitelist) | Class questions |

No label, misconception count, level check, level move, translation warning, staff
provenance or confidence count is sent to a phone or the projector.

### What the review fixes changed (19 Nov 2026)

The review of Phase 5 found that a class question's key could reach a phone before
the reveal by four routes, that a signed-in student's vote could be displaced by a
phone typing her roll number, and that a student's own dashboard still read a whole
linked profile. Each fix below is checked by `keysafety.mjs` (41 checks) or
`decisions.mjs`, and by unit tests. The examples are real: captured on 19 November
2026 from a server on the in-process store, four phones, the shared teacher key,
nothing off the machine (ids shortened).

**1. A phone's class question is named by the class question.** `class:question`
used to carry the bank question's id, which a phone could send back as its own answer,
here or in another open room on the same chapter, and be marked on, key and all.
Now `question._id` is the class question's own id, the one `student:vote` sends:

```json
{ "id": "d45ce3dc…", "seq": 1, "round": 1, "state": "open", "voting": true,
  "question": { "_id": "d45ce3dc…", "text": "Which layer routes packets between networks?", "bloom": "understand",
                "topic": "Layers", "kind": "mcq", "source": "llm", "options": ["Link", "Transport", "Network", "Physical"],
                "provenance": { "by": "ai", "checked": false, "text": "Written with AI help and chosen by your professor." } },
  "options": [{ "key": "A", "label": "Link" }, { "key": "B", "label": "Transport" }, { "key": "C", "label": "Network" }, { "key": "D", "label": "Physical" }],
  "confidence": [{ "id": "sure", "label": "Sure" }, { "id": "think_so", "label": "Think so" }, { "id": "guessing", "label": "Guessing" }],
  "mine": null,
  "message": "Your professor has put this question to the whole class. Choose your answer and say how sure you are." }
```

**2. Nothing kept with a class question is ever answered back as an answer.** A vote's
key sent again through `student:answer` is filed under `<key>@<roll number>` like
another student's row; the answer is kept with the class question (`final` false,
never counted), and the phone is moved on to a question of its own with no
`server:result`. A resend of an answer a phone sent to the class question as its own
(before the reveal, after a close without one, or kept late) likewise only moves the
phone on: it is never told `score`, `correct`, `detail` or `solution`. Each answer is
still stored once (never discarded). Before the fix a vote's key returned
`{ correct: false, score: 0, solution: 2 }` and moved the ladder; a resend leaked the
mark one option at a time.

A phone that had answered the question **on its own before** it was put to the class
was shown its answer then, as every final answer is; a later resend of that same
question is answered from its own earlier result, as any double tap is. The professor
is told how many such phones there are (5 below).

**3. Why a vote is kept and not counted.** In this order, the first that applies:

| `detail` on the stored row | When | `class:vote.message` |
|---|---|---|
| `Sent for a round that had not opened: kept, not counted.` | round 2 sent while round 1 is open, or after a close with no re-vote (**new**; was called late) | "That round of voting had not opened, so this vote was kept but not counted." |
| `Arrived after this round closed: kept, not counted.` | its round has closed | "Voting had closed for that round, so this vote was kept but not counted." |
| `Sent while the room was paused: kept, not counted.` | the professor paused the **room** (**new**) | "Your professor has paused the room, so this vote was kept but not counted. Vote again when the room carries on." |
| `Sent from a phone not signed in as the student, after their signed-in phone voted in this round: kept, not counted.` | decision 7 (**new**, below) | "A phone signed in as this roll number's student has voted in this round, so this vote, from a phone that is not signed in, was kept but not counted." |

A paused-room vote is followed by `session:paused` `{ "code": "3B8EVS" }`, as an
answer sent then would be; the phone's earlier vote stays in force. Captured:

```json
{ "id": "d45ce3dc…", "round": 2, "counted": false, "mine": { "response": 1, "confidence": "sure" },
  "message": "That round of voting had not opened, so this vote was kept but not counted." }
{ "id": "d45ce3dc…", "round": 1, "counted": false, "mine": { "response": 0, "confidence": null },
  "message": "Your professor has paused the room, so this vote was kept but not counted. Vote again when the room carries on." }
```

The last row's sentence is quoted from the code (`services/classQuestions.js`), not
captured: it needs a signed-in phone (`keysafety.mjs` checks it).

**4. A typed roll number never takes a signed-in student's vote.** Under a roll
number whose profile a signed-in phone linked (decision 7):
- A phone not signed in as her is sent `mine` only from votes of phones not signed in
  (never her vote or her tap), on join, reconnect and its own votes.
- Its vote is counted only until her own phone votes in that round; after that it is
  kept with the sentence above. Her vote stays in force.
- A key her phone wrote, sent by such a phone, is filed under a scoped key and never
  answered from her row.
- A roll number no phone signed in to votes and changes its vote as before.

**5. The professor is told who saw the key first, as a count.** The staff body of a
class question (every route, and `teacher:class-question`) gains
`phones.answeredAlone`: how many students in the room gave a final answer of their own
to this question before it was put to the class (each was shown its key with their
result; a poll has none). With one or more, a sentence:

```json
"phones": { "joined": 4, "online": 4, "answeredAlone": 1 },
"answeredAloneNote": "One phone in this room answered this question on its own before you put it to the class, and was shown its answer then. Its vote is not counted in attainment; close the question if that matters to the discussion."
```

Attainment follows it: such a student's round 1 vote is set aside (`knewKey`), under
either attempts rule, and their own answer counts instead. Their student report says
"Not counted: a class question vote from a student who had already answered this
question on their own in this room, and was shown its answer then. Their own answer
counts instead." Every methodology paragraph now says so.

**6. Refusals name no field.** The sentences a professor can be shown:

| Route | Before | Now |
|---|---|---|
| `POST …/class-questions`, no or a malformed `questionId` | "questionId must be the id of an approved question of this room." | "Choose one of this room's approved questions to put to the class." |
| `POST …/class-questions/:id/close`, `reveal` not true or false | "reveal must be true or false." | "Say whether to show the class the answer as you close it: yes or no." |
| `PATCH …/projector`, two things named | "question names one of a questionId, a tallyId or a classQuestionId, not more." | "Choose one thing to show: a question of the room, a question asked aloud or a class question." |
| `PATCH …/projector`, a class question of another room | "question.classQuestionId is not a class question of this room." | "That class question was not asked in this room: choose one that was." |
| `PATCH …/projector`, a shape it cannot read | "question must be { questionId }, { tallyId }, { classQuestionId } or null." | "Choose what the question screen shows: a question of the room, a question asked aloud, a class question, or nothing." |

Two older projector refusals (Phase 3) still named a field, untouched by the review:
"question.questionId is not a question this room serves: pick one of its approved
questions." and "question.tallyId is not a question asked aloud in this room."
(`services/projector.js`). They and five more were reworded in the Phase 5 follow-ups
(below).

**7. Outside the class question.** The decision 7 fix to a student's own history
("A student's own history, inside a linked room", above); a deleted room's archive
served without an under-18 student's signals; and a regenerate of a never-approved
replacement keeping its link (both in "The owner's decisions of 19 Nov 2026").

## Phase 5: confidence taps and class questions (pause, discuss, re-vote)

Uncommitted, server and database only (`0023`). Every phone, console and projector
screen is the UI session's; what each must do is listed in "What the screens need"
below. Exercised end to end by `server/scripts/classquestion.mjs` (eight phones over
the socket, a teacher's screen, a projector, signed-in callers answered in-process as
`roster.mjs` does) and unit-tested by `server/test/classQuestions.test.js`; nothing
was run against Supabase or Mongo.

### Every new and changed endpoint and socket event

| Route or event | Who | | What |
|---|---|---|---|
| `GET /api/session/:code/class-questions` | staff, read rule | **new** | Every class question of the room, oldest first, each as it stands; which one is running |
| `POST /api/session/:code/class-questions` | the room's owner | **new** | `{ questionId }`: put one approved question to every phone |
| `GET /api/session/:code/class-questions/:id` | staff, read rule | **new** | One class question as it stands |
| `POST /api/session/:code/class-questions/:id/pause` | the room's owner | **new** | Round 1 closes; the class discusses |
| `POST /api/session/:code/class-questions/:id/revote` | the room's owner | **new** | Round 2 opens: every phone votes again |
| `POST /api/session/:code/class-questions/:id/close` | the room's owner | **new** | `{ reveal? }`: it ends, its key revealed or not |
| `GET /api/session/:code/confidence` | staff, read rule | **new** | The room's confidence taps, counted by tap and by right and wrong |
| `GET /api/session/:code/students/:roll/card` | staff, read rule | changed | `confidence: { counts, choices, note }`; `lastAnswers` leaves out class votes |
| `GET /api/session/:code/answers`, `GET /api/analytics/:id/answers` (a teacher's view) | staff | changed | Each item gains `classQuestion: { id, round }` for a vote, `null` otherwise. No item carries a confidence tap |
| `GET /api/analytics/:id/answers` (a student's own), `GET /api/analytics/:id` topics, `GET /api/session/:code/topics`, `/items`, `GET /api/bank/:contentId/stats`, class analytics' hardest questions | | changed | Leave every class vote out: a vote is not a student's own work at a level |
| `GET /api/classes/:id/outcomes/coverage` | | changed | Leaves out round 2 (never counted); round 1 counts as any answer |
| `PATCH /api/session/:code/projector` | the room's owner | changed | `question` may be `{ classQuestionId }`; new `showCounts` (true or false); `revealed: true` with a class question on the screen is a 400 |
| `GET /api/session/:code/projector` | staff | changed | `screen.showCounts`; `shows.question` for a class question (below); `rule` says what the wall shows of one |
| attainment reports, the register, their CSV and HTML | staff | changed | A fourth evidence type, `revote` (below) |
| `student:answer` | phone to server | changed | Optional `confidence`: `sure`, `think_so` or `guessing` |
| `student:vote` | phone to server | **new** | A vote in the running class question |
| `session:accepted` | to a phone | changed | `confidence: [{ id, label }]`, the three taps |
| `class:question` | to a phone | **new** | The class question as it stands |
| `class:vote` | to a phone | **new** | The phone's own vote, back |
| `class:closed` | to a phone | **new** | It ended; back to the phone's own question |
| `server:question` | to a phone | changed | Also sent after a class question closes, to a phone whose own question was the class question |
| `teacher:class-question` | to teacher screens | **new** | The staff body of a class question, after every change and (at most once a second) after votes; at `teacher:watch` for a running one |

### The confidence tap

Every answer a phone sends may carry `confidence`: `"sure"`, `"think_so"` or
`"guessing"`. It is optional; anything else, or nothing, is stored as no tap and the
answer is taken as always. It is stored on the answer row (`answers.confidence`, in the
spellings `0008` allows: `sure`, `think`, `guess`) and **read by nothing that marks or
moves anything**: the score, `correct`, the ladder, the bands, the insights and
attainment are the same with or without it (unit-tested and end to end). Staff see it
as counts only, never beside an answer.

`GET /api/session/:code/confidence`: over the room's final answers to the students'
own questions (a class question counts its own, round by round).

```json
{
  "room": { "code": "QN4R7K", "title": "Networks", "status": "open" },
  "choices": [{ "id": "sure", "label": "Sure" }, { "id": "think_so", "label": "Think so" }, { "id": "guessing", "label": "Guessing" }],
  "answers": 8,
  "tapped": 4,
  "counts": {
    "sure":     { "answers": 2, "correct": 2, "wrong": 0, "ungraded": 0 },
    "think_so": { "answers": 1, "correct": 1, "wrong": 0, "ungraded": 0 },
    "guessing": { "answers": 1, "correct": 0, "wrong": 1, "ungraded": 0 },
    "none":     { "answers": 4, "correct": 3, "wrong": 1, "ungraded": 0 }
  },
  "questions": [{ "questionId": "…", "text": "Which layer is number 3?", "level": "understand", "kind": "mcq", "answers": 2, "counts": { "…": "as above" } }],
  "note": "How sure students said they were, counted beside whether the answer was right. It is information only: …"
}
```

`ungraded` counts polls, which have no right answer. "Sure and wrong"
(`counts.sure.wrong`) is the misconception signal. The student card's `confidence` is
the same `counts` for one student in the room.

### A class question

The room's owner puts one approved question of the room to every phone. Only in a
room where phones answer (Student devices or Mixed), while it is open, one at a time,
and only a question whose options every phone can vote on: `mcq`, `truefalse`, `poll`
or `multi`. A question asked to the class is never served to a phone on its own in that
room again, from the moment it is asked (`docs/PRODUCT_DECISIONS.md`, "Phase 5"), and
may not be asked to the class twice in one room.

```
        start               pause                 revote               close { reveal? }
  ───────────────> open ───────────> paused ───────────────> revote ─────────────────> closed
  (round 1 voting)    (round 1 closed: discussion)   (round 2 voting)
                     └──────────────── close ───────────────────────────────────────> closed
```

A professor may close from any round. A vote is taken only in the round now open; a
phone may change it until the round closes. Every vote is an `answers` row (below),
never overwritten. No vote touches a profile: **a class question moves no level** (it
was not chosen for any one student's level, and round 2 follows the class's
discussion).

`POST /api/session/:code/class-questions` `{ "questionId": "…" }`: **201** with the
class question. Refused, with a sentence a professor can read:
- **404** `That room was not found.` for a room that does not exist and, word for word,
  for one the caller may not read (another professor's, another department's).
- **403** for an HOD who may read the room (`… you can read it but not change it.`).
- **401** with no credentials (a phone has none).
- **409**: the room is closed, waiting or paused; it is Teacher-led ("no phone answers
  in it … Ask it aloud and count the hands instead."); another class question is
  running ("Close it first."); the question was already asked to the class here.
- **400**: `questionId` is missing or not an id; the question is not one this room may
  serve (another chapter, outside the room's set, not approved); its kind has no
  options to vote on (`… This question is "Match the pairs", so serve it to phones one
  at a time or ask it aloud instead.`).

`POST …/:id/pause` (from `open`), `…/revote` (from `paused`), `…/close` (from `open`,
`paused` or `revote`; body `{ "reveal": true }` to reveal the key, false when left
out): **200** with the class question. 409 with a sentence from any other state
(`Voting on this question is already paused.`, `Pause the first vote before opening the
re-vote, so the class can discuss it.`, `That class question is already closed.`); 400
for `reveal` that is not true or false, and for a reveal on a poll (`A poll has no
right answer to reveal. Close it without revealing.`); the same 404 for a class
question of another room. When a round closes, every vote already under way is waited
for before anyone is told, so the counts are the round's whole.

Closing the **room** closes its running class question, unrevealed. A room's own pause
leaves it as it is, and resuming the room sends it to the phones again.

#### The class question as staff get it

The body of every route above and of `teacher:class-question` (from the 8-phone run,
at the close):

```json
{
  "id": "…", "seq": 1, "questionId": "…",
  "state": "closed", "round": 2, "voting": false, "revealed": true,
  "startedAt": "…", "startedBy": "…", "pausedAt": "…", "revoteAt": "…", "closedAt": "…", "closedBy": "…",
  "question": {
    "text": "Which layer routes packets between networks?", "kind": "mcq", "kindLabel": "Choose one",
    "level": "remember", "levelLabel": "Remember", "topic": "Layers", "source": "teacher",
    "options": [{ "key": "A", "label": "Link" }, { "key": "B", "label": "Transport" }, { "key": "C", "label": "Network" }, { "key": "D", "label": "Physical" }],
    "correct": ["C"], "stimulus": null
  },
  "phones": { "joined": 9, "online": 8, "answeredAlone": 0 },
  "rounds": [
    {
      "round": 1, "open": false, "voted": 7, "changedVotes": 1, "notCounted": 1,
      "distribution": { "options": [{ "key": "A", "label": "Link", "votes": 2 }, { "key": "B", "label": "Transport", "votes": 1 }, { "key": "C", "label": "Network", "votes": 3 }, { "key": "D", "label": "Physical", "votes": 1 }], "unreadable": 0 },
      "right": { "students": 3, "of": 7, "share": 0.4285 },
      "confidence": { "sure": { "answers": 3, "correct": 2, "wrong": 1, "ungraded": 0 }, "think_so": { "…": "…" }, "guessing": { "…": "…" }, "none": { "…": "…" } }
    },
    { "round": 2, "open": false, "voted": 7, "changedVotes": 0, "notCounted": 1, "distribution": { "…": "…" }, "right": { "students": 4, "of": 7, "share": 0.5714 }, "confidence": { "…": "…" } }
  ],
  "changes": {
    "both": 6, "onlyBefore": 1, "onlyAfter": 1,
    "wrongToRight": 2, "rightToWrong": 1, "rightToRight": 1, "wrongToSameWrong": 1, "wrongToOtherWrong": 1
  },
  "confidenceChoices": [{ "id": "sure", "label": "Sure" }, "…"],
  "confidenceNote": "…",
  "note": "Counts only: no student is named. A class question moves no student's level: …"
}
```

- `question.correct` is the key as letters: staff always see it. `null` for a poll.
- `rounds[]`: round 2 only once the re-vote has opened. **While a round is open,
  `distribution`, `right` and `confidence` are `null`**: the professor sees how many
  have voted (`voted`), not what, until the round closes. `voted` counts each
  student's vote in force (their latest); `changedVotes` the earlier votes a phone
  replaced; `notCounted` the votes that came after their round closed, and answers a
  phone sent to the question as its own question afterwards (both kept, never
  counted). `right` is `null` for a poll; `share` is rounded down to 4 decimals.
  `distribution.options[].votes` counts a `multi` vote once on every option it ticked;
  `unreadable` counts votes that picked nothing on the list.
- `changes` once round 2 has closed, `null` before. Of the students who voted in both
  rounds (`both`): wrong to right, right to wrong, right both times, wrong both times on
  the same answer, wrong both times on a different one. For a poll, `kept` and
  `changed` instead. `onlyBefore` and `onlyAfter` voted in one round only.
- Counts only: no roll number or name anywhere in it.
- `phones.answeredAlone` (since the review fixes): how many students answered this
  question on their own in the room before it was put to the class, and so were shown
  its key; with one or more, `answeredAloneNote` says so in a sentence ("What the
  review fixes changed", 5). The `phones` above are from the run before the fixes;
  the field is added, nothing else moved.

`GET …/class-questions` answers `{ room, kinds, running, classQuestions: [ … ],
confidenceChoices, note }`.

#### What a phone is sent

`class:question`, to every phone in the room at the start, the pause and the
re-vote; to a phone that joins or reconnects while one runs (after its own
`server:question`, which it parks); to every phone when the room is resumed:

```json
{
  "id": "…", "seq": 1, "round": 1, "state": "open", "voting": true,
  "question": { "_id": "…", "text": "Which layer routes packets between networks?", "bloom": "remember", "topic": "Layers", "kind": "mcq", "source": "teacher", "options": ["Link", "Transport", "Network", "Physical"] },
  "options": [{ "key": "A", "label": "Link" }, { "key": "B", "label": "Transport" }, { "key": "C", "label": "Network" }, { "key": "D", "label": "Physical" }],
  "confidence": [{ "id": "sure", "label": "Sure" }, { "id": "think_so", "label": "Think so" }, { "id": "guessing", "label": "Guessing" }],
  "mine": null,
  "message": "Your professor has put this question to the whole class. Choose your answer and say how sure you are."
}
```

- `question` is built by `forStudent()`, as every phone's question is: never a key.
  Since the review fixes `question._id` is the class question's id (the same as
  `id`), never the bank question's. Every phone gets the same full list in the same order (the fewer-choices support is
  not applied, so the class can discuss by letter); a true-or-false question has
  `options` `A True` and `B False` and a response of `true` or `false`.
- `state`: `open` (round 1, `voting` true), `paused` (`voting` false; "Talk it over with
  the people around you."), `revote` (round 2, `voting` true).
- `mine` is the phone's own vote in force in the current round,
  `{ response, confidence }`, sent when it joins or reconnects and, since the Phase 5
  follow-ups, when the room is resumed and when the class question is paused (each
  phone its own); `null` at the start and the re-vote, when nobody has voted yet.

`student:vote` (phone to server):

```json
{ "classQuestionId": "…", "round": 1, "response": 2, "confidence": "sure", "answerId": "v-7f3a9c21" }
```

`response` is what `student:answer` would send for the kind: an option's position, a
list of positions for `multi`, `true` or `false`. `round` is the round the phone is
voting in; `confidence` optional; `answerId` the idempotency key, as for an answer
(a resend is answered from the stored row). A missing `response` or a malformed
`classQuestionId` is ignored; a class question that is not this room's is ignored.

`class:vote` (to the phone that voted):

```json
{ "id": "…", "round": 1, "counted": true, "mine": { "response": 2, "confidence": "sure" }, "message": "Vote saved. You can change it until your professor closes the vote." }
```

Never whether it was right. `counted: false`, with its own `message`, for a vote whose
round has closed, one for a round not yet open, one sent while the room is paused
(then `session:paused` follows), and one from a phone not signed in after the
signed-in student's phone voted in that round (decision 7); the last three since the
review fixes ("What the review fixes changed", 3). A resend of a vote the phone has
since replaced says "You changed this vote afterwards: your latest vote is the one
that counts."

`class:closed`, to every phone, when it closes:

```json
{ "id": "…", "revealed": true, "answer": 2, "correct": ["C"], "message": "Voting is closed, and the answer is shown. Back to your own questions now." }
```

`answer` (in a response's own terms) and `correct` (letters) only when revealed; both
`null` otherwise. The phone goes back to its own question. A phone whose own question
was the class question (it is never served on its own in the room again) is sent a new
`server:question` straight after.

An answer a phone sends with `student:answer` to the class question as its own
question, after it was put to the class, is kept with the class question (`final`
false, never counted) and the phone is sent a question of its own. Since the review
fixes it is told nothing about its mark, then or on a resend, and a vote's key sent
through `student:answer` is never answered from the vote ("What the review fixes
changed", 2).

#### What the projector shows

`PATCH /api/session/:code/projector` `{ "question": { "classQuestionId": "…" }, "showCounts": true }`
puts a class question on the question screen. `projector:state.question` then is:

```json
{
  "source": "class", "text": "…", "kind": "mcq",
  "options": [{ "key": "A", "label": "Link" }, "…"], "stimulus": null,
  "revealed": false, "correct": null,
  "round": 1, "state": "paused", "voted": 7,
  "counts": {
    "minVotes": 5,
    "before": { "voted": 7, "options": [{ "key": "A", "votes": 2 }, { "key": "B", "votes": 1 }, { "key": "C", "votes": 3 }, { "key": "D", "votes": 1 }], "correct": null, "confidence": { "sure": 3, "think_so": 1, "guessing": 2, "none": 1 } },
    "after": null,
    "changes": null
  }
}
```

- `voted`: how many have voted in the current round (a count).
- `counts` only when `showCounts` is true (off by default, and after a restart); each
  round's counts only once that round has closed and **5 or more** voted in it.
  Confidence taps alone, never with right and wrong.
- `correct` (the key), `counts.*.correct` (the share right) and `counts.changes` only
  once the key is revealed (a poll's changes, which tell no key, once round 2 has
  closed). `revealed: true` from the PATCH is a 400 for a class question.
- Never a name. Every payload still goes through `toProjector()`, whose whitelist
  gained exactly these keys.

### In the evidence

A vote is an `answers` row: `classQuestionId`, `round` (1, or 2 for the re-vote),
`attempt` (the n-th vote this phone sent in that round), `final` (true for the vote in
force; false for one the phone replaced, one that came late or early, one sent while
the room was paused, one from a phone not signed in after the signed-in student's
voted, and an answer sent as a phone's own question), `correct` and `score` marked
from the question as asked (null for a poll, `ungraded` true), `reviewStatus:
"auto"`, `confidence`, `detail` saying why a vote was not counted. Both new fields are
null on every other answer and written once (`0012`'s guard).

**Attainment.** Round 1 is a digital answer like any other: counted when its question
is mapped to an outcome, by the formula's attempts rule (under `final`, it replaces an
earlier answer to the same question in the same room). Round 2 is a fourth evidence
type, `revote` ("Re-votes after discussion"): in `evidenceTypes`, in every `marks`
breakdown (`counted: false`), in `answers.byType`, and in the CSV and HTML as its own
columns marked not counted. No formula may count it (`evidence.revote` is a 400). A
changed or late vote is set aside. Since the review fixes, so is a round 1 vote from a
student who had already given a final answer of their own to that question in the
same room (`knewKey` in `chooseAnswers`): their own answer counts, under either
attempts rule. Every methodology paragraph now says how class questions and
confidence are treated.

**Archive.** A deleted room's archive gains `classQuestions` (each with its state,
`revealed`, times and the question as asked) and keeps every vote among its answers,
changed and late ones included.

### What the screens need

**The phone (`/join`).**
- An optional Sure / Think so / Guessing tap on every answer (`session:accepted`
  `confidence` gives the ids and labels), sent as `confidence` with `student:answer`.
  It must never be shown as affecting the mark.
- On `class:question` with `voting` true: park the question on screen (and any result
  screen), show the class question's options lettered A, B, …, the three taps, and send
  `student:vote`; allow changing the vote. With `voting` false (`paused`): show the
  message and the phone's own vote; no voting. On round 2: vote again. Show `mine` on
  reconnect.
- On `class:vote`: show what was sent; never right or wrong. `counted: false`: show the
  message (four reasons, each its own sentence). Vote with the class question's `id`
  (since the review fixes it is also `question._id`); never send it as an answer.
- On `class:closed`: show the answer only when `revealed`, then return to the parked
  screen. A `server:question` straight after replaces the parked question.
- On `session:resumed`, expect `class:question` again if one is running, with this
  phone's own `mine` (since the Phase 5 follow-ups). A phone that joins or reloads
  while the room is paused is sent no class question then (the join stops at
  `session:paused`); on the resume it gets it with the vote the server holds.

**The professor's console (Live).**
- Pick an approved `mcq`, `truefalse`, `poll` or `multi` question of the room and put it
  to the class; show the refusal sentences.
- While round 1 is open: votes so far of phones joined (`rounds[0].voted`,
  `phones.joined`). Pause; then the distribution, the share right and the confidence
  taps by right and wrong (counts, no names). Open the re-vote; close, with or without
  revealing the key.
- After the close: before and after side by side (distribution, share right,
  confidence) and the changes (wrong to right, …), as counts.
- When `answeredAloneNote` is present, show it beside the class question as soon as
  it starts: those phones were shown the key on their own earlier.
- Choose whether the wall shows a class question and its counts (`showCounts`).
- Listen to `teacher:class-question`.
- The room's confidence counts (`GET /confidence`) and the student card's
  `confidence.counts`, as counts only. Never a "confidently wrong" label on a student.
- Attainment screens: the fourth evidence type, `revote`, shown and marked never
  counted.
- An HOD sees all of it read-only (every write is a 403).

**The projector.** Render `question.source: "class"`: the options, `voted`, and when
present `counts.before` / `counts.after` per option and per tap, `correct` and
`counts.changes` once revealed; say why a round's counts are missing when fewer than
`minVotes` voted.

## Phase 5: misconception labels on wrong options

Uncommitted, server and database only (`0024`). Every console screen is the UI
session's; what it must do is in "What the screens need" below. The phone and the
projector change in nothing. Exercised end to end by `server/scripts/misconceptions.mjs`
(three rooms of one class, thirteen phone sittings over the socket, a projector, a class
question, signed-in staff answered in-process as `roster.mjs` does) and unit-tested by
`server/test/misconceptions.test.js`; nothing was run against Supabase or Mongo, and the
model was never called (its proposed labels are tested by parsing a fixture response).

A label names the misunderstanding a student who picks one wrong option most likely
holds: "Thinks TCP is connectionless". The reports then say "12 students chose the
option linked to the misunderstanding ...".

### Every new and changed endpoint

| Route or event | Who | | What |
|---|---|---|---|
| `GET /api/bank/question/:id/misconceptions` | staff, read rule | **new** | The question's labels, which of its options can take one, whether this caller may edit them, and how many students chose each labelled option in every room on its chapter the caller may read |
| `PATCH /api/bank/question/:id/misconceptions` | the question's owner | **new** | Add, edit, confirm or clear labels |
| `GET /api/session/:code/misconceptions` | staff, read rule | **new** | One room's counts |
| `GET /api/classes/:id/misconceptions?from=&to=&rooms=` | staff, read rule | **new** | One class's counts over its rooms, narrowed as the attainment reports are |
| `GET /api/bank/:contentId` | staff | changed | Every question carries `misconceptions` (the stored list, below); new `misconceptionLabels: { kinds: ['mcq','multi','truefalse'], maxLength: 120, note }` |
| `PATCH /api/bank/question/:id` | the owner | changed | An edit that rewords or removes a labelled option, or makes it a right answer, removes that label with the edit: `misconceptionsRemoved: [{ option, label, provenance }]` and `misconceptionsNote` (a sentence), present only then |
| `POST /api/bank/bulk` with `action: 'bloom'` | the owner | changed | Likewise for a retag that changes the kind: `misconceptionsRemoved: [{ id, labels: [...] }]`, `misconceptionsNote` |
| `POST /api/bank/question/:id/split`, `POST /api/bank/merge` | the owner | changed | Each new question keeps the labels of the wrong options it carries over, by their words |
| `POST /api/generate`, `POST /api/bank/question/:id/regenerate` | the owner | changed | A model item may carry labels the model proposed, saved as `provenance: 'ai'`. The offline templates propose none |
| `GET /api/session/:code/items`, `GET /api/bank/:contentId/stats` | staff | changed | Every `distribution.rows[].options[]` gains `misconception`: `{ label, provenance, provenanceLabel }` for an option of a labelled question that has one, else `null` |
| every socket event | | unchanged | No label is sent to a phone, a teacher screen or the projector |

### The stored list (`questions.misconceptions`)

```js
[{ option: 'TCP',                     // the option's TEXT ("True" or "False" on a true/false)
   label: 'Thinks TCP is connectionless',
   provenance: 'ai' | 'professor',    // 'ai': the generator proposed it; 'professor': written, edited or confirmed
   addedAt: ISO, changedAt: ISO,      // first written; last reworded
   by: accountId | null }]            // who last wrote or confirmed it; null for the generator and the shared key
```

Keyed by the option's words, not its place, so reordering options keeps every label on
its option. Only on a wrong option of an `mcq`, `multi` or `truefalse` question, at
most one per option. Empty for every question without labels.

### `PATCH /api/bank/question/:id/misconceptions`

```js
{ misconceptions: [
    { option: 0, label: 'Thinks TCP is connectionless' }, // add, or replace (the professor's now)
    { option: 2, label: null },                           // clear ('' too)
    { option: 3, confirm: true },                         // confirm the AI draft there, as it stands
] }
```

- `option` is the option's index in the question as it stands (true/false: 0 True,
  1 False). Options not named keep what they have.
- A label written or confirmed by the professor is `provenance: 'professor'`. Writing
  the same words again is a confirmation, not an edit. An edit keeps `addedAt` and moves
  `changedAt`.
- **All or nothing**: one refused change refuses the request, and nothing is written.
  400, each with a sentence that names the option by its number from 1: a right
  answer ("Option 2 ("UDP") is a right answer: ..."), a poll ("A poll has no wrong
  answer, ..."), another kind, an option the question does not have, one named twice, a
  change that says nothing to do, an empty, non-text or over-120-character label, a
  label holding an email address, a web address, a handle or a phone number, or a
  confirmation where there is no label.
- **Who**: the question's owner. An HOD gets 403; another professor, and an id that
  names nothing, the same 404 word for word ("That question was not found."); no
  credentials, 401.
- **The approval gate is untouched.** Only the labels are written: an approved question
  stays approved, a draft stays a draft, the rule checks are not re-run. Approving a
  question does not confirm its labels.

**Response** (and `GET`'s top half):

```js
{ question: { _id, text, kind, kindLabel, bloom, topic, status, options: [String] },
  labelled: Boolean,              // whether this kind takes labels at all
  wrongOptions: [Number],         // the indices a label may sit on
  misconceptions: [{ optionIdx, option, label, provenance, provenanceLabel /* 'AI draft' | "Professor's label" */,
                     addedAt, changedAt }],
  canEdit: Boolean, maxLength: 120, note: String,
  changed: [{ optionIdx, action: 'added' | 'edited' | 'confirmed' | 'cleared' }] }  // PATCH only
```

`GET` adds `rooms` (the chapter's rooms the caller may read) and `report`, the same
shape as the room report below, for this question only, where a student is a roll
number **in a room** (a chapter's rooms may be different classes, which can share a
roll number).

### The reports

`GET /api/session/:code/misconceptions` lists every labelled question answered in the
room and every labelled question of its set; a student is a roll number.
`GET /api/classes/:id/misconceptions` lists every labelled question answered in the
class's rooms the caller may read (`?from=&to=` as days, `?rooms=` as codes, exactly as
the attainment reports; a code not of the class is a 400); a student is a roll number
pooled across the rooms, so one who chose an option in two rooms is one student and two
answers. Both add `room` or `class`, `window` and `rooms` to:

```js
{ counted: { questions, labels, aiDrafts, answers },
  questions: [{
    questionId, text, kind, kindLabel, bloom, topic, status,
    answers,              // counted answers to it
    students,             // distinct students who answered it
    otherWording,         // of those, given to another wording of the options (or another kind)
    otherWordingNote?,    // a sentence, when otherWording > 0
    options: [{
      optionIdx, option, label, provenance, provenanceLabel, addedAt, changedAt,
      students,           // distinct students who chose this option in their counted answer
      answers,            // counted answers that chose it
      beforeLabel,        // of those, given before the label was added
      beforeChange,       // given after it was added but before it was last reworded
      sentence,           // '12 students chose the option linked to the misunderstanding "X".'
                          // + ' (an AI draft label, not yet confirmed by the professor)' for an AI draft
      note,               // 'Label added after these answers.' | 'Label added after 4 of these 12 answers.'
                          // | 'Label reworded after 3 of these answers.' | null
    }] }],
  top: [{ questionId, text, optionIdx, option, label, provenance, students, sentence }],  // at most 5, most students first
  method: String, privacy: String }
```

- **Counted answer**: each student's final answer to the question in a room: a retried
  attempt is not counted, a poll never has a label, and a class question's votes are
  left out (as the item report leaves them out).
- **Which label**: the question's current label for the option the student chose,
  matched by the option's words in the question as that student saw it (the answer's
  snapshot), so an answer given before the options were reordered still lands on the
  right option, and one given before the label existed counts under it with a note. An
  answer to an option reworded since matches no label (`otherWording` counts it).
- A choose-all answer counts every labelled option the student ticked.
- Questions come in ladder order, then topic and text; options in the question's own
  order; `top` orders misunderstandings, never students. Counts only: no student is
  named, and no list is ever ordered by a student's score.

### What the screens need

**The professor's console.**
- **Question bank, on an `mcq`, `multi` or `truefalse` question** (`misconceptionLabels`
  on the bank says which kinds): beside each wrong option (never the key), a short
  optional "misconception" box, at most 120 characters, saved with `PATCH
  …/misconceptions`. Show `provenanceLabel` beside each label: an "AI draft" label gets a
  Confirm action (`{ option, confirm: true }`) and reads as a draft until confirmed or
  rewritten; a Clear action sends `label: null`. Show the 400's sentence beside the box.
  Never offer it on a poll. Saving a label must not look like an edit that needs
  re-approval: the question's status does not change. An HOD sees the labels read-only
  (`canEdit` false).
- **After an edit or a retag**: when the reply has `misconceptionsRemoved`, show
  `misconceptionsNote` and list the removed labels, so the professor can add them again.
- **Room and class reports**: a "Misconceptions" panel listing `top` and, per question,
  each labelled option's `sentence` and `note`, with AI drafts visibly marked;
  `otherWordingNote` where present. The class panel takes the same date and room filters
  as attainment. Counts only, never names.
- **Item report** (`/items`, bank `/stats`): show `misconception.label` under the option
  it belongs to, with "AI draft" where `provenance` is `ai`.

**The phone and the projector.** Nothing. Neither is ever sent a label.

## Phase 5: honest indicators

Uncommitted, server only. No migration: a level move is kept inside the history entry
(`profiles.history`, jsonb since `0000`), and `answers.language` exists since `0008`.
Every console and phone screen is the UI session's; what each must do is in "What the
screens need" below. Exercised end to end by `server/scripts/honesty.mjs` (three phones
over the socket, one signed in, a teacher screen, signed-in staff answered in-process as
`roster.mjs` does, a question-set room serving one question of each kind of row, a
second room with fixture answers in English and Hindi, and a class question) and
unit-tested by `server/test/honesty.test.js`. Nothing was run against Supabase or Mongo.

The directive's words: show AI draft labels, the reasons for mastery movements, the
number of responses behind an estimate, uncertain classifications and
translation-related difficulty warnings; no stigmatising label on a student's screen,
no coins, leaderboards or streaks. The pure parts are `services/honesty.js`
(provenance, the level check, count sentences, languages) and, beside the ladder,
`levelEvidence`, `levelMoves` and `masteryBasis` in `services/mastery.js`.

### Every changed endpoint and socket event

Every change is a field added; nothing was removed or renamed.

| Route or event | Who | What is added |
|---|---|---|
| `server:question` | phone | `question.provenance: { by, checked, text }` (below) |
| `class:question` | phone | `question.provenance`, from the question as asked |
| `session:accepted`, `server:result`, `server:exhausted` | phone | in `profile` (`PhoneRow`): `masteryBasis`, and `next.provisional` |
| `GET /api/session/:code/grid`, `teacher:grid` | staff | each row: `levelBasis: { answers, provisional, sentence }`, `masteryBasis` |
| `GET /api/bank/:contentId`, and every bank reply carrying `question` or `questions` (edit, split, merge, bulk, regenerate, approve, reject, approve-all, write-your-own) | staff | each question: `provenance` and `levelCheck` (below) |
| `GET` and `PATCH /api/bank/question/:id/misconceptions`, the misconception reports | staff | each label: `confirmed` (a professor wrote or confirmed it); each report question: `provenance` |
| `GET /api/session/:code/items`, `GET /api/bank/:contentId/stats` | staff | each item: `provenance`, `levelCheck` (null for a deleted question), `basis`, `languages`; each option's `misconception` gains `confirmed`; the report: `translation` |
| `GET /api/classes/:id/analytics` | staff | `hardest.items[]` as items above; `sentence` on each room's `accuracy`, each of `levels` and `levelBands`, and the `histogram` |
| `GET /api/session/:code/insights`, `teacher:insights` | staff | each student: `bandBasis`, `levelBasis`; each KPI: `sentence`; each card: `basis: { students, answers?, sentence }` |
| `GET /api/session/:code/students/:roll/card` | staff | `band.provisional`; `serving.basis`, `serving.moves`; `mastery`; `languages`; each of `lastAnswers.items`: `language` |
| `GET /api/session/:code/answers`, a teacher's `GET /api/analytics/:id/answers`, the attainment student report's answers (every read built on `answerItem`) | staff | `language` |
| `GET /api/dashboard` (HOD, professor) | staff | each room row: `answers`, `students`; an HOD's professor rows: `answers` |
| `GET /api/analytics/:id` (a professor, read by their HOD) | staff | each `timeline` room: `answers`, `students` |
| `GET /api/dashboard` (a student, their own) | student | unchanged, except that a history entry never carries `move` |
| class question view (`GET .../class-questions/:id`, `teacher:class-question`) | staff | `question.sourceLabel` |

### Who wrote a question, and whether it was let in

`provenance` on every bank question sent to staff, read from the row (`source`,
`model`, `status`, `approvedAt`); nothing is stored:

```js
{ source: 'ai' | 'professor' | 'template' | 'professor-or-template',
  sourceLabel: 'AI-generated' | 'Professor-written' | 'Offline template' | 'Professor-written or offline template',
  model: String | null,                 // the model id; 'offline-template' for the offline generator
  approval: 'draft' | 'approved' | 'written' | 'unrecorded' | 'discarded',
  approvedAt, approvedBy,
  aiDraft: Boolean,                     // an AI question waiting for approval
  label: 'AI draft' | 'AI-generated, approved' | 'Professor-written' | 'Offline template draft' | ...,
  sentence: 'Written by the language model (gemini-2.5-flash) from the professor\'s material. A draft: no room serves it until a professor approves it.' }
```

- `professor-or-template` is `source: 'fallback'` with no model: a professor's own
  question from before 19 Nov 2026, or a template row older than `0013`. Nothing on the
  row tells the two apart, so neither is claimed.
- `written`: a professor wrote it, which is its approval. `unrecorded`: in use since
  before approvals were recorded (`0013`). `discarded`: rejected, retired by its
  replacement, or removed.

The phone is told `question.provenance` only for a question its room serves, so never
a draft (`servableFor` is the gate; the end-to-end run checks every question served):

```js
{ by: 'professor' | 'ai' | 'not-ai', checked: Boolean, text: String }
```

| The row | `text` |
|---|---|
| `teacher` | Written by your professor. |
| `llm`, approved | Written with AI help and checked by your professor. |
| `llm`, no approval recorded (older rows; and a class question, whose snapshot keeps no approval) | Written with AI help and chosen by your professor. |
| `fallback` from the offline template, approved | Made without AI from your professor's material, and checked by your professor. |
| `fallback` from the offline template, not | Made without AI from your professor's material. |
| `fallback` with no model | Made without AI, by your professor or from their material. |

Never "template", "fallback", "offline" or a model's name. `question.source` stays
beside it, as before, for the phone already built; the new phone should show `text`.

### An uncertain Bloom level (staff only)

`levelCheck` on every bank question and every item:

```js
{ uncertain: Boolean,
  reasons: [{ id: 'model-level-unconfirmed' | 'kind-does-not-fit-level', message }],
  sentence: 'Level uncertain. ...' | null }
```

- `model-level-unconfirmed`: an AI question no professor has approved (a draft, or an
  older one in use with no approval recorded). Approval is the confirmation.
- `kind-does-not-fit-level`: its kind is not one that asks for its level
  (`KINDS_FOR_LEVEL`): an older Choose one at Analyse, or a pick at Create (then the
  Create check's own sentence). A poll is never uncertain: its level is where it sits.

Never on a phone, the projector or a student's own read.

### The count behind every estimate

Each is a number and a sentence; "provisional" means the count is under the engine's
own minimum, and a screen must not show it as a firm state.

| Estimate | Where | Count and sentence | Provisional when |
|---|---|---|---|
| A student's level | grid `levelBasis`, insights `levelBasis`, card `serving.basis` | `levelEvidence`: "Based on the last 4 answers at Apply." / "Moved to Apply on the last 3 answers at Understand; 1 answer at Apply since." / "Based on 5 answers overall." (the below-40% band) / "No graded answers yet: Understand is the room's start level, not an estimate." | no ladder decision is behind it: fewer than 3 answers at the level, and no move into it |
| A student's level, on the phone | `PhoneRow.next` | `answers`, `why` (as before), `provisional` (as staff) | the same |
| A level's mastery | `masteryBasis` on the grid row, the phone row and the card | `{ level, answers, correct, mastered, provisional, sentence }`, levels answered at only: "3 of 4 right at Apply: at or above this room's goal, so Apply counts as mastered." No percentage and no band, so phone and staff are told the same words | fewer than 3 counted answers at the level |
| An accuracy band | insights `bandBasis`, card `band.provisional` | `bandReason`'s sentence, as before | fewer than 3 graded answers (no band) |
| Item difficulty | each item's `basis` | "Based on 3 answers: too few for a difficulty band (5 needed)." | fewer than 5 answers (no band) |
| An insight | each card's `basis`, each KPI's `sentence` | "Based on 12 students with a graded answer, and 30 Apply answers in this room." | |
| Class analytics | `sentence` beside each count | "Based on 40 graded answers from 12 students." | |
| Dashboards | room rows' `answers`, `students` | numbers only | |
| Attainment | unchanged | already carries `answers` on every figure and the `not-enough-evidence` state below `minAnswers` (checked, not changed) | |

### Reasons for level moves

Every move the ladder makes is kept on the history entry of the answer that caused it,
as `move`, so it survives a reload (the profile's `reason` holds only the latest):

```js
move: { rule: 'promote' | 'demote' | 'band' | 'top' | 'floor',
        from, to,            // levels; equal for a hold at the top or the floor
        window: 5 | null,    // the ladder's window; null for the below-40% band, which reads every counted answer
        share: 0.6667,       // right in that window, four places
        answers: 3,          // answers in it
        reason: '100% at Understand over the last 3 - promoted to Apply.' }   // the professor's sentence
```

`band` is the move into Understand when a student enters the below-40% band; `top` and
`floor` are a hold where the rule said move and there was nowhere to go. A hold in the
middle of the ladder keeps nothing (it is every other answer). A room with adapt off
moves nobody and keeps nothing. Staff read them on the student card, newest first, as
`serving.moves: [{ at, questionId, rule, from, to, window, share, answers, reason }]`.
They are staff-only: the band's sentence names the band, so a student's own dashboard
trail is sent without `move`. The phone is told why in its own words (`next.why`,
decision (a)), as before.

### Translation-related difficulty warnings

`answers.language` is written by the live loop, as `'en'` on every answer and vote
(`sockets/index.js`): no phone shows a translated question yet and no question records
its language, so every question is taken as written in English (the generator writes
English). The reads below are ready for the Hub's language switch (Phase 6); until
then they find one language and say nothing.

Each item's `languages`:

```js
{ original: 'en', originalName: 'English',
  languages: [{ language: 'en', name: 'English', answers: 10, correct: 8, share: 0.8, original: true },
              { language: 'hi', name: 'Hindi', answers: 5, correct: 2, share: 0.4, original: false }],
  otherThanOriginal: 5,
  note: '5 of 15 answers were given in a language other than the question\'s own (English).' | null,
  warning: { languages: ['en', 'hi'], higher, lower, gap: 0.4,
             text: 'Answers in Hindi were right 2 of 5 times (40%), against 8 of 10 (80%) in English: a gap of 40 points, above the 20-point threshold. Translation can change how hard a question is, so check the Hindi version before reading this as a gap in understanding.' } | null }
```

The warning needs two or more languages with at least 5 counted answers each, and the
highest and lowest shares more than 20 percentage points apart, compared in whole
numbers (80% against 60% is exactly 20: no warning). A default
(`TRANSLATION_WARNING`, `docs/PRODUCT_DECISIONS.md`). The report's `translation` says
the threshold and how many questions have a warning. The student card's `languages`
says which of the student's answers were in another language
(`"1 of this student's 1 answer was in Hindi, not the question's own English. ..."`),
and each of its last answers carries `language`.

### The labels audit

Every string that can reach a phone or the projector was read: the phone's events
(`session:accepted`, `session:rejected`, `server:question`, `server:result`,
`server:exhausted`, `server:waiting`, `session:teacher-led`, `session:paused` and
`resumed`, `session:closed`, `class:question`, `class:vote`, `class:closed`), the
projector's (`projector:state`, `projector:refused`, `projector:closed`, all through
`toProjector()`), `GET /api/session/:code`, and a student's own dashboard and
analytics. None names a band, labels a student or ranks one. The professor's pin reason
("Below-40% band: serving ...", `selector.js`) stays on the pin, server-side. No coins,
points, badges, leaderboards or streaks exist anywhere on the server (searched).
`honesty.mjs` checks every event three phones heard for band words, staff fields,
ranking and gamification words. Staff-side orderings by score are listed under the
open issues below.

### What the screens need

**The phone.**
- Under each question, show `question.provenance.text` as it is (a quiet line, not a
  warning), in place of the chip built from `question.source`, which today says "Not
  written by AI" with a tip naming the offline template. Same on a class question.
- Where the level is shown, when `profile.next.provisional` is true, say so gently
  ("early days: your level settles after a few more answers"), next to `next.why`.
- Where mastered levels are shown, show each level's `masteryBasis[].sentence` (no
  percentages, no bands).

**The professor's console.**
- **Question bank**: a chip with `provenance.label` on every question ("AI draft" on an
  unapproved AI question), `provenance.sentence` on hover or in the detail; when
  `levelCheck.uncertain`, an "uncertain level" mark beside the Bloom tag with
  `levelCheck.sentence`. Misconception labels: "AI draft" until `confirmed`.
- **Grid and live view**: beside each student's level, `levelBasis.sentence`, and the
  level shown as provisional (lighter, "provisional") when `levelBasis.provisional`;
  mastered chips with their `masteryBasis` sentence. Never a firm band for
  `bandBasis.provisional`.
- **Insights**: each KPI's `sentence` under its tile, each card's `basis.sentence` under
  its text.
- **Student card**: `serving.basis.sentence` beside the level; a "Level changes" list
  from `serving.moves` (time, from → to, the sentence); `mastery` per level;
  `languages.note` when present, and a small language tag on each last answer whose
  `language` is not `languages.original`.
- **Item statistics** (room, bank, class analytics' hardest): `basis.sentence` beside
  the difficulty, `provenance.label`, the uncertain-level mark, `languages.note`, and
  `languages.warning.text` as a warning when present.
- **Dashboards**: the count beside each room's accuracy.

**The projector.** Nothing.

## Phase 5 follow-ups (19 Nov 2026)

Server only, no migration; every change is a field or a query option added, a default
order, a sentence reworded, or the room close going on past a store error. Checked end
to end on the in-process store by `decisions.mjs`, `honesty.mjs`, `insights.mjs`,
`keysafety.mjs` and `classquestion.mjs`, and by unit tests in `test/insights.test.js`
and `test/modes.test.js`. Nothing was run against Supabase, Mongo, a real Auth token or
a model.

| Route or event | What changed |
|---|---|
| `GET /api/classes/:id` (and the class body `PATCH /api/classes/:id` and `POST /api/classes` answer with) | `under18Note` whenever a student on the roster is marked under 18, removed students included |
| `GET /api/dashboard` (an HOD, a professor) | `levelBands` beside `bloom` |
| `GET /api/analytics` (an HOD, a professor) | Each subject row: `levelBands` |
| `GET /api/analytics/:id` (an HOD reading a professor, a professor reading a student) | `levelBands` beside `bloom`. A professor's `students` in roll order; `?order=accuracy` for highest accuracy first (new); any other `order` is a 400 |
| `GET /api/session/:code/insights`, `teacher:insights` | `sort.default: 'roll'`; `students` in roll order, as before |
| `class:question` | Sent phone by phone, each with its own `mine`, when the room is resumed and when the class question is paused (to the room at once with `mine: null` if the votes cannot be read) |
| `POST /api/session/:code/close` | A store error while closing the running class question is logged; the close still answers and the phones and the projector are still told |
| `PATCH /api/session/:code/projector` | Seven refusals reworded so none names a field |

**`under18Note` on a class read.** The sentence the writes already carried
("Integrity signals are neither recorded nor shown for a student marked under 18, …
a lawyer must confirm it before any college signs or before 13 May 2027.") now comes
with every class body whose roster holds a student marked under 18, so a screen opened
fresh and an HOD's read show it. A class with no marked student has no `under18Note`,
as before. A removed student counts: they are still the age they were, and their
signals stay hidden. The replies to the roster writes are unchanged.

**`levelBands` on the staff dashboards and analytics.** Decision 6's three level
bands, summed from the six-level `bloom` beside them by the `LEVEL_BANDS` the class
analytics and attainment reports use (`levelBandsOf` in
`services/classAnalytics.js`), in the shape class analytics sends them. `bloom` is
unchanged. Not sent to a student reading their own dashboard or analytics, whose
detail view stays six levels.

```json
"levelBands": [
  { "id": "lower", "label": "Remember and Understand", "levels": ["remember", "understand"], "answers": 6, "correct": 3, "accuracy": 0.5, "sentence": "Based on 6 graded answers." },
  { "id": "middle", "label": "Apply and Analyse", "levels": ["apply", "analyse"], "answers": 5, "correct": 5, "accuracy": 1, "sentence": "Based on 5 graded answers." },
  { "id": "higher", "label": "Evaluate and Create", "levels": ["evaluate", "create"], "answers": 0, "correct": 0, "accuracy": null, "sentence": "No graded answers yet." }
]
```

`answers` is the number of answers behind the band: the sum of its two levels' `seen`
in `bloom`, as `correct` is of their `correct`.

**Students in roll order.** `GET /api/analytics/:id` for a professor (an HOD's read)
lists `students` in roll order, numerically ('2' before '10'), where it listed highest
accuracy first. `?order=accuracy` gives the old order; `?order=roll` or none, roll
order; anything else is a 400 ("Students are listed in roll order, or by accuracy when
asked for: choose one of the two."), after the subject's 404, so an outsider learns
nothing from it. The insights' `students` were already in roll order (every store lists
a room's profiles that way); `sort.default` now says so, and `sort.keys` and
`sort.orders` are unchanged, "By band" and "Lowest first" included. Decided under the
owner's delegation (`docs/PRODUCT_DECISIONS.md`, honest indicators, question 1).

**Each phone's own `mine`.** `class:question` used to go to the whole room at once
with `mine: null` after `POST /api/session/:code/resume` and when the professor paused
the class question, so a phone that reloaded during a pause could not show the vote
the server held. Both now send it phone by phone, each with its own vote in force in
the current round (round 1 while paused), by the rule a join uses: under a roll number
a signed-in student's phone linked, a phone not signed in as her is sent `mine` only
from votes of phones not signed in (decision 7). The room's votes and profiles are
read once, not per phone; if that read fails, the error is logged and the room is sent
the question at once with `mine: null`, as before, so no phone keeps voting in a round
that has closed. The start and the re-vote still go to the room at once, with
`mine: null`, since nobody has voted in a round that has just opened.

**A room's close when the store fails.** `POST /api/session/:code/close` writes the
room closed, then closes its running class question. A store error in that step
(reading or updating the class question) is now logged (`[close] closing the class
question failed`) and the close goes on: `200` with the closed room, `session:closed` to
the phones, `teacher:status` to the professor's screens and `projector:closed` to the
projector. The class question is then left as the store had it, and can still be
closed by hand. Before, the step's error answered `500` for a room already closed and
nobody was told.

**Projector refusals in a professor's words** (`PATCH /api/session/:code/projector`):

| When | Before | Now |
|---|---|---|
| `revealed`, `showNames` or `showCounts` not true or false | "showNames must be true or false." | "Showing the picked student's name is either on or off." (and likewise "Showing the answer on the projector …", "Showing a class question's counts …") |
| An unknown screen | "mode must be one of question, diagram, progress." | "The projector shows a question, a diagram or the class's progress: choose one of those." |
| A diagram from a question the room does not serve | "diagram.questionId is not a question this room serves: pick one of its approved questions." | "That question is not one this room serves, so its diagram cannot be shown: pick one of its approved questions." |
| A pick not of this room's wheel | "pick.pickId is not a pick of this room's wheel." | "That pick is not one of this room's wheel." |
| Nothing to change | "Send mode, question, revealed, diagram, showNames, showCounts or pick to change." | "Nothing was changed: choose what the projector shows, or switch the answer, names or counts on or off." |
| A question the room does not serve | "question.questionId is not a question this room serves: pick one of its approved questions." | "That question is not one this room serves: pick one of its approved questions." |
| A question asked aloud of another room | "question.tallyId is not a question asked aloud in this room." | "That question was not asked aloud in this room: choose one that was." |

## Phase 6: the Learning Hub

Server and database only, committed as `646b4e6` with migrations `0025` to `0029`
(`docs/DATABASE_SCHEMA.md`). Every route here is new and lives under `/api/hub`; the
only changed room payloads are the additive `question.rich` on `server:question` and
`class:question` (below). The decisions behind it are H1 to H18
(`docs/PRODUCT_DECISIONS.md`, Phase 6); how it is built, `docs/ARCHITECTURE.md`,
"Learning Hub (Phase 6)".

**Tested, and not.** Exercised over HTTP on a real server (the production `createApp`
and `attachSockets`), on the in-process store, with signed-in callers answered
in-process as `roster.mjs` does, by `server/scripts/hub.mjs` (78 checks),
`practice.mjs` (78), `paths.mjs` (88), `lessons.mjs` (100) and `tutor.mjs` (84), and
unit-tested by nine new test files (219 tests); all passing on 19 November 2026
(`docs/TESTING.md`). **Nothing was run against Supabase, Mongo, a real Auth token or
a model.** Accounts work only through the scripts' in-process stand-in for Supabase
Auth. Every model path (link proposals, lessons, translations, explanations, hints)
was tested with fixture replies through the real parsers; the live Gemini calls
never ran. No screen exists for any of it.

The examples are real responses, captured on 19 November 2026 from a server on the
in-process store with no model, a professor, the department's HOD and one rostered
student answered in-process, nothing off the machine (a throwaway script, not kept).
Long arrays and MathML are shortened with `…`. Ids are 24-character hex; on Supabase
they are uuids.

### Who may call it

**Accounts only (H1).** Every hub router sits behind one gate (`hubGate`,
`routes/hub.js`):
- without Supabase, every route answers **503** "The learning hub needs student and
  staff accounts, and this server has none set up.";
- with no token, or with the shared teacher key, **401** "Sign in to continue.". The
  teacher key reaches nothing here, and a room phone (a typed roll number, no token)
  never reaches the hub.

**Who reaches a class** is one rule (`services/hubAccess.js`). A student reaches a
class when its owner is the professor the student reports to (`accounts.reports_to`)
and the class roster holds the student's roll number (matched as a room reads it),
not removed. The owner reads and writes. The department's HOD reads and gets **403**
on every write ("You can read this class's hub but not change it: only the professor
who owns it can."). Anyone else gets the same **404** as for something that does not
exist, word for word, one sentence per kind:

| Kind | The 404 |
|---|---|
| class, unit, chapter, topic, link | "That class was not found." (and "That unit / chapter / topic / link was not found.") |
| lesson, question, translation, item | "That lesson was not found.", "That question was not found.", "That translation was not found.", "That item was not found." |
| a student's Get Ready check, self-test, goal | "That Get Ready check was not found.", "That self-test was not found.", "That goal was not found." |
| a roster row on a staff read | "That student was not found." |
| a background run not started by the caller | "No such run." |

A student on a staff route gets **403** "This is for a professor or an HOD only."
before anything is read; staff on a student-only route get **403** too (practice:
"Practice is for a student account. Staff see their students' progress through the
class."). Captured:

```json
GET /api/hub (no token, or x-teacher-key)                 401 { "error": "Sign in to continue." }
GET /api/hub/classes/:id/progress (the student)           403 { "error": "This is for a professor or an HOD only." }
POST /api/hub/classes/:id/units (the HOD)                 403 { "error": "You can read this class's hub but not change it: only the professor who owns it can." }
```

**What a student is sent (H2).** Approved material only: placed chapters, live (not
retired) topics, confirmed links, approved questions through `forStudent` (no key
before an attempt), approved lessons, translations, explanations, hints and option
feedback. Never a draft, a proposed or rejected link, a misconception label, a model
name or a finding, nor the raw deck: slide text reaches a student only inside an
approved lesson. **Never a rank, a class average, a streak, coins or a band name**
(H16; checked by `paths.mjs` and the unit tests). Student screens must never call
`/api/content`, `/api/classes` or `/api/bank` (each answers 403 to a student).

**Ids a device makes.** An `attemptId` (every answer, and the hints opened before it)
and a `clientRunId` (a Get Ready check or a self-test) are 8 to 64 of `A-Z a-z 0-9 -
_`, made on the device. They are the idempotency keys (H5, Phase 7's outbox): the first
send is **201**; a resend of the same id is **200** with `duplicate: true` and the
stored result, never a second row. An id kept for something else is a **409** "That
attempt id was used for another answer. Send this one with a new id." (practice and
lessons; the practice route keeps its older sentence for a self-test's id, "That
answer belongs to a self-test; its result comes when the self-test is handed in.").

**Closed questions** (the fix after the review, `services/hubClosed.js`; (a), the
sentences about a room and the resend rule corrected for Batch 9, E1). A question
is closed to a student while (a) it is in the question set of a room on its chapter
that is not closed (open, paused or waiting), or, for a room with no set, among the
chapter's questions that room can serve (every student, not only those in the room:
rooms need no sign-in, decision 7); (b) it is on one of
the student's open self-tests; or (c) one of their open Get Ready checks is asking it.
While it is closed:
- `GET /practice/next` never serves it; with nothing else left, `question: null` and
  the message "Every question you could practise here is closed for now: part of a
  class that is still running, on a self-test you have not handed in, or the one your
  Get Ready check is asking. Come back once that is done.";
- an answer to it in practice, a review set or a lesson is a **409** with one of three
  sentences, and **nothing is stored** (the device keeps it and sends it later):
  "That question is part of a class that is still running, so it stays closed here. It
  opens when your professor closes the class.", "That question is on a self-test you have not handed in yet,
  so it stays closed here until you hand it in." or "That question is the one your Get
  Ready check is asking now, so it stays closed here until you answer it there.";
- a hint on it is the same **409**, and the next question's `hints` say
  `available: 0` with the sentence;
- Get Ready skips questions closed by a room or a self-test (with none left on the
  topic, `question: null` and a `waiting` sentence) and refuses an answer to one;
- a self-test result item, and an error-log entry, whose question a running room
  holds keep back its key and explanation (`held: true` / `keyHeld`, with "This question
  is part of a class that is still running, so what was right, and why, is shown here
  once your professor closes the class.").

A resent **practice** attempt id (same question, practice mode) whose question has
closed since keeps its earlier mark but, since Batch 9, not its key: `solution`,
`explanation` null, `optionFeedback` `[]`, with `held: true` and `heldNote`. Captured
(before Batch 9), practice on a question of the student's open self-test:

```json
POST /api/hub/practice/attempts   409
{ "error": "That question is on a self-test you have not handed in yet, so it stays closed here until you hand it in." }
```

**HTML fields.** Every name or title a hub payload carries comes twice: plain
(`name`, `title`, `text`) for search, aria labels and answering, and as server-made
HTML (`nameHtml`, `titleHtml`, `textHtml`, `reasonHtml`, `html`, `rich`). Since 19
November 2026 the staff review queues do too (explanations, hints and feedback,
lessons, translations): a question's `textHtml` and `topicHtml`, an option's
`optionHtml`, a chapter's `titleHtml`, and a translation's `englishHtml` and
`fieldsHtml`; before, they sent the plain text only, so a formula showed as its source
there. The HTML is
escaped text, with `$…$` and `$$…$$` (and `\ce{}`) as MathML from temml (trust off) and
fenced code highlighted by shiki; it carries inline `style` attributes and never
script. `\label`, `\ref` and `\eqref`, and any output with an `id=` or `href=`
attribute, are shown as the formula's escaped source. A formula that cannot be read is
its escaped source in `<span class="rich-tex-error">`.

### Every new endpoint

**The content backbone (H1 to H4)**, `routes/hub.js`. Every write replies with the
fresh staff view (`hub`), so a screen redraws from one reply.

| Route | Who | Body → reply; refusals |
|---|---|---|
| `GET /api/hub` | any account | Student: `{ role: 'student', notice, classes: [studentClassView], empty? }`. Staff: `{ role, classes: [{ id, courseName, section, termLabel, canEdit, units, chapters }] }` (a professor's own; an HOD's department) |
| `GET /api/hub/classes/:classId` | a student on it, the owner, the HOD | Student: `{ class: { id, courseName, section, termLabel }, units: [{ id, name, nameHtml, chapters: [{ id, title, titleHtml, topics: [{ id, name, nameHtml }] }] }], otherChapters: { label: 'Other chapters', chapters }, empty?, notice }`. Staff: `staffClassView` (`class` with `canEdit`, `access`; units with `position`; each chapter's kind, slides note, topics with `retired`, question counts `{ active, draft }`, link counts, `unsynced`, `unmatchedQuestions`; `otherChapters`; `available`, the owner's chapters not yet placed; `notes`). Staff with `?view=student` get the student shape plus `preview` |
| `POST /api/hub/classes/:classId/units` | owner | `{ name }` → 201 `{ unit: { id, name, position }, hub }`. 409 a duplicate name (case ignored); 400 blank, over 80 characters, contact details, or over 40 units |
| `PATCH /api/hub/classes/:classId/units/:unitId` | owner | `{ name }` → `{ unit, hub }`. A unit of another class is the unit's 404 |
| `DELETE /api/hub/classes/:classId/units/:unitId` | owner | `{ removed: true, message, hub }`; its chapters move to "Other chapters" |
| `PUT /api/hub/classes/:classId/units/order` | owner | `{ unitIds }`, every unit once → `{ hub }`; 400 otherwise |
| `PUT /api/hub/classes/:classId/chapters/:contentId` | owner, and only the class owner's own chapter (else the chapter's 404) | `{ unitId?: id \| null, position?: integer ≥ 1 }` → 201 when newly placed, 200 when moved: `{ placed: true, topics?: { added, retired }, hub }`. Leaving `unitId` out keeps the current unit (none for a new chapter). Nothing reaches a student until placed |
| `DELETE /api/hub/classes/:classId/chapters/:contentId` | owner | `{ removed: true, message, hub }`; the chapter itself is unchanged |
| `GET /api/hub/chapters/:contentId` | a student while it is placed on one of their classes, the owner, the HOD | Student: `{ chapter: { id, title, titleHtml, topics } }`. Staff: the staff chapter view with `canEdit` |
| `POST /api/hub/chapters/:contentId/topics/sync` | the chapter's owner | `{ added, restored, retired, removed, skipped, retiredNote?, chapter }` |
| `GET /api/hub/topics/:topicId` | a student (topic not retired, chapter placed on their class), the owner, the HOD | `{ topic: { id, name, nameHtml, chapter }, prerequisites: [{ id, name, nameHtml, chapter, depth, via, onYourClasses }] (nearest first, confirmed links only; `onYourClasses` for students), leadsTo, note }`. Staff also get `links: { prerequisites, dependants }` in every state, with `label`, `provenance`, `reason`, `reasonHtml` |
| `GET /api/hub/links` | staff | `?state=`, `?contentId=` → `{ links: [linkView], counts: { proposed, confirmed, rejected } }`; without `contentId`, a professor's own links, an HOD's department's |
| `POST /api/hub/links` | owner of both topics' chapters | `{ prerequisiteId, topicId }` → 201 `{ link }` (professor, confirmed); 200 when it confirms an existing proposed or rejected link of the pair. 409 with a sentence naming the chain for a loop or a topic before itself; 400 a retired topic; HOD 403; another professor "That topic was not found." |
| `PATCH /api/hub/links/:linkId` | owner | `{ state: 'confirmed' \| 'rejected' }` → `{ link }`; confirming a loop is the 409 |
| `DELETE /api/hub/links/:linkId` | owner | `{ removed: true, message }` |
| `POST /api/hub/links/propose` | owner (the professor's button) | `{ contentIds: 1 to 10 own chapters, runId? }` → `{ runId, source: 'llm' \| 'offline', note, proposed: [linkView], skipped: [{ prerequisite, topic, why }], warnings, topicsShown }`. Direct links only; offline proposes none and `note` says why |
| `GET /api/hub/links/run/:runId` | the professor who started it | `{ run }`, as `/api/generate/run` |

Captured, the owner adding a link by hand, then its reverse:

```json
POST /api/hub/links   201
{ "link": { "id": "482d36…", "prerequisite": { "id": "5cdb8f…", "name": "Sets", "nameHtml": "Sets", "chapter": { "id": "8ce873…", "title": "Discrete structures", "titleHtml": "Discrete structures" } },
            "topic": { "id": "c2a8a4…", "name": "Relations", "nameHtml": "Relations", "chapter": { "…": "as above" } },
            "provenance": "professor", "state": "confirmed", "label": "Added by the professor", "reason": "", "reasonHtml": "",
            "createdAt": "2026-11-19T13:44:02.489Z", "decidedAt": "2026-11-19T13:44:02.488Z" } }
POST /api/hub/links   409
{ "error": "\"Relations\" cannot come before \"Sets\": the confirmed links already put \"Sets\" before \"Relations\", so this link would make a loop. A topic cannot be needed before itself." }
```

The student's hub and a topic:

```json
GET /api/hub   200
{ "role": "student",
  "notice": "Your professor can see your progress in the hub: the topics you practise and how you are doing on them.",
  "classes": [{ "class": { "id": "a98626…", "courseName": "Discrete Maths", "section": "SY A", "termLabel": "" },
                "units": [{ "id": "df69db…", "name": "Unit 1: Sets and relations", "nameHtml": "Unit 1: Sets and relations",
                            "chapters": [{ "id": "8ce873…", "title": "Discrete structures", "titleHtml": "Discrete structures",
                                           "topics": [{ "id": "5cdb8f…", "name": "Sets", "nameHtml": "Sets" }, { "id": "c2a8a4…", "name": "Relations", "nameHtml": "Relations" }, "…"] }] }],
                "otherChapters": { "label": "Other chapters", "chapters": [] } }] }
GET /api/hub/topics/:topicId   200
{ "topic": { "id": "c2a8a4…", "name": "Relations", "nameHtml": "Relations", "chapter": { "…": "…" } },
  "prerequisites": [{ "id": "5cdb8f…", "name": "Sets", "nameHtml": "Sets", "chapter": { "…": "…" }, "depth": 1, "via": ["c2a8a4…"], "onYourClasses": true }],
  "leadsTo": [],
  "note": "Prerequisites are the topics your professor confirmed are needed first, nearest first." }
```

`onYourClasses: false` marks a prerequisite from the professor's chapters on none of
the student's classes (an earlier semester): its name and chapter title are sent, and
the chapter and topic themselves still answer 404 to that student.

**Practice, mastery, the error log and reviews (H5 to H8, H14)**,
`routes/hubPractice.js`. Students only unless marked staff.

| Route | Who | Body → reply; refusals |
|---|---|---|
| `GET /api/hub/practice/next?topicId=` (or `topicIds=a,b`) `&mode=practice\|review` | student | `{ mode, language, translationId, languageNote, question: forStudent fields + provenance + rich (never a key), topic, topics, why, hints: { available: 0..3, note }, setSize (review) }`; `{ question: null, topics, message }` when no approved question exists or all are closed. A topic not theirs: "That topic was not found." |
| `POST /api/hub/practice/attempts` | student | `{ attemptId, questionId, topicId, response, mode: 'practice' \| 'review', timeTakenMs?, shown?: { language, translationId } }` → 201 `{ attempt: { id, attemptId, mode, createdAt, language, hintsUsed }, duplicate: false, correct, score, detail, provisional?, provisionalNote?, solution (shown positions), explanation: { text, textHtml, by, label, note, language } \| null, optionFeedback, topic: { …, state } }`; 200 with `duplicate: true` on a resend; 409 an id of another answer, a self-test's id, or a closed question; 404 the topic or question (a draft, a poll, an image question, another topic); 400 validation, or a response over 20,000 characters |
| `GET /api/hub/progress` | student | `{ notice, basis, states, counts, topics: [{ id, name, nameHtml, chapter, classIds, practiceQuestions, state: { state, label, answers (N), attempts, provisional, pRight, outOf10, estimateState, sentence, bankShort?, review: { dueAt, due, when, sessions, lastRating } } }] }` |
| `GET /api/hub/review/due` | student | `{ due: [{ id, name, nameHtml, chapter, state, label, answers, review, practiceQuestions }] (most overdue first), upcoming (due within 7 days), setSize: 5, rule, empty? }` |
| `GET /api/hub/errors?status=open\|cleared&topicId=` | student | `{ entries: [{ id, status, from: 'practice' \| 'class', fromLabel, topic, level, levelLabel, times, firstAt, lastAt, clearedAt, clearedBy, question (as shown, with rich, no key), response, solution, provisional?, prerequisites: [{ id, name, nameHtml, depth, onYourClasses }] (nearest first), sentence, explanation, keyHeld? }] (newest first), counts: { open, cleared }, openByTopic, rule }`. `onYourClasses` (19 Nov 2026) is false for a prerequisite from a chapter on none of the student's classes, as on the topic view; the staff read of a student's log has no `onYourClasses` |
| `GET /api/hub/consistency?weeks=1..26` | student | `{ weeks: [{ start (a Monday), end, days: [{ day, practised, attempts, upcoming }], practisedDays, restDays, attempts, sentence }] (newest first), note }`; no streak anywhere |
| `GET /api/hub/classes/:classId/progress` | staff: the owner, the HOD | `{ class: { …, canEdit, access }, topics: [{ …, unit, practiceQuestions, counts: { <state>: n }, openErrors }] (layout order), students: [{ rosterId, rollNo, name, accountId \| null, note?, topics: { <topicId>: { state, label, answers, provisional, pRight, openErrors } }, activity: { …, hintsUsed, attemptsWithHints } }] (roll order), states, notes }` |
| `GET /api/hub/classes/:classId/students/:studentId/progress` | staff | `studentId` is the roster row id → `{ class, student: { rosterId, rollNo, name, accountId }, topics, activity: { total, last7Days, last30Days, daysActiveLast7, byMode, lastAt, hintsUsed, attemptsWithHints }, errors: { entries (each with questionId), counts, openByTopic, rule }, states }`, or a `note` and no data when no single account carries the roll number |
| `GET /api/hub/chapters/:contentId/explanations` | staff | `{ chapter: { id, title, titleHtml }, canEdit, questions: [{ questionId, text, textHtml, topic, topicHtml, bloom, kind, status, explanation: { text, textHtml, provenance, status, label, model, … } \| null }] (no polls, no discarded), counts: { approved, draft, none }, note }` |
| `PUT /api/hub/questions/:questionId/explanation` | the chapter's owner | `{ text }` (1 to 2000 characters) → 201 or 200 `{ explanation }`, approved as written, provenance professor; 400 a poll |
| `POST /api/hub/questions/:questionId/explanation/approve` | owner | `{ explanation }`, approved, provenance kept `ai`; 404 when none |
| `DELETE /api/hub/questions/:questionId/explanation` | owner | `{ removed: true, message }`; 404 when none |
| `POST /api/hub/explanations/generate` | owner | `{ contentId }` or `{ questionIds: 1..60 }`, `runId?` → `{ runId, source, note, drafted: [AI drafts], skipped: [{ questionId, why }], warnings }`; offline, `drafted: []` and `note` says so |
| `GET /api/hub/explanations/run/:runId` | the run's owner | `{ run: { state, planned, written, topicsDone, topicsTotal, elapsedMs, error } }` |

Hub choice questions are served in the bank's order (no shuffle), with the seed
`hub:<account id>:<question id>` for any kind that is reordered, so the error log
redraws an answer exactly as it was shown. Captured, a practice question with a
formula, a wrong answer, and its resend:

```json
GET /api/hub/practice/next?topicId=5cdb8f…   200
{ "mode": "practice", "language": "en", "translationId": null, "languageNote": null,
  "question": { "_id": "4e701e…", "text": "How many elements has $\\{1, 2, 2, 3\\}$?", "bloom": "understand", "topic": "Sets", "kind": "mcq",
                "source": "teacher", "options": ["2", "3", "4", "5"],
                "provenance": { "by": "professor", "checked": true, "text": "Written by your professor." },
                "rich": { "text": "How many elements has <math><mrow><mo fence=\"true\" form=\"prefix\" stretchy=\"false\">{</mo><mn>1</mn>…</mrow></math>?" } },
  "topic": { "id": "5cdb8f…", "name": "Sets", "nameHtml": "Sets", "chapter": { "…": "…" } }, "topics": ["…"],
  "why": "You have not practised this topic yet, so this question starts near its middle.",
  "hints": { "available": 0, "note": "Your professor has not added hints to this question." } }
POST /api/hub/practice/attempts   201   (a resend of the same attemptId: 200, "duplicate": true, the same body)
{ "attempt": { "id": "c3901a…", "attemptId": "doc-attempt-0001", "mode": "practice", "createdAt": "2026-11-19T13:44:02.588Z", "language": "en", "hintsUsed": 0 },
  "duplicate": false, "correct": false, "score": 0, "detail": "", "solution": 1, "explanation": null, "optionFeedback": [],
  "topic": { "id": "5cdb8f…", "name": "Sets", "…": "…",
             "state": { "state": "not-sure", "label": "Not sure yet", "answers": 1, "attempts": 1, "provisional": true, "pRight": null, "outOf10": null,
                        "estimateState": "not-sure", "sentence": "Not sure yet: this rests on 1 answer. After 3 answers you get a first estimate.",
                        "review": { "dueAt": "2026-11-19T13:45:02.588Z", "due": false, "when": "in 1 minute", "sessions": 1, "lastRating": "again" } } } }
```

The review is due a minute later: that is FSRS's default learning step, not a fault
(the screen should say a short second session soon after the first is part of
learning). The entry it made in the error log:

```json
GET /api/hub/errors   200
{ "entries": [{ "id": "practice:c3901a…", "status": "open", "from": "practice", "fromLabel": "From your practice",
                "topic": { "…": "…" }, "level": "understand", "levelLabel": "Understand", "times": 1,
                "firstAt": "2026-11-19T13:44:02.588Z", "lastAt": "2026-11-19T13:44:02.588Z", "clearedAt": null, "clearedBy": null,
                "question": { "text": "How many elements has $\\{1, 2, 2, 3\\}$?", "…": "…", "rich": { "text": "…" } },
                "response": 0, "solution": 1, "prerequisites": [],
                "sentence": "Answered wrong in practice. It clears when you get another question on this topic right at Understand or above.",
                "explanation": null }],
  "counts": { "open": 1, "cleared": 0 }, "openByTopic": { "5cdb8f…": 1 },
  "rule": "An entry clears when a different question on the same topic, at its level or above, is answered right." }
```

A "From class" entry (a wrong verified room answer) carries `keyHeld`, with `solution`
and `explanation` null, while a room is asking its question, or while the question is
still active in the bank but practice cannot serve it to this student (an image
question, say); retired or deleted since, it shows its key. Staff views are
unchanged. When a topic has too few practisable questions for the next state, the
state carries `bankShort: true` and its sentence says the topic needs more approved
questions.

**Get Ready, refresher paths, self-tests, goals and the hub home (H9, H10, H16,
H17)**, `routes/hubPaths.js`.

| Route | Who | Body → reply; refusals |
|---|---|---|
| `GET /api/hub/home` | student | `{ notice, basis, states, counts, classes: [{ class, units: [{ id, name, nameHtml, chapters: [{ id, title, titleHtml, topics: [{ id, name, nameHtml, practiceQuestions, state: { state, label, answers, provisional, outOf10, sentence }, review: { due, dueAt, when } }] }] }], otherChapters }], reviews: { due, upcoming, setSize, rule }, goals: { goals, note, max } \| { unavailable }, paths: { paths: [{ checkId, target, endedAt, steps, done, next, nextName, sentence }] } \| { unavailable }, weeks: { weeks (4), note }, bloomLevels: { levels: [{ level, label, now: { answers, right, accuracy }, monthAgo: { answers, right, accuracy }, change, provisional, sentence }], monthAgo, basis, note } \| { levels: [], basis, note, unavailable }, empty? }` (`bloomLevels`: below) |
| `POST /api/hub/getready` | student | `{ clientRunId, targetTopicId }` → 201 (200 resend, `duplicate: true`) `{ duplicate, check: { id, clientRunId, startedAt, endedAt, status: open \| complete, asked, maxQuestions: 12, rule }, target, prerequisites: [{ topic, depth, status: asking \| waiting \| decided, outcome: ready \| needs-review \| not-sure \| null, label, answers, right, source: check \| practice \| none, provisional, sentence }], sentence, question: { question, language, translationId, languageNote, topic, why, hints: { available: 0, note } } \| null, waiting?, path (once complete) }`. 400 a bad id or no target; 404 the topic; 409 the id of a self-test |
| `GET /api/hub/getready?topicId=` | student | `{ checks: [{ id, clientRunId, target, startedAt, endedAt, status, asked, counts: { ready, needs-review, not-sure }, sentence }] (newest first), rule }` |
| `GET /api/hub/getready/:checkId` | the student who started it | The check as above. Once complete, `path: { steps: [{ topicId, name, topic, depth, why, status: done \| in-progress \| to-do, answers, right, sentence }], target: { topic, status: ready \| waiting, sentence }, next, done, total, rule }` |
| `POST /api/hub/getready/:checkId/answers` | the student who started it | `{ attemptId, questionId, response, timeTakenMs?, shown? }` → 201 (200 resend) practice's feedback (`correct`, `solution`, `explanation`, `optionFeedback`, `topic.state`) plus `check`, the check after it. 404 "That question was not found." for a question not on the prerequisite being checked or already asked; 409 "This Get Ready check is complete. Start a new one to check again.", an id of another answer, or a closed question |
| `POST /api/hub/exams` | student | `{ clientRunId, topicIds (1 to 20), levels? (default all six), count? (1 to 30, default 10), timeLimitMinutes? (1 to 180) }` → 201 (200 resend) `{ duplicate, exam: { id, clientRunId, startedAt, timeLimitMinutes, deadlineAt, secondsLeft, endedAt, endReason, status, topics, levels, total, shortNote? }, questions: [{ position, questionId, topic, question, language…, answered, response, answeredAt } \| { removed, sentence }], answered, hints: { available: 0, note }, note }`. No key, mark or explanation. 400 when none of the professor's approved questions match; 404 a topic |
| `GET /api/hub/exams` | student | `{ exams: [head + answered (+ right, sentence once ended)], limits: { maxQuestions, maxMinutes, graceSeconds } }` newest first; a timed-out one is ended on this read |
| `GET /api/hub/exams/:examId` | the student who started it | Open: as `POST /exams`. Ended: `{ exam, ended, questions: [{ position, questionId, topicId, topic, bloom, levelLabel, question, answered, response, correct, score, detail, mark: auto \| provisional \| unmarked, markLabel, solution, explanation, optionFeedback, held?, heldNote? }], summary: { overall, byTopic, byLevel }, lateNote?, note }`. An unanswered question keeps its key and explanation hidden |
| `POST /api/hub/exams/:examId/answers` | the student who started it | `{ attemptId, questionId, response, timeTakenMs?, shown? }` → 201 (200 resend) exactly `{ saved, duplicate, late, attempt: { id, attemptId, createdAt }, answered, total, status, message? }`, no mark of any kind. A change of answer is a new attempt; the last before the end counts. A late answer is stored, `late: true`, and not counted. 404 a question not on the list; 409 an id of another answer |
| `POST /api/hub/exams/:examId/submit` | the student who started it | The result, as `GET` when ended. A second submit changes nothing |
| `GET /api/hub/goals` | student | `{ goals: [{ id, title, titleHtml, examDate, daysLeft, past, counts, topics: [{ topic, state, review } \| { id, unavailable, sentence }], focus, sentence, createdAt, updatedAt }] (soonest first), note: 'Only you see your goals.', max: 10 }` |
| `POST /api/hub/goals` | student | `{ title?, examDate (YYYY-MM-DD, today or later), topicIds (1 to 60) }` → 201 `{ goal }`. 400 a bad or past date; 404 a topic; 409 over 10 goals |
| `PATCH /api/hub/goals/:goalId` | the student who owns it | `{ title?, examDate?, topicIds? }` → `{ goal }` |
| `DELETE /api/hub/goals/:goalId` | the student who owns it | `{ removed: true, message }`; a second removal is the 404 |
| `GET /api/hub/classes/:classId/states` | staff: the owner, the HOD | `{ class: { …, canEdit, access }, topics: [{ id, name, nameHtml, chapter, unit, practiceQuestions, counts, openErrors, students: { <state>: [{ rosterId, rollNo, name, answers, provisional }] } }], noAccount: [{ rosterId, rollNo, name, note }], states, notes }`, roll order |
| `GET /api/hub/classes/:classId/students/:studentId/getready` | staff | `{ class, student, checks: [{ id, target, startedAt, endedAt, status, asked, counts, prerequisites (sentences about the student), sentence, path \| null }], note }`; a roster row with no account, `checks: []` and a note. Writes nothing |

**The home's Bloom levels** (`bloomLevels`, 19 Nov 2026; the zip's "Your Bloom levels ·
tick = last month"). Per level, in ladder order, the student's own right answers of
those asked as they stand now (`now`) and as they stood 30 days ago (`monthAgo`, the
tick), each cumulative to its moment; `accuracy` is a fraction, null with no answers.
Counted: their hub attempts that count (a self-test's only once it has ended, as it
stood at each moment) and the room answers a phone signed in as them sent (final,
marked, not a class vote); a room answer under a typed roll number never counts.
`change` is now minus a month ago in whole percentage points, and null unless both rest
on at least 3 answers; `provisional` is true under 3 answers now. Own data only: no
class figure, no average, no rank, no band. Sentences from the unit test
(`server/test/hubPractice.test.js`), not captured from a running server:

```json
{ "levels": [
    { "level": "apply", "label": "Apply", "now": { "answers": 7, "right": 6, "accuracy": 0.8571428571428571 }, "monthAgo": { "answers": 4, "right": 3, "accuracy": 0.75 },
      "change": 11, "provisional": false, "sentence": "6 of 7 right at Apply (86%), up 11 percentage points from 3 of 4 (75%) a month ago." },
    { "level": "remember", "…": "…", "sentence": "1 of 2 right at Remember so far: too few answers to say much yet." },
    { "level": "create", "…": "…", "sentence": "No answers at Create yet." }, "…"],
  "monthAgo": "2026-11-29T10:00:00.000Z",
  "basis": "From your answers in the hub and the ones you gave in class rooms while signed in on your phone.",
  "note": "Compared with your own answers a month ago only. Nobody else is in these figures." }
```

The other sentences: "… (n%). You had no answers at this level a month ago.", "… (n%). A
month ago you had too few answers at this level to compare with." and "… (n%), the same
as a month ago.".

Get Ready's rule (`check.rule`, captured): "The check asks at most 12 questions, about
the topics this one needs first, nearest first. Two right answers in a row on a topic
make it Ready and two wrong make it Needs review; after one of each, a third question
decides (two of three right is Ready). A topic you have already mastered in practice
is Ready without asking. A topic the check could not decide is Not sure yet." Not sure
yet comes with one of six reasons, each with its own sentence: the 12 questions ran
out, the check never reached it, too few approved questions, none, material on none of
the student's classes, or the check ended first. Once a check's end is written it stays
as it ended. A refresher step is done when the student's answers on it since the check
are two right in a row, or two right of their last three, a repeated question counting
once per round.

```json
POST /api/hub/getready   201
{ "duplicate": false,
  "check": { "id": "dc43bf…", "clientRunId": "doc-check-0001", "startedAt": "2026-11-19T13:44:02.615Z", "endedAt": null,
             "status": "open", "asked": 0, "maxQuestions": 12, "rule": "The check asks at most 12 questions, …" },
  "target": { "id": "c2a8a4…", "name": "Relations", "…": "…" },
  "prerequisites": [{ "topic": { "id": "5cdb8f…", "name": "Sets", "…": "…" }, "depth": 1, "status": "asking", "outcome": null, "label": null,
                      "answers": 0, "right": 0, "source": "none", "provisional": true, "sentence": "Being checked now." }],
  "sentence": "Checking the topics \"Relations\" needs first: 0 questions asked of at most 12.",
  "question": { "question": { "_id": "687448…", "text": "What is $\\{1,2\\} \\cap \\{2,3\\}$?", "kind": "mcq", "…": "…",
                              "rich": { "text": "What is <math>…</math>?", "options": ["<math>…</math>", "…"] } },
                "language": "en", "translationId": null, "languageNote": null, "topic": { "…": "…" },
                "why": "Checking \"Sets\", which \"Relations\" needs first.", "hints": { "available": 0, "note": "…" } } }
```

A self-test answer, and the result after hand-in (one question answered, one not):

```json
POST /api/hub/exams/:examId/answers   201
{ "saved": true, "duplicate": false, "late": false, "attempt": { "id": "a2704e…", "attemptId": "doc-exam-ans-01", "createdAt": "2026-11-19T13:44:02.636Z" },
  "answered": 1, "total": 2, "status": "open" }
POST /api/hub/exams/:examId/submit   200
{ "exam": { "id": "407dd5…", "status": "ended", "endReason": "submitted", "endedAt": "2026-11-19T13:44:02.652Z", "total": 2, "…": "…" },
  "ended": "You handed this self-test in.",
  "questions": [
    { "position": 1, "questionId": "bf1ee6…", "bloom": "understand", "levelLabel": "Understand", "question": { "…": "…" },
      "answered": true, "response": 0, "correct": true, "score": 1, "detail": "", "mark": "auto",
      "markLabel": "Marked by the computer from your professor's answer.", "solution": 0, "explanation": null, "optionFeedback": [] },
    { "position": 2, "questionId": "48f4b8…", "bloom": "remember", "levelLabel": "Remember", "question": { "…": "…" },
      "answered": false, "response": null, "correct": null, "score": null, "detail": "", "mark": "unmarked",
      "markLabel": "Not answered, so not marked. Its answer is shown once you have tried it, in practice or in another self-test.",
      "solution": null, "explanation": null, "optionFeedback": [] }],
  "summary": { "overall": { "questions": 2, "answered": 1, "right": 1, "provisional": 0, "unmarked": 1, "sentence": "1 of 2 questions right; 1 not answered." },
               "byTopic": ["…"], "byLevel": ["…"] },
  "note": "…" }
```

A student who no longer reaches a question's topic (taken off the roster, the chapter
taken off the class, the topic retired) does not see it while the self-test is open
(`removed: true`, "This question's chapter is no longer on your classes in the hub, so
it is not asked."); in the result, unanswered questions of that kind are left out and
answered ones show from the student's own attempt.

The staff view of students by state (captured, one topic):

```json
GET /api/hub/classes/:classId/states   200
{ "class": { "id": "a98626…", "courseName": "Discrete Maths", "section": "SY A", "termLabel": "", "canEdit": true, "access": "owner" },
  "topics": [{ "id": "5cdb8f…", "name": "Sets", "…": "…", "practiceQuestions": 3,
               "counts": { "not-started": 0, "not-sure": 1, "in-progress": 0, "mastered": 0, "needs-review": 0 }, "openErrors": 1,
               "students": { "not-sure": [{ "rosterId": "0fd4a5…", "rollNo": "21CS01", "name": "…", "answers": 1, "provisional": true }], "…": [] } }],
  "noAccount": [],
  "states": { "not-started": "Not started", "not-sure": "Not sure yet", "in-progress": "In progress", "mastered": "Mastered", "needs-review": "Needs review" },
  "notes": { "order": "Students are listed in roll order. Nothing here ranks them.",
             "basis": "Each state rests on the student's answers in the hub (N is how many). Answers in rooms are not counted in it; wrong ones show in the student's error log, marked \"From class\".",
             "students": "A student appears here once their account reports to the class's professor and the roster holds their roll number." } }
```

**Lessons (H11)**, `routes/hubLessons.js`.

| Route | Who | Body → reply; refusals |
|---|---|---|
| `GET /api/hub/topics/:topicId/lesson` | a rostered student (in their chosen language); staff preview with `?lang=en\|hi\|mr` | `{ topic: { id, name, nameHtml }, lesson: null \| { id, version, approvedAt, label, language: { requested, language, translationId, note }, steps: [ { type: 'chunk', cite, text, html } \| { type: 'example', cite, label, problem, problemHtml, steps: [{ text, html }], answer, answerHtml } \| { type: 'questions', cite, questions: [forStudent + rich + provenance + language + hints: { available, note } + closed?: { reason, note } + lastAnswer] } ], answering }, empty?, preview? }`. Never a key, a draft, a model, a warning or the basis before an answer. `answering` is true wherever the server runs. `lastAnswer` (19 Nov 2026) is the student's latest answer to that question in a lesson (any version of it), so a reload shows it answered: `null` until they answer it here (and always in a staff preview), else `{ attemptId, answeredAt, response, correct, score, language, solution, explanation, optionFeedback }`, the key, the approved explanation and the feedback being what the attempt's reply showed. While the question is closed to the student (`closed`), `solution` and `explanation` are null, `optionFeedback` is `[]`, and `held: true` with `heldNote` says why |
| `GET /api/hub/topics/:topicId/lessons` | staff (the owner, the HOD reads) | `{ topic, canEdit, writing, serving: lessonView \| null, drafts, history, basis: { from, perSlideText, slides, note }, nothingToTeach?, notes: { approval, questions, model } }`. A `lessonView`'s steps: `{ type: 'chunk', text, html }`, `{ type: 'example', problem, problemHtml, steps: [{ text, html }], answer, answerHtml }` and `{ type: 'questions', questions: [{ id, text, textHtml, kind, bloom, status, provenance, servedAs?, note? } \| { id, missing, note }] }`, each with `index`, `slides` and `cite` |
| `POST /api/hub/topics/:topicId/lessons/generate` | the chapter's owner | 202 `{ runId, state: 'running', note }`; writes a new draft version in the background (an AI draft with a model, "slides only" without). 409 a retired topic, a topic with no text, or a lesson being written now |
| `GET /api/hub/lessons/run/:runId` | the staff member who started it | `{ run: { id, state, written, topicsDone, topicsTotal, topic, elapsedMs, error } }` |
| `GET /api/hub/lessons/:lessonId` | staff who may read the chapter | `{ lesson: lessonView, canEdit }` |
| `POST /api/hub/lessons/:lessonId/approve` | owner | `{ lesson, message, replaced?: { id, version } }`; the version before it is retired in the same statement. 409 not a draft |
| `POST /api/hub/lessons/:lessonId/discard` | owner | `{ lesson, message }`; 409 not a draft |
| `POST /api/hub/lessons/:lessonId/questions/:questionId/attempts` | student, on an approved (or just superseded) lesson of their class | `{ attemptId, response, shown?: { language, translationId }, timeMs? }` → 201 `{ attemptId, duplicate: false, correct, score, solution, language, optionFeedback }`; 200 with `duplicate: true` only when the stored row is a lesson answer to the same question (the key worked out from that row's own snapshot). 409 an id kept for anything else, a closed question, or a question that has become a poll; 404 a draft or discarded lesson ("That lesson was not found."), or a question the lesson does not list or that was never approved ("That question was not found."); 400 a bad id, no answer, or one over 20,000 characters |

A lesson's answer is a hub attempt (`mode: 'lesson'`) in the same store as practice:
it counts in the student's mastery, error log, reviews and staff activity, and in no
room, attainment figure or register. Captured, offline (no model key):

```json
GET /api/hub/topics/:topicId/lesson (the student, before any is approved)   200
{ "topic": { "id": "5cdb8f…", "name": "Sets", "nameHtml": "Sets" }, "lesson": null,
  "empty": "Your professor has not published a lesson on this topic yet." }
POST /api/hub/topics/:topicId/lessons/generate (the owner)   202
{ "runId": "f1bd02…", "state": "running",
  "note": "No AI model is set up on this server, so this makes a slides-only lesson: your slides in steps, with questions you already approved. It arrives as a draft for you to approve." }
```

**Languages (H12)**, `routes/hubLanguages.js`.

| Route | Who | Body → reply; refusals |
|---|---|---|
| `GET /api/hub/language` | student | `{ language: 'en' \| 'hi' \| 'mr', choices: [{ tag, name, native, original }], note }` |
| `PUT /api/hub/language` | student | `{ language }` → `{ language, choices }`; 400 anything but `en`, `hi`, `mr` |
| `GET /api/hub/chapters/:contentId/translations?language=` | staff | `{ chapter: { id, title, titleHtml }, canEdit, languages, items: [{ kind: question \| lesson \| explanation \| hint \| feedback, id, status, english: { field: text \| [texts] }, englishHtml: { field: html \| [html] }, note, translations: { hi: { serving, drafts, shown }, mr: { … } } }], counts, notes }`; `translationView` (here and in every translation write's reply) carries `status`, `provenance`, `model`, `fields`, `fieldsHtml` (the same keys as `fields`, as HTML), `madeFrom`, `stale`, `staleNote?`, `findings: [{ field, id, blocking, message }]`, `blocking`, `flags` |
| `POST /api/hub/chapters/:contentId/translations/generate` | owner | `{ languages?, items? }` → 202 `{ runId, state, note, items, languages }`; items with a current draft or approved translation are skipped |
| `GET /api/hub/translations/run/:runId` | the staff member who started it | `{ run }`; when done, `run.error` holds a sentence if some items were not translated |
| `POST /api/hub/translations` | the owner of the item's chapter | `{ itemKind, itemId, language: 'hi' \| 'mr', fields }` → 201 `{ translation (a draft, provenance professor), message }`. Fields: a question `{ text, options }`; a lesson `steps.N.text`, `steps.N.problem`, `steps.N.steps` (a list), `steps.N.answer`; an explanation `explanation` (item id: the question's); a hint `hint`; option feedback `feedback` |
| `PATCH /api/hub/translations/:translationId` | owner | `{ fields }` → `{ translation, message }`, checked again against the English as it is now; 409 not a draft |
| `POST /api/hub/translations/:translationId/approve` | owner | `{ confirmFlags? }` → `{ translation, message }`. 409 not a draft, out of date, a blocking finding (`missing`, `count`, or `blanks`: a different number of `____` gaps), or flags (`numbers`, `formulas`, `code`, `untranslated`) without `confirmFlags: true` |
| `POST /api/hub/translations/:translationId/discard` | owner | `{ translation, message }`; 409 not a draft |
| `GET /api/hub/chapters/:contentId/languages` | staff | `{ chapter, items: [{ questionId, text, kind, bloom, students, original, originalName, languages: [{ language, name, answers, correct, share, original }], otherThanOriginal, note, warning }], warnings, method, note }`: each student's first graded hub attempt (practice and lessons), split by language with Phase 5's thresholds |

A translation made from English that has changed since is out of date and never
shown; one with any blocking finding against the current English is never served,
even if approved before. A student sees an approved, current translation, or English
with a plain note. Captured:

```json
GET /api/hub/language   200
{ "language": "en",
  "choices": [{ "tag": "en", "name": "English", "native": "English", "original": true },
              { "tag": "hi", "name": "Hindi", "native": "हिन्दी", "original": false },
              { "tag": "mr", "name": "Marathi", "native": "मराठी", "original": false }],
  "note": "Your professor checks every translation before you see it. Until one is checked, you see the English, with a note." }
```

**The tutor (H13)**, `routes/hubTutor.js`. No live model call: hints are approved
ladders of up to three steps (1 a nudge, 2 a strategy, 3 a worked step that stops
short of the answer) and feedback on wrong options.

| Route | Who | Body → reply; refusals |
|---|---|---|
| `GET /api/hub/practice/hints?attemptId&questionId&topicId` | student | The hints already opened for this attempt (for a reload): `{ hints, hintsUsed, remaining, why, note }`. 400 a bad id; 404 the topic or question |
| `POST /api/hub/practice/hints` | student | `{ attemptId, questionId, topicId, mode: 'practice' \| 'review', step? }` → 201 `{ hint: { position, kind: feedback \| nudge \| strategy \| worked, label, text, html, cite, by, byLabel, language, languageNote? }, hintsUsed, remaining, why, note, duplicate: false }`; 200 with the stored hint when `step` names one already opened; 200 `{ hint: null, message }` when none is left. 400 in a self-test or Get Ready ("No hints in a self-test" / "No hints in Get Ready"), a bad id or a step out of turn; 409 the attempt is answered already, the id was used for another question, or the question is closed |
| `GET /api/hub/lessons/:lessonId/questions/:questionId/hints?attemptId` | student on the lesson's class | As the practice `GET` |
| `POST /api/hub/lessons/:lessonId/questions/:questionId/hints` | student | `{ attemptId, step? }`, mode `lesson` → as the practice `POST`; staff 403 |
| `GET /api/hub/chapters/:contentId/hints` | staff | `{ chapter: { id, title, titleHtml }, canEdit, questions: [{ questionId, text, textHtml, topic, topicHtml, bloom, kind, kindLabel, status, hints: [{ id, step, kind, label, text, textHtml, provenance, status, statusLabel, model, sourceRef, cite, opened, leak? }], missingSteps, takesFeedback, options: [{ optionIdx, option, optionHtml, feedback: { id, optionIdx, option, optionHtml, text, textHtml, … } \| null }], noLongerShown: [feedback as in options], counts }], counts, notes }`. `option` is the wrong option's words (true/false: "True" or "False"); `optionIdx` its index |
| `GET /api/hub/questions/:questionId/hints` | staff | `{ question (one entry as above), canEdit, notes }` |
| `PUT /api/hub/questions/:questionId/hints/:step` | owner | step 1, 2 or 3; `{ text, slides? }` → 201 or 200 `{ question, message }`, approved as written. 400 when it gives the answer away (the reason named), a poll, a bad step, too long, contact details |
| `DELETE /api/hub/questions/:questionId/hints/:step` | owner | `{ removed: true, question, message }`; 404 no hint there |
| `PUT /api/hub/questions/:questionId/feedback/:option` | owner | option index from 0 (true/false: 0 True, 1 False); `{ text, slides? }` → 201 or 200 `{ question, message }`. 400 the right option, a kind that takes none, a poll, a leak |
| `DELETE /api/hub/questions/:questionId/feedback/:option` | owner | `{ removed: true, question, message }`; 404 none |
| `POST /api/hub/questions/:questionId/hints/approve` | owner | `{ steps?, options? }` (all AI drafts when neither) → `{ approved, refused: [{ step \| option, why }], question, message }`; each draft is leak-checked again. 404 no AI drafts |
| `POST /api/hub/chapters/:contentId/hints/generate` | owner | `{ questionIds?, runId? }` → 202 `{ runId, state: 'running', questions, skipped, note }`; drafts only what approved, non-poll, non-image questions lack. 409 nothing to draft or a run in progress. Offline still 202, and nothing is drafted |
| `GET /api/hub/hints/run/:runId` | the run's owner | `{ run: { state, written, topicsDone, topicsTotal, error } }` |

Hints are offered in practice, review sets and lessons only. The attempt's
`hintsUsed` counts the distinct hints the student opened on the question since their
previous answer to it, under any attempt id, at most 3, and 0 in a self-test or Get
Ready. Changed replies, all additive: `practice/next` `hints` is live; practice and
lesson attempt replies, Get Ready answers and the self-test result carry
`optionFeedback: [{ option, text, html, cite, by, byLabel, language }]` (approved
feedback on the wrong option chosen; `[]` when right or unanswered); each lesson
question carries `hints`; staff activity carries `hintsUsed` and `attemptsWithHints`
(counts only). In `optionFeedback`, `option` is **the chosen option's words** as the
question holds them now (true/false: "True" or "False"), **not an index**: match it to
an option by its text. (Only the staff routes `PUT` and `DELETE …/feedback/:option`
take an index, in the path.) Its `language` is an object, `{ requested, language, translationId, note }`,
as on an explanation; a hint's `language` is the language tag alone, a string, with
`languageNote` beside it when there is one. Captured, the owner writing a hint, and one
that gives the answer away:

```json
PUT /api/hub/questions/:questionId/hints/1   201
{ "question": { "questionId": "0cbc09…", "text": "Which symbol says that $x$ belongs to the set $A$?", "kind": "mcq", "kindLabel": "Choose one", "status": "active",
                "hints": [{ "id": "adf09d…", "step": 1, "kind": "nudge", "label": "Hint 1: a nudge",
                            "text": "Read the symbol aloud: which one is said \"is an element of\"?", "textHtml": "…",
                            "provenance": "professor", "status": "approved", "statusLabel": "Written by the professor",
                            "model": null, "sourceRef": null, "cite": null, "opened": 0, "…": "…" }],
                "missingSteps": [2, 3], "takesFeedback": true,
                "options": [{ "optionIdx": 1, "option": "$x \\subset A$", "feedback": null }, "…"], "noLongerShown": [], "counts": { "…": "…" } },
  "message": "Saved. Students on your classes see this hint when they ask for it." }
PUT /api/hub/questions/:questionId/hints/2   400
{ "error": "This hint was not saved. It gives the answer away: it names the right option, \"$x \\in A$\". Rewrite it so it helps without giving the answer." }
```

The leak check is lexical: a hint that gives the answer in other words passes it, and
the professor's approval is the real gate.

### The additive `question.rich` (rooms)

`server:question`'s `question` and `class:question`'s `question` gain `rich` (H15;
`CONTRACT.md` Amendment 6). It is an object of HTML for each field of the question as
the phone is shown it that holds a formula or a fenced code block (also a formula
that could not be read, sent as its escaped source, and an escaped dollar sign), and
`{}` for every other question, prices included. A list field is sent whole once any
item in it qualifies. Fields: `text`, `criterion`, `options[]`, `left[]`,
`right[]`, `items[]`, `groups[]`, `columns[]`, `rows[]` (grid), `passage` (stimulus)
and `gaps[i].options[]`. Every other field is unchanged, as are indices and order: the
plain field is still what the phone answers with. `server:question` waits for the code
highlighter to load (about 300 ms the first time); `class:question` is built at once, so
before the highlighter has loaded a code block there is shown escaped without colours.
Hub question payloads carry the same `rich`.

### What the screens need

None of these screens exists. Every student screen uses the student's bearer token;
no student screen calls `/api/content`, `/api/classes` or `/api/bank`. Show every
error's sentence as it is. Render `*Html` and `rich` as HTML (never the plain field
beside it); use the plain fields for search, aria labels and answering. Put
`lang="hi"` or `lang="mr"` on translated text and load a Devanagari font without
blocking the page. MathML is native (Chrome 109 and later; check a low-end Android),
`.rich-tex-error` needs a small rule (the escaped source of a formula that could not be
read), shiki's dark colours come through `--shiki-dark`, and any CSP must allow
`style` attributes.

**Hub home and mastery map.** `GET /api/hub/home` (or `GET /api/hub` and
`GET /api/hub/progress`). Show `notice` plainly near the top. The map is
`classes → units → chapters → topics`, then `otherChapters` under its label; each
topic shows `state.label`, N (`state.answers`, "based on N answers"), `state.sentence`,
a provisional marker when `state.provisional`, and `review.when`. Show `reviews`,
`goals`, `paths` and `weeks` (with `weeks.note`); where a part carries `unavailable`,
show that sentence instead. "Your Bloom levels" from `bloomLevels`: per level a bar at
`now.accuracy`, a tick at `monthAgo.accuracy`, the signed `change` when it is not null,
N (`now.answers`), the `sentence`, a provisional marker, and `note` and `basis` once
below. Show `empty`. **Never** a rank, a class average, another
student, a streak, coins, points or a band name.

**Topic and practice.** `GET /api/hub/topics/:id` (prerequisites nearest first; mark
`onYourClasses: false` as from earlier material; a 404 looks like any missing page).
Practice: `GET /practice/next?topicId=` then `POST /practice/attempts`. Make one
`attemptId` when a question is shown and use it for its hints and its answer; keep the
attempt in the outbox until 201 or 200; resend the same id after a network failure.
Render the question as the room phone does (`rich` first), with `provenance.text`,
`why` and `languageNote`; send `shown: { language, translationId }` from the payload.
After the reply: right or wrong, the right answer from `solution`, the explanation's
`textHtml` and label, `optionFeedback`, `provisionalNote` for a written answer, and the
topic's new state sentence and N (and the `bankShort` sentence). A 409 means "closed
for now": keep the answer, show the sentence, retry later; show the `ALL_CLOSED`
message when `question` is null. **Never** show a key, an explanation or feedback
before the reply.

**Get Ready and refresher path.** Make a `clientRunId` and keep it, then
`POST /api/hub/getready`. Show `check.rule`, each prerequisite (status, label,
answers, right, sentence, provisional marker) and the current question with its `why`;
no Hint button (`hints.note` says why). Each answer `POST …/answers` with its own
`attemptId`; show the feedback, then `body.check.question`. Show `waiting` when the
question is null for that reason. Once `check.status` is `complete`, show each
outcome's sentence and the path: each step's topic, `why`, status and sentence, with a
Practise action that opens practice on `step.topicId`, `path.next` highlighted, the
target last. Past checks: `GET /api/hub/getready`. **Never** hints, or another
student's results.

**Self-test builder and results.** Inputs: topics (up to 20), levels (all six on by
default), number (1 to 30, default 10), optional time limit (1 to 180 minutes).
`POST /api/hub/exams` with a `clientRunId`; show `shortNote`. Every answer and every
change of answer is a `POST …/answers` with a new `attemptId`; show only "saved",
answered of total and status. The countdown comes from `secondsLeft` / `deadlineAt`;
the server decides the end. Hand in with `POST …/submit`. Result: per question
`correct`, `response`, `solution`, `explanation`, `optionFeedback`, `markLabel`
(`unmarked` shows no key), `heldNote` when held; `summary` overall, by topic and by
level; `ended`, `lateNote`, `note` (counted nowhere official). `GET /api/hub/exams`
resumes an open one. **Never** a mark, a key, an explanation, feedback or a hint
before the end.

**Lessons.** `GET /api/hub/topics/:id/lesson`. Render the steps in order: a chunk's
`html` with its `cite`; an example's label, `problemHtml`, each step's `html` and
`answerHtml`; a questions step with each question in its kind's component, `rich`
first, its provenance text and `language.note`. Show `lesson.label` and
`lesson.language.note`; show `empty` when `lesson` is null. Answer with
`POST /api/hub/lessons/:lessonId/questions/:questionId/attempts` and an `attemptId`
kept in the outbox; show the key only from the reply, or from `lastAnswer` on a reload
(the response, right or wrong, `solution`, `explanation`, `optionFeedback`; `heldNote`
in place of the key when `held`). A question with `closed` shows `closed.note` and no
answer box. **Never** an "AI draft" label, a model name, a
warning, the basis or a draft lesson to a student.

**Language switch.** `GET /api/hub/language`, save with `PUT /api/hub/language`.
Offer English, हिन्दी and मराठी with `note`, then reload what is open. **Never** a
finding, `madeFrom`, a model or an AI-draft label to a student.

**Hints.** In practice, review sets and lessons only. A Hint button when
`hints.available > 0`, with `hints.note`. Each press `POST`s the attempt id,
question, topic and mode, with `step` = hints shown so far + 1 so a retry is safe.
Show the hint's `label`, `html`, `cite`, `byLabel`, `languageNote` and, with the first,
`why`. Stop at `remaining: 0` or `hint: null` (show `message`). On a reload, `GET` the
hints with the same attempt id. Hide the button once the answer is sent (a later
request is a 409). **Never** a Hint button in a self-test or Get Ready.

**Error log.** `GET /api/hub/errors` (filter by `status` or `topicId`). Each entry:
the question (`rich`), the response, the solution, the explanation, prerequisites
nearest first (mark `onYourClasses: false` as from earlier material, and do not link it:
its topic answers 404), `fromLabel`, status and `sentence`; `keyHeld` in place of the
solution when present. **Never** another student, or a room's key the entry holds back.

**Reviews and goals.** `GET /api/hub/review/due`: due and upcoming topics with
`review.when`; start a set of `setSize` (5) with `mode=review`. Say that a short second
session soon after the first is part of learning (FSRS's first step is minutes).
`GET /api/hub/consistency`: weeks with practised, rested and upcoming days, `sentence`
and `note`. Goals: a form (title up to 80 characters, exam date today or later, up to
60 of the student's topics), `POST`, `PATCH`, `DELETE /api/hub/goals…`; show each
goal's `sentence`, counts, `focus` and each topic's state with N, `note` ("Only you
see your goals.") and the limit of 10. **Never** a streak count, or a goal to staff.

**Professor: units and topics.** `GET /api/hub/classes/:id` (staff shape). Add,
rename, delete units; drag to reorder (`PUT …/units/order` with every id); place or
move chapters (`PUT …/chapters/:contentId { unitId, position }`) from `available`;
take one off (`DELETE`). Redraw from the reply's `hub`. A chapter panel
(`GET /api/hub/chapters/:id`): topics with question and link counts, retired ones
greyed, slide numbers, `slides.note` ("older decks cite slide numbers only"), a "Make
topic records" button when `unsynced` is not empty (`POST …/topics/sync`), and
`unmatchedQuestions` as a count. "Preview as a student" with `?view=student`. When
`canEdit` is false (an HOD), hide every control.

**Professor: prerequisite links.** The staff topic view lists links in every state
with `label`, `reason`. Add (`POST /api/hub/links`), confirm or reject (`PATCH`),
remove (`DELETE`); show a 409's sentence as it is (it names the chain). A proposals
queue from `GET /api/hub/links?state=proposed` with `counts`. "Suggest prerequisites":
`POST /api/hub/links/propose { contentIds, runId }` with a device-made `runId`, poll
`GET /api/hub/links/run/:runId`; show proposals as AI drafts ("not used until
confirmed"), `note`, `skipped` with reasons and `warnings`.

**Professor: the review queues.** Render each question's `textHtml`, each option's
`optionHtml`, each hint's and feedback's `textHtml` and each translation's `englishHtml`
and `fieldsHtml` as HTML, in place of the plain fields, which are for search and editing.
A question links to `GET /api/bank/question/:id` (the bank's one-question read).
- *Explanations*: `GET /api/hub/chapters/:id/explanations`; write or edit (`PUT`),
  approve an AI draft, remove; "Draft explanations" `POST /api/hub/explanations/generate`
  with a `runId`, poll the run, show the offline note.
- *Hints and feedback*: `GET /api/hub/chapters/:id/hints`; three step slots per
  question (label, text, `statusLabel`, `cite`, `opened`, a `leak` warning,
  `missingSteps`), each wrong option's feedback or an empty slot, `noLongerShown`;
  write or delete a step or feedback (show the 400's reason inline); "Approve drafts"
  (show `refused` with reasons); "Draft hints with AI" (202, poll
  `/api/hub/hints/run/:runId`, show `skipped` and the run's sentence).
- *Lessons*: `GET /api/hub/topics/:id/lessons`: serving, drafts, history, each with
  its `statusLabel`, `basis.note`, warnings and steps; each retrieval question with its
  provenance and status and a link to approve it in the bank; "Make a lesson" (202,
  poll `/api/hub/lessons/run/:runId`, disabled while `writing`, `notes.model`);
  Approve and Discard with the reply's `message`; preview as a student with `?lang=`.
- *Translations*: `GET /api/hub/chapters/:id/translations`: English and each
  translation side by side, status, `provenanceLabel`, `stale` and `staleNote`, the
  findings split into blocking and flags; edit (`PATCH`), write by hand (`POST`),
  approve (on a 409 for flags, resend with `confirmFlags: true` on a second press; a
  blocking finding needs an edit), discard; "Translate" (202, poll
  `/api/hub/translations/run/:runId`, show `run.error`). Item kinds question, lesson,
  explanation, hint and feedback need labels. Statistics by language:
  `GET /api/hub/chapters/:id/languages` (Phase 5's translation warning component).

**Professor and HOD: per-class and per-student hub views.** Class:
`GET /api/hub/classes/:id/progress` (a matrix of students in roll order by topics,
each cell state, N, open errors; per-topic counts; notes; roster rows with no account
show their note) and `GET /api/hub/classes/:id/states` (per topic, one column per
state, students in roll order with N and a provisional marker; `noAccount` apart).
Student: `GET …/students/:rosterId/progress` (states with N, activity for 7 and 30
days by mode, `hintsUsed` and `attemptsWithHints` as counts, the error log with each
`questionId` linking to the bank's one question, `GET /api/bank/question/:id`) and `GET …/students/:rosterId/getready` (each check's
target, status, counts, outcome sentences and path progress). The HOD sees all of it
read-only (`access: 'reader'`). **Never** a ranking, sorting by score by default, a
class average beside a name, or a student's goals.

## Phase 7: offline-first

Server and database only, committed as `46bf6f9` with migrations `0030` to `0032`
(`docs/DATABASE_SCHEMA.md`), built in the directive's three stages under decisions O1
to O5 (`docs/PRODUCT_DECISIONS.md`, Phase 7). The room contract's side is
`CONTRACT.md` Amendment 7. How it works: `docs/ARCHITECTURE.md`, "Offline-first
(Phase 7)". Why selection stays on the server: `docs/OFFLINE_SELECTION.md`. The
professor's guide to laptop mode: `docs/TRAVEL_ROUTER.md`.

- **First (O1)** is client work: the phone's service worker, answer outbox and "saved
  on this phone / sent / marked" indicators, built by the UI session
  (`docs/UI_REBUILD.md`, "Phase 7, stage First"). The server side is the idempotency it
  already had (`answerId`), now echoed in every reply so an outbox matches replies by
  key; and replay keys on the staff console's record writes (below).
- **Next (O2, O3)**: question packs, outbox answers marked in the order they arrive,
  and the grace window after a room closes.
- **Then (O4)**: laptop mode, and importing its room files back into the cloud.

**Tested, and not.** Exercised over Socket.io and HTTP on a real server (the
production `createApp` and `attachSockets`) on the in-process store by
`server/scripts/offline.mjs` (79 checks), `laptop.mjs` (79; the laptop is the real
server started with `--laptop` as its own process) and `recordsync.mjs` (38), and by
four unit files (91 tests); all passing on 19 November 2026 (`docs/TESTING.md`).
Time-based rules (the grace window, a pack's 6 hours) were tested by moving the whole
process's clock forward, not by waiting. **Nothing ran against Supabase or Mongo, on a
real phone, or over a real hotspot or travel router.** The phone's handling of
`server:kept`, `server:refused` and packs, and the console's outbox, import screen and
laptop banner, do not exist yet.

The examples are real replies, captured on 19 November 2026 from a server on the
in-process store with the shared teacher key, every network setting blank and every
request off the machine refused (a throwaway script, not kept). Roster names and roll
numbers are the script's made-up ones. Profiles and long arrays are shortened with `…`;
a laptop's folder and addresses are replaced with examples. Ids are 24-character hex; on Supabase they are uuids. A time inside a
sentence is India's.

### Every new and changed endpoint and socket event

| Event or route | Who | New or changed | What |
|---|---|---|---|
| `student:pack` `{}` | phone to server | new | Asks for a pack. Only after `session:accepted`; never from a projector connection |
| `server:pack` | to a phone | new | `{ issuedAt, expiresAt, graceMinutes, timePerQuestion?, questions: [{ question, reason }], note }`, or `{ questions: [], note }` |
| `server:kept` | to a phone | new | `{ questionId, answerId?, counted: false, message, late? }`: the answer is stored and will never count. Never a mark or a solution |
| `server:refused` | to a phone | new | `{ questionId, answerId?, message }`: refused for good and not stored |
| `student:join` | phone to server | changed | May carry `deliver: true`: the phone holds answers it has not sent |
| `session:accepted` | to a phone | changed | In a closed room only: `deliverOnly: true`, `deliverUntil`, `message` |
| `student:answer` | phone to server | changed | May carry `deviceAnsweredAt` (ISO string or epoch milliseconds), kept for the record only. Question ids are compared without case |
| `server:result` | to a phone | changed | Adds `questionId` and `answerId`; after the close also `late: true` and `message` |
| `server:exhausted` | to a phone | changed | Adds `questionId` and `answerId` when it answers an answer (past the cap, to a question never given) |
| `teacher:watch` | teacher screen | changed (laptop mode only) | Rejected with the lock-out sentence after too many wrong keys from that address |
| `GET /api/laptop` | staff | new | `{ laptop: false }`, or laptop mode's status |
| `POST /api/imports/rooms`, `GET /api/imports/rooms` | a professor or the shared key; the HOD reads | new | Import a room file laptop mode saved; list imports |
| The 13 teacher-record and attendance writes | room owner | changed | Optional `Idempotency-Key` header; reply header `Idempotent-Replayed: true` on a replay; 409 for a key reused with other details; optional `basedOn` on six of them, and a stale 409 |
| Every staff route (`requireTeacher`) | staff | changed (laptop mode only) | 429 after 10 different wrong keys from one address in 10 minutes |
| `GET /api/session` rows, `/:code/grid`, `/:code/answers`, `/topics`, `/items`, `/attendance` (`room`), the review queue and `GET`/`POST /api/review/:answerId` (`item.room`) | staff | changed | `importedFrom: { importedAt, sourceCode, laptop, note }`, present only for a room imported from laptop mode |
| `GET /api/classes/:id/attainment`, `…/attainment/students/:studentId`, `…/register` (JSON, CSV and printable) | staff | changed | `rooms[].importedFrom`; a methodology sentence naming imported rooms; `?imported=count` (the default) or `leave-out`, echoed as `window.imported`; any other value 400 "imported must be count or leave-out." |
| Answer rows (`/answers`, `GET /api/analytics/:id/answers` for staff, the archive) | staff | changed | Three new `detail` values for answers kept and not counted, with `final` false and `correct`, `score` null (the machine's reading in `auto`); the phone's own time is stored and archived, not yet on the answer list |

### Question packs (O3)

A phone that has joined sends `student:pack {}` and gets `server:pack`. A pack holds up
to 5 questions (`PACK_SIZE`): 3 at the student's working level, 1 a level below, 1 a
level above (`PACK_SHARE`); a level with too few gives its places to the others, the
working level first. Inside the below-40% band, Remember and Understand only,
alternating. A room that does not adapt packs nothing above the student's level. A
room with a cap on questions per student packs no more than the cap leaves (the cap,
less answers given, less the question on the screen).

Every packed question is approved and servable in the room, and never the question on
the phone's screen, one the student has been marked on, or one put to the class
(running, closed or revealed). Each goes out exactly as `server:question` carries it,
through `forStudent()` with the same seed and supports and the phone's own
`provenance`, with its own `reason`: no key, rubric, solution, misconception label or
level check. **It does not carry `rich`** (Phase 6), which `server:question` does: a
packed question with a formula or a code block shows its plain text.

The pack is recorded (`question_packs`, `0030`) before it is sent. It lasts 6 hours
(`PACK_HOURS`) or until the room closes; expiry only tells the phone to stop offering
it, and an answer to a question of an expired pack still counts as served. Asking
again returns the same pack, same questions and times, and writes nothing; a new
record is written only when the pack gains a question its live record lacks (an answer
or an expiry), at most 50 per phone per room. One request at a time per connection:
requests arriving meanwhile are folded into one more reply. A question put to the
class while a pack is being prepared is left out of it.

```json
server:pack
{
  "issuedAt": "2026-11-19T14:09:53.845Z",
  "expiresAt": "2026-11-19T20:09:53.845Z",
  "graceMinutes": 10,
  "questions": [
    {
      "question": {
        "_id": "072965ffc850f069267df5d2",
        "text": "understand question 2: which option is right?",
        "bloom": "understand", "topic": "Sets", "kind": "mcq", "source": "teacher",
        "options": ["Option A", "Option B", "Option C", "Option D"],
        "provenance": { "by": "professor", "checked": true, "text": "Written by your professor." }
      },
      "reason": "This question is at Understand, the level you are working at."
    },
    … two more at Understand,
    { "question": { … "bloom": "remember" … }, "reason": "This question is at Remember, the level before the one you are working at." },
    { "question": { … "bloom": "apply" … }, "reason": "This question is at Apply, the next level up, ready in case your answers move you on." }
  ],
  "note": "Questions to work on if your connection drops. Answers you give offline are saved on this phone and marked when you reconnect."
}
```

`timePerQuestion` is added when the room set seconds per question; the phone keeps the
time and never enforces it.

| When | Reply to `student:pack` |
|---|---|
| Not joined | `session:rejected` "Join a session before asking for questions." |
| The room is closed or gone | `session:closed {}` |
| Paused / waiting | `session:paused { code }` / `server:waiting { code, title, message }` |
| The phone's row is gone | `session:rejected` "Your row is gone - rejoin with your roll number." |
| Nothing left to pack | `{ questions: [], note: "There are no more questions to keep on this phone for now." }` |
| The room is being deleted, or the pack could not be recorded | `{ questions: [], note: "Questions for offline use could not be prepared just now. Your answers are still saved on this phone and sent when you reconnect." }` |

### Answers from an outbox: which reply means what (O2)

A packed or saved answer comes back through the ordinary `student:answer`, with its own
`answerId` (8 to 64 of `A-Z a-z 0-9 _ -`, the same on every resend) and, if the phone
has one, `deviceAnsweredAt`. Send only after `session:accepted` on the new connection:
before it, the reply is "Join a session before answering.". Answers are marked one by
one in the order the server receives them, each taking its student's place in the
queue as it arrives; the phone's time is stored (`answers.device_answered_at`, only
when it is a date from 2000 to 2099) and never read for order or counting.

**Every answer reply** (`server:result`, `server:kept`, `server:refused`, and
`server:exhausted` when it answers an answer) carries `questionId` (as the phone sent
it) and `answerId` (when the phone sent a valid one). An outbox matches replies by
`answerId`. `session:rejected`, `session:paused` and `session:closed` carry neither.

| What happened | Reply | What the outbox does |
|---|---|---|
| Marked (live, packed, or late inside the window) | `server:result`, as before plus the ids; after the close also `late: true` and `message` | Marked. Drop the item |
| A resend under the same `answerId` | The stored outcome: `server:result` for a marked answer, `server:kept` for a kept one | Settled |
| Stored, never counted: after the close and not given before it, or after the window; past the room's cap; a second, different answer to a question already marked; an answer to a question put to the class | `server:kept` with the sentence (and `late: true` after the close); past the cap in an open room, then `server:exhausted`; for a class question in an open room, then the screen's question again (`server:question`) | Saved, not counted. Drop it; show the sentence, never a mark |
| A question this room never asks, in a closed room; or past the 100 kept answers a student may have in a room | `server:refused { questionId, answerId, message }`, nothing stored | Refused for good: keep it, show it, never resend |
| A question this room never asks, in an open room | No answer reply; the phone is sent the question on its screen again (`server:question`) | As before |
| Past the room's cap, to a question never given to the phone, in an open room | `server:exhausted { profile, reason, questionId, answerId }`, nothing stored (as since `0018`) | Finished |
| The room is being deleted, or the save failed | `session:rejected` "That answer did not save. Tap Next question to carry on." | Send it again later, same `answerId` |
| Paused | `session:paused` | Hold until the room resumes |

An answer to any question other than the one pinned on the screen (packed, from the
outbox, never given) gets **one go**: it is final at its first attempt, never re-pins,
and leaves the pinned question where it is. A packed or outbox answer's `servedAt` is
its own question's time (the pin's, the log of serves', or the pack's). A phone still in
the room when it closes (not one back only to deliver) is also sent `session:closed`
after the reply, as it always was.

Captured, the phone offline, rejoined with `deliver: true`, then sending a packed answer
(the profile shortened), the same question again with another response under a new id,
and the first id again:

```json
server:result
{ "correct": true, "score": 1, "solution": 2, "detail": "", "kind": "mcq", "attempts": 1, "redeemed": null,
  "workingLevel": "understand",
  "reason": "Your next questions are at Understand. You have 1 answer there so far, and your level can change once you have 3.",
  "levelChanged": false, "profile": { … },
  "questionId": "072965ffc850f069267df5d2", "answerId": "out-23CS01-0001" }

server:kept
{ "questionId": "072965ffc850f069267df5d2", "answerId": "out-23CS01-0002", "counted": false,
  "message": "You had already answered this question and been marked on it, so this answer is saved but does not count." }

server:result   (the first id again: the stored outcome, nothing new stored)
{ "correct": true, "score": 1, "ungraded": false, "solution": 2, … "questionId": "072965ffc850f069267df5d2", "answerId": "out-23CS01-0001" }
```

The sentences `server:kept` may carry:
- "The room had closed, but you had this question before it closed, so your answer is
  marked and counts." (on `server:result`, `late: true`)
- "This answer reached your teacher after the room closed, and it was not a question you
  had been given before then, so it is saved but does not count."
- "This answer reached your teacher more than 10 minutes after the room closed, so it is
  saved but does not count."
- "You had already answered this question and been marked on it, so this answer is
  saved but does not count."
- "This question was put to the whole class, so your own answer to it is saved but does
  not count."
- "This room asks each student N questions, and you had answered them all before this
  one arrived, so it is saved but does not count."

`server:refused` carries "That question is not one this room asks, so the answer was
not taken.", or the plain sentence of the kept-answer limit.

**What staff see.** A kept row has `final: false`, `correct` and `score` null, the
machine's reading in `auto`, and one of three `detail` values: "Arrived after the room
closed: kept, not counted.", "Arrived after the student had answered every question the
room asks: kept, not counted." or "Arrived after the student had already been marked on
this question: kept, not counted.". Attainment and the register set these aside under
either attempt rule, each with its own note. The staff analytics answer list
(`GET /api/analytics/:id/answers`, teacher view) carries the same item, `detail`
included; a student's own read of it never does. Captured from `GET
/api/session/:code/answers`:

```json
{ "detail": "Arrived after the room closed: kept, not counted.", "final": false, "correct": null, "score": null,
  "auto": { "correct": true, "score": 1, "detail": "" }, … }
```

### A closed room: delivering saved answers, and the grace window (O2)

**The join.** A closed room refuses an ordinary join as it always has ("That session
has already been closed."). A phone holding saved answers joins with
`student:join { code, rollNo, name, deliver: true }`:
- **in a closed room** it is let in **at any time while the room exists** if it has a
  row of its own there, only to send what it saved: no question, no pack, no attendance
  mark. `session:accepted` adds `deliverOnly: true`, `deliverUntil` (the close plus 10
  minutes: until then, an answer to a question it was given counts) and `message`, and
  `bankCount` is 0. With no row of its own, or while the room is being deleted, it gets
  "That session has already been closed.". **A room imported from laptop mode refuses
  every delivery**, inside the window too: "This room was run on your teacher's laptop
  and has since been brought online from there, so it takes no more answers here.
  Anything still saved on this phone stays here; show it to your teacher if it
  matters."
- **in an open room** it is accepted as any join, and served nothing at the join: its
  saved answers go first and move the ladder, and its next `student:next` resumes the
  question pinned on its screen.

```json
session:accepted (closed room, deliver: true; the other fields as any join)
{ "profile": { … }, "session": { … }, "bankCount": 0,
  "deliverOnly": true, "deliverUntil": "2026-11-19T14:19:54.644Z",
  "message": "This room has closed. Answers saved on this phone are being sent; there are no new questions.",
  "supports": { … }, "linked": false, "confidence": [ … ] }
```

**The grace window** is 10 minutes after the close (`GRACE_MINUTES`), the edge counted,
judged by the server's clock at the moment the answer **arrived** (read before it waits
for its student's lock), never the phone's. An answer to a question the server served or
packed to that phone before the close, arriving inside the window, is marked and counts;
"served" reads the pin, the profile's log of serves (`profiles.served_log`) and the
packs. Every other late answer, after the window included, is stored, kept and not
counted. Captured, after the close: a packed answer, an answer to a bank question the
phone was never given, and one to another chapter's question:

```json
server:result   { "correct": true, "score": 1, … "late": true,
                  "message": "The room had closed, but you had this question before it closed, so your answer is marked and counts.",
                  "questionId": "f1c9e56cfc71184f00774ff5", "answerId": "out-23CS01-0003" }
server:kept     { "questionId": "09e06436e4394a9f7730f201", "answerId": "out-23CS01-0004", "counted": false, "late": true,
                  "message": "This answer reached your teacher after the room closed, and it was not a question you had been given before then, so it is saved but does not count." }
server:refused  { "questionId": "cb27e1e9abdfca01f92ee969", "answerId": "out-23CS01-0005",
                  "message": "That question is not one this room asks, so the answer was not taken." }
```

Class-question votes keep their existing late rules.

### Laptop mode (O4)

**Starting it.** From the repository root, `npm --workspace server run laptop` (or
`node server/src/index.js --laptop`, or `BLOOMLOOP_LAPTOP=1`). Before the store is
chosen it switches Supabase, MongoDB, Gemini and Google Classroom off, whatever
`server/.env` says, so the store is the in-process one. It listens on every interface
and prints a banner: the console link (the first LAN address, with the key), one join
link per LAN address (and any address that appears later), the archive folder and its
interval, the run tag, and what is unavailable. Settings:

| Variable | Default | Rule |
|---|---|---|
| `TEACHER_KEY` | unset: a random key of 24 characters at every start | At least 16 characters, or the start stops with a sentence saying what to do |
| `LAPTOP_ARCHIVE_DIR` | `server/.data/laptop-archives` (git ignores it) | The folder room files are written to |
| `LAPTOP_ARCHIVE_SECONDS` | 60 | A whole number from 1 to 3600, or the start stops with a sentence |

**Unavailable on the laptop** (`UNAVAILABLE`, printed and served): accounts and signing
in (the console link carries the laptop's key); AI generation (offline templates and the
professor's own questions work); Google Classroom; the Learning Hub; and anything kept
between restarts except the room files (chapters, questions, classes and rosters live in
memory).

**Room files.** Each room is written as its room archive (the JSON a deleted room is
kept as) plus `laptop: { run, startedAt }`, to `room-<CODE>-<room id>.json`: at once when
a close or delete is answered, every interval for each room whose archive changed
(running or closed, so late answers are caught), and at a normal stop. Each write is
atomic: a temporary file in the same folder, every byte written, flushed, then renamed
over the room's file; a write that cannot finish fails without renaming, so the last
good file stays. Files are written readable by the laptop's user only (0600 in a 0700
folder, where the system honours it; Windows does not), since they hold every
question's key. A file over 1 MB is still written, with a warning: it cannot be
imported. No archive, laptop or cloud, carries the profiles' log of serves.

**`GET /api/laptop`** (staff: a professor's or HOD's token, or the key; 401 without):

```json
on any other server   200 { "laptop": false }

in laptop mode        200
{
  "laptop": true, "run": "e5ccd514", "startedAt": "2026-11-19T14:09:54.735Z",
  "archives": { "folder": "<project>/server/.data/laptop-archives", "intervalSeconds": 60,
                "lastWriteAt": "2026-11-19T14:09:54.742Z", "writes": 1, "rooms": 1, "lastError": null },
  "join": [ { "network": "Wi-Fi", "url": "http://192.168.8.10:5050/join" } ],
  "unavailable": [
    "Accounts and signing in: use the console link printed here, which carries the laptop's own teacher key.",
    "Generating questions with AI: the offline templates and questions you write yourself work.",
    "Google Classroom.",
    "The student Learning Hub, which needs student accounts.",
    "Anything kept between restarts except the room archives: chapters, questions, classes and rosters made on the laptop are held in its memory and are gone when the server stops."
  ]
}
```

`lastWriteAt`, `writes`, `rooms` and `lastError` come once the writer has started.

**Wrong keys (laptop mode only).** 10 different wrong keys from one address within 10
minutes shut that address out of the key for 10 minutes, the right key included; the
same wrong key sent again counts once (a console tab holding an earlier start's key).
Every staff route answers 429, and `teacher:watch` is rejected with the same sentence:

```json
429 { "error": "Too many wrong teacher keys were tried from this device. Wait ten minutes, then open the console with the link the laptop printed." }
```

No other server counts wrong keys: the deployed one sets no `trust proxy`, so it sees
one address for everyone.

**Origins (laptop mode only).** The API's CORS and the socket's handshake accept a page
from the same origin, from loopback or `localhost` on the server's port, or from one of
the laptop's own network addresses on its port; a page another device on the hotspot
serves is refused, even on the same port. Every other server keeps its CORS list and the
socket's `origin: '*'`. Packs, the grace window and replay keys work as on any server.

### Room imports (O4)

**`POST /api/imports/rooms`**, a professor or the shared key; an HOD gets 403 ("An HOD
can read the department's imported rooms but not import one: the professor who ran the
class imports it."), no credentials 401. Body `{ archive, contentId?, classId? }`:
`archive` is the file's parsed JSON. The room becomes a **closed room the caller
owns** (unowned under the shared key), on the chosen chapter and class. Its students,
answers (inserted, never updated; a late or kept answer as the laptop kept it, with the
phone's time), reviews, attendance (matched to the class's roster by roll number) and
class questions with their votes are written as rows; the laptop's teacher records, and
attendance marks for roll numbers the roster does not hold, stay in the stored file
only. An answer's `question_id` is kept only when it names a question of the chosen
chapter (a laptop's never does); the snapshot keeps the laptop's id. Decision 8 holds:
no integrity signal is kept for a student the roster marks under 18.

The checks, in order: the file's shape and every row; its owner; then, one import of a
room at a time, whether it was imported before; whether its room id is already here from
another source; whether its code is taken (then a fresh code is drawn); the chapter; the
class. Every refusal is a sentence and writes nothing:

| Status | When | Error |
|---|---|---|
| 400 | No `archive` | "Choose the room file laptop mode saved, to import it. Nothing was imported." |
| 400 | Not JSON, not an archive, a bad row (names the first problem) | "This file is not a room archive BloomLoop can import: … Nothing was imported." |
| 400 | No laptop mark (a cloud archive download) | "This file does not carry the mark laptop mode puts on the rooms it saves, so it is not one to import here. The mark says where a file came from, not that it is unchanged, so every imported room is shown as imported. Nothing was imported." |
| 400 | No chapter chosen (none sent, and the file's own is not the caller's) | "Choose the chapter in your account that this room's questions belong to: the chapter on the laptop is not in your account, and each answer is filed under the chosen chapter's topics. Nothing was imported." |
| 400 | The room took attendance (or is Teacher-led) and no class chosen | "This room took attendance against a class on the laptop. Choose the class in your account it belongs to, so its attendance and answers count in that class's reports. Nothing was imported." |
| 403 | The file names another teacher as the room's owner | "This archive records a room another teacher owns, so only they may import it. Nothing was imported." |
| 404 | A chapter or class not the caller's, or not there | "That chapter was not found." / "That class was not found." |
| 409 | The room id is already here (a live room, a deleted room's archive, or an import the caller may not read) | "A room with this archive's id or code is already in BloomLoop from somewhere else, so this file was not imported: an import never replaces or joins evidence that is already here. Nothing was imported." |
| 413 | The archive is over 1 MB / the body over the parser's 2 MB | "This archive is N MB, over the 1 MB a room archive may be. Nothing was imported." / "This file is over the 1 MB a room archive may be. Nothing was imported." |

**The reply carries `error` only.** The import sets `needs: 'chapter'` or
`needs: 'class'` on its two 400s, but the app's error handler sends `{ error }` alone,
so `needs` never reaches the console (the builder's report said it did; the code and
the captured replies say not). Tell the two apart by what was sent: without
`contentId`, it is the chapter; with one, the class.

**Idempotent by the laptop's room id.** The same room again is 200 with
`alreadyImported: true` and changes nothing; `same: false` when the file differs (a
later save), with a sentence saying it was not used. A later save of an imported room
is never merged. A room **code** taken here does not refuse the import: the room gets a
fresh code, the import keeps the laptop's as `sourceCode`, and the message says so.
Captured (201, then the same file, then a later copy):

```json
201
{
  "imported": true, "alreadyImported": false,
  "room": { "code": "Q5B36K", "sessionId": "44283a93c475fad18918b228", "title": "Sets", "status": "closed",
            "contentId": "65069546fbd0a7e0b8a7f4af", "classId": "b0e660a83c8a238b0645e952",
            "startedAt": "2026-11-19T14:09:53.803Z", "closedAt": "2026-11-19T14:09:54.644Z" },
  "import": {
    "id": "2693ad6564fb0c22530e40fe", "room": { "code": "Q5B36K", "sessionId": "44283a93c475fad18918b228" },
    "sourceRoomId": "3aea7553cd0f917fe6ff8831", "laptop": { "run": "e5ccd514", "startedAt": "2026-11-19T14:09:54.735Z" },
    "archivedAt": "2026-11-19T14:09:54.736Z", "importedAt": "2026-11-19T14:09:54.804Z", "importedBy": null, "bytes": 3937,
    "summary": { "students": 1, "answers": 4, "reviews": 0, "classQuestions": 0,
                 "attendance": { "imported": 2, "notOnRoster": [] }, "records": { "tallies": 1 },
                 "roomWasRunning": false, "questionSetKept": true,
                 "sentences": [ "The teacher records made on the laptop (observations, the wheel, hands up, activities) are kept in the imported archive, not added to this room's records." ] }
  },
  "importedFrom": { "importedAt": "2026-11-19T14:09:54.804Z", "sourceCode": "Q5B36K",
                    "laptop": { "run": "e5ccd514", "startedAt": "2026-11-19T14:09:54.735Z" },
                    "note": "Imported from a file saved by laptop mode. BloomLoop checked that the file is a room it can read, not that it is unchanged since the laptop saved it: its answers, marks and attendance are as the file gives them." },
  "message": "Room Q5B36K was imported as a closed room: 4 answers from 1 student, 2 attendance marks. It is shown as imported wherever it appears: BloomLoop checked that the file is a room it can read, not that it is unchanged since the laptop saved it."
}

200 (the same file)   { "imported": false, "alreadyImported": true, "same": true, "import": { … },
                        "message": "Room Q5B36K was imported on 2026-11-19, so nothing was changed." }
200 (a later copy)    { …, "same": false, …, "message": "Room Q5B36K was imported on 2026-11-19, so nothing was changed. This file is not the one imported then (it may have been saved later): an imported room is never overwritten or added to, so nothing in it was used." }
```

A room saved while it was still running is imported closed as of the moment it was
saved, and `summary.sentences` says so.

**`GET /api/imports/rooms`** (staff): `{ imports: [import view, newest first], limitBytes:
1048576 }`, filtered to what the caller may read (the owner, their HOD, the key for
unowned imports). Never the file itself.

**Every staff view says a room was imported.** The file is checked for its shape, not
its authenticity: anyone can write the laptop mark. So `importedFrom { importedAt,
sourceCode, laptop, note }` is added, only for an imported room, to `GET /api/session`
rows (the HOD's list too), `/:code/grid`, `room` on `/:code/answers`, `/topics`, `/items`
and `/attendance`, `item.room` in the review queue and on `GET`/`POST
/api/review/:answerId`, and `rooms[]` in attainment, a student's report and the
register. Those three also name imported rooms in their methodology (and so in their
CSV and printable files), and take `?imported=leave-out` to leave them out:

```json
rooms[0].importedFrom   { "importedAt": "…", "sourceCode": "Q5B36K", "laptop": { "run": "e5ccd514", "startedAt": "…" }, "note": "Imported from a file saved by laptop mode. …" }
methodology (counted)   "One room counted here (Q5B36K) was imported from a file saved by laptop mode. BloomLoop checked that each such file is a room it can read, not that it is unchanged since the laptop saved it; a report can leave these rooms out."
?imported=leave-out     window: { "from": null, "to": null, "rooms": null, "imported": "leave-out" }; "Rooms imported from files saved by laptop mode are left out of this report."
?imported=maybe         400 { "error": "imported must be count or leave-out." }
```

### Teacher records sent again: `Idempotency-Key`, `basedOn` and stale 409s (O1, staff side)

The console keeps the records a professor makes while the network is down in an outbox
and sends them again, in order, once it reconnects. Thirteen writes take an optional
**`Idempotency-Key`** header: 8 to 64 of `A-Z a-z 0-9 _ -` (a UUID fits).

| Route | `route` name kept with the key | `basedOn` |
|---|---|---|
| `POST /api/session/:code/attendance` | `attendance` | per mark: `marks[i].basedOn`, the `markedAt` shown, or null for unmarked |
| `POST /:code/observations` | `observation` | `basedOn`: the `observedAt` of the mark in force shown, or null for none |
| `PATCH /:code/wheel/picks/:pickId` | `wheel-pick` | `basedOn: { ask?, questionId?, status? }` as shown |
| `PATCH /:code/tallies/:tallyId` | `tally-edit` | `basedOn: { text?, labels?, counts?, revealed?, correct? }` as shown |
| `PATCH /:code/activities/:activityId` | `activity-edit` | `basedOn: { outcome?, groups?, tallyId? }` as shown |
| `POST /:code/insights/actions` | `insight-action` | `basedOn`: the `actedAt` of the card's last action shown, or null |
| `POST /:code/tallies/:tallyId/increment`, `/decrement` | `tally-increment`, `tally-decrement` | none: a step, never stale; steps from two devices add up |
| `POST /:code/tallies`, `/activities`, `PATCH /:code/wheel`, `POST /:code/wheel/draw`, `/wheel/rounds` | `tally`, `activity`, `wheel-settings`, `wheel-draw`, `wheel-round` | none: the key makes each happen once; settings stay last write wins |

**Without the header** a write is done exactly as before. **With it**, the write's own
checks come first (the room's one 404 for "not there" and "not yours", 403 for an HOD,
401 and 403 as for the write), then, one key at a time:
- a key met before **with the same details** (the route, the record the path names and
  the body, in a canonical form) is answered with the **whole first reply**, status
  included, and header `Idempotent-Replayed: true`; nothing changes, nothing is pushed.
  The kept reply shows the room as that write left it, not as it is now: read the room
  again once the outbox has drained;
- a key met before **with other details** (another body, route or record) is 409
  "This change was already sent once with different details, so it was not done again.
  Nothing was changed: send it as a new change.";
- otherwise the write runs; a success (2xx) is kept under the key before the reply goes
  out. **A refusal (any 4xx, a stale 409 included) is never kept**, so the same write
  sent again is checked again against the room as it is then.

A key is the writer's own (the account, or the shared key) in that room
(`record_writes`, `0032`), and goes with the room. A malformed key is 400 "The replay key
must be 8 to 64 letters, digits, hyphens or underscores, such as a UUID.". There is no
batch route: the outbox sends one write at a time.

**`basedOn`, the stale-write rule.** A write that replaces a mark may say what it was
made from: the record as the screen showed it. If that record has moved on, nothing is
changed and the reply is **409** `{ error, stale: true, current, … }`: a sentence naming
what is newer (its time in India's clock, no route or field named) and the record as it
stands. Stamps are the server's own, compared only for equality, never for order:
device clocks are never compared. Per kind:
- **attendance**: refused, all or nothing, only when a professor's mark with a different
  status was made since; a phone's join never stands in the way. The 409 adds `newer:
  [{ studentId, status, markedAt, markedBy }]`, and `current` is the whole register;
- **observation**: refused when the mark in force is not the one shown; the same mark
  again is never refused. Adds `student`, `day`, `history`, `privacy`;
- **pick, tally edit, activity edit**: field by field; a field already holding the value
  sent is not a conflict. Adds `privacy`;
- **insight action**: refused when another action on the card was recorded since, unless
  it is this same action. Adds `privacy`.

`basedOn` must use these field names. **An object holding none of them is no check at
all**: the tally view's `options[]` sent as `basedOn` was taken as "nothing shown" and the
write went through (captured). Build a tally's `basedOn` as `{ counts:
options.map(o => o.count) }` (and `labels`, `correct`, `revealed`, `text` as needed).

Captured: a hand count step sent twice under one key; the key reused on another route;
a tally edit made from counts another screen had changed; an attendance chain where
another screen marked the student in between.

```json
POST …/tallies/:id/increment   Idempotency-Key: step-0001-a   { "option": 0 }
200  { "tally": { "id": "…", "seq": 1, "text": "Is the empty set a subset of every set?",
                  "options": [ { "key": "A", "label": "Yes", "count": 1, "correct": null }, … ], "total": 1, … },
       "clamped": false, "privacy": "Teacher records are for staff only: …" }
the same again                  200, Idempotent-Replayed: true, the same body; the count stays 1
the key on …/decrement          409 { "error": "This change was already sent once with different details, so it was not done again. Nothing was changed: send it as a new change." }
Idempotency-Key: x              400 { "error": "The replay key must be 8 to 64 letters, digits, hyphens or underscores, such as a UUID." }

PATCH …/tallies/:id   Idempotency-Key: tally-edit-0001   { "counts": [6, 2, 0, 0], "basedOn": { "counts": [1, 0, 0, 0] } }
409
{ "error": "This question's tally was changed at 19:40, newer than what this change was made from. Nothing was changed.",
  "stale": true,
  "privacy": "Teacher records are for staff only: never shown on a phone or the projector, and they never move a Bloom level.",
  "current": { "id": "…", "options": [ { "key": "A", "label": "Yes", "count": 4, … }, { "key": "B", "label": "No", "count": 1, … }, … ],
               "total": 5, "summary": "5 responded, more than the 1 marked present", "updatedAt": "2026-11-19T14:10:25.742Z", … } }
the same again       409 again (a refusal is not kept)

POST …/attendance   Idempotency-Key: att-0002-dev
{ "marks": [ { "studentId": "15756d7535d6201cf0b4f1ed", "status": "late", "basedOn": "2026-11-19T14:09:54.621Z" } ] }
409
{ "error": "23CS02 (Dev Patil) was marked absent at 19:39, newer than what this change was made from. Nothing was changed.",
  "stale": true,
  "newer": [ { "studentId": "15756d7535d6201cf0b4f1ed", "status": "absent", "markedAt": "2026-11-19T14:09:54.634Z", "markedBy": null } ],
  "current": { "room": { "code": "Q5B36K", … }, "class": { … },
               "students": [ …, { "studentId": "15756d7535d6201cf0b4f1ed", "rollNo": "23CS02", "name": "Dev Patil",
                                  "status": "absent", "source": "teacher", "markedAt": "2026-11-19T14:09:54.634Z", … }, … ],
               "counts": { … }, "summary": "1 / 3 present", "caveat": "…" } }
```

A pick marked Absent with `markAttendance` true still writes attendance without the
attendance stale check; an outbox can send `markAttendance: false` and a separate
attendance mark with its own `basedOn`.

**One gap, said plainly** (`routes/recordSync.js`): a write that succeeds but whose reply
then cannot be built (the store failing on the read after the write) answers 500 and
keeps no key, so a retry does the write again; for a tally step that is a hand counted
twice.

### What the review fixes changed (19 November 2026)

Reviewed after the merge. Which checks were shown to fail before their fix:
`docs/TESTING.md`, "Phase 7".
- **A second answer to a question already marked is stored**, kept and not counted
  (`server:kept`); the same response again is still told its mark.
- **The served log** (`profiles.served_log`): a question the pin moved off is still one
  the phone was given, so its late answer counts inside the window.
- **Past the window**, a deliver join is accepted and every answer stored, kept and not
  counted (it used to be refused at the door).
- **Packs**: one request in flight per connection, no room-wide lock, records reused,
  at most 50 per phone.
- **Laptop mode**: a TEACHER_KEY of at least 16 characters (24 random when unset), the
  wrong-key lock-out, origins limited to the laptop's own addresses, files 0600 in a 0700
  folder.
- **Imports**: shown as imported on every staff view, `?imported=leave-out`; a taken code
  gets a fresh code; the delivery check reads one room id, after the roll number and the
  row are checked.
- **Question ids are case-free** everywhere in the answer path, so no question is marked
  twice under another mix of capitals.
- **The grace verdict uses the arrival time**, read before the student's lock, so an
  answer that arrived in time counts even when it is marked later.
- **Kept answers are capped** at 100 per student per room (`KEPT_LIMIT`); past that,
  `server:refused` and nothing stored.
- **Laptop files are written whole or not at all**: the write loops until every byte is
  written, and otherwise fails without renaming over the last good file.

### What the screens need

None of these screens exists except the phone's stage-First outbox, service worker and
indicators. Show every sentence the server sends as it is.

**Phone: packs.** After `session:accepted`, send `student:pack` and keep the questions in
IndexedDB with `issuedAt` and `expiresAt`. Ask again after every reconnect, after each
`class:question` or `class:closed` (a question put to the class leaves every pack, and
the phone is not told which of its packed questions it was), and after live answers in a
room with a cap on questions per student. An empty `questions` means keep nothing; show
the `note`. Offline: the question on the screen first, then the packed ones in the order
sent, skipping and reordering none, until the pack is used up or `expiresAt`. One go
each; the label is "saved, will be marked when you reconnect". Show each question's
`reason` and `provenance.text`; keep `timePerQuestion`, never enforce it. While online,
let the service worker cache each packed question's image (`/api/media/<id>` serves a
phone only while the room runs). Render packed questions as live ones: `rich` first,
the plain fields otherwise. **Never** a mark, a key, a solution or "right"/"wrong" for an answer
made offline.

**Phone: replies.** Match every reply by `answerId` (and `questionId`), not by order.
`server:result`: marked (with `late` and `message` after the close). `server:kept`:
saved, does not count; show its `message` and drop it from the outbox, **never** with a
mark. `server:refused`: refused for good; keep the item, show it with its message, never
resend. `session:rejected` "That answer did not save…": resend later with the same
`answerId`. `session:paused`: hold. `server:exhausted` after a `server:kept`: the student
has finished.

**Phone: delivering to a closed room.** With items in the outbox, join with `deliver:
true` (and when an ordinary join gets "That session has already been closed.", retry
with `deliver: true`). With `deliverOnly`, send the outbox only, show `message` and say
that answers to questions it was given count until `deliverUntil`, and later ones are
kept but do not count; expect no question. In an open room, send the outbox, then
`student:next` to get the screen's question back. A refusal for an imported room means
keep the items, show the sentence, and stop retrying. Where the service worker is
unavailable (plain `http` on a laptop's LAN), guard `navigator.serviceWorker` and show a
one-line hint not to reload while the Wi-Fi is down. **Never** a new question in a
closed room.

**Console: the record outbox.** Queue every teacher-record and attendance write in
IndexedDB, append-only, and send them in order, one at a time, after reconnecting. Give
each item a fresh UUID when queued and send it as `Idempotency-Key` on every retry. Fill
in its path and body, `basedOn` included, just before its first send, then never change
it: a changed body under the same key is a 409. Chain `basedOn` from the stamp the
server last gave this console for that record (the last read, or the reply to the
previous outbox item on the same record: `students[i].markedAt`, `current.observedAt`,
the action's `actedAt`, the pick's, tally's or activity's fields), in the write's own
field names; null means "there was none"; leaving it out skips the check. Replies: any
2xx, `Idempotent-Replayed` or not, means done (drop it; read the room again once the
outbox drains); a network error or 5xx means retry the same item with the same key and
body; any 4xx means refused (keep it and show it, never delete it silently).

**Console: the sync pill and stale 409s.** A Synced / Offline · N waiting / Syncing pill;
a "Sync status" list of waiting items (Queued / Sending); "Saved on this device · will
sync" on each queued write; "All records synced" when the outbox drains. A 409 with
`stale: true`: show `error` beside `current` (and `newer` for attendance) and let the
professor resend it as a **new** item with a new key, or discard it. **Never** resend a
stale write under its old key, and never show a device's clock as the record's time.

**Console: imports.** Choose one or more room files (`.json`), parse each in the browser
and send `{ archive, contentId, classId }` one at a time, offering the professor's
chapters and, when the room had a class, her classes. On the chapter or class 400, ask
for that choice and send again (`needs` is not in the reply: see above). Show `message`
and `import.summary.sentences`. A 200 with `alreadyImported` is not an error: say
nothing changed, and show the extra sentence when `same` is false. Rooms list: mark
imported rooms (`importedFrom`, or match `GET /api/imports/rooms` by
`room.sessionId`) with "Imported from a laptop", the date and `laptop.run`. Wherever a
room is shown (rooms list, grid, answers, attendance, topics, item statistics, review
queue and detail, attainment, register), show `importedFrom.note`, and offer "leave
out imported rooms" on attainment and the register (`imported=leave-out`). Item
statistics list an imported room's questions as no longer in the bank: say "asked on
the laptop, not in this chapter's bank" instead. **Never** present an imported room as
one this server ran.

**Console: 429.** Show the lock-out sentence as it is, and do not retry the key
automatically while it stands.

**Console: laptop mode.** Call `GET /api/laptop` once on load. When `laptop` is true,
show a small banner: running on this laptop, rooms saved to `archives.folder` every
`intervalSeconds` and at each close, with `lastWriteAt` and any `lastError`, and the
`unavailable` list. Hide or disable sign-in, AI generation, Google Classroom and the hub.
When the console is opened at `localhost`, warn that the projector's QR code then gives
phones an address they cannot reach (open the printed LAN link). **Never** show the
teacher key on the projector, and never offer to open the console from another device.

## Batch 8: figures, interaction kinds and the design-zip server gaps

Committed as `ba0f59d` with migrations `0033` to `0035` (`docs/DATABASE_SCHEMA.md`),
on top of the UI session's Batch 8 screens (`4384844`). Decided under the owner's
delegation, 19 Nov 2026 (`docs/PRODUCT_DECISIONS.md`, Batch 8). The room contract's side
is `CONTRACT.md` Amendment 8. How it works: `docs/ARCHITECTURE.md`, "Figures and
interaction kinds (Batch 8)". Every change is additive except two hub answer routes,
which now need a serve token (below).

**Tested, and not.** Over HTTP and Socket.io on the real `createApp` and
`attachSockets`, in-process store, by `server/scripts/figures.mjs`, `figkinds.mjs`,
`zipgaps1.mjs` and `zipgaps2.mjs`, plus unit tests (`docs/TESTING.md`). **No model,
Supabase, Mongo or real phone was used.** Model replies (figure drafts, teaching moves,
the concept panel) went through the real parsers as fixtures only.

### The figure stimulus

A question's `stimulus` may be `{ kind: 'figure', spec, sourceRef? }`: a JSON spec the
server checks and draws. Never code, never SVG from anyone, never a model's picture.
The spec is checked key by key at save time (`POST /api/bank/:contentId/questions`,
`PATCH /api/bank/question/:id`, `POST /api/bank/bulk` with `action: 'stimulus'`); a bad
one is a 400 with one sentence, `The figure was not saved: ...`.

| `spec.type` | What it draws | Main keys |
|---|---|---|
| `plot` | functions from fixed families only (linear, quadratic, cubic, exponential, logarithmic, sine, cosine, absolute value, piecewise step) with numeric `params`; points, segments, shading | `x`, `y` (`{min,max,step,label}`), `grid`, `functions`, `points`, `segments`, `shade`, `steps` |
| `chart` | bar, line, pie, histogram, dot plot, box plot | `chart`, `x`, `y`, `categories`, `series`, `slices`, `bins`, `values`, `boxes` |
| `numberline` | a line with points, intervals and rays | `min`, `max`, `step`, `labelEvery`, `points`, `intervals`, `rays` |
| `geometry` | points, segments, rays, polygons, circles, angles, vectors; lens and mirror ray diagrams (the image is computed from the formula) | `view`, `grid`, `axes`, `points`, `segments`, `rays`, `polygons`, `circles`, `angles`, `vectors`, `optics`, `steps` |
| `timeline` | dated events (years, BCE allowed, or year-month-day), in up to four lanes each side | `events` |
| `diagram` | flowchart, tree, cycle, network, mind map, laid out by Graphviz from DOT the server writes | `layout`, `direction`, `nodes` (at most 25), `edges`, `steps` |
| `molecule` | a SMILES string RDKit accepts; a stated `formula` must match RDKit's | `smiles`, `name`, `formula` |
| `pattern` | up to 12 shapes, a blank shown as `?` | `items` |
| `stack` | frames with steps that push and pop | `frames`, `steps` |

Every spec also takes `title`. Stepped types (`plot`, `geometry`, `diagram`, `stack`)
take up to 12 `steps` of `{ highlight, caption }` (a stack's steps list frames). The caps
are `LIMITS` in `server/src/figures/spec.js` (for example a 60-character label, 20,000
bytes per spec, finite numbers within ±1,000,000), also sent by `GET /api/figures/kinds`.
An empty plot (axes only) is valid only as the board of a `plot` question.

**What each reader gets.** A phone (room, hub practice, exam, lesson question, offline
pack, class question) gets `{ kind:'figure', type, title, svg, description, table }`:
never the spec, the steps or anything that marks. `description` and `table`
(`{ caption, columns, rows }`) are generated from the spec, never by a model. `svg` may be
null (an engine not loaded yet); show the description alone then. The bank list
(`GET /api/bank/:contentId`) adds `figure` (staff view: `ok`, `reason`, `parts`,
`stepCount`, `steps`, `formula`); the review queue adds `question.figure`.

**Image stimulus regions.** `{ kind:'image', url, alt, regions? }`, each region
`{ id, label, points: [[x%, y%], ...] }` (0 to 100; at most 24 regions of 3 to 24
corners). Staff-only: `forStudent` leaves them out, except as the zones of a tap or label
question.

### The new kinds: hotspot, label, plot, numberline, chart

Twenty-one kinds now. None is in the default mix; a plan's `kindMix` may name them.

| Kind | Levels | Stored keys | Phone gets (`server:question`) | Phone sends | Marking |
|---|---|---|---|---|---|
| `hotspot` | Remember, Understand, Analyse | `answerIds` (part names or region ids) | `stimulus`, `zones` (`[{zone}]` on a figure, `[{zone, points}]` on a picture) | `[zone tokens]` | like choose-all |
| `label` | Remember, Understand | `placements`, `distractors` (up to 3) | `stimulus`, `zones`, `labels` (shuffled, extras included) | `{ zone: labelIndex }` | partial credit per label |
| `plot` | Apply; Create (conditions only) | `plotKey` (points, a line, or conditions) | `stimulus`, `grid {x, y, frame}`, `place` (`points` or `line`), `maxPoints` | `[[x, y], ...]` (exactly 2 for a line) | within one grid step; points like choose-all, conditions partial |
| `numberline` | Apply | `lineKey`, `tolerance?` | `stimulus`, `grid {min, max, step, frame}` | `{ points, intervals:[{from,to,fromOpen,toOpen}], rays:[{from,direction,open}] }` | interval ends half each; extra marks cost one each |
| `chart` | Apply | `bars`, `values`, `tolerance?` | `board {categories, min, max, step, label, xLabel}` | `[height per category]` | per bar |

Zone tokens are opaque and shuffled per student (seeded by `rollNo:questionId`); a tap or
label figure is drawn again per student with every part name replaced by its token, so
no part name reaches the phone. "Within one grid step" is strictly less than a step; a
stated `tolerance` is inclusive. `server:result`'s solution uses the same shapes (the
right tokens, the placement map, `{place, points|equation|conditions}`, the number-line
marks, the bar heights). Staff answer items (`GET /api/session/:code/answers`) add
`parts`: `{ tapped: [names] }` or `{ placed: [{ part, label|null }] }`.

### Figure generation

`POST /api/generate` (and `/preview`): a generated question may carry one `plot`,
`chart` or `numberline` figure, never another type. The server checks and draws it and,
where the figure settles the answer, works out the key from it. A model answer that
disagrees is kept as a draft with a check `figure-key` (with a `basis` fingerprint); a
figure that fails is dropped with check `figure-dropped`; a kind that needs a figure is
refused instead. Chart values are compared with the stem's numbers and flagged, never
changed. A finding goes away once the key or figure is edited. `warnings` gains a
sentence on which graph, number-line and bar questions the offline templates could
make.

**The writer switch (M3).** Body `writer: 'auto'` (default) or `'templates'` (the
built-in writer on purpose); any other value is a 400. The reply adds
`writer { asked, ran: 'templates'|'model'|'mixed', sentence }`.

### Figure endpoints

| Route | Who | Reply |
|---|---|---|
| `GET /api/figures/kinds` | staff | `{ types, stepped, families, charts, diagram{layouts,shapes,lines,arrows}, optics, pattern{shapes,fills,colours}, limits, note }` |
| `POST /api/figures/preview` | staff (HOD included; writes nothing) | body `{ spec, step? }` gives `{ spec, figure, atStep? }`, or 400 with one sentence |
| `GET /api/figures/content/:contentId/slide-pictures` | owner; HOD reads; else the same 404 | `{ pictures:[{ id, url, slide, mime, bytes, alt }], kept, summary or null, note }` |
| `GET /api/figures/content/:contentId/print` | as above | an HTML page: each approved figure question with its text, SVG, description and table; no answers; CSP `default-src 'none'` |
| `POST /api/hub/lessons/:lessonId/figures` | the chapter's professor (HOD 403; teacher key 401; 503 without Supabase) | body `{ spec, text?, after?, slides? }` gives 201 `{ lesson, message }`: a new draft version with the figure step, keeping the version's concept-panel sections |

### Slide pictures and regions

A `.pptx` upload (`POST /api/content`) keeps the deck's PNG, JPEG and WebP pictures as the
chapter's uploads (at most 60, each once at the first slide showing it, metadata
stripped; `0033`). When the deck had any, the reply adds `slidePictures { kept,
skippedType, skippedLarge, skippedOver, slides, keptAt, note }`; otherwise the reply is
as before. Each picture's alt is `Picture from slide N (not yet described)`, and
attaching one to a question is refused until the professor writes the alt. Regions:
above, under "Image stimulus regions".

### Stepped figures on the projector

`PATCH /api/session/:code/projector` accepts `step` (0 to `stepCount`; 0 is the figure
itself). The reply's `screen` carries `step`; `shows.question.stimulus` and
`shows.diagram.stimulus` (and `projector:state`) carry `type, title, svg, description,
table, step, stepCount, caption` for a figure. Changing the question, diagram or mode
resets the step. Hub lessons send every step at once: a lesson step of type `'figure'`
carries `text`, `html` and `figure { svg, description, table, steps:[{caption, svg,
description}] }` (staff views add `spec`). It is stored as a `chunk` step carrying
`figure`.

### The design-zip gaps

**Teaching moves and activity prompts, the wheel (`0034`).**

| Route or event | Who | What changed |
|---|---|---|
| `GET /api/session/:code/teaching-moves` | staff, read rule | `{ room, label: 'AI suggestion, your call', modelReady, offline?, kinds, suggestions:[{ id, purpose (move or prompt), kind, title, text, focus, topic, basis, sourceRef, label, askedAt, used }], note }` |
| `POST /api/session/:code/teaching-moves` | staff, write rule (HOD 403) | body `{ kind?, topic? }`. No kind: a teaching move (L1; 409 before any graded answer). A kind (`check`, `think`, `group`, `diagram`, `real`): that activity's prompt (C2). 202 `{ state:'running', requestId, ... }`; 200 `{ state:'offline', message }` with no model; 409 for a closed room or a request already running |
| `GET /api/session/:code/teaching-moves/requests/:requestId` | the professor who asked | `{ id, state (running, done or failed), suggestion, message }`; kept in memory 15 minutes |
| socket `teacher:teaching-move` | the room's teacher screens | `{ code, requestId, state, suggestion or null, message or null }` |
| `POST /api/session/:code/activities` | staff, write rule | optional `suggestionId` (a suggestion of this room); `kind` then defaults to the suggestion's |
| `POST /api/session/:code/wheel/draw` | staff, write rule | optional `withQuestion: true`: the server draws a question too; the pick carries `question` and `questionDraw { order, poolSize, drawnAt, draws }` |
| `POST /api/session/:code/wheel/picks/:pickId/next-question` | staff, write rule | "Another": never repeats a question drawn for the pick; 409 when none is left |
| `PATCH .../wheel/picks/:pickId`, `GET .../wheel` | staff | **verbal ask type**: ask `'verbal'` (`Verbal question`), with no bank question |

A move is built from the room's counts only (per level, the support band, not answered,
present) and the professor's own slides; it cites a slide and is refused whole if it
breaks a rule (kind, 500 characters, contact details, labelling words, a slide it was not
offered). Never repaired, never invented.

**Per-room levels, per-level insights, support against the previous room.**
- `GET /api/session` rows, room heads (`answers`, `topics`, `items`, attendance) and
  insights add `room.class { id, courseName, section, termLabel }` or null. Never on the
  phone's `GET /api/session/:code`.
- `GET /api/session/:code/insights` (and `teacher:insights`): `series.points[].levels`
  (every level: `{ accuracy, answers, correct }`, accuracy null with no answers),
  `series.threshold { goal, sentence }` (the room's own mastery goal, not a fixed 60%),
  `kpis.support.previousRoom { room, students, compared, then, now, change, sentence }`
  or null (only students below 40% now who answered in the class's previous room, pooled
  right of answered on both sides).
- `GET /api/classes/:id/analytics`: `comparison { previous, latest, levels[6],
  levelBands[3], sentence }` or null (the newest two rooms; change in points) and
  `hardest.items[].contentId`. Per-room levels were already in `roomReport`.

**Topic slides, supported levels, last used (M1, M2, M5).** `GET /api/content/:id` adds
`topicSources[]` (`{ topic, kind: 'slides'|'line'|null, slides, line, label, note? }`, for
example "Slides 3–4"), `levelSupport { topics:[{ topic, supports, levels:[{ level, label,
supported, kind, reason }] }], note }` (from the built-in writer's honest-fit check) and
`lastUsed { at, code, status }` or null. `GET /api/content` rows add `lastUsed`. The
template switch is `writer`, under "Figure generation".

**Rooms-only, serve tokens, ending Get Ready (`0035`).**
- `PUT /api/bank/question/:id/rooms-only`, owner only (HOD 403; else 404), body
  `{ roomsOnly: true|false }`, reply `{ question, changed, roomsOnly, message }`. The hub
  never serves, shows or explains such a question; rooms are unaffected. Staff lesson
  question rows add `roomsOnly` and a note.
- **Serve tokens.** `GET /api/hub/practice/next` and each question of a student's
  `GET /api/hub/topics/:topicId/lesson` carry `serveToken`. `POST
  /api/hub/practice/attempts` and `POST
  /api/hub/lessons/:lessonId/questions/:questionId/attempts` now **need** it: missing, for
  another account, question or mode, or older than 7 days, is a 409 with a sentence and
  nothing stored. A resend of an attempt already stored needs none. A deployment must set
  `SERVER_SECRET` (without it the server derives one from its service-role key, so set it for any deployment); `HUB_SERVE_TOKEN_HOURS`
  sets the expiry (default 168).
- A signed-in student's room avoids, at the level it chose, a question they practised in
  the hub while another of that level is left. Staff `GET
  /api/session/:code/students/:roll/card` and `GET
  /api/classes/:id/attainment/students/:studentId` add `practisedInHub` and
  `practisedNote` on such answers.
- `POST /api/hub/getready/:checkId/end` (the student who owns it; staff 403):
  undecided prerequisites become Not sure yet and the asked question is released. Reply
  `{ changed, check { ..., endedEarly, note }, prerequisites, sentence, path }`; ending an
  ended check changes nothing. Check reads add `path.why { sentence, changes, source }`.

**Concept panel (H9a to H9c).** Lesson reads (staff `GET /api/hub/lessons/:lessonId`, the
topic's lesson list; student `GET /api/hub/topics/:topicId/lesson`) add `sections
{ available, label, intro, facts, steps, example { language, body, html, caption, cite },
mistakes, note, visual }`. Written by the model for AI lessons only; each piece cites
lesson parts or is dropped; an AI draft exactly while its lesson is (staff see `aiDraft`).
`visual { available, figures:[{ step, title, stepCount, cite }], note }` points into the
same reply's `steps`, so a figure is sent once; it is present whether or not
`sections.available` is true.

### Answer echoes, `sw.js` and `answerKey`

- **`answerId` echoed.** `session:rejected`, `session:paused`, `session:closed`,
  `server:waiting` and `server:exhausted` now carry `questionId` + `answerId` (answers) or
  `classQuestionId` + `answerId` (votes); `class:vote` carries `classQuestionId` +
  `answerId`. Echoed only when it has the server's key shape.
- **`/sw.js`** is served with `Cache-Control: no-cache`; other hashed assets stay
  immutable, the shell `no-store`.
- **`answerKey` on staff lists**: room answers, attainment detail, the analytics teacher
  view, the student card and `GET /api/review` items. Never on a student's own copy. On
  the review queue `answerId` stays the row id the review routes take.

### What the screens need

The UI session built these screens in `4384844` and checked them against local servers
only, never on a real phone. What they must keep doing:
- **Figures:** insert `stimulus.svg` as markup (it passed the allow-list), scale to
  width, offer the description and a "Show the data" table, and show the description
  alone when `svg` is null. Keep figures on a light card in a dark theme.
- **Interaction kinds:** send zone tokens, never part names; never mark on the phone;
  offer keyboard and typed input (tab through zones, a number box per bar).
- **Projector:** Back, Next and Start over send `step`; show "Step n of m".
- **Hub:** keep each question's `serveToken` and send it with the answer; the offline
  outbox must store it (it lasts 7 days). On the 409 sentence, keep the answer and offer
  to reopen the question.
- **Live screen:** show a teaching move with its basis sentence and "AI suggestion, your
  call"; on `offline`, show the server's message, never a template suggestion. Hide the
  button for an HOD.
- **Wheel:** never pick the question on the client; show `draw.note` when the pool
  widened.
- **Phone outbox:** match replies by `answerId`, including every refusal above.
- **Student card and attainment:** show `practisedNote` as a neutral note, never as a
  label on the student.

## Batch 9: the hub during a class, written and drawn answers, exam mode

Built on branch `batch9`: `e95b90b` (E1, E3, E4), `46221a6` (E5, E7), merged as
`648bea2`, the review's fixes as `b6af63e`; migrations `0037` and `0038`
(`docs/DATABASE_SCHEMA.md`). Decided under the owner's delegation, 20 Nov 2026
(`docs/PRODUCT_DECISIONS.md`, Batch 9). The room contract's side is `CONTRACT.md`
Amendment 9. How it works: `docs/ARCHITECTURE.md`, "The hub during a class, drawings and
exam mode (Batch 9)".

Additive for a client that sends none of the new fields, **except three behaviour
changes**: the hub now closes every question of a running room's set, not only the one
on a phone (E1); a written answer over its word limit is refused, and every existing
`open` question is a short answer of at most 60 words (E3); and a written answer must
be a string.

**Tested, and not.** Over HTTP and Socket.io on the real `createApp` and
`attachSockets`, in-process store, scripted phones, console and projector, by
`server/scripts/answerkinds.mjs` (86 checks) and `examguard.mjs` (119), plus
`test/answerkinds.test.js`, `test/examguard.test.js` and `test/b9review.test.js`
(`docs/TESTING.md`). **No model, Supabase, Mongo, real phone, laptop, browser or Safe
Exam Browser was used.** Fullscreen, screen sharing, the copy guard and the screenshot
keys were driven only as the events a phone would send.

### The hub closes a running room's whole set (E1)

While a room is not closed (open, waiting or paused), **every** question of its set
(`sessions.question_ids`, or every question of the chapter it can serve when it has
none) is closed in the Learning Hub for every student, from the room's opening until
the professor closes it. Before, only the question a phone had been served, or the
class question, was closed. Worked out on each request, so a question opens the moment
its room closes. Where a closed question meets the hub, nothing new is added to a
reply; the existing closed behaviour applies ("Closed questions" under Phase 6, above),
with new words:

| Where | What happens |
|---|---|
| `GET /api/hub/practice/next`, review sets | not served; with nothing else left, `message` is `ALL_CLOSED` ("...closed for now: part of a class that is still running, ...") |
| `POST /api/hub/practice/attempts`, lesson answers | 409, nothing stored: "That question is part of a class that is still running, so it stays closed here. It opens when your professor closes the class." |
| A **resent** practice attempt (one already stored) whose question is now closed | 200 with its earlier mark, and `solution: null`, `explanation: null`, `optionFeedback: []`, `held: true`, `heldNote` |
| Hint reads | no hint opens (409, as before); the hints shown for the question are `[]` with `held: true` and `note`, those opened before included |
| Get Ready | skips it; `CHECK_WAITS` reworded the same way |
| Self-tests | one built while a room runs leaves the room's questions out; a result and the error log keep the key back with `ROOM_HELD_NOTE` ("...once your professor closes the class") |

### Short and long written answers (E3)

The `open` kind takes `length: 'short' | 'long'`. No `length` is short, so no stored
question changed and marking is unchanged (the rubric matcher reads words, not the box).

| Length | Words | Characters | Label |
|---|---|---|---|
| `short` (default) | 60 | 900 | "Short answer" |
| `long` | 600 | 9000 | "Long answer" |

- **Bank.** `POST /api/bank/:contentId/questions` and `PATCH /api/bank/question/:id`
  accept `length`; any other value is a 400 (`open length must be short or long`). The
  bank reply's `kinds` adds `openLengths` (`{ short: { maxWords, maxChars, label },
  long: {...} }`). Every staff question payload (bank, review queue, tutor, labels)
  carries `kindLabel`: "Short answer", "Long answer" or a kind's label. `length` is left
  out of `keyBasis`, so no saved check went stale.
- **Generation.** `POST /api/generate` (and `/preview`): the model may set `length` on
  an `open` question; the professor changes it in the editor. Tested with fixture
  replies only.
- **Phone** (`server:question`, packs, hub practice): an `open` question adds `length`,
  `maxWords` and `maxChars`. Never the rubric.
- **Words** are runs of non-space; a zero-width space, word joiner, BOM or U+180E counts
  as a gap (a zero-width joiner and non-joiner do not: Devanagari uses them inside
  words). **Characters** are counted after trimming and folding white space.
- **Refusals, before anything is marked or stored** (room: `server:refused
  { questionId, answerId, message }`; hub: 400):
  - over the word or character limit: "Your answer has N words, and this question
    takes at most M. Shorten it and send it again; nothing was saved." (or "...N
    characters long...");
  - not a string: "This question is answered in words. ...";
  - any answer, of any kind, over 20,000 characters as JSON: "That answer is too long
    to take, so nothing was saved. ...".
- **Kept, not counted.** An over-limit written answer the phone cannot shorten (from
  its outbox, a pack, or after the close) is kept with `final` false and `detail`
  `OVER_LIMIT_DETAIL`, and the phone gets `server:kept { questionId, answerId, counted:
  false, message, late? }`. Attainment explains it in its own note.

### Whiteboard answers: the `drawing` kind (E4)

Twenty-two kinds now. `drawing`: `text`, an optional `stimulus`, an optional `rubric`
(up to 5 points, the reviewer's guide, never matched by the machine) and an optional
`allowText` (words beside the drawing). Allowed at Apply, Analyse, Evaluate and Create;
in no default mix (a plan's `kindMix` may name it). Label "Draw your answer". **Never
marked by the machine.**

**In a room** (Socket.io):

| Event | Direction | Payload |
|---|---|---|
| `server:question` | to phone | the base fields and `allowText`; with `allowText`, `maxWords` 600 and `maxChars` 9000. Never the rubric |
| `student:drawing` | phone | `{ questionId, image, answerId }`. `image` is a PNG or WebP as a data URL, base64 or binary; `answerId` is the id the answer itself will carry. Only for the question pinned on this phone or packed for it |
| `drawing:stored` | to phone | `{ questionId, answerId, mediaId }`: kept, or already kept under this `answerId` (idempotent) |
| `drawing:refused` | to phone | `{ questionId, answerId?, message }`: refused for good (not PNG or WebP by its bytes, an SVG, over 400 KB, not this phone's question, no `answerId`, an `answerId` used for another question, 10 already for this question, the room full, laptop mode). Sending it again will not help |
| `drawing:rejected` | to phone | `{ questionId, answerId?, reason }`: not saved this time (more than 12 a minute on this connection, the room being deleted, a server error). Send it again |
| `student:answer` | phone | `response: { mediaId, text? }`, naming a drawing this phone stored for this question in this room; otherwise `server:refused` with one sentence. `text` only when `allowText` (else "This question asks for a drawing only, ..."), within 600 words |
| `server:result` | to phone | `{ correct: null, score: null, provisional: true, awaitingReview: true, note, solution: null, detail: 'waits for your professor', kind, workingLevel, reason, levelChanged: false, profile, questionId, answerId }` |

A room keeps at most 1,500 drawings and 100 MB; every cap is checked before the picture
is decoded. The picture's metadata is stripped. Laptop mode serves no drawing question.
The answer sits in the student's history but counts nowhere until reviewed.

**Review.** `GET /api/review` holds `open` and `drawing` answers. Each item adds
`kindLabel`; a written one `length` and `maxWords`; a drawing `drawing: { mediaId, url }`
(or null) and `text`. `POST /api/review/:answerId` with `decision: 'confirm'` on a
drawing is a 409 ("A drawing has no machine mark to confirm: give it a mark of your
own."); an override marks it, and only then do the ladder and attainment count it. Item
statistics, confidence counts and topic reports leave unmarked drawings out.
Attainment's note: "Not counted yet: a drawing, ...".

**The picture** is read at `GET /api/media/:id` by staff who may read its room (bearer
or teacher key), and for a hub drawing by staff of its chapter or the student who drew
it (bearer). Never by a phone's `<img>` or the projector; served `Cache-Control:
no-store, private`. A drawing can never be attached as a question's stimulus (the same
404 as an unknown upload).

**In the hub.** `POST /api/hub/practice/attempts` for a drawing takes `response: {
image, text? }` (same caps; 413 over 400 KB, 415 not PNG or WebP, 429 at 10 for the
question, 409 an attempt id used for another question). The reply adds `notMarked:
true` and `note`, with `correct: null` and `score: null`. A picture sent for any other
kind is a 400. Practice stops serving a drawing the student has sent 10 times
(`message` `DRAWINGS_DONE` when only such remain). Self-tests, Get Ready and lessons
never ask a drawing; a lesson answer to one is a 409 ("This question is answered with a
drawing now, ...").

**Archive.** A deleted room's archive keeps `{ mediaId, text }` on each drawing answer,
never the bytes, and adds `drawings: { answers, picturesKept: false, note }`; a laptop
copy says the pictures stay on the server that ran the room.

### Exam mode (E5, E7)

An opt-in room setting, off by default. The help text says plainly: **no website can
stop screenshots, Google Lens or a photo taken with another phone, and no website can
truly lock a tab.** Every signal is "a signal, not proof"; nothing ranks or labels a
student.

**The setting** `examMode`:

```
{ on, fullscreen, screenShare, snapshotSeconds: 0 | 30 | 60,
  seb: { required, configKeyHashes: [64 hex], browserExamKeys?: [64 hex] } }
```

Checked, never clamped: pictures need `screenShare`; `seb.required` needs at least one
Config Key; at most 5 keys of each. A Teacher-led room cannot be in exam mode (400).
**Fullscreen, screen sharing and pictures need a class** (only a class list can mark a
student under 18): without one they are a 400, and a stored row runs without them; the
copy guard and signals work in any room.

| Route | Who | What |
|---|---|---|
| `POST /api/session` | owner | optional `examMode`, checked before a room code is spent, stored only when on. Reply adds `examMode` (as stored; off for none) and `examHelp` |
| `GET /api/session` | staff | each row adds `examMode`: `{ on, fullscreen, screenShare, snapshotSeconds, seb: { required, keys, browserKeys } }`, counts only, no key |
| `GET /api/session/:code` (open, phones) | anyone with the code | adds `exam` only in an exam room: `{ on, copyGuard, watermark, fullscreen, screenShare, snapshotSeconds, snapshotMaxBytes, sebRequired, notice }`. Never a key |
| `GET /api/session/:code/exam` | read rule (owner, HOD) | `{ room { code, title, status }, examMode (keys included), help, students, honesty, privacy }`; `students` is null while off, else every student not marked under 18, in roll order: `{ rollNo, name, summary, snapshotAt }` |
| `PATCH /api/session/:code/exam` | owner only (HOD 403) | body `{ examMode }`, checked as at the opening. 409 for a closed room. Reply `{ room, examMode, help }`. Every phone in the room gets `exam:mode`; the console gets a full `teacher:integrity` |
| `GET /api/session/:code/exam/snapshots/:roll` | read rule | the newest screen picture, `image/jpeg`, `Cache-Control: no-store, private`, `X-Snapshot-At`. 404 "There is no screen picture for that student." when none, purged or under 18 |
| `GET /api/session/:code/exam/collusion` | read rule | `{ room, rule { minMatches, closeSeconds, commonShare, commonFloor, sentence }, pairs, note, privacy }`. 409 unless the room is in exam mode |
| `GET /api/session/:code/students/:roll/card` | read rule | adds `integrity` (the summary; null for under 18 or never joined), `integrityNote`, and in an exam room `exam: { snapshotAt }` |
| `PATCH /api/classes/:id/students/:studentId` | owner | changing `under18` pushes `exam:mode` to that student's phone in a running exam room at once |
| `POST /api/session/:code/close` | owner | reply may add `archiveWarning` and `archiveBytes` when the room's archive is over 90% of 1 MiB (long answers can pass it) |
| `DELETE /api/session/:code` | owner | also purges the room's pictures at once |

Every exam route is `requireTeacher` (a phone gets 401, a student account 403) and
answers the same 404 for "not yours" and "not there".

**The signal summary** (grid rows, `teacher:integrity`, the card, the integrity trail)
adds `counts` (`{ kind: n }`) and `latest` (`{ kind, at, src, method?, questionId? }`),
in every room. Its `notes` gain one sentence per exam kind, worded as what was seen
("Left fullscreen 2 times.", "Page left: possibly Google Lens, a screenshot tool or
another app. A notification or a message does the same.").

**Phone events.**

| Event | Direction | Payload |
|---|---|---|
| `student:join` | phone | optional `seb: { url, configKeyHash, browserExamKeyHash? }`, read from Safe Exam Browser's JavaScript API |
| `session:accepted` | to phone | in an exam room adds `examMode: { on, copyGuard, watermark, fullscreen, screenShare, snapshotSeconds, snapshotMaxBytes, sebRequired, watched, notice }`. `watched` false (under 18): nothing that watches is asked, and `notice` says so without the reason |
| `session:rejected` | to phone | `{ reason }`: Safe Exam Browser required and not shown, at the join or when the owner turns it on mid-room (then disconnected) |
| `exam:mode` | to phone | `{ examMode }` (null when turned off): after `PATCH .../exam`, an under-18 change, or the answer path finding the student now under 18 |
| `student:exam-consent` | phone | `{}`, ack `{ ok }`. A phone **already in the room** when exam mode is turned on sends it after showing the new `notice`; until then its signals are recorded as any room's. A phone that joins an exam room counts as having seen the notice: show it before joining |
| `student:signal` | phone | in an exam room also takes `fullscreen_exit`, `copy_attempt`, `context_menu`, `focus_lost`, `visibility_hidden`, `screenshare_stopped` and `screenshot_attempt` with `method` (`printscreen`, `snip_shortcut`, `mac_shortcut`; anything else is stored as `other`). The older `hidden`, `blurred` and `fullscreen-exit` are recorded under the exam names. At most 30 in any 60 seconds and one per kind a second; silent as ever. Dropped in other rooms |
| `student:screen` | phone | `{ state: 'started' \| 'stopped' \| 'declined', surface? }`, ack `{ ok, asked?, message? }`. `started` counts only with `surface: 'monitor'` (else `ok: false` and "Share your whole screen, not a window or a tab, ..."). `stopped` after a start is a signal; `declined` is recorded once per join as `screenshare_not_started` and nothing more |
| `exam:screen-needed` | to phone | `{ message, questionId, answerId }`: in a screen-share room an answer before the whole screen is shared is **not taken**; keep it and send it again after sharing. Answers the server already holds are replayed first |
| `student:snapshot` | phone | `{ jpeg }` (base64, data URL or binary), ack `{ ok, reason? }`; `reason` is `not-asked`, `not-sharing`, `too-soon`, `size`, `type`, `shape`, `full` or `error`. A whole JPEG by its bytes, at most 80 KB, one per interval less 2 seconds, metadata stripped. `full`: arrived but not kept (the store is at its cap); keep sending at the interval |

**Staff event** `teacher:integrity`, to the room's staff screens only: `{ code, full,
students: [{ rollNo, name?, summary?, snapshotAt? }], examMode?, honesty?, privacy? }`.
`full: true` on `teacher:watch` in an exam room and after every setting change (every
student not under 18, roll order, with `examMode` as the room list's summary, no key);
`full: false` carries the students that changed,
and a picture moves `snapshotAt` alone. Never picture bytes, never to a phone or the
projector.

**Observed kinds** (never accepted from a phone): `timing_anomaly` (an answer sooner
than its text, options and, once per student, its passage could be read at 25
characters a second, never under 0.9 s; in an exam room it replaces `too-fast`),
`second_device` (replaces `second-socket`), `snapshot_missing` (two intervals and 10
seconds without a picture while sharing; once per gap; never for a picture that arrived
but was not kept).

**Safe Exam Browser.** The server accepts either the
`X-SafeExamBrowser-ConfigKeyHash` header of the socket's opening request, checked as
SHA-256 of that request's URL plus a listed Config Key, or the join's `seb` value,
whose `url` must be this room's own join page (`/join` or `/join/<CODE>`) on the
server's origin. When the room lists Browser Exam Keys, the matching
`X-SafeExamBrowser-RequestHash` or `browserExamKeyHash` is needed too. Set
`PUBLIC_ORIGIN` (for example `https://bloomloop.example`) on a deployment; behind a
proxy that ends TLS, `TRUST_PROXY=1` lets `X-Forwarded-Proto` and `X-Forwarded-Host` be
believed. The help says it is a deterrent, not a lock: anyone holding the configuration
file can compute the value, and a value seen once can be replayed.

**Screen pictures.** Held only in the server's memory: the newest per student, 64 MB in
all and 24 MB per room (past either a new picture is refused, never another pushed
out). Purged two hours after the room closes, two hours after arrival whatever the
room's state, at once on delete, and on restart. Never in a table, the archive, the CSV
or any export.

**Collusion.** A pair is listed when both gave the same wrong answer to at least 3
questions, each within 60 seconds (timed by the earlier of the phone's answer time and
arrival). A wrong answer given by half or more of the students who got the question
wrong (when at least 5 did) is a common misconception and not counted. Final graded
answers only: no polls, class questions, kept-not-counted rows, right answers,
arrangements or drawings. Each pair: `{ students: [{ rollNo, name }, { rollNo, name }],
matches, sameWrong, questions: [{ questionId, topic, bloom, gapSeconds }] }`, in roll
order, never ranked, under-18 students left out. `note`: "Signals worth a look, not
proof. ...".

**Under 18** (decision 8): no signal recorded or shown, no fullscreen, screen share or
picture asked; the copy guard and watermark still apply.

### What the screens need

None of these screens is built by this batch (the server only). Grouped by screen:

- **Phone, before joining:** read `exam` from the open room route and show `notice`
  before the join. Safe Exam Browser: send `seb` from its JavaScript API, or rely on its
  header.
- **Phone, copy guard** (`copyGuard`): block the context menu, selection, copy, cut,
  drag and the iOS long-press callout **on the question only**, leaving the answer box
  and the whiteboard working; blur the question on focus or visibility loss; draw the
  faint `watermark` (roll number and room code). Send the matching `student:signal`.
  Screenshot keys (PrintScreen, Win+Shift+S, Cmd+Shift+3/4/5) send `screenshot_attempt`
  with `method` and blur at once.
- **Phone, fullscreen:** on a laptop ask for fullscreen before answering, pause on exit
  and send `fullscreen_exit`. A phone browser cannot be held in fullscreen.
- **Phone, screen share and pictures:** `getDisplayMedia` for the whole screen; send
  `student:screen` with the track's `displaySurface`; on `exam:screen-needed` keep the
  answer and resend after sharing; every `snapshotSeconds` send a low-resolution JPEG
  under `snapshotMaxBytes`, shrinking on `size`.
- **Phone, mid-room changes:** on `exam:mode`, apply the new rules, show the notice and
  send `student:exam-consent`; on `session:rejected`, show `reason`.
- **Phone, short and long answers:** size the box by `length`, count words live against
  `maxWords` (and `maxChars`), and keep the answer on a refusal so it can be shortened.
- **Phone, whiteboard:** pen, eraser, colours, undo; export PNG or WebP under 400 KB;
  send `student:drawing` with the answer's own `answerId`, then `student:answer` with
  `{ mediaId, text? }`; keep the drawing in the outbox until `drawing:stored`; resend on
  `drawing:rejected`, stop on `drawing:refused`; show `note` from `server:result`, never
  a mark.
- **Console, room settings:** the exam mode controls with `examHelp` beside each, the
  pictures interval only with screen share, the three watching parts only for a room
  opened for a class, Safe Exam Browser keys; change it live with `PATCH`.
- **Console, live signals:** listen for `teacher:integrity` (merge partial updates by
  `rollNo`), show counts and the latest signal with `honesty`, in roll order, never as a
  ranking or a verdict.
- **Console, snapshot viewer:** load `/exam/snapshots/:roll` with credentials when
  `snapshotAt` moves; never cache it.
- **Console, collusion list:** show pairs with `rule.sentence` and `note`; hide the
  button outside exam mode.
- **Console, drawing review:** the review queue shows the picture from `drawing.url`
  (with credentials) and `text`, offers marking only (no confirm), and a written
  answer's `kindLabel` and word limit.
- **Bank editor:** a Short / Long choice for written answers from `kinds.openLengths`;
  the drawing kind with `allowText` and an optional rubric.
- **Hub:** say the question is part of a class still running (the server's sentence);
  on a resent answer with `held`, show `heldNote` and the mark, never a key; a practice
  drawing sends `response: { image, text? }` and shows `note`, never a mark.

## Known open issues

Phase 7 (offline-first), open. None is a failing test; each is a gap, a limit or an
owner's call (`docs/PRODUCT_DECISIONS.md`, Phase 7):

- **Nothing ran against Supabase or Mongo.** `0030` to `0032` ran on PGlite only; the
  new Supabase methods (packs, imports, replay keys, `served_log`) only against a stubbed
  PostgREST, the Mongo ones only through the parity test. The hosted stores' case-blind
  id lookups were simulated in-process.
- **No real phone, hotspot or travel router.** The phone's outbox and service worker
  were checked in headless Chrome by the UI session; packs, `server:kept` and
  `server:refused` were tested with scripted Socket.io phones only. Real firewall
  prompts, how many phones a hotspot holds, a normal stop with Ctrl+C on Windows, an
  address appearing after the start, and the built client served in laptop mode were not
  run.
- **A packed question carries no `rich`: fixed, 19 Nov 2026.** `packPayload` now adds
  `rich` exactly as `server:question` does (`phoneRichSync`), so a formula or a code
  block reads the same offline as live (unit test in `test/offline.test.js`).
- **The import's `needs` never reaches the console** (found while writing these docs):
  the app's error handler sends `{ error }` only. Tell the chapter and class 400s apart
  by what was sent.
- **A `basedOn` holding none of its kind's field names is no check**: the write goes
  through as if nothing had been shown (captured with a tally view's `options`).
- **`student:next` puts a fresh question on the screen each time**, so a phone can read
  questions at its working level one at a time without answering (before Phase 7 too).
  Packs no longer add records on top of it.
- **No general rate limit per socket.** Only pack requests are folded; answers, joins and
  `student:next` can still be sent without limit (kept answers are capped at 100 per
  student per room).
- **The shared key over plain HTTP in laptop mode.** Anyone with the class Wi-Fi password
  can read traffic on it, the key included, if the console is opened from another
  device. The guide says to open it on the laptop only; refusing the key from any other
  address would stop a tablet console. The owner's call.
- **The wrong-key counter is laptop mode only.** The deployed server sets no `trust
  proxy`, sees one address for everyone, and would shut every professor out at once.
- **An imported room is shape-checked, not authenticated.** A hand-made file with the
  laptop mark imports as ordinary evidence; every staff view says it was imported and
  reports can leave it out. Its times come from the laptop's clock.
- **The laptop keeps only rooms across a restart.** Chapters, questions, classes and
  rosters are in memory. The laptop's question ids are never the cloud's, so an imported
  answer's `question_id` is empty: item statistics call those questions deleted and not
  in use, and the room's `bankCount` is the cloud chapter's. A running room is lost from
  memory at a crash (its file keeps up to the last save).
- **A record write done but not answered** (the store failing on the read after the
  write) keeps no key: a retry does it again; for a tally step, a hand counted twice.
- **A pick marked Absent with `markAttendance` true** writes attendance without the
  attendance stale check.
- **An answer past the room's cap to a question never given**, in an open room, is still
  not stored (`0018`'s rule); answers to served or packed questions past the cap are.
- **No fresh pack is pushed** when a class question starts: until the phone asks again,
  an answer to that question from an old pack is kept with the class question.
- **The phone's own time is not on the staff answer list** (`answerItem`); it is in the
  store and the archive.
- **The grace window is a constant** (`GRACE_MINUTES`, 10); O2 says a room setting later.
- **Replay keys keep the whole first reply** (the register or the wheel for some writes:
  tens of kilobytes at most per key), for as long as the room; not archived.
- **On Mongo every room is unowned** (the `Session` model declares no `ownerId`), an
  imported one included; before Phase 7 too.
- **The UI session's server asks still open**: `/sw.js` is served `immutable`, and
  `session:rejected` carries no `answerId`.

Phase 6 (the Learning Hub), open. None is a failing test; each is a gap, a limit or
an owner's call (`docs/PRODUCT_DECISIONS.md`, Phase 6):

- **Nothing ran against Supabase, Mongo, a real Auth token or a model.** Accounts work
  only through the scripts' in-process stand-in for Supabase Auth; the new repo methods
  were checked by the parity test, PGlite for the SQL and a few stubbed request shapes.
- **Rooms and the hub share one question bank.** Practice shows the key of every
  approved question after one try, so a student can collect, before class, the keys of
  questions a graded room will ask later. The fix closes only questions a room is
  asking right now. Decided, to be built in batch 8: a professor can mark a question
  "rooms only"; the room avoids a question the student has practised when another of
  that level exists; practice marks only questions practice served; a student can end
  a Get Ready check.
- **A Get Ready check cannot be abandoned.** While it is open, the question it is
  asking stays closed to practice and lessons (above); each open check adds a few reads
  to every practice request. Until batch 8, finishing the check is the only way out.
- **Any approved question in the student's scope can be answered by id**, as if
  practised: no store of served questions exists yet (batch 8).
- **A topic record with a lesson but no questions or links**, taken out of its
  chapter's topic list, is deleted, not retired, and its lessons go with it (`0027`
  cascades); its hub attempts keep the topic's name and lose the link. Found while
  writing these docs; traced from the code, not run.
- **Image-stimulus questions and the fewer-choices support are left out of hub
  practice** (an `<img>` carries no token; supports would need the account read at
  serve and submit).
- **Estimates are worked out per request** from every hub attempt on the topics
  involved, by every student. Not measured with a semester of data on Supabase,
  where PostgREST pages at 1000 rows.
- **One server process.** Unit, placement, link, explanation, hint and run locks are
  in memory; background runs are lost on a restart (a lesson run cut short can leave
  its retrieval drafts in the bank). The `0025` loop guard takes no lock, so two
  processes confirming A before B and B before A at once could both pass (reviewer's
  finding, low, not confirmed).
- **A translated hint or option feedback is leak-checked against the English
  question only** (reviewer's finding, low, not confirmed); approval stays the gate.
- **`hub_attempts` keeps no lesson id, lesson version or translation id**, only the
  mode and the language. The error log shows entries and explanations in English and
  labels a lesson's entry "From your practice".
- **Hints and feedback do not follow a regenerated question**; feedback whose option is
  reworded is kept but not shown (`noLongerShown`). A renamed topic is a new record:
  its questions stay on the retired one until retagged. A lesson cannot be edited, and
  an approved one cannot be withdrawn without approving a replacement.
- **A hub attempt is deleted with its student's account** (cascade), while room answers
  keep their roll number; the legal review of decision 8 should confirm this.
  `hub_goals.topic_ids` are not foreign keys: a topic gone from the student's classes
  shows in a goal as no longer on them.
- **No screen exists** for any of it, and no MathML, shiki output or Devanagari was
  rendered in a browser or on a phone.

Phase 2, open (none is a failing test; each is a gap or a default awaiting the owner):

- **The committed console cannot approve.** Generation now writes drafts, and the
  client as committed calls neither approve, reject nor approve-all. A room on a
  freshly generated bank is a 409. The UI session's uncommitted client does call
  them (`docs/UI_REBUILD.md`, "Phase 2"; not re-checked here). Do not deploy the
  Phase 2 or Phase 3 server without that client (`docs/IMPLEMENTATION_STATUS.md`).
- **The gate can show a draft's slides, not their text.** `sourceRef` names the
  slides the topic was read from. No route returns the passage the generator
  worked from, and the stored raw text keeps no slide boundaries.
- **A professor's own question is stored as `source: 'fallback'`. Decided and fixed,
  19 Nov 2026:** it is stored as `'teacher'` (contract amended, `0022`). Questions
  written before then keep `'fallback'`; the console still labels those template text.
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
  client's agreement. Confirmed again by the Phase 3 review: a classmate who types
  your roll number into a room you joined is sent your row, `slowLearner` and
  integrity summary included (decision 7's gap). **Decided and fixed on the server,
  19 Nov 2026** (decision (a), `CONTRACT.md` Amendment 3): the phone gets `PhoneRow`
  and its own sentences. A classmate typing your roll number is still sent your
  phone row (levels, totals, `next`), which a room without sign-in cannot prevent.
  The phone client still has to stop showing the old fields (client work).
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

Phase 5 (class questions, misconception labels and the review fixes), open:

- **A store failure while a room's close closes its class question leaves that class
  question running in the store** (fixed in the Phase 5 follow-ups so the close still
  answers and everyone is told; the error is logged). It can be closed by hand.
- **A phone that joins while the room is paused is sent no class question until the
  resume**; on the resume it now gets its own vote (Phase 5 follow-ups).
- **Splitting or merging a regenerated draft loses its link** (`replacesId`): the
  question it was to replace keeps serving after the new drafts are approved, until it
  is retired by hand. Recorded as a known gap under the owner's delegation, 19 Nov
  2026.
- **Supports follow a typed roll number.** A phone that does not sign in gets the
  supports (accommodations) of the roster student whose roll number it typed, the
  fewer-choices support included. Rooms are account-free (decision 7), so a token
  cannot be required for them. Kept, and recorded as a known gap, 19 Nov 2026.
- **One server process.** The class question's vote and state locks, its push
  throttle and the projector's `showCounts` are in memory, as every room lock is. The
  class question's state itself is stored and survives a restart.

Phase 5 (honest indicators), open:

- **No phone sends a language, and no question records one.** Every answer row is
  `'en'`, so the translation warning and the card's language note can only fire on
  rows written some other way (the unit tests and `honesty.mjs` use fixtures). The
  Hub's language switch (Phase 6) must record the language a question was shown in.
- **The phone still gets `question.source`** (`'fallback'` among its values) beside the
  new `provenance`, for the phone already built; drop it once the phone shows
  `provenance.text`. A student's own history (`redactForStudent`) shows its questions
  through `forStudent` with `source` and no `provenance` (the stored snapshot keeps no
  approval to word it from).
- **Moves are kept from now on.** A history written before carries none: the student
  card lists no moves for it, and `levelEvidence` reads a move off the last answers as
  `nextStep` does.
- **The HOD dashboard's professor accuracy** is a running pairwise average
  (`(a + b) / 2` per room, `dashboard.js`), not a mean of the rooms, so it weighs the
  latest room as half. Left as built; each room row and each professor row now carries
  its count of answers.

Phase 4 (course outcomes, mappings, the CSV import), open:

- **A renamed topic is not followed.** Renaming a topic in a chapter's list leaves its
  questions and answers under the old name, so their evidence is counted as unmapped
  (under the old name, `inChapter: false`) until the old name is mapped too. Nothing
  records that one name became the other.
- **Not atomic on Supabase.** Setting an outcome's topics is a read, then updates,
  inserts and deletes (a failure part way leaves extra mappings, never fewer); a copy
  is one write per outcome, mapping and override, so a failure part way leaves part of
  a copy. Removing an outcome takes it off overrides before deleting it. No lock: two
  professors' screens editing one class at once are last-write-wins.
- **Coverage and the remove check read every answer of the class's rooms** on each
  call. Fine at class size on the in-process store; not measured on Supabase.
- **Deleted rooms are not counted.** Their answers live in the room archive; coverage
  and the remove check read live rooms only.
- **The boot probe does not check `0019`'s tables**, on purpose: they are not needed
  by any room, so a server deployed before `0019` is applied keeps every room working
  and answers the outcome routes with a 500 naming the missing table, instead of
  falling back to the in-process store. **Since 19 Nov 2026 it checks them without
  failing**: a missing table is a boot-log line naming `0019` and what fails.
- **No route deletes an outcome that has evidence**, by design; nor a class.

Phase 4 (attainment and the marks register), open:

- **Deleted rooms are not counted.** Their answers are kept in `room_archives`, but an
  archive's class is inside its JSON, so finding a class's archived rooms means reading
  and decoding every archive the caller may read, in full, on every report. No
  `includeArchived` option was built; every report says deleted rooms are left out.
- **A roll number corrected on the roster before `0021`.** Since `0021` a report ties a
  room's answers to the student through the roll number on that room's attendance
  mark ("Whose answers they are"). A mark made before `0021` carries none, so in such
  a room the answers given under an old roll number are matched to the roster as it
  stands now: they appear as a roll number not on the roster, outside the class
  figure, and `rollNotes` says so. No route merges them.
- **Left alone on purpose by the review fixes:**
  - **"Everyone who joined" decides by the roll number on the roster now.**
    `marksFromJoins` (`POST /api/session/:code/attendance` with `fromJoins`) counts a
    student as joined when a phone joined with their current roster roll number. A
    student whose roll number was corrected after they joined, and who has no hand
    mark, is marked absent by it. Their answers stay theirs: the new mark keeps the
    roll number the replaced join mark carried.
  - **Reusing a roll number within a class after a correction.** If 21CS03 is
    corrected to 21CS13 and 21CS03 is later given to another student, answers under
    21CS03 fall to the new holder in any room where no single mark ties them to the
    first student: a room whose marks carry no roll number (made before `0021`), a
    room where no mark carries 21CS03, or a room where two marks carry it (then
    neither is chosen, and the roster as it stands decides).
- **Reads every answer of the rooms counted** on each report, all attempts (the best
  attempt needs them), and every attendance mark of those rooms. Fine at class size on
  the in-process store; not measured on Supabase.
- **No route reads an older version of a formula.** They are kept (`0020`), and every
  report names the version it used, but only the one in force is served.
- **Not built here**: best n of m rooms in the register, scaling marks to a college's
  maximum marks, the attainment sheet (one column per question), a blend of direct
  attainment with examinations or surveys. The JSON routes carry what those need; the
  methodology says this is direct attainment only.
- **The `aiProvisional` type is the keyword marker today**, and every report calls it a
  provisional machine mark, not AI. No model marks written answers; if one is added,
  its marks fall in the same type unless a column says which marker it was.
- **A professor's own question written before 19 Nov 2026 counts as offline-template**
  in the question sources, since it was stored as `source: 'fallback'`; the label says
  so ("Offline-template questions (and professor-written ones from before 19 Nov
  2026)"). Questions written since are `teacher` and count as `professorWritten`.
- **`best` across rooms with provisional marks counted. Fixed 19 Nov 2026.** For the
  same question, a professor-reviewed attempt now always beats a provisional machine
  mark, whatever the scores and whichever room each came from; the methodology says so.

Phase 4 (CSV exports and printable pages), open:

- **Never opened in a real spreadsheet.** The BOM, CRLF, quoting and the guard are
  checked byte by byte and read back by the server's own parser, not in Excel,
  LibreOffice or Google Sheets. Excel shows the guard's apostrophe when it opens a CSV
  (the sheet's `Formula guard` row says the apostrophe is the export's). The
  semicolon-separated reading the guard now covers was not tried in a spreadsheet
  either.
- **The printable pages were printed only by a headless Edge** to PDF (8 A4 pages for
  the acceptance class, 6 portrait and 2 landscape, before the review fixes added the
  question sources and roll notes), never on paper, nor in Firefox or Safari. Named
  pages (`@page wide`) are needed for the landscape matrices; without them the
  matrices print portrait.
- **The roadmap's per-question attainment sheet** (one column per question, with
  header rows for maximum marks, course outcome and Bloom level) is not built. The
  sheet built is student by outcome, as asked; a question has no maximum marks of its
  own yet (one answer is one mark).
- **A student's teacher records are not in any sheet**, on purpose (class level only);
  they are in that student's printable report and the JSON.
- **A wide class makes a wide sheet**: 8 columns per outcome in the students table
  (the Bloom sheet's, 72 for its nine bands and levels). The class table has 39 columns
  whatever the class, since the review fixes added the outside-the-share and
  question-source columns. The printed matrices split six to a table.
- **`?key=` on a JSON report** is still taken (only a file is refused), and stays in the
  browser's history and any proxy's log, as it does for an image. A signed-in
  professor's console fetches with the header instead.
- **Left alone on purpose by the review fixes: the Phase 0 room CSV.**
  `GET /api/session/:code/export` (`profilesToCsv`, `routes/export.js`) still takes
  `?key=` and is unchanged: its header must stay on row 1 for the Classroom import, so
  it carries no leading rows. Its guard covers `= + - @` but not a leading tab or
  carriage return, nor a lead after a semicolon or a tab; the names it writes are
  trimmed when a phone joins (`student:join` in `sockets/index.js`), so none starts
  with a tab or a carriage return.
- **A class has no code**, so filenames use the first 8 characters of its id.
- **Roll numbers in a spreadsheet.** A spreadsheet that opens a sheet directly may drop
  a leading zero (`0042` becomes `42`) or show a long roll number in scientific
  notation. Every sheet that lists students says how to keep them exactly (import the
  file, the Roll No column as Text); nothing in the file can force it.

**Deploying before `0021`** (Phase 4 review, traced from the code, not run on
Supabase): the repo writes `attendance.roll_no` on every mark (`inAttendance` in
`supabaseRepo.js`), and the boot probe does not check the column. On a database
without `0021`, PostgREST would refuse every attendance write: a join is let in but
marks nobody (the failure is logged, never shown to the phone), and a professor's
marks and the Absent mark of a wheel pick fail. Apply `0021` before this server
(`docs/DATABASE_SCHEMA.md`). The in-process store and Mongo need nothing.

Reported by the Phase 4 review, now fixed (each with a check in `server/test/` or the
three Phase 4 scripts; "The fixes from the Phase 4 review" has the full list):

- **The CSV guard and semicolon-separated spreadsheets.** A cell holding `;` used to
  be written unquoted, and the guard looked only at a cell's first character, so a
  name such as `Asha;=1+1` could become a cell starting with `=` in a spreadsheet
  splitting on semicolons. The guard now works after a semicolon or a tab too, and
  quotes any cell holding one.
- **The shared key printed on a page.** A page opened by a url carrying `?key=` could
  print the key in the browser's default footer. A file asked for with `?key=` is now
  a 400.
- **The class figure** rested on every roster student's answers; now on the counted
  students', with the rest outside the share.
- **A share rounded up to the threshold** (59.996% shown as 60% beside "Not
  attained"); shares are now rounded down.
- **A weighted room outside the report called deleted**; now "not in this report".
- **A corrected roll number cut a student from their answers**; `0021` and the
  reports now tie them through the attendance mark.
- **A restore past 50 outcomes**; now a 409.
- **The CSV import quadratic on crafted input**; now linear.

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
