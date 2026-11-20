/**
 * label: put labels on the numbered parts of a figure (or regions of a
 * picture). Sends `{ zone token: label index }`, the index being the label's
 * position in `question.labels` as shown (extras included); after marking,
 * result.solution is the same map, right.
 *
 * Three ways, one code path (put): tap a label then a part (or a part then a
 * label), or drag a label onto a part, on the figure or in the list. A part
 * that has a label gives it back on a tap, held, so moving it is one more tap;
 * the cross takes it off; the arrow keys on a part move its label to the part
 * above or below. The numbered pins on the drawing are for a finger; the list
 * under it is the same parts, and is what a keyboard and a screen reader use.
 */

import { useEffect, useRef, useState } from 'react';

import { Icon } from '../../ui/index.jsx';
import { Send } from '../Answer.jsx';
import { Board, useBoard } from './Hotspot.jsx';

/* As Answer.jsx: a press becomes a drag only past this many pixels. */
const SLOP = 8;
const TRAY = '-';

export default function Label({ question, result, locked, busy, onSubmit }) {
  const zones = question.zones ?? [];
  const labels = question.labels ?? [];
  const board = useBoard(question.stimulus, zones);
  const [placed, setPlaced] = useState({});  // zone token -> label index
  const [held, setHeld] = useState(null);    // a label picked up
  const [aim, setAim] = useState(null);      // a part tapped first
  const [said, setSaid] = useState('');
  const [fly, setFly] = useState(null);
  const drag = useRef(null);
  const quiet = useRef(0);                   // no tap straight after a drag ends
  const rowRefs = useRef(new Map());
  const wantFocus = useRef(null);

  useEffect(() => {
    const z = wantFocus.current;
    if (z === null) return;
    wantFocus.current = null;
    rowRefs.current.get(z)?.focus();
  });

  if (!question.stimulus) return <p className="ln-hint">This question's figure did not arrive.</p>;

  // Before the drawing is measured the list keeps the server's order.
  const rows = board.geo ?? zones.map((z, i) => ({ zone: z.zone, n: i + 1, x: null, where: '' }));
  const numOf = (t) => rows.find((g) => g.zone === t)?.n ?? '';
  const sol = result?.solution && typeof result.solution === 'object' && !Array.isArray(result.solution) ? result.solution : null;
  const toneOf = (t) => (result && sol ? (placed[t] === sol[t] ? 'yes' : 'no') : undefined);
  const used = new Set(Object.values(placed));
  const free = labels.map((_, i) => i).filter((i) => !used.has(i));
  const count = Object.keys(placed).length;
  const complete = zones.length > 0 && count === zones.length;

  /** Label li onto part t (null: back among the labels). Whatever was on t goes back. */
  const put = (li, t) => {
    if (locked) return;
    const before = t === null ? undefined : placed[t];
    setPlaced((p) => {
      const n = {};
      for (const [z, l] of Object.entries(p)) if (l !== li && z !== t) n[z] = l;
      if (t !== null) n[t] = li;
      return n;
    });
    setHeld(null);
    setAim(null);
    setSaid(t === null
      ? `${labels[li]} taken off.`
      : `${labels[li]} put on part ${numOf(t)}.${before !== undefined && before !== li ? ` ${labels[before]} went back to the labels.` : ''}`);
  };

  const tapLabel = (li) => {
    if (locked || Date.now() < quiet.current) return;
    if (aim !== null) { put(li, aim); return; }
    setHeld(held === li ? null : li);
    setSaid('');
  };

  const tapPart = (g) => {
    if (locked) return;
    if (held !== null) { put(held, g.zone); return; }
    const cur = placed[g.zone];
    if (cur !== undefined) {
      // Picked back up, so moving it is one more tap.
      setPlaced((p) => { const n = { ...p }; delete n[g.zone]; return n; });
      setHeld(cur);
      setAim(null);
      setSaid(`${labels[cur]} lifted off part ${g.n}. Tap the part it names, or tap the label to leave it off.`);
      return;
    }
    setAim(aim === g.zone ? null : g.zone);
    setSaid('');
  };

  // Up and down on a part with a label move the label to the next part, swapping.
  const keys = (k) => (e) => {
    const d = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
    const from = rows[k];
    const to = rows[k + d];
    if (!d || locked || !to) return;
    const a = placed[from.zone];
    if (a === undefined) return;
    e.preventDefault();
    const b = placed[to.zone];
    setPlaced((p) => {
      const n = { ...p, [to.zone]: a };
      if (b === undefined) delete n[from.zone]; else n[from.zone] = b;
      return n;
    });
    wantFocus.current = to.zone;
    setSaid(`${labels[a]} moved to part ${to.n}.${b !== undefined ? ` ${labels[b]} moved to part ${from.n}.` : ''}`);
  };

  const down = (li) => (e) => {
    if (locked || e.button > 0) return;
    drag.current = { li, x0: e.clientX, y0: e.clientY, live: false, over: null };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const move = (e) => {
    const d = drag.current;
    if (!d) return;
    if (!d.live && Math.abs(e.clientX - d.x0) < SLOP && Math.abs(e.clientY - d.y0) < SLOP) return;
    d.live = true;
    // Hit-tested where the finger is: a pin on the figure or a part's row.
    const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-fk-drop]');
    d.over = hit ? hit.dataset.fkDrop : null;
    setFly({ li: d.li, x: e.clientX, y: e.clientY, over: d.over });
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    setFly(null);
    if (!d?.live) return;
    quiet.current = Date.now() + 350;
    if (d.over && d.over !== TRAY) put(d.li, d.over);
  };
  const cancel = () => { drag.current = null; setFly(null); };

  const rowName = (g) => {
    const li = placed[g.zone];
    const where = g.where ? `, ${g.where}` : '';
    const now = li === undefined ? 'no label yet' : labels[li];
    const next = held !== null ? `. Put ${labels[held]} here` : '';
    return `Part ${g.n}${where}: ${now}${next}`;
  };

  return (
    <>
      <Board stimulus={question.stimulus} board={board}>
        {(geo, box) => (
          <>
            {board.isImage && (
              <svg className="fk-lab-shapes" width={box.width} height={box.height} aria-hidden="true">
                {geo.filter((g) => g.points).map((g) => (
                  <polygon key={g.zone} points={g.points.map((p) => p.join(',')).join(' ')} />
                ))}
              </svg>
            )}
            {geo.filter((g) => g.x !== null).map((g) => (
              // A finger's way in; the list below is the same parts, by keyboard.
              <button
                key={g.zone}
                type="button"
                tabIndex={-1}
                aria-hidden="true"
                className="fk-lab-pin"
                data-fk-drop={g.zone}
                data-has={placed[g.zone] !== undefined ? 'true' : undefined}
                data-state={aim === g.zone ? 'pick' : held !== null && !locked ? 'open' : undefined}
                data-over={fly?.over === g.zone ? 'true' : undefined}
                data-tone={toneOf(g.zone)}
                style={{ left: g.cx, top: g.cy }}
                disabled={locked}
                onClick={() => tapPart(g)}
              >
                <span>{g.n}</span>
              </button>
            ))}
          </>
        )}
      </Board>

      <p className="hint" role="status">
        {result
          ? "Each part's right label is shown."
          : said || (held !== null
            ? `Now tap the part for ${labels[held]}.`
            : aim !== null
              ? `Now tap the label for part ${numOf(aim)}.`
              : 'Tap a label, then the numbered part it names. Or drag the label onto the part.')}
      </p>

      {!result && (
        <div className="fk-lab-tray" data-fk-drop={TRAY} role="group" aria-label="Labels">
          {free.length === 0
            ? <span className="t-small muted">Every label is placed.</span>
            : free.map((li) => (
              <button
                key={li}
                type="button"
                className="fk-lab-chip"
                data-state={held === li ? 'pick' : undefined}
                data-flying={fly?.li === li ? 'true' : undefined}
                disabled={locked}
                aria-pressed={held === li}
                onClick={() => tapLabel(li)}
                onPointerDown={down(li)}
                onPointerMove={move}
                onPointerUp={up}
                onPointerCancel={cancel}
              >
                {labels[li]}
              </button>
            ))}
        </div>
      )}

      <ol className="fk-lab-rows" aria-label="The parts">
        {rows.map((g, k) => {
          const li = placed[g.zone];
          const tone = toneOf(g.zone);
          if (result) {
            const right = sol ? sol[g.zone] : undefined;
            return (
              <li key={g.zone} className="fk-lab-row" data-tone={tone}>
                <span className="fk-lab-num" aria-hidden="true">{g.n}</span>
                <span className="fk-lab-out">
                  <span className="sr-only">Part {g.n}: </span>
                  <span className="fk-lab-mine">
                    {tone && <Icon name={tone === 'yes' ? 'check' : 'close'} size={14} />}
                    <span>{li === undefined ? 'No label' : labels[li]}</span>
                    {tone && <span className="sr-only">{tone === 'yes' ? ', right' : ', not right'}</span>}
                  </span>
                  {tone === 'no' && right !== undefined && (
                    <span className="fk-lab-truth">
                      <Icon name="check" size={14} />
                      <span><span className="sr-only">Right label: </span>{labels[right]}</span>
                    </span>
                  )}
                </span>
              </li>
            );
          }
          return (
            <li
              key={g.zone}
              className="fk-lab-row"
              data-fk-drop={g.zone}
              data-state={aim === g.zone ? 'pick' : undefined}
              data-over={fly?.over === g.zone ? 'true' : undefined}
            >
              <button
                type="button"
                className="fk-lab-part"
                ref={(el) => { if (el) rowRefs.current.set(g.zone, el); }}
                disabled={locked}
                aria-pressed={aim === g.zone}
                aria-label={rowName(g)}
                onClick={() => tapPart(g)}
                onKeyDown={keys(k)}
              >
                <span className="fk-lab-num" aria-hidden="true">{g.n}</span>
                <span className={li === undefined ? 'fk-lab-empty' : 'fk-lab-mine'}>
                  {li !== undefined ? labels[li] : held !== null ? 'Put it here' : 'No label yet'}
                </span>
              </button>
              {li !== undefined && (
                <button
                  type="button"
                  className="ln-grip ln-out"
                  disabled={locked}
                  aria-label={`Take ${labels[li]} off part ${g.n}`}
                  onClick={() => put(li, null)}
                >
                  <Icon name="close" />
                </button>
              )}
            </li>
          );
        })}
      </ol>

      {fly && <div className="ln-flyer" style={{ left: fly.x, top: fly.y }} aria-hidden="true">{labels[fly.li]}</div>}

      {!result && (
        <Send
          label={complete ? 'Submit labels' : `${count} of ${zones.length} labelled`}
          disabled={!complete}
          busy={busy}
          onClick={() => onSubmit(placed)}
        />
      )}
    </>
  );
}
