/**
 * /hub/review - the student's reviews: the topics due now (most overdue first)
 * and those coming up in the next 7 days, from GET /api/hub/review/due.
 *
 * A review is a short practice set: `setSize` questions in review mode over
 * the topics due, at /hub/practice?topicIds=...&mode=review, or one topic's
 * own set from its row. The first review after a topic's first practice can
 * come round within minutes; the page says that this is part of learning,
 * not a fault. `rule` (how a review's result sets the next one) and `empty`
 * are the server's sentences.
 *
 * Review fetches; ReviewView draws and is what dev/hubmap.gallery.jsx renders.
 */

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { useEnter } from '../lib/motion.js';
import { Icon, Panel, Section } from '../ui/index.jsx';
import { HubTrouble, answersLine, reviewHref, topicHref } from './ClassMap.jsx';
import { hub } from './hubApi.js';
import HubPage from './HubPage.jsx';
import { StateMark } from './MapGraph.jsx';
import RichText from './RichText.jsx';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The server takes at most this many topics in one set. */
const MAX_TOPICS = 20;

function Row({ t, due }) {
  const can = (t.practiceQuestions ?? 0) > 0;
  const sessions = t.review?.sessions ?? 0;
  return (
    <li className="hub-rev-row" data-due={due ? 'true' : undefined}>
      <StateMark state={t.state} />
      <div className="hub-rev-body">
        <Link className="hub-rev-name" to={topicHref(t.id)}><RichText as="span" html={t.nameHtml} text={t.name} /></Link>
        <span className="hub-rev-meta">
          {t.chapter?.title && <RichText as="span" html={t.chapter.titleHtml} text={t.chapter.title} />}
          <span className="hub-rev-state">{t.label}</span>
          <span>{answersLine(t.answers)}</span>
          {sessions > 0 && <span>{plural(sessions, 'session')} so far</span>}
        </span>
      </div>
      <span className="hub-rev-when">{due ? 'Due now' : t.review?.when}</span>
      {due && (can
        ? <Link className="btn btn-sm" to={reviewHref([t.id])} aria-label={`Review ${t.name} on its own`}>Review</Link>
        : <span className="hub-rev-cant">No questions to practise yet</span>)}
    </li>
  );
}

/** The page in the shape it is about to take. */
function Waiting() {
  return (
    <div className="hub-rev" aria-busy="true" aria-label="Loading your reviews">
      <div className="skel hub-rev-skel-hero" />
      <div className="hub-rev-two">
        {[0, 1].map((k) => (
          <div key={k} className="card card-pad hub-map-skel-list">
            {[72, 58, 66].map((w, i) => <span key={i} className="skel" style={{ width: `${w}%` }} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

function Ready({ data }) {
  const root = useRef(null);
  useEnter(root, 'review');
  const due = data.due ?? [];
  const upcoming = data.upcoming ?? [];
  const practisable = due.filter((t) => (t.practiceQuestions ?? 0) > 0);
  const next = upcoming[0];
  const size = data.setSize ?? 5;

  return (
    <div className="hub-rev" ref={root}>
      <Panel className="hub-rev-hero" aria-label="Due now">
        <div className="hub-rev-hero-main">
          <span className="tag-mint">Reviews</span>
          <h2 className="hub-map-goal">
            {due.length ? `${plural(due.length, 'topic is', 'topics are')} due for review` : (data.empty || 'Nothing is due for review now.')}
          </h2>
          <p className="hub-map-summary">
            A short second session soon after the first is part of learning: a topic can come back within minutes of your first
            practice, then later each time it holds.
          </p>
          {practisable.length > 0 ? (
            <div className="hub-map-hero-acts">
              <Link className="btn btn-accent" to={reviewHref(practisable.map((t) => t.id))}>Start a review set<Icon name="forward" /></Link>
              <span className="hub-map-hero-note">
                {size} questions across {practisable.length > MAX_TOPICS ? `the ${MAX_TOPICS} most overdue topics` : plural(practisable.length, 'topic')}.
              </span>
            </div>
          ) : next && (
            <p className="hub-rev-next">
              <Icon name="clock" size={14} />
              Next: <RichText as="span" html={next.nameHtml} text={next.name} /> {next.review?.when}.
            </p>
          )}
        </div>
        <div className="hub-rev-figs" aria-hidden="true">
          <div><b>{due.length}</b><span>due now</span></div>
          <div><b>{upcoming.length}</b><span>in 7 days</span></div>
        </div>
      </Panel>

      <div className="hub-rev-two">
        <section className="card card-pad" aria-label="Due now">
          <Section title="Due now" sub="Most overdue first." />
          {due.length
            ? <ol className="hub-rev-list">{due.map((t) => <Row key={t.id} t={t} due />)}</ol>
            : <p className="hub-map-none-line">{data.empty || 'Nothing is due for review now.'}</p>}
        </section>
        <section className="card card-pad" aria-label="Coming up">
          <Section title="Coming up" sub="Due in the next 7 days, soonest first." />
          {upcoming.length
            ? <ol className="hub-rev-list">{upcoming.map((t) => <Row key={t.id} t={t} />)}</ol>
            : <p className="hub-map-none-line">Nothing comes up for review in the next 7 days.</p>}
        </section>
      </div>

      {data.rule && (
        <div className="hub-rev-rule">
          <Icon name="info" size={15} />
          <p><b>How a review sets the next one.</b> {data.rule}</p>
        </div>
      )}
    </div>
  );
}

/**
 * @param data     GET /api/hub/review/due, or null before it arrives
 * @param error    the error the read threw, or null
 * @param busy     a read is in flight
 * @param onRetry  ask again
 */
export function ReviewView({ data, error = null, busy = false, onRetry }) {
  const crumb = <Link to="/hub">Learning Hub</Link>;
  const actions = <Link className="btn" to="/hub/errors"><Icon name="wrong" />Error log</Link>;
  let body;
  if (!data && error) body = <HubTrouble error={error} busy={busy} onRetry={onRetry} what="Your reviews" />;
  else if (!data) body = <Waiting />;
  else body = <Ready data={data} />;
  return <HubPage crumb={crumb} title="Reviews" actions={data ? actions : null}>{body}</HubPage>;
}

export default function Review() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setBusy(true);
    hub.reviewDue().then(
      (r) => { if (alive) { setData(r); setError(null); setBusy(false); } },
      (e) => { if (alive) { setError(e); setBusy(false); } },
    );
    return () => { alive = false; };
  }, [nonce]);

  return <ReviewView data={data} error={error} busy={busy} onRetry={() => setNonce((n) => n + 1)} />;
}
