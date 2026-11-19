/**
 * Batch 8, material and the shared bank, from replies captured on the b8-z2
 * server (dev/samples-b8-material8.js). Dev only.
 *
 *   Material      where each topic came from, the topic-by-level grid with its
 *                 key and reasons, and "used <date>" in the library
 *   Planner       the "Write with AI" switch beside Write (off: writer 'templates')
 *   Bank          the "Rooms only" switch in an opened question, and its chip
 *   Hub lessons   the concept panel as its professor reviews it (an AI draft),
 *                 and a lesson question kept for rooms only
 *   Translations  the lesson's new fields in the generic field map
 *
 * Presses that reach a server answer with this page's server, which knows none
 * of these ids: Rooms only then hides itself, as it does on a server before
 * Batch 8.
 */

import { useState } from 'react';

import '../styles/hub.css';
import '../styles/hub-queues.css';
import { LessonsView } from '../hubstaff/Lessons.jsx';
import { TranslationsView } from '../hubstaff/Translations.jsx';
import AccountShell from '../shell/AccountShell.jsx';
import AppShell from '../shell/AppShell.jsx';
import Bank from '../teach/Bank.jsx';
import Material, { Library } from '../teach/Material.jsx';
import { LevelSupportGrid, chapterInfo } from '../teach/MaterialInfo.jsx';
import Planner from '../teach/Planner.jsx';
import { COMPLEXITY, LESSONS, LIBRARY, RECURSION, TR_LESSON, TR_META } from './samples-b8-material8.js';

const NAV = [
  { id: 'content', label: 'Material', icon: 'material', group: 'prepare' },
  { id: 'bank', label: 'Questions', icon: 'bank', group: 'prepare' },
  { id: 'session', label: 'Room', icon: 'room', group: 'prepare' },
];
const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });

function Console({ title, current = 'content', sub, children }) {
  return (
    <AppShell crumb={<span className="clip">{title}</span>} title={current === 'bank' ? 'Questions' : 'Material'} sub={sub} nav={NAV} current={current} onNav={() => {}}>
      {children}
    </AppShell>
  );
}

/* ------------------------------------------------------------- material */

function MaterialDemo({ chapter, ticked }) {
  const [content, setContent] = useState(chapter.content);
  const [selected, setSelected] = useState(ticked ?? chapter.content.topics);
  return (
    <Console title={content.title} sub="Tick the topics this class is asked about. Questions are written from those and nothing else.">
      <Material
        content={content}
        selected={selected}
        bank={null}
        hasBank={false}
        onContent={setContent}
        onSelected={setSelected}
        onNext={() => {}}
        info={chapterInfo(chapter)}
      />
    </Console>
  );
}

/** The grid on its own, with the topics ticked as given (press a cell to read its reason). */
function GridDemo({ chapter, ticked }) {
  return (
    <Console title={chapter.content.title} sub="The topic-by-level grid alone.">
      <section className="card"><LevelSupportGrid support={chapter.levelSupport} selected={ticked} /></section>
    </Console>
  );
}

function LibraryDemo() {
  return (
    <Console title="Reuse a chapter" sub="The library list: “used <date>” is the newest room opened on a chapter.">
      <div style={{ maxWidth: 420 }}>
        <Library saved={LIBRARY} loaded currentId={LIBRARY[1]?._id} busy="" onOpen={() => {}} />
      </div>
    </Console>
  );
}

/* --------------------------------------------------------------- planner */

function PlannerDemo({ writer }) {
  const [draft, setDraft] = useState({ total: 18, preset: 'balanced', mix: null, kinds: {}, mode: 'append', writer });
  const [ran, setRan] = useState('');
  return (
    <Console title={COMPLEXITY.content.title} current="bank" sub="A second run over the same chapter. Replace the bank, or add to it.">
      {ran && <p className="note" role="status">{ran}</p>}
      <Planner
        contentId={COMPLEXITY.content.contentId}
        topics={COMPLEXITY.content.topics}
        existing={3}
        draft={draft}
        held={null}
        onDraft={(patch) => setDraft((d) => ({ ...d, ...patch }))}
        onPlan={() => {}}
        onRun={() => setRan(`The run would send writer: ${draft.writer === 'templates' ? "'templates'" : 'nothing (the server uses the AI model when it has one)'}.`)}
        onConfirm={() => {}}
        onDismissHeld={() => {}}
      />
    </Console>
  );
}

/* ------------------------------------------------------------------ bank */

const q = (n, over) => ({
  _id: `m8q${String(n).padStart(21, '0')}`,
  status: 'active',
  source: 'teacher',
  model: null,
  topic: 'Big-O notation',
  kind: 'mcq',
  bloom: 'remember',
  options: ['$2^n$', '$n^2$', '$n \\log n$', '$n$'],
  answerIdx: 0,
  checks: [],
  misconceptions: [],
  provenance: { label: 'Professor-written', sentence: 'Written by a professor. In use since a professor wrote it.' },
  ...over,
});
const BANK = {
  questions: [
    q(1, { text: 'Which grows fastest as $n$ grows?', roomsOnly: true }),
    q(2, { text: 'Counting the steps of a loop that runs $n$ times gives which order?', options: ['$O(n)$', '$O(1)$', '$O(n^2)$', '$O(\\log n)$'], roomsOnly: false }),
    q(3, { bloom: 'apply', topic: 'Counting steps', kind: 'mcq', text: 'A loop inside a loop, each running $n$ times, does how many steps?', options: ['$n^2$', '$2n$', '$n$', '$n + 1$'] }),
  ],
  kinds: { forLevel: {}, label: {} },
};

