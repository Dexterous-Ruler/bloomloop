/**
 * The head of department's home.
 *
 * It reads top to bottom: the brief (what the department did, in a sentence,
 * with the figures behind it), where its answers land on the six levels - the
 * whole department first, each professor beside it on request - and then the
 * professors themselves, with whichever one is selected open beside the list.
 * The one thing an HOD writes is an invite, so that is the one primary button,
 * and the code it produces is the whole handover.
 *
 * Everything else is read-only on purpose: the server grants an HOD reads
 * across the department and writes on nothing but invites, so a button that
 * edited a bank here would only ever be refused.
 *
 * GET /api/dashboard carries no id - the token picks the department. A
 * professor's level detail is GET /api/analytics/:id, which the server checks
 * against the same reporting line.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { api } from '../lib/api.js';
import { LABEL, LEVELS } from '../lib/bloom.js';
import { HOME_FOR, ROLE_LABEL } from '../lib/routes.js';
import AccountShell from '../shell/AccountShell.jsx';
import { useViewer } from '../shell/viewer.js';
import {
  Avatar, Button, Chip, Dialog, Empty, Field, Icon, Note, Num, Panel, Section, Segmented, Spark, Tip,
} from '../ui/index.jsx';
import {
  ago, big, busiest, byLevel, CodeBlock, CopyButton, dateOf, dayOf, daysUntil, Facts, LEVEL_BANDS, LevelReading,
  LevelSummary, plural, Rate, restsOn, RoomDot, seriesOf, share, thinnest, useMedia,
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
      <div className="ac-skel-panel">
        <div className="stack stack-3">
          <div className="skel" style={{ height: 20, width: 150 }} />
          <div className="skel" style={{ height: 26, width: '84%' }} />
          <div className="skel" style={{ height: 26, width: '52%' }} />
          <div className="skel" style={{ height: 14, width: '70%', marginTop: 8 }} />
        </div>
        <div className="ac-skel-tiles">
          {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="skel" style={{ height: 96, borderRadius: 12 }} />)}
        </div>
      </div>
      <div className="card ac-skel-list">
        <div className="skel" style={{ height: 18, width: 180 }} />
        <div className="ac-skel-heat">
          {Array.from({ length: 14 }, (_, i) => <div key={i} className="skel" style={{ height: 34 }} />)}
        </div>
      </div>
    </div>
  );
}

/** Professors by name, for a sentence: "A", "A and B", "A, B and 3 more". */
function names(list) {
  const n = list.map((p) => p.fullName || 'an unnamed account');
  if (n.length <= 1) return n[0] ?? '';
  if (n.length === 2) return `${n[0]} and ${n[1]}`;
  return `${n[0]}, ${n[1]} and ${n.length - 2} more`;
}

/**
 * The brief: what the department did, in a sentence built from its own rows,
 * where the answers sit and who has not started, beside the figures.
 */
