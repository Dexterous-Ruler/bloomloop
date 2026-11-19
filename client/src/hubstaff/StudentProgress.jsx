/**
 * One student's hub, for their professor and the department's HOD, read-only
 * (/hubs/c/:classId/s/:rosterId): GET …/students/:rosterId/progress and
 * GET …/students/:rosterId/getready.
 *
 *   activity      how much and when: answers in the last 7 and 30 days, days
 *                 active, by mode, hints opened (as counts, never a mark)
 *   topics        each of the class's topics: the state, N, provisional, the
 *                 server's sentence, open errors
 *   error log     each entry's question, the answer given, the right answer,
 *                 where it came from, its status and sentence, its question id
 *   Get Ready     each check on the class's topics: target, outcomes with their
 *                 sentences, the path's progress
 *
 * Never a ranking, a class average, or the student's goals (the server sends
 * none of them). A roster row with no account shows the server's note.
 */

import { useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import '../styles/hub.css';
import '../styles/hub-practice.css';
import '../styles/hub-progress.css';
import { useEnter } from '../lib/motion.js';
import { Empty, Icon, Level, Panel, Segmented } from '../ui/index.jsx';
import AccountShell from '../shell/AccountShell.jsx';
import { staffHub } from '../hub/hubApi.js';
import RichText from '../hub/RichText.jsx';
import { TestSkeleton, Trouble, plural, useLoad, when } from '../hub/TestParts.jsx';
import { answerWords, solutionWords } from '../hub/TestQuestion.jsx';
import { StateKey, StateTag, showProvisional } from './ClassProgress.jsx';

const MODES = [
  ['practice', 'Practice'], ['review', 'Review sets'], ['lesson', 'Lessons'], ['exam', 'Self-tests'], ['getready', 'Get Ready'],
];
const OUTCOME = { ready: 'Ready', 'needs-review': 'Needs review', 'not-sure': 'Not sure yet' };
const STEP = { done: 'Done', 'in-progress': 'Started', 'to-do': 'To do' };
const STUDENT_SIDE = { to: '/hub', label: 'Go to your hub' };

/* --------------------------------------------------------------- activity */

function Activity({ a }) {
  const max = Math.max(1, ...MODES.map(([m]) => a.byMode?.[m] ?? 0));
  return (
    <section className="card" aria-labelledby="hub-sp-act-h">
      <div className="card-head">
        <div className="sec">
          <h2 id="hub-sp-act-h">Activity by kind</h2>
          <p>{a.lastAt ? `Last answer ${when(a.lastAt)}.` : 'No answers in the hub yet.'} Counts, not marks.</p>
        </div>
      </div>
      <ul className="hub-sp-modes">
        {MODES.map(([m, label]) => (
          <li key={m}>
            <span>{label}</span>
            <span className="hub-sp-modes-bar" aria-hidden="true"><i style={{ width: `${Math.round(((a.byMode?.[m] ?? 0) / max) * 100)}%` }} /></span>
            <b className="mono">{a.byMode?.[m] ?? 0}</b>
          </li>
        ))}
      </ul>
      <p className="hub-sp-hints">
        <Icon name="idea" size={14} />
        {a.hintsUsed
          ? `${plural(a.hintsUsed, 'hint')} opened, on ${plural(a.attemptsWithHints ?? 0, 'answer')}.`
          : 'No hints opened.'}
      </p>
    </section>
  );
}

/* ----------------------------------------------------------------- topics */

function Topics({ topics, states }) {
  return (
    <section className="card" aria-labelledby="hub-sp-topics-h">
      <div className="card-head">
        <div className="sec">
          <h2 id="hub-sp-topics-h">Topics</h2>
          <p>In the class's order. N is how many answers a state rests on.</p>
        </div>
      </div>
      <div className="hub-sp-keyrow"><StateKey states={states} /></div>
      {topics.length ? (
        <ul className="hub-sp-topics">
          {topics.map((t) => (
            <li key={t.id}>
              <div className="hub-sp-topic-t">
                <RichText as="b" html={t.nameHtml} text={t.name} />
                <small>
                  {t.unit?.name && <><RichText as="span" html={t.unit.nameHtml} text={t.unit.name} />{' · '}</>}
                  <RichText as="span" html={t.chapter?.titleHtml} text={t.chapter?.title} />
                </small>
              </div>
              <div className="hub-sp-topic-s">
                <StateTag state={t.state?.state} label={t.state?.label} provisional={showProvisional(t.state)} />
                <span className="mono hub-sp-n">N {t.state?.answers ?? 0}</span>
                {t.openErrors > 0 && <span className="hub-prog-err">{t.openErrors} open</span>}
              </div>
              {t.state?.sentence && <p className="hub-sp-topic-p">{t.state.sentence}</p>}
            </li>
          ))}
        </ul>
      ) : <Empty icon="material" title="No topics on this class yet" />}
    </section>
  );
}

/* -------------------------------------------------------------- error log */

function ErrorEntry({ e }) {
  const q = e.question;
  const given = q ? answerWords(q, e.response) : null;
  const right = q && e.solution != null ? solutionWords(q, e.solution) : null;
  const chapterId = e.topic?.chapter?.id;
  return (
    <li className="hub-sp-err" data-status={e.status}>
      <header className="hub-test-res-head">
        <span className="hub-sp-err-s" data-status={e.status}>{e.status === 'open' ? 'Open' : 'Cleared'}</span>
        <span className="hub-test-res-topic">{e.fromLabel}</span>
        {e.topic?.name && <RichText as="span" className="hub-test-res-topic" html={e.topic.nameHtml} text={e.topic.name} />}
        {e.level && <Level level={e.level}>{e.levelLabel}</Level>}
        <span className="hub-sp-err-d mono">{e.times > 1 ? `${e.times} times, last ` : ''}{when(e.lastAt)}</span>
      </header>
      {q && <RichText className="hub-test-res-text" html={q.rich?.text} text={q.text} />}
      <dl className="hub-test-res-ans">
        <div><dt>Their answer</dt><dd data-none={given ? undefined : 'true'}>{given ?? 'No answer'}</dd></div>
        {right && <div><dt>Right answer</dt><dd>{right}</dd></div>}
      </dl>
      <p className="hub-test-mark-l">{e.sentence}</p>
      {e.provisional && <p className="hub-test-mark-l">A written answer with a provisional machine mark.</p>}
      {(e.prerequisites ?? []).length > 0 && (
        <p className="hub-sp-err-pre">Builds on: {e.prerequisites.map((p) => p.name).filter(Boolean).join(', ')}</p>
      )}
      {e.questionId && (
        <p className="hub-sp-err-q">
          <span>Question <span className="mono">{e.questionId}</span></span>
          {chapterId && <Link to={`/hubs/ch/${chapterId}?tab=explanations`}>Open in its chapter<Icon name="forward" size={13} /></Link>}
        </p>
      )}
    </li>
  );
}

function ErrorLog({ errors }) {
  const [show, setShow] = useState('open');
  const entries = errors?.entries ?? [];
  const shown = entries.filter((e) => show === 'all' || e.status === show);
  return (
    <section className="card" aria-labelledby="hub-sp-err-h">
      <div className="card-head hub-test-res-top">
        <div className="sec">
          <h2 id="hub-sp-err-h">Error log</h2>
          <p>{errors?.rule}</p>
        </div>
        <Segmented
          label="Show"
          value={show}
          onChange={setShow}
          options={[
            { id: 'open', label: 'Open', count: errors?.counts?.open ?? 0 },
            { id: 'cleared', label: 'Cleared', count: errors?.counts?.cleared ?? 0 },
            { id: 'all', label: 'All', count: entries.length },
          ]}
        />
      </div>
      {shown.length
        ? <ol className="hub-test-res">{shown.map((e) => <ErrorEntry key={e.id} e={e} />)}</ol>
        : <Empty icon="ok" title={show === 'cleared' ? 'Nothing cleared yet' : 'Nothing open'}>Newest first, when there are entries.</Empty>}
    </section>
  );
}

/* -------------------------------------------------------------- Get Ready */

function Checks({ ready }) {
  const checks = ready?.checks ?? [];
  return (
    <section className="card" aria-labelledby="hub-sp-ready-h">
      <div className="card-head">
        <div className="sec">
          <h2 id="hub-sp-ready-h">Get Ready checks</h2>
          <p>{ready?.note}</p>
        </div>
      </div>
      {checks.length ? (
        <ul className="hub-sp-checks">
          {checks.map((c) => (
            <li key={c.id}>
              <header className="hub-sp-check-h">
                <b>Before <RichText as="span" html={c.target?.nameHtml} text={c.target?.name} /></b>
                <span className="hub-sp-check-s" data-s={c.status}>{c.status === 'open' ? 'Open' : 'Complete'}</span>
                <span className="mono hub-sp-err-d">{when(c.endedAt ?? c.startedAt)} · {plural(c.asked ?? 0, 'question')}</span>
              </header>
              <p className="hub-sp-check-p">{c.sentence}</p>
              <ul className="hub-sp-check-pre">
                {(c.prerequisites ?? []).map((p) => (
                  <li key={p.topic?.id} data-o={p.outcome ?? p.status}>
                    <b>{p.topic?.name}</b>
                    <span className="hub-sp-out">{p.label ?? OUTCOME[p.outcome] ?? (p.status === 'asking' ? 'Being checked' : 'Still to check')}</span>
                    <span>{p.sentence}</span>
                  </li>
                ))}
              </ul>
              {c.path && (
                <div className="hub-sp-path">
                  <span className="hub-sp-path-l">Refresher path · {c.path.done} of {plural(c.path.total ?? c.path.steps?.length ?? 0, 'step')} done</span>
                  <ol>
                    {(c.path.steps ?? []).map((s) => (
                      <li key={s.topicId} data-status={s.status}>
                        <b>{s.name}</b>
                        <span className="hub-sp-out">{STEP[s.status] ?? s.status}</span>
                        <span>{s.sentence}</span>
                      </li>
                    ))}
                    {c.path.target && (
                      <li data-target="true">
                        <b>{c.path.target.name}</b>
                        <span className="hub-sp-out">{c.path.target.status === 'ready' ? 'Ready to start' : 'The goal'}</span>
                        <span>{c.path.target.sentence}</span>
                      </li>
                    )}
                  </ol>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : <Empty icon="path" title="No checks on this class's topics">None yet.</Empty>}
    </section>
  );
}

/* ------------------------------------------------------------------ page */

/** The page's body as a pure view: `progress` and `ready` are the two replies. */
export function StudentProgressView({ progress, ready }) {
  const body = useRef(null);
  useEnter(body);
  const a = progress.activity;
  const reader = progress.class?.access === 'reader';
  if (!a) {
    return (
      <div className="card">
        <Empty icon="user" title="No hub practice to show">{progress.note ?? ready?.note}</Empty>
      </div>
    );
  }
  return (
    <div className="hub-sp" ref={body}>
      <Panel className="hub-test-brief" aria-label="This student in the hub">
        <div className="hub-test-brief-main">
          <span className="tag-mint">{reader ? 'One student · read only' : 'One student'}</span>
          <p className="hub-test-lead">
            {a.total
              ? `${plural(a.total, 'answer')} in the hub on this class's topics; ${a.last7Days} in the last 7 days, on ${plural(a.daysActiveLast7 ?? 0, 'day')}.`
              : 'No answers in the hub on this class\'s topics yet.'}
          </p>
          <p className="hub-test-brief-note">Their own practice only. Nothing here compares them with anyone.</p>
        </div>
        <div className="hub-test-tiles" role="group" aria-label="Activity in figures">
          <div className="ptile"><span>Last 7 days</span><b>{a.last7Days}</b><small><i>answers</i></small></div>
          <div className="ptile" style={{ '--d': '0.6s' }}><span>Last 30 days</span><b>{a.last30Days}</b><small><i>answers</i></small></div>
          <div className="ptile" style={{ '--d': '1.2s' }}><span>Hints opened</span><b>{a.hintsUsed ?? 0}</b><small><i>on {plural(a.attemptsWithHints ?? 0, 'answer')}</i></small></div>
        </div>
      </Panel>
      <div className="hub-sp-grid">
        <Topics topics={progress.topics ?? []} states={progress.states} />
        <Activity a={a} />
      </div>
      <ErrorLog errors={progress.errors} />
      <Checks ready={ready} />
    </div>
  );
}

export default function StudentProgress() {
  const { classId, rosterId } = useParams();
  const load = useLoad(() => Promise.all([staffHub.studentProgress(classId, rosterId), staffHub.studentReady(classId, rosterId)])
    .then(([progress, ready]) => ({ progress, ready })), [classId, rosterId]);
  const p = load.data?.progress;
  const klass = p?.class;
  const crumb = useMemo(() => [klass?.courseName, klass?.section].filter(Boolean).join(' · ') || 'Learning Hub', [klass]);
  const back = <Link className="btn btn-ghost" to={`/hubs/c/${classId}?tab=progress`}><Icon name="back" />Class progress</Link>;
  return (
    <AccountShell
      current="hub"
      crumb={`${crumb} · Learning Hub`}
      title={p?.student ? (p.student.name || p.student.rollNo) : 'Student'}
      sub={p?.student ? `Roll ${p.student.rollNo}` : undefined}
      actions={back}
      width="wide"
    >
      <div className="hub">
        {load.state === 'loading' && <TestSkeleton />}
        {load.state === 'failed' && <Trouble error={load.error} onRetry={load.retry} back={back} elsewhere={STUDENT_SIDE} />}
        {load.state === 'ready' && <StudentProgressView progress={load.data.progress} ready={load.data.ready} />}
      </div>
    </AccountShell>
  );
}
