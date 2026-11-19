/**
 * A topic in the Learning Hub: where the student stands on it, what it needs
 * first, and its lesson, in the language the student chose on the server.
 *
 *   /hub/t/:topicId?tab=introduction|explanation|visual|practice&step=N
 *
 * Calls: hub.topic (name, chapter, prerequisites nearest first), hub.lesson
 * (the approved lesson, or `empty`) and hub.progress (this topic's state, for
 * the brief; the page draws without it). The language is the server's
 * (useHubLanguage): a switch reloads the lesson.
 *
 * The lesson's steps arrive as a flat list (a chunk with its cited slide, a
 * worked example, a set of retrieval questions, the next chunk). Here each
 * chunk opens a step, "Step N of M", and the example and questions after it
 * belong to that step. The four tabs from the design map onto it:
 *   Introduction  the lesson's label and outline, and the prerequisites
 *   Explanation   the lesson itself, one step at a time
 *   Visual        a later server batch: said plainly, nothing drawn
 *   Practice      the way into practice and the short check
 * Never an AI-draft label, a model, a warning or a draft lesson: the server
 * sends none, and the screen invents none.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { slideTo, useEnter } from '../lib/motion.js';
import { Button, Empty, Icon, Note, Panel } from '../ui/index.jsx';
import HubPage from './HubPage.jsx';
import { hub } from './hubApi.js';
import { langAttr, useHubLanguage } from './lang.js';
import Prereqs from './Prereqs.jsx';
import QuestionCard, { qid } from './QuestionCard.jsx';
import RichText from './RichText.jsx';
import SharedMark from './StateMark.jsx';

export const TABS = [
  { id: 'introduction', label: 'Introduction' },
  { id: 'explanation', label: 'Explanation' },
  { id: 'visual', label: 'Visual' },
  { id: 'practice', label: 'Practice' },
];

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const same = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();

/** A topic's state as a shape (StateMark.jsx), a little larger on a topic's own page. */
export function StateMark({ state, size = 18 }) {
  return <SharedMark state={state} size={size} />;
}

/**
 * Where the student is on a topic, in the server's words: the state's label
 * with its mark, N, the sentence, a provisional marker and when it comes back.
 */
export function StateBrief({ state }) {
  if (!state) return null;
  const n = state.answers ?? 0;
  return (
    <div className="hub-topic-where">
      <p className="hub-topic-statebig">
        <StateMark state={state.state} />
        {state.label}
      </p>
      <p className="hub-topic-n">
        {n ? `Based on ${plural(n, 'answer', 'answers')}` : 'No answers yet'}
        {state.provisional && n > 0 && <span className="hub-topic-prov">Provisional</span>}
      </p>
      {state.sentence && <p className="hub-topic-sentence">{state.sentence}</p>}
      {state.review?.when && (
        <p className="hub-topic-review">
          <Icon name="clock" size={14} />
          <span>Next review {state.review.when}. A short second session soon after the first is part of learning.</span>
        </p>
      )}
    </div>
  );
}

/**
 * When a hub call is refused: the server's sentence, calm, with the one way
 * on. 503 (no accounts on this server), 401 (signed out), 403 (another role),
 * 404 (like any missing page), anything else with Try again.
 */
export function HubTrouble({ error, what = 'This page', onRetry, busy, crumb }) {
  const status = error?.status;
  const view = {
    503: { icon: 'info', title: 'The Learning Hub is not open on this server', to: null },
    401: { icon: 'lock', title: 'You are signed out', to: ['/signin', 'Sign in'] },
    403: { icon: 'lock', title: 'Not for this account', to: ['/hub', 'Back to the hub'] },
    404: { icon: 'search', title: `${what} was not found`, to: ['/hub', 'Back to the hub'] },
  }[status] ?? { icon: 'alert', title: `${what} did not load`, to: ['/hub', 'Back to the hub'], retry: true };
  return (
    <HubPage crumb={crumb ?? <Link to="/hub">Learning Hub</Link>} title={what} language={status !== 503 && status !== 401}>
      <div className="card hub-topic-trouble" data-status={status ?? 'none'}>
        <Empty
          icon={view.icon}
          title={view.title}
          action={(view.retry || view.to) && (
            <div className="cluster" style={{ justifyContent: 'center' }}>
              {view.retry && onRetry && <Button variant="primary" icon="refresh" busy={busy} onClick={onRetry}>Try again</Button>}
              {view.to && <Link className={view.retry ? 'btn' : 'btn btn-primary'} to={view.to[0]}>{view.to[1]}</Link>}
            </div>
          )}
        >
          {error?.message}
        </Empty>
      </div>
    </HubPage>
  );
}

