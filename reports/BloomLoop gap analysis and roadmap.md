# BloomLoop built the engine, not the classroom

BloomLoop's original promise works. A professor uploads a `.pptx` or pastes a syllabus, a Bloom-tagged bank is generated, students join by room code, and each one gets questions at the level they have reached, with a plain-English reason for every move. Almost everything the design handoff placed around that loop is missing. Of the eight views in v4, the primary handoff file, three do not exist at all: Roster & activities, class Analytics and the Learning Hub. The handoff's subtle features are absent from the build: attendance, private observations, the wheel's response statuses and history, think time, the raised-hands tally, the offline sync pill and outbox, the Hub's language switch, class analytics across sessions, and nearly every room setting. Written answers are the only evidence the product collects at the Create level. They are marked by keyword overlap and then thrown away, so no professor can see or re-check what a student wrote. The owner's wider vision is further off still: students have nothing to study, practise or test themselves with; graph, pattern, visual and maths-notation questions do not exist; and nothing works in a room with few phones or no connection. The right order is groundwork before novelty:

1. Fix the security and correctness defects found in the code.
2. Start storing each student's actual responses and topics.
3. Finish the features already half-wired on the server.
4. Rebuild the handoff's teacher-record layer.
5. Only then build the student hub and full offline mode.

After that, a short list of additions would make BloomLoop genuinely different: a course-outcome attainment export that Indian colleges now compute by hand, a room that keeps working offline or without phones, confidence taps with peer re-votes, misconception-tagged distractors, and a tutor that gives hints rather than answers. Each comes with obligations the team has to design for from the start:

- AI-written questions have error rates that make teacher review mandatory.
- Automated marking is unreliable and open to prompt injection.
- India's DPDP Act duties for students under 18 apply from May 2027.
- Desmos, GeoGebra and tldraw have licence limits.
- WCAG 2.2 sets rules for drag interactions.

## The live loop works, but the classroom around it was never built

The build is strongest where the original pitch was.

- Material, Question bank and Live session exist in substance.
- The server defines 16 question kinds, and 11 of them work end to end with partial credit (`server/src/questionTypes.js:44-61`).
- The adaptive rule attaches a reason sentence to every move (`README.md:143-149`). It starts every student at Understand, looks at their last five answers at a level, moves them up at 70% and down below 40%.
- Short connection drops are handled well: a submitted answer is held on the phone and re-sent after an automatic rejoin (`client/src/learn/LearnApp.jsx:945-955`).
- The student picker draws a name with `crypto.getRandomValues` before any animation starts (`client/src/teach/Draw.jsx:16-21`).
- The whole server can run from a laptop with no internet, using an in-process store and template questions (`README.md:57-65, 174-183`).

Everything this report says about the build comes from reading the code and the repo documents. Nothing was run.

What the handoff designed around that loop is a teaching companion for the whole lesson, and most of it is missing. v4 was the file open when the handoff was triggered. It contains everything in the four earlier files (Dashboard, Classroom v1, Classroom v2 and v3) plus Material, Question bank, Room and Analytics. The table below compares v4's views with the build; it was put together from a line-by-line reading of both.

| v4 view | What the handoff designs | In the build |
|---|---|---|
| Material | Upload or paste; four stat cards; a Topic × Bloom coverage matrix; a slide reference and supported-level dots per topic; "Use sample"; a "Write with AI" switch; chapter reuse | **Partly built.** Upload, ticking, renaming and adding topics, and chapter reuse are built. The coverage matrix, source references, sample button and AI switch are not. |
| Question bank | A source on every question; an "AI draft · review" approval gate; ticking questions "for the room"; "+ Add question"; a topic filter; "Asked 4× · 90% correct"; Rewrite, Harder ↑ and Easier ↓ | **Partly built.** Search, level filter, editor, rewrite at the same level, discard and bulk move/merge/split are built. Approval, room selection, add, per-question statistics and harder/easier are not. |
| Room | Student devices, Teacher-led or Mixed; an adapt switch; start level; questions per student; time per question; a question set; a waiting room with "Start session" | **Mostly missing.** Room code, link and QR code are built. Every setting and the waiting room are not. |
| Live session | Pause and resume; Focus, Support and Participation insight cards; an AI teaching move; KPI tiles showing change since the start; a students × level heat grid with sort and three bands; a Bloom pyramid; a student card with a radar chart, the last 10 answers and the next set | **Partly built.** The per-level roster grid, one support band, the accuracy figure and the reason panel are built. The cards, sort, bands, change figures, radar, last 10 answers and next set are not. |
| Spin wheel | Wheel and modes; present-only; no repeats with a counter; think time; a names toggle; a list view; an ask selector; response statuses; session history | **Reduced.** A fair no-repeat draw shown as a 3D drum. Everything else is missing. |
| Roster & activities | Attendance; four private observations; five no-device activities; a raised-hands tally | **Missing** |
| Analytics (class) | Trend over 4 or 8 sessions; accuracy histogram; level-by-level comparison between sessions; attendance and participation; hardest questions | **Missing** (the built analytics are per person, not per class) |
| Learning Hub | Prerequisite map; four-tab concept panel; language switch with a review state; a study path with "why this path"; progress bars compared with the student's own past | **Missing** |
| Projector | Question, diagram walk-through and class-progress modes; scores are never shown | **Join screen only** |
| Offline | Connection pill; sync panel listing queued records; "saved" toasts | **Missing** (no service worker, no app manifest, no IndexedDB) |

The features the owner calls subtle are the oldest and most deliberate part of the design. Every handoff version from Classroom v1 onward contains them:

- attendance;
- four private observations (Understood, Participated, Needs revision, Needs additional support), with the line "Teacher observation, kept private… never projected";
- the wheel's five response statuses and its per-session history;
- a ten-second think time;
- a raised-hands tally with counters for options A to D;
- an offline pill with its outbox;
- the Hub's English / हिन्दी / मराठी switch, with a "reviewed by" state on each translation.

A search of the whole repo finds none of them built.

A second layer of small details is also missing from screens that do exist:

- a source citation on every topic and question ("slide 3");
- "Asked 4× · 90% correct" with an Easy / Medium / Hard label;
- a "last move" line;
- the last ten answers and a "Next set · 3 Apply · 1 Understand review · 1 Analyse stretch" preview on the student card;
- change since the start of the session on each tile.

The earliest Dashboard file adds a session clock, a responses-per-minute strip and "37 of 42 reviewed". It also has a "below-40% group vs baseline" figure, which the pitch deck names as the pilot metric to record (deck p.10). None of these is built. Almost none of this can be added in the client alone, because the server stores no class roster, no teacher records, no per-room settings or question set, no review state, and no topic on any answer.

Written answers are the sharpest gap. Here is the marking rule, quoted from `server/src/questionTypes.js:775-794`:

```js
const keys = norm(point).split(' ').filter((w) => w.length > 3);
const hit = keys.filter((w) => said.includes(w)).length;
return hit / keys.length >= 0.5;
```

It works like this:

- A rubric point counts as made if half of its words longer than three letters appear **as substrings anywhere** in the answer.
- The answer passes at **70% of rubric points**.
- The result moves the student's level as a Create answer (`server/src/sockets/index.js:349-355`).
- The text is then discarded. A history row holds only `questionId, bloom, correct, score, tries, at` (`server/src/services/mastery.js:483-494`).

A student who lists the rubric's words in any order passes. A correct answer in different words fails. Negation makes no difference. The professor has nothing to re-check. The code comment calls the method "deterministic and explainable", which is true. The problem is that it sits exactly where the product claims to evaluate the top of Bloom's ladder.

The shortfall against the owner's wider vision is larger still.

- **Question forms.** The generator overrides the model's choice with one kind per level (`const kind = kindMap[bloom];`, `server/src/services/generate.js:1339`). A default bank therefore holds only mcq, match, blank, multi, order and open. Four finished phone widgets (hot text, dropdown, table and grid) are never generated and have no editor. A professor cannot write a question from scratch or attach an image. There is no graph, plot, pattern, maths-notation, drawing, code or hotspot question, and a short written answer below Create has nowhere to go.
- **Upload.** Only a `.pptx` up to 25 MB or pasted text is accepted. "Unit 3:" prefixes are stripped and there is no unit or lesson structure (`server/src/routes/content.js:16-27`).
- **Watching students.** The live row and side panel are good for one room. The record across rooms exists only for students with accounts, matched by a typed roll number. Every room restarts every student at Understand (`server/src/sockets/index.js:221-223`).
- **Students.** They get three read-only screens ("My results", "Progress", "Join a room"). That meets none of the owner's four student wants.
- **Reach.** The app is English only. There is no one-device or mixed mode and no offline store. Every phone loads about 870 KB of script and styles, uncompressed, on first visit.

