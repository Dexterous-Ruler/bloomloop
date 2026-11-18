/**
 * A professor's home: what is in the console, how the classes went, and the
 * students they answer for.
 *
 * It sits in front of the console, not inside it. The console is a job of work
 * with a beginning and an end; this is what a professor opens to see where the
 * term is, get back into a room that is running, and hand a student an account.
 *
 * Everything on it comes from one GET /api/dashboard. There is no id in that
 * call: the role picks the shape and the token picks the rows, so this screen
 * cannot be aimed at another professor. The selected student's level detail is
 * GET /api/analytics/:id, which the server checks against the same roster.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { api } from '../lib/api.js';
import { LABEL } from '../lib/bloom.js';
import AccountShell from '../shell/AccountShell.jsx';
import { useViewer } from '../shell/viewer.js';
import { Avatar, Button, Chip, Dialog, Empty, Fig, Icon, Level, Note, Segmented, Tip } from '../ui/index.jsx';
import { LevelBars } from '../ui/viz.jsx';
import InviteStudents from './dashInvite.jsx';
import {
  ago, big, busiest, byLevel, dayOf, Facts, plural, roomLink, RoomState, share, useMedia,
} from './dashParts.jsx';

/** The roll number, or '': the server stores it nullable and sometimes blank. */
const rollOf = (student) => String(student?.rollNo ?? '').trim();

/* Each filter carries its own test, so its count and the rows it shows cannot
   drift apart. */
const FILTERS = [
  { id: 'all', label: 'Everyone', match: () => true },
  { id: 'noroll', label: 'No roll number', match: (s) => !rollOf(s) },
  { id: 'off', label: 'Deactivated', match: (s) => !s.active },
];

const CHAPTERS_SHOWN = 5;
const STUDENTS_SHOWN = 12;
const ROOMS_SHOWN = 6;

/* ------------------------------------------------------------------ pieces */

function Skeleton() {
  return (
    <div className="stack stack-5" aria-busy="true">
      <div className="stack stack-2">
        <div className="skel" style={{ height: 32, width: 240 }} />
        <div className="skel" style={{ height: 16, width: 420, maxWidth: '100%' }} />
      </div>
      <div className="dash-top" style={{ marginBottom: 0 }}>
        <div className="skel" style={{ height: 280, borderRadius: 'var(--r-3)' }} />
        <div className="skel" style={{ height: 280, borderRadius: 'var(--r-3)' }} />
      </div>
      <div className="split">
        <div className="skel" style={{ height: 360, borderRadius: 'var(--r-3)' }} />
        <div className="skel" style={{ height: 360, borderRadius: 'var(--r-3)' }} />
      </div>
    </div>
  );
}

/** Nothing loaded, nothing run, nobody invited: the three things, in order. */
function FirstRun({ canInvite, onInvite }) {
  return (
    <section className="card">
      <div className="card-head"><h3>Three things get a class running</h3></div>
      <ol className="rows dash-pad">
        <li className="rw dash-stepline">
          <span className="dash-step">1</span>
          <span className="rw-main">
            <span className="strong dash-block">Load a chapter</span>
            <span className="t-small muted">A lesson deck or a pasted syllabus. Questions are written only from what is in it.</span>
          </span>
          <Link className="btn btn-primary dash-tap" to="/">Open the console<Icon name="forward" /></Link>
        </li>
        <li className="rw dash-stepline">
          <span className="dash-step">2</span>
          <span className="rw-main">
            <span className="strong dash-block">Open a room</span>
            <span className="t-small muted">Once a bank is written, a room puts a six-character code on the projector and the class does the rest.</span>
          </span>
        </li>
        <li className="rw dash-stepline">
          <span className="dash-step">3</span>
          <span className="rw-main">
            <span className="strong dash-block">Invite your students</span>
            <span className="t-small muted">
              Not needed to join: a room asks only for its code and a roll number. An account lets a student read
              their own history back afterwards.
            </span>
          </span>
          {canInvite && <Button className="dash-tap" icon="invite" onClick={onInvite}>Invite students</Button>}
        </li>
      </ol>
    </section>
  );
}

/**
 * One student in detail. The roll number is the whole story here: a live room
 * identifies a student by the number typed on their phone, so it is the only
 * thread between this account and the answers it gave.
 */
