/**
 * Get Ready, "Skip what I know · short check", on the server's replies
 * (docs/API.md, Phase 6, "Get Ready and refresher path").
 *
 *   /hub/ready                  ReadyList     the student's past checks, newest first
 *   /hub/ready/:topicId         ReadyStart    before a topic: what it builds on, the rule,
 *                                             a check still open on it, then Start
 *   /hub/ready/check/:checkId   ReadyAsk      the question the check asks now, with why;
 *                                             after each answer its feedback, then the next
 *                               ReadyWaiting  no question for now, in the server's words
 *                               ReadyResults  each prerequisite's outcome and the
 *                                             refresher path, next step marked, target last
 *
 * The start's clientRunId is kept for the tab until the server has it; each
 * answer has its own attemptId, kept on the device until the server has it.
 * Never a hint button, and nobody else's results.
 *
 * Batch 8: "End this check" while it is open (hub.readyEnd, after a short
 * confirm), then the check as it came back, with check.note when it ended
 * early; a 404 there (a server without the route) hides the control. Under
 * "Why this path", path.why.sentence and path.why.source.label.
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { useEnter } from '../lib/motion.js';
import { Button, Empty, Icon, Note, Panel } from '../ui/index.jsx';
import HubPage from './HubPage.jsx';
import { hub, newId } from './hubApi.js';
import { langAttr } from './lang.js';
import { flushPending } from './pending.js';
import RichText from './RichText.jsx';
import {
  LinkButton, TestSkeleton, Trouble, Verdict, WhyBlock,
  dropRunId, keptRunId, plural, toTop, useFocusOnArrive, useLoad, when,
} from './TestParts.jsx';
import { CHOICE_KINDS, Respond, TestQuestion, isAnswered, optionsOf } from './TestQuestion.jsx';

export const LABEL = 'Skip what I know · short check';
const CRUMB = `Learning Hub · ${LABEL}`;
const STAFF_SIDE = { to: '/hubs', label: 'Go to the staff hub' };
const allChecks = <LinkButton to="/hub/ready" icon="back">All checks</LinkButton>;

/** Each outcome with a mark that is not colour alone. The word is the server's `label`. */
const MARK = { ready: 'ok', 'needs-review': 'refresh', 'not-sure': 'help' };
const STEP = { done: ['ok', 'Done'], 'in-progress': ['clock', 'Started'], 'to-do': ['dot', 'To do'] };

/** One prerequisite as the check sees it: its status or outcome in words, the counts, the sentence. */
function Prereq({ p, compact = false }) {
  const o = p.outcome ?? (p.status === 'asking' ? 'asking' : 'waiting');
  const word = p.label ?? (p.status === 'asking' ? 'Being checked' : 'Still to check');
  return (
    <li data-o={o}>
      <span className="hub-test-mark" aria-hidden="true"><Icon name={MARK[o] ?? (o === 'asking' ? 'eye' : 'dot')} size={16} /></span>
      <span className="hub-test-pre-t">
        <RichText as="b" html={p.topic?.nameHtml} text={p.topic?.name} />
        {!compact && <span>{p.sentence}</span>}
      </span>
      <span className="hub-test-pre-o">
        <span className="hub-test-word">{word}</span>
        {p.answers > 0 && <span className="mono">{p.right} of {plural(p.answers, 'answer')} right</span>}
        {p.provisional && p.outcome && <span className="hub-test-prov-m">Provisional</span>}
      </span>
    </li>
  );
}

/* ================================================================== list */

