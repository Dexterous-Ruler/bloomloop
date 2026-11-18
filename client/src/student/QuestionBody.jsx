import { Fragment, useEffect, useId, useRef, useState } from 'react';

// One definition, in kinds.js. The passage arrives with its markers still in it
// — `blankCount` only says how many there should be — so the phone has to split
// on the same token the validator counted, and a second copy of it here is
// exactly the drift that file exists to prevent.
import { BLANK_MARK } from '../kinds.js';
import Icon from '../ui/Icon.jsx';
import { readDraft, saveDraft, clearDraft } from './draft.js';

const KEYS = ['A', 'B', 'C', 'D', 'E', 'F'];

/* How far a finger travels before a press becomes a drag. Under it nothing has
   happened at all, so a thumb that rests on a handle and shifts a pixel getting
   off it does not quietly reorder the list. */
const SLOP = 8;

/**
 * Shuffled lists arrive as plain strings, in the order this student is to see
 * them, and carrying nothing that identifies the original item.
 *
 * They used to arrive as {t, i} with `i` the ORIGINAL index — which for match,
 * order, rank and categorise IS the answer: one `sort((a,b)=>a.i-b.i)` in
 * devtools returned the correct sequence verbatim, and the shuffle was purely
 * cosmetic. The server now keeps that mapping to itself and recomputes it from
 * the same seed when it scores.
 *
 * So `i` here is the SHOWN POSITION. Everything below still speaks in `.i`, and
 * the positions it sends back are exactly what the server expects to translate.
 */
const asShown = (list) =>
  (Array.isArray(list) ? list : []).map((it, i) => ({ t: typeof it === 'string' ? it : it?.t ?? '', i }));

const moveAt = (list, from, to) => {
  const next = list.slice();
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
};

/**
 * The placed list for `order` and `rank`, reorderable three ways.
 *
 * Drag the grip, press the arrow keys on it, or take a row out with × and tap it
 * back in. Drag is the fastest and the only one a screen reader cannot use,
 * which is exactly why it is not the only one.
 *
 * The DOM order never changes while a drag is live — the rows are slid with
 * transforms and the array is committed on release. That is not a flourish: a
 * pointer capture is released the moment its element leaves the document, and
 * re-parenting the row under the finger is precisely what would do that, halfway
 * through the gesture, on the phone least able to recover from it.
 */
