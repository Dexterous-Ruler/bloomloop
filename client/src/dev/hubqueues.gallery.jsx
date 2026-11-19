/**
 * The professor's review queues in the Learning Hub, drawn from replies
 * captured on the hub harness (hub/samples/queues.js). Dev only.
 *
 * Each entry renders a queue's pure view inside a page frame, as the chapter
 * and topic frames will host it. The presses answer the way the offline
 * harness does: a run that ends at once and says nothing was drafted. A write
 * is answered with the server's sentence; the Marathi draft with a formula
 * flag answers 409 until the second press confirms it.
 */

import { useState } from 'react';

import '../styles/hub.css';
import '../styles/hub-queues.css';
import {
  EXPLANATIONS, EXPLANATION_PRESS, HINTS, HINT_LEAK, HINT_PRESS, LANGUAGES, LANGUAGES_NONE, LESSONS_DRAFT, LESSONS_FULL,
  LESSONS_HOD, LESSONS_NONE, LESSONS_WRITING, LESSON_PRESS, PREVIEW, REFUSED, RUNS, TRANSLATE_PRESS, TRANSLATIONS,
  TRANSLATIONS_FLAGS_409,
} from '../hub/samples/queues.js';
import { ExplanationsView } from '../hubstaff/Explanations.jsx';
import { HintsView } from '../hubstaff/Hints.jsx';
import { LanguagesView } from '../hubstaff/Languages.jsx';
import { LessonsView } from '../hubstaff/Lessons.jsx';
import { QueueFailed, QueueLoading, ReadOnly } from '../hubstaff/QueueParts.jsx';
import { TranslationsView } from '../hubstaff/Translations.jsx';
import AccountShell from '../shell/AccountShell.jsx';

const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });
const refuse = (status, message) => Object.assign(new Error(message), { status });
const readOnly = (d) => ({ ...structuredClone(d), canEdit: false });

/** The page around a tab, until the chapter and topic frames host them. */
function Frame({ title = 'Recursion and the call stack', tab, readOnly = false, children }) {
  return (
    <AccountShell current="hub" crumb="Learning Hub" title={title} sub={tab} width="wide">
      <div className="hub">
        {/* The chapter and topic frames say this once for an HOD, above their tabs. */}
        {readOnly && <ReadOnly />}
        {children}
      </div>
    </AccountShell>
  );
}

/** A press on the offline harness: running for a moment, then its end. */
function useFakeRun(press, run) {
  const [state, setState] = useState(null);
  const start = async () => {
    setState({ phase: 'running', reply: null, run: { ...run, state: 'running', topicsDone: Math.round((run?.topicsTotal ?? 0) / 3) } });
    await wait(1400);
    setState({ phase: 'done', reply: press, run });
  };
  return { state, start, clear: () => setState(null) };
}

/* ------------------------------------------------------------ explanations */

function Explanations({ data = EXPLANATIONS, ranFirst = false }) {
  const [filter, setFilter] = useState('');
  const run = useFakeRun(EXPLANATION_PRESS, RUNS.explanations);
  const state = ranFirst && !run.state ? { phase: 'done', reply: EXPLANATION_PRESS, run: RUNS.explanations } : run.state;
  return (
    <Frame tab="Explanations" readOnly={data.canEdit === false}>
      <ExplanationsView
        data={data}
        filter={filter}
        onFilter={setFilter}
        run={state}
        onDraft={run.start}
        onClearRun={run.clear}
        onWrite={() => wait(500)}
        onApprove={() => wait(500)}
        onRemove={async () => { await wait(500); return 'The explanation was removed. Students no longer see one for this question.'; }}
      />
    </Frame>
  );
}

/* ------------------------------------------------------------ hints */

const B3 = HINTS.questions.find((q) => list(q.hints).some((h) => h.status === 'draft'))?.questionId;
const LEAKY = HINTS.questions.find((q) => list(q.hints).some((h) => h.leak))?.questionId;
function list(v) { return Array.isArray(v) ? v : []; }

