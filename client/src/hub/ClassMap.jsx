/**
 * /hub/c/:classId - one class in a student's Learning Hub.
 *
 * GET /api/hub/classes/:id gives the class as its professor laid it out:
 * units, chapters, topics, then "Other chapters". It carries no states, so
 * GET /api/hub/progress (the student's own topics, each with its state, N,
 * sentence and review) is read beside it and matched by topic id. A failed
 * progress read leaves the layout up and says why.
 *
 * Everything shown is the student's own: their states and their answers.
 * There is no class figure, rank or streak here, and none is sent. Every
 * sentence is the server's, printed as it comes.
 *
 * ClassMap fetches; ClassMapView draws and is what dev/hubmap.gallery.jsx
 * renders. HubTrouble is the hub's refusal states (503, 401, 403, 404,
 * anything else), shared with Review.jsx and Errors.jsx.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { EASE, gsap, reduced, useEnter } from '../lib/motion.js';
import { Button, Empty, Icon, Panel, Section } from '../ui/index.jsx';
import { hub } from './hubApi.js';
import HubPage from './HubPage.jsx';
import { useHubLanguage } from './lang.js';
import { StateMark } from './MapGraph.jsx';
import RichText from './RichText.jsx';

/* ----------------------------------------------------------------- helpers */

export const topicHref = (topicId) => `/hub/t/${encodeURIComponent(topicId)}`;

/** A review set: practice in review mode over these topics, most overdue first (the server takes 20 at most). */
export const reviewHref = (ids) =>
  `/hub/practice?topicIds=${ids.slice(0, 20).map(encodeURIComponent).join(',')}&mode=review`;

export const answersLine = (n) => (n ? `based on ${n} ${n === 1 ? 'answer' : 'answers'}` : 'No answers yet');

/** "Review due now", "Review in 9 minutes", "Review tomorrow", "Review on 2026-11-26". */
export const reviewLine = (review) => {
  if (!review?.when) return '';
  return review.due ? 'Review due now' : `Review ${review.when}`;
};

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The state order a student reads them in: furthest along first. */
const ORDER = ['mastered', 'needs-review', 'in-progress', 'not-sure', 'not-started'];

/* ------------------------------------------------------------ the refusals */

/**
 * Why a hub screen has nothing to show, from the error lib/api.js threw: its
 * sentence as the server said it, and the one way on that fits.
 *
 *   503  this server has no accounts: a calm page, nothing to retry
 *   401  not signed in: a link to /signin
 *   403  a staff account on a student page: a link to the professor's hub
 *   404  not found (or not theirs): back to the hub
 *   else the sentence and Try again
 */
export function HubTrouble({ error, busy = false, onRetry, what = 'This page' }) {
  const status = error?.status;
  const said = error?.message || 'The server did not answer.';
  let body;
  if (status === 503) {
    body = <Empty icon="school" title="The Learning Hub is not open on this server">{said}</Empty>;
  } else if (status === 401) {
    body = (
      <Empty icon="login" title="You are signed out" action={<Link className="btn btn-primary" to="/signin">Sign in</Link>}>
        {said}
      </Empty>
    );
  } else if (status === 403) {
    body = (
      <Empty icon="lock" title="Not for this account" action={<Link className="btn btn-primary" to="/hubs">Go to the professor&rsquo;s hub</Link>}>
        {said}
      </Empty>
    );
  } else if (status === 404) {
    body = (
      <Empty icon="path" title="Not found" action={<Link className="btn btn-primary" to="/hub">Back to your hub</Link>}>
        {said}
      </Empty>
    );
  } else {
    body = (
      <Empty
        icon="alert"
        title={`${what} did not load`}
        action={(
          <div className="cluster">
            {onRetry && <Button variant="primary" icon="refresh" busy={busy} onClick={onRetry}>Try again</Button>}
            <Link className="btn btn-ghost" to="/hub">Back to your hub</Link>
          </div>
        )}
      >
        {said}
      </Empty>
    );
  }
  return <div className="card hub-trouble" data-status={status ?? 'failed'} role={status === 503 ? undefined : 'alert'}>{body}</div>;
}

/* ---------------------------------------------------------------- the hero */

