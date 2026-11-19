/**
 * /hub/goals - a student's goals: an exam date and the topics it covers.
 *
 * Only the student sees them (the server's `note` says so at the top, and
 * staff never read a goal). Each goal shows the server's sentence, its topics
 * counted by state, where to start (`focus`) and every topic with its state
 * and the N behind it. Add, edit and remove through hub.addGoal / editGoal /
 * removeGoal; the topics to choose from are the student's own, from the
 * home's map (hub.home()), read when the form first opens. At most `max` (10)
 * goals, 60 topics each, a title of up to 80 characters, an exam date of
 * today or later: the server decides, and its sentence is shown as given.
 *
 * Goals fetches. GoalsView draws, and is what the dev gallery renders.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { useEnter } from '../lib/motion.js';
import { Button, Dialog, Empty, Field, Icon, Note, Panel, Section } from '../ui/index.jsx';
import { toast } from '../ui/toast.jsx';
import {
  DATE, StateBar, StateMark, TopicRow, Trouble, calendarDay, daysLeftText, goalTitle, topicPath,
} from './Home.jsx';
import HubPage from './HubPage.jsx';
import { hub } from './hubApi.js';
import RichText from './RichText.jsx';

const MAX_TITLE = 80;
const MAX_TOPICS = 60;
const NOTE = 'Only you see your goals.';

const LONG_DATE = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function Title({ g }) {
  const fallback = goalTitle(g);
  return fallback ?? <RichText as="span" html={g.titleHtml} text={g.title} />;
}
const plainTitle = (g) => g.title || goalTitle(g);

function Focus({ g }) {
  if (g.past || !(g.focus ?? []).length) return null;
  return (
    <div className="hub-home-focus">
      <span>Start with</span>
      <ul aria-label="Start with">
        {g.focus.map((f) => (
          <li key={f.id}>
            <Link to={topicPath(f.id)}>
              <StateMark state={f.state} size={12} />
              <RichText as="span" html={f.nameHtml} text={f.name} />
              <span className="sr-only">, {f.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------- the brief */

function TopicList({ g }) {
  const live = (g.topics ?? []).filter((t) => !t.unavailable);
  const gone = (g.topics ?? []).filter((t) => t.unavailable);
  return (
    <ul className="hub-goals-topic-list">
      {live.map((t) => <TopicRow key={t.id} t={t} />)}
      {gone.map((t) => (
        <li key={t.id} className="hub-goals-gone"><Icon name="info" size={14} /><span>{t.sentence}</span></li>
      ))}
    </ul>
  );
}

/**
 * The one dark panel: the next exam, how its topics stand and where to
 * start, with its own Edit and Remove; under it, every topic it covers.
 */
function Next({ g, onEdit, onRemove }) {
  const d = calendarDay(g.examDate);
  const live = (g.topics ?? []).filter((t) => !t.unavailable).length;
  const name = plainTitle(g);
  return (
    <>
      <Panel className="hub-goals-brief" aria-labelledby="hub-goals-next">
        <div className="hub-goals-brief-main">
          <div className="hub-goals-brief-top">
            <span className="tag-mint">Next exam</span>
            <span className="hub-goals-brief-acts">
              <Button size="sm" icon="edit" onClick={() => onEdit(g)} aria-label={`Edit ${name}`}>Edit</Button>
              <Button size="sm" icon="trash" onClick={() => onRemove(g)} aria-label={`Remove ${name}`}>Remove</Button>
            </span>
          </div>
          <h2 className="hub-goals-brief-title" id="hub-goals-next"><Title g={g} /></h2>
          <span className="hub-goals-brief-when">
            <Icon name="calendar" size={15} />
            {d ? <time dateTime={g.examDate}>{LONG_DATE.format(d)}</time> : g.examDate}
            <span>· {daysLeftText(g)}</span>
          </span>
          {g.sentence && <p className="hub-goals-brief-said">{g.sentence}</p>}
          <Focus g={g} />
        </div>
        <div className="hub-goals-brief-side">
          <p className="hub-goals-days">
            <b>{g.counts?.mastered ?? 0}</b>
            <span>of {live} topic{live === 1 ? '' : 's'} mastered</span>
          </p>
          <StateBar counts={g.counts} label="Topics in this goal" />
        </div>
      </Panel>
      {(g.topics ?? []).length > 0 && (
        <section className="card card-pad hub-goals-next-topics" aria-labelledby="hub-goals-next-topics">
          <Section
            title={<span id="hub-goals-next-topics">The topics it covers</span>}
            sub="Each with its state, the answers it rests on and when its review comes."
          />
          <TopicList g={g} />
        </section>
      )}
    </>
  );
}

