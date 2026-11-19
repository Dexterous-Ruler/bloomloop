/**
 * Step two: the questions.
 *
 * Four states of one screen. With no bank yet it is the planner. While a run
 * is in the air it is six tubes filling. Once written, the questions are
 * drafts: nothing generated reaches a room until a teacher approves it, so the
 * screen opens on the drafts, each with the slides it came from and any rule
 * check it failed. Approved questions are the bank, curated as before: filter
 * by level or topic, read the answer key, tick several and act on them, open
 * one in the editor beside the list.
 */

import { useEffect, useState } from 'react';

import Tubes from '../fx/Tubes.jsx';
import { api } from '../lib/api.js';
import { LABEL, LEVELS } from '../lib/bloom.js';
import { KIND_LABEL } from '../lib/kinds.js';
import { Button, Chip, Dialog, Empty, Icon, Level, Menu, Note, Num, Panel, Section, Segmented, Tip } from '../ui/index.jsx';
import { LevelSpread } from '../ui/viz.jsx';
import AnswerKey from './AnswerKey.jsx';
import Editor from './Editor.jsx';
import { ItemDetail, ItemFigures, StatsView, useBankStats } from './ItemStats.jsx';
import Planner, { mmss, startTotal } from './Planner.jsx';

// Everything a teacher might search a question by, including its answer key.
const haystack = (q) => [
  q.text, q.topic,
  ...(q.options ?? []),
  ...(q.pairs ?? []).flatMap((p) => [p?.left, p?.right]),
  ...(q.buckets ?? []).flatMap((b) => [b?.name, ...(b?.items ?? [])]),
  ...(q.sequence ?? []), q.criterion,
  ...(q.accept ?? []),
  ...(q.blanks ?? []).flatMap((b) => [...(b?.accept ?? []), ...(b?.options ?? [])]),
  ...(q.tokens ?? []), ...(q.columns ?? []),
  ...(q.rows ?? []).flatMap((r) => (typeof r === 'string' ? [r] : [r?.header, r?.label])),
  q.unit,
  ...(q.rubric ?? []),
].filter(Boolean).join(' ').toLowerCase();

const many = (n, word = 'question') => `${n} ${word}${n === 1 ? '' : 's'}`;
const andList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** The rule checks a question failed. Advice only: none of them blocks approval. */
export const failedChecks = (q) => (Array.isArray(q?.checks) ? q.checks.filter((c) => c && c.ok === false) : []);

/**
 * Where a question came from, said honestly. `model` is what tells: a
 * professor's own question is stored with source 'fallback' too, so the
 * source field alone would call it a template.
 */
export function sourceLabel(q) {
  if (q?.model === 'offline-template') return 'Offline template';
  if (q?.model) return 'AI written';
  return null;
}

/** "Slides 3, 4" for a question read from a deck, or null. */
export function slidesLabel(q) {
  const slides = q?.sourceRef?.kind === 'slides' && Array.isArray(q.sourceRef.slides) ? q.sourceRef.slides : [];
  if (slides.length === 0) return null;
  return `${slides.length === 1 ? 'Slide' : 'Slides'} ${slides.join(', ')}`;
}

// A rejected draft: discarded, written by a model, never approved. Restoring
// it is an approval, so it is offered as one.
const isRejectedDraft = (q) => q.status === 'discarded' && Boolean(q.model) && !q.approvedAt;

const VIEW_WORD = { drafts: 'drafts', bank: 'approved', aside: 'set aside' };

