/**
 * The drawing kind (batch 9, E4) on the phone: a whiteboard, words beside it
 * when the question allows them, and the answer `{ image, text? }`. Lazy-loaded
 * by learn/Answer.jsx, so /join downloads none of this until one is on screen.
 *
 * The board takes touch, mouse and stylus through pointer events, with a
 * stylus's pressure where it gives one; `touch-action: none` keeps the page
 * from scrolling under a stroke. Once a stylus has touched the board, fingers
 * are ignored, so a palm resting on the glass draws nothing.
 *
 * The picture leaves here as a data URL under the cap, through onSubmit like
 * any answer. In a room the phone's outbox keeps it on disk and sends it first
 * (`student:drawing`), then the answer that names it (`{ mediaId, text? }`):
 * learn/LearnApp.jsx. In the hub the same `{ image, text? }` is the answer.
 */

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Eraser, PenLine, Redo2, Trash2, Undo2 } from 'lucide-react';

import { Note } from '../../ui/index.jsx';
import { Count, Send } from '../Answer.jsx';
import { COLOURS, WIDTHS, hasInk, paint, segment, shown, toDataUrl } from './ink.js';
import '../../styles/drawing.css';

const TOO_BIG = 'This drawing is too detailed to send. Clear part of it and send it again.';

/** A tool button: pressed or not, always named. */
function Tool({ label, pressed, disabled, onClick, children }) {
  return (
    <button
      type="button" className="dw-btn" aria-label={label} title={label}
      aria-pressed={pressed === undefined ? undefined : pressed}
      disabled={disabled} onClick={onClick}
    >
      {children}
    </button>
  );
}

const ICON = { size: 18, strokeWidth: 1.75, 'aria-hidden': true, focusable: false };

