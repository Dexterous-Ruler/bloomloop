/**
 * Course outcomes, drawn from sample data. Development only.
 *
 * Every object has the shape the server returns (docs/API.md, "Phase 4: course
 * outcomes, their mappings, and the roster from CSV"), and the figures agree:
 * each outcome's answers are its topics' plus what is mapped to it directly,
 * and counted = mapped + excluded + unmapped. Sentences in replies are the
 * server's, copied from its routes. Nothing here talks to the server: the
 * callbacks wait a moment and change local state, refusing as the server
 * refuses (a code in use, a topic the chapter does not carry, the cap of 50),
 * so every button can be pressed. Coverage stays as sampled.
 */

import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { OutcomesView, listOf } from '../account/Outcomes.jsx';
import AccountShell from '../shell/AccountShell.jsx';
import { Icon, Segmented } from '../ui/index.jsx';

const NOW = Date.now();
const daysAgo = (d) => new Date(NOW - d * 86400000).toISOString();
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const hex = (n) => n.toString(16).padStart(24, '0');
const refuse = (message, status) => { throw Object.assign(new Error(message), { status }); };

const CLASS = { id: '76739eec407b3a5a88295326', courseName: 'Computer Networks', section: 'CS-A', termLabel: 'Odd term 2026' };
const PRIVACY = 'Course outcomes, their coverage and attainment are for staff only: never shown on a phone or the projector, and never sent to a student-facing route.';
const LIMITS = { outcomes: 50, code: 16, statement: 300, topicsPerOutcome: 100, weight: 100 };

/* ---------------------------------------------------------------- chapters */

const UNIT4 = 'b21d3dd1c905f99b8349777b';
const UNIT3 = 'c4a07e19d2b35f6a8e01c7d2';

const q = (n, topic, text, level, kind = 'mcq', status = 'active') => ({ id: hex(0xd000 + n), text, topic, level, kind, status });
const CHAPTERS = [
  {
    id: UNIT4,
    title: 'Computer Networks: Unit 4, the transport layer',
    topics: ['Transport layer services', 'User Datagram Protocol', 'Transmission Control Protocol', 'TCP connection establishment', 'Flow control and the sliding window', 'Congestion control'],
    questions: [
      q(1, 'Transport layer services', 'Which field of a segment lets the receiving host hand it to the right socket?', 'remember'),
      q(2, 'Transport layer services', 'Explain the difference between multiplexing at the sender and demultiplexing at the receiver.', 'understand', 'open'),
      q(3, 'Transport layer services', 'How many port numbers does a 16-bit field allow?', 'remember', 'numeric'),
      q(4, 'Transport layer services', 'Match each service to the layer that provides it.', 'understand', 'match'),
      q(5, 'User Datagram Protocol', 'Why does a DNS query usually travel over UDP?', 'understand'),
      q(6, 'User Datagram Protocol', 'Which of these does UDP not provide?', 'remember', 'multi'),
      q(7, 'User Datagram Protocol', 'A live video call drops one datagram in a hundred. What does the receiver see?', 'apply'),
      q(8, 'User Datagram Protocol', 'What is the size of a UDP header in bytes?', 'remember', 'numeric'),
      q(9, 'Transmission Control Protocol', 'Three duplicate acknowledgements arrive for the same sequence number. What does the sender do?', 'apply'),
      q(10, 'Transmission Control Protocol', 'Compare TCP and UDP for a file transfer over a lossy link.', 'analyse', 'open'),
      q(11, 'Transmission Control Protocol', 'Put the steps of a retransmission after a timeout in order.', 'understand', 'order'),
      q(12, 'Transmission Control Protocol', 'Which estimate is the retransmission timeout worked out from?', 'remember'),
      q(13, 'Congestion control', 'In slow start, how does the congestion window grow each round trip?', 'understand'),
      q(14, 'Congestion control', 'Judge whether halving the window on every loss is fair to new connections.', 'evaluate', 'open', 'draft'),
    ],
  },
  {
    id: UNIT3,
    title: 'Computer Networks: Unit 3, the network layer',
    topics: ['IP addressing', 'Routing', 'Subnetting'],
    questions: [
      q(21, 'IP addressing', 'Which of these is a private IPv4 address?', 'remember'),
      q(22, 'IP addressing', 'How many hosts can a /26 network address?', 'apply', 'numeric'),
      q(23, 'Routing', 'Why does a link-state router flood its link costs?', 'understand'),
      q(24, 'Routing', 'Given this routing table, where does a packet for 10.2.3.4 go?', 'apply'),
      q(25, 'Routing', 'Compare distance-vector and link-state routing for a campus network.', 'analyse', 'open'),
      q(26, 'Subnetting', 'Split 192.168.10.0/24 into four equal subnets.', 'apply', 'table'),
      q(27, 'Subnetting', 'Design an addressing plan for three labs of 50, 30 and 12 machines.', 'create', 'open'),
    ],
  },
];
const chapterTitle = (id) => CHAPTERS.find((c) => c.id === id)?.title ?? '';

