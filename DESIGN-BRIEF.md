# BloomLoop — UI brief

---

## 1. What we are creating

**BloomLoop** turns a teacher's own lesson material into a question bank where every
question is tagged to one of the six levels of Bloom's revised taxonomy — **Remember,
Understand, Apply, Analyse, Evaluate, Create** — and then runs a live classroom session
in which every student is served questions at the cognitive level they have actually
reached. The system re-aims after every single answer.

Every other classroom quiz tool gives forty students the same paper faster. BloomLoop
gives each of them a different one.

The problem it solves: a class holds 40–60 students. One lesson, one test. A familiar
group scores below 30–40% test after test — not because the material is beyond them, but
because every question they receive assumes a cognitive level they have not reached.
Meanwhile the top of the class finishes in five minutes and switches off.

Existing tools (Wayground/Quizizz, Kahoot) generate quizzes from a document and run them
as games, but every student answers the same items — their "personalisation" changes how
a question is *displayed*, never what is *asked*. The unfilled gap is level control, per
student, live. That is the whole product.

---

## 2. What we need

A user interface for two surfaces:

- **A teacher console**, used on a laptop and usually mirrored to a projector while the
  teacher talks over it to the room.
- **A student view**, used by 10–60 students at once on their own phone browsers. No app
  and no account — a student joins with a 6-character room code and their roll number.

The interface has to make three things obvious:

1. Every question carries exactly one Bloom level, and you can see the spread across a bank.
2. Two students in the same room, at the same moment, are being asked different things.
3. A teacher can ask "why did this student get these questions?" and get a plain-English
   answer, not a black box.

Some product logic is surfaced in the interface, so it needs to be understood:

- A student with no history starts at **Understand**, not at the bottom.
- A student whose overall accuracy falls under **40%** is inside the **below-40% band**
  and is served **Remember and Understand items only**.
- Scoring well at the current level promotes a student one level; scoring badly demotes
  them one level. Never below Remember, never above Create.

---

## 3. How many pages

**14 pages — 8 teacher, 6 student.**

---

## 4. What each page should contain

### Teacher

**T1 — Unlock**
A single field for the teacher key that gates the console, and a note explaining the key
is printed in the server window. A line clarifying that students never need this key.

**T2 — Content, empty**
The starting point. Two ways to bring in material: upload a `.pptx` lesson deck, or paste
syllabus text. A statement that BloomLoop reads the teacher's material and never
generates teaching content of its own.

**T3 — Content, loaded**
The material has been parsed into a topic list. The topics are shown, individually
selectable, renameable and removable, with a way to add a topic the parser missed, and a
count of how many are selected. Also a list of previously uploaded chapters that can be
reused, each showing how many questions it already has. A way to move on to generation.

Real topics from the sample chapter: Transport layer services · User Datagram Protocol ·
Transmission Control Protocol · TCP connection establishment · Flow control and the
sliding window · Congestion control.

**T4 — Question bank, generating**
The bank is being written. Because the product claims "40+ questions in under two
minutes", an elapsed timer is visible while it runs.

**T5 — Question bank, ready**
The generated bank, and proof that every item is tagged. Shows the total, the
distribution across all six Bloom levels, a way to filter to one level, and the list of
questions. Each question shows its Bloom level, its topic, the question text, its four
options with the correct one marked, and actions to discard it or regenerate it.

A real generated item to use:
> Which statement accurately describes the function of multiplexing at the transport layer?
> A. It is the delivery of an arriving segment to the correct socket at the receiver.
> B. It involves breaking application layer messages into smaller segments.
> C. It is the gathering of data from multiple application sockets at the sender. *(correct)*
> D. It establishes a connection between two communicating hosts.

**T6 — Session**
This page is projected to the whole class, so its job is to get 40 phones into the room.
It shows the room code, the URL students type, a way to copy both, and a QR code of the
join URL. Plus a short explanation of what a student does: open the link, enter the code
and roll number, answer what appears.

Sample room code: `T6N9QG`.

**T7 — Classroom, live** *(the most important page in the product)*
What is happening in the room right now:
- How many students joined, how many are online, how many answers have arrived, how many
  students are inside the below-40% band, and how many have climbed above Understand.
- A profile for one selected student: their performance across all six Bloom levels shown
  visually, their current level, and the one-sentence reason they are on it — for example
  *"Overall 38% is inside the below-40% band — serving Remember and Understand items only."*
- A grid of every student against all six Bloom levels, showing correct-out-of-seen at
  each level, their current working level, their overall percentage, and whether they are
  online. Students inside the below-40% band are distinguishable at a glance. Selecting a
  student switches the profile above.
- Actions: export the results, post them to Google Classroom, and end the session.

Sample students: roll `02` at Evaluate on 90%, roll `07` in the below-40% band at
Understand on 38%. Roll numbers here look like `ADT24SOCB0934`.

**T8 — Classroom, waiting**
The same page before anyone has joined: counts at zero and a prompt to share the room code.

---

### Student (phone)

Every student page shows the room code, their roll number, their current Bloom level, and
their connection state.

**S1 — Join**
Two fields: the 6-character room code and their roll number, plus an optional name. A
statement that no account is needed. Roll numbers are alphanumeric, like `ADT24SOCB0934`.

**S2 — Question, unanswered**
One question on the screen. Its Bloom level, its topic, the question, and four options to
tap. Progress through their set.

**S3 — Question, answered**
The same question with their choice marked right or wrong, the correct option revealed,
and a way to move to the next question.

**S4 — Level change** *(the moment the whole demo builds to)*
Shown when an answer moves the student up or down a level: the level they were on, and
the level they have moved to. Moving down is framed as re-aiming, never as failure.

**S5 — Finished**
Their own results across the six Bloom levels, their overall figure, and the level they
finished at. Worded as "that is your set" rather than "you finished the whole bank",
because a student in the band only ever receives part of it. No comparison to any other
student and no ranking anywhere.

**S6 — Reconnecting**
The phone has dropped off the network. Tells the student their answers are saved and that
they are being reconnected automatically, with nothing for them to do.
