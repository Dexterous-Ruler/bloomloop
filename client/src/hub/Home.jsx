/**
 * /hub - the Learning Hub's home: a signed-in student's own place between rooms.
 *
 * One call, hub.home() (GET /api/hub/home), drawn as it comes:
 *   - the brief: what is due for review now (each to its topic, and a review
 *     set), how their topics stand by state, and the server's `notice` that
 *     their professor can see this hub, said plainly near the top;
 *   - goals (to /hub/goals) and refresher paths from Get Ready checks;
 *   - their weeks: days practised and days rested, never a streak;
 *   - the mastery map: classes -> units -> chapters -> topics, then "Other
 *     chapters", each topic with its state, N and sentence.
 *
 * Every comparison is with the student's own past. There is no class figure,
 * rank, streak, badge or point anywhere on this page, and the reply carries
 * none. Every sentence here that comes from the server is shown as given.
 *
 * Home fetches. HomeView draws, and is what the dev gallery renders. Trouble
 * and StateMark are shared with Goals.jsx.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { useEnter } from '../lib/motion.js';
import { useViewer } from '../shell/viewer.js';
import { Button, Empty, Icon, Note, Panel, Section } from '../ui/index.jsx';
import HubPage from './HubPage.jsx';
import { hub } from './hubApi.js';
import { useHubLanguage } from './lang.js';
import RichText from './RichText.jsx';
import StateMark from './StateMark.jsx';

/* ------------------------------------------------------------------ words */

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The server's own state words, for a reply that leaves `states` out. */
const STATE_WORDS = {
  'not-started': 'Not started', 'not-sure': 'Not sure yet', 'in-progress': 'In progress', mastered: 'Mastered', 'needs-review': 'Needs review',
};
/** The order the counts are drawn in: furthest along first. */
export const STATE_ORDER = ['mastered', 'in-progress', 'not-sure', 'needs-review', 'not-started'];

export const topicPath = (id) => `/hub/t/${encodeURIComponent(id)}`;
const classPath = (id) => `/hub/c/${encodeURIComponent(id)}`;
const reviewSetPath = (ids) => `/hub/practice?topicIds=${ids.map(encodeURIComponent).join(',')}&mode=review`;

/* ------------------------------------------------------------------ dates */

// The server sends calendar days ('2026-12-04'). Read as a day where the
// student is, so a date never slips by one across time zones.
export function calendarDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? ''));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
function isToday(d) {
  const t = new Date();
  return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
}
export const DATE = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
const LONG_DAY = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
const DAY_MONTH = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });
const WEEKDAY = new Intl.DateTimeFormat('en-IN', { weekday: 'short' });

/**
 * When a topic's review comes, in the server's words ('now', 'in 3 minutes',
 * 'later today', 'tomorrow', 'on 2026-11-26'); only the bare date is set as a
 * day a person reads.
 */
export function reviewWhen(review) {
  const when = String(review?.when ?? '').trim();
  if (!when) return '';
  if (when === 'now') return 'Review due now';
  const m = /^on (\d{4}-\d{2}-\d{2})$/.exec(when);
  const d = m && calendarDay(m[1]);
  return `Review ${d ? `on ${DATE.format(d)}` : when}`;
}

/** "Based on 3 answers": the N a state rests on. */
export const answersText = (n) => (n > 0 ? `Based on ${plural(n, 'answer')}` : 'No answers yet');

/* ------------------------------------------------------------ the marks */

/** A topic's state as a shape: one copy for the hub, in StateMark.jsx. */
export { default as StateMark } from './StateMark.jsx';

/**
 * Counts by state as one bar, with its key: each state's mark, word and
 * count. The student's own topics only.
 */