function Hints({ data = HINTS, opened = [B3, LEAKY], ranFirst = false }) {
  const [filter, setFilter] = useState('');
  const run = useFakeRun(HINT_PRESS, RUNS.hints);
  const state = ranFirst && !run.state ? { phase: 'done', reply: HINT_PRESS, run: RUNS.hints } : run.state;
  const saved = { message: 'Saved. Students on your classes see this hint when they ask for it.' };
  const act = {
    // A hint naming the right option is refused, as the server words it.
    writeHint: async (qid, step, text) => { await wait(500); if (/smaller input|\b6\b/i.test(text)) throw refuse(400, HINT_LEAK); return saved; },
    removeHint: async () => { await wait(400); return { removed: true, message: 'Removed. Students no longer see this hint.' }; },
    writeFeedback: async () => { await wait(500); return { message: 'Saved. A student who chooses this option reads it after answering, and as the first hint when they meet the question again.' }; },
    removeFeedback: async () => { await wait(400); return { removed: true, message: 'Removed. Students no longer see this feedback.' }; },
    approve: async (qid, body) => {
      await wait(500);
      const n = body?.steps?.length ?? 2;
      return { approved: Array.from({ length: n }, (_, i) => ({ step: i + 1 })), refused: [], message: `Approved ${n}. Students on your classes see ${n === 1 ? 'it' : 'them'} from now on.` };
    },
  };
  return (
    <Frame tab="Hints and feedback" readOnly={data.canEdit === false}>
      <HintsView data={data} filter={filter} onFilter={setFilter} run={state} onDraft={run.start} onClearRun={run.clear} act={act} opened={opened.filter(Boolean)} />
    </Frame>
  );
}

/* ------------------------------------------------------------ lessons */

function Lessons({ data = LESSONS_FULL, run: preset = null, previewOpen = false }) {
  const [state, setState] = useState(preset);
  const make = async () => {
    setState({ phase: 'running', reply: LESSON_PRESS, run: { state: 'running', topic: data.topic?.name } });
    await wait(1400);
    setState({ phase: 'done', reply: LESSON_PRESS, run: { state: 'done', written: 1, topic: data.topic?.name, error: '' } });
  };
  return (
    <Frame title={data.topic?.name ?? 'Topic'} tab="Lessons" readOnly={data.canEdit === false}>
      <LessonsView
        data={data}
        run={state}
        onMake={make}
        onClearRun={() => setState(null)}
        onApprove={async () => { await wait(500); return { message: 'Approved. Students on your classes now read this lesson, in place of version 2.', replaced: { id: 'x', version: 2 } }; }}
        onDiscard={async () => { await wait(500); return { message: 'Discarded. Students never saw it.' }; }}
        readPreview={async (lang) => { await wait(400); return lang === 'en' ? PREVIEW.en : lang === 'hi' ? PREVIEW.hi : { ...PREVIEW.hi, lesson: { ...PREVIEW.hi.lesson, language: { requested: 'mr', language: 'en', translationId: null, note: 'This lesson is not in Marathi yet, so it is shown in English.' }, steps: PREVIEW.en.lesson.steps } }; }}
        onRecheck={() => {}}
        previewOpen={previewOpen}
      />
    </Frame>
  );
}

/* ------------------------------------------------------------ translations */

function Translations({ data = TRANSLATIONS, lang: first = 'mr', ranFirst = false }) {
  const [lang, setLang] = useState(first);
  const [filter, setFilter] = useState('');
  const run = useFakeRun(TRANSLATE_PRESS, RUNS.translations);
  const state = ranFirst && !run.state ? { phase: 'done', reply: TRANSLATE_PRESS, run: RUNS.translations } : run.state;
  const flagged = new Set(data.items.flatMap((i) => Object.values(i.translations).flatMap((t) => list(t.drafts)))
    .filter((t) => t.flags > 0 && t.blocking === 0).map((t) => t.id));
  const act = {
    write: async () => { await wait(500); return { message: 'Saved as a draft. The check found nothing to look at; approve it when you have read it.' }; },
    edit: async () => { await wait(500); return { message: 'Saved as a draft. The check found nothing to look at; approve it when you have read it.' }; },
    approve: async (id, { confirmFlags } = {}) => {
      await wait(500);
      if (flagged.has(id) && !confirmFlags) throw refuse(409, TRANSLATIONS_FLAGS_409);
      return { message: `Approved. Students who chose ${lang === 'hi' ? 'Hindi' : 'Marathi'} now see it.` };
    },
    discard: async () => { await wait(400); return { message: 'Discarded. Students never saw it.' }; },
  };
  return (
    <Frame tab="Translations" readOnly={data.canEdit === false}>
      <TranslationsView data={data} lang={lang} onLang={setLang} filter={filter} onFilter={setFilter} run={state} onTranslate={run.start} onClearRun={run.clear} act={act} />
    </Frame>
  );
}

/* ------------------------------------------------------------ languages */

function Languages({ data = LANGUAGES }) {
  const [filter, setFilter] = useState('');
  return <Frame tab="Languages"><LanguagesView data={data} filter={filter} onFilter={setFilter} /></Frame>;
}

/* ------------------------------------------------------------ entries */