Three rules written in the repo conflict with the wider vision. Each needs the owner's explicit ruling rather than a quiet override:

- "No PPT/content generation, ever. Ingest only. No image generation." (`CONTRACT.md:159`)
- "The live loop makes zero LLM calls." (`CONTRACT.md:160`)
- the deck's "Deliberately out: content authoring… image generation; proctoring; native mobile apps" (deck p.7).

The same deck already lists Hindi and Marathi generation, homework with spaced repetition, an offline-tolerant web app and IRT calibration as future work (deck p.11). Much of the roadmap below is the owner's own plan, made concrete. From here on, each proposal is labelled by type:

- **(a)** restores what the handoff already designed;
- **(b)** closes the gap to the owner's vision;
- **(c)** is a genuinely distinctive addition.

## Nine defects found in the code should be fixed first

These defects were found by reading code, not by running it. Items marked "verified" were re-opened and checked line by line by the auditor. The rest come from delegated read-only audits with file and line evidence. All are light or medium work, and several would cause trouble in a pilot with real students.

| # | Defect | Where | Why it matters | Weight |
|---|---|---|---|---|
| 1 | The teacher console at `/` has no role check, so a signed-in student can open it | `client/src/teach/TeachApp.jsx:87`, `client/src/main.jsx:73` | The v2 contract says students have no access to content (`V2-CONTRACT.md:33, 40`) | Light |
| 2 | `teacher:watch` checks the role or teacher key but not that the watcher owns the room (verified) | `server/src/sockets/index.js:430-437` | Any professor or key holder can watch another professor's class live | Light |
| 3 | Mastery goal, reattempts and redemption are validated and stored but never applied. The client never sends them, and the grid uses a fixed 80% (the `applyAnswer` call was verified) | `server/src/sockets/index.js:350-355, 123-126`, `client/src/teach/Room.jsx:15-19` | Settings that do nothing, and three different thresholds in play | Light, once the threshold is decided |
| 4 | The Topics view is always empty: analytics group answers by a `topic` field that history rows never have (verified) | `server/src/services/analytics.js:81-94, 268`, `server/src/services/mastery.js:483-494` | A screen that can never show data | Light |
| 5 | The student's bundle includes the teacher console and every account screen. Uncompressed sizes: app chunk 595,008 bytes, React 162,884, socket 41,609, CSS 72,003. The Vite config's own comment sets a student-route target of about 100 KB. Fonts load from Google's CDN | `client/src/main.jsx:20-29`, `client/vite.config.js:18-28`, `client/index.html:7-12` | Every phone downloads code it never runs, and the project misses its own target. Compressed sizes were not measured | Light to medium |
| 6 | A `poll` item would be scored as correct: the live handler calls `applyAnswer` without the `countsTowardMastery` check (verified) | `server/src/sockets/index.js:349-355`, `server/src/questionTypes.js:146-169` | Harmless today, since no route can create a poll, but it would inflate levels later | Light |
| 7 | The CSV export link attaches only the shared teacher key, so a professor signed in with an account is probably refused (read, not run) | `client/src/lib/api.js:170-173`, `server/src/routes/export.js:25` | The only export breaks on the main sign-in path | Light |
| 8 | Answers carry no idempotency key (a unique ID that lets the server ignore a repeat). Only one in-flight answer is kept, in memory. Drafts are keyed by question ID only, not by room or roll number | `server/src/sockets/index.js:308-325`, `client/src/lib/draft.js:23-30` | Blocks any offline outbox; a draft could reappear for another student on a shared phone | Light to medium |
| 9 | The database schema has drifted from the code: no SQL file creates `accounts`, `questions.kind`, `questions.payload` or the `owner_id` columns, and `profiles.account_id` exists but is never used | `supabase/005_sessions_and_profiles_v2.sql:67` and the server audit | A fresh database cannot be built from the migrations, and nothing links a room profile to a student account, which the hub needs | Medium |

Three smaller loose ends belong in the same sweep:

- Seven accommodations are defined in `server/src/accommodations.js:64-126` but nothing reads or writes them: read aloud, dyslexia font, larger text, high contrast, extra time, no timer and fewer choices.
- The `level-jump` integrity signal is declared but never recorded (`server/src/services/integrity.js:38`).
- The Live screen does not listen for pause or resume events, so pausing works only from `/rooms` (`client/src/teach/useRoomFeed.js:59-63`).

Defect 3 is really a decision, because three thresholds are in play:

- the handoff shows 60% everywhere ("A student moves up after 3 correct at 60% or more");
- the engine promotes at 70%;
- the room stores 80, 90 or 100, while the grid uses 80.

One has to be picked before the Room settings screen is built.

## Professor-centric means keeping evidence, not adding charts

### Three foundations would restore most of the handoff (a)

Most of the missing handoff features rest on three things the server would need to store.

- **A class roster** that a room is opened for: course, section, roll numbers and class size. This gives attendance, "36 / 40 present", participation figures, absent students leaving the wheel, and class analytics across sessions.
- **A teacher-record store**: one observation per student per day, a record per wheel pick (what was asked and how the student responded), and a record per raised-hands question. This carries the whole Roster & activities view, the wheel history, the Teacher-led and Mixed modes, and what the handoff calls "evidence from digital answers and teacher records".
- **Topic-aware history**: the topic and question attached to every response. This gives per-topic results, "hardest questions" and the Hub's "why this path".

Around these sit smaller fields that the live loop already has a place for:

- per session: mode, start level, questions per student, time per question, an adapt switch, a waiting-room state before questions start, and the set of questions used;
- per question: a review state (draft or approved) and a source reference (slide or line).

Estimated weight: the roster and teacher records are medium work (new tables, routes, and two or three screens); room settings are light to medium because the loop already exists; class analytics are medium.

Research gives a reason to restore the handoff's insight cards before its charts.

