/**
 * What the three account homes share: how a share, a date, a size and a room's
 * state are written, the copy button, and the parts an inspector is built from.
 *
 * Nothing here fetches. Department, Overview and Rooms each keep their reads
 * and writes in a container and hand a view plain data, so the same views can
 * be drawn from sample data in the dev gallery.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { LABEL, LEVELS } from '../lib/bloom.js';
import { Button, Chip, Segmented } from '../ui/index.jsx';

/* ------------------------------------------------------------ formatting */

/** Server accuracies are 0..1, and null means nothing to average yet. */
export const share = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);

export const plural = (n, one, many = `${one}s`) =>
  `${Number(n ?? 0).toLocaleString()} ${Number(n) === 1 ? one : many}`;

/** A figure for a <Fig> or a tile: grouped once it is long enough to need it. */
export const big = (n) => {
  const v = Number(n ?? 0);
  return v >= 1000 ? v.toLocaleString() : v;
};

/** Bytes as a person reads them: "820 B", "312 KB", "1.02 MB". */
export function sizeOf(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  // A round ceiling is said as one: "1 MB", not "1.00 MB".
  if (n % (1024 * 1024) === 0) return `${n / (1024 * 1024)} MB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

const DAY = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const FULL = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const STAMP = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const TIME = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: 'long' });
const MONTH = new Intl.DateTimeFormat(undefined, { month: 'short' });
const TODAY = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

function written(iso, fmt) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : fmt.format(d);
}
export const dayOf = (iso) => written(iso, DAY);
export const dateOf = (iso) => written(iso, FULL);
export const stampOf = (iso) => written(iso, STAMP);
export const timeOf = (iso) => written(iso, TIME);

/** "Wednesday 18 November": the date a page head carries. */
export const todayLine = () => TODAY.format(new Date());

/** Morning until noon, afternoon until six, evening after. */
export function greeting(now = new Date()) {
  const h = now.getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/** "20 min ago" is what a teacher reads off a room list. */
export function ago(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function daysUntil(iso) {
  const d = new Date(iso ?? '');
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.round((d.getTime() - Date.now()) / 86400000));
}

/**
 * The calendar day a moment fell on, as a key and as the words a date rail
 * shows: "Today", "Yesterday", a weekday within the week, then a date. A
 * missing or unreadable date is its own day, so it is grouped, never guessed.
 */
export function dayParts(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return { key: 'none', label: 'Date not recorded', day: '—', month: '' };
  const start = (t) => new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  const diff = Math.round((start(new Date()) - start(d)) / 86400000);
  const label = diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : diff < 7 ? WEEKDAY.format(d) : FULL.format(d);
  return { key: String(start(d)), label, day: String(d.getDate()), month: MONTH.format(d) };
}

/**
 * A field of a list of rooms, oldest first, as a series a sparkline can draw.
 * Rooms arrive newest first; a room with nothing to average is left out, not
 * drawn as a zero.
 */
export const seriesOf = (rooms, key) =>
  [...(rooms ?? [])].reverse().map((r) => r?.[key]).filter((v) => v != null && Number.isFinite(Number(v))).map(Number);

/**
 * What a room's accuracy rests on (Phase 5, the count behind every estimate):
 * " from 150 answers by 15 students". A row with `answers` and no `students`
 * (an HOD's professor rows) says the answers only. Empty when the server sent
 * no count, or the count is nought and the accuracy is already a dash.
 */
export function restsOn(row) {
  const answers = Number(row?.answers);
  if (!Number.isFinite(answers) || answers <= 0) return '';
  return ` from ${plural(answers, 'answer')}${Number.isFinite(row?.students) ? ` by ${plural(row.students, 'student')}` : ''}`;
}

/**
 * Staff lists of students read in roll order, numerically ('2' before '10'),
 * as the server lists them since the Phase 5 follow-ups; never by score unless
 * someone asks for it. A student with no roll number comes last, by name.
 */
export function byRoll(a, b) {
  const ra = String(a?.rollNo ?? '').trim();
  const rb = String(b?.rollNo ?? '').trim();
  if (ra && rb) return ra.localeCompare(rb, undefined, { numeric: true, sensitivity: 'base' });
  if (ra || rb) return ra ? -1 : 1;
  return String(a?.fullName ?? a?.name ?? '').localeCompare(String(b?.fullName ?? b?.name ?? ''));
}

/* ----------------------------------------------------------------- levels */

/** The server's per-level report, as a map by level. */
export const byLevel = (bloom) =>
  Object.fromEntries((bloom ?? []).map((b) => [b.level, { seen: b.seen ?? 0, correct: b.correct ?? 0 }]));

/** The level most answers landed on, or null when nothing has been answered. */
export const busiest = (bloom) =>
  (bloom ?? []).reduce((best, b) => ((b.seen ?? 0) > (best?.seen ?? 0) ? b : best), null);

/** The thinnest level among those served at all: an untouched level is a gap in the bank, not a weakness. */
export function thinnest(bloom) {
  const served = (bloom ?? []).filter((b) => b.seen > 0 && b.accuracy != null);
  return served.length ? served.reduce((low, b) => (b.accuracy < low.accuracy ? b : low)) : null;
}

/**
 * Where the answers sit on the ladder: the level of every answer averaged, 1 to
 * 6, with the level nearest to it. Null when nothing has been answered.
 */
export function meanLevel(bloom) {
  let seen = 0;
  let sum = 0;
  (bloom ?? []).forEach((b) => {
    const i = LEVELS.indexOf(b.level);
    if (i < 0) return;
    seen += b.seen ?? 0;
    sum += (b.seen ?? 0) * (i + 1);
  });
  if (!seen) return null;
  const value = sum / seen;
  return { value, level: LEVELS[Math.min(5, Math.max(0, Math.round(value) - 1))] };
}

/**
 * The six levels as six thin horizontal bars, lowest first: the level named,
 * how well (the fill and the percentage) and on how much (correct of answered),
 * so a 100% from one answer cannot pass for mastery. `current` is marked as
 * the level being worked at.
 */
export function LevelRows({ bloom, current, label = 'Accuracy by level' }) {
  const map = byLevel(bloom);
  return (
    <ul className="ac-lvrows" aria-label={label}>
      {LEVELS.map((l, i) => {
        const seen = map[l]?.seen ?? 0;
        const correct = map[l]?.correct ?? 0;
        const pct = seen ? Math.round((correct / seen) * 100) : null;
        const here = current === l;
        return (
          <li key={l} className="ac-lvrow" data-level={l} data-here={here ? 'true' : undefined} data-empty={seen ? undefined : 'true'}>
            <span className="ac-lvrow-name">
              <i className="ac-lvrow-n">{i + 1}</i>
              {LABEL[l]}
              {here && <span className="sr-only"> (working here)</span>}
            </span>
            <span className="ac-lvrow-bar" aria-hidden="true"><i style={{ width: `${pct == null ? 0 : Math.max(pct, 3)}%` }} /></span>
            <span className="ac-lvrow-pct">{pct == null ? '—' : `${pct}%`}</span>
            <span className="ac-lvrow-ct">{seen ? `${correct}/${seen}` : 'none'}</span>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------ level bands */

/**
 * Decision 6 (19 Nov 2026): a class summary reads in three level bands first,
 * with the six levels one press away; one student's detail stays six. The
 * bands are the server's (LEVEL_BANDS in server/src/services/classAnalytics.js),
 * named as it names them. GET /api/classes/:id/analytics sends them ready
 * made; GET /api/dashboard and GET /api/analytics send the six levels only, so
 * a summary drawn from those adds each pair's answers here. Nothing else is
 * worked out: every count is the server's.
 */
export const LEVEL_BANDS = [
  { id: 'lower', label: 'Remember and Understand', levels: ['remember', 'understand'] },
  { id: 'middle', label: 'Apply and Analyse', levels: ['apply', 'analyse'] },
  { id: 'higher', label: 'Evaluate and Create', levels: ['evaluate', 'create'] },
];

/**
 * The three bands: { id, label, levels, seen, correct, sentence? }. The
 * server's own `levelBands` as sent since the Phase 5 follow-ups ({ id, label,
 * levels, answers, correct, accuracy, sentence }; `answers` is read as `seen`).
 * Only when a read carries no `levelBands` at all are the six levels added up
 * in pairs here, without a sentence.
 */
export function bandsOf(bloom, sent) {
  if (Array.isArray(sent)) {
    return sent.map((b) => ({ ...b, seen: b.answers ?? 0, correct: b.correct ?? 0 }));
  }
  const map = byLevel(bloom);
  return LEVEL_BANDS.map((b) => ({
    ...b,
    seen: b.levels.reduce((n, l) => n + (map[l]?.seen ?? 0), 0),
    correct: b.levels.reduce((n, l) => n + (map[l]?.correct ?? 0), 0),
  }));
}

/** The switch between the two readings of the same answers. */
export function LevelReading({ value, onChange }) {
  return (
    <Segmented
      label="Read the levels by"
      value={value}
      onChange={onChange}
      options={[{ id: 'bands', label: 'Three bands' }, { id: 'levels', label: 'Six levels' }]}
    />
  );
}

/**
 * The three bands as three bars: the band named with its two level numbers,
 * how well and on how much. One green for every band, so a bar reads as "how
 * well" and never as one level's colour.
 */
export function BandRows({ bloom, bands, label = 'Accuracy by level band' }) {
  return (
    <ul className="ac-bandrows" aria-label={label}>
      {bandsOf(bloom, bands).map((b) => {
        const pct = b.seen ? Math.round((b.correct / b.seen) * 100) : null;
        return (
          <li key={b.id} className="ac-bandrow" data-empty={b.seen ? undefined : 'true'}>
            <span className="ac-bandrow-name">
              <span className="ac-bandrow-ns" aria-hidden="true">
                {b.levels.map((l) => <i key={l} className="ac-lvrow-n" data-level={l}>{LEVELS.indexOf(l) + 1}</i>)}
              </span>
              {b.label}
            </span>
            <span className="ac-lvrow-pct">{pct == null ? '—' : `${pct}%`}</span>
            <span className="ac-lvrow-ct">{b.seen ? `${b.correct}/${b.seen}` : 'none'}</span>
            <span className="ac-lvrow-bar ac-bandrow-bar" aria-hidden="true"><i style={{ width: `${pct == null ? 0 : Math.max(pct, 3)}%` }} /></span>
            {/* The server's count sentence, when the band is the server's. */}
            {b.sentence && <span className="ac-bandrow-basis">{b.sentence}</span>}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A class summary's level figures: three bands, or the six levels, as `by`
 * says. `bands` is the server's `levelBands` when the read carried them.
 */
export function LevelSummary({ bloom, bands, by, current }) {
  return by === 'levels' ? <LevelRows bloom={bloom} current={current} /> : <BandRows bloom={bloom} bands={bands} />;
}

/**
 * Where a student is on the climb: six rungs rising, lit in their own colours
 * up to `level`, with the level's number and name beside them so the colour is
 * never the only thing saying it.
 */
export function Climb({ level, className = '' }) {
  const at = LEVELS.indexOf(level);
  if (at < 0) return null;
  return (
    <span className={`ac-climb ${className}`} data-level={level}>
      <span className="ac-climb-rungs" aria-hidden="true">
        {LEVELS.map((l, i) => <i key={l} data-level={l} data-on={i <= at ? 'true' : undefined} />)}
      </span>
      <span className="ac-climb-name"><b>{at + 1}</b>{LABEL[level]}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ rooms */

/**
 * A room's state. Live is the one chip on the screen that moves; paused and
 * closed step back from it. An unrecognised status is printed as it came, never
 * folded into "closed": that would put the calmest word in the product on a
 * room nobody understands.
 */
export function RoomState({ status }) {
  if (status === 'open') return <Chip tone="ok" dot className="chip-live ac-state">Live</Chip>;
  if (status === 'paused') return <Chip tone="warn" icon="pause" className="ac-state">Paused</Chip>;
  // Phase 3: opened with a waiting room and not started yet.
  if (status === 'waiting') return <Chip tone="line" icon="clock" className="ac-state">Waiting</Chip>;
  if (status === 'closed') return <Chip tone="line" className="ac-state">Closed</Chip>;
  return <Chip tone="line" className="ac-state">{status || 'Unknown'}</Chip>;
}

/** A room's state as a dot, for a list where the words are said beside it. */
export function RoomDot({ status }) {
  return <span className="ac-dot" data-status={status} aria-hidden="true" />;
}

export function roomWhen(room) {
  if (room.status === 'paused') return `Paused ${ago(room.pausedAt) || 'at an unrecorded time'}`;
  if (room.status === 'closed') return `Closed ${ago(room.closedAt) || 'at an unrecorded time'}`;
  if (room.status === 'waiting') return `Opened ${ago(room.startedAt) || 'at an unrecorded time'}, not started`;
  return `Opened ${ago(room.startedAt) || 'at an unrecorded time'}`;
}

/** Where the console reopens a room: the class, or the code on the projector. */
export const roomLink = (code, view = 'live') => `/?session=${encodeURIComponent(code)}&view=${view}`;

/** A room code as it is read off a board: mono, spaced, on its own plate. */
export function CodePlate({ code, size, className = '' }) {
  return <span className={`ac-plate${size ? ` ac-plate-${size}` : ''} ${className}`}>{code || '——————'}</span>;
}

/**
 * An accuracy as a short meter and its figure. The meter is drawn in one
 * green for every room, so it reads as "how well", never as a level.
 */
export function Rate({ value, className = '' }) {
  const pct = value == null ? null : Math.round(value * 100);
  return (
    <span className={`ac-rate ${className}`}>
      <span className="ac-rate-bar" aria-hidden="true"><i style={{ width: `${pct == null ? 0 : Math.max(pct, 2)}%` }} /></span>
      <span className="ac-rate-n">{pct == null ? '—' : `${pct}%`}</span>
    </span>
  );
}

/* ------------------------------------------------------------- behaviour */

/** True while the window matches `query`. */
export function useMedia(query) {
  return useSyncExternalStore(
    (fn) => {
      const m = window.matchMedia(query);
      m.addEventListener('change', fn);
      return () => m.removeEventListener('change', fn);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/**
 * A code is only useful somewhere else, so copying it is one press. Clipboard
 * access throws on an insecure origin, and a button that silently does nothing
 * is worse than one that says it was blocked.
 */
export function CopyButton({ value, label = 'Copy', size = 'sm', variant, className = '', ...rest }) {
  const [said, setSaid] = useState('');
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy(event) {
    // A copy inside a pressable row is not a press on the row.
    event?.stopPropagation?.();
    let ok = true;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      ok = false;
    }
    setSaid(ok ? 'Copied' : 'Copy blocked');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setSaid(''), 1800);
  }

  return (
    <Button
      size={size}
      variant={variant}
      className={`${className}${label == null ? ' btn-icon' : ''}`}
      icon={said === 'Copied' ? 'check' : 'copy'}
      onClick={copy}
      {...rest}
    >
      {/* With no label it is an icon, and what happened is still said aloud. */}
      {label != null
        ? <span aria-live="polite">{said || label}</span>
        : <span className="sr-only" aria-live="polite">{said}</span>}
    </Button>
  );
}

/** A code to hand over: large, in mono, with the button that copies it. */
export function CodeBlock({ code, label }) {
  return (
    <div className="ac-codeblock">
      <div className="grow">
        {label && <div className="eyebrow">{label}</div>}
        <div className="ac-code">{code}</div>
      </div>
      <CopyButton value={code} label="Copy the code" variant="primary" size={null} className="ac-tap" />
    </div>
  );
}

/** Label and value, one pair per line: the facts in an inspector. */
export function Facts({ items }) {
  return (
    <dl className="ac-kv">
      {items.filter(Boolean).map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