function Brief({ counts, professors, bloom, recent, owners, onRooms, onAnalytics }) {
  const ran = professors.filter((p) => p.sessions > 0);
  const idle = professors.filter((p) => p.sessions === 0 && p.active !== false);
  const off = professors.filter((p) => p.active === false);
  const live = recent.find((r) => r.status === 'open');
  const latest = recent[0];
  const peak = busiest(bloom);
  const weak = thinnest(bloom);
  const seen = bloom.reduce((n, b) => n + (b.seen ?? 0), 0);
  const total = counts.professors ?? professors.length;

  const lines = [];
  if (seen > 0 && peak) {
    lines.push(['Levels', weak && weak.level !== peak.level
      ? `Most answers land at ${LABEL[peak.level]}. ${LABEL[weak.level]} is the thinnest, at ${share(weak.accuracy)} of ${weak.seen.toLocaleString()} served.`
      : `Most answers land at ${LABEL[peak.level]}.`]);
  }
  if (idle.length) lines.push(['Waiting', `${names(idle)} ${idle.length === 1 ? 'has' : 'have'} not run a room yet.`]);
  if (off.length) {
    lines.push(['Disabled', off.length === 1
      ? `${names(off)}'s account is switched off.`
      : `${names(off)} have their accounts switched off.`]);
  }

  const accuracy = seriesOf(recent, 'accuracy');
  const banded = seriesOf(recent, 'banded');
  const owner = (r) => owners.get(String(r.ownerId)) || 'A professor not on the roster';

  return (
    <Panel className="ac-brief" aria-label="The department in brief">
      <div className="ac-brief-say">
        <div className="cluster">
          <span className="tag-mint">Department brief</span>
          {live && <span className="ac-brief-meta"><span className="live-dot" aria-hidden="true" />A room is live</span>}
        </div>
        <p className="ac-lead">
          <em>{ran.length} of {plural(total, 'professor')}</em> {ran.length === 1 ? 'has' : 'have'} run a room, {plural(counts.sessions, 'room')} in all.
          {live
            ? <> {owner(live)}&rsquo;s <em>{live.title || 'Untitled room'}</em> is live now.</>
            : latest && <> The latest was <em>{latest.title || 'Untitled room'}</em>{dayOf(latest.startedAt) && <> on {dayOf(latest.startedAt)}</>}.</>}
        </p>
        {lines.length > 0 && (
          <div className="brief">
            {lines.map(([k, v]) => <span key={k} style={{ display: 'contents' }}><b>{k}</b><span>{v}</span></span>)}
          </div>
        )}
        <div className="ac-brief-acts">
          <Button variant="accent" className="ac-tap" icon="rooms" onClick={onRooms}>All rooms</Button>
          <Button className="ac-tap" icon="analytics" onClick={onAnalytics}>Analytics</Button>
        </div>
      </div>

      <div className="ac-tiles ac-tiles-6">
        <div className="ptile">
          <span>Professors</span>
          <b><Num value={big(total)} /></b>
          <small>{ran.length} <i>have run a room</i></small>
        </div>
        <div className="ptile" style={{ '--d': '0.6s' }}>
          <span>Students</span>
          <b><Num value={big(counts.students)} /></b>
          <small>{plural(counts.contents, 'chapter')} <i>loaded</i></small>
        </div>
        <div className="ptile" style={{ '--d': '1.2s' }}>
          <span>Rooms run</span>
          <b><Num value={big(counts.sessions)} /></b>
          <small>{big(counts.questions)} <i>questions written</i></small>
        </div>
        <div className="ptile" style={{ '--d': '1.8s' }}>
          <span>Answers</span>
          <b><Num value={big(counts.answered)} /></b>
          <small>{counts.sessions ? big(Math.round((counts.answered ?? 0) / counts.sessions)) : '—'} <i>per room</i></small>
        </div>
        <div className="ptile" style={{ '--d': '2.4s' }}>
          <span>Mean accuracy</span>
          <b><Num value={share(counts.accuracy)} /></b>
          <Spark values={accuracy} label={`Accuracy in the department's last ${accuracy.length} rooms`} />
          <small>{accuracy.length ? `${accuracy.length} rooms` : '—'} <i>most recent</i></small>
        </div>
        <div className="ptile" style={{ '--d': '3s' }}>
          <span>Support band</span>
          <b><Num value={big(counts.banded)} /></b>
          <Spark values={banded} label={`Students in the support band, last ${banded.length} rooms`} />
          <small>sittings <i>under 40%</i></small>
        </div>
      </div>
    </Panel>
  );
}

/* Five steps of one green, a fifth of the range each. Steps rather than a
   continuous shade so the figure printed on a cell can always be read: the
   text colour is chosen per step, per theme, in account.css. */
const STEPS = [
  { step: 1, label: 'Under 20%' },
  { step: 2, label: '20 to 39%' },
  { step: 3, label: '40 to 59%' },
  { step: 4, label: '60 to 79%' },
  { step: 5, label: '80% and over' },
];
const stepOf = (acc) => (acc < 0.2 ? 1 : acc < 0.4 ? 2 : acc < 0.6 ? 3 : acc < 0.8 ? 4 : 5);

