/**
 * Batch 9 (E3): short and long written answers on the phone, empty, partway,
 * near the limit and over it. The limit only guides; the server is the judge.
 * The finish screen's hub link (E2) is in learn.gallery.jsx: 'phone-done'
 * (not signed in) and 'phone-done-next' (signed in, linked).
 */

import { useEffect, useRef, useState } from 'react';

import Question from '../learn/Question.jsx';
import { Climb, Conn, DockSlot } from '../learn/parts.jsx';
import { Mark } from '../ui/index.jsx';

const noop = () => {};

function Phone({ level = 'evaluate', children }) {
  const [dock, setDock] = useState(null);
  return (
    <DockSlot.Provider value={dock}>
      <div className="learn" data-view="question">
        <header className="ln-bar">
          <div className="ln-bar-in">
            <Mark size={30} />
            <span className="ln-room"><b>K7Q42M</b></span>
            <span className="ln-who">CSF042</span>
            <span className="push"><Conn status="online" /></span>
          </div>
        </header>
        <Climb level={level} />
        <main className="ln-page" data-view="question">{children}</main>
        <footer className="ln-dock" ref={setDock} />
      </div>
    </DockSlot.Provider>
  );
}

/** Types `text` into the answer box once it is there, as a student would. */
function Typed({ text, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const box = ref.current?.querySelector('textarea');
    if (!box || !text) return;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box, text);
    box.dispatchEvent(new Event('input', { bubbles: true }));
  }, [text]);
  return <div ref={ref} style={{ display: 'contents' }}>{children}</div>;
}

const SHORT = {
  _id: 'w9-short',
  kind: 'open',
  bloom: 'understand',
  topic: 'Factors affecting the rate',
  text: 'In one or two sentences, say why a plant in bright light still stops making sugar when it has no carbon dioxide.',
  rubric: ['carbon dioxide is fixed in the Calvin cycle', 'no carbon dioxide, no sugar'],
};

const LONG = {
  ...SHORT,
  _id: 'w9-long',
  length: 'long',
  bloom: 'evaluate',
  text: 'A farmer adds carbon dioxide to a greenhouse on a cloudy day. Will it raise the rate of photosynthesis? Weigh the evidence and justify your answer.',
  rubric: ['light is the limiting factor', 'extra carbon dioxide has little effect', 'names the evidence'],
};

const SENTENCE = 'On a cloudy day light is the limiting factor, so extra carbon dioxide adds little to the rate. ';
/** About `n` words of a plausible answer. */
const words = (n) => SENTENCE.repeat(Math.ceil(n / 18)).split(' ').slice(0, n).join(' ');

const ask = (question, text, save = null) => (
  <Phone level={question.bloom}>
    <Typed text={text}>
      <Question
        item={{ question, index: 4, reason: '' }}
        result={null}
        awaiting={false}
        sent={null}
        level={question.bloom}
        trail={['understand', 'apply', 'apply', 'analyse']}
        auto={false}
        save={save}
        onSubmit={noop}
        onNext={noop}
      />
    </Typed>
  </Phone>
);

const SCREENS = [
  { id: 'w9-short-empty', title: 'Short answer: empty', note: 'No `length` on the question, so it is short: a compact box and up to 60 words.', el: ask(SHORT, '') },
  { id: 'w9-short-near', title: 'Short answer: near the limit', note: 'Past 90% of the limit the count turns gold and says so once.', el: ask(SHORT, words(56)) },
  { id: 'w9-long-partway', title: 'Long answer: partway', note: "length: 'long': a roomy editor that grows with the text, and a live word count.", el: ask(LONG, words(140)) },
  { id: 'w9-long-near', title: 'Long answer: near the limit', el: ask(LONG, words(560)) },
  { id: 'w9-long-over', title: 'Long answer: over the limit', note: 'A soft warning only: Submit stays on, and the server decides.', el: ask(LONG, words(618)) },
  {
    id: 'w9-short-refused',
    title: 'Short answer: refused, kept to shorten',
    note: "The room sent server:refused: the text stays in its box, the server's sentence under it, and Submit sends the shortened one.",
    el: ask({ ...SHORT, maxWords: 60, maxChars: 900 }, words(72), {
      state: 'again',
      note: 'Your answer has 72 words, and this question takes at most 60. Shorten it and send it again; nothing was saved.',
    }),
  },
];

export default SCREENS.map(({ el, ...entry }) => ({ ...entry, role: null, render: () => el }));
