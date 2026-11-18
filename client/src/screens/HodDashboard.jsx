/**
 * The head of department's screen.
 *
 * It answers three questions, in the order an HOD actually asks them:
 *
 *   1. how is my department doing   the counters, then the Bloom profile
 *   2. who is doing it              the roster, on the dark panel
 *   3. how do I add a professor     an invite, and the code it hands back
 *
 * Until this file the third one existed only as an HTTP route, which meant the
 * one thing an HOD is uniquely allowed to do had no door. That is what this
 * screen is for; the numbers above it are context for the decision.
 *
 * Everything here is read-only except the invite, and that is not this file
 * being timid: ownership.js grants an HOD reads across the department and writes
 * on nothing else, so a button that edited a bank would be refused by the server
 * and would only ever have been a lie on screen.
 *
 * No request from this screen carries an id. GET /api/dashboard shapes itself
 * from the token, so an HOD cannot ask for one professor's dashboard - which is
 * also why the professor rows here come from the department payload rather than
 * from a per-professor read that does not exist.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { api } from '../api.js';
import { useAccount, signOut } from '../auth.js';
import { LEVELS, LABEL } from '../bloom.js';
import Icon from '../ui/Icon.jsx';
import Shell, { Avatar, Card, Empty, NavPill, PageHead, Stat, TailBars } from '../ui/Shell.jsx';
import { HOME_FOR } from './SignIn.jsx';

/** Server accuracies are 0..1, and null means "nothing to average yet". */
const asPct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const DAY = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const FULL = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const DAY_NUM = new Intl.DateTimeFormat(undefined, { day: 'numeric' });

function dateOf(iso, fmt = DAY) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : fmt.format(d);
}

function daysUntil(iso) {
  const d = new Date(iso ?? '');
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.round((d.getTime() - Date.now()) / 86400000));
}

/** Two letters for a bar label — a name does not fit under a 30px bar. */
const initials = (name) =>
  String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase() || '?';

/** Roster narrowing. Each pill carries its own predicate so its count and the
 *  rows it reveals cannot drift apart. */
const FILTERS = [
  { id: 'all', label: 'Everyone', match: () => true },
  { id: 'running', label: 'Has run a session', match: (p) => p.sessions > 0 },
  { id: 'idle', label: 'Not started', match: (p) => p.sessions === 0 },
  { id: 'off', label: 'Disabled', match: (p) => p.active === false },
];

/**
 * An invite code is only useful somewhere else — a message, a slide, a corridor
 * — so copying it has to be one tap. Clipboard access throws outright on an
 * insecure origin, and a button that silently does nothing is worse than one
 * that admits it did nothing.
 */
function CopyButton({ value, className = 'btn sm', label = 'Copy' }) {
  const [said, setSaid] = useState('');
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
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
    <button type="button" className={className} onClick={copy} title={`Copy ${value}`}>
      <Icon name={said === 'Copied' ? 'check' : 'copy'} size={12} />
      {said || label}
    </button>
  );
}

/** The skeleton is shaped like the page it is replacing, so nothing jumps when
 *  the payload lands and nothing has to say the word "loading". */
function Skeleton() {
  return (
    <>
      <div className="grid auto" style={{ marginBottom: 16 }}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="skel" style={{ height: 182, borderRadius: 'var(--r-card)' }} />
        ))}
      </div>
      <div className="skel" style={{ height: 252, borderRadius: 'var(--r-card)', marginBottom: 16 }} />
      <div className="skel" style={{ height: 340, borderRadius: 'var(--r-panel)' }} />
    </>
  );
}

