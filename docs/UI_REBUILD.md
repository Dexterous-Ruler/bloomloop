# BloomLoop client rebuild (v6 "Forest", 18 Nov 2026)

The web client was recreated from scratch today. A first pass took the warm
terracotta direction of the "BloomLoop v4" Claude Design handoff; Karim found
it cluttered ("that shabby orange one") and gave a calmer reference, his
Goodfor design. This version follows that reference. Every screen and the
shell have a new composition; the data layer (`client/src/lib/*`) is untouched.

## Direction

- **Calm and exact.** A warm off-white page with soft washes of mint and sand
  behind it, a near-black forest sidebar, and glass cards drawn with hairlines
  and one soft shadow. Colour is spent on the action, the level and the
  verdict, and nowhere else.
- **One forest brief per screen.** Near the top of each screen a dark panel
  says what matters right now in one sentence, built from real data, with its
  key figures as frosted tiles and sparklines. Faint dashed lines drift behind
  it. That panel carries the screen's weight, so everything around it can stay
  quiet.
- **One typeface.** Manrope for everything read, JetBrains Mono for room
  codes, roll numbers, axis labels and small figures. Both are self-hosted
  through Fontsource (SIL OFL 1.1), so there is no Google Fonts request.
- **Actions in three voices.** Deep green is the action, black is the
  decisive second step, and mint is the action on a dark panel.
- **Levels split the way the taxonomy does.** The lower-order three
  (remember, understand, apply) are greens, light to deep. The higher-order
  three (analyse, evaluate, create) are golds, light to deep. The brand mark
  and the level glyph are the same six rising rungs. A level colour always has
  its name or number beside it.
- **Right and wrong are a green tick and a red cross, always with the word.**
  There is no purple or violet anywhere, and no emoji.
- **Both themes are first-class.** Every text pair in `styles/tokens.css` was
  checked at 4.5:1 or better on its surface, and field borders at 3:1. The
  student supports still apply through `data-contrast`, `data-dyslexia` and
  `data-large`. These are high contrast, the Atkinson Hyperlegible font and
  larger text.

## Where things live

- `styles/tokens.css` holds both themes, `.on-panel` (which turns the text
  tokens over inside a dark panel) and the level ramp. `base.css` holds type
  and layout, `ui.css` the component look, and `shell.css` the rail, the top
  bar, the command palette and the `.gate` split layout.
- `ui/index.jsx` holds the components. New in this version: `Panel` (the forest
  brief), `Flow`, `Spark` (a sparkline from a real series), `Ladder` (also
  exported as `Loop`), `Mark`, `Switch`, `Stepper`, `Steps` and `Section`.
- `shell/AppShell.jsx` is the frame:
  - a forest rail whose groups fold;
  - a glass top bar with a working Ctrl/Cmd+K command palette that goes
    anywhere the rail goes, plus any page actions passed to it;
  - a page head with eyebrow, title, one-line purpose and actions;
  - a drawer below 1024px.

  `shell/ThemeToggle.jsx` is a separate file so `/join` does not download the
  frame.
- `hub/` is a student's Learning Hub (`/hub`) and `hubstaff/` a professor's or
  HOD's (`/hubs`). Both call the server only through `hub/hubApi.js`. Their
  gallery samples are real replies, kept in `hub/samples/` and imported by
  galleries only.
- `dev/*.gallery.jsx` are the sample-data views at `/__gallery` (dev only).
  `learn.gallery.jsx` shows the student phone in the states that are hard to
  reach by hand: retry, marked right and wrong, level up and down, paused, and
  finished.

## Screens

### Student phone (`/join`, `/join/:code`)

- **Join:** split screen. The forest half says "Answer at *your* level" over
  the six rungs growing in. The form half asks for the code in one wide,
  letter-spaced mono field, then the roll number and an optional name. On a
  phone the forest half becomes a short band above the form.
- **Question:**
  - A forest bar holds the room code plate, the roll number, the connection
    and "Not me".
  - Under it is the climb: six rungs across the top, lit to the working level,
    with that rung ringed and named.
  - The question sits on a glass sheet with hairline answer tiles. Under it
    are the product's reason, the goes hint and focus mode.
- **Retry:** a quiet amber band says "Not quite", with one dot per go left.
  Nothing is revealed and the options reopen.
- **Verdict:** the dock tints green, red or amber, and the Lottie mark draws
  itself in a disc. The server's sentence and "Next question" sit under it.
- **Level change:** the screen goes forest and a six-rung tower climbs, or
  folds down, to the new level with GSAP. Going down is called "re-aiming",
  never failure.
- **Paused, reconnecting, lost:** a forest cover over the question, which
  stays mounted underneath. It shows one mint icon tile and plain words.
- **Done:** a forest brief ("That is your set") with an accuracy ring and
  frosted figure tiles, then the liquid tubes (a spring height-field) filling
  per level.

### Teacher console (`/`)

- **Frame:** the rail has three groups. Overview, Rooms and Analytics show only
  when signed in. Material, Questions and Room sit under Prepare, and Live
  class under Teach. Questions carries its question count, and Live class a
  pulsing badge while a room is open. A locked step says why when pressed.
  On the three prep steps the head shows the crumb (room code in mono and the
  chapter), the step's title, a one-line purpose and a numbered stepper. The
  command palette adds "Open the projector" and "Watch room".
- **Material:** a forest brief, "Start from what you already teach". Under it
  are a dashed drop zone for a deck, a paste-a-syllabus card and a "Reuse a
  chapter" list. Once a source is read, the topics are hairline rows (tick,
  topic, six tiny bars for the levels the material supports, about how many
  questions), beside a forest panel with the planned count, a level bar and
  "Generate question bank".
- **Questions:** a "Coverage by Bloom level" card (split bar, level filters
  with counts, the thin levels named) sits beside a forest "For the room"
  panel. Below them are a toolbar and hairline question rows, with the answer
  key folding out under a row.
- **Planner and writing run:**
  - The size card shows its "asks first" mark.
  - The level mix has liquid tubes and a weight stepper per level.
  - A sticky forest "This run" panel summarises the run.
  - While questions are being written, a forest panel counts them and the
    tubes rise.
- **Room:** a forest panel for the room to be opened, with a rules card under
  it as rows. The mastery goal is 80, 90 or 100%, extra goes are none, one or
  two, and redemption is a switch. A waiting-room card says what happens next.
- **Live class:** a status eyebrow and the actions (Pause/Resume, Draw a
  student, Projector, and a menu holding CSV export, Classroom posting and
  closing the room).
  - **Brief:** a forest brief, "Class right now". It gives one sentence from
    the feed, WHAT/WHY/NOW lines and four tiles. Their sparklines are sampled
    from the moment the page opens and never invented.
  - **Heatmap:** a "Students × Bloom level" heatmap with sticky band headers
    and a ring on the level served now.
  - **Marbles and inspector:** the Rapier marbles in six tubes, then the
    inspector. It holds a radar of the student against the class, their
    recent answers, and their signals.
- **Projector:** a full-window forest stage. One frosted strip holds the join
  address, the room code set large in mono and the QR. Under it are the joined
  count and the marble tray in one colour, so no level shows on the wall.
- **Draw a student:** the ammo.js drum on a small forest stage, with "Next to
  answer" beside it (the roll number large in mono), the online-only switch
  and this page's picks. The pick is still made by `crypto.getRandomValues`
  before the drum moves.
- **Key gate:** the split forest layout. The key field is a password field and
  ships empty.

### Account screens

- **Overview (`/home`):**
  - The greeting carries the date and a live dot.
  - A forest brief covers the live or latest room, with five tiles.
  - "Your students" sits beside a sticky inspector holding six level bars,
    recent rooms and the seven Supports, each with one line on what it does,
    saved per student.
  - A rooms feed sits beside the chapters.
  - Each student's level and last-seen now come from the roster (server
    change made today).
- **Department (`/admin`):** a forest brief, then an accuracy-by-level heatmap
  in five steps of one green with a legend. It shows the department and
  expands to compare professors. Below it are the professors with codes,
  status, accuracy and invites.
- **Rooms (`/rooms`):**
  - A Live/Paused/Closed/All filter with search.
  - Rooms grouped by day as hairline rows (state chip, code, settings chips,
    joined, accuracy meter, actions).
  - A new **Deleted rooms** list (title and code, date archived, size against
    the 1 MB limit, Download).
  - The delete dialog says the room is archived first, and shows plainly when
    the server refuses an archive over 1 MB.
- **Your progress (`/me`):** a forest brief "Where you are" with the ladder lit
  to the student's level, a path of sessions you can open into answer strips,
  and six labelled level bars.
- **Strengths and gaps / Analytics (`/analytics`):**
  - A range control in the head.
  - For staff, a forest brief that can filter to the students under 40%.
  - The people list (with a spread chart) sits beside the record. The record
    has an SVG trend with a hover crosshair, by-level bars and hardest topics.
- **Profile (`/profile`):** the person as the heading, a forest ID card with
  the BloomLoop ID in mono and copy, connections as rows, and what the account
  can do.
- **Sign in, Sign up:** the split forest layout. Errors show under their field.
  Sign up has a two-step marker and shows the invite code as a receipt.
- **Gallery (`/__gallery`, dev only):** grouped by area, with a role and one
  line per entry, and kept out of production builds.

### Phase 1: evidence and review (19 Nov)

