/**
 * Exam mode in a live room (Batch 9, E5 and E7): the setting and, while it is
 * on, what each student's phone reported and what the server worked out. Staff
 * only: none of it reaches a phone or the projector.
 *
 * The students are listed in roll order and stay there. Nothing is ranked,
 * scored or coloured by how much was recorded: a count is a count, the latest
 * signal is said as what was seen, and every list carries the server's honesty
 * sentence (a signal is a prompt to look, never proof).
 *
 * What arrives where:
 *   GET /api/session/:code/exam    the setting (keys included), its help, the
 *                                  students, honesty and privacy; read on load
 *                                  and after every full push
 *   teacher:integrity              full: the whole list again (on watch and after
 *                                  any change of the setting); otherwise only the
 *                                  students that changed, merged by roll number
 *                                  (teach/useRoomFeed.js)
 *   PATCH /api/session/:code/exam  the owner changes the setting; an HOD's 403
 *                                  and a closed room's 409 are shown as said
 *   .../exam/snapshots/:roll       the newest screen picture, fetched with this
 *                                  browser's credentials whenever `snapshotAt`
 *                                  moves, shown from a blob url, never cached
 *   .../exam/collusion             pairs of matching wrong answers, asked for,
 *                                  never fetched on its own; exam rooms only
 *
 *   <ExamRoom code canControl closed info integrity onOpenStudent />
 *   <SnapshotView roll name at load privacy />   also on the student card
 *   signalSentence(event), countsOf(summary)      also on the live trail and the card
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '../lib/api.js';
import { LABEL } from '../lib/bloom.js';
import { Button, Dialog, Empty, Icon, Level, Note, Panel } from '../ui/index.jsx';
import ExamSettings, { draftFrom, examLine, examModeFrom, rememberExamHelp } from './ExamSettings.jsx';

import '../styles/exam.css';

const list = (v) => (Array.isArray(v) ? v : []);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const CLOCK = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const clock = (iso) => { const t = iso ? new Date(iso) : null; return t && !Number.isNaN(t.getTime()) ? CLOCK.format(t) : ''; };
const ago = (iso, now) => {
  const t = Date.parse(iso ?? '');
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  return s < 15 ? 'just now' : s < 60 ? `${s} s ago` : s < 3600 ? `${Math.floor(s / 60)} min ago` : `${Math.floor(s / 3600)} h ago`;
};
const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);
const secs = (ms) => `${(Math.max(0, Number(ms) || 0) / 1000).toFixed(1)}s`;

/* ------------------------------------------------------- signals in words */

// Each kind as a short label, in the order counts are listed (never by size).
// The older kinds read as their exam names, as the server records them.
const KIND = [
  ['visibility_hidden', 'Page left'], ['hidden', 'Page left'],
  ['focus_lost', 'Focus lost'], ['blurred', 'Focus lost'],
  ['returned', 'Came back'],
  ['fullscreen_exit', 'Left fullscreen'], ['fullscreen-exit', 'Left fullscreen'],
  ['copy_attempt', 'Copy blocked'], ['context_menu', 'Menu blocked'], ['paste', 'Pasted'],
  ['screenshot_attempt', 'Screenshot key'],
  ['screenshare_stopped', 'Sharing stopped'], ['screenshare_not_started', 'Sharing not started'],
  ['snapshot_missing', 'Picture missing'],
  ['second_device', 'Second connection'], ['second-socket', 'Second connection'],
  ['timing_anomaly', 'Faster than reading'], ['too-fast', 'Faster than reading'],
  ['level-jump', 'Sudden run of right answers'], ['reload', 'Reloaded'],
];
const KIND_LABEL = Object.fromEntries(KIND);
const KIND_ORDER = KIND.map(([k]) => k);

const SHOT_KEY = { printscreen: 'Print Screen', snip_shortcut: 'Windows+Shift+S', mac_shortcut: 'Cmd+Shift+3, 4 or 5' };

