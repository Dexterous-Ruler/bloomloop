/**
 * A class's practice in the hub at a glance (GET /api/hub/classes/:id/progress),
 * the "progress" tab inside the class frame: students in roll order down the
 * side, the class's topics in its own order across the top, and in each cell
 * the student's state on that topic, N (the answers it rests on) and their open
 * errors. A roster row no account carries shows the server's note instead.
 *
 * Roll order always. No sorting, no ranking, no average beside a name. The
 * HOD reads the same page; there is nothing on it to change.
 */

import { Link } from 'react-router-dom';

import '../styles/hub-progress.css';
import { Empty, Icon } from '../ui/index.jsx';
import { staffHub } from '../hub/hubApi.js';
import RichText from '../hub/RichText.jsx';
import { Trouble, plural, useLoad } from '../hub/TestParts.jsx';

/** The server's own order, for when a reply leaves `states` out. */
export const STATE_ORDER = ['not-started', 'not-sure', 'in-progress', 'mastered', 'needs-review'];
const STUDENT_SIDE = { to: '/hub', label: 'Go to your hub' };

/** A state as a mark that is not colour alone (its shape differs), always beside its word. */
export function StateMark({ state }) {
  return <span className="hub-st-mark" data-state={state} aria-hidden="true" />;
}

/** The state in words, with its mark. `label` is the server's word for it. */
export function StateTag({ state, label, provisional = false }) {
  return (
    <span className="hub-st-tag" data-state={state}>
      <StateMark state={state} />
      <span>{label}</span>
      {provisional && <span className="hub-st-prov" title="Provisional: too few answers to be sure">provisional</span>}
    </span>
  );
}

/** The marks and their words, once, above a table that uses them. */
export function StateKey({ states }) {
  const order = Object.keys(states ?? {}).length ? Object.keys(states) : STATE_ORDER;
  return (
    <ul className="hub-st-key" aria-label="What each mark means">
      {order.map((s) => <li key={s}><StateMark state={s} />{states?.[s] ?? s}</li>)}
    </ul>
  );
}

/** "3 mastered, 1 in progress", for a screen reader beside a topic's bar. */
const countsWords = (counts, states) => Object.entries(counts ?? {})
  .filter(([, n]) => n > 0).map(([s, n]) => `${n} ${String(states?.[s] ?? s).toLowerCase()}`).join(', ') || 'no students yet';

/** A topic's students by state, as one thin bar of counts (with its words for a screen reader). */
export function CountsBar({ counts, states }) {
  const order = Object.keys(states ?? {}).length ? Object.keys(states) : STATE_ORDER;
  const total = order.reduce((n, s) => n + (counts?.[s] ?? 0), 0);
  return (
    <span className="hub-st-bar" role="img" aria-label={countsWords(counts, states)}>
      {total > 0 && order.map((s) => (counts?.[s] ? <i key={s} data-state={s} style={{ flexGrow: counts[s] }} /> : null))}
    </span>
  );
}

const studentHref = (classId, rosterId) => `/hubs/c/${classId}/s/${rosterId}`;

/** Topics next to each other in one chapter, as one header over them. */
function chapterRuns(topics) {
  const runs = [];
  for (const t of topics) {
    const last = runs[runs.length - 1];
    if (last && last.chapter?.id === t.chapter?.id) last.span += 1;
    else runs.push({ key: `${t.chapter?.id}-${t.id}`, chapter: t.chapter, unit: t.unit, span: 1 });
  }
  return runs;
}

/** N, and "provisional" only once there is something to be provisional about. */
export const showProvisional = (cell) => Boolean(cell?.provisional && cell.answers > 0);

