/**
 * Self-tests, on the server's replies (docs/API.md, Phase 6, "Self-test
 * builder and results").
 *
 *   /hub/exam           ExamHome     start one (topics from the student's own map,
 *                                    levels, how many, an optional time limit),
 *                                    resume one still open, and past results
 *   /hub/exam/:examId   ExamTake     while open: the questions, "saved", answered of
 *                                    total and the status, nothing else
 *                       ExamResults  once ended: every question with the answer
 *                                    given, right or wrong, the right answer, why,
 *                                    and the summary by topic and by level
 *
 * The start's clientRunId is kept for the tab until the server has it, so a
 * retry gets the same self-test back. Every answer, and every change of one, is
 * its own attemptId, sent in order and kept on the device until the server has
 * it. The clock comes from `secondsLeft`; the server decides the end. Never a
 * mark, key, explanation, feedback or hint before the end.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { LABEL, LEVELS } from '../lib/bloom.js';
import { setDraftScope } from '../lib/draft.js';
import { useEnter } from '../lib/motion.js';
import { Button, Empty, Icon, Level, Note, Num, Panel, Segmented, Stepper, Switch } from '../ui/index.jsx';
import HubPage from './HubPage.jsx';
import { hub, newId } from './hubApi.js';
import { langAttr } from './lang.js';
import { discardPending, pendingList, usePending } from './pending.js';
import RichText from './RichText.jsx';
import {
  HandInCheck, LinkButton, TestBar, TestClock, TestNav, TestSkeleton, Trouble, Verdict, WhyBlock,
  dropRunId, endsAtOf, keptRunId, listWords, plural, toTop, useCountdown, useEvery, useFocusOnArrive, useLoad, when,
} from './TestParts.jsx';
import {
  CHOICE_KINDS, Respond, TestOptions, TestQuestion, answerWords, isAnswered, optionsOf, solutionWords,
} from './TestQuestion.jsx';

/** Until GET /hub/exams has answered with its own limits. */
const LIMITS = { maxQuestions: 30, maxMinutes: 180, graceSeconds: 30 };
/** A self-test mixes at most this many topics (the server's refusal says so too). */
export const MAX_TOPICS = 20;
const CRUMB = 'Learning Hub · Self-test';
const STAFF_SIDE = { to: '/hubs', label: 'Go to the staff hub' };
const backHome = <LinkButton to="/hub" icon="back">Back to your hub</LinkButton>;
const examPath = (examId) => `/hub/exams/${encodeURIComponent(examId)}/answers`;

/* ============================================================ the topics */

/** Every topic on the student's map, once, grouped as the map groups them. */
export function topicGroups(home) {
  const seen = new Set();
  const out = [];
  for (const c of home?.classes ?? []) {
    const klass = c.class ?? {};
    const title = [klass.courseName, klass.section].filter(Boolean).join(' · ');
    const chapters = [
      ...(c.units ?? []).flatMap((u) => (u.chapters ?? []).map((ch) => ({ ...ch, unit: u.name, unitHtml: u.nameHtml }))),
      ...(c.otherChapters?.chapters ?? []).map((ch) => ({ ...ch, unit: c.otherChapters.label })),
    ].map((ch) => ({ ...ch, topics: (ch.topics ?? []).filter((t) => !seen.has(t.id) && seen.add(t.id)) }))
      .filter((ch) => ch.topics.length);
    if (chapters.length) out.push({ id: klass.id ?? title, title, chapters });
  }
  return out;
}

/* ============================================================ home: start */

/**
 * Choosing a self-test. `initial` pre-ticks topics (from ?topicIds=). `error`
 * is the server's refusal, as given.
 */
