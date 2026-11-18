/**
 * /analytics — one screen, three roles.
 *
 * There is one file here rather than three because the difference between the
 * roles is already in the payload and nowhere else. GET /api/analytics answers
 * with a list of *subjects* the caller may analyse:
 *
 *   hod        -> their professors
 *   professor  -> their students
 *   student    -> themselves, exactly once
 *
 * and GET /api/analytics/:id answers with one subject in full, in one of two
 * shapes. Three near-identical files would have to agree on the level ramp, the
 * confidence rule, the topic bars and the trend line, and they would stop
 * agreeing the first week somebody fixed a rounding bug in only one of them.
 *
 * What actually changes per role, and all that changes:
 *
 *   - the sentence under the title
 *   - whether there is a list to pick from at all (a student's picker would have
 *     one entry, which is furniture, so a student skips straight to their detail)
 *   - the words on the tiles: "students taught" against "sessions sat"
 *
 * Nothing on this screen writes. That is not this file being careful — analytics
 * is two GETs and there is no third route to call. For a student the chrome says
 * so out loud, because a student is read-only everywhere in the product and the
 * one place that would be worth hiding is the one place it is worth stating.
 *
 * The id in the second call is not a capability. services/analytics.js checks it
 * against the caller's own subject list and answers 404 for anything outside it —
 * the same answer as an id that does not exist — so this screen cannot be talked
 * into reading someone else's class by editing the address bar.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
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

/* The band the server brands a sitting with (services/mastery.js), and the
   number of answers it insists on before it will brand anything at all. Both are
   quoted here only to phrase a sentence — no judgement on this screen is made in
   the browser. */
const BAND = 0.4;
const MIN_EVIDENCE = 3;

const DAY = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const DAY_NUM = new Intl.DateTimeFormat(undefined, { day: 'numeric' });

function dateOf(iso, fmt = DAY) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : fmt.format(d);
}

/** Two letters for a bar label — a name does not fit under a 30px bar. */

/* Re, Un, Ap, An, Ev, Cr. Two letters is enough to tell the six apart, which is
   the only job a label under a 30px bar has. */
const SHORT = (level) => (LABEL[level] ?? level).slice(0, 2);

/**
 * The three status colours, and no fourth. This is the same hi / mid / lo split
 * `cellClass` puts on the teacher grid, so a bar and a cell reading 62% are the
 * same colour on both screens.
 */
function tone(accuracy) {
  if (accuracy == null) return 'var(--line-3)';
  if (accuracy >= 0.7) return 'var(--ok)';
  if (accuracy >= BAND) return 'var(--warn)';
  return 'var(--bad)';
}

/** The same three, as the tint on a <Stat>'s round icon. */
function statTone(accuracy) {
  if (accuracy == null) return '';
  if (accuracy >= 0.7) return 'ok';
  return accuracy < BAND ? 'bad' : 'warn';
}

/* A tail with nothing in it is the thing that makes a card look unfinished, so a
   subject with no answers yet gets a flat row of labelled stubs rather than an
   empty 68px box. */
const FLAT = LEVELS.map((level) => ({ label: SHORT(level), value: 0 }));
const bars = (rows) => (rows.length ? rows : FLAT);

/**
 * What each role is looking at. Every string that differs between the three
 * lives in this one table, so a change of wording is a change in one place and
 * the three roles cannot drift into three different products.
 */
const FRAMING = {
  hod: {
    sub: 'How each professor’s classes are going — measured from every session their students have sat, never estimated.',
    list: 'Professors',
    one: 'professor',
    many: 'professors',
    picked: 'Selected professor',
    empty: 'No professors to analyse yet',
    emptyBody:
      'Analytics is built out of live sessions, so it starts the moment one of your professors opens a room. Invite one from the department screen and this fills itself in.',
    emptyTo: '/admin',
    emptyAction: 'Go to your department',
    profile: 'Every answer their students have given, folded into the six levels.',
  },
  professor: {
    sub: 'The track record of each student — every room you have run, folded into one profile per person.',
    list: 'Students',
    one: 'student',
    many: 'students',
    picked: 'Selected student',
    empty: 'No students on your roster yet',
    emptyBody:
      'A student turns up here once they are on your roster and has a profile once they have sat a session. Invite one from your overview and the first room they join writes the rest.',
    emptyTo: '/home',
    emptyAction: 'Go to your overview',
    profile: 'Every answer they have given, across every room of yours they have sat.',
  },
  student: {
    sub: 'Where you are strongest, and where to put the next hour. Everything here was measured in a live room — nothing on this page is a guess.',
    list: 'You',
    one: 'student',
    many: 'students',
    picked: 'Your record',
    empty: 'Nothing to analyse yet',
    emptyBody:
      'Your profile is written by the rooms you sit. Join one, answer a few questions, and the six levels below start filling in.',
    emptyTo: '/join',
    emptyAction: 'Join a room',
    profile: 'Every answer you have given, across every session you have sat.',
  },
};