/** One recorded event as a sentence: what was seen, never what it means. */
export function signalSentence(e) {
  switch (e?.kind) {
    case 'hidden':
    case 'visibility_hidden': return `Page left${Number(e.awayMs) ? ` for ${secs(e.awayMs)}` : ''}: possibly Lens or a screenshot tool.`;
    case 'blurred':
    case 'focus_lost': return 'Page left: possibly Lens or a screenshot tool.';
    case 'returned': return 'The page came back.';
    case 'fullscreen_exit':
    case 'fullscreen-exit': return 'Fullscreen was left.';
    case 'copy_attempt': return 'Copying the question was blocked.';
    case 'context_menu': return 'The right-click or long-press menu was blocked.';
    case 'screenshot_attempt': return `A screenshot key was pressed${SHOT_KEY[e.method] ? ` (${SHOT_KEY[e.method]})` : ''}.`;
    case 'screenshare_stopped': return 'Screen sharing stopped.';
    case 'screenshare_not_started': return 'Screen sharing was not started.';
    case 'snapshot_missing': return 'An expected screen picture did not arrive.';
    case 'second_device':
    case 'second-socket': return 'The same roll number joined from a second live connection.';
    case 'timing_anomaly':
    case 'too-fast': return Number(e.tookMs)
      ? `An answer arrived in ${secs(e.tookMs)}, against about ${secs(e.expectedMs)} to read the question.`
      : 'An answer arrived faster than the question could be read.';
    case 'paste': return 'Text was pasted into an answer.';
    case 'reload': return 'The page was reloaded.';
    default: return KIND_LABEL[e?.kind] ? `${KIND_LABEL[e.kind]}.` : String(e?.kind ?? 'Something');
  }
}

/** A summary's counts as [label, n], merged where two kinds read the same, in a fixed order. */
export function countsOf(summary) {
  const counts = summary?.counts && typeof summary.counts === 'object' ? summary.counts : {};
  const kinds = Object.keys(counts).filter((k) => Number(counts[k]) > 0)
    .sort((a, b) => (KIND_ORDER.indexOf(a) + 1 || 99) - (KIND_ORDER.indexOf(b) + 1 || 99));
  const out = [];
  for (const k of kinds) {
    const label = KIND_LABEL[k] ?? k;
    const had = out.find((x) => x[0] === label);
    if (had) had[1] += Number(counts[k]); else out.push([label, Number(counts[k])]);
  }
  return out;
}

const fromServer = (e) => (e?.src === 'observed' ? 'worked out by the server' : 'reported by the browser');