// What a chapter's evidence carries, as the server checks a mapping against
// it: its list, its questions' topics, and old names answers were given under.
const OLD_NAMES = { [UNIT4]: ['Reliable delivery', 'Ports and sockets'] };
const knownOf = (id) => {
  const c = CHAPTERS.find((x) => x.id === id);
  if (!c) return null;
  const all = [...c.topics, ...c.questions.map((x) => x.topic), ...(OLD_NAMES[id] ?? [])];
  return [...new Map(all.map((t) => [t.toLowerCase(), t])).values()];
};

const SOURCE = {
  chapters: async () => { await wait(250); return CHAPTERS.map(({ id, title }) => ({ id, title })); },
  chapter: async (id) => {
    await wait(350);
    const c = CHAPTERS.find((x) => x.id === id);
    if (!c) refuse('That chapter was not found.', 404);
    return c;
  },
  classes: async () => {
    await wait(250);
    return [
      CLASS,
      { id: '6fc2802e8bcc25b1479fd944', courseName: 'Computer Networks', section: 'CS-B', termLabel: 'Odd term 2026' },
      { id: '7922c0a1d4e5f60718293a4b', courseName: 'Computer Networks', section: 'CS-A', termLabel: 'Odd term 2025' },
      { id: '81a3b4c5d6e7f8091a2b3c4d', courseName: 'Operating Systems', section: 'TY-CSF B', termLabel: 'Sem V 2026' },
    ];
  },
};

/* ---------------------------------------------------------------- outcomes */

const link = (contentId, topic, weight = 1, inChapter = true) => ({ contentId, chapter: chapterTitle(contentId), topic, weight, inChapter });
const outcome = (n, code, statement, targetLevel, topics, extra = {}) => ({
  id: hex(0xe000 + n), code, statement, targetLevel, position: n, archived: false, archivedAt: null,
  createdAt: daysAgo(30), updatedAt: daysAgo(4), topics, ...extra,
});

const CO1 = outcome(1, 'CO1', 'Explain how the transport layer delivers data between processes.', 'understand', [link(UNIT4, 'Transport layer services', 2)]);
const CO2 = outcome(2, 'CO2', 'Compare UDP and TCP for a given application.', 'analyse', [
  link(UNIT4, 'Transmission Control Protocol', 2), link(UNIT4, 'User Datagram Protocol'), link(UNIT4, 'Reliable delivery', 1, false),
]);
const CO3 = outcome(3, 'CO3', 'Apply flow and congestion control to a scenario.', 'apply', [
  link(UNIT4, 'Flow control and the sliding window'), link(UNIT4, 'Congestion control'),
]);
const CO4 = outcome(4, 'CO4', 'Design a subnet plan for a small campus network.', 'create', []);
const CO5 = outcome(5, 'CO5', 'Describe the layers of the OSI reference model.', 'remember', [link(UNIT3, 'IP addressing')], {
  archived: true, archivedAt: daysAgo(6), position: 5,
});

