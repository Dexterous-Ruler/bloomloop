/**
 * Batch 9 (E4): the drawing kind on the phone, and a drawing answer in the
 * console's review. Development only, like every gallery file.
 *
 * The phone entries go through the real path (Question, Answer's lazy
 * dispatch, learn/drawing/), with the outbox's report on the answer standing
 * in for the room: stored and waiting for the professor, refused, or held
 * offline. Strokes are drawn by dispatching real pointer events at the board,
 * so what shows is what a finger or stylus would leave.
 */

import { useEffect, useRef, useState } from 'react';

import { ReviewScreen } from '../account/Review.jsx';
import { toPicture } from '../learn/drawing/ink.js';
import Question from '../learn/Question.jsx';
import { Conn, DockSlot } from '../learn/parts.jsx';
import { Button, Mark } from '../ui/index.jsx';

const noop = () => {};

/* ------------------------------------------------------------- sample */

const QUESTION = {
  _id: 'draw-fbd-q',
  kind: 'drawing',
  bloom: 'apply',
  text: 'A block rests on a rough slope without moving. Draw the forces acting on it, and say in a line which one stops it sliding.',
};

/* A block on a slope, its three forces in green: in the unit square. */
const D = [0.877, -0.48];
const N = [-0.48, -0.877];
const C = [0.462, 0.52];
const at = (p, v, k) => [p[0] + v[0] * k, p[1] + v[1] * k];
const arrow = (from, dir, len) => {
  const end = at(from, dir, len);
  const back = at(end, dir, -0.035);
  const side = [-dir[1], dir[0]];
  return [[from, end], [at(back, side, 0.025), end, at(back, side, -0.025)]];
};
const SLOPE = [[[0.08, 0.82], [0.92, 0.82], [0.92, 0.36], [0.08, 0.82]]];
const BLOCK = [[[0.421, 0.633], [0.579, 0.547], [0.502, 0.407], [0.344, 0.493], [0.421, 0.633]]];
const FORCES = [...arrow(C, [0, 1], 0.24), ...arrow(C, N, 0.2), ...arrow(C, D, 0.2)];

/** The same picture as ink.js entries, for the review's stand-in upload. */
const entriesOf = (lines, color, w) => lines.map((pts) => ({ tool: 'pen', color, pts: pts.map(([x, y]) => [x, y, w]) }));
const PICTURE = [
  ...entriesOf(SLOPE, '#1F2A24', 0.012),
  ...entriesOf(BLOCK, '#1F2A24', 0.012),
  ...entriesOf(FORCES, '#2F6B4F', 0.012),
];

/* ------------------------------------------------------------- the phone */

/* What the room does with the answer once the phone has it, as the phone's
   outbox reports it to the question (learn/LearnApp.jsx): stored and waiting
   for the professor, refused for good with the server's sentence, or held on
   the phone while offline. */
const AWAITING = {
  correct: null, score: null, provisional: true, awaitingReview: true, solution: null, kind: 'drawing',
  note: 'Your drawing is saved. Your professor will look at it and mark it; until then it does not count either way.',
  detail: 'waits for your professor', levelChanged: false,
};
const LAPTOP = 'Drawings cannot be taken in a room run on a laptop, so this one was not saved. It is still on your device: show it to your professor.';

/** Draws one polyline on the board with real pointer events. */
function stroke(canvas, pts, { type = 'pen', pressure = 0.55 } = {}) {
  const r = canvas.getBoundingClientRect();
  const fire = (name, [x, y], p) => canvas.dispatchEvent(new PointerEvent(name, {
    bubbles: true, cancelable: true, pointerId: 7, pointerType: type, isPrimary: true, button: 0,
    pressure: p, clientX: r.left + x * r.width, clientY: r.top + y * r.width,
  }));
  fire('pointerdown', pts[0], pressure);
  for (let i = 1; i < pts.length; i += 1) {
    const [a, b] = [pts[i - 1], pts[i]];
    const steps = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.01));
    for (let k = 1; k <= steps; k += 1) {
      const t = k / steps;
      fire('pointermove', [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], pressure + 0.25 * Math.sin(Math.PI * t));
    }
  }
  fire('pointerup', pts[pts.length - 1], 0);
}

