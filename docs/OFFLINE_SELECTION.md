# Offline selection: should adaptive selection move onto the phone?

Phase 7, stage "Next" (decisions O2 and O3 of 19 Nov 2026, taken under the owner's
delegation). Written with the server work it describes: `server/src/services/offline.js`,
`handlePack` and the late-answer path in `server/src/sockets/index.js`,
`supabase/migrations/0030_offline_packs.sql`, `server/test/offline.test.js` and
`server/scripts/offline.mjs`.

## The answer

No. Selection stays on the server. A phone that may lose its connection takes a small
**pack** of the questions the server would serve it next, without their keys. Offline it
works through them in order and keeps its answers in its outbox. When it reconnects the
server marks each answer and moves the ladder, in the order the answers arrive. The
reason is short: adaptive selection needs marks, marks need keys, and keys never go to
a device. A phone that selected adaptively on its own would have to hold the keys, and
then any phone with its developer tools open could read them.

## What was built

| Piece | Rule | Where |
|---|---|---|
| The pack | After `session:accepted` a phone may send `student:pack`. It gets `server:pack`: at most 5 questions (`PACK_SIZE`), 3 at its working level, 1 a level below, 1 a level above (`PACK_SHARE`). A level with too few questions gives its places to the others, the working level first. Inside the below-40% band it gets Remember and Understand only, alternating as `selectNext` does. A room that does not adapt gets nothing above the level it holds the student at. The pack never holds the question on the phone's screen (the phone has that one already), a question the student has been marked on, anything not approved and servable in this room, or a question put to the class (running, closed or revealed). The room's cap on questions per student makes it smaller | `choosePack`, `packLevels` |
| What a packed question carries | Exactly what `server:question` carries: `forStudent()` with the same seed and supports (so the board is the same offline as online, fewer choices included), the phone's own provenance, and a sentence naming its level. No key, rubric, solution, misconception label or level check | `packPayload`, `packReason` |
| The record | Each pack is a `question_packs` row (`0030`), written **before** the pack is sent, so every answer to a packed question is recognised as served. It is written once, and a new pack is a new row. Asking again within the pack's life returns the same pack and writes nothing. Questions answered since are replaced from the same stable order, so a phone sees at most what it has answered plus one pack ahead | `handlePack`, `addQuestionPack`, `listQuestionPacks` |
| Order per student | Each student's order is a hash of the roll number and the question id. Asking again shows the same questions, and two students' packs come in different orders | `choosePack` |
| Expiry | 6 hours after the pack is sent (`PACK_HOURS`), or sooner if the room closes. Expiry tells the phone to stop offering the pack. It does not decide whether an answer counts: a question from an expired pack was still served | `packExpiry`, `livePack` |
| Marking | A packed question's answer comes back through the ordinary `student:answer`, with its own `answerId` (the idempotency key `answers.answer_key`, as before). It is taken as served (`servedAt` is the pack's time) and gets **one go**: there was no screen to retry on, so it is final at the first attempt. The question on the phone's screen stays pinned | `handleAnswer` |
| Arrival order | Each answer takes its place in its student's queue (`lockProfile`) the moment it arrives, before anything waits on the store. An outbox's answers are therefore marked one by one in the order the server received them. The phone may send `deviceAnsweredAt`. It is stored (`answers.device_answered_at`) and read by nothing that marks, orders or counts | `handleAnswer`, `deviceTimeOf` |
| The room's cap | A pack is sized to what the cap leaves (the cap, less answers given, less the question on the screen). Live answers given after a pack was sent can still use up the rest, so an outbox answer can arrive once the cap is reached. If its question was served or packed to that phone, it is stored, `final` false, with the detail "Arrived after the student had answered every question the room asks: kept, not counted." and no mark. The phone gets `server:kept`, then `server:exhausted` as before. An answer past the cap to a question the server never gave that phone is still not taken, as it has not been since `0018`, unless it arrives after the close (then the late rule keeps it) | `handleAnswer`, `OVER_CAP_DETAIL` |
| A rejoin with answers waiting | `student:join` with `deliver: true`. In an open room the phone is served nothing at the join: its answers go first and move the ladder, then its `student:next` resumes the question pinned on its screen | `handleJoin`, `handleNext` |
| The grace window | 10 minutes after the close (`GRACE_MINUTES`). An answer to a question the server served or packed to that phone **before** the close, arriving within 10 minutes of it (the edge counts), is stored and counted. Any other late answer is stored with `final` false, the detail "Arrived after the room closed: kept, not counted." and no mark on the row (the machine's reading is kept beside it for staff). It moves no level and counts in no report, and the phone gets `server:kept` telling it so. A phone may rejoin a closed room with `deliver: true` within the window, only to send what it saved. It gets no new question, no pack and no attendance mark. After the window, or with nothing of its own in the room, it is refused with a sentence. An answer to a question this room never asks (another chapter's, a draft, one outside its set) is not stored, since it would put a question no phone in the room was given into its record. In a closed room the phone gets `server:refused`, which says the answer is refused for good. In an open room the phone is moved on, as before. Votes keep their existing late rules | `lateVerdict`, `deliveryOpen`, `keptNotCounted` |

