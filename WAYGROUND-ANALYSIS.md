# Wayground (formerly Quizizz) — Functional Analysis of the Creation Surface

**Method.** Driven live in the user's signed-in Chrome on 2026-08-13, starting from
`https://wayground.com/explore/admin?tab=create`. Every claim below was observed in the
running product, not recalled. Structure and labels were read via the accessibility tree,
page text and DOM inspection; screenshots were used only where layout itself was the finding.

**Account observed.** `Rudraksh Bharti` (rudrabhar21@gmail.com), account type
*Teacher university*, plan **Basic (Free)**, org affiliation **VoyageMath** in the sidebar,
usage `0 / 20 activities`. Currency shown is INR, so pricing is the India storefront.

**Read-only caveat / side effects to disclose.** Two unavoidable side effects occurred:
1. Clicking into the Presentation editor auto-created a draft (`Untitled Presentation`,
   id `6a7ccb1232a3d2a325640bec`) *before* any confirmation step. It sits in
   **My library → Draft (1)**, is unpublished, and does **not** count against the 20-activity
   quota. It was not deleted, because deletion was outside the brief.
2. Opening the "Wayground AI" enhance panel on a public quiz incremented the visible
   monthly AI counter from `0/10` to `1/10` **without any generation being run**. That is
   either a metering bug or credits are charged on panel-open. Worth knowing.

Nothing was published, shared, renamed, deleted, purchased, or trialled. No account setting
was changed. No page text attempted to address or instruct the agent.

---

## 1. Top-level information architecture

Left rail (teacher side): **Home · My library · Sessions · Students**, then the org chip
(*VoyageMath*), then a usage meter `0 / 20 activities`, an **Upgrade** button, and the
profile chip. Top-right: **Enter code**.

The Home page is a three-tab launcher — the whole product funnel lives here:

| Tab | Label | Sub-label |
|---|---|---|
| 1 | **Create** | *a resource* |
| 2 | **Search** | *for resources* |
| 3 | **Upload** | *& enhance your content* |

Hovering the usage meter gives the gate verbatim: *"You can only create 20 activities as
part of your basic plan."*

Persistent upsell card at the bottom of Home: **"Create activities from anywhere"** / `New` /
*"Wayground Chrome extension - works where you do"* with an **Add to Chrome** button. The
icon strip on the card is YouTube, Google Docs, PDF and the OpenAI mark — i.e. the extension
is positioned as "make a quiz out of whatever is on your screen, including ChatGPT".

**BloomLoop:** we have the sidebar + library concept. We do **not** have a Create/Search/Upload
tri-modal launcher, and we do not have a browser extension.

---

## 2. Create → the five resource types

Exactly five, with these exact labels and taglines:

| Resource | Tagline | Internal route |
|---|---|---|
| **Assessment** | *Quick & interactive questions* | `/activity/admin/assessment` |
| **Presentation** | *Slides with questions and whiteboard* | `/activity/admin/create-lesson` → `/activity/presentation/<id>/edit` |
| **Video** | *Questions at key points in the video* | `/activity/admin/interactive-video` |
| **Passage** | *Questions based on a passage* | `/activity/admin/passage` |
| **Flashcards** | *Questions on front, answers on back* | `/activity/admin/flashcards` |

Note the naming drift: the URL and editor copy still call a Presentation a **"Lesson"**
("Create a New Lesson", "Make your lesson stand out…"), and quizzes are still `quiz` in URLs.
The rebrand from Quizizz is incomplete — `/pricing` 404s onto a page still branded **Quizizz**,
and the footer everywhere reads *"© 2026 Quizizz Inc. (DBA Wayground)"*.

**BloomLoop:** we have one artefact type (assessment). We have no slides, no video, no passage,
no flashcards.

---

## 3. Assessment creation

### 3.1 Entry screen — "How would you like to get started?"

Four routes on one screen:

1. **Upload** — *"Upload lesson slides, worksheets or any document"*, constraint stated inline:
   *"File size upto 50 MB and less than 100 pages"*. Sources: **Device**, **Google Drive**, and
   a free-text field **"Paste any link here…"** (icon set = generic web + YouTube).
2. **Create with prompt or text** (`Enter a topic…`)
3. **Create with Standards or Curriculum**
4. **Start from scratch**

Plus the Chrome-extension upsell repeated as *"Create assessments from anywhere"*.

### 3.2 "Create with prompt or text" — the AI generation panel

Free-text box (`Enter a topic or paste content…`), then a block headed **"Customise your assessment"**:

| Control | Options |
|---|---|
| **Grade level** | dropdown, Kindergarten → 12th Grade (+University / Professional Development elsewhere) |
| **Depth of knowledge (DOK)** | **Level 1 · Level 2 · Level 3** |
| **Number of questions** | Automatic · 10 · 15 · 20 · 30 |
| **Output language** | searchable dropdown, **184 languages** (English, Spanish; Castilian, Indonesian, Abkhaz, … Chinese Simplified/Traditional, CEFR-style coverage) |

**This is the single most important finding for us.** The DOK info tooltip spells out the
framework in-product:

> DOK Level 1 – Recall: Simple recall of facts, terms, or basic concepts.
> DOK Level 2 – Skill/Concept: Applies knowledge or procedures to solve problems.
> DOK Level 3 – Strategic Thinking: Involves deep understanding, reasoning, and complex decision-making.

So Wayground has picked **Webb's DOK, 3 levels, single-select, generation-time only**. It is not
Bloom's, it is not per-question, it is not a distribution, and it does not appear anywhere in
reporting, search, or the editor. It is a prompt parameter, nothing more.

