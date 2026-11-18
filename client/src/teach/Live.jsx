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
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import Marbles from '../fx/Marbles.jsx';
import { api } from '../lib/api.js';
import { LABEL, LEVELS, pct } from '../lib/bloom.js';
import { Avatar, Button, Dialog, Field, Fig, Icon, Level, Menu, Note, Num, Panel, Segmented, Spark } from '../ui/index.jsx';
import Draw from './Draw.jsx';
import useRoomFeed from './useRoomFeed.js';

const ZERO = { seen: 0, correct: 0 };
const SHORT = ['Rem', 'Und', 'App', 'Ana', 'Eva', 'Cre'];
const levelAt = (l) => LEVELS.indexOf(l);

// What a row carries when the server sent no summary: 'clear', so the absence
// of data never renders as a signal.
const NO_SIG = { events: 0, away: 0, awayMs: 0, reported: 0, observed: 0, notes: [], level: 'clear' };
const sigOf = (row) => row?.integrity ?? NO_SIG;

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

export default function Live({ code, title, closed, onClosed, onProjector }) {
  const { rows, wire, wireError, error, setError, downFor, retry, roomStatus, setRoomStatus } = useRoomFeed(code);
  const paused = roomStatus === 'paused';
  const [toggling, setToggling] = useState(false);
  const [exporting, setExporting] = useState(false);
  const { live, everLive, downSince, rejoined, stopped } = wire;

  const [pickedRoll, setPickedRoll] = useState('');
  const [drawing, setDrawing] = useState(false);
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

  return (
    <>
      <div className="page-head lc-head">
        <div className="ttl">
          <div className="crumb lc-state" data-tone={status.tone} role="status">
            {status.spin ? <span className="spinner" style={{ width: 10, height: 10 }} /> : <i className={status.tone === 'live' ? 'live-dot' : 'lc-dot'} />}
            <span>{status.text}</span>
            <span aria-hidden="true">·</span>
            <span>room <span className="mono">{code}</span></span>
          </div>
          <h1>{title || 'Live room'}</h1>
          <p className="sub">
            {closed ? 'Where everyone finished, level by level. It stays readable for as long as the room exists.' : 'Who is working at which level, who just moved, and who needs you next.'}
          </p>
        </div>
        <div className="acts">
          {!closed && (
            <Button icon={paused ? 'play' : 'pause'} busy={toggling} onClick={togglePause}>
              {paused ? 'Resume' : 'Pause'}
            </Button>
          )}
          <Button variant="primary" icon="draw" disabled={empty || closed} onClick={() => setDrawing(true)}>Draw a student</Button>
          <Button icon="projector" disabled={closed} onClick={onProjector}>Projector</Button>
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

      {connecting ? (
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
              <b className="mono">{code}</b>
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
                      <Button variant="accent" icon="draw" onClick={() => setDrawing(true)}>Draw a student</Button>
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

          <div className="lc-cols">
            <section className="card lc-grid" style={fade} aria-labelledby="lc-grid-h">
              <div className="lc-grid-head">
                <div className="sec">
                  <h2 id="lc-grid-h">Students × Bloom level</h2>
                  <p>
                    {shown.length === rows.length ? `${rows.length} joined` : `${shown.length} of ${rows.length}`}
                    {closed ? ', final standing' : stale ? ', frozen' : ''}. Accuracy at each level; the ring is the level served now.
                  </p>
                </div>
                <label className="search lc-find">
                  <Icon name="search" />
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a student" aria-label="Find a student" />
                </label>
              </div>
              <div className="lc-filters">
                <Segmented label="Narrow the roster" value={filter} onChange={setFilter} options={FILTERS.map((f) => ({ id: f.id, label: f.label, count: rows.filter(f.match).length }))} />
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
                            <th colSpan={9} scope="rowgroup">
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
                                      {r.name && <span className="mono">{r.rollNo}</span>}
                                    </span>
                                  </span>
                                </td>
                                {LEVELS.map((l) => {
                                  const c = (r.levels || {})[l] || ZERO;
                                  return (
                                    <td key={l} className="lc-lv">
                                      <span
                                        className="lc-cell"
                                        data-heat={heat(c.seen, c.correct)}
                                        data-cur={r.workingLevel === l ? 'true' : undefined}
                                        title={c.seen ? `${LABEL[l]}: ${c.correct} of ${c.seen} right (${pct(c.seen, c.correct)})` : `${LABEL[l]}: not answered yet`}
                                      >
                                        {c.seen ? `${c.correct}/${c.seen}` : ''}
                                      </span>
                                    </td>
                                  );
                                })}
                                <td className="lc-acc">
                                  <span className="mono">{pct(total.seen, total.correct)}</span>
                                  {r.slowLearner && <span className="lc-support">support</span>}
                                </td>
                                <td className="lc-sigc">
                                  {sig.level !== 'clear' && <span className="lc-sig" data-level={sig.level} title={sigTitle}>{sig.notes.length || null}</span>}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      );
                    })}
                  </table>
                </div>
              )}

              <div className="lc-legend">
                <span className="lc-legend-k">Accuracy</span>
                {HEAT_KEY.map(([h, label]) => (
                  <span key={h}><i className="lc-cell lc-key" data-heat={h} />{label}</span>
                ))}
                <span><i className="lc-cell lc-key" data-cur="true" data-heat={0} />level served now</span>
                {rows.some((r) => sigOf(r).level !== 'clear') && (
                  <span className="lc-legend-sig">
                    <i className="lc-sig" data-level="note" /> reported by the browser
                    <i className="lc-sig" data-level="watch" /> worked out by the server
                  </span>
                )}
              </div>
            </section>

            <div className="lc-side">
              <section className="card lc-tubes" style={fade} aria-labelledby="lc-tubes-h">
                <div className="sec">
                  <h2 id="lc-tubes-h">Where the class is</h2>
                  <p>One marble is one student. It changes tube when they change level.</p>
                </div>
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

                  <div className="lc-insp-now">
                    <span className="t-meta">Working at</span>
                    <Level level={sel.workingLevel} size="lg" />
                  </div>
                  {sel.reason && <p className="said">{sel.reason}</p>}

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

                  <div className="lc-insp-sec">
                    <div className="lc-insp-h">
                      <h3>Signals</h3>
                      <span className="t-meta">
                        {selSig.events === 0 ? 'nothing recorded' : `${selSig.reported} reported, ${selSig.observed} observed`}
                      </span>
                    </div>
                    {selSig.events === 0 ? (
                      <p className="hint">This student's browser has reported nothing, and nothing has been worked out from their answers.</p>
                    ) : selSig.notes.length ? (
                      <ul className="stack stack-2">{selSig.notes.map((note) => <li key={note} className="said">{note}</li>)}</ul>
                    ) : (
                      <p className="hint">Nothing recorded has crossed the threshold for a note. The trail lists every one of the {selSig.events} events.</p>
                    )}
                    {selSig.events > 0 && (
                      <div><Button size="sm" icon="checklist" busy={trailBusy} onClick={() => loadTrail(sel.rollNo)}>{shownTrail ? 'Load the trail again' : 'Load the full trail'}</Button></div>
                    )}
                    {trailError && <Note tone="bad">{trailError}</Note>}
                    {trailBusy && !shownTrail && <div className="stack stack-1">{[0, 1, 2].map((i) => <div key={i} className="skel" style={{ height: 36 }} />)}</div>}
                    {shownTrail && (
                      <>
                        {/* The server's own caveat travels with the events. */}
                        <Note>{shownTrail.honesty}</Note>
                        {shownTrail.events.length === 0 ? (
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
      )}

      <Draw open={drawing} onOpenChange={setDrawing} rows={rows} onOpen={setPickedRoll} />

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
