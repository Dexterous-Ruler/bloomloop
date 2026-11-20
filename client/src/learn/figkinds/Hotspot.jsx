/**
 * hotspot: tap one or several parts of the figure (or regions of a picture).
 * Sends the zone tokens chosen, `[token, ...]`; after marking, result.solution
 * is the right tokens and each part says whether it was right.
 *
 * The server's drawing stays as it is. Over it sits a layer of real buttons,
 * one per part, measured off the drawing: on a figure each `<g data-part>` is
 * found and boxed (a point is a few pixels, so its button is at least 44 px and
 * centred on it); on a picture each region is its own outline, hit-tested as
 * drawn, so two regions side by side never steal each other's taps.
 *
 * Also exports the board (useBoard, Board, whereOf), which Label.jsx shares.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { Icon } from '../../ui/index.jsx';
import { Send } from '../Answer.jsx';
import Figure from '../Figure.jsx';

/** Where on the drawing, in words a screen reader can use: the tokens name nothing. */
export const whereOf = (fx, fy) => {
  const h = fx < 0.34 ? 'left' : fx > 0.66 ? 'right' : 'centre';
  const v = fy < 0.34 ? 'top' : fy > 0.66 ? 'bottom' : '';
  if (!v) return h;
  return h === 'centre' ? v : `${v} ${h}`;
};

/**
 * Each zone's place on the drawing as shown, in pixels of the drawing, sorted
 * into reading order and numbered from 1. Measured after layout and again
 * whenever the board changes size; a zone the drawing does not have keeps
 * `x: null` (it is still answerable from a list, never drawn).
 */
