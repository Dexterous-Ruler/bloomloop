# UI zip audit: the v4 design against the built client (19 Nov 2026)

A read-only comparison of the primary file in the owner's design zip, `BloomLoop v4.dc.html`
(1,473 lines: an HTML template from line 9 to 993 and a state class from line 994), with the
client in `client/src` as it stood on 19 Nov 2026. Line numbers marked "v4 123" are lines of
that file. Paths under "What we have" are relative to `client/src`. Nothing was rendered: the
zip was read as text, and the client was read and searched, not run.

## Summary

Outside the Learning Hub, **27 gaps**: **19 small, 6 medium, 2 large**. Almost all of them
are small. The built client already goes well past v4 on most screens: the approval gate,
attendance, the server's wheel, class questions, insights, attainment and the wall. The
**Learning Hub** is not built at all, which is expected because its server is Phase 6. It
counts as one large piece, and every element of it is listed in its own section below.

The five most worthwhile gaps:

1. **F1, offline records on the teacher's device (L).** v4 is designed around a console that
   keeps working without a network. It shows a Synced / Offline / Syncing pill, a panel of
   records waiting to sync, and "Nothing is discarded, even if the app closes". The phone has
   this (`lib/outbox.js`). The console does not: attendance, observations, wheel responses,
   tallies and activities fail when the network drops.
2. **L1, the AI teaching move (M).** On the live screen, one press asks for a two-minute,
   no-device activity aimed at the level where the class is stuck. It uses only the numbers on
   the screen and is marked "AI suggestion, your call". Nothing like it exists. The same route
   would also serve **C2**, activity prompts written for the chapter.
3. **W1, think time on the wheel (S).** A ten-second countdown with the question on screen
   before the draw. It is a known classroom technique (wait time), it costs little, and it
   needs no server work.
4. **A1, session comparison by level (M).** Each level's accuracy in the previous room beside
   the latest one, with the change. The class page pools 4 or 8 rooms, so it cannot say what
   moved since last time.
5. **B1, one press to draft for the thin levels (S).** The bank already names its thin levels.
   v4 has a button that drafts questions for exactly those levels. Today the professor opens
   the planner and sets the levels by hand.

Close behind: **F3**, which makes the wheel and the room's records reachable directly, from
the address bar and the Ctrl+K palette. Today they are two clicks deep and lost on reload.

Things that could not be settled are listed at the end.

Sizes:

- **S:** under a day of client work, with no server change or a trivial one.
- **M:** a day or two, or it needs a new server field or route.
- **L:** several days, with server design work.

## Batch 8 status (19 Nov 2026)

