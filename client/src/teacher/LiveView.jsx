import { useEffect, useMemo, useRef, useState } from 'react';

import { api, socketCredentials } from '../api.js';
import { connect, EV, stillTrying } from '../socket.js';
import { LEVELS, LABEL, cellClass, tagClass, pct } from '../bloom.js';
import Icon from '../ui/Icon.jsx';
import { Card, Empty, PageHead, Stat, TailBars } from '../ui/Shell.jsx';

const ZERO = { seen: 0, correct: 0 };
const SHORT = ['REM', 'UND', 'APP', 'ANA', 'EVA', 'CRE'];

/**
 * What a row carries when the server sent no summary at all — a payload from
 * before this field existed, or a profile written by an older build. 'clear'
 * rather than nothing, so the absence of data never renders as a signal.
 */
const NO_SIG = { events: 0, away: 0, awayMs: 0, reported: 0, observed: 0, notes: [], level: 'clear' };

const sigOf = (row) => row?.integrity ?? NO_SIG;

// Each filter carries its own predicate so the count printed on the pill and the
// rows the pill reveals cannot drift apart.
const FILTERS = [
  { id: 'all', label: 'Everyone', match: () => true },
  { id: 'online', label: 'Answering now', match: (r) => r.online },
  { id: 'band', label: 'Support band', match: (r) => r.slowLearner },
  { id: 'above', label: 'Above Understand', match: (r) => LEVELS.indexOf(r.workingLevel) > 1 },
  // Not "flagged", not "suspicious". The pill narrows the roster to the students
  // something was recorded about; what it was recorded about is on the panel.
  { id: 'signals', label: 'With signals', match: (r) => sigOf(r).level !== 'clear' },
];

/**
 * Which of the two classes an event belongs to.
 *
 * The server stamps every event it records, so this only has to read the stamp —
 * and anything arriving without one is treated as the weaker class rather than
 * guessed at from its name. The error that costs a student is trusting a signal
 * too much, so an unknown one is always the cheap-to-fake kind.
 */
const isObserved = (e) => e?.src === 'observed';

const secs = (ms) => `${(Math.max(0, Number(ms) || 0) / 1000).toFixed(1)}s`;

/**
 * One event as a sentence.
 *
 * Descriptive, never evaluative: it says what the browser reported or what the
 * server worked out, and stops there. An unrecognised kind prints its own name
 * rather than being given a meaning this screen invented for it.
 */
function eventLine(e) {
  switch (e?.kind) {
    case 'hidden':
      return `The tab was hidden${Number(e.awayMs) ? ` for ${secs(e.awayMs)}` : ''}.`;
    case 'returned': return 'The tab came back.';
    case 'blurred': return 'The window lost focus.';
    case 'fullscreen-exit': return 'Focus mode was left.';
    case 'paste': return 'Text was pasted into an answer.';
    case 'reload': return 'The page was reloaded.';
    case 'too-fast':
      // Both numbers, because the second one is what makes the first mean
      // anything: "0.6s" is only fast against the time the question takes to read.
      return `An answer arrived in ${secs(e.tookMs)}, against about ${secs(e.expectedMs)} to read the question.`;
    case 'second-socket':
      return 'The same roll number was answering from a second live connection.';
    default: return String(e?.kind ?? 'unknown');
  }
}

// The classroom route reports skipped students; the shape is only promised to be
// an array, so render whatever identifiable field is on it rather than [object].
const skippedLabel = (e) =>
  e === null || typeof e !== 'object' ? String(e) : String(e.rollNo || e.name || e.reason || 'unknown');

const CLOCK = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** An event's ISO stamp on the wall clock. An unparseable one prints as nothing
 *  rather than as "Invalid Date" beside a student's name. */
const stamp = (iso) => {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? '—' : CLOCK.format(at);
};