export default [
  { id: 'hq-expl', title: 'Review queues: explanations', role: 'professor', note: 'AI drafts first: approve, edit, discard; write one where there is none; Draft with AI.', render: () => <Explanations /> },
  { id: 'hq-expl-offline', title: 'Review queues: explanations, drafted offline', role: 'professor', note: 'The press on a server with no model: the note says nothing was drafted, and what was left out, why.', render: () => <Explanations ranFirst /> },
  { id: 'hq-expl-hod', title: 'Review queues: explanations, read by the HOD', role: 'hod', note: 'canEdit false: every control hidden, a read-only line in their place.', render: () => <Explanations data={readOnly(EXPLANATIONS)} /> },
  { id: 'hq-hints', title: 'Review queues: hints and option feedback', role: 'professor', note: 'Two AI hint drafts, a hint the question has since made a leak, feedback no longer shown. Write a hint naming the key to see the 400.', render: () => <Hints /> },
  { id: 'hq-hints-offline', title: 'Review queues: hints, drafted offline', role: 'professor', note: 'The 202 press and its run, which ends saying no hints were drafted.', render: () => <Hints ranFirst opened={[]} /> },
  { id: 'hq-hints-hod', title: 'Review queues: hints, read by the HOD', role: 'hod', render: () => <Hints data={readOnly(HINTS)} /> },
  { id: 'hq-lessons', title: 'Review queues: lessons', role: 'professor', note: 'An AI draft waiting (a worked example, a question waiting in the bank), the version serving, an earlier one.', render: () => <Lessons /> },
  { id: 'hq-lessons-slides', title: 'Review queues: a slides-only lesson draft', role: 'professor', note: 'Captured: Memoisation, made offline, nothing serving yet.', render: () => <Lessons data={LESSONS_DRAFT} /> },
  { id: 'hq-lessons-none', title: 'Review queues: no lesson yet', role: 'professor', note: 'A pasted chapter: the basis says the lesson comes from its text. Make a lesson runs offline.', render: () => <Lessons data={LESSONS_NONE} /> },
  { id: 'hq-lessons-writing', title: 'Review queues: a lesson being written', role: 'professor', note: 'The server says one is being written: Make a lesson is off.', render: () => <Lessons data={LESSONS_WRITING} /> },
  { id: 'hq-lessons-running', title: 'Review queues: Make a lesson, running', role: 'professor', render: () => <Lessons data={LESSONS_NONE} run={{ phase: 'running', reply: LESSON_PRESS, run: { state: 'running', topic: LESSONS_NONE.topic.name } }} /> },
  { id: 'hq-lessons-preview', title: 'Review queues: a lesson as a student reads it', role: 'professor', note: 'The preview in English, Hindi (approved) and Marathi (not translated, so English with a note).', render: () => <Lessons data={LESSONS_DRAFT.serving ? LESSONS_DRAFT : LESSONS_FULL} previewOpen /> },
  { id: 'hq-lessons-hod', title: 'Review queues: lessons, read by the HOD', role: 'hod', render: () => <Lessons data={LESSONS_HOD} /> },
  { id: 'hq-tr', title: 'Review queues: translations into Marathi', role: 'professor', note: 'A clean draft, an AI draft with a blocking finding and a flag, a draft with a formula flag (approve answers 409, then confirm).', render: () => <Translations /> },
  { id: 'hq-tr-hi', title: 'Review queues: translations into Hindi', role: 'professor', note: 'Approved ones shown side by side, and one out of date since its English changed.', render: () => <Translations lang="hi" /> },
  { id: 'hq-tr-offline', title: 'Review queues: Translate, offline', role: 'professor', render: () => <Translations ranFirst /> },
  { id: 'hq-tr-hod', title: 'Review queues: translations, read by the HOD', role: 'hod', render: () => <Translations data={readOnly(TRANSLATIONS)} /> },
  { id: 'hq-lang', title: 'Review queues: language statistics', role: 'professor', note: 'Phase 5’s translation warning on a question with a gap between English and Hindi.', render: () => <Languages /> },
  { id: 'hq-lang-none', title: 'Review queues: language statistics, nothing answered', role: 'professor', render: () => <Languages data={LANGUAGES_NONE} /> },
  { id: 'hq-loading', title: 'Review queues: loading', role: 'professor', render: () => <Frame tab="Hints and feedback"><QueueLoading /></Frame> },
  { id: 'hq-503', title: 'Review queues: no accounts on this server (503)', role: 'professor', render: () => <Frame tab="Explanations"><QueueFailed error={REFUSED[503]} /></Frame> },
  {
    id: 'hq-refused',
    title: 'Review queues: signed out (401), a student (403), not found (404)',
    role: 'professor',
    render: () => (
      <Frame tab="Explanations">
        <QueueFailed error={REFUSED[401]} />
        <QueueFailed error={REFUSED[403]} />
        <QueueFailed error={REFUSED[404]} />
        <QueueFailed error={{ status: 500, message: 'The server did not answer.' }} onRetry={() => {}} what="The explanations" />
      </Frame>
    ),
  },
];