- **Review answers (`/review`):** written answers waiting for a professor.
  - It is listed in the rail for professors, the head of department and the
    teacher key.
  - At the top, a forest brief ("N written answers are waiting in M rooms")
    with tiles.
  - The queue is grouped by day, with cursor paging.
  - A sticky detail panel shows the question, the student's answer in full,
    the rubric and model answer, the mark so far with its log, and the
    decision form: confirm, or change the mark by rubric points or score. The
    note field is marked "Shown to the student".
  - Keyboard: J/K or the arrow keys move, Enter opens, Ctrl+Enter saves.
  - A head of department reads but cannot decide. A refusal shows the
    server's own sentence, and the typed note is kept.
- **Live class:** a Students | Topics switch on the heatmap card, with a
  topic × level grid for the room that says where its numbers came from. The
  inspector gains "Answers in this room": every attempt with its mark,
  Provisional / Reviewed / Changed and the teacher's note, with a link to
  review a provisional written answer.
- **Overview and `/me`:** a student's answers across rooms (paged, filterable
  by level and topic, with marks and notes), and a "By topic" grid. Pressing a
  square on Overview filters the list. Analytics adds a "Topics by level" card
  to each student's record.
- **Student phone:** a written answer's first mark says "Your teacher may
  review this mark."

### Phase 2: question bank and authoring (19 Nov)

- **Questions (`teach/Bank.jsx`):** generated questions arrive as drafts, and
  the screen opens on them.
  - The views are Drafts, Approved, Set aside, and "How it went" once any room
    has answered.
  - Each draft shows:
    - who wrote it ("AI draft · review" or "Offline template · review");
    - the slides it was read from, in mono;
    - each failed rule check, with its message, as a warn line.
  - Approve, Reject and Edit stay in view on every draft. Ticked drafts can be
    approved or rejected together.
  - **Approve all** asks first when any draft is flagged, offering "Approve the N
    that passed" or all of them. Afterwards it lists the flagged questions it
    let through, each with Open.
  - Approving a flagged question names the check it failed.
  - **For the room** counts approved questions only, with "N drafts waiting for
    your review" under it.
  - The source label comes from `model`, never from `source`, so a professor's
    own question has none.
  - The row menu holds Write a harder version, Write an easier version (each a
    new draft; the original stays), Rewrite it (confirmed first, since the
    question leaves rooms until its replacement is approved) and Set aside.
  - Approved rows carry their answers, % correct and band "for this class".
    Unfolded, they show the option spread and the wrong-key flag, whose Check
    the key opens the editor.
  - A replacing run while a room on the chapter is open shows the server's
    sentence and offers to add the questions instead.
- **Planner:** warns that replacing deletes the drafts waiting too. Each level
  offers "A mix of N" (the server's default spread over that level's kinds) or
  one kind.
- **Editor (`teach/Editor.jsx`, `teach/Media.jsx`):**
  - Editors for hot text (click the words), dropdown (one set of options per
    `____`), table (each cell given or written by the student) and grid (tick
    the matches).
  - A stimulus section: a passage with its source, or an image upload (PNG,
    JPEG or WebP, 500 KB at most) with required alt text. It is previewed as
    the phone shows it, from a blob url, since an `<img>` sends no token.
  - The failed checks are at the top.
  - A draft can be saved, or saved and approved.
  - **Write your own** opens it empty and says plainly that the question goes
    straight into the bank, approved.
- **Room (`teach/Room.jsx`):**
  - The whole approved bank (6 or more), or a set you pick (1 or more), with a
    level spread of the set.
  - A chapter with only drafts says so before the server refuses, with a button
    to the drafts.
  - The projector and `/rooms` show a set room's size ("Set of 8").
- **Live class:** a Questions view beside Students and Topics: the room's item
  statistics, flagged first. Its Check the key opens the question in the
  editor.
- **Counts everywhere:** Material, the step pills, the library and the
  professor's dashboard say "N approved · M to review", never "no questions
  yet" while drafts wait.

### Phase 3: classes, room modes, teacher records, insights, projector (19 Nov)

Every Phase 3 control follows the server's `canEdit` (classes) or `canControl`
(rooms), so a head of department reads and changes nothing. Server sentences
(errors, 409 reasons, notes, privacy, caveats, rules) are shown as they come.
None of the staff-only data reaches a phone or the wall.

- **Classes (`account/Classes.jsx`, `/classes`, `/classes/:id`):** a "Classes"
  item in every staff menu.
  - **The list:** newest first, with a New class dialog.
  - **One class, the roster:** in roll-number order.
    - Names and roll numbers are edited inline.
    - Removing is soft: the server's message is shown, with a way to put the
      student back. Removed students sit in their own list.
    - Students are added by pasting lines (roll and name), previewed exactly
      as they will be sent. The result shows every refused line with its
      reason, the ignored fields and the note.
    - Nothing asks for a phone number, email, date of birth or photo. Roll
      numbers are sent as typed.
  - **One student's observations** across days, in a side sheet with the
    privacy sentence.
  - **Across rooms:** the last 4 or 8 rooms, oldest first.
    - It shows the trend, the spread of accuracy (counts only), accuracy by
      level and the hardest questions.
    - The three level bands (Remember and Understand, Apply and Analyse,
      Evaluate and Create) show first, with the six levels one press away:
      decision 6, taken 19 Nov. Wherever the next question is chosen, and in
      one student's detail, the six levels stay.
    - Every figure says what it rests on, and no student is ranked.
- **Opening a room (`teach/Room.jsx`):**
  - **Class and mode:**
    - A class (optional).
    - The mode: Student devices, Teacher-led or Mixed, each with one plain
      line.
    - A waiting room.
  - **Room rules:** levels move (adapt), the start level, questions per
    student (1 to 500) and time per question (10 to 600 s, timed by the
    phone, late answers still taken).
  - A Teacher-led room without a class is explained before the server's 400.
    A room left on the defaults sends exactly what it sent before.
  - A new Teacher-led room goes straight to the live tools rather than the
    join code.
- **The live class (`teach/Live.jsx`):** a switch under the head between
  Class, Insights, Attendance (class rooms), In the room and Projector, with
  the class's "N / M present" beside it.
  - A Teacher-led room opens on In the room and has no Class view or join-code
    button.
  - "Draw a student" became **Spin the wheel**, the server's draw. The old
    client-side draw (`teach/Draw.jsx`, `fx/Drum.jsx` and their styles) is
    removed.
  - **Lobby (`teach/Lobby.jsx`):** while the room waits it shows phones joined
    of students present (labelled as not the attendance figure), with Start.
    Start is disabled with the server's reason when it cannot start yet. Pause
    is hidden until the room starts.
  - **Mixed and Teacher-led (`teach/FeedSplit.jsx`):** digital answers and
    teacher records in two labelled blocks, never added together, with the
    privacy sentence.
  - **Attendance (`teach/Attendance.jsx`):**
    - Present, late, absent and unmarked as four states that differ by shape
      as well as colour. Unmarked is never shown as absent.
    - Students are marked one at a time or several together, or everyone who
      joined is marked present. That last one is hidden in a Teacher-led
      room, with the reason.
    - The caveat that a typed roll number is not proof of identity sits
      beside "joined".
    - Students not on the roster and removed students are listed apart.
  - **In the room (`teach/Records.jsx` and its parts):** the wheel, the
    raised-hands tally, observations and activities.
  - **Insights (`teach/Insights.jsx`, `teach/StudentCard.jsx`):**
    - The band counts and three figures, each with its start and change.
    - The three cards, with their own action (ask at a level opens the
      Projector, sort reorders the list, wheel opens the wheel) and Dismiss
      with a note.
    - The students in the server's three orders, with no position numbers.
    - Teacher records apart from accuracy.
    - A row opens the student's card, where the next set is labelled a plan.
- **The projector:**
  - **Controls (`teach/ProjectorControl.jsx`):** make a link and turn links
    off. Choose question, diagram or progress, put a room question or a
    question asked aloud up, reveal or hide the key, choose a diagram, show
    first names or roll numbers, and take a pick down.
    - The preview is the server's `shows`, drawn by the same component as the
      wall.
    - Reveal is disabled outside Teacher-led rooms for a bank question, with
      the server's rule.
  - **The wall (`/wall`, `teach/Wall.jsx`):** the page a classroom PC opens
    from a link.
    - The token rides in the hash. It is taken out of the address bar at
      once and never stored, so a reload needs a new link.
    - It holds no credentials and loads no account or console code. Its
      socket sends only `projector:watch`.
    - It draws each `projector:state` whole:
      - the join code when nothing is up;
      - the question, and its key only once it is revealed;
      - the diagram;
      - progress, with levels held back until enough students have answered,
        saying why;
      - the pick, as a roll number and first name.
    - Closed and refused show the server's sentence.
  - The old full-window join screen (code, QR, marbles) is still "Show the
    code".
- **Student phone:**
  - A waiting room shows "Waiting to start" with the server's sentence, and
    the phone stops asking for questions until the start sends one.
  - A Teacher-led room shows the server's message and Leave, and nothing more.
  - A timed room shows a small clock. At zero it says "Time is up. You can
    still answer, and it will count." Submit never locks. A student with a
    no-timer or extra-time support sees no clock.
  - The room's cap shows the server's reason on the finish screen.
  - The question chip "Offline template" became "Not written by AI", since a
    professor's own question is `fallback` too and the phone is not sent
    `model`.
- **Rooms and Overview:** a Waiting state with "Open the lobby", and
  Teacher-led, Mixed and "Class roster" marks on a room.

### Phase 4: course outcomes, attainment, marks register, roster import (19 Nov)

Three new tabs on a class page (`/classes/:id?view=outcomes|attainment|register`)
and an "Import a CSV" button on its roster. All of it is staff only: no call is
made from `/join`, the projector or the wall, and the phone bundle carries none
of these routes. Writes follow the server's `canEdit`, so a head of department
reads only. Server sentences are shown as they come.