const routingQ = CHAPTERS[1].questions[3];
const OVERRIDES = [
  {
    questionId: routingQ.id, excluded: false, outcomes: [{ id: CO3.id, code: 'CO3', archived: false }],
    question: { text: routingQ.text, topic: routingQ.topic, level: routingQ.level, kind: routingQ.kind, status: 'active', contentId: UNIT3, chapter: chapterTitle(UNIT3) },
    updatedAt: daysAgo(3),
  },
  {
    questionId: hex(0xd0ff), excluded: true, outcomes: [], question: null,
    note: 'The question has been deleted. The override still applies to the answers given to it.',
    updatedAt: daysAgo(9),
  },
  {
    questionId: CHAPTERS[0].questions[3].id, excluded: false,
    outcomes: [{ id: CO1.id, code: 'CO1', archived: false }, { id: CO5.id, code: 'CO5', archived: true }],
    question: { ...CHAPTERS[0].questions[3], status: 'active', contentId: UNIT4, chapter: chapterTitle(UNIT4) },
    updatedAt: daysAgo(12),
  },
];

const LIST = { class: CLASS, canEdit: true, outcomes: [CO1, CO2, CO3, CO4, CO5], overrides: OVERRIDES, limits: LIMITS, privacy: PRIVACY };

/* ---------------------------------------------------------------- coverage */

const DEFINITIONS = {
  answers: 'Final, graded answers given in rooms opened for this class: polls, and attempts followed by a retry, are left out. An answer that belongs to two outcomes is counted under each, and once in the class totals.',
  questions: 'Approved questions (the ones a room may serve) of the chapters involved; drafts and discarded questions are left out.',
  resolution: 'An answer belongs to the outcomes its question is mapped to directly (a per-question override), if it has one; otherwise to the outcomes its topic is mapped to, in its chapter. A question excluded by an override belongs to none. Whatever reaches no outcome is counted as unmapped, never dropped.',
  topics: 'Topics are matched within their chapter, ignoring case and runs of spaces. While a question still exists its topic is used; then the topic the answer was given under, which is kept as it was when answered.',
  renamedTopics: 'Renaming a topic in a chapter\'s list does not rename it on questions and answers already written. Their evidence stays under the old name (inChapter: false) and shows as unmapped until that name is mapped too.',
  weights: 'A topic\'s weight (1 unless set) says how much its evidence counts towards the outcome beside the outcome\'s other topics, for the attainment report to apply. Coverage counts answers and questions unweighted. A question mapped directly counts with weight 1.',
  archived: 'An archived outcome keeps its mappings, so evidence still reaches it and every report still names it.',
  evidence: 'Digital answers only. Teacher observations and other teacher records are never mapped to an outcome or counted here (decision 3).',
};

const cov = (o, topics, direct, students, evidence, summary) => {
  const questions = topics.reduce((s, t) => s + t.questions, 0) + direct.questions;
  const answers = topics.reduce((s, t) => s + t.answers, 0) + direct.answers;
  return {
    ...o, topics: o.topics.map((t, i) => ({ ...t, ...topics[i] })), direct, questions, answers, students, evidence, summary,
  };
};
const COVERAGE = {
  class: CLASS,
  rooms: { counted: 5, codes: ['S5ANZP', 'WCS7XX', '7RN8Y5', 'WZWH6U', 'D6SEKU'] },
  outcomes: [
    cov(CO1, [{ questions: 4, answers: 112 }], { questions: 0, answers: 0 }, 18, 'answers', '112 answers from 18 students.'),
    cov(CO2, [{ questions: 4, answers: 132 }, { questions: 4, answers: 122 }, { questions: 0, answers: 9 }], { questions: 0, answers: 0 }, 18, 'answers', '263 answers from 18 students.'),
    cov(CO3, [{ questions: 0, answers: 0 }, { questions: 1, answers: 0 }], { questions: 1, answers: 4 }, 4, 'answers', '4 answers from 4 students.'),
    cov(CO4, [], { questions: 0, answers: 0 }, 0, 'none', 'No evidence: no topic or question is mapped to it yet.'),
    cov(CO5, [{ questions: 2, answers: 20 }], { questions: 0, answers: 0 }, 9, 'answers', '20 answers from 9 students.'),
  ],
  // 112 + 263 + 4 + 20 = 399 mapped; 6 kept out; 28 + 12 unmapped.
  answers: { counted: 445, mapped: 399, excluded: 6, unmapped: 40 },
  unmapped: [
    { contentId: UNIT3, chapter: chapterTitle(UNIT3), topic: 'Subnetting', inChapter: true, questions: 2, answers: 28 },
    { contentId: UNIT4, chapter: chapterTitle(UNIT4), topic: 'Ports and sockets', inChapter: false, questions: 0, answers: 12 },
  ],
  excluded: { questions: 0, answers: 6 },
  definitions: DEFINITIONS,
  privacy: PRIVACY,
};

