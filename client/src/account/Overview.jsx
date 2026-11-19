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
 * GET /api/analytics/:id, and their stored answers GET /api/analytics/:id/answers,
 * both checked by the server against the same roster.
 *
 * The page reads top to bottom as: the brief (what matters now, in a sentence,
 * with the figures behind it), the students beside whichever one is open, then
 * the rooms and the chapters they came from.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { api } from '../lib/api.js';
import { LABEL, LEVELS } from '../lib/bloom.js';
import { reduced } from '../lib/motion.js';
import AccountShell from '../shell/AccountShell.jsx';
import { useViewer } from '../shell/viewer.js';
import {
  Avatar, Button, Chip, Dialog, Empty, Icon, Level, Note, Num, Panel, Section, Segmented, Spark, Tick, Tip,
} from '../ui/index.jsx';
import InviteStudents from './dashInvite.jsx';
import {
  ago, big, busiest, byLevel, Climb, dayOf, Facts, greeting, LevelRows, meanLevel, plural, Rate, roomLink, RoomDot,
  seriesOf, share, thinnest, todayLine, useMedia,
} from './dashParts.jsx';
import { AnswerFilters, AnswerList, TopicGrid, TopicGridSkel, useAnswers } from './insightParts.jsx';

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
/* The inspector is narrow: a short page of answers and the busiest topics,
   each with a way to the rest. */
const ANSWERS_SHOWN = 8;
const TOPICS_SHOWN = 8;

/* ------------------------------------------------------------------ pieces */

/** The page's shape while the first read is out: a brief, a list, an inspector. */
function Skeleton() {
  return (
    <div className="stack stack-5" aria-busy="true">
      <div className="ac-skel-panel">
        <div className="stack stack-3">
          <div className="skel" style={{ height: 20, width: 140 }} />
          <div className="skel" style={{ height: 26, width: '86%' }} />
          <div className="skel" style={{ height: 26, width: '60%' }} />
          <div className="skel" style={{ height: 14, width: '72%', marginTop: 8 }} />
          <div className="skel" style={{ height: 14, width: '64%' }} />
        </div>
        <div className="ac-skel-tiles">
          {[0, 1, 2, 3, 4].map((i) => <div key={i} className="skel" style={{ height: 104, borderRadius: 12 }} />)}
        </div>
      </div>
      <div className="ac-split">
        <div className="card ac-skel-list">
          <div className="skel" style={{ height: 18, width: 160 }} />
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="ac-skel-row">
              <div className="skel" style={{ width: 30, height: 30, borderRadius: 999 }} />
              <div className="skel" style={{ height: 14, flex: 1, maxWidth: 220 }} />
              <div className="skel" style={{ height: 14, width: 64 }} />
            </div>
          ))}
        </div>
        <div className="card ac-skel-list">
          <div className="skel" style={{ height: 44, width: 44, borderRadius: 999 }} />
          {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="skel" style={{ height: 10 }} />)}
        </div>
      </div>
    </div>
  );
}

/** Nothing loaded, nothing run, nobody invited: the three things, in order. */
function FirstRun({ canInvite, onInvite }) {
  return (
    <Panel className="ac-first" aria-label="Getting started">
      <div className="ac-first-say">
        <span className="tag-mint">Getting started</span>
        <h2 className="ac-lead">Three things get a class running.</h2>
        <p className="ac-first-sub">Do them in this order. Nothing here is needed again once a room has run.</p>
      </div>
      <ol className="ac-first-steps">
        <li>
          <span className="ac-first-n">1</span>
          <span className="grow">
            <b>Load a chapter</b>
            <span>A lesson deck or a pasted syllabus. Questions are written only from what is in it.</span>
          </span>
          <Link className="btn btn-accent ac-tap" to="/">Open the console<Icon name="forward" /></Link>
        </li>
        <li>
          <span className="ac-first-n">2</span>
          <span className="grow">
            <b>Open a room</b>
            <span>Once a bank is written, a room puts a six-character code on the projector and the class does the rest.</span>
          </span>
        </li>
        <li>
          <span className="ac-first-n">3</span>
          <span className="grow">
            <b>Invite your students</b>
            <span>
              Not needed to join: a room asks only for its code and a roll number. An account lets a student read
              their own history back afterwards.
            </span>
          </span>
          {canInvite && <Button className="ac-tap" icon="invite" onClick={onInvite}>Invite students</Button>}
        </li>
      </ol>
    </Panel>
  );
}

