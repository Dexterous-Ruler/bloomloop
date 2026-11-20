/**
 * Exam mode on the phone: the copy guard, the watermark and the screenshot
 * signals (decisions E5 and E7). Mounted by Exam.jsx, beside it, in a room
 * whose `examMode` is on; for every student, since neither records anything
 * on its own. What it reports goes out only for a student who is watched.
 *
 * Deterrents and signals, never a lock. No website can stop a screenshot or
 * Google Lens; what this does is make copying the question awkward, hide it
 * while the page is not in front, print the student's roll number and room
 * code faintly over it so a shared copy traces back, and report the few
 * screenshot keys a desktop browser can see. Speech, screen readers and the
 * keyboard are left alone: the blur is a filter, the watermark is aria-hidden
 * and ignores the pointer, and no key is ever swallowed.
 *
 * Leaving the page and losing focus are reported by LearnApp's own listeners
 * ('hidden', 'blurred'), which an exam room records under its own names
 * (visibility_hidden, focus_lost): sending both would be one leave told twice.
 */

import { useEffect, useRef } from 'react';

import '../../styles/guard.css';

// The question content: a served question and the class question. The finish
// screen's cards are sections and are left alone.
const GUARDED = 'article.ln-card';
// Fields the student types into keep selection, copy and their own menu.
const EDITABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
// One signal per kind (and per screenshot method) in this long, whatever the
// keyboard repeats or a finger resting on the question does.
const QUIET_MS = 10_000;
// The snipping overlay takes focus before the page sees the S, so focus lost
// this soon after Shift+S, or after Win and Shift together, is read as it.
const ARMED_MS = 800;
// How long a screenshot key keeps the question blurred with focus still here.
const SHOT_MS = 1500;
const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

const elementOf = (t) => (t?.nodeType === 1 ? t : t?.parentElement ?? null);
const guarded = (t) => {
  const el = elementOf(t);
  return Boolean(el?.closest(GUARDED)) && !el.closest(EDITABLE);
};

/** A tile of the roll number and room code, as a mask: the theme colours it. */
function tile(text) {
  const t = text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const line = (x, y) => `<text x="${x}" y="${y}" text-anchor="middle" transform="rotate(-24 ${x} ${y})">${t}</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="170" font-family="system-ui,sans-serif" font-size="13" font-weight="600">${line(65, 50)}${line(195, 135)}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/**
 * @param rollNo, code  what the watermark prints
 * @param report        send signals: false for a student marked under 18
 *                      (`watched: false`), who is guarded and not reported
 * @param onSignal      LearnApp's signal(kind, meta)
 */
export default function Guard({ rollNo, code, report, onSignal }) {
  // Read by listeners that outlive the render.
  const sendRef = useRef(null);
  sendRef.current = report ? onSignal : null;

  useEffect(() => {
    const html = document.documentElement;
    let shotUntil = 0;
    let shotTimer = 0;
    let armedAt = 0;
    // Focus as the events say, not document.hasFocus(): some in-app browsers
    // never report focus at all, and the question must not stay blurred there.
    let unfocused = false;
    const last = {};

    // Applied straight to the page, not through a render: the blur has to be
    // on screen in the same frame as the key.
    const veil = () => {
      const hidden = document.visibilityState === 'hidden';
      html.toggleAttribute('data-exam-veil', hidden || unfocused || Date.now() < shotUntil);
    };

    // The server's kinds; at most one per kind (or method) in QUIET_MS.
    const tell = (kind, meta, key = kind) => {
      const send = sendRef.current;
      if (!send) return;
      const at = Date.now();
      if (at - (last[key] ?? 0) < QUIET_MS) return;
      last[key] = at;
      try { send(kind, meta); } catch { /* never worth a broken session */ }
    };

    const shot = (method) => {
      shotUntil = Date.now() + SHOT_MS;
      veil();
      window.clearTimeout(shotTimer);
      shotTimer = window.setTimeout(veil, SHOT_MS + 20);
      tell('screenshot_attempt', { method }, method);
    };

    // PrintScreen on the way down and up: Windows often keeps the keydown.
    const onKey = (e) => {
      const k = e.key;
      const c = e.code;
      if (k === 'PrintScreen' || c === 'PrintScreen') { shot('printscreen'); return; }
      if (e.type !== 'keydown') return;
      const s = c === 'KeyS' || k === 's' || k === 'S';
      if (e.metaKey && e.shiftKey && s) { shot('snip_shortcut'); return; }
      if (e.metaKey && e.shiftKey && /^Digit[345]$/.test(c)) { shot('mac_shortcut'); return; }
      // A capital S typed into an answer is not a shortcut.
      if (e.shiftKey && (e.metaKey || (s && !elementOf(e.target)?.closest(EDITABLE)))) armedAt = Date.now();
    };

    const onBlur = () => {
      unfocused = true;
      if (Date.now() - armedAt < ARMED_MS) {
        armedAt = 0;
        shot(MAC ? 'mac_shortcut' : 'snip_shortcut');
        return;
      }
      veil();
    };
    const onFocus = () => { unfocused = false; veil(); };

    // Blocked on the question; a copy, a cut and the menu are reported, a
    // selection or a drag only blocked.
    const block = (e) => {
      if (!guarded(e.target)) return;
      e.preventDefault();
      if (e.type === 'copy' || e.type === 'cut') tell('copy_attempt');
      else if (e.type === 'contextmenu') tell('context_menu');
    };
    const BLOCKED = ['contextmenu', 'copy', 'cut', 'dragstart', 'selectstart'];

    html.setAttribute('data-exam', '');
    veil();
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', veil);
    BLOCKED.forEach((t) => document.addEventListener(t, block, true));

    return () => {
      window.clearTimeout(shotTimer);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', veil);
      BLOCKED.forEach((t) => document.removeEventListener(t, block, true));
      html.removeAttribute('data-exam');
      html.removeAttribute('data-exam-veil');
    };
  }, []);

  const text = [rollNo, code].filter(Boolean).join('  ·  ');
  return text ? <div className="ex-mark" aria-hidden="true" style={{ '--ex-tile': tile(text) }} /> : null;
}