export function useBoard(stimulus, zoneList) {
  // By value: a parent that rebuilds the array must not re-measure every render.
  const key = JSON.stringify(zoneList ?? []);
  const zones = useMemo(() => JSON.parse(key), [key]);
  const ref = useRef(null);
  const [box, setBox] = useState(null);
  const [geo, setGeo] = useState(null);
  const isImage = stimulus?.kind === 'image';

  const measure = useCallback(() => {
    const wrap = ref.current;
    const el = wrap?.querySelector(isImage ? '.fk-hot-pic img' : '.fig-card svg');
    if (!el) return;
    const W = wrap.getBoundingClientRect();
    const S = el.getBoundingClientRect();
    if (!S.width || !S.height) return;
    const list = zones.map((z) => {
      const g = { zone: z.zone, x: null, y: null, w: 0, h: 0, text: '' };
      if (isImage) {
        const pts = (Array.isArray(z.points) ? z.points : []).map(([px, py]) => [(px / 100) * S.width, (py / 100) * S.height]);
        if (pts.length < 3) return g;
        const xs = pts.map((p) => p[0]);
        const ys = pts.map((p) => p[1]);
        Object.assign(g, { x: Math.min(...xs), y: Math.min(...ys), points: pts });
        g.w = Math.max(...xs) - g.x;
        g.h = Math.max(...ys) - g.y;
      } else {
        const part = el.querySelector(`[data-part="${CSS.escape(String(z.zone))}"]`);
        if (!part) return g;
        const r = part.getBoundingClientRect();
        Object.assign(g, { x: r.left - S.left, y: r.top - S.top, w: r.width, h: r.height });
        // Text the part itself shows (a value on a bar, a step's words) helps
        // name it; a token or a paragraph does not.
        const t = (part.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (t && t !== z.zone && t.length <= 40) g.text = t;
      }
      g.cx = g.x + g.w / 2;
      g.cy = g.y + g.h / 2;
      return g;
    });
    const band = S.height / 6;
    list.sort((a, b) => {
      if (a.x === null || b.x === null) return (a.x === null) - (b.x === null);
      return (Math.round(a.cy / band) - Math.round(b.cy / band)) || (a.cx - b.cx);
    });
    list.forEach((g, i) => {
      g.n = i + 1;
      g.where = g.x === null ? '' : whereOf(g.cx / S.width, g.cy / S.height);
    });
    setBox({ left: S.left - W.left, top: S.top - W.top, width: S.width, height: S.height });
    setGeo(list);
  }, [isImage, zones]);

  useLayoutEffect(() => { measure(); }, [measure]);

  useEffect(() => {
    const wrap = ref.current;
    if (!wrap || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => measure());
    ro.observe(wrap);
    // Text in the drawing moves a little once its face has loaded.
    document.fonts?.ready?.then(measure).catch(() => {});
    return () => ro.disconnect();
  }, [measure]);

  return { ref, box, geo, measure, isImage };
}

/** The drawing (the server's figure, or the picture) with a layer exactly over it. */
export function Board({ stimulus, board, children }) {
  const [broken, setBroken] = useState(false);
  return (
    <div className="fk-hot-board" ref={board.ref}>
      {board.box && board.geo && (
        <div className="fk-hot-layer" style={board.box}>{children(board.geo, board.box)}</div>
      )}
      {board.isImage ? (
        <div className="fk-hot-pic">
          {broken
            ? <p className="fk-hot-alt">{stimulus.alt}</p>
            : <img src={stimulus.url} alt={stimulus.alt ?? ''} onLoad={board.measure} onError={() => setBroken(true)} />}
        </div>
      ) : (
        <Figure figure={stimulus} />
      )}
    </div>
  );
}

const TONE_SAYS = {
  yes: 'right, and you chose it',
  no: 'you chose it, not right',
  miss: 'right, you did not choose it',
};

const many = (n) => (n === 1 ? '1 part' : `${n} parts`);

export default function Hotspot({ question, result, locked, busy, onSubmit }) {
  const zones = question.zones ?? [];
  const board = useBoard(question.stimulus, zones);
  const [chosen, setChosen] = useState([]);
  const [said, setSaid] = useState('');
  const btns = useRef(new Map());
  const want = Array.isArray(result?.solution) ? result.solution : null;
  const all = board.geo ?? [];
  const total = all.length;

  if (!question.stimulus) return <p className="ln-hint">This question's figure did not arrive.</p>;

  const toneOf = (t) => {
    const mine = chosen.includes(t);
    if (!result || !want) return mine ? 'on' : undefined;
    if (want.includes(t)) return mine ? 'yes' : 'miss';
    return mine ? 'no' : undefined;
  };

  const toggle = (g) => {
    if (locked) return;
    // From the latest state, so two taps inside one frame both count.
    setChosen((c) => {
      const on = !c.includes(g.zone);
      const next = on ? [...c, g.zone] : c.filter((t) => t !== g.zone);
      setSaid(`Part ${g.n} ${on ? 'chosen' : 'cleared'}. ${many(next.length)} chosen.`);
      return next;
    });
  };

  // Arrow keys walk the parts in reading order; Enter and Space tap.
  const walk = (g) => (e) => {
    const d = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1
      : (e.key === 'ArrowLeft' || e.key === 'ArrowUp') ? -1 : 0;
    const shown = all.filter((x) => x.x !== null);
    const at = shown.findIndex((x) => x.zone === g.zone);
    let to = null;
    if (d) to = shown[(at + d + shown.length) % shown.length];
    else if (e.key === 'Home') to = shown[0];
    else if (e.key === 'End') to = shown[shown.length - 1];
    if (!to) return;
    e.preventDefault();
    btns.current.get(to.zone)?.focus();
  };

  const nameOf = (g) => {
    const tone = toneOf(g.zone);
    const base = `Part ${g.n} of ${total}${g.where ? `, ${g.where}` : ''}${g.text ? `, ${g.text}` : ''}`;
    return TONE_SAYS[tone] ? `${base}: ${TONE_SAYS[tone]}` : base;
  };

  // Smaller parts on top: a part drawn inside another is still reachable.
  const byArea = (list) => list.filter((g) => g.x !== null).sort((a, b) => b.w * b.h - a.w * a.h);

  let summary = '';
  if (result && want) {
    const got = chosen.filter((t) => want.includes(t)).length;
    const extra = chosen.length - got;
    summary = `${want.length === 1 ? 'The right part is' : 'The right parts are'} ringed in green. `
      + `You found ${got} of ${want.length}${extra ? `, and chose ${many(extra)} that ${extra === 1 ? 'is' : 'are'} not right (crossed)` : ''}.`;
  }

  // On the ring's top-right: a figure part's ring is a little larger than the
  // part (see .fk-hot-part::before); a region's is its outline.
  const mark = (g, tone) => (tone === 'yes' || tone === 'no' || tone === 'miss') && (
    <span
      key={`m${g.zone}`}
      className="fk-hot-mark"
      data-tone={tone}
      aria-hidden="true"
      style={board.isImage
        ? { left: g.x + g.w, top: g.y }
        : { left: g.cx + Math.max(11, g.w / 2 + 5) - 3, top: g.cy - Math.max(11, g.h / 2 + 5) + 3 }}
    >
      <Icon name={tone === 'no' ? 'close' : 'check'} size={12} />
    </span>
  );

  return (
    <>
      <Board stimulus={question.stimulus} board={board}>
        {(geo, box) => (board.isImage ? (
          <>
            <svg className="fk-hot-shapes" width={box.width} height={box.height} viewBox={`0 0 ${box.width} ${box.height}`}>
              {byArea(geo).map((g) => {
                const tone = toneOf(g.zone);
                return (
                  <polygon
                    key={g.zone}
                    ref={(el) => { if (el) btns.current.set(g.zone, el); }}
                    points={g.points.map((p) => p.join(',')).join(' ')}
                    role="button"
                    tabIndex={locked ? -1 : 0}
                    aria-pressed={chosen.includes(g.zone)}
                    aria-disabled={locked || undefined}
                    aria-label={nameOf(g)}
                    data-tone={tone}
                    onClick={() => toggle(g)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(g); return; }
                      walk(g)(e);
                    }}
                  />
                );
              })}
            </svg>
            {geo.map((g) => g.x !== null && mark(g, toneOf(g.zone)))}
          </>
        ) : (
          <>
            {byArea(geo).map((g) => {
              const tone = toneOf(g.zone);
              const round = g.w < 24 && g.h < 24;
              return (
                <button
                  key={g.zone}
                  type="button"
                  ref={(el) => { if (el) btns.current.set(g.zone, el); }}
                  className="fk-hot-part"
                  data-tone={tone}
                  data-round={round ? 'true' : undefined}
                  style={{ left: g.cx, top: g.cy, '--w': `${g.w}px`, '--h': `${g.h}px` }}
                  disabled={locked}
                  aria-pressed={chosen.includes(g.zone)}
                  aria-label={nameOf(g)}
                  onClick={() => toggle(g)}
                  onKeyDown={walk(g)}
                />
              );
            })}
            {geo.map((g) => g.x !== null && mark(g, toneOf(g.zone)))}
          </>
        ))}
      </Board>

      <p className="hint" role="status">
        {result
          ? summary
          : said || 'Tap the part of the figure the question asks for. Tap it again to clear it. You can choose more than one.'}
      </p>

      {!result && (
        <Send
          label={chosen.length === 0 ? 'Tap a part of the figure' : `Submit ${many(chosen.length)}`}
          disabled={chosen.length === 0}
          busy={busy}
          onClick={() => onSubmit([...chosen].sort())}
        />
      )}
    </>
  );
}
