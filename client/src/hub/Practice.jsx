/**
 * Practice in the Learning Hub, on one topic or a review set across topics.
 *
 *   /hub/t/:topicId/practice                    practice on one topic
 *   /hub/practice?topicIds=a,b&mode=review      a review set (setSize questions)
 *
 * The server picks each next question (hub.nextPractice) and never sends a
 * key. One attempt id per shown question, for its hints and its answer
 * (QuestionCard). The answer goes through hub.attempt, which keeps it on this
 * device when it cannot be stored now (a 409 "closed for now", no
 * connection). After the reply: right or wrong, the right answer and why, and
 * the topic's new state. `question: null` is the server's message.
 *
 * The language is the server's (useHubLanguage): after a switch an unanswered
 * question is asked for again, in the new language.
 *
 * No score, rank, streak, badge or points: the only figure is the topic's own
 * state, as the server words it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { Button, Empty, Icon, Note, Panel } from '../ui/index.jsx';
import HubPage from './HubPage.jsx';
import { hub } from './hubApi.js';
import { langAttr, useHubLanguage } from './lang.js';
import { usePending } from './pending.js';
import QuestionCard, { qid } from './QuestionCard.jsx';
import RichText from './RichText.jsx';
import { HubTrouble, StateBrief, StateMark } from './Topic.jsx';

const same = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Any opaque token the next-question reply carries (a serve token), echoed with the answer as sent. */
const tokensOf = (turn) => Object.fromEntries(
  Object.entries(turn ?? {}).filter(([k, v]) => /token$/i.test(k) && typeof v === 'string'),
);

/** The calls one shown question's card makes. */
export const practiceCalls = (turn) => {
  const questionId = qid(turn.question);
  const topicId = turn.topic?.id;
  const { mode } = turn;
  return {
    send: (attemptId, response, timeTakenMs) => hub.attempt({
      attemptId,
      questionId,
      topicId,
      response,
      mode,
      timeTakenMs,
      shown: { language: turn.language ?? 'en', translationId: turn.translationId ?? null },
      ...tokensOf(turn),
    }),
    askHint: (attemptId, step) => hub.hint({ attemptId, questionId, topicId, mode, step }),
    opened: (attemptId) => hub.hintsOpened({ attemptId, questionId, topicId }),
  };
};

function Crumb({ review, topic }) {
  return (
    <span className="hub-topic-crumb">
      <Link to="/hub">Learning Hub</Link>
      <span aria-hidden="true">·</span>
      {review
        ? <Link to="/hub/review">Reviews</Link>
        : topic && <Link to={`/hub/t/${topic.id}`}><RichText as="span" className="hub-inherit" html={topic.nameHtml} text={topic.name} /></Link>}
    </span>
  );
}

/**
 * Practice as drawn.
 *
 * @param mode     'practice' | 'review'
 * @param turn     hub.nextPractice's reply (question may be null, with `message`)
 * @param states   { [topicId]: state } from hub.progress, updated by each reply
 * @param number   which question this is in this sitting, from 1
 * @param answered the current question has its reply (or is kept), so Next is offered
 * @param given    answers given in this sitting
 * @param finished the review set is done
 * @param kept     answers waiting on this device (usePending)
 * @param calls    (turn) => { send, askHint, opened } for the card
 */
