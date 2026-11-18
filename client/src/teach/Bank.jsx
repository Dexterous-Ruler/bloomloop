/**
 * Step two: the questions.
 *
 * Three states of one screen. With no bank yet it is the planner. While a run
 * is in the air it is six tubes filling. With a bank it is a list to curate:
 * the bank's coverage across the levels beside what goes to the room, then
 * the questions themselves - filter by level or topic, read the answer key,
 * tick several and act on them, open one in the editor beside the list.
 */

import { useEffect, useState } from 'react';

import Tubes from '../fx/Tubes.jsx';
import { api } from '../lib/api.js';
import { LABEL, LEVELS } from '../lib/bloom.js';
import { KIND_LABEL } from '../lib/kinds.js';
import { Button, Chip, Empty, Icon, Level, Note, Num, Panel, Section, Tip } from '../ui/index.jsx';
import { LevelSpread } from '../ui/viz.jsx';
import AnswerKey from './AnswerKey.jsx';
import Editor from './Editor.jsx';
import Planner, { mmss, startTotal } from './Planner.jsx';

// Everything a teacher might search a question by, including its answer key.
const haystack = (q) => [
  q.text, q.topic,
  ...(q.options ?? []),
  ...(q.pairs ?? []).flatMap((p) => [p?.left, p?.right]),
  ...(q.buckets ?? []).flatMap((b) => [b?.name, ...(b?.items ?? [])]),
  ...(q.sequence ?? []), q.criterion,
  ...(q.accept ?? []),
  ...(q.blanks ?? []).flatMap((b) => b?.accept ?? []),
  q.unit,
  ...(q.rubric ?? []),
].filter(Boolean).join(' ').toLowerCase();

const many = (n) => `${n} question${n === 1 ? '' : 's'}`;
const andList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