/** One accuracy as a cell on a single green scale: darker is stronger. */
function Cell({ name, entry }) {
  const seen = entry?.seen ?? 0;
  // A band from the server brings its count sentence: said on hover and to a screen reader.
  const said = entry?.sentence ? ` ${entry.sentence}` : '';
  if (!seen) {
    return <td><span className="ac-cell" data-empty="true" title={`${name}: not answered.${said}`}>—</span></td>;
  }
  const correct = entry.correct ?? 0;
  const acc = correct / seen;
  return (
    <td>
      <span
        className="ac-cell"
        data-step={stepOf(acc)}
        title={`${name}: ${correct.toLocaleString()} of ${seen.toLocaleString()} correct.${said}`}
      >
        {Math.round(acc * 100)}
        <span className="sr-only">% of {seen.toLocaleString()}.{said}</span>
      </span>
    </td>
  );
}

/* The map's columns: the three level bands (decision 6, the default for a
   summary) or the six levels. Each column is a set of levels, so a cell is
   the answers at those levels added together. */
const COLUMNS = {
  bands: LEVEL_BANDS.map((b) => ({ id: b.id, name: b.label, levels: b.levels })),
  levels: LEVELS.map((l) => ({ id: l, name: LABEL[l], levels: [l] })),
};
const entryOf = (bloom, col, sent) => {
  // The server's own band, as the dashboard and analytics send `levelBands`
  // since the Phase 5 follow-ups; the column's levels added up only when a
  // read carries none.
  const given = Array.isArray(sent) ? sent.find((b) => b.id === col.id) : null;
  if (given) return { seen: given.answers ?? 0, correct: given.correct ?? 0, sentence: given.sentence };
  const map = byLevel(bloom);
  return col.levels.reduce(
    (e, l) => ({ seen: e.seen + (map[l]?.seen ?? 0), correct: e.correct + (map[l]?.correct ?? 0) }),
    { seen: 0, correct: 0 },
  );
};

/**
 * Where the department's answers land, in three level bands first and the six
 * levels on request. The department is one row and is always there; each
 * professor is a row of their own once asked for, read from their own
 * analytics, because nothing on the dashboard carries a level profile per
 * professor.
 */