/** A ring filled to done of total, drawn in once. */
function Ring({ done, of, word }) {
  const arc = useRef(null);
  const R = 46;
  const C = 2 * Math.PI * R;
  const share = of > 0 ? Math.max(0, Math.min(1, done / of)) : 0;
  useLayoutEffect(() => {
    const el = arc.current;
    if (!el) return undefined;
    const to = C * (1 - share);
    if (reduced()) { gsap.set(el, { strokeDashoffset: to }); return undefined; }
    const tween = gsap.fromTo(el, { strokeDashoffset: C }, { strokeDashoffset: to, duration: 1.1, ease: EASE, delay: 0.15 });
    const guard = setTimeout(() => tween.progress(1), 1900);
    return () => { clearTimeout(guard); tween.kill(); gsap.set(el, { strokeDashoffset: to }); };
  }, [C, share]);

  return (
    <div className="hub-map-ring" role="img" aria-label={`${done} of ${of} ${word}`}>
      <svg viewBox="0 0 110 110" aria-hidden="true" focusable="false">
        <circle cx="55" cy="55" r={R} className="trk" />
        {/* None at nought: a round cap would still draw a dot. */}
        {share > 0 && <circle ref={arc} cx="55" cy="55" r={R} className="arc" transform="rotate(-90 55 55)" strokeDasharray={C.toFixed(2)} strokeDashoffset={(C * (1 - share)).toFixed(2)} />}
      </svg>
      <span className="hub-map-ring-fig" aria-hidden="true"><b>{done} of {of}</b><small>{word}</small></span>
    </div>
  );
}

/**
 * What to do next in this class, from the student's own states: reviews due
 * first, then the topic they were last working through, then where to start.
 */
function nextStep(rows, basis) {
  const due = rows.filter((r) => r.state?.review?.due).sort((a, b) => Date.parse(a.state.review.dueAt) - Date.parse(b.state.review.dueAt));
  if (due.length) {
    return {
      head: `${plural(due.length, 'topic is', 'topics are')} due for review`,
      line: 'A short second session soon after the first is part of learning: a topic can come back within minutes of your first practice.',
      to: reviewHref(due.map((r) => r.id)),
      act: 'Start a review set',
    };
  }
  const answered = rows.filter((r) => (r.state?.answers ?? 0) > 0);
  if (!answered.length) {
    const first = rows.find((r) => r.state);
    return {
      head: 'Nothing practised here yet',
      line: 'Open a topic to read its lesson and practise. Each topic’s state rests on your own answers.',
      to: first ? topicHref(first.id) : null,
      act: first ? `Start with ${first.name}` : null,
    };
  }
  const going = rows.find((r) => r.state && r.state.state !== 'mastered' && r.state.answers > 0)
    ?? rows.find((r) => r.state && r.state.state !== 'mastered');
  if (!going) return { head: 'Every topic here is mastered', line: basis, to: null, act: null };
  const under = rows.filter((r) => ['in-progress', 'not-sure'].includes(r.state?.state)).length;
  return {
    head: under ? `${plural(under, 'topic')} under way` : `${plural(rows.filter((r) => r.state?.state === 'not-started').length, 'topic')} still to start`,
    line: basis,
    to: topicHref(going.id),
    act: `Continue with ${going.name}`,
  };
}

function Hero({ rows, progress, notice, statesError }) {
  const known = rows.filter((r) => r.state);
  const mastered = known.filter((r) => r.state.state === 'mastered').length;
  const tally = ORDER.map((s) => ({ s, label: progress?.states?.[s], n: known.filter((r) => r.state.state === s).length }))
    .filter((t) => t.n > 0 && t.label);
  const next = progress && known.length ? nextStep(rows, progress.basis) : null;

  return (
    <Panel className="hub-map-hero" aria-label="Where you stand in this class">
      <div className="hub-map-hero-main">
        <span className="tag-mint">Where you stand</span>
        {next ? (
          <>
            <h2 className="hub-map-goal">{next.head}</h2>
            {next.line && <p className="hub-map-summary">{next.line}</p>}
          </>
        ) : (
          <>
            <h2 className="hub-map-goal">Your topics in this class</h2>
            <p className="hub-map-summary">
              {statesError ? `Your states did not load: ${statesError}` : 'Every topic, in your professor’s order, with where you stand on it.'}
            </p>
          </>
        )}
        {tally.length > 0 && (
          <ul className="hub-map-tally" aria-label="Your topics by state">
            {tally.map((t) => (
              <li key={t.s}><StateMark state={t.s} /><b>{t.n}</b>{t.label}</li>
            ))}
          </ul>
        )}
        {next?.to && (
          <div className="hub-map-hero-acts">
            <Link className="btn btn-accent" to={next.to}>{next.act}<Icon name="forward" /></Link>
          </div>
        )}
        {notice && <p className="hub-map-notice"><Icon name="eye" size={14} />{notice}</p>}
      </div>
      {known.length > 0 && <Ring done={mastered} of={rows.length} word="mastered" />}
    </Panel>
  );
}

/* ----------------------------------------------------- units, chapters, topics */