- **Calls (`lib/api.js`):** every Phase 4 route.
  - Reports and files share one query, `{ from, to, rooms }`.
  - `downloadCsv` fetches with the credentials in headers and saves the file
    under the server's name.
  - `openReport` opens a blank tab before the request (so it is not blocked
    as a popup) and points it at a blob url of the printable page.
  - Neither puts `?key=` in a url or builds a link to the API.
  - The roster import is sent as `text/csv`, so a file over the app's JSON
    limit still gets the import's own 1 MB sentence.
- **The report window (`account/ReportWindow.jsx`):** a date range and, if
  wanted, some of the class's rooms, shared by the attainment report and the
  marks register. It says that deleted rooms and rooms not opened for the
  class are not counted.
- **Outcomes (`account/Outcomes.jsx`):**
  - The class's course outcomes in order, with code, statement and target
    level. Archived ones sit at the foot with Restore.
  - Add, change, reorder and remove (the server's message says whether it was
    archived or deleted).
  - An editor per outcome maps a chapter's topics with weights. A 400 shows
    the valid topics. A renamed topic says "renamed or no longer in the
    chapter: map the old name to keep this evidence".
  - Questions mapped one by one: their own outcomes, or excluded from this
    class.
  - Copy from another class, and Export CSV.
  - **Coverage** writes out counted = reach an outcome + kept out by an
    override + reach no outcome. It shows questions, answers and students per
    outcome and topic, the summary sentences as given, and what reaches no
    outcome with a way to map it.
  - No student's name appears, and nothing maps or counts teacher records.
- **Attainment (`account/Attainment.jsx`, `AttainmentFormula.jsx`,
  `StudentAttainment.jsx`):**
  - The formula's name, version and source, and its methodology word for
    word.
  - Per course outcome, and per Bloom band with the six levels one press
    away, it shows:
    - students on the roster, counted, attained, not attained, not enough
      evidence and with no answers;
    - the share (rounded down, never up) and the level the formula gives it;
    - marks per evidence type, each "counted" or "shown, not counted", and
      per question source (AI-generated, professor-written, offline
      template), with the server's labels;
    - students outside the figure beside it, not inside it;
    - the summary sentence and what it rests on.
  - The students table is in roll order with every state in words. "Not enough
    evidence" is its own state, never a colour alone.
  - Teacher records and unmapped answers have their own sections.
  - A student opens one student's report: every answer behind each figure,
    with Print.
  - CSV (the outcomes sheet and the Bloom sheet) and a printable report.
  - **The formula** sits inside the tab:
    - Example presets by their own names, and only the changed fields sent.
    - A refusal says why and keeps the draft; a version clash reads the
      formula again and offers to apply the change again.
    - Nothing calls a formula NAAC, NBA or a standard, and nothing offers to
      count teacher records.
- **Marks register (`account/Register.jsx`):**
  - Students in roll order by rooms, oldest room first. Each cell has the
    attendance mark (a shape and a word), joined, and obtained of possible.
  - 0 of 0 reads "No answers", never 0 or 0%. An off-roster roll has no
    attendance mark.
  - The total carries the attendance counts. There are no teacher records and
    nothing is sorted.
  - It scrolls inside its card with the roll column fixed. CSV and a
    printable page.
- **Roster import (`account/RosterImport.jsx`):**
  - A file or pasted text, then a dry run.
  - The dry run shows what was read, who would be added, refused rows with
    reasons, duplicates, removed students (each with Put back) and the ignored
    columns by name only. Then the import, and the roster reads again.
  - The file's contents are never shown, and no value from an ignored column
    is drawn.
- **Icons:** a print icon for the printable pages.

### The owner's decisions of 19 Nov, and Phase 5 part 1: confidence taps and class questions (19 Nov)

- **Phone (`/join`):**
  - **Linking to an account:** a signed-in student's access token goes with
    the join. It is read from the browser's stored session, so the phone
    bundle carries no Supabase code. `linkNote` is shown as sent, only when
    sent. A linked phone's finish screen says the answers are also in the
    student's history.
  - **What comes next:** the phone reads the server's `PhoneRow`. The result
    and finish screens show `next.why` with `next.levels` and the count of
    answers it rests on. The reason under a question is the server's own
    sentence.
  - **Who wrote the question:** a professor's own question reads "Written by
    your teacher". "Not written by AI" stays for template questions, which
    also hold older professor questions.
  - **Confidence tap:** an optional Sure / Think so / Guessing row on every
    answer kind, labels from the server. It sits above the answer, because a
    choose-one sends on the tap. The line under it says it never changes the
    mark or the level.
  - **Class question:** the phone's own question is parked, not unmounted, so
    a half-built answer and the timer survive. The options are lettered, with
    the three taps. A vote can be changed while its round is open, and each
    vote has a fresh id.
    - Paused: the message and the phone's own vote.
    - Re-vote: vote again.
    - The confirmation never says right or wrong; a vote that did not count
      shows the server's message.
    - At the close, the key only when revealed, then back to the parked
      question (or the new one the server sends).
- **Live console:**
  - **A Class question space** (rooms where phones answer), marked "running"
    while one is open:
    - Pick an approved choose-one, true-or-false, have-your-say or
      choose-all question of the room's set; the server's refusals are shown
      as sent.
    - Round 1 shows only how many have voted of the phones joined.
    - Pause shows the spread, the share right (rounded down, with its count)
      and the taps by right and wrong.
    - Re-vote, then close, with "Show the key on phones as it closes"
      (never offered for a poll).
    - After the close: before and after side by side, and the five changes
      as counts.
    - Past class questions of the room can be opened.
    - Counts only throughout. An HOD reads only.
  - **Confidence counts:** the room's confidence counts sit below the class
    question, with the server's note. One student's card gains "How sure they
    said they were" as counts. No tap is shown beside an answer, and no
    student is labelled by one.
  - **Signals off:** a grid row whose `integrity` is null reads "off", never
    clear and never a signal. The trail shows the server's `message` when
    `signalsOff`.
- **Wall and its controls:**
  - A Teacher-led room's wall shows no join code. The console's projector
    command and code screen do not offer it either. A room reopened from a
    link keeps its mode.
  - A class question on the wall shows its state, the votes this round, and
    the counts before and after when switched on.
    - Each round's counts show only once it has closed with 5 or more votes;
      otherwise the wall says which of those it is waiting for.
    - The key, the share right and the changes only after the reveal.
  - Projector controls: a Class questions tab to put one up, the "Show vote
    counts on the wall" switch (off by default), and a line saying the key
    goes up by closing with the key on the Class question space.
- **Roster:**
  - **Under 18:** a quiet "Under 18" tag per student. The owner can set or
    remove the mark from the student's row menu. A note says what the mark
    does and that only staff see it, with the server's `under18Note` once a
    reply has carried it.
  - **Paste and CSV import:** a pasted list may have an Under 18 column. The
    import shows the column it read, the mark on each row to add, the
    server's `under18` sentence and `under18Note`.
  - **New class** follows the server's `canCreate`.
  - **Archive:** the rooms list says a deleted room's records stay in its
    archive.
- **Level bands first (decision 6):** "All your classes", the department's
  level map and a professor's classes open on the three level bands, with the
  six levels one press away. One student stays at six levels.
- **A student's own pages:** no `banded` and no support-band wording, and the
  server's `note` (only rooms joined while signed in appear).
- **Promotion copy (decision 2):** the room settings and the student's own
  page say moving up is 70% over the last five answers at a level, with at
  least three; sign-in says 70% over the last five. The room settings add
  that stepping back is below 40%, and that the mastery goal is the room's
  setting, 80% by default.
- **Bank and editor:**
  - **Sources:** a professor's own question is "Professor-written"; template
    text that may be an older professor question is labelled so.
  - **Rewriting an active question:** it keeps serving until the new draft is
    approved. The bank no longer asks to confirm the rewrite, because nothing
    leaves a room at once now. The reply's `note` is shown as sent.
  - A draft that replaces a question says "Replaces:" with that question.
    Approve, approve-all, restore and bulk restore name what was retired.
- **Attainment and register:**
  - The fourth evidence type, re-votes after discussion, is always shown and
    marked never counted, with the server's label. The formula never offers
    to count it.
  - The template source's label comes from the server.
- **Dev gallery:** each entry is drawn fresh when moving between entries, so
  one entry's state never leaks into the next.

### Phase 5 part 2: the review fixes, misconception labels and honest indicators (19 Nov)

- **Phone:**
  - **Who wrote the question:** under each question, and on a class
    question, a quiet line with the server's `provenance.text`. It replaces
    the chips built from `source`, so no "template", "fallback" or model name
    reaches a student.
  - **Early days:** when `next.provisional` is true, a gentle note says the
    level settles after a few more answers.
  - **Mastered levels:** the finish screen lists them with each level's
    `masteryBasis` sentence, never a percentage.
  - **Votes not counted:** shown with the server's sentence. A vote sent
    while the room is paused leaves the earlier vote in force, and the
    outbox records it as sent but not counted.
  - **Never on the phone:** a class question's id is never sent as an
    answer. No misconception label, level check, level move, translation
    warning, confidence count or anyone else's vote reaches it.