const EMPTY = { ...LIST, outcomes: [], overrides: [] };
const EMPTY_COVERAGE = {
  ...COVERAGE,
  outcomes: [],
  answers: { counted: 366, mapped: 0, excluded: 0, unmapped: 366 },
  unmapped: [
    { contentId: UNIT4, chapter: chapterTitle(UNIT4), topic: 'Transmission Control Protocol', inChapter: true, questions: 4, answers: 132 },
    { contentId: UNIT4, chapter: chapterTitle(UNIT4), topic: 'User Datagram Protocol', inChapter: true, questions: 4, answers: 122 },
    { contentId: UNIT4, chapter: chapterTitle(UNIT4), topic: 'Transport layer services', inChapter: true, questions: 4, answers: 112 },
  ],
  excluded: { questions: 0, answers: 0 },
};

const COPY_REPLY = {
  copied: { outcomes: 3, topics: 5, overrides: 1 },
  skipped: {
    archivedOutcomes: 1,
    topics: [{ code: 'CO3', contentId: hex(0xf001), topic: 'Error detection', reason: 'that chapter was not found' }],
    overrides: [{ questionId: hex(0xf002), reason: 'the question has been deleted' }],
  },
  from: { id: '7922c0a1d4e5f60718293a4b', courseName: 'Computer Networks', section: 'CS-A', termLabel: 'Odd term 2025' },
  message: 'Copied 3 course outcomes with their mappings. Nothing is linked: a later change in either class does not change the other.',
};

const MAP_400 = `topics[3]: "Transport" is not a topic of "${chapterTitle(UNIT4)}". Its topics are: Transport layer services; User Datagram Protocol; Transmission Control Protocol; TCP connection establishment; Flow control and the sliding window; Congestion control; Reliable delivery; Ports and sockets.`;

/* -------------------------------------------------------- the pretend server */

const tidyCode = (code) => String(code ?? '').trim().replace(/\s+/g, ' ').toUpperCase();

