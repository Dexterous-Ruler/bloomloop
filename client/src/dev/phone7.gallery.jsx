/**
 * The student's phone in Phase 7, stage "Next": the question pack answered
 * offline, the server's final replies (marked, kept and not counted, refused),
 * and a closed room taking what the phone kept. Each is the real component in
 * the real frame, handed the shapes and sentences the server sends
 * (server/src/services/offline.js, docs/OFFLINE_SELECTION.md). Development
 * only, like every gallery file.
 */

import { useState } from 'react';

import Finish from '../learn/Finish.jsx';
import Question from '../learn/Question.jsx';
import { Climb, Conn, Dock, DockSlot, Kept, Offline } from '../learn/parts.jsx';
import { Button, Ladder, Mark, Note } from '../ui/index.jsx';

const noop = () => {};

/** LearnApp's frame: bar (with the offline line), climb, page and dock slot. */
function Phone({ view = 'question', level = 'apply', offline = false, noWorker = false, children }) {
  const [dock, setDock] = useState(null);
  return (
    <DockSlot.Provider value={dock}>
      <div className="learn" data-view={view}>
        <header className="ln-bar">
          <div className="ln-bar-in">
            <Mark size={30} />
            <span className="ln-room"><b>K7Q42M</b></span>
            <span className="ln-who">CSF042</span>
            <span className="push"><Conn status={offline ? 'offline' : 'online'} /></span>
            {view === 'question' && <Button variant="ghost" size="sm">Not me</Button>}
          </div>
          {offline && <Offline noWorker={noWorker} />}
        </header>
        {view === 'question' && <Climb level={level} />}
        <main className="ln-page" data-view={view}>{children}</main>
        <footer className="ln-dock" ref={setDock} />
      </div>
    </DockSlot.Provider>
  );
}

/* What the server says, as it says it. */
const PACK_NOTE = 'Questions to work on if your connection drops. Answers you give offline are saved on this phone and marked when you reconnect.';
const PACK_EMPTY_NOTE = 'There are no more questions to keep on this phone for now.';
const NOTHING_LEFT = 'There is nothing more to answer until you reconnect. Your answers are saved on this phone.';
const LATE_COUNTED = 'The room had closed, but you had this question before it closed, so your answer is marked and counts.';
const LATE_TOO_LATE = 'This answer reached your teacher more than 10 minutes after the room closed, so it is saved but does not count.';
const ANSWERED_AGAIN = 'You had already answered this question and been marked on it, so this answer is saved but does not count.';
const ASKED_KEPT = 'This question was put to the whole class, so your own answer to it is saved but does not count.';
const NOT_THIS_ROOM = 'That question is not one this room asks, so the answer was not taken.';
const DELIVER = 'This room has closed. Answers saved on this phone are being sent; there are no new questions.';
const DELIVER_IMPORTED = 'This room was run on your teacher\'s laptop and has since been brought online from there, so it takes no more answers here. Anything still saved on this phone stays here; show it to your teacher if it matters.';

const PROV = { by: 'ai', checked: true, text: 'Written with AI help and checked by your professor.' };

/** The question on screen when the connection dropped. */
const LIVE = {
  _id: 'live-q',
  kind: 'mcq',
  bloom: 'apply',
  topic: 'Routing',
  provenance: PROV,
  text: 'A packet for 10.0.3.7 reaches a router whose table holds 10.0.0.0/8 and 10.0.3.0/24. Which route does it take?',
  options: ['10.0.0.0/8, the first match', '10.0.3.0/24, the longest prefix', 'Neither: it is dropped', 'Both, as two copies'],
};

/* A pack of five, as server:pack sends it: each question through
   forStudent() (no key), with its own reason sentence. */