The server side of these gaps is built in `ba0f59d` (`docs/API.md`, "Batch 8"), and the
UI session built their screens in `4384844`, checked against local servers only:
- **Served by the server:** M1, M2, M3, M5 (material); L1 and C2 (teaching moves and
  activity prompts); L2 (the class on the room); W2 (the wheel's Question + student);
  A1 (the class comparison: `roomReport` already carried per-room levels, so the new
  part is the comparison block) and A3 (`contentId` on hardest items); P1 and H9c
  (stepped figures on the projector and in lessons); H9a and H9b (the concept panel's
  sections); and from the older files H5 ("why this path") and gaps 2 (per-level
  insight lines), 6 (support against the previous room) and 9 (a verbal ask).
- The rows below still describe the gaps as they were found.

## Gaps by screen

### Frame: rail, top bar, header

| ID | The zip has | What we have | Server work | Size |
|---|---|---|---|---|
| F1 | **A sync state for the console (v4 62-80, 1090-1096, 1273-1277).** A pill in the header reads "Synced 09:52", "Offline · 4 waiting to sync" or "Syncing · 4 records" (with a spinner). Pressing it opens a "Sync status" dialog with the time of the last sync and a sentence for each state. The offline sentence is "Saved on this device and sent when you reconnect. Nothing is discarded, even if the app closes." The dialog lists each waiting record with its time and Queued / Sending, and shows "Nothing waiting. Every record is on the school server." when empty. Every record shows a "Saved on this device · will sync" toast, and reconnecting ends with "All records synced". Esc closes the dialog (v4 1071). | The top bar has only "Server unreachable", "Offline templates" and "Not saved" chips (`teach/TeachApp.jsx` 361-375). The phone's answer outbox (`lib/outbox.js`) is phone only: a search of `teach/` for outbox or queue finds nothing. When the network drops, an observation, attendance mark, wheel response, tally step or activity fails with an error and is not kept. | An idempotency key on every record write (observation, attendance mark, wheel pick patch, tally step, activity), so a replayed write is stored once. Possibly one batch route for a replay. | L |
| F2 | **A toast (v4 992, 1442).** A short confirmation at the foot of the screen with `role="status"`: "Saved", "Join link copied", "Question removed", "4 AI drafts added · review before use", "Write the question first". | Confirmations are inline: Notes, "Copied" on the copy buttons, spinners on rows. There is no toast anywhere in the staff client (a search for "toast" finds only `learn/LearnApp.jsx`). | None | S |
| F3 | **The wheel and the room's records as places of their own (v4 1270).** They have their own rail items ("Spin wheel", "Roster & activities") and their own crumbs: "Fair, random and visible to the class" and "Teacher-led · works on one device" (v4 1271). A "Project to class" button sits in the header of both (v4 67-69, 1449). | They are spaces inside Live class (`teach/Live.jsx` 1064-1072), reached by "Spin the wheel" or the space switch. The space is component state (`Live.jsx` 706), so a reload or a shared link loses it. The Ctrl+K palette offers only "Open the projector" and "Watch room" (`TeachApp.jsx` 300-304). | None. Put `space` and the records tab in the address, and add "Spin the wheel", "Attendance", "Observations" and "Raised hands" to the palette. | S |
| F4 | **A rail badge hides while you are on its page (v4 1270, `badgeDisp`).** | The badge always shows (`shell/AppShell.jsx` 108-110). Trivial. | None | S |

### Material

| ID | The zip has | What we have | Server work | Size |
|---|---|---|---|---|
| M1 | **Where each topic came from (v4 195, 1043):** "slides 3–4", "slide 14" or "line 3" under each topic name. Each question in the bank cites the same (v4 1255: "Each question cites the slide or line it came from."). | Topics show their position, "01", "02" (`teach/Material.jsx` 412). A question's own slides are shown in the bank. `docs/UI_REBUILD.md` lists this under "Data the API does not send yet". | The slide range (or line) per topic on the content read. | M |
| M2 | **Topic × level coverage that includes unticked and unsupported levels (v4 137-148, 1212).** The key is "ticked", "not ticked" and "not supported" (a dashed ring). Each cell has a tooltip: "{topic} · {level}: will be asked / supported, not ticked / not supported by the material". The topic rows' six bars show which levels the material supports (v4 196, 1206: "Supports: Remember, Understand, Apply"). | `LevelTicks` shows the first plan's mix for ticked topics only. An unticked topic shows "—" (`Material.jsx` 157-168, 414-417). Nothing says that a level is not supported by the material. | The levels each topic can support, for every topic, ticked or not. This could be a `supports` list per topic on the preview or the content read. | M |
| M3 | **A "Write with AI" switch beside Generate (v4 202, 1143).** With it on, the note reads "AI writes about 24 questions across 5 Bloom levels. You approve each one." (v4 1208). With it off, the built-in templates write. If the model is unavailable, the toast says "AI unavailable · used built-in questions" (v4 1149). | The server decides. The top bar shows "Offline templates" when it has no model key (`TeachApp.jsx` 364-368). The professor cannot choose templates on purpose. | A flag on `POST /api/generate` that asks for the template writer. | S |
| M4 | **"Use sample" on the syllabus card (v4 169, 1259).** It fills the title and topics with an example unit, so a first-time professor sees the shape the text should take. | Not found (searched for "sample"). The field hint says "One topic per line reads best." (`Material.jsx` 82). | None | S |
| M5 | **When each library chapter was last used (v4 1213):** "4 topics · used 12 Nov". | The date the chapter was read, with topic, approved and draft counts (`Material.jsx` 133-140). | A last-used date per chapter, for example from the newest room opened on it. | S |

### Question bank

| ID | The zip has | What we have | Server work | Size |
|---|---|---|---|---|
| B1 | **"AI assist", one press for the thin levels (v4 250-255, 1182-1198).** "Drafts 4 questions for your thinnest levels (Evaluate, Create, Analyse) from these topics only. Drafts stay out of the room until you approve them." It has a "Draft with AI" button that turns into "Drafting…", and ends with the toast "4 AI drafts added · review before use". | The coverage card names the thin levels in a sentence: "Thin at …; approve or write more there." (`teach/Bank.jsx` 514-525). "Add questions" opens the planner in append mode with no levels set (`Bank.jsx` 660-662). | None. Open the planner in append mode with the thin levels already weighted. | S |
| B2 | **A new question starts at the current filter (v4 1262).** "+ Add question" takes its level and topic from the level and topic filters in force. | "Write your own" opens a blank editor with no level and no topic (`Bank.jsx` 655-659, 855-862; `teach/Editor.jsx` 125-129). | None | S |

### Room

| ID | The zip has | What we have | Server work | Size |
|---|---|---|---|---|
| R1 | **How long the room will take (v4 334, 1238):** "About 10 minutes at this pace", worked out from questions per student × time per question. | Not found. The cap (1 to 500) and the timer (10 to 600 s) are separate fields with no total (`teach/Room.jsx` 744-766). | None | S |
| R2 | **Who has joined the waiting room (v4 363-368, 1233-1234).** Initials and first names pop in as phones join. The line underneath reads "Waiting for the first student…", then "7 still joining. Start any time; late joiners slot in.", then "Everyone present has joined." | The lobby shows the count, a meter and a fixed line (`teach/Lobby.jsx` 75-88). It names nobody. The projector's marbles show arrivals, but not who they are. | None. The live grid's rows already carry roll numbers, and names in a class room. | S |
| R3 | **The code split for reading aloud:** "K7Q·42M" on the room panel, the live hero and the projector (v4 312, 455, 943). | The six characters are letter-spaced but not grouped (`teach/Projector.jsx` 115, `teach/Live.jsx` 1200). Check that the phone's join field ignores the dot before adding it. | None | S |

### Live session

| ID | The zip has | What we have | Server work | Size |
|---|---|---|---|---|
| L1 | **"AI teaching move" (v4 485-500, 1174-1181, 1294-1298).** The resting card reads "Get a two-minute, no-device activity aimed at where the class is stuck.", with the line "Uses only the numbers on this screen" and a "Suggest a move" button. While it waits it says "Reading the class data…". The answer comes with "Based on 14 students on Apply, 38% above 60% there, 6 below 40% overall · AI suggestion, your call". Under it sit "Use it" (which records that the move was used) and "Another idea" (which asks for a different one). If the model fails, the card says "AI unavailable · try again". The model's instructions say "Never label or judge individual students". | Not found (searched for "teaching move", "Suggest a move", "Another idea"). The Insights space has three cards with their own actions (`teach/Insights.jsx`), but none of them suggests an activity. | A staff route, for example `POST /api/session/:code/suggest-move`. It builds the context from the room's aggregate figures only, which the server already has: counts per level, the support band count, the not-answered count and the chapter's topic. The model call stays on the server. The reply is `{ move, basis, sourceRef }`, marked as an AI suggestion (decision 1: it must come from the professor's material and cite it). "Use it" can write an activity through the existing activities route. | M |
| L2 | **The course and chapter on the live head (v4 449):** "Data Structures · Chapter 4". The analytics context line reads "Data Structures · TY-CSF B · 8 sessions" (v4 378). | The head shows the status, the room code and the chapter title (`Live.jsx` 1086-1092). The class name appears only inside Attendance and Observations (`teach/Attendance.jsx` 218, `teach/Observe.jsx` 235). | The class's course and section on the room row, or one class read. | S |
| L3 | **How many have mastered each level, one figure per level.** v4's "Bloom's pyramid" (v4 557-570, 1347) gives each level the share of present students at 60% or more. Its colours break a rule (see "Left out on purpose"), but the measure itself is useful. | Each heatmap cell marks mastery at the room's goal (`Live.jsx` 1461, 1501), and the "At the goal" tile counts students mastered at one level or more (`Live.jsx` 1290-1296). There is no count per level. | None. The rows already carry their mastery, so this means counting the server's own marks at the room's goal, not the zip's 60%. | S |