function TopicRow({ topic, state }) {
  const s = state;
  const when = reviewLine(s?.review);
  return (
    <li>
      <Link className="hub-map-row" to={topicHref(topic.id)} data-state={s?.state ?? 'none'}>
        <StateMark state={s?.state ?? 'none'} />
        <span className="hub-map-row-name">
          <RichText as="span" html={topic.nameHtml} text={topic.name} />
          {s?.provisional && s.answers > 0 && <span className="hub-map-prov">Provisional</span>}
        </span>
        <span className="hub-map-row-meta">
          {s ? (
            <>
              <span className="hub-map-row-state">{s.label}</span>
              {/* Not started: the sentence says there are no answers. */}
              {s.answers > 0 && <span>{answersLine(s.answers)}</span>}
              {when && <span data-due={s.review.due ? 'true' : undefined}>{when}</span>}
            </>
          ) : <span>No state yet</span>}
        </span>
        {s?.sentence && <span className="hub-map-row-said">{s.sentence}</span>}
        <Icon name="chevronRight" size={14} />
      </Link>
    </li>
  );
}

function Chapters({ chapters, states }) {
  return chapters.map((c) => (
    <div key={c.id} className="hub-map-chapter">
      <RichText as="h4" html={c.titleHtml} text={c.title} />
      {(c.topics ?? []).length ? (
        <ol>
          {c.topics.map((t) => <TopicRow key={t.id} topic={t} state={states.get(t.id)?.state} />)}
        </ol>
      ) : <p className="hub-map-none-line">No topics in this chapter yet.</p>}
    </div>
  ));
}