/** Once the lazy board is on screen: draw, type and send, as `script` says. */
function useScript(ref, script) {
  const did = useRef(false);
  useEffect(() => {
    if (!script || did.current) return undefined;
    let tries = 0;
    const t = setInterval(() => {
      const root = ref.current;
      const canvas = root?.querySelector('.dw-canvas');
      tries += 1;
      if (tries > 100) clearInterval(t);
      if (!canvas || !canvas.getBoundingClientRect().width) return;
      clearInterval(t);
      did.current = true;
      const click = (sel) => root.querySelector(sel)?.click();
      if (script.draw) {
        SLOPE.concat(BLOCK).forEach((pts) => stroke(canvas, pts, { type: 'mouse', pressure: 0.5 }));
        click('button[aria-label="Green pen"]');
        // React re-renders before the next stroke picks the colour up.
        setTimeout(() => {
          FORCES.forEach((pts) => stroke(canvas, pts));
          if (script.text) {
            const box = root.querySelector('.dw-text');
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box, script.text);
            box.dispatchEvent(new Event('input', { bubbles: true }));
          }
          if (script.send) setTimeout(() => click('.ln-dock button'), 60);
        }, 60);
      }
    }, 50);
    return () => clearInterval(t);
  }, [ref, script]);
}

/** The phone frame from LearnApp: bar, page and the dock slot, in a room. */
function Phone({ mode = 'store', script = null, question = QUESTION }) {
  const [dock, setDock] = useState(null);
  const [sent, setSent] = useState(null);
  const [result, setResult] = useState(null);
  const ref = useRef(null);
  useScript(ref, script);
  const [refused, setRefused] = useState(false);
  const submit = (response) => {
    setSent(response);
    if (mode === 'store') setTimeout(() => setResult(AWAITING), 900);
    // Refused on screen: the board opens again with the sentence under it.
    if (mode === 'refuse') setTimeout(() => { setSent(null); setRefused(true); }, 900);
  };
  const save = refused ? { state: 'again', note: LAPTOP }
    : !sent ? null
      : mode === 'offline' ? { state: 'held', note: '' }
        : { state: result ? 'sent' : 'sending', note: '' };
  return (
    <DockSlot.Provider value={dock}>
      <div className="learn" data-view="question" ref={ref}>
        <header className="ln-bar">
          <div className="ln-bar-in">
            <Mark size={30} />
            <span className="ln-room"><b>K7Q42M</b></span>
            <span className="ln-who">CSF042</span>
            <span className="push"><Conn status={mode === 'offline' ? 'offline' : 'online'} /></span>
            <Button variant="ghost" size="sm">Not me</Button>
          </div>
        </header>
        <main className="ln-page" data-view="question">
          <Question
            item={{ question, index: 4, reason: '' }}
            result={result} awaiting={false} sent={sent} level="apply"
            trail={['understand', 'apply', 'apply', 'apply']} auto={false}
            save={save}
            onSubmit={submit} onNext={noop}
          />
        </main>
        <footer className="ln-dock" ref={setDock} />
      </div>
    </DockSlot.Provider>
  );
}

const WORDS = 'Friction acts up the slope and balances the part of the weight along it.';

/* ------------------------------------------------------------- the review */