### Spin the wheel

| ID | The zip has | What we have | Server work | Size |
|---|---|---|---|---|
| W1 | **Think time (v4 671-678, 1101-1104, 1361-1368, 1370).** A "Think time" switch. With it on, Spin starts a ten-second countdown first. The side panel shows "Think time · everyone", the seconds in large figures and the question. The ring around the hub empties as the seconds pass, and the hub shows the number. "Skip to spin" ends it early. The pick is made only when the countdown ends. | Not found (searched for "think", "countdown"). Draw goes straight to the server (`teach/Wheel.jsx` 568-587). | None: the timer runs before `POST /wheel/draw`. Showing the countdown on the wall as well would need a field on the projector state (and would make this M). | S |
| W2 | **The wheel's modes (v4 600-603, 1100, 1112, 1459).** "Classic wheel", "Quick pick" (no animation) and "Question + student". In the last, each spin also picks a question from the bank at random, and the question shows with the pick (v4 699). An "Another" button moves on to the next question (v4 697, 1461). | One way to draw. Each pick has a manual question picker (`Wheel.jsx` 288-303). The ring walks for 1.5 s and lands at once under reduced motion (`Wheel.jsx` 141-160), so "Quick pick" adds little. | For "Question + student": an option on `POST /wheel/draw` to draw a question from the room's approved set with the same server randomness. The client must not pick it. | M |
| W3 | **An empty wheel offers the fix in place (v4 606-612).** "Everyone present has had a turn", "Start a new round to put everyone back on the wheel.", with a "Start new round" button. | The server's `pool.empty` sentence shows as a note (`Wheel.jsx` 476). "New round" sits in the card's head, away from the note (`Wheel.jsx` 455-459). | None | S |
| W4 | **A "Names" switch (v4 1370, 1356, 1377).** With it off, the wheel, the pick and the history show roll numbers only. This matters when a laptop screen is mirrored to the class. | The projector has its own names switch (`teach/ProjectorControl.jsx`). The console wheel always shows names and the pick's responses (`Wheel.jsx` 199-200, 268, 371). | None | S |

### Roster and activities ("In the room")

| ID | The zip has | What we have | Server work | Size |
|---|---|---|---|---|
| C1 | **Attendance on the observation roster (v4 743, 754, 1387-1391).** Absent students' tiles are dimmed. The tile's accessible name reads "Aarav Shah, roll 01, absent, Understood". The side panel has a "Present / Absent" toggle beside the four marks. | The observation rows carry no attendance state (`teach/Observe.jsx` 97-161). Attendance is its own space (`teach/Attendance.jsx`), so a professor marking observations cannot see who is absent. | The attendance mark per student on the observations read, or the screen reads attendance too. | S |
| C2 | **Activity prompts written for the chapter (v4 1007).** For example: "Benches of four write the postorder sequence of the projected tree on paper. Record which groups got it, not which students.", and "Ask where trees appear around them: family trees, phone folders, a school timetable." The prompt shows large when the activity is chosen (v4 790-795). | Each of the five kinds has one fixed generic line (`teach/Activities.jsx` 22-28). | The same route as L1, asked for one kind. It is drawn from the chapter's text, cites its slide, and is marked an AI suggestion. | M |

### Analytics (class across sessions)

| ID | The zip has | What we have | Server work | Size |
|---|---|---|---|---|
| A1 | **Session comparison (v4 405-415, 1315, 1323-1324).** "Class accuracy by Bloom level, %", with the previous session and today as paired bars per level. Under each pair is the change, such as "+6" or "−2", in green or red. | "Accuracy by level" pools the 4 or 8 rooms (`account/Classes.jsx` 1213-1258). The latest room cannot be set against the one before. | Per-room level figures in `GET /api/classes/:id/analytics`. `roomReport` has none today (`server/src/services/classAnalytics.js` 106-118); the level cells are only pooled (173-178). | M |
| A2 | **Two charts over sessions:** a labelled line chart of accuracy and participation per session, with values on the points and dates on the axis (v4 381-394); and stacked bars per session of answered, present without an answer, and absent (v4 416-423). | The same figures appear as sparklines in the brief tiles and as numbers in the "Rooms, oldest first" table (`Classes.jsx` 1029-1062, 1067-1138). | None: `rooms[]` already carries accuracy, participation and attendance. | S |
| A3 | **From a hard question to the bank (v4 426):** "Open question bank" beside "Hardest questions". | The hardest list has no way to open a question (`Classes.jsx` 1260-1330). | `contentId` on each hardest item. The service reads the banks by content id (`classAnalytics.js` 187-200), but `hardItem` does not pass it on. | S |

### Projector

| ID | The zip has | What we have | Server work | Size |
|---|---|---|---|---|
| P1 | **A diagram the class steps through (v4 958-976, 1401-1408).** A tree drawn on the wall lights up one visit at a time. The visits so far fill a row of tiles. Buttons read "Next visit", then "Start over", and "Switch order" changes the traversal (Preorder, Inorder, Postorder). The SVG has a full text description (v4 961). | A diagram is a question's picture or passage, shown still (`ProjectorControl.jsx` 436-452). It has no steps. | A structured, code-rendered diagram with ordered steps (allowed by decision 4, in the batch planned after Phase 6), and a `step` on the projector state that the wall follows. | L |

## The Learning Hub ("My Learning Hub", a student view)

