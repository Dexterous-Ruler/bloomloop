/**
 * The head of department's home. The page is the list of professors.
 *
 * Above the list: the few figures that describe the whole department and the
 * levels its answers landed on. Beside it: whichever professor is selected, in
 * detail. The one thing an HOD writes is an invite, so that is the one primary
 * button, and the code it produces is the whole handover.
 *
 * Everything else is read-only on purpose: the server grants an HOD reads
 * across the department and writes on nothing but invites, so a button that
 * edited a bank here would only ever be refused.
 *
 * GET /api/dashboard carries no id - the token picks the department. The
 * selected professor's level detail is GET /api/analytics/:id, which the
 * server checks against the same reporting line.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { api } from '../lib/api.js';
import { LABEL } from '../lib/bloom.js';
import { HOME_FOR, ROLE_LABEL } from '../lib/routes.js';
import AccountShell from '../shell/AccountShell.jsx';
import { useViewer } from '../shell/viewer.js';
import { Avatar, Button, Chip, Dialog, Empty, Field, Fig, Icon, Note, Segmented, Tip } from '../ui/index.jsx';
import { LevelBars } from '../ui/viz.jsx';
import {
  big, busiest, byLevel, CodeBlock, CopyButton, dateOf, dayOf, daysUntil, Facts, plural, RoomState, share, useMedia,
} from './dashParts.jsx';

/* Each filter carries its own test, so its count and the rows it shows cannot
   drift apart. */
const FILTERS = [
  { id: 'all', label: 'Everyone', match: () => true },
  { id: 'running', label: 'Has run a room', match: (p) => p.sessions > 0 },
  { id: 'idle', label: 'Not started', match: (p) => p.sessions === 0 },
  { id: 'off', label: 'Disabled', match: (p) => p.active === false },
];

/* ------------------------------------------------------------------ pieces */

function Skeleton() {
  return (
    <div className="stack stack-5" aria-busy="true">
      <div className="stack stack-2">
        <div className="skel" style={{ height: 32, width: 320, maxWidth: '100%' }} />
        <div className="skel" style={{ height: 16, width: 460, maxWidth: '100%' }} />
      </div>
      <div className="cluster cluster-5">
        {[72, 88, 80, 96, 104].map((w, i) => <div key={i} className="skel" style={{ height: 48, width: w }} />)}
      </div>
      <div className="split">
        <div className="skel" style={{ height: 420, borderRadius: 'var(--r-3)' }} />
        <div className="skel" style={{ height: 420, borderRadius: 'var(--r-3)' }} />
      </div>
    </div>
  );
}

/** One of the department's rooms, as a line in the inspector. */
function RoomLine({ room, owner }) {
  return (
    <li className="rw dash-roomline">
      <span className="dash-roomline-top">
        <span className="mono muted">{room.code}</span>
        <span className="strong clip" title={room.title || undefined}>{room.title || 'Untitled room'}</span>
        <RoomState status={room.status} />
      </span>
      <span className="t-meta clip">
        {owner !== undefined && `${owner || 'Owner not on the roster'} · `}
        {`${room.joined ?? 0} joined · ${share(room.accuracy)}`}
        {dayOf(room.startedAt) && ` · ${dayOf(room.startedAt)}`}
        {/* One professor's own list has the room for it; the department's does not. */}
        {owner === undefined && room.banded > 0 && ` · ${room.banded} in support band`}
      </span>
    </li>
  );
}

/**
 * Nobody selected: the department as a whole stands in the inspector, with the
 * one chart this page is for - not how much the department did, but at which
 * levels it is able to think.
 */