/**
 * The answers by level as six small columns, each numbered, so the tile says
 * where the class works without a colour having to say it alone.
 */
function LevelDist({ bloom }) {
  const map = byLevel(bloom);
  const top = Math.max(1, ...LEVELS.map((l) => map[l]?.seen ?? 0));
  return (
    <span
      className="ac-dist"
      role="img"
      aria-label={`Answers by level: ${LEVELS.map((l) => `${LABEL[l]} ${(map[l]?.seen ?? 0).toLocaleString()}`).join(', ')}`}
    >
      {LEVELS.map((l, i) => (
        <span key={l} data-level={l}>
          <i style={{ height: `${Math.max(8, ((map[l]?.seen ?? 0) / top) * 100)}%` }} />
          <b>{i + 1}</b>
        </span>
      ))}
    </span>
  );
}

/**
 * The brief: the one sentence that matters now, built from the room that is
 * live or the one that ran last, then where the answers sit and what to do
 * about it, beside the figures it was read from.
 */
function Brief({ counts, sessions, running, roster, bloom, contents, onAnalytics }) {
  const live = running.filter((r) => r.status === 'open');
  const focus = live[0] ?? running[0] ?? sessions[0] ?? null;
  const peak = busiest(bloom);
  const weak = thinnest(bloom);
  const seen = bloom.reduce((n, b) => n + (b.seen ?? 0), 0);
  const mean = meanLevel(bloom);
  const linked = roster.filter((s) => rollOf(s)).length;
  const noRoll = roster.length - linked;

  let lead;
  if (!focus) {
    lead = contents.length
      ? <>Nothing has run yet. <em>{plural(counts.questions, 'question')}</em> {counts.questions === 1 ? 'is' : 'are'} written and ready for a room.</>
      : <>Nothing has run yet, and no chapter is loaded to run from.</>;
  } else if (focus.status === 'open') {
    lead = (
      <>
        <em>{focus.title || 'Untitled room'}</em> is live, with {plural(focus.joined, 'student')} in
        {focus.accuracy != null && <> at {share(focus.accuracy)} so far</>}.
        {focus.banded > 0 && <> {plural(focus.banded, 'is', 'are')} in the support band.</>}
      </>
    );
  } else if (focus.status === 'paused') {
    lead = <><em>{focus.title || 'Untitled room'}</em> is paused, with {plural(focus.joined, 'student')} holding their place.</>;
  } else if (focus.status === 'waiting') {
    lead = <><em>{focus.title || 'Untitled room'}</em> is waiting for you to start it, with {plural(focus.joined, 'student')} in.</>;
  } else {
    lead = (
      <>
        Your last room, <em>{focus.title || 'Untitled room'}</em>
        {dayOf(focus.startedAt) && <> on {dayOf(focus.startedAt)}</>}, closed
        {focus.accuracy != null && <> at {share(focus.accuracy)}</>} with {plural(focus.joined, 'student')}.
      </>
    );
  }

  const lines = [];
  if (seen > 0 && peak) {
    lines.push(['Levels', weak && weak.level !== peak.level
      ? `Most answers land at ${LABEL[peak.level]}. ${LABEL[weak.level]} is the thinnest, at ${share(weak.accuracy)} of ${weak.seen.toLocaleString()} served.`
      : `Most answers land at ${LABEL[peak.level]}.`]);
    if (weak && weak.level !== peak.level) lines.push(['Next', `Weight the next bank towards ${LABEL[weak.level]}.`]);
  }
  if (noRoll > 0) {
    lines.push(['Roster', `${plural(noRoll, 'account has', 'accounts have')} no roll number, so no room can be matched to ${noRoll === 1 ? 'it' : 'them'}.`]);
  }

  const accuracy = seriesOf(sessions, 'accuracy');
  const banded = seriesOf(sessions, 'banded');
  const last = sessions.find((s) => s.accuracy != null);

  return (
    <Panel className="ac-brief" aria-label="Your classes today">
      <div className="ac-brief-say">
        <div className="cluster">
          <span className="tag-mint">Your classes today</span>
          {live.length > 0 && <span className="ac-brief-meta"><span className="live-dot" aria-hidden="true" />{plural(live.length, 'room')} live</span>}
        </div>
        <p className="ac-lead">{lead}</p>
        {lines.length > 0 && (
          <div className="brief">
            {lines.map(([k, v]) => <span key={k} style={{ display: 'contents' }}><b>{k}</b><span>{v}</span></span>)}
          </div>
        )}
        <div className="ac-brief-acts">
          {focus && (focus.status === 'open' || focus.status === 'paused' || focus.status === 'waiting') ? (
            <Link className="btn btn-accent ac-tap" to={roomLink(focus.code, 'live')}><Icon name="live" />Open the class</Link>
          ) : (
            <Button variant="accent" className="ac-tap" icon="analytics" onClick={onAnalytics}>Read the analytics</Button>
          )}
          {sessions.length > 0 && <Link className="btn ac-tap" to="/rooms">All rooms</Link>}
        </div>
      </div>

      <div className="ac-tiles">
        <div className="ptile">
          <span>Students</span>
          <b><Num value={big(counts.students ?? roster.length)} /></b>
          <small>{linked} linked <i>by roll number</i></small>
        </div>
        <div className="ptile" style={{ '--d': '0.7s' }}>
          <span>Rooms running</span>
          <b><Num value={running.length} /></b>
          <small>{live.length} live <i>{plural(counts.sessions, 'room')} run</i></small>
        </div>
        <div className="ptile" style={{ '--d': '1.4s' }}>
          <span>Mean accuracy</span>
          <b><Num value={share(counts.accuracy)} /></b>
          <Spark values={accuracy} label={`Accuracy in your last ${accuracy.length} rooms`} />
          <small>{last ? share(last.accuracy) : '—'} <i>last room</i></small>
        </div>
        <div className="ptile" style={{ '--d': '2.1s' }}>
          <span>Support band</span>
          <b><Num value={big(counts.banded)} /></b>
          <Spark values={banded} label={`Students in the support band, last ${banded.length} rooms`} />
          <small>sittings <i>under 40%</i></small>
        </div>
        <div className="ptile ac-tile-lv" style={{ '--d': '2.8s' }}>
          <span>Average level</span>
          <b>{mean ? mean.value.toFixed(1) : '—'}</b>
          {mean && <LevelDist bloom={bloom} />}
          <small>{mean ? `Nearest ${LABEL[mean.level]}` : 'No answers yet'} <i>of 6</i></small>
        </div>
      </div>
    </Panel>
  );
}

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

  const onCount = state.list ? state.list.filter((sup) => state.on?.[sup.key] === true).length : 0;

  return (
    <section className="ac-sec" aria-labelledby={`sup-head-${studentId}`}>
      <div className="ac-sec-head">
        <h3 className="ac-label" id={`sup-head-${studentId}`}>Supports</h3>
        {state.list && <span className="t-meta">{onCount} of {state.list.length} on</span>}
      </div>
      {state.loading ? (
        <div className="stack stack-2" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="ac-skel-row">
              <div className="skel" style={{ width: 18, height: 18, borderRadius: 5 }} />
              <div className="stack stack-1 grow">
                <div className="skel" style={{ height: 12, width: '40%' }} />
                <div className="skel" style={{ height: 10, width: '86%' }} />
              </div>
            </div>
          ))}
        </div>
      ) : state.error ? (
        <Note tone="bad">Their supports did not load: {state.error}</Note>
      ) : (
        <>
          <ul className="ac-sups">
            {state.list.map((sup) => {
              const on = state.on?.[sup.key] === true;
              return (
                <li key={sup.key}>
                  <label className="ac-sup" data-on={on ? 'true' : undefined}>
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={on}
                      disabled={Boolean(saving)}
                      onChange={(e) => toggle(sup.key, e.target.checked)}
                      aria-describedby={`sup-${studentId}-${sup.key}`}
                    />
                    <Tick on={on} />
                    <span className="ac-sup-txt">
                      <span className="ac-sup-name">{sup.label}</span>
                      <span className="ac-sup-what" id={`sup-${studentId}-${sup.key}`} title={sup.detail}>{sup.detail}</span>
                    </span>
                    {saving === sup.key && <span className="spinner" aria-label="Saving" />}
                  </label>
                </li>
              );
            })}
          </ul>
          {state.saveError && <Note tone="bad">Not saved: {state.saveError}</Note>}
          <p className="said">
            Applied the next time their phone joins one of your rooms. Only you see this list; their phone is told
            how to draw a question, never why.
          </p>
        </>
      )}
    </section>
  );
}