v4 802-927 is the template, 1010-1019 holds the content and 1413-1440 the behaviour. The rail
lists it as "Learning Hub" under a "Student view" heading (v4 1270). The crumb reads "Riya
Sharma · student view" and the title "My Learning Hub" (v4 1271).

**What exists today:** none of it (searched for prerequisite, concept, path, hub, translation
and both language names). Some nearby pieces can be reused; they are listed after the
element table.

### Every element, and what it needs from the server

| # | Element (v4 lines) | What it does | Data it needs |
|---|---|---|---|
| H1 | **Hero, greeting** (807) | "Hi Riya, here's your path" | The student's first name, from their account (decision 7: the Hub needs an account). |
| H2 | **Hero, goal** (808) | "Get ready for Trees & Traversals": the topic the path leads to. | The target concept: name, its chapter, and the room or date it is for. |
| H3 | **Hero, summary** (809, 1427) | "5 concepts lead here. You've mastered 2. Recursion is next." The count of mastered concepts rises live when a concept is completed (1415, 1427). | The prerequisite count, the mastered count, and the next concept's id and name. |
| H4 | **Hero, path ring** (812-815, 1426-1427) | A ring with the share of path steps done, "40% of path", which animates as steps complete. | Path steps done and total (see H11). |
| H5 | **Hero, "Skip what I know"** (816) | A button with **no handler in v4**, so its intent is open. Read it as a short placement check: two to four questions per prerequisite, which marks concepts already known as done. | A placement set per prerequisite and a route that marks it. The roadmap's research (ALEKS-style placement, "not sure yet, try two questions") points the same way. |
| H6 | **Prerequisite map** (820-831, 1414-1423) | Six concepts in columns from left to right: Programming basics, then Functions, then Recursion and Arrays & linked lists side by side, then Stacks & queues, then Trees & Traversals. Links are solid green when met and dashed when not. A dashed bracket joins the two parallel concepts into the next one. The map scrolls sideways below 520 px. | A graph per target: nodes `{ id, name, column, row, status }` and edges `{ from, to, met }`, plus whether a link is a fork or a join. The model proposes only direct links and the professor confirms them (roadmap, "Prerequisites"). |
| H7 | **Map node** (824-829, 1416-1422) | A button (`aria-pressed`) with the name and a status mark: "Mastered" (filled, with a tick), "In progress" (accent ring), "Not started" (grey ring) or "Main topic" (dark node, with a star). The selected node has an accent border and a soft halo, and lifts on hover. Pressing a node opens it in the concept panel on Introduction. A node turns Mastered live once its Visual is finished and all its Practice is right (1415). | Per concept, this student's status from their own evidence, and the rule that moves it. The roadmap suggests "ready", "needs review" and "not sure yet" as the student's words; the choice of words is a Phase 6 decision. |
| H8 | **Concept panel, heading and language switch** (836-839, 1428) | The concept's name. A segmented switch, English, हिन्दी, मराठी (`role="group"`, `aria-label="Language"`). | The languages available for this concept, each with its review state. |
| H9 | **Concept panel, four tabs** (841-843, 1429) | Introduction, Explanation, Visual and Practice (`role="tablist"`, underline on the current tab). The content animates in. | None beyond each tab's content. Add arrow-key movement between tabs, which v4 lacks. |
| H9a | **Introduction tab** (844-852, 1431-1432) | One lead paragraph in the chosen language. Under it, either "Translation reviewed by Prof. A. Kulkarni." or "This translation is waiting for teacher review, so English is shown." (English is then shown in its place). Three fact cards: "Why it matters", "Where it is used", "Connects to". A concept without facts shows "Status" and "Next step: Open Recursion to continue your path." | The intro text per language, each with `review { state, by, at }`, a source reference (slide or line) and an approval state, marked "AI draft" until the professor approves it (decision 1; `sourceRef`, `approvedBy`/`approvedAt`). The facts as `{ label, text, sourceRef }`. |
| H9b | **Explanation tab** (853-866) | Four numbered steps, each a bold term followed by a sentence ("Base case. The smallest input you can answer directly…"), with the number chips in the level ramp. A dark code block with a worked example (a `fact(n)` function with comments). A "Common mistakes" box with three lines. | `steps [{ term, text }]`, `example { body, language, caption }`, `mistakes [text]`, each with a source reference and an approval state. |
| H9c | **Visual tab** (867-884, 1018, 1434-1436) | A step-through "Call stack · fact(3)": frames push and pop in a container drawn in perspective, with the top frame in the accent colour. Six progress dots and a caption per step ("fact(2) needs fact(1), so it waits too."). The buttons are "Back", "Next" and, at the end, "Replay". There are seven states. | A structured visual: `steps [{ frames [{ label, note }], caption }]`. This is the same step format as P1, so build them together, as code-rendered figures (decision 4). |
| H9d | **Practice tab** (885-897, 1019, 1437-1438) | Three questions, each with its level chip and four options. A tap answers at once. Feedback reads "Correct." or "Not quite.", followed by the reason ("It answers directly without calling fact again."). After a wrong answer the right option is outlined green and the chosen one amber. The question can be answered again. All right, together with the Visual finished, completes the concept. | Practice items (from the approved bank, or written for the Hub through the same gate) with a level, options and a `why`. Marking stays on the server: post an answer, get back `{ correct, keyIdx, why }`. No key is sent before the answer. |
| H10 | **"Your path back to Trees"** (899-908, 1425, 1439) | A vertical list of five steps: "Review recursion basics", "Trace the call stack", "Practise 3 questions", "Short knowledge check" and "Back to Trees & Traversals". A done step has a filled tick and a green line, the current step an accent ring and bold text, and later steps are grey. Two steps finish from the tabs: the call-stack visual and the practice set. | `steps [{ id, label, kind, done }]` and which one is current. Each step's kind ties it to a tab, a check or a room. |
| H11 | **"Why this path"** (909-913) | "On Tuesday you answered 1 of 4 recursion questions at Apply. Functions was 5 of 5, so you can skip it." with a mono source line, "Source: digital assessment · 11 Nov". | A sentence built from this student's own counts (topic, level, right of asked, date), with its source: the kind of evidence and its date. Use the server's sentence, as the rest of the client does. |
| H12 | **"Your Bloom levels · tick = last month"** (914-923, 1440) | Six rows: the level name, a bar that grows in, a tick where the level stood a month ago, and the change ("+8" in green when up, muted otherwise). | Per level, right of asked now and a month ago. `/me` already draws the tick, but its tick marks "before your latest session" and it shows no signed change (`account/insightParts.jsx` 175-200). |
| H13 | **Motion** (805, 834, 899, 919) | The hero's glow drifts, panels rise as they scroll in, bars grow and stack frames pop, all switched off under reduced motion. | None. In Forest these become the existing GSAP entrances (`lib/motion.js`). |