### What is kept across a long interruption, and for how long

| What | Where | Kept |
|---|---|---|
| The question on the phone's screen (the pin: question, when served, retries spent) | `profiles.served_*`, in the store | While the room is open, however long the phone is away. A rejoin resumes it. Nothing clears it on a disconnect |
| The phone's packs | `question_packs` rows | With the room. A phone works from its latest pack for 6 hours. After that the next request chooses afresh from where the student stands. Answers to any packed question count as served while the room is open, and for 10 minutes after it closes |
| Answers already given | `answers` rows | With the room, then in its archive (each with its phone time, when it had one) |
| Whether the phone is online | In memory (`presence`) | Until it disconnects. The grid shows it offline. Nothing else follows from that |
| The phone's outbox | The phone (IndexedDB) | The phone's own business. The server never asks for it and never drops an answer that reaches it |

`scripts/offline.mjs` moves the clock on 5 hours and then 7, and checks both cases: the
same pin and the same pack at 5 hours, the same pin and a fresh pack at 7.

## The two designs compared

**A. Server-side selection with a pack** (built). The server chooses, marks and moves
the ladder. The phone holds at most the question on its screen and one pack of keyless
questions.

**B. Full client-side selection.** The phone holds the room's bank, runs the selector
and the ladder itself, marks offline and sends its results when it reconnects.

### What a tampered phone could see or do

A "tampered phone" here is a student with the browser's developer tools, a modified copy
of the web app, or a script replaying socket events. It holds a real room code and roll
number.

| | A: pack, server marks | B: phone selects and marks |
|---|---|---|
| **Keys** | None. Every packed question goes through `forStudent()`. A packed answer is final at its first go, so retries cannot probe a key option by option. A late answer that is not counted is told no mark, and its row carries none, so after the close there is no oracle either | All of them, for the whole bank. Marking needs the keys, so the phone has them. Hashing a key does not help: an mcq has four options, and a hash of one is guessed in four tries |
| **Other questions** | The pin plus at most one pack (5) ahead. Seeing more costs answers on the record: each packed question answered is a marked, final answer the professor sees | The whole bank, at once, with keys. Shared once, it is out for every room on that chapter |
| **The ladder** | Moved only by the server's own marks, in arrival order. A phone cannot choose its level, skip the band's ceiling (the band packs Remember and Understand only) or have an answer counted twice (the idempotency key). It can only decline to send an answer | Whatever the phone says. A modified app can report any level and any marks. The server could re-mark on sync, but only from the keys it would then also have shipped |
| **Counting after the close** | Only questions the server gave that phone before the close, arriving within 10 minutes. The phone's clock is never read, so back-dating an answer gains nothing | The phone's clock decides, so it can be set to anything |
| **Integrity signals** | Lost while offline. The server cannot time an offline answer (the pack's send time to the answer's arrival is long by nature), and tab-away reports are self-reports that the phone may or may not queue. Which answers waited on a phone is on record: each such row carries `device_answered_at`, in the store and in the room's archive (the console does not show it yet) | Every signal becomes the phone's own report of itself |
| **Withholding** | A phone could send only some offline answers. It does not know which were right (no keys), so this gains it nothing over skipping a question | It knows which were right, and can send only those |