- **Live console:**
  - **Class question:** `answeredAloneNote` shows as soon as one starts,
    when phones had already answered that question alone. The question's
    `sourceLabel` is beside it.
  - **Grid:**
    - each student's `levelBasis` sentence under their roll number;
    - a provisional level drawn lighter, with a dashed ring and the word
      "provisional";
    - mastered cells ticked, with their `masteryBasis` sentence.
  - **Insights:**
    - each KPI's `sentence` and each card's `basis` sentence;
    - each student's `bandBasis` and `levelBasis`;
    - a provisional band always reads "Not enough answers yet".
  - **Student card:**
    - the `serving.basis` sentence beside the level;
    - "Level changes": time, from → to and the server's reason, five shown
      with "Show earlier";
    - mastery per level;
    - `languages.note` and a language tag on an answer in another language;
    - a provisional band never shown as firm.
  - **Misconceptions in the Insights space** (rooms where phones answer):
    the most-chosen misunderstandings, then each labelled option's sentence
    and note, with AI drafts marked and `otherWordingNote`. Counts only.
- **Item statistics (room and bank):**
  - `basis.sentence` beside the difficulty;
  - who wrote the question;
  - "Level uncertain" with its sentence;
  - the language note and warning;
  - each option's misconception label ("AI draft" until confirmed).
- **Bank and editor:**
  - **Misconceptions on wrong options**, in the editor for choose-one,
    choose-all and true-or-false:
    - a box of up to 120 characters beside each wrong option, never the key,
      with Save, Clear and Confirm (for an AI draft);
    - the label's provenance, its counts, and the server's refusal sentence;
    - saving changes no status and asks for no re-approval;
    - read-only when `canEdit` is false.
  - After an edit or a retag that removes labels, `misconceptionsNote` with
    each removed label and a way to open its question.
  - Every row has a `provenance.label` chip, with its sentence on hover and
    in the opened row.
  - "Level uncertain" sits beside the Bloom tag.
  - Rewriting a replacement or rejected draft shows `note` and keeps
    "Replaces:".
- **Class page:**
  - **A Misconceptions tab:** the class report with the shared date and room
    filter.
  - **Across rooms:**
    - the server's count sentences beside room accuracy, levels, level bands
      and the histogram;
    - the hardest questions with their basis, who wrote them and the
      uncertain mark.
- **Account:**
  - **A student's own pages:** a dash where a linked room's level is null,
    and the server's new note.
  - **Dashboards:** the answers and students behind each room's accuracy,
    and answers on an HOD's professor rows.
  - **Level bands:** the server's `levelBands` are used when sent, with the
    client's own pairing kept as the fallback.
- **Attainment:** one student's report tags class votes and shows the
  sentence for a vote set aside because the student had answered that
  question alone.

### Phase 6: the Learning Hub, wired to the API (19 Nov)

A signed-in student's own place to learn between rooms, from the zip's hub (H1
to H13 in `docs/UI_ZIP_AUDIT.md`), now on the real Phase 6 replies (`docs/API.md`,
"Phase 6: the Learning Hub", "What the screens need").

- **One adapter, `hub/hubApi.js`:**
  - Every route, student (`hub`) and staff (`staffHub`), through
    `http` in `lib/api.js` with the account's bearer token. Replies come back
    as the server sends them, and every refusal's sentence is shown as it is.
  - `newId()` makes the device ids (attemptId, clientRunId, runId), with a
    fallback where `crypto.randomUUID` is missing (http on a LAN).
    `untilDone()` polls a background run.
  - A student screen never calls `/api/content`, `/api/classes` or
    `/api/bank`. The one staff picker that lists a professor's chapters uses
    `/api/content`.
- **Answers kept on the device (`hub/pending.js`):** practice, lesson, Get
  Ready and self-test answers are saved before they are sent, and dropped
  once the server has them (201, or 200 for a resend of the same id). After
  no reply or a 5xx they stay and are resent with the same id and body, on
  the hub's next load and when the browser is back online. A 409 that says
  the question "stays closed" (asked in class, on an open self-test, the one
  a Get Ready check is asking) is kept too; every other refusal is final.
- **Language (`hub/lang.js`, `hub/Language.jsx`):** the server keeps the
  choice (`GET` and `PUT /api/hub/language`). The switch sits in every
  student hub header, each name in its own script. A change reloads what is
  open. Translated text carries `lang="hi"` or `lang="mr"`. The choice belongs
  to the signed-in account, so another student signing in on the same tab
  reads their own.
- **Routes:**
  - `/hub`: home.
  - `/hub/goals`: goals.
  - `/hub/c/:classId`: a class.
  - `/hub/t/:topicId` (`?tab=`, `?step=`): a topic and its lesson.
  - `/hub/t/:topicId/practice`: practice.
  - `/hub/practice?topicIds=&mode=review`: a review set.
  - `/hub/review`: reviews due.
  - `/hub/errors`: the error log.
  - `/hub/exam` and `/hub/exam/:examId`: self-tests.
  - `/hub/ready`, `/hub/ready/:topicId` and `/hub/ready/check/:checkId`: Get
    Ready.
- **Home (`hub/Home.jsx`):**
  - `notice` (the professor can see your progress) near the top.
  - Reviews due, with "Start a review set".
  - Goals and refresher paths.
  - Four weeks as a calendar, with practised days, rest days and the note,
    and never a streak.
  - The mastery map: classes, units, chapters and topics, then "Other
    chapters". Each topic shows its state in words with a shape, a
    provisional marker, the sentence, "Based on N answers" and when its
    review comes.
  - `empty`, and each part's `unavailable` sentence.
- **Goals (`hub/Goals.jsx`):**
  - Add, edit and remove a goal. The title has an 80-character counter, the
    exam date must be today or later, and the topic picker holds up to 60 of
    the student's own topics, searchable by chapter.
  - The 10-goal limit, and "Only you see your goals."
- **A class (`hub/ClassMap.jsx`):** units, chapters and topics with their
  states (the class view joined to `/hub/progress`), the next step, this
  class's reviews over seven days and the states' key.
- **A topic (`hub/Topic.jsx`, `hub/Prereqs.jsx`, `hub/MapGraph.jsx`):**
  - Prerequisites nearest first. Those from earlier material are marked and
    not linked. The chain is drawn with the layered map, laid out from `via`
    and `depth`.
  - The lesson in order: a cited slide chunk, a worked example, then
    retrieval questions, grouped as "Step N of M", with `lesson.label` and
    the language note.
  - Clean empty states for the introduction, facts, code example, common
    mistakes and the Visual (batch 8).
  - A lesson question that is `closed` shows its note and no answer box.
  - Never an AI-draft label, a model, a warning or a draft to a student.
- **Questions (`hub/QuestionCard.jsx`):**
  - `rich` first, then provenance, `why` and the language note.
  - Choose-one, true-or-false and choose-all are drawn in the card; every
    other kind uses the phone's own `learn/Answer.jsx`, which now draws
    `rich` too.
  - Hints one step at a time (`step` = shown + 1). The first carries `why`.
    The ladder stops at `remaining: 0` or `hint: null`, and the button goes
    once the answer is sent. After a reload, the hints already opened come
    back with the same attempt id.
  - After the reply only: right or wrong, the answer, feedback on the option
    chosen, the explanation with who wrote it, the provisional note, and the
    topic's new state with N.
- **Practice and review sets (`hub/Practice.jsx`):**
  - One attempt id per question shown. `shown` and `timeTakenMs` are sent.
  - An opaque `*Token` on the next question is passed back with the answer,
    ready for batch 8's serve token.
  - `question: null` shows the server's message.
  - The page says how many answers are waiting on the device.
- **Reviews and the error log (`hub/Review.jsx`, `hub/Errors.jsx`):**
  - Reviews due and coming up, each with when, the rule, and "a short second
    session soon after the first is part of learning".
  - The error log with status and topic filters kept in the address. Each
    entry shows the question, response, solution (or the held key's
    sentence), explanation, prerequisites, where it came from and its
    sentence.
- **Self-test (`hub/Exam.jsx`):**
  - Up to 20 topics from the student's own map, the levels, 1 to 30
    questions, and an optional 1 to 180 minute limit.
  - While open, only "saved", answered of total and the status. Every
    change of answer is a new attempt; an older one still waiting on the
    device is dropped so it cannot land after the newer one.
  - The clock comes from `secondsLeft`; the server ends it.
  - Results show the summary overall, by topic and by level, then each
    question with its mark label, held note, late note, explanation and
    feedback.
- **Get Ready (`hub/GetReady.jsx`), "Skip what I know · short check":**
  - The rule, each prerequisite's status, and the question with its `why`
    and no hint button. `waiting` when nothing can be asked.
  - Then the outcomes and the refresher path, with the next step marked, a
    Practise link on each step and the target last.
  - An open check on the same topic is carried on, not started twice.
  - Past checks are listed.
- **Refusals:** every screen says the same thing for the same status:
  - 503 "The Learning Hub is not open on this server", with the server's
    sentence, calm, nothing to retry;
  - 401 "You are signed out", with Sign in;
  - 403 "Not for this account", with the way to the right side;
  - 404, like any missing page;
  - anything else with Try again.
- **One state mark (`hub/StateMark.jsx`):** a shape per state, so it reads
  without colour. Its colours are in `styles/hub.css`.
- **Linked:** "Learning Hub" in the student's menu (`/hub`) and in a
  professor's or HOD's (`/hubs`), and on a class page for signed-in staff. It
  is hidden in laptop mode. Dev builds use `dev/DevViewer.jsx` in place of
  `RoleRoute` (see "Checks run").

### Phase 6: the professor's Learning Hub (19 Nov)

`/hubs`, for a professor and, read-only, the department's HOD. Built from the
Phase 6 staff routes. When `canEdit` is false every control is hidden, and the
page says it is read-only in one line.

- **Routes:**
  - `/hubs`: classes.
  - `/hubs/c/:classId?tab=structure|progress|states`: a class.
  - `/hubs/c/:classId/s/:rosterId`: one student, read-only.
  - `/hubs/ch/:contentId?tab=topics|explanations|hints|translations|languages`:
    a chapter.
  - `/hubs/t/:topicId?tab=links|lessons`: a topic.
  - `/hubs/links`: proposed links.

  Tabs are kept in the address and move with the arrow keys.