### What already exists to reuse

- The `Panel` brief, `Ladder`, `Level`, `Spark` and `Segmented` components (`ui/index.jsx`).
- `/me`'s "Your path" (sessions on a line), "Your Bloom levels" with its tick, and the
  topic-by-level grid (`account/Me.jsx` 219-336, 474-484). The Hub can sit beside `/me` or
  absorb it.
- The phone's answer kinds and stimulus renderer, for Practice (`learn/Answer.jsx`,
  `learn/Stimulus.jsx`).
- Noto Sans Devanagari is already loaded (`main.jsx` 10-12; `styles/tokens.css` 98), so Hindi
  and Marathi render in both themes.

### Rules the Hub build must keep

- **Decision 7:** a signed-in student account. Rooms stay account-free.
- **Decision 1:** generated text comes only from the professor's material. It cites its slide
  or line, shows "AI draft" until approved, and never adds syllabus that was not taught.
- **Comparisons:** the student is compared only with their own past (H12 does this). No class
  rank, streak, points or badge.
- **Votes:** class-question votes stay out of the student's history (`docs/PRODUCT_DECISIONS.md`
  877).
- **Language:** a translation shows only once reviewed, and English shows otherwise (H9a). Put
  a `lang` attribute on the translated text; v4 has none. The question-language column noted in
  `PRODUCT_DECISIONS.md` 979 and 1003 is a prerequisite for the language switch.
- **Practice keys:** marked on the server, so no key reaches the browser before an answer.

## Built differently or elsewhere (checked, not gaps)

- **Picking questions for a room:** ticking questions in the bank and "Select all shown"
  (v4 261, 273) became the Room step's set picker, with search, a topic filter and "Tick all"
  per level (`teach/Room.jsx` 110-229).
- **The rest of the bank:** the empty state, the per-level generation run, coverage with level
  filters, search and topic chips, "No questions match", rewrite / harder / easier, the
  "approve before use" gate, and "% correct" with the "for this class" band are all present
  and go further (`teach/Bank.jsx`, `teach/Planner.jsx`).
- **Room rules:** "How students answer", "Adapt by Bloom level", "Start everyone at", the cap,
  the timer, the question set, the closed state, "No joining needed" for Teacher-led, and Start
  disabled until it may start. All are present (`Room.jsx`, `Lobby.jsx`).
- **Live:** the heatmap with "level served now", sticky band rows and a scroll inside the
  card; the radar against the class; the last answers as ticks and crosses; "Next set" (now
  "Planned next", labelled "A plan, not a promise", `teach/StudentCard.jsx` 371); the three
  insight cards with evidence and actions; and the KPI tiles with change since the start. All
  are present (`Live.jsx`, `teach/Insights.jsx`).