function WholeDepartment({ bloom, recent, names }) {
  const seen = bloom.reduce((n, r) => n + (r.seen ?? 0), 0);
  const peak = busiest(bloom);
  return (
    <>
      <div className="dash-insp-head">
        <span className="avatar avatar-lg"><Icon name="building" size={18} /></span>
        <div className="grow">
          <h3>Whole department</h3>
          <div className="t-meta">Select a professor to read their classes.</div>
        </div>
      </div>

      <div className="dash-sec">
        <div className="cluster between">
          <span className="t-label">Accuracy by level</span>
          <span className="t-meta">correct of answered</span>
        </div>
        <div className="dash-levels"><LevelBars byLevel={byLevel(bloom)} current={seen ? peak?.level : undefined} height={40} /></div>
        <p className="t-meta">
          {seen
            ? `Outlined: ${LABEL[peak.level]}, where most of the department's questions landed.`
            : 'Fills in from live rooms. Nothing here is estimated.'}
        </p>
      </div>

      <div className="dash-sec">
        <div className="t-label">Recent rooms</div>
        {recent.length === 0 ? (
          <p className="hint">
            No room has been opened yet. Rooms are run by professors, so this fills in the first time one of them puts
            a code on the board.
          </p>
        ) : (
          <ul className="rows dash-flush">
            {recent.slice(0, 4).map((r) => <RoomLine key={r.code} room={r} owner={names.get(String(r.ownerId)) ?? ''} />)}
          </ul>
        )}
      </div>
    </>
  );
}

/**
 * One professor in detail. `detail` is { loading, error, data } for
 * GET /api/analytics/:id; until it lands the facts the dashboard already
 * carried are shown, and the level profile holds its shape.
 */
function ProfessorDetail({ professor: p, detail, recent, onRetry }) {
  const d = detail?.data;
  // The analytics timeline is every room this professor ran, oldest first. The
  // dashboard only carries the department's last twelve, so it is the stand-in
  // while the fuller read is out.
  const rooms = d ? [...(d.timeline ?? [])].reverse().slice(0, 4) : recent.slice(0, 4);
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
        <div className="cluster between nowrap-flex">
          <div className="grow">
            <div className="t-meta">BloomLoop code</div>
            <div className="mono strong">{p.code}</div>
          </div>
          <CopyButton value={p.code} className="dash-tap" />
        </div>
      </div>

      <div className="dash-sec">
        <div className="t-label">Their classes, by level</div>
        {p.sessions === 0 ? (
          <p className="said">
            Nothing has been run from this account yet. A bank and a roster can both be in place and still show no
            profile: a live room is what writes one.
          </p>
        ) : detail?.error ? (
          <Note tone="bad">
            The level detail did not load: {detail.error}{' '}
            <button type="button" className="link dash-linkbtn" onClick={onRetry}>Try again</button>
          </Note>
        ) : !d ? (
          <div className="skel" style={{ height: 184 }} />
        ) : (
          <>
            <div className="dash-levels"><LevelBars byLevel={byLevel(d.bloom)} current={busiest(d.bloom)?.level} height={40} /></div>
            {reading && <p className="t-meta">{reading}</p>}
          </>
        )}
      </div>

      <div className="dash-sec">
        <Facts
          items={[
            ['Chapters loaded', big(p.contents)],
            ['Answers recorded', d ? big(d.counts?.answered) : '—'],
            ['Students seen in their rooms', d ? big(d.counts?.students) : '—'],
            ['Last room', p.lastSessionAt ? dateOf(p.lastSessionAt) : 'Never'],
          ]}
        />
      </div>

      {rooms.length > 0 && (
        <div className="dash-sec">
          <div className="t-label">Recent rooms</div>
          <ul className="rows dash-flush">
            {rooms.map((r) => <RoomLine key={r.code} room={r} />)}
          </ul>
        </div>
      )}
    </>
  );
}

/**
 * Invite a professor. The form, then the code it produced: the code is shown
 * large with what to tell the professor, because eight characters and a guess
 * is not a handover.
 */
