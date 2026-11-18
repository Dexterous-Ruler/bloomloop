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
 * The page opens on a forest panel that says, in a sentence, what the list
 * adds up to: a class, a department, or the student's own record. Every figure
 * in it is the server's, summed or averaged here and labelled as that.
 *
 * Nothing here writes: analytics is two GETs. The id in the second is not a
 * capability either. The server checks it against the caller's own list and
 * answers 404 for anything outside it, the same as an id that does not exist.
 *
 * Every judgement on this screen is the server's. A level is named strongest
 * or weakest only when the server says the comparison holds, and anything
 * resting on fewer than three answers is labelled as that.
 *
 * The range in the page head is a display choice too: it picks how many of the
 * open record's sessions the trend and the session list show. The levels and
 * topics are the server's all-time tallies, which it does not split by date,
 * and their cards say so.
 *
 * Analytics fetches. AnalyticsView draws, and is what the dev gallery renders.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../lib/api.js';
import { LABEL, LEVELS } from '../lib/bloom.js';
import AccountShell from '../shell/AccountShell.jsx';
import { useViewer } from '../shell/viewer.js';
import { Avatar, Button, Chip, Empty, Fig, Icon, Level, Note, Panel, Section, Segmented, Spark } from '../ui/index.jsx';
import { LevelSpread } from '../ui/viz.jsx';
import {
  BAND, MIN_EVIDENCE, RANGES, arrange, asPct, commonWeakest, day, levelN, mean, plural, scope,
} from './insightData.js';
import { Hardest, InWords, LevelPairs, Spread, TopicGrid, TrendChart } from './insightParts.jsx';

/** Everything that is worded differently for the three roles, in one table. */
const FRAMING = {
  hod: {
    crumb: 'Analytics',
    title: 'Analytics',
    sub: 'How each professor’s classes are going, measured from the sessions their students sat.',
    tag: 'Your department',
    list: 'Professors',
    one: 'professor',
    many: 'professors',
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
    tag: 'Your class',
    list: 'Students',
    one: 'student',
    many: 'students',
    all: 'All students',
    empty: 'No students on your roster yet',
    emptyBody: 'A student appears here once they are on your roster, and has a record once they have sat a session. Invite one from your overview.',
    emptyTo: '/home',
    emptyAction: 'Go to your overview',
  },
  student: {
    crumb: 'Progress',
    title: 'Strengths and gaps',
    sub: 'Where you are strongest, and where to put the next hour. All of it was measured in a live room.',
    tag: 'Your record',
    empty: 'Nothing to analyse yet',
    emptyBody: 'Your record is written by the rooms you sit. Join one, answer a few questions, and the six levels start filling in.',
    emptyTo: '/join',
    emptyAction: 'Join a room',
  },
};

/** How many of a professor's students show before the rest are asked for. */
const ROSTER_FIRST = 10;

/* Narrowing the list is a display choice. Each filter carries its own test,
   so the count on it and the rows it leaves cannot disagree. */
const FILTERS = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'weak', label: 'Under 40%', match: (s) => s.counts?.accuracy != null && s.counts.accuracy < BAND },
  { id: 'quiet', label: 'No answers', match: (s) => !(s.counts?.answered > 0) },
  { id: 'off', label: 'Inactive', match: (s) => s.active === false },
];

/* ------------------------------------------------------------- the briefs */

/**
 * What the list adds up to, for a professor (their class) or a head of
 * department (their professors). Sums and averages of the overview's own rows;
 * the average is over people with answers, and says so.
 */
