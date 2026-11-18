/**
 * Step two: the questions.
 *
 * Three states of one screen. With no bank yet it is the planner. While a run
 * is in the air it is six tubes filling. With a bank it is a list to curate:
 * filter by level, read the answer key, tick several and act on them, open one
 * in the editor beside the list.
 */

import { useEffect, useState } from 'react';

import Tubes from '../fx/Tubes.jsx';
import { api } from '../lib/api.js';
import { LABEL, LEVELS } from '../lib/bloom.js';
import { KIND_LABEL } from '../lib/kinds.js';
import { Button, Chip, Empty, Icon, Level, Loop, Note, Num, Tip } from '../ui/index.jsx';
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

export default function Bank({ content, selected, bank, onBank, onBack, onNext }) {
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [runId, setRunId] = useState('');
  const [progress, setProgress] = useState(null);
  const [tookSecs, setTookSecs] = useState(null);
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState([]);
  const [filter, setFilter] = useState('all');
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

  if (!content) {
    return (
      <Empty icon="material" title="No chapter is open" action={<Button variant="primary" onClick={onBack}>Go to Material</Button>}>
        Questions are written from a chapter, so there is nothing to write from until one is open.
      </Empty>
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
    return (
      <>
        <div className="page-head">
          <div>
            <div className="eyebrow">{content.title}</div>
            <h1>Writing the questions</h1>
          </div>
        </div>
        <section className="card">
          <div className="card-body stack stack-5">
            <div className="figs ruled">
              <div className="fig fig-lg"><b className="mono">{mmss(elapsed)}</b><span>elapsed{plan ? `, about ${mmss(plan.estimateSeconds)} expected` : ''}</span></div>
              <div className="fig fig-lg">
                <b>{progress ? <><Num value={progress.written} /><span className="muted"> of {progress.planned}</span></> : (plan?.total ?? '—')}</b>
                <span>{progress ? 'written' : 'planned'}</span>
              </div>
              {progress?.topicsTotal > 0 && (
                <div className="fig grow">
                  <b>{Math.min(progress.topicsDone + 1, progress.topicsTotal)}<span className="muted"> of {progress.topicsTotal}</span></b>
                  <span className="clip">{progress.topic ? `topic: ${progress.topic}` : 'topics'}</span>
                </div>
              )}
            </div>
            {/* Each tube fills toward its share of the plan, and its surface
                moves only when a question actually lands at that level. */}
            <Tubes values={done} targets={plan?.perLevel ?? {}} height={184} />
            <p className="said">Every question is tagged to exactly one level as it is written. Nothing is tagged afterwards, so nothing lands untagged.</p>
          </div>
        </section>
      </>
    );
  }

  /* ------------------------------------------------------------ planning */
  if (planning || active.length === 0) {
    return (
      <>
        <div className="page-head">
          <div>
            <div className="eyebrow">{content.title} · {topics.length} topic{topics.length === 1 ? '' : 's'}</div>
            <h1>{active.length === 0 ? 'Plan the questions' : 'Plan another run'}</h1>
          </div>
          {active.length > 0 && (
            <div className="acts"><Button icon="back" onClick={() => setPlanning(false)}>Back to the questions</Button></div>
          )}
        </div>
        {(error || selected.length === 0) && (
          <div className="stack stack-2" style={{ marginBottom: 16 }}>
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
  const pool = filter === 'discarded' ? discarded : filter === 'all' ? active : active.filter((q) => q.bloom === filter);
  const needle = query.trim().toLowerCase();
  const shown = needle ? pool.filter((q) => haystack(q).includes(needle)) : pool;
  const open = editing ? questions.find((q) => q._id === editing) : null;

  const bulkSaid = !bulk ? '' : bulk.changed === 0 ? 'Nothing changed'
    : bulk.what === 'merge' ? 'Two questions merged into one. Both originals are in the discarded pile'
      : bulk.what === 'bloom' ? `${many(bulk.changed)} moved${bulk.level ? ` to ${bulk.level}` : ''}`
        : `${many(bulk.changed)} ${bulk.what === 'discard' ? 'discarded' : 'restored'}`;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{content.title}</div>
          <h1><Num value={active.length} /> questions</h1>
          <p className="t-small muted" style={{ marginTop: 4 }}>
            across {bankTopics.length} topic{bankTopics.length === 1 ? '' : 's'}
            {tookSecs != null ? `, written in ${mmss(tookSecs)}` : ''}
            {discarded.length > 0 ? `, ${discarded.length} discarded` : ''}
          </p>
        </div>
        <div className="acts">
          <Button icon="plan" onClick={() => setPlanning(true)}>Plan another run</Button>
          <Button variant="primary" onClick={onNext}>Open a room<Icon name="forward" /></Button>
        </div>
      </div>

      {(error || warnings.length > 0 || fallbacks > 0 || bulk) && (
        <div className="stack stack-2" style={{ marginBottom: 16 }}>
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

      <section className="card">
        {/* The shape of the bank is also the way to narrow it. */}
        <div className="card-body stack stack-3" style={{ paddingBottom: 12 }}>
          <LevelSpread counts={dist} showKey={false} />
          <div className="cluster">
            <button type="button" className="lvfilter" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
              <Loop size={16} />All<span className="ct">{active.length}</span>
            </button>
            {LEVELS.map((l) => (
              <button key={l} type="button" className="lvfilter" data-level={l} aria-pressed={filter === l} onClick={() => setFilter(l)}>
                <Loop level={l} size={16} />{LABEL[l]}<span className="ct">{dist[l]}</span>
              </button>
            ))}
            {discarded.length > 0 && (
              <button type="button" className="lvfilter" aria-pressed={filter === 'discarded'} onClick={() => setFilter('discarded')}>
                <Icon name="trash" />Discarded<span className="ct">{discarded.length}</span>
              </button>
            )}
            <label className="search push" style={{ width: 260, maxWidth: '100%' }}>
              <Icon name="search" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search questions and answers" aria-label="Search the bank" />
            </label>
          </div>
        </div>

        <div className="qtools">
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
              <span className="t-meta">{shown.length} shown</span>
              <label className="check push t-small">
                <input type="checkbox" checked={showKeys} onChange={(e) => setShowKeys(e.target.checked)} />
                Show every answer key
              </label>
            </>
          )}
        </div>

        {shown.length === 0 ? (
          <Empty icon="search" title="Nothing here" action={<Button onClick={() => { setFilter('all'); setQuery(''); }}>Clear the filter</Button>}>
            {needle ? `Nothing in the bank mentions "${query.trim()}".` : 'No questions at that level yet. Plan another run weighted towards it, or pick a different filter.'}
          </Empty>
        ) : (
          <ul className="qlist">
            {shown.map((q) => {
              const kind = q.kind ?? 'mcq';
              const rowBusy = working.startsWith(`${q._id}:`);
              const isOpen = showKeys || opened.has(q._id);
              const off = q.status === 'discarded';
              return (
                <li key={q._id} className="q" data-off={off ? 'true' : undefined} data-picked={picked.has(q._id) ? 'true' : undefined}>
                  <div className="q-row">
                    <label className="q-pick">
                      <input type="checkbox" checked={picked.has(q._id)} onChange={() => toggle(q._id)} aria-label={`Tick: ${q.text}`} />
                    </label>
                    <button
                      type="button"
                      className="q-main"
                      aria-expanded={isOpen}
                      onClick={() => setOpened((prev) => { const next = new Set(prev); if (next.has(q._id)) next.delete(q._id); else next.add(q._id); return next; })}
                    >
                      <span className="q-meta">
                        <Level level={q.bloom} />
                        <Chip>{KIND_LABEL[kind] ?? kind}</Chip>
                        {q.topic && <span className="t-meta clip">{q.topic}</span>}
                        {q.source === 'fallback' && <Chip className="chip-line">offline template</Chip>}
                      </span>
                      <span className="q-text">{q.text}</span>
                    </button>
                    <span className="q-acts">
                      {off ? (
                        <Button size="sm" icon="undo" busy={working === `${q._id}:restore`} disabled={rowBusy} onClick={() => act(q._id, 'restore', () => api.restoreQuestion(q._id))}>Restore</Button>
                      ) : (
                        <>
                          <Tip label="Edit"><Button variant="ghost" size="sm" icon="edit" aria-label="Edit this question" disabled={rowBusy} onClick={() => setEditing(q._id)} /></Tip>
                          <Tip label="Rewrite it"><Button variant="ghost" size="sm" icon="refresh" aria-label="Rewrite this question" busy={working === `${q._id}:regen`} disabled={rowBusy} onClick={() => act(q._id, 'regen', () => api.regenerateQuestion(q._id))} /></Tip>
                          <Tip label="Discard"><Button variant="ghost" size="sm" icon="trash" aria-label="Discard this question" busy={working === `${q._id}:discard`} disabled={rowBusy} onClick={() => act(q._id, 'discard', () => api.discardQuestion(q._id))} /></Tip>
                        </>
                      )}
                      <Icon name="chevron" className="q-chev muted" />
                    </span>
                  </div>
                  {isOpen && <div className="q-key"><AnswerKey q={q} /></div>}
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