function InviteProfessor({ open, onOpenChange, onInvite }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [made, setMade] = useState(null);

  // Opening it again is asking for a new invite, not for the last one back.
  useEffect(() => {
    if (open) { setMade(null); setError(''); }
  }, [open]);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      setMade(await onInvite({ fullName: name, email }));
      setName('');
      setEmail('');
    } catch (err) {
      setError(err.message || 'The invite was not created.');
    } finally {
      setBusy(false);
    }
  }

  const days = made ? daysUntil(made.expiresAt) : null;
  const where = typeof window === 'undefined' ? '/signup' : `${window.location.host}/signup`;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      locked={busy}
      title={made ? 'Hand this code over' : 'Invite a professor'}
      description={made
        ? 'Copy it before you close this. It stays listed on this page only until you leave.'
        : 'You get a single-use code to pass on. A professor is the only role you can invite.'}
      footer={made ? (
        <div className="dash-acts">
          <Button onClick={() => setMade(null)}>Invite another</Button>
          <Button variant="primary" onClick={() => onOpenChange(false)}>Done</Button>
        </div>
      ) : (
        <div className="dash-acts">
          <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="dash-invite-prof" variant="primary" icon="key" busy={busy}>Create the invite</Button>
        </div>
      )}
    >
      {made ? (
        <div className="stack">
          <CodeBlock
            code={made.code}
            label={made.forName || made.forEmail ? `Invite for ${made.forName || made.forEmail}` : 'Professor invite'}
          />
          <p className="said">
            Tell them to open <span className="mono">{where}</span> and enter this code with their own name, email and
            a password. Their role, department and reporting line come from the invite, not from anything they type.
          </p>
          <p className="hint">
            Single use.{dateOf(made.expiresAt) && ` Expires ${dateOf(made.expiresAt)}`}
            {days != null && `, ${plural(days, 'day')} from now`}.
          </p>
        </div>
      ) : (
        <form id="dash-invite-prof" className="stack" onSubmit={submit}>
          {error && <Note tone="bad" role="alert">{error}</Note>}
          <div className="grid-2">
            <Field label="Their name" optional htmlFor="dash-prof-name">
              <input id="dash-prof-name" className="input" autoFocus autoComplete="off" disabled={busy} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Their email" optional htmlFor="dash-prof-email">
              <input id="dash-prof-email" className="input" type="email" autoComplete="off" disabled={busy} value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
          </div>
          <p className="hint">
            Neither is checked when the code is redeemed. They label the code so you can tell two open ones apart.
          </p>
        </form>
      )}
    </Dialog>
  );
}

/** Codes created in this visit. A quiet list, not a second dashboard. */
function PendingInvites({ invites }) {
  return (
    <section className="stack stack-3">
      <div className="stack stack-1">
        <h4>Invites created in this visit</h4>
        <p className="hint measure">
          Only codes created in this visit are listed: nothing reads open invites back from the server. Copy a code
          before you leave this page, or issue a fresh one.
        </p>
      </div>
      <ul className="rows">
        {invites.map((inv) => (
          <li key={inv.code} className="rw">
            <span className="mono strong">{inv.code}</span>
            <span className="rw-main">
              <span className="clip dash-block">{inv.forName || inv.forEmail || 'No label'}</span>
              {dateOf(inv.expiresAt) && <span className="t-meta">Expires {dateOf(inv.expiresAt)}</span>}
            </span>
            <CopyButton value={inv.code} className="dash-tap" />
          </li>
        ))}
      </ul>
    </section>
  );
}

/* -------------------------------------------------------------------- view */

/**
 * @param loading    the first read is still out
 * @param data       GET /api/dashboard as an HOD, or null before the first read
 * @param invites    codes created in this visit, newest first
 * @param onInvite   ({ fullName, email }) => Promise<invite>
 * @param details    { [professorId]: { loading, error, data } } from GET /api/analytics/:id
 * @param onInspect  (professorId, force?) => void - asks for that detail
 */