/** How long the wire has been down, in the units a person waiting would use. */
const forHuman = (secs) => (secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`);

/**
 * A spinner sized for a flag. `.spin` is built for a button, and at its own size
 * it swamps a 26px pill and pushes the label off centre.
 */
const Tick = () => <span className="spin" style={{ width: 9, height: 9, borderWidth: 1.5 }} />;

/**
 * T7 (live) and T8 (waiting). The page the whole product is for.
 *
 * The dark panel is the working surface: the selected student on the gradient
 * card, the roster directly under it. Everything above the panel is a counter,
 * and a counter is never allowed to out-shout the grid.
 */
export default function LiveView({ code, title, closed, onClosed, onProjector }) {
  const [rows, setRows] = useState([]);
  /**
   * The state of the wire, as one object so its four parts can never disagree.
   *
   * Three different silences look identical on a roster that has stopped moving:
   * the socket has not opened yet, the socket is open and the class is thinking,
   * and the socket is gone. `live` alone only separated the first from the other
   * two — a teacher watching a still grid could not tell a quiet class from a
   * dead page, and the two need opposite reactions.
   *
   *   live      the socket is connected right now
   *   everLive  it has been connected at least once, so a failure now is a DROP
   *             rather than a connection that never came up
   *   downSince when it went, stamped once so the outage timer does not restart
   *             on every retry
   *   rejoined  it just came back, and that is worth saying out loud once
   *   stopped   socket.io is no longer trying. Attempts are infinite, so this is
   *             never the wifi: it is the server having refused this socket or
   *             hung up on it, and it is the only state on this page that is a
   *             real error rather than a wait.
   */
  const [wire, setWire] = useState({
    live: false, everLive: false, downSince: null, rejoined: false, stopped: false,
  });
  const { live, everLive, downSince, rejoined, stopped } = wire;
  // Kept apart from `error`: that one carries a failed export or a refused close
  // and must always be shown, while a transport failure is only worth a red line
  // before the wire has ever opened. After that the reconnect banner says it
  // better, and socket.io retries on a backoff that starts at 600ms — a line
  // repeating the same transport wording twice a second is noise on an outage.
  const [wireError, setWireError] = useState('');
  // Held so the one state that will not fix itself has something to press.
  const socketRef = useRef(null);
  const [downFor, setDownFor] = useState(0);
  const [error, setError] = useState('');
  const [pickedRoll, setPickedRoll] = useState('');
  // View-only: the filter and the search never touch the payload, so the
  // counters above the roster always describe the whole class.
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
  /**
   * The full signal trail, fetched on request rather than pushed with the grid.
   *
   * It carries the roll number it was fetched for, and the panel refuses to
   * render it under any other name. A teacher can click a second student while
   * the first one's request is still in the air, and one student's events shown
   * under another student's name is the single worst thing this screen could do.
   */
  const [trail, setTrail] = useState(null);
  const [trailBusy, setTrailBusy] = useState(false);
  const [trailError, setTrailError] = useState('');

  useEffect(() => {
    if (!code) return undefined;
    const socket = connect();
    socketRef.current = socket;

    // Re-emitting on every 'connect' matters: after a reconnect the server has
    // forgotten this socket was in the teacher room - it is in no room, it is
    // watching nothing, and it will be sent nothing.
    // Credentials travel with the message: a socket has no headers, and the
    // server now refuses to hand the grid to anyone who only knows the code.
    const onConnect = async () => {
      // `rejoined` is only true if something was actually lost: the first
      // connect of a page is not a reconnection and must not be dressed as one.
      setWire((w) => ({
        live: true, everLive: true, downSince: null, rejoined: w.downSince !== null, stopped: false,
      }));
      setWireError('');
      const creds = await socketCredentials();
      // The await is a round trip to the auth session, and the wifi that just
      // came back can go again inside it. Emitting into a socket that has since
      // dropped does not fail - socket.io buffers the packet and flushes it on
      // the next connection, ahead of that connection's own watch - so let the
      // next 'connect' do the asking with credentials read at the time.
      if (socket.connected) socket.emit(EV.teacherWatch, { code, ...creds });
    };

    const drop = () =>
      setWire((w) => ({
        ...w,
        live: false,
        rejoined: false,
        // `active` stays true through every retry and goes false only when the
        // client has genuinely given up. It is the difference between a banner
        // that says "wait" and one that says "this needs you".
        stopped: !stillTrying(socket),
        // Stamped once, on the first sign of trouble. socket.io fires
        // connect_error on every retry, so re-stamping would reset the clock
        // twice a second and make a ten-minute outage read as ten seconds. Null
        // while the wire has never opened, because that is not a drop.
        downSince: w.everLive ? w.downSince ?? Date.now() : null,
      }));

    const onErr = (err) => { drop(); setWireError(err.message); };
    const onGrid = (p) => {
      if (!p || (p.code && p.code !== code)) return;
      setRows(Array.isArray(p.rows) ? p.rows : []);
    };
    // The server refuses `teacher:watch` from anyone it cannot identify. Before
    // this the refusal went nowhere: the socket was up, the flag said Live, and
    // the roster sat empty for the rest of the class with nothing on the page
    // that could explain why.
    const onRefused = (p) => setError(p?.reason || 'The server would not hand over this grid.');

    socket.on('connect', onConnect);
    socket.on('disconnect', drop);
    socket.on('connect_error', onErr);
    socket.on(EV.grid, onGrid);
    socket.on(EV.rejected, onRefused);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', drop);
      socket.off('connect_error', onErr);
      socket.off(EV.grid, onGrid);
      socket.off(EV.rejected, onRefused);
      socket.close();
    };
  }, [code]);

  /**
   * The outage clock. A number that moves is the whole difference between "it is
   * still trying" and "this page is dead" — and it is the only thing on a frozen
   * grid that is allowed to move, because nothing else on it is true any more.
   */
  useEffect(() => {
    if (!downSince) { setDownFor(0); return undefined; }
    const tick = () => setDownFor(Math.max(0, Math.round((Date.now() - downSince) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [downSince]);

  /**
   * The recovery announces itself and then gets out of the way. A green bar that
   * never leaves stops being read as news and becomes chrome, and by then the
   * state it reports is long over.
   */
  useEffect(() => {
    if (!rejoined) return undefined;
    const timer = setTimeout(() => setWire((w) => ({ ...w, rejoined: false })), 6000);
    return () => clearTimeout(timer);
  }, [rejoined]);

  // One REST read so the table is populated before the first broadcast arrives;
  // a broadcast that lands first always wins.
  useEffect(() => {
    if (!code) return undefined;
    let alive = true;
    api.getGrid(code).then(
      (res) => alive && Array.isArray(res.rows) && setRows((prev) => (prev.length ? prev : res.rows)),
      (err) => alive && setError(`Could not load the grid: ${err.message}`),
    );
    return () => { alive = false; };
  }, [code]);

  useEffect(() => {
    let alive = true;
    api.classroomStatus().then((res) => alive && setClassroom(res), (err) => alive && setClassroomError(err.message));
    return () => { alive = false; };
  }, []);

  /**
   * Ask the server for the consent URL, then send the browser to Google.
   *
   * The tab is opened synchronously inside the click, before the await: opening
   * it after the request resolves is a popup, and every browser blocks it.
   */
  async function connectClassroom() {
    setClassroomError('');
    setLinking(true);
    const tab = window.open('', '_blank', 'noopener');
    try {
      const { url } = await api.classroomAuthUrl();
      if (tab) tab.location.href = url;
      else window.location.href = url; // popups blocked entirely; go here instead
    } catch (err) {
      if (tab) tab.close();
      setClassroomError(`Could not start the Google sign-in: ${err.message}`);
    } finally {
      setLinking(false);
    }
  }

  async function loadCourses() {
    setClassroomError('');
    setPosting(true);
    try {
      const res = await api.classroomCourses();
      const list = res.courses ?? [];
      setCourses(list);
      if (list.length) setCourseId(list[0].id);
    } catch (err) { setClassroomError(`Could not list Classroom courses: ${err.message}`); }
    finally { setPosting(false); }
  }

  async function post() {
    setClassroomError('');
    setPosted(null);
    setPosting(true);
    try { setPosted(await api.classroomPost(code, courseId)); }
    catch (err) { setClassroomError(`Posting to Classroom failed: ${err.message}`); }
    finally { setPosting(false); }
  }

  async function end() {
    setError('');
    setEnding(true);
    try { await api.closeSession(code); onClosed(); }
    catch (err) { setError(`Could not end the session: ${err.message}`); }
    finally { setEnding(false); setConfirmEnd(false); }
  }

  /**
   * The events themselves, with the caveat the server sends alongside them.
   *
   * Asked for, never fetched on selection: the grid summary is enough to decide
   * whether to look, and pulling every student's raw event list as a teacher
   * arrows down the roster would be reading forty students' trails to read one.
   */
  async function loadTrail(rollNo) {
    setTrailError('');
    setTrailBusy(true);
    try { setTrail(await api.integrity(code, rollNo)); }
    catch (err) { setTrailError(`Could not load the trail for ${rollNo}: ${err.message}`); }
    finally { setTrailBusy(false); }
  }

  const answers = rows.reduce((n, r) => n + (typeof r.answered === 'number' ? r.answered : (r.total || ZERO).seen), 0);
  const online = rows.filter((r) => r.online).length;
  const inBand = rows.filter((r) => r.slowLearner).length;

  // Pooled, not the mean of per-student accuracies: a student who has answered
  // twice must not weigh the same as one who has answered twenty times.
  const seen = rows.reduce((n, r) => n + (r.total || ZERO).seen, 0);
  const correct = rows.reduce((n, r) => n + (r.total || ZERO).correct, 0);

  // Where the class actually is, as a shape rather than a sentence.
  const atLevel = LEVELS.map((l) => rows.filter((r) => r.workingLevel === l).length);
  const peak = atLevel.indexOf(Math.max(...atLevel));

  // Default to a student in the below-40% band: that is the one the demo is
  // about, and the teacher should not have to hunt for them.
  const sel = useMemo(() => {
    if (!rows.length) return null;
    return rows.find((r) => r.rollNo === pickedRoll) ?? rows.find((r) => r.slowLearner) ?? rows[0];
  }, [rows, pickedRoll]);

  const selSig = sigOf(sel);

  // A trail belongs to exactly one student. Checked at render rather than only
  // on arrival, so a response that lands after the teacher has moved on can
  // never paint itself onto whoever is selected by then.
  const shownTrail = trail && sel && trail.rollNo === sel.rollNo ? trail : null;

  // The request that is still in the air is only this student's while this
  // student is still the selected one.
  useEffect(() => { setTrailError(''); setTrailBusy(false); }, [sel?.rollNo]);

  // Narrowing the list is display only — `sel` still comes off the full roster,
  // so filtering never silently drops the student the teacher is reading.
  const shown = useMemo(() => {
    const match = (FILTERS.find((f) => f.id === filter) ?? FILTERS[0]).match;
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) => match(r) && (!q || `${r.rollNo} ${r.name || ''}`.toLowerCase().includes(q)),
    );
  }, [rows, filter, query]);

  const ready = Boolean(classroom?.configured && classroom?.connected);
  const needsAuth = Boolean(classroom?.configured && !classroom?.connected);
  let why = 'Post the roster and per-level scores to a Classroom course.';
  if (classroomError) why = classroomError;
  else if (!classroom) why = 'Checking whether Google Classroom is configured…';
  else if (!classroom.configured) why = classroom.reason || 'Google Classroom is not configured on this server.';
  else if (!classroom.connected) why = classroom.reason || 'Configured, but no Google account is connected yet.';

  const empty = rows.length === 0;
  // Nothing has arrived and the socket has not opened yet, so there is nothing
  // truthful to say: shimmer rows shaped like the roster, not the word Loading.
  const connecting = empty && !everLive && !closed && !wireError && !error;

  /**
   * The grid, gone stale. Everything below the counters is fed by the socket, so
   * the moment the socket is gone none of it is current — and a class that has
   * gone quiet and a page that has stopped receiving looked exactly the same.
   * Half-faded under a red banner, they cannot be confused: the numbers are
   * still readable, which they must be, but nothing about them reads as now.
   *
   * Not applied to a closed room. There the grid is deliberately final, and
   * fading it would be saying something is wrong with a room that ended cleanly.
   * Deliberately not faded through a transition either: this is not decoration,
   * it is the page saying it has stopped hearing anything, and it has to be true
   * the instant it is true.
   */
  const stale = Boolean(downSince) && !closed;
  const staleStyle = stale ? { opacity: 0.5 } : undefined;

  const selTotal = (sel?.total) || ZERO;

  return (
    <>
      <PageHead
        title="Classroom"
        sub={<><span className="mono">{code}</span>{title ? ` · ${title}` : ''}</>}
        /* Four states, four chips. The old pair said "Live" or "Reconnecting" in
           two shades of the same quiet pill, which on a projector at the back of
           a hall is one chip — the exact confusion this page cannot afford. */
        aside={
          closed ? (
            <span className="flag neutral">Room closed</span>
          ) : stopped ? (
            /* No spinner on this one. Nothing is spinning: the client has
               stopped, and a moving mark here would be the page pretending to
               work on a problem it has put down. */
            <span className="flag bad">Not connected</span>
          ) : stale ? (
            <span className="flag bad">
              <Tick />
              Reconnecting · {forHuman(downFor)}
            </span>
          ) : live ? (
            <span className="flag ok">
              <i
                style={{
                  width: 6, height: 6, display: 'block', borderRadius: 'var(--r-pill)',
                  background: 'currentColor', animation: 'bl-pulse 1.2s ease-in-out infinite',
                }}
              />
              Live
            </span>
          ) : (
            <span className="flag">
              <Tick />
              Connecting
            </span>
          )
        }
        actions={
          <div className="row" style={{ gap: 8 }}>
            <a
              className="btn sm"
              href={api.exportUrl(code)}
              download
              aria-disabled={empty}
              style={empty ? { pointerEvents: 'none', color: 'var(--ink-6)' } : undefined}
            >
              <Icon name="download" size={13} />
              Export CSV
            </a>
            <button type="button" className="btn sm" onClick={loadCourses} disabled={!ready || posting} title={why}>
              {posting && !courses ? <span className="spin" /> : <Icon name="upload" size={13} />}
              Post to Classroom
            </button>
            {needsAuth && (
              <button type="button" className="btn sm" onClick={connectClassroom} disabled={linking}>
                {linking ? <span className="spin" /> : <Icon name="google" size={13} />}
                Connect Google
              </button>
            )}
            {confirmEnd ? (
              <>
                <button type="button" className="btn sm danger" onClick={end} disabled={ending}>
                  {ending && <span className="spin" />}
                  Confirm close
                </button>
                <button type="button" className="btn sm ghost" onClick={() => setConfirmEnd(false)}>Keep open</button>
              </>
            ) : (
              <button type="button" className="btn sm dark" onClick={() => setConfirmEnd(true)} disabled={closed}>
                {closed ? 'Room closed' : 'Close room'}
              </button>
            )}
          </div>
        }
      />

      {/* A banner and not only the chip, for both of the states below. A teacher
          stands at the front of the room reading this grid from several feet
          back, and a 26px pill in the corner is not where they are going to
          notice that the page has stopped listening.

          This first one is the connection state nothing will fix on its own, so
          it is the one that gets a button. Reaching it means the server refused
          this socket or hung up on it — the retries are infinite, so the wifi
          can never land here. */}
      {stopped && !closed && (
        <div className="note bad" role="alert" style={{ marginBottom: 12 }}>
          <Icon name="alert" size={15} />
          <span>
            <b>The live connection has stopped, and it is not retrying.</b> The retries are
            infinite, so this is the server refusing this console or hanging up on it, never the
            wifi.{wireError ? ` It said: ${wireError}.` : ''} The class is unaffected — students are
            still answering, and every answer is saved on the server as it is given — but the
            roster below is frozen{downSince ? ` at ${CLOCK.format(downSince)}` : ''} until this is
            back.
          </span>
          <button
            type="button"
            className="btn sm right"
            onClick={() => {
              // Cleared before the attempt, not after it: trying again is
              // trying, and a banner insisting the connection is not retrying
              // over the whole handshake is the same lie in the other
              // direction. A second failure sets it straight back.
              setWire((w) => ({ ...w, stopped: false }));
              socketRef.current?.connect();
            }}
          >
            Try again
          </button>
        </div>
      )}
      {stale && !stopped && (
        <div className="note bad" role="alert" style={{ marginBottom: 12 }}>
          <span className="spin" style={{ marginTop: 2 }} />
          <span>
            <b>The live connection dropped {forHuman(downFor)} ago.</b> Nothing below is updating —
            it is the roster as it stood at {CLOCK.format(downSince)}. The class has not stopped:
            students are still answering, and every answer is saved on the server the moment it is
            given, so nothing is being lost while this page is blind. It is reconnecting on its own
            and the grid fills itself back in the moment it does.
          </span>
        </div>
      )}
      {rejoined && (
        <div className="note ok" role="status" style={{ marginBottom: 12 }}>
          <Icon name="checkCircle" size={15} />
          <span>
            Back on the wire. The roster below was read again from the server just now, so it is
            the whole class as it stands — including everything answered while the page was out.
          </span>
        </div>
      )}
      {/* Only before the wire has ever opened, and only while it is still trying:
          once it has opened, the drop banner is the honest account of the same
          failure, and once it has stopped the banner above carries the message
          itself. Either way this would double it. */}
      {wireError && !everLive && !stopped && (
        <div className="note bad" style={{ marginBottom: 12 }}>
          <Icon name="alert" size={15} />
          <span>
            The live grid could not open its connection: {wireError}. The roster below was read once
            over HTTP and will not move until the connection comes up.
          </span>
        </div>
      )}
      {error && (
        <div className="note bad" style={{ marginBottom: 12 }}>
          <Icon name="alert" size={15} />
          <span>{error}</span>
        </div>
      )}
      {classroomError && (
        <div className="note bad" style={{ marginBottom: 12 }}>
          <Icon name="alert" size={15} />
          <span>{classroomError}</span>
        </div>
      )}
      {posted && (
        <div className="note ok" style={{ marginBottom: 12 }}>
          <Icon name="checkCircle" size={15} />
          <span>
            Posted to Classroom{posted.courseWorkId ? ` (${posted.courseWorkId})` : ''}: {posted.posted} rows
            {posted.skipped?.length ? `, ${posted.skipped.length} skipped (${posted.skipped.map(skippedLabel).join(', ')})` : ''}.
          </span>
        </div>
      )}

      {courses && (
        <Card className="outline" style={{ marginBottom: 14 }}>
          <div className="row" style={{ gap: 10 }}>
            {courses.length === 0 ? (
              <span className="muted">The connected Google account has no courses.</span>
            ) : (
              <>
                <label className="lab" htmlFor="course" style={{ margin: 0 }}>Course</label>
                <select
                  id="course"
                  value={courseId}
                  onChange={(e) => setCourseId(e.target.value)}
                  style={{ flex: '1 1 200px', maxWidth: 320 }}
                >
                  {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <button type="button" className="btn pri sm" onClick={post} disabled={posting || !courseId}>
                  {posting && <span className="spin" />}
                  Post results
                </button>
              </>
            )}
            <button type="button" className="btn ghost sm right" onClick={() => setCourses(null)}>Cancel</button>
          </div>
        </Card>
      )}

      <div
        style={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'stretch', gap: 12, marginBottom: 14,
          ...staleStyle,
        }}
      >
        <div className={`gstats${empty ? ' idle' : ''}`} style={{ flex: '3 1 460px' }}>
          <div className="gstat">
            <div className="v">{rows.length}</div>
            <div className="k">joined</div>
          </div>
          <div className="gstat">
            {/* The one number on this page that is not merely stale but unknowable
                while the socket is down: presence is the socket's own map, and a
                confident "12 answering now" from a page that cannot hear anyone
                is the single most misleading thing the grid could say. */}
            <div className={`v${empty || stale ? '' : ' ok'}`}>{stale ? '—' : online}</div>
            <div className="k">{stale ? 'connected — not known' : 'answering now'}</div>
          </div>
          <div className="gstat">
            <div className={`v${empty ? '' : ' brand'}`}>{pct(seen, correct)}</div>
            <div className="k">average accuracy</div>
          </div>
          <div className={`gstat${empty ? '' : ' band'}`}>
            <div className="v">{inBand}</div>
            <div className="k">in the support band</div>
          </div>
          <div className="gstat">
            <div className="v">{answers}</div>
            <div className="k">questions served</div>
          </div>
        </div>

        <div style={{ flex: '1 1 240px', minWidth: 0, display: 'grid' }}>
          <Stat
            label="Where the class is working"
            icon="layers"
            value={empty ? '—' : LABEL[LEVELS[peak]]}
            delta={empty ? null : `${atLevel[peak]} of ${rows.length} students at this level`}
            tail={<TailBars bars={LEVELS.map((l, i) => ({ label: SHORT[i], value: atLevel[i], on: i === peak }))} />}
          />
        </div>
      </div>

      {/* Nothing to narrow until somebody has joined, and four pills reading 0
          over an empty roster is the kind of chrome that reads as a mock-up. */}
      {!empty && (
        <div className="row" style={{ gap: 8, marginBottom: 14 }}>
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className="fpill"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
              <b>{rows.filter(f.match).length}</b>
            </button>
          ))}
          {/* A <label>, and the magnifier first — the same build as the one on
              the bank screen one nav click away. As a <div> with the icon after
              the input, the pill was mirrored and its chrome did not focus the
              field when clicked. */}
          <label className="search right" style={{ width: 210 }}>
            <Icon name="search" size={13} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a roll number"
              aria-label="Find a student in the roster"
            />
          </label>
        </div>
      )}

      {/* Only once there is something in the column to explain. A legend for a
          mark nobody has is chrome, and it would sit on the screen all class
          implying the roster is being policed. It says what the two marks are
          made of and nothing about what they mean — what they are worth is on
          the panel, in the server's own words. */}
      {!empty && rows.some((r) => sigOf(r).level !== 'clear') && (
        <p className="hint" style={{ marginTop: -6, marginBottom: 14 }}>
          Under <b>Signals</b>: a hollow ring is something the student's browser reported, a solid
          dot is something the server worked out for itself, and the number is how many notes there
          are to read. Open a student for the notes and the events behind them.
        </p>
      )}

      {empty && !connecting ? (
        <Empty
          icon={stale ? 'alert' : 'users'}
          title={
            closed ? 'The room closed before anyone joined'
              /* An empty roster on a dead wire is not "waiting" — a room can be
                 full of students whose joins this page never heard about. */
              : stale ? 'Nobody can appear here while the connection is down'
                : 'Waiting for the first student'
          }
          action={closed ? undefined : (
            <button type="button" className="btn pri" onClick={onProjector}>
              <Icon name="broadcast" size={13} />
              Put the code back on the projector
            </button>
          )}
        >
          {closed
            ? 'Nobody answered in this room, so there is nothing to export.'
            : stale
              ? <>Students joining <b className="mono">{code}</b> are still being let in and their
                answers are still being saved — this page just cannot see them yet.</>
              : <>Share the room code <b className="mono">{code}</b> — joins appear here the moment they arrive.</>}
        </Empty>
      ) : (
        <div className="panel" style={staleStyle}>
          <div className="panel-head">
            <span className="t">Roster</span>
            <span className="panel-sub">
              {shown.length === rows.length ? `${rows.length} joined` : `${shown.length} of ${rows.length} shown`}
              {closed ? ' · final standing' : stale ? ' · frozen until the connection is back' : ' · updates as they answer'}
            </span>
            <button
              type="button"
              className="d-tile right"
              onClick={onProjector}
              title="Put the room code back on the projector"
            >
              <Icon name="broadcast" size={14} />
            </button>
          </div>

          {sel && (
            <div
              style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                gap: 12, marginBottom: 14,
              }}
            >
              <div className="accent">
                <div className="k">Selected student</div>
                <div className="row" style={{ gap: 10, marginTop: 6 }}>
                  <span style={{ font: '800 19px/1 var(--mono)', letterSpacing: '-0.02em' }}>{sel.rollNo}</span>
                  {sel.name && <span className="k">{sel.name}</span>}
                  {!sel.online && <span className="k">offline</span>}
                </div>

                {/* The report's promise: a teacher can ask why a student got the
                    set they got and get an answer in one sentence. This is it. */}
                <div className="said" style={{ marginTop: 12 }}>
                  <span style={{ color: 'var(--on-d)' }}>{sel.reason}</span>
                </div>

                <div className="tiles" style={{ marginTop: 16 }}>
                  <div className="accent-tile">
                    <b>{pct(selTotal.seen, selTotal.correct)}<Icon name="activity" size={11} /></b>
                    <span>Overall accuracy</span>
                  </div>
                  <div className="accent-tile">
                    <b>{LABEL[sel.workingLevel]}</b>
                    <span>Working at</span>
                  </div>
                  <div className="accent-tile">
                    <b>{typeof sel.answered === 'number' ? sel.answered : selTotal.seen}<Icon name="check" size={11} /></b>
                    <span>Questions answered</span>
                  </div>
                  <div className="accent-tile">
                    <b>
                      {sel.slowLearner ? 'Support' : 'On track'}
                      <Icon name={sel.slowLearner ? 'alert' : 'checkCircle'} size={11} />
                    </b>
                    <span>Below-40% band</span>
                  </div>
                </div>
              </div>

              <Card>
                <div className="cardhead">
                  <h3>Accuracy by level</h3>
                  <span className="sub">lime marks where they are now</span>
                </div>
                <div className="bars">
                  {LEVELS.map((l) => {
                    const c = (sel.levels || {})[l] || ZERO;
                    const share = c.seen ? Math.round((c.correct / c.seen) * 100) : 0;
                    const cur = sel.workingLevel === l;
                    return (
                      <div key={l}>
                        <div className="lab">{c.seen ? `${c.correct}/${c.seen}` : '—'}</div>
                        <div className={`track${cur ? ' cur' : ''}`}>
                          <i className={`swatch ${l}`} style={{ height: `${share}%` }} />
                        </div>
                        <div className={`nm${cur ? ' cur' : ''}`}>{LABEL[l]}</div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            </div>
          )}

          {/* What was recorded about the selected student, and what it is worth.
              Its own card and not a tile on the gradient one: a tile is a score,
              and the whole position of this feature is that none of this is a
              score. The two classes are kept apart everywhere in here, because
              which class a line belongs to is the most useful thing on it. */}
          {sel && (
            <Card style={{ marginBottom: 14 }}>
              <div className="cardhead">
                <h3>Integrity signals</h3>
                <span className="sub">
                  {selSig.events === 0
                    ? `nothing recorded for ${sel.rollNo}`
                    : `${selSig.reported} reported by the browser · ${selSig.observed} observed by the server`}
                </span>
              </div>

              {selSig.events === 0 ? (
                <div className="card-empty">
                  <Empty icon="shield" title="Nothing has been recorded">
                    This student&apos;s browser has reported nothing, and nothing has been derived
                    from the answers they have given.
                  </Empty>
                </div>
              ) : (
                <div className="signotes">
                  {selSig.notes.length ? (
                    // The server's own sentences, not a rewrite of them: the
                    // thresholds that decide when a count becomes a note live in
                    // one place, and so does the wording that reports it.
                    selSig.notes.map((note) => <span key={note} className="signote">{note}</span>)
                  ) : (
                    <span className="signote">
                      Nothing recorded has crossed the threshold for a note. The trail still lists
                      every one of the {selSig.events} events behind that.
                    </span>
                  )}
                </div>
              )}

              <div className="row" style={{ gap: 10, marginTop: 16 }}>
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => loadTrail(sel.rollNo)}
                  disabled={trailBusy}
                >
                  {trailBusy ? <span className="spin" /> : <Icon name="list" size={13} />}
                  {shownTrail ? 'Load the trail again' : 'Load the full trail'}
                </button>
                <span className="hint" style={{ marginTop: 0 }}>
                  {selSig.events} event{selSig.events === 1 ? '' : 's'} on record for {sel.rollNo}
                  {stale ? ' — read over HTTP, so this works while the live grid is down.' : '.'}
                </span>
              </div>

              {trailError && (
                <div className="note bad" style={{ marginTop: 12 }}>
                  <Icon name="alert" size={15} />
                  <span>{trailError}</span>
                </div>
              )}

              {trailBusy && !shownTrail && (
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="skel" style={{ height: 38, borderRadius: 'var(--r-tile)' }} />
                  ))}
                </div>
              )}

              {shownTrail && (
                <>
                  {/* Verbatim, from the payload, immediately above the events it
                      qualifies. Not a tooltip, not shortened, and not restated
                      in this screen's own words — one wording on the server is
                      the only way every surface keeps saying the same thing. */}
                  <div className="note" style={{ marginTop: 14 }}>
                    <Icon name="info" size={15} />
                    <span>{shownTrail.honesty}</span>
                  </div>

                  {shownTrail.events.length === 0 ? (
                    <p className="hint">Nothing is on record for {shownTrail.rollNo}.</p>
                  ) : (
                    <>
                      <div className="eyebrow" style={{ margin: '14px 0 8px' }}>
                        {shownTrail.events.length} event
                        {shownTrail.events.length === 1 ? '' : 's'} · oldest first
                      </div>
                      <div className="trail">
                        {shownTrail.events.map((e, i) => (
                          <div key={`${e.at}-${e.kind}-${i}`} className="trail-row">
                            <span className="at">{stamp(e.at)}</span>
                            <span className={`src${isObserved(e) ? ' observed' : ''}`}>
                              {isObserved(e) ? 'observed' : 'reported'}
                            </span>
                            <span className="what">{eventLine(e)}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
            </Card>
          )}

          {shown.length === 0 && !connecting ? (
            <div className="d-empty">
              <b>No student matches</b>
              <span>Clear the search, or switch the filter back to Everyone.</span>
            </div>
          ) : (
            <>
              <div className="grid-head">
                <span>Roll</span>
                {SHORT.map((s) => <span key={s}>{s}</span>)}
                <span>Working at</span>
                <span className="r">Overall</span>
                <span>Signals</span>
                <span />
              </div>

              {connecting
                ? [0, 1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="skel" style={{ height: 46, borderRadius: 'var(--r-tile)', marginBottom: 5 }} />
                ))
                : shown.map((r) => {
                  const total = r.total || ZERO;
                  const sig = sigOf(r);
                  // The mark carries the notes with it, so a teacher who is only
                  // hovering gets the words rather than a symbol to decode. It
                  // says what was recorded and never what it adds up to.
                  const sigTitle = sig.notes.length
                    ? `${sig.notes.join(' ')} Open ${r.rollNo} for the full trail.`
                    : `${sig.events} signal${sig.events === 1 ? '' : 's'} recorded. Open ${r.rollNo} for the full trail.`;
                  return (
                    // A div, not a button: a <button> carries UA padding, centring
                    // and intrinsic sizing that fight `display:grid`, which knocked
                    // every cell out of line with its column header.
                    <div
                      key={r.rollNo}
                      role="button"
                      tabIndex={0}
                      className={`grid-row${r.online ? '' : ' off'}`}
                      aria-selected={sel?.rollNo === r.rollNo}
                      title={r.reason || undefined}
                      onClick={() => setPickedRoll(r.rollNo)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPickedRoll(r.rollNo); } }}
                    >
                      <span className="roll"><span className="dot" />{r.rollNo}</span>
                      {LEVELS.map((l) => {
                        const c = (r.levels || {})[l] || ZERO;
                        const cur = r.workingLevel === l;
                        return (
                          <span key={l} className={`${cellClass(c.seen, c.correct)}${cur ? ' cur' : ''}`}>
                            {c.seen ? `${c.correct}/${c.seen}` : '·'}
                          </span>
                        );
                      })}
                      <span className="lv">
                        <span className={`${tagClass(r.workingLevel)} sm`}>{LABEL[r.workingLevel]}</span>
                      </span>
                      <span className={`pct${r.slowLearner ? ' band' : ''}`}>{pct(total.seen, total.correct)}</span>
                      {/* Empty for most students, and that emptiness is the
                          point: a mark on every row would turn a signal into a
                          score. */}
                      <span className="sig">
                        {sig.level !== 'clear' && (
                          // The level is an attribute, not a class: 'note' is
                          // already a class in the sheet and it is a message box.
                          <span className="sigmark" data-level={sig.level} title={sigTitle}>
                            {sig.notes.length || null}
                          </span>
                        )}
                      </span>
                      <span className="bandtag">{r.slowLearner ? 'BAND' : ''}</span>
                    </div>
                  );
                })}
            </>
          )}
        </div>
      )}
    </>
  );
}