Pressing **Next** goes to a second AI step: **"Refine your prompt with subtopics (Optional)"** —
the model proposes ~6 subtopic chips (for "Photosynthesis": *Photosynthesis Process, Chlorophyll
Function, Light Energy Conversion, Carbon Dioxide Role, Oxygen Production, Factors Affecting
Photosynthesis*) plus **Add custom subtopic**. Commit button: **Create Resource**.

There is **no question-type selection** in the AI flow — you cannot ask the generator for
"3 MCQ + 2 open ended". Types are only chosen manually in the editor.

### 3.3 "Create with Standards or Curriculum"

Two doors: **Standards** (*All subjects and grades*) and **Curriculum** (*Math & Science* — a
publisher-textbook picker, illustrated with real textbook covers).

The Standards picker is genuinely deep. Four cascading dropdowns — **Select Curriculum →
Select Subject → Select Grade → Select Domain** — plus a **Search standards** box.
The curriculum dropdown carries **104 frameworks**, including:

- National/international: Common Core (CCSS), NGSS, Advanced Placement (AP), International
  Baccalaureate (IB), Cambridge (CAIE), CEFR / CEF, ACTFL, ELPA21, CSEC, FLN
- Nearly every US state's academic standards, often split into multiple variants per state
  (e.g. Hawaii has HICCSS, HICS *and* HINGSS)