function UnitsCard({ klass, states }) {
  const other = klass.otherChapters?.chapters ?? [];
  return (
    <section className="card card-pad hub-map-units" aria-label="Units, chapters and topics">
      <Section title="Units and chapters" sub="Every topic in this class, in your professor’s order. Open one for its lesson and practice." />
      {(klass.units ?? []).map((u) => (
        <div key={u.id} className="hub-map-unit">
          <RichText as="h3" className="hub-map-unit-title" html={u.nameHtml} text={u.name} />
          {(u.chapters ?? []).length
            ? <Chapters chapters={u.chapters} states={states} />
            : <p className="hub-map-none-line">No chapters in this unit yet.</p>}
        </div>
      ))}
      {other.length > 0 && (
        <div className="hub-map-unit">
          <h3 className="hub-map-unit-title">{klass.otherChapters.label}</h3>
          <Chapters chapters={other} states={states} />
        </div>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- the aside */

function ReviewsCard({ rows }) {
  const soon = Date.now() + 7 * 86400000;
  const listed = rows
    .filter((r) => r.state?.review?.dueAt && (r.state.review.due || Date.parse(r.state.review.dueAt) <= soon))
    .sort((a, b) => Date.parse(a.state.review.dueAt) - Date.parse(b.state.review.dueAt));
  return (
    <section className="card card-pad hub-map-side" aria-label="Reviews in this class">
      <Section title="Reviews" sub="When each topic you have practised here comes back, over the next 7 days." />
      {listed.length ? (
        <ol className="hub-map-revs">
          {listed.map((r) => (
            <li key={r.id} data-due={r.state.review.due ? 'true' : undefined}>
              <Link to={topicHref(r.id)}><RichText as="span" html={r.nameHtml} text={r.name} /></Link>
              <span>{r.state.review.due ? 'Due now' : r.state.review.when}</span>
            </li>
          ))}
        </ol>
      ) : <p className="hub-map-none-line">Nothing in this class comes back for review in the next 7 days.</p>}
      <Link className="hub-map-more" to="/hub/review">All your reviews<Icon name="chevronRight" size={14} /></Link>
    </section>
  );
}

function StatesCard({ progress }) {
  const labels = ORDER.filter((s) => progress.states?.[s]);
  return (
    <section className="card card-pad hub-map-side" aria-label="What the states mean">
      <Section title="The states" sub="A mark and a word for each, so none rests on colour." />
      <ul className="hub-map-legend">
        {labels.map((s) => <li key={s}><StateMark state={s} />{progress.states[s]}</li>)}
      </ul>
      {progress.basis && <p className="hub-map-basis">{progress.basis}</p>}
      <Link className="hub-map-more" to="/hub/errors">Your error log<Icon name="chevronRight" size={14} /></Link>
    </section>
  );
}

/* ---------------------------------------------------------------- the view */

/** The page in the shape it is about to take. */
function Waiting() {
  return (
    <div className="hub-map" aria-busy="true" aria-label="Loading this class">
      <div className="skel hub-map-skel-hero" />
      <div className="hub-map-two">
        <div className="card card-pad hub-map-skel-list">
          {[78, 64, 70, 52, 66].map((w, i) => <span key={i} className="skel" style={{ width: `${w}%` }} />)}
        </div>
        <div className="skel hub-map-skel-card" />
      </div>
    </div>
  );
}

function Ready({ klass, progress, statesError, statesBusy, onStatesRetry }) {
  const root = useRef(null);
  useEnter(root, klass.class?.id);
  const states = useMemo(() => new Map((progress?.topics ?? []).map((t) => [t.id, t])), [progress]);
  // Every topic of the class once, in the professor's order, with its state.
  const rows = useMemo(() => {
    const chapters = [...(klass.units ?? []).flatMap((u) => u.chapters ?? []), ...(klass.otherChapters?.chapters ?? [])];
    const seen = new Set();
    return chapters.flatMap((c) => c.topics ?? []).filter((t) => !seen.has(t.id) && seen.add(t.id))
      .map((t) => ({ ...t, state: states.get(t.id)?.state ?? null }));
  }, [klass, states]);

  if (klass.empty || !rows.length) {
    return (
      <div className="hub-map" ref={root}>
        <div className="card">
          <Empty icon="book" title="Nothing in this class yet" action={<Link className="btn" to="/hub">Back to your hub</Link>}>
            {klass.empty || 'Your professor has not added any topics to this class yet.'}
          </Empty>
        </div>
        {klass.notice && <p className="hub-map-notice-plain"><Icon name="eye" size={14} />{klass.notice}</p>}
      </div>
    );
  }

  return (
    <div className="hub-map" ref={root}>
      <Hero rows={rows} progress={progress} notice={klass.notice} statesError={statesError} />
      {statesError && (
        <div className="hub-map-stateserr" role="alert">
          <p><b>Your states did not load.</b> {statesError}</p>
          <Button size="sm" icon="refresh" busy={statesBusy} onClick={onStatesRetry}>Try again</Button>
        </div>
      )}
      <div className="hub-map-two">
        <UnitsCard klass={klass} states={states} />
        {progress && (
          <div className="hub-map-aside">
            <ReviewsCard rows={rows} />
            <StatesCard progress={progress} />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * @param klass         GET /api/hub/classes/:id, or null before it arrives
 * @param progress      GET /api/hub/progress, or null (not yet, or it failed)
 * @param error         the error the class read threw, or null
 * @param statesError   why the progress read failed, or ''
 * @param busy          a read is in flight
 * @param onRetry       ask for both again
 */
export function ClassMapView({ klass, progress = null, error = null, statesError = '', busy = false, onRetry }) {
  const crumb = <Link to="/hub">Learning Hub</Link>;
  const head = klass?.class;
  const actions = head
    ? <Link className="btn" to="/hub/exam"><Icon name="checklist" />Self-test</Link>
    : null;

  if (!klass && error) {
    return (
      <HubPage crumb={crumb} title="Your class">
        <HubTrouble error={error} busy={busy} onRetry={onRetry} what="This class" />
      </HubPage>
    );
  }
  if (!klass) return <HubPage crumb={crumb} title="Your class"><Waiting /></HubPage>;

  const sub = [head?.section, head?.termLabel].filter(Boolean).join(' · ');
  return (
    <HubPage crumb={crumb} title={head?.courseName || 'Your class'} sub={sub} actions={actions}>
      <Ready
        key={head?.id}
        klass={klass}
        progress={progress}
        statesError={statesError}
        statesBusy={busy}
        onStatesRetry={onRetry}
      />
    </HubPage>
  );
}

/* ----------------------------------------------------------- the container */

export default function ClassMap() {
  const { classId } = useParams();
  const { version } = useHubLanguage();
  const [klass, setKlass] = useState(null);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [statesError, setStatesError] = useState('');
  const [busy, setBusy] = useState(true);
  const [nonce, setNonce] = useState(0);

  // A different class in the address clears the one on screen.
  useEffect(() => { setKlass(null); setError(null); }, [classId]);

  useEffect(() => {
    let alive = true;
    setBusy(true);
    Promise.allSettled([hub.klass(classId), hub.progress()]).then(([k, p]) => {
      if (!alive) return;
      if (k.status === 'fulfilled') { setKlass(k.value); setError(null); } else setError(k.reason);
      if (p.status === 'fulfilled') { setProgress(p.value); setStatesError(''); } else setStatesError(p.reason?.message || 'The server did not answer.');
      setBusy(false);
    });
    return () => { alive = false; };
  }, [classId, nonce, version]);

  return (
    <ClassMapView
      klass={klass}
      progress={progress}
      error={error}
      statesError={klass ? statesError : ''}
      busy={busy}
      onRetry={() => setNonce((n) => n + 1)}
    />
  );
}