/**
 * The supports a student's phone gives them. Private to this screen: nothing
 * here reaches the projector, the live roster or the student's classmates, and
 * the phone is told only which rendering switches are on, never a label.
 * Saved on each change; a failed save puts the box back as it was.
 */
function Supports({ studentId, services }) {
  const [state, setState] = useState({ loading: true });
  const [saving, setSaving] = useState('');

  useEffect(() => {
    let alive = true;
    setState({ loading: true });
    services.studentAccommodations(studentId).then(
      (res) => { if (alive) setState({ list: res.supports ?? [], on: res.accommodations ?? {} }); },
      (err) => { if (alive) setState({ error: err.message || 'The server did not answer.' }); },
    );
    return () => { alive = false; };
  }, [studentId, services]);

  async function toggle(key, value) {
    const before = state.on;
    const next = { ...before, [key]: value };
    if (!value) delete next[key];
    setState((s) => ({ ...s, on: next, saveError: '' }));
    setSaving(key);
    try {
      const res = await services.setStudentAccommodations(studentId, next);
      setState((s) => ({ ...s, on: res.accommodations ?? next }));
    } catch (err) {
      setState((s) => ({ ...s, on: before, saveError: err.message || 'The server did not answer.' }));
    } finally { setSaving(''); }
  }

  return (
    <div className="dash-sec">
      <div className="t-label">Supports</div>
      {state.loading ? (
        <div className="skel" style={{ height: 96 }} />
      ) : state.error ? (
        <Note tone="bad">Their supports did not load: {state.error}</Note>
      ) : (
        <>
          <div className="stack stack-2">
            {state.list.map((sup) => (
              <label key={sup.key} className="check">
                <input
                  type="checkbox"
                  checked={state.on?.[sup.key] === true}
                  disabled={Boolean(saving)}
                  onChange={(e) => toggle(sup.key, e.target.checked)}
                  aria-describedby={`sup-${studentId}-${sup.key}`}
                />
                <Tip label={sup.detail}><span>{sup.label}</span></Tip>
                <span id={`sup-${studentId}-${sup.key}`} className="sr-only">{sup.detail}</span>
              </label>
            ))}
          </div>
          {state.saveError && <Note tone="bad">Not saved: {state.saveError}</Note>}
          <p className="said">
            Applied the next time their phone joins one of your rooms. Only you see this list; their phone is told
            how to draw a question, never why.
          </p>
        </>
      )}
    </div>
  );
}

function StudentDetail({ student: s, detail, onRetry, services }) {
  const roll = rollOf(s);
  const d = detail?.data;
  const level = d?.currentLevel ?? null;
  const seen = (d?.bloom ?? []).reduce((n, b) => n + (b.seen ?? 0), 0);

  let reading = null;
  if (d && seen > 0) {
    if (d.confident && d.best && d.weakest) {
      reading = `Strongest at ${LABEL[d.best.level]} (${share(d.best.accuracy)}), weakest at ${LABEL[d.weakest.level]} (${share(d.weakest.accuracy)}).`;
    } else if (d.best) {
      reading = `Only ${LABEL[d.best.level]} has enough answers behind it to read.`;
    } else {
      reading = 'Too few answers at any one level to call it strong or weak.';
    }
  }

  return (
    <>
      <div className="dash-sec">
        <div className="t-label">Level reached</div>
        {!roll ? (
          <p className="muted">Unknown. No room can be matched to this account.</p>
        ) : detail?.error ? (
          <Note tone="bad">
            Their results did not load: {detail.error}{' '}
            <button type="button" className="link dash-linkbtn" onClick={onRetry}>Try again</button>
          </Note>
        ) : !d ? (
          <div className="skel" style={{ height: 32, width: 160 }} />
        ) : level ? (
          <div className="cluster cluster-3">
            <Level level={level} size="lg" />
            <span className="t-meta">
              in their last room · {plural(d.counts?.sessions, 'room')}, {plural(d.counts?.answered, 'answer')}, {share(d.counts?.accuracy)}
            </span>
          </div>
        ) : (
          <p className="muted">None yet. Roll number {roll} has not sat one of your rooms.</p>
        )}
      </div>

      {roll && !detail?.error && (
        <div className="dash-sec">
          <div className="cluster between">
            <span className="t-label">Accuracy by level</span>
            <span className="t-meta">correct of answered</span>
          </div>
          {!d ? (
            <div className="skel" style={{ height: 184 }} />
          ) : (
            <>
              <div className="dash-levels"><LevelBars byLevel={byLevel(d.bloom)} current={level ?? undefined} height={40} /></div>
              {reading && <p className="t-meta">{reading}</p>}
            </>
          )}
        </div>
      )}

      <div className="dash-sec">
        <div className="t-label">How they are linked</div>
        <Facts
          items={[
            ['Roll number', roll ? <span className="mono">{roll}</span> : 'Not set'],
            ['Their results', roll ? 'Joined by roll number' : 'Not linked'],
            ['BloomLoop code', <span className="mono">{s.code}</span>],
            ['Account', s.active ? 'Active' : 'Deactivated'],
          ]}
        />
        <p className="said">
          {roll
            ? `Their phone types ${roll} to join a room, and everything that number has answered in your rooms is on their results screen.`
            : 'Nothing in a room knows this account exists: the class is keyed on the number typed on the phone, and this account has none. Only a head of department can add it afterwards, so put the number on the invite before it goes out.'}
        </p>
      </div>

      {s.active && services?.studentAccommodations && <Supports studentId={s.id} services={services} />}
    </>
  );
}