export default function Bank({ content, selected, bank, onBank, onPhase, onBack, onNext }) {
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [runId, setRunId] = useState('');
  const [progress, setProgress] = useState(null);
  const [tookSecs, setTookSecs] = useState(null);
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState([]);
  const [filter, setFilter] = useState('all');
  const [topicFilter, setTopicFilter] = useState('');
  const [query, setQuery] = useState('');
  const [working, setWorking] = useState('');
  const [planning, setPlanning] = useState(false);
  const [plan, setPlan] = useState(null);
  const [editing, setEditing] = useState('');
  const [picked, setPicked] = useState(() => new Set());
  const [opened, setOpened] = useState(() => new Set());
  const [showKeys, setShowKeys] = useState(false);
  const [bulk, setBulk] = useState(null);
  const [retagTo, setRetagTo] = useState('');
  // A run the server held back for being large, waiting on a yes.
  const [held, setHeld] = useState(null);
  const [draft, setDraft] = useState(() => ({
    total: startTotal(selected.length),
    preset: 'balanced',
    mix: null,
    kinds: {},
    mode: 'replace',
  }));

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

  // Tell the console which state this step is in, so its head can say so.
  const keptCount = (bank?.questions ?? []).filter((q) => q.status !== 'discarded').length;
  const phase = busy ? 'writing' : keptCount === 0 ? 'first' : planning ? 'again' : 'curating';
  useEffect(() => { onPhase?.(phase); }, [phase, onPhase]);

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

  async function run(spec, opts) {
    setError(''); setWarnings([]); setHeld(null); setBusy(true); setElapsed(0); setProgress(null);
    const id = (crypto.randomUUID?.() ?? `run-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    setRunId(id);
    const started = Date.now();
    try {
      const res = await api.generate(content.contentId, topics, spec, { ...opts, runId: id });
      setWarnings(res.warnings ?? []);
      setTookSecs(Math.round((Date.now() - started) / 1000));
      setPlanning(false);
      await refresh();
    } catch (err) {
      // 409 is the server asking for a yes on a large run, not a failure.
      if (err.status === 409) setHeld({ spec, mode: opts.mode, total: plan?.total ?? null });
      else setError(`Writing failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function act(id, what, fn) {
    setWorking(`${id}:${what}`); setError('');
    try { await fn(); await refresh(); }
    catch (err) { setError(err.message); }
    finally { setWorking(''); }
  }

  function toggle(id) {
    setBulk(null);
    setPicked((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  async function runBulk(what, fn) {
    setWorking(`bulk:${what}`); setError(''); setBulk(null);
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

  const questions = bank?.questions ?? [];
  const active = questions.filter((q) => q.status !== 'discarded');
  const discarded = questions.filter((q) => q.status === 'discarded');
  const dist = LEVELS.reduce((a, l) => ({ ...a, [l]: active.filter((q) => q.bloom === l).length }), {});
  const fallbacks = active.filter((q) => q.source === 'fallback').length;

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
        <p className="said">Every question is tagged to exactly one level as it is written. Nothing is tagged afterwards, so nothing lands untagged.</p>
      </Panel>
    );
  }

  /* ------------------------------------------------------------ planning */
  if (planning || active.length === 0) {
    return (
      <>
        {(active.length > 0 || error || selected.length === 0) && (
          <div className="stack stack-2">
            {active.length > 0 && (
              <div><Button variant="ghost" icon="back" onClick={() => setPlanning(false)}>Back to the questions</Button></div>
            )}
            {error && <Note tone="bad">{error}</Note>}
            {selected.length === 0 && (
              <Note>No topics are ticked, so the whole chapter counts as one topic. Tick topics on Material for a wider spread.</Note>
            )}
          </div>
        )}
        <Planner
          contentId={content.contentId}
          topics={topics}
          existing={active.length}
          draft={draft}
          held={held}
          onDraft={(patch) => { setDraft((d) => ({ ...d, ...patch })); if (patch.mode) setHeld(null); }}
          onPlan={(next) => { setPlan(next); setHeld((h) => (h && h.total !== next.total ? null : h)); }}
          onRun={run}
          onConfirm={() => run(held.spec, { mode: held.mode, confirm: true })}
          onDismissHeld={() => setHeld(null)}
        />
      </>
    );
  }

  /* ------------------------------------------------------------- curating */
  const bankTopics = [...new Set(active.map((q) => q.topic).filter(Boolean))];
  const chipTopics = [...new Set(questions.map((q) => q.topic).filter(Boolean))];
  const onTopic = chipTopics.includes(topicFilter) ? topicFilter : '';
  const pool = filter === 'discarded' ? discarded : filter === 'all' ? active : active.filter((q) => q.bloom === filter);
  const scoped = onTopic ? pool.filter((q) => q.topic === onTopic) : pool;
  const needle = query.trim().toLowerCase();
  const shown = needle ? scoped.filter((q) => haystack(q).includes(needle)) : scoped;
  const open = editing ? questions.find((q) => q._id === editing) : null;
  const refOf = new Map(questions.map((q, i) => [q._id, `Q${String(i + 1).padStart(2, '0')}`]));
  const covered = LEVELS.filter((l) => dist[l] > 0).length;

  // A level is thin when it holds under half of an even share of the bank.
  const floor = Math.max(1, active.length / 12);
  const thin = LEVELS.filter((l) => dist[l] < floor);
  const thinSaid = thin.length === 0
    ? `Every level holds at least ${Math.min(...LEVELS.map((l) => dist[l]))} questions, so a student can climb all six without running dry.`
    : `Thin at ${andList(thin.map((l) => `${LABEL[l]} (${dist[l]})`))}. Students who reach ${thin.length === 1 ? 'that level' : 'those levels'} have the least to answer there; plan another run weighted towards ${thin.length === 1 ? 'it' : 'them'}.`;

  const bulkSaid = !bulk ? '' : bulk.changed === 0 ? 'Nothing changed'
    : bulk.what === 'merge' ? 'Two questions merged into one. Both originals are in the discarded pile'
      : bulk.what === 'bloom' ? `${many(bulk.changed)} moved${bulk.level ? ` to ${bulk.level}` : ''}`
        : `${many(bulk.changed)} ${bulk.what === 'discard' ? 'discarded' : 'restored'}`;

  const clearFilters = () => { setFilter('all'); setTopicFilter(''); setQuery(''); };

  return (
    <>
      <div className="tc-bank-top">
        <section className="card card-pad tc-cover" aria-label="Coverage by Bloom level">
          <Section
            title="Coverage by Bloom level"
            sub={`${active.length} questions kept, across ${bankTopics.length} topic${bankTopics.length === 1 ? '' : 's'}. Press a level to show only those.`}
          />
          <LevelSpread counts={dist} showKey={false} />
          <div className="tc-lvf" role="group" aria-label="Show questions at">
            <button type="button" className="tc-lvbtn" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
              All<span className="ct">{active.length}</span>
            </button>
            {LEVELS.map((l) => (
              <button key={l} type="button" className="tc-lvbtn" data-level={l} aria-pressed={filter === l} onClick={() => setFilter(l)}>
                <i className="swatch" />{LABEL[l]}<span className="ct">{dist[l]}</span>
              </button>
            ))}
            {discarded.length > 0 && (
              <button type="button" className="tc-lvbtn" aria-pressed={filter === 'discarded'} onClick={() => setFilter('discarded')}>
                <Icon name="trash" size={13} />Discarded<span className="ct">{discarded.length}</span>
              </button>
            )}
          </div>
          <p className="said">{thinSaid}</p>
        </section>

        <Panel className="tc-forroom" aria-label="For the room">
          <span className="tag-mint">For the room</span>
          <div className="tc-big">
            <b><Num value={active.length} /></b>
            <span>questions go to the room when it opens</span>
          </div>
          <p className="tc-forroom-meta">
            <span><b>{covered}</b> of 6 levels</span>
            <span><b>{bankTopics.length}</b> topic{bankTopics.length === 1 ? '' : 's'}</span>
            {tookSecs != null && <span>written in <b className="mono">{mmss(tookSecs)}</b></span>}
            {discarded.length > 0 && <span><b>{discarded.length}</b> discarded</span>}
          </p>
          <div className="cluster">
            <Button variant="accent" onClick={onNext}>Set up the room<Icon name="forward" /></Button>
            <Button icon="plan" onClick={() => setPlanning(true)}>Plan another run</Button>
          </div>
        </Panel>
      </div>

      {(error || warnings.length > 0 || fallbacks > 0 || bulk) && (
        <div className="stack stack-2">
          {error && <Note tone="bad">{error}</Note>}
          {warnings.length > 0 && (
            <Note icon="alert">{warnings.length} item{warnings.length === 1 ? ' was' : 's were'} rejected by the schema and retried: {warnings.slice(0, 3).join(' · ')}</Note>
          )}
          {fallbacks > 0 && (
            <Note icon="alert">
              <b>{fallbacks} of these came from the offline template writer</b>, not the language model. They are labelled
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
        <label className="search tc-qsearch">
          <Icon name="search" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search questions and answers" aria-label="Search the bank" />
        </label>
        {chipTopics.length > 1 && (
          <div className="tc-tchips" role="group" aria-label="Show topic">
            <button type="button" className="tc-tchip" aria-pressed={!onTopic} onClick={() => setTopicFilter('')}>All topics</button>
            {chipTopics.map((t) => (
              <button key={t} type="button" className="tc-tchip" aria-pressed={onTopic === t} title={t} onClick={() => setTopicFilter(onTopic === t ? '' : t)}>{t}</button>
            ))}
          </div>
        )}
        <Tip label="Plan a run that adds to this bank">
          <Button icon="plus" className="push" onClick={() => { setDraft((d) => ({ ...d, mode: 'append' })); setPlanning(true); }}>Add questions</Button>
        </Tip>
      </div>

      <section className="card tc-qcard" aria-label="Questions">
        <div className="tc-qhead" data-bulk={picked.size > 0 ? 'true' : undefined}>
          {picked.size > 0 ? (
            <>
              <span className="strong">{picked.size} ticked</span>
              <Button variant="ghost" size="sm" onClick={() => { setPicked(new Set()); setBulk(null); }}>Clear</Button>
              <span className="push cluster">
                <select className="select input-sm" style={{ width: 150 }} aria-label="Move the ticked questions to a level" value={retagTo} onChange={(e) => setRetagTo(e.target.value)}>
                  <option value="">Move to level</option>
                  {LEVELS.map((l) => <option key={l} value={l}>{LABEL[l]}</option>)}
                </select>
                <Button size="sm" busy={working === 'bulk:bloom'} disabled={!retagTo || Boolean(working)} onClick={() => runBulk('bloom', (ids) => api.bulkQuestions(ids, 'bloom', retagTo))}>Move</Button>
                <Tip label={picked.size === 2 ? 'Combine these two into one question' : 'Tick exactly two questions to merge'}>
                  <Button size="sm" icon="merge" busy={working === 'bulk:merge'} disabled={picked.size !== 2 || Boolean(working)} onClick={() => runBulk('merge', (ids) => api.mergeQuestions(ids))}>Merge two</Button>
                </Tip>
                <Button size="sm" icon="undo" busy={working === 'bulk:restore'} disabled={Boolean(working)} onClick={() => runBulk('restore', (ids) => api.bulkQuestions(ids, 'restore'))}>Restore</Button>
                <Button size="sm" variant="danger" icon="trash" busy={working === 'bulk:discard'} disabled={Boolean(working)} onClick={() => runBulk('discard', (ids) => api.bulkQuestions(ids, 'discard'))}>Discard</Button>
              </span>
            </>
          ) : (
            <>
              <span className="tc-qhead-meta">
                {shown.length} shown{filter !== 'all' || onTopic || needle ? ` of ${filter === 'discarded' ? discarded.length : active.length}` : ''}
              </span>
              {(filter !== 'all' || onTopic || needle) && <Button variant="ghost" size="sm" onClick={clearFilters}>Clear the filter</Button>}
              <label className="check push">
                <input type="checkbox" checked={showKeys} onChange={(e) => setShowKeys(e.target.checked)} />
                Show every answer key
              </label>
            </>
          )}
        </div>

        {shown.length === 0 ? (
          <Empty icon="search" title="Nothing here" action={<Button onClick={clearFilters}>Clear the filter</Button>}>
            {needle ? `Nothing in the bank mentions "${query.trim()}".` : 'No questions match that filter yet. Plan another run weighted towards it, or pick a different filter.'}
          </Empty>
        ) : (
          <ul className="tc-qlist">
            {shown.map((q) => {
              const kind = q.kind ?? 'mcq';
              const rowBusy = working.startsWith(`${q._id}:`);
              const isOpen = showKeys || opened.has(q._id);
              const off = q.status === 'discarded';
              return (
                <li
                  key={q._id}
                  className="tc-q"
                  data-off={off ? 'true' : undefined}
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
                      {q.source === 'fallback' && <Chip className="chip-line">offline template</Chip>}
                    </span>
                    <span className="tc-q-text">{q.text}</span>
                  </button>
                  <span className="tc-q-acts">
                    <span className="tc-q-tools">
                      {off ? (
                        <Button size="sm" icon="undo" busy={working === `${q._id}:restore`} disabled={rowBusy} onClick={() => act(q._id, 'restore', () => api.restoreQuestion(q._id))}>Restore</Button>
                      ) : (
                        <>
                          <Tip label="Edit"><Button variant="ghost" size="sm" icon="edit" aria-label="Edit this question" disabled={rowBusy} onClick={() => setEditing(q._id)} /></Tip>
                          <Tip label="Rewrite it"><Button variant="ghost" size="sm" icon="refresh" aria-label="Rewrite this question" busy={working === `${q._id}:regen`} disabled={rowBusy} onClick={() => act(q._id, 'regen', () => api.regenerateQuestion(q._id))} /></Tip>
                          <Tip label="Discard"><Button variant="ghost" size="sm" icon="trash" aria-label="Discard this question" busy={working === `${q._id}:discard`} disabled={rowBusy} onClick={() => act(q._id, 'discard', () => api.discardQuestion(q._id))} /></Tip>
                        </>
                      )}
                    </span>
                    <Icon name="chevron" className="tc-q-chev" />
                  </span>
                  {isOpen && <div className="tc-q-key"><AnswerKey q={q} /></div>}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {open && (
        <Editor
          key={open._id}
          question={open}
          kinds={bank?.kinds}
          onClose={() => setEditing('')}
          onDone={async () => { await refresh(); setEditing(''); }}
        />
      )}
    </>
  );
}