/**
 * One student in detail. The roll number is the whole story here: a live room
 * identifies a student by the number typed on their phone, so it is the only
 * thread between this account and the answers it gave.
 *
 * Under their levels sit the answers themselves: topic by level as a grid
 * (from the same GET /api/analytics/:id), then every stored answer across
 * your rooms, newest first, from GET /api/analytics/:id/answers. A square in
 * the grid narrows the list to that topic at that level.
 */
function StudentDetail({ student: s, detail, onRetry, services }) {
  const roll = rollOf(s);
  const d = detail?.data;
  const level = d?.currentLevel ?? null;
  const seen = (d?.bloom ?? []).reduce((n, b) => n + (b.seen ?? 0), 0);
  const rooms = d ? [...(d.timeline ?? [])].reverse().slice(0, 4) : [];
  const report = d?.topicLevels ?? null;

  // Asked for only when there is a roll number to match on and the record
  // itself was not refused: the list answers to the same check.
  const readable = Boolean(roll && !detail?.error && services?.studentAnswers);
  // "Read the overview again" re-reads this student's record. A record that
  // arrives in place of an earlier one bumps the list's version, so the
  // answers are read again with it. The first record does not: the list is
  // already on its way.
  const read = useRef({ data: null, n: 0 });
  if (d && d !== read.current.data) {
    read.current = { data: d, n: read.current.data ? read.current.n + 1 : read.current.n };
  }
  const answers = useAnswers((params) => services.studentAnswers(s.id, params), readable ? s.id : null, ANSWERS_SHOWN, read.current.n);
  // A square narrows the list, so it is pressable only while there is a list to narrow.
  const canPick = readable && !(answers.status === 'ready' && !answers.items.length && !answers.filtered);
  const listRef = useRef(null);
  const pickCell = (cell) => {
    answers.setFilters(cell);
    listRef.current?.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
  };

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
        <h3 className="ac-label">Level reached</h3>
        {!roll ? (
          <p className="muted t-small">Unknown. No room can be matched to this account.</p>
        ) : detail?.error ? (
          <Note tone="bad">
            Their results did not load: {detail.error}{' '}
            <button type="button" className="link ac-linkbtn" onClick={onRetry}>Try again</button>
          </Note>
        ) : !d ? (
          <div className="skel" style={{ height: 28, width: 180 }} />
        ) : level ? (
          <div className="ac-reached">
            <Level level={level} size="lg" />
            <span className="t-meta">
              in their last room · {plural(d.counts?.sessions, 'room')}, {plural(d.counts?.answered, 'answer')}, {share(d.counts?.accuracy)}
            </span>
          </div>
        ) : (
          <p className="muted t-small">None yet. Roll number <span className="mono">{roll}</span> has not sat one of your rooms.</p>
        )}
      </section>

      {roll && !detail?.error && (
        <section className="ac-sec">
          <div className="ac-sec-head">
            <h3 className="ac-label">Accuracy by level</h3>
            <span className="t-meta">correct of answered</span>
          </div>
          {!d ? (
            <div className="stack stack-2">{LEVELS.map((l) => <div key={l} className="skel" style={{ height: 14 }} />)}</div>
          ) : (
            <>
              <LevelRows bloom={d.bloom} current={level ?? undefined} />
              {reading && <p className="t-meta">{reading}</p>}
            </>
          )}
        </section>
      )}

      {rooms.length > 0 && (
        <section className="ac-sec">
          <h3 className="ac-label">Recent rooms</h3>
          <ul className="ac-mini">
            {rooms.map((r) => (
              <li key={`${r.code}-${r.startedAt}`}>
                <span className="grow">
                  <span className="clip ac-mini-t">{r.title || 'Untitled room'}</span>
                  <span className="t-meta">
                    <span className="mono">{r.code}</span>
                    {dayOf(r.startedAt) && ` · ${dayOf(r.startedAt)}`}
                    {r.workingLevel && ` · worked at ${LABEL[r.workingLevel] ?? r.workingLevel}`}
                  </span>
                </span>
                <Rate value={r.accuracy} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {roll && !detail?.error && (!d || report) && (
        <section className="ac-sec" aria-labelledby={`topics-h-${s.id}`}>
          <div className="ac-sec-head">
            <h3 className="ac-label" id={`topics-h-${s.id}`}>By topic</h3>
            <span className="t-meta">right of asked, at each level</span>
          </div>
          {!d ? (
            <TopicGridSkel rows={3} />
          ) : report.topics?.length ? (
            <>
              <TopicGrid
                report={report}
                compact
                first={TOPICS_SHOWN}
                picked={answers.filters}
                onPick={canPick ? pickCell : undefined}
                label={`${s.fullName || 'This student'}: right answers of those asked, for each topic at each level`}
              />
              {canPick && <p className="t-meta">Press a square to list those answers below.</p>}
            </>
          ) : (
            <p className="muted t-small">No topic on record yet. A topic is counted when a final, marked answer carries one.</p>
          )}
        </section>
      )}

      {readable && (
        <section className="ac-sec" aria-labelledby={`answers-h-${s.id}`} ref={listRef}>
          <div className="ac-sec-head">
            <h3 className="ac-label" id={`answers-h-${s.id}`}>Answers</h3>
            <span className="t-meta">newest first, every room</span>
          </div>
          <AnswerFilters answers={answers} topics={(report?.topics ?? []).map((t) => t.topic)} />
          <AnswerList
            answers={answers}
            view="teacher"
            compact
            label={`${s.fullName || 'This student'}: answers, newest first`}
            empty={report?.source === 'history' ? (
              <p>
                <b>None stored one by one.</b> Their rooms ran before each answer was kept, so those answers count in
                the levels above but have no rows here.
              </p>
            ) : (
              <p><b>No answers yet.</b> Nothing is stored for roll number <span className="mono">{roll}</span> in your rooms.</p>
            )}
          />
        </section>
      )}

      <section className="ac-sec">
        <h3 className="ac-label">How they are linked</h3>
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
      </section>

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
  const weakest = thinnest(bloom);

  return (
    <>
      <div className="ac-insp-head">
        <span className="avatar avatar-lg ac-insp-ic"><Icon name="users" size={18} /></span>
        <div className="grow">
          <h3>All your classes</h3>
          <div className="t-meta">{hasStudents ? 'Select a student to read their levels.' : 'Every room you have run, together.'}</div>
        </div>
      </div>

      <section className="ac-sec">
        <div className="ac-figs">
          <div><b><Num value={big(counts.attendances)} /></b><span>Seats filled</span></div>
          <div><b><Num value={big(counts.answered)} /></b><span>Answers</span></div>
          <div><b><Num value={share(counts.accuracy)} /></b><span>Mean accuracy</span></div>
          <div><b><Num value={big(counts.banded)} /></b><span>In the support band</span></div>
        </div>
        <p className="t-meta">
          Seats count sittings, not people: a student in four rooms is four. Accuracy is the mean of each
          student&rsquo;s own. A sitting under 40% overall is in the support band.
        </p>
      </section>

      <section className="ac-sec">
        <div className="ac-sec-head">
          <h3 className="ac-label">Accuracy by level</h3>
          <span className="t-meta">correct of answered</span>
        </div>
        <LevelRows bloom={bloom} current={seen ? peak?.level : undefined} />
        <p className="t-meta">
          {seen === 0
            ? 'Fills in from answers, not from banks. One room with one class puts six bars here.'
            : (
              <>
                Marked: {LABEL[peak.level]}, where most questions landed.
                {weakest && weakest.level !== peak.level && (
                  <> {LABEL[weakest.level]} is the thinnest at {share(weakest.accuracy)} of {weakest.seen.toLocaleString()} served, so weight the next bank towards it.</>
                )}
              </>
            )}
        </p>
      </section>
    </>
  );
}

/** One student as a row: who, the number that links them, and what is known of their climb. */
function StudentRow({ student: s, detail, selected, onPick }) {
  const roll = rollOf(s);
  const d = detail?.data;
  const lastRoom = d?.timeline?.length ? d.timeline[d.timeline.length - 1] : null;
  // The roster row carries the latest working level and last answer since the
  // server learned to send them; an opened student's detail is fresher still.
  // Either can be missing - never sat a room, or an older server - and then
  // the cell stays empty rather than guessing.
  const level = d?.currentLevel ?? s.currentLevel ?? null;
  const seenAt = lastRoom?.startedAt ?? s.lastSeenAt ?? null;
  return (
    <li>
      <button
        type="button"
        className="ac-person"
        aria-current={selected ? 'true' : undefined}
        data-off={s.active ? undefined : 'true'}
        onClick={() => onPick(s.id)}
      >
        <Avatar name={s.fullName} />
        <span className="ac-person-who">
          <span className="ac-person-name">
            <span className="clip">{s.fullName || 'Unnamed account'}</span>
            {!s.active && <Chip tone="line">Deactivated</Chip>}
          </span>
          <span className="ac-person-code">{s.code}</span>
        </span>
        <span className="ac-person-roll">
          {roll ? <span className="mono">{roll}</span> : <Chip tone="warn" icon="alert">No roll number</Chip>}
        </span>
        <span className="ac-person-lv">
          {level ? <Climb level={level} /> : detail?.loading ? <span className="skel" style={{ height: 14, width: 96 }} /> : null}
        </span>
        <span className="ac-person-seen">{seenAt ? ago(seenAt) : ''}</span>
        <Icon name="chevronRight" className="ac-person-go" />
      </button>
    </li>
  );
}

/** Rooms as a short feed: what is running first, then what ran last, each with its way back in. */
function RoomFeed({ sessions, running, contents, onOpenRoom }) {
  const rest = sessions.filter((s) => !running.includes(s));
  const feed = [...running, ...rest].slice(0, Math.max(ROOMS_SHOWN, running.length));

  return (
    <section className="card ac-card">
      <div className="ac-head">
        <Section title="Rooms" sub={running.length ? 'Running first, then the most recent.' : 'The most recent first.'} as="h2" />
        {sessions.length > 0 && <Link className="link ac-more" to="/rooms">All rooms<Icon name="forward" size={14} /></Link>}
      </div>
      {sessions.length === 0 ? (
        <div className="ac-quiet">
          <p className="t-small muted">
            {contents.length === 0
              ? 'No rooms run yet. Load a chapter and write a bank first: a room needs questions to serve.'
              : 'No rooms run yet. Your banks are written, so a room can go on the projector whenever the class is ready.'}
          </p>
          <Button className="ac-tap" icon="play" disabled={contents.length === 0} onClick={onOpenRoom}>Open a room</Button>
        </div>
      ) : (
        <ul className="ac-feed">
          {feed.map((r) => (
            <li key={r.code} className="ac-feed-row" data-status={r.status}>
              <RoomDot status={r.status} />
              <span className="ac-feed-main">
                <span className="ac-feed-t">
                  <span className="clip" title={r.title || undefined}>{r.title || 'Untitled room'}</span>
                  {r.status === 'open' && <Chip tone="ok" dot className="chip-live">Live</Chip>}
                  {r.status === 'paused' && <Chip tone="warn">Paused</Chip>}
                  {r.status === 'waiting' && <Chip tone="line" icon="clock">Waiting</Chip>}
                </span>
                <span className="t-meta">
                  <span className="mono">{r.code}</span>
                  {` · ${plural(r.joined, 'student')} · ${share(r.accuracy)}`}
                  {/* The dashboard's rows carry when a room opened, not when it paused. */}
                  {r.status === 'closed' ? (dayOf(r.startedAt) && ` · ${dayOf(r.startedAt)}`) : ` · opened ${ago(r.startedAt) || 'at an unrecorded time'}`}
                  {r.banded > 0 && ` · ${r.banded} in support band`}
                </span>
              </span>
              <Link
                className={`btn btn-sm ac-tap${r.status === 'open' ? ' btn-primary' : r.status === 'closed' ? ' btn-ghost' : ''}`}
                to={roomLink(r.code, 'live')}
              >
                {r.status === 'closed' ? 'Final standing' : 'Open the class'}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Chapters({ contents, counts }) {
  const [all, setAll] = useState(false);
  const chapters = all ? contents : contents.slice(0, CHAPTERS_SHOWN);
  return (
    <section className="card ac-card">
      <div className="ac-head">
        <Section title="Chapters in the console" sub={`${plural(counts.questions, 'question')} across ${plural(contents.length, 'chapter')}.`} as="h2" />
      </div>
      {contents.length === 0 ? (
        <Empty icon="deck" title="No material loaded yet" action={<Link className="btn btn-primary ac-tap" to="/"><Icon name="upload" />Load a chapter</Link>}>
          A lesson deck or a pasted syllabus is all it takes. Everything else here is written from what you already
          teach.
        </Empty>
      ) : (
        <ul className="ac-chapters">
          {chapters.map((c) => (
            <li key={c.id}>
              <Link className="ac-chapter" to={`/?content=${encodeURIComponent(c.id)}`}>
                <span className="ac-chapter-ic"><Icon name={c.kind === 'syllabus' ? 'material' : 'deck'} /></span>
                <span className="grow">
                  <span className="clip ac-chapter-t">{c.title || 'Untitled chapter'}</span>
                  <span className="t-meta">
                    {plural(c.topics, 'topic')} · {c.questions ? `${c.questions} approved` : c.drafts ? '' : 'no questions yet'}
                    {c.drafts > 0 && `${c.questions ? ' · ' : ''}${c.drafts} to review`}
                    {c.sessions > 0 && ` · ${plural(c.sessions, 'room')} run`}
                    {dayOf(c.createdAt) && ` · loaded ${dayOf(c.createdAt)}`}
                  </span>
                </span>
                {/* A bank that has never been in front of a class is the one
                    thing on this row worth acting on. */}
                {c.questions > 0 && !c.sessions && <Chip tone="accent">Not run yet</Chip>}
                <Icon name="chevronRight" className="ac-chapter-go" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {contents.length > CHAPTERS_SHOWN && (
        <div className="ac-foot">
          <Button size="sm" variant="ghost" className="ac-tap" onClick={() => setAll((v) => !v)}>
            {all ? 'Show fewer' : `Show all ${contents.length} chapters`}
          </Button>
        </div>
      )}
    </section>
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

  const running = sessions.filter((s) => s.status === 'open' || s.status === 'paused' || s.status === 'waiting');
  const live = running.filter((s) => s.status === 'open');

  const crumb = (
    <>
      {live.length > 0 && <span className="live-dot" aria-hidden="true" />}
      <span>{todayLine()}</span>
      {live.length > 0 && <><span aria-hidden="true">·</span><span>{plural(live.length, 'room')} live</span></>}
      {account?.code && <><span aria-hidden="true">·</span><span className="mono">{account.code}</span></>}
    </>
  );
  // The shared teacher key is not an account, and the server refuses it an
  // invite on purpose: there is no reporting line to hang a student off.
  const canInvite = Boolean(account);
  const title = account ? `${greeting()}, ${account.fullName || 'Professor'}` : 'Your teaching';

  if (loading) {
    return <AccountShell current="home" crumb={crumb} title={title}><Skeleton /></AccountShell>;
  }

  if (!data) {
    return (
      <AccountShell current="home" crumb={crumb} title={title}>
        <div className="card">
          <Empty
            icon="alert"
            title="Your overview did not load"
            action={<Button variant="primary" icon="refresh" busy={refreshing} onClick={onRefresh}>Try again</Button>}
          >
            {error || 'The server did not answer.'}
          </Empty>
        </div>
      </AccountShell>
    );
  }

  const counts = data.counts ?? {};
  const linked = roster.filter((s) => rollOf(s)).length;
  const blank = contents.length === 0 && sessions.length === 0 && roster.length === 0;
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

  const sub = blank
    ? 'Nothing is loaded yet. The console is where a chapter becomes a question bank and a bank becomes a room.'
    : `${plural(counts.contents, 'chapter')} and ${plural(counts.questions, 'question')} in the console, ${plural(counts.sessions, 'room')} run.`;

  const actions = (
    <span className="ac-headacts">
      <Tip label="Read the overview again">
        <Button variant="ghost" className="ac-tap" icon="refresh" busy={refreshing} aria-label="Read the overview again" onClick={onRefresh} />
      </Tip>
      {!blank && <Button className="ac-tap" icon="invite" disabled={!canInvite} onClick={() => setInviting(true)}>Invite students</Button>}
      {/* The one primary action is getting to the console. When a room is
          live that is the room, and this steps back for it. */}
      {!blank && (
        <Link className={`btn ac-tap${live.length > 0 ? '' : ' btn-primary'}`} to="/">Open the console<Icon name="forward" /></Link>
      )}
    </span>
  );

  const studentsCard = (
    <section className="card ac-card" aria-labelledby="ac-students-h">
      <div className="ac-head">
        <div className="sec">
          <h2 id="ac-students-h">Your students</h2>
          <p>
            {plural(roster.length, 'account reports', 'accounts report')} to you
            {roster.length > 0 && ` · ${linked} linked by roll number`}
          </p>
        </div>
        {canInvite && roster.length > 0 && (
          <Button size="sm" variant="ghost" className="ac-tap" icon="invite" onClick={() => setInviting(true)}>Invite</Button>
        )}
      </div>

      {roster.length === 0 ? (
        <Empty
          icon="users"
          title="Nobody reports to you yet"
          action={canInvite && <Button variant="primary" className="ac-tap" icon="invite" onClick={() => setInviting(true)}>Invite your first student</Button>}
        >
          Students join a room with its code and a roll number and need no account for that. An account lets them read
          their own history back afterwards.
        </Empty>
      ) : (
        <>
          <div className="ac-tools">
            <label className="search">
              <Icon name="search" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a name, code or roll number" aria-label="Find a student" />
            </label>
            <div className="ac-segbox">
              <Segmented
                label="Which students to show"
                value={filter}
                onChange={setFilter}
                options={FILTERS.map((f) => ({ id: f.id, label: f.label, count: roster.filter(f.match).length }))}
              />
            </div>
          </div>

          {shownRoster.length === 0 ? (
            <Empty
              icon="search"
              title="No student matches"
              action={<Button className="ac-tap" onClick={() => { setFilter('all'); setQuery(''); }}>Clear the filter</Button>}
            >
              Nothing on your roster answers to that.
            </Empty>
          ) : (
            <ul className="ac-people" aria-label="Students">
              {visible.map((s) => (
                <StudentRow key={s.id} student={s} detail={details[s.id]} selected={!narrow && s.id === sel?.id} onPick={pick} />
              ))}
            </ul>
          )}
          {shownRoster.length > visible.length || (allStudents && shownRoster.length > STUDENTS_SHOWN) ? (
            <div className="ac-foot">
              <Button size="sm" variant="ghost" className="ac-tap" onClick={() => setAllStudents((v) => !v)}>
                {allStudents ? 'Show fewer' : `Show all ${shownRoster.length} students`}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );

  return (
    <AccountShell current="home" crumb={crumb} title={title} sub={sub} actions={actions}>
      {(error || (data.role && data.role !== 'professor') || !canInvite) && (
        <div className="stack stack-3">
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
      )}

      {blank ? (
        <FirstRun canInvite={canInvite} onInvite={() => setInviting(true)} />
      ) : (
        <>
          <Brief
            counts={counts}
            sessions={sessions}
            running={running}
            roster={roster}
            bloom={bloom}
            contents={contents}
            onAnalytics={() => navigate('/analytics')}
          />

          <div className="ac-split">
            {studentsCard}
            <aside
              className="card ac-insp"
              aria-label={sel && !narrow ? `${sel.fullName || 'Student'} in detail` : 'All your classes'}
            >
              {sel && !narrow ? (
                <>
                  <div className="ac-insp-head">
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
              <div className="ac-foot">
                <Button size="sm" variant="ghost" className="ac-tap" icon="analytics" onClick={() => navigate('/analytics')}>Analytics</Button>
              </div>
            </aside>
          </div>

          <div className="ac-pair">
            <RoomFeed sessions={sessions} running={running} contents={contents} onOpenRoom={() => navigate('/')} />
            <Chapters contents={contents} counts={counts} />
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
          {sel && <div className="ac-insp is-flat">{detailOf(sel)}</div>}
        </Dialog>
      )}

      <InviteStudents open={inviting} onOpenChange={setInviting} services={services} />
    </AccountShell>
  );
}

/* --------------------------------------------------------------- container */

/* What the invite dialog, the supports panel and the answer list may call.
   Named once, so the dialog never reaches for the whole api and the dev
   gallery can stand in for these. */
const SERVICES = {
  invite: api.invite,
  classroomStatus: api.classroomStatus,
  classroomAuthUrl: api.classroomAuthUrl,
  classroomCourses: api.classroomCourses,
  classroomCourseStudents: api.classroomCourseStudents,
  studentAccommodations: api.studentAccommodations,
  setStudentAccommodations: api.setStudentAccommodations,
  studentAnswers: api.studentAnswers,
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
