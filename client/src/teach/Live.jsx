/**
 * Step four: the class, live.
 *
 * The bench is the page: six tubes of marbles, one marble per student, and a
 * marble changes tube when its student changes level. Under it is the roster
 * as a table, and beside both is whoever is selected - their level, the
 * server's own sentence for why, accuracy by level, and what was recorded
 * about the session.
 *
 * Everything under the counters is fed by a socket, so the moment the socket
 * is gone none of it is current. The page says so in a banner and fades the
 * data, because a quiet class and a dead page otherwise look identical.
 */

import { useEffect, useMemo, useState } from 'react';

import Marbles from '../fx/Marbles.jsx';
import { api } from '../lib/api.js';
import { LABEL, LEVELS, pct } from '../lib/bloom.js';
import { Button, Chip, Dialog, Empty, Fig, Field, Icon, Level, Menu, Note, Segmented } from '../ui/index.jsx';
import { LevelBars } from '../ui/viz.jsx';
import Draw from './Draw.jsx';
import useRoomFeed from './useRoomFeed.js';

const ZERO = { seen: 0, correct: 0 };
const SHORT = ['Rem', 'Und', 'App', 'Ana', 'Eva', 'Cre'];

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

const tone = (seen, correct) => {
  if (!seen) return 'none';
  const a = correct / seen;
  return a >= 0.7 ? 'hi' : a >= 0.4 ? 'mid' : 'lo';
};

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

  const ready = Boolean(classroom?.configured && classroom?.connected);
  const needsAuth = Boolean(classroom?.configured && !classroom?.connected);
  const empty = rows.length === 0;
  const connecting = empty && !everLive && !closed && !wireError && !error;
  const stale = Boolean(downSince) && !closed;
  const fade = stale ? { opacity: 0.5 } : undefined;

  const state = closed ? <Chip>Room closed</Chip>
    : paused && !stale ? <Chip icon="pause">Paused</Chip>
    : stopped ? <Chip tone="bad">Not connected</Chip>
      : stale ? <Chip tone="bad"><span className="spinner" style={{ width: 10, height: 10 }} />Reconnecting, {forHuman(downFor)}</Chip>
        : live ? <Chip tone="ok" dot>Live</Chip>
          : <Chip><span className="spinner" style={{ width: 10, height: 10 }} />Connecting</Chip>;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{title || 'Live room'}</div>
          <h1 className="cluster cluster-3">Class <span className="mono muted">{code}</span> {state}</h1>
        </div>
        <div className="acts">
          <Button variant="primary" icon="draw" disabled={empty || closed} onClick={() => setDrawing(true)}>Draw a student</Button>
          {!closed && (
            <Button icon={paused ? 'play' : 'pause'} busy={toggling} onClick={togglePause}>
              {paused ? 'Resume' : 'Pause'}
            </Button>
          )}
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

      <div className="stack stack-2" style={{ marginBottom: 16 }}>
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

      {empty && !connecting ? (
        <Empty
          icon={stale ? 'alert' : 'live'}
          title={closed ? 'The room closed before anyone joined' : stale ? 'Nobody can appear here while the connection is down' : 'Waiting for the first student'}
          action={closed ? undefined : <Button variant="primary" icon="projector" onClick={onProjector}>Put the code on the projector</Button>}
        >
          {closed
            ? 'Nobody answered in this room, so there is nothing to export.'
            : stale
              ? `Students joining ${code} are still being let in and their answers are still being saved. This page cannot see them yet.`
              : `Share the room code ${code}. Students appear here the moment they join.`}
        </Empty>
      ) : (
        <>
          <div className="figs ruled" style={{ marginBottom: 24, ...fade }}>
            <Fig value={rows.length} label="joined" />
            {/* Presence is the socket's own knowledge: with the socket down it
                is not stale, it is unknown, and a confident number would mislead. */}
            <Fig value={stale ? '—' : online} label={stale ? 'answering now: not known' : 'answering now'} />
            <Fig value={pct(seen, correct)} label="accuracy, all answers" />
            <Fig value={inBand} label="in the support band" />
            <Fig value={answers} label="questions served" />
          </div>

          <div className="split wide">
            <div className="stack">
              <section className="card card-pad" style={fade}>
                <div className="cluster between baseline" style={{ marginBottom: 12 }}>
                  <h3>Where the class is working</h3>
                  <span className="t-meta">One marble is one student. It changes tube when they change level.</span>
                </div>
                <Marbles rows={rows} selected={sel?.rollNo} onSelect={setPickedRoll} frozen={stale || closed} height={232} />
              </section>

              <section className="card" style={fade}>
                <div className="card-head roster-head">
                  <h3>Roster</h3>
                  <span className="t-meta">
                    {shown.length === rows.length ? `${rows.length} joined` : `${shown.length} of ${rows.length}`}
                    {closed ? ', final standing' : stale ? ', frozen' : ''}
                  </span>
                  <label className="search push" style={{ width: 220, maxWidth: '100%' }}>
                    <Icon name="search" />
                    <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a roll number" aria-label="Find a student" />
                  </label>
                </div>
                <div className="roster-filters">
                  <Segmented label="Narrow the roster" value={filter} onChange={setFilter} options={FILTERS.map((f) => ({ id: f.id, label: f.label, count: rows.filter(f.match).length }))} />
                </div>

                {connecting ? (
                  <div className="stack stack-2" style={{ padding: 16 }}>{[0, 1, 2, 3, 4].map((i) => <div key={i} className="skel" style={{ height: 40 }} />)}</div>
                ) : shown.length === 0 ? (
                  <Empty icon="search" title="No student matches">Clear the search, or switch back to Everyone.</Empty>
                ) : (
                  <div className="tbl-wrap">
                    <table className="tbl roster">
                      <thead>
                        <tr>
                          <th>Student</th>
                          {SHORT.map((s, i) => <th key={s} className="lvcol" title={LABEL[LEVELS[i]]}>{s}</th>)}
                          <th>Working at</th>
                          <th className="r">Accuracy</th>
                          <th>Signals</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((r) => {
                          const total = r.total || ZERO;
                          const sig = sigOf(r);
                          const sigTitle = sig.notes.length
                            ? `${sig.notes.join(' ')} Open ${r.rollNo} for the full trail.`
                            : `${sig.events} recorded. Open ${r.rollNo} for the full trail.`;
                          return (
                            <tr
                              key={r.rollNo}
                              className="is-click"
                              tabIndex={0}
                              aria-selected={sel?.rollNo === r.rollNo}
                              title={r.reason || undefined}
                              onClick={() => setPickedRoll(r.rollNo)}
                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPickedRoll(r.rollNo); } }}
                            >
                              <td>
                                <span className="who" data-off={r.online ? undefined : 'true'}>
                                  <i className="who-dot" aria-label={r.online ? 'connected' : 'not connected'} />
                                  <span className="mono strong">{r.rollNo}</span>
                                  {r.name && <span className="muted clip">{r.name}</span>}
                                </span>
                              </td>
                              {LEVELS.map((l) => {
                                const c = (r.levels || {})[l] || ZERO;
                                return (
                                  <td key={l} className="lvcol">
                                    <span className="cell" data-tone={tone(c.seen, c.correct)} data-cur={r.workingLevel === l ? 'true' : undefined}>
                                      {c.seen ? `${c.correct}/${c.seen}` : '·'}
                                    </span>
                                  </td>
                                );
                              })}
                              <td><Level level={r.workingLevel} /></td>
                              <td className="r mono">{pct(total.seen, total.correct)}{r.slowLearner && <span className="band-tag">support</span>}</td>
                              <td>
                                {sig.level !== 'clear' && <span className="sig" data-level={sig.level} title={sigTitle}>{sig.notes.length || null}</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {rows.some((r) => sigOf(r).level !== 'clear') && (
                  <p className="hint" style={{ padding: '12px 20px' }}>
                    Under Signals, a hollow ring is something the student's browser reported, a solid dot is something the
                    server worked out itself, and the number is how many notes there are to read.
                  </p>
                )}
              </section>
            </div>

            {sel && (
              <aside className="card sticky" style={fade}>
                <div className="card-body stack">
                  <div className="stack stack-2">
                    <div className="cluster">
                      <h2 className="mono">{sel.rollNo}</h2>
                      {!sel.online && <Chip>not connected</Chip>}
                      {sel.slowLearner && <Chip className="chip-line">support band</Chip>}
                    </div>
                    {sel.name && <span className="dim">{sel.name}</span>}
                  </div>
                  <div><Level level={sel.workingLevel} size="lg" /></div>
                  {sel.reason && <p className="said">{sel.reason}</p>}
                  <div className="figs">
                    <Fig value={pct(selTotal.seen, selTotal.correct)} label="accuracy" />
                    <Fig value={typeof sel.answered === 'number' ? sel.answered : selTotal.seen} label="answered" />
                  </div>
                  <LevelBars byLevel={sel.levels} current={sel.workingLevel} short />
                </div>

                <div className="card-body stack stack-3" style={{ borderTop: '1px solid var(--line)' }}>
                  <div className="cluster between baseline">
                    <h4>Signals</h4>
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
                        <ul className="trail">
                          {shownTrail.events.map((e, i) => (
                            <li key={`${e.at}-${e.kind}-${i}`}>
                              <span className="mono t-meta">{stamp(e.at)}</span>
                              <span className="trail-src" data-observed={isObserved(e) ? 'true' : undefined}>{isObserved(e) ? 'observed' : 'reported'}</span>
                              <span className="trail-what">{eventLine(e)}</span>
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