export function ExamSetup({ home, limits = LIMITS, busy = false, error = null, initial = null, onStart, children }) {
  const groups = useMemo(() => topicGroups(home), [home]);
  const askable = useMemo(() => new Set(groups.flatMap((g) => g.chapters.flatMap((ch) => ch.topics))
    .filter((t) => (t.practiceQuestions ?? 1) > 0).map((t) => t.id)), [groups]);
  const [picked, setPicked] = useState(() => new Set((initial?.topicIds ?? []).filter((id) => askable.has(id))));
  const [levels, setLevels] = useState(() => new Set(initial?.levels ?? LEVELS));
  const [count, setCount] = useState(() => Math.min(initial?.count ?? 10, limits.maxQuestions));
  const [timed, setTimed] = useState(Boolean(initial?.minutes));
  const [minutes, setMinutes] = useState(initial?.minutes ?? 20);
  const body = useRef(null);
  useEnter(body);

  const full = picked.size >= MAX_TOPICS;
  const toggle = (set, id) => set((p) => {
    const next = new Set(p);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const minutesOk = Number.isInteger(minutes) && minutes >= 1 && minutes <= limits.maxMinutes;
  const ready = picked.size > 0 && levels.size > 0 && (!timed || minutesOk);
  const start = () => onStart({
    topicIds: [...picked], levels: LEVELS.filter((l) => levels.has(l)), count, minutes: timed ? minutes : null,
  });

  if (!groups.length) {
    return (
      <div className="card">
        <Empty icon="checklist" title="No topics to test yourself on yet" action={backHome}>
          {home?.empty || 'When your professor places chapters on your classes in the hub, their topics appear here.'}
        </Empty>
      </div>
    );
  }

  return (
    <div className="hub-test-flow" ref={body}>
      <Panel className="hub-test-brief" aria-label="About a self-test">
        <div className="hub-test-brief-main">
          <span className="tag-mint">Self-test</span>
          <p className="hub-test-lead">Answer at your own pace. Nothing is marked on screen until you hand it in.</p>
          <div className="brief">
            <b>Before</b><span>Pick topics from your own map, the levels, how many questions (at most {limits.maxQuestions}) and, if you like, a time limit.</span>
            <b>During</b><span>Each answer is saved as you go. No hints, and no right or wrong. Change any answer until the end.</span>
            <b>After</b><span>Every question with your answer, the right answer and why, and how you did by topic and by level.</span>
          </div>
        </div>
        <div className="hub-test-tiles" role="group" aria-label="What you have chosen">
          <div className="ptile"><span>Topics</span><b><Num value={picked.size} /></b><small><i>at most {MAX_TOPICS}</i></small></div>
          <div className="ptile" style={{ '--d': '0.6s' }}><span>Questions</span><b><Num value={count} /></b><small><i>at most {limits.maxQuestions}</i></small></div>
          <div className="ptile" style={{ '--d': '1.2s' }}><span>Time limit</span><b>{timed ? <Num value={minutesOk ? minutes : 0} /> : 'None'}</b><small><i>{timed ? 'minutes' : 'take your time'}</i></small></div>
        </div>
      </Panel>

      {children}

      <div className="hub-test-setup">
        <section className="card hub-test-topics" aria-labelledby="hub-test-topics-h">
          <div className="card-head">
            <div className="sec">
              <h2 id="hub-test-topics-h">Topics</h2>
              <p>{full ? `${MAX_TOPICS} chosen, the most one self-test mixes.` : 'Your state on each comes from your own answers.'}</p>
            </div>
            <Button size="sm" variant="ghost" disabled={!picked.size} onClick={() => setPicked(new Set())}>Clear</Button>
          </div>
          <div className="card-body hub-test-units">
            {groups.map((g) => (
              <div key={g.id} className="hub-test-unit">
                {groups.length > 1 && <p className="eyebrow">{g.title}</p>}
                {g.chapters.map((ch) => (
                  <fieldset key={ch.id} className="hub-test-chapter">
                    <legend>
                      <RichText as="span" html={ch.titleHtml} text={ch.title} />
                      {ch.unit && <RichText as="small" html={ch.unitHtml} text={ch.unit} />}
                    </legend>
                    {ch.topics.map((t) => {
                      const none = !askable.has(t.id);
                      const on = picked.has(t.id);
                      return (
                        <label key={t.id} className="hub-test-pick" data-none={none ? 'true' : undefined}>
                          <input type="checkbox" checked={on} disabled={none || (full && !on)} onChange={() => toggle(setPicked, t.id)} />
                          <span className="hub-test-pick-t">
                            <RichText as="b" html={t.nameHtml} text={t.name} />
                            <small>
                              {none ? 'No approved questions yet'
                                : `${t.state?.label ?? 'Not started'} · ${t.state?.answers ? `based on ${plural(t.state.answers, 'answer')}` : 'no answers yet'}`}
                            </small>
                          </span>
                        </label>
                      );
                    })}
                  </fieldset>
                ))}
              </div>
            ))}
          </div>
        </section>

        <section className="card card-pad hub-test-settings" aria-labelledby="hub-test-set-h">
          <div className="sec">
            <h2 id="hub-test-set-h">How it runs</h2>
            <p>Levels, how many questions, and a time limit if you want one.</p>
          </div>
          <fieldset className="hub-test-levels">
            <legend className="label">Levels</legend>
            {LEVELS.map((l) => (
              <label key={l} className="hub-test-level">
                <input type="checkbox" checked={levels.has(l)} onChange={() => toggle(setLevels, l)} />
                <Level level={l} />
              </label>
            ))}
          </fieldset>
          <div className="hub-test-set">
            <div className="hub-test-set-t">
              <span className="label" id="hub-test-count-l">Questions</span>
              <span className="hint">At most {limits.maxQuestions}. If fewer match, you get those, and it says so.</span>
            </div>
            <Stepper value={count} onChange={setCount} min={1} max={limits.maxQuestions} label="Number of questions" />
          </div>
          <div className="hub-test-set">
            <div className="hub-test-set-t">
              <span className="label">Time limit</span>
              <span className="hint">The clock sits above the questions. When it runs out, what you have saved is handed in.</span>
            </div>
            <Switch checked={timed} onChange={setTimed} label="Time limit" />
          </div>
          {timed && (
            <div className="hub-test-set">
              <label className="hub-test-set-t" htmlFor="hub-test-minutes">
                <span className="label">Minutes</span>
                <span className="hint">1 to {limits.maxMinutes}.</span>
              </label>
              <input
                id="hub-test-minutes"
                className="input hub-test-minutes"
                type="number"
                inputMode="numeric"
                min={1}
                max={limits.maxMinutes}
                value={Number.isFinite(minutes) ? minutes : ''}
                aria-invalid={minutesOk ? undefined : 'true'}
                onChange={(e) => setMinutes(e.target.value === '' ? NaN : Math.round(Number(e.target.value)))}
              />
            </div>
          )}
          {error && <Note tone="bad" role="alert">{error}</Note>}
          <Button variant="primary" size="lg" block icon="play" busy={busy} disabled={!ready} onClick={start}>
            Start the self-test
          </Button>
          <p className="hint" aria-live="polite">
            {!picked.size ? 'Pick at least one topic to start.'
              : !levels.size ? 'Pick at least one level.'
                : timed && !minutesOk ? `A time limit is 1 to ${limits.maxMinutes} minutes.`
                  : `Up to ${plural(count, 'question')} from ${plural(picked.size, 'topic')}, ${timed ? plural(minutes, 'minute') : 'no time limit'}.`}
          </p>
        </section>
      </div>
    </div>
  );
}

const topicNames = (e) => listWords((e.topics ?? []).map((t) => t.name));

/** A self-test still open, to carry on with. */
export function ExamOpen({ exams = [] }) {
  return exams.filter((e) => e.status === 'open').map((e) => (
    <section key={e.id} className="card hub-test-resume" aria-label="A self-test you have not handed in">
      <span className="hub-test-resume-ic" aria-hidden="true"><Icon name="clock" size={18} /></span>
      <div className="hub-test-resume-t">
        <b>A self-test is still open</b>
        <span>
          {topicNames(e)}. {e.answered} of {e.total} answered
          {e.secondsLeft != null ? `, ${Math.ceil(e.secondsLeft / 60)} min left` : ''}. Started {when(e.startedAt)}.
        </span>
      </div>
      <LinkButton to={`/hub/exam/${e.id}`} variant="primary" icon="play">Carry on</LinkButton>
    </section>
  ));
}

/** Self-tests that have ended, newest first as sent, each to read again. */
export function ExamPast({ exams = [] }) {
  const ended = exams.filter((e) => e.status !== 'open');
  if (!ended.length) return null;
  return (
    <section className="card" aria-labelledby="hub-test-past-h">
      <div className="card-head">
        <div className="sec">
          <h2 id="hub-test-past-h">Your past self-tests</h2>
          <p>Only you and your professor see these. They count in no mark.</p>
        </div>
      </div>
      <ul className="hub-test-past">
        {ended.map((e) => (
          <li key={e.id}>
            <div className="hub-test-past-t">
              <b>{topicNames(e)}</b>
              <span>{e.sentence}{e.endReason === 'timed-out' ? ' The time ran out.' : ''}</span>
            </div>
            <span className="hub-test-past-d mono">{when(e.endedAt ?? e.startedAt)}</span>
            <LinkButton to={`/hub/exam/${e.id}`} size="sm">See the answers<Icon name="forward" /></LinkButton>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ExamHome() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const load = useLoad(() => Promise.all([hub.exams(), hub.home()]).then(([list, home]) => ({ list, home })), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const initial = useMemo(() => ({ topicIds: (params.get('topicIds') ?? '').split(',').filter(Boolean) }), [params]);

  const start = async (choice) => {
    const body = {
      topicIds: choice.topicIds, levels: choice.levels, count: choice.count,
      ...(choice.minutes ? { timeLimitMinutes: choice.minutes } : {}),
    };
    // One id per choice, kept until the server has it: a retry gets the same self-test.
    const scope = `exam:${JSON.stringify(body)}`;
    setBusy(true);
    setError(null);
    try {
      const reply = await hub.examStart({ clientRunId: keptRunId(scope), ...body });
      dropRunId(scope);
      navigate(`/hub/exam/${reply.exam.id}`);
    } catch (e) {
      if (e.status && e.status < 500) dropRunId(scope);
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <HubPage crumb={CRUMB} title="Test yourself" sub="A self-test is for you. It counts in no mark, and nobody is compared with you.">
      {load.state === 'loading' && <TestSkeleton />}
      {load.state === 'failed' && <Trouble error={load.error} onRetry={load.retry} back={backHome} elsewhere={STAFF_SIDE} />}
      {load.state === 'ready' && (
        <>
          <ExamSetup home={load.data.home} limits={load.data.list.limits ?? LIMITS} busy={busy} error={error} initial={initial} onStart={start}>
            <ExamOpen exams={load.data.list.exams} />
          </ExamSetup>
          <ExamPast exams={load.data.list.exams} />
        </>
      )}
    </HubPage>
  );
}

/* ================================================================= taking */

const MODES = [{ id: 'one', label: 'One at a time' }, { id: 'all', label: 'All questions' }];

/** What a question's save says: only that it is saved, or where it is. */
function SaveLine({ save, words = null }) {
  if (!save) return <p className="hub-test-save" />;
  const s = {
    saving: [null, 'Saving'],
    // A built answer (a ranking, a value) says what was saved: the control may not show it after a reload.
    saved: ['check', words ? `Saved: ${words}` : 'Saved'],
    late: ['info', save.message],
    kept: [save.closed ? 'clock' : 'wifiOff', `Kept on this device. ${save.message}`],
    error: ['alert', save.message],
  }[save.state];
  if (!s) return <p className="hub-test-save" />;
  return (
    <p className="hub-test-save" data-state={save.state}>
      {s[0] ? <Icon name={s[0]} size={14} /> : <span className="spinner" aria-hidden="true" />}
      <span>{s[1]}</span>
    </p>
  );
}

/**
 * Answering, as a pure view. `responses` and `saves` are by question id;
 * `onAnswer(item, response)` saves one; `onHandIn` hands in. `left` is the
 * clock's seconds (null without a limit); at 0 the questions lock and the
 * page waits for the server's end.
 */
export function ExamTake({
  data, responses, saves, counts, left = null, onAnswer, onHandIn, handing = false, error = null, kept = 0,
  initialIndex = 0, initialMode = 'one', initialCheck = false,
}) {
  const { exam } = data;
  const items = data.questions;
  const n = items.length;
  const [mode, setMode] = useState(initialMode);
  const [at, setAt] = useState(Math.min(initialIndex, Math.max(0, n - 1)));
  const [checking, setChecking] = useState(initialCheck);
  const up = left === 0;
  const locked = up || handing;
  const answered = items.map((it) => (it.removed ? null : saves[it.questionId]?.state === 'saved' || (it.answered && !saves[it.questionId]) || saves[it.questionId]?.state === 'kept'));
  const missing = answered.flatMap((a, i) => (a === false ? [i] : []));

  const main = useRef(null);
  const cards = useRef([]);
  useEnter(main, mode === 'one' ? `q${at}` : 'all');

  // After a move, take focus (and a screen reader) to the question moved to.
  const go = (i, as = mode) => {
    setAt(i);
    requestAnimationFrame(() => {
      const el = as === 'one' ? cards.current[0] : cards.current[i];
      if (!el) return;
      if (as === 'all') el.scrollIntoView({ block: 'start' });
      el.focus({ preventScroll: as === 'all' });
    });
  };
  const handIn = () => { if (missing.length || kept) setChecking(true); else onHandIn(); };

  const card = (it, i, foot) => {
    const textId = `hub-exam-q${i}`;
    if (it.removed) {
      return (
        <article key={it.questionId} ref={(el) => { cards.current[mode === 'one' ? 0 : i] = el; }} className="card hub-test-q hub-test-q-gone" tabIndex={-1}>
          <header className="hub-test-q-head"><span className="hub-test-q-n">Question {i + 1} of {n}</span></header>
          <p className="hub-test-gone">{it.sentence}</p>
          {foot}
        </article>
      );
    }
    return (
      <TestQuestion
        key={it.questionId}
        ref={(el) => { cards.current[mode === 'one' ? 0 : i] = el; }}
        question={it.question}
        number={i + 1}
        of={n}
        topicName={it.topic?.name}
        lang={langAttr(it.language)}
        languageNote={it.languageNote}
        textId={textId}
        className="hub-test-q-scroll"
      >
        <Respond
          question={it.question}
          value={responses[it.questionId]}
          onChoose={(r) => onAnswer(it, r)}
          onSubmit={(r) => onAnswer(it, r)}
          disabled={locked}
          busy={saves[it.questionId]?.state === 'saving' && !CHOICE_KINDS.has(it.question?.kind ?? 'mcq')}
          labelledBy={textId}
          lang={langAttr(it.language)}
        />
        <SaveLine
          save={saves[it.questionId] ?? (it.answered ? { state: 'saved' } : null)}
          words={CHOICE_KINDS.has(it.question?.kind ?? 'mcq') ? null : answerWords(it.question, responses[it.questionId])}
        />
        {foot}
      </TestQuestion>
    );
  };

  return (
    <>
      <TestBar done={counts.answered} of={counts.total} status={counts.status}>
        {left != null && <TestClock left={left} minutes={exam.timeLimitMinutes ?? 0} />}
      </TestBar>

      {exam.shortNote && <p className="said">{exam.shortNote}</p>}
      {up && (
        <div className="note note-warn hub-test-up" role="alert">
          <Icon name="timer" />
          <span className="grow">
            <b>Time is up.</b> The server hands in what you saved, and this page shows your answers as soon as it has.
          </span>
          <Button size="sm" busy={handing} onClick={() => onHandIn()}>Hand in now</Button>
        </div>
      )}
      {error && <Note tone="bad" role="alert">{error}</Note>}

      <div className="hub-test-take">
        <div className="hub-test-main" ref={main}>
          {mode === 'one'
            ? card(items[at], at, (
              <footer className="hub-test-foot">
                <Button icon="chevronLeft" disabled={at === 0} onClick={() => go(at - 1)}>Previous</Button>
                {at < n - 1
                  ? <Button variant="ink" onClick={() => go(at + 1)}>Next<Icon name="forward" /></Button>
                  : <Button variant="primary" busy={handing} disabled={up} onClick={handIn}>Hand in</Button>}
              </footer>
            ))
            : items.map((it, i) => card(it, i))}
        </div>

        <Panel as="aside" className="hub-test-side" aria-label="Your answers">
          <span className="tag-mint">Your answers</span>
          <TestNav tone="panel" answered={answered} current={mode === 'one' ? at : null} onGo={go} />
          <p className="hub-test-legend">
            <span><i data-done="true" aria-hidden="true" />Saved</span>
            <span><i aria-hidden="true" />No answer yet</span>
          </p>
          <Segmented options={MODES} value={mode} onChange={(m) => { setMode(m); go(at, m); }} label="Show the questions" />
          <Button variant="accent" block busy={handing} disabled={up} onClick={handIn}>Hand in</Button>
          <p className="hub-test-side-note">{data.note}</p>
          {data.hints?.note && <p className="hub-test-side-note">{data.hints.note}</p>}
        </Panel>
      </div>

      <HandInCheck
        open={checking}
        onOpenChange={setChecking}
        missing={missing}
        kept={kept}
        busy={handing}
        onGo={(i) => { setChecking(false); setTimeout(() => go(i), 60); }}
        onHandIn={() => { setChecking(false); onHandIn(); }}
      />
    </>
  );
}

/** The open self-test, saving each answer as it is given. */
function ExamTakeRoute({ examId, data, onEnded, reload }) {
  const [responses, setResponses] = useState(() => Object.fromEntries(
    data.questions.filter((q) => !q.removed && q.answered).map((q) => [q.questionId, q.response]),
  ));
  const [saves, setSaves] = useState({});
  const [counts, setCounts] = useState({ answered: data.answered, total: data.exam.total, status: data.exam.status });
  const [handing, setHanding] = useState(false);
  const [error, setError] = useState(null);
  const [endsAt] = useState(() => endsAtOf(data.exam));
  const left = useCountdown(endsAt);
  const chain = useRef(Promise.resolve());
  const latest = useRef({});
  const shownAt = useRef(Date.now());
  const path = examPath(examId);
  const kept = usePending().filter((p) => p.path === path).length;

  // The phone's controls keep what is built but not yet saved on this device, per question, for this self-test.
  useEffect(() => {
    setDraftScope(`HUBEXAM-${examId}`, 'SELF');
    return () => setDraftScope('', '');
  }, [examId]);

  // At zero the server ends it (after a short grace for answers on their way): read it until it has.
  useEvery(left === 0 && !handing, 5000, reload);

  const mark = (id, save) => setSaves((s) => ({ ...s, [id]: save }));

  const answer = (item, response) => {
    const id = item.questionId;
    setResponses((r) => ({ ...r, [id]: response }));
    if (!isAnswered(response)) return;
    const token = (latest.current[id] ?? 0) + 1;
    latest.current[id] = token;
    mark(id, { state: 'saving' });
    // In order, one at a time: the last answer sent is the one that counts.
    chain.current = chain.current.then(async () => {
      if (latest.current[id] !== token) return; // changed again before this one went
      // An older answer to this question still kept on the device must not arrive after this one.
      for (const p of pendingListFor(path)) if (p.body?.questionId === id) discardPending(p.key);
      const body = {
        attemptId: newId(), questionId: id, response,
        timeTakenMs: Math.max(0, Date.now() - shownAt.current),
        shown: { language: item.language ?? 'en', translationId: item.translationId ?? null },
      };
      try {
        const r = await hub.examAnswer(examId, body);
        setCounts({ answered: r.answered, total: r.total, status: r.status });
        mark(id, r.late ? { state: 'late', message: r.message } : { state: 'saved' });
        if (r.status === 'ended') reload();
      } catch (e) {
        mark(id, e.kept ? { state: 'kept', message: e.message, closed: e.closed } : { state: 'error', message: e.message });
      }
    });
  };

  const handIn = async () => {
    if (handing) return;
    setHanding(true);
    setError(null);
    await chain.current; // the answers on their way go first
    try {
      onEnded(await hub.examSubmit(examId));
      toTop();
    } catch (e) {
      setError(e.message);
      setHanding(false);
    }
  };

  return (
    <ExamTake
      data={data} responses={responses} saves={saves} counts={counts} left={left} kept={kept}
      onAnswer={answer} onHandIn={handIn} handing={handing} error={error}
    />
  );
}

/* pending.js lists every kept answer; this narrows it to one self-test's. */
const pendingListFor = (path) => pendingList().filter((p) => p.path === path);

/* ================================================================ results */

const FILTERS = (rows) => {
  const right = rows.filter((r) => r.answered && r.correct && r.mark !== 'provisional').length;
  return [
    { id: 'all', label: 'All', count: rows.length },
    { id: 'again', label: 'To go over', count: rows.length - right },
    { id: 'right', label: 'Right', count: right },
  ];
};

/** One question's result, as the server marked it. */
function ResultItem({ r }) {
  const q = r.question;
  const choice = q && CHOICE_KINDS.has(q.kind ?? 'mcq');
  const given = q ? answerWords(q, r.response) : null;
  const right = q && r.solution != null ? solutionWords(q, r.solution) : null;
  const optionText = (i) => optionsOf(q ?? {})[Number(i)]?.text;
  return (
    <li className="hub-test-res-item" data-v={!r.answered ? 'none' : r.correct ? 'right' : 'wrong'}>
      <header className="hub-test-res-head">
        <span className="hub-test-res-n">Question {r.position}</span>
        {r.topic?.name && <RichText as="span" className="hub-test-res-topic" html={r.topic.nameHtml} text={r.topic.name} />}
        {r.bloom && <Level level={r.bloom}>{r.levelLabel ?? LABEL[r.bloom]}</Level>}
        <Verdict answered={r.answered} correct={r.correct} provisional={r.mark === 'provisional'} held={r.held} />
      </header>
      {q && <RichText className="hub-test-res-text" html={q.rich?.text} text={q.text} />}
      {q && choice && r.answered && !r.held && r.solution != null
        ? <TestOptions question={q} value={r.response} solution={r.solution} disabled />
        : (
          <dl className="hub-test-res-ans">
            <div><dt>Your answer</dt><dd data-none={given ? undefined : 'true'}>{given ?? 'No answer'}</dd></div>
            {right && <div><dt>Right answer</dt><dd>{right}</dd></div>}
          </dl>
        )}
      <p className="hub-test-mark-l">{r.markLabel}</p>
      {r.heldNote && <Note icon="clock">{r.heldNote}</Note>}
      <WhyBlock explanation={r.explanation} optionFeedback={r.optionFeedback} optionText={optionText} />
      {(r.topicId || r.topic?.id) && (
        <LinkButton to={`/hub/t/${r.topicId ?? r.topic.id}/practice`} size="sm" icon="refresh">
          Practise {r.topic?.name || 'this topic'}
        </LinkButton>
      )}
    </li>
  );
}

/** The result: the end in the server's words, the summary, then every question. */
export function ExamResults({ result, initialFilter = 'all' }) {
  const [filter, setFilter] = useState(initialFilter);
  const lead = useRef(null);
  const body = useRef(null);
  useFocusOnArrive(lead);
  useEnter(body);
  const rows = result.questions ?? [];
  const o = result.summary?.overall ?? {};
  const shown = rows.filter((r) => {
    const right = r.answered && r.correct && r.mark !== 'provisional';
    return filter === 'all' || (filter === 'right' ? right : !right);
  });
  return (
    <div className="hub-test-flow" ref={body}>
      <Panel className="hub-test-brief" aria-label="Your self-test, ended">
        <div className="hub-test-brief-main">
          <span className="tag-mint">Self-test · {result.exam?.endReason === 'timed-out' ? 'time ran out' : 'handed in'}</span>
          <p className="hub-test-lead" ref={lead} tabIndex={-1}>{o.sentence}</p>
          <p className="hub-test-brief-note">{result.ended}{result.exam?.endedAt ? ` ${when(result.exam.endedAt)}.` : ''}</p>
          {result.lateNote && <p className="hub-test-brief-note">{result.lateNote}</p>}
          <div className="cluster">
            <LinkButton to="/hub/exam" variant="accent" icon="refresh">Another self-test</LinkButton>
          </div>
        </div>
        <div className="hub-test-tiles" role="group" aria-label="Your answers in figures">
          <div className="ptile"><span>Right</span><b>{o.right ?? 0}</b><small><i>of {o.questions ?? rows.length}</i></small></div>
          <div className="ptile" style={{ '--d': '0.6s' }}><span>Not right</span><b>{Math.max(0, (o.answered ?? 0) - (o.right ?? 0))}</b><small><i>of {o.questions ?? rows.length}</i></small></div>
          <div className="ptile" style={{ '--d': '1.2s' }}><span>Not answered</span><b>{o.unmarked ?? 0}</b><small><i>of {o.questions ?? rows.length}</i></small></div>
        </div>
      </Panel>

      <p className="said">{result.note}</p>

      <div className="hub-test-sums">
        <section className="card" aria-labelledby="hub-test-bytopic-h">
          <div className="card-head"><div className="sec"><h2 id="hub-test-bytopic-h">By topic</h2><p>In the order you chose them.</p></div></div>
          <ul className="hub-test-sum">
            {(result.summary?.byTopic ?? []).map((t) => (
              <li key={t.topic?.id}>
                <b>{t.topic?.name}</b>
                <span>{t.sentence}</span>
                <span className="hub-test-sum-bar" aria-hidden="true"><i style={{ width: `${t.questions ? Math.round((t.right / t.questions) * 100) : 0}%` }} /></span>
              </li>
            ))}
          </ul>
        </section>
        <section className="card" aria-labelledby="hub-test-bylevel-h">
          <div className="card-head"><div className="sec"><h2 id="hub-test-bylevel-h">By level</h2><p>Remember to Create, the levels asked.</p></div></div>
          <ul className="hub-test-sum">
            {(result.summary?.byLevel ?? []).map((l) => (
              <li key={l.level}>
                <Level level={l.level}>{l.label}</Level>
                <span>{l.sentence}</span>
                <span className="hub-test-sum-bar" aria-hidden="true"><i style={{ width: `${l.questions ? Math.round((l.right / l.questions) * 100) : 0}%` }} /></span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="card" aria-labelledby="hub-test-res-h">
        <div className="card-head hub-test-res-top">
          <div className="sec">
            <h2 id="hub-test-res-h">Question by question</h2>
            <p>Each with your answer, the right answer and why. Practise a topic to go over it.</p>
          </div>
          <Segmented options={FILTERS(rows)} value={filter} onChange={setFilter} label="Show" />
        </div>
        {shown.length
          ? <ol className="hub-test-res">{shown.map((r) => <ResultItem key={`${r.position}-${r.questionId}`} r={r} />)}</ol>
          : (
            <Empty icon="ok" title={filter === 'right' ? 'None right this time' : 'Nothing to go over'}>
              {filter === 'right' ? 'Every question is under "To go over".' : 'Every answer was right.'}
            </Empty>
          )}
      </section>
    </div>
  );
}

/* ================================================================== route */

function ExamRun({ examId }) {
  const load = useLoad(() => hub.exam(examId), [examId]);
  const ended = load.data?.exam?.status === 'ended';
  const names = listWords((load.data?.exam?.topics ?? []).map((t) => t.name));
  return (
    <HubPage
      crumb={CRUMB}
      title={ended ? 'Your self-test' : 'Self-test'}
      sub={load.state === 'ready' ? names : undefined}
      actions={ended || load.state !== 'ready' ? <LinkButton to="/hub/exam" icon="back">All self-tests</LinkButton> : null}
    >
      {load.state === 'loading' && <TestSkeleton />}
      {load.state === 'failed' && (
        <Trouble error={load.error} onRetry={load.retry} back={<LinkButton to="/hub/exam" icon="back">All self-tests</LinkButton>} elsewhere={STAFF_SIDE} />
      )}
      {load.state === 'ready' && (ended
        ? <ExamResults result={load.data} />
        : <ExamTakeRoute examId={examId} data={load.data} onEnded={load.set} reload={load.retry} />)}
    </HubPage>
  );
}

export default function Exam() {
  const { examId } = useParams();
  return examId ? <ExamRun key={examId} examId={examId} /> : <ExamHome />;
}
