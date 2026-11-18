# Changelog

Newest first. Nothing below is deployed. The 18 November entries are committed as
`b4585a0` on branch `roadmap-phase0-evidence`. The 19 November entries are
uncommitted.

## Unreleased: 19 November 2026

Server and database only. No screen uses any of this yet. Every suite was rerun on
19 November: unit 172/172, live loop 41/41, security 13/13, migrations 204/204,
review 83/83, evidence 37/37, resume and integrity pass, and the question-kind round
trip has its same 5 known failures. Nothing was run against Supabase or with a
signed-in account.

### Phase 1: fixes from the review of the review queue and retrieval

- **A student's own answers are matched by account only.** Unlinked rows under their
  roll number may have been typed by anyone and are no longer shown to them. A
  professor's view still gathers them.
- **One roll number per department, as a room reads it** (`0011`). `21CS01` and
  `21cs01` can no longer be two accounts in one department.
- **Keyless answers are keyed per student.** Two students sending the same answer to
  the same question were one stored row. A key another student's row holds is never
  answered from that row.
- **`student:answer` refuses a question from another room's content**, which used to
  be marked, sent its key, and stored with its rubric in the wrong room.
- **A resend rebuilt from a reviewed row keeps the review**, and the phone no longer
  gets the machine's detail beside a professor's override.
- **Nothing is written into a room while it is archived and deleted.** A review sent
  then is refused (409); one already under way is waited for and archived.
- **The review queue pages by cursor** (`?before=` the previous page's `next`).
  `offset` is refused.
- **The database guards the evidence** (`0012`): an answer's response, snapshot and
  machine assessment are written once, and the review log is append-only.
- **The review note is documented as student-visible**, and the live phone's
  rubric reveal is documented as intended.
- **Non-uuid ids and deep offsets.** A 24-character hex id on Supabase is a 404, not a
  500, and `offset` is capped at 100,000 on the two answer lists.

### Phase 1: reading the evidence back

- **`GET /api/session/:code/answers`.** Every stored attempt in a room, newest first,
  paged, with the full question snapshot and the machine's reading. `?rollNo=` narrows
  it to one student.
- **`GET /api/session/:code/topics`.** Per topic × per level for a room, from final
  graded answers. Rooms older than the answers table are read from their history,
  and the reply names its `source`.
- **`GET /api/analytics/:id/answers`.** One student's answers across their
  professor's rooms. Who may call it is the analytics subject list. A student gets
  their own answers with the key, rubric and machine reading taken out.
- **`topicLevels` on `GET /api/analytics/:id`** for a student. The existing `topics`
  list is now read from the same rows.
- **New `listAnswers` filters** in all three repos: `kind`, `final` and `order` for
  the queue; `student`, `topic` and `bloom` for these reads; and the queue's `before`
  cursor.

### Phase 1: review queue for written answers

- **`answer_reviews`** (`0010`). One row per decision, never updated. A later decision
  never erases an earlier one.
- **`GET /api/review`, `GET` and `POST /api/review/:answerId`.** A professor reads
  each written answer with its rubric, response and machine mark, and confirms or
  overrides it with an optional note. The response and the machine's mark are never
  changed.
- **The student's numbers follow the decision** (`applyReview`). The history entry
  takes the human mark, and the level tally moves by the difference. The working
  level is not rewound. Teacher screens get the corrected grid.
- **`provisional: true` on `server:result`** for a written answer's machine mark.
- **A lock per student.** Each profile write reads the whole row, so it takes this
  lock first. Without it, a review landing between a live answer's read and write was
  lost.
- **Room archives include the review log.** Archives made without it still read.

### Docs

- New: `docs/API.md`, the reference for every Phase 1 endpoint and the `provisional`
  flag.
- Updated: `IMPLEMENTATION_STATUS.md` (Phase 1 checklist and test table),
  `TESTING.md`, `ARCHITECTURE.md`, `DATABASE_SCHEMA.md`, `PRODUCT_DECISIONS.md` and
  this file.

## Unreleased: 18 November 2026

### Phase 0: defects and accommodations

- **Teacher watch ownership.** `teacher:watch` checks ownership like the HTTP routes.
  Watching another teacher's room gets the same answer as an unknown code.
- **Room settings in the live loop.** The mastery goal, extra goes (0–2) and
  redemption are applied by the server. The Room screen sets them when a room opens.
  The phone is told how many goes it has, and a wrong answer with a go left reopens
  the question without revealing the answer.
- **Topic, kind and answer key on every history entry.**
- **Polls never count toward mastery.** They are still recorded, so they are never
  served twice.
- **Idempotent answers.** Every attempt carries a client key (`answerId`). A resend,
  with or without a key, is stored and counted once. Resending the same wrong answer
  does not spend a retry.
- **Drafts.** Scoped to one room and one roll number, and cleared when the student
  leaves.
- **Accommodations.**
  - The seven supports are applied: read aloud, dyslexia-friendly text, larger text,
    high contrast, extra time, no timer, and fewer choices (done on the server).
  - A professor sets them per student from the inspector on `/home`.
  - The phone is told only how to draw a question, never why.
- **`level-jump` signal.** Defined and recorded: five right straight after five with at
  most one right. It is shown as a prompt to look, not a finding.
- **Pause and resume on the Live screen.** Pause, resume and close reach the teacher's
  screen from anywhere (`teacher:status`).
- **CSV export with an account sign-in.** Uses `api.downloadExport`, which sends the
  bearer token.
- **Student bundle split.** `/join` loads 156 KiB of gzipped JS (was 241 KiB), with no
  Supabase or teacher code. Fonts are self-hosted through Fontsource, so there is no
  Google Fonts request.
- **Migrations.**
  - `supabase/migrations/0000`–`0009` build a fresh database and are safe to re-run.
  - `0001` was reconstructed from code.
  - The loose files are gone.
- **Boot probe.** Checks every table the server writes and names the migration that
  creates any table that is missing.

### Phase 1: evidence (started)

- **`answers` table** (`0008`). One row per attempt: the response, the question as
  shown, topic, level, attempt, key and timestamps. A written answer is stored as
  `provisional`, and the machine's mark is kept beside any later review.
- **Answer and history timestamps.** Each answer's row and its history entry now share
  one timestamp.
- **Room archive** (`0009`, decision 9).
  - Deleting a room first saves the whole room as one compact JSON document under
    1 MB, then deletes the live rows. If that save fails, nothing is deleted.
  - `GET /api/session/archives` lists archives and `GET /api/session/archives/:id`
    downloads one, both under the same ownership rule as rooms.
  - Measured: a class of 60 with 30 answers each is 267 KB.
- **`listAnswers` takes `offset`.** Supabase caps a request at 1,000 rows.

### Docs

- `IMPLEMENTATION_STATUS.md`
- `PRODUCT_DECISIONS.md`
- `DATABASE_SCHEMA.md`
- `TESTING.md`
- `ARCHITECTURE.md`
- this file

### In progress elsewhere

- **UI rebuild.** A from-scratch rebuild of the client UI runs in its own session.
  Notes go to `docs/UI_REBUILD.md`.
