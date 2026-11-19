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
- **Phase 3, wanted from the server:**
  - A `canCreate` on `GET /api/classes`. The New class button follows the
    role until then.
  - The room's mode in `projector:state`. Today the wall shows the join code
    in a Teacher-led room too, where a phone only gets the Teacher-led
    message.
  - `model` on the phone's question, so it could say "Offline template"
    again where that is true.
  - Rewording three server sentences that show API detail to people:
    - the remove message's "(PATCH with { "active": true })";
    - the Teacher-led `cardsNote`'s "teacherRecords";
    - phone `reason` sentences that can name the below-40% band (an open
      issue).
- **Fewer choices:** for a student given that support, a stored choose-one or
  choose-all answer can name the wrong option text. The server keeps the full
  option list, not the shorter list the student saw.