const PACK = [
  {
    question: { _id: 'pk-1', kind: 'mcq', bloom: 'apply', topic: 'Routing', provenance: PROV, text: 'A router has no route for a packet and no default route. What does it do with the packet?', options: ['Sends it back', 'Drops it and may send an ICMP message', 'Floods every port', 'Holds it until a route appears'] },
    reason: 'Your next questions are at Apply, from your last 4 answers there.',
  },
  {
    question: { _id: 'pk-2', kind: 'truefalse', bloom: 'understand', topic: 'Layers', provenance: PROV, text: 'A switch forwards frames by looking at IP addresses.' },
    reason: 'This question is at Understand, the level before the one you are working at.',
  },
  {
    question: {
      _id: 'pk-3',
      kind: 'mcq',
      bloom: 'apply',
      topic: 'Topologies',
      provenance: PROV,
      stimulus: {
        kind: 'image',
        // In the room this is /api/media/<id>, kept in the phone's cache while online.
        url: 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="140" viewBox="0 0 320 140"><rect width="320" height="140" fill="#eef3ee"/><g stroke="#2f5d46" stroke-width="2" fill="#fff"><circle cx="160" cy="70" r="16"/><circle cx="60" cy="30" r="12"/><circle cx="60" cy="110" r="12"/><circle cx="260" cy="30" r="12"/><circle cx="260" cy="110" r="12"/><path d="M72 34 144 64M72 106 144 76M248 34 176 64M248 106 176 76"/></g></svg>'),
        alt: 'Four computers, each joined by its own cable to one device in the middle.',
      },
      text: 'Which topology does the picture show?',
      options: ['Bus', 'Ring', 'Star', 'Mesh'],
    },
    reason: 'Your next questions are at Apply, from your last 4 answers there.',
  },
  {
    question: { _id: 'pk-4', kind: 'mcq', bloom: 'apply', topic: 'Addressing', provenance: PROV, text: 'How many usable host addresses does a /26 subnet have?', options: ['62', '64', '30', '126'] },
    reason: 'Your next questions are at Apply, from your last 4 answers there.',
  },
  {
    question: { _id: 'pk-5', kind: 'mcq', bloom: 'analyse', topic: 'Routing', provenance: PROV, text: 'Two routes reach the same network: one has fewer hops, the other a faster link. Why might a link-state protocol prefer the second?', options: ['It counts hops only', 'It weighs each link by its cost', 'It picks at random', 'It always prefers the newest route'] },
    reason: 'This question is at Analyse, the next level up, ready in case your answers move you on.',
  },
];

/* A question with a formula and a fenced Python block, and the `rich` the
   server sends with it (services/richText.js phoneRich, run on this sample):
   MathML, and shiki's HTML with both themes. */
const RICH_Q = {
  _id: 'rich-q',
  kind: 'mcq',
  bloom: 'apply',
  topic: 'Recursion',
  provenance: { by: 'professor', checked: true, text: 'Written by your professor.' },
  text: "For $n \\geq 0$, what does `f(3)` return?\n```python\ndef f(n):\n    if n == 0:\n        return 0\n    return n + f(n - 1)\n```",
  options: ["$6$", "$3$", "$0$", "It never returns"],
  rich: {"text": "For <math><mrow><mi>n</mi><mo>≥</mo><mn>0</mn></mrow></math>, what does `f(3)` return?<pre class=\"shiki shiki-themes github-light github-dark\" style=\"background-color:#fff;--shiki-dark-bg:#24292e;color:#24292e;--shiki-dark:#e1e4e8\" tabindex=\"0\"><code><span class=\"line\"><span style=\"color:#D73A49;--shiki-dark:#F97583\">def</span><span style=\"color:#6F42C1;--shiki-dark:#B392F0\"> f</span><span style=\"color:#24292E;--shiki-dark:#E1E4E8\">(n):</span></span>\n<span class=\"line\"><span style=\"color:#D73A49;--shiki-dark:#F97583\">    if</span><span style=\"color:#24292E;--shiki-dark:#E1E4E8\"> n </span><span style=\"color:#D73A49;--shiki-dark:#F97583\">==</span><span style=\"color:#005CC5;--shiki-dark:#79B8FF\"> 0</span><span style=\"color:#24292E;--shiki-dark:#E1E4E8\">:</span></span>\n<span class=\"line\"><span style=\"color:#D73A49;--shiki-dark:#F97583\">        return</span><span style=\"color:#005CC5;--shiki-dark:#79B8FF\"> 0</span></span>\n<span class=\"line\"><span style=\"color:#D73A49;--shiki-dark:#F97583\">    return</span><span style=\"color:#24292E;--shiki-dark:#E1E4E8\"> n </span><span style=\"color:#D73A49;--shiki-dark:#F97583\">+</span><span style=\"color:#24292E;--shiki-dark:#E1E4E8\"> f(n </span><span style=\"color:#D73A49;--shiki-dark:#F97583\">-</span><span style=\"color:#005CC5;--shiki-dark:#79B8FF\"> 1</span><span style=\"color:#24292E;--shiki-dark:#E1E4E8\">)</span></span></code></pre>", "options": ["<math><mn>6</mn></math>", "<math><mn>3</mn></math>", "<math><mn>0</mn></math>", "It never returns"]},
};