export default function HodDashboard() {
  const navigate = useNavigate();
  const { account, loading: accountLoading } = useAccount();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloads, setReloads] = useState(0);

  const [pickedId, setPickedId] = useState('');
  const [filter, setFilter] = useState('all');

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState('');
  // Codes minted in this browser session. The payload carries no invite list and
  // there is no endpoint that reads one back, so this array is the only record
  // the HOD has until they hand the code over.
  const [minted, setMinted] = useState([]);

  const inviteRef = useRef(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.dashboard().then(
      (res) => { if (alive) { setData(res); setError(''); setLoading(false); } },
      (err) => { if (alive) { setError(err.message || 'The department did not load.'); setLoading(false); } },
    );
    return () => { alive = false; };
  }, [reloads]);

  const openInvite = useCallback(() => {
    setInviteOpen(true);
    setInviteError('');
    // The action sits in the page header and the panel it opens is at the foot of
    // the page; without this the primary button looks like it did nothing. One
    // frame later, so the panel exists to scroll to.
    requestAnimationFrame(() => inviteRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }, []);

  const professors = useMemo(() => data?.professors ?? [], [data]);

  // The payload arrives sorted by sessions run, so the busiest professor is the
  // one already on screen. Filtering never changes it: narrowing the list is a
  // display choice, and it must not silently swap the person being read.
  const sel = useMemo(
    () => professors.find((p) => p.id === pickedId) ?? professors[0] ?? null,
    [professors, pickedId],
  );

  const byId = useMemo(
    () => new Map(professors.map((p) => [String(p.id), p])),
    [professors],
  );

  async function createInvite(event) {
    event.preventDefault();
    setInviteBusy(true);
    setInviteError('');
    try {
      // 'professor' is not a choice offered to the HOD — it is the only role this
      // account may hand out, and the server checks it again against the caller.
      const res = await api.invite({
        role: 'professor',
        fullName: inviteName.trim(),
        email: inviteEmail.trim(),
      });
      // Stamped with who it was meant for. The server echoes back a code, a role
      // and an expiry and nothing else, and an unlabelled column of
      // eight-character codes is unusable an hour later.
      setMinted((list) => [
        { ...res.invite, forName: inviteName.trim(), forEmail: inviteEmail.trim() },
        ...list,
      ]);
      setInviteName('');
      setInviteEmail('');
      setInviteOpen(false);
    } catch (err) {
      setInviteError(err.message || 'The invite was not created.');
    } finally {
      setInviteBusy(false);
    }
  }

  const department = data?.department || account?.department || '';

  /* --- chrome ------------------------------------------------------------ */

  const bar = {
    badge: department ? <span className="barcount">{department}</span> : null,
    // The console is not an HOD's screen to work in — they own no bank and run
    // no room — but it is the only place the department's material can be read,
    // so the way across sits on the same track the console uses to come back.
    nav: (
      <NavPill
        items={[
          { id: 'admin', label: 'Department' },
          { id: 'analytics', label: 'Analytics' },
          { id: 'rooms', label: 'Rooms' },
          { id: 'console', label: 'Teaching console' },
        ]}
        value="admin"
        onChange={(id) => {
          if (id === 'analytics') navigate('/analytics');
          else if (id === 'rooms') navigate('/rooms');
          else if (id === 'console') navigate('/');
        }}
      />
    ),
    right: account ? (
      <>
        <span className="flag neutral" title={`${account.role}${account.code ? ` · ${account.code}` : ''}`}>
          {account.code ?? account.role}
        </span>
        <Avatar name={account.fullName || account.email || 'Head of department'} href="/profile" />
        <button type="button" className="iconbtn" title="Sign out" onClick={() => signOut()}>
          <Icon name="logout" />
        </button>
      </>
    ) : null,
  };

  if (accountLoading || (loading && !error)) {
    return (
      <Shell {...bar}>
        <PageHead
          title={department || 'Your department'}
          sub={<span className="skel" style={{ display: 'block', width: 230, height: 10, borderRadius: 5 }} />}
        />
        <Skeleton />
      </Shell>
    );
  }

  // Signed out, or a build with no accounts configured at all. Either way there
  // is no department to read, and the dashboard behind this door is defined by
  // whose token asked for it.
  if (!account) {
    return (
      <Shell {...bar}>
        <Empty
          icon="lock"
          title="Sign in to open your department"
          action={<a className="btn pri" href="/signin"><Icon name="user" size={13} />Sign in</a>}
        >
          This screen is built from the account asking for it — your professors, your students, your
          department. There is no version of it to show a stranger.
        </Empty>
      </Shell>
    );
  }

  if (error) {
    return (
      <Shell {...bar}>
        <PageHead title={department || 'Your department'} sub="The department did not load." />
        <Empty
          icon="alert"
          title="Could not read the department"
          action={(
            <button type="button" className="btn pri" onClick={() => setReloads((n) => n + 1)}>
              <Icon name="refresh" size={13} />
              Try again
            </button>
          )}
        >
          {error}
        </Empty>
      </Shell>
    );
  }

  // The route decides the shape, not the address bar: a professor who lands here
  // gets their own payload back, and rendering it as a department would invent a
  // hierarchy they do not have.
  if (data?.role !== 'hod') {
    return (
      <Shell {...bar}>
        <Empty
          icon="shield"
          title="This is the head of department's screen"
          action={(
            <a className="btn pri" href={HOME_FOR[data?.role] ?? '/'}>
              Go to your own dashboard
              <Icon name="forward" size={13} />
            </a>
          )}
        >
          Your account is signed in as {data?.role ?? 'something else'}, so the server answered with
          that dashboard instead. Nothing was refused — this page simply is not yours.
        </Empty>
      </Shell>
    );
  }

  /* --- the payload ------------------------------------------------------- */

  const counts = data.counts ?? {};
  const recent = data.recentSessions ?? [];
  // Six rows, in taxonomy order, even on a department that has answered nothing:
  // the profile is the point of the page and a missing chart reads as a bug.
  const bloom = Array.isArray(data.bloom) && data.bloom.length
    ? data.bloom
    : LEVELS.map((level) => ({ level, seen: 0, correct: 0, accuracy: null }));

  const seenTotal = bloom.reduce((n, r) => n + (r.seen ?? 0), 0);
  const busiest = bloom.reduce((best, r) => ((r.seen ?? 0) > (best?.seen ?? -1) ? r : best), null);

  // Newest first out of the server (services/dashboard.js), so reverse it: a row
  // of bars is read left to right and the newest session belongs on the right.
  const timeline = [...recent].reverse();
  const ran = professors.filter((p) => p.sessions > 0).length;
  const lastRun = professors.reduce(
    (latest, p) => (p.lastSessionAt && p.lastSessionAt > (latest ?? '') ? p.lastSessionAt : latest),
    null,
  );

  // A stat with nothing under the number is what makes a dashboard look
  // unfinished, so both tails are drawn from whatever the department has: the
  // roster when the number is per-professor, the session log when it is per-room.
  // The professor slice is the busiest eight, which is the order the server sent.
  const profBars = (pick) =>
    professors.slice(0, 8).map((p) => ({
      label: initials(p.fullName),
      value: pick(p) ?? 0,
      on: p.id === sel?.id,
    }));
  const sessionBars = (pick) =>
    timeline.slice(-10).map((s, i, arr) => ({
      label: dateOf(s.startedAt, DAY_NUM) || String(i + 1),
      value: pick(s) ?? 0,
      on: i === arr.length - 1,
    }));
  // Before the first session there is nothing per-room to draw, so the per-room
  // tails fall back to a flat row of the roster rather than an empty box.
  const roomBars = (pick) => (timeline.length ? sessionBars(pick) : profBars(() => 0));

  const shown = professors.filter((FILTERS.find((f) => f.id === filter) ?? FILTERS[0]).match);
  const bare = professors.length === 0;

  // If the payload ever starts carrying open invites, show them. It does not
  // today, and inventing an endpoint to fetch them would be a screen making a
  // promise the server never agreed to.
  const carried = Array.isArray(data.invites) ? data.invites : [];
  const invites = [...minted, ...carried];
  const fresh = minted[0] ?? null;

  return (
    <Shell {...bar}>
      <PageHead
        title={department || 'Your department'}
        sub={`Head of department · ${plural(counts.professors ?? 0, 'professor')} · ${plural(counts.students ?? 0, 'student')} · you read everything below you and write nothing but invites`}
        actions={(
          <>
            <button type="button" className="btn" onClick={() => setReloads((n) => n + 1)}>
              <Icon name="refresh" size={13} />
              Refresh
            </button>
            <button type="button" className="btn pri" onClick={openInvite}>
              <Icon name="plus" size={13} />
              Invite a professor
            </button>
          </>
        )}
      />

      {bare ? (
        <Empty
          icon="users"
          title={`No professors in ${department || 'this department'} yet`}
          action={(
            <button type="button" className="btn pri" onClick={openInvite}>
              <Icon name="plus" size={13} />
              Invite the first professor
            </button>
          )}
        >
          A department is its professors — they write the banks and run the sessions, and every number
          on this page is the sum of what they do. Invite one and the page starts filling itself in.
        </Empty>
      ) : (
        <>
          {/* 1. How is my department doing. ------------------------------- */}
          <div className="grid auto" style={{ marginBottom: 16 }}>
            <Stat
              label="Professors"
              icon="users"
              value={counts.professors ?? professors.length}
              delta={`${ran} of ${professors.length} have run a session`}
              tail={<TailBars bars={profBars((p) => p.sessions)} />}
            />
            <Stat
              label="Students"
              icon="school"
              value={counts.students ?? 0}
              delta={`${plural(counts.answered ?? 0, 'answer')} recorded across the department`}
              tail={<TailBars bars={profBars((p) => p.students)} />}
            />
            <Stat
              label="Question banks written"
              icon="layers"
              value={counts.contents ?? 0}
              unit="chapters"
              delta={`${plural(counts.questions ?? 0, 'question')} in them`}
              tail={<TailBars bars={profBars((p) => p.questions)} />}
            />
            <Stat
              label="Sessions run"
              icon="broadcast"
              value={counts.sessions ?? 0}
              delta={lastRun ? `most recent on ${dateOf(lastRun)}` : 'no room has been opened yet'}
              tail={<TailBars bars={roomBars((s) => s.joined)} />}
            />
            <Stat
              label="In the support band"
              icon="alert"
              tone="warn"
              value={counts.banded ?? 0}
              // Counted per sitting, not per person: harvest() folds one profile
              // per student per session, so a student who sat four sessions below
              // 40% is four here. Saying "students" would overstate the problem.
              delta="sittings below 40% overall, counted once per session"
              tail={<TailBars bars={roomBars((s) => s.banded)} />}
            />
            <Stat
              label="Department accuracy"
              icon="activity"
              tone={counts.accuracy == null ? '' : counts.accuracy >= 0.7 ? 'ok' : counts.accuracy < 0.4 ? 'bad' : ''}
              value={asPct(counts.accuracy)}
              // The server means each student's own accuracy, averaged. A student
              // who answered forty questions does not outvote one who answered
              // four, and the number on screen has to say which one it is.
              delta="the average of each student's own accuracy"
              tail={<TailBars bars={roomBars((s) => Math.round((s.accuracy ?? 0) * 100))} />}
            />
          </div>

          {/* The chart the whole page exists for: not how much the department
              did, but at which levels it is able to think. */}
          <Card className="pad-lg" style={{ marginBottom: 16 }}>
            <div className="cardhead">
              <h2>The department&apos;s cognitive profile</h2>
              <span className="sub">
                {seenTotal
                  ? `${seenTotal} answers across the six levels · lime marks where the department is spending its questions`
                  : 'written by the classroom, one session at a time'}
              </span>
            </div>

            {seenTotal === 0 ? (
              <Empty
                icon="chart"
                title="No answers yet"
                action={(
                  <button type="button" className="btn pri" onClick={openInvite}>
                    <Icon name="plus" size={13} />
                    Invite a professor
                  </button>
                )}
              >
                Every level fills in from live sessions, so this stays empty until a room has run.
                There is nothing to estimate here — the profile is measured or it is absent.
              </Empty>
            ) : (
              <>
                <div className="eyebrow">Share of every answer, by level</div>
                <div className="dist" style={{ marginTop: 9 }}>
                  {bloom.map((r) => (r.seen > 0
                    ? <i key={r.level} className={`swatch ${r.level}`} style={{ flex: r.seen }} />
                    : null))}
                </div>

                <div className="eyebrow" style={{ marginTop: 26 }}>Accuracy at each level</div>
                <div className="bars" style={{ marginTop: 12 }}>
                  {bloom.map((r) => {
                    const here = busiest?.level === r.level && r.seen > 0;
                    return (
                      <div key={r.level}>
                        <div className="lab">{asPct(r.accuracy)}</div>
                        <div className={`track${here ? ' cur' : ''}`}>
                          <i
                            className={`swatch ${r.level}`}
                            style={{ height: `${Math.round((r.accuracy ?? 0) * 100)}%` }}
                          />
                        </div>
                        <div className={`nm${here ? ' cur' : ''}`}>{LABEL[r.level] ?? r.level}</div>
                        <div className="lab" style={{ color: 'var(--ink-5)' }}>
                          {r.seen ? `${r.correct}/${r.seen}` : '—'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </Card>

          {/* 2. Who are my professors. ------------------------------------ */}
          {professors.length > 1 && (
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
                  <b>{professors.filter(f.match).length}</b>
                </button>
              ))}
            </div>
          )}

          <div className="panel">
            <div className="panel-head">
              <span className="t">Professors</span>
              <span className="panel-sub">
                {shown.length === professors.length
                  ? `${professors.length} in the department · most sessions first`
                  : `${shown.length} of ${professors.length} shown`}
              </span>
              <span className="grow" />
              <button type="button" className="btn on-d" onClick={openInvite}>
                <Icon name="plus" size={13} />
                Invite a professor
              </button>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' }}>
              <div
                style={{
                  flex: '1 1 260px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4,
                  maxHeight: 460, overflowY: 'auto',
                }}
              >
                {shown.length === 0 ? (
                  <div className="d-empty">
                    <b>Nobody matches that filter</b>
                    <span>Switch back to Everyone — the roster itself has not changed.</span>
                  </div>
                ) : shown.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="d-row"
                    aria-selected={p.id === sel?.id}
                    onClick={() => setPickedId(p.id)}
                  >
                    <Avatar name={p.fullName} size="sm" className="on-d" />
                    <span className="t">
                      <b>{p.fullName}</b>
                      <span>
                        {p.code} · {plural(p.sessions, 'session')} · {plural(p.students, 'student')}
                        {p.active === false ? ' · disabled' : ''}
                      </span>
                    </span>
                    <span className="mono" style={{ fontSize: 12, fontWeight: 700 }}>
                      {asPct(p.accuracy)}
                    </span>
                  </button>
                ))}
              </div>

              {sel && (
                <div className="accent" style={{ flex: '2 1 360px', minWidth: 0 }}>
                  <div className="k">Selected professor</div>
                  <div className="row" style={{ gap: 12, marginTop: 8 }}>
                    <Avatar name={sel.fullName} size="lg" className="on-d" />
                    <div className="grow">
                      <div style={{ font: '800 20px/1.2 var(--sans)', letterSpacing: '-0.02em' }}>
                        {sel.fullName}
                      </div>
                      {sel.email && <div className="k" style={{ marginTop: 5 }}>{sel.email}</div>}
                    </div>
                    {sel.active === false && <span className="k">account disabled</span>}
                  </div>

                  {/* The code, not the name, is how this person is referred to on
                      every other screen in the product — the roster, an export, a
                      session's owner. It gets the largest type on the card. */}
                  <div className="row" style={{ gap: 10, marginTop: 16 }}>
                    <span
                      className="mono"
                      style={{ fontSize: 22, fontWeight: 800, letterSpacing: '0.1em', lineHeight: 1 }}
                    >
                      {sel.code}
                    </span>
                    <CopyButton value={sel.code} className="btn on-d sm" />
                    <span className="k">BloomLoop code</span>
                  </div>

                  <div className="tiles" style={{ marginTop: 16 }}>
                    <div className="accent-tile">
                      <b>{sel.students}<Icon name="users" size={11} /></b>
                      <span>Students reporting to them</span>
                    </div>
                    <div className="accent-tile">
                      <b>{sel.contents}<Icon name="deck" size={11} /></b>
                      <span>Chapters loaded</span>
                    </div>
                    <div className="accent-tile">
                      <b>{sel.questions}<Icon name="layers" size={11} /></b>
                      <span>Questions written</span>
                    </div>
                    <div className="accent-tile">
                      <b>{sel.sessions}<Icon name="broadcast" size={11} /></b>
                      <span>Sessions run</span>
                    </div>
                    <div className="accent-tile">
                      <b>{asPct(sel.accuracy)}<Icon name="activity" size={11} /></b>
                      <span>Their classes&apos; accuracy</span>
                    </div>
                    <div className="accent-tile">
                      <b>{sel.lastSessionAt ? dateOf(sel.lastSessionAt) : 'Never'}<Icon name="clock" size={11} /></b>
                      <span>Last session</span>
                    </div>
                  </div>

                  {sel.sessions === 0 && (
                    <div className="said" style={{ marginTop: 16 }}>
                      <span style={{ color: 'var(--on-d)' }}>
                        Nothing has been run from this account yet. A bank and a roster can both be in
                        place and still show no profile — a live session is what writes one.
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* 3. How do I add a professor. ----------------------------------- */}
      <section ref={inviteRef} style={{ marginTop: 16 }}>
        <Card className="pad-lg">
          <div className="cardhead">
            <h2>Add a professor</h2>
            <span className="sub">
              An HOD may only invite a professor. The server decides that from your account, not from
              this form.
            </span>
            <span className="grow" />
            {!inviteOpen && (
              <button type="button" className="btn pri" onClick={openInvite}>
                <Icon name="plus" size={13} />
                {invites.length ? 'Invite another' : 'Invite a professor'}
              </button>
            )}
          </div>

          {/* The sentence that turns a code into a workflow. Without it the
              handover is eight characters and a guess. */}
          <div className="said">
            <span>
              The code is the whole handover: the professor types it into the sign-up form, and their
              role, department and reporting line are taken from the invite rather than from anything
              they fill in.
            </span>
          </div>

          {inviteError && (
            <div className="note bad" role="alert" style={{ marginTop: 14 }}>
              <Icon name="alert" size={15} />
              <span>{inviteError}</span>
            </div>
          )}

          {inviteOpen && (
            <form onSubmit={createInvite} style={{ marginTop: 18 }}>
              <div className="grid auto-lg">
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="invite-name">Their name (optional)</label>
                  <input
                    id="invite-name"
                    autoComplete="off"
                    disabled={inviteBusy}
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                  />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="invite-email">Their email (optional)</label>
                  <input
                    id="invite-email"
                    type="email"
                    autoComplete="off"
                    disabled={inviteBusy}
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                  />
                </div>
              </div>

              {/* Both fields ride along on the invite row, but sign-up reads the
                  name and address the professor types when they redeem it. They
                  label the code while it is in your hands; they do not bind it. */}
              <div className="hint">
                Neither field is checked when the code is redeemed — they are here so you can tell two
                open codes apart.
              </div>

              <div className="row" style={{ gap: 8, marginTop: 16 }}>
                <button type="submit" className="btn pri" disabled={inviteBusy}>
                  {inviteBusy
                    ? <><span className="spin" />Creating the invite…</>
                    : <><Icon name="key" size={13} />Create the invite</>}
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  disabled={inviteBusy}
                  onClick={() => { setInviteOpen(false); setInviteError(''); }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {fresh && (
            <div
              style={{
                marginTop: 18, padding: '20px 22px', borderRadius: 'var(--r-card)',
                background: 'var(--brand-soft-2)', border: '1px solid var(--brand-soft)',
              }}
            >
              <div className="eyebrow">
                {fresh.forName || fresh.forEmail
                  ? `Invite for ${fresh.forName || fresh.forEmail}`
                  : 'Professor invite'}
              </div>
              <div className="row" style={{ gap: 14, marginTop: 12 }}>
                <span
                  className="mono"
                  style={{
                    fontSize: 'clamp(30px, 6vw, 44px)', fontWeight: 800, lineHeight: 1,
                    letterSpacing: '0.14em', color: 'var(--brand-deep)',
                  }}
                >
                  {fresh.code}
                </span>
                <CopyButton value={fresh.code} className="btn pri sm" label="Copy the code" />
              </div>
              <div className="hint">
                Single use. Expires {dateOf(fresh.expiresAt, FULL)}
                {daysUntil(fresh.expiresAt) != null && ` · ${plural(daysUntil(fresh.expiresAt), 'day')} from now`}.
                They redeem it at <a href="/signup">/signup</a>.
              </div>
            </div>
          )}

          {invites.length > 1 && (
            <div style={{ marginTop: 22 }}>
              <div className="eyebrow">Also issued</div>
              {invites.slice(1).map((inv) => (
                <div
                  key={inv.code}
                  className="row"
                  style={{ gap: 10, padding: '11px 0', borderTop: '1px solid var(--line-2)' }}
                >
                  <span className="mono" style={{ fontSize: 14, fontWeight: 800, letterSpacing: '0.1em' }}>
                    {inv.code}
                  </span>
                  <span className="flag neutral">{inv.role}</span>
                  <span className="grow muted" style={{ fontSize: 12, fontWeight: 600 }}>
                    {inv.forName || inv.forEmail || 'no label'}
                  </span>
                  <span className="muted nowrap" style={{ fontSize: 11.5, fontWeight: 600 }}>
                    expires {dateOf(inv.expiresAt, FULL)}
                  </span>
                  <CopyButton value={inv.code} className="btn sm" />
                </div>
              ))}
            </div>
          )}

          {minted.length > 0 && (
            <div className="note warn" style={{ marginTop: 16 }}>
              <Icon name="alert" size={15} />
              <span>
                This list is only what you created here. Nothing reads open invites back out of the
                server, so a code you leave this page without copying is gone — issue a fresh one.
              </span>
            </div>
          )}
        </Card>
      </section>

      {/* The department's recent rooms, each one attributed. ------------- */}
      {!bare && (
        <Card className="pad-lg" style={{ marginTop: 16 }}>
          <div className="cardhead">
            <h2>Recent sessions</h2>
            <span className="sub">
              {recent.length ? `the last ${recent.length}, newest first` : 'nothing has been run yet'}
            </span>
          </div>

          {recent.length === 0 ? (
            <Empty icon="broadcast" title="No rooms have been opened">
              Sessions are run by professors, never by you — this fills in the first time one of them
              puts a room code on the board.
            </Empty>
          ) : recent.map((s, i) => {
            const owner = byId.get(String(s.ownerId));
            return (
              <div
                key={s.code}
                className="row"
                style={{ gap: 10, padding: '11px 0', borderTop: i ? '1px solid var(--line-2)' : 'none' }}
              >
                <span className="mono" style={{ fontSize: 12.5, fontWeight: 700 }}>{s.code}</span>
                <span className="grow" style={{ fontSize: 13, fontWeight: 600 }}>
                  {s.title || 'Untitled room'}
                </span>
                <span className="row" style={{ gap: 7 }}>
                  {owner
                    ? (
                      <>
                        <Avatar name={owner.fullName} size="sm" />
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-3)' }}>
                          {owner.fullName}
                        </span>
                      </>
                    )
                    : <span className="muted" style={{ fontSize: 12 }}>owner not in the roster</span>}
                </span>
                <span className="flag neutral nowrap">{plural(s.joined, 'student')}</span>
                {s.banded > 0 && <span className="flag nowrap">{s.banded} in band</span>}
                <span className="mono" style={{ fontSize: 12.5, fontWeight: 700 }}>{asPct(s.accuracy)}</span>
                {s.status === 'open' && <span className="flag ok">live</span>}
                <span className="muted nowrap" style={{ fontSize: 11.5, fontWeight: 600 }}>
                  {dateOf(s.startedAt) || '—'}
                </span>
              </div>
            );
          })}
        </Card>
      )}
    </Shell>
  );
}