function LiveOutcomes({ initial = LIST, coverage = COVERAGE, start }) {
  const [data, setData] = useState(initial);
  const now = useRef(data);
  now.current = data;
  const coverageOf = (id) => coverage.outcomes.find((o) => o.id === id);

  const inUse = (d) => d.outcomes.filter((o) => !o.archived);
  const ordered = (outs) => [...outs.filter((o) => !o.archived).sort((a, b) => a.position - b.position), ...outs.filter((o) => o.archived)];
  const commit = (next, extra = {}) => {
    const d = { ...next, outcomes: ordered(next.outcomes) };
    setData(d);
    return { ...extra, ...d };
  };
  const nextPos = (d) => d.outcomes.reduce((m, o) => Math.max(m, o.position), 0) + 1;
  const fields = ({ code, statement, targetLevel }, partial = false) => {
    const out = {};
    if (code !== undefined || !partial) {
      const c = tidyCode(code);
      if (!c) refuse('code is required: a short code such as CO1.', 400);
      if (c.length > 16) refuse('code may be at most 16 characters.', 400);
      out.code = c;
    }
    if (statement !== undefined || !partial) {
      const s = String(statement ?? '').trim().replace(/\s+/g, ' ');
      if (!s) refuse('statement is required.', 400);
      if (/\S+@\S+/.test(s)) refuse('statement holds an email address. A course outcome says what a student can do; it carries no contact details.', 400);
      out.statement = s;
    }
    if (targetLevel !== undefined) out.targetLevel = targetLevel || null;
    return out;
  };

  const on = {
    create: async (body) => {
      await wait(450);
      const d = now.current;
      const f = fields(body);
      if (inUse(d).length >= 50) refuse('This class already has 50 course outcomes, the most it may hold.', 409);
      if (inUse(d).some((o) => o.code === f.code)) refuse(`${f.code} is already a course outcome of this class.`, 409);
      const made = outcome(0, f.code, f.statement, f.targetLevel ?? null, [], { id: hex(0xe100 + d.outcomes.length), position: nextPos(d), createdAt: new Date().toISOString() });
      return commit({ ...d, outcomes: [...d.outcomes, made] }, { outcome: made });
    },
    update: async (id, patch) => {
      await wait(400);
      const d = now.current;
      const f = fields(patch, true);
      if (f.code && inUse(d).some((o) => o.id !== id && o.code === f.code)) refuse(`${f.code} is already a course outcome of this class.`, 409);
      const outs = d.outcomes.map((o) => (o.id === id ? { ...o, ...f, updatedAt: new Date().toISOString() } : o));
      return commit({ ...d, outcomes: outs }, { outcome: outs.find((o) => o.id === id) });
    },
    restore: async (id) => {
      await wait(400);
      const d = now.current;
      const o = d.outcomes.find((x) => x.id === id);
      if (inUse(d).length >= 50) refuse(`This class already has 50 course outcomes, the most it may hold. Archive one before restoring ${o.code}.`, 409);
      if (inUse(d).some((x) => x.code === o.code)) refuse(`${o.code} is already a course outcome of this class.`, 409);
      const outs = d.outcomes.map((x) => (x.id === id ? { ...x, archived: false, archivedAt: null, position: nextPos(d) } : x));
      return commit({ ...d, outcomes: outs }, { outcome: outs.find((x) => x.id === id) });
    },
    reorder: async (ids) => {
      await wait(300);
      const d = now.current;
      return commit({ ...d, outcomes: d.outcomes.map((o) => (o.archived ? o : { ...o, position: ids.indexOf(o.id) + 1 })) });
    },
    remove: async (id) => {
      await wait(500);
      const d = now.current;
      const o = d.outcomes.find((x) => x.id === id);
      const ev = coverageOf(id);
      if (ev && ev.answers > 0) {
        const outs = d.outcomes.map((x) => (x.id === id ? { ...x, archived: true, archivedAt: new Date().toISOString() } : x));
        return commit({ ...d, outcomes: outs }, {
          removed: 'archived',
          evidence: { answers: ev.answers, students: ev.students },
          message: `${o.code} has ${ev.answers} answer${ev.answers === 1 ? '' : 's'} from ${ev.students} student${ev.students === 1 ? '' : 's'} mapped to it, so it was archived, not deleted: its mappings and evidence are kept, and later reports still name it. Restore it with { "archived": false }.`,
        });
      }
      const n = o.topics.length;
      return commit({ ...d, outcomes: d.outcomes.filter((x) => x.id !== id) }, {
        removed: 'deleted', outcome: o, topicsRemoved: n, overridesChanged: { narrowed: [], removed: [] },
        message: `${o.code} had no answers mapped to it, so it was deleted with its ${n} topic mapping${n === 1 ? '' : 's'}.`,
      });
    },
    mapTopics: async (id, topics) => {
      await wait(500);
      const d = now.current;
      const links = topics.map((t, i) => {
        const known = knownOf(t.contentId);
        if (!known) refuse(`That chapter (topics[${i}]) was not found.`, 404);
        const spelled = known.find((k) => k.toLowerCase() === String(t.topic).trim().toLowerCase());
        if (!spelled) refuse(`topics[${i}]: "${t.topic}" is not a topic of "${chapterTitle(t.contentId)}". Its topics are: ${known.join('; ')}.`, 400);
        const inList = CHAPTERS.find((c) => c.id === t.contentId).topics.some((k) => k.toLowerCase() === spelled.toLowerCase());
        return link(t.contentId, spelled, t.weight ?? 1, inList);
      });
      const outs = d.outcomes.map((o) => (o.id === id ? { ...o, topics: links } : o));
      return commit({ ...d, outcomes: outs }, { outcome: outs.find((o) => o.id === id) });
    },
    override: async (questionId, body) => {
      await wait(450);
      const d = now.current;
      const qn = CHAPTERS.flatMap((c) => c.questions.map((x) => ({ ...x, contentId: c.id, chapter: c.title }))).find((x) => x.id === questionId);
      if (!qn) refuse('That question was not found.', 404);
      const row = {
        questionId,
        excluded: body.exclude === true,
        outcomes: body.exclude ? [] : body.outcomeIds.map((oid) => { const o = d.outcomes.find((x) => x.id === oid); return { id: oid, code: o.code, archived: o.archived }; }),
        question: { text: qn.text, topic: qn.topic, level: qn.level, kind: qn.kind, status: qn.status, contentId: qn.contentId, chapter: qn.chapter },
        updatedAt: new Date().toISOString(),
      };
      const rest = d.overrides.filter((x) => x.questionId !== questionId);
      return commit({ ...d, overrides: [...rest, row] });
    },
    clearOverride: async (questionId) => {
      await wait(400);
      const d = now.current;
      return commit({ ...d, overrides: d.overrides.filter((x) => x.questionId !== questionId) }, {
        removed: true, questionId, message: 'The question follows its topic\'s course outcomes again.',
      });
    },
    copy: async (fromClassId) => {
      await wait(700);
      const d = now.current;
      const wanted = [CO1, CO2, CO3];
      const clash = wanted.filter((w) => inUse(d).some((o) => o.code === w.code)).map((w) => w.code);
      if (clash.length) {
        refuse(`This class already has ${clash.join(', ')}. Nothing was copied: rename or remove ${clash.length === 1 ? 'it' : 'them'} here first.`, 409);
      }
      let pos = nextPos(d);
      const made = wanted.map((w, i) => ({ ...w, id: hex(0xe200 + i), position: pos++, createdAt: new Date().toISOString() }));
      return commit({ ...d, outcomes: [...d.outcomes, ...made] }, { ...COPY_REPLY, from: { ...COPY_REPLY.from, id: fromClassId } });
    },
    exportCsv: async () => { await wait(600); return 'bloomloop-outcomes-computer-networks-cs-a-2026-11-19.csv'; },
    reload: () => {},
    reloadCoverage: () => {},
  };

  return (
    <ClassFrame canEdit={data.canEdit}>
      <OutcomesView data={listOf(data)} coverage={{ data: coverage, loading: false, error: '' }} classId={CLASS.id} source={SOURCE} on={on} start={start} />
    </ClassFrame>
  );
}