export default function DrawingAnswer({ question, result, locked, busy, onSubmit }) {
  const [log, setLog] = useState({ entries: [], redo: [] });
  const [tool, setTool] = useState('pen');
  const [colour, setColour] = useState(COLOURS[0].id);
  const [width, setWidth] = useState(WIDTHS[1].id);
  const [text, setText] = useState('');
  const [side, setSide] = useState(0);
  const [phase, setPhase] = useState({ state: 'idle', message: '' });

  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const stroke = useRef(null);     // { id: pointerId, s: the stroke being drawn }
  const penSeen = useRef(false);
  const alive = useRef(true);
  const textId = useId();
  const countId = useId();

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  // The board is square, as wide as the page allows (styles/drawing.css).
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return undefined;
    const measure = () => setSide(wrap.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  // Everything in force, repainted whenever it or the board's size changes.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !side) return;
    const px = Math.round(side * Math.min(window.devicePixelRatio || 1, 3));
    if (canvas.width !== px) { canvas.width = px; canvas.height = px; }
    paint(canvas.getContext('2d'), log.entries, px);
  }, [log.entries, side]);

  const sending = phase.state === 'sending';
  const off = locked || sending;
  const ink = hasInk(log.entries);
  const anything = shown(log.entries).length > 0;
  // Words beside the drawing only where the question takes them.
  const allowText = question.allowText === true;
  const words = allowText ? text.trim() : '';
  const hex = COLOURS.find((c) => c.id === colour)?.hex ?? COLOURS[0].hex;
  const base = WIDTHS.find((w) => w.id === width)?.w ?? WIDTHS[1].w;

  const change = (fn) => {
    setLog(fn);
    if (phase.state === 'refused') setPhase({ state: 'idle', message: '' });
  };
  const add = (entry) => change(({ entries }) => ({ entries: [...entries, entry], redo: [] }));
  const undo = () => change(({ entries, redo }) => (entries.length
    ? { entries: entries.slice(0, -1), redo: [...redo, entries[entries.length - 1]] }
    : { entries, redo }));
  const redo = () => change(({ entries, redo: back }) => (back.length
    ? { entries: [...entries, back[back.length - 1]], redo: back.slice(0, -1) }
    : { entries, redo: back }));

  /** Where a pointer is on the board, in the unit square, with its width. */
  const pointOf = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    const pressed = e.pointerType === 'pen' && e.pressure > 0;
    const w = tool === 'eraser' ? Math.max(0.04, base * 3) : base * (pressed ? 0.35 + e.pressure * 1.3 : 1);
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.width, w];
  };

  const onDown = (e) => {
    if (off || stroke.current) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.pointerType === 'pen') penSeen.current = true;
    else if (e.pointerType === 'touch' && penSeen.current) return;
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* a pointer the browser no longer has */ }
    const s = { tool, color: hex, pts: [pointOf(e)] };
    stroke.current = { id: e.pointerId, s };
    const canvas = canvasRef.current;
    segment(canvas.getContext('2d'), s, 0, canvas.width);
  };

  const onMove = (e) => {
    const live = stroke.current;
    if (!live || live.id !== e.pointerId) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const list = e.nativeEvent.getCoalescedEvents?.();
    for (const ev of list?.length ? list : [e.nativeEvent]) {
      live.s.pts.push(pointOf(ev));
      segment(ctx, live.s, live.s.pts.length - 1, canvas.width);
    }
  };

  const onUp = (e) => {
    const live = stroke.current;
    if (!live || live.id !== e.pointerId) return;
    stroke.current = null;
    add(live.s);
  };

  async function send() {
    if (off || !ink) return;
    setPhase({ state: 'sending', message: '' });
    const image = await toDataUrl(log.entries);
    if (!alive.current) return;
    if (!image) { setPhase({ state: 'refused', message: TOO_BIG }); return; }
    setPhase({ state: 'idle', message: '' });
    onSubmit({ image, ...(words ? { text: words } : {}) });
  }

  const boardName = locked
    ? 'Your drawing, as sent.'
    : anything ? 'Drawing board, with your drawing on it.' : 'Drawing board, empty. Draw with a finger, a stylus or the mouse.';

  return (
    <div className="dw" data-locked={locked || undefined}>
      <div className="dw-tools">
        <div className="dw-group" role="group" aria-label="Tool">
          <Tool label="Pen" pressed={tool === 'pen'} disabled={off} onClick={() => setTool('pen')}><PenLine {...ICON} /></Tool>
          <Tool label="Eraser" pressed={tool === 'eraser'} disabled={off} onClick={() => setTool('eraser')}><Eraser {...ICON} /></Tool>
        </div>
        <div className="dw-group" role="group" aria-label="Pen colour">
          {COLOURS.map((c) => (
            <Tool
              key={c.id} label={`${c.name} pen`} pressed={tool === 'pen' && colour === c.id} disabled={off}
              onClick={() => { setColour(c.id); setTool('pen'); }}
            >
              <span className="dw-swatch" style={{ '--c': c.hex }} />
            </Tool>
          ))}
        </div>
        <div className="dw-group" role="group" aria-label="Line width">
          {WIDTHS.map((w, i) => (
            <Tool key={w.id} label={`${w.name} line`} pressed={width === w.id} disabled={off} onClick={() => setWidth(w.id)}>
              <span className="dw-width" style={{ '--d': `${[4, 7, 12][i]}px` }} />
            </Tool>
          ))}
        </div>
        <div className="dw-group dw-history" role="group" aria-label="Undo and clear">
          <Tool label="Undo" disabled={off || log.entries.length === 0} onClick={undo}><Undo2 {...ICON} /></Tool>
          <Tool label="Redo" disabled={off || log.redo.length === 0} onClick={redo}><Redo2 {...ICON} /></Tool>
          <Tool label="Clear the board" disabled={off || !anything} onClick={() => add({ clear: true })}><Trash2 {...ICON} /></Tool>
        </div>
      </div>

      <div className="dw-board">
        <div className="dw-paper" ref={wrapRef}>
          <canvas
            ref={canvasRef} className="dw-canvas" role="img" aria-label={boardName}
            data-tool={tool}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
            onContextMenu={(e) => e.preventDefault()}
          />
          {!anything && !locked && <span className="dw-empty" aria-hidden="true">Draw here</span>}
        </div>
      </div>

      <div className="dw-said" aria-live="polite">
        {sending && <p className="dw-sending" role="status">Getting your drawing ready…</p>}
        {phase.state === 'refused' && <Note>{phase.message}</Note>}
        {/* Never a mark: a drawing waits for a person (the server's sentence). */}
        {result?.note && <Note icon="clock" role="status">{result.note}</Note>}
      </div>

      {allowText && (
        <>
          <label className="dw-label" htmlFor={textId}>
            Explain your drawing <span className="muted">(optional)</span>
          </label>
          <textarea
            id={textId} className="textarea dw-text" rows={3} value={text} disabled={off}
            aria-describedby={countId} placeholder="What does your drawing show?"
            onChange={(e) => { setText(e.target.value); if (phase.state === 'refused') setPhase({ state: 'idle', message: '' }); }}
          />
          {!result && <Count id={countId} text={text} maxWords={question.maxWords || 600} maxChars={question.maxChars || 9000} />}
        </>
      )}

      {!result && <Send label={ink ? 'Send drawing' : 'Draw your answer'} disabled={!ink} busy={busy || sending} onClick={send} />}
    </div>
  );
}
