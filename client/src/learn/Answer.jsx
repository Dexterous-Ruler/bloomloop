/**
 * The interaction for one question, chosen by its kind. All sixteen live here.
 *
 * Drag is real, and built on POINTER events with setPointerCapture - never the
 * HTML5 drag-and-drop API, whose `dragstart` does not fire from a finger on
 * Android at all. Tap is a peer of drag and not a fallback: a drag only begins
 * after SLOP pixels on a handle that carries no click of its own, so every tap
 * lands where it always did. Tap, with arrow keys on the same handle, is also
 * what a keyboard and a screen reader get.
 *
 * Owns its own draft and hands the finished response up. `mcq`, `truefalse`
 * and `poll` submit on the tap, because a single choice needs no confirmation;
 * every other kind is built first and sent deliberately, from the dock.
 *
 * Mounted once per question (the parent keys it by question id), so a new
 * question starts from its own saved draft or from blanks, and nothing has to
 * be reset by hand.
 */

import { Fragment, useEffect, useRef, useState } from 'react';

import { clearDraft, readDraft, saveDraft } from '../lib/draft.js';
// One definition. The passage arrives with its markers still in it, so the
// phone must split on the same token the server's validator counted.
import { BLANK_MARK } from '../lib/kinds.js';
import { Button, Icon, Note } from '../ui/index.jsx';
import { Dock } from './parts.jsx';

const KEYS = ['A', 'B', 'C', 'D', 'E', 'F'];

/* How far a finger travels before a press becomes a drag. Under it nothing has
   happened, so a thumb that shifts a pixel getting off a handle does not
   quietly reorder the list. */
const SLOP = 8;

/**
 * Shuffled lists arrive as plain strings in the order this student is to see
 * them, carrying nothing that identifies the original item: for match, order,
 * rank and categorise the original index IS the answer. The server keeps that
 * mapping and recomputes it from the same seed when it scores.
 *
 * So `i` here is the SHOWN POSITION, and the positions sent back are exactly
 * what the server expects to translate.
 */
const asShown = (list) =>
  (Array.isArray(list) ? list : []).map((it, i) => ({ t: typeof it === 'string' ? it : it?.t ?? '', i }));

const moveAt = (list, from, to) => {
  const next = list.slice();
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
};

/** Options short enough to sit two to a row on a wide screen. */
const brief = (options) => options.length > 0 && options.every((o) => String(o).length <= 28);

/** The one action, in the dock. */
function Send({ label, disabled, busy, onClick }) {
  return (
    <Dock>
      <Button variant="primary" size="xl" block busy={busy} disabled={disabled} onClick={onClick}>{label}</Button>
    </Dock>
  );
}

/** A box that is ticked, and after marking says whether it should have been. */
function Box({ tone }) {
  return (
    <span className="ln-box" data-tone={tone} aria-hidden="true">
      {tone === 'no' ? <Icon name="close" size={14} /> : tone ? <Icon name="check" size={14} /> : null}
    </span>
  );
}

/** What the server says the answer was, shown under a marked answer. */
function Key({ label, children }) {
  return (
    <div className="well ln-keybox">
      <span className="t-label">{label}</span>
      {children}
    </div>
  );
}

/**
 * The placed list for `order` and `rank`, reorderable three ways: drag the
 * grip, press the arrow keys on it, or take a row out and tap it back in. Drag
 * is the fastest and the one a screen reader cannot use, which is why it is not
 * the only one.
 *
 * The DOM order never changes while a drag is live: rows are slid with
 * transforms and the array is committed on release. A pointer capture is
 * released the moment its element leaves the document, and re-parenting the row
 * under the finger would do exactly that, halfway through the gesture.
 */
function SortList({ items, seq, locked, hint, onSeq }) {
  const listRef = useRef(null);
  const boxes = useRef([]);      // row rectangles, measured once when a drag starts
  const grab = useRef(null);     // the live gesture: which row, where it began, has it moved
  const [drag, setDrag] = useState(null);
  const [said, setSaid] = useState('');

  const textOf = (pos) => items.find((it) => it.i === pos)?.t ?? '';

  const put = (from, to) => {
    if (locked || to < 0 || to >= seq.length || to === from) return;
    const what = textOf(seq[from]);
    onSeq(moveAt(seq, from, to));
    // Said on screen, for everyone: a keyboard move with no visible
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
    // Which slot the row's middle has been dragged into. Walking outwards from
    // where it started means a row changes slot only when it has crossed a
    // neighbour's midpoint, so it does not flicker between two.
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

  // The browser can take the pointer back mid-gesture: a system edge swipe, a
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
      <p className="hint" role="status">{said || hint}</p>
      <ol className="ln-sort" ref={listRef} data-dragging={drag ? 'true' : undefined}>
        {seq.map((pos, n) => (
          <li key={pos} data-row className="ln-row" data-lift={drag?.n === n ? 'true' : undefined} style={slide(n)}>
            <span className="ln-key">{n + 1}</span>
            <span className="grow wrap-any">{textOf(pos)}</span>
            <button
              type="button"
              className="ln-grip"
              disabled={locked}
              aria-label={`Move ${textOf(pos)}, position ${n + 1} of ${seq.length}. Drag it, or use the up and down arrow keys.`}
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
              <Icon name="grip" />
            </button>
            <button
              type="button"
              className="ln-grip ln-out"
              disabled={locked}
              onClick={() => onSeq(seq.filter((x) => x !== pos))}
              aria-label={`Take ${textOf(pos)} back out`}
            >
              <Icon name="close" />
            </button>
          </li>
        ))}
        {seq.length === 0 && <li className="ln-row ln-ghost">Nothing placed yet</li>}
      </ol>
    </>
  );
}

