/**
 * Pictures from a chapter's slides, and regions marked on a picture (batch 8).
 *
 *   GET /api/figures/content/:id/slide-pictures
 *       { pictures [{ id, url, slide, mime, bytes, alt }], kept, summary, note }
 *
 * For what code cannot draw (anatomy, apparatus, maps, an engineering drawing)
 * the figure is the professor's own picture, and the deck already holds it. A
 * kept picture's alt is a placeholder until the professor describes it: the
 * server refuses the placeholder on a question, so the picker never offers it.
 *
 * Regions are polygons in percentages of the picture (0 to 100 across and
 * down), each with a short name and a label, for "tap the part" questions.
 * At most 24 regions of 3 to 24 corners. Drawn with a pointer or entirely from
 * the keyboard: arrows move a cross, Enter puts a corner there.
 */

import { useEffect, useId, useRef, useState } from 'react';

import { api } from '../lib/api.js';
import { Button, Icon, Note } from '../ui/index.jsx';
import { nextId } from './figureSpec.js';
import '../styles/figedit.css';

const arr = (v) => (Array.isArray(v) ? v : []);
const kb = (bytes) => `${Math.max(1, Math.round((bytes ?? 0) / 1024)).toLocaleString('en-GB')} KB`;

/** MAX_REGIONS, MAX_REGION_POINTS and REGION_ID in server/src/questionTypes.js. */
export const MAX_REGIONS = 24;
export const MAX_CORNERS = 24;
const REGION_ID = /^[A-Za-z][A-Za-z0-9_-]{0,23}$/;

/** A placeholder alt the server writes on a kept picture ("Picture from slide 3 (not yet described)"). */
export const isPlaceholderAlt = (alt) => /\(not yet described\)\s*$/.test(String(alt ?? '').trim());

/* ------------------------------------------------------------- reading */

/**
 * The chapter's slide pictures. `state`: 'loading', 'ready', 'absent' (a 404:
 * a server without batch 8, or a chapter this viewer cannot read; the option
 * hides) or 'failed' (the sentence, with a retry).
 */
export function useSlidePictures(contentId, services = api, enabled = true) {
  const [got, setGot] = useState({ for: null, state: 'loading', data: null, error: '' });
  const [again, setAgain] = useState(0);
  useEffect(() => {
    if (!enabled || !contentId || !services.slidePictures) return undefined;
    let live = true;
    setGot({ for: contentId, state: 'loading', data: null, error: '' });
    services.slidePictures(contentId).then(
      (data) => { if (live) setGot({ for: contentId, state: 'ready', data, error: '' }); },
      (err) => { if (live) setGot({ for: contentId, state: err?.status === 404 || err?.status === 405 ? 'absent' : 'failed', data: null, error: err?.message ?? '' }); },
    );
    return () => { live = false; };
  }, [contentId, services, enabled, again]);
  if (!enabled || !contentId || !services.slidePictures) return { state: 'absent', data: null, error: '', reload: () => {} };
  return { ...got, reload: () => setAgain((n) => n + 1) };
}

/** A blob url for an upload, fetched with this browser's credentials (an <img> sends none), revoked when done. */
export function useBlobSrc(url, services = api) {
  const [got, setGot] = useState({ for: null, src: null, failed: false });
  useEffect(() => {
    if (!url) return undefined;
    let live = true;
    let made = null;
    const fetchIt = services.mediaBlobUrl ?? api.mediaBlobUrl;
    fetchIt(url).then(
      (src) => { if (live) { made = src; setGot({ for: url, src, failed: false }); } else if (String(src).startsWith('blob:')) URL.revokeObjectURL(src); },
      () => { if (live) setGot({ for: url, src: null, failed: true }); },
    );
    return () => {
      live = false;
      if (made && String(made).startsWith('blob:')) URL.revokeObjectURL(made);
    };
  }, [url, services]);
  return got.for === url ? got : { src: null, failed: false };
}

/* ------------------------------------------------------------- the picker */

function Thumb({ picture, services, on, onPick }) {
  const { src, failed } = useBlobSrc(picture.url, services);
  return (
    <button type="button" role="radio" aria-checked={on} className="fe-pic" onClick={() => onPick(picture)}>
      <span className="fe-pic-img">
        {src ? <img src={src} alt="" /> : failed ? <Icon name="alert" /> : <span className="skel" />}
      </span>
      <small><b>Slide {picture.slide}</b><span>{kb(picture.bytes)}</span></small>
    </button>
  );
}

/**
 * The chapter's slide pictures to choose from, with the server's note (which
 * also covers a chapter uploaded before pictures were kept, or typed in).
 */