export default function Bank({ content, selected, bank, onBank, onPhase, focus, onFocused, onBack, onNext }) {
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [runId, setRunId] = useState('');
  const [progress, setProgress] = useState(null);
  const [tookSecs, setTookSecs] = useState(null);
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState([]);
  // What just happened, said once above the list: a run, an approval, a new draft.
  const [said, setSaid] = useState(null);
  // A replacing run the server refused because a room on the chapter is running.
  const [blocked, setBlocked] = useState(null);
  const [view, setView] = useState(() => {
    if (focus === 'drafts') return 'drafts';
    if (String(focus ?? '').startsWith('edit:')) return 'bank';
    return (bank?.questions ?? []).some((q) => q.status === 'draft') ? 'drafts' : 'bank';
  });
  const [filter, setFilter] = useState('all');
  const [topicFilter, setTopicFilter] = useState('');
  const [query, setQuery] = useState('');
  const [working, setWorking] = useState('');
  const [planning, setPlanning] = useState(false);
  const [plan, setPlan] = useState(null);
  // '' closed, 'new' writing one from scratch, or the id being edited. The
  // live class can ask for one straight from a "check the key" flag.
  const [editing, setEditing] = useState(() => (String(focus ?? '').startsWith('edit:') ? focus.slice(5) : ''));
  // How each question did, across every room run on this chapter.
  const [statsVersion, setStatsVersion] = useState(0);
  const stats = useBankStats(content?.contentId ?? null, statsVersion);
  const [picked, setPicked] = useState(() => new Set());
  const [opened, setOpened] = useState(() => new Set());
  const [showKeys, setShowKeys] = useState(false);
  const [bulk, setBulk] = useState(null);
  const [retagTo, setRetagTo] = useState('');
  const [askAll, setAskAll] = useState(false);
  const [askRewrite, setAskRewrite] = useState(null);
  // A run the server held back for being large, waiting on a yes.
  const [held, setHeld] = useState(null);
  const [draft, setDraft] = useState(() => ({
    total: startTotal(selected.length),
    preset: 'balanced',
    mix: null,
    kinds: {},
    mode: 'replace',
  }));

  useEffect(() => { if (focus) onFocused?.(); }, [focus, onFocused]);

  useEffect(() => {
    if (!busy) return undefined;
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 250);
    return () => clearInterval(t);
  }, [busy]);

  // Real counts, polled from the run while it is open.
  useEffect(() => {
    if (!busy || !runId) return undefined;
    let alive = true;
    const tick = () => api.generateRun(runId).then((res) => { if (alive && res?.run) setProgress(res.run); }, () => {});
    tick();
    const t = setInterval(tick, 900);
    return () => { alive = false; clearInterval(t); };
  }, [busy, runId]);

  const questions = bank?.questions ?? [];
  const approved = questions.filter((q) => q.status === 'active');
  const drafts = questions.filter((q) => q.status === 'draft');
  const aside = questions.filter((q) => q.status === 'discarded');
  const flaggedDrafts = drafts.filter((q) => failedChecks(q).length > 0);

  // Tell the console which state this step is in, so its head can say so.
  const phase = busy ? 'writing'
    : approved.length + drafts.length === 0 ? 'first'
      : planning ? 'again'
        : drafts.length > 0 ? 'review' : 'curating';
  useEffect(() => { onPhase?.(phase); }, [phase, onPhase]);

  // A view that empties (the last draft approved) moves on rather than
  // leaving an empty list behind.
  const viewEmpty = (view === 'drafts' && drafts.length === 0) || (view === 'aside' && aside.length === 0);
  useEffect(() => {
    if (viewEmpty && questions.length > 0) { setView('bank'); setPicked(new Set()); }
  }, [viewEmpty, questions.length]);

  if (!content) {
    return (
      <div className="card">
        <Empty icon="material" title="No chapter is open" action={<Button variant="primary" onClick={onBack}>Go to Material</Button>}>
          Questions are written from a chapter, so there is nothing to write from until one is open.
        </Empty>
      </div>
    );
  }

  // Nothing ticked is not an error: the server treats the chapter title as one
  // topic, so do the same here and the preview cannot promise a different bank.
  const topics = selected.length > 0 ? selected : [content.title];

  async function refresh() { onBank(await api.getBank(content.contentId)); }

  function show(next) {
    setView(next); setPicked(new Set()); setBulk(null); setFilter('all');
    if (next === 'stats') setStatsVersion((v) => v + 1);
  }

  async function run(spec, opts) {
    setError(''); setWarnings([]); setHeld(null); setBlocked(null); setSaid(null);
    setBusy(true); setElapsed(0); setProgress(null);
    const id = (crypto.randomUUID?.() ?? `run-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    setRunId(id);
    const started = Date.now();
    try {
      const res = await api.generate(content.contentId, topics, spec, { ...opts, runId: id });
      setWarnings(res.warnings ?? []);
      setTookSecs(Math.round((Date.now() - started) / 1000));
      setPlanning(false);
      await refresh();
      const flagged = res.flagged ?? 0;
      setSaid({
        tone: 'ok',
        text: `${many(res.generated ?? 0, 'draft')} written${flagged > 0 ? `, ${flagged} flagged by a rule check` : ''}. Review them before they reach a room: nothing here is served until you approve it.`,
      });
      show('drafts');
    } catch (err) {
      // 409 is either a large run waiting on a yes, or a replacing run while a
      // room on this chapter is running. Only the first can be confirmed.
      if (err.status === 409 && !opts.confirm && plan?.needsConfirm) setHeld({ spec, mode: opts.mode, total: plan?.total ?? null });
      else if (err.status === 409) setBlocked({ spec, message: err.message });
      else setError(`Writing failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function act(id, what, fn, after) {
    setWorking(`${id}:${what}`); setError(''); setSaid(null);
    try {
      const res = await fn();
      await refresh();
      if (after) setSaid(after(res));
    } catch (err) {
      setError(err.message);
    } finally {
      setWorking('');
    }
  }

  function toggle(id) {
    setBulk(null);
    setPicked((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  async function runBulk(what, fn) {
    setWorking(`bulk:${what}`); setError(''); setBulk(null); setSaid(null);
    try {
      const res = await fn([...picked]);
      await refresh();
      setBulk({ what, changed: res.changed ?? (res.question ? 1 : 0), refused: res.refused ?? [], level: res.level ?? '' });
      // Whatever was refused stays ticked, so it can be opened and fixed.
      const refusedIds = new Set((res.refused ?? []).map((r) => String(r.id)));
      setPicked((prev) => new Set([...prev].filter((id) => refusedIds.has(String(id)))));
    } catch (err) {
      setBulk({ what, changed: 0, refused: [{ id: 'all', reason: err.message }], level: '' });
    } finally {
      setWorking('');
    }
  }

  const refOf = new Map(questions.map((q, i) => [q._id, `Q${String(i + 1).padStart(2, '0')}`]));
  const ref = (id) => refOf.get(id) ?? 'This question';

  // Approving says what it let through, so a flag is never approved unseen.
  const approvedSaid = (q) => (res) => {
    const failed = res?.failedChecks ?? [];
    return failed.length === 0
      ? { tone: 'ok', text: `${ref(q._id)} approved. Rooms on this chapter can serve it now.` }
      : { text: `${ref(q._id)} approved with ${many(failed.length, 'failed check')}: ${failed.map((c) => c.message).join(' ')}` };
  };

  async function approveAll() {
    setAskAll(false);
    setWorking('all'); setError(''); setSaid(null);
    try {
      const res = await api.approveAll(content.contentId);
      await refresh();
      setSaid({ tone: res.flagged?.length ? undefined : 'ok', approvedAll: res });
    } catch (err) {
      setError(err.message);
    } finally {
      setWorking('');
    }
  }

  // Bulk restore on unapproved model output is an approval.
  async function approveClean() {
    setAskAll(false);
    const ids = drafts.filter((q) => failedChecks(q).length === 0).map((q) => q._id);
    setWorking('clean'); setError(''); setSaid(null);
    try {
      const res = await api.bulkQuestions(ids, 'restore');
      await refresh();
      const left = flaggedDrafts.length;
      setSaid({
        tone: 'ok',
        text: `${many(res.changed ?? ids.length)} approved. The ${left} flagged ${left === 1 ? 'draft waits' : 'drafts wait'} here for you to fix or approve one by one.`,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setWorking('');
    }
  }

  function variant(q, direction) {
    const word = direction === 'harder' ? 'harder' : 'easier';
    act(q._id, direction, () => api.regenerateQuestion(q._id, direction), (res) => ({
      tone: 'ok',
      text: `A ${word} version of ${ref(q._id)} is waiting in Drafts, at ${LABEL[res?.question?.bloom] ?? 'the next level'}. The original is unchanged.`,
      toDrafts: true,
    }));
  }

  function rewrite(q) {
    setAskRewrite(null);
    act(q._id, 'regen', () => api.regenerateQuestion(q._id), (res) => ({
      text: res?.warnings?.[0] ?? `${ref(q._id)} was rewritten. The new version is a draft waiting for your approval.`,
      toDrafts: true,
    }));
  }

  /* ------------------------------------------------------------- writing */
  if (busy) {
    const done = progress?.perLevelDone ?? {};
    const share = progress?.planned > 0 ? Math.min(1, progress.written / progress.planned) : 0;
    return (
      <Panel className="tc-run" aria-label="Writing the questions">
        <div className="tc-run-head">
          <div>
            <span className="tag-mint"><span className="live-dot" />Writing · {content.title}</span>
            <p className="tc-run-big" aria-live="polite">
              {progress
                ? <><Num value={progress.written} /> <span>of {progress.planned} written</span></>
                : <>{plan?.total ?? '—'} <span>planned</span></>}
            </p>
          </div>
          <dl className="tc-run-figs">
            <div><dt>Elapsed</dt><dd className="mono">{mmss(elapsed)}</dd></div>
            {plan && <div><dt>Expected, about</dt><dd className="mono">{mmss(plan.estimateSeconds)}</dd></div>}
            {progress?.topicsTotal > 0 && (
              <div>
                <dt>Topic {Math.min(progress.topicsDone + 1, progress.topicsTotal)} of {progress.topicsTotal}</dt>
                <dd>{progress.topic || 'Starting'}</dd>
              </div>
            )}
          </dl>
        </div>
        <div className="tc-run-line" role="progressbar" aria-label="Questions written" aria-valuemin={0} aria-valuemax={progress?.planned ?? 0} aria-valuenow={progress?.written ?? 0}>
          <i style={{ width: `${share * 100}%` }} />
        </div>
        {/* Each tube fills toward its share of the plan, and its surface
            moves only when a question actually lands at that level. */}
        <Tubes values={done} targets={plan?.perLevel ?? {}} height={184} />
        <p className="said">Every question is tagged to exactly one level as it is written, and arrives as a draft for you to approve.</p>
      </Panel>
    );
  }

  /* ------------------------------------------------------------ planning */
  if (planning || approved.length + drafts.length === 0) {
    return (
      <>
        {(approved.length + drafts.length > 0 || error || blocked || selected.length === 0) && (
          <div className="stack stack-2">
            {approved.length + drafts.length > 0 && (
              <div><Button variant="ghost" icon="back" onClick={() => setPlanning(false)}>Back to the questions</Button></div>
            )}
            {error && <Note tone="bad">{error}</Note>}
            {blocked && (
              <Note tone="bad" icon="lock">
                {blocked.message}
                <div className="cluster" style={{ marginTop: 12 }}>
                  <Button size="sm" variant="accent" onClick={() => { setDraft((d) => ({ ...d, mode: 'append' })); run(blocked.spec, { mode: 'append' }); }}>
                    Add them to the bank instead
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setBlocked(null)}>Not now</Button>
                </div>
              </Note>
            )}
            {selected.length === 0 && (
              <Note>No topics are ticked, so the whole chapter counts as one topic. Tick topics on Material for a wider spread.</Note>
            )}
          </div>
        )}
        <Planner
          contentId={content.contentId}
          topics={topics}
          existing={approved.length}
          drafts={drafts.length}
          draft={draft}
          held={held}
          onDraft={(patch) => { setDraft((d) => ({ ...d, ...patch })); if (patch.mode) { setHeld(null); setBlocked(null); } }}
          onPlan={(next) => { setPlan(next); setHeld((h) => (h && h.total !== next.total ? null : h)); }}
          onRun={run}
          onConfirm={() => run(held.spec, { mode: held.mode, confirm: true })}
          onDismissHeld={() => setHeld(null)}
        />
      </>
    );
  }

  /* ------------------------------------------------------------- curating */
  const list = view === 'drafts' ? drafts : view === 'aside' ? aside : approved;
  const answered = (stats.data?.counted?.answers ?? 0) > 0;
  const dist = LEVELS.reduce((a, l) => ({ ...a, [l]: list.filter((q) => q.bloom === l).length }), {});
  const bankDist = LEVELS.reduce((a, l) => ({ ...a, [l]: approved.filter((q) => q.bloom === l).length }), {});
  const bankTopics = [...new Set(approved.map((q) => q.topic).filter(Boolean))];
  const chipTopics = [...new Set(list.map((q) => q.topic).filter(Boolean))];
  const onTopic = chipTopics.includes(topicFilter) ? topicFilter : '';
  const pool = filter === 'all' ? list : list.filter((q) => q.bloom === filter);
  const scoped = onTopic ? pool.filter((q) => q.topic === onTopic) : pool;
  const needle = query.trim().toLowerCase();
  const shown = needle ? scoped.filter((q) => haystack(q).includes(needle)) : scoped;
  const open = editing && editing !== 'new' ? questions.find((q) => q._id === editing) : null;
  const covered = LEVELS.filter((l) => bankDist[l] > 0).length;
  const templated = [...approved, ...drafts].filter((q) => q.model === 'offline-template').length;
  const filtered = filter !== 'all' || Boolean(onTopic) || Boolean(needle);

  // A level is thin when it holds under half of an even share of the bank.
  const floor = Math.max(1, approved.length / 12);
  const thin = LEVELS.filter((l) => bankDist[l] < floor);
  const coverSaid = view === 'drafts'
    ? `${many(drafts.length, 'draft')} waiting${flaggedDrafts.length ? `, ${flaggedDrafts.length} flagged by a rule check` : ''}. A flag is advice: read it, fix the question or approve it as it is.`
    : view === 'aside'
      ? 'Rejected drafts and discarded questions. Nothing here reaches a room. Restoring a rejected draft approves it.'
      : approved.length === 0
        ? 'Nothing is approved yet, so a room has nothing to serve.'
        : thin.length === 0
          ? `Every level holds at least ${Math.min(...LEVELS.map((l) => bankDist[l]))} approved questions, so a student can climb all six without running dry.`
          : `Thin at ${andList(thin.map((l) => `${LABEL[l]} (${bankDist[l]})`))}. Students who reach ${thin.length === 1 ? 'that level' : 'those levels'} have the least to answer there; approve or write more there.`;

  const bulkSaid = !bulk ? '' : bulk.changed === 0 ? 'Nothing changed'
    : bulk.what === 'merge' ? 'Two questions merged into one. Both originals are set aside'
      : bulk.what === 'bloom' ? `${many(bulk.changed)} moved${bulk.level ? ` to ${bulk.level}` : ''}`
        : bulk.what === 'approve' ? `${many(bulk.changed)} approved`
          : bulk.what === 'reject' ? `${many(bulk.changed, 'draft')} rejected`
            : `${many(bulk.changed)} ${bulk.what === 'discard' ? 'set aside' : 'restored'}`;

  const clearFilters = () => { setFilter('all'); setTopicFilter(''); setQuery(''); };

  const views = [
    drafts.length > 0 && { id: 'drafts', label: 'Drafts', count: drafts.length },
    { id: 'bank', label: 'Approved', count: approved.length },
    aside.length > 0 && { id: 'aside', label: 'Set aside', count: aside.length },
    answered && { id: 'stats', label: 'How it went' },
  ].filter(Boolean);

  const outcome = said?.approvedAll;

  return (
    <>
      <div className="tc-bank-top">
        <section className="card card-pad tc-cover" aria-label="Coverage by Bloom level">
          <Section
            title={view === 'drafts' ? 'Drafts by Bloom level' : view === 'aside' ? 'Set aside, by level' : 'Approved, by Bloom level'}
            sub={`${view === 'drafts' ? many(list.length, 'draft') : `${many(list.length)} ${VIEW_WORD[view]}`}. Press a level to show only those.`}
          />
          <LevelSpread counts={dist} showKey={false} />
          <div className="tc-lvf" role="group" aria-label="Show questions at">
            <button type="button" className="tc-lvbtn" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
              All<span className="ct">{list.length}</span>
            </button>
            {LEVELS.map((l) => (
              <button key={l} type="button" className="tc-lvbtn" data-level={l} aria-pressed={filter === l} onClick={() => setFilter(l)}>
                <i className="swatch" />{LABEL[l]}<span className="ct">{dist[l]}</span>
              </button>
            ))}
          </div>
          <p className="said">{coverSaid}</p>
        </section>

        <Panel className="tc-forroom" aria-label="For the room">
          <span className="tag-mint">For the room</span>
          <div className="tc-big">
            <b><Num value={approved.length} /></b>
            <span>approved question{approved.length === 1 ? '' : 's'}, the only ones a room serves</span>
          </div>
          <p className="tc-forroom-meta">
            <span><b>{covered}</b> of 6 levels</span>
            <span><b>{bankTopics.length}</b> topic{bankTopics.length === 1 ? '' : 's'}</span>
            {tookSecs != null && <span>written in <b className="mono">{mmss(tookSecs)}</b></span>}
          </p>
          {drafts.length > 0 && (
            <p className="tc-forroom-wait">
              <Icon name="clock" size={14} />
              <span><b>{drafts.length}</b> draft{drafts.length === 1 ? '' : 's'} waiting for your review</span>
              {view !== 'drafts' && <button type="button" className="link" onClick={() => show('drafts')}>Review</button>}
            </p>
          )}
          <div className="cluster">
            <Button variant="accent" onClick={onNext}>Set up the room<Icon name="forward" /></Button>
            <Button icon="plan" onClick={() => setPlanning(true)}>Plan another run</Button>
          </div>
        </Panel>
      </div>

      {(error || warnings.length > 0 || templated > 0 || bulk || said) && (
        <div className="stack stack-2">
          {error && <Note tone="bad">{error}</Note>}
          {said && !outcome && (
            <Note tone={said.tone} icon={said.tone === 'ok' ? 'ok' : 'alert'}>
              {said.text}
              {said.toDrafts && view !== 'drafts' && drafts.length > 0 && (
                <> <button type="button" className="link" onClick={() => show('drafts')}>Show the drafts</button></>
              )}
            </Note>
          )}
          {outcome && (
            <Note tone={outcome.flagged?.length ? undefined : 'ok'} icon={outcome.flagged?.length ? 'alert' : 'ok'}>
              <b>{many(outcome.approved)} approved. The bank now holds {outcome.bankCount}.</b>
              {outcome.flagged?.length > 0 && (
                <>
                  <div>{outcome.flagged.length === 1 ? 'One of them' : `${outcome.flagged.length} of them`} failed a rule check. They are in rooms now; read them again when you can.</div>
                  <ul className="tc-flagged">
                    {outcome.flagged.map((f) => (
                      <li key={f.id}>
                        <span className="tc-ref">{ref(f.id)}</span>
                        <span className="tc-flagged-txt">
                          <span className="clip">{f.text}</span>
                          {(f.failedChecks ?? []).map((c) => <span key={c.id} className="t-small dim">{c.message}</span>)}
                        </span>
                        <Button size="sm" variant="ghost" icon="edit" onClick={() => setEditing(f.id)}>Open</Button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Note>
          )}
          {warnings.length > 0 && (
            <Note icon="alert">{warnings.slice(0, 3).map((w) => <div key={w}>{w}</div>)}</Note>
          )}
          {templated > 0 && (
            <Note icon="alert">
              <b>{templated} of these came from the offline template writer</b>, not the language model. They are labelled
              here and on every phone. Do not present them as model output.
            </Note>
          )}
          {bulk && (
            <Note tone={bulk.refused.length ? undefined : 'ok'} icon="alert">
              <b>{bulkSaid}{bulk.changed > 0 && bulk.refused.length > 0 && `, ${bulk.refused.length} refused`}</b>
              {bulk.refused.map((r) => <div key={r.id}>{r.reason}</div>)}
              {bulk.refused.length > 0 && picked.size > 0 && <div>Still ticked below, so you can open {picked.size === 1 ? 'it' : 'them'} and fix {picked.size === 1 ? 'it' : 'them'}.</div>}
            </Note>
          )}
        </div>
      )}

      <div className="tc-qbar">
        {views.length > 1 && <Segmented label="Which questions" value={view} onChange={show} options={views} />}
        {view !== 'stats' && (
          <label className="search tc-qsearch">
            <Icon name="search" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search questions and answers" aria-label="Search the bank" />
          </label>
        )}
        <span className="push cluster">
          <Tip label="Write a question yourself. It goes straight into the bank, approved.">
            <Button icon="edit" onClick={() => setEditing('new')}>Write your own</Button>
          </Tip>
          <Tip label="Plan a run that adds drafts to this bank">
            <Button icon="plus" onClick={() => { setDraft((d) => ({ ...d, mode: 'append' })); setPlanning(true); }}>Add questions</Button>
          </Tip>
        </span>
      </div>

      {view === 'stats' && (
        <StatsView contentId={content.contentId} questions={questions} stats={stats} onCheckKey={(id) => setEditing(id)} />
      )}

      {view !== 'stats' && chipTopics.length > 1 && (
        <div className="tc-tchips" role="group" aria-label="Show topic">
          <button type="button" className="tc-tchip" aria-pressed={!onTopic} onClick={() => setTopicFilter('')}>All topics</button>
          {chipTopics.map((t) => (
            <button key={t} type="button" className="tc-tchip" aria-pressed={onTopic === t} title={t} onClick={() => setTopicFilter(onTopic === t ? '' : t)}>{t}</button>
          ))}
        </div>
      )}

      {view !== 'stats' && (
      <section className="card tc-qcard" aria-label={view === 'drafts' ? 'Drafts' : view === 'aside' ? 'Set aside' : 'Approved questions'}>
        <div className="tc-qhead" data-bulk={picked.size > 0 ? 'true' : undefined}>
          {picked.size > 0 ? (
            <>
              <span className="strong">{picked.size} ticked</span>
              <Button variant="ghost" size="sm" onClick={() => { setPicked(new Set()); setBulk(null); }}>Clear</Button>
              <span className="push cluster">
                {view !== 'aside' && (
                  <>
                    <select className="select input-sm" style={{ width: 150 }} aria-label="Move the ticked questions to a level" value={retagTo} onChange={(e) => setRetagTo(e.target.value)}>
                      <option value="">Move to level</option>
                      {LEVELS.map((l) => <option key={l} value={l}>{LABEL[l]}</option>)}
                    </select>
                    <Button size="sm" busy={working === 'bulk:bloom'} disabled={!retagTo || Boolean(working)} onClick={() => runBulk('bloom', (ids) => api.bulkQuestions(ids, 'bloom', retagTo))}>Move</Button>
                    <Tip label={picked.size === 2 ? 'Combine these two into one question' : 'Tick exactly two questions to merge'}>
                      <Button size="sm" icon="merge" busy={working === 'bulk:merge'} disabled={picked.size !== 2 || Boolean(working)} onClick={() => runBulk('merge', (ids) => api.mergeQuestions(ids))}>Merge two</Button>
                    </Tip>
                  </>
                )}
                {view === 'drafts' && (
                  <>
                    <Button size="sm" variant="danger" icon="close" busy={working === 'bulk:reject'} disabled={Boolean(working)} onClick={() => runBulk('reject', (ids) => api.bulkQuestions(ids, 'discard'))}>Reject</Button>
                    <Button size="sm" variant="primary" icon="check" busy={working === 'bulk:approve'} disabled={Boolean(working)} onClick={() => runBulk('approve', (ids) => api.bulkQuestions(ids, 'restore'))}>Approve {picked.size}</Button>
                  </>
                )}
                {view === 'bank' && (
                  <Button size="sm" variant="danger" icon="trash" busy={working === 'bulk:discard'} disabled={Boolean(working)} onClick={() => runBulk('discard', (ids) => api.bulkQuestions(ids, 'discard'))}>Set aside</Button>
                )}
                {view === 'aside' && (
                  <Button size="sm" icon="undo" busy={working === 'bulk:restore'} disabled={Boolean(working)} onClick={() => runBulk('restore', (ids) => api.bulkQuestions(ids, 'restore'))}>Restore</Button>
                )}
              </span>
            </>
          ) : (
            <>
              <span className="tc-qhead-meta">
                {shown.length} shown{filtered ? ` of ${list.length}` : ''}
              </span>
              {filtered && <Button variant="ghost" size="sm" onClick={clearFilters}>Clear the filter</Button>}
              <label className="check push">
                <input type="checkbox" checked={showKeys} onChange={(e) => setShowKeys(e.target.checked)} />
                Show every answer key
              </label>
              {view === 'drafts' && (
                <Button size="sm" variant="primary" icon="check" busy={working === 'all' || working === 'clean'} disabled={Boolean(working)} onClick={() => (flaggedDrafts.length > 0 ? setAskAll(true) : approveAll())}>
                  Approve all {drafts.length}
                </Button>
              )}
            </>
          )}
        </div>

        {shown.length === 0 ? (
          <Empty icon="search" title="Nothing here" action={<Button onClick={clearFilters}>Clear the filter</Button>}>
            {needle ? `Nothing here mentions "${query.trim()}".` : 'No questions match that filter. Pick a different level or topic.'}
          </Empty>
        ) : (
          <ul className="tc-qlist">
            {shown.map((q) => {
              const kind = q.kind ?? 'mcq';
              const rowBusy = Boolean(working) && (working.startsWith(`${q._id}:`) || !working.includes(':'));
              const isOpen = showKeys || opened.has(q._id);
              const isDraft = q.status === 'draft';
              const off = q.status === 'discarded';
              const failed = failedChecks(q);
              const source = sourceLabel(q);
              const slides = slidesLabel(q);
              const poll = kind === 'poll';
              return (
                <li
                  key={q._id}
                  className="tc-q"
                  data-off={off ? 'true' : undefined}
                  data-draft={isDraft ? 'true' : undefined}
                  data-picked={picked.has(q._id) ? 'true' : undefined}
                  data-open={isOpen ? 'true' : undefined}
                >
                  <label className="tc-q-pick">
                    <input type="checkbox" checked={picked.has(q._id)} onChange={() => toggle(q._id)} aria-label={`Tick: ${q.text}`} />
                  </label>
                  <button
                    type="button"
                    className="tc-q-main"
                    aria-expanded={isOpen}
                    onClick={() => setOpened((prev) => { const next = new Set(prev); if (next.has(q._id)) next.delete(q._id); else next.add(q._id); return next; })}
                  >
                    <span className="tc-q-meta">
                      <Level level={q.bloom} />
                      {q.topic && <span className="tc-q-topic">{q.topic}</span>}
                      <span className="tc-ref">{refOf.get(q._id)}</span>
                      <i className="dot" aria-hidden="true" />
                      <span>{KIND_LABEL[kind] ?? kind}</span>
                      {slides && <span className="tc-q-slides">{slides}</span>}
                      {isDraft
                        ? <Chip className="chip-line" title={q.model ?? undefined}>{q.model === 'offline-template' ? 'Offline template' : q.model ? 'AI draft' : 'Draft'} · review</Chip>
                        : off
                          ? <Chip className="chip-line">{isRejectedDraft(q) ? 'Rejected draft' : 'Set aside'}</Chip>
                          : source && <Chip className="chip-line" title={q.model ?? undefined}>{source}</Chip>}
                      {failed.length > 0 && <Chip tone="warn" icon="alert">{failed.length === 1 ? '1 flag' : `${failed.length} flags`}</Chip>}
                    </span>
                    <span className="tc-q-text">{q.text}</span>
                    {!isDraft && <ItemFigures item={stats.byId.get(q._id)} />}
                    {failed.length > 0 && (isDraft || isOpen) && (
                      <span className="tc-q-flags">
                        {failed.map((c) => <span key={c.id}><Icon name="alert" size={13} />{c.message}</span>)}
                      </span>
                    )}
                  </button>
                  <span className="tc-q-acts">
                    {isDraft ? (
                      <span className="tc-q-decide">
                        <Tip label="Edit"><Button variant="ghost" size="sm" icon="edit" aria-label={`Edit ${refOf.get(q._id)}`} disabled={rowBusy} onClick={() => setEditing(q._id)} /></Tip>
                        <Button size="sm" variant="ghost" busy={working === `${q._id}:reject`} disabled={rowBusy} onClick={() => act(q._id, 'reject', () => api.rejectQuestion(q._id))}>Reject</Button>
                        <Button size="sm" icon="check" busy={working === `${q._id}:approve`} disabled={rowBusy} onClick={() => act(q._id, 'approve', () => api.approveQuestion(q._id), approvedSaid(q))}>Approve</Button>
                      </span>
                    ) : (
                      <span className="tc-q-tools">
                        {off ? (
                          <Button size="sm" icon={isRejectedDraft(q) ? 'check' : 'undo'} busy={working === `${q._id}:restore`} disabled={rowBusy} onClick={() => act(q._id, 'restore', () => api.restoreQuestion(q._id))}>
                            {isRejectedDraft(q) ? 'Approve' : 'Restore'}
                          </Button>
                        ) : (
                          <>
                            <Tip label="Edit"><Button variant="ghost" size="sm" icon="edit" aria-label={`Edit ${refOf.get(q._id)}`} disabled={rowBusy} onClick={() => setEditing(q._id)} /></Tip>
                            <Menu
                              trigger={<Button variant="ghost" size="sm" icon="more" aria-label={`More for ${refOf.get(q._id)}`} busy={rowBusy && working.startsWith(`${q._id}:`)} disabled={rowBusy} />}
                              items={[
                                { id: 'harder', label: q.bloom === 'create' ? 'Harder: already at Create' : 'Write a harder version', icon: 'up', disabled: poll || q.bloom === 'create', onSelect: () => variant(q, 'harder') },
                                { id: 'easier', label: q.bloom === 'remember' ? 'Easier: already at Remember' : 'Write an easier version', icon: 'down', disabled: poll || q.bloom === 'remember', onSelect: () => variant(q, 'easier') },
                                { id: 'regen', label: 'Rewrite it', icon: 'refresh', onSelect: () => setAskRewrite(q) },
                                'sep',
                                { id: 'discard', label: 'Set aside', icon: 'trash', danger: true, onSelect: () => act(q._id, 'discard', () => api.discardQuestion(q._id)) },
                              ]}
                            />
                          </>
                        )}
                      </span>
                    )}
                    <Icon name="chevron" className="tc-q-chev" />
                  </span>
                  {isOpen && (
                    <div className="tc-q-key">
                      <AnswerKey q={q} />
                      {(stats.byId.get(q._id)?.attempts ?? 0) > 0 && (
                        <ItemDetail item={stats.byId.get(q._id)} thresholds={stats.data?.thresholds} onCheckKey={(id) => setEditing(id)} />
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      )}

      {(open || editing === 'new') && (
        <Editor
          key={open?._id ?? 'new'}
          question={open ?? null}
          contentId={content.contentId}
          kinds={bank?.kinds}
          onClose={() => setEditing('')}
          onDone={async (info) => {
            await refresh();
            setStatsVersion((v) => v + 1);
            setEditing('');
            if (info?.note) setSaid({ tone: info.tone, text: info.note, toDrafts: /draft/i.test(info.note) });
          }}
        />
      )}

      <Dialog
        open={askAll}
        onOpenChange={setAskAll}
        title={`Approve all ${drafts.length} drafts?`}
        description={`${flaggedDrafts.length} of them failed a rule check.`}
        footer={(
          <>
            <Button variant="ghost" onClick={() => setAskAll(false)}>Cancel</Button>
            <Button disabled={drafts.length === flaggedDrafts.length} onClick={approveClean}>
              Approve the {drafts.length - flaggedDrafts.length} that passed
            </Button>
            <Button variant="primary" onClick={approveAll}>Approve all {drafts.length}</Button>
          </>
        )}
      >
        <div className="stack stack-3">
          <p>Checks are advice, not refusals: approving lets a flagged question into rooms exactly as it is. These are the flags:</p>
          <ul className="tc-flagged">
            {flaggedDrafts.slice(0, 6).map((q) => (
              <li key={q._id}>
                <span className="tc-ref">{refOf.get(q._id)}</span>
                <span className="tc-flagged-txt">
                  <span className="clip">{q.text}</span>
                  {failedChecks(q).map((c) => <span key={c.id} className="t-small dim">{c.message}</span>)}
                </span>
              </li>
            ))}
          </ul>
          {flaggedDrafts.length > 6 && <p className="t-small dim">And {flaggedDrafts.length - 6} more, each marked in the list.</p>}
        </div>
      </Dialog>

      <Dialog
        open={Boolean(askRewrite)}
        onOpenChange={(v) => { if (!v) setAskRewrite(null); }}
        title={`Rewrite ${askRewrite ? refOf.get(askRewrite._id) : ''}?`}
        description="The rewrite arrives as a draft, at the same level."
        footer={(
          <>
            <Button variant="ghost" onClick={() => setAskRewrite(null)}>Cancel</Button>
            <Button variant="primary" icon="refresh" onClick={() => rewrite(askRewrite)}>Rewrite it</Button>
          </>
        )}
      >
        <p>
          This question is approved and in use, so it leaves rooms now and is set aside. Its replacement joins rooms when you
          approve it. To keep this one and add another beside it, ask for a harder or easier version instead.
        </p>
      </Dialog>
    </>
  );
}