/**
 * @param sent  the response already submitted for this question, or null. It is
 *              what locks the controls while the answer is being marked, and it
 *              is where the single-tap kinds read which option was tapped.
 * @param busy  an answer is being re-sent after a reconnect.
 */
export default function Answer({ question, result, busy, sent, onSubmit }) {
  const kind = question.kind ?? 'mcq';
  const waiting = busy || (sent !== null && !result);
  const locked = Boolean(result) || waiting;

  /* What this student had already built for this question when the tab died,
     read HERE and not in an effect. An effect runs after paint, so restoring in
     one would show an empty box and fill it a frame later: the student would
     see their work missing and then returning. */
  const [saved] = useState(() => readDraft(question._id));

  /* The five interactive kinds carry no slot of their own, deliberately.
     draft.js re-shapes everything it reads back out of a store the student can
     edit, so every new slot is one more shape it must be taught to distrust.
     Each is one of the shapes already there and already guarded:

       hottext   a set of token indices, like multi   -> chosen
       grid      the set of ticked cells, flattened   -> chosen
       dropdown  one chosen option per gap            -> pairs
       table     one string per cell, holes kept      -> words

     The two rectangular kinds flatten as `row * columns + column`. Only one
     kind is ever on screen, so nothing collides. mcq, truefalse and poll keep
     nothing: they submit on the tap that answers them, so there is no unsent
     state - either the answer reached the server, or the question comes back
     untouched for one more tap. */
  const [chosen, setChosen] = useState(saved.chosen);  // multi, hottext, grid
  const [pairs, setPairs] = useState(saved.pairs);     // match: left -> shown right. dropdown: gap -> shown option
  const [activeLeft, setActiveLeft] = useState(null);
  const [seq, setSeq] = useState(saved.seq);           // order, rank: shown positions in chosen order
  const [typed, setTyped] = useState(saved.typed);     // blank, numeric, open
  const [words, setWords] = useState(saved.words);     // cloze: one per marker. table: one per cell
  const [placed, setPlaced] = useState(saved.placed);  // categorise: shown item -> group
  const [held, setHeld] = useState(null);              // categorise: the item picked up by tap
  const [fly, setFly] = useState(null);                // categorise: the item in the air
  const [said, setSaid] = useState('');                // what just happened, for the hint line

  // Grips are re-parented when an item changes group, so the focused one is a
  // different DOM node afterwards and the keyboard would be dropped mid-sort.
  // Held by item index and refocused after the move.
  const gripRefs = useRef(new Map());
  const wantFocus = useRef(null);
  const dragRef = useRef(null);

  // Everything built and not yet sent, in one shape, so saving never has to
  // ask which kind is on screen.
  const draft = { chosen, pairs, seq, typed, words, placed };

  // The last committed draft, for the flush below. Set in the effect and not
  // during render, so a render React throws away cannot change what is saved.
  const live = useRef(null);

  useEffect(() => {
    live.current = result ? null : { id: question._id, draft };

    /* Marked. The saved copy is now worse than nothing: this question will not
       be served again, so anything left behind could only surface under an
       answer that is already decided. */
    if (result) { clearDraft(question._id); return undefined; }

    /* Debounced: this runs on every keystroke, and a localStorage write is
       synchronous on the thread that is drawing the letters. On the phones this
       is built for, saving per character is a stutter mid-sentence. */
    const t = setTimeout(() => saveDraft(question._id, draft), 400);
    return () => clearTimeout(t);
  }, [question._id, result, chosen, pairs, seq, typed, words, placed]); // not `draft`: new object every render

  useEffect(() => {
    /* A debounce is a timer, and a closing tab never runs its timers.
       `pagehide` is the last event a page reliably hears on a phone (iOS Safari
       does not fire `beforeunload`), so the final keystrokes are written here. */
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
    const options = question.options ?? [];
    const stateOf = (i) => {
      if (!result) return sent === i ? 'pick' : undefined;
      if (i === solution) return 'yes';
      if (i === sent) return 'no';
      return 'dim';
    };
    return (
      <div className="ln-opts" data-cols={brief(options) ? '2' : undefined}>
        {options.map((o, i) => {
          const s = stateOf(i);
          return (
            <button key={i} type="button" className="ln-opt" data-state={s} disabled={locked} onClick={() => onSubmit(i)}>
              <span className="ln-key" aria-hidden="true">
                {s === 'yes' ? <Icon name="check" size={14} /> : s === 'no' ? <Icon name="close" size={14} /> : KEYS[i]}
              </span>
              <span className="ln-opt-t">
                <span className="wrap-any">{o}</span>
                {s === 'yes' && <span className="ln-tag">Correct answer</span>}
                {s === 'no' && <span className="ln-tag">Your answer</span>}
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  /* ---------------------------------------------------------- truefalse --- */
  if (kind === 'truefalse') {
    // Two targets, half the screen each. The item text is a statement (the
    // contract refuses a question mark here), so these two are the interaction.
    const stateOf = (v) => {
      if (!result) return sent === v ? 'pick' : undefined;
      if (v === solution) return 'yes';
      if (v === sent) return 'no';
      return 'dim';
    };
    return (
      <div className="ln-opts ln-two">
        {[true, false].map((v) => {
          const s = stateOf(v);
          return (
            <button key={String(v)} type="button" className="ln-opt ln-big" data-state={s} disabled={locked} onClick={() => onSubmit(v)}>
              <span>{v ? 'True' : 'False'}</span>
              {s === 'yes' && <span className="ln-tag"><Icon name="check" size={14} />Correct answer</span>}
              {s === 'no' && <span className="ln-tag"><Icon name="close" size={14} />Your answer</span>}
            </button>
          );
        })}
      </div>
    );
  }

  /* --------------------------------------------------------------- poll --- */
  if (kind === 'poll') {
    /* Nothing here is right or wrong, so nothing here is green or red. The
       chosen option keeps the ink outline that means "the one you picked" and
       the rest go quiet. `yes` would be the worse lie of the two: a student
       told they were correct about their own opinion learns that this product
       hands out ticks for tapping.

       The server scores every well-formed poll answer as correct so the
       "answer landed" path is the one every kind takes; what keeps that out of
       the student's eyes is this branch and the suppressed verdict above it. */
    const options = question.options ?? [];
    return (
      <>
        {/* Said before and after, because those are two worries. Before: "what
            if I pick the wrong one". After: "did I just get something wrong". */}
        <Note icon="users" role="status">
          {result
            ? 'Your answer is in. This one was not marked: there was no right answer, and it has not moved your level.'
            : 'This one is not marked. There is no right answer and nothing to get wrong: the room is being asked what it thinks, and your level does not move.'}
        </Note>
        {/* Never two columns. A poll's options are usually a scale, which is
            why the server will not shuffle them, and a scale broken across two
            columns stops reading as one. */}
        <div className="ln-opts">
          {options.map((o, i) => (
            <button
              key={i}
              type="button"
              className="ln-opt"
              data-state={sent === i ? 'pick' : result ? 'dim' : undefined}
              disabled={locked}
              onClick={() => onSubmit(i)}
            >
              <span className="ln-key" aria-hidden="true">{KEYS[i]}</span>
              <span className="ln-opt-t">
                <span className="wrap-any">{o}</span>
                {result && sent === i && <span className="ln-tag">Your answer</span>}
              </span>
            </button>
          ))}
        </div>
      </>
    );
  }

  /* -------------------------------------------------------------- multi --- */
  if (kind === 'multi') {
    const options = question.options ?? [];
    const want = Array.isArray(solution) ? solution : [];
    const stateOf = (i) => {
      const mine = chosen.includes(i);
      if (!result) return mine ? 'pick' : undefined;
      if (want.includes(i)) return 'yes';
      if (mine) return 'no';
      return 'dim';
    };
    const boxOf = (i) => {
      const mine = chosen.includes(i);
      if (!result) return mine ? 'on' : undefined;
      if (want.includes(i)) return mine ? 'yes' : 'miss';
      return mine ? 'no' : undefined;
    };
    return (
      <>
        <div className="ln-opts" data-cols={brief(options) ? '2' : undefined}>
          {options.map((o, i) => (
            <button
              key={i}
              type="button"
              className="ln-opt"
              data-state={stateOf(i)}
              disabled={locked}
              aria-pressed={chosen.includes(i)}
              onClick={() => setChosen((c) => (c.includes(i) ? c.filter((x) => x !== i) : [...c, i]))}
            >
              <Box tone={boxOf(i)} />
              <span className="ln-opt-t">
                <span className="wrap-any">{o}</span>
                {result && want.includes(i) && <span className="ln-tag">Correct answer</span>}
              </span>
            </button>
          ))}
        </div>
        {!result && (
          <Send
            label={chosen.length ? `Submit ${chosen.length} selected` : 'Choose all that apply'}
            disabled={chosen.length === 0}
            busy={waiting}
            onClick={() => onSubmit(chosen)}
          />
        )}
      </>
    );
  }

  /* ------------------------------------------------------------ hottext --- */
  if (kind === 'hottext') {
    const tokens = question.tokens ?? [];
    const want = Array.isArray(solution) ? solution : null;

    /* Four states, only once the answer is in: the words they found, the words
       they picked that were not it, the ones they missed, and the rest of the
       sentence, which stays plain. Dimming the untouched words would leave the
       sentence unreadable exactly when the student is trying to see what the
       right answer looked like in it. */
    const toneOf = (i) => {
      const mine = chosen.includes(i);
      if (!result || !want) return mine ? 'on' : undefined;
      if (want.includes(i)) return mine ? 'yes' : 'miss';
      return mine ? 'no' : undefined;
    };

    return (
      <>
        {/* Selecting words with the criterion off screen is unanswerable: pick
            the words that WHAT? It stays up after the answer because it is what
            the selection meant. Label and value, not a sentence built around
            the teacher's wording, which is as likely to be a noun phrase. */}
        <div className="ln-crit">
          <span className="t-small muted">What to pick</span>
          <b>{question.criterion ?? ''}</b>
        </div>

        {/* The sentence in its own order, never shuffled. Every word is its own
            button, because a thumb needs a box. */}
        <div className="ln-toks">
          {tokens.map((t, i) => (
            <button
              key={i}
              type="button"
              className="ln-tok"
              data-tone={toneOf(i)}
              disabled={locked}
              aria-pressed={chosen.includes(i)}
              onClick={() => setChosen((c) => (c.includes(i) ? c.filter((x) => x !== i) : [...c, i]))}
            >
              {t}
            </button>
          ))}
        </div>

        {result && want && (
          <p className="hint">
            The words that answered it are outlined. Anything you picked that is not one of them is struck through.
          </p>
        )}

        {!result && (
          // Sent in reading order, not tap order. The server scores it as a set
          // either way; sorted is what a human can read in a log.
          <Send
            label={chosen.length === 0 ? 'Tap the words above' : chosen.length === 1 ? 'Submit 1 word' : `Submit ${chosen.length} words`}
            disabled={chosen.length === 0}
            busy={waiting}
            onClick={() => onSubmit([...chosen].sort((a, b) => a - b))}
          />
        )}
      </>
    );
  }

  /* -------------------------------------------------------------- match --- */
  if (kind === 'match') {
    const left = question.left ?? [];
    const right = asShown(question.right);
    const usedRight = new Set(Object.values(pairs));
    // Which item on the left a match is paired with: the letter it shows.
    const mateOf = (pos) => {
      const li = Object.keys(pairs).find((k) => pairs[k] === pos);
      return li === undefined ? null : Number(li);
    };

    const tapLeft = (li) => {
      if (locked) return;
      if (pairs[li] !== undefined) {
        setPairs((p) => { const n = { ...p }; delete n[li]; return n; });
        setActiveLeft(li);
        return;
      }
      setActiveLeft(activeLeft === li ? null : li);
    };
    const tapRight = (pos) => {
      if (locked || activeLeft === null) return;
      setPairs((p) => ({ ...p, [activeLeft]: pos }));
      setActiveLeft(null);
    };

    const answer = left.map((_, li) => (pairs[li] === undefined ? -1 : pairs[li]));
    const complete = answer.every((v) => v >= 0);

    if (result) {
      return (
        <>
          <p className="hint">The correct pairing is shown.</p>
          <ol className="ln-pairs">
            {left.map((t, li) => {
              // solution[li] is the SHOWN position of the item that belongs to
              // left li. It arrives with the result and never before it.
              const truthPos = Array.isArray(solution) ? solution[li] : undefined;
              const ok = pairs[li] === truthPos;
              return (
                <li key={li} className="ln-pair" data-tone={ok ? 'yes' : 'no'}>
                  <span className="ln-key">{KEYS[li]}</span>
                  <div className="ln-pair-t">
                    <span className="strong wrap-any">{t}</span>
                    <span className="ln-mate">
                      <Icon name={ok ? 'check' : 'close'} size={14} />
                      <span className="wrap-any">{right[pairs[li]]?.t ?? 'No match chosen'}</span>
                    </span>
                    {!ok && (
                      <span className="ln-mate ln-truth">
                        <Icon name="check" size={14} />
                        <span className="wrap-any">{right[truthPos]?.t ?? ''}</span>
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      );
    }

    return (
      <>
        <p className="hint" role="status">
          {activeLeft === null ? 'Tap an item on the left, then its match.' : 'Now tap its match.'}
        </p>
        {/* Side by side even on a phone, with a letter on both halves of a
            pair: stacked, the two lists are ten identical tiles and a scroll
            between every tap. */}
        <div className="ln-match">
          <div className="ln-col">
            {left.map((t, li) => (
              <button
                key={li}
                type="button"
                className="ln-tile"
                data-state={activeLeft === li ? 'pick' : pairs[li] !== undefined ? 'done' : undefined}
                disabled={locked}
                aria-pressed={activeLeft === li}
                onClick={() => tapLeft(li)}
              >
                <span className="ln-key" aria-hidden="true">{KEYS[li]}</span>
                <span className="wrap-any">{t}</span>
              </button>
            ))}
          </div>
          <div className="ln-col">
            {right.map((r) => {
              const mate = mateOf(r.i);
              return (
                <button
                  key={r.i}
                  type="button"
                  className="ln-tile"
                  data-state={mate !== null ? 'done' : undefined}
                  disabled={locked || usedRight.has(r.i)}
                  aria-label={mate !== null ? `${r.t}, matched to ${left[mate]}` : undefined}
                  onClick={() => tapRight(r.i)}
                >
                  <span className="ln-key" aria-hidden="true">{mate !== null ? KEYS[mate] : ''}</span>
                  <span className="wrap-any">{r.t}</span>
                </button>
              );
            })}
          </div>
        </div>
        <Send
          label={complete ? 'Submit pairs' : `${answer.filter((v) => v >= 0).length} of ${left.length} paired`}
          disabled={!complete}
          busy={waiting}
          onClick={() => onSubmit(answer)}
        />
      </>
    );
  }

  /* --------------------------------------------------------- categorise --- */
  if (kind === 'categorise') {
    const groups = question.groups ?? [];
    const items = asShown(question.items);
    // One group index per SHOWN item position, so it indexes straight.
    const truth = Array.isArray(solution) ? solution : null;

    const textOf = (pos) => items.find((it) => it.i === pos)?.t ?? '';
    const pool = items.filter((it) => placed[it.i] === undefined);
    const inGroup = (g) => items.filter((it) => placed[it.i] === g);

    // -1 is the tray. One code path puts an item anywhere, so tap, drag and
    // the arrow keys cannot drift apart.
    const place = (pos, g) => {
      if (locked) return;
      setPlaced((p) => {
        const next = { ...p };
        if (g < 0) delete next[pos]; else next[pos] = g;
        return next;
      });
      setHeld(null);
      setSaid(g < 0 ? `${textOf(pos)} taken back out.` : `${textOf(pos)} put in ${groups[g]}.`);
    };

    // The same two-step tap match uses: pick a thing up, then say where it
    // goes. Tapping something already placed lifts it out and keeps hold of
    // it, so a mistake is one tap to fix and not two.
    const tapItem = (pos) => {
      if (locked) return;
      if (placed[pos] !== undefined) { place(pos, -1); setHeld(pos); return; }
      setHeld(held === pos ? null : pos);
    };
    const tapBin = (g) => { if (!locked && held !== null) place(held, g); };

    const gripDown = (pos) => (e) => {
      if (locked || e.button > 0) return;
      dragRef.current = { pos, x0: e.clientX, y0: e.clientY, live: false };
      e.currentTarget.setPointerCapture?.(e.pointerId);
    };
    const gripMove = (e) => {
      const d = dragRef.current;
      if (!d) return;
      if (!d.live && Math.abs(e.clientX - d.x0) < SLOP && Math.abs(e.clientY - d.y0) < SLOP) return;
      d.live = true;
      // Hit-tested, not measured, so a group that moved because the tray above
      // it emptied is found where it is. The flyer is inert to pointers, or it
      // would be the only thing this ever hits.
      const bin = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-bin]');
      setFly({ pos: d.pos, x: e.clientX, y: e.clientY, over: bin ? Number(bin.dataset.bin) : null });
    };
    const gripUp = () => {
      const d = dragRef.current;
      dragRef.current = null;
      if (d?.live && fly && fly.over !== null) place(d.pos, fly.over);
      setFly(null);
    };
    const gripCancel = () => { dragRef.current = null; setFly(null); };

    const gripKeys = (pos) => (e) => {
      if (locked) return;
      const step = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1
        : (e.key === 'ArrowLeft' || e.key === 'ArrowUp') ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      const from = placed[pos] === undefined ? -1 : placed[pos];
      const to = Math.max(-1, Math.min(groups.length - 1, from + step));
      if (to === from) return;
      wantFocus.current = pos;
      place(pos, to);
    };

    const toneOf = (it) => {
      if (!result || !truth) return undefined;
      return truth[it.i] === placed[it.i] ? 'yes' : 'no';
    };

    const chip = (it) => {
      const tone = toneOf(it);
      return (
        <div
          key={it.i}
          className="ln-item"
          data-state={held === it.i ? 'pick' : undefined}
          data-flying={fly?.pos === it.i ? 'true' : undefined}
          data-tone={tone}
        >
          <button
            type="button"
            className="ln-grip"
            disabled={locked}
            ref={(el) => { if (el) gripRefs.current.set(it.i, el); }}
            aria-label={`Move ${it.t}. ${placed[it.i] === undefined ? 'Not in a group yet' : `In ${groups[placed[it.i]]}`}. Drag it, or use the arrow keys.`}
            onPointerDown={gripDown(it.i)}
            onPointerMove={gripMove}
            onPointerUp={gripUp}
            onPointerCancel={gripCancel}
            onKeyDown={gripKeys(it.i)}
          >
            <Icon name="grip" />
          </button>
          <button type="button" className="ln-item-t" disabled={locked} aria-pressed={held === it.i} onClick={() => tapItem(it.i)}>
            {tone && <Icon name={tone === 'yes' ? 'check' : 'close'} size={14} />}
            <span className="ln-opt-t">
              <span className="wrap-any">{it.t}</span>
              {tone === 'no' && <span className="ln-tag">Belongs in {groups[truth[it.i]]}</span>}
            </span>
          </button>
        </div>
      );
    };

    return (
      <>
        <p className="hint" role="status">
          {/* The result outranks the running commentary: `said` still holds
              the last move, and next to a marked answer that reads as if the
              marking were still going on. */}
          {result
            ? 'Where each one belonged is shown.'
            : said || (held === null
              ? 'Tap an item, then the group it belongs in. Or drag it there by the handle.'
              : 'Now tap its group.')}
        </p>

        {/* The tray is a drop target too, so a drag can undo itself. */}
        <div className="ln-tray" data-bin="-1" data-over={fly?.over === -1 ? 'true' : undefined}>
          {pool.length === 0
            ? <span className="t-small muted">Everything is in a group.</span>
            : pool.map(chip)}
        </div>

        <div className="ln-bins">
          {groups.map((g, gi) => (
            <section key={g} className="ln-bin" data-bin={gi} data-over={fly?.over === gi ? 'true' : undefined}>
              <button type="button" className="ln-bin-head" disabled={locked} onClick={() => tapBin(gi)}>
                <span className="strong grow wrap-any">{g}</span>
                {held !== null && !locked
                  ? <span className="ln-tag">Put it here</span>
                  : <span className="mono muted">{inGroup(gi).length}</span>}
              </button>
              <div className="ln-bin-items">
                {inGroup(gi).map(chip)}
                {inGroup(gi).length === 0 && <span className="t-small muted">Nothing here yet</span>}
              </div>
            </section>
          ))}
        </div>

        {/* Follows the finger above it, not under it: a thumb covers the tile
            it is carrying, and nobody can aim what they cannot see. */}
        {fly && (
          <div className="ln-flyer" style={{ left: fly.x, top: fly.y }} aria-hidden="true">
            {textOf(fly.pos)}
          </div>
        )}

        {/* With an item in hand the next thing to do is name its group, and on
            a phone the groups are a scroll away below the tray. So while one is
            held the dock offers them, under the thumb. */}
        {!result && held !== null && !locked ? (
          <Dock>
            <p className="t-small muted clip">Put {textOf(held)} in</p>
            <div className="ln-put" data-many={groups.length > 3 ? 'true' : undefined}>
              {groups.map((g, gi) => (
                <Button key={g} size="lg" onClick={() => place(held, gi)}><span className="clip">{g}</span></Button>
              ))}
            </div>
          </Dock>
        ) : !result && (
          <Send
            label={pool.length > 0 ? `${items.length - pool.length} of ${items.length} sorted` : 'Submit groups'}
            disabled={pool.length > 0}
            busy={waiting}
            onClick={() => onSubmit(placed)}
          />
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
        {/* Ranking with the criterion off screen is unanswerable: ordered by
            WHAT? It stays up after the answer because it is what the order
            meant. */}
        {criterion && (
          <div className="ln-crit">
            <span className="t-small muted">Rank by</span>
            <b>{criterion}</b>
          </div>
        )}

        {result && truth ? (
          <>
            <p className="hint">The correct order is shown.</p>
            <ol className="ln-sort">
              {truth.map((t, n) => (
                <li key={n} className="ln-row">
                  <span className="ln-key">{n + 1}</span>
                  <span className="grow wrap-any">{t}</span>
                </li>
              ))}
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
            {/* What is still to be placed: things moved into a sequence, not
                answers being chosen. */}
            {rest.length > 0 && (
              <div className="ln-pool">
                {rest.map((it) => (
                  <button key={it.i} type="button" className="ln-tile" disabled={locked} onClick={() => setSeq((s) => [...s, it.i])}>
                    <span className="ln-key" aria-hidden="true"><Icon name="plus" size={14} /></span>
                    <span className="wrap-any">{it.t}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {!result && (
          <Send
            label={rest.length > 0
              ? `${seq.length} of ${items.length} placed`
              : kind === 'rank' ? 'Submit ranking' : 'Submit order'}
            disabled={rest.length > 0}
            busy={waiting}
            onClick={() => onSubmit(seq)}
          />
        )}
      </>
    );
  }

  /* -------------------------------------------------------------- cloze --- */
  if (kind === 'cloze') {
    const parts = String(question.text ?? '').split(BLANK_MARK);
    const marks = parts.length - 1;
    // A passage whose markers went missing is still answerable: one box per
    // blank the server says it has, not a sentence with nowhere to type.
    const count = marks > 0 ? marks : Number(question.blankCount) || 0;
    const filled = Array.from({ length: count }).filter((_, i) => String(words[i] ?? '').trim()).length;

    const box = (i) => (
      <input
        key={`b${i}`}
        className="input ln-gap"
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
        {/* The passage IS the interaction, so the boxes sit in the sentence: a
            student reading a gap can see what has to fit in it. */}
        {marks > 0 ? (
          <p className="ln-passage">
            {parts.map((part, i) => <Fragment key={i}>{part}{i < marks && box(i)}</Fragment>)}
          </p>
        ) : (
          <div className="stack stack-2">{Array.from({ length: count }).map((_, i) => box(i))}</div>
        )}

        {result && (
          <Key label="Accepted answers">
            <ol className="ln-list">{(Array.isArray(solution) ? solution : []).map((s, i) => <li key={i}>{s}</li>)}</ol>
          </Key>
        )}

        {!result && (
          // Every blank is scored on its own, so two of three is not held
          // hostage by the one they cannot get.
          <Send
            label={filled === count ? 'Submit answers' : `Submit ${filled} of ${count}`}
            disabled={filled === 0}
            busy={waiting}
            onClick={() => onSubmit(Array.from({ length: count }, (_, i) => words[i] ?? ''))}
          />
        )}
      </>
    );
  }

  /* ----------------------------------------------------------- dropdown --- */
  if (kind === 'dropdown') {
    const parts = String(question.text ?? '').split(BLANK_MARK);
    const marks = parts.length - 1;
    const gaps = Array.isArray(question.gaps) ? question.gaps : [];
    // Same fallback as cloze: missing markers become a stack of gaps.
    const count = marks > 0 ? marks : gaps.length;
    const answer = Array.from({ length: count }, (_, i) => (pairs[i] === undefined ? -1 : pairs[i]));
    const answered = answer.filter((v) => v >= 0).length;
    const truth = Array.isArray(solution) ? solution : null;

    /* The options arrive already shuffled, per gap, on the gap's own seed, so
       the position sent back IS the answer as far as this phone knows. `truth`
       comes back in the same shown space, which is what makes the comparison
       below legitimate and not the client marking its own work. */
    const gap = (i) => {
      const options = gaps[i]?.options ?? [];
      const mine = pairs[i];
      const tone = !result || truth?.[i] === undefined ? undefined : mine === truth[i] ? 'yes' : 'no';
      return (
        <Fragment key={`g${i}`}>
          <select
            className="select ln-gap"
            data-tone={tone}
            disabled={locked}
            /* Empty until they choose. A select that opens on its first option
               has answered for them, and a skipped gap would be recorded as
               whatever was shuffled into first place. */
            value={mine === undefined ? '' : String(mine)}
            aria-label={`Gap ${i + 1} of ${count}`}
            onChange={(e) => setPairs((p) => ({ ...p, [i]: Number(e.target.value) }))}
          >
            <option value="" disabled>Choose</option>
            {options.map((o, pos) => <option key={pos} value={pos}>{o}</option>)}
          </select>
          {/* A sign as well as a colour, for anyone who cannot tell the two apart. */}
          {tone && <Icon name={tone === 'yes' ? 'check' : 'close'} size={14} className={`ln-sign ln-sign-${tone}`} />}
        </Fragment>
      );
    };

    return (
      <>
        {marks > 0 ? (
          <p className="ln-passage">
            {parts.map((part, i) => <Fragment key={i}>{part}{i < marks && gap(i)}</Fragment>)}
          </p>
        ) : (
          <div className="stack stack-2">{Array.from({ length: count }).map((_, i) => gap(i))}</div>
        )}

        {result && truth && (
          <Key label="The word for each gap">
            {/* Positions turned back into words with the list this phone was
                handed, so the key reads as the passage and not as numbers. */}
            <ol className="ln-list">{truth.map((pos, i) => <li key={i}>{gaps[i]?.options?.[pos] ?? ''}</li>)}</ol>
          </Key>
        )}

        {!result && (
          // Scored per gap, like cloze.
          <Send
            label={answered === count ? 'Submit answers' : `Submit ${answered} of ${count}`}
            disabled={answered === 0}
            busy={waiting}
            onClick={() => onSubmit(answer)}
          />
        )}
      </>
    );
  }

  /* -------------------------------------------------------------- table --- */
  if (kind === 'table') {
    const columns = question.columns ?? [];
    const rows = question.rows ?? [];
    const wide = Math.max(1, columns.length);
    // One flat slot per cell, so the draft is the `words` list cloze uses.
    // Real coordinates on the wire, because a table is never shuffled: its
    // headings are what make a cell answerable at all.
    const at = (ri, ci) => ri * wide + ci;
    const cellAt = (ri, ci) => `${ri}:${ci}`;
    const textAt = (ri, ci) => words[at(ri, ci)] ?? '';
    const truth = result && solution && typeof solution === 'object' && !Array.isArray(solution) ? solution : null;

    const blanks = [];
    rows.forEach((r, ri) => (r.cells ?? []).forEach((c, ci) => { if (c.blank) blanks.push([ri, ci]); }));
    const filled = blanks.filter(([ri, ci]) => String(textAt(ri, ci)).trim()).length;

    return (
      <>
        <p className="hint">
          {result
            ? 'The accepted answer for each cell is under what you wrote.'
            : 'Fill in the empty cells. The rows already filled in show you the rule.'}
          {/* A phone hides its scrollbars, and a column nobody found is a cell
              nobody filled. */}
          {!result && columns.length > 2 && <span className="ln-narrow"> The table scrolls sideways.</span>}
        </p>

        {/* A real table, not a stack of labelled rows: the pattern down a
            column is the reason completing a table is Apply and not recall. It
            scrolls sideways with the row headings pinned when it will not fit. */}
        <div className="card tbl-wrap">
          <table className="tbl ln-table">
            <thead>
              <tr>
                <td />
                {columns.map((c) => <th key={c} scope="col">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={r.header}>
                  <th scope="row">{r.header}</th>
                  {(r.cells ?? []).map((c, ci) => (
                    <td key={ci}>
                      {!c.blank ? c.given : result ? (
                        /* No tick or cross per cell. A blank accepts several
                           answers and only the first travels back, so a phone
                           comparing the two would mark a synonym wrong that
                           the server accepted. The count in the verdict is the
                           mark; this is only the key. */
                        <span className="ln-cell">
                          <b>{String(textAt(ri, ci)).trim() || '—'}</b>
                          {truth?.[cellAt(ri, ci)] !== undefined && <span className="muted">{truth[cellAt(ri, ci)]}</span>}
                        </span>
                      ) : (
                        <input
                          className="input"
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
          // procedure demonstrated.
          <Send
            label={filled === blanks.length ? 'Submit the table' : `Submit ${filled} of ${blanks.length} cells`}
            disabled={filled === 0}
            busy={waiting}
            onClick={() => onSubmit(Object.fromEntries(blanks.map(([ri, ci]) => [cellAt(ri, ci), textAt(ri, ci)])))}
          />
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
    // The key comes back as "row:column" strings for the true intersections:
    // the server's answer, not a judgement made here.
    const want = Array.isArray(solution) ? new Set(solution) : null;
    const ticked = (ri, ci) => chosen.includes(at(ri, ci));

    const toneOf = (ri, ci) => {
      const mine = ticked(ri, ci);
      if (!result || !want) return mine ? 'on' : undefined;
      if (want.has(cellAt(ri, ci))) return mine ? 'yes' : 'miss';
      return mine ? 'no' : undefined;
    };

    /* Bounded before it is sent. `chosen` is restored from a store the student
       can edit, and a flat index off the end of the board would arrive as a
       coordinate for a row that does not exist. */
    const cells = rows.length * wide;
    const answer = Object.fromEntries(
      chosen.filter((n) => n >= 0 && n < cells).map((n) => [`${Math.floor(n / wide)}:${n % wide}`, true]),
    );
    const count = Object.keys(answer).length;

    return (
      <>
        <p className="hint">
          {result
            ? 'A filled tick is one you found, a cross is one that should not be ticked, an outlined tick is one you missed.'
            : 'Tick every box where the row and the column go together.'}
          {!result && columns.length > 3 && <span className="ln-narrow"> The grid scrolls sideways.</span>}
        </p>

        {/* Every intersection is its own yes-or-no, so the server marks what
            was ticked AND what was rightly left alone. A box left alone is an
            answer, and the whole cell is the target, not the box inside it. */}
        <div className="card tbl-wrap">
          <table className="tbl ln-table ln-grid">
            <thead>
              <tr>
                <td />
                {columns.map((c) => <th key={c} scope="col">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={r}>
                  <th scope="row">{r}</th>
                  {columns.map((c, ci) => (
                    <td key={c}>
                      <label className="ln-cellbox">
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={ticked(ri, ci)}
                          disabled={locked}
                          aria-label={`${r}, ${c}`}
                          onChange={() => setChosen((s) => (s.includes(at(ri, ci))
                            ? s.filter((x) => x !== at(ri, ci))
                            : [...s, at(ri, ci)]))}
                        />
                        <Box tone={toneOf(ri, ci)} />
                      </label>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!result && (
          <Send
            label={count === 0 ? 'Tick the boxes above' : `Submit ${count} ticked`}
            disabled={count === 0}
            busy={waiting}
            onClick={() => onSubmit(answer)}
          />
        )}
      </>
    );
  }

  /* ---------------------------------------------- numeric / blank / open --- */
  const ready = Boolean(typed.trim());
  // The dock can sit under the phone's keyboard, so on the two one-line kinds
  // the keyboard's own enter key sends as well.
  const send = (e) => { e.preventDefault(); if (ready && !locked) onSubmit(typed); };
  // One answer, right or wrong, so the field itself can carry the mark.
  const typedTone = result ? (result.correct ? 'yes' : 'no') : undefined;

  if (kind === 'numeric') {
    return (
      <>
        <form className="ln-value" onSubmit={send}>
          {/* A decimal keypad on a text field, never type="number": the scorer
              strips spaces and commas so "3,000" is right, and a number input
              would refuse the comma before the server saw it. */}
          <input
            className="input input-lg ln-typed" data-tone={typedTone}
            value={typed} disabled={locked} type="text" inputMode="decimal" enterKeyHint="send"
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Your answer" aria-label="Your answer" autoComplete="off"
          />
          {question.unit && <span className="mono">{question.unit}</span>}
        </form>

        {result && (
          <Key label="The value">
            <b>{String(solution ?? '')}{question.unit ? ` ${question.unit}` : ''}</b>
          </Key>
        )}

        {!result && <Send label="Submit answer" disabled={!ready} busy={waiting} onClick={() => onSubmit(typed)} />}
      </>
    );
  }

  const isOpen = kind === 'open';
  return (
    <>
      {isOpen && question.hint && <p className="hint">{question.hint}</p>}
      {isOpen ? (
        <textarea
          className="textarea ln-open" value={typed} disabled={locked} rows={6}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="Your answer, in your own words" aria-label="Your answer"
        />
      ) : (
        <form onSubmit={send}>
          <input
            className="input input-lg ln-typed" data-tone={typedTone} value={typed} disabled={locked} enterKeyHint="send"
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Type your answer" aria-label="Your answer" autoComplete="off" autoCorrect="off"
          />
        </form>
      )}

      {result && (
        <Key label={isOpen ? 'Points a full answer makes' : 'Accepted answer'}>
          {isOpen
            ? <ul className="ln-list">{(Array.isArray(solution) ? solution : []).map((p, i) => <li key={i}>{p}</li>)}</ul>
            : <b>{String(solution ?? '')}</b>}
        </Key>
      )}

      {!result && <Send label="Submit answer" disabled={!ready} busy={waiting} onClick={() => onSubmit(typed)} />}
    </>
  );
}