/** The matrix, as a pure view of the server's reply. */
export function ClassProgressView({ data }) {
  const classId = data.class?.id;
  const topics = data.topics ?? [];
  const students = data.students ?? [];
  const states = data.states ?? {};
  const notes = data.notes ?? {};

  if (!topics.length) {
    return (
      <div className="card">
        <Empty icon="material" title="No topics on this class yet">
          Place a chapter on the class (Structure) and its topics show here, with each student's state on them.
        </Empty>
      </div>
    );
  }

  return (
    <div className="hub-prog">
      <div className="hub-prog-notes">
        {notes.order && <p className="hub-prog-order"><Icon name="list" size={14} />{notes.order}</p>}
        <StateKey states={states} />
      </div>

      {students.length ? (
        <section className="card hub-prog-card" aria-label="Students by topic, in roll order">
          <div className="hub-prog-frame" tabIndex={0} role="region" aria-label="The class by topic. Scrolls sideways when wide.">
            <table className="hub-prog-table">
              <caption className="sr-only">Each student's state on each topic, with N, the answers it rests on, and open errors. Roll order.</caption>
              <thead>
                <tr className="hub-prog-groups">
                  <td className="hub-prog-who" />
                  {chapterRuns(topics).map((g) => (
                    <th key={g.key} scope="colgroup" colSpan={g.span} className="hub-prog-group">
                      <RichText as="span" className="hub-prog-group-c" html={g.chapter?.titleHtml} text={g.chapter?.title} />
                      {g.unit && <RichText as="span" className="hub-prog-group-u" html={g.unit.nameHtml} text={g.unit.name} />}
                    </th>
                  ))}
                </tr>
                <tr className="hub-prog-head">
                  <th scope="col" className="hub-prog-who">Student <span>roll order</span></th>
                  {topics.map((t) => (
                    <th key={t.id} scope="col" className="hub-prog-topic">
                      <RichText as="span" className="hub-prog-topic-n" html={t.nameHtml} text={t.name} />
                      <CountsBar counts={t.counts} states={states} />
                      <span className="hub-prog-topic-m">
                        {plural(t.practiceQuestions ?? 0, 'question')}{t.openErrors ? ` · ${t.openErrors} open` : ''}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {students.map((s) => (
                  <tr key={s.rosterId} data-none={s.accountId ? undefined : 'true'}>
                    <th scope="row" className="hub-prog-who">
                      <span className="mono">{s.rollNo}</span>
                      {s.accountId
                        ? <Link to={studentHref(classId, s.rosterId)}>{s.name || s.rollNo}</Link>
                        : <span>{s.name || s.rollNo}</span>}
                    </th>
                    {s.accountId
                      ? topics.map((t) => {
                        const c = s.topics?.[t.id];
                        if (!c) return <td key={t.id} className="hub-prog-cell" />;
                        return (
                          <td key={t.id} className="hub-prog-cell" data-state={c.state}>
                            <StateTag state={c.state} label={c.label} />
                            <span className="hub-prog-n">
                              <span title="Answers this state rests on">N {c.answers}</span>
                              {showProvisional(c) && <span className="hub-st-prov">provisional</span>}
                              {c.openErrors > 0 && <span className="hub-prog-err">{c.openErrors} open</span>}
                            </span>
                          </td>
                        );
                      })
                      : <td colSpan={topics.length} className="hub-prog-note">{s.note}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <div className="card">
          <Empty icon="users" title="No students on the roster">{notes.students}</Empty>
        </div>
      )}

      <div className="hub-prog-foot">
        {notes.basis && <p>{notes.basis}</p>}
        {notes.students && students.length > 0 && <p>{notes.students}</p>}
      </div>
    </div>
  );
}

export function ProgressSkeleton() {
  return (
    <div className="hub-prog" role="status" aria-busy="true" aria-label="Loading">
      <div className="skel" style={{ height: 18, width: '40%' }} />
      <div className="card card-pad stack stack-3">
        {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="skel" style={{ height: 38 }} />)}
      </div>
    </div>
  );
}

export default function ClassProgress({ classId }) {
  const load = useLoad(() => staffHub.classProgress(classId), [classId]);
  if (load.state === 'loading') return <ProgressSkeleton />;
  if (load.state === 'failed') return <Trouble error={load.error} onRetry={load.retry} elsewhere={STUDENT_SIDE} />;
  return <ClassProgressView data={load.data} />;
}