### Bandwidth

Measured on the server's own payload builder (`packPayload`), with a typical
college MCQ (a 150-character stem and four options of 20 to 30 characters): about
**650 bytes a question, 3.2 KB a pack of five**, before Socket.io's framing and with no
compression. A pack is asked for once at the join and again only after answers. A
200-question bank with keys, the least design B needs, is about **115 KB** of text
measured the same way. Neither figure counts images. A question's image is fetched by URL
(`/api/media/<id>`), up to 500 KB each. Under A only the packed questions' images are
needed offline (the phone's service worker can fetch them while online), and under B every
image in the bank is.

### Correctness and staff views

Under A the professor's grid, insights, item statistics and attainment read the same
answer rows, marked by the same code (`score()`), as a live answer. An offline answer
differs only in arriving late and carrying a phone time. Under B every report would rest
on marks a phone produced, and the review queue, misconception counts and attainment
would need a second, trust-the-device path.

## The recommended policy (what the server enforces)

1. **Keys never go to a device.** Not in a pack, not after the close, not hashed.
2. **Packs hold approved, servable, keyless questions** of the student's own room, at the
   working level and one either side (the band: Remember and Understand only), 5 at most,
   recorded before they are sent, for 6 hours at most.
3. **Marking and the ladder stay on the server**, in the order answers arrive. The
   phone's clock is stored for the record and never read for order or counting.
4. **One go per packed question.** It has no screen to retry on, and retries would let a
   phone probe a key.
5. **Late answers.** One served before the close counts within 10 minutes of it. Every
   other answer that reaches the server is stored, marked "arrived after the room closed"
   (or past the room's cap), and counted nowhere. The phone is told which plainly, and a
   not-counted answer is never told a mark. The one exception is an answer to a question
   the room never asks. It is refused for good and not stored, so another chapter's
   question never enters this room's record.
6. **The phone's own rule offline is tiny and deterministic.** Answer the question on the
   screen first, then the pack's questions in the order sent. Skip none and reorder none.
   Stop when the pack is done or expires. Each answer is shown as "saved, will be marked
   when you reconnect".

## Integrity trade-offs accepted

- **No timing signal offline.** "Too fast" can only fire for a packed answer that arrives
  sooner after its pack than a real answer could. A student offline could consult a
  classmate unseen. Live answers keep every signal they had.
- **Shared packs.** Two phones' packs can overlap, so students can compare questions
  before answering. Each student's order is different, packs are small, and every
  answer is marked by the server against that student's own row.
- **The ladder does not adapt inside a pack.** Five questions at most, spread one level
  either side, then the server re-chooses from where the student stands. A student who
  would have been promoted after the second answer still sees the pack's remaining
  questions. The level above is in every pack for that reason.
- **Arrival order is not answering order.** An outbox replays in order, so in practice
  they agree. When they do not (two phones, a resend), the server's order wins, and the
  phone's time is on the row for anyone who wants to see the difference.
- **After the window.** A phone that comes back more than 10 minutes after the close is
  refused, and its answers stay on the phone. The refusal tells the student to show the
  teacher if it matters. Nothing reaches the server, so nothing is stored. That is the
  cost of a window at all.

## Not built here (later, or elsewhere)

- The grace window as a room setting. It is a named constant now (`GRACE_MINUTES`).
- Pushing a fresh pack when a class question starts. The phone re-asks when it receives
  `class:question` (client work). Until it does, an answer to that question from an old
  pack is kept with the class question and not counted, as an answer to it from the screen
  always was.
- Packs in the room archive. The archive keeps every answer with its `servedAt` and phone
  time. The pack rows decide only whether a late answer counts, and no late answer can
  reach a deleted room.
- Laptop-as-server and archive import (stage "Then") are a separate piece of work.