function BankDemo() {
  const [bank, setBank] = useState(BANK);
  return (
    <Console title={COMPLEXITY.content.title} current="bank" sub="Open a question: its Rooms only switch sits above the answer key.">
      <Bank content={COMPLEXITY.content} selected={COMPLEXITY.content.topics} bank={bank} onBank={setBank} onPhase={() => {}} onBack={() => {}} onNext={() => {}} />
    </Console>
  );
}

/* -------------------------------------------------------------- the hub */

function HubFrame({ title, tab, children }) {
  return (
    <AccountShell current="hub" crumb="Learning Hub" title={title} sub={tab} width="wide">
      <div className="hub">{children}</div>
    </AccountShell>
  );
}

function LessonsDemo() {
  return (
    <HubFrame title={LESSONS.topic?.name ?? 'Recursion'} tab="Lessons">
      <LessonsView
        data={LESSONS}
        run={null}
        onMake={() => {}}
        onClearRun={() => {}}
        onApprove={async () => { await wait(400); return { message: 'Approved. Students on your classes now read this lesson, in place of version 1.' }; }}
        onDiscard={async () => { await wait(400); return { message: 'Discarded. Students never saw it.' }; }}
        readPreview={async () => { await wait(300); return { empty: 'Nothing to preview here.' }; }}
        onRecheck={() => {}}
      />
    </HubFrame>
  );
}

function TranslationsDemo() {
  const [lang, setLang] = useState('hi');
  const [filter, setFilter] = useState('all');
  const data = { ...TR_META, items: [TR_LESSON] };
  const said = async () => { await wait(400); return { message: 'Saved as a draft. The check found nothing to look at; approve it when you have read it.' }; };
  return (
    <HubFrame title={TR_META.chapter?.title ?? 'Recursion and the call stack'} tab="Translations">
      <TranslationsView
        data={data}
        lang={lang}
        onLang={setLang}
        filter={filter}
        onFilter={setFilter}
        run={null}
        onTranslate={() => {}}
        onClearRun={() => {}}
        act={{ write: said, edit: said, approve: said, discard: said }}
        opened={[`lesson:${TR_LESSON.id}`]}
      />
    </HubFrame>
  );
}

/* --------------------------------------------------------------- entries */

export default [
  {
    id: 'm8-material-text',
    title: 'Material: a pasted chapter, its sources and the level grid',
    role: 'professor',
    note: 'Line numbers under each topic, a hand-added topic with the server’s note, two topics ticked of three, and the grid’s three marks with Understand and Analyse not supported by the material. Press or focus a square for its reason.',
    render: () => <MaterialDemo chapter={COMPLEXITY} ticked={COMPLEXITY.content.topics.slice(0, 2)} />,
  },
  {
    id: 'm8-material-deck',
    title: 'Material: a deck, every topic to its slide',
    role: 'professor',
    note: 'Slide numbers under each topic; the material supports every level for every topic. Four of six ticked.',
    render: () => <MaterialDemo chapter={RECURSION} ticked={RECURSION.content.topics.slice(0, 4)} />,
  },
  {
    id: 'm8-grid',
    title: 'Material: the level grid alone',
    role: 'professor',
    note: 'One Tab stop; the arrow keys, Home and End move through it, and each square’s reason is its tooltip and the line under the grid.',
    render: () => <GridDemo chapter={COMPLEXITY} ticked={['Big-O notation']} />,
  },
  {
    id: 'm8-library',
    title: 'Material: the library, last used',
    role: 'professor',
    note: '“used 19 Nov” under the chapter a room was opened on; nothing under the ones never used.',
    render: () => <LibraryDemo />,
  },
  {
    id: 'm8-planner-ai',
    title: 'Questions: the planner, Write with AI on',
    role: 'professor',
    note: 'The switch beside Write. On sends no writer (the server uses its model when it has one). This page has no server, so the plan does not resolve.',
    render: () => <PlannerDemo writer="auto" />,
  },
  {
    id: 'm8-planner-templates',
    title: 'Questions: the planner, Write with AI off',
    role: 'professor',
    note: 'Off sends writer: \'templates\'. After the run the bank says the server’s sentence, as a toast and above the drafts.',
    render: () => <PlannerDemo writer="templates" />,
  },
  {
    id: 'm8-bank-rooms',
    title: 'Questions: rooms only',
    role: 'professor',
    note: 'Q01 is kept for rooms (its chip); open a question for its switch. A press here reaches no Batch 8 server, so the switch hides, as it does before Batch 8.',
    render: () => <BankDemo />,
  },
  {
    id: 'm8-hub-lessons',
    title: 'Hub lessons: the concept panel, an AI draft',
    role: 'professor',
    note: 'Version 2 carries the sections (introduction, three facts, explanation steps, a Python example, common mistakes, each cited) labelled an AI draft; its first question is kept for rooms only.',
    render: () => <LessonsDemo />,
  },
  {
    id: 'm8-hub-translations',
    title: 'Hub translations: the lesson’s new fields',
    role: 'professor',
    note: 'Introduction, Facts, Explanation steps, Code example: caption and Common mistakes, side by side with a Hindi draft. Edit gives a box per sentence.',
    render: () => <TranslationsDemo />,
  },
];