export function PracticeView({
  mode = 'practice', turn, states = {}, number = 1, answered = false, given = 0, finished = false, kept = 0,
  calls, onResult, onNext, nextBusy = false, nextError = null,
}) {
  const review = mode === 'review';
  const topics = turn.topics?.length ? turn.topics : turn.topic ? [turn.topic] : [];
  const topic = turn.topic ?? topics[0] ?? null;
  const setSize = turn.setSize ?? null;
  const last = review && setSize && given >= setSize;
  const back = review ? '/hub/review' : topic ? `/hub/t/${topic.id}` : '/hub';
  const slot = useRef(null);
  const q = turn.question;

  // A new question (or the end) takes focus, so a keyboard lands on it, not on
  // the button that fetched it. Not on arrival: the page itself is new then.
  const shownKey = finished ? 'end' : q ? qid(q) + number : 'none';
  const lastShown = useRef(shownKey);
  useEffect(() => {
    if (lastShown.current === shownKey) return;
    lastShown.current = shownKey;
    slot.current?.focus();
  }, [shownKey]);

  return (
    <HubPage
      crumb={<Crumb review={review} topic={topic} />}
      title={review ? 'Review set' : <>Practice: <RichText as="span" className="hub-inherit" html={topic?.nameHtml} text={topic?.name ?? ''} /></>}
      actions={<Link className="btn" to={back}><Icon name="back" />{review ? 'Reviews' : 'The topic'}</Link>}
    >
      <div className="hub-topic-layout" data-first="main">
        <Panel className="hub-topic-brief" aria-label={review ? 'This review set' : 'Where you are on this topic'}>
          <span className="tag-mint">{review ? 'This review set' : 'Where you are'}</span>
          {review ? (
            <>
              {setSize && <p className="hub-topic-statebig">Question {Math.min(given + (answered ? 0 : 1), setSize)} of {setSize}</p>}
              <ul className="hub-topic-setlist">
                {topics.map((t) => {
                  const s = states[String(t.id).toLowerCase()];
                  return (
                    <li key={t.id}>
                      <RichText as="b" className="hub-inherit" html={t.nameHtml} text={t.name} />
                      {s && (
                        <span>
                          <StateMark state={s.state} size={14} />
                          {s.label} · {plural(s.answers ?? 0, 'answer', 'answers')}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
              <p className="hub-topic-sentence">A short second session soon after the first is part of learning.</p>
            </>
          ) : (
            <StateBrief state={topic ? states[String(topic.id).toLowerCase()] : null} />
          )}
          <div className="brief">
            <b>Picked</b><span>By the hub, one question at a time.</span>
            <b>Hints</b><span>A step at a time, only when you ask.</span>
            <b>After</b><span>Right or wrong, the right answer and why.</span>
          </div>
          {kept > 0 && (
            <p className="hub-topic-keptline">
              <Icon name="clock" size={14} />
              {plural(kept, 'answer', 'answers')} kept on this device, sent when {kept === 1 ? 'it' : 'they'} can be.
            </p>
          )}
        </Panel>

        <div className="hub-topic-run">
          {finished ? (
            <div className="card hub-topic-slot" ref={slot} tabIndex={-1}>
              <Empty
                icon="ok"
                title="That is the set"
                action={(
                  <div className="cluster" style={{ justifyContent: 'center' }}>
                    <Link className="btn btn-primary" to="/hub/review">Reviews</Link>
                    <Link className="btn" to="/hub">The hub</Link>
                  </div>
                )}
              >
                You answered {plural(given, 'question', 'questions')}. Each topic&apos;s next review is set from your answers.
              </Empty>
            </div>
          ) : !q ? (
            <div className="card hub-topic-slot" ref={slot} tabIndex={-1}>
              <Empty
                icon="clock"
                title="Nothing to practise here just now"
                action={(
                  <div className="cluster" style={{ justifyContent: 'center' }}>
                    <Link className="btn btn-primary" to={back}>{review ? 'Reviews' : 'Back to the topic'}</Link>
                    <Link className="btn" to="/hub">The hub</Link>
                  </div>
                )}
              >
                {turn.message}
              </Empty>
            </div>
          ) : (
            <>
              <section className="hub-topic-slot" ref={slot} tabIndex={-1} aria-label={`Question ${number}`}>
                <QuestionCard
                  key={qid(q) + number}
                  question={q}
                  slot={`${turn.mode}:${qid(q)}`}
                  label={review && setSize ? `Question ${number} of ${setSize}` : `Question ${number}`}
                  topicName={review ? turn.topic?.name : undefined}
                  lang={langAttr(turn.language)}
                  note={turn.languageNote ?? null}
                  why={turn.why ?? null}
                  offer={turn.hints ?? null}
                  {...(calls ? calls(turn) : {})}
                  onResult={onResult}
                />
              </section>
              {nextError && (
                <Note tone="bad" role="alert">The next question did not load. {nextError.message}</Note>
              )}
              {answered && (
                <div className="hub-topic-next">
                  <Button variant="primary" size="lg" busy={nextBusy} onClick={onNext}>
                    {nextError ? 'Try again' : last ? 'Finish the set' : 'Next question'} <Icon name="forward" />
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </HubPage>
  );
}

/** While practice loads: the page's shape, in skeletons. */
export function PracticeLoading({ review = false }) {
  return (
    <HubPage crumb={<Crumb review={review} />} title={<><span className="sr-only">Loading practice</span><span className="skel hub-topic-skeltitle" aria-hidden="true" /></>}>
      <div className="hub-topic-layout" data-first="main" role="status" aria-label="Loading practice">
        <div className="skel hub-topic-skelbrief" />
        <div className="card hub-topic-skelcard" aria-hidden="true">
          <div className="skel" style={{ width: 150, height: 22 }} />
          <div className="skel" style={{ width: '85%', height: 20 }} />
          {[0, 1, 2, 3].map((i) => <div key={i} className="skel" style={{ height: 48, borderRadius: 12 }} />)}
        </div>
      </div>
    </HubPage>
  );
}

export default function Practice() {
  const { topicId } = useParams();
  const [params] = useSearchParams();
  const topicIds = topicId ? null : (params.get('topicIds') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const mode = !topicId && params.get('mode') === 'review' ? 'review' : 'practice';
  const scope = topicId ?? topicIds.join(',');
  const { version } = useHubLanguage();
  const kept = usePending().length;

  const [turn, setTurn] = useState(null);
  const [error, setError] = useState(null);
  const [reading, setReading] = useState(0);
  const [busy, setBusy] = useState(false);
  const [states, setStates] = useState({});
  const [number, setNumber] = useState(1);
  const [answered, setAnswered] = useState(false);
  const [given, setGiven] = useState(0);
  const [finished, setFinished] = useState(false);
  const [nextBusy, setNextBusy] = useState(false);
  const [nextError, setNextError] = useState(null);
  const seen = useRef(version);

  const next = useCallback(
    () => hub.nextPractice(topicId ? { topicId, mode } : { topicIds, mode }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scope, mode],
  );

  useEffect(() => {
    let on = true;
    setError(null);
    setTurn(null);
    setNumber(1);
    setAnswered(false);
    setGiven(0);
    setFinished(false);
    setBusy(true);
    next()
      .then((t) => { if (on) setTurn(t); })
      .catch((e) => { if (on) setError(e); })
      .finally(() => { if (on) setBusy(false); });
    hub.progress()
      .then((p) => { if (on) setStates(Object.fromEntries((p.topics ?? []).map((t) => [String(t.id).toLowerCase(), t.state]))); })
      .catch(() => { /* the brief draws without it */ });
    return () => { on = false; };
  }, [next, reading]);

  // A language switch: an unanswered question is asked for again, in the new language.
  useEffect(() => {
    if (seen.current === version) return undefined;
    seen.current = version;
    if (answered || !turn?.question) return undefined;
    let on = true;
    next().then((t) => { if (on) setTurn(t); }).catch(() => { /* the old question stays */ });
    return () => { on = false; };
  }, [version, answered, turn, next]);

  const onResult = (r) => {
    setAnswered(true);
    setGiven((n) => n + 1);
    const t = r?.topic;
    if (t?.state) setStates((s) => ({ ...s, [String(t.id).toLowerCase()]: t.state }));
  };

  const onNext = () => {
    if (nextBusy) return;
    if (mode === 'review' && turn?.setSize && given >= turn.setSize) { setFinished(true); return; }
    setNextBusy(true);
    setNextError(null);
    next()
      .then((t) => { setTurn(t); setAnswered(false); setNumber((n) => n + 1); })
      .catch((e) => setNextError(e))
      .finally(() => setNextBusy(false));
  };

  if (error) return <HubTrouble error={error} what="Practice" onRetry={() => setReading((n) => n + 1)} busy={busy} />;
  if (!turn) return <PracticeLoading review={mode === 'review'} />;
  if (topicId && turn.topic && !same(turn.topic.id, topicId)) return <PracticeLoading />;

  return (
    <PracticeView
      mode={mode}
      turn={turn}
      states={states}
      number={number}
      answered={answered}
      given={given}
      finished={finished}
      kept={kept}
      calls={practiceCalls}
      onResult={onResult}
      onNext={onNext}
      nextBusy={nextBusy}
      nextError={nextError}
    />
  );
}
