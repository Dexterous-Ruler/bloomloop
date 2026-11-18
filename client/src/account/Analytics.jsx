/**
 * /analytics - one screen, three roles.
 *
 * GET /api/analytics answers with the people the caller may read:
 *
 *   head of department  their professors
 *   professor           their students
 *   student             themselves, once
 *
 * and GET /api/analytics/:id answers with one of them in full, in one of two
 * shapes. So the screen is a list and a record. A student has a list of one,
 * which would be furniture, so for a student the record is the page; their
 * record rides along on the first answer and there is no second call.
 *
 * Nothing here writes: analytics is two GETs. The id in the second is not a
 * capability either. The server checks it against the caller's own list and
 * answers 404 for anything outside it, the same as an id that does not exist.
 *
 * Every judgement on this screen is the server's. A level is named strongest
 * or weakest only when the server says the comparison holds, and anything
 * resting on fewer than three answers is labelled as that.
 *
 * Analytics fetches. AnalyticsView draws, and is what the dev gallery renders.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../lib/api.js';
import { LEVELS } from '../lib/bloom.js';
import AccountShell from '../shell/AccountShell.jsx';
import { useViewer } from '../shell/viewer.js';
import { Button, Chip, Empty, Fig, Icon, Level, Meter, Note, Segmented } from '../ui/index.jsx';
import { LevelSpread } from '../ui/viz.jsx';
import { BAND, MIN_EVIDENCE, arrange, asPct, day, plural } from './insightData.js';
import { InWords, Levels } from './insightParts.jsx';

/** Everything that is worded differently for the three roles, in one table. */
const FRAMING = {
  hod: {
    crumb: 'Analytics',
    title: 'Analytics',
    sub: 'How each professor’s classes are going, measured from the sessions their students sat.',
    list: 'Professors',
    one: 'professor',
    all: 'All professors',
    empty: 'No professors to analyse yet',
    emptyBody: 'Analytics is built from live sessions, so it starts when one of your professors opens a room. Invite one from the department screen.',
    emptyTo: '/admin',
    emptyAction: 'Go to your department',
  },
  professor: {
    crumb: 'Analytics',
    title: 'Analytics',
    sub: 'Each student’s track record, across every room you have run.',
    list: 'Students',
    one: 'student',
    all: 'All students',
    empty: 'No students on your roster yet',
    emptyBody: 'A student appears here once they are on your roster, and has a record once they have sat a session. Invite one from your overview.',
    emptyTo: '/home',
    emptyAction: 'Go to your overview',
  },
  student: {
    crumb: 'Progress',
    title: 'Your progress',
    sub: 'Where you are strongest, and where to put the next hour. All of it was measured in a live room.',
    empty: 'Nothing to analyse yet',
    emptyBody: 'Your record is written by the rooms you sit. Join one, answer a few questions, and the six levels start filling in.',
    emptyTo: '/join',
    emptyAction: 'Join a room',
  },
};

/* Narrowing the list is a display choice. Each filter carries its own test,
   so the count on it and the rows it leaves cannot disagree. */
const FILTERS = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'weak', label: 'Under 40%', match: (s) => s.counts?.accuracy != null && s.counts.accuracy < BAND },
  { id: 'quiet', label: 'No answers', match: (s) => !(s.counts?.answered > 0) },
  { id: 'off', label: 'Inactive', match: (s) => s.active === false },
];

/* ---------------------------------------------------------------- the list */

/**
 * The people this viewer may read. Each row carries what the overview knows:
 * how much they have answered, how well, and the level they are weakest at -
 * named only when the server says that comparison holds.
 */