function SortList({ items, seq, locked, hint, onSeq }) {
  const listRef = useRef(null);
  const boxes = useRef([]);      // row rectangles, measured once when a drag starts
  const grab = useRef(null);     // the live gesture: which row, where it began, has it moved
  const [drag, setDrag] = useState(null);
  const [said, setSaid] = useState('');

  const textOf = (orig) => items.find((it) => it.i === orig)?.t ?? '';

  const put = (from, to) => {
    if (locked || to < 0 || to >= seq.length || to === from) return;
    const what = textOf(seq[from]);
    onSeq(moveAt(seq, from, to));
    // Said out loud, on screen, for everyone: a keyboard move with no visible
    // consequence is a control that appears not to work.
    setSaid(`${what} moved to ${to + 1} of ${seq.length}.`);
  };

  const onDown = (n) => (e) => {
    if (locked || e.button > 0) return;
    boxes.current = [...(listRef.current?.querySelectorAll('[data-row]') ?? [])]
      .map((el) => el.getBoundingClientRect());
    grab.current = { n, y0: e.clientY, live: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onMove = (e) => {
    const g = grab.current;
    const b = boxes.current;
    if (!g || !b[g.n]) return;
    const dy = e.clientY - g.y0;
    if (!g.live && Math.abs(dy) < SLOP) return;
    g.live = true;
    // Which slot the row's own middle has been dragged into. Walking outwards
    // from where it started means a row only changes slot when it has genuinely
    // crossed a neighbour's midpoint, so it does not flicker between two.
    const mid = b[g.n].top + b[g.n].height / 2 + dy;
    let to = g.n;
    while (to > 0 && mid < b[to - 1].top + b[to - 1].height / 2) to -= 1;
    while (to < b.length - 1 && mid > b[to + 1].top + b[to + 1].height / 2) to += 1;
    setDrag({ n: g.n, dy, to });
  };

  const onUp = () => {
    const g = grab.current;
    grab.current = null;
    if (g?.live && drag) put(drag.n, drag.to);
    setDrag(null);
  };

  // The browser can take the pointer back mid-gesture — a system edge swipe, a
  // call arriving. Nothing was dropped, so nothing moves.
  const onCancel = () => { grab.current = null; setDrag(null); };

  const gap = boxes.current.length > 1
    ? boxes.current[1].top - (boxes.current[0].top + boxes.current[0].height)
    : 0;
  const shift = drag && boxes.current[drag.n] ? boxes.current[drag.n].height + gap : 0;

  const slide = (n) => {
    if (!drag) return undefined;
    if (n === drag.n) return { transform: `translateY(${drag.dy}px)` };
    if (drag.to > drag.n && n > drag.n && n <= drag.to) return { transform: `translateY(${-shift}px)` };
    if (drag.to < drag.n && n >= drag.to && n < drag.n) return { transform: `translateY(${shift}px)` };
    return undefined;
  };

  return (
    <>
      <p className="hintline" role="status">{said || hint}</p>
      <ol className="ordered" ref={listRef}>
        {seq.map((orig, n) => (
          <li key={orig} data-row className={`sortrow${drag?.n === n ? ' lift' : ''}`} style={slide(n)}>
            <span className="n">{n + 1}</span>
            <span className="t">{textOf(orig)}</span>
            <button
              type="button"
              className="grip"
              disabled={locked}
              aria-label={`Move ${textOf(orig)}, position ${n + 1} of ${seq.length}. Drag it, or use the up and down arrow keys.`}
              onPointerDown={onDown(n)}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onCancel}
              onKeyDown={(e) => {
                const d = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
                if (!d) return;
                e.preventDefault();
                put(n, n + d);
              }}
            >
              <Icon name="menu" size={14} />
            </button>
            <button
              type="button"
              className="undo"
              disabled={locked}
              onClick={() => onSeq(seq.filter((x) => x !== orig))}
              aria-label={`Take ${textOf(orig)} back out`}
            >
              ×
            </button>
          </li>
        ))}
        {seq.length === 0 && <li className="ghost"><span className="t">Nothing placed yet</span></li>}
      </ol>
    </>
  );
}

/**
 * The passage or the image a question hangs off, above the question it is about.
 *
 * A stimulus is not a kind, which is the whole point of it: the competitor sells
 * "Passage" as its own paid question type, and that quietly fixes the ratio at
 * one reading to one item at one depth. Here it rides on the base object for
 * every kind, so the same passage can carry an mcq at Remember, a hottext at
 * Analyse and an open response at Create. This component therefore has to work
 * above all sixteen interactions and know nothing about any of them.
 *
 * Collapsible, and that is the design rather than a nicety. On a 390px screen a
 * seven-hundred-word passage and a set of answer controls are in direct
 * competition for the same space, and both obvious resolutions are wrong:
 * pinned open, the question is buried under the reading; hidden behind a link,
 * it is a passage nobody opens. So it arrives expanded but CAPPED — it scrolls
 * inside itself, the page keeps its own scroll, and one thumb-sized tap folds it
 * to a single line the moment the student has read enough and needs the room to
 * answer. The question is never more than a short scroll away in either state.
 *
 * Rendered by QuestionCard above the stem, not inside the body below it: a
 * student who met the question first would have to scroll back up past the
 * passage to find out what they were reading it for.
 */
export function Stimulus({ stimulus }) {
  const [open, setOpen] = useState(true);
  /* An image that never arrived — hall wifi, a host that is down. The alt text
     is the only evidence left on the screen in that case, which is exactly why
     the server refuses an image stimulus without one. */
  const [broken, setBroken] = useState(false);
  const bodyId = useId();

  if (!stimulus) return null;
  const isImage = stimulus.kind === 'image';
  const peek = isImage ? (stimulus.alt ?? '') : String(stimulus.text ?? '');

  return (
    <div className="stim">
      <button
        type="button"
        className="stimhead"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="k">{isImage ? 'Image' : 'Passage'}</span>
        {/* Folded away it still says what it was, so opening it again is never a
            tap into the dark. */}
        {!open && <span className="peek">{peek}</span>}
        <span className="act">{open ? 'Hide' : 'Show'}</span>
        <Icon name="chevron" size={14} style={open ? undefined : { transform: 'rotate(-90deg)' }} />
      </button>

      {open && (
        <div
          className="stimbody"
          id={bodyId}
          /* It scrolls, so it has to be focusable: a scroll box a keyboard
             cannot reach is a passage a keyboard cannot read past its first
             screenful. Labelled, because a region with no name is announced as
             "group" and tells a screen reader user nothing about what is in it. */
          tabIndex={0}
          role="region"
          aria-label={isImage ? 'The image this question is about' : 'The passage this question is about'}
        >
          {isImage
            ? (broken
              ? <p className="stimtext">{stimulus.alt}</p>
              : <img className="stimimg" src={stimulus.url} alt={stimulus.alt ?? ''} onError={() => setBroken(true)} />)
            : <p className="stimtext">{stimulus.text}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * The interaction for one question, chosen by its kind.
 *
 * Drag is real here, and it is built on POINTER events with setPointerCapture —
 * never the HTML5 drag-and-drop API. `dragstart` does not fire from a finger on
 * Android at all, so an HTML5 implementation would be a control that simply does
 * not exist on the hardware this runs on: cheap phones, on college wifi, in a
 * lecture hall.
 *
 * Tap is not a legacy path left behind by drag; the two are peers. A drag only
 * begins after SLOP pixels of movement and lives on a handle that carries no
 * click of its own, so every tap still lands exactly where it always did. Tap is
 * also what a keyboard and a screen reader get, alongside arrow keys on the same
 * handle — a control that can only be dragged is a control some of the class
 * cannot answer with.
 *
 * Owns its own draft answer and hands the finished response up. `mcq`,
 * `truefalse` and `poll` submit on tap because a single choice needs no
 * confirmation; every other kind is built up first and submitted deliberately.
 */
export default function QuestionBody({ question, result, busy, onSubmit }) {
  const kind = question.kind ?? 'mcq';
  const locked = Boolean(result) || busy;

  /* Whatever this student had already built for this question when the tab
     died, read HERE rather than in an effect. An effect runs after the browser
     has painted, so restoring in one would put an empty box on screen and fill
     it a frame later — the student would see their work missing and then
     returning, which is the exact moment this phase exists to prevent. */
  const [saved] = useState(() => readDraft(question._id));

  /* Draft resets whenever a new question arrives, and starts from whatever was
     saved for the one on screen now.

     The five interactive kinds carry no slot of their own, deliberately.
     draft.js re-shapes everything it reads back out of localStorage — a store
     the student can edit and an older build may have written — so every new
     slot is one more shape it has to be taught to distrust, and a `seq` that
     came back as a string is a white screen rather than a wrong answer. All
     five are one of the four shapes that are already there and already guarded:

       hottext   a set of token indices, exactly like multi   -> chosen
       grid      the set of ticked cells, flattened           -> chosen
       dropdown  one chosen option per gap                    -> pairs
       table     one string per cell, holes kept              -> words

     Flattened as `row * columns + column` for the two rectangular kinds, so a
     grid of ticks is a set of integers and a table of entries is a sparse list
     of strings — which is what those two slots already hold for multi and for
     cloze. Only one kind is ever on screen, so nothing collides. `poll` needs
     no slot at all: like mcq it submits on the tap that answers it. */
  const [picked, setPicked] = useState(null);      // mcq, truefalse, poll — see below, never saved
  const [chosen, setChosen] = useState(saved.chosen);  // multi, hottext, grid
  const [pairs, setPairs] = useState(saved.pairs);     // match: leftIdx -> originalRightIdx. dropdown: gapIdx -> shown option
  const [activeLeft, setActiveLeft] = useState(null);
  const [seq, setSeq] = useState(saved.seq);       // order, rank: original indices in chosen order
  const [typed, setTyped] = useState(saved.typed); // blank, numeric, open
  const [words, setWords] = useState(saved.words); // cloze: one string per marker. table: one per cell
  const [placed, setPlaced] = useState(saved.placed); // categorise: originalItemIdx -> groupIdx
  const [held, setHeld] = useState(null);          // categorise: the item picked up by tap
  const [fly, setFly] = useState(null);            // categorise: the item currently in the air
  const [said, setSaid] = useState('');            // what just happened, for the hint line

  // Grips are re-parented when an item changes group, so the focused one is a
  // different DOM node afterwards and the keyboard would be dropped on the floor
  // mid-sort. Held by item index and refocused after the move.
  const gripRefs = useRef(new Map());
  const wantFocus = useRef(null);
  const dragRef = useRef(null);

  /* The question the initialisers above already restored. The effect below is
     the reset path for questions that arrive AFTER mount, and running it for the
     first one would re-read the store and hand the same values back through a
     second render — worse, it would do it a frame late, so a student quick
     enough to type between paint and effect would have that keystroke
     overwritten by the very draft it was appended to. One shot, then off. */
  const booted = useRef(question._id);

  useEffect(() => {
    if (booted.current === question._id) { booted.current = null; return; }
    /* Reset and restore are ONE path, not two effects on the same trigger: the
       draft saved for the question that has just arrived, or blanks when there
       is none. Split in two, they would race on every new question and whichever
       ran last would win — half the time that is the one that wipes what the
       other just put back. */
    const d = readDraft(question._id);
    setPicked(null); setChosen(d.chosen); setPairs(d.pairs); setActiveLeft(null); setSeq(d.seq);
    setTyped(d.typed); setWords(d.words); setPlaced(d.placed);
    setHeld(null); setFly(null); setSaid('');
    gripRefs.current.clear();
  }, [question._id]);

  /* Everything the student has built and not yet sent, in one shape so saving
     never has to ask which kind is on screen.

     `picked` is deliberately absent. mcq and truefalse submit on the same tap
     that sets it, so there is no unsent state to keep: either the answer reached
     the server, which then has it and re-serves accordingly, or it did not and
     the question comes back untouched for one more tap. */
  const draft = { chosen, pairs, seq, typed, words, placed };

  // The last committed draft, for the flush below. Set inside the effect rather
  // than during render so a render React throws away cannot change what is saved.
  const live = useRef(null);

  useEffect(() => {
    live.current = result ? null : { id: question._id, draft };

    /* Marked. From here the saved copy is worse than nothing: this question has
       been scored and will not be served again, so anything left behind could
       only ever surface under an answer that is already decided. */
    if (result) { clearDraft(question._id); return undefined; }

    /* Debounced, because this runs on every keystroke and every tap, and a
       localStorage write is synchronous on the main thread — the thread that is
       also drawing the letters. On the phones this is built for, saving on each
       character is a stutter in the middle of a sentence.

       A new question changes `question._id` one render before the effect above
       has swapped the state underneath it, so this write is briefly aimed at the
       new id with the old draft still in hand. It never lands: that effect hands
       back fresh arrays and objects every time, so this one re-runs and clears
       its own timer within the same tick, four hundred milliseconds early. */
    const t = setTimeout(() => saveDraft(question._id, draft), 400);
    return () => clearTimeout(t);
  }, [question._id, result, chosen, pairs, seq, typed, words, placed]); // not `draft` — new object every render

  useEffect(() => {
    /* A debounce is a timer, and a tab that is being closed never gets to run
       its timers. `pagehide` is the last event a page reliably hears on a phone
       — iOS Safari does not fire `beforeunload` at all — so the final few
       hundred milliseconds of typing are written here instead of dying with the
       tab that the teacher, or a fat thumb, just closed. */
    const flush = () => { if (live.current) saveDraft(live.current.id, live.current.draft); };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  useEffect(() => {
    const id = wantFocus.current;
    if (id === null) return;
    wantFocus.current = null;
    gripRefs.current.get(id)?.focus();
  });

  const solution = result?.solution;

  /* ---------------------------------------------------------------- mcq --- */
  if (kind === 'mcq') {
    const cls = (i) => {
      if (!result) return picked === i ? 'opt pick' : 'opt';
      if (i === solution) return 'opt yes';
      if (i === picked) return 'opt no';
      return 'opt dim';
    };
    return (
      <div className="opts">
        {(question.options ?? []).map((o, i) => (
          <button key={i} type="button" className={cls(i)} disabled={locked}
            onClick={() => { setPicked(i); onSubmit(i); }}>
            <span className="k">{KEYS[i]}</span>
            <span className="t">{o}</span>
            {result && i === solution && <span className="tag2">correct</span>}
            {result && i === picked && i !== solution && <span className="tag2">you</span>}
          </button>
        ))}
      </div>
    );
  }

  /* ---------------------------------------------------------- truefalse --- */
  if (kind === 'truefalse') {
    // Two targets, so they get half the screen each rather than the width of a
    // word. The item text is a statement — the contract refuses to store a
    // question mark here — so these two are the whole interaction.
    const cls = (v) => {
      if (!result) return picked === v ? 'opt big pick' : 'opt big';
      if (v === solution) return 'opt big yes';
      if (v === picked) return 'opt big no';
      return 'opt big dim';
    };
    return (
      <div className="opts two">
        {[true, false].map((v) => (
          <button key={String(v)} type="button" className={cls(v)} disabled={locked}
            onClick={() => { setPicked(v); onSubmit(v); }}>
            <span className="t">{v ? 'True' : 'False'}</span>
            {result && v === solution && <span className="tag2">correct</span>}
            {result && v === picked && v !== solution && <span className="tag2">you</span>}
          </button>
        ))}
      </div>
    );
  }

  /* --------------------------------------------------------------- poll --- */
  if (kind === 'poll') {
    /* Nothing here is right and nothing here is wrong, so nothing here is green
       or red. The chosen option keeps the same lime the phone uses everywhere
       else for "this is the one you picked" and the rest go quiet — the marked
       kinds' `yes` and `no` would both be lies, and `yes` is the worse of the
       two: a student told they were correct about their own opinion learns that
       this product hands out ticks for tapping.

       The server scores every well-formed poll answer as correct so that the
       "your answer landed" path is the same one every other kind takes; what
       stops that reaching the mastery model is countsTowardMastery(), and what
       stops it reaching the student's eyes is this branch and the suppressed
       verdict in QuestionCard. */
    const cls = (i) => {
      if (picked === i) return 'opt pick';
      return result ? 'opt dim' : 'opt';
    };
    return (
      <>
        {/* Said before they answer and again after, because those are two
            different worries. Before: "what happens if I pick the wrong one".
            After: "did I just get something wrong". */}
        <div className="note on-d pollsay" role="status">
          <Icon name="users" size={15} />
          <span>
            {result
              ? 'Your answer is in. This one was not marked — there was no right answer to it, and what you picked has not moved your level.'
              : 'This one is not marked. There is no right answer and nothing to get wrong: it is the room being asked what it thinks, and your level does not move either way.'}
          </span>
        </div>
        {/* Never two columns, whatever the width. A poll's options are usually a
            scale, which is why the server refuses to shuffle them, and a scale
            broken across two columns stops reading as one. */}
        <div className="opts single">
          {(question.options ?? []).map((o, i) => (
            <button key={i} type="button" className={cls(i)} disabled={locked}
              onClick={() => { setPicked(i); onSubmit(i); }}>
              <span className="k">{KEYS[i]}</span>
              <span className="t">{o}</span>
              {result && picked === i && <span className="tag2">yours</span>}
            </button>
          ))}
        </div>
      </>
    );
  }

  /* -------------------------------------------------------------- multi --- */
  if (kind === 'multi') {
    const want = Array.isArray(solution) ? solution : [];
    const cls = (i) => {
      const mine = chosen.includes(i);
      if (!result) return mine ? 'opt pick' : 'opt';
      if (want.includes(i)) return 'opt yes';
      if (mine) return 'opt no';
      return 'opt dim';
    };
    return (
      <>
        <div className="opts">
          {(question.options ?? []).map((o, i) => (
            <button key={i} type="button" className={cls(i)} disabled={locked}
              onClick={() => setChosen((c) => (c.includes(i) ? c.filter((x) => x !== i) : [...c, i]))}>
              <span className="k" aria-hidden="true">{chosen.includes(i) || (result && want.includes(i)) ? '✓' : ''}</span>
              <span className="t">{o}</span>
              {result && want.includes(i) && <span className="tag2">correct</span>}
            </button>
          ))}
        </div>
        {!result && (
          <button type="button" className="btn lime" style={{ marginTop: 16 }} disabled={chosen.length === 0 || busy}
            onClick={() => onSubmit(chosen)}>
            {busy ? <span className="spin" /> : null}
            Submit {chosen.length ? `${chosen.length} selected` : ''}
          </button>
        )}
      </>
    );
  }

  /* ------------------------------------------------------------ hottext --- */
  if (kind === 'hottext') {
    const tokens = question.tokens ?? [];
    const want = Array.isArray(solution) ? solution : null;

    /* Four states, and only after the answer is in: the words they found, the
       words they picked that were not it, the ones they missed, and the rest of
       the sentence — which stays plain. Dimming the untouched words the way the
       option kinds do would leave the sentence unreadable at exactly the moment
       the student is trying to see what the right answer looked like in it. */
    const tone = (i) => {
      const mine = chosen.includes(i);
      if (!result || !want) return mine ? ' on' : '';
      if (want.includes(i)) return mine ? ' yes' : ' miss';
      return mine ? ' no' : '';
    };

    return (
      <>
        {/* Selecting words with the criterion off screen is not a hard question,
            it is an unanswerable one — pick the words that WHAT? The contract
            refuses to store a hottext without one, and it stays up after the
            answer because it is what the selection meant. Label and value, not a
            sentence built around the teacher's wording: a criterion is as likely
            to arrive as a noun phrase as a predicate, and half of those would
            read as broken English inside a stitched-together prompt. */}
        <div className="crit">
          <span className="k">What to pick</span>
          <b>{question.criterion ?? ''}</b>
        </div>

        {/* The sentence in its own order, never shuffled — a sentence with its
            words rearranged is not a sentence, and the question stops meaning
            anything. Every word is its own target rather than one run of text
            with hit regions, because a thumb needs a box and a box needs a
            button. */}
        <div className="hottext">
          {tokens.map((t, i) => (
            <button
              key={i}
              type="button"
              className={`tok${tone(i)}`}
              disabled={locked}
              aria-pressed={chosen.includes(i)}
              onClick={() => setChosen((c) => (c.includes(i) ? c.filter((x) => x !== i) : [...c, i]))}
            >
              {t}
            </button>
          ))}
        </div>

        {result && want && (
          <p className="hintline">The words that answered it are outlined. Anything you picked that is not one of them is marked.</p>
        )}

        {!result && (
          // Sent in reading order rather than tap order. The server scores it as
          // a set either way; a sorted answer is one a human can read in a log
          // next to the sentence it came from.
          <button type="button" className="btn lime" style={{ marginTop: 16 }} disabled={chosen.length === 0 || busy}
            onClick={() => onSubmit([...chosen].sort((a, b) => a - b))}>
            {busy ? <span className="spin" /> : null}
            {chosen.length === 0 ? 'Tap the words above' : chosen.length === 1 ? 'Submit 1 word' : `Submit ${chosen.length} words`}
          </button>
        )}
      </>
    );
  }

  /* -------------------------------------------------------------- match --- */
  if (kind === 'match') {
    const left = question.left ?? [];
    const right = asShown(question.right);
    const usedRight = new Set(Object.values(pairs));
    const pairedFor = (li) => pairs[li];

    const tapLeft = (li) => {
      if (locked) return;
      if (pairedFor(li) !== undefined) {
        setPairs((p) => { const n = { ...p }; delete n[li]; return n; });
        setActiveLeft(li);
        return;
      }
      setActiveLeft(activeLeft === li ? null : li);
    };
    const tapRight = (originalIdx) => {
      if (locked || activeLeft === null) return;
      setPairs((p) => ({ ...p, [activeLeft]: originalIdx }));
      setActiveLeft(null);
    };

    const answer = left.map((_, li) => (pairs[li] === undefined ? -1 : pairs[li]));
    const complete = answer.every((v) => v >= 0);

    return (
      <>
        <p className="hintline">
          {result ? 'Correct pairing shown below.' : activeLeft === null ? 'Tap an item on the left, then its match.' : 'Now tap its match.'}
        </p>
        <div className="pairgrid">
          <div>
            {/* Numbered on purpose. On a phone these two lists stack, and
                without the headings a student sees ten identical tiles and no
                indication of which half is which. */}
            <span className={`pairstep${activeLeft === null && !result ? ' on' : ''}`}>
              <i>1</i>{result ? 'The items' : 'Tap an item'}
            </span>
            {left.map((t, li) => {
              const done = pairs[li] !== undefined;
              const right2 = right.find((r) => r.i === pairs[li]);
              // solution[li] is the SHOWN position of the right-hand item that belongs to
    // left li. It arrives with the result and never before it.
    const truthPos = Array.isArray(solution) ? solution[li] : undefined;
    const ok = result ? pairs[li] === truthPos : null;
              return (
                <button key={li} type="button" disabled={locked}
                  className={`chipbtn${activeLeft === li ? ' active' : ''}${done ? ' done' : ''}${ok === true ? ' yes' : ok === false ? ' no' : ''}`}
                  onClick={() => tapLeft(li)}>
                  <span className="t">{t}</span>
                  {done && <span className="mate">{right2?.t ?? ''}</span>}
                  {result && !ok && <span className="mate truth">{right[truthPos]?.t ?? ''}</span>}
                </button>
              );
            })}
          </div>
          <div>
            <span className={`pairstep${activeLeft !== null && !result ? ' on' : ''}`}>
              <i>2</i>{result ? 'The matches' : 'Then tap its match'}
            </span>
            {right.map((r) => (
              <button key={r.i} type="button" disabled={locked || usedRight.has(r.i)}
                className={`chipbtn right${usedRight.has(r.i) ? ' used' : ''}`}
                onClick={() => tapRight(r.i)}>
                <span className="t">{r.t}</span>
              </button>
            ))}
          </div>
        </div>
        {!result && (
          <button type="button" className="btn lime" style={{ marginTop: 16 }} disabled={!complete || busy}
            onClick={() => onSubmit(answer)}>
            {busy ? <span className="spin" /> : null}
            {complete ? 'Submit pairs' : `${answer.filter((v) => v >= 0).length} of ${left.length} paired`}
          </button>
        )}
      </>
    );
  }

  /* --------------------------------------------------------- categorise --- */
  if (kind === 'categorise') {
    const groups = question.groups ?? [];
    const items = asShown(question.items);
    // solution is one group index per ORIGINAL item index, so it indexes straight.
    const truth = Array.isArray(solution) ? solution : null;

    const textOf = (orig) => items.find((it) => it.i === orig)?.t ?? '';
    const pool = items.filter((it) => placed[it.i] === undefined);
    const inGroup = (g) => items.filter((it) => placed[it.i] === g);

    // -1 is the tray. One code path puts an item anywhere, so tap, drag and the
    // arrow keys cannot drift apart.
    const place = (orig, g) => {
      if (locked) return;
      setPlaced((p) => {
        const next = { ...p };
        if (g < 0) delete next[orig]; else next[orig] = g;
        return next;
      });
      setHeld(null);
      setSaid(g < 0 ? `${textOf(orig)} taken back out.` : `${textOf(orig)} put in ${groups[g]}.`);
    };

    // Same two-step tap the match kind uses: pick a thing up, then say where it
    // goes. Tapping something already placed lifts it back out and keeps hold of
    // it, so a mistake is one tap to fix rather than two.
    const tapItem = (orig) => {
      if (locked) return;
      if (placed[orig] !== undefined) { place(orig, -1); setHeld(orig); return; }
      setHeld(held === orig ? null : orig);
    };
    const tapBin = (g) => { if (!locked && held !== null) place(held, g); };

    const gripDown = (orig) => (e) => {
      if (locked || e.button > 0) return;
      dragRef.current = { orig, x0: e.clientX, y0: e.clientY, live: false };
      e.currentTarget.setPointerCapture?.(e.pointerId);
    };
    const gripMove = (e) => {
      const d = dragRef.current;
      if (!d) return;
      if (!d.live && Math.abs(e.clientX - d.x0) < SLOP && Math.abs(e.clientY - d.y0) < SLOP) return;
      d.live = true;
      // Hit-tested rather than measured, so a group that moved because the tray
      // above it emptied is still found where it actually is. The flyer is inert
      // to pointers, or it would be the only thing this ever hits.
      const bin = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-bin]');
      setFly({ orig: d.orig, x: e.clientX, y: e.clientY, over: bin ? Number(bin.dataset.bin) : null });
    };
    const gripUp = () => {
      const d = dragRef.current;
      dragRef.current = null;
      if (d?.live && fly && fly.over !== null) place(d.orig, fly.over);
      setFly(null);
    };
    const gripCancel = () => { dragRef.current = null; setFly(null); };

    const gripKeys = (orig) => (e) => {
      if (locked) return;
      const step = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1
        : (e.key === 'ArrowLeft' || e.key === 'ArrowUp') ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      const from = placed[orig] === undefined ? -1 : placed[orig];
      const to = Math.max(-1, Math.min(groups.length - 1, from + step));
      if (to === from) return;
      wantFocus.current = orig;
      place(orig, to);
    };

    const toneOf = (it) => {
      if (!result || !truth) return '';
      return truth[it.i] === placed[it.i] ? ' yes' : ' no';
    };

    const chip = (it) => (
      <div
        key={it.i}
        className={`dragrow${held === it.i ? ' active' : ''}${fly?.orig === it.i ? ' flying' : ''}${toneOf(it)}`}
      >
        <button
          type="button"
          className="grip"
          disabled={locked}
          ref={(el) => { if (el) gripRefs.current.set(it.i, el); }}
          aria-label={`Move ${it.t}. ${placed[it.i] === undefined ? 'Not in a group yet' : `In ${groups[placed[it.i]]}`}. Drag it, or use the arrow keys.`}
          onPointerDown={gripDown(it.i)}
          onPointerMove={gripMove}
          onPointerUp={gripUp}
          onPointerCancel={gripCancel}
          onKeyDown={gripKeys(it.i)}
        >
          <Icon name="menu" size={14} />
        </button>
        <button type="button" className="body" disabled={locked} onClick={() => tapItem(it.i)}>
          <span className="t">{it.t}</span>
          {result && truth && truth[it.i] !== placed[it.i] && (
            <span className="mate truth">{groups[truth[it.i]]}</span>
          )}
        </button>
      </div>
    );

    return (
      <>
        <p className="hintline" role="status">
          {/* The result outranks the running commentary. `said` still holds the
              last thing the student moved, and leaving that on screen next to a
              marked answer reads as if the marking were still in progress. */}
          {result
            ? 'Where each one belonged is shown below.'
            : said || (held === null
              ? 'Tap an item, then the group it belongs in — or drag it there by the handle.'
              : 'Now tap its group.')}
        </p>

        {/* The tray is a drop target too, so a drag can undo itself without
            having to find the × on a moving tile. */}
        <div className={`tray${fly?.over === -1 ? ' over' : ''}`} data-bin="-1">
          {pool.length === 0
            ? <span className="binhint">Everything is in a group.</span>
            : pool.map(chip)}
        </div>

        <div className="bins">
          {groups.map((g, gi) => (
            <div key={g} className={`bin${fly?.over === gi ? ' over' : ''}`} data-bin={gi}>
              <button type="button" className="binhead" disabled={locked} onClick={() => tapBin(gi)}>
                <span className="nm">{g}</span>
                <span className="n">{inGroup(gi).length}</span>
              </button>
              <div className="binitems">
                {inGroup(gi).map(chip)}
                {inGroup(gi).length === 0 && (
                  <span className="binhint">{held === null ? 'nothing here yet' : 'tap to put it here'}</span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Follows the finger above it, not under it: a thumb covers the tile it
            is carrying, and a student cannot aim something they cannot see. */}
        {fly && (
          <div className="flyer" style={{ left: fly.x, top: fly.y }} aria-hidden="true">
            {textOf(fly.orig)}
          </div>
        )}

        {!result && (
          <button type="button" className="btn lime" style={{ marginTop: 16 }} disabled={pool.length > 0 || busy}
            onClick={() => onSubmit(placed)}>
            {busy ? <span className="spin" /> : null}
            {pool.length > 0 ? `${items.length - pool.length} of ${items.length} sorted` : 'Submit groups'}
          </button>
        )}
      </>
    );
  }

  /* -------------------------------------------------------- order / rank --- */
  if (kind === 'order' || kind === 'rank') {
    const items = asShown(question.items);
    const rest = items.filter((it) => !seq.includes(it.i));
    const truth = Array.isArray(solution) ? solution : null;
    const criterion = kind === 'rank' ? (question.criterion ?? '') : '';

    return (
      <>
        {/* Ranking with the criterion off screen is not a hard question, it is an
            unanswerable one — ordered by WHAT? The contract refuses to store a
            rank item without one, so the phone has no excuse for hiding it, and
            it stays up after the answer because it is what the order meant. */}
        {criterion && (
          <div className="crit">
            <span className="k">Rank by</span>
            <b>{criterion}</b>
          </div>
        )}

        {result && truth ? (
          <>
            <p className="hintline">The correct order is shown below.</p>
            <ol className="ordered">
              {truth.map((t, n) => <li key={n}><span className="n">{n + 1}</span><span className="t">{t}</span></li>)}
            </ol>
          </>
        ) : (
          <>
            <SortList
              items={items}
              seq={seq}
              locked={locked}
              onSeq={setSeq}
              hint={kind === 'rank'
                ? 'Tap them in order, strongest first. Drag a handle or use the arrow keys to adjust.'
                : 'Tap them in order, first to last. Drag a handle or use the arrow keys to adjust.'}
            />
            {/* The pool below the list is a chip, not an option: it is a thing
                being moved into a sequence rather than an answer being chosen. */}
            <div className="opts" style={{ marginTop: 12 }}>
              {rest.map((it) => (
                <button key={it.i} type="button" className="chipbtn" disabled={locked}
                  onClick={() => setSeq((s) => [...s, it.i])}>
                  <span className="t">{it.t}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {!result && (
          <button type="button" className="btn lime" style={{ marginTop: 16 }} disabled={rest.length > 0 || busy}
            onClick={() => onSubmit(seq)}>
            {busy ? <span className="spin" /> : null}
            {rest.length > 0
              ? `${seq.length} of ${items.length} placed`
              : kind === 'rank' ? 'Submit ranking' : 'Submit order'}
          </button>
        )}
      </>
    );
  }

  /* -------------------------------------------------------------- cloze --- */
  if (kind === 'cloze') {
    const parts = String(question.text ?? '').split(BLANK_MARK);
    const marks = parts.length - 1;
    // A passage whose markers went missing is still answerable: fall back to one
    // box per blank the server says it has, rather than handing a student a
    // sentence with nowhere to type.
    const count = marks > 0 ? marks : Number(question.blankCount) || 0;
    const filled = Array.from({ length: count }).filter((_, i) => String(words[i] ?? '').trim()).length;

    const box = (i) => (
      <input
        key={`b${i}`}
        className="blankin"
        value={words[i] ?? ''}
        disabled={locked}
        // Grows with what is typed, so a long word is not read through a keyhole.
        size={Math.max(6, String(words[i] ?? '').length + 2)}
        onChange={(e) => setWords((w) => { const next = w.slice(); next[i] = e.target.value; return next; })}
        aria-label={`Blank ${i + 1} of ${count}`}
        autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false"
      />
    );

    return (
      <>
        {/* The passage IS the interaction, so it is rendered here with the boxes
            in the sentence rather than above it with a numbered list underneath.
            A student reading a gap can see what has to fit in it. */}
        {marks > 0 ? (
          <p className="q-text cloze">
            {parts.map((part, i) => <Fragment key={i}>{part}{i < marks && box(i)}</Fragment>)}
          </p>
        ) : (
          <div className="stack tight" style={{ marginTop: 14 }}>
            {Array.from({ length: count }).map((_, i) => box(i))}
          </div>
        )}

        {result && (
          <div className="truthbox">
            <span className="k">Accepted answers</span>
            <ol>{(Array.isArray(solution) ? solution : []).map((s, i) => <li key={i}>{s}</li>)}</ol>
          </div>
        )}

        {!result && (
          // Every blank is scored on its own, so a student who has two of three
          // is not held hostage by the one they cannot get.
          <button type="button" className="btn lime" style={{ marginTop: 16 }} disabled={filled === 0 || busy}
            onClick={() => onSubmit(Array.from({ length: count }, (_, i) => words[i] ?? ''))}>
            {busy ? <span className="spin" /> : null}
            {filled === count ? 'Submit answers' : `Submit ${filled} of ${count}`}
          </button>
        )}
      </>
    );
  }

  /* ----------------------------------------------------------- dropdown --- */
  if (kind === 'dropdown') {
    const parts = String(question.text ?? '').split(BLANK_MARK);
    const marks = parts.length - 1;
    const gaps = Array.isArray(question.gaps) ? question.gaps : [];
    // Same fallback as cloze: a passage whose markers went missing is still
    // answerable as a stack of gaps, rather than a sentence with nowhere to
    // choose in it.
    const count = marks > 0 ? marks : gaps.length;
    const answer = Array.from({ length: count }, (_, i) => (pairs[i] === undefined ? -1 : pairs[i]));
    const answered = answer.filter((v) => v >= 0).length;
    const truth = Array.isArray(solution) ? solution : null;

    /* The options arrive already shuffled, per gap, on the gap's own seed — so
       the position sent back IS the answer as far as this phone is concerned and
       it never learns which word was written first. `truth` comes back in the
       same shown space for the same reason, which is what makes this comparison
       legitimate rather than the client marking its own work. */
    const gap = (i) => {
      const options = gaps[i]?.options ?? [];
      const mine = pairs[i];
      const tone = !result || truth?.[i] === undefined ? '' : mine === truth[i] ? ' yes' : ' no';
      return (
        <span className={`gapwrap${tone}`} key={`g${i}`}>
          <select
            className="gapsel"
            disabled={locked}
            /* Empty until they choose. A select that opens on its first real
               option has answered the question for them, and the student who
               skips a gap would be recorded as having picked whatever happened
               to be shuffled into first place. */
            value={mine === undefined ? '' : String(mine)}
            aria-label={`Gap ${i + 1} of ${count}`}
            onChange={(e) => setPairs((p) => ({ ...p, [i]: Number(e.target.value) }))}
          >
            <option value="" disabled>Choose…</option>
            {options.map((o, pos) => <option key={pos} value={pos}>{o}</option>)}
          </select>
          <Icon name="chevron" size={12} />
        </span>
      );
    };

    return (
      <>
        {/* The passage IS the interaction, so the gaps sit in the sentence and
            the sentence is rendered here rather than by the card above — which
            skips its own copy for this kind for exactly that reason. */}
        {marks > 0 ? (
          <p className="q-text cloze">
            {parts.map((part, i) => <Fragment key={i}>{part}{i < marks && gap(i)}</Fragment>)}
          </p>
        ) : (
          <div className="stack tight" style={{ marginTop: 14 }}>
            {Array.from({ length: count }).map((_, i) => gap(i))}
          </div>
        )}

        {result && truth && (
          <div className="truthbox">
            <span className="k">The word for each gap</span>
            {/* Positions translated back into words with the very list this
                phone was handed, so the key reads as the passage rather than as
                a row of numbers only the server could interpret. */}
            <ol>{truth.map((pos, i) => <li key={i}>{gaps[i]?.options?.[pos] ?? ''}</li>)}</ol>
          </div>
        )}

        {!result && (
          // Every gap is scored on its own, so a student who has two of three is
          // not held hostage by the one they cannot see.
          <button type="button" className="btn lime" style={{ marginTop: 16 }} disabled={answered === 0 || busy}
            onClick={() => onSubmit(answer)}>
            {busy ? <span className="spin" /> : null}
            {answered === count ? 'Submit answers' : `Submit ${answered} of ${count}`}
          </button>
        )}
      </>
    );
  }

  /* -------------------------------------------------------------- table --- */
  if (kind === 'table') {
    const columns = question.columns ?? [];
    const rows = question.rows ?? [];
    const wide = Math.max(1, columns.length);
    // One flat slot per cell, so the draft is the `words` list cloze already
    // uses. Addressed by real coordinates on the wire because a table is never
    // shuffled — its headings are what make a cell answerable at all, so moving
    // them would change the question rather than hide the answer.
    const at = (ri, ci) => ri * wide + ci;
    const cellAt = (ri, ci) => `${ri}:${ci}`;
    const textAt = (ri, ci) => words[at(ri, ci)] ?? '';
    const truth = result && solution && typeof solution === 'object' && !Array.isArray(solution) ? solution : null;

    const blanks = [];
    rows.forEach((r, ri) => (r.cells ?? []).forEach((c, ci) => { if (c.blank) blanks.push([ri, ci]); }));
    const filled = blanks.filter(([ri, ci]) => String(textAt(ri, ci)).trim()).length;

    return (
      <>
        <p className="hintline">
          {result
            ? 'The accepted answer for each cell is under what you wrote.'
            : 'Fill in the empty cells. The rows already filled in show you the rule.'}
        </p>

        {/* A real table, not a stack of labelled rows. The row and the column
            heading together are what make a cell answerable, and a layout that
            reads one of them out per cell loses the pattern down the column —
            which is the whole reason completing a table is Apply and not recall.
            It scrolls sideways when it will not fit, with the row headings
            pinned, rather than crushing four columns into a phone. */}
        <div className="tablewrap">
          <table className="qtable">
            <thead>
              <tr>
                <td className="corner" />
                {columns.map((c) => <th key={c} scope="col">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={r.header}>
                  <th scope="row">{r.header}</th>
                  {(r.cells ?? []).map((c, ci) => (
                    <td key={ci} className={c.blank ? 'blank' : 'given'}>
                      {!c.blank ? c.given : result ? (
                        /* No tick and no cross per cell. A blank cell accepts
                           several answers and only the first of them travels
                           back, so a phone comparing the two would mark a
                           student wrong for a synonym the server itself would
                           have accepted. The count in the result line is the
                           verdict; this is only the key. */
                        <span className="wasin">
                          <b>{String(textAt(ri, ci)).trim() || '—'}</b>
                          {truth?.[cellAt(ri, ci)] !== undefined && <i>{truth[cellAt(ri, ci)]}</i>}
                        </span>
                      ) : (
                        <input
                          className="cellin"
                          value={textAt(ri, ci)}
                          disabled={locked}
                          aria-label={`${r.header}, ${columns[ci] ?? `column ${ci + 1}`}`}
                          onChange={(e) => setWords((w) => {
                            const next = w.slice();
                            next[at(ri, ci)] = e.target.value;
                            return next;
                          })}
                          autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false"
                        />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!result && (
          // Per cell, like cloze: four rows right and a fumbled fifth is a
          // procedure demonstrated, not a question failed.
          <button type="button" className="btn lime" style={{ marginTop: 16 }} disabled={filled === 0 || busy}
            onClick={() => onSubmit(Object.fromEntries(blanks.map(([ri, ci]) => [cellAt(ri, ci), textAt(ri, ci)])))}>
            {busy ? <span className="spin" /> : null}
            {filled === blanks.length ? 'Submit the table' : `Submit ${filled} of ${blanks.length} cells`}
          </button>
        )}
      </>
    );
  }

  /* --------------------------------------------------------------- grid --- */
  if (kind === 'grid') {
    const columns = question.columns ?? [];
    const rows = question.rows ?? [];
    const wide = Math.max(1, columns.length);
    const at = (ri, ci) => ri * wide + ci;
    const cellAt = (ri, ci) => `${ri}:${ci}`;
    // The key comes back as "row:column" strings for the true intersections,
    // which is the server's own answer and not a judgement made here.
    const want = Array.isArray(solution) ? new Set(solution) : null;
    const ticked = (ri, ci) => chosen.includes(at(ri, ci));

    const tone = (ri, ci) => {
      const mine = ticked(ri, ci);
      if (!result || !want) return mine ? ' on' : '';
      if (want.has(cellAt(ri, ci))) return mine ? ' yes' : ' miss';
      return mine ? ' no' : '';
    };

    /* Bounded before it is sent. `chosen` is restored from a store the student
       can edit, and a flat index off the end of the board would arrive as a
       coordinate for a row that does not exist. The server drops those rather
       than penalising them; there is no reason to make it. */
    const cells = rows.length * wide;
    const answer = Object.fromEntries(
      chosen.filter((n) => n >= 0 && n < cells).map((n) => [`${Math.floor(n / wide)}:${n % wide}`, true]),
    );
    const count = Object.keys(answer).length;

    return (
      <>
        <p className="hintline">
          {result
            ? 'Green is one you found, red is one that should not be ticked, outlined is one you missed.'
            : `Tick every box where the row and the column go together.${columns.length > 3 ? ' The grid scrolls sideways.' : ''}`}
        </p>

        {/* Every intersection is its own yes-or-no, which is why the server marks
            this on what was ticked AND on what was rightly left alone — so a box
            left alone is an answer here, and it has to be as easy to see as a
            box that was ticked. The whole cell is the target, not the 20px
            checkbox inside it. */}
        <div className="tablewrap">
          <table className="qtable qgrid">
            <thead>
              <tr>
                <td className="corner" />
                {columns.map((c) => <th key={c} scope="col">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={r}>
                  <th scope="row">{r}</th>
                  {columns.map((c, ci) => (
                    <td key={c} className="tick">
                      <label className={`tickbox${tone(ri, ci)}`}>
                        <input
                          type="checkbox"
                          checked={ticked(ri, ci)}
                          disabled={locked}
                          aria-label={`${r}, ${c}`}
                          onChange={() => setChosen((s) => (s.includes(at(ri, ci))
                            ? s.filter((x) => x !== at(ri, ci))
                            : [...s, at(ri, ci)]))}
                        />
                      </label>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!result && (
          <button type="button" className="btn lime" style={{ marginTop: 16 }} disabled={count === 0 || busy}
            onClick={() => onSubmit(answer)}>
            {busy ? <span className="spin" /> : null}
            {count === 0 ? 'Tick the boxes above' : `Submit ${count} ticked`}
          </button>
        )}
      </>
    );
  }

  /* ------------------------------------------------------------ numeric --- */
  if (kind === 'numeric') {
    return (
      <>
        <div className="numrow">
          {/* A decimal keypad on a text field, never type="number": the scorer
              strips spaces and commas on purpose so "3,000" is right, and a
              number input would refuse the comma before the server saw it. */}
          <input
            value={typed} disabled={locked} type="text" inputMode="decimal"
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Your answer" aria-label="Your answer" autoComplete="off"
          />
          {question.unit && <span className="unit">{question.unit}</span>}
        </div>

        {result && (
          <div className="truthbox">
            <span className="k">The value</span>
            <b>{String(solution ?? '')}{question.unit ? ` ${question.unit}` : ''}</b>
          </div>
        )}

        {!result && (
          <button type="button" className="btn lime" style={{ marginTop: 16 }} disabled={!typed.trim() || busy}
            onClick={() => onSubmit(typed)}>
            {busy ? <span className="spin" /> : null}
            Submit answer
          </button>
        )}
      </>
    );
  }

  /* -------------------------------------------------------- blank / open --- */
  const isOpen = kind === 'open';
  return (
    <>
      {isOpen && question.hint && <p className="hintline">{question.hint}</p>}
      {isOpen ? (
        <textarea value={typed} disabled={locked} onChange={(e) => setTyped(e.target.value)}
          placeholder="Your answer, in your own words" rows={5} />
      ) : (
        <input value={typed} disabled={locked} onChange={(e) => setTyped(e.target.value)}
          placeholder="Type your answer" autoComplete="off" autoCorrect="off" />
      )}

      {result && (
        <div className="truthbox">
          <span className="k">{isOpen ? 'Points a full answer makes' : 'Accepted answer'}</span>
          {isOpen
            ? <ul>{(Array.isArray(solution) ? solution : []).map((p, i) => <li key={i}>{p}</li>)}</ul>
            : <b>{String(solution ?? '')}</b>}
        </div>
      )}

      {!result && (
        <button type="button" className="btn lime" style={{ marginTop: 16 }} disabled={!typed.trim() || busy}
          onClick={() => onSubmit(typed)}>
          {busy ? <span className="spin" /> : null}
          Submit answer
        </button>
      )}
    </>
  );
}