- **Structure (`hubstaff/ClassStructure.jsx`):**
  - Units can be added, renamed, removed and reordered. Reordering works by
    drag, or from the keyboard with the grip focused and the up and down
    arrows; each move is announced.
  - Chapters are placed from `available`, moved within or between units,
    and taken off.
  - The page redraws from each reply's `hub`.
  - "Preview as a student" opens a side sheet (`?view=student`).
- **A chapter's topics (`hubstaff/ChapterTopics.jsx`):**
  - Slides, approved and draft questions, and links in and out. Retired
    topics are greyed and listed last.
  - The slides note, "Make topic records" when the chapter has topics not
    yet recorded, and how many questions match no topic.
- **Links (`hubstaff/TopicLinks.jsx`, `hubstaff/LinkQueue.jsx`):**
  - Every state, with confirm, reject and remove.
  - A link added by hand in either direction. A loop's 409 is shown as given
    (it names the chain).
  - The chain students see.
  - "Suggest prerequisites": a device-made `runId` and a polled run. The
    proposals are AI drafts, "not used until confirmed", with what was left
    out and why. Offline, the note says nothing was proposed.
  - The queue counts proposed, confirmed and rejected links.
- **Review queues:**
  - **Explanations** (`hubstaff/Explanations.jsx`): write, edit, approve or
    remove, and "Draft explanations".
  - **Hints and feedback** (`hubstaff/Hints.jsx`):
    - three step slots per question, and feedback for each wrong option;
    - the server's 400 when a hint gives the answer away, shown under the
      box with the text kept;
    - "Approve drafts", with refusals and their reasons;
    - "Draft hints with AI", and "no longer shown".
  - **Lessons** (`hubstaff/Lessons.jsx`):
    - the lesson serving, drafts and history;
    - "Make a lesson", off while one is being written;
    - Approve and Discard, with the reply's message;
    - a preview as a student in English, Hindi and Marathi;
    - each retrieval question links to approving it in the console's bank.
  - **Translations** (`hubstaff/Translations.jsx`):
    - English and the translation side by side, with findings split into
      "to fix" (blocking) and "to check" (flags);
    - a 409 for flags turns the button into "Approve: I checked them", which
      resends with `confirmFlags`;
    - write by hand, edit and discard, "Translate", and out-of-date notes;
    - each kind of item is labelled.
  - **Language statistics** (`hubstaff/Languages.jsx`) use Phase 5's
    `TranslationLine`.
  - Every background run shows its sentence, progress and error. With no
    model, the server's offline note is shown plainly.
- **Progress (`hubstaff/ClassProgress.jsx`, `ClassStates.jsx`,
  `StudentProgress.jsx`):**
  - A roll-order matrix of students by topic. Each cell shows the state
    mark and word, N, provisional and open errors. Roster rows with no
    account show their note.
  - Each topic's students by state in roll order, with no-account rows
    apart.
  - One student: activity as counts over 7 and 30 days by mode, hints used,
    their topics, their error log with question ids, and their Get Ready
    checks and paths.
  - Never a ranking, a sort by score, an average beside a name, or a
    student's goals.

### The design zip's gaps, client only, and the server follow-ups of 4c1df09 (19 Nov)

The client-only gaps the roadmap chose from `docs/UI_ZIP_AUDIT.md`; each ID is
its row there.

- **Shell:**
  - **F2:** a toast (`ui/toast.jsx`, role=status, polite). It is used only
    where a result would otherwise go unseen; failures stay beside their
    control. The phone never loads it.
  - **F4:** a rail badge hides on its own page.