/* ------------------------------------------------------------- one goal */

function GoalCard({ g, onEdit, onRemove }) {
  const d = calendarDay(g.examDate);
  const live = (g.topics ?? []).filter((t) => !t.unavailable);
  const name = plainTitle(g);
  return (
    <article className="card hub-goals-item" data-past={g.past ? 'true' : undefined} aria-labelledby={`hub-goal-${g.id}`}>
      <header className="hub-goals-item-head">
        <div className="hub-goals-item-title">
          <h3 id={`hub-goal-${g.id}`}><Title g={g} /></h3>
          <span className="hub-home-goal-date">
            <Icon name="calendar" size={14} />
            {d ? <time dateTime={g.examDate}>{DATE.format(d)}</time> : g.examDate}
            <span>· {daysLeftText(g)}</span>
          </span>
        </div>
        <div className="hub-goals-item-acts">
          <Button size="sm" variant="ghost" icon="edit" onClick={() => onEdit(g)} aria-label={`Edit ${name}`}>Edit</Button>
          <Button size="sm" variant="ghost" icon="trash" className="btn-danger" onClick={() => onRemove(g)} aria-label={`Remove ${name}`}>Remove</Button>
        </div>
      </header>
      <StateBar counts={g.counts} label="Topics in this goal" />
      {g.sentence && <p className="hub-goals-item-said">{g.sentence}</p>}
      <Focus g={g} />
      {(g.topics ?? []).length > 0 && (
        <details className="hub-goals-topics">
          <summary><Icon name="chevronRight" size={14} />Every topic in this goal ({live.length})</summary>
          <TopicList g={g} />
        </details>
      )}
    </article>
  );
}

/* --------------------------------------------------------------- the form */

/** The student's own topics from the home's map: class -> chapter -> topics, each topic once. */
function topicTree(home) {
  const seen = new Set();
  return (home?.classes ?? []).map((entry) => {
    const chapters = [
      ...(entry.units ?? []).flatMap((u) => u.chapters ?? []),
      ...(entry.otherChapters?.chapters ?? []),
    ].map((c) => ({
      ...c,
      topics: (c.topics ?? []).filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true))),
    })).filter((c) => c.topics.length);
    return { klass: entry.class ?? {}, chapters };
  }).filter((k) => k.chapters.length);
}