- A review of 50 teacher-dashboard studies found most aimed only at awareness. Of the 38 papers that claimed a purpose of prompting action, 16 were vague about what the action should be. Only one experimental study measured a dashboard's effect on learning outcomes ([Kaliisa, Jivet & Prinsloo 2023](https://educationaltechnologyjournal.springeropen.com/articles/10.1186/s41239-023-00394-6)).
- An umbrella review of 17 reviews, published in September 2026, concludes that dashboards raise awareness but often fail to support action ([Roy Chowdhury et al. 2026](https://reference-global.com/article/10.5334/uproc.247)).

The products that survive in classrooms show a few states and a way to act on them:

- Carnegie Learning's LiveLab marks each student working, idle or "monitor", adds an at-risk icon, and lets the teacher sort at-risk students to the top ([Carnegie Learning](https://support.carnegielearning.com/help-center/math/livelab/article/live-lab-at-risk-alert/)).
- ASSISTments flags a "common wrong answer" when three or more students give the same wrong answer ([ASSISTments](https://www.assistments.org/individual-resource/what-are-common-wrong-answers-and-how-are-they-calculated)).

A year-long analysis of 1.6 million actions in a tutoring system found teachers mostly helped students who were idle, while struggle showed up among students who were active ([EDM 2025](https://educationaldatamining.org/EDM2025/proceedings/2025.EDM.poster-demo-papers.276/index.html)). A tool earns its place by showing who is struggling while still working, which a professor scanning the room misses. Each of the handoff's three insight cards ends in an action: Focus ("Ask {level}"), Support ("Show them") and Participation. They should come back first.

One handoff item conflicts with a written rule. The "✦ AI teaching move" (a two-minute, no-device activity aimed at where the class is stuck) needs a model call during class, which `CONTRACT.md:160` forbids. The professor triggers it, not sixty phones, so the rule's stated reason (API quota and delay) does not obviously apply. Still, that is the owner's decision.

### Storing each answer turns watching into evaluating (b)

The owner wants professors to "keep watch on every single student and evaluate them". That fails at the moment of marking, because the evidence is thrown away. The smallest change with the largest payoff is to add these fields to every history row:

- the response itself;
- the topic;
- time taken;
- the language the question was shown in;
- the item's source and the model that wrote it.

The live grid row should also include each student's last few answers.

Research on existing products points to the same minimal data model:

- student;
- course offering;
- session;
- item, tagged with topic, course outcome, Bloom level and marks;
- response: score, time, answer, attempt number and timestamp.

Mastery should be computed from the raw responses when needed, so the rule can change without losing history. Canvas, for example, offers several such rules, including a default that weights the newest result 65% and earlier results 35% ([Canvas product blog](https://community.canvaslms.com:443/t5/The-Product-Blog/Canvas-Outcomes-New-and-Updated-Proficiency-Calculations-Coming/ba-p/579866)). This is light to medium work, and everything else reads from it. It also increases what the product holds about each student, which matters under the DPDP Act (see the obligations section below). Once a student has a lasting identity, the next room can start them at their last estimated level instead of Understand.

Evaluating by Bloom's level needs honesty about what a level is. Even experts disagree about which level a question tests:

- Pharmacy faculty classifying exam questions into six levels reached an inter-rater reliability of 0.25 and an accuracy of 46%. Accuracy rose to 81.8% when the six levels were collapsed to three ([Karpen & Welch 2016](https://dc.etsu.edu/etsu-works/15008)).
- Even trained experts in a careful generation study agreed on the level for only 82% to 93% of questions ([Scaria et al. 2024](https://arxiv.org/html/2408.04394v1)).

That has four consequences for the design:

- A student's standing is better shown as a profile than as a single number: the share answered correctly at each level, with the count of answers behind it.
- **Three bands (Remember–Understand, Apply–Analyse, Evaluate–Create) should be the default view**, with all six levels one click away.
- Every item should record who tagged its level (the AI or the professor), and the professor should be able to change it.
- The professor's view should show both the level a student has reached and how far that is from the level the exam expects.

Two findings support the last two points. AICTE itself says Evaluate and Create are hard to assess in timed exams and belong in projects and open-ended work ([AICTE Examination Reform Policy](https://aicte.gov.in/sites/default/files/ExaminationReforms.pdf)). And a tool that adapts to a student's level can end up teaching below the exam. Mindspark raised learning in randomised trials but had no effect on school exam scores, because it taught at each student's actual level ([J-PAL](https://www.povertyactionlab.org/node/8138364)).

The most valuable addition for professors is a report Indian colleges already have to produce by hand: course-outcome (CO) attainment, the share of students meeting each course outcome, which accreditation bodies ask for.

- UGC guidance says every assessment question should be linked to a course outcome, and student performance on each question tracked to measure attainment ([UGC Evaluation Reforms](https://mgmuhs.com/UGC/EVALUATION%20ENGLISH.pdf)).
- One university handbook sets 4–6 course outcomes per course. Its targets: level 3 when 85% of students score at least 60% of the marks for that outcome, level 2 at 70% of students, level 1 at 60%. It splits marks 50:50 between internal and end-semester exams, and computes **final attainment as 70% direct plus 30% from a course-exit survey** ([SRM IST handbook](https://webstor.srmist.edu.in/web_assets/downloads/2024/co-po-attainment-handbook-dsbs.pdf)).
- A state technical university deliberately **leaves quizzes and assignments out of direct attainment, because separating their marks by course outcome is too hard** ([VSSUT IQAC](https://vssut.ac.in/IQAC/documentspdf/OBE-VSSUT.pdf)). A quiz tool that tags every question with a course outcome fills exactly that gap, as a by-product.

Two exports would serve it:

- **A marks register**: one row per student, keyed by roll number, with one column per quiz scaled to the college's marks. It needs rules for counting the best n of m quizzes and for absent versus zero.
- **An attainment sheet**: one column per question, with header rows for maximum marks, course outcome and Bloom level.

Colleges set different thresholds and weights, so these must be settings, printed on the report. Because adaptive serving gives each student different questions, attainment for each course outcome should be each student's share of marks on the questions they were actually given for it. The export should say so.

No NBA or NAAC document was found that asks for attainment by Bloom level as such. Accreditation uses course-outcome attainment, and Bloom level enters through how the outcome is written and how the paper is planned.

Suggested order for integrations (a judgement, not a sourced finding):

1. CSV or Excel files keyed on roll number.
2. Google sign-in and Classroom roster import through the plain API. Classroom add-ons need paid education licences ([Google for Developers](https://developers.google.com/workspace/classroom/add-ons)).
3. LTI 1.3 into Moodle, only when an institution asks for it.

### Questions from uploaded units need a review gate, not trust (b)

Uploads should be widened in three ways:

- accept PDF and Word as well as `.pptx`;
- keep the unit and lesson structure instead of stripping "Unit 3:";
- carry a slide or page reference from extraction through to every question.

A 2026 system that turns slide decks into questions extracts text with PyMuPDF, also renders each slide as an image, and classifies each slide's role. It gives **zero questions to title, agenda and transition slides** ([slidesqaqa, arXiv 2605.26428](https://arxiv.org/html/2605.26428v2)). Text-only extraction silently skips slides that are only images. A known failure of lecture-based generation is questions that depend on something visible only on screen, such as "the orange curve" ([Arif et al., L@S 2024](https://public.websites.umich.edu/~kevynct/pubs/L_S_2024_WorkInProgress_Question_Generation_CRFinal2.pdf)). "Can this be answered without seeing the slide?" should therefore be an explicit check. For a single deck, sending the model a window of consecutive slides with their numbers intact is more faithful than search-based retrieval; retrieval only pays off across a whole course.

The accuracy evidence makes an approval gate essential. In the best-controlled expert study (2,550 questions from five models):

- 78% of questions were high quality, but only **65.56% of those matched the Bloom level asked for**;
- GPT-4 managed 70.04%;
- a prompt asking for step-by-step reasoning plus a definition of each level did best, at 76.32%;
- the most elaborate prompt, with examples added, fell to 51.18%;
- most models could not write good Create questions ([Scaria et al.](https://arxiv.org/html/2408.04394v1)).

Unreviewed multiple-choice items have high error rates:

- In one physiology study, **49% had item-writing flaws and 22% had factual errors**, although 91% were a reasonable starting point for revision ([Camarata et al. 2025](https://researchdiscovery.drexel.edu/esploro/outputs/journalArticle/LLM-Generated-Multiple-Choice-Practice-Quizzes-for/991022059818004721)).
- Across 71 medical-education studies, error rates ranged from under 1% to 45% ([AI MedEd Observatory](https://tipegitimi.gazi.edu.tr/ai-meded-observatory/what-can-ai-do/generating-assessment-materials/generating-mcqs)).
- 4.9% of GPT-4 programming multiple-choice questions had more than one correct option ([Savelka & Sakr](https://arxiv.org/html/2312.03173)).

Most of this evidence comes from 2023–24 models and medical subjects. No expert-rated study of 2026's leading models was found.

Automated checks help unevenly:

- Rule checks are cheap and reliable for surface flaws: the longest option being the answer, absolute words like "always", "all/none of the above", and duplicate options.
- Asking a second model to solve the question without the key catches few problems: it rarely raises false alarms (specificity 92.9%) but catches only about a third of bad items (sensitivity 35.3%).
- A model reviewing the questions itself caught 1 of 6 wrong or missing answer keys and 1 of 23 off-topic items ([AIME-Con 2026 review](https://aclanthology.org/2026.aimecon-wip.58.pdf)).

The design that follows is the handoff's own:

- every AI item is badged "AI draft · review" and kept out of rooms until approved;
- the source passage and the check results are shown beside it;
- Harder ↑ and Easier ↓ regenerate the question one level up or down.

After a question has been used, the responses become the best quality check. For each item, report:

- the proportion who answered correctly;
- the point-biserial, which measures whether students who did well overall got this item right;
- how many students chose each option.

**A negative point-biserial is the strongest single sign of a wrong answer key**, and it shows up even at class size. Assessment offices treat 0.2 as an acceptable point-biserial ([University of Arizona](https://phoenixmed.arizona.edu/assessment/item-analysis)). Reliability statistics such as KR-20 are misleading on a ten-item quiz. Full item response theory (IRT) calibration needs hundreds of responses per item; one simulation study recommends 500 or more students for the simplest model, Rasch ([JP3I](https://journal.uinjkt.ac.id/index.php/jp3i/article/download/34130/pdf_1)). With one class, the honest output is a rough band, which is exactly the handoff's "Easy / Medium / Hard for this class". An Elo-style rating per item gives nearly the same estimates as a Rasch model with almost no tuning ([Řihák & Pelánek](https://www.fi.muni.cz/~xpelanek/publications/its-matmat.pdf)). It lets the difficulty students actually experience correct the model's Bloom tag over time.

Money is not the limiting cost; the professor's review time is. At Gemini 3.8 Flash list prices ($0.75 per million input tokens and $3.75 per million output tokens until 31 December 2026), a 50-question bank with a verification pass costs roughly $0.19, assuming about 105,000 input and 30,000 output tokens. Gemini 4 Carbon and Argon prices double on 1 December 2026 ([Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)). The build already uses Gemini, so the model should stay a setting, and the model that wrote each item should be recorded. Affiliated colleges share university syllabi. A reviewed bank keyed by university, course code, unit and Bloom level would cut both cost and errors over time.

### Each question form maps to a library, a licence and a weight (b)

A question's format sets a ceiling on the level it can reach; what it asks the student to do sets the actual level. In the Blooming Biology Tool, built from ranking almost 600 science questions, multiple choice reached every level from knowledge through analysis, plus evaluation, but never synthesis (Create). Short answer and essay reached all six levels ([Crowe et al. 2008](https://pmc.ncbi.nlm.nih.gov/articles/PMC2592046/)). Each item should be tagged by what it demands, with the format only limiting the tag; no selected-response item should ever be tagged Create. The generator should produce several kinds of question per level rather than one.

About ten question types need no third-party code. The effort is concentrated in four: maths entry, graphing, drawing, and drag and drop that works by touch and keyboard. Sizes in the table are bundlephobia's compressed (gzipped) figures, a rough guide only. Each heavy type should be loaded separately, only when a question needs it.

| Form | In the build | Build with (licence, compressed size) | How it is marked | Weight |
|---|---|---|---|---|
| Multiple choice, true/false, typed blank, cloze, numeric | Built | Native inputs | Exact; numeric within a tolerance (units are shown but not checked today) | Done |
| Dropdown, hot text, table, grid | Phone widget built; never generated; no editor | Native inputs | Exact, partial credit | Light |
| Match, order, rank, categorise, drag words into gaps | Built (match is tap-only) | dnd-kit core + sortable (MIT, 14 kB + 4 kB), with tap-to-place | Exact, partial credit | Light |
| Short written answer at any level | Missing below Create | Plain text box | AI draft on each rubric point; professor confirms | Medium |
| Long written answer | Create only; keyword overlap | Text box with word count | Same | Medium |
| Maths expression | Missing | MathLive for input (MIT, 217 kB); KaTeX for display (MIT, 75 kB); math.js on the server (Apache-2.0); a SymPy or Maxima side service for checking form | Equivalence checked at random points, plus rules for form | Medium |
| Graph answer (points, line, parabola) | Missing | Mafs (MIT, 93 kB); JSXGraph for constructions (MIT / LGPL-3.0, 253 kB); Function Plot for display (MIT, 44 kB) | Compare a few parameters | Medium |
| Parameterised maths and number patterns | Missing | Generator programs written by the model, with answers and distractors computed by code | As numeric or expression | Medium |
| Label an image, hotspot | An image stimulus renders, but nothing creates one | Image upload; Konva + react-konva for drawing regions (MIT, 55 kB + 44 kB) | Whether the tap falls in the right region | Light to medium |
| Freehand working or sketch | Missing | perfect-freehand (MIT, 2 kB); Excalidraw for shapes and arrows (MIT, 344 kB) | Professor, or AI on an exported image with review | Medium |
| Code (CS courses) | Missing | CodeMirror 6 (MIT, 116 kB); Judge0 self-hosted (GPL-3.0) or Pyodide in the browser (MPL-2.0); ordering for Parsons problems (rearranging shuffled lines of code) | Test cases | Medium to heavy |
| Spoken explanation | Missing | wavesurfer.js (BSD-3-Clause, 15 kB) or RecordRTC (MIT) | Professor, or AI with review | Medium |

Library sources: [MathLive](https://github.com/arnog/mathlive), [KaTeX](https://github.com/KaTeX/KaTeX), [math.js](https://github.com/josdejong/mathjs), [Mafs](https://github.com/stevenpetryk/mafs), [JSXGraph](https://github.com/jsxgraph/jsxgraph), [Function Plot](https://github.com/mauriciopoppe/function-plot), [Konva](https://github.com/konvajs/konva), [perfect-freehand](https://github.com/steveruizok/perfect-freehand), [Excalidraw](https://github.com/excalidraw/excalidraw), [dnd-kit](https://github.com/clauderic/dnd-kit), [CodeMirror](https://bundlephobia.com/package/codemirror), [Judge0](https://github.com/judge0/judge0), [Pyodide](https://github.com/pyodide/pyodide), [wavesurfer.js](https://github.com/katspaugh/wavesurfer.js), [RecordRTC](https://github.com/muaz-khan/RecordRTC).

**Maths answers** must be checked for equivalence, not matched as text.

- Numbas substitutes random values into both the student's expression and the correct one, and treats agreement on enough points as equivalent ([Numbas](https://docs.numbas.org.uk/en/latest/question/parts/mathematical-expression.html)). math.js can do this on the Node server without a second runtime. Marking on the server also keeps heavy code off phones and keeps answers off the client.
- STACK's tests, built on the Maxima algebra system, separate "is it equivalent" from "is it factorised" ([STACK](https://docs.stack-assessment.org/en/Authoring/Answer_Tests/)). Checks of form are where a SymPy or Maxima side service earns the extra operational work.

**Generating maths questions** works at scale when the model writes a parameterised generator program and code computes the answers. In one deployed system:

- per-problem success was 0.79, against 0.17 for generating each variant and then checking it;
- the cost per 100 variants was $0.71, against $30.03;
- content errors were 17.8% lower than in variants written by experts ([CBIT, arXiv 2511.07932](https://arxiv.org/html/2511.07932v1)).

By contrast, small local models produced a correct answer key for only 37 of 75 primary-school maths items ([Kim 2026](https://aclanthology.org/2026.aimecon-wip.44.pdf)). Worked solutions should be built from the checked computation, not written freely. No surveyed product has a dedicated pattern or sequence question type, so pattern questions are best built on existing types:

- numeric entry for the next term;
- expression entry for the nth term;
- ordering;
- multiple choice over images generated from parameters.

**Visual questions** should be drawn by code from the same parameters as the answer, so the picture cannot disagree with the key. A 2026 benchmark of 2,920 maths-diagram prompts found ([Math-Vision Diagrams](https://arxiv.org/html/2608.08964)):

- models that write drawing code produced a diagram that compiled 70.7% to 93.2% of the time;
- image models always returned a picture;
- every model got the structure badly wrong (shapes and connections did not match what was asked);
- **wrong, missing or misplaced labels were the most common failure**.

Image models are unsuitable wherever a label, angle or coordinate carries meaning. Drawing a plot from data is arguably not the "image generation" that `CONTRACT.md:159` forbids, but the owner should confirm that reading.

Labelling and hotspot questions need an image upload endpoint and a stimulus field in the editor; the phone already renders stimuli. Both are light to medium work. Constrained graphing (place points, drag a line, set a vertex) is marked by comparing a few parameters, so it is as reliable as numeric marking.

**Drag and drop must work without dragging.** Two WCAG 2.2 rules apply:

- Criterion 2.5.7 requires every drag action to be possible with a single tap or click, and keyboard support alone does not satisfy it ([W3C](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html)).
- Criterion 2.5.8 sets a minimum target size of 24 × 24 CSS pixels ([W3C](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)).

The pattern that meets both:

- "tap an item, then tap where it goes", with dragging as an extra;
- up/down buttons for ordering;
- a list of named regions for hotspots;
- number fields beside every graph point.

dnd-kit includes keyboard support, sensible accessibility defaults and screen-reader announcements ([dnd-kit](https://github.com/clauderic/dnd-kit)). react-dnd and react-beautiful-dnd have had no updates in over a year and should be avoided for new work.

Three well-known tools are off limits without paying:

- The Desmos API's free tier is only for personal non-commercial use or a 90-day internal trial; production use needs a paid plan ([Desmos API terms](https://www.desmos.com/api-terms)).
- GeoGebra needs a commercial licence for any commercial purpose, explicitly including non-profits that charge course fees ([GeoGebra licence](https://www.geogebra.org/license)).
- The tldraw SDK may be used only in development unless the team buys a licence or accepts a watermarked hobby licence ([tldraw](https://tldraw.dev/community/license)).

Mafs, JSXGraph and Excalidraw cover the same ground under MIT.

### Written answers: the model proposes, the professor decides (b)

Keyword overlap should be replaced with a pipeline in which the professor reviews every mark. The evidence shows why AI marking must stay under review:

- **Agreement with humans is only moderate.** GPT-4o scoring more than 25,000 essays reached a quadratic weighted kappa of 0.629. It made larger errors for non-native writers it had identified as such ([Yang et al. 2025](https://arxiv.org/html/2504.21330v1)).
- **Fine-grained scales hurt.** One marker's accuracy fell from 76% to 57%, and its kappa from 0.51 to 0.34, when it moved from right/wrong to five levels. Running it ten times and auto-accepting only the answers where runs agreed raised right/wrong accuracy from 77.4% to 81.1%, while the share of answers it could mark fell from 98.2% to 85.6% ([arXiv 2601.08843](https://arxiv.org/html/2601.08843v1)).
- **Marking rubric points one at a time works better.** On handwritten university maths, per-point decisions were 89% to over 99% accurate, and 87% of the errors came from misreading the handwriting ([arXiv 2605.19043](https://arxiv.org/html/2605.19043)).
- **Students can attack the marker.** Instructions appended to answers succeeded **56.9% of the time on average across five marking models**. Defences written into the prompt left most models above 30%. A separate model trained to detect injected text scored over 95% F1 ([arXiv 2606.03090](https://arxiv.org/html/2606.03090)).
- **Humans are not perfect either.** Two teaching assistants using the same rubric gave exactly the same score on only about 45% of partial-credit items ([arXiv 2603.00895](https://arxiv.org/html/2603.00895v1)). The fair comparison is a second human marker.

The design that follows:

- split each rubric into yes/no points;
- quote the part of the student's answer that supports each decision;
- run the marker two or three times and send disagreements to the professor;
- treat the answer as untrusted text and screen it with a separate injection detector;
- hide the writer's identity from the marker;
- mark the result as provisional until the professor confirms it;
- group similar answers so one decision covers many, as Gradescope does.

Marking 600 answers three times costs about $7 on a mid-tier model such as Claude Sonnet 5.5 ($2 / $10 per million tokens) and under $1 on Claude Haiku 5.5 ([Claude pricing](https://docs.claude.com/en/docs/about-claude/pricing)). Short written answers also need a place below Create, since `open` is allowed only there and `blank` needs an exact match.

Academic integrity follows the same logic:

- Universities have settled on a "two-lane" model: supervised in-class assessment is what can be trusted, and unsupervised work is assumed to allow AI ([University of Sydney](https://educational-innovation.sydney.edu.au/teaching@sydney/embracing-the-future-of-assessment-at-the-university-of-sydney/)). A live, timed room on the professor's own material is naturally the supervised lane. The same questions set as homework should count for little.
- AI-detection scores should never feed a flag. Seven detectors labelled 61.3% of non-native students' TOEFL essays as AI-written ([Liang et al.](https://arxiv.org/pdf/2304.02819)).
- The build already records integrity as "signals, not proof", which is the right stance.

## A student hub has to stand on the professor's own material

The handoff's Learning Hub already covers three of the owner's four student wants. It has:

- a prerequisite map with Mastered / In progress / Not started states;
- a concept panel with Introduction, Explanation, Visual (step-through) and Practice tabs;
- a path back to the main topic, with a "why this path" line that cites the student's own answers;
- Bloom bars that compare the student only with their own last month.

None of it exists, and none of it can be built on today's data. It needs:

- **A lasting student identity.** Today a room profile is just a typed roll number, and the `profiles.account_id` column meant to link it to an account is never used. Accounts exist only when Supabase is configured.
- **Topic-aware history.**
- **Concepts linked by prerequisites.**
- **Permission for students to read content.** Today they have `content:'none'` (`server/src/routes/auth.js:460-469`).
- **A way to serve questions outside a live room.**

**Prerequisites** are best handled the way successful products handle them: an explicit graph of topics, plus a short adaptive check that spreads evidence along the links. ALEKS places students with **at most 16 questions across up to 501 topics**. Across 116,276 placements its predictions scored an AUROC of 0.889, and it labels about a quarter of topics "uncertain" rather than forcing a yes or no ([EDM 2024](https://educationaldatamining.org/EDM2024/proceedings/2024.EDM-industry.61/index.html)).

Language models handle direct prerequisite links reasonably well but get worse on longer chains, and no accuracy figure exists for engineering syllabi ([LLM + KC benchmark](https://ai-for-edu.github.io/Evaluating-Large-Language-Models-with-Educational-Knowledge-Graphs-on-Prerequisite-Relationships/about)). So:

- the model should propose only direct links, including links back to topics from earlier semesters;
- the professor confirms them in a quick review;
- the graph works out longer chains itself;
- response data later shows which links hold up.

Khan Academy's own A/B test found that showing unmastered prerequisites, with a brief review before harder problems, raised correctness on the next item by 2.7% ([Khan Academy](https://blog.khanacademy.org/?p=21314)). That is the company's own figure, and a short-term measure. Students should see each topic as "ready", "needs review" or "not sure yet, try two questions".

**Learning from scratch** runs straight into `CONTRACT.md:159` ("No PPT/content generation, ever. Ingest only.") and the deck's exclusion of content authoring. Yet the handoff's Hub shows explanations, a code sample, and translations "reviewed by" the professor. The route that respects the rule is to build lessons from the professor's own deck. Its full extracted text is already stored for each chapter, but only teachers can see it. Each lesson step would be:

1. a chunk of slides;
2. one worked example;
3. two to four retrieval questions with feedback that explains the answer;
4. then the next chunk.

The evidence supports this shape:

- Worked examples average an effect size of g = 0.48 across 55 studies, mostly school maths ([Barbieri et al. 2023](https://link.springer.com/content/pdf/10.1007/s10648-023-09745-1.pdf)).
- Feedback rich in information averages d = 0.48 ([Wisniewski et al. 2020](https://pmc.ncbi.nlm.nih.gov/articles/PMC6987456)).
- Summarising, highlighting and rereading rate as low-value study methods ([APS on Dunlosky et al.](https://www.psychologicalscience.org/news/releases/which-study-strategies-make-the-grade.html)).

If the owner allows generated explanations, they should go through the same approval gate as questions.

**A tutor must give hints, not answers.**

- In a field experiment with nearly 1,000 high-school maths students, a ChatGPT-like assistant raised practice scores 48% but left students **17% worse on the exam they took without it**. A tutor version, prompted with the solution and common mistakes and told to give hints step by step, raised practice scores 127% and largely removed the harm ([Bastani et al., PNAS 2025](https://ideas.repec.org/a/nas/journl/v122y2025pe2422633122.html)).
- In a 194-student Harvard physics study, a purpose-built AI tutor roughly doubled the learning gain of an active-learning class. The study covered two topics and used a short-term test ([Kestin et al. 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12179260/)).
- The bigger real-world problem is that students don't use tutors. In a Tennessee trial, students consulted Khanmigo on only 17% of their mistakes and learned about as much as without it. In two districts, students averaged 2 and 5 minutes a week against the 60 expected ([The 74](https://www.the74million.org/article/ai-tutors-not-yet-a-replacement-for-humans-research-says/)).

So the tutor belongs at the moment a student gets something wrong, not in a separate chat tab. It should:

- be grounded in the professor's slides and cite them;
- be given a structured summary of the student's recent attempts and Bloom profile, which was worth 3.4% in Khan's internal tests ([Khan Academy](https://blog.khanacademy.org/?p=21314));
- hold back the answer until the student has tried;
- come with hints written in advance for offline use.

A widely cited meta-analysis claiming an effect size of g = 0.867 for ChatGPT has been retracted and should not be quoted ([Plagiarism Today](https://www.plagiarismtoday.com/2026/07/15/study-claiming-ai-helps-students-learn-retracted/)).

**Practice and self-testing** have the strongest evidence. Retrieval practice (recalling material by answering questions) averages **g = 0.499 across 222 classroom studies and 48,478 students**. The effect is larger when practice matches the final test's format, includes corrective feedback and is repeated ([Yang et al. 2021](https://scholars.hkbu.edu.hk/en/publications/testing-quizzing-boosts-classroom-learning-a-systematic-and-meta-/)). Practice should therefore mirror the university paper (short answers, numerical problems, derivations), not only multiple choice.

For spacing reviews over time:

- The FSRS scheduling algorithm beat the older SM-2 algorithm at predicting recall for 99.6% of 9,999 Anki users' collections. Its default settings beat per-user tuning in about 16% of cases, mostly small collections ([srs-benchmark](https://expertium.github.io/Benchmark.html)).
- ts-fsrs (MIT) with default settings suits single facts such as definitions and formulae.
- Problem types need a list of topics due for review and, later, credit that flows along the topic graph, as Math Academy describes ([Math Academy](https://mathacademy.com/how-our-ai-works)).

For a class of 30–60, simple models of what each student knows work best:

- an Elo rating per student per topic and per item, seeded from the Bloom and difficulty tags ([Pelánek 2016](https://www.fi.muni.cz/~xpelanek/publications/CAE-elo.pdf));
- pyBKT (MIT), only once data is pooled across sections ([pyBKT](https://github.com/CAHLR/pyBKT)).

Self-tests need two modes: a practice mode with feedback after each item, and an exam mode that is timed, mixed and without hints. The error log should be built automatically from wrong answers (topic, level, linked prerequisite) rather than left to students. Reflection forms filled in after exams have mixed effects on scores ([ASEE](https://peer.asee.org/32772.pdf)). OATutor (MIT code, CC BY content) is the best open-source reference for a hint data model with question selection based on mastery ([OATutor](https://github.com/CAHLR/OATutor)).

**Motivation needs restraint.**

- Lower-ranked students lose motivation under leaderboards ([NSF PAR review](https://par.nsf.gov/servlets/purl/10510520)).
- A 16-week course with badges, a leaderboard and coins ended with lower motivation and lower final-exam scores ([IJETHE 2022, citing Hanus and Fox](https://link.springer.com/article/10.1186/s41239-021-00314-6)).
- People who break a streak are more likely to quit ([The Decision Lab](https://thedecisionlab.com/insights/consumer-insights/streak-creep-the-perils-of-too-much-gamification)).

The hub should show a mastery map by topic, goals tied to exam dates, weekly consistency with rest days, and comparisons with the student's own best. It should never show a student the words "slow learner". NAAC metric 2.2.1 does require colleges to identify slow and advanced learners ([ACU NAAC 2.2.1](https://acu.edu.in/naac/naac/Criterion-2/Summary%20Sheets/2.2.1.pdf)), but that report belongs to professors and heads of department, not students.

**Language needs restraint too.**

- English-medium engineering dominates. AICTE's first regional-language intake filled 255 of 1,230 seats: 116 in Hindi and 60 in Marathi ([ThePrint](https://theprint.in/india/education/cold-start-for-aictes-regional-language-engg-courses-21-seats-filled-no-takers-for-kannada/801619)). The right default is English technical terms with a Hindi or Marathi explanation switch, which is what the handoff draws.
- Translation changes difficulty. One certification test found 10 of its 30 translated items behaved differently from the originals ([Gierl, Rogers & Klinger](https://journalhosting.ucalgary.ca/index.php/ajer/article/view/54709/41766)). Correctness should therefore be tracked by the language a question was shown in.
- IndicTrans2's translation models are MIT-licensed ([Hugging Face](https://huggingface.co/ai4bharat/indictrans2-indic-indic-1B/blob/main/README.md?code=true)). Bhashini's API terms limit it to proofs of concept ([Bhashini](https://bhashini.gitbook.io/bhashini-apis/)).

The hub should be built in this order:

1. The content backbone: units, topics, reviewed prerequisite links, and questions tagged with topic, level and exam format.
2. A practice loop with feedback, Elo-based mastery states and an automatic error log.
3. FSRS review.
4. The "Get ready" check and a refresher path.
5. The self-test builder.
6. Lessons from the deck, with the language switch.
7. The tutor, last.

Each step uses data the previous one produces, and the tutor carries the biggest risk of going unused. Together this is the heaviest block on the roadmap: plausibly a semester of work for a student team (an estimate, not a measurement).

## Seven small additions would set BloomLoop apart (c)

BloomLoop's core is already what sets it apart. The platforms reviewed fall into four groups that barely overlap:

- live quiz games that give everyone the same questions;
- slide lessons with checks;
- AI generators with no classroom loop;
- adaptive practice that is individual rather than live.

Wayground's "adaptive" features either re-ask missed questions until a target is reached or rotate between sets of questions. Neither changes difficulty for each student ([Wayground Mastery Peak](https://help.wayground.com/support/solutions/articles/158000404926-host-an-assessment-quiz-in-mastery-peak-mode)). No product documentation reviewed reports results by Bloom level.

A useful test for subtle novelty comes from tools teachers love. Desmos's anonymise and pacing buttons exist to run a class discussion ([Desmos](https://blog.desmos.com/articles/anonymize-the-dashboard/)), and Plickers removes student devices entirely. A new feature should pass four tests:

- it removes a step or a barrier;
- it supports a teaching method research already backs;
- it still makes sense the twentieth time it is used;
- it can be explained in one sentence.

Points and leaderboards fail the second and third tests.

| Addition | Why it is distinctive | Strength of evidence | Weight |
|---|---|---|---|
| Course-outcome and Bloom attainment export, produced as a by-product of class | No live classroom tool reviewed exports in an accreditation format. Indian outcome-based-education modules are college-wide ERP purchases priced on request, and none was found that runs live questioning ([Linways](https://linways.com/pages/outcome-based-education-software/)). Colleges leave quizzes out of attainment because separating their marks by outcome is too hard | Strong evidence of the need; no study measures how much faculty time it would save, and formulas vary by college | Medium |
| A room that keeps working on a bad network or a local hotspot | Only Moodle's opt-in offline quiz attempts ([Moodle docs](https://docs.moodle.org/310/en/Quiz_offline_attempts)) and paper modes are documented as working without a connection | Strong evidence of the need; the technique is proven ([Kolibri](https://learningequality.org/kolibri/)); not tested in a rural deployment of BloomLoop | Heavy |
| One-device mode now, adaptive paper cards later | Existing paper modes are multiple choice only, don't adapt, and stop at 60–63 cards | The tally and Teacher-led mode follow the handoff; scanning cards for more than 60 students has not been studied | Light (tally), heavy (cards) |
| A confidence tap with pause, discuss and re-vote | No live-quiz product reviewed has a built-in two-round question | Moderate: peer-instruction gains come from quasi-experimental studies; the confidence evidence comes from one research group | Light |
| Distractors tagged with the misconception each represents | Turns wrong answers into a named misunderstanding the professor can re-teach | Weak: no trial tests the technique on its own | Medium |
| A tutor that gives hints, grounded in the professor's slides and the student's Bloom profile | General study modes exist, but none is tied to this professor's deck and this student's level history | Moderate for the hints-first design; strong evidence that optional tutors go unused | Heavy |
| Honesty marks: an "AI draft" badge, a one-line reason for each level change, "based on N answers", a flag when a translation changes difficulty | Competitors avoid showing imperfection. Showing students the system's estimate of them raises self-awareness more consistently than scores ([Frontiers 2026](https://www.frontiersin.org/journals/education/articles/10.3389/feduc.2025.1760183/full)) | Moderate for self-awareness, weak for scores | Light |

The two-round question deserves the earliest slot, because it is light to build and the evidence is good.

- When Harvard physics adopted peer instruction, normalised learning gains rose from 0.25 to 0.49 ([Crouch & Mazur](https://mazur.harvard.edu/publications/peer-instruction-ten-years-experience-and-results)).
- Across 62 courses, interactive methods averaged 0.48 against 0.23 for lectures ([PhysPort](https://physport.org/recommendations/Entry.cfm?ID=93336)).

Both are quasi-experimental, not randomised.

A confidence tap ("sure / think so / guessing") should be used as information, not to deduct marks.

- Across 17 medical exams, scores weighted by confidence were more reliable than plain scores: a Cronbach's alpha of 92.4% against 88.7% ([Physiological Society](https://www.physoc.org/abstracts/analysis-of-exams-using-certainty-based-marking/)).
- But students were confused when their weighted score came out lower than their raw accuracy ([Physiological Society 2013](https://www.physoc.org/?p=56141)).
- All of this comes from one research group.

Together, confidence taps and re-votes give the professor a list of students who were confidently wrong, which is the signal that points to a misconception. They add only a few bytes per answer.

Misconception-tagged distractors take this a step further:

1. Ask the generator to state which misunderstanding each wrong option represents.
2. Keep the tag after the professor reviews it.
3. Report "12 students chose the option that confuses X with Y".

The evidence for the tags themselves is weak. The one large trial of a diagnostic-question product could not report effects on attainment, and found low use and guessing ([EEF](https://educationendowmentfoundation.org.uk/projects-and-evaluation/projects/diagnostic-questions)).

### Rural reach depends on a phone in hand, not a phone at home

The urban–rural gap in India is about having a working device in the room, a signal and power, not about the price of data.

- **Phones.** In rural India in 2024, **89.1% of 14–16-year-olds had a smartphone at home, but only 65.9% could bring one in for the survey (62.2% of girls)**. Of those who could use a smartphone, only 31.4% owned one ([Ideas for India on ASER 2024](https://www.ideasforindia.in/topics/human-development/youth-s-digital-readiness-in-rural-india.html)). College students are older and ownership rises with age, but no survey measures college students directly. A design that assumes one phone per student will under-count girls and poorer students.
- **Data and speed.** Data costs about ₹8 per GB ([TRAI FY2025-26](https://trai.gov.in/sites/default/files/2026-10/PR_No127of2026.pdf)). India's median mobile download speed is 131.77 Mbps ([TelecomTalk on Ookla](https://telecomtalk.info/india-sees-median-mobile-download-speed-jump/1000114/)), but **one user in four gets about 6.2 Mbps or less, with 85 ms of delay** ([Russell 2025](https://infrequently.org/2025/11/performance-inequality-gap-2026/)). The same analysis allows roughly 300–620 KiB of JavaScript for a three-second load on a typical low-end phone. BloomLoop's app chunk alone is 595,008 bytes before compression. Its compressed size was not measured, so whether it breaks that budget is unknown, but every student downloads the teacher console they never use.
- **School connectivity.** School internet access ranges from 100% in Delhi to 18.6% in West Bengal ([UDISE+ 2024-25 analysis](https://educationforallinindia.com/school-infrastructure-insights-from-udise-2024-25/)). These figures are for schools, not colleges.
- **Power.** Rural power supply averages 22.6 hours a day, and some villages get far less ([Upstox explainer](https://upstox.com/news/upstox-originals/investing/watt-s-next-india-s-growing-rural-electrification/article-158206)).

The handoff's one-device features are the cheapest rural wins and should arrive with the roster work. Teacher-led mode, the raised-hands tally, attendance and observations all work on the professor's phone alone.

For patchy connections, a quiz has a simple data model: one student writes one answer to one question, once.

- An append-only outbox in IndexedDB, keyed by student, session and question, with the server keeping the first copy it receives, handles any conflicts. Heavier sync tools (CRDTs or sync engines) are unnecessary.
- Workbox can cache the app shell. Background Sync exists only in Chromium browsers ([Can I use](https://caniuse.com/background-sync)), so queued answers must also be re-sent on reconnect and when the app starts.
- Surviving a long drop mid-quiz means downloading the question set, with every adaptive branch, when the student joins, and choosing the next question on the phone. That moves the question-picking logic, which today runs only on the server, into code shared with the phone. It also puts answer keys on the device. This is the heavy part, and an integrity trade-off: Moodle's offline mode deliberately downloads questions without answers ([Moodle docs](https://docs.moodle.org/310/en/Quiz_offline_attempts)).

For rooms with no internet at all, the build already runs from a laptop without accounts. Turning that into a supported "teacher laptop as server" mode needs a cheap travel router:

- a Raspberry Pi's built-in Wi-Fi is reported to fail beyond 8 devices ([OpenWrt forum](https://forum.openwrt.org/t/remove-limit-of-8-devices-on-wifi-network-on-raspberry-pi/128734));
- phone hotspots often stop at 10 ([AOSP](https://source.android.com/docs/core/connect/wifi-softap)).

That mode also loses the app's install and offline features, because browsers do not treat a plain `http://192.168.x.x` address as secure, and those features require it ([MDN](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_contexts)).

Paper cards are the only proven way to run a live quiz for each student with no student devices at all. Both existing products are limited:

- Plickers prints sets of 40 and 63 cards, and its free plan allows five questions per set ([Plickers](https://help.plickers.com/hc/en-us/articles/360008948034-Get-Plickers-Cards); [Tech & Learning](https://www.techlearning.com/how-to/plickers-how-to-use-it-to-teach)).
- Wayground Paper Mode uses 60 cards, multiple choice only, and needs two teacher devices ([Wayground](https://help.wayground.com/support/solutions/articles/158000404923-a-quick-guide-to-paper-mode)).
- With Plickers, 78.26% of students responded, against 87.22% with clicker handsets ([Keele](https://keele-repository.worktribe.com/output/417481)).

No one offers an adaptive paper session: the teacher's phone reads every card, updates each student's estimate, and picks the next projected question for the class's weakest level. But card sets are smaller than many Indian sections of 70–120, scanning accuracy at that size has not been studied, and the camera work is heavy.

A pair mode, with two names on one phone, is a light alternative. Mindspark paired students of similar level on one computer and still found gains of 0.22 standard deviations in maths ([J-PAL](https://www.povertyactionlab.org/node/8138364)).

Adoption is the last rural constraint. India's public-school teachers often stop using AI tools after one or two sessions ([Analytics India Magazine](https://analyticsindiamag.com/ai-features/indias-public-school-teachers-are-adopting-aiand-outrunning-rules)). No equivalent data exists for college faculty. Mindspark's use fell when lab staffing was cut ([J-PAL](https://www.povertyactionlab.org/node/8138364)). The real test is the second and third session, which means:

- five minutes from upload to a running room;
- a session that is useful even if the professor does nothing afterwards;
- printable one-page summaries and question papers for days when the power or the projector fails;
- the attainment export as the reason to come back.

## Five obligations shape the design from the first commit

**AI-written questions** need a review gate, a visible source and a recorded model for every item, for the reasons given above. No vendor examined publishes independently checked error rates, and the industry norm is "the AI drafts, and the teacher must review" ([MagicSchool](https://www.magicschool.ai/privacy/quality)). **Automated marking** must stay provisional, quote its evidence, screen for injection, and keep the human grade as the official record.

**India's DPDP Act** applies to a tool that tracks every student. The timeline:

- The Rules were notified on 13 November 2025.
- The provisions on consent managers took effect on 13 November 2026.
- **The rules on notice and consent, the duties of whoever controls the data, children's data, people's rights over their data, and the Data Protection Board's power to impose penalties take effect on 13 May 2027** ([AZB & Partners](https://www.azbpartners.com/bank/update-indias-digital-personal-data-protection-framework-comes-into-effect/)).

What it requires:

- **Children.** A child is anyone under 18. Processing a child's data needs verifiable consent from a parent, and tracking or monitoring children's behaviour is banned ([DPDP Act ss. 2(f), 9](https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf)).
- **The education exemption.** Educational institutions are exempt from parental consent and the monitoring ban only where processing is limited to activities such as education and safety, and that processing must be kept separate from everything else ([AZB](https://www.azbpartners.com/bank/update-indias-digital-personal-data-protection-framework-comes-into-effect/)).
- **First-year students.** Many are 17. The product must either learn students' ages (or rely on the college to confirm them) or treat everyone as a child.
- **Who is responsible.** Handling data on a college's instructions, as its processor, is a stronger position than signing students up directly. That needs a lawyer's confirmation before May 2027.
- **Penalties.** Maximum fines reach ₹250 crore for failing to protect data and ₹200 crore for breaching the rules on children ([DPDP Act Schedule](https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf)).

The practical minimum before May 2027:

- a separate privacy notice shown when a student joins;
- consent that can be withdrawn;
- no advertising or third-party tracking;
- collecting only roll number and name;
- a retention schedule that squares the Rules' minimum of one year of logs with deletion on request;
- a breach procedure: notify the Board without delay, and report to CERT-In within six hours;
- a complaints route that answers within 90 days;
- a standard data-processing agreement for colleges to sign.

**Labels and leaderboards** can do harm.

- Purdue's Course Signals early-warning system probably overstated its effect on retention, and students who read warnings as a reprimand avoided staff ([Inside Higher Ed](https://www.insidehighered.com/index%2Ephp/node/48444)).
- India's own UGC guidance notes that students with low marks get labelled and looked down on ([UGC](https://mgmuhs.com/UGC/EVALUATION%20ENGLISH.pdf)).

Flags should:

- describe evidence ("4 of the last 5 Analyse questions wrong") rather than predict failure;
- be visible only to staff who can act on them;
- be possible to dismiss;
- never appear on the projector;
- record what was done about them.

The build's lack of coins and leaderboards should stay.

**Licences** rule out some obvious choices. Desmos, GeoGebra and tldraw need paid terms in production, as above. Copyleft licences (which require sharing your own source code in some cases) need care:

- Judge0 is GPL-3.0 ([judge0](https://github.com/judge0/judge0)) and is best run as a separate, self-hosted service.
- The Citolab QTI components are GPL-3.0, and H5P's PHP core is GPL ([H5P licensing](https://h5p.org/licensing)).
- Anki is commonly reported to be AGPL; this was not checked.
- Piston's public code-execution API stopped being free on 15 February 2026 ([piston](https://github.com/engineer-man/piston)).

**Accessibility** can now be enforced in India.

- The government's website guidelines (GIGW 3.0) follow WCAG 2.1 AA, and the Supreme Court has treated digital accessibility as part of the right to life ([AZB & Partners](https://www.azbpartners.com/bank/bridging-the-digital-divide-indias-evolving-accessibility-framework/)).
- UGC wrote to all institutions in July 2025 urging them to implement its accessibility guidelines ([Careers360](https://news.careers360.com/ugc-asks-colleges-universities-implement-accessibility-guidelines-facilitate-pwd-students/amp)).

For BloomLoop that means:

- WCAG 2.2's dragging and target-size rules on every new interaction;
- level colours that also carry text or icons;
- screen-reader announcements in the live room;
- text alternatives for questions drawn on a canvas;
- the seven accommodations already defined on the server, finally applied to each student.

## Build the groundwork first, after the owner settles eight decisions

The order follows two principles: dependency, and what cannot be undone. Evidence that is not stored today is lost for good, and features built on a temporary identity model will have to be rebuilt. The weights are estimates for a team of third-year students, not measurements: light is days, medium is one to three weeks, heavy is a month or more.

| Step | Work | Type | Weight | Why here |
|---|---|---|---|---|
| 0 | Fix the nine defects; pick one mastery threshold; separate the student app from the teacher console; host fonts locally | Fix | Light (1–2 weeks) | Security and trust before any pilot; a light student bundle comes before every rural feature |
| 1 | Store the response, topic, time, language and item source with every answer; add an idempotency key; show each student's last answers in the live grid; make written-answer marks provisional, with a review queue for the professor (keyword marks stop moving levels until confirmed) | (b) | Light to medium | Every later feature reads this data, and anything not stored now is lost |
| 2 | Finish the half-wired server work: several kinds per level; generating and editing hot text, dropdown, table and grid; write-your-own question; image and passage authoring; an approval gate showing the source and check results; Harder/Easier; per-question statistics and item analysis; room settings and a question set per room | (a) + (b) | Medium | The cheapest visible gain; the bank must be trustworthy before students study from it |
| 3 | The roster and teacher-record store: class and section, attendance, observations, the full wheel, the hands tally, Teacher-led and Mixed modes, the waiting room, insight cards, three bands, the student card, class analytics, projector modes | (a) | Medium to heavy | Restores the handoff's teaching companion and is also the first mode that needs no student phones |
| 4 | Course-outcome tagging and attainment exports (marks register and attainment sheet) with adjustable thresholds; roster import from CSV | (b) + (c) | Medium | The reason colleges will adopt it; needs steps 1 and 3 |
| 5 | Confidence tap, pause-discuss-re-vote, misconception-tagged distractors, honesty marks | (c) | Light to medium | Independent; can run alongside steps 3 and 4 |
| 6 | AI-assisted marking of written answers: one rubric point at a time, repeated runs, quoted evidence, an injection guard | (b) | Medium | Needs the review queue from step 1 |
| 7 | The student hub, in the order given above | (b) | Heavy | Needs a lasting identity, topic history and an approved bank |
| 8 | An offline outbox with question choice on the phone; a supported laptop-server mode with a router; adaptive paper cards last | (c) | Heavy | Needs steps 0, 1 and 3; paper scanning is the least certain item |
| Parallel | Maths entry and equivalence checking, graph answers, parameterised generators, code answers | (b) | Medium each | Doesn't depend on the chain; schedule by which courses pilot first |
| Dated | The DPDP minimum by 13 May 2027; WCAG 2.2 on every new interaction | Obligation | Light to medium | A legal deadline; accessibility is cheaper built in than added later |

Why this order rather than starting with the most visible feature:

- **The hub waits.** It is what the owner most wants to show, but it relies on a lasting identity, topic history and an approved bank, none of which exist yet. Building it first would mean building it twice.
- **The roster comes before attainment,** because attainment reports are per class.
- **Written marking is handled twice.** Step 1 brings an interim fix and step 6 the full one, because the current method corrupts exactly the evidence the product is named for.
- **Full offline comes late despite the rural priority.** It means restructuring how the server picks questions, while the cheap rural wins land in steps 0 and 3: a lighter student bundle, Teacher-led mode, tallies, and a supported laptop-server mode.

| Decision the owner must make | Where the conflict shows | What waits on it |
|---|---|---|
| May teaching content be generated, or must the hub use only the professor's own material? | `CONTRACT.md:159` and the deck rule out content authoring; the handoff's Hub shows explanations, code and reviewed translations | "Learn from scratch" in the hub |
| Which mastery threshold is the real one? | The handoff uses 60% ("3 correct at 60% or more"); the engine moves students up at 70% and down below 40% over five answers; the room stores 80/90/100 and the grid uses 80 | Room settings, bands, analytics |
| Do teacher observations and spoken answers move a student's Bloom level? | The handoff keeps them separate from accuracy, while its Analytics speaks of "evidence from digital answers and teacher records" | The teacher-record store, attainment |
| Does "no image generation" cover plots and diagrams drawn from data? | `CONTRACT.md:159` | Graph and visual questions |
| May a model call the professor triggers (the AI teaching move, marking during class) break "zero LLM calls in the live loop"? | `CONTRACT.md:160` | The live view, written marking |
| Six levels or three bands as the default display? | Raters agree poorly at six levels | Every report |
| Must the hub require student accounts? | `CONTRACT.md:161` says joining needs no student account; v2 accounts exist only with Supabase | Hub identity |
| Is the college or BloomLoop the data fiduciary (the party legally responsible for the data), and how are students under 18 handled? | The DPDP Act from 13 May 2027 | Sign-up, notices, contracts |

## Conclusion

The gap is not really a list of missing features; it is missing memory. BloomLoop decides well in the moment: which level, which question, and why. Then it forgets what the student actually did, keeps no class around the room, and records nothing the professor saw with their own eyes. That should change what the next demo shows. A professor re-checking one student's written answer, then printing a course-outcome sheet built from three weeks of quizzes, is more convincing to a college than any new question type, and it is cheaper to build. Competitors are well ahead, and well funded, on breadth of question types. They are weak where BloomLoop can be strong: being honest about uncertainty (AI-draft status, "based on N answers", quoted evidence, flags when a translation changes difficulty) and fitting how Indian colleges actually work (roll-number keys, attainment produced as a by-product, a room that survives a dead network or a class with few phones).

The sequencing risk is real. The hub is the most visible item and the one most likely to be started first, yet it is the item that most depends on everything else. Meanwhile May 2027 is a fixed date. If the team starts storing students' answers, as step 1 recommends, while also preparing notices, age handling and a data-processing agreement, the most useful thing the product will do and its biggest legal exposure arrive together. The heavy, novel items (choosing questions offline on the phone, adaptive paper cards, the tutor) are worth building only after the light ones show that professors come back for a third session.