const minsAgo = (m) => new Date(Date.now() - m * 60000).toISOString();
const ROOM = { code: 'MEC3PL', title: 'Forces on an incline', status: 'open' };
/* GET /api/review's shape for a drawing (batch 9): kindLabel, the picture as drawing { mediaId, url }, the words as text. */
const reviewItem = (n, name, response) => ({
  answerId: `dw${String(n).padStart(22, '0')}`,
  room: { ...ROOM },
  student: { rollNo: `22ME0${n}`, name },
  topic: 'Friction',
  bloom: 'apply',
  kind: 'drawing',
  kindLabel: 'Draw your answer',
  drawing: response.mediaId ? { mediaId: response.mediaId, url: `/api/media/${response.mediaId}` } : null,
  text: response.text ?? '',
  question: {
    id: 'fbd1', text: QUESTION.text, modelAnswer: null,
    rubric: ['weight drawn straight down', 'normal force at right angles to the slope', 'friction up the slope', 'names friction as what stops it'],
  },
  response,
  autoCorrect: null, autoScore: null, autoDetail: 'waits for your professor', correct: null, score: null,
  reviewStatus: 'provisional', reviewedBy: null, reviewedAt: null, reviewNote: '',
  attempt: 1, servedAt: minsAgo(20 + n * 3), answeredAt: minsAgo(17 + n * 3),
});
const ITEMS = [
  reviewItem(1, 'Asha Rao', { mediaId: '6a1f3c0e9b2d4f7a8c5e1b30', text: WORDS }),
  reviewItem(2, 'Kabir Mehta', { mediaId: '6a1f3c0e9b2d4f7a8c5e1b31', text: '' }),
  reviewItem(3, 'Tara Menon', { mediaId: null, text: 'Weight down, normal force out of the slope, friction up the slope. Friction stops it.' }),
];
const wait = (value, ms = 300) => new Promise((r) => { setTimeout(() => r(value), ms); });
let picture = null;
const SERVICES = {
  listSessions: () => wait({ rooms: [{ ...ROOM, startedAt: minsAgo(60) }] }),
  reviewQueue: ({ status = 'provisional' } = {}) => wait({
    items: ITEMS.filter((i) => status === 'all' || i.reviewStatus === status), status, limit: 50, hasMore: false, next: null,
  }),
  reviewItem: (id) => wait({ item: ITEMS.find((i) => i.answerId === id), log: [] }),
  review: () => Promise.reject(Object.assign(new Error('Decisions are not saved in this sample.'), { status: 400 })),
  // GET /api/media/<id> with this console's credentials: here, the picture
  // the phone would have sent, made by the phone's own export.
  mediaBlobUrl: async () => {
    picture ??= toPicture(PICTURE);
    return URL.createObjectURL(await wait(await picture, 400));
  },
};

/* ------------------------------------------------------------- entries */

export default [
  {
    id: 'drawing-phone-empty',
    title: 'Drawing: the phone, an empty board',
    note: 'Pen, eraser, four colours, three widths, undo, redo and clear, and the words box with its count (allowText). Send stays off until there is ink.',
    render: () => <Phone question={{ ...QUESTION, allowText: true, maxWords: 600, maxChars: 9000 }} />,
  },
  {
    id: 'drawing-phone-only',
    title: 'Drawing: the phone, a drawing only',
    note: 'A question without allowText: no words box, the board alone.',
    render: () => <Phone />,
  },
  {
    id: 'drawing-phone-mid',
    title: 'Drawing: the phone, mid-drawing',
    note: 'A block on a slope and its three forces, drawn by pointer events (mouse, then a stylus with pressure), with a line of words.',
    render: () => <Phone question={{ ...QUESTION, allowText: true, maxWords: 600, maxChars: 9000 }} script={{ draw: true, text: WORDS }} />,
  },
  {
    id: 'drawing-phone-awaiting',
    title: 'Drawing: the phone, sent and waiting for the professor',
    note: "Sent, stored, and the room's server:result with awaitingReview: its note, never a mark.",
    render: () => <Phone question={{ ...QUESTION, allowText: true, maxWords: 600, maxChars: 9000 }} script={{ draw: true, text: WORDS, send: true }} />,
  },
  {
    id: 'drawing-phone-offline',
    title: 'Drawing: the phone, sent while offline',
    note: 'The picture and the answer wait in the outbox on this phone, and go when it reconnects.',
    render: () => <Phone mode="offline" script={{ draw: true, send: true }} />,
  },
  {
    id: 'drawing-phone-refused',
    title: 'Drawing: the phone, refused (laptop mode)',
    note: 'The room answered drawing:refused with its sentence: that picture is never sent again, and the board opens for the student to send another.',
    render: () => <Phone mode="refuse" script={{ draw: true, send: true }} />,
  },
  {
    id: 'drawing-review',
    title: 'Drawing: an answer in the review',
    role: 'professor',
    note: 'The picture is fetched with the console\'s credentials and shown from a blob url, with the student\'s words. Also in the queue: a drawing with no words, and an answer in words only.',
    render: () => <ReviewScreen services={SERVICES} initialOpen={ITEMS[0].answerId} />,
  },
];
