/**
 * Students by state, one topic at a time (GET /api/hub/classes/:id/states),
 * the "states" tab inside the class frame: a column per state, each listing
 * its students in roll order with N (the answers the state rests on) and a
 * provisional marker. Roster rows no account carries are listed apart, with
 * the server's reason.
 *
 * Roll order inside every column. No sorting, no ranking, no average beside a
 * name. The HOD reads the same page; there is nothing on it to change.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Empty } from '../ui/index.jsx';
import { staffHub } from '../hub/hubApi.js';
import RichText from '../hub/RichText.jsx';
import { Trouble, plural, useLoad } from '../hub/TestParts.jsx';
import { CountsBar, ProgressSkeleton, STATE_ORDER, StateMark, showProvisional } from './ClassProgress.jsx';

const STUDENT_SIDE = { to: '/hub', label: 'Go to your hub' };

/** One topic's students, a column per state. */
function Board({ topic, states, classId }) {
  const order = Object.keys(states ?? {}).length ? Object.keys(states) : STATE_ORDER;
  return (
    <div className="hub-states-board" role="group" aria-label={`Students by state on ${topic.name}`}>
      {order.map((s) => {
        const people = topic.students?.[s] ?? [];
        return (
          <section key={s} className="hub-states-col" data-state={s} aria-labelledby={`hub-st-${topic.id}-${s}`}>
            <h3 id={`hub-st-${topic.id}-${s}`} className="hub-states-col-h">
              <StateMark state={s} />
              <span>{states?.[s] ?? s}</span>
              <b className="mono">{people.length}</b>
            </h3>
            {people.length ? (
              <ol className="hub-states-list">
                {people.map((p) => (
                  <li key={p.rosterId}>
                    <span className="mono hub-states-roll">{p.rollNo}</span>
                    <Link to={`/hubs/c/${classId}/s/${p.rosterId}`} className="hub-states-name">{p.name || p.rollNo}</Link>
                    <span className="hub-states-n">
                      N {p.answers}
                      {showProvisional(p) && <span className="hub-st-prov">provisional</span>}
                    </span>
                  </li>
                ))}
              </ol>
            ) : <p className="hub-states-none">Nobody</p>}
          </section>
        );
      })}
    </div>
  );
}

/** The pure view: the topics to choose from, then the chosen topic's board. */
export function ClassStatesView({ data, initialTopic = null }) {
  const topics = data.topics ?? [];
  const states = data.states ?? {};
  const notes = data.notes ?? {};
  const classId = data.class?.id;
  const [at, setAt] = useState(() => Math.max(0, topics.findIndex((t) => t.id === initialTopic)));
  const topic = topics[at];

  if (!topics.length) {
    return (
      <div className="card">
        <Empty icon="material" title="No topics on this class yet">
          Place a chapter on the class (Structure) and its topics show here, with the students in each state.
        </Empty>
      </div>
    );
  }

  return (
    <div className="hub-states">
      {notes.order && <p className="hub-prog-order">{notes.order}</p>}
      <div className="hub-states-grid">
        <nav className="card hub-states-topics" aria-label="Topics">
          <label className="hub-states-pick">
            <span className="label">Topic</span>
            <select className="select" value={at} onChange={(e) => setAt(Number(e.target.value))}>
              {topics.map((t, i) => <option key={t.id} value={i}>{t.name}</option>)}
            </select>
          </label>
          <ul className="hub-states-tlist">
            {topics.map((t, i) => (
              <li key={t.id}>
                <button type="button" aria-current={i === at ? 'true' : undefined} onClick={() => setAt(i)}>
                  <RichText as="b" html={t.nameHtml} text={t.name} />
                  <RichText as="small" html={t.chapter?.titleHtml} text={t.chapter?.title} />
                  <CountsBar counts={t.counts} states={states} />
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <section className="card hub-states-main" aria-labelledby="hub-states-h">
          <div className="card-head">
            <div className="sec">
              <h2 id="hub-states-h"><RichText as="span" html={topic.nameHtml} text={topic.name} /></h2>
              <p>
                {topic.unit?.name && <><RichText as="span" html={topic.unit.nameHtml} text={topic.unit.name} />{' · '}</>}
                <RichText as="span" html={topic.chapter?.titleHtml} text={topic.chapter?.title} />
                {` · ${plural(topic.practiceQuestions ?? 0, 'practice question')}`}
                {` · ${topic.openErrors ? `${topic.openErrors} open ${topic.openErrors === 1 ? 'error' : 'errors'} in the class` : 'no open errors'}`}
              </p>
            </div>
          </div>
          <Board topic={topic} states={states} classId={classId} />
        </section>
      </div>

      {(data.noAccount ?? []).length > 0 && (
        <section className="card" aria-labelledby="hub-states-none-h">
          <div className="card-head"><div className="sec"><h2 id="hub-states-none-h">Not in the hub yet</h2><p>On the roster, with no single student account for the roll number. Roll order.</p></div></div>
          <ul className="hub-states-noacc">
            {data.noAccount.map((s) => (
              <li key={s.rosterId}>
                <span className="mono hub-states-roll">{s.rollNo}</span>
                <b>{s.name || s.rollNo}</b>
                <span>{s.note}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="hub-prog-foot">
        {notes.basis && <p>{notes.basis}</p>}
        {notes.students && <p>{notes.students}</p>}
      </div>
    </div>
  );
}

export default function ClassStates({ classId }) {
  const load = useLoad(() => staffHub.classStates(classId), [classId]);
  if (load.state === 'loading') return <ProgressSkeleton />;
  if (load.state === 'failed') return <Trouble error={load.error} onRetry={load.retry} elsewhere={STUDENT_SIDE} />;
  return <ClassStatesView data={load.data} />;
}