function GoalForm({ goal, picker, onLoadPicker, onSubmit, onClose }) {
  const today = todayIso();
  const [title, setTitle] = useState(goal?.title ?? '');
  const [examDate, setExamDate] = useState(goal?.examDate ?? '');
  const [chosen, setChosen] = useState(() => new Set((goal?.topics ?? []).filter((t) => !t.unavailable).map((t) => t.id)));
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const gone = (goal?.topics ?? []).filter((t) => t.unavailable).length;

  useEffect(() => { if (!picker.data && !picker.loading && !picker.error) onLoadPicker(); }, [picker, onLoadPicker]);

  const tree = useMemo(() => topicTree(picker.data), [picker.data]);
  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => tree.map((k) => ({
    ...k,
    chapters: k.chapters.map((c) => ({ ...c, topics: c.topics.filter((t) => !needle || String(t.name).toLowerCase().includes(needle)) }))
      .filter((c) => c.topics.length),
  })).filter((k) => k.chapters.length), [tree, needle]);

  const full = chosen.size >= MAX_TOPICS;
  const toggle = (id) => setChosen((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else if (next.size < MAX_TOPICS) next.add(id);
    return next;
  });
  const toggleAll = (topics, on) => setChosen((prev) => {
    const next = new Set(prev);
    for (const t of topics) {
      if (!on) next.delete(t.id);
      else if (next.size < MAX_TOPICS) next.add(t.id);
    }
    return next;
  });

  const ready = examDate && chosen.size > 0 && chosen.size <= MAX_TOPICS;
  const submit = async (e) => {
    e?.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setErr('');
    try {
      await onSubmit({ title: title.replace(/\s+/g, ' ').trim(), examDate, topicIds: [...chosen] });
      onClose(true);
    } catch (ex) {
      setErr(ex?.message || 'The server did not answer.');
      setBusy(false);
    }
  };

  let pick;
  if (picker.loading || (!picker.data && !picker.error)) {
    pick = <div className="stack stack-2" aria-busy="true">{[0, 1, 2, 3].map((i) => <div key={i} className="skel" style={{ height: 22 }} />)}</div>;
  } else if (picker.error) {
    pick = (
      <Note tone="bad" role="alert">
        {picker.error} <button type="button" className="hub-goals-pick-all" onClick={onLoadPicker}>Try again</button>
      </Note>
    );
  } else if (!tree.length) {
    pick = <p className="hub-goals-pick-none">{picker.data?.empty || 'Your classes have no topics on the hub yet, so there is nothing to choose from.'}</p>;
  } else if (!shown.length) {
    pick = <p className="hub-goals-pick-none">No topic has “{q.trim()}” in its name.</p>;
  } else {
    pick = shown.map((k) => (
      <div key={k.klass.id}>
        {tree.length > 1 && <p className="hub-goals-pick-class">{k.klass.courseName}{k.klass.section ? ` · ${k.klass.section}` : ''}</p>}
        {k.chapters.map((c) => {
          const allOn = c.topics.every((t) => chosen.has(t.id));
          return (
            <div key={c.id} className="hub-goals-pick-chapter" role="group" aria-labelledby={`hub-goal-ch-${c.id}`}>
              <div className="hub-goals-pick-ch">
                <h4 id={`hub-goal-ch-${c.id}`}><RichText as="span" html={c.titleHtml} text={c.title} /></h4>
                <button type="button" className="hub-goals-pick-all" onClick={() => toggleAll(c.topics, !allOn)} disabled={!allOn && full}>
                  {allOn ? 'Clear' : 'Choose all'}<span className="sr-only"> in {c.title}</span>
                </button>
              </div>
              <div className="hub-goals-pick-list">
                {c.topics.map((t) => (
                  <label key={t.id} className="check">
                    <input
                      type="checkbox"
                      checked={chosen.has(t.id)}
                      disabled={!chosen.has(t.id) && full}
                      onChange={() => toggle(t.id)}
                      aria-label={`${t.name}${t.state?.label ? `, ${t.state.label}` : ''}`}
                    />
                    <span>
                      <RichText as="span" html={t.nameHtml} text={t.name} />
                      {t.state?.label && <small><StateMark state={t.state.state} size={11} />{t.state.label}</small>}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    ));
  }

  return (
    <Dialog
      open
      wide
      locked={busy}
      onOpenChange={(v) => { if (!v) onClose(false); }}
      title={goal ? 'Change this goal' : 'A new goal'}
      description="An exam date and the topics it covers. Only you see your goals."
      footer={(
        <>
          <Button onClick={() => onClose(false)} disabled={busy}>Cancel</Button>
          <Button variant="primary" busy={busy} disabled={!ready} onClick={submit}>{goal ? 'Save changes' : 'Add goal'}</Button>
        </>
      )}
    >
      <form className="hub-goals-form" onSubmit={submit} noValidate>
        <div className="hub-goals-form-two">
          <Field label="Title" optional htmlFor="hub-goal-title" hint="Such as “Mid-semester test”. Without one, the goal is named by its date.">
            <input
              id="hub-goal-title"
              className="input"
              value={title}
              maxLength={MAX_TITLE}
              onChange={(e) => setTitle(e.target.value)}
              autoComplete="off"
            />
            <span className="hub-goals-count" aria-hidden="true">{title.length}/{MAX_TITLE}</span>
          </Field>
          <Field label="Exam date" htmlFor="hub-goal-date">
            <input
              id="hub-goal-date"
              className="input"
              type="date"
              value={examDate}
              min={goal && examDate === goal.examDate ? undefined : today}
              onChange={(e) => setExamDate(e.target.value)}
              required
            />
          </Field>
        </div>

        <div className="hub-goals-pick">
          <div className="hub-goals-pick-head">
            <span className="label" id="hub-goal-topics">Topics it covers</span>
            <input
              className="input input-sm"
              type="search"
              placeholder="Find a topic"
              aria-label="Find a topic"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="hub-goals-pick-box" role="group" aria-labelledby="hub-goal-topics">{pick}</div>
          <p className="hint" aria-live="polite">
            {chosen.size} chosen{full ? `: the most one goal can cover is ${MAX_TOPICS}.` : `, at most ${MAX_TOPICS}.`}
            {gone > 0 && ` ${gone === 1 ? 'One topic of this goal is' : `${gone} topics of this goal are`} no longer on your classes, so saving leaves ${gone === 1 ? 'it' : 'them'} out.`}
          </p>
        </div>

        {err && <Note tone="bad" role="alert">{err}</Note>}
      </form>
    </Dialog>
  );
}

function RemoveGoal({ goal, onRemove, onClose }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async () => {
    setBusy(true);
    setErr('');
    try {
      const res = await onRemove(goal);
      toast(res?.message || 'The goal was removed.');
      onClose();
    } catch (ex) {
      setErr(ex?.message || 'The server did not answer.');
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      locked={busy}
      onOpenChange={(v) => { if (!v) onClose(); }}
      title="Remove this goal?"
      description={`“${plainTitle(goal)}” goes from your goals. Your practice and progress stay as they are.`}
      footer={(
        <>
          <Button onClick={onClose} disabled={busy}>Keep it</Button>
          <Button variant="primary" className="btn-danger" busy={busy} onClick={go}>Remove goal</Button>
        </>
      )}
    >
      {err ? <Note tone="bad" role="alert">{err}</Note> : null}
    </Dialog>
  );
}

/* --------------------------------------------------------------- the view */

function Waiting() {
  return (
    <>
      <div className="hub-home-skel-panel">
        <div className="stack stack-3">
          <div className="skel" style={{ height: 20, width: 110 }} />
          <div className="skel" style={{ height: 30, width: '60%' }} />
          <div className="skel" style={{ height: 14, width: '40%' }} />
          <div className="skel" style={{ height: 40 }} />
        </div>
        <div className="stack stack-3">
          <div className="skel" style={{ height: 34, width: 120 }} />
          <div className="skel" style={{ height: 8 }} />
          <div className="skel" style={{ height: 60 }} />
        </div>
      </div>
      {[0, 1].map((i) => (
        <div key={i} className="card hub-goals-item stack stack-3">
          <div className="skel" style={{ height: 18, width: 200 }} />
          <div className="skel" style={{ height: 8 }} />
          <div className="skel" style={{ height: 14, width: '70%' }} />
        </div>
      ))}
    </>
  );
}

/**
 * @param data        the hub.goals() reply, or null before the first one
 * @param loading     a read is in flight
 * @param error       the last read's refusal ({ message, status }) or ''
 * @param onRetry     read again
 * @param picker      { data: hub.home() reply | null, loading, error } for the topic picker
 * @param onLoadPicker read the student's topics for the form
 * @param onSave      (goal | null, { title, examDate, topicIds }) => Promise
 * @param onRemove    (goal) => Promise<{ removed, message }>
 * @param open        'new' to start with the form open (the gallery)
 */
export function GoalsView({
  data, loading = false, error = '', onRetry, picker = { data: null, loading: false, error: '' }, onLoadPicker, onSave, onRemove, open = null,
}) {
  const box = useRef(null);
  const status = data ? 'ready' : error && !loading ? 'error' : 'loading';
  useEnter(box, status);
  const [editing, setEditing] = useState(open);
  const [removing, setRemoving] = useState(null);

  const goals = data?.goals ?? [];
  const max = data?.max ?? 10;
  const atMax = goals.length >= max;
  const next = goals.find((g) => !g.past);
  const later = goals.filter((g) => !g.past && g !== next);
  const past = goals.filter((g) => g.past);
  const said = typeof error === 'object' ? error?.message : error;

  const add = status === 'ready' && (
    <Button variant="primary" icon="plus" onClick={() => setEditing('new')} disabled={atMax}>New goal</Button>
  );

  let body;
  if (status === 'loading') body = <Waiting />;
  else if (status === 'error') body = <Trouble error={error} what="Your goals" onRetry={onRetry} busy={loading} />;
  else {
    body = (
      <>
        {said && <Note tone="bad" role="alert">That read did not come back ({said}). This is what the server last said.</Note>}
        {next && <Next g={next} onEdit={setEditing} onRemove={setRemoving} />}
        {goals.length ? (
          <>
            {later.length > 0 && (
              <section className="hub-goals-list" aria-labelledby="hub-goals-later">
                <Section title={<span id="hub-goals-later">Later goals</span>} sub="Soonest first." />
                {later.map((g) => <GoalCard key={g.id} g={g} onEdit={setEditing} onRemove={setRemoving} />)}
              </section>
            )}
            {past.length > 0 && (
              <section className="hub-goals-list" aria-labelledby="hub-goals-past">
                <Section title={<span id="hub-goals-past">Past goals</span>} sub="Their date has passed. Each stays until you remove it." />
                {past.map((g) => <GoalCard key={g.id} g={g} onEdit={setEditing} onRemove={setRemoving} />)}
              </section>
            )}
            <p className="hub-goals-foot">
              <span>{goals.length} of {max} goals</span>
              {atMax && <span>You can keep at most {max} goals. Remove one you no longer need to add another.</span>}
            </p>
          </>
        ) : (
          <section className="card">
            <Empty
              icon="target"
              title="No goals yet"
              action={<Button variant="primary" icon="plus" onClick={() => setEditing('new')}>Set a goal</Button>}
            >
              A goal is an exam date and the topics it covers. Once one is set, you see how those topics stand, and
              where to start, as the date comes closer.
            </Empty>
          </section>
        )}
      </>
    );
  }

  const close = useCallback((saved) => {
    if (saved) toast(editing === 'new' ? 'Goal added.' : 'Goal saved.');
    setEditing(null);
  }, [editing]);

  return (
    <HubPage title="Your goals" sub={data?.note || NOTE} actions={add}>
      <div className="hub-goals" ref={box} aria-busy={status === 'loading' ? 'true' : undefined}>{body}</div>
      {editing && (
        <GoalForm
          goal={editing === 'new' ? null : editing}
          picker={picker}
          onLoadPicker={onLoadPicker ?? (() => {})}
          onSubmit={(b) => onSave(editing === 'new' ? null : editing, b)}
          onClose={close}
        />
      )}
      {removing && <RemoveGoal goal={removing} onRemove={onRemove} onClose={() => setRemoving(null)} />}
    </HubPage>
  );
}

/* ----------------------------------------------------------- the container */

export default function Goals() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const [picker, setPicker] = useState({ data: null, loading: false, error: '' });

  useEffect(() => {
    let alive = true;
    setLoading(true);
    hub.goals().then(
      (res) => { if (!alive) return; setData(res); setError(''); setLoading(false); },
      (err) => { if (!alive) return; setError({ message: err?.message || 'The server did not answer.', status: err?.status }); setLoading(false); },
    );
    return () => { alive = false; };
  }, [nonce]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);

  const loadPicker = useCallback(() => {
    setPicker((p) => ({ ...p, loading: true, error: '' }));
    hub.home().then(
      (res) => setPicker({ data: res, loading: false, error: '' }),
      (err) => setPicker({ data: null, loading: false, error: err?.message || 'The server did not answer.' }),
    );
  }, []);

  const save = useCallback(async (goal, body) => {
    const res = goal ? await hub.editGoal(goal.id, body) : await hub.addGoal(body);
    retry();
    return res;
  }, [retry]);

  const remove = useCallback(async (goal) => {
    const res = await hub.removeGoal(goal.id);
    retry();
    return res;
  }, [retry]);

  return (
    <GoalsView
      data={data}
      loading={loading}
      error={error}
      onRetry={retry}
      picker={picker}
      onLoadPicker={loadPicker}
      onSave={save}
      onRemove={remove}
    />
  );
}