/** The class page around the tab, as account/Classes.jsx draws it. */
function ClassFrame({ canEdit = true, children }) {
  return (
    <AccountShell
      current="classes"
      crumb={<><Link to="/classes" className="cl-crumb">Classes</Link><span aria-hidden="true">/</span><span className="clip">{CLASS.section}</span></>}
      title={CLASS.courseName}
      sub={`${CLASS.section} · ${CLASS.termLabel} · 25 students on the roster`}
    >
      <div className="cl-viewbar">
        <Segmented
          label="Class view"
          value="outcomes"
          onChange={() => {}}
          options={[
            { id: 'roster', label: 'Roster', count: 25 },
            { id: 'rooms', label: 'Across rooms', count: 5 },
            { id: 'outcomes', label: 'Outcomes' },
            { id: 'attainment', label: 'Attainment' },
            { id: 'register', label: 'Marks register' },
          ]}
        />
        {!canEdit && <span className="cl-ro"><Icon name="eye" />Read only: changes belong to the professor who keeps this class.</span>}
      </div>
      {children}
    </AccountShell>
  );
}

/** Fifty in use, so a restore meets the cap. */
const AT_CAP = {
  ...LIST,
  outcomes: [
    ...Array.from({ length: 50 }, (_, i) => outcome(100 + i, `CO${i + 1}`, i < 4 ? [CO1, CO2, CO3, CO4][i].statement : `Course outcome ${i + 1} of the programme’s list.`, null, i < 4 ? [CO1, CO2, CO3, CO4][i].topics : [], { position: i + 1 })),
    { ...CO5, code: 'CO51' },
  ],
  overrides: [],
};
const CAP_409 = 'This class already has 50 course outcomes, the most it may hold. Archive one before restoring CO51.';