/** Counts, the latest signal and the server's notes, for one student. */
export function SignalSummary({ summary, now = Date.now() }) {
  if (!summary || !summary.events) return <p className="ex-quiet">Nothing recorded.</p>;
  const counts = countsOf(summary);
  const latest = summary.latest;
  return (
    <div className="ex-sum">
      {counts.length > 0 && (
        <ul className="ex-counts" aria-label="Recorded, by kind">
          {counts.map(([label, n]) => <li key={label}>{label} <b className="mono">{n}</b></li>)}
        </ul>
      )}
      {latest && (
        <p className="ex-latest">
          <span className="ex-latest-k">Latest</span>
          <span>{signalSentence(latest)}</span>
          <span className="ex-latest-meta">
            {latest.at && <time dateTime={latest.at} title={clock(latest.at)}>{ago(latest.at, now)}</time>}
            <span>{fromServer(latest)}</span>
          </span>
        </p>
      )}
      {list(summary.notes).length > 0 && (
        <ul className="ex-notes">
          {list(summary.notes).map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}
    </div>
  );
}

/* ---------------------------------------------------------- the picture */

/**
 * The newest screen picture of one student. Read when `at` (their snapshotAt)
 * moves and never kept: each read is a fresh blob url, the last one revoked
 * as the next arrives and when the viewer goes. While a new one loads the old
 * stays, so the picture does not blink every half minute.
 *
 * @param load  () => Promise<{ url, at }>  (api.examSnapshot, or the gallery's)
 */
export function SnapshotView({ roll, name, at, load, privacy }) {
  const [shot, setShot] = useState({ status: 'idle', url: '', at: '', error: '' });
  const urlRef = useRef('');
  // The caller's loader may be a new function on every render; the picture is
  // read again only when the student or their picture's time moves.
  const loadRef = useRef(load);
  loadRef.current = load;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, []);

  const read = useCallback(() => {
    let alive = true;
    setShot((s) => ({ ...s, status: 'loading', error: '' }));
    loadRef.current().then(
      (r) => {
        if (!alive) { URL.revokeObjectURL(r.url); return; }
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = r.url;
        setShot({ status: 'ready', url: r.url, at: r.at ?? '', error: '' });
      },
      (err) => {
        if (!alive) return;
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = '';
        setShot({ status: err.status === 404 ? 'none' : 'error', url: '', at: '', error: err.message });
      },
    );
    return () => { alive = false; };
  }, []);

  // A new student, or a new picture of the same one.
  useEffect(() => {
    if (!roll || !at) {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = '';
      setShot({ status: 'idle', url: '', at: '', error: '' });
      return undefined;
    }
    return read();
  }, [roll, at, read]);

  const who = name ? `${name} (${roll})` : roll;
  return (
    <div className="ex-shot">
      <div className="ex-shot-frame" data-state={shot.status} aria-busy={shot.status === 'loading' || undefined}>
        {shot.url ? (
          <img src={shot.url} alt={`The newest screen picture from ${who}`} />
        ) : shot.status === 'loading' ? (
          <span className="skel" />
        ) : (
          <span className="ex-shot-none">
            <Icon name="projector" size={20} />
            {shot.status === 'none' || shot.status === 'error' ? shot.error
              : at ? 'Reading the picture.' : `No screen picture has arrived from ${who}.`}
          </span>
        )}
      </div>
      <div className="ex-shot-meta">
        {shot.at ? (
          <span>Taken <b className="mono">{clock(shot.at)}</b>, {ago(shot.at, now)}</span>
        ) : <span>{at ? `Sent ${clock(at)}` : 'Nothing sent yet'}</span>}
        {at && (
          <Button size="sm" variant="ghost" icon="refresh" busy={shot.status === 'loading' && Boolean(shot.url)} onClick={read}>Read again</Button>
        )}
      </div>
      {shot.status === 'error' && <Note tone="bad">{shot.error}</Note>}
      {privacy && <p className="ex-priv"><Icon name="eyeOff" size={14} />{privacy}</p>}
    </div>
  );
}

/* ------------------------------------------------------------ collusion */

/** Pairs of matching wrong answers: asked for, with the rule and the note beside them. */
export function Collusion({ load }) {
  const [state, setState] = useState({ status: 'idle', data: null, error: '' });
  const check = () => {
    setState((s) => ({ ...s, status: 'loading', error: '' }));
    load().then(
      (data) => setState({ status: 'ready', data, error: '' }),
      (err) => setState((s) => ({ ...s, status: 'error', error: err.message })),
    );
  };
  const data = state.data;
  const pairs = list(data?.pairs);
  return (
    <section className="card ex-pairs" aria-labelledby="ex-pairs-h">
      <div className="ex-card-head">
        <div className="sec">
          <h2 id="ex-pairs-h">Matching wrong answers</h2>
          <p>Students who gave the same wrong answers close together. Asked for, never run on its own.</p>
        </div>
        <Button size="sm" icon={data ? 'refresh' : 'checklist'} busy={state.status === 'loading'} onClick={check}>
          {data ? 'Check again' : 'Check now'}
        </Button>
      </div>
      <div className="ex-card-body">
        {state.status === 'error' && <Note tone="bad">{state.error}</Note>}
        {!data && state.status !== 'error' && (
          <p className="ex-quiet">The check compares final answers only: no polls, class questions, right answers or drawings.</p>
        )}
        {data && (
          <>
            {data.note && <Note className="ex-pairs-note">{data.note}</Note>}
            {data.rule?.sentence && <p className="ex-rule">{data.rule.sentence}</p>}
            {pairs.length === 0 ? (
              <p className="ex-quiet">No pair matches the rule.</p>
            ) : (
              <ol className="ex-pair-list">
                {pairs.map((p) => {
                  const [a, b] = list(p.students);
                  return (
                    <li key={`${a?.rollNo}-${b?.rollNo}`} className="ex-pair">
                      <p className="ex-pair-who">
                        <span><b className="mono">{a?.rollNo}</b>{a?.name ? ` ${a.name}` : ''}</span>
                        <span aria-hidden="true">and</span>
                        <span className="sr-only">and</span>
                        <span><b className="mono">{b?.rollNo}</b>{b?.name ? ` ${b.name}` : ''}</span>
                      </p>
                      <p className="ex-pair-n">
                        The same wrong answer to {plural(p.matches, 'question')} within {data.rule?.closeSeconds ?? 60} seconds of each other;
                        {' '}{p.sameWrong} the same wrong at any time.
                      </p>
                      <ul className="ex-pair-qs">
                        {list(p.questions).map((q) => (
                          <li key={q.questionId}>
                            {q.bloom && LABEL[q.bloom] && <Level level={q.bloom} />}
                            <span className="clip">{q.topic || 'No topic'}</span>
                            <span className="mono">{q.gapSeconds} s apart</span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  );
                })}
              </ol>
            )}
            {data.privacy && <p className="ex-priv"><Icon name="eyeOff" size={14} />{data.privacy}</p>}
          </>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ the space */

const NOT_LISTED = 'Students the class list marks under 18 are not listed: nothing is recorded about them.';

/**
 * @param code        the room
 * @param canControl  this account may change the room (false for an HOD)
 * @param closed      the room is closed: the setting stays as it was
 * @param info        the room's row in the room list (classId, examMode summary)
 * @param integrity   the merged teacher:integrity feed (useRoomFeed), or null
 * @param onOpenStudent (rollNo) => open the student card
 * @param read / save / snapshot / collusion   stand-ins for the api (the gallery)
 * @param initialPick the student whose picture shows to begin with (the gallery)
 */
export default function ExamRoom({
  code, canControl = true, closed = false, info, integrity, onOpenStudent,
  read = api.examMode, save = api.setExamMode, snapshot = api.examSnapshot, collusion = api.examCollusion,
  initialPick = '',
}) {
  const [exam, setExam] = useState({ status: 'loading', data: null, error: '' });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => draftFrom(null));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [picked, setPicked] = useState(initialPick);
  const [query, setQuery] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [tries, setTries] = useState(0);
  const hasClass = Boolean(info?.classId);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  // Read on load and after every full push: a full push follows any change of
  // the setting, made here or in another tab.
  const seq = integrity?.seq ?? 0;
  const readRef = useRef(read);
  readRef.current = read;
  useEffect(() => {
    let alive = true;
    readRef.current(code).then(
      (data) => { if (alive) { setExam({ status: 'ready', data, error: '' }); rememberExamHelp(data?.help); } },
      (err) => { if (alive) setExam((e) => ({ ...e, status: e.data ? 'ready' : 'error', error: err.message })); },
    );
    return () => { alive = false; };
  }, [code, seq, tries]);

  const data = exam.data;
  const mode = data?.examMode ?? null;
  const on = Boolean(mode?.on ?? integrity?.examMode?.on ?? info?.examMode?.on);
  const help = data?.help;
  // The socket's list once a full push has come; the read's until then.
  const students = useMemo(() => list(integrity?.seq > 0 ? integrity.students : data?.students), [integrity, data]);
  const honesty = integrity?.honesty ?? data?.honesty;
  const privacy = integrity?.privacy ?? data?.privacy;
  const pictures = Number(mode?.snapshotSeconds ?? integrity?.examMode?.snapshotSeconds ?? 0) > 0 || students.some((s) => s.snapshotAt);

  const q = query.trim().toLowerCase();
  const shown = q ? students.filter((s) => `${s.rollNo} ${s.name ?? ''}`.toLowerCase().includes(q)) : students;
  const withSignal = students.filter((s) => (s.summary?.events ?? 0) > 0).length;
  const withPicture = students.filter((s) => s.snapshotAt).length;
  const sel = students.find((s) => s.rollNo === picked) ?? null;

  function openEditor() {
    setDraft(draftFrom(mode));
    setSaveError('');
    setEditing(true);
  }
  const { value, why } = examModeFrom(draft, { hasClass });
  async function store() {
    setSaving(true); setSaveError('');
    try {
      const reply = await save(code, value);
      rememberExamHelp(reply?.help);
      setExam((e) => ({ status: 'ready', error: '', data: { ...(e.data ?? {}), room: reply?.room ?? e.data?.room, examMode: reply?.examMode, help: reply?.help ?? e.data?.help } }));
      setEditing(false);
    } catch (err) {
      setSaveError(err.message);
    } finally { setSaving(false); }
  }

  if (exam.status === 'loading' && !data) {
    return (
      <div className="ex-live" aria-busy="true" aria-label="Reading exam mode">
        <div className="skel ex-skel-brief" />
        <div className="skel ex-skel-list" />
      </div>
    );
  }
  if (exam.status === 'error' && !data) {
    return (
      <div className="card">
        <Empty icon="shield" title="Exam mode could not be read" action={<Button icon="refresh" onClick={() => { setExam({ status: 'loading', data: null, error: '' }); setTries((t) => t + 1); }}>Try again</Button>}>
          {exam.error}
        </Empty>
      </div>
    );
  }

  const change = canControl && !closed;
  return (
    <div className="ex-live">
      <Panel className="ex-brief" aria-label="Exam mode in this room">
        <div className="ex-brief-main">
          <div className="cluster">
            <span className="tag-mint">Exam mode · staff only</span>
            <span className="ex-brief-meta">{on ? 'On' : 'Off'}{closed ? ' · room closed' : ''}</span>
          </div>
          <p className="ex-lead">
            {!on ? (closed ? 'Exam mode was off in this room.' : 'Exam mode is off. Phones work as in any room.')
              : !students.length ? 'Exam mode is on. Nobody is listed yet.'
                : withSignal ? `Exam mode is on. ${withSignal} of ${students.length} students have something recorded: each a prompt to look.`
                  : `Exam mode is on. Nothing is recorded for any of the ${plural(students.length, 'student')} listed.`}
          </p>
          {help?.honesty && <p className="ex-brief-honest">{help.honesty}</p>}
          {on && (
            <div className="brief">
              <b>Asks</b>
              <span>{cap(examLine(mode ?? integrity?.examMode))}.</span>
              <b>Listed</b>
              <span>In roll order, as they join.{hasClass ? ` ${NOT_LISTED}` : ''}</span>
            </div>
          )}
          <div className="cluster ex-brief-acts">
            {change && (
              <Button variant={on ? undefined : 'accent'} icon={on ? 'settings' : 'shield'} onClick={openEditor}>
                {on ? 'Change exam mode' : 'Turn exam mode on'}
              </Button>
            )}
          </div>
          {!canControl && <p className="ex-ro">Read only: only whoever runs this room changes its exam mode.</p>}
          {canControl && closed && <p className="ex-ro">The room is closed, so its exam mode can no longer change.</p>}
        </div>
        {on && (
          <div className="ex-tiles">
            <div className="ptile">
              <span>Listed</span>
              <b>{students.length}</b>
              <small><i>in roll order</i></small>
            </div>
            <div className="ptile" style={{ '--d': '0.6s' }}>
              <span>With a signal</span>
              <b>{withSignal}</b>
              <small>of {students.length}</small>
            </div>
            {pictures && (
              <div className="ptile" style={{ '--d': '1.2s' }}>
                <span>With a picture</span>
                <b>{withPicture}</b>
                <small>of {students.length}</small>
              </div>
            )}
          </div>
        )}
      </Panel>

      {on && (
        <div className="ex-cols">
          <section className="card ex-list" aria-labelledby="ex-list-h">
            <div className="ex-card-head">
              <div className="sec">
                <h2 id="ex-list-h">Signals, in roll order</h2>
                <p>What each phone reported and what the server worked out. Never a ranking.</p>
              </div>
              {students.length > 8 && (
                <label className="search ex-find">
                  <Icon name="search" />
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a student" aria-label="Find a student" />
                </label>
              )}
            </div>
            {honesty && <p className="ex-honesty"><Icon name="info" size={14} /><span>{honesty}</span></p>}
            {students.length === 0 ? (
              <div className="ex-card-body">
                <p className="ex-quiet">Nobody is listed yet. Each student appears here as they join, in roll order.</p>
              </div>
            ) : shown.length === 0 ? (
              <div className="ex-card-body"><p className="ex-quiet">No student matches. Clear the search to see everyone.</p></div>
            ) : (
              <ol className="ex-rows">
                {shown.map((s) => (
                  <li key={s.rollNo} className="ex-st" data-on={sel?.rollNo === s.rollNo ? 'true' : undefined}>
                    <div className="ex-st-who">
                      {onOpenStudent ? (
                        <button type="button" className="ex-st-open" onClick={() => onOpenStudent(s.rollNo)} aria-label={`Open the card of ${s.name || s.rollNo}`}>
                          <b className="mono">{s.rollNo}</b>
                          {s.name && <span className="clip">{s.name}</span>}
                        </button>
                      ) : (
                        <span className="ex-st-open"><b className="mono">{s.rollNo}</b>{s.name && <span className="clip">{s.name}</span>}</span>
                      )}
                    </div>
                    <SignalSummary summary={s.summary} now={now} />
                    {pictures && (
                      <div className="ex-st-pic">
                        {s.snapshotAt ? (
                          <Button
                            size="sm"
                            variant={sel?.rollNo === s.rollNo ? 'primary' : undefined}
                            icon="projector"
                            aria-pressed={sel?.rollNo === s.rollNo}
                            onClick={() => setPicked(s.rollNo)}
                          >
                            <span className="sr-only">Show the screen picture of {s.rollNo}, </span>{clock(s.snapshotAt)}
                          </Button>
                        ) : <span className="ex-quiet">No picture</span>}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>

          <div className="ex-side">
            {pictures && (
              <section className="card ex-viewer" aria-labelledby="ex-viewer-h">
                <div className="ex-card-head">
                  <div className="sec">
                    <h2 id="ex-viewer-h">Screen picture</h2>
                    <p>{sel ? <><span className="mono">{sel.rollNo}</span>{sel.name ? `, ${sel.name}` : ''}: the newest only.</> : 'Choose a picture time in the list to see it here.'}</p>
                  </div>
                </div>
                <div className="ex-card-body">
                  {sel ? (
                    <SnapshotView
                      roll={sel.rollNo}
                      name={sel.name}
                      at={sel.snapshotAt}
                      load={() => snapshot(code, sel.rollNo)}
                      privacy={privacy}
                    />
                  ) : privacy && <p className="ex-priv"><Icon name="eyeOff" size={14} />{privacy}</p>}
                </div>
              </section>
            )}
            <Collusion load={() => collusion(code)} />
          </div>
        </div>
      )}

      <Dialog
        open={editing}
        onOpenChange={(v) => { if (!v && !saving) setEditing(false); }}
        locked={saving}
        wide
        title={`Exam mode in ${code}`}
        description="A change reaches every phone in the room at once."
        footer={(
          <>
            <Button variant="ghost" disabled={saving} onClick={() => setEditing(false)}>Cancel</Button>
            <Button variant="primary" busy={saving} disabled={Boolean(why)} onClick={store}>
              {draft.on ? (on ? 'Save the change' : 'Turn exam mode on') : (on ? 'Turn exam mode off' : 'Save')}
            </Button>
          </>
        )}
      >
        <div className="ex-dlg">
          {!on && draft.on && (
            <Note>
              A phone already in the room shows the student the exam notice first. Until it has, what it reports is
              recorded as in any room.
            </Note>
          )}
          <ExamSettings
            draft={draft}
            onDraft={(d) => { setDraft(d); setSaveError(''); }}
            help={help}
            hasClass={hasClass}
            noClass="This room was opened without a class, so fullscreen, screen sharing and pictures cannot be asked for in it: only a class list can mark a student under 18."
            idp="exl"
            why={why}
          />
          {saveError && <Note tone="bad" role="alert">{saveError}</Note>}
        </div>
      </Dialog>
    </div>
  );
}