function LevelMap({ bloom, bands, professors, details, onInspect, onPick }) {
  const [open, setOpen] = useState(false);
  const [by, setBy] = useState('bands');
  const cols = COLUMNS[by];
  const sentFor = (b) => (by === 'bands' ? b : null);
  const ran = professors.filter((p) => p.sessions > 0);
  const idle = professors.filter((p) => p.sessions === 0);
  const seen = bloom.reduce((n, b) => n + (b.seen ?? 0), 0);
  const dept = cols.map((c) => entryOf(bloom, c, sentFor(bands)));
  // The column most answers landed in, marked in the head.
  const peak = seen ? cols[dept.reduce((at, e, i) => (e.seen > dept[at].seen ? i : at), 0)] : null;

  // Opening the comparison is what asks for each professor's levels: one read
  // each, and the cache in the container means never twice.
  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) ran.forEach((p) => { if (!details[p.id]) onInspect?.(p.id); });
  }

  return (
    <section className="card ac-card">
      <div className="ac-head">
        <Section
          as="h2"
          title="Accuracy by level"
          sub={by === 'bands'
            ? 'Correct of answered in three bands of two levels each, so each figure rests on more answers. Darker is stronger; a dash is a band nobody has been asked.'
            : 'Correct of answered at each of the six levels. Darker is stronger; a dash is a level nobody has been asked.'}
        />
        <div className="ac-heat-tools">
          <LevelReading value={by} onChange={setBy} />
          <div className="ac-legend" aria-hidden="true">
            <span>0%</span>
            {STEPS.map((s) => <i key={s.step} data-step={s.step} title={s.label} />)}
            <span>100%</span>
            <i data-empty="true" />
            <span>Not asked</span>
          </div>
        </div>
      </div>

      <div className="ac-heat-wrap">
        <table className={`ac-heat${by === 'bands' ? ' is-bands' : ''}`}>
          <caption className="sr-only">
            {by === 'bands'
              ? 'Accuracy in each level band, as a percentage of the answers asked at its two levels'
              : 'Accuracy at each level, as a percentage of answers that level was asked'}
          </caption>
          <thead>
            <tr>
              <th scope="col"><span className="sr-only">Who</span></th>
              {cols.map((c) => (
                <th key={c.id} scope="col" data-peak={peak?.id === c.id ? 'true' : undefined}>
                  <span className="ac-heat-lv">
                    {c.levels.map((l) => <span key={l} className="ac-heat-n" data-level={l}><i className="swatch" />{LEVELS.indexOf(l) + 1}</span>)}
                  </span>
                  <span className="ac-heat-name">{c.name}</span>
                  {peak?.id === c.id && <span className="sr-only"> (most answers)</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="is-dept">
              <th scope="row">
                <span className="ac-heat-who">Whole department</span>
                <small>{seen ? `${seen.toLocaleString()} answers` : 'Fills in from live rooms'}</small>
              </th>
              {cols.map((c, i) => <Cell key={c.id} name={c.name} entry={dept[i]} />)}
            </tr>
            {ran.length > 0 && (
              <tr className="ac-heat-toggle">
                <td colSpan={cols.length + 1}>
                  <button type="button" aria-expanded={open} onClick={toggle}>
                    <Icon name="chevron" size={14} />
                    {open ? 'Hide the professors' : `Compare ${plural(ran.length, 'professor')}`}
                  </button>
                </td>
              </tr>
            )}
            {open && ran.map((p) => {
              const d = details[p.id];
              return (
                <tr key={p.id}>
                  <th scope="row">
                    <button type="button" className="ac-heat-who is-link" onClick={() => onPick(p.id)}>{p.fullName || 'Unnamed account'}</button>
                    <small>{plural(p.sessions, 'room')}</small>
                  </th>
                  {d?.error ? (
                    <td colSpan={cols.length}>
                      <span className="ac-heat-err">
                        Did not load: {d.error}{' '}
                        <button type="button" className="link ac-linkbtn" onClick={() => onInspect?.(p.id, true)}>Try again</button>
                      </span>
                    </td>
                  ) : !d?.data ? (
                    cols.map((c) => <td key={c.id}><span className="ac-cell skel" aria-hidden="true" /></td>)
                  ) : (
                    cols.map((c) => <Cell key={c.id} name={c.name} entry={entryOf(d.data.bloom, c, sentFor(d.data.levelBands))} />)
                  )}
                </tr>
              );
            })}
            {open && idle.length > 0 && (
              <tr className="is-idle">
                <th scope="row">
                  <span className="ac-heat-who">{names(idle)}</span>
                  <small>No rooms yet</small>
                </th>
                <td colSpan={cols.length}><span className="t-meta">A live room is what writes a level profile, so there is nothing to read here yet.</span></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {peak && (
        <p className="ac-heat-note t-meta">
          Marked: {peak.name}, where most of the department&rsquo;s questions landed. Nothing here is estimated.
        </p>
      )}
    </section>
  );
}

/** One of the department's rooms, as a line in the inspector. */
function RoomLine({ room, owner }) {
  return (
    <li className="ac-feed-row is-tight" data-status={room.status}>
      <RoomDot status={room.status} />
      <span className="ac-feed-main">
        <span className="ac-feed-t">
          <span className="clip" title={room.title || undefined}>{room.title || 'Untitled room'}</span>
          {room.status === 'open' && <Chip tone="ok" dot className="chip-live">Live</Chip>}
          {room.status === 'paused' && <Chip tone="warn">Paused</Chip>}
        </span>
        <span className="t-meta">
          <span className="mono">{room.code}</span>
          {owner !== undefined && ` · ${owner || 'Owner not on the roster'}`}
          {` · ${room.joined ?? 0} joined · ${share(room.accuracy)}${restsOn(room)}`}
          {dayOf(room.startedAt) && ` · ${dayOf(room.startedAt)}`}
          {/* One professor's own list has the room for it; the department's does not. */}
          {owner === undefined && room.banded > 0 && ` · ${room.banded} in support band`}
        </span>
      </span>
    </li>
  );
}

/**
 * Nobody selected: the department's latest rooms stand in the inspector, with
 * who ran each. The level picture is the map above.
 */
function WholeDepartment({ recent, names: owners }) {
  return (
    <>
      <div className="ac-insp-head">
        <span className="avatar avatar-lg ac-insp-ic"><Icon name="building" size={18} /></span>
        <div className="grow">
          <h3>Whole department</h3>
          <div className="t-meta">Select a professor to read their classes.</div>
        </div>
      </div>

      <section className="ac-sec">
        <div className="ac-sec-head">
          <h3 className="ac-label">Recent rooms</h3>
          {recent.length > 0 && <span className="t-meta">newest first</span>}
        </div>
        {recent.length === 0 ? (
          <p className="t-small muted">
            No room has been opened yet. Rooms are run by professors, so this fills in the first time one of them puts
            a code on the board.
          </p>
        ) : (
          <ul className="ac-feed is-flush">
            {recent.slice(0, 6).map((r) => <RoomLine key={r.code} room={r} owner={owners.get(String(r.ownerId)) ?? ''} />)}
          </ul>
        )}
      </section>
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
  // Their classes together are a summary (decision 6): three bands first.
  const [by, setBy] = useState('bands');

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
      <section className="ac-sec">
        <div className="ac-codeline">
          <div className="grow">
            <div className="t-meta">BloomLoop code</div>
            <div className="mono strong">{p.code}</div>
          </div>
          <CopyButton value={p.code} className="ac-tap" />
        </div>
      </section>

      <section className="ac-sec">
        <div className="ac-sec-head">
          <h3 className="ac-label">Their classes, by level</h3>
          {p.sessions > 0 && d && <LevelReading value={by} onChange={setBy} />}
        </div>
        {p.sessions === 0 ? (
          <p className="said">
            Nothing has been run from this account yet. A bank and a roster can both be in place and still show no
            profile: a live room is what writes one.
          </p>
        ) : detail?.error ? (
          <Note tone="bad">
            The level detail did not load: {detail.error}{' '}
            <button type="button" className="link ac-linkbtn" onClick={onRetry}>Try again</button>
          </Note>
        ) : !d ? (
          <div className="stack stack-2">{LEVELS.map((l) => <div key={l} className="skel" style={{ height: 14 }} />)}</div>
        ) : (
          <>
            <LevelSummary bloom={d.bloom} bands={d.levelBands} by={by} current={busiest(d.bloom)?.level} />
            <p className="t-meta">
              Correct of answered.{by === 'bands' ? ' Two levels to a band.' : ''}{reading ? ` ${reading}` : ''}
            </p>
          </>
        )}
      </section>

      <section className="ac-sec">
        <Facts
          items={[
            ['Chapters loaded', big(p.contents)],
            ['Questions written', big(p.questions)],
            ['Answers recorded', d ? big(d.counts?.answered) : '—'],
            ['Students seen in their rooms', d ? big(d.counts?.students) : '—'],
            ['Students reporting to them', big(p.students)],
            ['Last room', p.lastSessionAt ? dateOf(p.lastSessionAt) : 'Never'],
          ]}
        />
      </section>

      {rooms.length > 0 && (
        <section className="ac-sec">
          <h3 className="ac-label">Recent rooms</h3>
          <ul className="ac-feed is-flush">
            {rooms.map((r) => <RoomLine key={`${r.code}-${r.startedAt}`} room={r} />)}
          </ul>
        </section>
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
        <div className="ac-acts">
          <Button onClick={() => setMade(null)}>Invite another</Button>
          <Button variant="primary" onClick={() => onOpenChange(false)}>Done</Button>
        </div>
      ) : (
        <div className="ac-acts">
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

/** Codes created in this visit. A quiet list under the professors, not a second dashboard. */
function PendingInvites({ invites }) {
  return (
    <div className="ac-invites">
      <div className="ac-sec-head">
        <h3 className="ac-label">Invites created in this visit</h3>
        <span className="t-meta">{plural(invites.length, 'code')}</span>
      </div>
      <p className="t-meta">
        Only codes created in this visit are listed: nothing reads open invites back from the server. Copy a code
        before you leave this page, or issue a fresh one.
      </p>
      <ul className="ac-invite-list">
        {invites.map((inv) => (
          <li key={inv.code}>
            <span className="ac-invite-code">{inv.code}</span>
            <span className="grow">
              <span className="clip ac-block">{inv.forName || inv.forEmail || 'No label'}</span>
              {dateOf(inv.expiresAt) && <span className="t-meta">Expires {dateOf(inv.expiresAt)}</span>}
            </span>
            <CopyButton value={inv.code} className="ac-tap" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A professor as a row: who, their code to copy, where they are, how their classes did. */
function ProfessorRow({ professor: p, selected, onPick }) {
  const status = p.active === false
    ? <Chip tone="line">Disabled</Chip>
    : p.sessions === 0
      ? <Chip tone="warn">Not started</Chip>
      : <span className="t-meta">Last room {p.lastSessionAt ? ago(p.lastSessionAt) : 'never'}</span>;
  return (
    <li>
      <div className="ac-prof" data-selected={selected ? 'true' : undefined} onClick={() => onPick(p.id)}>
        <button
          type="button"
          className="ac-prof-who"
          aria-label={`${p.fullName || 'Unnamed account'}, open details`}
          aria-current={selected ? 'true' : undefined}
          onClick={(e) => { e.stopPropagation(); onPick(p.id); }}
        >
          <Avatar name={p.fullName} />
          <span className="ac-person-who">
            <span className="ac-person-name"><span className="clip">{p.fullName || 'Unnamed account'}</span></span>
            <span className="t-meta clip">
              {plural(p.sessions, 'room')} · {plural(p.students, 'student')} · {plural(p.questions, 'question')}
            </span>
          </span>
        </button>
        <span className="ac-prof-code">
          <span className="mono">{p.code}</span>
          <CopyButton value={p.code} label={null} variant="ghost" className="ac-tap" aria-label={`Copy the code for ${p.fullName || 'this account'}`} />
        </span>
        <span className="ac-prof-state">{status}</span>
        <span className="ac-prof-rate">
          <span aria-label={`Mean accuracy ${share(p.accuracy)}${restsOn(p)}`}><Rate value={p.accuracy} /></span>
          {/* What it rests on (Phase 5): their rooms' graded answers. */}
          {Number(p.answers) > 0 && <small aria-hidden="true">{plural(p.answers, 'answer')}</small>}
        </span>
      </div>
    </li>
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
  const owners = useMemo(() => new Map(professors.map((p) => [String(p.id), p.fullName])), [professors]);

  const inspected = sel && (!narrow || sheet) ? sel.id : null;
  useEffect(() => {
    if (inspected != null && !details[inspected]) onInspect?.(inspected);
  }, [inspected, details, onInspect]);

  const department = data?.department || account?.department || '';
  const crumb = (
    <>
      <span>Head of department</span>
      {account?.code && <><span aria-hidden="true">·</span><span className="mono">{account.code}</span></>}
    </>
  );

  if (loading) {
    return <AccountShell current="home" crumb={crumb} title={department || 'Your department'}><Skeleton /></AccountShell>;
  }

  // Signed out, or a build with no accounts at all. This screen is built from
  // the account asking for it, so there is no version to show a stranger.
  if (!account) {
    return (
      <AccountShell current="home" crumb={crumb}>
        <div className="card">
          <Empty icon="lock" title="Sign in to open your department" action={<Link className="btn btn-primary" to="/signin">Sign in</Link>}>
            This screen is your professors, your students, your department. It is drawn from the account that asks for it.
          </Empty>
        </div>
      </AccountShell>
    );
  }

  if (error && !data) {
    return (
      <AccountShell current="home" crumb={crumb} title={department || 'Your department'}>
        <div className="card">
          <Empty
            icon="alert"
            title="The department did not load"
            action={<Button variant="primary" icon="refresh" busy={refreshing} onClick={onRefresh}>Try again</Button>}
          >
            {error}
          </Empty>
        </div>
      </AccountShell>
    );
  }

  // The token decides the shape, not the address bar. A professor who lands
  // here got their own payload back; drawing it as a department would invent a
  // hierarchy they do not have.
  if (data?.role !== 'hod') {
    return (
      <AccountShell current="home" crumb={crumb}>
        <div className="card">
          <Empty
            icon="shield"
            title="This is the head of department's screen"
            action={<Link className="btn btn-primary" to={HOME_FOR[data?.role] ?? '/'}>Go to your own home</Link>}
          >
            You are signed in as {ROLE_LABEL[data?.role]?.toLowerCase() ?? data?.role ?? 'something else'}, so the
            server answered with that home instead. Nothing was refused.
          </Empty>
        </div>
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

  const sub = bare
    ? 'Nobody reports to you yet. The one thing you create here is an invite, and everything else on this page comes from the professors who redeem one.'
    : `${plural(counts.professors ?? professors.length, 'professor')}, ${plural(counts.students, 'student')}, ${plural(counts.questions, 'question')} across ${plural(counts.contents, 'chapter')}. You can read all of it; the one thing you create here is an invite.`;

  const actions = (
    <span className="ac-headacts">
      <Tip label="Read the department again">
        <Button variant="ghost" className="ac-tap" icon="refresh" busy={refreshing} aria-label="Read the department again" onClick={onRefresh} />
      </Tip>
      {/* With nobody on the page yet, the brief below carries this. */}
      {!bare && <Button variant="primary" className="ac-tap" icon="invite" onClick={() => setInviting(true)}>Invite a professor</Button>}
    </span>
  );

  return (
    <AccountShell current="home" crumb={crumb} title={department || 'Your department'} sub={sub} actions={actions}>
      {error && <Note tone="bad">The figures below are the last ones that loaded: {error}</Note>}

      {bare ? (
        <>
          <Panel className="ac-first is-solo" aria-label="Your department">
            <div className="ac-first-say">
              <span className="tag-mint">Your department</span>
              <h2 className="ac-lead">No professors in {department || 'this department'} yet.</h2>
              <p className="ac-first-sub">
                Professors write the question banks and run the rooms, and every figure on this page is the sum of what
                they do. Invite one and it starts filling in.
              </p>
              <div className="ac-brief-acts">
                <Button variant="accent" className="ac-tap" icon="invite" onClick={() => setInviting(true)}>Invite the first professor</Button>
              </div>
            </div>
          </Panel>
          {invites.length > 0 && <section className="card ac-card ac-pad"><PendingInvites invites={invites} /></section>}
        </>
      ) : (
        <>
          <Brief
            counts={counts}
            professors={professors}
            bloom={bloom}
            recent={recent}
            owners={owners}
            onRooms={() => navigate('/rooms')}
            onAnalytics={() => navigate('/analytics')}
          />

          <LevelMap bloom={bloom} bands={data.levelBands} professors={professors} details={details} onInspect={onInspect} onPick={pick} />

          <div className="ac-split">
            <section className="card ac-card" aria-labelledby="ac-profs-h">
              <div className="ac-head">
                <div className="sec">
                  <h2 id="ac-profs-h">Professors</h2>
                  <p>{plural(professors.length, 'professor reports', 'professors report')} to you. Select one to read their classes.</p>
                </div>
                <Button size="sm" className="ac-tap" icon="invite" onClick={() => setInviting(true)}>Invite</Button>
              </div>
              {professors.length > 1 && (
                <div className="ac-tools">
                  <div className="ac-segbox">
                    <Segmented
                      label="Which professors to show"
                      value={filter}
                      onChange={setFilter}
                      options={FILTERS.map((f) => ({ id: f.id, label: f.label, count: professors.filter(f.match).length }))}
                    />
                  </div>
                </div>
              )}

              {shown.length === 0 ? (
                <Empty
                  icon="filter"
                  title="Nobody matches that filter"
                  action={<Button className="ac-tap" onClick={() => setFilter('all')}>Show everyone</Button>}
                >
                  The roster itself has not changed.
                </Empty>
              ) : (
                <ul className="ac-profs" aria-label="Professors">
                  {shown.map((p) => <ProfessorRow key={p.id} professor={p} selected={!narrow && p.id === sel?.id} onPick={pick} />)}
                </ul>
              )}

              {invites.length > 0 && <PendingInvites invites={invites} />}
            </section>

            <aside
              className="card ac-insp"
              aria-label={sel && !narrow ? `${sel.fullName || 'Professor'} in detail` : 'The whole department'}
            >
              {sel && !narrow ? (
                <>
                  <div className="ac-insp-head">
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
                <WholeDepartment recent={recent} names={owners} />
              )}
              <div className="ac-foot">
                <Button size="sm" variant="ghost" className="ac-tap" icon="rooms" onClick={() => navigate('/rooms')}>All rooms</Button>
                <Button size="sm" variant="ghost" className="ac-tap" icon="analytics" onClick={() => navigate('/analytics')}>Analytics</Button>
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
          {sel && <div className="ac-insp is-flat">{detailOf(sel)}</div>}
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