/* Narrowing the list is a display choice and each pill carries its own
   predicate, so the count on the pill and the rows it reveals cannot drift. */
const FILTERS = [
  { id: 'all', label: 'Everyone', match: () => true },
  { id: 'weak', label: 'Under 40%', match: (s) => s.counts?.accuracy != null && s.counts.accuracy < BAND },
  { id: 'quiet', label: 'Nothing recorded', match: (s) => !(s.counts?.answered > 0) },
  { id: 'off', label: 'Deactivated', match: (s) => s.active === false },
];

/* ------------------------------------------------------------------ pieces */

/** Shaped like the page it stands in for, so nothing jumps when the data lands. */
function Skeleton() {
  return (
    <>
      <div className="skel" style={{ height: 320, borderRadius: 'var(--r-panel)', marginBottom: 16 }} />
      <div className="grid auto" style={{ marginBottom: 16 }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skel" style={{ height: 182, borderRadius: 'var(--r-card)' }} />
        ))}
      </div>
      <div className="skel" style={{ height: 264, borderRadius: 'var(--r-card)' }} />
    </>
  );
}

/** The same, for the half of the page that swaps when a subject is picked. */
function DetailSkeleton() {
  return (
    <>
      <div className="grid auto" style={{ marginBottom: 16 }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skel" style={{ height: 182, borderRadius: 'var(--r-card)' }} />
        ))}
      </div>
      <div className="skel" style={{ height: 264, borderRadius: 'var(--r-card)', marginBottom: 16 }} />
      <div className="grid auto-lg">
        {[0, 1].map((i) => (
          <div key={i} className="skel" style={{ height: 148, borderRadius: 'var(--r-card)' }} />
        ))}
      </div>
    </>
  );
}

/**
 * The six levels, as one shape.
 *
 * Bar height is accuracy, not volume — how often the answers at that level were
 * right, so a level met three times and a level met thirty are read the same
 * way. The count underneath carries the volume. Lime marks the level the subject
 * is working at right now and means nothing else anywhere in this product; a
 * professor is not working at a level, so on a professor's profile nothing is
 * limed, which falls out of `currentLevel` simply not being in their payload.
 */