export default [
  {
    id: 'outcomes-list', title: 'Course outcomes: the list and coverage', role: 'professor',
    note: 'In order, archived last; a renamed topic on CO2; coverage adding up, with what reaches no outcome; questions mapped one by one, one of them deleted.',
    render: () => <LiveOutcomes />,
  },
  {
    id: 'outcomes-empty', title: 'Course outcomes: none yet', role: 'professor',
    note: 'Add one or copy them; every counted answer reaches no outcome until then.',
    render: () => <LiveOutcomes initial={EMPTY} coverage={EMPTY_COVERAGE} />,
  },
  {
    id: 'outcomes-adding', title: 'Course outcomes: adding one', role: 'professor',
    render: () => <LiveOutcomes start={{ adding: true }} />,
  },
  {
    id: 'outcomes-mapping', title: 'Course outcomes: mapping topics to one outcome', role: 'professor',
    note: 'The editor opens under CO2: its topics with their weights, a renamed one marked, and a chapter’s topics to tick.',
    render: () => <LiveOutcomes start={{ editing: CO2.id, tab: 'topics' }} />,
  },
  {
    id: 'outcomes-map-400', title: 'Course outcomes: a topic the chapter does not carry', role: 'professor',
    note: 'The 400 as the server words it, listing the chapter’s topics.',
    render: () => <LiveOutcomes start={{ editing: CO2.id, tab: 'topics', mapError: MAP_400 }} />,
  },
  {
    id: 'outcomes-details', title: 'Course outcomes: changing the details', role: 'professor',
    render: () => <LiveOutcomes start={{ editing: CO1.id, tab: 'details' }} />,
  },
  {
    id: 'outcomes-archived', title: 'Course outcomes: removed with evidence, so archived', role: 'professor',
    note: 'The reply’s message as it comes; CO5 sits apart and can be restored.',
    render: () => (
      <LiveOutcomes start={{ notice: 'CO5 has 20 answers from 9 students mapped to it, so it was archived, not deleted: its mappings and evidence are kept, and later reports still name it. Restore it with { "archived": false }.' }} />
    ),
  },
  {
    id: 'outcomes-cap', title: 'Course outcomes: restoring at the cap of 50', role: 'professor',
    note: 'The 409 under the archived outcome, as the server words it.',
    render: () => <LiveOutcomes initial={AT_CAP} start={{ rowError: { id: CO5.id, message: CAP_409 } }} />,
  },
  {
    id: 'outcomes-override', title: 'Course outcomes: mapping one question', role: 'professor',
    note: 'Pick a chapter and a question, then its outcomes in place of its topic’s, or none.',
    render: () => <LiveOutcomes start={{ override: 'new' }} />,
  },
  {
    id: 'outcomes-override-change', title: 'Course outcomes: changing a question’s override', role: 'professor',
    render: () => <LiveOutcomes start={{ override: routingQ.id }} />,
  },
  {
    id: 'outcomes-copy', title: 'Course outcomes: copying from another class', role: 'professor',
    render: () => <LiveOutcomes initial={EMPTY} coverage={EMPTY_COVERAGE} start={{ copy: true }} />,
  },
  {
    id: 'outcomes-copied', title: 'Course outcomes: what was copied', role: 'professor',
    note: 'Counts copied, and what was not, each with the server’s reason.',
    render: () => <LiveOutcomes start={{ copy: COPY_REPLY }} />,
  },
  {
    id: 'outcomes-hod', title: 'Course outcomes: read only', role: 'hod',
    note: 'A head of department reads the outcomes, their mappings and coverage, and can export the CSV.',
    render: () => <LiveOutcomes initial={{ ...LIST, canEdit: false }} />,
  },
  {
    id: 'outcomes-loading', title: 'Course outcomes: loading', role: 'professor',
    render: () => <ClassFrame><OutcomesView loading /></ClassFrame>,
  },
  {
    id: 'outcomes-not-found', title: 'Course outcomes: not found', role: 'professor',
    render: () => <ClassFrame><OutcomesView data={null} notFound error="That class was not found." on={{ reload: () => {} }} /></ClassFrame>,
  },
];