export function ReadyList({ checks = [], rule }) {
  const body = useRef(null);
  useEnter(body);
  const open = checks.filter((c) => c.status === 'open');
  return (
    <div className="hub-test-flow" ref={body}>
      <Panel className="hub-test-brief hub-test-brief-one" aria-label="About Get Ready">
        <div className="hub-test-brief-main">
          <span className="tag-mint">{LABEL}</span>
          <p className="hub-test-lead">A few questions on what a topic builds on, so what you already know comes off your path.</p>
          {rule && <p className="hub-test-brief-note">{rule}</p>}
        </div>
      </Panel>
      <section className="card" aria-labelledby="hub-ready-list-h">
        <div className="card-head">
          <div className="sec">
            <h2 id="hub-ready-list-h">Your checks</h2>
            <p>{open.length ? `${plural(open.length, 'check')} still open.` : 'Newest first.'}</p>
          </div>
        </div>
        {checks.length ? (
          <ul className="hub-test-past">
            {checks.map((c) => (
              <li key={c.id} data-open={c.status === 'open' ? 'true' : undefined}>
                <div className="hub-test-past-t">
                  <b>Before <RichText as="span" html={c.target?.nameHtml} text={c.target?.name} /></b>
                  <span>{c.sentence}</span>
                  {c.status === 'complete' && (
                    <span className="hub-test-tally">
                      <span data-o="ready">{c.counts?.ready ?? 0} Ready</span>
                      <span data-o="needs-review">{c.counts?.['needs-review'] ?? 0} Needs review</span>
                      <span data-o="not-sure">{c.counts?.['not-sure'] ?? 0} Not sure yet</span>
                    </span>
                  )}
                </div>
                <span className="hub-test-past-d mono">{when(c.endedAt ?? c.startedAt)}</span>
                <LinkButton to={`/hub/ready/check/${c.id}`} size="sm" variant={c.status === 'open' ? 'primary' : 'ghost'}>
                  {c.status === 'open' ? 'Carry on' : 'See the path'}<Icon name="forward" />
                </LinkButton>
              </li>
            ))}
          </ul>
        ) : (
          <Empty icon="path" title="No checks yet" action={<LinkButton to="/hub" variant="primary" icon="book">Open your hub</LinkButton>}>
            Start one from a topic: "{LABEL}" checks what that topic builds on.
          </Empty>
        )}
      </section>
    </div>
  );
}

function ReadyListRoute() {
  const load = useLoad(() => hub.readyChecks(), []);
  return (
    <HubPage crumb={CRUMB} title="Get Ready" sub="Short checks before a topic, and the paths they made.">
      {load.state === 'loading' && <TestSkeleton />}
      {load.state === 'failed' && <Trouble error={load.error} onRetry={load.retry} back={<LinkButton to="/hub" icon="back">Back to your hub</LinkButton>} elsewhere={STAFF_SIDE} />}
      {load.state === 'ready' && <ReadyList checks={load.data.checks} rule={load.data.rule} />}
    </HubPage>
  );
}

/* ================================================================= start */

/**
 * Before a topic. `topic` is GET /hub/topics/:id; `checks` and `rule` are
 * GET /hub/getready?topicId=. A check still open on this topic is carried on,
 * not started again: while it is open its question stays closed elsewhere.
 */