export function StateBar({ counts = {}, words = STATE_WORDS, label, keyed = true }) {
  const total = STATE_ORDER.reduce((s, k) => s + (counts[k] ?? 0), 0);
  if (!total) return null;
  const said = STATE_ORDER.filter((k) => counts[k]).map((k) => `${counts[k]} ${(words[k] ?? k).toLowerCase()}`).join(', ');
  return (
    <div className="hub-home-bar">
      <span className="hub-home-bar-track" role="img" aria-label={`${label ? `${label}: ` : ''}${said}`}>
        {STATE_ORDER.filter((k) => counts[k]).map((k, i) => (
          <i key={k} data-state={k} style={{ flexGrow: counts[k], '--d': `${i * 70}ms` }} />
        ))}
      </span>
      {keyed && (
        <ul className="hub-home-bar-key" aria-hidden="true">
          {STATE_ORDER.filter((k) => counts[k]).map((k) => (
            <li key={k}><StateMark state={k} size={12} />{words[k] ?? k}<b>{counts[k]}</b></li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* --------------------------------------------------------- trouble states */

/**
 * Why a hub page could not be drawn, calmly. 503: this server has no
 * accounts (the sentence, and the way back to rooms). 401: sign in. 403:
 * the wrong kind of account, and where theirs belongs. Anything else: the
 * sentence and Try again. Every sentence is the server's.
 */
export function Trouble({ error, what = 'Your hub', onRetry, busy = false }) {
  const status = typeof error === 'object' ? error?.status : undefined;
  const said = (typeof error === 'object' ? error?.message : error) || 'The server did not answer.';

  if (status === 503) {
    return (
      <section className="card hub-home-trouble" role="status" data-kind="setup">
        <Empty
          icon="info"
          title="The Learning Hub is not open on this server"
          action={<Link className="btn" to="/join"><Icon name="forward" />Join a room with a code</Link>}
        >
          {said} Rooms you join with a code work as before.
        </Empty>
      </section>
    );
  }
  if (status === 401) {
    return (
      <section className="card hub-home-trouble" role="status">
        <Empty icon="key" title="You are signed out" action={<Link className="btn btn-primary" to="/signin">Sign in</Link>}>
          {said}
        </Empty>
      </section>
    );
  }
  if (status === 403) {
    return (
      <section className="card hub-home-trouble" role="status">
        <Empty icon="users" title="Not for this account" action={<Link className="btn btn-primary" to="/hubs">Open the staff hub</Link>}>
          {said}
        </Empty>
      </section>
    );
  }
  return (
    <section className="card hub-home-trouble" role="alert">
      <Empty
        icon="alert"
        title={`${what} did not load`}
        action={onRetry && <Button variant="primary" icon="refresh" busy={busy} onClick={onRetry}>Try again</Button>}
      >
        {said} Nothing is lost: your progress is kept on the server, not in this page.
      </Empty>
    </section>
  );
}

/* ---------------------------------------------------------------- the brief */

const DUE_SHOWN = 4;

function DueRow({ r }) {
  const when = reviewWhen(r.review);
  return (
    <li>
      <Link to={topicPath(r.id)} className="hub-home-due-row">
        <span className="hub-home-due-topic"><RichText as="span" html={r.nameHtml} text={r.name} /></span>
        <span className="hub-home-due-meta">
          {r.chapter?.title && <RichText as="span" html={r.chapter.titleHtml} text={r.chapter.title} />}
          {when && <span>{when}</span>}
        </span>
        <Icon name="chevronRight" size={16} className="hub-home-due-go" />
      </Link>
    </li>
  );
}

/** The one dark panel: what is due now, how the topics stand, and who can see this hub. */
function Brief({ data }) {
  const reviews = data.reviews ?? {};
  const due = reviews.due ?? [];
  const upcoming = reviews.upcoming ?? [];
  const noClasses = !(data.classes ?? []).length;
  const counts = data.counts ?? {};
  const total = STATE_ORDER.reduce((s, k) => s + (counts[k] ?? 0), 0);
  const next = upcoming[0];
  const soon = next && /^in \d+ minutes?$/.test(String(next.review?.when ?? ''));

  let line;
  if (noClasses) line = 'Nothing to review yet.';
  else if (due.length) line = `${due.length === 1 ? 'One topic is' : `${due.length} topics are`} due for review.`;
  else line = 'Nothing is due for review now.';

  return (
    <Panel className={`hub-home-brief${total ? '' : ' hub-home-brief-solo'}`} aria-labelledby="hub-home-brief-line">
      <div className="hub-home-brief-main">
        <div className="cluster">
          <span className="tag-mint">Due now</span>
          <span className="hub-home-brief-date">{LONG_DAY.format(new Date())}</span>
        </div>
        <h2 className="hub-home-brief-line" id="hub-home-brief-line">{line}</h2>

        {noClasses && data.empty && <p className="hub-home-brief-sub">{data.empty}</p>}

        {due.length > 0 && (
          <>
            <ul className="hub-home-due" aria-label="Reviews due now">
              {due.slice(0, DUE_SHOWN).map((r) => <DueRow key={r.id} r={r} />)}
            </ul>
            <div className="hub-home-brief-acts">
              <Link className="btn btn-accent" to={reviewSetPath(due.map((r) => r.id))}>
                <Icon name="play" />Start a review set
              </Link>
              <Link className="btn" to="/hub/review">
                {due.length > DUE_SHOWN ? `All ${due.length} reviews` : 'All reviews'}
              </Link>
            </div>
            {reviews.setSize > 0 && (
              <p className="hub-home-brief-small">A review set is {plural(reviews.setSize, 'question')} across the topics due.</p>
            )}
          </>
        )}

        {!due.length && !noClasses && (
          next ? (
            <p className="hub-home-brief-sub">
              Next: <Link className="hub-home-brief-link" to={topicPath(next.id)}><RichText as="span" html={next.nameHtml} text={next.name} /></Link>
              {', '}{reviewWhen(next.review).replace(/^Review /, '')}.
              {upcoming.length > 1 && <> {plural(upcoming.length - 1, 'more review')} in the next seven days.</>}
              {soon && <> A short second session soon after the first is part of learning.</>}
              {' '}<Link className="hub-home-brief-link" to="/hub/review">See reviews</Link>
            </p>
          ) : (
            <p className="hub-home-brief-sub">A topic you have practised comes back here when a short review will help you keep it.</p>
          )
        )}

        {data.notice && (
          <p className="hub-home-seen">
            <Icon name="eye" size={15} />
            <span>{data.notice}</span>
          </p>
        )}
      </div>

      {total > 0 && (
        <section className="hub-home-brief-side" aria-labelledby="hub-home-topics-h">
          <h3 id="hub-home-topics-h" className="hub-home-panel-h">Your topics</h3>
          <p className="hub-home-brief-fig">
            <b>{counts.mastered ?? 0}</b>
            <span>of {plural(total, 'topic')} mastered</span>
          </p>
          <StateBar counts={counts} words={data.states ?? STATE_WORDS} label="Your topics by state" />
        </section>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------- goals and paths */

const GOALS_SHOWN = 3;

export function goalTitle(g) {
  const d = calendarDay(g.examDate);
  return g.title ? null : `Exam on ${d ? DATE.format(d) : g.examDate}`;
}

export function daysLeftText(g) {
  if (g.past) return 'passed';
  if (g.daysLeft === 0) return 'today';
  if (g.daysLeft === 1) return 'tomorrow';
  return `in ${g.daysLeft} days`;
}

function GoalRow({ g }) {
  const d = calendarDay(g.examDate);
  const fallback = goalTitle(g);
  return (
    <li className="hub-home-goal" data-past={g.past ? 'true' : undefined}>
      <div className="hub-home-goal-head">
        <h3>{fallback ?? <RichText as="span" html={g.titleHtml} text={g.title} />}</h3>
        <span className="hub-home-goal-date">
          <Icon name="calendar" size={14} />
          {d && <time dateTime={g.examDate}>{DATE.format(d)}</time>}
          <span>· {daysLeftText(g)}</span>
        </span>
      </div>
      <StateBar counts={g.counts} keyed={false} label="Topics in this goal" />
      {g.sentence && <p className="hub-home-goal-said">{g.sentence}</p>}
      {(g.focus ?? []).length > 0 && !g.past && (
        <div className="hub-home-focus">
          <span>Start with</span>
          <ul aria-label="Start with">
            {g.focus.map((f) => (
              <li key={f.id}>
                <Link to={topicPath(f.id)} data-state={f.state}>
                  <StateMark state={f.state} size={12} />
                  <RichText as="span" html={f.nameHtml} text={f.name} />
                  <span className="sr-only">, {f.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

function Goals({ goals, noClasses }) {
  const list = goals?.goals ?? [];
  const head = (
    <div className="hub-home-head">
      <Section title="Goals" sub={goals?.note || 'Only you see your goals.'} />
      {!noClasses && !goals?.unavailable && (
        <Link className="btn btn-sm" to="/hub/goals">{list.length ? 'Manage goals' : 'Set a goal'}</Link>
      )}
    </div>
  );
  let body;
  if (goals?.unavailable) body = <Note tone="warn">{goals.unavailable}</Note>;
  else if (list.length) {
    body = (
      <>
        <ul className="hub-home-goals">{list.slice(0, GOALS_SHOWN).map((g) => <GoalRow key={g.id} g={g} />)}</ul>
        {list.length > GOALS_SHOWN && <Link className="hub-home-more" to="/hub/goals">All {list.length} goals<Icon name="forward" size={14} /></Link>}
      </>
    );
  } else {
    body = (
      <div className="hub-home-none">
        <span className="hub-home-none-art" aria-hidden="true"><Icon name="target" size={18} /></span>
        <div>
          <h3>No goal yet</h3>
          <p>
            {noClasses
              ? 'A goal is an exam date and the topics it covers. You can set one once you are on a class in the hub.'
              : 'A goal is an exam date and the topics it covers. Set one, and how those topics stand shows here, with where to start.'}
          </p>
        </div>
      </div>
    );
  }
  return <section className="card card-pad hub-home-card" aria-label="Goals">{head}{body}</section>;
}

/** A ring: refresher steps done of all. */
function Ring({ done, of }) {
  const r = 17;
  const c = 2 * Math.PI * r;
  const share = of > 0 ? Math.min(1, done / of) : 0;
  return (
    <svg className="hub-home-ring" width="44" height="44" viewBox="0 0 44 44" aria-hidden="true" focusable="false">
      <circle cx="22" cy="22" r={r} className="t" />
      {share > 0 && <circle cx="22" cy="22" r={r} className="v" strokeDasharray={`${share * c} ${c}`} transform="rotate(-90 22 22)" />}
      <text x="22" y="26" textAnchor="middle">{done}/{of}</text>
    </svg>
  );
}

function Paths({ paths, noClasses }) {
  const list = paths?.paths ?? [];
  let body;
  if (paths?.unavailable) body = <Note tone="warn">{paths.unavailable}</Note>;
  else if (list.length) {
    body = (
      <ul className="hub-home-paths">
        {list.map((p) => (
          <li key={p.checkId}>
            <Ring done={p.done ?? 0} of={p.steps ?? 0} />
            <div className="hub-home-path-main">
              <h3>Before <RichText as="span" html={p.target?.nameHtml} text={p.target?.name} /></h3>
              {p.sentence && <p>{p.sentence}</p>}
              <div className="hub-home-path-acts">
                {p.next ? (
                  <Link className="btn btn-sm btn-primary" to={topicPath(p.next)}>Next: {p.nextName}</Link>
                ) : (
                  p.target?.id && <Link className="btn btn-sm btn-primary" to={topicPath(p.target.id)}>Open {p.target.name}</Link>
                )}
                <Link className="btn btn-sm btn-ghost" to={`/hub/ready/check/${encodeURIComponent(p.checkId)}`}>See the check</Link>
              </div>
            </div>
          </li>
        ))}
      </ul>
    );
  } else {
    body = (
      <div className="hub-home-none">
        <span className="hub-home-none-art" aria-hidden="true"><Icon name="path" size={18} /></span>
        <div>
          <h3>No refresher path yet</h3>
          <p>
            {noClasses
              ? 'Before a new topic, a short check asks about what it needs first. Your paths show here once you are on a class.'
              : 'Before a new topic, “Skip what I know · short check” asks a few questions on what it needs first, and lays out a short path from your answers.'}
          </p>
        </div>
      </div>
    );
  }
  return (
    <section className="card card-pad hub-home-card" aria-label="Refresher paths">
      <div className="hub-home-head">
        <Section title="Refresher paths" sub="From your Get Ready checks: what to brush up before a topic." />
        {!noClasses && <Link className="btn btn-sm btn-ghost" to="/hub/ready">Past checks</Link>}
      </div>
      {body}
    </section>
  );
}

/* ---------------------------------------------------------------- the weeks */

function weekName(w, i) {
  if (i === 0) return 'This week';
  if (i === 1) return 'Last week';
  const d = calendarDay(w.start);
  return d ? `From ${DAY_MONTH.format(d)}` : w.start;
}

/**
 * The last four weeks, one row each, newest first: a day practised is filled,
 * with its answers; a day not practised is rest, drawn as rest and never as a
 * miss; days still to come are faint. Nothing counts days in a row.
 */
function Weeks({ weeks }) {
  const rows = weeks?.weeks ?? [];
  const heads = (rows[0]?.days ?? []).map((d) => calendarDay(d.day)).filter(Boolean);
  return (
    <section className="card card-pad hub-home-card hub-home-weeks" aria-labelledby="hub-home-weeks-h">
      <div className="hub-home-head">
        <Section title={<span id="hub-home-weeks-h">Your weeks</span>} sub="The days you practised and the days you rested." />
      </div>
      {rows.length > 0 ? (
        <div className="hub-home-cal">
          <div className="hub-home-cal-row hub-home-cal-heads" aria-hidden="true">
            <span />
            <span className="hub-home-cal-days">{heads.map((d) => <b key={d.toISOString()}>{WEEKDAY.format(d)}</b>)}</span>
            <span />
          </div>
          {rows.map((w, i) => (
            <div className="hub-home-cal-row" key={w.start}>
              <span className="hub-home-cal-name">{weekName(w, i)}</span>
              <ol className="hub-home-cal-days" aria-label={weekName(w, i)}>
                {(w.days ?? []).map((d) => {
                  const date = calendarDay(d.day);
                  const kind = d.upcoming ? 'upcoming' : d.practised ? 'practised' : 'rest';
                  const today = date ? isToday(date) : false;
                  const said = `${date ? LONG_DAY.format(date) : d.day}${today ? ', today' : ''}: ${
                    kind === 'practised' ? `practised, ${plural(d.attempts, 'answer')}` : kind === 'rest' ? 'rested' : 'still to come'}`;
                  return (
                    <li key={d.day} data-kind={kind} data-today={today ? 'true' : undefined}>
                      <span className="sr-only">{said}</span>
                      <span aria-hidden="true">{kind === 'practised' ? d.attempts : ''}</span>
                    </li>
                  );
                })}
              </ol>
              <p className="hub-home-cal-said">{w.sentence}</p>
            </div>
          ))}
          <p className="hub-home-key" aria-hidden="true">
            <span><i className="hub-home-key-day" data-kind="practised" />Practised, with the answers given</span>
            <span><i className="hub-home-key-day" data-kind="rest" />Rest</span>
          </p>
        </div>
      ) : (
        <p className="hint">No weeks to show yet.</p>
      )}
      {weeks?.note && <p className="said">{weeks.note}</p>}
    </section>
  );
}

/* ----------------------------------------------------------- the mastery map */

export function TopicRow({ t }) {
  const s = t.state ?? {};
  // N always, except on a topic not started, whose sentence already says so.
  const words = [s.answers > 0 || s.state !== 'not-started' ? answersText(s.answers ?? 0) : '', reviewWhen(t.review)].filter(Boolean);
  return (
    <li className="hub-home-topic" data-state={s.state}>
      <StateMark state={s.state} />
      <div className="hub-home-topic-main">
        <div className="hub-home-topic-line">
          <Link className="hub-home-topic-name" to={topicPath(t.id)}>
            <RichText as="span" html={t.nameHtml} text={t.name} />
          </Link>
          <span className="hub-home-topic-state">
            {s.label}
            {s.provisional && s.answers > 0 && <span className="hub-home-prov">Provisional</span>}
          </span>
        </div>
        {s.sentence && <p className="hub-home-topic-said">{s.sentence}</p>}
        {words.length > 0 && <p className="hub-home-topic-meta">{words.join(' · ')}</p>}
      </div>
    </li>
  );
}

function Chapter({ c }) {
  return (
    <section className="hub-home-chapter">
      <h4><RichText as="span" html={c.titleHtml} text={c.title} /></h4>
      <ul>{(c.topics ?? []).map((t) => <TopicRow key={t.id} t={t} />)}</ul>
    </section>
  );
}

function ClassMap({ entry }) {
  const k = entry.class ?? {};
  const units = (entry.units ?? []).filter((u) => (u.chapters ?? []).length);
  const other = entry.otherChapters ?? {};
  const all = [...units.flatMap((u) => u.chapters), ...(other.chapters ?? [])].flatMap((c) => c.topics ?? []);
  const counts = {};
  all.forEach((t) => { counts[t.state?.state] = (counts[t.state?.state] ?? 0) + 1; });
  const sub = [k.section, k.termLabel].filter(Boolean).join(' · ');

  return (
    <article className="hub-home-class" aria-labelledby={`hub-home-class-${k.id}`}>
      <header className="hub-home-class-head">
        <div className="hub-home-class-name">
          <h3 id={`hub-home-class-${k.id}`}><Link to={classPath(k.id)}>{k.courseName}</Link></h3>
          {sub && <small>{sub}</small>}
        </div>
        {all.length > 0 && (
          <div className="hub-home-class-sum">
            <span>{counts.mastered ?? 0} of {plural(all.length, 'topic')} mastered</span>
            <StateBar counts={counts} keyed={false} label={`${k.courseName}, topics by state`} />
          </div>
        )}
        <Link className="btn btn-sm btn-ghost hub-home-class-open" to={classPath(k.id)} aria-label={`Open ${k.courseName}`}>
          Open class<Icon name="chevronRight" size={14} />
        </Link>
      </header>

      {all.length === 0 && <p className="hint hub-home-class-none">Your professor has not added any chapters to this class yet.</p>}

      {units.map((u) => (
        <div key={u.id} className="hub-home-unit">
          <h4 className="hub-home-unit-name"><RichText as="span" html={u.nameHtml} text={u.name} /></h4>
          <div className="hub-home-chapters">{u.chapters.map((c) => <Chapter key={c.id} c={c} />)}</div>
        </div>
      ))}
      {(other.chapters ?? []).length > 0 && (
        <div className="hub-home-unit">
          <h4 className="hub-home-unit-name">{other.label || 'Other chapters'}</h4>
          <div className="hub-home-chapters">{other.chapters.map((c) => <Chapter key={c.id} c={c} />)}</div>
        </div>
      )}
    </article>
  );
}

function MasteryMap({ data }) {
  const classes = data.classes ?? [];
  return (
    <section className="card card-pad hub-home-card hub-home-map" aria-labelledby="hub-home-map-h">
      <div className="hub-home-head">
        <Section title={<span id="hub-home-map-h">Your classes and topics</span>} sub={data.basis} />
      </div>
      {classes.length ? (
        classes.map((entry) => <ClassMap key={entry.class?.id} entry={entry} />)
      ) : (
        <Empty
          icon="book"
          title="No class on the hub yet"
          action={<Link className="btn" to="/join"><Icon name="forward" />Join a room with a code</Link>}
        >
          {data.empty || 'None of your classes is on the hub yet.'} Rooms you join with a code work as before.
        </Empty>
      )}
    </section>
  );
}

/* ------------------------------------------------------------- the states */

/** The page in the shape it is about to take. */
function Waiting() {
  return (
    <>
      <div className="hub-home-skel-panel">
        <div className="stack stack-3">
          <div className="skel" style={{ height: 20, width: 150 }} />
          <div className="skel" style={{ height: 28, width: '62%' }} />
          <div className="skel" style={{ height: 50, marginTop: 6 }} />
          <div className="skel" style={{ height: 14, width: '80%', marginTop: 12 }} />
        </div>
        <div className="stack stack-3">
          <div className="skel" style={{ height: 12, width: 90 }} />
          <div className="skel" style={{ height: 30, width: 120 }} />
          <div className="skel" style={{ height: 8 }} />
          <div className="skel" style={{ height: 40 }} />
        </div>
      </div>
      <div className="hub-home-two">
        {[0, 1].map((i) => (
          <div key={i} className="card card-pad stack stack-3">
            <div className="skel" style={{ height: 18, width: 120 }} />
            <div className="skel" style={{ height: 70 }} />
          </div>
        ))}
      </div>
      <div className="card card-pad stack stack-3">
        <div className="skel" style={{ height: 18, width: 180 }} />
        {[0, 1, 2].map((i) => <div key={i} className="skel" style={{ height: 52 }} />)}
      </div>
    </>
  );
}

/**
 * @param data     the hub.home() reply, or null before the first one
 * @param loading  a read is in flight
 * @param error    the last read's refusal ({ message, status }) or a sentence, or ''
 * @param onRetry  ask again
 */
export function HomeView({ data, loading = false, error = '', onRetry }) {
  const { account } = useViewer();
  const box = useRef(null);
  const status = data ? 'ready' : error && !loading ? 'error' : 'loading';
  useEnter(box, status);

  const first = String(account?.fullName ?? '').trim().split(/\s+/)[0] || '';
  const title = status === 'ready' && first ? `Hi ${first}` : 'Your Learning Hub';
  const sub = 'What is due, your goals, your weeks and every topic on your classes.';
  const said = typeof error === 'object' ? error?.message : error;

  let body;
  if (status === 'loading') {
    body = <Waiting />;
  } else if (status === 'error') {
    body = <Trouble error={error} onRetry={onRetry} busy={loading} />;
  } else {
    const noClasses = !(data.classes ?? []).length;
    body = (
      <>
        {said && <Note tone="bad" role="alert">That read did not come back ({said}). This is what the server last said.</Note>}
        <Brief data={data} />
        <div className="hub-home-two">
          <Goals goals={data.goals} noClasses={noClasses} />
          <Paths paths={data.paths} noClasses={noClasses} />
        </div>
        <Weeks weeks={data.weeks} />
        <MasteryMap data={data} />
      </>
    );
  }

  return (
    <HubPage title={title} sub={sub}>
      <div className="hub-home" ref={box} aria-busy={status === 'loading' ? 'true' : undefined}>{body}</div>
    </HubPage>
  );
}

/* ----------------------------------------------------------- the container */

export default function Home() {
  const { version } = useHubLanguage();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    hub.home().then(
      (res) => { if (!alive) return; setData(res); setError(''); setLoading(false); },
      (err) => { if (!alive) return; setError({ message: err?.message || 'The server did not answer.', status: err?.status }); setLoading(false); },
    );
    return () => { alive = false; };
  }, [nonce, version]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);
  return <HomeView data={data} loading={loading} error={error} onRetry={retry} />;
}
