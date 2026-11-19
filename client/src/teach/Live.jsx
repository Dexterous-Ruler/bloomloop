/**
 * Step four: the class, live.
 *
 * The page opens on a forest brief: one sentence on where the class is right
 * now, the numbers behind it, and a strip of what just changed - all of it
 * worked out from the feed, nothing written in advance. The sparklines are
 * sampled here, from the moment this page opened, so they start empty and only
 * ever show what this page actually saw.
 *
 * Under it, the roster as a heatmap: one row per student, one cell per level,
 * the cell's green as deep as their accuracy there and a ring on the level they
 * are being served now. Beside it the class as marbles in six tubes, and
 * whoever is selected - their level, the server's own sentence for why, how
 * they compare with the class, what they answered since this page opened, and
 * what was recorded about the session.
 *
 * Everything under the head is fed by a socket, so the moment the socket is
 * gone none of it is current. The page says so in a banner and fades the data,
 * because a quiet class and a dead page otherwise look identical.
 *
 * Two reads are not the socket's: the stored record. The heatmap card turns
 * to topics or to questions (the item report: how each question did, and
 * which keys are worth a look), counted by the server from final, marked
 * answers; the inspector
 * lists the selected student's every attempt with the question as their phone
 * showed it. Both are read over HTTP, and read again only when the roster says
 * there is something new to read.
 *
 * Phase 3 puts the rest of the room beside the class: a switch under the head
 * opens Insights, Attendance (a class room), In the room (the wheel, the
 * raised-hands tally, observations and activities) and the Projector. A
 * Teacher-led room has no phones, so it opens on In the room and has no Class
 * view. A waiting room shows its lobby, with Start, above whichever is open.
 * All of it is for this screen only: none of it reaches a phone or the wall.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import Marbles from '../fx/Marbles.jsx';
import { api } from '../lib/api.js';
import { LABEL, LEVELS, pct } from '../lib/bloom.js';
import { KIND_LABEL } from '../lib/kinds.js';
import { Avatar, Button, Dialog, Field, Fig, Icon, Level, Menu, Note, Num, Panel, Segmented, Spark } from '../ui/index.jsx';
import Attendance from './Attendance.jsx';
import FeedSplit from './FeedSplit.jsx';
import Insights from './Insights.jsx';
import { ItemList, Thresholds } from './ItemStats.jsx';
import Lobby from './Lobby.jsx';
import ProjectorControl from './ProjectorControl.jsx';
import Records, { RECORD_TABS } from './Records.jsx';
import ClassQuestions, { RoomConfidence } from './ClassQuestions.jsx';
import { RoomMisconceptions } from './Misconceptions.jsx';
import StudentCard from './StudentCard.jsx';
import useRoomFeed from './useRoomFeed.js';
import { ImportedNote, isKept, KeptTag, laptopItems } from './imported.jsx';

const ZERO = { seen: 0, correct: 0 };
const SHORT = ['Rem', 'Und', 'App', 'Ana', 'Eva', 'Cre'];
const levelAt = (l) => LEVELS.indexOf(l);

// What a row carries when the server sent no summary: 'clear', so the absence
// of data never renders as a signal.
const NO_SIG = { events: 0, away: 0, awayMs: 0, reported: 0, observed: 0, notes: [], level: 'clear' };
// `integrity: null` is not "nothing recorded": signals are not shown for this
// row (a student marked under 18 in a class room, or a roster read that failed
// for this push). It draws as off, never as clear and never as a signal.
const OFF_SIG = { ...NO_SIG, off: true };
const sigOf = (row) => (row && row.integrity === null ? OFF_SIG : row?.integrity ?? NO_SIG);

// Each filter carries its own test, so the count on the control and the rows
// it reveals cannot drift apart.
const FILTERS = [
  { id: 'all', label: 'Everyone', match: () => true },
  { id: 'online', label: 'Answering now', match: (r) => r.online },
  { id: 'band', label: 'Support band', match: (r) => r.slowLearner },
  { id: 'above', label: 'Above Understand', match: (r) => LEVELS.indexOf(r.workingLevel) > 1 },
  // Not "flagged": it narrows to the students something was recorded about.
  { id: 'signals', label: 'With signals', match: (r) => sigOf(r).level !== 'clear' },
];

// Anything arriving without a stamp is treated as the weaker class: the error
// that costs a student is trusting a signal too much.
const isObserved = (e) => e?.src === 'observed';
const secs = (ms) => `${(Math.max(0, Number(ms) || 0) / 1000).toFixed(1)}s`;

/** One event as a sentence: what was reported or worked out, and nothing more. */
function eventLine(e) {
  switch (e?.kind) {
    case 'hidden': return `The tab was hidden${Number(e.awayMs) ? ` for ${secs(e.awayMs)}` : ''}.`;
    case 'returned': return 'The tab came back.';
    case 'blurred': return 'The window lost focus.';
    case 'fullscreen-exit': return 'Focus mode was left.';
    case 'paste': return 'Text was pasted into an answer.';
    case 'reload': return 'The page was reloaded.';
    case 'too-fast': return `An answer arrived in ${secs(e.tookMs)}, against about ${secs(e.expectedMs)} to read the question.`;
    case 'second-socket': return 'The same roll number was answering from a second live connection.';
    default: return String(e?.kind ?? 'unknown');
  }
}

const skippedLabel = (e) => (e === null || typeof e !== 'object' ? String(e) : String(e.rollNo || e.name || e.reason || 'unknown'));
const CLOCK = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const stamp = (iso) => { const at = new Date(iso); return Number.isNaN(at.getTime()) ? '—' : CLOCK.format(at); };
const forHuman = (s) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`);
const ago = (at, now) => {
  const s = Math.max(0, Math.round((now - at) / 1000));
  return s < 15 ? 'just now' : s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`;
};
const byRoll = (a, b) => String(a.rollNo).localeCompare(String(b.rollNo), undefined, { numeric: true });
const plural = (n, one, many = `${one}s`) => (n === 1 ? one : many);

/** How long since a moment, in whole minutes: "under a minute", "24 min", "1 h 05 min". */
const lasted = (ms) => {
  const m = Math.floor(Math.max(0, ms) / 60_000);
  if (m < 1) return 'under a minute';
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
};

// The parts of the room, as the address names them (F3): `?space=` and, for
// the teacher records, `?tab=`. A reload or a shared link opens on the same one.
const SPACE_IDS = ['class', 'insights', 'ask', 'attendance', 'room', 'projector'];

/**
 * A room code split in two for reading aloud: "K7Q 42M", with a visual gap and
 * never a dot or a hyphen. The gap is a margin, not a character, so copying the
 * code still gives its six characters.
 */
function SplitCode({ code, className = '' }) {
  const c = String(code ?? '');
  if (c.length !== 6) return <span className={`mono ${className}`}>{c}</span>;
  return <span className={`mono lc-code ${className}`}><span>{c.slice(0, 3)}</span><span className="lc-code-b">{c.slice(3)}</span></span>;
}

/** The lower median of the working levels of students with a graded answer, or null. */
function medianLevel(rows) {
  const at = rows.filter((r) => LEVELS.includes(r.workingLevel) && (r.total || ZERO).seen > 0).map((r) => levelAt(r.workingLevel)).sort((a, b) => a - b);
  return at.length ? { level: LEVELS[at[Math.floor((at.length - 1) / 2)]], of: at.length } : null;
}

/** A student's running accuracy over the answers this page has watched, one point per delivery. */
function trendOf(tries = []) {
  let n = 0;
  let k = 0;
  return tries.map((t) => { n += t.n; k += t.k; return k / n; });
}

// How the heatmap draws accuracy: shaded cells, or dots whose size and
// opacity carry it (so it can be read without comparing shades). Remembered
// on this device only.
const VIEW_KEY = 'bloomloop.heatView';
const readView = () => { try { return localStorage.getItem(VIEW_KEY) === 'dots' ? 'dots' : 'cells'; } catch { return 'cells'; } };
const keepView = (v) => { try { localStorage.setItem(VIEW_KEY, v); } catch { /* private window: not kept */ } };

// Four steps of one green, deepest for the best. Unanswered is a step of its
// own with no fill, so "not asked yet" can never read as "got it wrong".
const heat = (seen, correct) => {
  if (!seen) return 0;
  const a = correct / seen;
  return a >= 0.8 ? 4 : a >= 0.6 ? 3 : a >= 0.4 ? 2 : 1;
};
const HEAT_KEY = [[1, 'under 40%'], [2, '40 to 59%'], [3, '60 to 79%'], [4, '80% or more']];

// The brief's sparklines: one sample every ten seconds from this page's own
// view of the feed, ten minutes kept. Nothing before the page opened exists.
const SAMPLE_MS = 10_000;
const KEEP = 60;
const NO_SERIES = { online: [], answers: [], acc: [], met: [] };
const sample = (s, f) => ({
  online: [...s.online, f.online].slice(-KEEP),
  answers: [...s.answers, f.answers].slice(-KEEP),
  acc: f.acc === null ? s.acc : [...s.acc, Math.round(f.acc * 1000) / 10].slice(-KEEP),
  met: [...s.met, f.met].slice(-KEEP),
});

/** Pooled seen/correct per level across a set of rows. */
function pooled(list) {
  const out = Object.fromEntries(LEVELS.map((l) => [l, { seen: 0, correct: 0 }]));
  list.forEach((r) => LEVELS.forEach((l) => {
    const c = (r.levels || {})[l];
    if (c) { out[l].seen += c.seen || 0; out[l].correct += c.correct || 0; }
  }));
  return out;
}

/**
 * Phase 5, honest indicators: what a row's working level rests on
 * (`levelBasis`: the answers behind it, whether it is still provisional, and
 * the server's sentence) and, per level answered at, what its mastery rests on
 * (`masteryBasis`). Both arrive on every grid row; older rows have neither.
 */
const basisOf = (r) => (r?.levelBasis && typeof r.levelBasis === 'object' ? r.levelBasis : null);
const masteryOf = (r) => (Array.isArray(r?.masteryBasis) ? r.masteryBasis : []);
const masteryAt = (r, level) => masteryOf(r).find((m) => m.level === level) ?? null;
// Said beside a provisional level unless the server's own sentence already starts with the word.
const needsProvWord = (b) => Boolean(b?.provisional) && !/^provisional/i.test(String(b.sentence ?? ''));

/**
 * Six axes, one per level: this student's accuracy against the class's pooled
 * accuracy, with the room's mastery goal drawn as a dashed ring. A level with
 * no answers sits at the centre and its label says so.
 */