export function ReadyStart({ topic, checks = [], rule, busy = false, error = null, onStart }) {
  const body = useRef(null);
  useEnter(body);
  const t = topic.topic;
  const pre = topic.prerequisites ?? [];
  const open = checks.find((c) => c.status === 'open');
  const past = checks.filter((c) => c.status !== 'open');
  const toTopic = <LinkButton to={`/hub/t/${t.id}`} icon="book">Open {t.name}</LinkButton>;

  if (!pre.length) {
    return (
      <div className="card">
        <Empty icon="check" title="Nothing to check first" action={<div className="cluster hub-center">{toTopic}<LinkButton to={`/hub/t/${t.id}/practice`} variant="primary" icon="play">Practise it</LinkButton></div>}>
          {t.name} has no prerequisites your professor has confirmed, so you can start it straight away.
        </Empty>
      </div>
    );
  }

  return (
    <div className="hub-test-flow" ref={body}>
      <Panel className="hub-test-brief" aria-label="About the check">
        <div className="hub-test-brief-main">
          <span className="tag-mint">{LABEL}</span>
          <p className="hub-test-lead">
            Before <RichText as="span" html={t.nameHtml} text={t.name} />: a few questions on what it builds on.
          </p>
          {rule && <p className="hub-test-brief-note">{rule}</p>}
          {error && <Note tone="bad" role="alert">{error}</Note>}
          <div className="cluster">
            {open
              ? <LinkButton to={`/hub/ready/check/${open.id}`} variant="accent" icon="play">Carry on with your check</LinkButton>
              : <Button variant="accent" size="lg" icon="play" busy={busy} onClick={onStart}>Start the check</Button>}
            {toTopic}
          </div>
          {open && <p className="hub-test-brief-note">{open.sentence} Started {when(open.startedAt)}.</p>}
        </div>
        <div className="hub-test-prereq" role="group" aria-label="What the check covers">
          <span className="hub-test-prereq-l">It builds on, nearest first</span>
          <ul>
            {pre.map((p) => (
              <li key={p.id}>
                <RichText as="b" html={p.nameHtml} text={p.name} />
                <span>{p.onYourClasses === false ? 'earlier material' : p.depth === 1 ? 'directly' : `${p.depth} steps back`}</span>
              </li>
            ))}
          </ul>
          {topic.note && <p className="hub-test-prereq-n">{topic.note}</p>}
        </div>
      </Panel>
      {past.length > 0 && (
        <section className="card" aria-labelledby="hub-ready-past-h">
          <div className="card-head"><div className="sec"><h2 id="hub-ready-past-h">Earlier checks on this topic</h2><p>Newest first.</p></div></div>
          <ul className="hub-test-past">
            {past.map((c) => (
              <li key={c.id}>
                <div className="hub-test-past-t"><span>{c.sentence}</span></div>
                <span className="hub-test-past-d mono">{when(c.endedAt ?? c.startedAt)}</span>
                <LinkButton to={`/hub/ready/check/${c.id}`} size="sm">See the path<Icon name="forward" /></LinkButton>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ReadyStartRoute({ topicId }) {
  const navigate = useNavigate();
  const load = useLoad(() => Promise.all([hub.topic(topicId), hub.readyChecks({ topicId })])
    .then(([topic, list]) => ({ topic, list })), [topicId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const start = async () => {
    const scope = `ready:${topicId}`;
    setBusy(true);
    setError(null);
    try {
      const reply = await hub.readyStart({ clientRunId: keptRunId(scope), targetTopicId: topicId });
      dropRunId(scope);
      navigate(`/hub/ready/check/${reply.check.id}`, { replace: true });
    } catch (e) {
      if (e.status && e.status < 500) dropRunId(scope);
      setError(e.message);
      setBusy(false);
    }
  };
  const name = load.data?.topic?.topic?.name;
  return (
    <HubPage crumb={CRUMB} title={name ? `Before ${name}` : 'Get Ready'} sub="A short check over what this topic builds on." actions={allChecks}>
      {load.state === 'loading' && <TestSkeleton />}
      {load.state === 'failed' && <Trouble error={load.error} onRetry={load.retry} back={allChecks} elsewhere={STAFF_SIDE} />}
      {load.state === 'ready' && (
        <ReadyStart topic={load.data.topic} checks={load.data.list.checks} rule={load.data.list.rule} busy={busy} error={error} onStart={start} />
      )}
    </HubPage>
  );
}

/* ================================================================ asking */

/**
 * Batch 8: ending an open check early, after a confirm that says what happens.
 * Focus moves into the confirm and back, so a keyboard never lands on nothing.
 */
function EndCheck({ onEnd, busy = false, error = null, disabled = false }) {
  const [asking, setAsking] = useState(false);
  const yes = useRef(null);
  const open = useRef(null);
  const was = useRef(false);
  useEffect(() => {
    if (asking) yes.current?.focus();
    else if (was.current) open.current?.focus();
    was.current = asking;
  }, [asking]);
  return (
    <div className="hub-test-end">
      {asking ? (
        <div role="group" aria-label="End this check">
          <p>End the check now? The topics it has not decided become Not sure yet, and you see the path so far.</p>
          <div className="cluster">
            <Button ref={yes} size="sm" variant="accent" busy={busy} onClick={onEnd}>End the check</Button>
            <Button size="sm" disabled={busy} onClick={() => setAsking(false)}>Keep going</Button>
          </div>
        </div>
      ) : (
        <Button ref={open} size="sm" icon="stop" disabled={disabled} onClick={() => setAsking(true)}>End this check</Button>
      )}
      {error && <p className="hub-test-end-err" role="alert">{error}</p>}
    </div>
  );
}

/** How far the check has gone: questions asked of at most its limit, and each prerequisite. */
function CheckSide({ data, end = null }) {
  const c = data.check;
  return (
    <Panel as="aside" className="hub-test-side" aria-label="Where the check stands">
      <span className="tag-mint">{LABEL}</span>
      <p className="hub-test-side-lead">{data.sentence}</p>
      <div className="hub-test-meter" role="img" aria-label={`${c.asked} of at most ${c.maxQuestions} questions asked`}>
        {Array.from({ length: c.maxQuestions }, (_, i) => <i key={i} data-on={i < c.asked ? 'true' : undefined} />)}
      </div>
      <ul className="hub-test-pre hub-test-pre-panel">
        {(data.prerequisites ?? []).map((p) => <Prereq key={p.topic?.id} p={p} compact />)}
      </ul>
      <details className="hub-test-rule">
        <summary>How the check decides</summary>
        <p>{c.rule}</p>
      </details>
      {end && c.status === 'open' && <EndCheck {...end} />}
    </Panel>
  );
}

/**
 * The question the check asks now, and after the answer its feedback. Pure:
 * `reply` is the answer's reply (feedback, then `check`), `error` a refusal.
 * `end` is { onEnd, busy, error, disabled } for "End this check" (batch 8), or null.
 */
export function ReadyAsk({
  data, value, onChoose, onSubmit, busy = false, sent = null, reply = null, error = null, onNext, onRetry, end = null,
}) {
  const item = data.question;
  const q = item.question;
  const choice = CHOICE_KINDS.has(q.kind ?? 'mcq');
  const card = useRef(null);
  const main = useRef(null);
  const verdict = useRef(null);
  useEnter(main, q._id);
  useFocusOnArrive(card);
  // The feedback takes focus when it lands, so a keyboard is next to "Next question".
  useEffect(() => { if (reply) verdict.current?.focus({ preventScroll: false }); }, [reply]);
  const after = reply?.check;
  const done = after?.check?.status === 'complete';
  const optionText = (i) => optionsOf(q)[Number(i)]?.text;
  const textId = `hub-ready-q-${q._id}`;

  return (
    <div className="hub-test-take" data-ready="true">
      <div className="hub-test-main" ref={main}>
        <p className="hub-test-why-q"><Icon name="target" size={14} />{item.why}</p>
        <TestQuestion
          ref={card}
          question={q}
          number={data.check.asked + 1}
          topicName={item.topic?.name}
          lang={langAttr(item.language)}
          languageNote={item.languageNote}
          textId={textId}
        >
          <Respond
            question={q}
            value={value}
            onChoose={onChoose}
            onSubmit={onSubmit}
            busy={busy}
            disabled={Boolean(reply)}
            result={reply}
            sent={sent}
            labelledBy={textId}
            lang={langAttr(item.language)}
          />
          {!reply && item.hints?.note && <p className="hub-test-nohint">{item.hints.note}</p>}
          {error && (
            <Note tone={error.kept ? undefined : 'bad'} icon={error.kept ? 'clock' : undefined} role="alert">
              {error.kept ? `Kept on this device. ${error.message}` : error.message}
              {error.kept && <> <Button size="sm" variant="ghost" icon="refresh" onClick={onRetry}>Try again</Button></>}
            </Note>
          )}
          {reply ? (
            <div className="hub-test-after" ref={verdict} tabIndex={-1} role="status">
              <div className="hub-test-after-head">
                <Verdict correct={reply.correct} provisional={reply.provisional} />
                {reply.topic?.state?.sentence && <span className="hub-test-after-state">{reply.topic.state.sentence}</span>}
              </div>
              {reply.provisionalNote && <p className="hub-test-mark-l">{reply.provisionalNote}</p>}
              <WhyBlock explanation={reply.explanation} optionFeedback={reply.optionFeedback} optionText={optionText} />
              <footer className="hub-test-foot">
                <span />
                <Button variant="primary" onClick={onNext}>
                  {done ? 'See what the check found' : 'Next question'}<Icon name="forward" />
                </Button>
              </footer>
            </div>
          ) : choice && (
            <footer className="hub-test-foot">
              <span className="hub-test-foot-n">{isAnswered(value) ? 'Check it when you are sure.' : 'Choose an answer.'}</span>
              <Button variant="primary" busy={busy} disabled={!isAnswered(value)} onClick={() => onSubmit(value)}>Check my answer</Button>
            </footer>
          )}
        </TestQuestion>
      </div>
      <CheckSide data={after ?? data} end={end} />
    </div>
  );
}

/** No question for now: the server's sentence, and a way to look again. */
export function ReadyWaiting({ data, onRetry, end = null }) {
  return (
    <div className="hub-test-take" data-ready="true">
      <div className="hub-test-main">
        <div className="card">
          <Empty icon="clock" title="Nothing to ask just now" action={<Button variant="primary" icon="refresh" onClick={onRetry}>Look again</Button>}>
            {data.waiting}
          </Empty>
        </div>
      </div>
      <CheckSide data={data} end={end} />
    </div>
  );
}

/* ================================================================ result */

export function ReadyResults({ data }) {
  const lead = useRef(null);
  const body = useRef(null);
  useFocusOnArrive(lead);
  useEnter(body);
  const pre = data.prerequisites ?? [];
  const tally = (o) => pre.filter((p) => p.outcome === o).length;
  const path = data.path;
  const steps = path?.steps ?? [];
  const target = path?.target;
  const nextStep = steps.find((s) => s.topicId === path?.next);
  const nextId = path?.next;

  return (
    <div className="hub-test-flow" ref={body}>
      <Panel className="hub-test-brief" aria-label="What the check found">
        <div className="hub-test-brief-main">
          <span className="tag-mint">{LABEL} · result</span>
          <p className="hub-test-lead" ref={lead} tabIndex={-1}>{data.sentence}</p>
          {data.check?.endedEarly && data.check.note && <p className="hub-test-brief-note hub-test-ended">{data.check.note}</p>}
          <p className="hub-test-brief-note">Checked {when(data.check?.endedAt ?? data.check?.startedAt)}, {plural(data.check?.asked ?? 0, 'question')} asked.</p>
          <div className="cluster">
            {nextStep
              ? <LinkButton to={`/hub/t/${nextStep.topicId}/practice`} variant="accent" icon="play">Practise {nextStep.name}</LinkButton>
              : target && <LinkButton to={`/hub/t/${target.topicId}`} variant="accent" icon="book">Open {target.name}</LinkButton>}
          </div>
        </div>
        <div className="hub-test-tiles" role="group" aria-label="Topics by outcome">
          <div className="ptile"><span>Ready</span><b>{tally('ready')}</b><small><i>skip these</i></small></div>
          <div className="ptile" style={{ '--d': '0.6s' }}><span>Needs review</span><b>{tally('needs-review')}</b><small><i>on your path</i></small></div>
          <div className="ptile" style={{ '--d': '1.2s' }}><span>Not sure yet</span><b>{tally('not-sure')}</b><small><i>practise to tell</i></small></div>
        </div>
      </Panel>

      <div className="hub-test-ready">
        <section className="card" aria-labelledby="hub-ready-found-h">
          <div className="card-head">
            <div className="sec"><h2 id="hub-ready-found-h">Topic by topic</h2><p>Nearest first, from your answers.</p></div>
          </div>
          <ul className="hub-test-pre">{pre.map((p) => <Prereq key={p.topic?.id} p={p} />)}</ul>
        </section>

        <section className="card" aria-labelledby="hub-ready-path-h">
          <div className="card-head">
            <div className="sec">
              <h2 id="hub-ready-path-h">Your refresher path</h2>
              <p>{steps.length ? `${path.done} of ${plural(path.total ?? steps.length, 'step')} done.` : 'Nothing needs review first.'}</p>
            </div>
          </div>
          {path?.why?.sentence && (
            <div className="hub-test-pathwhy">
              <span className="hub-test-pathwhy-l">Why this path</span>
              <p>{path.why.sentence}</p>
              {path.why.source?.label && <p className="hub-test-pathwhy-src"><Icon name="history" size={13} />{path.why.source.label}</p>}
            </div>
          )}
          <ol className="hub-test-path">
            {steps.map((s, i) => {
              const [icon, word] = STEP[s.status] ?? ['dot', s.status];
              const isNext = s.topicId === nextId;
              return (
                <li key={s.topicId} data-status={s.status} data-next={isNext ? 'true' : undefined} aria-current={isNext ? 'step' : undefined}>
                  <span className="hub-test-path-n" aria-hidden="true">{s.status === 'done' ? <Icon name="check" size={14} /> : i + 1}</span>
                  <div className="hub-test-path-t">
                    <span className="hub-test-path-h">
                      <RichText as="b" html={s.topic?.nameHtml} text={s.name} />
                      {isNext && <span className="hub-test-next">Next</span>}
                      <span className="hub-test-step" data-s={s.status}><Icon name={icon} size={13} />{word}</span>
                    </span>
                    <p className="hub-test-path-why"><span>Why this is on your path</span>{s.why}</p>
                    <p className="hub-test-path-s">{s.sentence}</p>
                    <LinkButton to={`/hub/t/${s.topicId}/practice`} size="sm" variant={isNext ? 'primary' : 'ghost'} icon="play">Practise</LinkButton>
                  </div>
                </li>
              );
            })}
            {target && (
              <li data-target="true" data-next={nextId === target.topicId ? 'true' : undefined} aria-current={nextId === target.topicId ? 'step' : undefined}>
                <span className="hub-test-path-n" aria-hidden="true"><Icon name="target" size={14} /></span>
                <div className="hub-test-path-t">
                  <span className="hub-test-path-h">
                    <RichText as="b" html={target.topic?.nameHtml} text={target.name} />
                    {nextId === target.topicId && <span className="hub-test-next">Next</span>}
                  </span>
                  <p className="hub-test-path-why">{target.sentence}</p>
                  <LinkButton to={`/hub/t/${target.topicId}`} size="sm" variant={nextId === target.topicId ? 'primary' : 'ghost'} icon="book">Open the topic</LinkButton>
                </div>
              </li>
            )}
          </ol>
          {path?.rule && <p className="hub-test-path-rule">{path.rule}</p>}
        </section>
      </div>
    </div>
  );
}

/* ================================================================= route */

function ReadyCheckRoute({ checkId }) {
  const load = useLoad(() => hub.readyCheck(checkId), [checkId]);
  const [value, setValue] = useState(null);
  const [sent, setSent] = useState(null);
  const [reply, setReply] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const ids = useRef({});
  const shownAt = useRef(Date.now());
  const data = load.data;
  const qid = data?.question?.question?._id;

  const send = async (response) => {
    if (busy || !qid) return;
    const item = data.question;
    // One attempt id per question shown: a retry of the same answer resends it.
    ids.current[qid] ??= newId();
    setBusy(true);
    setSent(response);
    setError(null);
    try {
      const r = await hub.readyAnswer(checkId, {
        attemptId: ids.current[qid], questionId: qid, response,
        timeTakenMs: Math.max(0, Date.now() - shownAt.current),
        shown: { language: item.language ?? 'en', translationId: item.translationId ?? null },
      });
      setReply(r);
    } catch (e) {
      if (!e.kept) setSent(null);
      // The check has ended meanwhile: read where it stands.
      if (e.status === 409 && !e.kept) load.retry();
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    const after = reply?.check;
    setReply(null);
    setSent(null);
    setValue(null);
    setError(null);
    shownAt.current = Date.now();
    if (after) load.set(after); else load.retry();
    toTop();
  };

  const retryKept = async () => {
    await flushPending();
    setError(null);
    setSent(null);
    load.retry();
  };

  // Batch 8: end the check early; the reply is the check as it ended.
  const [ending, setEnding] = useState(false);
  const [endError, setEndError] = useState(null);
  const [canEnd, setCanEnd] = useState(true);
  const endCheck = async () => {
    if (ending) return;
    setEnding(true);
    setEndError(null);
    try {
      const r = await hub.readyEnd(checkId);
      setReply(null);
      setSent(null);
      setValue(null);
      setError(null);
      load.set(r);
      toTop();
    } catch (e) {
      // A server without the route: the control goes, quietly.
      if (e.status === 404) setCanEnd(false); else setEndError(e.message);
    } finally {
      setEnding(false);
    }
  };
  const end = canEnd ? { onEnd: endCheck, busy: ending, error: endError, disabled: busy } : null;

  const complete = data?.check?.status === 'complete';
  const target = data?.target?.name;
  return (
    <HubPage
      crumb={CRUMB}
      title={target ? `Before ${target}` : 'Get Ready'}
      sub={complete ? 'What the check found, and what to look at first.' : 'No hints here. After each answer you see whether it was right, and why.'}
      actions={allChecks}
    >
      {load.state === 'loading' && <TestSkeleton />}
      {load.state === 'failed' && <Trouble error={load.error} onRetry={load.retry} back={allChecks} elsewhere={STAFF_SIDE} />}
      {load.state === 'ready' && (complete
        ? <ReadyResults data={data} />
        : data.question
          ? (
            <ReadyAsk
              key={qid}
              data={data}
              value={value}
              onChoose={setValue}
              onSubmit={send}
              busy={busy}
              sent={sent}
              reply={reply}
              error={error}
              onNext={next}
              onRetry={retryKept}
              end={end}
            />
          )
          : <ReadyWaiting data={data} onRetry={load.retry} end={end} />)}
    </HubPage>
  );
}

export default function GetReady() {
  const { topicId, checkId } = useParams();
  if (checkId) return <ReadyCheckRoute key={checkId} checkId={checkId} />;
  if (topicId) return <ReadyStartRoute key={topicId} topicId={topicId} />;
  return <ReadyListRoute />;
}