export function DepartmentView({
  loading, error, data, refreshing, onRefresh, invites = [], onInvite, details = {}, onInspect,
}) {
  const { account } = useViewer();
  const navigate = useNavigate();
  // Under this width the inspector cannot sit beside the list, so it opens
  // over it instead of landing somewhere below the fold.
  const narrow = useMedia('(max-width: 1080px)');

  const [pickedId, setPickedId] = useState('');
  const [filter, setFilter] = useState('all');
  const [inviting, setInviting] = useState(false);
  const [sheet, setSheet] = useState(false);

  const professors = useMemo(() => data?.professors ?? [], [data]);

  // Nobody is selected until someone is picked: the inspector then holds the
  // department as a whole. Filtering never changes the selection - narrowing
  // the list is a display choice and must not swap the person being read.
  const sel = useMemo(() => professors.find((p) => p.id === pickedId) ?? null, [professors, pickedId]);
  const names = useMemo(() => new Map(professors.map((p) => [String(p.id), p.fullName])), [professors]);

  const inspected = sel && (!narrow || sheet) ? sel.id : null;
  useEffect(() => {
    if (inspected != null && !details[inspected]) onInspect?.(inspected);
  }, [inspected, details, onInspect]);

  const department = data?.department || account?.department || '';
  const crumb = (
    <>
      <span>Department</span>
      {account?.code && <span className="mono">{account.code}</span>}
    </>
  );

  if (loading) {
    return <AccountShell current="home" crumb={crumb}><Skeleton /></AccountShell>;
  }

  // Signed out, or a build with no accounts at all. This screen is built from
  // the account asking for it, so there is no version to show a stranger.
  if (!account) {
    return (
      <AccountShell current="home" crumb={crumb}>
        <Empty icon="lock" title="Sign in to open your department" action={<Link className="btn btn-primary" to="/signin">Sign in</Link>}>
          This screen is your professors, your students, your department. It is drawn from the account that asks for it.
        </Empty>
      </AccountShell>
    );
  }

  if (error && !data) {
    return (
      <AccountShell current="home" crumb={crumb}>
        <Empty
          icon="alert"
          title="The department did not load"
          action={<Button variant="primary" icon="refresh" busy={refreshing} onClick={onRefresh}>Try again</Button>}
        >
          {error}
        </Empty>
      </AccountShell>
    );
  }

  // The token decides the shape, not the address bar. A professor who lands
  // here got their own payload back; drawing it as a department would invent a
  // hierarchy they do not have.
  if (data?.role !== 'hod') {
    return (
      <AccountShell current="home" crumb={crumb}>
        <Empty
          icon="shield"
          title="This is the head of department's screen"
          action={<Link className="btn btn-primary" to={HOME_FOR[data?.role] ?? '/'}>Go to your own home</Link>}
        >
          You are signed in as {ROLE_LABEL[data?.role]?.toLowerCase() ?? data?.role ?? 'something else'}, so the
          server answered with that home instead. Nothing was refused.
        </Empty>
      </AccountShell>
    );
  }

  const counts = data.counts ?? {};
  const bloom = Array.isArray(data.bloom) ? data.bloom : [];
  const recent = data.recentSessions ?? [];
  const shown = professors.filter((FILTERS.find((f) => f.id === filter) ?? FILTERS[0]).match);
  const bare = professors.length === 0;

  const pick = (id) => {
    setPickedId(id);
    if (narrow) setSheet(true);
  };

  const detailOf = (p) => (
    <ProfessorDetail
      professor={p}
      detail={details[p.id]}
      recent={recent.filter((s) => String(s.ownerId) === String(p.id))}
      onRetry={() => onInspect?.(p.id, true)}
    />
  );

  return (
    <AccountShell current="home" crumb={crumb}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Head of department</div>
          <h1 className="wrap-any">{department || 'Your department'}</h1>
          <p className="t-lead lead">
            {bare
              ? 'Nobody reports to you yet. The one thing you create here is an invite, and everything else on this page comes from the professors who redeem one.'
              : (
                <>
                  {plural(counts.professors ?? professors.length, 'professor')}, {plural(counts.students, 'student')},{' '}
                  {plural(counts.questions, 'question')} across {plural(counts.contents, 'chapter')}. You can read all
                  of it. The one thing you create here is an invite.
                </>
              )}
          </p>
        </div>
        <div className="acts dash-headacts">
          <Tip label="Read the department again">
            <Button variant="ghost" className="dash-tap" icon="refresh" busy={refreshing} aria-label="Read the department again" onClick={onRefresh} />
          </Tip>
          {/* With nobody on the page yet, the empty state below carries this. */}
          {!bare && <Button variant="primary" className="dash-tap" icon="invite" onClick={() => setInviting(true)}>Invite a professor</Button>}
        </div>
      </div>

      {error && (
        <Note tone="bad" style={{ marginBottom: 24 }}>The figures below are the last ones that loaded: {error}</Note>
      )}

      {bare ? (
        <div className="stack stack-5">
          <div className="card">
            <Empty
              icon="users"
              title={`No professors in ${department || 'this department'} yet`}
              action={<Button variant="primary" className="dash-tap" icon="invite" onClick={() => setInviting(true)}>Invite the first professor</Button>}
            >
              Professors write the question banks and run the rooms, and every figure on this page is the sum of what
              they do. Invite one and it starts filling in.
            </Empty>
          </div>
          {invites.length > 0 && <PendingInvites invites={invites} />}
        </div>
      ) : (
        <>
          <section className="dash-strip" aria-label="The department in figures">
            <div className="figs dash-figs">
              <Fig value={big(counts.students)} label="Students" />
              <Fig value={big(counts.sessions)} label="Rooms run" />
              <Fig value={big(counts.answered)} label="Answers" />
              <Fig value={share(counts.accuracy)} label="Mean accuracy" />
              <Fig value={big(counts.banded)} label="In the support band" />
            </div>
            <p className="t-meta">
              Accuracy is the mean of each student&rsquo;s own, so forty answers do not outvote four. The support band
              counts sittings under 40%, once per room, not people.
            </p>
          </section>

          <div className="split">
            <div className="stack stack-5">
              <section className="card">
                <div className="card-head dash-wrap">
                  <h3>Professors</h3>
                  {professors.length > 1 && (
                    <div className="dash-segbox">
                      <Segmented
                        label="Which professors to show"
                        value={filter}
                        onChange={setFilter}
                        options={FILTERS.map((f) => ({ id: f.id, label: f.label, count: professors.filter(f.match).length }))}
                      />
                    </div>
                  )}
                </div>

                {shown.length === 0 ? (
                  <Empty
                    icon="filter"
                    title="Nobody matches that filter"
                    action={<Button className="dash-tap" onClick={() => setFilter('all')}>Show everyone</Button>}
                  >
                    The roster itself has not changed.
                  </Empty>
                ) : (
                  <table className="tbl dash-tbl">
                    <thead>
                      <tr>
                        <th>Professor</th>
                        <th className="r">Rooms run</th>
                        <th className="r">Students</th>
                        <th className="r">Questions</th>
                        <th className="r">Accuracy</th>
                        <th className="r">Last room</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((p) => (
                        <tr
                          key={p.id}
                          className="is-click"
                          aria-selected={!narrow && p.id === sel?.id ? 'true' : undefined}
                          onClick={() => pick(p.id)}
                        >
                          <td className="c-main">
                            <div className="dash-who">
                              <button
                                type="button"
                                className="dash-rowbtn"
                                aria-label={`${p.fullName || 'Unnamed account'}, open details`}
                                onClick={(e) => { e.stopPropagation(); pick(p.id); }}
                              >
                                <Avatar name={p.fullName} />
                                <span className="dash-who-txt">
                                  <span className="strong clip">{p.fullName || 'Unnamed account'}</span>
                                  <span className="t-meta mono">{p.code}</span>
                                </span>
                              </button>
                              {p.active === false && <Chip tone="line">Disabled</Chip>}
                            </div>
                          </td>
                          <td className="r" data-label="Rooms run">{big(p.sessions)}</td>
                          <td className="r" data-label="Students">{big(p.students)}</td>
                          <td className="r" data-label="Questions">{big(p.questions)}</td>
                          <td className="r" data-label="Accuracy">{share(p.accuracy)}</td>
                          <td className="r nowrap" data-label="Last room">{p.lastSessionAt ? dayOf(p.lastSessionAt) : 'Never'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>

              {invites.length > 0 && <PendingInvites invites={invites} />}
            </div>

            <aside
              className="card sticky dash-insp"
              aria-label={sel && !narrow ? `${sel.fullName || 'Professor'} in detail` : 'The whole department'}
            >
              {sel && !narrow ? (
                <>
                  <div className="dash-insp-head">
                    <Avatar name={sel.fullName} size="lg" />
                    <div className="grow">
                      <h3 className="clip">{sel.fullName || 'Unnamed account'}</h3>
                      {sel.email && <div className="t-meta clip">{sel.email}</div>}
                    </div>
                    {sel.active === false && <Chip tone="line">Disabled</Chip>}
                    <Tip label="Back to the whole department">
                      <Button variant="ghost" size="sm" icon="close" aria-label="Back to the whole department" onClick={() => setPickedId('')} />
                    </Tip>
                  </div>
                  {detailOf(sel)}
                </>
              ) : (
                <WholeDepartment bloom={bloom} recent={recent} names={names} />
              )}
              <div className="card-foot">
                <Button size="sm" variant="ghost" className="dash-tap" icon="rooms" onClick={() => navigate('/rooms')}>All rooms</Button>
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
          description={[sel?.email, sel?.active === false ? 'Account disabled' : null].filter(Boolean).join(' · ') || undefined}
        >
          {sel && <div className="dash-insp is-flat">{detailOf(sel)}</div>}
        </Dialog>
      )}

      <InviteProfessor open={inviting} onOpenChange={setInviting} onInvite={onInvite} />
    </AccountShell>
  );
}

/* --------------------------------------------------------------- container */

export default function Department() {
  const { account, loading: accountLoading } = useViewer();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloads, setReloads] = useState(0);

  // Codes created in this visit. The payload carries no invite list and no
  // route reads one back, so this is the only record until a code is handed over.
  const [minted, setMinted] = useState([]);

  const [details, setDetails] = useState({});
  const asked = useRef(new Set());

  useEffect(() => {
    if (accountLoading) return undefined;
    let alive = true;
    setLoading(true);
    api.dashboard().then(
      (res) => { if (alive) { setData(res); setError(''); setLoading(false); } },
      (err) => { if (alive) { setError(err.message || 'The department did not load.'); setLoading(false); } },
    );
    return () => { alive = false; };
  }, [accountLoading, account?.id, reloads]);

  const refresh = useCallback(() => {
    // The detail belongs to the read it came with.
    asked.current = new Set();
    setDetails({});
    setReloads((n) => n + 1);
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

  const invite = useCallback(async ({ fullName, email }) => {
    const forName = String(fullName ?? '').trim();
    const forEmail = String(email ?? '').trim();
    // 'professor' is not a choice offered here: it is the only role this
    // account may hand out, and the server checks it against the caller again.
    const res = await api.invite({ role: 'professor', fullName: forName, email: forEmail });
    // Stamped with who it was meant for. The server answers with a code, a role
    // and an expiry, and a bare column of codes is unusable an hour later.
    const made = { ...res.invite, forName, forEmail };
    setMinted((list) => [made, ...list]);
    return made;
  }, []);

  // If the payload ever starts carrying open invites, show them. It does not
  // today, and a screen must not invent an endpoint the server never agreed to.
  const carried = Array.isArray(data?.invites) ? data.invites : [];

  return (
    <DepartmentView
      loading={accountLoading || (loading && !data && !error)}
      refreshing={loading}
      error={error}
      data={data}
      onRefresh={refresh}
      invites={[...minted, ...carried]}
      onInvite={invite}
      details={details}
      onInspect={inspect}
    />
  );
}