function Radar({ mine = {}, theirs = {}, goal, current, who }) {
  const S = 264;
  const C = S / 2;
  const R = 84;
  const at = (i, v) => {
    const a = ((-90 + i * 60) * Math.PI) / 180;
    return [C + Math.cos(a) * R * v, C + Math.sin(a) * R * v];
  };
  const poly = (vals) => vals.map((v, i) => at(i, v).map((n) => n.toFixed(1)).join(',')).join(' ');
  const acc = (c) => (c?.seen ? c.correct / c.seen : 0);
  const me = LEVELS.map((l) => acc(mine[l]));
  const all = LEVELS.map((l) => acc(theirs[l]));
  const said = LEVELS.map((l, i) => `${LABEL[l]} ${mine[l]?.seen ? `${Math.round(me[i] * 100)}%` : 'not answered'}, class ${theirs[l]?.seen ? `${Math.round(all[i] * 100)}%` : 'not answered'}`);
  return (
    <svg className="lc-radar" viewBox={`0 0 ${S} ${S}`} role="img" aria-label={`${who} against the class, by level: ${said.join('; ')}.`}>
      {[0.25, 0.5, 0.75, 1].map((f) => <polygon key={f} className="lc-radar-ring" points={poly(LEVELS.map(() => f))} />)}
      {LEVELS.map((l, i) => { const [x, y] = at(i, 1); return <line key={l} className="lc-radar-axis" x1={C} y1={C} x2={x} y2={y} />; })}
      {goal > 0 && <polygon className="lc-radar-goal" points={poly(LEVELS.map(() => goal))} />}
      <polygon className="lc-radar-class" points={poly(all)} />
      <polygon className="lc-radar-me" points={poly(me)} />
      {me.map((v, i) => {
        if (!mine[LEVELS[i]]?.seen) return null;
        const [x, y] = at(i, v);
        return <circle key={LEVELS[i]} className="lc-radar-pt" cx={x.toFixed(1)} cy={y.toFixed(1)} r={3} />;
      })}
      {LEVELS.map((l, i) => {
        const [x, y] = at(i, 1.3);
        const anchor = i === 0 || i === 3 ? 'middle' : i < 3 ? 'start' : 'end';
        const seen = mine[l]?.seen;
        return (
          <g key={l} className="lc-radar-lab" data-current={current === l ? 'true' : undefined}>
            <text x={x.toFixed(1)} y={(y - 3).toFixed(1)} textAnchor={anchor}>{SHORT[i]}</text>
            <text className="lc-radar-val" x={x.toFixed(1)} y={(y + 10).toFixed(1)} textAnchor={anchor}>{seen ? `${Math.round(me[i] * 100)}%` : '—'}</text>
          </g>
        );
      })}
    </svg>
  );
}

/* ------------------------------------------------- the stored record */

const PAGE = 8;
// The topic and question reports are read at most this often while the class is answering.
const TOPICS_EVERY = 10_000;
const NO_TOPICS = { status: 'idle', data: null, error: '', at: 0 };
const NO_ITEMS = NO_TOPICS;

const list = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const str = (v) => (v === null || v === undefined ? '' : String(v));
const label = (x) => (typeof x === 'string' ? x : str(x?.header ?? x?.label ?? x?.name));
const LETTER = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
/** An option by its position, lettered; a position with no option says so. */
const option = (opts, i) => {
  const n = Number(i);
  return Number.isInteger(n) && opts[n] !== undefined ? `${LETTER[n] ?? n + 1}. ${opts[n]}` : `position ${str(i)}, not an option`;
};
const cellAt = (at) => str(at).split(':').map(Number);
// A response may arrive as an array or as an object keyed by position.
const nth = (r, i) => (Array.isArray(r) ? r[i] : obj(r)[i]);

/**
 * What the student gave, line by line, read against the question as their
 * phone showed it: positions are positions in that shown order. A response
 * that does not have the shape its kind expects is printed as it was stored,
 * rather than read as nothing.
 */
function given(a) {
  const r = a.response;
  if (r === null || r === undefined || r === '') return [];
  const lines = readAs(a.kind || a.question?.kind || 'mcq', a.question || {}, r).filter((line) => str(line).trim());
  return lines.length ? lines : [typeof r === 'object' ? JSON.stringify(r) : str(r)];
}

function readAs(kind, q, r) {
  switch (kind) {
    case 'mcq': case 'poll': return [option(list(q.options), r)];
    case 'multi': return list(r).map((i) => option(list(q.options), i));
    case 'truefalse': return [typeof r === 'boolean' ? (r ? 'True' : 'False') : str(r)];
    case 'match': return list(q.left).map((l, i) => {
      const pos = nth(r, i);
      return `${l} → ${pos === undefined ? 'left unmatched' : list(q.right)[Number(pos)] ?? `position ${pos}`}`;
    });
    case 'categorise': return Object.entries(obj(r)).map(([pos, g]) => `${list(q.items)[Number(pos)] ?? `item ${pos}`} → ${list(q.groups)[Number(g)] ?? `group ${g}`}`);
    case 'blank': return [str(Array.isArray(r) ? r[0] : r)];
    case 'cloze': return list(r).map((v, i) => `${i + 1}. ${str(v) || 'left empty'}`);
    case 'numeric': return [`${str(r)}${q.unit ? ` ${q.unit}` : ''}`];
    case 'order': case 'rank': return list(r).map((p, i) => `${i + 1}. ${list(q.items)[Number(p)] ?? `position ${p}`}`);
    case 'open': return [str(r)];
    case 'hottext': return [list(r).map((i) => list(q.tokens)[Number(i)] ?? `word ${i}`).join(', ')];
    case 'dropdown': return list(r).map((p, i) => `${i + 1}. ${list(list(q.gaps)[i]?.options)[Number(p)] ?? `position ${p}`}`);
    case 'table': return Object.entries(obj(r)).map(([at, v]) => {
      const [ri, ci] = cellAt(at);
      return `${label(list(q.rows)[ri]) || `Row ${ri + 1}`}, ${label(list(q.columns)[ci]) || `column ${ci + 1}`}: ${str(v) || 'left empty'}`;
    });
    case 'grid': return Object.keys(obj(r)).filter((k) => r[k]).map((at) => {
      const [ri, ci] = cellAt(at);
      return `${label(list(q.rows)[ri]) || `Row ${ri + 1}`} × ${label(list(q.columns)[ci]) || `column ${ci + 1}`}`;
    });
    default: return [typeof r === 'object' ? JSON.stringify(r) : str(r)];
  }
}

/** The answer key, from the question as it was stored when it was served. */
function keyOf(s = {}) {
  const kind = s.kind || 'mcq';
  const opts = list(s.options);
  const out = (() => {
    switch (kind) {
      case 'mcq': return [option(opts, s.answerIdx)];
      case 'multi': return list(s.answerIdxs).map((i) => option(opts, i));
      case 'truefalse': return typeof s.answerBool === 'boolean' ? [s.answerBool ? 'True' : 'False'] : [];
      case 'match': return list(s.pairs).map((p) => `${str(p?.left)} → ${str(p?.right)}`);
      case 'categorise': return list(s.buckets).map((b) => `${str(b?.name)}: ${list(b?.items).join(', ')}`);
      case 'order': case 'rank': return [
        ...(kind === 'rank' && s.criterion ? [`Ranked by ${s.criterion}`] : []),
        ...list(s.sequence).map((t, i) => `${i + 1}. ${t}`),
      ];
      case 'blank': return [list(s.accept).join(' / ')];
      case 'cloze': return list(s.blanks).map((b, i) => `${i + 1}. ${list(b?.accept).join(' / ')}`);
      case 'numeric': {
        const tol = Number(s.tolerance);
        return Number.isFinite(Number(s.value)) ? [`${s.value}${tol > 0 ? ` ± ${tol}` : ''}${s.unit ? ` ${s.unit}` : ''}`] : [];
      }
      case 'open': return list(s.rubric);
      case 'hottext': return [list(s.answerIdxs).map((i) => list(s.tokens)[Number(i)]).filter(Boolean).join(', ')];
      case 'dropdown': return list(s.blanks).map((b, i) => `${i + 1}. ${list(b?.options)[Number(b?.answerIdx)] ?? '—'}`);
      case 'table': return list(s.rows).flatMap((row, ri) => list(row?.cells).map((c, ci) => (
        c?.accept === undefined ? null : `${label(row) || `Row ${ri + 1}`}, ${label(list(s.columns)[ci]) || `column ${ci + 1}`}: ${list(c.accept).join(' / ')}`
      )));
      case 'grid': return list(s.answers).flatMap((row, ri) => list(row).map((v, ci) => (
        v ? `${label(list(s.rows)[ri]) || `Row ${ri + 1}`} × ${label(list(s.columns)[ci]) || `column ${ci + 1}`}` : null
      )));
      default: return [];
    }
  })();
  return out.filter((line) => line && String(line).trim());
}

const share = (score) => `${Math.round(Number(score) * 100)}%`;
const partial = (score) => Number.isFinite(Number(score)) && Number(score) > 0 && Number(score) < 1;

/** The mark in force, as a glyph and as words. */
function markOf(a) {
  // Phase 7: stored after the room closed or past its cap, never counted.
  if (isKept(a)) return { v: 'poll', label: 'Kept, not counted: no mark' };
  if (a.ungraded) return { v: 'poll', label: 'A poll: nothing to mark' };
  if (typeof a.correct !== 'boolean') return { v: 'poll', label: 'No mark recorded' };
  if (partial(a.score)) return { v: a.correct ? 'yes' : 'no', text: share(a.score), label: `${a.correct ? 'Counted as right' : 'Counted as wrong'}, ${share(a.score)} of the marks` };
  return { v: a.correct ? 'yes' : 'no', icon: a.correct ? 'check' : 'close', label: a.correct ? 'Right' : 'Wrong' };
}
const markWords = (m) => (m && typeof m.correct === 'boolean'
  ? `${m.correct ? 'right' : 'wrong'}${partial(m.score) ? ` (${share(m.score)})` : ''}`
  : 'no mark');

// Only written answers are reviewed; everything else is marked by the
// machine alone and says nothing here.
const REVIEW = {
  provisional: { label: 'Provisional', tone: 'warn', say: 'A written answer marked by the machine and not yet reviewed. The mark may change.' },
  confirmed: { label: 'Reviewed', tone: 'ok', say: 'Reviewed: the machine’s mark was kept.' },
  overridden: { label: 'Changed', tone: 'ink', say: 'Reviewed: the mark was changed.' },
};

/**
 * The selected student's every attempt in this room, newest first: retries
 * and polls too, because this is the record and not a report. Keyed on the
 * student by its parent, so a late page can never land on someone else.
 * `signature` moves when the roster shows them answering (or a review moving
 * their numbers); only then is the first page read again and merged in.
 */