/** What is coming in a later server batch: a dashed outline, never a faked figure. */
function Later({ icon = 'clock', title, children }) {
  return (
    <div className="hub-topic-later">
      <span className="hub-topic-later-ic" aria-hidden="true"><Icon name={icon} size={16} /></span>
      <div>
        <b>{title}</b>
        <p>{children}</p>
      </div>
    </div>
  );
}

/**
 * The lesson's flat list as steps: each chunk opens one, and the example and
 * questions after it belong to it (anything before the first chunk opens one).
 */
export function lessonSteps(steps = []) {
  const out = [];
  for (const s of steps) {
    if (s.type === 'chunk' || !out.length) out.push({ cite: s.cite ?? null, chunk: null, examples: [], questions: [] });
    const g = out[out.length - 1];
    if (s.type === 'chunk') g.chunk = s;
    else if (s.type === 'example') g.examples.push(s);
    else if (s.type === 'questions') g.questions.push(...(s.questions ?? []));
    if (!g.cite && s.cite) g.cite = s.cite;
  }
  return out;
}

function Tabs({ tab, onTab, ids }) {
  const list = useRef(null);
  const thumb = useRef(null);
  const btns = useRef({});
  const placed = useRef(false);

  const place = useCallback((first) => slideTo(thumb.current, btns.current[tab], first), [tab]);
  useLayoutEffect(() => { place(!placed.current); placed.current = true; }, [place]);
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined' || !list.current) return undefined;
    const ro = new ResizeObserver(() => place(true));
    ro.observe(list.current);
    return () => ro.disconnect();
  }, [place]);

  const onKey = (e) => {
    const i = TABS.findIndex((t) => t.id === tab);
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const next = TABS[(to + TABS.length) % TABS.length].id;
    onTab(next);
    btns.current[next]?.focus();
  };

  return (
    <div className="hub-topic-tabs" role="tablist" aria-label="Parts of this topic" ref={list} onKeyDown={onKey}>
      <span className="hub-topic-thumb" ref={thumb} aria-hidden="true" />
      {TABS.map((t) => (
        <button
          key={t.id}
          ref={(el) => { btns.current[t.id] = el; }}
          type="button"
          role="tab"
          id={ids.tab(t.id)}
          aria-selected={tab === t.id}
          aria-controls={ids.panel(t.id)}
          tabIndex={tab === t.id ? 0 : -1}
          onClick={() => onTab(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** The slide a step comes from, as the server cites it ("Slide 3", "Slides 3 and 4"). */
function Cite({ cite }) {
  if (!cite) return null;
  return <span className="hub-topic-slide"><Icon name="deck" size={13} />{cite}</span>;
}

/** A worked example: the problem, its steps, the answer, and the server's label. */
function Example({ ex, lang }) {
  return (
    <figure className="hub-topic-example">
      <span className="hub-topic-eyebrow">Worked example</span>
      <RichText html={ex.problemHtml} text={ex.problem} lang={lang} />
      {ex.steps?.length > 0 && (
        <ol className="hub-topic-exsteps">
          {ex.steps.map((s, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <li key={i}><RichText html={s.html} text={s.text} lang={lang} /></li>
          ))}
        </ol>
      )}
      {(ex.answerHtml || ex.answer) && (
        <div className="hub-topic-exans">
          <span className="hub-topic-eyebrow">Answer</span>
          <RichText html={ex.answerHtml} text={ex.answer} lang={lang} />
        </div>
      )}
      {(ex.label || ex.cite) && (
        <figcaption>
          {ex.label}
          {ex.cite && <span className="hub-topic-src">{ex.cite}</span>}
        </figcaption>
      )}
    </figure>
  );
}

/* ------------------------------------------------------------------- view */

/**
 * The topic as drawn. No calls of its own, except the question cards (through
 * `lessonOps`).
 *
 * @param data      hub.topic's reply: { topic, prerequisites, leadsTo, note }
 * @param lesson    hub.lesson's reply: { topic, lesson: null | {...}, empty? }, or null while it loads
 * @param lessonError  the lesson's refusal, or null
 * @param progress  hub.progress's `topics` (this topic's state is read from it), null while loading
 * @param tab, onTab, step, onStep   the open tab and lesson step, kept in the address
 * @param lessonOps (lessonId) => { send, askHint, opened } for the question cards
 */
export function TopicView({
  data, lesson: reply = null, lessonError = null, onRetryLesson, progress = null,
  tab, onTab, step: wanted = 0, onStep, lessonOps, onResult,
}) {
  const { topic, prerequisites = [], leadsTo = [], note } = data;
  const state = stateIn(progress, topic.id);
  const lesson = reply?.lesson ?? null;
  const lang = langAttr(lesson?.language?.language);
  const steps = useMemo(() => lessonSteps(lesson?.steps), [lesson]);
  const M = steps.length;
  const step = Math.max(0, Math.min(wanted, M - 1));
  const questionCount = steps.reduce((n, s) => n + s.questions.length, 0);
  const ops = useMemo(() => (lesson && lessonOps ? lessonOps(lesson.id) : null), [lesson, lessonOps]);
  const heads = useRef([]);
  const want = useRef(null);
  const live = useRef(null);
  const shown = useRef(null);
  const ids = useMemo(() => ({ tab: (t) => `hub-topic-tab-${t}`, panel: (t) => `hub-topic-panel-${t}` }), []);
  const practice = `/hub/t/${topic.id}/practice`;

  useEnter(shown, tab);
  useEnter(live, step);

  // A step opened from elsewhere (the outline, Next, Start) puts focus on its heading once shown.
  useEffect(() => {
    if (want.current === null) return;
    heads.current[want.current]?.focus();
    want.current = null;
  });

  const open = (i) => { onStep(i); want.current = i; onTab('explanation'); };

  const lessonLine = !reply ? null : !lesson ? 'Not published yet.'
    : `${plural(M, 'step', 'steps')}${questionCount ? `, ${plural(questionCount, 'question', 'questions')} to check yourself` : ''}.`;

  const noLesson = !reply ? null : lessonError ? (
    <Note tone="bad" role="alert">
      {lessonError.message}{' '}
      <button type="button" className="link hub-topic-linkbtn" onClick={onRetryLesson}>Try again</button>
    </Note>
  ) : !lesson ? (
    <Empty icon="book" title="No lesson on this topic yet">{reply.empty}</Empty>
  ) : null;

  const loadingLesson = !reply && !lessonError;

  return (
    <HubPage
      crumb={(
        <span className="hub-topic-crumb">
          <Link to="/hub">Learning Hub</Link>
          {topic.chapter?.title && (
            <>
              <span aria-hidden="true">·</span>
              <RichText as="span" className="hub-inherit" html={topic.chapter.titleHtml} text={topic.chapter.title} />
            </>
          )}
        </span>
      )}
      title={<RichText as="span" className="hub-inherit" html={topic.nameHtml} text={topic.name} />}
    >
      <div className="hub-topic-layout">
        <Panel className="hub-topic-brief" aria-label="Where you are on this topic">
          <span className="tag-mint">Where you are</span>
          {state ? <StateBrief state={state} /> : <p className="hub-topic-sentence">Your state on this topic shows here once it loads.</p>}
          <div className="brief">
            <b>Lesson</b>
            <span>{lessonLine ?? '…'}</span>
            {lesson?.label && (<><b>Made from</b><span>{lesson.label}</span></>)}
            {lesson?.language?.note && (<><b>Language</b><span>{lesson.language.note}</span></>)}
          </div>
          <div className="cluster">
            {lesson && <Button variant="accent" onClick={() => open(step)}>{step > 0 ? 'Back to the lesson' : 'Start the lesson'}</Button>}
            <Link className="btn" to={practice}>Practise</Link>
          </div>
        </Panel>

        <section className="card hub-topic-lesson" aria-label="Lesson">
          <Tabs tab={tab} onTab={onTab} ids={ids} />

          {/* Every panel stays mounted, so an answer given in step 1 is still
              there after a look at the Introduction. */}
          {TABS.map((t) => (
            <div
              key={t.id}
              role="tabpanel"
              id={ids.panel(t.id)}
              aria-labelledby={ids.tab(t.id)}
              hidden={tab !== t.id}
              tabIndex={0}
              className="hub-topic-panel"
              ref={tab === t.id ? shown : undefined}
            >
              {t.id === 'introduction' && (
                <>
                  {loadingLesson && <LessonSkeleton />}
                  {noLesson}
                  {lesson && (
                    <>
                      <div className="sec">
                        <h2>In this lesson</h2>
                        <p>{lesson.label}</p>
                      </div>
                      {lesson.language?.note && <Note icon="info">{lesson.language.note}</Note>}
                      <ol className="hub-topic-outline">
                        {steps.map((s, i) => (
                          // eslint-disable-next-line react/no-array-index-key
                          <li key={i}>
                            <button type="button" onClick={() => open(i)}>
                              <span className="hub-topic-num">{i + 1}</span>
                              <span className="grow">
                                <b>{s.cite ?? `Step ${i + 1}`}</b>
                                <small>
                                  {[s.examples.length ? 'a worked example' : '', s.questions.length ? plural(s.questions.length, 'question', 'questions') : '']
                                    .filter(Boolean).join(', ').replace(/^./, (c) => c.toUpperCase()) || 'Reading'}
                                </small>
                              </span>
                              <Icon name="chevronRight" />
                            </button>
                          </li>
                        ))}
                      </ol>
                      <div><Button variant="primary" onClick={() => open(0)}>Start the lesson</Button></div>
                    </>
                  )}
                  <section className="hub-topic-before" aria-label="What this topic needs first">
                    <div className="sec">
                      <h2>Before this topic</h2>
                    </div>
                    <Prereqs topic={topic} prerequisites={prerequisites} leadsTo={leadsTo} note={note} states={progress} />
                  </section>
                  <Later title="An introduction and the key facts">
                    Why this topic matters and the facts to hold on to come later, written from your professor&apos;s material and shown once they approve them.
                  </Later>
                </>
              )}

              {t.id === 'explanation' && (
                <>
                  {loadingLesson && <LessonSkeleton />}
                  {noLesson}
                  {lesson && steps.map((s, i) => (
                    <article
                      // eslint-disable-next-line react/no-array-index-key
                      key={i}
                      className="hub-topic-step"
                      hidden={i !== step}
                      ref={i === step ? live : undefined}
                      aria-labelledby={`hub-topic-step-${i}`}
                    >
                      <h3 className="hub-topic-stephead" id={`hub-topic-step-${i}`} tabIndex={-1} ref={(el) => { heads.current[i] = el; }}>
                        <span className="hub-topic-count">
                          Step {i + 1} of {M}
                          <span className="hub-topic-ticks" aria-hidden="true">
                            {/* eslint-disable-next-line react/no-array-index-key */}
                            {steps.map((x, k) => <i key={k} data-on={k <= i ? 'true' : undefined} />)}
                          </span>
                        </span>
                        <Cite cite={s.cite} />
                      </h3>
                      {s.chunk && <RichText className="hub-topic-text" html={s.chunk.html} text={s.chunk.text} lang={lang} />}
                      {s.examples.map((ex, k) => <Example key={`ex${k}`} ex={ex} lang={lang} />)}
                      {s.questions.length > 0 && (
                        <section className="hub-topic-check" aria-label={`Check yourself, step ${i + 1}`}>
                          <div className="hub-topic-check-head">
                            <h4>Check yourself</h4>
                            <span className="hub-topic-meta">{plural(s.questions.length, 'question', 'questions')} on this step</span>
                          </div>
                          {/* What a hint costs, said once for the step's questions rather than under each. */}
                          {s.questions.find((q) => q.hints?.available > 0 && !q.closed) && (
                            <p className="hub-topic-meta">{s.questions.find((q) => q.hints?.available > 0 && !q.closed).hints.note}</p>
                          )}
                          {s.questions.map((q, j) => (
                            <QuestionCard
                              key={qid(q)}
                              question={q}
                              slot={`lesson:${lesson.id}:${qid(q)}`}
                              label={`Question ${j + 1} of ${s.questions.length}`}
                              lang={langAttr(q.language?.language)}
                              note={q.language?.note ?? null}
                              offer={q.hints ?? null}
                              hintNote={false}
                              send={ops ? (attemptId, response, timeMs) => ops.send(q, attemptId, response, timeMs) : undefined}
                              askHint={ops ? (attemptId, n) => ops.askHint(q, attemptId, n) : undefined}
                              opened={ops ? (attemptId) => ops.opened(q, attemptId) : undefined}
                              onResult={onResult}
                            />
                          ))}
                        </section>
                      )}
                    </article>
                  ))}
                  {lesson && (
                    <nav className="hub-topic-nav" aria-label="Lesson steps">
                      <Button icon="back" disabled={step === 0} onClick={() => open(step - 1)}>Back</Button>
                      <span className="hub-topic-meta" aria-hidden="true">Step {step + 1} of {M}</span>
                      {step < M - 1
                        ? <Button variant="primary" onClick={() => open(step + 1)}>Next step <Icon name="forward" /></Button>
                        : <Link className="btn btn-primary" to={practice}>Practise this topic <Icon name="forward" /></Link>}
                    </nav>
                  )}
                  <Later title="A code example and common mistakes">
                    These come later, from your professor&apos;s material, once they approve them.
                  </Later>
                </>
              )}

              {t.id === 'visual' && (
                <Empty icon="eye" title="The visual comes later">
                  A step-by-step picture of this topic is planned. It appears here once it is drawn from your professor&apos;s material and approved. Nothing is shown until then.
                </Empty>
              )}

              {t.id === 'practice' && (
                <div className="hub-topic-go">
                  <div className="sec">
                    <h2>Practise <RichText as="span" className="hub-inherit" html={topic.nameHtml} text={topic.name} /></h2>
                    <p>Questions from your professor&apos;s approved bank, on this topic only.</p>
                  </div>
                  <ul className="hub-topic-rules">
                    <li><Icon name="target" size={15} />One question at a time, picked for you.</li>
                    <li><Icon name="idea" size={15} />A hint a step at a time, only when you ask.</li>
                    <li><Icon name="ok" size={15} />After each answer: right or wrong, the right answer and why.</li>
                  </ul>
                  <div className="cluster">
                    <Link className="btn btn-primary" to={practice}>Start practice <Icon name="forward" /></Link>
                    {prerequisites.length > 0 && (
                      <Link className="btn" to={`/hub/ready/${topic.id}`}>Skip what I know · short check</Link>
                    )}
                  </div>
                  {prerequisites.length > 0 && (
                    <p className="hub-topic-meta">
                      The short check asks a few questions on what this topic needs first, then shows what to brush up on.
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </section>
      </div>
    </HubPage>
  );
}

function LessonSkeleton() {
  return (
    <div className="hub-topic-skellesson" role="status" aria-label="Loading the lesson">
      <div className="skel" style={{ width: 160, height: 14 }} />
      <div className="skel" style={{ width: '90%', height: 18 }} />
      <div className="skel" style={{ width: '70%', height: 18 }} />
      <div className="skel" style={{ height: 120, borderRadius: 12 }} />
    </div>
  );
}

/** While the topic loads: the page's shape, in skeletons. */
export function TopicLoading() {
  return (
    <HubPage crumb={<Link to="/hub">Learning Hub</Link>} title={<><span className="sr-only">Loading the topic</span><span className="skel hub-topic-skeltitle" aria-hidden="true" /></>}>
      <div className="hub-topic-layout" role="status" aria-label="Loading the topic">
        <div className="skel hub-topic-skelbrief" />
        <div className="card hub-topic-lesson" aria-hidden="true">
          <div className="cluster cluster-5">
            {[96, 92, 52, 64].map((w) => <div key={w} className="skel" style={{ width: w, height: 16 }} />)}
          </div>
          <LessonSkeleton />
        </div>
      </div>
    </HubPage>
  );
}

/* ------------------------------------------------------------------ route */

/** The calls a lesson's question cards make, for one lesson. */
export const lessonCalls = (lessonId) => ({
  send: (q, attemptId, response, timeMs) => hub.lessonAttempt(lessonId, qid(q), {
    attemptId,
    response,
    timeMs,
    shown: { language: q.language?.language ?? 'en', translationId: q.language?.translationId ?? null },
  }),
  askHint: (q, attemptId, step) => hub.lessonHint(lessonId, qid(q), { attemptId, step }),
  opened: (q, attemptId) => hub.lessonHintsOpened(lessonId, qid(q), attemptId),
});

/** This topic's state in hub.progress's reply, or null. */
export const stateIn = (topics, topicId) => topics?.find((t) => same(t.id, topicId))?.state ?? null;

export default function Topic() {
  const { topicId } = useParams();
  const [params, setParams] = useSearchParams();
  const { version } = useHubLanguage();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [lesson, setLesson] = useState(null);
  const [lessonError, setLessonError] = useState(null);
  // GET /api/hub/progress's `topics`: null while it loads, undefined when it did not (Prereqs then reads its own).
  const [progress, setProgress] = useState(null);
  const [reading, setReading] = useState(0);
  const [lessonReading, setLessonReading] = useState(0);
  const [busy, setBusy] = useState(false);

  const raw = params.get('tab');
  const tab = TABS.some((t) => t.id === raw) ? raw : 'introduction';
  const step = Math.max(0, Number.parseInt(params.get('step') ?? '0', 10) - 1 || 0);
  const setParam = useCallback((key, value) => {
    setParams((p) => {
      const next = new URLSearchParams(p);
      if (value === null) next.delete(key); else next.set(key, value);
      return next;
    }, { replace: true });
  }, [setParams]);
  const onTab = useCallback((id) => setParam('tab', id === 'introduction' ? null : id), [setParam]);
  const onStep = useCallback((i) => setParam('step', i > 0 ? String(i + 1) : null), [setParam]);

  const readState = useCallback(() => {
    hub.progress().then((p) => setProgress(p.topics ?? [])).catch(() => setProgress(undefined));
  }, []);

  useEffect(() => {
    let on = true;
    setError(null);
    setBusy(true);
    hub.topic(topicId)
      .then((t) => { if (on) setData(t); })
      .catch((e) => { if (on) { setData(null); setError(e); } })
      .finally(() => { if (on) setBusy(false); });
    readState();
    return () => { on = false; };
  }, [topicId, reading, readState]);

  // The lesson, again after a language switch (version): the old one stays on screen until the new one is in.
  useEffect(() => {
    let on = true;
    setLessonError(null);
    hub.lesson(topicId)
      .then((l) => { if (on) setLesson(l); })
      .catch((e) => { if (on) setLessonError(e); });
    return () => { on = false; };
  }, [topicId, version, lessonReading]);

  // A lesson answer moves the topic's state: read it again for the brief.
  const onResult = useCallback((r) => { if (!r?.kept) readState(); }, [readState]);

  if (error) return <HubTrouble error={error} what="This topic" onRetry={() => setReading((n) => n + 1)} busy={busy} />;
  if (!data || !same(data.topic?.id, topicId)) return <TopicLoading />;

  return (
    <TopicView
      data={data}
      lesson={lesson && same(lesson.topic?.id, topicId) ? lesson : (lessonError ? { lesson: null } : null)}
      lessonError={lessonError}
      onRetryLesson={() => setLessonReading((n) => n + 1)}
      progress={progress}
      tab={tab}
      onTab={onTab}
      step={step}
      onStep={onStep}
      lessonOps={lessonCalls}
      onResult={onResult}
    />
  );
}