const item = (q, i) => ({ question: q.question, reason: q.reason, index: 0, tag: `Offline ${i + 1}/${PACK.length}` });

const ask = (it, extra = {}) => (
  <Question
    item={it}
    result={null}
    awaiting={false}
    sent={null}
    level="apply"
    trail={['understand', 'apply', 'apply', 'apply']}
    auto={false}
    onSubmit={noop}
    onNext={noop}
    {...extra}
  />
);

const held = (answerId, label) => ({ answerId, label, status: 'queued' });

const SCREENS = [
  {
    id: 'phone7-live-held',
    title: 'Offline: the question on screen answered, on to the pack',
    note: 'The answer waits in the outbox, labelled as such. With a pack on this phone, Next question opens the first packed question; nothing says right or wrong.',
    el: <Phone offline>{ask({ question: LIVE, index: 7, reason: 'Your next questions are at Apply, from your last 4 answers there.' }, { sent: 1, save: { state: 'held' }, onward: noop })}</Phone>,
  },
  {
    id: 'phone7-packed',
    title: 'Offline: a packed question',
    note: 'The pack’s own sentence at the top, its place in the pack for a number, and the reason sentence the server sent with this question.',
    el: (
      <Phone offline level="apply">
        <div className="ln-notes"><Note icon="info" role="status">{PACK_NOTE}</Note></div>
        <Kept items={[held('a0', LIVE.text)]} offline />
        {ask(item(PACK[1], 1))}
      </Phone>
    ),
  },
  {
    id: 'phone7-packed-image',
    title: 'Offline: a packed question with a picture',
    note: 'The picture was kept in the phone’s cache when the pack arrived, so it draws with the network down.',
    el: <Phone offline>{ask(item(PACK[2], 2), { sent: 2, save: { state: 'held' }, onward: noop })}</Phone>,
  },
  {
    id: 'phone7-packed-saved',
    title: 'Offline: packed answers saved, one go each',
    note: 'Each answer: “Saved, will be marked when you reconnect”. The one on screen is locked; the earlier ones are listed.',
    el: (
      <Phone offline>
        <Kept items={[held('a0', LIVE.text), held('a1', PACK[0].question.text), held('a2', PACK[1].question.text)]} offline />
        {ask(item(PACK[3], 3), { sent: 0, save: { state: 'held' }, onward: noop })}
      </Phone>
    ),
  },
  {
    id: 'phone7-pack-done',
    title: 'Offline: the pack used up',
    note: 'Stopped at the end of the pack (or its expiry). No Next question: there is nothing more until the connection is back.',
    el: (
      <Phone offline level="apply">
        <div className="ln-notes"><Note icon="info" role="status">{NOTHING_LEFT}</Note></div>
        <Kept items={[held('a0', LIVE.text), ...PACK.slice(0, 4).map((q, i) => held(`a${i + 1}`, q.question.text))]} offline />
        {ask(item(PACK[4], 4), { sent: 1, save: { state: 'held' } })}
      </Phone>
    ),
  },
  {
    id: 'phone7-pack-empty',
    title: 'Offline: the server sent no pack',
    note: 'server:pack with no questions: its note, said once there is nothing left to answer. Nothing was kept.',
    el: (
      <Phone offline>
        <div className="ln-notes"><Note icon="info" role="status">{PACK_EMPTY_NOTE}</Note></div>
        {ask({ question: LIVE, index: 12, reason: '' }, { sent: 1, save: { state: 'held' } })}
      </Phone>
    ),
  },
  {
    id: 'phone7-no-worker',
    title: 'Offline on plain http over the hall Wi-Fi',
    note: 'Not a secure context: no service worker, so a reload with the network down cannot open the page. The offline line says so, once.',
    el: <Phone offline noWorker>{ask({ question: LIVE, index: 7, reason: '' }, { sent: 1, save: { state: 'held' }, onward: noop })}</Phone>,
  },
  {
    id: 'phone7-resume-pack',
    title: 'Reopened offline, with a pack on this phone',
    note: 'A reload with no network: the outbox is listed, and the questions kept here can be answered before the connection comes back.',
    el: (
      <Phone view="resume" offline>
        <div className="ln-seek" aria-hidden="true"><Ladder size={56} /></div>
        <div className="ln-card">
          <span className="eyebrow">Picking you back up</span>
          <h1 className="ln-text">You are already in room <span className="mono">K7Q42M</span>.</h1>
          <p className="t-lead">
            You are in as <span className="mono">CSF042</span>. Your level and the question you were on are held by the
            server, and any answer not yet sent is kept on this phone, so closing the tab lost nothing. This is the
            session you left, not a new one.
          </p>
        </div>
        <Kept items={[held('a0', LIVE.text)]} offline />
        <Dock>
          <div className="stack stack-2">
            <Button variant="primary" size="xl" block>Answer the questions kept on this phone</Button>
            <Button size="xl" block icon="logout">Not me, join as someone else</Button>
          </div>
        </Dock>
      </Phone>
    ),
  },
  {
    id: 'phone7-settled',
    title: 'Back online: each answer settled by its answerId',
    note: 'Marked; kept and not counted (server:kept, its sentence, never a mark); refused for good (server:refused, kept here, never sent again); one still sending.',
    el: (
      <Phone>
        <Kept
          flying="s5"
          items={[
            { answerId: 's1', label: LIVE.text, status: 'marked' },
            { answerId: 's2', label: PACK[0].question.text, status: 'marked' },
            { answerId: 's3', label: PACK[1].question.text, status: 'sent', counted: false, note: ANSWERED_AGAIN },
            { answerId: 's4', label: PACK[2].question.text, status: 'refused', note: NOT_THIS_ROOM },
            { answerId: 's5', label: PACK[3].question.text, status: 'queued' },
          ]}
        />
        {ask({ question: { ...PACK[4].question }, index: 13, reason: PACK[4].reason })}
      </Phone>
    ),
  },
  {
    id: 'phone7-kept-live',
    title: 'The answer on screen kept, not counted',
    note: 'server:kept for the question on screen (it was put to the class meanwhile): the sentence under it, no verdict, and the way on.',
    el: <Phone>{ask({ question: LIVE, index: 7, reason: '' }, { sent: 2, save: { state: 'uncounted', note: ASKED_KEPT }, onward: noop })}</Phone>,
  },
  {
    id: 'phone7-deliver',
    title: 'Closed room: sending what this phone kept',
    note: 'session:accepted with deliverOnly: the server’s sentence and until when an answer to a question given before the close counts. Each answer as it goes; one marked late with its sentence.',
    el: (
      <Phone view="done">
        <Note icon="send" role="status">
          {DELIVER} An answer to a question you were given before it closed counts if it reaches your teacher by 10:42 am; after that it is saved but does not count.
        </Note>
        <Kept
          flying="d3"
          items={[
            { answerId: 'd1', label: LIVE.text, status: 'marked', note: LATE_COUNTED },
            { answerId: 'd2', label: PACK[0].question.text, status: 'marked', note: LATE_COUNTED },
            { answerId: 'd3', label: PACK[1].question.text, status: 'queued' },
            { answerId: 'd4', label: PACK[2].question.text, status: 'queued' },
          ]}
        />
        <Finish
          ending="closed"
          onLeave={noop}
          profile={{ workingLevel: 'apply', total: { seen: 9, correct: 6 }, levels: { remember: { seen: 2, correct: 2 }, understand: { seen: 3, correct: 2 }, apply: { seen: 4, correct: 2 } } }}
        />
      </Phone>
    ),
  },
  {
    id: 'phone7-deliver-late',
    title: 'Closed room, after the 10 minutes',
    note: 'Still let in to send, at any time while the room exists. Said plainly: saved, does not count. No mark on any of them.',
    el: (
      <Phone view="done">
        <Note icon="send" role="status">
          {DELIVER} It is more than 10 minutes since it closed, so these answers are saved but do not count.
        </Note>
        <Kept
          items={[
            { answerId: 'l1', label: LIVE.text, status: 'sent', counted: false, note: LATE_TOO_LATE },
            { answerId: 'l2', label: PACK[0].question.text, status: 'sent', counted: false, note: LATE_TOO_LATE },
          ]}
        />
        <Finish ending="closed" onLeave={noop} profile={{ workingLevel: 'apply', total: { seen: 7, correct: 5 }, levels: { apply: { seen: 4, correct: 3 } } }} />
      </Phone>
    ),
  },
  {
    id: 'phone7-deliver-refused',
    title: 'Closed room that will not take them',
    note: 'A deliver join refused (here, a room brought in from a laptop): nothing is sent or deleted; every answer stays on this phone, shown, for the teacher.',
    el: (
      <Phone view="done">
        <Finish ending="kept" led={{ tag: 'Kept on this phone', title: 'Show these answers to your teacher', message: DELIVER_IMPORTED }} onLeave={noop} />
        <Kept
          items={[
            { answerId: 'r1', label: LIVE.text, status: 'refused' },
            { answerId: 'r2', label: PACK[0].question.text, status: 'refused' },
          ]}
        />
      </Phone>
    ),
  },
  {
    id: 'phone7-rich',
    title: 'A formula and a code block (question.rich)',
    note: 'The server’s HTML drawn as given: MathML for the formula and the options, shiki’s highlighting for the code, with its dark colours in the dark theme. The plain fields stay for answering and aria labels.',
    el: <Phone>{ask({ question: RICH_Q, index: 4, reason: 'Your next questions are at Apply, from your last 4 answers there.' })}</Phone>,
  },
  {
    id: 'phone7-rich-packed',
    title: 'Offline: a packed question with a formula and code',
    note: 'Packed questions carry `rich` too; the outbox label above it uses the same HTML.',
    el: (
      <Phone offline>
        <Kept items={[{ answerId: 'x1', label: RICH_Q.text, html: RICH_Q.rich.text, status: 'queued' }]} offline />
        {ask({ question: RICH_Q, index: 0, tag: 'Offline 2/5', reason: 'This question is at Apply, the level you are working at.' }, { sent: 0, save: { state: 'held' }, onward: noop })}
      </Phone>
    ),
  },
];

export default SCREENS.map(({ el, ...entry }) => ({ ...entry, role: null, render: () => el }));
