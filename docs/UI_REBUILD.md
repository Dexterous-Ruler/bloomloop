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

## Not finished

- **No Google sign-in button.** Sign-in is email and password only in
  `lib/auth.js`, so a Google button would do nothing. Google linking stays on
  the profile and results screens.
- **Data the API does not send yet:**
  - Slide numbers per topic (Material shows the topic's position instead).
  - Per-question accuracy in the bank (no meter on question rows).
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
- **Fewer choices:** for a student given that support, a stored choose-one or
  choose-all answer can name the wrong option text. The server keeps the full
  option list, not the shorter list the student saw.