/**
 * Nobody selected: every class together stands in the inspector. How the rooms
 * went as figures, then where the answers landed and how well.
 */
function AllClasses({ counts, bloom, hasStudents }) {
  const seen = bloom.reduce((n, b) => n + (b.seen ?? 0), 0);
  const peak = busiest(bloom);
  // The thinnest level among those that have been served at all: an untouched
  // level is not a weakness, it is a gap in the bank.
  const served = bloom.filter((b) => b.seen > 0 && b.accuracy != null);
  const weakest = served.length ? served.reduce((low, b) => (b.accuracy < low.accuracy ? b : low)) : null;

  return (
    <>
      <div className="dash-insp-head">
        <span className="avatar avatar-lg"><Icon name="users" size={18} /></span>
        <div className="grow">
          <h3>All your classes</h3>
          <div className="t-meta">{hasStudents ? 'Select a student to read their levels.' : 'Every room you have run, together.'}</div>
        </div>
      </div>

      <div className="dash-sec">
        <div className="figs dash-figs-tight">
          <Fig value={big(counts.attendances)} label="Seats filled" />
          <Fig value={big(counts.answered)} label="Answers" />
          <Fig value={share(counts.accuracy)} label="Mean accuracy" />
          <Fig value={big(counts.banded)} label="In the support band" />
        </div>
        <p className="t-meta">
          Seats count sittings, not people: a student in four rooms is four. Accuracy is the mean of each
          student&rsquo;s own. A sitting under 40% overall is in the support band.
        </p>
      </div>

      <div className="dash-sec">
        <div className="cluster between">
          <span className="t-label">Accuracy by level</span>
          <span className="t-meta">correct of answered</span>
        </div>
        <div className="dash-levels"><LevelBars byLevel={byLevel(bloom)} current={seen ? peak?.level : undefined} height={40} /></div>
        <p className="t-meta">
          {seen === 0
            ? 'Fills in from answers, not from banks. One room with one class puts six bars here.'
            : (
              <>
                Outlined: {LABEL[peak.level]}, where most questions landed.
                {weakest && weakest.level !== peak.level && (
                  <> {LABEL[weakest.level]} is the thinnest at {share(weakest.accuracy)} of {weakest.seen.toLocaleString()} served, so weight the next bank towards it.</>
                )}
              </>
            )}
        </p>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------- view */

/**
 * @param data       GET /api/dashboard as a professor, or null before the first read
 * @param details    { [studentId]: { loading, error, data } } from GET /api/analytics/:id
 * @param onInspect  (studentId, force?) => void - asks for that detail
 * @param services   what the invite dialog calls; see dashInvite.jsx
 */
export function OverviewView({
  loading, error, data, refreshing, onRefresh, details = {}, onInspect, services,
}) {
  const { account } = useViewer();
  const navigate = useNavigate();
  const narrow = useMedia('(max-width: 1080px)');

  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [pickedId, setPickedId] = useState('');
  const [sheet, setSheet] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [allChapters, setAllChapters] = useState(false);
  const [allStudents, setAllStudents] = useState(false);

  const contents = useMemo(() => data?.contents ?? [], [data]);
  const sessions = useMemo(() => data?.recentSessions ?? [], [data]);
  const roster = useMemo(() => data?.roster ?? [], [data]);
  const bloom = useMemo(() => data?.bloom ?? [], [data]);

  const shownRoster = useMemo(() => {
    const match = (FILTERS.find((f) => f.id === filter) ?? FILTERS[0]).match;
    const q = query.trim().toLowerCase();
    return roster.filter(
      (s) => match(s) && (!q || `${s.fullName ?? ''} ${s.code ?? ''} ${rollOf(s)}`.toLowerCase().includes(q)),
    );
  }, [roster, filter, query]);

  /* Nobody is selected until someone is picked: the inspector then holds every
     class together. The accounts that need something done - no roll number -
     are marked in the list and counted on the filter, so they are not hunted for. */
  const sel = useMemo(() => roster.find((s) => s.id === pickedId) ?? null, [roster, pickedId]);

  // An account with no roll number has nothing to look up, and the server
  // would only say so.
  const inspected = sel && rollOf(sel) && (!narrow || sheet) ? sel.id : null;
  useEffect(() => {
    if (inspected != null && !details[inspected]) onInspect?.(inspected);
  }, [inspected, details, onInspect]);

  const crumb = (
    <>
      <span>Overview</span>
      {account?.code && <span className="mono">{account.code}</span>}
    </>
  );

  if (loading) {
    return <AccountShell current="home" crumb={crumb}><Skeleton /></AccountShell>;
  }

  if (!data) {
    return (
      <AccountShell current="home" crumb={crumb}>
        <Empty
          icon="alert"
          title="Your overview did not load"
          action={<Button variant="primary" icon="refresh" busy={refreshing} onClick={onRefresh}>Try again</Button>}
        >
          {error || 'The server did not answer.'}
        </Empty>
      </AccountShell>
    );
  }

  const counts = data.counts ?? {};
  // The shared teacher key is not an account, and the server refuses it an
  // invite on purpose: there is no reporting line to hang a student off.
  const canInvite = Boolean(account);

  const running = sessions.filter((s) => s.status === 'open' || s.status === 'paused');
  const live = running.filter((s) => s.status === 'open');
  const linked = roster.filter((s) => rollOf(s)).length;
  const blank = contents.length === 0 && sessions.length === 0 && roster.length === 0;
  const chapters = allChapters ? contents : contents.slice(0, CHAPTERS_SHOWN);
  // A whole class is a long list to open on. A search or a filter is already a
  // narrowing, so what it finds is shown in full.
  const narrowed = filter !== 'all' || query.trim() !== '';
  const visible = allStudents || narrowed ? shownRoster : shownRoster.slice(0, STUDENTS_SHOWN);

  const pick = (id) => {
    setPickedId(id);
    if (narrow) setSheet(true);
  };

  const detailOf = (s) => (
    <StudentDetail student={s} detail={details[s.id]} onRetry={() => onInspect?.(s.id, true)} services={services} />
  );

  const studentsCard = (
    <section className="card">
      <div className="card-head dash-wrap">
        <h3>Students</h3>
        <span className="t-meta">
          {plural(roster.length, 'account reports', 'accounts report')} to you
          {roster.length > 0 && ` · ${linked} linked by roll number`}
        </span>
      </div>

      {roster.length === 0 ? (
        <Empty
          icon="users"
          title="Nobody reports to you yet"
          action={canInvite && <Button variant="primary" className="dash-tap" icon="invite" onClick={() => setInviting(true)}>Invite your first student</Button>}
        >
          Students join a room with its code and a roll number and need no account for that. An account lets them read
          their own history back afterwards.
        </Empty>
      ) : (
        <>
          <div className="dash-tools is-inset">
            <div className="dash-segbox">
              <Segmented
                label="Which students to show"
                value={filter}
                onChange={setFilter}
                options={FILTERS.map((f) => ({ id: f.id, label: f.label, count: roster.filter(f.match).length }))}
              />
            </div>
            <label className="search">
              <Icon name="search" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a name, code or roll number" aria-label="Find a student" />
            </label>
          </div>

          {shownRoster.length === 0 ? (
            <Empty
              icon="search"
              title="No student matches"
              action={<Button className="dash-tap" onClick={() => { setFilter('all'); setQuery(''); }}>Clear the filter</Button>}
            >
              Nothing on your roster answers to that.
            </Empty>
          ) : (
            <table className="tbl dash-tbl dash-students">
              <thead>
                <tr>
                  <th>Student</th>
                  <th className="r">Roll number</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((s) => {
                  const roll = rollOf(s);
                  return (
                    <tr
                      key={s.id}
                      className="is-click"
                      aria-selected={!narrow && s.id === sel?.id ? 'true' : undefined}
                      onClick={() => pick(s.id)}
                    >
                      <td className="c-main">
                        <div className="dash-who">
                          <button
                            type="button"
                            className="dash-rowbtn"
                            aria-label={`${s.fullName || 'Unnamed account'}, open details`}
                            onClick={(e) => { e.stopPropagation(); pick(s.id); }}
                          >
                            <Avatar name={s.fullName} />
                            <span className="dash-who-txt">
                              <span className="strong clip">{s.fullName || 'Unnamed account'}</span>
                              <span className="t-meta mono">{s.code}</span>
                            </span>
                          </button>
                          {!s.active && <Chip tone="line">Deactivated</Chip>}
                        </div>
                      </td>
                      <td className="r c-roll">
                        {roll ? <span className="mono">{roll}</span> : <Chip icon="alert">No roll number</Chip>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {shownRoster.length > visible.length || (allStudents && shownRoster.length > STUDENTS_SHOWN) ? (
            <div className="card-foot">
              <Button size="sm" variant="ghost" className="dash-tap" onClick={() => setAllStudents((v) => !v)}>
                {allStudents ? 'Show fewer' : `Show all ${shownRoster.length} students`}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );

  return (
    <AccountShell current="home" crumb={crumb}>
      <div className="page-head">
        <div>
          <div className="eyebrow">{data.department || (canInvite ? 'Professor' : 'Shared teacher key')}</div>
          <h1>Your teaching</h1>
          <p className="t-lead lead">
            {blank
              ? 'Nothing is loaded yet. The console is where a chapter becomes a question bank and a bank becomes a room.'
              : (
                <>
                  {plural(counts.contents, 'chapter')} and {plural(counts.questions, 'question')} in the console,{' '}
                  {plural(counts.sessions, 'room')} run.
                  {live.length > 0 && ` ${plural(live.length, 'room is', 'rooms are')} live now.`}
                </>
              )}
          </p>
        </div>
        <div className="acts dash-headacts">
          <Tip label="Read the overview again">
            <Button variant="ghost" className="dash-tap" icon="refresh" busy={refreshing} aria-label="Read the overview again" onClick={onRefresh} />
          </Tip>
          {!blank && <Button className="dash-tap" icon="invite" disabled={!canInvite} onClick={() => setInviting(true)}>Invite students</Button>}
          {/* The one primary action is getting to the console. When a room is
              live that is the room, and this steps back for it. */}
          {!blank && (
            <Link className={`btn dash-tap${live.length > 0 ? '' : ' btn-primary'}`} to="/">Open the console<Icon name="forward" /></Link>
          )}
        </div>
      </div>

      <div className="stack stack-3 dash-notes">
        {error && <Note tone="bad">The figures below are the last ones that loaded: {error}</Note>}
        {/* The role decides the payload shape, so a mismatch means this screen is
            on the wrong route, not that the data is odd. */}
        {data.role && data.role !== 'professor' && (
          <Note>Your account signs in as {data.role}, so this is not your screen. Nothing here is shaped for it.</Note>
        )}
        {!canInvite && (
          <Note>
            This is open on the shared teacher key, which is not an account. It reads the chapters and rooms nobody
            owns, but it cannot invite: an invited student has to report to somebody, and a key reports to nobody.
          </Note>
        )}
      </div>

      {blank ? (
        <FirstRun canInvite={canInvite} onInvite={() => setInviting(true)} />
      ) : (
        <>
          {running.length > 0 && (
            <section className="card dash-running" aria-label="Rooms running now">
              <ul className="rows dash-pad">
                {running.map((r) => (
                  <li key={r.code} className="rw dash-liverow">
                    <RoomState status={r.status} />
                    <span className="mono strong">{r.code}</span>
                    <span className="rw-main">
                      <span className="strong clip dash-block">{r.title || 'Untitled room'}</span>
                      <span className="t-meta">{plural(r.joined, 'student')} joined · opened {ago(r.startedAt) || 'at an unrecorded time'}</span>
                    </span>
                    <Link className={`btn dash-tap${r.status === 'open' ? ' btn-primary' : ''}`} to={roomLink(r.code, 'live')}>
                      <Icon name="live" />
                      Open the class
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="dash-top">
            <section className="card">
              <div className="card-head">
                <h3>Chapters in the console</h3>
                <span className="t-meta">{plural(counts.questions, 'question')}</span>
              </div>
              {contents.length === 0 ? (
                <Empty icon="deck" title="No material loaded yet" action={<Link className="btn btn-primary dash-tap" to="/"><Icon name="upload" />Load a chapter</Link>}>
                  A lesson deck or a pasted syllabus is all it takes. Everything else here is written from what you
                  already teach.
                </Empty>
              ) : (
                <ul className="rows dash-pad">
                  {chapters.map((c) => (
                    <li key={c.id}>
                      <Link className="rw" to={`/?content=${encodeURIComponent(c.id)}`}>
                        <Icon name={c.kind === 'syllabus' ? 'material' : 'deck'} className="muted" />
                        <span className="rw-main">
                          <span className="strong clip dash-block">{c.title || 'Untitled chapter'}</span>
                          <span className="t-meta">
                            {plural(c.topics, 'topic')} · {c.questions ? plural(c.questions, 'question') : 'no questions yet'}
                            {c.sessions > 0 && ` · ${plural(c.sessions, 'room')} run`}
                            {dayOf(c.createdAt) && ` · loaded ${dayOf(c.createdAt)}`}
                          </span>
                        </span>
                        {/* A bank that has never been in front of a class is the
                            one thing on this row worth acting on. */}
                        {c.questions > 0 && !c.sessions && <Chip>Not run yet</Chip>}
                        <Icon name="chevronRight" className="muted" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {contents.length > CHAPTERS_SHOWN && (
                <div className="card-foot">
                  <Button size="sm" variant="ghost" className="dash-tap" onClick={() => setAllChapters((v) => !v)}>
                    {allChapters ? 'Show fewer' : `Show all ${contents.length} chapters`}
                  </Button>
                </div>
              )}
            </section>

            <section className="card">
              <div className="card-head">
                <h3>Recent rooms</h3>
                {sessions.length > 0 && <Button size="sm" variant="ghost" className="dash-tap" onClick={() => navigate('/rooms')}>All rooms</Button>}
              </div>
              {sessions.length === 0 ? (
                <div className="card-body stack stack-3">
                  <p className="muted">
                    {contents.length === 0
                      ? 'No rooms run yet. Load a chapter and write a bank first: a room needs questions to serve.'
                      : 'No rooms run yet. Your banks are written, so a room can go on the projector whenever the class is ready.'}
                  </p>
                  <div><Button className="dash-tap" icon="play" disabled={contents.length === 0} onClick={() => navigate('/')}>Open a room</Button></div>
                </div>
              ) : (
                <ul className="rows dash-pad">
                  {sessions.slice(0, ROOMS_SHOWN).map((s) => (
                    <li key={s.code}>
                      <Link className="rw dash-roomline" to={roomLink(s.code, 'live')}>
                        <span className="dash-roomline-top">
                          <span className="mono muted">{s.code}</span>
                          <span className="strong clip" title={s.title || undefined}>{s.title || 'Untitled room'}</span>
                          <RoomState status={s.status} />
                        </span>
                        <span className="t-meta clip">
                          {`${s.joined ?? 0} joined · ${share(s.accuracy)}`}
                          {dayOf(s.startedAt) && ` · ${dayOf(s.startedAt)}`}
                          {s.banded > 0 && ` · ${s.banded} in support band`}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <div className="split">
            {studentsCard}
            <aside
              className="card sticky dash-insp"
              aria-label={sel && !narrow ? `${sel.fullName || 'Student'} in detail` : 'All your classes'}
            >
              {sel && !narrow ? (
                <>
                  <div className="dash-insp-head">
                    <Avatar name={sel.fullName} size="lg" />
                    <div className="grow">
                      <h3 className="clip">{sel.fullName || 'Unnamed account'}</h3>
                      <div className="t-meta mono">{sel.code}</div>
                    </div>
                    {!sel.active && <Chip tone="line">Deactivated</Chip>}
                    <Tip label="Back to all your classes">
                      <Button variant="ghost" size="sm" icon="close" aria-label="Back to all your classes" onClick={() => setPickedId('')} />
                    </Tip>
                  </div>
                  {detailOf(sel)}
                </>
              ) : (
                <AllClasses counts={counts} bloom={bloom} hasStudents={roster.length > 0} />
              )}
              <div className="card-foot">
                <Button size="sm" variant="ghost" className="dash-tap" icon="analytics" onClick={() => navigate('/analytics')}>Analytics</Button>
              </div>
            </aside>
          </div>
        </>
      )}

      {narrow && (
        <Dialog
          sheet
          open={sheet && Boolean(sel)}
          onOpenChange={setSheet}
          title={sel?.fullName || 'Unnamed account'}
          description={[sel?.code, sel && !sel.active ? 'Deactivated' : null].filter(Boolean).join(' · ') || undefined}
        >
          {sel && <div className="dash-insp is-flat">{detailOf(sel)}</div>}
        </Dialog>
      )}

      <InviteStudents open={inviting} onOpenChange={setInviting} services={services} />
    </AccountShell>
  );
}

/* --------------------------------------------------------------- container */

/* What the invite dialog may call. Named once, so the dialog never reaches for
   the whole api and the dev gallery can stand in for these five. */
const SERVICES = {
  invite: api.invite,
  classroomStatus: api.classroomStatus,
  classroomAuthUrl: api.classroomAuthUrl,
  classroomCourses: api.classroomCourses,
  classroomCourseStudents: api.classroomCourseStudents,
  studentAccommodations: api.studentAccommodations,
  setStudentAccommodations: api.setStudentAccommodations,
};

export default function Overview() {
  const { account, loading: accountLoading } = useViewer();

  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [reloading, setReloading] = useState(false);

  const [details, setDetails] = useState({});
  const asked = useRef(new Set());

  /* One read per signed-in account. It waits for the session to be restored:
     firing before then sends no bearer token, and the server would answer with
     the shared-key professor - a real payload describing somebody else's rows. */
  useEffect(() => {
    if (accountLoading) return undefined;
    let alive = true;
    api.dashboard().then(
      (res) => { if (alive) { setData(res); setError(''); } },
      (err) => { if (alive) setError(err.message || 'The server did not answer.'); },
    );
    return () => { alive = false; };
  }, [accountLoading, account?.id]);

  const refresh = useCallback(async () => {
    setReloading(true);
    try {
      const res = await api.dashboard();
      // The detail belongs to the read it came with.
      asked.current = new Set();
      setDetails({});
      setData(res);
      setError('');
    } catch (err) {
      setError(err.message || 'The server did not answer.');
    } finally {
      setReloading(false);
    }
  }, []);

  const inspect = useCallback((id, force = false) => {
    if (asked.current.has(id) && !force) return;
    asked.current.add(id);
    setDetails((all) => ({ ...all, [id]: { loading: true } }));
    api.analyticsFor(id).then(
      (res) => setDetails((all) => ({ ...all, [id]: { data: res } })),
      (err) => setDetails((all) => ({ ...all, [id]: { error: err.message || 'The server did not answer.' } })),
    );
  }, []);

  return (
    <OverviewView
      loading={accountLoading || (!data && !error)}
      refreshing={reloading}
      error={error}
      data={data}
      onRefresh={refresh}
      details={details}
      onInspect={inspect}
      services={SERVICES}
    />
  );
}
