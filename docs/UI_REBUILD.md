# BloomLoop client rebuild (v5, 18 Nov 2026)

The web client was recreated from scratch a second time today, from Karim's own
Claude Design handoff ("BloomLoop v4") and outside references. Every screen and
the shell have a new composition; the data layer (`client/src/lib/*`) is
untouched.

## Direction

- **Warm, not graphite.** A cream page, an espresso sidebar, and one espresso
  panel per screen with a slow terracotta and saffron glow behind it. Terracotta
  is the action (buttons sit on a darker lip they press into); saffron is the
  thing to look at, used on espresso only.
- **Type with a voice.** Bricolage Grotesque for titles and big numbers (read
  from across a room), Instrument Sans for text, IBM Plex Mono for room codes,
  roll numbers and counts. All self-hosted through Fontsource (SIL OFL 1.1); no
  Google Fonts request.
- **The level is a ladder.** The six Bloom levels are one warm ramp, pale gold
  (Remember) to brick (Create), lightest to deepest, so the order survives
  greyscale and colour-blind eyes. The brand mark and the level glyph are the
  same six rising rungs. A level colour always has its name or number beside it.
- **Right and wrong are green and red,** nothing else is. No purple or violet
  anywhere, no emoji.
- **Both themes are first-class.** Every text pair in `styles/tokens.css` was
  checked at 4.5:1 or better on the surface it sits on, field borders at 3:1.
  High contrast, dyslexia font and larger text are student supports set by the
  professor and still apply through `data-contrast`, `data-dyslexia`,
  `data-large`.

## Where things live

- `styles/tokens.css` palette for both themes and `.on-panel` (turns text tokens
  over inside an espresso panel); `base.css` type and layout; `ui.css` the
  component set's look; `shell.css` the rail, page head, drawer and the split
  `.gate` layout for screens outside the frame.
- `ui/index.jsx` components. New: `Ladder` (also exported as `Loop`), `Mark`,
  `Switch`, `Stepper`, `Steps`, `Section`. `Avatar` now takes a warm tint per name.
- `shell/AppShell.jsx`: an espresso rail with grouped navigation (Prepare,
  Teach, Overview, Account, Learn), the theme switch and the account menu at its
  foot; a page head with crumb, title and actions; below 1024px a bar and a
  drawer. `shell/ThemeToggle.jsx` is separate so `/join` does not download the
  frame.
- `dev/*.gallery.jsx`: sample-data views at `/__gallery` (dev only). New:
  `learn.gallery.jsx`, the student phone in the states that are hard to reach by
  hand (retry, marked right and wrong, level up and down, paused, finished).

## Screens

<!-- filled in below as each area lands -->

### Student phone (`/join`, `/join/:code`)

- **Join:** split screen. An espresso art half says "Answer at *your* level"
  over the six-rung ladder growing in; the form half asks for the code in one
  wide letter-spaced mono field, the roll number and an optional name. On a
  phone the art becomes a short band above the form.
- **Question:** an espresso bar (room code plate, roll, connection, "Not me"),
  then the climb: six rungs across the top, lit to the working level with that
  rung ringed and named. The question sits on its own sheet in display type,
  with tactile answer tiles. Under it the product's reason in a saffron-ruled
  line, the goes hint and focus mode.
- **Retry:** an amber "Not quite" band with one pip per go left; nothing is
  revealed and the options reopen.
- **Verdict:** the dock floods green, red or amber and the Lottie mark draws
  itself in a disc; the server's sentence and "Next question" sit under it.
- **Level change:** the whole screen turns espresso and a six-rung tower climbs
  (or folds down) to the new level with GSAP; down is "re-aiming", never failure.
- **Paused, reconnecting, lost:** an espresso cover over the mounted question
  with one saffron icon tile and plain words.
- **Done:** a deep terracotta hero ("That is your set") with a progress ring and
  three figures, then the liquid tubes (spring height-field) filling per level.

## References and what they shaped

- Karim's Claude Design handoff, `BloomLoop v4.dc.html` (cream, espresso rail,
  terracotta and saffron, Bricolage Grotesque, prep step pills, espresso hero
  panels, room code plate, students × level heatmap, radar inspector, spin
  stage, projector): the direction and most compositions.
- Mobbin, Quizlet "enter join code":
  https://mobbin.com/screens/a8192739-6109-4395-b0a9-c2b3d1ae437a, the one wide
  letter-spaced code field.
- Mobbin, Duolingo match and streak feedback:
  https://mobbin.com/screens/8199682b-96e6-4d64-be65-98e3dd309fc2 and
  https://mobbin.com/screens/a8db96b1-31d0-46aa-bf74-0ca30e8e3b44, the verdict
  as a tinted sheet where the thumb already is.
- Mobbin, Deezer party quiz:
  https://mobbin.com/screens/d96b1a9f-2524-4181-93d6-0b482c186e4e, answer tiles
  with a hard bottom edge in the thumb zone.
- Mobbin, Liven and Google Maps level-up moments:
  https://mobbin.com/screens/db31d935-a489-48f2-84c5-c358688a1246 and
  https://mobbin.com/screens/1965ab91-7a4c-4c03-9e07-716dcf09adb7, one sentence
  and one button on a dark stage for the level change.
- Mobbin, Duolingo and Brilliant lesson-complete:
  https://mobbin.com/screens/31fdc425-1a41-4b78-b4e6-762bff0b9306 and
  https://mobbin.com/screens/f5881118-ee68-4f94-b0fa-c56e9bffb6f0, the three
  framed figures on the finish hero.

The full list of 22 references, with what each offers, is in the session notes
(`ui-references.md`). Dribbble showed a bot check, so no Dribbble shot was
opened; Behance pages gave text but no images; Pinterest was not used.

## Not finished

<!-- filled in at the end -->