function RoomAnswers({ code, roll, signature }) {
  const [state, setState] = useState({ status: 'loading', items: [], hasMore: false, error: '' });
  const [more, setMore] = useState(false);
  const [moreError, setMoreError] = useState('');
  const [open, setOpen] = useState(() => new Set());
  const req = useRef(0);

  const load = useCallback(() => {
    const id = ++req.current;
    api.roomAnswers(code, { rollNo: roll, limit: PAGE }).then(
      (res) => {
        if (req.current !== id) return;
        const fresh = list(res?.items);
        setState((s) => {
          if (!s.items.length) return { status: 'ready', items: fresh, hasMore: Boolean(res?.hasMore), error: '' };
          const ids = new Set(fresh.map((a) => a.answerId));
          // More arrived than one page holds: the gap cannot be stitched, so
          // the list starts again from the newest.
          if (res?.hasMore && !s.items.some((a) => ids.has(a.answerId))) return { status: 'ready', items: fresh, hasMore: true, error: '' };
          return { status: 'ready', items: [...fresh, ...s.items.filter((a) => !ids.has(a.answerId))], hasMore: s.hasMore, error: '' };
        });
      },
      (err) => {
        if (req.current !== id) return;
        setState((s) => ({ ...s, status: s.items.length ? 'ready' : 'error', error: err.message }));
      },
    );
  }, [code, roll]);

  useEffect(() => { load(); }, [load]);

  // A short wait folds a burst of roster pushes into one read.
  const lastSig = useRef(signature);
  useEffect(() => {
    if (lastSig.current === signature) return undefined;
    lastSig.current = signature;
    const timer = setTimeout(load, 700);
    return () => clearTimeout(timer);
  }, [signature, load]);

  async function showMore() {
    setMore(true); setMoreError('');
    try {
      const res = await api.roomAnswers(code, { rollNo: roll, limit: PAGE, offset: state.items.length });
      setState((s) => {
        const have = new Set(s.items.map((a) => a.answerId));
        return { ...s, items: [...s.items, ...list(res?.items).filter((a) => !have.has(a.answerId))], hasMore: Boolean(res?.hasMore) };
      });
    } catch (err) { setMoreError(`Could not load more: ${err.message}`); }
    finally { setMore(false); }
  }

  const retry = () => { setState((s) => ({ ...s, status: 'loading', error: '' })); load(); };
  const toggle = (id) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const { status, items, hasMore, error } = state;

  return (
    <div className="lc-insp-sec" aria-busy={status === 'loading' || undefined}>
      <div className="lc-insp-h">
        <h3>Answers in this room</h3>
        <span className="t-meta">{items.length ? 'newest first' : ''}</span>
      </div>

      {status === 'loading' ? (
        <div className="lc-ans-wait" aria-label={`Reading ${roll}'s answers`}>
          {[0, 1, 2].map((i) => (
            <div key={i}><span className="skel" /><span className="skel" /><span className="skel" /></div>
          ))}
        </div>
      ) : status === 'error' ? (
        <Note tone="bad">
          Could not read {roll}'s answers: {error}
          <div style={{ marginTop: 8 }}><Button size="sm" icon="refresh" onClick={retry}>Try again</Button></div>
        </Note>
      ) : items.length === 0 ? (
        <p className="hint">No answer from {roll} is stored in this room yet. Each one lands here with the question exactly as their phone showed it.</p>
      ) : (
        <>
          <ol className="lc-answers">
            {items.map((a) => {
              const m = markOf(a);
              const said = given(a);
              const rv = REVIEW[a.review?.status];
              const isOpen = open.has(a.answerId);
              const panel = `lc-ans-${a.answerId}`;
              const q = a.question || {};
              const key = keyOf(a.snapshot);
              const note = str(a.review?.note).trim();
              const kept = isKept(a);
              const reading = kept ? '' : str(a.auto?.detail || a.detail).trim();
              return (
                <li key={a.answerId} className="lc-ans" data-final={a.final === false ? 'false' : undefined}>
                  <span className="lc-mark" data-v={m.v} data-prov={a.review?.status === 'provisional' ? 'true' : undefined} title={m.label}>
                    {m.icon ? <Icon name={m.icon} size={13} /> : m.text ?? <i aria-hidden="true" />}
                    <span className="sr-only">{m.label}</span>
                  </span>
                  <div className="lc-ans-main">
                    <button type="button" className="lc-ans-q" aria-expanded={isOpen} aria-controls={panel} onClick={() => toggle(a.answerId)}>
                      <span className="clip">{q.text || a.snapshot?.text || 'Question text not stored'}</span>
                      <Icon name="chevron" size={14} />
                    </button>
                    <p className="lc-ans-said">
                      <span className="sr-only">Their answer: </span>
                      {said.length ? said.join('; ') : <span className="lc-ans-none">No answer given</span>}
                    </p>
                    <div className="lc-ans-meta">
                      {a.level && <span className="lc-ans-lv" data-level={a.level}><i className="swatch" />{LABEL[a.level] ?? a.level}</span>}
                      <span>Attempt {a.attempt ?? 1}{a.final === false && !kept ? ', retried' : ''}</span>
                      {kept && <KeptTag detail={a.detail} />}
                      <time className="mono" dateTime={a.answeredAt}>{stamp(a.answeredAt)}</time>
                      {rv && (
                        <span className="lc-rv" data-tone={rv.tone} title={rv.say}>
                          {rv.label}
                          {a.review.status === 'provisional' && (
                            <Link className="lc-rv-go" to={`/review?code=${encodeURIComponent(code)}`}>Review<Icon name="forward" size={12} /></Link>
                          )}
                        </span>
                      )}
                    </div>
                    {note && <p className="lc-ans-note"><b>Note to the student</b>{note}</p>}

                    {isOpen && (
                      <dl className="lc-ans-more" id={panel}>
                        <dt>Asked</dt>
                        <dd>
                          <p>{q.text || a.snapshot?.text}</p>
                          {q.stimulus?.text && <p className="lc-ans-stim">{q.stimulus.text}</p>}
                          <span className="lc-ans-kind">{KIND_LABEL[a.kind] ?? a.kind}{a.topic ? ` · ${a.topic}` : ''}</span>
                        </dd>
                        <dt>Gave</dt>
                        <dd>{said.length ? <ul>{said.map((line, i) => <li key={i}>{line}</li>)}</ul> : 'Nothing.'}</dd>
                        <dt>Key</dt>
                        <dd>{key.length ? <ul>{key.map((line, i) => <li key={i}>{line}</li>)}</ul> : a.ungraded ? 'A poll has no key.' : 'No key was stored with this question.'}</dd>
                        <dt>Mark</dt>
                        <dd>
                          {kept
                            ? `${a.detail} It has no mark.`
                            : a.final === false
                            ? 'Wrong, and followed by a retry: this attempt did not count.'
                            : a.ungraded ? 'Not marked. A poll counts towards nothing.' : `${m.label}.`}
                          {reading && <> The machine read it as {reading}.</>}
                          {a.review?.status === 'overridden' && a.auto && (
                            <> First marked {markWords(a.auto)}; changed to {markWords(a)}{a.review.reviewedAt ? ` at ${stamp(a.review.reviewedAt)}` : ''}.</>
                          )}
                          {a.review?.status === 'confirmed' && a.review.reviewedAt && <> Reviewed at {stamp(a.review.reviewedAt)}.</>}
                          {rv && a.review.status === 'provisional' && <> {rv.say}</>}
                        </dd>
                      </dl>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          {hasMore && (
            <div><Button size="sm" variant="ghost" icon="chevron" busy={more} onClick={showMore}>Show more</Button></div>
          )}
          {moreError && <p className="hint lc-ans-err">{moreError}</p>}
          {error && <p className="hint lc-ans-err">Could not read the newest answers just now ({error}). What is shown was read earlier.</p>}
        </>
      )}
    </div>
  );
}

/** The topic report as a heatmap: one row per topic, one cell per level. */
function TopicGrid({ topics, onRetry, closed }) {
  const { status, data, error, at } = topics;
  if (status === 'idle' || (status === 'loading' && !data)) {
    return (
      <div className="lc-tskel" aria-busy="true" aria-label="Counting answers by topic">
        {[0, 1, 2, 3].map((i) => (
          <div key={i}><span className="skel" />{LEVELS.map((l) => <span key={l} className="skel" />)}</div>
        ))}
      </div>
    );
  }
  if (status === 'error' && !data) {
    return (
      <div className="lc-none" role="alert">
        <Icon name="alert" />
        <div>
          <b>Could not count the topics.</b> {error}
          <div style={{ marginTop: 8 }}><Button size="sm" icon="refresh" onClick={onRetry}>Try again</Button></div>
        </div>
      </div>
    );
  }

  const rowsT = list(data?.topics);
  const counted = data?.counted ?? {};
  const untagged = Number(data?.untagged) || 0;
  const source = data?.source;
  const read = at ? ` Read at ${CLOCK.format(at)}.` : '';
  const whence = source === 'history'
    ? `Counted from each student’s running record, not answer by answer: this room ran before answers were stored one at a time.${read}`
    : source === 'mixed'
      ? `${counted.answers ?? 0} from stored answers, ${counted.history ?? 0} from the older running record kept before them; nothing is counted twice.${read}`
      : source === 'answers'
        ? `From ${counted.answers ?? 0} final, marked ${plural(counted.answers ?? 0, 'answer')}.${read}`
        : read.trim();

  if (!rowsT.length) {
    return (
      <div className="lc-tempty">
        <div className="lc-tempty-cells" aria-hidden="true">
          {LEVELS.map((l, i) => <span key={l}><i className="lc-cell" data-heat={0} />{SHORT[i]}</span>)}
        </div>
        <p>
          <b>{untagged ? 'No topic to show.' : 'No marked answers yet.'}</b>{' '}
          {untagged
            ? `${untagged} marked ${plural(untagged, 'answer is', 'answers are')} stored, but none of their questions carries a topic.`
            : closed
              ? 'The room closed before a final answer was marked.'
              : 'A topic gets a row as soon as a final answer on it is marked. Retries and polls are not counted.'}
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="lc-heat-scroll" role="region" aria-label="Topics by level" tabIndex={0}>
        <table className="lc-heat lc-topics">
          <thead>
            <tr>
              <th className="lc-who" scope="col">Topic</th>
              {LEVELS.map((l, i) => (
                <th key={l} className="lc-lv" scope="col" data-level={l} title={LABEL[l]}>
                  <span><i className="swatch" />{SHORT[i]}</span>
                </th>
              ))}
              <th className="lc-acc" scope="col">Acc.</th>
            </tr>
          </thead>
          <tbody>
            {rowsT.map((t) => {
              const byL = Object.fromEntries(list(t.levels).map((x) => [x.level, x]));
              return (
                <tr key={t.topic} className="lc-trow">
                  <th scope="row" className="lc-who">
                    <span className="lc-names">
                      <b className="clip" title={t.topic}>{t.topic}</b>
                      <span>{t.students} {plural(t.students, 'student')}</span>
                    </span>
                  </th>
                  {LEVELS.map((l) => {
                    const c = byL[l] || ZERO;
                    return (
                      <td key={l} className="lc-lv">
                        <span
                          className="lc-cell"
                          data-heat={heat(c.seen, c.correct)}
                          title={c.seen ? `${t.topic} at ${LABEL[l]}: ${c.correct} of ${c.seen} right (${pct(c.seen, c.correct)})` : `${t.topic} at ${LABEL[l]}: nothing marked yet`}
                        >
                          {c.seen ? `${c.correct}/${c.seen}` : ''}
                        </span>
                      </td>
                    );
                  })}
                  <td className="lc-acc">
                    <span className="mono">{pct(t.seen, t.correct)}</span>
                    <span className="lc-acc-of">of {t.seen}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="lc-legend">
        <span className="lc-legend-k">Accuracy</span>
        {HEAT_KEY.map(([h, words]) => (
          <span key={h}><i className="lc-cell lc-key" data-heat={h} />{words}</span>
        ))}
        <p className="lc-legend-note">
          {whence}
          {untagged > 0 && ` ${untagged} ${plural(untagged, 'answer')} had no topic and ${untagged === 1 ? 'is' : 'are'} left out.`}
          {status === 'error' && ` The last read failed (${error}); this is the one before it.`}
        </p>
      </div>
    </>
  );
}

/**
 * The item report for this room: one row per question, flagged first, each
 * opening into what the class chose. Read over HTTP like the topics.
 */
function RoomQuestions({ items, onRetry, closed, onCheckKey }) {
  const { status, data, error, at } = items;
  if (status === 'idle' || (status === 'loading' && !data)) {
    return (
      <div className="it-skel lc-qskel" aria-busy="true" aria-label="Counting how each question did">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="it-skel-row"><span className="skel" /><span className="skel" /><span className="skel" /></div>
        ))}
      </div>
    );
  }
  if (status === 'error' && !data) {
    return (
      <div className="lc-none" role="alert">
        <Icon name="alert" />
        <div>
          <b>Could not read how the questions did.</b> {error}
          <div style={{ marginTop: 8 }}><Button size="sm" icon="refresh" onClick={onRetry}>Try again</Button></div>
        </div>
      </div>
    );
  }

  const all = laptopItems(data?.items, data?.room?.importedFrom);
  const answers = Number(data?.counted?.answers) || 0;
  const read = at ? ` Read at ${CLOCK.format(at)}.` : '';

  if (!all.length) {
    return (
      <div className="lc-tempty">
        <p>
          <b>No marked answers yet.</b>{' '}
          {closed
            ? 'The room closed before a final answer was marked.'
            : 'A question gets a row as soon as a final answer to it is marked. Retries and polls are not counted.'}
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="lc-heat-scroll lc-qscroll" role="region" aria-label="Questions in this room" tabIndex={0}>
        <ItemList items={all} thresholds={data.thresholds} translation={data.translation} onCheckKey={onCheckKey} />
      </div>
      <div className="lc-legend">
        <Thresholds thresholds={data.thresholds} className="lc-legend-note" />
        <p className="lc-legend-note">
          From {answers} final, marked {plural(answers, 'answer')}: a wrong try followed by a retry and a poll are left out.{read}
          {status === 'error' && ` The last read failed (${error}); this is the one before it.`}
        </p>
      </div>
    </>
  );
}

/**
 * This room's row in the room list: its class, its settings and whether this
 * caller may act on it (`canControl`, false for an HOD). Read again when the
 * room's status changes, so a start or a close is reflected.
 */
function useRoomInfo(code, status) {
  // undefined while the first read is out; null when it failed or the room is
  // not in the list (the class view works without it).
  const [info, setInfo] = useState(undefined);
  useEffect(() => {
    let alive = true;
    api.listSessions().then(
      (res) => {
        const row = list(res?.rooms ?? res).find((r) => r.code === code);
        if (alive) setInfo((prev) => row ?? prev ?? null);
      },
      () => { if (alive) setInfo((prev) => prev ?? null); },
    );
    return () => { alive = false; };
  }, [code, status]);
  return info;
}

export default function Live({ code, title, closed, onClosed, onProjector, onOpenQuestion }) {
  const { rows, room, insights, classQuestion, setClassQuestion, wire, wireError, error, setError, downFor, retry, roomStatus, setRoomStatus } = useRoomFeed(code);
  const info = useRoomInfo(code, roomStatus);
  const known = info !== undefined;
  const mode = info?.settings?.mode ?? 'devices';
  const led = mode === 'teacher-led';
  const classRoom = Boolean(info?.classId);
  // Unknown until the room list answers; a write the caller may not make is
  // refused by the server with its own sentence either way.
  const canControl = info ? info.canControl !== false : true;
  const waitingRoom = !closed && (roomStatus || info?.status) === 'waiting';
  const paused = roomStatus === 'paused';
  // Which part of the room is open, and which teacher record, read from the
  // address and written back to it (F3), so a reload or a shared link keeps
  // them. No space in the address means the room's own default, so a
  // Teacher-led room opens on its own tools once the room list has said what
  // it is. Replaced, not pushed: Back still leaves the console.
  const location = useLocation();
  const navigate = useNavigate();
  const asked = new URLSearchParams(location.search);
  const space = SPACE_IDS.includes(asked.get('space')) ? asked.get('space') : null;
  const recordsTab = RECORD_TABS.some((t) => t.id === asked.get('tab')) ? asked.get('tab') : 'wheel';
  const setAddress = useCallback((patch) => {
    const next = new URLSearchParams(window.location.search);
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    const search = next.toString();
    if (search === window.location.search.replace(/^\?/, '')) return;
    navigate({ search: search ? `?${search}` : '' }, { replace: true });
  }, [navigate]);
  const setSpace = useCallback((id) => setAddress({ space: id }), [setAddress]);
  const setRecordsTab = useCallback((id) => setAddress({ tab: id }), [setAddress]);
  // Null: Insights orders the students as the server says by default (roll order).
  const [insightSort, setInsightSort] = useState(null);
  const [heatView, setHeatView] = useState(readView);
  const [cardRoll, setCardRoll] = useState('');
  const [askLevel, setAskLevel] = useState(null);
  const [toggling, setToggling] = useState(false);
  const [exporting, setExporting] = useState(false);
  const { live, everLive, downSince, rejoined, stopped } = wire;

  const [pickedRoll, setPickedRoll] = useState('');
  // The heatmap card's two readings: the roster, or the room by topic.
  const [lens, setLens] = useState('students');
  const [topics, setTopics] = useState(NO_TOPICS);
  // The Questions side: the room's item report, and the question whose key
  // the teacher asked about.
  const [items, setItems] = useState(NO_ITEMS);
  const [keyFor, setKeyFor] = useState(null);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [classroom, setClassroom] = useState(null);
  const [classroomError, setClassroomError] = useState('');
  const [linking, setLinking] = useState(false);
  const [courses, setCourses] = useState(null);
  const [courseId, setCourseId] = useState('');
  const [posting, setPosting] = useState(false);
  const [posted, setPosted] = useState(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [ending, setEnding] = useState(false);
  // The raw events for one student. Asked for, never fetched on selection.
  const [trail, setTrail] = useState(null);
  const [trailBusy, setTrailBusy] = useState(false);
  const [trailError, setTrailError] = useState('');

  // What this page has watched happen since it opened: arrivals, level moves
  // and each student's answers, worked out by comparing one roster with the
  // next. Kept here only; a reload starts it again from nothing.
  const [feed, setFeed] = useState({ events: [], tries: {}, up: 0, down: 0 });
  const [series, setSeries] = useState(NO_SERIES);
  const [now, setNow] = useState(() => Date.now());

  // Checked on arrival and again whenever this window regains focus, which is
  // when the teacher comes back from the Google consent tab.
  useEffect(() => {
    let alive = true;
    const check = () => api.classroomStatus().then(
      (res) => { if (alive) setClassroom(res); },
      (err) => { if (alive) { setClassroom({ configured: false }); setClassroomError(err.message); } },
    );
    check();
    window.addEventListener('focus', check);
    return () => { alive = false; window.removeEventListener('focus', check); };
  }, []);

  async function connectClassroom() {
    setClassroomError(''); setLinking(true);
    // Opened before the request, or the browser blocks it as a popup. Not with
    // "noopener": that makes open() return null, so the tab could never be sent
    // anywhere. The opener is cut by hand instead, and the class stays on screen.
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    try {
      const { url } = await api.classroomAuthUrl();
      if (tab) tab.location.href = url; else window.location.href = url;
    } catch (err) {
      if (tab) tab.close();
      setClassroomError(`Could not start the Google sign-in: ${err.message}`);
    } finally { setLinking(false); }
  }

  async function loadCourses() {
    setClassroomError(''); setPosting(true);
    try {
      const res = await api.classroomCourses();
      const list = res.courses ?? [];
      setCourses(list);
      if (list.length) setCourseId(list[0].id);
    } catch (err) { setClassroomError(`Could not list Classroom courses: ${err.message}`); }
    finally { setPosting(false); }
  }

  async function post() {
    setClassroomError(''); setPosted(null); setPosting(true);
    try { setPosted(await api.classroomPost(code, courseId)); setCourses(null); }
    catch (err) { setClassroomError(`Posting to Classroom failed: ${err.message}`); }
    finally { setPosting(false); }
  }

  // Closed from anywhere (the rooms screen, another tab): this screen follows.
  useEffect(() => {
    if (roomStatus === 'closed' && !closed) onClosed();
  }, [roomStatus, closed, onClosed]);

  async function togglePause() {
    setError(''); setToggling(true);
    try {
      if (paused) await api.resumeSession(code); else await api.pauseSession(code);
      // The server confirms over the socket as well; set it here so the button
      // never waits on the wire to show what it just did.
      setRoomStatus(paused ? 'open' : 'paused');
    } catch (err) {
      setError(`Could not ${paused ? 'resume' : 'pause'} the room: ${err.message}`);
    } finally { setToggling(false); }
  }

  async function exportCsv() {
    setError(''); setExporting(true);
    try { await api.downloadExport(code); }
    catch (err) { setError(`Could not export the results: ${err.message}`); }
    finally { setExporting(false); }
  }

  async function end() {
    setError(''); setEnding(true);
    try { await api.closeSession(code); onClosed(); }
    catch (err) { setError(`Could not close the room: ${err.message}`); }
    finally { setEnding(false); setConfirmEnd(false); }
  }

  async function loadTrail(rollNo) {
    setTrailError(''); setTrailBusy(true);
    try { setTrail(await api.integrity(code, rollNo)); }
    catch (err) { setTrailError(`Could not load the trail for ${rollNo}: ${err.message}`); }
    finally { setTrailBusy(false); }
  }

  const answers = rows.reduce((n, r) => n + (typeof r.answered === 'number' ? r.answered : (r.total || ZERO).seen), 0);
  const online = rows.filter((r) => r.online).length;
  const inBand = rows.filter((r) => r.slowLearner).length;
  // Pooled, not a mean of per-student accuracies: two answers must not weigh the same as twenty.
  const seen = rows.reduce((n, r) => n + (r.total || ZERO).seen, 0);
  const correct = rows.reduce((n, r) => n + (r.total || ZERO).correct, 0);
  const counts = LEVELS.map((l) => rows.filter((r) => r.workingLevel === l).length);
  const byLevel = useMemo(() => pooled(rows), [rows]);
  // Met the room's goal at one level or more, by the server's own reckoning.
  const met = rows.filter((r) => Array.isArray(r.mastered) && r.mastered.length > 0).length;
  const goal = rows.find((r) => Number(r.masteryGoal) > 0)?.masteryGoal ?? null;

  // ---- the topic report ------------------------------------------------------
  // Read when the Topics side of the card is first opened, then again only
  // when the roster shows new answers or a review moved a mark, and never more
  // often than TOPICS_EVERY. A newer read always wins over an older one.
  const topicsReq = useRef(0);
  const topicsFor = useRef({ sig: null, at: 0 });
  const topicsSig = `${seen}:${correct}`;
  const sigNow = useRef(topicsSig);
  sigNow.current = topicsSig;
  const loadTopics = useCallback(() => {
    const id = ++topicsReq.current;
    topicsFor.current = { sig: sigNow.current, at: Date.now() };
    setTopics((t) => ({ ...t, status: t.data ? t.status : 'loading' }));
    api.roomTopics(code).then(
      (data) => { if (topicsReq.current === id) setTopics({ status: 'ready', data, error: '', at: Date.now() }); },
      (err) => { if (topicsReq.current === id) setTopics((t) => ({ ...t, status: 'error', error: err.message })); },
    );
  }, [code]);
  useEffect(() => {
    topicsReq.current += 1;
    topicsFor.current = { sig: null, at: 0 };
    setTopics(NO_TOPICS);
  }, [code]);
  useEffect(() => {
    if (lens !== 'topics' || topicsFor.current.sig === topicsSig) return undefined;
    const timer = setTimeout(loadTopics, Math.max(0, topicsFor.current.at + TOPICS_EVERY - Date.now()));
    return () => clearTimeout(timer);
  }, [lens, topicsSig, loadTopics]);

  // ---- the question report ---------------------------------------------------
  // The same rhythm as the topics: read when the Questions side is opened,
  // again when the roster moves, never more often than TOPICS_EVERY, and once
  // more when the room closes.
  const itemsReq = useRef(0);
  const itemsFor = useRef({ sig: null, at: 0 });
  const itemsSig = `${topicsSig}:${closed ? 'closed' : 'open'}`;
  const itemsSigNow = useRef(itemsSig);
  itemsSigNow.current = itemsSig;
  const loadItems = useCallback(() => {
    const id = ++itemsReq.current;
    itemsFor.current = { sig: itemsSigNow.current, at: Date.now() };
    setItems((t) => ({ ...t, status: t.data ? t.status : 'loading' }));
    api.roomItems(code).then(
      (data) => { if (itemsReq.current === id) setItems({ status: 'ready', data, error: '', at: Date.now() }); },
      (err) => { if (itemsReq.current === id) setItems((t) => ({ ...t, status: 'error', error: err.message })); },
    );
  }, [code]);
  useEffect(() => {
    itemsReq.current += 1;
    itemsFor.current = { sig: null, at: 0 };
    setItems(NO_ITEMS);
    setKeyFor(null);
  }, [code]);
  useEffect(() => {
    if (lens !== 'questions' || itemsFor.current.sig === itemsSig) return undefined;
    const timer = setTimeout(loadItems, Math.max(0, itemsFor.current.at + TOPICS_EVERY - Date.now()));
    return () => clearTimeout(timer);
  }, [lens, itemsSig, loadItems]);
  const itemList = list(items.data?.items);
  const keyItem = keyFor ? itemList.find((i) => i.questionId === keyFor) ?? null : null;

  // ---- what this page has seen happen --------------------------------------
  // The hook's own empty start is not a delivery, so it is told apart by
  // reference. The first real delivery is the baseline: nobody already in the
  // room when the page opened "joins".
  const start = useRef(rows);
  const before = useRef(null);
  useEffect(() => {
    if (rows === start.current) return;
    const snap = new Map(rows.map((r) => [r.rollNo, { level: r.workingLevel, seen: (r.total || ZERO).seen, correct: (r.total || ZERO).correct }]));
    const prev = before.current;
    before.current = snap;
    if (!prev) return;
    const at = Date.now();
    const evs = [];
    const tries = {};
    let up = 0;
    let down = 0;
    rows.forEach((r) => {
      const was = prev.get(r.rollNo);
      const is = snap.get(r.rollNo);
      if (!was) { evs.push({ kind: 'join', rollNo: r.rollNo, name: r.name, level: is.level, at }); return; }
      if (is.seen > was.seen) {
        // One answer between two rosters is a tick or a cross. More than one
        // (after a reconnect) is kept as a count: their order is not known.
        tries[r.rollNo] = { at, n: is.seen - was.seen, k: Math.max(0, is.correct - was.correct), level: was.level };
      }
      if (is.level !== was.level) {
        const rose = levelAt(is.level) > levelAt(was.level);
        if (rose) up += 1; else down += 1;
        evs.push({ kind: rose ? 'up' : 'down', rollNo: r.rollNo, name: r.name, level: is.level, at });
      }
    });
    if (!evs.length && !Object.keys(tries).length) return;
    setFeed((f) => {
      const next = { ...f.tries };
      Object.entries(tries).forEach(([roll, t]) => { next[roll] = [...(next[roll] ?? []), t].slice(-24); });
      return {
        events: [...evs.map((e, i) => ({ ...e, id: `${at}-${i}-${e.rollNo}` })).reverse(), ...f.events].slice(0, 12),
        tries: next,
        up: f.up + up,
        down: f.down + down,
      };
    });
  }, [rows]);

  // Pausing, resuming and closing belong on the strip too.
  const lastStatus = useRef('');
  useEffect(() => {
    const was = lastStatus.current;
    lastStatus.current = roomStatus;
    if (!was || !roomStatus || was === roomStatus) return;
    const at = Date.now();
    setFeed((f) => ({ ...f, events: [{ kind: 'status', status: roomStatus, at, id: `${at}-status` }, ...f.events].slice(0, 12) }));
  }, [roomStatus]);

  // Default to a student in the support band: that is who the teacher is most
  // likely looking for, and they should not have to hunt.
  const sel = useMemo(() => {
    if (!rows.length) return null;
    return rows.find((r) => r.rollNo === pickedRoll) ?? rows.find((r) => r.slowLearner) ?? rows[0];
  }, [rows, pickedRoll]);
  const selSig = sigOf(sel);
  const selTotal = sel?.total || ZERO;
  // A trail belongs to one student; checked at render so a late response can
  // never paint itself onto whoever is selected by then.
  const shownTrail = trail && sel && trail.rollNo === sel.rollNo ? trail : null;
  useEffect(() => { setTrailError(''); setTrailBusy(false); }, [sel?.rollNo]);

  const shown = useMemo(() => {
    const match = (FILTERS.find((f) => f.id === filter) ?? FILTERS[0]).match;
    const q = query.trim().toLowerCase();
    return rows.filter((r) => match(r) && (!q || `${r.rollNo} ${r.name || ''}`.toLowerCase().includes(q)));
  }, [rows, filter, query]);

  // Grouped by the level each student is working at, lowest first, so the
  // rings step down and to the right like the ladder they are on. Inside a
  // group the order is the roll, which does not move while the class answers.
  const groups = useMemo(() => {
    const out = LEVELS.map((l) => ({ id: l, level: l, rows: shown.filter((r) => r.workingLevel === l).sort(byRoll) }));
    const rest = shown.filter((r) => !LEVELS.includes(r.workingLevel)).sort(byRoll);
    if (rest.length) out.push({ id: 'none', level: null, rows: rest });
    return out.filter((g) => g.rows.length);
  }, [shown]);

  const ready = Boolean(classroom?.configured && classroom?.connected);
  const needsAuth = Boolean(classroom?.configured && !classroom?.connected);
  const empty = rows.length === 0;
  const connecting = empty && !everLive && !closed && !wireError && !error;
  const stale = Boolean(downSince) && !closed;
  const fade = stale ? { opacity: 0.5 } : undefined;

  // ---- the sparklines -------------------------------------------------------
  const figs = useRef(null);
  figs.current = { online, answers, acc: seen ? correct / seen : null, met };
  const sampling = rows.length > 0 && !stale && !closed;
  const sampleOn = useRef(false);
  sampleOn.current = sampling;
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
      // Presence is unknown while the socket is down, so nothing is sampled.
      if (sampleOn.current) setSeries((s) => sample(s, figs.current));
    }, SAMPLE_MS);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (sampling) setSeries((s) => (s.answers.length ? s : sample(s, figs.current)));
  }, [sampling]);
  const perStep = series.answers.slice(1).map((v, i) => Math.max(0, v - series.answers[i]));
  const minuteBack = series.answers.length > 6 ? series.answers[series.answers.length - 7] : series.answers[0];
  const lately = series.answers.length ? Math.max(0, answers - minuteBack) : null;

  // ---- the brief, from the numbers ----------------------------------------
  const most = Math.max(0, ...counts);
  const atMost = LEVELS.filter((_, i) => counts[i] === most && most > 0);
  // Only a reason when there is something to explain: a level with enough
  // answers to say anything, under the room's goal, and not the only one.
  const bar = goal ?? 0.8;
  const judged = LEVELS.map((l, i) => ({ l, i, ...byLevel[l] })).filter((x) => x.seen >= 5);
  const weakest = judged.length > 1
    ? judged.sort((a, b) => a.correct / a.seen - b.correct / b.seen).find((x) => x.correct / x.seen < bar)
    : undefined;
  const support = rows.filter((r) => r.slowLearner)
    .sort((a, b) => ((a.total || ZERO).correct / ((a.total || ZERO).seen || 1)) - ((b.total || ZERO).correct / ((b.total || ZERO).seen || 1)));
  const first = support[0];
  const watching = rows.filter((r) => sigOf(r).level === 'watch').length;

  const lead = closed ? (
    <>The room is closed. {rows.length} {plural(rows.length, 'student')} answered {answers} {plural(answers, 'question')}, and {pct(seen, correct)} of {plural(seen, 'answer')} were right.</>
  ) : atMost.length === 0 ? (
    <>{rows.length} joined, and nobody has been placed at a level yet.</>
  ) : atMost.length === 1 ? (
    <>
      {most * 2 > rows.length ? 'Most of the class is' : 'The largest group is'} working at <em>{LABEL[atMost[0]]}</em>: {most} of {rows.length}.
      {(feed.up > 0 || feed.down > 0) && <> Since this page opened, {[feed.up && `${feed.up} moved up`, feed.down && `${feed.down} moved down`].filter(Boolean).join(' and ')}.</>}
    </>
  ) : (
    <>
      The class is split between {atMost.map((l, i) => <span key={l}>{i > 0 && (i === atMost.length - 1 ? ' and ' : ', ')}<em>{LABEL[l]}</em></span>)}, {most} each.
      {(feed.up > 0 || feed.down > 0) && <> Since this page opened, {[feed.up && `${feed.up} moved up`, feed.down && `${feed.down} moved down`].filter(Boolean).join(' and ')}.</>}
    </>
  );

  const status = closed ? { tone: 'closed', text: 'Room closed' }
    : paused && !stale ? { tone: 'paused', text: 'Paused' }
      : stopped ? { tone: 'bad', text: 'Not connected' }
        : stale ? { tone: 'bad', text: `Reconnecting, ${forHuman(downFor)}`, spin: true }
          : live ? { tone: 'live', text: 'Live' }
            : { tone: 'wait', text: 'Connecting', spin: true };

  const eventText = (e) => {
    if (e.kind === 'status') return e.status === 'paused' ? 'The room was paused' : e.status === 'closed' ? 'The room was closed' : 'The room was resumed';
    if (e.kind === 'join') return 'joined';
    return `moved ${e.kind} to ${LABEL[e.level] ?? e.level}`;
  };

  const selTries = sel ? feed.tries[sel.rollNo] ?? [] : [];

  // #1: how long the room has been open, from the room list's own times.
  // `startedAt` is set when the room is created, so a waiting room's lobby
  // time is in it, and the label says "since the room was opened".
  const timeOf = (iso) => { const t = iso ? Date.parse(iso) : NaN; return Number.isFinite(t) ? t : null; };
  const opened = timeOf(info?.startedAt);
  const closedAt = timeOf(info?.closedAt);
  // #3: the class's median working level, over students with a graded answer.
  const median = medianLevel(rows);
  // L3: per level, how many have mastered it at the room's goal, by the rows' own marks.
  const masteredAt = (pool) => LEVELS.map((l) => pool.filter((r) => Array.isArray(r.mastered) && r.mastered.includes(l)).length);

  // ---- Phase 3: the parts of the room beside the class ---------------------
  const spaces = [
    !led && { id: 'class', label: 'Class' },
    { id: 'insights', label: 'Insights' },
    // Phase 5: one question put to every phone. Only where phones answer.
    !led && { id: 'ask', label: 'Class question', count: classQuestion && classQuestion.state !== 'closed' ? 'running' : undefined },
    classRoom && { id: 'attendance', label: 'Attendance' },
    { id: 'room', label: 'In the room' },
    { id: 'projector', label: 'Projector' },
  ].filter(Boolean);
  // A space the address names but this room has not (Attendance in a room
  // with no class, Class in a Teacher-led one) falls back to the default.
  const current = spaces.some((s) => s.id === space) ? space : (led ? 'room' : 'class');
  function spinWheel() { setAddress({ space: 'room', tab: 'wheel' }); }
  // An insight card's own action: ask a question at its level (on the wall),
  // sort the list its way, or go to the wheel.
  function onAct(action = {}) {
    if (action.do === 'wheel') spinWheel();
    else if (action.do === 'sort') { if (action.sort) setInsightSort(action.sort); setSpace('insights'); }
    else if (action.do === 'ask') { setAskLevel(action.level ?? null); setSpace('projector'); }
  }

  return (
    <>
      <div className="page-head lc-head">
        <div className="ttl">
          <div className="crumb lc-state" data-tone={status.tone} role="status">
            {status.spin ? <span className="spinner" style={{ width: 10, height: 10 }} /> : <i className={status.tone === 'live' ? 'live-dot' : 'lc-dot'} />}
            <span>{status.text}</span>
            <span aria-hidden="true">·</span>
            <span>room <SplitCode code={code} /></span>
            {opened && (
              <>
                <span aria-hidden="true">·</span>
                <span className="lc-elapsed" title="Counted from when the room was opened, any time in the waiting room included.">
                  {closed
                    ? (closedAt ? `${lasted(closedAt - opened)} from opening to close` : null)
                    : `${lasted(now - opened)} since the room was opened`}
                </span>
              </>
            )}
          </div>
          <h1>{title || 'Live room'}</h1>
          <p className="sub">
            {closed ? 'Where everyone finished, level by level. It stays readable for as long as the room exists.' : 'Who is working at which level, who just moved, and who needs you next.'}
          </p>
        </div>
        <div className="acts">
          {!closed && !waitingRoom && (
            <Button icon={paused ? 'play' : 'pause'} busy={toggling} onClick={togglePause}>
              {paused ? 'Resume' : 'Pause'}
            </Button>
          )}
          <Button variant="primary" icon="draw" disabled={closed} onClick={spinWheel}>Spin the wheel</Button>
          {/* The join code, full window. A Teacher-led room takes no phones. */}
          {!led && <Button icon="projector" disabled={closed} onClick={onProjector}>Show the code</Button>}
          <Menu
            trigger={<Button icon="more" aria-label="More actions" />}
            items={[
              { id: 'csv', label: exporting ? 'Exporting' : 'Export results as CSV', icon: 'download', disabled: empty || exporting, onSelect: exportCsv },
              ready && { id: 'post', label: 'Post results to Google Classroom', icon: 'upload', disabled: empty || posting, onSelect: loadCourses },
              needsAuth && { id: 'google', label: 'Connect Google Classroom', icon: 'google', disabled: linking, onSelect: connectClassroom },
              !closed && 'sep',
              !closed && { id: 'close', label: 'Close the room', icon: 'stop', danger: true, onSelect: () => setConfirmEnd(true) },
            ]}
          />
        </div>
      </div>

      {/* Phase 7: a room run in laptop mode and imported is never shown as one this server ran. */}
      <ImportedNote from={info?.importedFrom} code={code} />

      {(stopped && !closed) || (stale && !stopped) || rejoined || (wireError && !everLive && !stopped) || error || classroomError || posted ? (
        <div className="stack stack-2">
          {stopped && !closed && (
            <Note tone="bad" role="alert">
              <b>The live connection has stopped and is not retrying.</b> Retries never give up on their own, so this is the
              server refusing this console or hanging up on it, not the wifi.{wireError ? ` It said: ${wireError}.` : ''} The
              class is unaffected: students are still answering and every answer is saved as it is given. What is below is
              frozen{downSince ? ` at ${CLOCK.format(downSince)}` : ''}.
              <div style={{ marginTop: 8 }}><Button size="sm" onClick={retry}>Try again</Button></div>
            </Note>
          )}
          {stale && !stopped && (
            <Note tone="bad" role="alert">
              <b>The live connection dropped {forHuman(downFor)} ago.</b> Nothing below is updating: it is the roster as it
              stood at {CLOCK.format(downSince)}. The class has not stopped, and every answer is saved the moment it is given.
              It is reconnecting on its own.
            </Note>
          )}
          {rejoined && <Note tone="ok" role="status">Reconnected. The roster was read again just now, including everything answered while this page was out.</Note>}
          {wireError && !everLive && !stopped && (
            <Note tone="bad">The live connection could not open: {wireError}. The roster below was read once and will not move until it does.</Note>
          )}
          {error && <Note tone="bad">{error}</Note>}
          {classroomError && <Note tone="bad">{classroomError}</Note>}
          {posted && (
            <Note tone="ok">
              Posted to Classroom{posted.courseWorkId ? ` (${posted.courseWorkId})` : ''}: {posted.posted} rows
              {posted.skipped?.length ? `, ${posted.skipped.length} skipped (${posted.skipped.map(skippedLabel).join(', ')})` : ''}.
            </Note>
          )}
        </div>
      ) : null}

      {waitingRoom && (
        <Lobby
          code={code}
          waiting={room.waiting}
          rows={rows}
          canControl={canControl}
          mode={mode}
          onStarted={() => setRoomStatus('open')}
        />
      )}

      {known && (
        <div className="lc-spaces">
          <Segmented label="Part of the room" value={current} onChange={setSpace} options={spaces} />
          {room.attendance && <span className="t-meta">{room.attendance.summary}</span>}
        </div>
      )}

      {current === 'class' && (connecting || !known ? (
        <div className="lc-wait" aria-busy="true" aria-label="Opening the live roster">
          <div className="skel lc-wait-brief" />
          <div className="lc-cols">
            <div className="skel lc-wait-grid" />
            <div className="stack stack-3"><div className="skel lc-wait-side" /><div className="skel lc-wait-insp" /></div>
          </div>
        </div>
      ) : empty ? (
        <Panel className="lc-empty" style={fade}>
          <div className="lc-empty-main">
            <span className="tag-mint">{closed ? 'Room closed' : stale ? 'Connection down' : 'Waiting for the class'}</span>
            <h2 className="lc-lead">
              {closed ? 'The room closed before anyone joined.' : stale ? 'Nobody can appear here while the connection is down.' : 'Waiting for the first student.'}
            </h2>
            <p className="lc-empty-sub">
              {closed
                ? 'Nobody answered in this room, so there is nothing to export.'
                : stale
                  ? `Students joining ${code} are still being let in and their answers are still being saved. This page cannot see them yet.`
                  : `Share the room code. Students appear here the moment they join, one marble each.`}
            </p>
            {!closed && (
              <div className="cluster">
                <Button variant="accent" icon="projector" onClick={onProjector}>Put the code on the projector</Button>
              </div>
            )}
          </div>
          {!closed && (
            <div className="lc-empty-code" aria-label={`Room code ${code.split('').join(' ')}`}>
              <span>Room code</span>
              <b><SplitCode code={code} /></b>
            </div>
          )}
        </Panel>
      ) : (
        <>
          <Panel className="lc-brief" aria-label="The class right now" style={fade}>
            <div className="lc-brief-main">
              <div className="cluster">
                <span className="tag-mint">{closed ? 'Final standing' : 'Class right now'}</span>
                <span className="lc-brief-meta">
                  {rows.length} joined{closed ? '' : stale ? ', presence not known' : `, ${online} answering now`}
                </span>
              </div>
              <p className="lc-lead">{lead}</p>
              <div className="brief">
                {closed ? (goal ? (
                  <>
                    <b>What</b>
                    <span>{met} of {rows.length} met the {Math.round(goal * 100)}% goal at one level or more.</span>
                  </>
                ) : null) : (
                  <>
                    <b>What</b>
                    <span>{pct(seen, correct)} of {seen} {plural(seen, 'answer')} right so far{goal ? `; ${met} of ${rows.length} have met the ${Math.round(goal * 100)}% goal at a level` : ''}.</span>
                  </>
                )}
                {weakest && (
                  <>
                    <b>Why</b>
                    <span>
                      Accuracy is lowest at {LABEL[weakest.l]}: {pct(weakest.seen, weakest.correct)} of {weakest.seen} answers,
                      {counts[weakest.i] ? ` with ${counts[weakest.i]} working there now.` : ' though nobody is working there now.'}
                    </span>
                  </>
                )}
                {!closed && (
                  <>
                    <b>Now</b>
                    <span>
                      {first
                        ? <>{inBand} {plural(inBand, 'student is', 'students are')} in the support band. Start with <span className="mono">{first.rollNo}</span>{first.name ? ` (${first.name})` : ''}: {pct((first.total || ZERO).seen, (first.total || ZERO).correct)} over {(first.total || ZERO).seen} answers.</>
                        : watching
                          ? <>Nobody is in the support band. {watching} {plural(watching, 'student has', 'students have')} something recorded worth a look.</>
                          : <>Nobody is in the support band. A good moment to draw a student to explain an answer aloud.</>}
                    </span>
                  </>
                )}
              </div>
              {!closed && (
                <div className="cluster lc-brief-acts">
                  {first ? (
                    <>
                      <Button variant="accent" icon="forward" onClick={() => setPickedRoll(first.rollNo)}>Open {first.rollNo}</Button>
                      <Button onClick={() => setFilter('band')}>Show the support band</Button>
                    </>
                  ) : (
                    <>
                      <Button variant="accent" icon="draw" onClick={spinWheel}>Spin the wheel</Button>
                      {watching > 0 && <Button onClick={() => setFilter('signals')}>Show who has signals</Button>}
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="lc-tiles">
              <div className="ptile">
                <span>Joined</span>
                <b><Num value={rows.length} /></b>
                <Spark values={series.online} label={series.online.length > 1 ? 'Students answering, sampled every ten seconds since this page opened' : undefined} />
                {!closed && series.online.length < 2 && <i className="lc-spark-wait" aria-hidden="true" />}
                <small>{stale ? '—' : online} <i>answering now</i></small>
              </div>
              <div className="ptile" style={{ '--d': '0.6s' }}>
                <span>Answers</span>
                <b><Num value={answers} /></b>
                <Spark values={perStep} label={perStep.length > 1 ? 'Answers per ten seconds since this page opened' : undefined} />
                {!closed && perStep.length < 2 && <i className="lc-spark-wait" aria-hidden="true" />}
                {closed
                  ? <small>{rows.length ? (answers / rows.length).toFixed(1) : '—'} <i>per student</i></small>
                  : <small>{lately === null ? '—' : `+${lately}`} <i>{series.answers.length > 6 ? 'last minute' : 'since this page opened'}</i></small>}
              </div>
              <div className="ptile" style={{ '--d': '1.2s' }}>
                <span>Class accuracy</span>
                <b><Num value={pct(seen, correct)} /></b>
                <Spark values={series.acc} label={series.acc.length > 1 ? 'Class accuracy, sampled every ten seconds since this page opened' : undefined} />
                {!closed && series.acc.length < 2 && <i className="lc-spark-wait" aria-hidden="true" />}
                <small>{correct} <i>right of {seen}</i></small>
              </div>
              <div className="ptile" style={{ '--d': '1.8s' }}>
                <span>{goal ? `At the ${Math.round(goal * 100)}% goal` : 'At the goal'}</span>
                <b><Num value={met} /></b>
                <Spark values={series.met} label={series.met.length > 1 ? 'Students at the goal, sampled every ten seconds since this page opened' : undefined} />
                {!closed && series.met.length < 2 && <i className="lc-spark-wait" aria-hidden="true" />}
                <small>of {rows.length} <i>at a level or more</i></small>
              </div>
            </div>

            <div className="lc-ticker">
              <span className="lc-ticker-tag">Latest</span>
              {feed.events.length ? (
                <ol className="lc-ticker-list" aria-label="What changed most recently, newest first">
                  {feed.events.map((e) => (
                    <li key={e.id}>
                      {e.kind === 'status' ? <i className="lc-tdot" data-status={e.status} /> : <i className="lc-tdot" data-level={e.level} />}
                      {e.rollNo && <b className="mono">{e.rollNo}</b>}
                      <span>{eventText(e)}</span>
                      <time>{ago(e.at, now)}</time>
                    </li>
                  ))}
                </ol>
              ) : (
                <span className="lc-ticker-none">{closed ? 'The room is closed. Nothing here will change again.' : 'Arrivals and level changes appear here as they happen.'}</span>
              )}
            </div>
          </Panel>

          {room.feed && <FeedSplit feed={room.feed} />}

          <div className="lc-cols">
            <section className="card lc-grid" style={fade} aria-labelledby="lc-grid-h" data-view={lens === 'students' ? heatView : undefined}>
              <div className="lc-grid-head">
                <div className="sec">
                  <h2 id="lc-grid-h">{lens === 'questions' ? 'How each question did' : lens === 'topics' ? 'Topics × Bloom level' : 'Students × Bloom level'}</h2>
                  {lens === 'questions' ? (
                    <p>
                      {items.data && itemList.length
                        ? `${itemList.length} ${plural(itemList.length, 'question')}, ${items.data.counted?.students ?? 0} ${plural(items.data.counted?.students ?? 0, 'student')}${closed ? ', final' : ''}. `
                        : ''}
                      Flagged first; open one to see what the class chose.
                    </p>
                  ) : lens === 'topics' ? (
                    <p>
                      {topics.data && list(topics.data.topics).length
                        ? `${list(topics.data.topics).length} ${plural(list(topics.data.topics).length, 'topic')} across ${topics.data.students} ${plural(topics.data.students, 'student')}${closed ? ', final' : ''}. `
                        : ''}
                      Accuracy at each level, from final, marked answers.
                    </p>
                  ) : (
                    <p>
                      {shown.length === rows.length ? `${rows.length} joined` : `${shown.length} of ${rows.length}`}
                      {closed ? ', final standing' : stale ? ', frozen' : ''}. Accuracy at each level; the ring is the level served now.
                    </p>
                  )}
                </div>
                <Segmented
                  label="Read the class by"
                  value={lens}
                  onChange={setLens}
                  options={[
                    { id: 'students', label: 'Students', count: rows.length },
                    { id: 'topics', label: 'Topics', count: topics.data ? list(topics.data.topics).length : undefined },
                    { id: 'questions', label: 'Questions', count: items.data ? itemList.length : undefined },
                  ]}
                />
              </div>

              {lens === 'questions' ? (
                <RoomQuestions items={items} onRetry={loadItems} closed={closed} onCheckKey={setKeyFor} />
              ) : lens === 'topics' ? (
                <TopicGrid topics={topics} onRetry={loadTopics} closed={closed} />
              ) : (
                <>
                  <div className="lc-filters">
                    <Segmented label="Narrow the roster" value={filter} onChange={setFilter} options={FILTERS.map((f) => ({ id: f.id, label: f.label, count: rows.filter(f.match).length }))} />
                    <label className="search lc-find">
                      <Icon name="search" />
                      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a student" aria-label="Find a student" />
                    </label>
                    <Segmented
                      label="Draw accuracy as"
                      value={heatView}
                      onChange={(v) => { setHeatView(v); keepView(v); }}
                      options={[{ id: 'cells', label: 'Cells' }, { id: 'dots', label: 'Dots' }]}
                    />
                  </div>

                  {shown.length === 0 ? (
                    <div className="lc-none">
                      <Icon name="search" />
                      <div><b>No student matches.</b> Clear the search, or switch back to Everyone.</div>
                    </div>
                  ) : (
                    <div className="lc-heat-scroll" role="region" aria-label="Students by level" tabIndex={0}>
                      <table className="lc-heat">
                        <thead>
                          <tr>
                            <th className="lc-who" scope="col">Student</th>
                            {LEVELS.map((l, i) => (
                              <th key={l} className="lc-lv" scope="col" data-level={l} title={LABEL[l]}>
                                <span><i className="swatch" />{SHORT[i]}</span>
                              </th>
                            ))}
                            <th className="lc-acc" scope="col">Acc.</th>
                            <th className="lc-trendc" scope="col" title="Each student's accuracy over the answers given since this page opened">Since opened</th>
                            <th className="lc-sigc" scope="col"><span className="sr-only">Signals</span></th>
                          </tr>
                        </thead>
                        {groups.map((g) => {
                          const gp = pooled(g.rows);
                          const gs = LEVELS.reduce((n, l) => n + gp[l].seen, 0);
                          const gc = LEVELS.reduce((n, l) => n + gp[l].correct, 0);
                          return (
                            <tbody key={g.id}>
                              <tr className="lc-band">
                                <th colSpan={10} scope="rowgroup">
                                  <span className="lc-band-in">
                                    {g.level ? <Level level={g.level} /> : <span className="t-meta">Not placed yet</span>}
                                    <span className="lc-band-n">{g.rows.length} {plural(g.rows.length, 'student')}</span>
                                    <span className="lc-band-acc">{pct(gs, gc)} <i>of {gs}</i></span>
                                  </span>
                                </th>
                              </tr>
                              {g.rows.map((r) => {
                                const total = r.total || ZERO;
                                const sig = sigOf(r);
                                const basis = basisOf(r);
                                const sigTitle = sig.notes.length
                                  ? `${sig.notes.join(' ')} Open ${r.rollNo} for the full trail.`
                                  : `${sig.events} recorded. Open ${r.rollNo} for the full trail.`;
                                return (
                                  <tr
                                    key={r.rollNo}
                                    className="lc-row"
                                    tabIndex={0}
                                    aria-selected={sel?.rollNo === r.rollNo}
                                    title={r.reason || undefined}
                                    onClick={() => setPickedRoll(r.rollNo)}
                                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPickedRoll(r.rollNo); } }}
                                  >
                                    <td className="lc-who">
                                      <span className="lc-person" data-off={r.online ? undefined : 'true'}>
                                        <span className="lc-av">
                                          <Avatar name={r.name || r.rollNo} title={r.online ? 'connected' : 'not connected'} />
                                          <i aria-hidden="true" />
                                          <span className="sr-only">{r.online ? 'connected' : 'not connected'}</span>
                                        </span>
                                        <span className="lc-names">
                                          <b className="clip">{r.name || r.rollNo}</b>
                                          <span className="lc-sub">
                                            {r.name && <span className="mono">{r.rollNo}</span>}
                                            {basis?.sentence && (
                                              <span className="lc-basis" data-prov={basis.provisional ? 'true' : undefined} title={basis.sentence}>
                                                {needsProvWord(basis) && <i className="lc-prov">provisional</i>}
                                                {basis.sentence}
                                              </span>
                                            )}
                                          </span>
                                        </span>
                                      </span>
                                    </td>
                                    {LEVELS.map((l) => {
                                      const c = (r.levels || {})[l] || ZERO;
                                      const cur = r.workingLevel === l;
                                      const m = masteryAt(r, l);
                                      const said = [
                                        c.seen ? `${LABEL[l]}: ${c.correct} of ${c.seen} right (${pct(c.seen, c.correct)}).` : `${LABEL[l]}: not answered yet.`,
                                        cur && basis?.sentence ? `Level served now${basis.provisional ? ', provisional' : ''}. ${basis.sentence}` : '',
                                        m?.sentence ?? '',
                                      ].filter(Boolean).join(' ');
                                      return (
                                        <td key={l} className="lc-lv">
                                          <span
                                            className="lc-cell"
                                            data-heat={heat(c.seen, c.correct)}
                                            data-cur={cur ? 'true' : undefined}
                                            data-prov={cur && basis?.provisional ? 'true' : undefined}
                                            data-mastered={m?.mastered ? 'true' : undefined}
                                            title={said}
                                          >
                                            {c.seen ? <span className="lc-cell-n">{`${c.correct}/${c.seen}`}</span> : ''}
                                            {m?.mastered && <span className="sr-only">, mastered</span>}
                                          </span>
                                        </td>
                                      );
                                    })}
                                    <td className="lc-acc">
                                      <span className="mono">{pct(total.seen, total.correct)}</span>
                                      {r.slowLearner && <span className="lc-support">support</span>}
                                    </td>
                                    <td className="lc-trendc">
                                      {(() => {
                                        // #5: in neutral ink, never green or red; from this page's own view only.
                                        const tries = feed.tries[r.rollNo] ?? [];
                                        const n = tries.reduce((s, t) => s + t.n, 0);
                                        const k = tries.reduce((s, t) => s + t.k, 0);
                                        return tries.length > 1
                                          ? <span className="lc-trend"><Spark values={trendOf(tries)} height={18} label={`${k} of ${n} right since this page opened`} /></span>
                                          : <span className="lc-trend-none" title={n ? `${k} of ${n} right since this page opened` : 'No answer since this page opened'}>{n ? `${k}/${n}` : ''}</span>;
                                      })()}
                                    </td>
                                    <td className="lc-sigc">
                                      {sig.off ? (
                                        <span className="lc-sig-off" title="No signals are shown for this student.">
                                          <span aria-hidden="true">off</span>
                                          <span className="sr-only">No signals shown</span>
                                        </span>
                                      ) : sig.level !== 'clear' && <span className="lc-sig" data-level={sig.level} title={sigTitle}>{sig.notes.length || null}</span>}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          );
                        })}
                        {/* L3: how many of those shown have mastered each level at the room's goal, by the rows' own marks. */}
                        <tfoot>
                          <tr className="lc-mfoot">
                            <th scope="row" className="lc-who">
                              <span className="lc-mfoot-k">{goal ? `Mastered at the ${Math.round(goal * 100)}% goal` : 'Mastered at the goal'}</span>
                              <span className="lc-mfoot-of">of {shown.length} {plural(shown.length, 'student')}{shown.length === rows.length ? '' : ' shown'}</span>
                            </th>
                            {masteredAt(shown).map((n, i) => (
                              <td key={LEVELS[i]} className="lc-lv" title={`${n} of ${shown.length} ${plural(shown.length, 'student')} ${n === 1 ? 'has' : 'have'} mastered ${LABEL[LEVELS[i]]}${goal ? ` at the ${Math.round(goal * 100)}% goal` : ''}.`}>
                                <b className="mono" data-zero={n ? undefined : 'true'}>{n}</b>
                                <span className="sr-only"> of {shown.length} mastered {LABEL[LEVELS[i]]}</span>
                              </td>
                            ))}
                            <td colSpan={3} />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}

                  <div className="lc-legend">
                    <span className="lc-legend-k">Accuracy</span>
                    {HEAT_KEY.map(([h, label]) => (
                      <span key={h}><i className="lc-cell lc-key" data-heat={h} />{label}</span>
                    ))}
                    <span><i className="lc-cell lc-key" data-cur="true" data-heat={0} />level served now</span>
                    {rows.some((r) => basisOf(r)?.provisional) && (
                      <span><i className="lc-cell lc-key" data-cur="true" data-prov="true" data-heat={0} />provisional: too few answers behind it</span>
                    )}
                    {rows.some((r) => masteryOf(r).some((m) => m.mastered)) && (
                      <span><i className="lc-cell lc-key" data-mastered="true" data-heat={0} />mastered at the room’s goal</span>
                    )}
                    {rows.some((r) => sigOf(r).level !== 'clear') && (
                      <span className="lc-legend-sig">
                        <i className="lc-sig" data-level="note" /> reported by the browser
                        <i className="lc-sig" data-level="watch" /> worked out by the server
                      </span>
                    )}
                    <span className="lc-legend-note">
                      {heatView === 'dots' ? 'A bigger, darker dot is a higher accuracy. ' : ''}
                      Since opened: each student’s running accuracy over the answers given since this page opened; a reload starts it again.
                    </span>
                  </div>
                </>
              )}
            </section>

            <div className="lc-side">
              <section className="card lc-tubes" style={fade} aria-labelledby="lc-tubes-h">
                <div className="sec">
                  <h2 id="lc-tubes-h">Where the class is</h2>
                  <p>One marble is one student. It changes tube when they change level.</p>
                </div>
                {median && (
                  <p className="lc-median">
                    <span>Median working level</span>
                    <Level level={median.level} />
                    <span className="lc-median-of">of {median.of} {plural(median.of, 'student')} with an answer</span>
                  </p>
                )}
                <Marbles rows={rows} selected={sel?.rollNo} onSelect={setPickedRoll} frozen={stale || closed} height={196} />
              </section>

              {sel && (
                <aside className="card lc-insp" style={fade} aria-label={`${sel.rollNo} in detail`}>
                  <div className="lc-insp-who">
                    <Avatar name={sel.name || sel.rollNo} size="lg" />
                    <div className="grow">
                      <h2 className="clip">{sel.name || sel.rollNo}</h2>
                      <div className="lc-insp-sub">
                        {sel.name && <span className="mono">{sel.rollNo}</span>}
                        <span className="lc-presence" data-off={sel.online ? undefined : 'true'}><i />{sel.online ? 'connected' : 'not connected'}</span>
                        {sel.slowLearner && <span className="lc-support">support band</span>}
                      </div>
                    </div>
                  </div>

                  <div className="lc-insp-now" data-prov={basisOf(sel)?.provisional ? 'true' : undefined}>
                    <span className="t-meta">Working at</span>
                    <span className="lc-insp-lv">
                      {basisOf(sel)?.provisional && <span className="lc-prov">provisional</span>}
                      <Level level={sel.workingLevel} size="lg" className={basisOf(sel)?.provisional ? 'lc-lv-prov' : ''} />
                    </span>
                  </div>
                  {basisOf(sel)?.sentence && <p className="lc-insp-basis">{basisOf(sel).sentence}</p>}
                  {sel.reason && <p className="said">{sel.reason}</p>}
                  {masteryOf(sel).some((m) => m.mastered) && (
                    <ul className="lc-mastered" aria-label="Levels mastered, and what each rests on">
                      {masteryOf(sel).filter((m) => m.mastered).map((m) => (
                        <li key={m.level}>
                          <Level level={m.level}><Icon name="check" size={12} />{LABEL[m.level] ?? m.level}</Level>
                          <span>{m.sentence}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="figs ruled lc-insp-figs">
                    <Fig value={pct(selTotal.seen, selTotal.correct)} label="accuracy" />
                    <Fig value={typeof sel.answered === 'number' ? sel.answered : selTotal.seen} label="answered" />
                    {Array.isArray(sel.mastered) && <Fig value={sel.mastered.length} label={goal ? `${plural(sel.mastered.length, 'level')} at ${Math.round(goal * 100)}%` : plural(sel.mastered.length, 'level') + ' met'} />}
                  </div>

                  <div className="lc-insp-sec">
                    <div className="lc-insp-h">
                      <h3>Against the class</h3>
                      <span className="lc-radar-key">
                        <span><i className="lc-k-me" />{sel.rollNo}</span>
                        <span><i className="lc-k-class" />class</span>
                        {goal ? <span><i className="lc-k-goal" />{Math.round(goal * 100)}% goal</span> : null}
                      </span>
                    </div>
                    <Radar mine={sel.levels} theirs={byLevel} goal={goal ?? 0} current={sel.workingLevel} who={sel.rollNo} />
                  </div>

                  <div className="lc-insp-sec">
                    <div className="lc-insp-h">
                      <h3>Answers since this page opened</h3>
                      <span className="t-meta">{selTries.length ? `${selTries.reduce((n, t) => n + t.k, 0)} of ${selTries.reduce((n, t) => n + t.n, 0)} right` : ''}</span>
                    </div>
                    {selTries.length ? (
                      <ol className="lc-tries" aria-label="Oldest first">
                        {selTries.map((t, i) => (
                          <li
                            key={`${t.at}-${i}`}
                            data-v={t.n > 1 ? 'mix' : t.k ? 'yes' : 'no'}
                            data-level={t.level}
                            title={`${t.n > 1 ? `${t.k} of ${t.n} right, order not known` : t.k ? 'Right' : 'Wrong'} at ${LABEL[t.level] ?? t.level}, ${CLOCK.format(t.at)}`}
                          >
                            {t.n > 1 ? <span className="mono">{t.k}/{t.n}</span> : <Icon name={t.k ? 'check' : 'close'} size={12} />}
                            <span className="sr-only">{t.n > 1 ? `${t.k} of ${t.n} right` : t.k ? 'right' : 'wrong'}</span>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="hint">Nothing yet. Each answer {sel.rollNo} gives from now on lands here as a tick or a cross.</p>
                    )}
                  </div>

                  <RoomAnswers
                    key={sel.rollNo}
                    code={code}
                    roll={sel.rollNo}
                    signature={`${typeof sel.answered === 'number' ? sel.answered : ''}:${selTotal.seen}:${selTotal.correct}`}
                  />

                  <div className="lc-insp-sec">
                    <div className="lc-insp-h">
                      <h3>Signals</h3>
                      <span className="t-meta">
                        {selSig.off ? 'not shown' : selSig.events === 0 ? 'nothing recorded' : `${selSig.reported} reported, ${selSig.observed} observed`}
                      </span>
                    </div>
                    {selSig.off ? (
                      <p className="hint">No signals are shown for this student. The trail says why.</p>
                    ) : selSig.events === 0 ? (
                      <p className="hint">This student's browser has reported nothing, and nothing has been worked out from their answers.</p>
                    ) : selSig.notes.length ? (
                      <ul className="stack stack-2">{selSig.notes.map((note) => <li key={note} className="said">{note}</li>)}</ul>
                    ) : (
                      <p className="hint">Nothing recorded has crossed the threshold for a note. The trail lists every one of the {selSig.events} events.</p>
                    )}
                    {(selSig.events > 0 || selSig.off) && (
                      <div><Button size="sm" icon="checklist" busy={trailBusy} onClick={() => loadTrail(sel.rollNo)}>{shownTrail ? 'Load the trail again' : 'Load the full trail'}</Button></div>
                    )}
                    {trailError && <Note tone="bad">{trailError}</Note>}
                    {trailBusy && !shownTrail && <div className="stack stack-1">{[0, 1, 2].map((i) => <div key={i} className="skel" style={{ height: 36 }} />)}</div>}
                    {shownTrail && (
                      <>
                        {/* The server's own caveat travels with the events. */}
                        {shownTrail.signalsOff ? (
                          <Note>{shownTrail.message}</Note>
                        ) : shownTrail.honesty && <Note>{shownTrail.honesty}</Note>}
                        {shownTrail.signalsOff ? null : !shownTrail.events?.length ? (
                          <p className="hint">Nothing is on record for {shownTrail.rollNo}.</p>
                        ) : (
                          <ul className="lc-trail">
                            {shownTrail.events.map((e, i) => (
                              <li key={`${e.at}-${e.kind}-${i}`}>
                                <span className="mono">{stamp(e.at)}</span>
                                <span className="lc-trail-src" data-observed={isObserved(e) ? 'true' : undefined}>{isObserved(e) ? 'observed' : 'reported'}</span>
                                <span className="lc-trail-what">{eventLine(e)}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </>
                    )}
                  </div>
                </aside>
              )}
            </div>
          </div>
        </>
      ))}

      {current === 'insights' && (
        <Insights
          code={code}
          insights={insights}
          canControl={canControl}
          info={info}
          sort={insightSort}
          onSort={setInsightSort}
          onAct={onAct}
          onOpenStudent={setCardRoll}
        />
      )}
      {/* Phase 5: which wrong options students chose, by the misunderstanding
          labelled on them. Counts only. Only where phones answer. */}
      {current === 'insights' && !led && <RoomMisconceptions code={code} />}
      {current === 'ask' && !led && (
        <div className="stack stack-4">
          <ClassQuestions
            code={code}
            canControl={canControl}
            info={info}
            pushed={classQuestion}
            onPushed={setClassQuestion}
            onOpenProjector={() => setSpace('projector')}
          />
          <RoomConfidence code={code} />
        </div>
      )}
      {current === 'attendance' && classRoom && (
        <Attendance code={code} canControl={canControl} mode={mode} summary={room.attendance} />
      )}
      {current === 'room' && (
        <Records code={code} canControl={canControl} info={info} rows={rows} tab={recordsTab} onTab={setRecordsTab} onProject={() => setSpace('projector')} />
      )}
      {current === 'projector' && (
        <ProjectorControl code={code} canControl={canControl} info={info} askLevel={askLevel} />
      )}

      {cardRoll && <StudentCard code={code} roll={cardRoll} onClose={() => setCardRoll('')} />}

      <Dialog
        open={Boolean(courses)}
        onOpenChange={(v) => { if (!v) setCourses(null); }}
        locked={posting}
        title="Post results to Google Classroom"
        description="The roster and each student's score by level are posted to one course."
        footer={(
          <>
            <Button variant="ghost" onClick={() => setCourses(null)} disabled={posting}>Cancel</Button>
            <Button variant="primary" busy={posting} disabled={!courseId} onClick={post}>Post results</Button>
          </>
        )}
      >
        {courses?.length === 0 ? (
          <p className="muted">The connected Google account has no courses.</p>
        ) : (
          <Field label="Course" htmlFor="course">
            <select id="course" className="select" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
              {(courses ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        )}
      </Dialog>

      <Dialog
        open={Boolean(keyItem)}
        onOpenChange={(v) => { if (!v) setKeyFor(null); }}
        title="Check the key"
        description="The key is changed in the question bank, not in the live room."
        footer={onOpenQuestion && keyItem?.status !== 'deleted' ? (
          <>
            <Button variant="ghost" onClick={() => setKeyFor(null)}>Not now</Button>
            <Button variant="primary" icon="edit" onClick={() => { const id = keyItem.questionId; setKeyFor(null); onOpenQuestion(id); }}>Open it in the editor</Button>
          </>
        ) : <Button variant="primary" onClick={() => setKeyFor(null)}>Done</Button>}
      >
        {keyItem && (
          <div className="stack stack-3 lc-keyhelp">
            <p className="lc-keyhelp-q">{keyItem.text}</p>
            {list(keyItem.flags).map((f) => <p key={f.id} className="said">{f.message}</p>)}
            <ol className="lc-keyhelp-steps">
              <li>Open <b>Questions</b>, under Prepare in the menu.</li>
              <li>Find this question{keyItem.topic ? <> under <b>{keyItem.topic}</b></> : ''} and fold out its answer key.</li>
              <li>Check the key against the material first, then the wording. Press <b>Edit</b> to change either.</li>
            </ol>
            <p className="hint">Answers given after an edit count towards a new version of the question, and this report says when that has happened.</p>
          </div>
        )}
      </Dialog>

      <Dialog
        open={confirmEnd}
        onOpenChange={setConfirmEnd}
        locked={ending}
        title={`Close room ${code}?`}
        description="Every student is taken to their finish screen and nothing more can be answered. A closed room cannot be reopened; its results stay readable."
        footer={(
          <>
            <Button variant="ghost" onClick={() => setConfirmEnd(false)} disabled={ending}>Keep it open</Button>
            <Button variant="primary" className="btn-danger" busy={ending} onClick={end}>Close the room</Button>
          </>
        )}
      />
    </>
  );
}