- **The wheel:** present only, no repeats, the round's progress, "who is on the wheel" as a
  list (the zip's List view), "What was asked" (bank / diagram / demo) and "How they
  responded" from the server's lists, and the pick log by round (`Wheel.jsx`).
- **Roster and activities:** the four observation marks with counts, raised hands with plus and
  minus, reveal and hide, and the five activities. All are present, with keyboard marking 1 to
  4 that v4 lacks (`Observe.jsx`, `teach/Tally.jsx`, `Activities.jsx`).
- **Projector:** Question, Diagram and Progress modes, the pick shown with the question, "Scores
  … are never shown here", and Esc. All are present, as the Projector space and the `/wall`
  page (`ProjectorControl.jsx`, `teach/Wall.jsx`, `Projector.jsx`).
- **Analytics:** the Last 4 / Last 8 range, the trend, the participation figures, the
  10-point distribution with three bands, and the hardest questions. All are on the class
  page's "Across rooms" view (`account/Classes.jsx` 985-1370).
- **Accessibility details in v4:** switches with `role="switch"`, pressed states, chart
  `aria-label`s, cell tooltips and reduced motion. All have equivalents (`ui/index.jsx`,
  `lib/motion.js`).

## Seen and judged not worth building

- **Material:** the four KPI cards (v4 98-119, 1250-1254) and the donut of planned questions
  (v4 120-136). The yield panel and `LevelSpread` say the same once.
- **Live:** the gauge ring for class accuracy (v4 461-471). The "Class accuracy" tile carries
  the figure.
- **Roster:** the roster as 40 tiles (v4 741-749). The row list with keys 1 to 4 is faster
  down a class of forty.
- **The wheel's "Quick pick" mode:** see W2.
- **Rail:** the "New" badge on "Spin wheel" (v4 1270) is a launch label, not a count. The rail
  foot showing one class and division (v4 51, "TY-CSF · Div B") assumes one class per
  professor. The brand tagline "Learn · Engage · Grow" (v4 39) adds nothing.

## Left out on purpose

| What v4 has | Why it is left out |
|---|---|
| The warm palette (terracotta, saffron, espresso, cream), Bricolage Grotesque, Instrument Sans and IBM Plex Mono from Google Fonts (v4 12-31, 998) | The owner replaced it with the Forest design: Manrope and JetBrains Mono, self-hosted, with no Google Fonts request (memory `bloomloop-design-system.md`; `docs/UI_REBUILD.md`). This audit compares features, not the skin. |
| Hover tilt on cards and the hero (v4 443, 476, 1119, 1278), drifting radial glows (v4 309, 444-445, 805), the 3D wheel cabinet with blinking bulbs, pegs and a flapping pointer (v4 615-645), the glowing spin button (v4 1365), scroll-linked rises (v4 476 and on) | Forest restraint. The owner reads loud motion and decoration as clutter (memory `ui-craft-bar.md`). Motion in Forest is GSAP entrances and counts, the level tower and the Rapier marbles. |
| Confetti on every wheel pick (v4 646, 1378-1381) | The same restraint. It also celebrates being picked, which edges towards the rewards family the owner forbids. |
| The Bloom's pyramid colours: a rainbow from red through blue (hue 250) to purple (hue 295) (v4 1347), and the glossy 3D bars | No purple, anywhere. The measure is kept as gap L3. |
| Pictographic glyphs used as icons: a raised hand, a heart, a sparkle for AI, stars, arrows, up and down triangles (v4 251, 275, 1292-1293, 1416) | No emoji. Forest uses lucide icons, and a level colour always sits beside its name. |
| "Lowest first" sorting (v4 1342, 1454); bands sorted by mean, lowest first (v4 1341); "Show them" sorting the class lowest first (v4 1292) | No sorting of students by score. The heatmap groups by working level in roll order; Insights uses the server's three orders, with no positions. |
| Hands raised and "Answered aloud" as projector bars (v4 1411, "Today, as a class") | No staff data on the projector. The tally says "The hands are counted here only. They never go on the projector." (`Tally.jsx` 194). |
| A fixed class of 40 ("/ 40 present", "out of 40", v4 378, 417, 729, 1302), invented history (dates, accuracy, participation and attendance series, v4 1306-1308), an invented previous session (v4 1315), random joins and live drift (v4 1075-1088, 1121), a seeded outbox and a "Simulate going offline" button (v4 1058, 1274) | No number that is not from the API. Every figure in the build is the server's, with what it rests on. |
| "A student moves up after 3 correct at 60% or more" (v4 326), and 60% as the mastery line (v4 1024, 1285, 1347) | Decision 2: moving up is 70% over the last five answers at a level, with at least three; stepping back is below 40%; mastery is the room's goal, 80% by default. The room screen says so (`Room.jsx` 698, 729-731). |
| Analytics "evidence from digital answers and teacher records" in one figure (v4 378) | Teacher records are counted apart and never added to accuracy (Phase 3; `teach/Records.jsx` 16-17). |
| The draw made in the browser with `crypto.getRandomValues` (v4 1028, 1110) | The server draws and stores the pick before it answers. The ring only shows it (`Wheel.jsx` 1-12). |
| The projector as an overlay inside the console window (v4 931-991) | The wall is its own page, opened from a link token. It holds no credentials and receives no staff data (Phase 3, `Wall.jsx`). |
| Model calls from the browser (`window.claude.complete`, v4 1052-1197) | Model calls go through the server, which holds the key, and drafts pass the approval gate. L1 and C2 are specified that way. |
| Coloured initial avatars in seven hues, one of them blue (v4 999) | Skin. Forest uses its own `Avatar`. |

## The older design files (v3, Classroom v2, Classroom, Dashboard)

From a second read of the four older files, for what is in them but in neither v4 nor the client. v3 and Classroom v2 are drafts of v4, so most of these come from the Dashboard file.

### The older design files: what they have that v4 and the client do not

Read in full: `BloomLoop Dashboard.dc.html` (454 lines), `BloomLoop Classroom.dc.html` (696), `BloomLoop Classroom v2.dc.html` (826) and `BloomLoop v3.dc.html` (865). `support.js` is the design runtime (`sc-for`, `sc-if`, `style-hover`) and adds no feature of its own. Each candidate was searched for in `BloomLoop v4.dc.html`; anything found there is left to the v4 audit. What remained was searched for in `client/src` and checked against `docs/UI_REBUILD.md`. Line numbers are the older file's unless a path is given.

v3 and Classroom v2 are drafts of v4. Almost everything they show reappears in v4: the wheel's modes, think time, names and list-view switches, the sync panel and outbox, the insight cards, the Bloom pyramid, roster observations, activities, the projector overlay and the Learning Hub. Those are not repeated here. Most of the gaps below come from the Dashboard, the oldest of the four.

Counts (gaps 1 to 11): S 7, M 4, L 0. The hub has 5 details found only in the older files (S 4, M 1); the hub as a whole is L.

### BloomLoop Dashboard.dc.html

#### Live session screen

| # | Gap | The older file | What we have | Server work | Size |
|---|---|---|---|---|---|
| 1 | Session clock | A ring with "Elapsed / 40 min" and mm:ss beside the room code, filling as the class runs (72-76, 427) | Not found. The Live head (`teach/Live.jsx` 1084-1097) shows the state, the code and the title. "Elapsed" appears only in `Bank.jsx`, for writing time | For elapsed time, none if `session.startedAt` (sent at `server/src/routes/session.js` 532) counts as the start. It is set when the room is created, so a waiting room's lobby time would be included. The planned length ("/ 40 min") is not stored: it needs a new optional room setting, or can be left out | S (M with a planned length) |
| 2 | Accuracy by level over time | "Accuracy by level, last 60 seconds": six lines, a dashed "mastery threshold 60" line, and each level's latest figure in the legend (151-173). Classroom v2 has the same idea as a sparkline per level in "Mastery by level · % ≥ 60 · last 60s" (v2 166-176, 706) | Whole class only. The Live tiles sample from the moment the page opens (`Live.jsx` 1266-1297), and Insights draws accuracy, the support band and participation each minute (`Insights.jsx` 144-161). Nothing per level | Either sample each level on the page, as the tiles do, or add per-level points to the insights timeline (`GET /api/session/:code/insights`). The threshold line must be the room's goal from the API, not a fixed 60 | M |
| 3 | Median working level | The centre of the "Mastery by level" rings gives the class's median level, captioned "median level" (134-137, 395) | Not found: no "median" in `client/src`. "Where the class is" shows the spread as marbles | None: worked out from the roster's levels | S |
| 4 | Dots view of the heatmap | A "Heat cells / Dots" setting (`gridStyle`). In Dots, each cell is a dot whose size and opacity carry the accuracy, so the grid can be read without comparing shades (203-208, 324, 389) | Heat cells only (`Live.jsx` 1378-1500) | None | S |
| 5 | Trend for each student | A "Trend" column with a sparkline of the student's recent accuracy on every heatmap row (192, 212, 401-407). It draws rising in green and falling in red | Only the selected student's attempts, in the inspector, counted from page open (`Live.jsx` 1582; `feed.tries` 918-942). No trend on the rows | None for a trend counted from page open, since `feed.tries` already holds it. A trend that survives a reload needs a per-student window on the roster read. Draw it in a neutral ink, because green and red are kept for right and wrong | M |
| 6 | Support band against the last test | "Below-40% group vs. baseline": this room's line against a dashed "Last test" line, with "+N pts over baseline" (258-280, 443-445) | Compared only with the start of this room: the support figure in Insights says "Start … at" (`Insights.jsx` 151-156) | The same students' accuracy in the class's previous room, as a new field on the insights read (for example `support.previousRoom`). The class reports already read across rooms | M |
| 7 | Review state of the bank by level | "Question bank · 37 of 42 reviewed": one bar per level, approved in solid and waiting in hatching, with a key (282-303) | `teach/Bank.jsx` 548-563 shows one view's counts by level at a time (Drafts or Approved). "N drafts waiting for your review" is a total (578-583). Nothing on the Live screen | None: the bank read carries both | S |
| 8 | Reassurance about joining | "Phone browsers, no installs" under the joined count (89) | Not found: no "install" in the staff screens | None | S |

#### Left out on purpose (Dashboard and Classroom v2)

- **Sorting the heatmap by "Level", "At risk" or "Name"** (184-186, 398, 434). "Level" and "At risk" order students by score, and "At risk" is forbidden wording. Classroom v2's "Needs support" sort (v2 697, 805) is the same idea. v4's version of it belongs to the other audit.
- **A red dot before every student under 40%** (198, 405; the code calls it `riskColor`). It marks individual students as at risk by their score. The built heatmap groups rows by the server's support band instead (`Live.jsx` 1398-1404).
- **The "Adaptive engine" spinner, "Recalibrating sets" or "Idle"** (307-308, 419-421, 447). The API sends no such state. The event list beside it is already built, as the "Latest" ticker (`Live.jsx` 1299-1315).
- **Fixed figures:** "/ 60" students (88), "/ 40 min" (74), "% of class ≥ 60%" (124) and "mastery threshold 60" (168). None of them comes from the API. Under decision 2, a student moves up at 70% over their last five answers, and the goal is the room's own setting (80% by default).

### BloomLoop Classroom.dc.html (the oldest)

#### Spin the wheel

| # | Gap | The older file | What we have | Server work | Size |
|---|---|---|---|---|---|
| 9 | "Verbal question" as an ask type | Four ask types: "Bank question", "Verbal question", "Explain a diagram" and "Demonstrate" (477, 138-142) | Three, from the server: Bank, Diagram and Demo (`teach/Wheel.jsx` PickCard; `server/src/services/wheel.js` 31-35). A question the teacher makes up on the spot fits none of them. The tally counts raised hands, not one student's answer | Add `{ id: 'verbal', label: 'Verbal question', hint }` to `ASK_TYPES`. Change the `wheel_picks_ask_check` constraint (`supabase/migrations/0017_teacher_records.sql` 275) with a new migration. Check whatever reads `ask` (`services/attainment.js` 1337, exports) | S |

#### Classroom mode

| # | Gap | The older file | What we have | Server work | Size |
|---|---|---|---|---|---|
| 10 | An offline banner that says what is already on the device | "Working offline": "Lesson, roster and question bank were downloaded this morning. Everything you record is kept on this device and synced when you reconnect. Nothing is discarded." Beside it, "N unsynced · last sync 09:12", then "Syncing" and "All records synced" (180-184, 613-615) | Not found. Only the phone works offline (`client/sw/joinWorker.js`, scope `/join`; UI_REBUILD "Phase 7, stage First"). v4's sync pill and outbox (the other audit) cover queued records, but not a statement of what was downloaded beforehand | None for the banner itself. It depends on staff screens caching the lesson, roster and bank, and on the teacher's records outbox (a v4 item) | M (on top of an L) |

### BloomLoop Classroom v2.dc.html

| # | Gap | The older file | What we have | Server work | Size |
|---|---|---|---|---|---|
| 11 | The projector opens on the knowledge-check question | Pressing "Project to class" from the Activities tab opens on the Question view, showing the tally's question (802). v3 and v4 dropped this | `teach/Tally.jsx` 10 and 194: the question goes up from the Projector space only | None: `ProjectorControl` can already put a tally question up | S |

Everything else in v2 is in v4, apart from the per-level sparklines, which are folded into gap 2.

### BloomLoop v3.dc.html

Nothing turned up that is in neither v4 nor the client. About sixty distinctive strings and behaviours from v3 were each found in v4: for example "drawn securely", "Start new round", "Skip to spin", "Students still in this round", "Saved on this device · will sync", "even if the app closes", "Benches of four", "Exit · Esc", "Translation reviewed", the status toast and `prefers-reduced-motion`. Its glyphs (♥, ✋, ◎, ★), confetti and hover tilt are in v4 too, so checking them against the owner's rules is for the other audit.

### Student hub and learning path (Phase 6)

The Learning Hub appears in Classroom (343-467), Classroom v2 (365-480) and v3 (391-516), and again in v4. None of it is built: there is no "Learning Hub", "prerequisite" or "concept" in `client/src`. This section first lists the details only the older files have, then describes the whole hub as they draw it, with the data each part needs from the Phase 6 server. Everything in the second list is also in v4, and is given here only so the server work can be planned from one place.

#### Details only in the older files

| # | Detail | The older file | Data or work | Size |
|---|---|---|---|---|
| H1 | The skip button says what it starts | "Already know some? Take a 5-question check" (Classroom 351); "Skip what I know · 5-question check" (v2 370). v4 says only "Skip what I know". No version gives the button an action | A five-question check across the prerequisites, and a rule for which prerequisites a result marks as done | S for the wording, M for the check |
| H2 | A text counter on the call-stack stepper | "Step N of 6" (Classroom 411). v2, v3 and v4 replaced it with step dots marked `aria-hidden`, so a screen reader hears no position | None | S |
| H3 | The level bars say who they are compared with | "Your Bloom levels … Compared with your own earlier attempts only." (Classroom 453-462). v2 has "vs. your own last month" (468); v4 has "tick = last month". The older line states plainly that no classmate is in the comparison | None | S |
| H4 | Prerequisites stored as data | An edge list, `HUBE` (Classroom 490): basics → functions → recursion → stacks, and lists → stacks → trees. v2, v3 and v4 fix the map's columns and rows in the layout (`col`, `row`, `links`) | A prerequisite graph per chapter, so the map can be drawn from each professor's own chapter (see "Prerequisite map" below) | M |
| H5 | The evidence names the change it made | "…Functions was 5 of 5, so it is marked done and you can skip it." (Classroom 449). Later versions shorten it to "so you can skip it" | The status change a piece of evidence caused, kept with that evidence | S |

#### The whole hub as the older files draw it (also in v4)

| Part | What it shows | Data it needs |
|---|---|---|
| Entry | "Learn · student view" in the teacher's rail and "Riya Sharma · student view" as the crumb (Classroom 40; v3 698) | A read rule that lets a professor open one student's hub without changing anything |
| Header | "Get ready for Trees & Traversals", "5 concepts lead here. You've mastered 2. Recursion is next.", and a "% of path" ring (v3 393-406, 818) | The target topic (the chapter the student is working back towards), the number of prerequisite concepts, how many are mastered, the next concept, and the path steps done |
| Prerequisite map | Six concepts, each Mastered, In progress, Not started or Main topic. Links are solid once done and dashed after that. Pressing a concept opens it (v3 409-420, 808-814) | A concept graph per chapter drawn from the professor's own material, citing its source and marked by approval (decision 1). Each student's status per concept, from their answers by topic and from their hub practice |
| Concept: language | English, हिन्दी and मराठी, with "Translation reviewed by Prof. A. Kulkarni." or "This translation is waiting for teacher review, so English is shown." (v3 426-436, 819-822) | Translations of each lesson with a review state and the reviewer's name, falling back to English. The language of each question recorded (the translation note in `docs/PRODUCT_DECISIONS.md`) |
| Concept: Introduction | A paragraph and three cards: "Why it matters", "Where it is used" and "Connects to". When there is nothing to show, the cards read "Status" and "Next step" (v3 433-441, 598-601, 823) | Lesson text per concept with `sourceRef` and an approval state (decision 1) |
| Concept: Explanation | Four numbered steps, a code sample and "Common mistakes" (v3 442-455, 602-604) | The same as the Introduction, with code stored as text |
| Concept: Visual | A call stack that fills and empties one step at a time, with a caption, Back, and Next or Replay (v3 456-473, 605) | A list of frames and captions per visual. Drawn by code, so allowed under decision 4 |
| Concept: Practice | Three questions, each tagged with its level. An answer shows "Correct." or "Not quite." and the reason. The right option turns green and a wrong choice amber (v3 474-486, 606, 828-829) | Practice items per concept with the level, the key and the explanation. Attempts stored against the student. Whether they count towards a room's attainment is not decided |
| Path | "Your path back to Trees": five steps, each done, current or still to do (v3 489-497, 816) | An ordered plan per student, and what completes each step |
| Why this path | "On Tuesday you answered 1 of 4 recursion questions at Apply. Functions was 5 of 5, so you can skip it." and "Source: digital assessment · 11 Nov" (v3 498-502) | The evidence behind each step: the room, the date, the level, right answers out of those seen, and the kind of source |
| Your Bloom levels | Six bars, each with a tick at last month's value and the change (v3 503-511, 831) | The student's own accuracy per level over two periods. No class figure |
| Mastery on completion | Finishing the visual and getting every practice question right turns Recursion to Mastered and moves the path on (v3 806-808) | A server rule for when a concept counts as mastered |

The hub needs a lasting student identity. Under decision 7 (`docs/PRODUCT_DECISIONS.md` §7), rooms stay account-free and the hub requires an account. Size L overall.

### Not determined

- Whether `session.startedAt` records the moment a waiting room was started. Its default is the creation time (`server/src/models/index.js` 103 and 420), and gap 1 depends on it.
- The PDFs and screenshots in `uploads` were not read, because no screen file refers to them. The files were read as markup and not rendered, as asked, so the motion was judged from the CSS and the code.

## What could not be determined, and where I looked

- **Hub routes.** No Phase 6 route for the Hub was found in `server/src`: a search for hub,
  prerequisite and concept finds only unrelated files. So the field names in the Hub section
  are proposals, not the server's.
- **M3.** Whether the server can already be asked for the template writer. Nothing in
  `lib/api.js` sends such a flag, and the generate route was not read in full.
- **R3.** Whether the phone's join field would accept or ignore a separator in the code. Check
  this before grouping the code.
- **"Skip what I know".** Its intent (H5): the button has no handler in v4, so H5 is a reading,
  not the design.
- **Behaviour.** v4's behaviour is inferred from its template and state class. It was not run,
  as instructed. The client was read and searched, not run, so screen states that need live
  data were judged from code.
- **Out of scope.** The older design files (v3, Classroom v2, Classroom, Dashboard) were not
  read; another agent covers them. `support.js` is the template runtime only and adds no
  features.