function GroupBrief({ role, copy, subjects, onShowWeak }) {
  const n = subjects.length;
  const withData = subjects.filter((s) => s.counts?.answered > 0);
  const avg = mean(withData.map((s) => s.counts?.accuracy).filter((v) => v != null));
  const under = subjects.filter(FILTERS[1].match).length;
  const answers = subjects.reduce((t, s) => t + (s.counts?.answered ?? 0), 0);
  const mode = commonWeakest(subjects);
  const isHod = role === 'hod';

  let line;
  if (isHod) {
    const ran = subjects.filter((s) => s.counts?.sessions > 0).length;
    line = ran === 0
      ? `None of your ${plural(n, 'professor')} has run a room yet.`
      : `${ran} of your ${plural(n, 'professor')} ${ran === 1 ? 'has' : 'have'} run a room${
        under ? `, and ${under} ${under === 1 ? 'has' : 'have'} students averaging under 40%` : ''}.`;
  } else {
    line = withData.length === 0
      ? `None of your ${plural(n, 'student')} has an answer on record yet.`
      : under
        ? `${under} of the ${plural(withData.length, 'student')} with answers ${under === 1 ? 'is' : 'are'} under 40% overall.`
        : `All ${plural(withData.length, 'student')} with answers are at 40% or above overall.`;
  }

  const tiles = isHod
    ? [
      { label: 'Professors', value: n, small: `${subjects.filter((s) => s.active !== false).length} active` },
      { label: 'Rooms run', value: subjects.reduce((t, s) => t + (s.counts?.sessions ?? 0), 0), small: 'between them' },
      { label: 'Students who turned up', value: subjects.reduce((t, s) => t + (s.counts?.students ?? 0), 0), small: `${answers} answers` },
      { label: 'Average accuracy', value: asPct(avg), small: 'of their class averages' },
    ]
    : [
      { label: 'Students', value: n, small: `${withData.length} with answers` },
      { label: 'Answers', value: answers, small: 'every room' },
      { label: 'Average accuracy', value: asPct(avg), small: 'of students with answers' },
      { label: 'Under 40%', value: under, small: 'overall accuracy' },
    ];

  return (
    <Panel className="in-brief in-brief-group" aria-label={`${copy.tag}, all time`}>
      <div className="in-brief-main">
        <div className="cluster">
          <span className="tag-mint">{copy.tag} · all time</span>
          <span className="in-brief-meta">{plural(n, copy.one)}</span>
        </div>
        <p className="in-brief-line">{line}</p>
        {mode && (
          <div className="brief">
            <b>Weakest</b>
            <span>
              <Level level={mode.level} /> is the level named weakest most often, for {mode.count} of
              the {copy.many} where the server could compare.
            </span>
          </div>
        )}
        {under > 0 && (
          <div className="cluster in-brief-acts">
            <Button variant="accent" icon="filter" onClick={onShowWeak}>Show the {under} under 40%</Button>
          </div>
        )}
      </div>
      <div className="in-tiles">
        {tiles.map((t, i) => (
          <div key={t.label} className="ptile" style={{ '--d': `${i * 0.6}s` }}>
            <span>{t.label}</span>
            <b>{t.value}</b>
            <small><span /><i>{t.small}</i></small>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/** A student's own record, said in a sentence, with the figures that carry it. */
function SelfBrief({ copy, full }) {
  const timeline = full?.timeline ?? [];
  const counts = full?.counts ?? {};
  const last = timeline[timeline.length - 1];
  const best = full?.best;
  const weakest = full?.weakest;

  let line;
  if (full?.reason) line = 'No roll number on your account yet.';
  else if (!timeline.length) line = 'Nothing recorded yet. The first room you join starts this record.';
  else if (full.confident && best && weakest && best.accuracy !== weakest.accuracy) {
    line = `Strongest at ${LABEL[best.level]}, weakest at ${LABEL[weakest.level]}. That is where the next hour goes.`;
  } else line = 'Not enough answers yet to call one level stronger than another.';

  return (
    <Panel className="in-brief" aria-label="Your record, all time">
      <div className="in-brief-main">
        <div className="cluster">
          <span className="tag-mint">{copy.tag} · all time</span>
          {last && <span className="in-brief-meta">Latest {day(last.startedAt) || 'undated'}</span>}
        </div>
        <p className="in-brief-line">{line}</p>
        {full?.reason ? (
          // The server's own sentence, verbatim. "No sessions" would be a lie
          // about their attendance.
          <p className="in-brief-sub">{full.reason}</p>
        ) : full?.confident && best && weakest && best.accuracy !== weakest.accuracy ? (
          <div className="brief">
            <b>Best</b><span>{LABEL[best.level]}: {best.correct} of {best.seen} right, {asPct(best.accuracy)}.</span>
            <b>Weak</b><span>{LABEL[weakest.level]}: {weakest.correct} of {weakest.seen} right, {asPct(weakest.accuracy)}.</span>
          </div>
        ) : null}
        {!timeline.length && !full?.reason && (
          <div className="cluster in-brief-acts">
            <Link className="btn btn-accent" to="/join"><Icon name="room" />Join a room</Link>
          </div>
        )}
      </div>
      {timeline.length > 0 && (
        <div className="in-tiles">
          <div className="ptile" style={{ '--d': '0s' }}>
            <span>Sessions sat</span>
            <b>{counts.sessions ?? 0}</b>
            <small><span>{day(timeline[0].startedAt) ? `since ${day(timeline[0].startedAt)}` : ''}</span></small>
          </div>
          <div className="ptile" style={{ '--d': '0.6s' }}>
            <span>Answers</span>
            <b>{counts.answered ?? 0}</b>
            <Spark values={timeline.map((s) => s.answered ?? 0)} label="Answers in each session" />
            <small><span>{counts.correct ?? 0} right</span></small>
          </div>
          <div className="ptile" style={{ '--d': '1.2s' }}>
            <span>Accuracy</span>
            <b>{asPct(counts.accuracy)}</b>
            <Spark values={timeline.map((s) => s.accuracy).filter((v) => v != null)} label="Accuracy in each session" />
            <small><span>latest {asPct(last?.accuracy)}</span><i>session mean</i></small>
          </div>
          <div className="ptile in-tile-level" style={{ '--d': '1.8s' }}>
            <span>Last session ended at</span>
            <b>{full.currentLevel ? LABEL[full.currentLevel] : '—'}</b>
            <Spark values={timeline.map((s) => levelN(s.workingLevel))} label="Level each session ended at" />
            <small><span>{full.currentLevel ? `level ${levelN(full.currentLevel)} of 6` : ''}</span></small>
          </div>
        </div>
      )}
    </Panel>
  );
}

/* ---------------------------------------------------------------- the list */

/**
 * The people this viewer may read: how they spread by accuracy, then one row
 * each with how much they have answered, how well, and the level they are
 * weakest at - named only when the server says that comparison holds.
 */
function People({ copy, subjects, sel, onPick, filter, onFilter, query, onQuery, listRef }) {
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
    <section className="card in-people" aria-label={copy.list} ref={listRef}>
      <div className="in-people-top">
        <Section
          title={copy.list}
          sub={shown.length === subjects.length
            ? `${subjects.length}, most answers first`
            : `${shown.length} of ${subjects.length} shown`}
        />
        <Spread
          values={subjects.map((s) => (s.counts?.answered > 0 ? s.counts.accuracy : null))}
          one={copy.one}
          many={copy.many}
        />
        {/* Worth its space once scrolling stops being faster than typing a name. */}
        {subjects.length > 8 && (
          <label className="search">
            <Icon name="search" />
            <input
              type="search"
              value={query}
              aria-label={`Find a ${copy.one}`}
              placeholder={`Find a ${copy.one}`}
              onChange={(e) => onQuery(e.target.value)}
            />
          </label>
        )}
        {subjects.length > 1 && (
          <Segmented
            label="Show"
            value={filter}
            onChange={onFilter}
            options={FILTERS.map((f) => ({ id: f.id, label: f.label, count: subjects.filter(f.match).length }))}
          />
        )}
      </div>

      <div className="in-people-cols" aria-hidden="true">
        <span>Name</span><span>Weakest level</span><span className="r">Accuracy</span>
      </div>

      {shown.length === 0 ? (
        <div className="in-none">
          <p className="muted">Nobody matches. The roster itself has not changed.</p>
          <Button size="sm" onClick={() => { onFilter('all'); onQuery(''); }}>Show everyone</Button>
        </div>
      ) : (
        <ul className="in-people-list">
          {shown.map((s) => {
            const answered = s.counts?.answered ?? 0;
            const acc = s.counts?.accuracy;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  className="rw in-person"
                  aria-current={String(s.id) === String(sel.id) ? 'true' : undefined}
                  onClick={() => onPick(s.id)}
                >
                  <span className="rw-main">
                    <span className="in-person-name">
                      <span className="strong clip">{s.name || 'Name not recorded'}</span>
                      {s.active === false && <span className="t-meta">inactive</span>}
                    </span>
                    <span className="t-meta clip">
                      <span className="mono">{s.rollNo || s.code}</span> · {answered ? plural(answered, 'answer') : 'nothing recorded'}
                    </span>
                  </span>
                  {s.confident && s.weakest
                    ? <Level level={s.weakest} />
                    : <span className="t-meta in-person-few">{answered ? 'Too few to compare' : ''}</span>}
                  <span className="in-person-acc" data-thin={answered < MIN_EVIDENCE ? 'true' : undefined} data-low={acc != null && acc < BAND ? 'true' : undefined}>
                    {asPct(acc)}
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
    <div className="stack" aria-busy="true">
      <div className="skel" style={{ height: 300, borderRadius: 'var(--r-4)' }} />
      <div className="in-pair-cards">
        <div className="skel" style={{ height: 260, borderRadius: 'var(--r-4)' }} />
        <div className="skel" style={{ height: 260, borderRadius: 'var(--r-4)' }} />
      </div>
      <div className="skel" style={{ height: 220, borderRadius: 'var(--r-4)' }} />
    </div>
  );
}

/** A list with a line of column labels that folds to two lines per row when narrow. */
function List({ cols, head, children, className = '' }) {
  return (
    <div className={`in-list ${className}`} style={{ '--cols': cols }}>
      <div className="in-list-head" aria-hidden="true">{head}</div>
      <ul>{children}</ul>
    </div>
  );
}

/** One student's sessions, newest first. */
function Sittings({ rows }) {
  return (
    <List
      cols="72px minmax(0, 1fr) 72px 64px 72px 128px"
      head={<><span>Date</span><span>Chapter</span><span className="r">Answered</span><span className="r">Right</span><span className="r">Accuracy</span><span>Ended at</span></>}
    >
      {rows.map((s, i) => (
        <li key={`${s.code}-${i}`} className="in-list-row">
          <span className="in-list-main">
            <span className="strong clip" title={s.title || undefined}>{s.title || 'Untitled session'}</span>
            {s.banded && <Chip tone="warn">Support band</Chip>}
          </span>
          <span className="in-list-cells">
            <span className="in-list-date">{day(s.startedAt) || 'No date'}</span>
            <span className="in-list-n">{s.answered}<span className="in-list-unit"> answered</span></span>
            <span className="in-list-n">{s.correct}<span className="in-list-unit"> right</span></span>
            <span className="in-list-n">{asPct(s.accuracy)}<span className="in-list-unit"> accuracy</span></span>
          </span>
          <span className="in-list-end"><Level level={s.workingLevel} /></span>
        </li>
      ))}
    </List>
  );
}

/** The rooms one professor has run, newest first. */
function Rooms({ rows }) {
  return (
    <List
      cols="72px minmax(0, 1fr) 64px 96px 72px"
      head={<><span>Date</span><span>Room</span><span className="r">Joined</span><span className="r">Support band</span><span className="r">Accuracy</span></>}
    >
      {rows.map((s, i) => (
        <li key={`${s.code}-${i}`} className="in-list-row">
          <span className="in-list-main"><span className="strong clip" title={s.title || undefined}>{s.title || s.code}</span></span>
          <span className="in-list-cells">
            <span className="in-list-date">{day(s.startedAt) || 'No date'}</span>
            <span className="in-list-n">{s.joined}<span className="in-list-unit"> joined</span></span>
            <span className="in-list-n">{s.banded}<span className="in-list-unit"> in the support band</span></span>
          </span>
          <span className="in-list-end in-list-n">{asPct(s.accuracy)}<span className="in-list-unit"> accuracy</span></span>
        </li>
      ))}
    </List>
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
  // Ten at first: past that a list is scrolled past, not read. Every row is
  // one press away, and the count on the button says how many are folded.
  const [all, setAll] = useState(false);
  const rows = all ? students : students.slice(0, ROSTER_FIRST);
  return (
    <>
      <List
        cols="minmax(0, 1fr) 72px 88px 72px 128px"
        head={<><span>Student</span><span className="r">Sessions</span><span className="r">Right</span><span className="r">Accuracy</span><span>Last ended at</span></>}
      >
        {rows.map((s) => {
          const low = s.accuracy != null && s.answered >= MIN_EVIDENCE && s.accuracy < BAND;
          return (
            <li key={s.rollNo} className="in-list-row">
              <span className="in-list-main">
                <span className="strong clip">{s.name || 'Name not recorded'}</span>
                <span className="t-meta mono">{s.rollNo}</span>
                {low && <Chip tone="warn">Under 40% overall</Chip>}
                {s.answered < MIN_EVIDENCE && <Chip>Few answers</Chip>}
              </span>
              <span className="in-list-cells">
                <span className="in-list-n">{s.sessions}<span className="in-list-unit">{s.sessions === 1 ? ' session' : ' sessions'}</span></span>
                <span className="in-list-n">{s.correct} of {s.answered}<span className="in-list-unit"> right</span></span>
                <span className="in-list-n">{asPct(s.accuracy)}<span className="in-list-unit"> accuracy</span></span>
              </span>
              <span className="in-list-end"><Level level={s.lastLevel} /></span>
            </li>
          );
        })}
      </List>
      {students.length > ROSTER_FIRST && (
        <div className="in-more">
          <Button size="sm" variant="ghost" icon={all ? 'chevronUp' : 'chevron'} aria-expanded={all} onClick={() => setAll((v) => !v)}>
            {all ? 'Show the first ten' : `Show all ${students.length}`}
          </Button>
        </div>
      )}
    </>
  );
}

/** Accuracy session by session, for the sessions the range keeps. */
function Trend({ full, isProf, mine, range }) {
  const timeline = full.timeline ?? [];
  const { shown, previous } = scope(timeline, range);
  const scored = shown.filter((s) => s.accuracy != null);
  const points = scored.map((s) => ({
    v: s.accuracy,
    label: day(s.startedAt),
    title: s.title || s.code,
    detail: isProf
      ? `${plural(s.joined ?? 0, 'student')}, ${s.banded ?? 0} in the support band`
      : `${s.correct} of ${s.answered} right`,
  }));
  const prev = previous.map((s) => s.accuracy).filter((v) => v != null);

  const whose = isProf ? 'Each point is a room, averaged over the students in it.' : '';
  const sub = shown.length === timeline.length
    ? `${plural(timeline.length, isProf ? 'room' : 'session')}, oldest to newest. ${whose || 'Point at the line for exact values.'}`
    : `The last ${shown.length} of ${timeline.length}${prev.length ? `, with the ${prev.length} before them dashed` : ''}. ${whose}`;

  return (
    <section className="card card-pad in-card" aria-label="Accuracy by session">
      <Section title={isProf ? 'Room accuracy by session' : mine ? 'Your accuracy by session' : 'Accuracy by session'} sub={sub.trim()} />
      {points.length ? (
        <TrendChart
          points={points}
          previous={prev}
          name={isProf ? 'Their rooms' : mine ? 'You' : 'This student'}
          prevName="Sessions before"
          label="Accuracy by session"
        />
      ) : (
        <p className="hint">No session in this range has a scored answer, so there is nothing to draw.</p>
      )}
    </section>
  );
}

function RecordBody({ full, mine, isProf, range }) {
  // Six rows in taxonomy order even when nothing has been answered.
  const report = Array.isArray(full.bloom) && full.bloom.length
    ? full.bloom
    : LEVELS.map((level) => ({ level, seen: 0, correct: 0, accuracy: null }));
  const seenTotal = report.reduce((n, r) => n + (r.seen ?? 0), 0);
  const timeline = full.timeline ?? [];
  const topics = full.topics ?? [];
  const roster = full.students ?? [];

  // The server's own sentence for an account with no roll number, verbatim.
  // "No sessions" would be a lie about their attendance. For a student's own
  // page the brief has already said it.
  if (full.reason) {
    return mine ? null : <section className="card card-pad"><p className="said">{full.reason}</p></section>;
  }

  if (seenTotal === 0 && timeline.length === 0) {
    return (
      <section className="card">
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
      </section>
    );
  }

  const { shown } = scope(timeline, range);
  // Said only when there are two sessions to compare, and as two figures: a
  // single "up 12 points" would read as a trend that two points cannot carry.
  const scored = shown.filter((s) => s.accuracy != null);
  const span = scored.length >= 2
    ? `first ${asPct(scored[0].accuracy)}, latest ${asPct(scored[scored.length - 1].accuracy)}`
    : null;

  const ended = Object.fromEntries(LEVELS.map((l) => [l, roster.filter((s) => s.lastLevel === l).length]));

  return (
    <>
      {timeline.length > 0 && <Trend full={full} isProf={isProf} mine={mine} range={range} />}

      <div className="in-pair-cards">
        <section className="card card-pad in-card" aria-label="By Bloom level">
          <Section title="By Bloom level" sub="Asked and right at each level, across every session." />
          {seenTotal === 0
            ? <p className="hint">No answers yet. Each level fills in as questions at it are answered.</p>
            : <LevelPairs bloom={report} current={isProf ? undefined : full.currentLevel} />}
          <div className="in-card-rule" />
          <InWords
            bloom={report}
            best={full.best}
            weakest={full.weakest}
            confident={full.confident}
            who={mine ? 'you' : isProf ? 'classes' : 'they'}
          />
        </section>

        <section className="card card-pad in-card" aria-label="Hardest topics">
          <Section
            title="Hardest topics"
            sub={`Lowest accuracy first, across every session.${topics.length >= 12 ? ' Of the 12 most answered.' : ''} Reported per topic, not per question.`}
          />
          {topics.length
            ? <Hardest topics={topics} />
            : <p className="hint">No topics recorded. A topic is counted when the questions answered carry one.</p>}
        </section>
      </div>

      {/* A student's record carries the topic report per level; a professor's
          does not, and an empty one is already said by the card above. */}
      {!isProf && full.topicLevels?.topics?.length > 0 && (
        <section className="card card-pad in-card" aria-label="Topics by level">
          <Section
            title="Topics by level"
            sub="Right of asked, for each topic at each level, across every session. Darker is stronger; an empty square was never asked."
          />
          <TopicGrid
            report={full.topicLevels}
            label={`${mine ? 'Your' : 'Their'} right answers of those asked, for each topic at each level`}
          />
        </section>
      )}

      {isProf && (
        <section className="card card-pad in-card" aria-label="Their students">
          <Section
            title="Their students"
            sub={roster.length ? `${roster.length}, highest accuracy first` : 'Nobody has sat one of their rooms yet.'}
          />
          {roster.length > 0 && (
            <>
              <div className="in-class">
                <div className="stack stack-2">
                  <h3 className="in-h4">By accuracy</h3>
                  <Spread values={roster.map((s) => (s.answered > 0 ? s.accuracy : null))} />
                </div>
                <div className="stack stack-2">
                  <h3 className="in-h4">Where each ended</h3>
                  <p className="t-meta">The level each student was at when their last session ended.</p>
                  <LevelSpread counts={ended} />
                </div>
              </div>
              <Roster students={roster} />
            </>
          )}
        </section>
      )}

      {timeline.length > 0 && (
        <section className="card in-card in-card-list" aria-label={isProf ? 'Rooms' : 'Sessions'}>
          <div className="in-card-pad">
            <Section
              title={isProf ? 'Rooms' : 'Sessions'}
              sub={`${shown.length === timeline.length ? timeline.length : `${shown.length} of ${timeline.length}`}, newest first${span ? ` · ${span}` : ''}`}
            />
          </div>
          {isProf ? <Rooms rows={[...shown].reverse()} /> : <Sittings rows={[...shown].reverse()} />}
          {isProf && (
            <p className="hint in-card-pad in-card-note">
              Accuracy is the room’s, averaged over the students in it. Support band counts those who
              finished that session under 40%.
            </p>
          )}
        </section>
      )}
    </>
  );
}

function Record({ sel, full, busy, error, mine, onReload, range }) {
  const isProf = (full?.kind ?? sel.kind) === 'professor';
  // From the record once it lands and from the list row until then, so
  // changing person changes these figures and does not blank them.
  const counts = full?.counts ?? sel.counts ?? {};
  const answered = counts.answered ?? 0;

  return (
    <div className="stack in-record">
      {!mine && (
        <section className="card in-who-card">
          <header className="in-who">
            <Avatar name={sel.name || sel.code || '?'} size="lg" />
            <div className="in-who-name">
              <h2 className="wrap-any">{sel.name || 'Name not recorded'}</h2>
              <p className="t-meta">
                {sel.rollNo && <>Roll <span className="mono">{sel.rollNo}</span> · </>}
                <span className="mono">{sel.code}</span>
              </p>
            </div>
            {sel.active === false && <Chip>Account deactivated</Chip>}
            {!isProf && full?.currentLevel && (
              <div className="in-at">
                <span className="t-meta">Last session ended at</span>
                <Level level={full.currentLevel} size="lg" />
              </div>
            )}
          </header>

          {/* An account with no roll number cannot be matched to any session, so
              a row of noughts would be a claim about attendance nobody can make. */}
          {!full?.reason && (
            <div className="figs ruled in-figs">
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
        </section>
      )}

      {/* A record already on screen stays there while it is read again; the
          skeleton is for a person whose record has not arrived at all. */}
      {error && !busy ? (
        <section className="card card-pad stack stack-3">
          <Note tone="bad" role="alert">{error}</Note>
          <div><Button icon="refresh" onClick={onReload}>Try again</Button></div>
        </section>
      ) : !full ? (
        <RecordSkel />
      ) : (
        <RecordBody full={full} mine={mine} isProf={isProf} range={range} />
      )}
    </div>
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
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [range, setRange] = useState('all');
  const top = useRef(null);
  const list = useRef(null);

  // A range that would show every session of this record is the same as All,
  // so it is offered disabled rather than as a choice that changes nothing.
  const sessions = full && !full.reason ? (full.timeline ?? []).length : 0;
  const can = (r) => r.n === Infinity || r.n < sessions;
  const shownRange = can(RANGES.find((r) => r.id === range) ?? RANGES[0]) ? range : 'all';

  const actions = (
    <>
      {ready && sel && sessions > 0 && (
        <Segmented
          label="Sessions in the trend"
          value={shownRange}
          onChange={setRange}
          options={RANGES.map((r) => ({ id: r.id, label: r.label, disabled: !can(r) }))}
        />
      )}
      <Button icon="refresh" busy={loading} onClick={onReload}>
        {mine && full?.reason ? 'Check again' : 'Refresh'}
      </Button>
    </>
  );

  const toTop = () => top.current?.scrollIntoView({ block: 'start' });

  let body;
  if (!ready && !error) {
    body = (
      <div className="stack stack-5" aria-busy="true">
        <div className="skel in-skel-panel" />
        <div className={mine ? 'stack' : 'in-an'}>
          {!mine && <div className="skel" style={{ height: 520, borderRadius: 'var(--r-4)' }} />}
          <div className="skel" style={{ height: 520, borderRadius: 'var(--r-4)' }} />
        </div>
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
      <div className="stack stack-5 in-an-page" data-step={mine ? 'detail' : step} ref={top}>
        {error && (
          <Note tone="bad" role="alert">
            That refresh did not come back ({error}). This is the last answer the server gave.
          </Note>
        )}
        {mine ? (
          <SelfBrief copy={copy} full={full} />
        ) : (
          <GroupBrief
            role={role}
            copy={copy}
            subjects={subjects}
            onShowWeak={() => {
              setFilter('weak');
              setQuery('');
              setStep('list');
              list.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
          />
        )}
        {mine ? (
          <Record sel={sel} full={full} busy={busy} error={detailError} mine onReload={onReload} range={shownRange} />
        ) : (
          <div className="in-an">
            <People
              copy={copy}
              subjects={subjects}
              sel={sel}
              filter={filter}
              onFilter={setFilter}
              query={query}
              onQuery={setQuery}
              listRef={list}
              onPick={(id) => { onPick(id); setStep('detail'); toTop(); }}
            />
            <div className="in-an-pane">
              <Button
                variant="ghost"
                size="sm"
                icon="back"
                className="in-an-back"
                onClick={() => { setStep('list'); toTop(); }}
              >
                {copy.all}
              </Button>
              {/* Keyed by person: a figure that counted from the last person's
                  value to this one's would pass through numbers that are nobody's. */}
              <Record key={sel.id} sel={sel} full={full} busy={busy} error={detailError} mine={false} onReload={onReload} range={shownRange} />
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <AccountShell
      current="analytics"
      crumb={mine ? copy.crumb : ready && subjects.length ? `${copy.crumb} · ${plural(subjects.length, copy.one)}` : copy.crumb}
      title={copy.title}
      sub={copy.sub}
      actions={actions}
      width={mine ? undefined : 'wide'}
    >
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