function People({ copy, subjects, sel, onPick }) {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');

  // Filtering narrows what is shown and never moves the selection. Who is
  // being read is the viewer's decision, and a filter quietly swapping it is
  // how somebody ends up reading the wrong student's marks.
  const shownFilter = FILTERS.find((f) => f.id === filter) ?? FILTERS[0];
  const needle = query.trim().toLowerCase();
  const shown = subjects.filter(
    (s) => shownFilter.match(s)
      && (!needle
        || String(s.name ?? '').toLowerCase().includes(needle)
        || String(s.code ?? '').toLowerCase().includes(needle)
        || String(s.rollNo ?? '').toLowerCase().includes(needle)),
  );

  return (
    <section className="card an-list" aria-label={copy.list}>
      <div className="an-list-top">
        <div className="cluster between baseline">
          <h3>{copy.list}</h3>
          <span className="t-meta">
            {shown.length === subjects.length
              ? `${subjects.length}, most answers first`
              : `${shown.length} of ${subjects.length} shown`}
          </span>
        </div>
        {/* Worth its space once scrolling stops being faster than typing a name. */}
        {subjects.length > 8 && (
          <label className="search">
            <Icon name="search" />
            <input
              type="search"
              value={query}
              aria-label={`Find a ${copy.one}`}
              placeholder={`Find a ${copy.one}`}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        )}
        {subjects.length > 1 && (
          <div className="an-filter">
            <Segmented
              label="Show"
              value={filter}
              onChange={setFilter}
              options={FILTERS.map((f) => ({ id: f.id, label: f.label, count: subjects.filter(f.match).length }))}
            />
          </div>
        )}
      </div>

      <div className="an-cols" aria-hidden="true">
        <span>Name</span><span>Weakest level</span><span className="r">Accuracy</span>
      </div>

      {shown.length === 0 ? (
        <div className="an-none">
          <p className="muted">Nobody matches. The roster itself has not changed.</p>
          <Button size="sm" onClick={() => { setFilter('all'); setQuery(''); }}>Show everyone</Button>
        </div>
      ) : (
        <ul className="an-people">
          {shown.map((s) => {
            const answered = s.counts?.answered ?? 0;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  className="rw an-person"
                  aria-current={String(s.id) === String(sel.id) ? 'true' : undefined}
                  onClick={() => onPick(s.id)}
                >
                  <span className="rw-main">
                    <span className="an-name">
                      <span className="strong clip">{s.name || 'Name not recorded'}</span>
                      {s.active === false && <span className="t-meta">inactive</span>}
                    </span>
                    <span className="t-meta clip">
                      {s.rollNo || s.code} · {answered ? plural(answered, 'answer') : 'nothing recorded'}
                    </span>
                  </span>
                  {s.confident && s.weakest
                    ? <Level level={s.weakest} />
                    : <span className="t-meta">{answered ? 'Too few to compare' : ''}</span>}
                  <span className="an-acc" data-thin={answered < MIN_EVIDENCE ? 'true' : undefined}>
                    {asPct(s.counts?.accuracy)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* -------------------------------------------------------------- the record */

function RecordSkel() {
  return (
    <div className="an-sec" aria-busy="true">
      <div className="skel" style={{ height: 16, width: 160 }} />
      <div className="skel" style={{ height: 152 }} />
      <div className="skel" style={{ height: 16, width: 120, marginTop: 8 }} />
      {[0, 1, 2, 3].map((i) => <div key={i} className="skel" style={{ height: 40 }} />)}
    </div>
  );
}

/** One student's sessions, newest first. */
function Sittings({ rows }) {
  return (
    <div className="in-rec-box an-sat">
      <div className="in-rec-head" aria-hidden="true">
        <span>Date</span><span>Chapter</span><span className="r">Answered</span>
        <span className="r">Correct</span><span className="r">Accuracy</span><span>Ended at</span>
      </div>
      <ul className="in-rec">
        {rows.map((s, i) => (
          <li key={`${s.code}-${i}`} className="in-rec-row">
            <span className="in-rec-main">
              <span className="strong clip" title={s.title || undefined}>{s.title || 'Untitled session'}</span>
              {s.banded && <Chip>Support band</Chip>}
            </span>
            <span className="in-rec-cells">
              <span className="in-rec-date">{day(s.startedAt) || 'No date'}</span>
              <span className="in-rec-n">{s.answered}<span className="in-rec-unit"> answered</span></span>
              <span className="in-rec-n">{s.correct}<span className="in-rec-unit"> correct</span></span>
              <span className="in-rec-n">{asPct(s.accuracy)}<span className="in-rec-unit"> accuracy</span></span>
            </span>
            <span className="in-rec-end"><Level level={s.workingLevel} /></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The rooms one professor has run, newest first. */
function Rooms({ rows }) {
  return (
    <div className="in-rec-box an-run">
      <div className="in-rec-head" aria-hidden="true">
        <span>Date</span><span>Room</span><span className="r">Joined</span>
        <span className="r">Support band</span><span className="r">Accuracy</span>
      </div>
      <ul className="in-rec">
        {rows.map((s, i) => (
          <li key={`${s.code}-${i}`} className="in-rec-row">
            <span className="in-rec-main"><span className="strong clip" title={s.title || undefined}>{s.title || s.code}</span></span>
            <span className="in-rec-cells">
              <span className="in-rec-date">{day(s.startedAt) || 'No date'}</span>
              <span className="in-rec-n">{s.joined}<span className="in-rec-unit"> joined</span></span>
              <span className="in-rec-n">{s.banded}<span className="in-rec-unit"> in the support band</span></span>
            </span>
            <span className="in-rec-end in-rec-n">{asPct(s.accuracy)}<span className="in-rec-unit"> accuracy</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A professor's students, in the server's order: highest accuracy first.
 *
 * The flag says "under 40% overall", not "support band". The band is a
 * judgement the server makes on one session; this row is a total across all
 * of them, and calling it the same thing would put a label on a student that
 * no session ever gave them.
 */
function Roster({ students }) {
  return (
    <div className="in-rec-box an-roster">
      <div className="in-rec-head" aria-hidden="true">
        <span>Student</span><span className="r">Sessions</span><span className="r">Right</span>
        <span className="r">Accuracy</span><span>Last ended at</span>
      </div>
      <ul className="in-rec">
        {students.map((s) => {
          const low = s.accuracy != null && s.answered >= MIN_EVIDENCE && s.accuracy < BAND;
          return (
            <li key={s.rollNo} className="in-rec-row">
              <span className="in-rec-main">
                <span className="strong clip">{s.name || 'Name not recorded'}</span>
                <span className="t-meta mono">{s.rollNo}</span>
                {low && <Chip>Under 40% overall</Chip>}
                {s.answered < MIN_EVIDENCE && <Chip>Few answers</Chip>}
              </span>
              <span className="in-rec-cells">
                <span className="in-rec-n">{s.sessions}<span className="in-rec-unit">{s.sessions === 1 ? ' session' : ' sessions'}</span></span>
                <span className="in-rec-n">{s.correct} of {s.answered}<span className="in-rec-unit"> right</span></span>
                <span className="in-rec-n">{asPct(s.accuracy)}<span className="in-rec-unit"> accuracy</span></span>
              </span>
              <span className="in-rec-end"><Level level={s.lastLevel} /></span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Topics, in the server's order: most answered first, because the topic met
 * twice at 0% is not the biggest problem on the page, it is the least known
 * thing on it.
 */
function Topics({ topics }) {
  return (
    <div className="in-rec-box an-topics">
      <div className="in-rec-head" aria-hidden="true">
        <span>Topic</span><span /><span className="r">Right</span><span className="r">Accuracy</span>
      </div>
      <ul className="in-rec">
        {topics.map((t) => (
          <li key={t.topic} className="in-rec-row">
            <span className="in-rec-main">
              <span className="wrap-any">{t.topic}</span>
              {t.seen < MIN_EVIDENCE && <Chip>Few answers</Chip>}
            </span>
            <span className="in-rec-cells">
              <span className="an-meter"><Meter value={t.correct} max={t.seen} /></span>
              <span className="in-rec-n">{t.correct} of {t.seen}<span className="in-rec-unit"> right</span></span>
            </span>
            <span className="in-rec-end in-rec-n">{asPct(t.accuracy)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RecordBody({ full, mine, isProf }) {
  // Six rows in taxonomy order even when nothing has been answered.
  const report = Array.isArray(full.bloom) && full.bloom.length
    ? full.bloom
    : LEVELS.map((level) => ({ level, seen: 0, correct: 0, accuracy: null }));
  const seenTotal = report.reduce((n, r) => n + (r.seen ?? 0), 0);
  const timeline = full.timeline ?? [];
  const topics = full.topics ?? [];
  const roster = full.students ?? [];

  // The server's own sentence for an account with no roll number, verbatim.
  // "No sessions" would be a lie about their attendance.
  if (full.reason) {
    return <div className="an-sec"><p className="said">{full.reason}</p></div>;
  }

  if (seenTotal === 0 && timeline.length === 0) {
    return (
      <div className="an-sec">
        <Empty
          icon="clock"
          title="Nothing recorded yet"
          action={mine ? <Link className="btn btn-primary" to="/join"><Icon name="room" />Join a room</Link> : undefined}
        >
          {isProf
            ? 'This professor has not opened a room yet. A record is measured in live sessions or it is absent: nothing here is estimated.'
            : mine
              ? 'You have not sat a session yet. The first room you join starts this record.'
              : 'They have not sat a session yet. The first room they join starts this record.'}
        </Empty>
      </div>
    );
  }

  // Said only when there are two sessions to compare, and as two figures: a
  // single "up 12 points" would read as a trend that two points cannot carry.
  const scored = timeline.filter((s) => s.accuracy != null);
  const span = scored.length >= 2
    ? `first ${asPct(scored[0].accuracy)}, latest ${asPct(scored[scored.length - 1].accuracy)}`
    : null;

  const ended = Object.fromEntries(LEVELS.map((l) => [l, roster.filter((s) => s.lastLevel === l).length]));

  return (
    <>
      <div className="an-two">
        <div className="an-sec">
          <div className="an-sec-head">
            <h3>Accuracy by level</h3>
            <span className="t-meta">right answers, of those asked</span>
          </div>
          {seenTotal === 0 ? (
            <p className="hint">No answers yet. Each level fills in as questions at it are answered.</p>
          ) : (
            <>
              <Levels bloom={report} current={full.currentLevel} />
              <p className="hint">
                How full a bar is shows how often answers at that level were right. The count under
                it is how much that rests on.
                {full.currentLevel ? ' Outlined is where the last session ended.' : ''}
              </p>
            </>
          )}
        </div>
        <div className="an-sec">
          <div className="an-sec-head"><h3>Strongest and weakest</h3></div>
          <InWords
            bloom={report}
            best={full.best}
            weakest={full.weakest}
            confident={full.confident}
            who={mine ? 'you' : isProf ? 'classes' : 'they'}
          />
        </div>
      </div>

      {isProf && roster.length > 0 && (
        <div className="an-sec">
          <div className="an-sec-head">
            <h3>Where their students are</h3>
            <span className="t-meta">the level each was at when their last session ended</span>
          </div>
          <LevelSpread counts={ended} />
        </div>
      )}

      <div className="an-sec an-sec-list">
        <div className="an-sec-head">
          <h3>{isProf ? 'Rooms' : 'Sessions'}</h3>
          <span className="t-meta">
            {timeline.length ? `${timeline.length}, newest first` : 'none yet'}
            {span ? ` · ${span}` : ''}
          </span>
        </div>
        {timeline.length > 0 && (isProf
          ? <Rooms rows={[...timeline].reverse()} />
          : <Sittings rows={[...timeline].reverse()} />)}
        {isProf && timeline.length > 0 && (
          <p className="hint an-list-note">
            Accuracy is the room’s, averaged over the students in it. Support band counts those who
            finished that session under 40%.
          </p>
        )}
      </div>

      {topics.length > 0 && (
        <div className="an-sec an-sec-list">
          <div className="an-sec-head">
            <h3>Topics</h3>
            <span className="t-meta">{topics.length}, most answered first</span>
          </div>
          <Topics topics={topics} />
        </div>
      )}

      {isProf && (
        <div className="an-sec an-sec-list">
          <div className="an-sec-head">
            <h3>Their students</h3>
            <span className="t-meta">
              {roster.length ? `${roster.length}, highest accuracy first` : 'nobody has sat one of their rooms yet'}
            </span>
          </div>
          {roster.length > 0 && <Roster students={roster} />}
        </div>
      )}
    </>
  );
}

function Record({ sel, full, busy, error, mine, onReload }) {
  const isProf = (full?.kind ?? sel.kind) === 'professor';
  // From the record once it lands and from the list row until then, so
  // changing person changes these figures and does not blank them.
  const counts = full?.counts ?? sel.counts ?? {};
  const answered = counts.answered ?? 0;

  return (
    <section className="card an-record" aria-label={mine ? 'Your record' : `Record of ${sel.name || 'this person'}`}>
      <header className="an-who">
        <div className="grow stack stack-1">
          <h2 className="wrap-any">{mine ? 'Your record' : (sel.name || 'Name not recorded')}</h2>
          <p className="t-small muted">
            {sel.rollNo && <>Roll <span className="mono">{sel.rollNo}</span> · </>}
            <span className="mono">{sel.code}</span>
          </p>
        </div>
        {sel.active === false && <Chip>Account deactivated</Chip>}
        {!isProf && full?.currentLevel && (
          <div className="an-at">
            <span className="t-meta">Last session ended at</span>
            <Level level={full.currentLevel} size="lg" />
          </div>
        )}
      </header>

      {/* An account with no roll number cannot be matched to any session, so
          a row of noughts would be a claim about attendance nobody can make. */}
      {!full?.reason && (
        <div className="an-figs figs ruled">
          <Fig value={counts.sessions ?? 0} label={isProf ? 'sessions run' : 'sessions sat'} />
          {isProf && <Fig value={counts.students ?? 0} label="students who turned up" />}
          <Fig value={answered} label="answers" />
          {!isProf && <Fig value={counts.correct ?? 0} label="right" />}
          <Fig
            value={asPct(counts.accuracy)}
            label={answered > 0 && answered < MIN_EVIDENCE
              ? `accuracy, from only ${plural(answered, 'answer')}`
              : isProf ? 'accuracy, averaged per student' : 'accuracy, averaged per session'}
          />
        </div>
      )}

      {/* A record already on screen stays there while it is read again; the
          skeleton is for a person whose record has not arrived at all. */}
      {error && !busy ? (
        <div className="an-sec">
          <Note tone="bad" role="alert">{error}</Note>
          <div><Button icon="refresh" onClick={onReload}>Try again</Button></div>
        </div>
      ) : !full ? (
        <RecordSkel />
      ) : (
        <RecordBody full={full} mine={mine} isProf={isProf} />
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- the view */

/**
 * @param role         whose shape this is: the server's answer, or the account's until it lands
 * @param ready        the list has arrived at least once
 * @param loading      a read of the list is in flight
 * @param error        why the last read of the list failed, or ''
 * @param subjects     the people, arranged (see arrange())
 * @param sel          the one that is open, or null when there is nobody
 * @param full         that person's record, or null until it lands
 * @param busy         the record is being read
 * @param detailError  why the record did not load, or ''
 */
export function AnalyticsView({ role, ready, loading, error, subjects, sel, full, busy, detailError, onPick, onReload }) {
  const copy = FRAMING[role] ?? FRAMING.professor;
  const mine = role === 'student';
  // On a phone the list and the record are two steps. On a wide screen both
  // are on show and this is not read.
  const [step, setStep] = useState('list');

  const head = (
    <div className={`page-head in-head${!mine && step === 'detail' ? ' an-head-detail' : ''}`}>
      <div className="grow">
        <h1>{copy.title}</h1>
        <p className="t-lead lead">{copy.sub}</p>
      </div>
      <div className="acts">
        <Button icon="refresh" busy={loading} onClick={onReload}>
          {mine && full?.reason ? 'Check again' : 'Refresh'}
        </Button>
      </div>
    </div>
  );

  let body;
  if (!ready && !error) {
    body = (
      <div className={`an${mine ? ' an-solo' : ''}`} aria-busy="true">
        {!mine && <div className="skel" style={{ height: 480, borderRadius: 'var(--r-3)' }} />}
        <div className="skel" style={{ height: 560, borderRadius: 'var(--r-3)' }} />
      </div>
    );
  } else if (!ready) {
    body = (
      <div className="card">
        <Empty
          icon="alert"
          title="Could not read the analytics"
          action={<Button variant="primary" icon="refresh" busy={loading} onClick={onReload}>Try again</Button>}
        >
          {error}
        </Empty>
      </div>
    );
  } else if (!sel) {
    body = (
      <div className="card">
        <Empty
          icon="users"
          title={copy.empty}
          action={<Link className="btn btn-primary" to={copy.emptyTo}>{copy.emptyAction}<Icon name="forward" /></Link>}
        >
          {copy.emptyBody}
        </Empty>
      </div>
    );
  } else {
    body = (
      <>
        {error && (
          <Note tone="bad" className="in-gap" role="alert">
            That refresh did not come back ({error}). This is the last answer the server gave.
          </Note>
        )}
        <div className={`an${mine ? ' an-solo' : ''}`} data-step={mine ? 'detail' : step}>
          {!mine && (
            <People
              copy={copy}
              subjects={subjects}
              sel={sel}
              onPick={(id) => { onPick(id); setStep('detail'); window.scrollTo(0, 0); }}
            />
          )}
          <div className="an-pane">
            {!mine && (
              <Button
                variant="ghost"
                size="sm"
                icon="back"
                className="an-back"
                onClick={() => { setStep('list'); window.scrollTo(0, 0); }}
              >
                {copy.all}
              </Button>
            )}
            {/* Keyed by person: a figure that counted from the last person's
                value to this one's would pass through numbers that are nobody's. */}
            <Record key={sel.id} sel={sel} full={full} busy={busy} error={detailError} mine={mine} onReload={onReload} />
          </div>
        </div>
      </>
    );
  }

  return (
    <AccountShell current="analytics" crumb={copy.crumb} width={mine ? undefined : 'wide'}>
      {head}
      {body}
    </AccountShell>
  );
}

/* ----------------------------------------------------------- the container */

export default function Analytics() {
  const { account, loading: accountLoading } = useViewer();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloads, setReloads] = useState(0);

  const [pickedId, setPickedId] = useState('');

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
  const mine = role === 'student';

  const { subjects, sel } = useMemo(() => arrange(data, pickedId), [data, pickedId]);

  // A student's own record rides along on the list - the same object
  // GET /api/analytics/:id would return - so there is nothing to fetch.
  useEffect(() => {
    if (mine || !sel?.id) return undefined;
    let alive = true;
    setDetailLoading(true);
    api.analyticsFor(sel.id).then(
      (res) => { if (alive) { setDetail(res); setDetailError(''); setDetailLoading(false); } },
      (err) => {
        if (alive) {
          setDetail(null);
          setDetailError(err.message || 'That record did not load.');
          setDetailLoading(false);
        }
      },
    );
    return () => { alive = false; };
  }, [sel?.id, mine, reloads]);

  // A record is shown only under the person it was read for. While the next
  // one is on its way the last one is still in state, and its figures under a
  // different name would be somebody else's marks.
  const fetched = detail && String(detail.subject?.id) === String(sel?.id) ? detail : null;

  return (
    <AnalyticsView
      role={role}
      ready={Boolean(data) && !accountLoading}
      loading={loading}
      error={error}
      subjects={subjects}
      sel={sel}
      full={mine ? (data?.detail ?? null) : fetched}
      busy={mine ? loading : detailLoading}
      detailError={detailError}
      onPick={setPickedId}
      onReload={() => setReloads((n) => n + 1)}
    />
  );
}