- **Live console:**
  - **F3:** the space and the records tab are in the address (`?space=`,
    `?tab=`), so a reload or a shared link keeps them. Ctrl+K has "Spin the
    wheel", "Attendance", "Observations" and "Raised hands".
  - **L3:** a grid footer counts the students mastered at each level, at the
    room's goal, from the rows' own marks.
  - **#1:** the time since the room was opened. It is not a planned length,
    because `startedAt` counts from creation.
  - **#3:** the median working level.
  - **#4:** a Cells / Dots view of the heatmap, kept per device.
  - **#5:** a "Since opened" trend per student, in neutral ink and labelled
    as counted from this page's opening.
  - **Insights** open in roll order (the server's `sort.default`).
- **Room set-up, lobby and the code:**
  - **R1:** "About N minutes for each student", only when both the cap and
    the time per question are set, and named as an estimate.
  - **R2:** who has joined the waiting room: roster names in a class room,
    roll numbers otherwise, never a typed name. The line under them comes
    from the server's counts.
  - **R3:** the code is shown in two halves with a gap, never a dot or a
    hyphen, on the lobby, the room page, the code screen and the wall.
    Copying it gives the six characters.
    - The phone's code field now keeps letters and digits only, so "ABC 123"
      or "ABC-123", typed or pasted, lands as ABC123. It allows nine
      characters, so a pasted separator is no longer cut off before it is
      removed.
  - **#8:** "Phone browsers, no installs" under the joined count.
- **Records:**
  - **W1:** think time. Draw first runs a ten-second countdown, with the
    question to think about when one is picked. "Skip to draw" draws at once
    and Cancel draws nothing. The server is asked only when the countdown
    ends. It runs on the console only.
  - **W3:** "Start new round" sits inside the empty-wheel note.
  - **W4:** a Names switch shows roll numbers only, for a mirrored screen.
    It is kept for the browser session and never sent.
  - **C1:** in a class room, the observation roster shows each student's
    attendance mark. Absent rows are dimmed in colour, and the mark is in
    the row's accessible name.
  - **#11:** a knowledge check with a tally has "Project to class". It puts
    that question on the wall and opens the Projector space.
- **Bank and material:**
  - **M4:** "Use sample" fills an example unit, only while both fields are
    empty, and offers "Clear the example".
  - **B1:** "Draft for these levels" opens the planner in append mode,
    weighted to the levels the bank calls thin (four drafts each, a client
    default).
  - **B2:** a new question starts at the level and topic filters in force.
  - **#7:** "Reviewed · N of M": approved and waiting per level.
- **Class page:**
  - **A2:** two charts over the class's rooms:
    - accuracy and participation as two labelled lines, with values on the
      points;
    - stacked bars of answered, present without an answer, absent and not
      marked;
    - each part has its own fill, edge and written counts.
- **Server follow-ups (4c1df09):**
  - The server's `levelBands` are read, with each band's sentence.
  - `under18Note` shows on a fresh load.
  - Staff student lists are in roll order.
  - The phone takes `mine` on resume and pause.
  - The projector shows its reworded refusals as sent.

### Phase 7, stage "First": the phone keeps working offline (19 Nov)

- **Service worker (`client/sw/joinWorker.js`, built to `/sw.js` by
  `client/sw/plugin.js`):** hand-written, no Workbox.
  - It is registered by the phone alone, with scope `/join`, and only in
    production builds. The dev server and every staff screen never have one.
  - The build writes the precache list into it: the `/join` entry chunk and
    its imports, the entry CSS and the Latin fonts that CSS names. The cache
    is named by a hash of that list, and older ones go on activate.
  - The `/join` page is fetched from the network first and falls back to the
    kept copy when the network is down or slower than 4 seconds. Hashed files
    under `/assets/` are served from the cache first.
  - `/api` and `/socket.io` always go to the network; nothing the server
    says is cached.
  - There is no skipWaiting: an open room keeps the build it started with
    until the tab is closed.
  - The server's static files vary on Origin (its CORS), so the cache is
    matched with `ignoreVary`.
  - To try it, build and serve the build. `vite preview` proxies `/api` and
    `/socket.io` like the dev server.
- **Answer outbox (`lib/outbox.js`, IndexedDB):**
  - Every answer and class vote is written there first, under its
    `answerId`, then sent.
  - It is append-only and scoped by room code and roll number.
  - After the rejoin is accepted, it is replayed one item at a time. The
    server's result does not carry the `answerId`, so a reply is matched by
    order, with a 12 second wait.
  - An item counts as sent only when the server's reply arrives. An unsent
    item is never deleted.
  - A refusal for good (the room closed, the set finished) is kept and shown,
    never retried.
  - A reply for an earlier question goes to its outbox item and never paints
    over the question on screen.
- **Reconnecting:**
  - The socket retries with jittered backoff, 0.6 to 10 seconds, without end.
    It also tries at once when the browser says it is back online.
  - The full-screen "Reconnecting" panel is gone. Offline is now one calm
    line under the bar: "Offline: your answers are kept on this phone and
    will be sent when you reconnect". The student can keep answering the
    question on screen.
- **Indicators:**
  - "Saved on this phone" (held), "Sent" (the server has it, not yet marked:
    a written answer, a poll, a retry) and "Marked" (the result came back).
  - Nothing says right or wrong before the server has marked it. The phone
    holds no keys.

### Phase 7, stages 2 and 3, and F1: packs, late answers, the console outbox, imports and laptop mode (19 Nov)

From `docs/API.md`, "Phase 7: offline-first", and the roadmap's note of 19 Nov.
That note wins where it differs from the builders' notes.

- **The phone: question packs (`learn/LearnApp.jsx`, `lib/outbox.js`):**
  - After each join, once the outbox has drained, the phone asks for a pack
    (`student:pack`) and keeps it in IndexedDB (a `packs` store) with
    `issuedAt` and `expiresAt`.
  - It asks again after `class:question`, after `class:closed`, and after
    live answers in a room that limits questions per student.
  - The images of packed questions are cached while online (`bloomloop-media`
    in the service worker).
  - Offline, after the question on screen, "Next question" opens the pack in
    order, one go each, never skipped or reordered. Each shows its reason
    sentence and "Offline n/N". Each answer is "Saved, will be marked when
    you reconnect"; never a mark, key or right or wrong.
  - The pack stops at `expiresAt` or when used up, with one sentence.
  - After an offline reload the phone offers "Answer the questions kept on
    this phone".
- **The phone: replies by `answerId`:**
  - `server:result`: marked, with the late message when there is one.
  - `server:kept`: saved, does not count. The message shows for the visit,
    and the item is dropped. Never a mark.
  - `server:refused`: refused for good (including the cap of 100 kept
    answers). Kept, shown, and never resent.
  - Matching by order remains only for replies that carry no id.
- **The phone: closed rooms:**
  - With unsent answers the phone joins with `deliver: true`, and rejoins
    that way after "That session has already been closed.".
  - With `deliverOnly` it sends only and shows the message and
    `deliverUntil`, or "saved but does not count" after it. It never shows a
    question.
  - An imported room's refusal marks the items refused, shows them with
    "Show these answers to your teacher", and stops retrying.
- **The phone: `rich`:**
  - The phone now draws the server's HTML (MathML, shiki) for every field
    the server sends it for, in live, class and packed questions, through
    one helper (`rt` in `learn/parts.jsx`). Otherwise it draws the plain
    field.
  - A dropdown gap's choices stay plain, because a native `<select>` cannot
    hold HTML; they show rich in the result.
- **The phone: http on a LAN:** the service worker is not registered (no
  secure context). During an outage the offline line adds "Do not reload
  while the Wi-Fi is down; your answers are kept on this phone".
- **Console outbox, F1 (`lib/consoleOutbox.js`, `teach/SyncStatus.jsx`):**
  - Every teacher-record and attendance write (observations, attendance,
    the wheel, the tally, activities, insight actions) goes through an
    IndexedDB outbox kept per account or key.
  - Each item has one UUID `Idempotency-Key`. Its body, `basedOn` included,
    is fixed at the first send.
  - `basedOn` chains from the server's last stamp, in the write's own field
    names; a tally sends `counts`.
  - Items are sent one at a time, oldest first:
    - a 2xx (replayed or not) is done;
    - a 5xx or no reply is retried with the same key;
    - any 4xx is kept and shown;
    - a stale 409 shows `error` beside `current` (and `newer`), and can be
      resent only as a new item with a new key, or discarded in two steps;
    - 401 and 429 are held, never retried by themselves.
  - The header pill reads "Synced", "Offline · N waiting" or "Syncing". The
    "Sync status" dialog lists waiting and refused items.
  - Toasts say "Saved on this device · will sync" and "All records synced",
    and a staff offline banner shows while offline.
  - A draw is not queued offline: the server makes the pick and it goes on
    the projector, so a late one would surprise the room. "Absent" on a pick
    is two writes (the pick, then its own attendance mark).
- **Imported rooms (`teach/imported.jsx`, `account/ImportRooms.jsx`):**
  - "Imported from a laptop" with its date and run on the rooms list.
    `importedFrom.note` on the live room, review, attainment, the register,
    the report window and a class's rooms.
  - "Leave out imported rooms" sends `imported=leave-out` on attainment and
    the register; on the rooms list it filters on screen.
  - Item statistics say "Asked on the laptop, not in this chapter's bank".
  - Kept answers show in the live room's answer list with no mark and the
    server's sentence.
  - The import screen opens from the rooms list. It reads files in the
    browser and sends them one at a time. It asks for a chapter or a class
    when the server needs one (told apart by what was sent). "Already
    imported" is not an error. It is not offered to an HOD or on the laptop.
- **Laptop mode (`teach/laptop.jsx`):**
  - `GET /api/laptop` once per page.
  - A banner with the folder, the interval, the last write and the last
    error, and what is unavailable.
  - No sign-in, and no hub.
  - With the console at localhost, the projector and wall build the join
    link and QR from the laptop's network address, with a chooser when
    there are several. With no address, they say phones cannot reach it yet.
  - With the console at any other address, the banner says every device on
    the Wi-Fi can reach it, to use it on this laptop only and to lock it.
    `docs/API.md` and the roadmap's note disagreed here; this does both.
  - The 429 lock-out sentence is shown at the gate as it is, never retried
    by itself.

## References and what they shaped

- Karim's Goodfor design (Claude Design file, Nov 2026) shaped the direction:
  the forest rail with folding groups, the glass top bar with search, the
  page-head eyebrow with a live dot, the dark brief panel (tag, one sentence,
  WHAT/WHY/NOW lines, frosted KPI tiles with sparklines, drifting dashed
  lines), the glass cards, line charts with a hover crosshair, lists with an
  action at the right, score rings and small-cell heatmaps.
- Karim's earlier "BloomLoop v4" handoff supplied the screen inventory and the
  compositions kept from it: the prep step pills, the room code plate, the
  students × level heatmap, the radar inspector, the draw stage and the 16:9
  projector.
- Mobbin, Quizlet "enter join code"
  (https://mobbin.com/screens/a8192739-6109-4395-b0a9-c2b3d1ae437a): the one
  wide, letter-spaced code field.
- Mobbin, Duolingo match and streak feedback
  (https://mobbin.com/screens/8199682b-96e6-4d64-be65-98e3dd309fc2 and
  https://mobbin.com/screens/a8db96b1-31d0-46aa-bf74-0ca30e8e3b44): the
  verdict as a tinted sheet where the thumb already is.
- Mobbin, Liven and Google Maps level-up moments
  (https://mobbin.com/screens/db31d935-a489-48f2-84c5-c358688a1246 and
  https://mobbin.com/screens/1965ab91-7a4c-4c03-9e07-716dcf09adb7): one
  sentence and one button on a dark stage for the level change.
- Mobbin, Duolingo and Brilliant lesson-complete screens
  (https://mobbin.com/screens/31fdc425-1a41-4b78-b4e6-762bff0b9306 and
  https://mobbin.com/screens/f5881118-ee68-4f94-b0fa-c56e9bffb6f0): the framed
  figures on the finish brief.

The full list of 22 references, with what each offers, is in the session notes
(`ui-references.md`). Dribbble showed a bot check, so no Dribbble shot was
opened. Behance pages gave text but no images, and Pinterest was not used.

## Checks run

- `npx vite build` passes.
- **What `/join` downloads:**
  - 160.7 KiB of gzipped JavaScript plus 21.4 KiB of CSS. Earlier today it was
    about 156 KiB; the difference is mostly the larger icon set.
  - No Supabase client, no teacher or account code, and no Rapier or ammo.js.
  - No Google Fonts request.
  - The gallery is not in the production files.
- **Every screen loads cleanly at 1280px and 390px:** no console errors, and
  no sideways page scroll (the two heatmaps scroll inside their own cards).
- **Contrast scan:** every text element on the console, dashboards, results,
  analytics, rooms, sign-in and the student phone was checked in light and
  dark. Two muted greys were raised to pass everywhere. The heatmap cells were
  checked by hand, since the scan cannot read `color-mix`.
- **Student flow, run for real:** joining, answering, retry, the verdict and
  the paused cover were driven against a test room. The level change and the
  finish screen were checked through the dev gallery.
- **Live class:** checked against pretend classes, with pause and resume
  exercised for real.
- **Phase 2, against the Phase 2 server on the in-memory store:**
  - Approve, reject, approve all, and approving only the drafts that passed.
  - Harder (made a draft) and Harder refused (the server's 502 sentence shown).
  - A replacing run refused while a room was open (the 409).
  - A set room opened (HW3EKZ, 8 questions).
  - The drafts-only room screen.
  - Item statistics from a 14-student pretend class.
  - An edit saved to each new kind, a question written from scratch, and a PNG
    uploaded and attached.
  - The build passes. `/join` is 161.0 KiB gzipped and still loads no
    teacher code.
  - The new gallery entries (bank, author, items, room) render with no
    console errors at 1280 and 390, in light and dark.
- **Phase 3, against the Phase 3 server on the in-memory store (shared key):**
  - **Classes:** create, paste a roster (refused lines with reasons; "03" and
    "3" kept as two students), rename, a roll-number clash, remove, put back,
    edit course and term. Also a student's observations, and the analytics at
    last 4 and last 8.
  - **Opening a room:** through the real form as Mixed with a waiting room,
    adapt off, Apply, a cap of 5 and a 30 s timer. The reply carried the
    settings, the class and `waiting`.
  - **The lobby:** Start disabled with the server's reason until a phone
    joined. Six pretend phones then showed "6 / 6 present" in the lobby
    beside "6 / 25 present" for attendance, and Start served them.
  - **Attendance:** one mark, a mark of several, and everyone who joined
    (hand marks kept). A room with no class shows the server's 409 sentence.
  - **The wheel:** draw; a bank question on a pick; Absent marking attendance,
    and not when unticked; the empty-wheel 409; present only off; a new
    round.
  - **The tally:** made from the bank, plus and minus, the 0 case, reveal, and
    a phone number refused.
  - **Observations and activities:** observations set, cleared and noted
    (an email refused), keys 1 to 4. An activity recorded and changed (a
    group label with contact details refused).
  - **Insights:** act and dismiss (a note with a phone number refused), and a
    dismissal made elsewhere arriving by the socket. A student's card opened
    from the list.
  - **The projector:** a link made and turned off; on the wall, a question
    revealed in a Teacher-led room and a diagram. Reveal was refused (409)
    and disabled in a Student devices room, while a question asked aloud
    could be revealed there. Progress held back until 5 had answered, then
    pushed live. A wheel pick shown with and without names. A bad token
    refused.
  - **The phone:**
    - A waiting room's screen and its start.
    - The Teacher-led message.
    - The clock: it counts down to "Time is up" and Submit stays open.
  - **Bundles:**
    - The build passes.
    - `/join` is 155.7 KiB gzipped. The phone's new states added 1.3 KiB.
      Splitting the icon set then took 6.6 KiB off: `ui/Icon.jsx` keeps the
      31 icons the phone draws, and the 73 staff-only icons are in
      `ui/staffIcons.js`, loaded with every staff screen and the wall. It
      still loads no teacher, account or Supabase code.
    - `/wall` loads its own chunk, its stylesheet and the staff icons beyond
      the base. It never loads `api.js` or `auth.js`.
    - No icon is missing on a fresh load of the live room, Classes, Rooms,
      the wall or the phone: in development an unknown icon name is now a
      console warning.
    - The phone was run once more after the split:
      - joined a room with a 15-second timer and a cap of 2;
      - answered the second question after "Time is up" (it was taken);
      - reached the finish screen with the cap's reason.
  - **Galleries:** classes, attend, records, coach and wall, plus five new phone
    states. Checked at 1280 and 390 in light and dark, with no console errors
    and no sideways scroll.
  - **Contrast:** worked out from the token pairs each screen uses, not
    measured with a tool.
- **Phase 4, against the Phase 4 working tree on the in-memory store (shared key):**
  - **Outcomes:** on a class of the agent's own:
    - copied outcomes from another class (a second copy is the clash 409);
    - mapped topics (a weight over 100 is the 400);
    - a duplicate code (409), an email in a statement (400), add, change,
      reorder and delete;
    - an outcome archived once answers reached it, and its restore refused
      while its code was in use;
    - an override set, changed to excluded and removed;
    - coverage moving from 30 = 30 + 0 + 0 to 30 = 21 + 0 + 9 when a topic
      was taken off;
    - the CSV.
  - **Attainment:** on the seeded class (366 answers over two rooms):
    - the report, a window narrowed to one room (which showed students
      outside the figure), one student's 22 answers;
    - both CSV sheets, and both printable pages: the right report, no key in
      the page.
    - Formula saves on a class of the agent's own: a save (version 1), a 400
      that kept the draft, a save with nothing changed, and a simulated 409
      re-applied (version 2).
  - **Register:** on the seeded class, the figures matched the JSON, a
    one-room window, the CSV and the printable page.
  - **Roster import:** on a class of the agent's own:
    - a dry run with a Phone column (no digits shown anywhere);
    - Put back, the import, a file over 1 MB (413), 2,001 rows (400) and a
      file with no header (400).
  - **After the server's review fixes (final field names), on a fresh store:**
    - Attainment: CO1 at 11.76% (rounded down); "Outside the share" beside a
      figure with its own evidence; the source split under the server's
      labels; the definitions as sent.
    - On a class of the agent's own, with a roll number changed after
      answering: one row, each answer "Given as" its old roll, a removed
      student and an off-roster roll each shown apart with the server's note.
      A room weight outside the window reads "not in this report".
    - Register: a "Who wrote the question" view beside "How it was marked";
      an off-roster old roll with its tie note; the CSV with the new leading
      rows and source columns.
  - **Bundles:** the build passes. `/join` is still 155.7 KiB and contains
    none of the Phase 4 routes.
  - **Galleries and contrast:** outcomes, attain and register galleries (42
    states), at 1280 and 390, light and dark, with no console errors and no
    sideways scroll. Contrast was measured in the page and passes AA in both
    themes.

## Checks run: the owner's decisions and Phase 5 part 1

Against the current server tree on the in-memory store (shared key), restarted
19 Nov on the decisions and Phase 5 code.

- **Class question, through the console:** a fresh Student devices room with
  7 simulated phones, run open, then pause, re-vote and close with the key.
  - Round 1 showed only "7 of 7 phones joined".
  - After the pause: 42%, 3 of 7 right.
  - After the close: 57%, 4 of 7 right.
  - The spread was 2/1/1/3 before and 2/0/1/4 after.
  - The changes were 1 wrong to right, 0 right to wrong, 3 right both times
    and 3 wrong both times on the same answer.
  - Every figure matched the server's GET.
  - Each builder also ran its own rooms: the console with 8 and 9 phones,
    including a choose-all closed without the key; the wall with 8 phones.
- **Phone:** at 390 px in its own room:
  - a made-up stored token gave the `linkNote`, and no token gave no note;
  - a vote, a changed vote and a reload restoring the vote in force;
  - pause, re-vote and close with the key, then back to a half-built answer
    intact;
  - a true-or-false closed without the key, a choose-all with the key, and the
    room paused and resumed during a class question;
  - an answer tapped "Think so" counted in the room's confidence counts.
- **Wall:** open, paused (8 votes), re-vote and closed with the key at
  1920x1080 and 1280x720, and a Teacher-led wall with no join code.
- **Roster:** on a class of the builder's own, setting and removing the mark,
  and a dry run and import with Under 18 and Date of birth columns.
- **Bank:** a question written in the bank came back as the professor's own.
  Rewriting it gave a draft with `replacesId` and a `note`. Approving it named
  the retired question, and so did restore, approve-all and bulk restore.
- **Attainment:** after a re-vote on the seeded class, the report showed
  "Re-votes after discussion: 8, never counted", and so did one student's
  report and the register.
- **Bundles:** the build passes. `/join` is 158.9 KiB, under its 161 KiB
  target. It has no class-question, attainment or under-18 routes; its
  Supabase strings are only the stored-session key it reads.
- **Galleries:** all 305 entries render with no script error. The new states
  are at 1280 and 390, light and dark, with contrast measured at AA or better.

## Checks run: the Learning Hub wired, and Phase 7 stages 2 and 3

- **Where:** a local harness (`tools/hubserver.mjs` in the UI session's
  scratchpad, not in the repository). It runs the server code of this working
  tree on the in-process store, with a stand-in for Supabase Auth answered
  in-process, no model, and nothing leaving the machine (0 requests refused).
  It seeds through the real API:
  - an HOD, a professor and four students, plus a roster row with no account;
  - two units, three chapters and 55 approved questions with formulas and
    code;
  - confirmed, proposed and rejected links;
  - explanations, hints and feedback, lessons, and Hindi and Marathi
    translations;
  - a student's activity in all five topic states, backdated.

  A cookie chooses the account in dev; `dev/DevViewer.jsx` stands in for
  `RoleRoute` in dev builds only.
- **Bundles:** the build passes. `/join` is 165.5 KiB gzip (162.1 before):
  +2.2 for packs and replies, +0.6 for `rich`, the rest from shared code.
  Its CSS is 22.3 KiB. The hub (42.7 KiB) and the staff hub (34.8 KiB) are
  their own lazy chunks.
- **Routes, headless Chrome, at 1280 (the main ten of each side again at
  390):**
  - as a student: 17 hub routes, including an open and an ended self-test,
    an open and a complete Get Ready check, a review set and a missing topic;
  - as the professor and as the HOD: 15 staff routes and the class page,
    including every tab, a student, a no-account roster row and the preview;
  - no console error, no blank page and no sideways scroll. Wrong-role pages
    show their refusal.
- **503:** the memory server (no accounts) behind a second dev server: every
  student and staff route shows "The Learning Hub is not open on this
  server" with the server's sentence.
- **Galleries:** 532 entries (the hub's 156 among them) at 1280 and 390: no
  console error or warning, none blank, no sideways scroll.
- **Builders' checks, live on the harness:**
  - practice with hints, a hint restored after a reload, a lesson answer,
    the 409 "closed for now" kept on the device, and Hindi with a reload on
    switching;
  - goals added, edited and removed, and the 400 for a past date;
  - a 10-question self-test over nine kinds with a changed answer, a reload
    and resume, and a one-minute timed test locking at zero;
  - a Get Ready check to its path;
  - units reordered by keyboard and by drag, the loop 409, a hint's leak 400,
    a Marathi translation through the flags 409, and Make a lesson then
    Discard;
  - an HOD seeing no controls on every staff page;
  - scripted AA in both themes on every new screen.
- **Phase 7, live:**
  - The phone, as a production build in headless Chrome against the Phase 7
    server, with the server stopped to make the outage:
    - a pack answered offline, including a reload partway, with images from
      the cache; all marked once on reconnect, none stored twice, and a
      fresh pack after;
    - a packed question put to the class came back kept and was dropped;
    - a room closed while offline: its answers delivered late, with no
      question shown;
    - a LAN address with no service worker showed the hint;
    - formulas in light and dark at 390.
  - The console outbox, with offline switched off by an in-page fetch
    switch:
    - chained observations and attendance;
    - stale 409s for attendance, a pick and a tally, resent with a new key;
    - a lost reply replayed under the same key;
    - a 503 retried until 201;
    - items surviving a reload.
  - Imports and laptop mode:
    - a real import as the professor: the chapter 400, the class 400, 201,
      then "already imported";
    - that room marked across the live room, attainment, the register and
      the class;
    - a laptop-mode server: banner, no hub or sign-in, the projector's
      network chooser, and ten wrong keys reaching the 429.
- **Fixed in integration:**
  - one state mark, and the same refusal wording on every hub screen;
  - only the "stays closed" 409 is kept on the device (an id used for
    another answer was being kept for good);
  - the language choice follows the signed-in account;
  - staff `/hubs` no longer reads a class view when a student opens it.

## Checks run: the zip gaps and the follow-ups

Against 4c1df09 on the in-memory store, restarted and reseeded 19 Nov.

- **Bundles:** the build passes. `/join` is 162.1 KiB, unchanged by the
  staff gaps; the toast, think time and charts are not in it.
- **Galleries:** all 342 entries render, with no script error and no React
  warning.
- **Contrast:** measured on the new records entries in light and dark; every
  text element passes AA.
- **The phone's code field, in the browser:** "ab-c 12-3" became ABC123,
  "K7Q 42M" and "k7q·42m" became K7Q42M, and a seventh character was dropped.
- **Builders' live checks on their own rooms:**
  - a reload of `space=room&tab=observe` reopening on Observations, and the
    new palette entries;
  - L3's count at Remember matching the server;
  - the lobby going from "Everyone present has joined" to "3 still
    joining…" as students were marked present;
  - copied codes giving six characters;
  - think time, Names off, Start new round and attendance on the
    observation roster, with 2 absent and 1 late;
  - "Project to class" putting the tally question on the projector;
  - B1 writing eight drafts weighted to two thin levels;
  - the class charts against real rooms;
  - `under18Note` on a fresh load.

## Checks run: Phase 5 part 2

Against the committed server (2f4fd2b) on the in-memory store, restarted 19
Nov, with labels added to seven questions of the seeded chapter.

- **Class page, Misconceptions tab:** 12 labels on 6 questions from 271
  answers across 7 rooms. The top five matched the server's reply.
- **Live console, Insights space:** room XF5RYZ's report with 14 labels on 7
  questions from 74 answers, with no console errors.
- **Builders' own checks:**
  - phone: provenance, early days and a vote sent while the room was paused
    (the server counted 1 voted, 1 not counted);
  - console: a class question with 12 phones that had already answered it
    alone (the note showed), provisional grid rows, a card with real level
    changes and mastery;
  - bank: labels saved, edited, cleared and refused, an edit and a bulk
    retag that removed labels, and the rewrite of a replacement draft;
  - account: the class's Across rooms sentences and hardest questions.
- **Bundles:** the build passes. `/join` is 162.1 KiB, under the 164.9 KiB
  ceiling, and carries no label, level check, level move or confidence
  count.
- **Galleries:** all 334 sample entries render with no script error. One
  sample listed a student twice, which raised a React key warning; fixed in
  `dev/records.gallery.jsx`.

## Checks run: Phase 7 "First"

- **Bundles:** the build passes. `/join` is 161.9 KiB, up 3.0 KiB from 158.9
  (the budget allowed 6). `sw.js` is 3.9 KB. The precache list is the phone's
  three chunks, its CSS and four Latin fonts, with no staff chunk.
- **The outage, in headless Chrome against :5050** (a production build under
  `vite preview`; the outage was the preview stopped), room HQS8FY:
  - Twice: answered with the network down ("Saved on this phone") and
    reloaded offline. The page opened from the cache, with the held answer
    and the offline line. Back online, the same question returned, and the
    answer was sent and marked.
  - The socket was cut after an answer was sent but before its result came
    back. Back online, the phone was on a new question; the old answer was
    sent again and shown as Marked, with nothing painted over the new one.
  - A class vote cast offline was confirmed after reconnecting.
  - On the server: four rows, three answers on three questions and one vote,
    each a first attempt and final. Nothing was stored twice.

## Not finished

- **No Google sign-in button.** Sign-in is email and password only in
  `lib/auth.js`, so a Google button would do nothing. Google linking stays on
  the profile and results screens.
- **Data the API does not send yet:**
  - Slide numbers per topic on Material (it shows the topic's position). A
    question's own slides are shown in the bank.
  - The passage a draft was written from: only its slide numbers come back.
  - A class-wide timeline for a professor (the trend is per student).
  - Per-course level data for a head of department (the heatmap rows are the
    department and its professors).
- **Never seen on screen:**
  - A marble changing tube when a student moves level, because no pretend
    student moved off Understand.
  - Drag and hover on the marbles.
- **Not run end to end:** account screens backed by Supabase (it was
  unreachable today) were checked only through the dev gallery. This includes
  the Phase 1 answer history on Overview and `/me`, and the head of
  department's read-only review.
- **Phase 2, not run:**
  - A bearer-token caller: a professor's own chapter, and an HOD's read-only bank.
  - Generation by Gemini: every draft seen was an offline template.
  - A poll in the editor: it still says it has no editor.
- **Phase 3, not run:**
  - A head of department against the server. Every read-only state was
    checked only by drawing it with `canEdit` or `canControl` false, since the
    shared key may always write.
  - The wheel's spin animation (only the reduced-motion landing ran in the
    hidden pane), a screen reader, and the wall's reconnecting state.
  - Opening the wall in a real new window: the built-in browser blocks
    pop-ups.
- **Phase 4, not run:**
  - A head of department, a student or a signed-out caller: read-only is
    drawn in the galleries only.
  - A real version clash on saving a formula (simulated), a real renamed
    topic, and the 50-outcome cap against the server.
  - A print dialog, paper or a spreadsheet opening the CSV.
- **Phase 4, not seen live:** a roll number off the roster whose attendance
  mark was made for a roster student (`rollNotes[].tiedTo`) in the attainment
  report. The register showed one; the note sentence carries it in both.
- **Owner decisions and Phase 5 part 1, not run:**
  - A student account: no real token linked a phone (the in-memory store has
    no accounts), and a student's own pages were checked in the gallery
    only.
  - A head of department against the server: read-only class questions,
    wall controls and roster are drawn in the galleries only.
  - On the phone, against the server:
    - a vote that did not count;
    - a class question arriving over a result or level-change screen;
    - the new question that follows when the class question was the
      phone's own.
  - A server refusal of a class question live (the console disables the
    button when the room's state rules it out).
  - The 400 for a formula that counts re-votes (no control sends it).
- **Learning Hub, not run:**
  - Supabase, a real sign-in, Mongo or a model: every check used the
    harness's stand-in accounts. AI drafts were written into the store, and
    lessons are slides-only.
  - A screen reader, reduced motion emulated, and MathML on a low-end
    Android.
  - An offline retry of a hub answer against a dropped connection (only a
    harness restart mid-answer was seen kept).
  - Marathi on a student screen (no approved Marathi exists in the seed).
  - Approving the seeded AI drafts (explanation, hints, lesson, a
    translation after confirming flags): gallery only.
- **Learning Hub, wanted from the server:**
  - Question text keeps its line breaks: `services/edits.js` collapses
    whitespace in a hand-written question's `text`, so a fenced code block
    arrives on one line, `rich` is `{}`, and every screen shows raw
    backticks. Inline backticks are not turned into code either.
  - `textHtml` / `optionHtml` on the staff queue views (explanations, hints,
    translations): they send plain text, so `$...$` shows as source there.
  - Per-level figures on `/api/hub/home`, to bring back the student's own
    Bloom levels against a month ago (the zip's H12).
  - The student's earlier answers on a lesson reply: after a reload the
    lesson's questions show unanswered again.
  - `onYourClasses` on error-log prerequisites, so earlier material can be
    marked there too.
  - Docs: `optionFeedback[].option` is the option's text, not an index; and
    an explanation's and feedback's `language` is an object while a hint's
    is a string.
  - The console has no link to one question in the bank (a lesson's
    retrieval question lands on the chapter's bank, the error log's question
    on the chapter's explanations).
- **Zip gaps, not run:**
  - The Overview and Department pages live (they need a sign-in): gallery
    only.
  - "Use sample" with generation on: offline, the bare sample topics cannot
    give Understand or Analyse drafts (the server answers "Generation
    produced no valid questions").
  - A screen reader through think time; the countdown is announced at its
    start and at five seconds.
- **Phase 5 part 2, not run:**
  - An AI draft label from the server: labels written by hand are always
    the professor's, so Confirm was seen in the gallery only.
  - A question with an uncertain level, a second answer language, and a
    mastered tick in the grid: none occurred live, so all three are gallery
    only.
  - A head of department, and the "another phone signed in as this student"
    vote sentence, which needs a signed-in student.
- **Phase 7 "First", not run:**
  - A real phone, iOS Safari (which may delete a site's stored data after
    seven days unused, and in private mode), and an outage of several
    minutes.
  - The service worker in the app's own browser pane, which refuses to
    register one. All service-worker proof is from headless Chrome.
  - Two answers held offline in a row: the next question comes from the
    server, so that waits for the question pack ("Next").
  - Refused items stay on the phone for good. A later stage should age them
    out.
- **Phase 7 stages 2 and 3, not run:**
  - A real phone or iOS, and Chrome's own offline switch (the server was
    stopped instead).
  - The pack request after live answers in a capped room, pack expiry, and
    `server:refused` or an imported room's refusal on a live phone (gallery
    only).
  - An insight action through the outbox (a room with no answers has no
    cards), and the outbox draining outside the console: `/rooms` and the
    other account pages do not mount it.
  - A wall opened through `?join=`, and a kept answer from a real late phone
    in the console (gallery only).
  - The staff analytics answer list carries no `detail`, so kept answers
    cannot be marked there. The misconceptions report has no leave-out
    option (its rooms carry no `importedFrom`).
- **Wanted from the server:**
  - `answerId` echoed in `server:result`, `server:exhausted` and
    `session:rejected`, so the outbox matches a reply by key, not by order
    and a wait.
  - `/sw.js` served with `no-cache`. It is sent `immutable` today. The
    browser checks it anyway (`updateViaCache: 'none'`), but a CDN in front
    could keep the old worker.
  - The answer key (`answerKey`) on staff answer reads, for audits.
- **Fewer choices:** for a student given that support, a stored choose-one or
  choose-all answer can name the wrong option text. The server keeps the full
  option list, not the shorter list the student saw.