function BloomBars({ report, currentLevel }) {
  const chart = useRef(null);
  const [tight, setTight] = useState(false);

  // Six full level names want about 74px of column each. Measured off the card
  // rather than off a breakpoint, because what decides it is the width this
  // chart was given and the page around it is free to change that.
  useEffect(() => {
    const el = chart.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => setTight(entry.contentRect.width / LEVELS.length < 74));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="bars" ref={chart}>
      {report.map((row) => {
        const share = row.accuracy == null ? 0 : Math.round(row.accuracy * 100);
        const here = row.level === currentLevel;
        return (
          // .here goes round the whole column, label and name included: the
          // sentence it is making is "this level is where you are", not "this
          // bar is where you are".
          <div key={row.level} className={here ? 'here' : ''} title={LABEL[row.level] ?? row.level}>
            <div className="lab">{row.seen ? `${share}%` : '—'}</div>
            <div className="track" style={{ height: 132 }}>
              {/* A level answered and never got right is not the same thing as a
                  level never met, so 0% keeps a sliver rather than vanishing. */}
              <i
                className={`swatch ${row.level}`}
                style={{ height: row.seen ? `${Math.max(share, 3)}%` : 0 }}
              />
            </div>
            <div className={`nm${here ? ' cur' : ''}`}>
              {tight ? SHORT(row.level) : (LABEL[row.level] ?? row.level)}
            </div>
            <div className="lab" style={{ color: 'var(--ink-5)' }}>
              {row.seen ? `${row.correct}${tight ? '/' : ' of '}${row.seen}` : (tight ? '—' : 'not met')}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Strongest and weakest.
 *
 * `confident` is the whole reason this is a component and not two lines of JSX.
 * The server sets it false when fewer than two levels have MIN_EVIDENCE answers
 * behind them, and in that state it still returns a `best` — the single level
 * that qualified, which is also the `weakest`. Naming it would tell a student
 * they are "best at Create" off one lucky answer, and that is the sentence they
 * will repeat to themselves all term. So when the flag is false the level is not
 * named at all, whatever is sitting in the field.
 */
function Extremes({ best, weakest, confident, you }) {
  if (!confident) {
    return (
      <Card className="pad-lg">
        <div className="cardhead">
          <h2>Strongest and weakest</h2>
          <span className="sub">not yet a comparison</span>
        </div>
        <div className="said">
          <span>
            Two levels need at least {MIN_EVIDENCE} answers each before one can honestly be called
            stronger than the other. {you ? 'You are' : 'This profile is'} not there yet, so nothing is
            named — a level called strongest off one lucky answer is worse than saying nothing.
          </span>
        </div>
      </Card>
    );
  }

  const pair = [
    {
      key: 'best',
      eyebrow: 'Strongest',
      row: best,
      icon: 'trendUp',
      line: you
        ? 'The level you get right most often. It is the one to lean on, not the one to practise.'
        : 'The level answered correctly most often across everything on record.',
    },
    {
      key: 'weakest',
      eyebrow: 'Weakest',
      row: weakest,
      icon: 'trendDown',
      line: you
        ? 'Where the next hour goes. Same six levels, so this is a level of thinking rather than a topic.'
        : 'The level to aim the next bank at. It is a kind of thinking, not a chapter.',
    },
  ];

  return (
    <div className="grid auto-lg">
      {pair.map(({ key, eyebrow, row, icon, line }) => (
        <Card key={key} className="pad-lg">
          <div className="row" style={{ gap: 10 }}>
            <span className="eyebrow">{eyebrow}</span>
            <span className="grow" />
            <Icon name={icon} size={13} />
          </div>
          <div className="row" style={{ gap: 12, marginTop: 12 }}>
            <span className={`tag lg ${row.level}`}>{LABEL[row.level] ?? row.level}</span>
            <span className="mono" style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em' }}>
              {asPct(row.accuracy)}
            </span>
            <span className="muted" style={{ fontSize: 11.5, fontWeight: 600 }}>
              {row.correct} of {row.seen} right
            </span>
          </div>
          <div className="hint" style={{ marginTop: 12 }}>{line}</div>
        </Card>
      ))}
    </div>
  );
}

/**
 * Topics, ranked by how much evidence there is behind each one.
 *
 * The server mines these out of the answer history rather than storing them, so
 * the order is "most answered first" and not "worst first": a topic met twice at
 * 0% is not the biggest problem on the page, it is the least known thing on it.
 * The bar carries the accuracy and the count carries the weight.
 */
function Topics({ topics }) {
  return (
    <div className="stack tight">
      {topics.map((t) => {
        const share = t.accuracy == null ? 0 : Math.round(t.accuracy * 100);
        return (
          <div className="genrow" key={t.topic}>
            {/* .genrow's label is a fixed 92px because the generator's labels are
                six known words. A topic is arbitrary text off a syllabus, so it
                is allowed to grow and to wrap. */}
            <div className="n" style={{ width: 'auto', flex: '1 1 180px', minWidth: 0, lineHeight: 1.35 }}>
              {t.topic}
            </div>
            <div className="track" style={{ flex: '2 1 120px' }}>
              <i style={{ width: `${Math.max(share, 2)}%`, background: tone(t.accuracy) }} />
            </div>
            <div className="c">{share}%</div>
            <div className="c" style={{ color: 'var(--ink-5)' }}>{t.correct}/{t.seen}</div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Session by session, oldest on the left, because a trend is read left to right.
 *
 * Height is the accuracy of that sitting. For a student the bar is also coloured
 * by the level they were working at when it ended — two encodings on purpose,
 * the same pair the answer trail uses on their own dashboard, so a run of
 * improving marks at a rising level is visible as one shape. A professor has no
 * working level of their own, so their bars are brand-coloured and the count of
 * students in the support band rides underneath instead.
 */
function Timeline({ rows, kind }) {
  const student = kind === 'student';
  return (
    <div className="bars">
      {rows.map((s, i) => {
        const share = s.accuracy == null ? 0 : Math.round(s.accuracy * 100);
        const last = i === rows.length - 1;
        return (
          <div key={`${s.code}-${i}`} title={`${s.title || s.code} · ${dateOf(s.startedAt) || 'no date'}`}>
            <div className="lab">{s.accuracy == null ? '—' : `${share}%`}</div>
            <div className="track" style={{ height: 108 }}>
              <i
                className={student && s.workingLevel ? `swatch ${s.workingLevel}` : undefined}
                style={{
                  height: `${Math.max(share, 3)}%`,
                  background: student && s.workingLevel ? undefined : 'var(--brand)',
                }}
              />
            </div>
            {/* Bold on the most recent, never lime: lime is the level a person is
                working at and borrowing it for "newest" would make the ramp mean
                two things. */}
            <div className={`nm${last ? ' cur' : ''}`}>{dateOf(s.startedAt) || s.code}</div>
            <div className="lab" style={{ color: 'var(--ink-5)' }}>
              {student
                ? `${s.correct}/${s.answered}`
                : `${s.joined} in${s.banded ? ` · ${s.banded}↓` : ''}`}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * A professor's roster, ranked. The server sorts it by accuracy already, so the
 * position number is the server's ranking and not a second opinion.
 *
 * The 40% flag says "under 40% overall" rather than "in the support band". The
 * band is a per-sitting judgement the server makes with MIN_EVIDENCE behind it;
 * this row is a career total across every session, and calling it the same thing
 * would put a label on a student that no session ever gave them.
 */
function Roster({ students }) {
  return (
    <div>
      {students.map((s, i) => {
        const share = s.accuracy == null ? 0 : Math.round(s.accuracy * 100);
        const low = s.accuracy != null && s.answered >= MIN_EVIDENCE && s.accuracy < BAND;
        return (
          <div
            key={s.rollNo}
            className="row"
            style={{ gap: 10, padding: '11px 0', borderTop: i ? '1px solid var(--line-2)' : 'none' }}
          >
            <span className="mono muted" style={{ fontSize: 11.5, fontWeight: 700, width: 22 }}>
              {i + 1}
            </span>
            <Avatar name={s.name || s.rollNo} size="sm" />
            <span className="grow" style={{ minWidth: 120 }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>{s.name || 'Name not recorded'}</span>
              <span className="mono muted" style={{ fontSize: 11, fontWeight: 600, marginLeft: 8 }}>
                {s.rollNo}
              </span>
            </span>
            {s.lastLevel && (
              <span className={`tag sm ${s.lastLevel}`} title="The level they were working at when their last session ended">
                {LABEL[s.lastLevel] ?? s.lastLevel}
              </span>
            )}
            <span className="flag neutral nowrap">{plural(s.sessions, 'session')}</span>
            {low && <span className="flag nowrap">under 40%</span>}
            <span
              aria-hidden="true"
              style={{ width: 68, height: 6, flex: 'none', borderRadius: 'var(--r-pill)', background: 'var(--line-2)' }}
            >
              <i
                style={{
                  display: 'block', height: '100%', width: `${Math.max(share, 2)}%`,
                  borderRadius: 'var(--r-pill)', background: tone(s.accuracy),
                }}
              />
            </span>
            <span className="mono nowrap" style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-4)' }}>
              {s.correct}/{s.answered}
            </span>
            <span className="mono nowrap" style={{ fontSize: 12.5, fontWeight: 700, width: 42, textAlign: 'right' }}>
              {asPct(s.accuracy)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------- the screen */

export default function Analytics() {
  const navigate = useNavigate();
  const { account, loading: accountLoading } = useAccount();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloads, setReloads] = useState(0);

  const [pickedId, setPickedId] = useState('');
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');

  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.analytics().then(
      (res) => { if (alive) { setData(res); setError(''); setLoading(false); } },
      (err) => { if (alive) { setError(err.message || 'Analytics did not load.'); setLoading(false); } },
    );
    return () => { alive = false; };
  }, [reloads]);

  // The server's answer decides the shape, not the address bar and not the
  // cached account: whoever the token belongs to is what came back.
  const role = data?.role ?? account?.role ?? 'professor';
  const copy = FRAMING[role] ?? FRAMING.professor;
  const mine = role === 'student';

  // Most answers first. The list arrives in roster order, which puts whoever was
  // created first at the top regardless of whether there is anything to read
  // about them — and the row at the top is the one that opens by default, so it
  // ought to be the one with the most evidence behind it.
  const subjects = useMemo(() => {
    const rows = data?.subjects ?? [];
    return [...rows].sort(
      (a, b) => (b.counts?.answered ?? 0) - (a.counts?.answered ?? 0)
        || String(a.name ?? '').localeCompare(String(b.name ?? '')),
    );
  }, [data]);

  // Filtering narrows what is shown; it never moves the selection. Which person
  // is being read is the user's decision, and a filter silently swapping it is
  // how somebody ends up reading the wrong student's marks.
  const sel = useMemo(
    () => subjects.find((s) => String(s.id) === String(pickedId)) ?? subjects[0] ?? null,
    [subjects, pickedId],
  );

  // A student's own analysis rides along on the overview — the same object
  // GET /api/analytics/:id would return — so there is nothing to fetch and no
  // second round trip to sit through.
  useEffect(() => {
    if (mine || !sel?.id) return undefined;
    let alive = true;
    setDetailLoading(true);
    api.analyticsFor(sel.id).then(
      (res) => { if (alive) { setDetail(res); setDetailError(''); setDetailLoading(false); } },
      (err) => {
        if (alive) {
          setDetail(null);
          setDetailError(err.message || 'That profile did not load.');
          setDetailLoading(false);
        }
      },
    );
    return () => { alive = false; };
  }, [sel?.id, mine, reloads]);

  const full = mine ? (data?.detail ?? null) : detail;
  const busy = mine ? loading : detailLoading;

  /* --- chrome ------------------------------------------------------------ */

  // The same track every signed-in screen wears, with this screen marked and the
  // role's own home first — an HOD's department, a professor's overview, a
  // student's results. The console is a teacher's workshop and is not offered to
  // a student, who has no bank to open and no room to run.
  // Rooms is on the two teaching roles and not on the student's, which is the
  // same list /rooms is guarded on — an item that redirected on click would be
  // worse than no item at all.
  const NAV = {
    hod: [
      { id: 'home', label: 'Department' },
      { id: 'analytics', label: 'Analytics' },
      { id: 'rooms', label: 'Rooms' },
      { id: 'console', label: 'Teaching console' },
    ],
    professor: [
      { id: 'home', label: 'Overview' },
      { id: 'analytics', label: 'Analytics' },
      { id: 'rooms', label: 'Rooms' },
      { id: 'console', label: 'Teaching console' },
    ],
    student: [
      { id: 'home', label: 'Your results' },
      { id: 'analytics', label: 'Analytics' },
      { id: 'join', label: 'Join a room' },
    ],
  };

  const bar = {
    badge: mine
      ? (account?.rollNo ? <span className="barcount mono" title="Your roll number">{account.rollNo}</span> : null)
      : (account?.department ? <span className="barcount">{account.department}</span> : null),
    nav: (
      <NavPill
        items={NAV[role] ?? NAV.professor}
        value="analytics"
        onChange={(id) => {
          if (id === 'home') navigate(HOME_FOR[role] ?? '/');
          else if (id === 'rooms') navigate('/rooms');
          else if (id === 'console') navigate('/');
          else if (id === 'join') navigate('/join');
        }}
      />
    ),
    right: (
      <>
        {mine ? (
          <span className="flag neutral" title="A student account reads its own history and writes nothing.">
            <Icon name="lock" size={11} />
            Read only
          </span>
        ) : (
          account?.code && <span className="flag neutral" title={account.role}>{account.code}</span>
        )}
        <Avatar name={account?.fullName || account?.email || 'Your account'} href="/profile" />
        <button type="button" className="iconbtn" title="Sign out" onClick={() => signOut()}>
          <Icon name="logout" />
        </button>
      </>
    ),
  };

  const head = (
    <PageHead
      title="Analytics"
      sub={copy.sub}
      actions={(
        // The only button on this screen for any role, and it asks the server the
        // same question again. There is nothing here to change.
        <button type="button" className="btn" onClick={() => setReloads((n) => n + 1)} disabled={loading}>
          {loading ? <span className="spin" /> : <Icon name="refresh" size={13} />}
          {loading ? 'Reading…' : 'Refresh'}
        </button>
      )}
    />
  );

  if (accountLoading || (loading && !data && !error)) {
    return (
      <Shell {...bar}>
        <PageHead
          title="Analytics"
          sub={<span className="skel" style={{ display: 'block', width: 280, height: 10, borderRadius: 5 }} />}
        />
        <Skeleton />
      </Shell>
    );
  }

  if (error) {
    return (
      <Shell {...bar}>
        {head}
        <Empty
          icon="alert"
          title="Could not read the analytics"
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

  /* --- nobody to analyse -------------------------------------------------- */

  if (!sel) {
    return (
      <Shell {...bar}>
        {head}
        <Empty
          icon="users"
          title={copy.empty}
          action={<a className="btn pri" href={copy.emptyTo}>{copy.emptyAction}<Icon name="forward" size={13} /></a>}
        >
          {copy.emptyBody}
        </Empty>
      </Shell>
    );
  }

  /* --- a student with no roll number -------------------------------------- */

  // The join between an account and the marks earned under it is the roll number
  // typed on a phone in a live room, so without one there is nothing to look up
  // and "no sessions" would be a lie about their attendance. The server's own
  // sentence is printed verbatim: it is the one explanation that cannot drift
  // out of step with the rule that produced it.
  if (mine && full?.reason) {
    return (
      <Shell {...bar}>
        <PageHead
          title="Analytics"
          sub={copy.sub}
          aside={<span className="flag"><Icon name="key" size={11} />No roll number</span>}
          actions={(
            <button type="button" className="btn" onClick={() => setReloads((n) => n + 1)} disabled={loading}>
              {loading ? <span className="spin" /> : <Icon name="refresh" size={13} />}
              Check again
            </button>
          )}
        />
        <div className="panel">
          <div className="panel-head">
            <span className="t">Why this is empty</span>
            <span className="panel-sub">A live room knows you by roll number, not by your account.</span>
          </div>
          <div className="accent">
            <div className="k">BloomLoop said</div>
            <div className="said" style={{ marginTop: 10 }}>
              <span style={{ color: 'var(--on-d)', fontSize: 14.5 }}>{full.reason}</span>
            </div>
            <div className="tiles" style={{ marginTop: 18 }}>
              <div className="accent-tile">
                <b>Not set<Icon name="key" size={11} /></b>
                <span>Your roll number</span>
              </div>
              <div className="accent-tile">
                <b>{account?.department || 'Not linked'}</b>
                <span>Your department</span>
              </div>
            </div>
          </div>
        </div>
      </Shell>
    );
  }

  /* --- the payload -------------------------------------------------------- */

  const kind = full?.kind ?? sel.kind;
  const isProf = kind === 'professor';

  // Headline numbers come from the detail once it lands and from the overview
  // row until then, so switching subject changes the card rather than blanking
  // it. Both are computed by the same functions on the server.
  const counts = full?.counts ?? sel.counts ?? {};
  const timeline = full?.timeline ?? [];
  const topics = full?.topics ?? [];
  const roster = full?.students ?? [];

  // Six rows in taxonomy order even when nothing has been answered: the profile
  // is the point of the page, and a missing chart reads as a bug rather than as
  // an empty class.
  const report = Array.isArray(full?.bloom) && full.bloom.length
    ? full.bloom
    : LEVELS.map((level) => ({ level, seen: 0, correct: 0, accuracy: null }));
  const seenTotal = report.reduce((n, r) => n + (r.seen ?? 0), 0);

  // best / weakest arrive as level names on the overview row and as whole report
  // rows on the detail. The overview form is enough for a tile, the detail form
  // is what the cards need.
  const confident = full ? full.confident : sel.confident;
  const bestLevel = full ? full.best?.level ?? null : sel.best;
  const weakLevel = full ? full.weakest?.level ?? null : sel.weakest;

  const shownFilter = FILTERS.find((f) => f.id === filter) ?? FILTERS[0];
  const needle = query.trim().toLowerCase();
  const shown = subjects.filter(
    (s) => shownFilter.match(s)
      && (!needle
        || String(s.name ?? '').toLowerCase().includes(needle)
        || String(s.code ?? '').toLowerCase().includes(needle)
        || String(s.rollNo ?? '').toLowerCase().includes(needle)),
  );

  // The last fourteen. Past that the columns are thinner than their own labels,
  // and a trend nobody can read is not a trend.
  const recent = timeline.slice(-14);
  const withAcc = recent.filter((s) => s.accuracy != null);
  // A trend, stated only when there are two points to draw a line between.
  const drift = withAcc.length >= 2
    ? Math.round((withAcc[withAcc.length - 1].accuracy - withAcc[0].accuracy) * 100)
    : null;

  const sessionBars = (pick) =>
    bars(recent.map((s, i, arr) => ({
      label: dateOf(s.startedAt, DAY_NUM) || String(i + 1),
      value: pick(s) ?? 0,
      on: i === arr.length - 1,
    })));
  const levelBars = (pick) =>
    report.map((r) => ({ label: SHORT(r.level), value: pick(r) ?? 0, on: r.level === full?.currentLevel }));

  return (
    <Shell {...bar}>
      {head}

      {/* The working surface: who is being read, and their headline numbers. */}
      <div className="panel">
        <div className="panel-head">
          <span className="t">{copy.list}</span>
          <span className="panel-sub">
            {mine
              ? 'A picker with one entry would be furniture, so there is not one.'
              : shown.length === subjects.length
                ? `${plural(subjects.length, copy.one)} · most answers first`
                : `${shown.length} of ${subjects.length} shown`}
          </span>
          <span className="grow" />
          {/* A search box is worth its space at the size where scrolling the
              list stops being faster than typing a name. */}
          {!mine && subjects.length > 8 && (
            <span className="search" style={{ maxWidth: 220 }}>
              <Icon name="search" size={13} />
              <input
                type="search"
                value={query}
                aria-label={`Find a ${copy.one}`}
                placeholder={`Find a ${copy.one}`}
                onChange={(e) => setQuery(e.target.value)}
              />
            </span>
          )}
        </div>

        {!mine && subjects.length > 1 && (
          <div className="row" style={{ gap: 8, marginBottom: 12 }}>
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className="fpill"
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
                <b>{subjects.filter(f.match).length}</b>
              </button>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' }}>
          {!mine && (
            <div
              style={{
                flex: '1 1 260px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4,
                maxHeight: 460, overflowY: 'auto',
              }}
            >
              {shown.length === 0 ? (
                <div className="d-empty">
                  <b>Nobody matches that</b>
                  <span>The roster itself has not changed — clear the filter to see it again.</span>
                </div>
              ) : shown.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="d-row"
                  aria-selected={String(s.id) === String(sel.id)}
                  onClick={() => setPickedId(s.id)}
                >
                  <Avatar name={s.name} size="sm" className="on-d" />
                  <span className="t">
                    <b>{s.name || 'Name not recorded'}</b>
                    <span>
                      {s.rollNo || s.code}
                      {' · '}
                      {s.counts?.answered
                        ? plural(s.counts.answered, 'answer')
                        : 'nothing recorded'}
                      {s.active === false ? ' · deactivated' : ''}
                    </span>
                  </span>
                  <span className="mono" style={{ fontSize: 12, fontWeight: 700 }}>
                    {asPct(s.counts?.accuracy)}
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="accent" style={{ flex: mine ? '1 1 100%' : '2 1 360px', minWidth: 0 }}>
            <div className="k">{copy.picked}</div>
            <div className="row" style={{ gap: 12, marginTop: 8 }}>
              <Avatar name={sel.name} size="lg" className="on-d" />
              <div className="grow">
                <div style={{ font: '800 20px/1.2 var(--sans)', letterSpacing: '-0.02em' }}>
                  {sel.name || 'Name not recorded'}
                </div>
                <div className="k" style={{ marginTop: 5 }}>
                  {sel.rollNo ? `Roll ${sel.rollNo} · ` : ''}{sel.code}
                </div>
              </div>
              {sel.active === false && <span className="k">account deactivated</span>}
            </div>

            <div className="tiles" style={{ marginTop: 16 }}>
              <div className="accent-tile">
                <b>{counts.sessions ?? 0}<Icon name="broadcast" size={11} /></b>
                <span>{isProf ? 'Sessions run' : mine ? 'Sessions you have sat' : 'Sessions sat'}</span>
              </div>
              {isProf ? (
                <div className="accent-tile">
                  <b>{counts.students ?? 0}<Icon name="users" size={11} /></b>
                  <span>Students who turned up</span>
                </div>
              ) : (
                <div className="accent-tile">
                  <b>{counts.correct ?? 0}<Icon name="check" size={11} /></b>
                  <span>Answered right</span>
                </div>
              )}
              <div className="accent-tile">
                <b>{counts.answered ?? 0}<Icon name="layers" size={11} /></b>
                <span>Questions answered</span>
              </div>
              <div className="accent-tile">
                <b>{asPct(counts.accuracy)}<Icon name="activity" size={11} /></b>
                <span>{isProf ? 'Their classes’ accuracy' : mine ? 'Your accuracy' : 'Their accuracy'}</span>
              </div>
              {/* Named only when the server says the comparison holds. */}
              <div className="accent-tile">
                <b>{confident && bestLevel ? <span className={`tag sm ${bestLevel}`}>{LABEL[bestLevel]}</span> : 'Not yet'}</b>
                <span>Strongest level</span>
              </div>
              <div className="accent-tile">
                <b>{confident && weakLevel ? <span className={`tag sm ${weakLevel}`}>{LABEL[weakLevel]}</span> : 'Not yet'}</b>
                <span>Weakest level</span>
              </div>
            </div>

            {!isProf && full?.currentLevel && (
              <div className="row" style={{ gap: 10, marginTop: 16 }}>
                <span className="k">Working at</span>
                {/* .here sets its own radius, so it goes round the tag rather
                    than on it — otherwise the lime outline squares off a pill. */}
                <span className="here" style={{ display: 'inline-flex' }}>
                  <span className={`tag ${full.currentLevel}`}>{LABEL[full.currentLevel]}</span>
                </span>
                <span className="k">
                  {mine ? 'where the room was aiming questions when you last left it'
                    : 'where the room was aiming questions when they last left it'}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Volume, not accuracy — where the answers actually went. It is the one
            thing the chart below cannot say, because that chart deliberately
            reads a level met three times the same way as one met thirty. */}
        {seenTotal > 0 && (
          <div style={{ marginTop: 16 }}>
            <div className="eyebrow on-d">Where the answers went · {seenTotal} in total</div>
            <div className="dist" style={{ marginTop: 9 }}>
              {report.map((r) => (r.seen > 0
                ? <i key={r.level} className={`swatch ${r.level}`} style={{ flex: r.seen }} title={`${LABEL[r.level]} · ${r.seen}`} />
                : null))}
            </div>
          </div>
        )}
      </div>

      {/* --- the detail ------------------------------------------------- */}

      {detailError ? (
        <Card className="pad-lg" style={{ marginTop: 16 }}>
          <div className="note bad" role="alert">
            <Icon name="alert" size={15} />
            <span>{detailError}</span>
          </div>
        </Card>
      ) : busy || !full ? (
        <div style={{ marginTop: 16 }}><DetailSkeleton /></div>
      ) : (
        <>
          <div className="grid auto" style={{ marginTop: 16, marginBottom: 16 }}>
            <Stat
              label={isProf ? 'Sessions run' : 'Sessions sat'}
              icon="broadcast"
              value={counts.sessions ?? 0}
              delta={timeline.length
                ? `most recent on ${dateOf(timeline[timeline.length - 1].startedAt) || 'an unrecorded date'}`
                : 'no room on record yet'}
              tail={<TailBars bars={sessionBars((s) => (isProf ? s.joined : s.answered))} />}
            />
            <Stat
              label={isProf ? 'Students taught' : 'Questions answered'}
              icon={isProf ? 'users' : 'layers'}
              value={isProf ? (counts.students ?? 0) : (counts.answered ?? 0)}
              delta={isProf
                ? `${plural(counts.answered ?? 0, 'answer')} between them`
                : `${counts.correct ?? 0} of them right`}
              tail={<TailBars bars={levelBars((r) => r.seen)} />}
            />
            <Stat
              label={isProf ? 'Answers recorded' : 'Answered right'}
              icon={isProf ? 'layers' : 'check'}
              value={isProf ? (counts.answered ?? 0) : (counts.correct ?? 0)}
              delta={seenTotal
                ? `across ${plural(report.filter((r) => r.seen > 0).length, 'level')} of the six`
                : 'nothing answered yet'}
              tail={<TailBars bars={levelBars((r) => r.correct)} />}
            />
            <Stat
              label="Accuracy"
              icon="activity"
              tone={statTone(counts.accuracy)}
              value={asPct(counts.accuracy)}
              // Both roles average an average, and which average matters: a
              // student who answered forty questions does not outvote one who
              // answered four, and neither does a busy session outvote a short
              // one. The number has to say which one it is.
              delta={isProf
                ? 'the average of each student’s own accuracy'
                : mine
                  ? 'the average of your per-session accuracy'
                  : 'the average of their per-session accuracy'}
              tail={<TailBars bars={sessionBars((s) => Math.round((s.accuracy ?? 0) * 100))} />}
            />
          </div>

          <Card className="pad-lg" style={{ marginBottom: 16 }}>
            <div className="cardhead">
              <h2>{mine ? 'Your cognitive profile' : 'Cognitive profile'}</h2>
              <span className="sub">
                {seenTotal
                  ? `${copy.profile} Bar height is accuracy, so a level met three times reads the same as one met thirty.`
                  : 'written by the classroom, one session at a time'}
              </span>
            </div>

            {seenTotal === 0 ? (
              <Empty icon="chart" title="No answers yet">
                Every level fills in from live sessions, so this stays empty until a room has run.
                There is nothing to estimate here — the profile is measured or it is absent.
              </Empty>
            ) : (
              <>
                <BloomBars report={report} currentLevel={full.currentLevel} />
                {full.currentLevel && (
                  <div className="hint" style={{ marginTop: 14 }}>
                    Lime marks {mine ? 'the level you are' : 'the level they are'} working at right now.
                    It is the level the room aims the next question at, and it is the only thing lime
                    ever means in BloomLoop.
                  </div>
                )}
              </>
            )}
          </Card>

          <div style={{ marginBottom: 16 }}>
            <Extremes best={full.best} weakest={full.weakest} confident={confident} you={mine} />
          </div>

          <Card className="pad-lg" style={{ marginBottom: 16 }}>
            <div className="cardhead">
              <h2>Topics</h2>
              <span className="sub">
                {topics.length
                  ? `${plural(topics.length, 'topic')} · most answered first, because the widest bar is not the same thing as the surest one`
                  : 'mined from the answers themselves, not from the syllabus'}
              </span>
            </div>

            {topics.length === 0 ? (
              <Empty icon="list" title="No topics on record">
                Topics come off the questions that were actually asked, so they appear as soon as a
                session has run over material with topics on it.
              </Empty>
            ) : (
              <Topics topics={topics} />
            )}
          </Card>

          <Card className="pad-lg" style={{ marginBottom: 16 }}>
            <div className="cardhead">
              <h2>Session by session</h2>
              <span className="sub">
                {recent.length
                  ? `${timeline.length > recent.length ? `the last ${recent.length} of ${timeline.length}` : plural(recent.length, 'session')} · oldest on the left`
                  : 'a trend needs a second session before it is a trend'}
              </span>
              <span className="grow" />
              {drift !== null && (
                <span className={`flag ${drift > 0 ? 'ok' : drift < 0 ? 'bad' : 'neutral'} nowrap`}>
                  <Icon name={drift > 0 ? 'trendUp' : drift < 0 ? 'trendDown' : 'minus'} size={11} />
                  {drift === 0 ? 'level' : `${drift > 0 ? '+' : ''}${drift} points`} since the first of these
                </span>
              )}
            </div>

            {recent.length === 0 ? (
              <Empty icon="clock" title="No sessions recorded">
                {isProf
                  ? 'This professor has not opened a room yet. Everything above is waiting on the first one.'
                  : mine
                    ? 'You have not sat a session yet. The first room you join writes the first bar here.'
                    : 'They have not sat a session yet — the first room they join writes the first bar here.'}
              </Empty>
            ) : (
              <>
                <Timeline rows={recent} kind={kind} />
                <div className="hint" style={{ marginTop: 14 }}>
                  {isProf
                    ? 'Height is that room’s accuracy, averaged over the students in it. Underneath: how many joined, and how many of them finished in the support band.'
                    : 'Height is that session’s accuracy. The colour is the level being asked at when it ended, so a rising line at a darker colour is harder work done better.'}
                </div>
              </>
            )}
          </Card>

          {isProf && (
            <Card className="pad-lg">
              <div className="cardhead">
                <h2>Their students</h2>
                <span className="sub">
                  {roster.length
                    ? `${plural(roster.length, 'student')} · ranked by accuracy across every session of theirs`
                    : 'nobody has sat one of their rooms yet'}
                </span>
              </div>

              {roster.length === 0 ? (
                <Empty icon="users" title="No students on record">
                  A student appears here the first time they type this professor&apos;s room code on
                  their phone — the roll number they type is the only join between the two.
                </Empty>
              ) : (
                <Roster students={roster} />
              )}
            </Card>
          )}
        </>
      )}
    </Shell>
  );
}