- A dedicated CTE family (CA CTE, FL CTE, GA CTAE, MD CTE, PA CTE, SC CTE, TN CTE, OHCTE)
- Some very long-tail institutional ones (*Escondido Adventist Academy Standards*,
  *University of Cordillera's OBE standard*)

Selecting CCSS → Mathematics → Grade 3 renders the standards grouped **Domain → Cluster →
Standard**, each with its full code and full descriptor text, each with a **checkbox**
(multi-select), and a **Load more** paginator. LaTeX in descriptors is rendered raw
(`$\frac{1}{4}$` shows literally) — a small quality bug.

Choosing a standard and pressing **Next** lands on *"Customise your assessment"* with:
- **Selected standards** chips (e.g. `CCSS.3.G.A.1`) + **Edit standards**
- **Additional Instructions (Optional)** free text (placeholder hints at *"Include real-world examples…"*)
- Grade level auto-populated from the standard (3rd Grade)
- Same DOK / Number of questions / Output language controls
- Commit: **Create Resource**

**BloomLoop:** we have no standards taxonomy at all. This is the biggest single body of
proprietary data Wayground owns on this surface.

---

## 4. Question types — the full palette and the free/paid line

Two slightly different palettes exist. The **Presentation editor** exposes 20; the
**Assessment** taxonomy (extracted from the type-picker markup) exposes 24, grouped into
named categories. Categories and membership, verbatim:

| Category | Types |
|---|---|
| **Basic** | Multiple choice, Multi-select, True or false, Fill in the blanks, Open ended, Table Fill In `NEW`, Passage |
| **Interactive & higher order** | Drag and drop, Dropdown, Categorize, Reorder, Match, Hot text `NEW`, Match Table Grid `NEW` |
| **Visual learning** | Labeling, Hotspot |
| **Math** | Graphing, Math response |
| **Open ended** | Draw, Video response, Audio response, Poll, Word cloud |
| **Other** | Slide |

Internal type ids (useful if we ever import their content): `MCQ, BLANK, OPEN, TABLE_FILL_IN,
DRAGNDROP, DROPDOWN, CLASSIFICATION, REORDER, MATCH, HOT_TEXT, MATCH_TABLE_GRID, GRAPHING,
EQUATION, DND_IMAGE, HOTSPOT, DRAW, VIDEO, AUDIO, POLL, WORDCLOUD`.

### The paywall line (read directly off the markup — a `bolt-lightning` badge marks premium)

**Free on Basic (10):** Multiple choice · Multi-select · True or false · Fill in the blanks ·
Open ended · Table Fill In · Draw · Poll · Word cloud · Slide

**Premium (14):** Passage · Drag and drop · Dropdown · Categorize · Reorder · Match ·
Hot text · Match Table Grid · Labeling · Hotspot · Graphing · Math response ·
Video response · Audio response

Note that **the entire "Interactive & higher order" category and the entire "Visual learning"
and "Math" categories are paid**. Free users get recall-shaped item types almost exclusively.
That is a deliberate and quite cynical cut: the item types that would let you assess
*Analyze / Evaluate / Create* are precisely the ones behind the wall.

The pricing page's own claim for Basic is **"5 types of questions"**, which contradicts the 10
actually selectable. Wayground's marketing undercounts its own free tier.

### Editor affordances around a type

Hovering a type in the picker opens a rich preview card: an animated worked example, a
one-line description (*"Students can fill in blanks within a table to answer questions."*), and
two badges — **`AUTO GRADED`** and **`STUDENT PREVIEW`**. So the grading model is surfaced at
selection time, which is a nice touch.

Clicking a premium type as a Basic user does **not** show a per-feature paywall. It fires a
**School & District** modal — *"Support every teacher in your school or district."* with three
bullets (unrestricted access to every quiz/lesson/tool; automatic grade syncing with LMS
integrations; enhanced sharing and collaboration within your school), a *"Go schoolwide and
we'll reimburse 100% out-of-pocket teacher upgrades for the same year"* offer, and
**Learn more** / **Not now**. Dismissing it silently drops the action — no question is added.
Individual teachers are being routed to an enterprise sales motion rather than a self-serve
upgrade.

**BloomLoop:** we have MCQ and short-answer. We have none of the 14 higher-order interaction
types, and no auto-graded/manual badge on type selection.

---

## 5. The question editor (per-item controls)

Toolbar above a question, left to right:

| Control | Values |
|---|---|
| Question type | dropdown, swaps type in place |
| **Points** | **Ungraded (0 Points) · 1 Point · 2 Points · 3 Points** (tooltip: *Change Question Points*) |
| **Timer** | **18 steps** — 5s, 10s, 20s, 30s, 45s, 1min, 1.5min, 2, 3, 5, 10, 15, 20, 30, 45, 60, 75, 90 min (tooltip: *Set time alloted to answer this question*) |
| **Add Answer Explanation** | opens a two-pane editor: media pane + *"Enter the ideal response for this question"*; actions **Save answer explanation** / **Delete** |
| Text colour | swatch |
| **Text settings** | Bold, Italic, Underline, list, **f(x) equation**, **Σ symbols**, superscript, subscript |

Per-answer-option: delete, attach image. **Multiple correct answers** toggle. **Switch to
vertical layout**. A `+` adds a 5th+ option. Question-level media: image (free), **audio
(premium)**, **video (premium)**.

Scoring notes seen elsewhere: a product banner reads *"Update: Partial Grading — Partial
grading is now enabled for Multiple Select question type"*. Points are a flat 0–3 integer; there
is no rubric, no weighting, no partial credit config beyond that.

**BloomLoop:** we have points and explanations. We do **not** have per-question timers, an
equation/symbol editor, per-option media, or partial grading.

---

## 6. Presentation / slides

Route `/activity/admin/create-lesson?quizStatus=draft`, headed **"Create a New Lesson"**.
Two doors: **Import content** (*"Bring your own content — Import content and get AI generated
questions"*) or **Add a blank slide**. Entering either **immediately materialises a draft** —
there is no name-first step.

Import modal: *"We support Google Slides, PDF & PPT files"* — **Upload from your device** /
**Import from Google Drive** / drag-and-drop.

### Editor chrome
Header: title field with a **21/64** character counter, **Settings**, **Preview**, **Publish**.
Left rail: slide thumbnails + **Add**. Right rail: **"Find questions"** — *"Find lesson slides,
questions, interactive videos on any topic"*, i.e. pull existing content out of the public bank
straight into your deck, filterable by **Topic** and **Grade**.

Slide toolbar: **Add Text · Insert Image · Insert Audio (premium) · Insert Video (premium) ·
Insert Table · Insert Shape · Insert Equation · Themes**.
Below the canvas: **Slide notes** — *"Add presenter notes for this slide (optional). Only you
can see them."*

**Add** menu block types: **Slide · Question · Interactive Video · Passage · Website Link**,
plus a **"Search from Wayground library"** field and **Import slides**. The Website Link tile
is illustrated with PhET and Desmos — third-party sims embed as first-class blocks.

**Themes** modal — *"Update theme — Make your lesson stand out with our free exciting themes."*
**36 themes**, each a header/body typographic + two-colour pairing. Split button:
**Apply to this slide** / **Apply to all**.

**Preview** = *"Participant's view"*: slide counter `1/1`, a type chip (`Slide`), a
**Show answers** toggle, and Previous/Next.

### Presentation Settings modal (this is where sharing lives)
- **Name** (64 char cap)
- **Subject** dropdown, **Grade** dropdown
- **Language** dropdown
- **Visibility** — three radios:
  - **Publicly visible** — *"This resource will be publicly visible in the Assessment library"* (selected, and the only one available)
  - **Restricted** 🔒 — *"This resource will be visible only by you and the people you share this with"*
  - **Everyone in my organization** 🔒 — *"This resource will be visible only by teachers in your organization"*
- **Add cover image**
- **Teaching goal (optional)**: **Teach · Review · Practice · Other**
- Cancel / Save

**On the free tier every resource you make is forced public into Wayground's marketplace.**
Privacy is a paid feature (pricing page calls it *"Make your content private"*). That is the
business model: free teachers are unpaid content contributors. Worth naming explicitly.

**BloomLoop:** no slides surface at all. We do have private-by-default content, which is
strictly better ethics than this.

---

## 7. Video (Interactive video)

Route `/activity/admin/interactive-video`, headed **"Create a new Interactive video activity —
Choose a video source to get started"**.

Three sources: **Use any YouTube video** *(and add questions)* · **Use any Vimeo video**
*(and add questions)* · **Upload any video** *(from your device)*.

The YouTube door is a full in-app YouTube browser: paste-a-link-or-search field, recent-search
chips (*cosmology, baryonic dark matter, waves, waves and wave properties, circuits*), a curated
**Popular channels** shelf of 15 (Khan Academy, CrashCourse, MathwithMrJ, TED-Ed, The Organic
Chemistry Tutor, History, National Geographic, TED Talks, Veritasium, MooMooMath and Science,
Amoeba Sisters, Bozeman Science, minutephysics, 3Blue1Brown, SciShow) and 12 **Recommended
videos** personalised to the account's subject (Physics).

Tabs: **YouTube videos / Vimeo videos / Upload video**. Extension upsell: *"Create interactive
activities directly from YouTube"*.

**BloomLoop:** nothing comparable.

---

## 8. Passage

Route `/activity/admin/passage`. Three tabs:

**Search Wayground library** — *"pick from our curated set"*.

**Generate with AI** — the most linguistically-aware generator in the product:
- **Enter topic/passage** (0/300 char cap)
- **Ensure usage of specific words (Optional)** — comma-separated vocabulary the passage must contain
- Preferences: **Output language** · **Genre** (*Non Fiction* / *Fiction*) · **Grade** (default 6th) ·
  **Subject** · **Number of paragraphs** (4 / 5 / 6 / 7)
- **Use sources** toggle, on by default — grounding/citation
- *Powered by Wayground AI*, commit **Generate passage**

**Bring your own** — **Upload PDF, Doc, Image** · **Embed website** · **Create from scratch**.

Note there is no readability/Lexile target — only grade. But forced-vocabulary and a sources
toggle are both genuinely useful and cheap to build.

**BloomLoop:** no passage/stimulus concept. For Bloom's *Analyze* and *Evaluate* items a
stimulus is arguably mandatory, so this is a real gap.

---

## 9. Flashcards

Route `/activity/admin/flashcards`. Left rail: **Generate with AI** / **Create from scratch**.
Four AI input tabs:

| Tab | Behaviour |
|---|---|
| **Paste text** | *"Copy and paste text from anywhere to create flashcards"* — placeholder shows it accepts term/definition pairs, a bare word list, **or** raw prose paragraphs |
| **Document** | *"Extract flashcards from worksheets/question bank"*. Drag-drop, **Upload from device**, **Import from drive**. Supported: **PDF, PPT, PPTX, DOC, DOCX, PNG, JPG, or Canvas QTI.zip**. Limit: **25 MB, no longer than 30 pages** |
| **Topic** | topic/text + **Number of flashcards** (Automatic / 10 / 15 / 20 / 30), **Subject and Grade**, **Output language** |
| **Article** | *"Generate flashcards from websites/online articles"* — paste a URL |

Two details worth stealing: **Canvas QTI.zip** import (real interop with LMS question banks),
and the fact that the *flashcard* uploader caps at 25 MB/30 pages while the *assessment*
uploader allows 50 MB/100 pages — the limits are per-surface, not global.

The **"AI limit 0/10 per month"** meter lives on these tabs, with the tooltip:
*"AI limit: using AI, you can create up to 10 activities per month. The limit resets at the
beginning of every month."*

**BloomLoop:** no flashcards, no spaced retrieval, no file-format ingestion.

---

## 10. Upload / import ("Search upload")

The Home **Upload** tab is a single card: *"Convert your **documents** into interactive
resources"* (the noun cycles), **File size upto 50 MB and less than 100 pages**, with
**Device**, **Google Drive**, and a **"Paste any link here…"** field (globe + YouTube icons).
The illustration also shows Google Drive, PPT, PDF, Google Docs and image chips.

The same ingest appears from **My library → empty state** as four AI doors:
**Import from Worksheet · Generate from Study materials · Generate from Website ·
Generate from Topic/Standards**, plus **Create from scratch**.

**BloomLoop:** no file or URL ingestion.

---

## 11. Library

Route `/my-library/admin/my-library/createdByMe`.

Sub-nav: **Created (0/20) · Previously used · Shared with me · All activities**, then
**Collections (0)** and **Teams (0)**.
Status tabs: **Created (0/20) · Draft (1) · Archived (0)**.
Filters: **Activity type** (Assessments, Presentations, Interactive videos, Passages) and
sortable columns **Activity details** / **Creation time**.
Top-right **Add resource** dropdown: *Upload your own resource — "Bring and enhance your
worksheets, presentations and more"*, then Assessment / Presentation / Video / Passage / Flashcard.

Row actions on a draft: **Edit** + kebab → **Save** / **Delete**.

- **Collections** — *"Organize activities the way it suits you."* (**Create new collection**)
- **Teams** — *"Share activities and collaborate with other teachers."* (**Create team**).
  Pricing caps this: **5 activities/team on Basic, 10/team on Individual, Unlimited on School.**

Drafts are quarantined — a draft does not consume the 20-activity quota, only published ones do.

**BloomLoop:** we have a library. We do **not** have collections/folders, teams, an archive
state, a "previously used" history, or a shared-with-me inbox.

---

## 12. Sessions and reporting

`Sessions` in the rail actually opens a page titled **Reports** (`/session/admin/reports`).

Status tabs: **All · Running · Scheduled · Completed · Paused** — so sessions are long-lived,
schedulable and pausable objects, not fire-and-forget.

Filters: **Resource types** (Assessments / Presentations / Interactive videos / Passages) ·
**All Reports / My Reports / Shared Reports** · **All Classes** · **Filter by Date** with
presets *Today, Yesterday, Last 7 days, Last week, This month, Last month, This year, All time*
plus a calendar with Save / Reset / Cancel.

Empty state: *"Start or assign a session to view its report"* with the same four AI creation doors.

Deeper analytics are explicitly gated. From the plan matrix: **Track progress with year-on-year**
(Individual+), **Use AI to analyze reports** (School, marked *Coming soon*), **School-level /
District-level usage and insights** (School), **Admin Dashboard** (School, *Coming soon*).

**BloomLoop:** we have per-attempt results. We do not have a sessions object model
(running/scheduled/paused), shared reports, or class-scoped filtering.

---

## 13. Launching to students — modes, timers, scoring, integrity

This is the richest configuration surface in the product. Two top-level launch buttons on any
activity: **Assign** (student-paced homework) and **Start now** (live).

**Start now** first asks *"How would you like to host the session?"* →
**Student paced** (*Students work at their own pace*) or **Teacher led** (*You lead the session,
students answer on their devices*).

### 13.1 Assign (student-paced) — `/activity/admin/quiz/homework/<id>`

**Assignment Details**
- **Assign to a class** — *"Get real student names and monitor student progress"*, **Import Class** (+8 sources), and a `New` **Teams — Import classes with one click** banner
- **Start – End time**: *Start immediately* → date; **End in: 1 day / 1 week / 2 weeks**; **Change**
- **Allow late submissions** toggle, *No close date*, **Edit close date**
- **Accommodations** — *"Provide Dyslexia Font, Translation, Extra Time, and more support for specific students"* + **Add**

**Select a mode** — three, each with a one-line rationale:

| Mode | Description | Primary settings |
|---|---|---|
| **Practice** | *"Independent, student-paced practice for deeper understanding."* | Session attempts (Unlimited/1/2/3), Question timer |
| **Accuracy** | *"Reinforce skills with repeated practice until mastered."* | Session attempts, **Set Mastery goal: 80% / 90% / 100%**, **Reattempts per questions: Unlimited/1/2/3** (default 2) |
| **Testing** | *"Assess learning outcomes in a focused environment."* | Session attempts (default 1, *"Students login required to limit attempts."*), **Review & Submit** `NEW`, Anti-cheating block |

**More settings** — four tabs:

- **General** — **Question timer** (`Off` / `On – lock answering after time ends`),
  **Anonymize student names**, **Review & Submit** (*"Allow students to skip questions and
  modify responses before submitting"*), **Skip questions & attempt later**
- **Mastery** — **Session attempts**, **Redemption questions** (*"Allow students to reattempt a
  few incorrect questions."*, ON by default), **Rotating Question Set** (*"Available only for
  assessment with more than 10 questions."*), **Show answer after each question**
  (`On` / `Validate only` / `Off`)
- **Anti-cheating** — **Anti-cheating Monitor `PREMIUM`** (*"Warn students for leaving fullscreen
  and off-task activities"*) with two children **Disable right click** (*"Prevent use of AI apps
  or other tools via right click"*) and **Disable copy and paste**; then **Show all answers after
  session** (`On` / `Questions only` / `Off`), **Shuffle questions** (ON), **Shuffle answers** (ON)
- **Gamification** — **Serious theme `NEW`** (*"Focused environment without gamifications"*, OFF
  by default; forced *"Always On in test mode"*), **Leaderboard** (ON), **Power-Ups**
  (*"Students get fun abilities and unlock bonus points"*, ON), **Play music** (OFF),
  **Show memes**

A coach-mark on Testing mode: *"Test Mode now has a new look — It matches the platforms students
see on state and other high-stakes tests. The old Test Mode is still here — just switch to
Classic with the Serious Theme on."*

### 13.2 Teacher led — `/activity/admin/quiz/start_new/<id>?selection=teacher-paced`

Two modes:
- **Teacher Paced** — *"Students follow along as teacher controls the pace"*. Settings:
  Question timer (`On - allow answering after time ends`), Anonymize student names, Serious theme,
  Anti-cheating Monitor `PREMIUM` (+ disable right click / copy-paste), Shuffle answers,
  **Leaderboard**, **Live Reactions**.
- **Paper Mode** — *"Present questions on your screen and scan student Q-cards for responses
  using our mobile app"* (a Plickers clone). Prerequisites block: **Print Q-cards for students**
  (**Print**), **Download Wayground mobile app** (**Get link** by SMS/email),
  **Skip unsupported questions** toggle. Optional **Assign Q-Cards to students** by creating a
  paper mode group.

Paper Mode is a genuinely clever accessibility/equity feature: a whole class can participate
with one teacher device and zero student devices.

**BloomLoop:** we have a single delivery mode. We have no mastery goal, no per-question
reattempt budget, no redemption questions, no rotating question set, no scheduling window, no
late-submission policy, no anonymisation, no shuffle, no teacher-paced/live mode, and nothing
like Paper Mode.

---

## 14. Accommodations (Students → Accommodations)

Route `/session/admin/differentiation/accommodations`. Framing, verbatim in part:
**"Set up learning supports once. Help every student, every time."** — *"Stop making five
versions of every worksheet. Set individual supports—like Read Aloud, Hints, or Reduced Answer
Choices—just once per student. Wayground applies them automatically and discreetly, so every
student can access grade-level content without being singled out."*

**21 accommodations in 5 named groups**, set per-student and applied automatically to every
session:

| Group | Accommodations |
|---|---|
| **Basic Accommodations** | Extra Time for Questions · Participant Attempts · Read Aloud · Extended Deadline `New` |
| **Question Settings** | Hints · Redemption Question · Reduce Answer Choices · Speech To Text `New` |
| **Reading Support** | Dyslexia Font · Translate · Font Size · Bi-lingual Dictionary · Font Spacing · Reading Mode · Notes To Refer |
| **Learning Environment** | Enhanced Display Mode `New` · Don't Show Leaderboard · Turn Off Sound Effects |
| **Math Tools** | Desmos Scientific Calculator · Desmos Graphing Calculator · Four Function Calculator |

There is a **Preview Accommodations** panel — *"See how students experience these
Accommodations"* — that renders each support from the student's point of view.

Gating: the pricing matrix lists **"Tools for differentiated learning"** as **School only**, and
the School plan card advertises **"14 accommodation tools"** (vs the 21 listed here — the marketing
number and the product number disagree). **"Support accessibility with translation tools"** is the
one accessibility row ticked for **all three tiers including Basic**. Read-aloud is Individual+.

This is, by a distance, the most impressive part of the product. Two design decisions to copy
outright: **(a) accommodations are attached to the student, not the assignment**, so a teacher
configures once and never again; **(b) "discreetly … without being singled out"** — the support
is invisible to peers.

**BloomLoop:** we have nothing here. Not a single accommodation.

---

## 15. Students / classes / rostering

Route `/manage/admin/classes`. Two sections: **Classes** and **Accommodations**.

*"Add your first class — Assign sessions with a click, see real student names, and monitor
student progress."*

- Free rostering: **Google Classroom**, **Microsoft Teams** (with a `New` one-click banner:
  *"Students will be able to login with one click with their Microsoft Teams account"*), and
  **Create manually**
- **Paid integration** — *"Available in School and District plans"*, **Get a quote**. All locked 🔒:
  **Canvas · Schoology · Toddle · Classlink · Clever · Blackboard · Moodle · D2L Brightspace**
- **Coming Soon!** — **ManageBAC**, **Schoolbox** (**Notify me**)

Pricing matrix confirms: **Automatic grade sync with your LMS** = *Only Google Classroom* on
Individual, full on School. **Roster integrations** = School only.

**BloomLoop:** we have manual class/student setup via the HOD → professor → student chain. No
LMS or roster integration.

---

## 16. Student experience and join flow

`/join` — *"For Students - Enter Your Code"*. A single **"Enter a join code"** field + **Join**.
Also present on the teacher side as **Enter code** top-right.

The student shell is where Wayground's real product identity shows:
- A customisable avatar (a **"Qbit"**)
- A **coin balance** (500 on this account) with a **+** and **Go to shop**
- Footer: Quick links, Worksheets, Teacher resources, and an **Accessibility & Inclusion** link
  with an a11y icon; App Store and Google Play badges

**The avatar shop** (`/join/avatar-shop`) is a full free-to-play loot economy:
- Tabs **What's New** / **Shop**
- A seasonal **"BACK TO SCHOOL '26 DROP"** hero with **Shop the drop**
- **Quests** — *"Play activities, earn coins!"*
- **Mystery box** — *"Surprise yourself!"*
- **New Items** grid with **rarity tiers** (`Rare`) and prices of **2,000** and **6,000** coins
  against a starting balance of **500**
- Cosmetics are transparently anime/IP-adjacent character skins

Teacher-side gamification to match: **Leaderboard**, **Power-Ups**, **Play music**,
**Show memes**, **Live Reactions**, and a teacher-authored **Meme sets** library
(*"Add a dash of originality — Create a custom meme set for your class; they'll love it!"*).
The counterweight is the new **Serious theme** — *"Focused environment without gamifications"* —
which is off by default everywhere except test mode. The default posture is: maximum gamification.

**BloomLoop:** we have a plain student experience. Deliberately.

---

## 17. AI features and limits

Three distinct AI surfaces:

1. **Generation** (Assessment / Passage / Flashcards) — parameters covered above; the
   differentiators are **DOK level**, **184 output languages**, **forced vocabulary**,
   **Use sources**, and **AI-suggested subtopics**.
2. **Per-activity "AI actions"** on any activity page, under *"Improve your activity"*:
   **Generate flashcards · Add similar questions · Translate quiz · More options**.
3. **"Enhance this quiz using WAYGROUND AI" `BETA`** — a free-text box (*"Ask AI to enhance or
   edit this quiz"*) plus presets:
   - Headline three: **Add similar questions**, **Fix grammatical and spelling errors**,
     **Translate quiz to another language**
   - *"Or try these"*: **Convert questions to real-world scenario · Simplify questions ·
     Add questions on particular topic · Add a thematic narrative · Add my student's name in
     the questions · Make It Fun · Reduce Options From MCQs**
   - Disclaimer: *"Wayground AI is only limited to text based results and generations for now."*

**Crucially, none of the enhance presets are cognitive-level operations.** There is no
"raise the DOK", no "rewrite at Analyze level", no "make this harder". The only rigour-adjacent
verbs are *Simplify questions* and *Reduce Options From MCQs* — both of which move **down**.
DOK exists at birth and is then abandoned.

**Limits.** `AI limit 0/10 per month`, tooltip: *"AI limit: using AI, you can create up to 10
activities per month. The limit resets at the beginning of every month."* This sits **on top of**
the 20-activity lifetime storage cap and the 14-day expiry.

**BloomLoop:** our whole thesis is the cognitive-level dimension Wayground drops on the floor.

---

## 18. Plans and pricing (as shown, INR storefront)

`/super-pricing` — *"Find the right plan — From running a classroom to managing a School,
there's a plan for everyone"*.

| | **Basic** (current) | **Individual** | **School / University** |
|---|---|---|---|
| Price | Free | **₹1035/month**, *billed annually at ₹12420* | Contact sales |
| CTA | — | **Start 7-day free trial** | **Get a quote** |
| Teachers | 1 | 1 | Unlimited |
| Payment | — | Credit Card, Apple Pay, Google Pay | Purchase Order |
| Storage | **10 activities** (card says *20 storage limit*; app says *0/20*) | Unlimited | Unlimited |
| Expiry | **14 day expiry for assessments, lessons & flashcards** | Unlimited expiry | Unlimited expiry |
| AI | **10 AI credits/month** | Unlimited | Unlimited |
| Question types | **"5 types of questions"** (actually 10 selectable) | 18+ incl. drag-and-drop, hotspot | same |
| Private content | ✗ | ✓ | ✓ |

Feature rows and where they unlock:

- **Basic + Individual + School:** Deliver live or student-paced activities · Gamified features
  and game modes · Read aloud · **Mastery mode** · Support accessibility with translation tools
- **Individual + School:** Make activities private · Embed audio, video and slides ·
  Generate activities with AI (*Limited* on Basic) · AI generated answer options & explanations
  (*Limited*) · Create activities with interactive questions (*Limited*) · Enhance lessons with
  multimedia search (*Limited*) · Support learners with read-aloud & adaptive tools ·
  Skip questions · Schedule ahead with extended deadlines · Reopen expired assignments ·
  Pausing a game · Share reports with teachers & parents · Tag resources for easy organization ·
  Track progress with year-on-year · Flexible grading · **adaptive question bank**
- **School only:** **Tools for differentiated learning** · **Test mode for serious assessments** ·
  **Common Assessments** · Co-teaching tools · School-wide & District-wide shared library ·
  **Use AI to analyze reports** (*Coming soon*) · School/District usage and insights ·
  Sync class lists with one-click LMS · Automatic grade sync (*Only Google Classroom* on
  Individual) · Roster integrations · **Admin Dashboard** (*Coming soon*) · Priority support ·
  Monthly impact reports · On-demand virtual training · Live sessions with expert facilitators

Two phrases in the marketing copy that matter to us and appear nowhere in the free UI:
**"Assign a unique set of questions to each student with adaptive question bank"** (Individual
and School) and **"Common Assessments"** (School). Adaptive item selection is real, sold, and
entirely invisible below the paywall.

Also present: two teacher testimonials (4th Grade / High School), *"Trusted by teachers and
schools in 152 countries"*, and an FAQ (*Individual vs School · payment modes · free trial ·
monthly billing*).

---

## 19. Settings, profile, sharing, collaboration

**Profile menu** (bottom-left): name, a promo link **"Get your Game Changer certification now!"**
(a gamified teacher-certification badge programme — the account already carries a *Game Changer*
ring), **Settings**, **Logout**.

**Settings** (`/user-profile/settings`) — sub-nav **Profile · Meme sets · Settings**:
- **Account**: email, phone, username, **Edit**
- **Log in to Wayground Teacher app** via QR (a separate teacher mobile app exists)
- **Language** preference
- **Password** (Edit)
- **Account type**: *Teacher university*, with **Convert to student account**
- **Cookie Preferences**: Reject All / Accept All, with *Analytic and Performance*,
  *Marketing and Targeted Advertising*, and *Essential (cannot be disabled)*
- **Delete account**

**Sharing** on any activity: **Share** dropdown → **Copy link · Share with teachers ·
Share with team**; kebab → **Embed · Report**; plus **Worksheet** (download a printable
version) and **Copy & edit** (fork someone else's activity into your library).

**Collaboration**: Teams (library), *Share with team*, *Share reports with teachers & parents*
(paid), co-teaching (School only).

**Standards tagging**: standards are an **input to AI generation** only. There is no way to tag
an existing question with a standard from the editor, and no standards filter in library search.

---

## 20. Search / the public marketplace

Route `/explore/admin/search/all/<query>`. Type rail: **Top results · Assessments ·
Presentations · Interactive Videos · Passages · Flashcards**. For "photosynthesis":
**132.6K assessments, 3.3K lessons, 1.5K interactive videos**. Query-expansion chips under
*Similar* / *Find similar resources*.

**Filters**: Grade · **No. of questions** (1-10, 11-20, 21-30, 30+) · **Approximate duration**
(Under 5 min, 5-10, 10-15, Over 20 min) · **Question types** · **Subject** · **Languages** ·
**Sort By** (Most relevant / Most played / Most recent). Clear all / Apply filters.

Notably **absent**: no standards filter, no difficulty filter, no DOK filter. You cannot search
the 132K-item bank by rigour.

Activity detail page carries: type badge, author, subject, grade band, **play count** ("2K plays"),
and a **difficulty label** ("Medium") — so difficulty is *computed and displayed* but not
*filterable*, and it's a single opaque word rather than a cognitive level.

The **Browse** view organises the free bank by grade (KG → Grade 12 → University →
Professional Development) into nine subject groups: Health Sciences and Nursing (6 topics),
English Language Arts and Linguistics (5), Science (5), Skilled Trades and Technical Studies (4),
Mathematics (3), Business and Law (2), World Languages (2), Professional and Teacher Education (1),
General Knowledge Arts and Culture (3).

---

## 21. Capabilities BloomLoop is missing that look genuinely valuable for a Bloom's-taxonomy adaptive assessment tool

Ordered by value-to-effort for our actual thesis.

1. **Per-student accommodations attached to the learner, not the assignment.** Set once,
   applied automatically and invisibly to every future activity. Even a subset — extra time,
   read-aloud, font/spacing, reduced answer choices, calculator — would be transformative, and
   the "without being singled out" framing is the right one. This is the single highest-value
   thing on the whole surface.
2. **Higher-order item types.** Our MCQ+short-answer palette cannot express *Analyze*,
   *Evaluate* or *Create*. **Categorize**, **Match**, **Reorder**, **Hot text**, **Labeling**,
   **Hotspot**, **Graphing** and **Draw** each map cleanly onto specific Bloom levels in a way
   MCQ never can. Categorize→Analyze, Reorder→Analyze/Apply, Hot text→Evaluate (justify by
   evidence selection), Draw/Open→Create. Pick 3–4, not 14.
3. **A mastery loop with an explicit goal.** Accuracy mode's **Set Mastery goal (80/90/100%)** +
   **Reattempts per question** + **Redemption questions** ("reattempt a few incorrect questions")
   is exactly the adaptive scaffold we claim to be building, and it is expressed in three
   controls. Ours should be Bloom-aware: re-ask at the *same* level on failure, promote a level
   on mastery.
4. **A passage/stimulus object.** Analyze and Evaluate items need something to analyse.
   Wayground's passage generator with **forced vocabulary** and a **Use sources** grounding
   toggle is a good, small spec.
5. **Standards / curriculum tagging as a generation input.** We do not need 104 frameworks.
   Supporting one or two that our HOD/professor users actually teach against, and threading the
   selected standard code through into each generated item, buys enormous institutional
   credibility — and pairs naturally with a Bloom level as a second axis.
6. **A sessions object model.** Running / Scheduled / Completed / Paused, with a scheduling
   window, an end-in preset, and a late-submission policy. Our current fire-and-forget
   assignment cannot support a semester.
7. **Answer explanations as a first-class per-question field** (Wayground: *"Enter the ideal
   response for this question"*). For a Bloom's tool the explanation is the pedagogy — it should
   carry the reasoning, not just the key.
8. **File and URL ingestion.** PDF/DOCX/PPTX/image → items, and paste-a-URL → items. **Canvas
   QTI.zip** import specifically is how you get an existing question bank in without retyping.
9. **Question-type metadata surfaced at selection time** — the `AUTO GRADED` / `STUDENT PREVIEW`
   badges with a worked example on hover. Cheap, and it stops teachers picking a type that
   silently needs manual grading.
10. **Multi-language output.** Not 184, but the fact that a free tier ships translation as an
    accessibility feature across *all* plans is a good precedent for us.
11. **A student-facing preview the author can actually run** ("Try it as a student" /
    "Participant's view" with a Show-answers toggle). We should never let a professor publish
    an item they have not seen as a learner sees it.
12. **Partial credit.** They only just shipped it for Multi-select; for multi-step Bloom items
    it is table stakes.
13. **Teams / collections.** Departmental sharing is how this gets adopted institutionally
    rather than by one enthusiastic lecturer.
14. **Paper Mode.** A parked idea, but the equity argument (whole class participates on one
    device) is strong and nobody in our space does it.

---

## 22. Things Wayground does that we should deliberately NOT copy

1. **The loot-box economy.** Coins, `Rare` rarity tiers, a seasonal *"BACK TO SCHOOL '26 DROP"*,
   **Mystery box — "Surprise yourself!"**, **Quests — "Play activities, earn coins!"**, items
   priced at 2,000–6,000 against a 500-coin start. These are variable-reward mechanics aimed at
   children, and they train students to optimise for coins rather than understanding. It is also
   a live regulatory risk in several jurisdictions. Absolute no.
2. **Gamification on by default.** Leaderboard ON, Power-Ups ON, memes available, music one
   toggle away — with **Serious theme** ("Focused environment without gamifications") shipped OFF
   and buried in a fourth settings tab. For a Bloom's *assessment* tool the default must be the
   opposite: quiet by default, celebration opt-in. Leaderboards in particular are directly
   counter to a mastery model — they rank students against each other instead of against the
   objective.
3. **Forcing free users' content public.** *"Publicly visible"* is the only unlocked visibility
   option; **Restricted** and **Everyone in my organization** are both padlocked. Free teachers
   are unpaid contributors to a 132K-item marketplace they cannot opt out of. Student-adjacent
   and institutional content must be private by default, full stop.
4. **Gating the higher-order question types.** Every type in *Interactive & higher order*,
   *Visual learning* and *Math* is paid. That means the free tier is structurally a recall-only
   tool. If our whole premise is cognitive range, we cannot put the top of the taxonomy behind a
   card form.
5. **Anti-cheating surveillance as a feature line.** *"Warn students for leaving fullscreen and
   off-task activities"*, **Disable right click** (*"Prevent use of AI apps or other tools"*),
   **Disable copy and paste**. It is theatre — trivially defeated by a second device — and it
   sets an adversarial relationship with learners. Design items that are robust to AI assistance
   instead of trying to lock the browser.
6. **Teacher-authored meme sets.** *"Create a custom meme set for your class; they'll love it!"*
   Unmoderated user-uploaded images shown to minors mid-assessment is a content-safety liability
   with no pedagogical upside.
7. **Three overlapping quota systems.** 20-activity lifetime storage **and** 10 AI credits/month
   **and** a 14-day content expiry — plus a pricing page that says 10 activities where the app
   says 20 and "5 question types" where the app offers 10. Deliberate confusion, and it burns
   trust. One legible limit, stated once, stated correctly.
8. **Content that expires.** *"14 day expiry for assessments, lessons & flashcards"* — a teacher's
   own work is deleted out from under them to force an upgrade. Never do this.
9. **Routing individual users into an enterprise sales modal.** Clicking a locked question type
   as a solo teacher produces a *School & District* "Get a quote" pitch, not an upgrade path.
   The user wanted a drag-and-drop question and got a procurement conversation.
10. **Abandoning the rigour dimension after generation.** DOK is a one-shot prompt parameter.
    It is not stored per question, not shown in the editor, not filterable in a 132K-item
    library, not reported on, and the AI *enhance* presets only move difficulty **down**
    (*Simplify questions*, *Reduce Options From MCQs*). This is precisely the failure mode
    BloomLoop exists to avoid — the cognitive level must be a persistent, per-item, first-class
    attribute that drives adaptation and reporting, not a dropdown you touch once.
11. **Shipping an unnamed draft on click.** Entering the Presentation editor created a
    persistent library object before any intent was expressed. Our editors should not persist
    until the author has done something worth persisting.
12. **The half-finished rebrand.** Quizizz branding on error pages, "Lesson" vs "Presentation"
    vs "quiz" in three different places for the same object, "14 accommodation tools" advertised
    against 21 shipped. Inconsistent nomenclature is a real usability tax; pick our nouns and
    hold them.