export function SlidePicker({ read, services = api, chosen, onPick }) {
  if (read.state === 'loading') {
    return (
      <div className="fe-pics" aria-busy="true" aria-label="Reading the slide pictures">
        {[0, 1, 2, 3].map((i) => <div key={i} className="skel" style={{ aspectRatio: '4 / 3.6', borderRadius: 12 }} />)}
      </div>
    );
  }
  if (read.state === 'failed') {
    return (
      <Note tone="bad" role="alert">
        {read.error || 'The slide pictures did not load.'}{' '}
        <button type="button" className="link" onClick={read.reload}>Try again</button>
      </Note>
    );
  }
  const pictures = arr(read.data?.pictures);
  return (
    <div className="stack stack-2">
      {read.data?.note && <p className="hint">{read.data.note}</p>}
      {pictures.length > 0 && (
        <div className="fe-pics" role="radiogroup" aria-label="Pictures from the slides">
          {pictures.map((p) => <Thumb key={p.id} picture={p} services={services} on={chosen === p.url} onPick={onPick} />)}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- regions */

const clamp = (v) => Math.min(100, Math.max(0, Math.round(v * 10) / 10));
const centre = (pts) => {
  const n = pts.length || 1;
  return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n];
};
const pointsAttr = (pts) => pts.map((p) => `${p[0]},${p[1]}`).join(' ');

/** What is wrong with one region, said the way the server would, or ''. */
export function regionProblem(r, i, all) {
  if (!REGION_ID.test(String(r.id ?? ''))) return 'Its name must start with a letter, then letters, digits, - or _ (at most 24).';
  if (all.some((o, j) => j !== i && String(o.id).toLowerCase() === String(r.id).toLowerCase())) return `Another region is also called ${r.id}.`;
  if (!String(r.label ?? '').trim()) return 'It needs a label.';
  if (String(r.label).length > 60) return 'Its label is longer than 60 characters.';
  if (arr(r.points).length < 3) return 'It needs at least 3 corners.';
  return '';
}

/**
 * Polygons drawn on a picture. `regions` is [{ id, label, points: [[x, y]] }]
 * in percentages; `onChange` gets the whole list.
 */
export function RegionTool({ src, alt, regions, onChange }) {
  const list = arr(regions);
  const stage = useRef(null);
  const svgRef = useRef(null);
  const helpId = useId();
  const [on, setOn] = useState(-1);
  // { at: index being redrawn, or -1 for a new region; points }
  const [drawing, setDrawing] = useState(null);
  const [cursor, setCursor] = useState([50, 50]);

  const start = (at) => {
    setDrawing({ at, points: [] });
    setOn(at);
    setCursor([50, 50]);
    // The keyboard can draw at once.
    setTimeout(() => svgRef.current?.focus(), 0);
  };
  const addCorner = (p) => setDrawing((d) => (d && d.points.length < MAX_CORNERS ? { ...d, points: [...d.points, [clamp(p[0]), clamp(p[1])]] } : d));
  const finish = () => {
    if (!drawing || drawing.points.length < 3) return;
    if (drawing.at >= 0) {
      onChange(list.map((r, i) => (i === drawing.at ? { ...r, points: drawing.points } : r)));
      setOn(drawing.at);
    } else {
      onChange([...list, { id: nextId('', list.map((r) => r.id)), label: '', points: drawing.points }]);
      setOn(list.length);
    }
    setDrawing(null);
  };
  const cancel = () => setDrawing(null);

  function onPointerDown(e) {
    if (!drawing) return;
    const box = stage.current.getBoundingClientRect();
    const p = [((e.clientX - box.left) / box.width) * 100, ((e.clientY - box.top) / box.height) * 100];
    setCursor([clamp(p[0]), clamp(p[1])]);
    addCorner(p);
    e.preventDefault();
  }

  function onKeyDown(e) {
    if (!drawing) return;
    const step = e.shiftKey ? 5 : 1;
    const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (move) {
      setCursor((c) => [clamp(c[0] + move[0]), clamp(c[1] + move[1])]);
      e.preventDefault();
    } else if (e.key === 'Enter' && e.shiftKey) {
      finish();
      e.preventDefault();
    } else if (e.key === 'Enter' || e.key === ' ') {
      addCorner(cursor);
      e.preventDefault();
    } else if (e.key === 'Backspace') {
      setDrawing((d) => ({ ...d, points: d.points.slice(0, -1) }));
      e.preventDefault();
    } else if (e.key === 'Escape') {
      cancel();
      e.preventDefault();
      e.stopPropagation();
    }
  }

  const patch = (i, p) => onChange(list.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const remove = (i) => { onChange(list.filter((_, j) => j !== i)); setOn(-1); };
  const draft = drawing?.points ?? [];
  const full = list.length >= MAX_REGIONS;

  return (
    <div className="fe-reg">
      <div className="fe-reg-stage" ref={stage} data-drawing={drawing ? 'true' : undefined}>
        <img src={src} alt={alt ?? ''} draggable={false} />
        <svg
          ref={svgRef}
          className="fe-reg-svg"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          tabIndex={drawing ? 0 : -1}
          role="application"
          aria-label={drawing ? `Drawing a region: ${draft.length} corner${draft.length === 1 ? '' : 's'}. Cross at ${cursor[0]}% across, ${cursor[1]}% down.` : 'Regions on the picture'}
          aria-describedby={drawing ? helpId : undefined}
          onPointerDown={onPointerDown}
          onKeyDown={onKeyDown}
        >
          {list.map((r, i) => (drawing?.at === i ? null : (
            // eslint-disable-next-line jsx-a11y/no-static-element-interactions
            <polygon key={`${r.id}-${i}`} className="fe-reg-poly" data-on={on === i ? 'true' : undefined} points={pointsAttr(arr(r.points))} onPointerDown={() => { if (!drawing) setOn(i); }} />
          )))}
          {draft.length > 1 && <polygon className="fe-reg-draft" points={pointsAttr(draft)} />}
        </svg>
        {list.map((r, i) => {
          if (drawing?.at === i || arr(r.points).length < 3) return null;
          const [x, y] = centre(r.points);
          return <span key={`t-${r.id}-${i}`} className="fe-reg-label" data-on={on === i ? 'true' : undefined} style={{ left: `${x}%`, top: `${y}%` }} aria-hidden="true">{r.id}</span>;
        })}
        {draft.map((p, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <span key={i} className="fe-reg-pt" style={{ left: `${p[0]}%`, top: `${p[1]}%` }} aria-hidden="true" />
        ))}
        {drawing && <span className="fe-reg-x" style={{ left: `${cursor[0]}%`, top: `${cursor[1]}%` }} aria-hidden="true" />}
      </div>

      {drawing ? (
        <div className="fe-reg-bar" id={helpId} role="status">
          <span className="grow">
            {drawing.at >= 0 ? `Redrawing ${list[drawing.at]?.id}. ` : 'A new region. '}
            Click each corner in turn, or move the cross with the <kbd>arrows</kbd> (<kbd>Shift</kbd> for bigger steps) and press <kbd>Enter</kbd>.
            {' '}<kbd>Backspace</kbd> takes the last corner back. {draft.length} of 3 to {MAX_CORNERS} corners.
          </span>
          <Button size="sm" variant="ghost" onClick={cancel}>Cancel</Button>
          <Button size="sm" variant="primary" icon="check" disabled={draft.length < 3} title={draft.length < 3 ? 'A region needs at least 3 corners' : 'Shift+Enter'} onClick={finish}>Finish</Button>
        </div>
      ) : (
        <div className="cluster">
          <Button size="sm" icon="plus" disabled={full} title={full ? `${MAX_REGIONS} regions is the most` : undefined} onClick={() => start(-1)}>Add a region</Button>
          <span className="t-meta">{list.length} of {MAX_REGIONS}. Each is a shape drawn over a part of the picture, with a name and a label.</span>
        </div>
      )}

      {list.length > 0 && (
        <ol className="fe-reg-list">
          {list.map((r, i) => {
            const bad = regionProblem(r, i, list);
            return (
              // eslint-disable-next-line react/no-array-index-key
              <li key={i} className="fe-reg-row" data-on={on === i ? 'true' : undefined} onFocus={() => !drawing && setOn(i)}>
                <label className="fe-f">
                  <span className="fe-f-k">Name</span>
                  <input className="input input-sm mono" value={r.id} aria-invalid={bad.startsWith('Its name') || bad.startsWith('Another') || undefined} onChange={(e) => patch(i, { id: e.target.value })} />
                </label>
                <label className="fe-f" data-grow="true">
                  <span className="fe-f-k">Label</span>
                  <input className="input input-sm" value={r.label} placeholder="Left ventricle" aria-invalid={bad.includes('label') || undefined} onChange={(e) => patch(i, { label: e.target.value })} />
                </label>
                <span className="t-meta">{arr(r.points).length} corners</span>
                <Button size="sm" variant="ghost" icon="edit" disabled={Boolean(drawing)} onClick={() => start(i)}>Redraw</Button>
                <Button size="sm" variant="ghost" icon="close" aria-label={`Remove region ${r.id || i + 1}`} disabled={Boolean(drawing)} onClick={() => remove(i)} />
                {bad && <p className="fe-reg-bad">{bad}</p>}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
