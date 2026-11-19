/**
 * A class's course outcomes (Phase 4): the class page's Outcomes tab.
 *
 *   the list       the outcomes in the class's order, archived ones after and
 *                  marked; add, edit, reorder, remove, restore
 *   an editor      opens under one outcome: its code, statement and target
 *                  level, and the topics mapped to it with their weights
 *   coverage       approved questions and counted answers per outcome and
 *                  topic, the answers that reach no outcome, and the check that
 *                  mapped + excluded + unmapped = counted
 *   one by one     questions mapped straight to outcomes in this class, or kept
 *                  out of every outcome (overrides)
 *   copy, CSV      outcomes copied from another class; the list as a sheet
 *
 * Staff only. Nothing here names a student: coverage counts them. Teacher
 * records are never mapped or counted, and nothing here offers to. Who may
 * change what is the server's `canEdit` (an HOD reads only); every refusal and
 * every summary is the server's sentence, shown as it comes.
 *
 * The container at the foot reads and writes. Everything above it draws only
 * what it is handed, which is what lets dev/outcomes.gallery.jsx draw every
 * state from sample data.
 *
 *   <Outcomes classId />                      the tab (container)
 *   <OutcomesView data coverage source on />  the view
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { api } from '../lib/api.js';
import { LABEL, LEVELS } from '../lib/bloom.js';
import { KIND_LABEL } from '../lib/kinds.js';
import { useViewer } from '../shell/viewer.js';
import { Button, Chip, Dialog, Empty, Field, Icon, Level, Menu, Note, Segmented, Tip } from '../ui/index.jsx';

/* ----------------------------------------------------------------- helpers */

const list = (v) => (Array.isArray(v) ? v : []);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const count = (n, one, many = `${one}s`) => `${num(n).toLocaleString()} ${num(n) === 1 ? one : many}`;
/** Topics are one topic whatever their case or spacing, as the server compares them. */
const keyOf = (topic) => String(topic ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const linkKey = (contentId, topic) => `${String(contentId ?? '').toLowerCase()}|${keyOf(topic)}`;
const weightOf = (w) => (num(w) > 0 ? num(w) : 1);

// A topic name the chapter's list no longer holds.
const RENAMED_UNMAPPED = 'Renamed or no longer in the chapter: map the old name to keep this evidence.';
const RENAMED_MAPPED = 'Renamed or no longer in the chapter: this old name is mapped, so the answers given under it still reach this outcome.';

const STATUS = { draft: 'Draft', discarded: 'Discarded', rejected: 'Rejected' };

// The coverage definitions, under names a reader knows them by. Their text is the server's.
const DEFINED = [
  ['answers', 'Counted answers'],
  ['questions', 'Questions'],
  ['resolution', 'How an answer reaches an outcome'],
  ['topics', 'Topics'],
  ['renamedTopics', 'Renamed topics'],
  ['weights', 'Weights'],
  ['archived', 'Archived outcomes'],
  ['evidence', 'Evidence'],
];

/** The list fields of a reply: every write answers the whole list again. */
export function listOf(res) {
  return {
    class: res?.class ?? null,
    canEdit: res?.canEdit === true,
    outcomes: list(res?.outcomes),
    overrides: list(res?.overrides),
    limits: res?.limits ?? {},
    privacy: res?.privacy ?? '',
  };
}

/** The topics a chapter offers: its own list, then the topics its questions carry. */
function topicsOf(chapter) {
  const byKey = new Map();
  for (const t of list(chapter?.topics)) {
    const k = keyOf(t);
    if (k && !byKey.has(k)) byKey.set(k, { topic: String(t).trim(), questions: 0, inList: true });
  }
  for (const q of list(chapter?.questions)) {
    const k = keyOf(q.topic);
    if (!k) continue;
    if (!byKey.has(k)) byKey.set(k, { topic: String(q.topic).trim(), questions: 0, inList: false });
    if (q.status === 'active') byKey.get(k).questions += 1;
  }
  return [...byKey.values()];
}

/* --------------------------------------------------------------- skeleton */

function Skeleton() {
  return (
    <div className="stack stack-5" aria-busy="true" aria-label="Reading the course outcomes">
      <div className="card oc-skel">
        <div className="skel" style={{ height: 14, width: 160 }} />
        <div className="skel" style={{ height: 11, width: '44%' }} />
        {[0, 1, 2].map((i) => (
          <div key={i} className="oc-skel-row">
            <div className="skel" style={{ width: 46, height: 24, borderRadius: 6 }} />
            <div className="stack stack-2 grow">
              <div className="skel" style={{ height: 13, width: `${62 - i * 9}%` }} />
              <div className="skel" style={{ height: 11, width: '30%' }} />
            </div>
          </div>
        ))}
      </div>
      <div className="card oc-skel">
        <div className="skel" style={{ height: 14, width: 120 }} />
        <div className="skel" style={{ height: 64 }} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- the details */

function DetailsForm({ initial, limits, submitLabel, onSubmit, onCancel }) {
  const id = useId();
  const [code, setCode] = useState(initial?.code ?? '');
  const [statement, setStatement] = useState(initial?.statement ?? '');
  const [level, setLevel] = useState(initial?.targetLevel ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const maxCode = limits?.code ?? 16;
  const maxStatement = limits?.statement ?? 300;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSubmit({ code, statement, targetLevel: level || null });
    } catch (err) {
      setError(err.message || 'The server refused that.');
      setBusy(false);
    }
  }

  return (
    <form className="oc-form" onSubmit={submit} onKeyDown={(e) => { if (e.key === 'Escape' && !busy) { e.stopPropagation(); onCancel(); } }}>
      <div className="oc-form-pair">
        <Field label="Code" htmlFor={`${id}-code`} hint={`Up to ${maxCode} characters, such as CO1.`}>
          <input
            id={`${id}-code`}
            className="input input-code"
            value={code}
            maxLength={maxCode}
            required
            autoFocus
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setCode(e.target.value)}
          />
        </Field>
        <Field label="Target level" optional htmlFor={`${id}-level`}>
          <select id={`${id}-level`} className="select" value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="">No target level</option>
            {LEVELS.map((l) => <option key={l} value={l}>{LABEL[l]}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Statement" htmlFor={`${id}-st`} hint={`${statement.length} of ${maxStatement} characters`}>
        <textarea
          id={`${id}-st`}
          className="textarea oc-statement"
          rows={3}
          value={statement}
          maxLength={maxStatement}
          required
          placeholder="What a student who has met it can do"
          onChange={(e) => setStatement(e.target.value)}
        />
      </Field>
      {error && <Note tone="bad" role="alert">{error}</Note>}
      <div className="cluster">
        <Button type="submit" variant="primary" busy={busy}>{submitLabel}</Button>
        <Button variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------- the topics */

/** A chapter and its topics, as checkboxes: ticked is mapped. */
function TopicPicker({ source, chapterId, onChapter, mapped, onToggle }) {
  const id = useId();
  const [chapters, setChapters] = useState(null);
  const [chaptersError, setChaptersError] = useState('');
  const [chapter, setChapter] = useState({ id: '', data: null, error: '' });
  const [q, setQ] = useState('');
  const [more, setMore] = useState(false);

  useEffect(() => {
    let alive = true;
    source.chapters().then(
      (rows) => { if (alive) setChapters(list(rows)); },
      (err) => { if (alive) setChaptersError(err.message || 'The chapters did not load.'); },
    );
    return () => { alive = false; };
  }, [source]);

  useEffect(() => {
    if (!chapterId) return undefined;
    let alive = true;
    setChapter({ id: chapterId, data: null, error: '' });
    setQ('');
    setMore(false);
    source.chapter(chapterId).then(
      (data) => { if (alive) setChapter({ id: chapterId, data, error: '' }); },
      (err) => { if (alive) setChapter({ id: chapterId, data: null, error: err.message || 'That chapter did not load.' }); },
    );
    return () => { alive = false; };
  }, [source, chapterId]);

  const topics = useMemo(() => topicsOf(chapter.data), [chapter.data]);
  const needle = keyOf(q);
  const shown = needle ? topics.filter((t) => keyOf(t.topic).includes(needle)) : topics;
  const asked = shown.filter((t) => t.questions > 0);
  const rest = shown.filter((t) => t.questions === 0);
  const title = chapter.data?.title || chapters?.find((c) => c.id === chapterId)?.title || '';

  const row = (t) => {
    const on = mapped.has(linkKey(chapterId, t.topic));
    return (
      <li key={keyOf(t.topic)}>
        <label className="check oc-pick">
          <input
            type="checkbox"
            checked={on}
            aria-label={`${t.topic}: ${t.questions > 0 ? count(t.questions, 'approved question') : 'no approved question'}`}
            onChange={() => onToggle({ contentId: chapterId, chapter: title, topic: t.topic })}
          />
          <span className="oc-pick-t">{t.topic}</span>
          <span className="oc-pick-n">{t.questions > 0 ? count(t.questions, 'approved question') : 'No approved question'}</span>
        </label>
      </li>
    );
  };

  return (
    <div className="oc-picker">
      <Field label="Add topics from a chapter" htmlFor={`${id}-ch`}>
        {chaptersError ? (
          <Note tone="bad" role="alert">{chaptersError}</Note>
        ) : (
          <select id={`${id}-ch`} className="select" value={chapterId} disabled={!chapters} onChange={(e) => onChapter(e.target.value)}>
            <option value="">{chapters ? 'Choose a chapter' : 'Reading the chapters'}</option>
            {list(chapters).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        )}
      </Field>

      {chapterId && chapter.error && <Note tone="bad" role="alert">{chapter.error}</Note>}
      {chapterId && !chapter.data && !chapter.error && (
        <div className="stack stack-2" aria-busy="true">
          {[0, 1, 2].map((i) => <div key={i} className="skel" style={{ height: 30 }} />)}
        </div>
      )}
      {chapter.data && (
        <div className="oc-pick-box">
          {topics.length > 8 && (
            <label className="search oc-pick-search">
              <Icon name="search" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a topic" aria-label="Find a topic in this chapter" />
            </label>
          )}
          {topics.length === 0 && <p className="oc-quiet">This chapter has no topics yet.</p>}
          {topics.length > 0 && shown.length === 0 && <p className="oc-quiet">No topic of this chapter matches “{q.trim()}”.</p>}
          {asked.length > 0 && <ul className="oc-picks" aria-label={`Topics of ${title} with approved questions`}>{asked.map(row)}</ul>}
          {rest.length > 0 && (asked.length === 0 || more || needle) ? (
            <ul className="oc-picks" aria-label={`Other topics in the list of ${title}`}>{rest.map(row)}</ul>
          ) : rest.length > 0 && (
            <button type="button" className="oc-fold" aria-expanded="false" onClick={() => setMore(true)}>
              <Icon name="chevron" size={14} />
              Show the other {count(rest.length, 'topic')} in the chapter’s list
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const draftOf = (topics) => list(topics).map((t) => ({
  contentId: t.contentId, chapter: t.chapter, topic: t.topic, inChapter: t.inChapter, weight: String(weightOf(t.weight)),
}));
const signOf = (rows) => JSON.stringify(rows.map((t) => [String(t.contentId).toLowerCase(), keyOf(t.topic), String(t.weight).trim()]));

/** The topics mapped to one outcome. Saved as a whole set: what is not here is not mapped. */
function TopicsEditor({ o, limits, source, onSave, start }) {
  const id = useId();
  const saved = useMemo(() => draftOf(o.topics), [o.topics]);
  const savedSign = signOf(saved);
  const [draft, setDraft] = useState(saved);
  const [chapterId, setChapterId] = useState(start?.chapter ?? saved[0]?.contentId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(start?.mapError ?? '');
  const [done, setDone] = useState('');

  // A new reading of the same mapping (any write elsewhere) keeps the draft;
  // a changed one replaces it.
  useEffect(() => { setDraft(draftOf(o.topics)); }, [savedSign]); // eslint-disable-line react-hooks/exhaustive-deps

  const mapped = useMemo(() => new Set(draft.map((t) => linkKey(t.contentId, t.topic))), [draft]);
  const dirty = signOf(draft) !== savedSign;
  const max = limits?.topicsPerOutcome ?? 100;
  const maxWeight = limits?.weight ?? 100;

  function toggle(t) {
    setDone('');
    setError('');
    const k = linkKey(t.contentId, t.topic);
    setDraft((d) => (d.some((x) => linkKey(x.contentId, x.topic) === k)
      ? d.filter((x) => linkKey(x.contentId, x.topic) !== k)
      : [...d, { ...t, inChapter: true, weight: '1' }]));
  }

  async function save() {
    setBusy(true);
    setError('');
    setDone('');
    try {
      const res = await onSave(draft.map((t) => {
        const w = String(t.weight).trim();
        return { contentId: t.contentId, topic: t.topic, ...(w === '' ? {} : { weight: Number(w) }) };
      }));
      // As the server stored them: its spelling of each topic, its weights.
      if (res?.outcome) setDraft(draftOf(res.outcome.topics));
      setDone(draft.length ? `Saved: ${o.code} is mapped to ${count(draft.length, 'topic')}.` : `Saved: no topic is mapped to ${o.code}.`);
    } catch (err) {
      setError(err.message || 'The server refused that.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="oc-topics">
      <div className="oc-topics-head">
        <span className="oc-k">Mapped to {o.code}</span>
        <span className="t-meta">{draft.length} of at most {max}</span>
      </div>
      {draft.length === 0 ? (
        <p className="oc-quiet">No topic is mapped. Tick topics from a chapter below; their answers then reach {o.code}.</p>
      ) : (
        <ul className="oc-maps" aria-label={`Topics mapped to ${o.code}`}>
          {draft.map((t, i) => (
            <li key={linkKey(t.contentId, t.topic)} className="oc-map">
              <div className="oc-map-t">
                <b>{t.topic}</b>
                <small className="clip" title={t.chapter}>{t.chapter || 'Chapter'}</small>
                {t.inChapter === false && <span className="oc-renamed"><Icon name="alert" size={14} />{RENAMED_MAPPED}</span>}
              </div>
              <label className="oc-weight" htmlFor={`${id}-w${i}`}>
                <span>Weight</span>
                <input
                  id={`${id}-w${i}`}
                  aria-label={`Weight of ${t.topic}`}
                  type="number"
                  inputMode="decimal"
                  className="input input-sm"
                  min="0.001"
                  max={maxWeight}
                  step="any"
                  value={t.weight}
                  onChange={(e) => { const v = e.target.value; setDone(''); setDraft((d) => d.map((x, j) => (j === i ? { ...x, weight: v } : x))); }}
                />
              </label>
              <Tip label="Take this topic off">
                <Button size="sm" variant="ghost" icon="close" aria-label={`Take ${t.topic} off ${o.code}`} onClick={() => toggle(t)} />
              </Tip>
            </li>
          ))}
        </ul>
      )}
      <p className="oc-hint">A weight says how much a topic’s answers count beside {o.code}’s other topics in the attainment report: 1 unless set, at most {maxWeight}.</p>

      <TopicPicker source={source} chapterId={chapterId} onChapter={setChapterId} mapped={mapped} onToggle={toggle} />

      {error && <Note tone="bad" role="alert" className="oc-err">{error}</Note>}
      {done && !dirty && <Note tone="ok" role="status">{done}</Note>}
      <div className="cluster">
        <Button variant="primary" busy={busy} disabled={!dirty} onClick={save}>Save the topics</Button>
        {dirty && <Button variant="ghost" disabled={busy} onClick={() => { setDraft(saved); setError(''); }}>Undo changes</Button>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- one outcome */

function topicLine(o) {
  const topics = list(o.topics);
  if (!topics.length) return 'No topic mapped yet';
  const named = topics.slice(0, 3).map((t) => (weightOf(t.weight) !== 1 ? `${t.topic} (weight ${weightOf(t.weight)})` : t.topic));
  return `${named.join(' · ')}${topics.length > 3 ? ` · and ${topics.length - 3} more` : ''}`;
}

function OutcomeEditor({ o, limits, source, on, start, firstTab = 'details', onClose }) {
  const [tab, setTab] = useState(start?.tab ?? firstTab);
  return (
    <div className="oc-editor" role="region" aria-label={`Change ${o.code}`}>
      <div className="oc-editor-top">
        <Segmented
          label={`What to change on ${o.code}`}
          value={tab}
          onChange={setTab}
          options={[{ id: 'details', label: 'Details' }, { id: 'topics', label: 'Topics', count: list(o.topics).length }]}
        />
      </div>
      <div>
        {tab === 'details' ? (
          <DetailsForm
            initial={o}
            limits={limits}
            submitLabel="Save the details"
            onCancel={onClose}
            onSubmit={async (fields) => {
              const patch = {};
              if (fields.code !== o.code) patch.code = fields.code;
              if (fields.statement !== o.statement) patch.statement = fields.statement;
              if ((fields.targetLevel ?? null) !== (o.targetLevel ?? null)) patch.targetLevel = fields.targetLevel;
              if (Object.keys(patch).length) await on.update(o.id, patch);
              onClose();
            }}
          />
        ) : (
          <TopicsEditor o={o} limits={limits} source={source} start={start} onSave={(topics) => on.mapTopics(o.id, topics)} />
        )}
      </div>
    </div>
  );
}

function OutcomeRow({ o, index, total, canEdit, direct, open, busy, error, onOpen, onClose, onMove, onRemove, onRestore, children }) {
  const renamed = list(o.topics).filter((t) => t.inChapter === false).length;
  return (
    <li className="oc-row" data-archived={o.archived ? 'true' : undefined} data-open={open ? 'true' : undefined} aria-busy={busy || undefined}>
      <div className="oc-row-line">
        <span className="oc-code">{o.code}</span>
        <div className="oc-main">
          <p className="oc-stmt">{o.statement}</p>
          <div className="oc-sub">
            {o.targetLevel
              ? <span className="oc-target"><span className="oc-k">Target</span><Level level={o.targetLevel} /></span>
              : <span className="oc-k">No target level</span>}
            <span className="oc-topicline">{topicLine(o)}</span>
            {direct > 0 && <span className="oc-direct">{count(direct, 'question')} mapped one by one</span>}
            {renamed > 0 && <span className="oc-flag"><Icon name="alert" size={13} />{count(renamed, 'topic')} renamed or no longer in the chapter</span>}
          </div>
        </div>
        {canEdit && (
          <div className="oc-acts">
            {o.archived ? (
              <Button size="sm" icon="undo" busy={busy} onClick={onRestore} aria-label={`Restore ${o.code}`}>Restore</Button>
            ) : (
              <>
                <span className="oc-move">
                  <Tip label="Move up">
                    <Button size="sm" variant="ghost" icon="up" data-move={`${o.id}-up`} disabled={busy || index === 0} onClick={() => onMove(-1)} aria-label={`Move ${o.code} up`} />
                  </Tip>
                  <Tip label="Move down">
                    <Button size="sm" variant="ghost" icon="down" data-move={`${o.id}-down`} disabled={busy || index === total - 1} onClick={() => onMove(1)} aria-label={`Move ${o.code} down`} />
                  </Tip>
                </span>
                <Button size="sm" icon="edit" aria-expanded={open} onClick={open ? onClose : onOpen} aria-label={`${open ? 'Close' : 'Change'} ${o.code}`}>
                  {open ? 'Close' : 'Change'}
                </Button>
                <Menu
                  items={[
                    { id: 'remove', label: `Remove ${o.code}`, icon: 'trash', danger: true, onSelect: () => setTimeout(onRemove, 0) },
                    { heading: 'Archived if any answer reaches it, deleted if none does.' },
                  ]}
                  trigger={<Button size="sm" variant="ghost" icon="more" disabled={busy} aria-label={`More for ${o.code}`} />}
                />
              </>
            )}
          </div>
        )}
      </div>
      {error && <p className="oc-row-err" role="alert">{error}</p>}
      {children}
    </li>
  );
}

/* ------------------------------------------------------------------ dialogs */

function RemoveDialog({ o, onOpenChange, onRemove }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setError(''); setBusy(false); }, [o?.id]);
  async function go() {
    setBusy(true);
    setError('');
    try {
      await onRemove(o);
      onOpenChange(false);
    } catch (err) {
      setError(err.message || 'The server refused that.');
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={Boolean(o)}
      onOpenChange={onOpenChange}
      locked={busy}
      title={o ? `Remove ${o.code}?` : 'Remove'}
      description="If any counted answer from this class’s rooms reaches it, it is archived: its mappings and evidence are kept and reports still name it. If none does, it is deleted with its topic mappings."
      footer={(
        <>
          <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>Keep it</Button>
          <Button variant="primary" className="btn-danger" icon="trash" busy={busy} onClick={go}>Remove {o?.code}</Button>
        </>
      )}
    >
      {o && <p className="oc-dlg-stmt"><span className="oc-code">{o.code}</span>{o.statement}</p>}
      {error && <Note tone="bad" role="alert">{error}</Note>}
    </Dialog>
  );
}

function CopyResult({ result }) {
  const copied = result?.copied ?? {};
  const skipped = result?.skipped ?? {};
  const topics = list(skipped.topics);
  const overrides = list(skipped.overrides);
  const from = result?.from;
  return (
    <div className="stack stack-3">
      {result?.message && <Note tone="ok" role="status">{result.message}</Note>}
      {from && (
        <p className="t-meta">
          From {[from.courseName, from.section, from.termLabel].filter(Boolean).join(' · ')}
        </p>
      )}
      <div className="oc-figs">
        <div><b>{num(copied.outcomes)}</b><span>{num(copied.outcomes) === 1 ? 'outcome' : 'outcomes'} copied</span></div>
        <div><b>{num(copied.topics)}</b><span>topic {num(copied.topics) === 1 ? 'mapping' : 'mappings'}</span></div>
        <div><b>{num(copied.overrides)}</b><span>{num(copied.overrides) === 1 ? 'question' : 'questions'} mapped one by one</span></div>
      </div>
      {(num(skipped.archivedOutcomes) > 0 || topics.length > 0 || overrides.length > 0) && (
        <div className="stack stack-2">
          <span className="oc-k">Not copied</span>
          <ul className="oc-skipped">
            {num(skipped.archivedOutcomes) > 0 && <li>{count(skipped.archivedOutcomes, 'archived outcome')}: archived outcomes are not copied.</li>}
            {topics.map((t, i) => <li key={`t${i}`}><b className="mono">{t.code}</b> {t.topic}: {t.reason}</li>)}
            {overrides.map((v, i) => <li key={`o${i}`}>A question mapped one by one: {v.reason}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function CopyDialog({ open, onOpenChange, classId, source, onCopy, start }) {
  const id = useId();
  const [classes, setClasses] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [from, setFrom] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(start && typeof start === 'object' ? start : null);

  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    setLoadError('');
    source.classes().then(
      (rows) => { if (alive) setClasses(list(rows).filter((c) => String(c.id) !== String(classId))); },
      (err) => { if (alive) setLoadError(err.message || 'The classes did not load.'); },
    );
    return () => { alive = false; };
  }, [open, source, classId]);

  function close(v) {
    onOpenChange(v);
    if (!v) { setResult(null); setError(''); setFrom(''); }
  }

  async function go() {
    setBusy(true);
    setError('');
    try {
      setResult(await onCopy(from));
    } catch (err) {
      setError(err.message || 'The server refused that.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      locked={busy}
      title="Copy outcomes from another class"
      description={result ? undefined : 'Its outcomes in use are added after this class’s own, with their topic mappings and the questions mapped one by one. They are new rows: nothing stays linked.'}
      footer={result ? (
        <Button variant="primary" onClick={() => close(false)}>Done</Button>
      ) : (
        <>
          <Button variant="ghost" disabled={busy} onClick={() => close(false)}>Cancel</Button>
          <Button variant="primary" icon="copy" busy={busy} disabled={!from} onClick={go}>Copy the outcomes</Button>
        </>
      )}
    >
      {result ? <CopyResult result={result} /> : (
        <div className="stack stack-3">
          {loadError ? <Note tone="bad" role="alert">{loadError}</Note> : (
            <Field label="Copy from" htmlFor={`${id}-from`} hint={classes && classes.length === 0 ? 'There is no other class you may read.' : 'Any class you may read.'}>
              <select id={`${id}-from`} className="select" value={from} disabled={!classes || classes.length === 0} onChange={(e) => setFrom(e.target.value)}>
                <option value="">{classes ? 'Choose a class' : 'Reading your classes'}</option>
                {list(classes).map((c) => (
                  <option key={c.id} value={c.id}>{[c.courseName, c.section, c.termLabel].filter(Boolean).join(' · ')}</option>
                ))}
              </select>
            </Field>
          )}
          {error && <Note tone="bad" role="alert">{error}</Note>}
        </div>
      )}
    </Dialog>
  );
}

/* ------------------------------------------------------------- the list */

function OutcomeList({ data, canEdit, source, on, start, classId }) {
  const outcomes = list(data.outcomes);
  const active = outcomes.filter((o) => !o.archived);
  const archived = outcomes.filter((o) => o.archived);
  const limits = data.limits ?? {};
  const directOf = useMemo(() => {
    const m = new Map();
    for (const ov of list(data.overrides)) for (const x of list(ov.outcomes)) m.set(x.id, (m.get(x.id) ?? 0) + 1);
    return m;
  }, [data.overrides]);

  const [open, setOpen] = useState(start?.editing ?? null);
  // A new outcome opens on its topics, the next thing it needs.
  const [openTab, setOpenTab] = useState('details');
  const [adding, setAdding] = useState(Boolean(start?.adding));
  const [busyId, setBusyId] = useState(null);
  const [rowError, setRowError] = useState(start?.rowError ?? { id: null, message: '' });
  const [notice, setNotice] = useState(start?.notice ?? '');
  const [removing, setRemoving] = useState(null);
  const [copying, setCopying] = useState(Boolean(start?.copy));
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState({ tone: '', text: '' });

  // An outcome that has gone (deleted, or a fresh reading without it) closes its editor.
  useEffect(() => {
    if (open && !active.some((o) => o.id === open)) setOpen(null);
  }, [open, active]);

  const fail = (id, err) => setRowError({ id, message: err.message || 'The server refused that.' });

  async function move(o, dir) {
    const ids = active.map((x) => x.id);
    const at = ids.indexOf(o.id);
    const to = at + dir;
    if (to < 0 || to >= ids.length) return;
    [ids[at], ids[to]] = [ids[to], ids[at]];
    setBusyId(o.id);
    setRowError({ id: null, message: '' });
    try {
      await on.reorder(ids);
    } catch (err) {
      fail(o.id, err);
    } finally {
      setBusyId(null);
      // The buttons were disabled while it moved, which drops focus: put the
      // keyboard back on the one pressed, or on its pair at an end of the list.
      setTimeout(() => {
        const btn = document.querySelector(`[data-move="${o.id}-${dir < 0 ? 'up' : 'down'}"]`);
        const pair = document.querySelector(`[data-move="${o.id}-${dir < 0 ? 'down' : 'up'}"]`);
        (btn && !btn.disabled ? btn : pair)?.focus();
      }, 0);
    }
  }

  async function restore(o) {
    setBusyId(o.id);
    setRowError({ id: null, message: '' });
    setNotice('');
    try {
      await on.restore(o.id);
      setNotice(`${o.code} is back in use, last in the order.`);
    } catch (err) {
      fail(o.id, err);
    } finally {
      setBusyId(null);
    }
  }

  async function exportCsv() {
    setExporting(true);
    setExported({ tone: '', text: '' });
    try {
      const name = await on.exportCsv();
      setExported({ tone: 'ok', text: name ? `Saved ${name}.` : 'Saved.' });
    } catch (err) {
      setExported({ tone: 'bad', text: err.message || 'The file did not download.' });
    } finally {
      setExporting(false);
    }
  }

  const rowOf = (o, i, set) => (
    <OutcomeRow
      key={o.id}
      o={o}
      index={i}
      total={set.length}
      canEdit={canEdit}
      direct={directOf.get(o.id) ?? 0}
      open={open === o.id}
      busy={busyId === o.id}
      error={rowError.id === o.id ? rowError.message : ''}
      onOpen={() => { setOpen(o.id); setOpenTab('details'); setAdding(false); setNotice(''); }}
      onClose={() => setOpen(null)}
      onMove={(dir) => move(o, dir)}
      onRemove={() => { setNotice(''); setRemoving(o); }}
      onRestore={() => restore(o)}
    >
      {open === o.id && canEdit && !o.archived && (
        <OutcomeEditor
          o={o}
          limits={limits}
          source={source}
          on={on}
          start={start?.editing === o.id ? start : null}
          firstTab={openTab}
          onClose={() => setOpen(null)}
        />
      )}
    </OutcomeRow>
  );

  return (
    <section className="card ac-card oc-card" aria-labelledby="oc-list-h">
      <div className="ac-head">
        <div className="sec">
          <h2 id="oc-list-h">Course outcomes</h2>
          <p>What a student of this course should be able to do, in the order they are taught. Answers reach an outcome through the topics mapped to it.</p>
        </div>
        <div className="oc-head-acts">
          {!canEdit && <span className="oc-ro"><Icon name="eye" />Read only</span>}
          <Button icon="download" busy={exporting} onClick={exportCsv}>Export CSV</Button>
          {canEdit && <Button icon="copy" onClick={() => setCopying(true)}>Copy from a class</Button>}
          {canEdit && outcomes.length > 0 && (
            <Button variant="primary" icon="plus" onClick={() => { setAdding(true); setOpen(null); setNotice(''); }}>Add an outcome</Button>
          )}
        </div>
      </div>

      {(notice || exported.text) && (
        <div className="oc-notes">
          {notice && <Note tone="ok" role="status">{notice}</Note>}
          {exported.text && <Note tone={exported.tone} role={exported.tone === 'bad' ? 'alert' : 'status'}>{exported.text}</Note>}
        </div>
      )}

      {outcomes.length === 0 && !adding ? (
        <div className="oc-empty">
          <span className="oc-empty-ic" aria-hidden="true"><Icon name="target" size={18} /></span>
          <div className="stack stack-1">
            <b>No course outcomes yet</b>
            <span className="t-small muted">
              {canEdit
                ? 'Add the outcomes this course is assessed against, or copy them from another class with their mappings. Until then no answer reaches an outcome.'
                : 'The professor who keeps this class has not added any yet.'}
            </span>
          </div>
          {canEdit && (
            <span className="cluster">
              <Button icon="copy" onClick={() => setCopying(true)}>Copy from a class</Button>
              <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Add an outcome</Button>
            </span>
          )}
        </div>
      ) : (
        <>
          <div className="oc-count">
            <span>{active.length} of {limits.outcomes ?? 50} in use</span>
            {archived.length > 0 && <span>{count(archived.length, 'archived')}</span>}
          </div>
          {active.length > 0 && <ol className="oc-rows" aria-label="Course outcomes in use, in order">{active.map((o, i) => rowOf(o, i, active))}</ol>}
          {adding && canEdit && (
            <div className="oc-adding">
              <span className="oc-k">A new outcome, last in the order</span>
              <DetailsForm
                limits={limits}
                submitLabel="Add the outcome"
                onCancel={() => setAdding(false)}
                onSubmit={async (fields) => {
                  const res = await on.create({ code: fields.code, statement: fields.statement, ...(fields.targetLevel ? { targetLevel: fields.targetLevel } : {}) });
                  setAdding(false);
                  if (res?.outcome?.id) { setOpenTab('topics'); setOpen(res.outcome.id); }
                }}
              />
            </div>
          )}
          {archived.length > 0 && (
            <div className="oc-archived">
              <div className="oc-archived-h">
                <span className="oc-k">Archived</span>
                <p>Kept with their mappings, so their evidence is still traced to them and reports still name them.{canEdit ? ' Restore one to use it again.' : ''}</p>
              </div>
              <ul className="oc-rows" aria-label="Archived course outcomes">{archived.map((o, i) => rowOf(o, i, archived))}</ul>
            </div>
          )}
        </>
      )}

      {canEdit && (
        <>
          <RemoveDialog
            o={removing}
            onOpenChange={(v) => { if (!v) setRemoving(null); }}
            onRemove={async (o) => {
              const res = await on.remove(o.id);
              if (open === o.id) setOpen(null);
              setNotice(res?.message || `${o.code} was removed.`);
            }}
          />
          <CopyDialog
            open={copying}
            onOpenChange={setCopying}
            classId={classId}
            source={source}
            onCopy={on.copy}
            start={start?.copy}
          />
        </>
      )}
    </section>
  );
}

/* --------------------------------------------------------------- coverage */

function Renamed() {
  return <span className="oc-renamed"><Icon name="alert" size={14} />{RENAMED_UNMAPPED}</span>;
}

function CoverageSkeleton() {
  return (
    <div className="oc-pad" aria-busy="true" aria-label="Counting the coverage">
      <div className="skel" style={{ height: 70, marginBottom: 14 }} />
      {[0, 1, 2].map((i) => <div key={i} className="skel" style={{ height: 34, marginBottom: 8 }} />)}
    </div>
  );
}

function Coverage({ coverage, outcomesInUse, canEdit, on }) {
  const c = coverage?.data;
  const [mapping, setMapping] = useState(null);
  const [mapError, setMapError] = useState('');
  const [mapped, setMapped] = useState('');
  const [defs, setDefs] = useState(false);

  async function mapTo(o, u) {
    const k = linkKey(u.contentId, u.topic);
    setMapping(k);
    setMapError('');
    setMapped('');
    try {
      await on.mapTopics(o.id, [
        ...list(o.topics).map((t) => ({ contentId: t.contentId, topic: t.topic, weight: weightOf(t.weight) })),
        { contentId: u.contentId, topic: u.topic },
      ]);
      setMapped(`${u.topic} is now mapped to ${o.code}.`);
    } catch (err) {
      setMapError(err.message || 'The server refused that.');
    } finally {
      setMapping(null);
    }
  }

  const head = (
    <div className="ac-head">
      <div className="sec">
        <h2 id="oc-cov-h">Coverage</h2>
        <p>Approved questions and counted answers that reach each outcome. Counts only: attainment is worked out in its own tab.</p>
      </div>
      {c?.rooms && (
        <span className="t-meta oc-rooms">
          {num(c.rooms.counted) === 0 ? 'No room yet' : `Over ${count(c.rooms.counted, 'room')}`}
          {list(c.rooms.codes).length > 0 && <span className="mono"> {list(c.rooms.codes).join(' · ')}</span>}
        </span>
      )}
    </div>
  );

  if (!c) {
    return (
      <section className="card ac-card oc-card" aria-labelledby="oc-cov-h" aria-busy={coverage?.loading || undefined}>
        {head}
        {coverage?.error ? (
          <div className="oc-pad stack stack-3">
            <Note tone="bad" role="alert">{coverage.error}</Note>
            <Button icon="refresh" onClick={on.reloadCoverage}>Count again</Button>
          </div>
        ) : <CoverageSkeleton />}
      </section>
    );
  }

  const a = c.answers ?? {};
  const outcomes = list(c.outcomes);
  const unmapped = list(c.unmapped);
  const excluded = c.excluded ?? {};
  const definitions = c.definitions ?? {};
  const defined = DEFINED.filter(([k]) => definitions[k]).concat(
    Object.keys(definitions).filter((k) => !DEFINED.some(([d]) => d === k)).map((k) => [k, k]),
  );

  return (
    <section className="card ac-card oc-card" aria-labelledby="oc-cov-h" aria-busy={coverage.loading || undefined}>
      {head}
      {coverage.error && <div className="oc-pad-x"><Note tone="bad" role="alert">The coverage below is the last one counted: {coverage.error}</Note></div>}

      <div className="oc-sum" role="group" aria-label={`${count(a.counted, 'counted answer')}: ${num(a.mapped)} mapped, ${num(a.excluded)} excluded, ${num(a.unmapped)} unmapped`}>
        <div className="oc-sum-cell is-total"><span>Counted answers</span><b>{num(a.counted).toLocaleString()}</b></div>
        <div className="oc-sum-cell"><span>Reach an outcome</span><b><i aria-hidden="true">=</i>{num(a.mapped).toLocaleString()}</b></div>
        <div className="oc-sum-cell"><span>Kept out by an override</span><b><i aria-hidden="true">+</i>{num(a.excluded).toLocaleString()}</b></div>
        <div className="oc-sum-cell" data-some={num(a.unmapped) > 0 ? 'true' : undefined}><span>Reach no outcome</span><b><i aria-hidden="true">+</i>{num(a.unmapped).toLocaleString()}</b></div>
      </div>
      <p className="oc-sum-note">Every counted answer is in exactly one of the three. An answer reaching two outcomes counts under each below, and once here.</p>

      {outcomes.length > 0 && (
        <table className="oc-cov">
          <caption className="sr-only">Approved questions, counted answers and students per outcome and topic</caption>
          <thead>
            <tr>
              <th scope="col">Outcome and topic</th>
              <th scope="col" className="r">Approved questions</th>
              <th scope="col" className="r">Counted answers</th>
              <th scope="col" className="r">Students</th>
            </tr>
          </thead>
          {outcomes.map((o) => (
            <tbody key={o.id} className="oc-cov-o" data-archived={o.archived ? 'true' : undefined} data-evidence={o.evidence}>
              <tr className="oc-cov-orow">
                <th scope="row">
                  <span className="oc-cov-name">
                    <b className="oc-code">{o.code}</b>
                    <span className="oc-cov-what">
                      <span className="oc-cov-line">
                        <span className="oc-cov-stmt clip" title={o.statement}>{o.statement}</span>
                        {o.archived && <Chip className="chip-line oc-arch-chip">Archived</Chip>}
                      </span>
                      {o.summary && <span className="oc-cov-say">{o.summary}</span>}
                    </span>
                  </span>
                </th>
                <td className="r" data-label="Approved questions">{num(o.questions).toLocaleString()}</td>
                <td className="r" data-label="Counted answers">{num(o.answers).toLocaleString()}</td>
                <td className="r" data-label="Students">{num(o.students).toLocaleString()}</td>
              </tr>
              {list(o.topics).map((t) => (
                <tr key={linkKey(t.contentId, t.topic)} className="oc-cov-trow">
                  <th scope="row">
                    <span className="oc-cov-topic">
                      {t.topic}
                      {weightOf(t.weight) !== 1 && <small className="oc-cov-w">weight {weightOf(t.weight)}</small>}
                    </span>
                    <small className="oc-cov-ch clip" title={t.chapter}>{t.chapter}</small>
                    {t.inChapter === false && <span className="oc-renamed"><Icon name="alert" size={14} />{RENAMED_MAPPED}</span>}
                  </th>
                  <td className="r" data-label="Approved questions">{num(t.questions).toLocaleString()}</td>
                  <td className="r" data-label="Counted answers">{num(t.answers).toLocaleString()}</td>
                  <td className="r oc-cov-none" data-label="Students" />
                </tr>
              ))}
              {(num(o.direct?.questions) > 0 || num(o.direct?.answers) > 0) && (
                <tr className="oc-cov-trow">
                  <th scope="row"><span className="oc-cov-topic">Questions mapped one by one</span></th>
                  <td className="r" data-label="Approved questions">{num(o.direct.questions).toLocaleString()}</td>
                  <td className="r" data-label="Counted answers">{num(o.direct.answers).toLocaleString()}</td>
                  <td className="r oc-cov-none" data-label="Students" />
                </tr>
              )}
            </tbody>
          ))}
          {(num(excluded.questions) > 0 || num(excluded.answers) > 0) && (
            <tbody className="oc-cov-o">
              <tr className="oc-cov-orow">
                <th scope="row"><span className="oc-cov-stmt">Kept out of every outcome by an override</span></th>
                <td className="r" data-label="Approved questions">{num(excluded.questions).toLocaleString()}</td>
                <td className="r" data-label="Counted answers">{num(excluded.answers).toLocaleString()}</td>
                <td className="r oc-cov-none" data-label="Students" />
              </tr>
            </tbody>
          )}
        </table>
      )}

      <div className="oc-un">
        <div className="oc-un-h">
          <h3>Reaching no outcome</h3>
          <span className="t-meta">{unmapped.length ? `${count(a.unmapped, 'answer')}, most first` : 'None'}</span>
        </div>
        {(mapError || mapped) && (
          <div className="stack stack-2">
            {mapError && <Note tone="bad" role="alert">{mapError}</Note>}
            {mapped && <Note tone="ok" role="status">{mapped}</Note>}
          </div>
        )}
        {unmapped.length === 0 ? (
          <p className="oc-quiet">Every counted answer reaches an outcome or is kept out by an override.</p>
        ) : (
          <ul className="oc-un-list" aria-label="Topics whose answers reach no outcome">
            {unmapped.map((u) => {
              const k = linkKey(u.contentId, u.topic);
              return (
                <li key={k} className="oc-un-row" data-renamed={u.inChapter === false ? 'true' : undefined}>
                  <div className="oc-un-t">
                    <b>{u.topic || 'No topic'}</b>
                    <small className="clip" title={u.chapter}>{u.chapter}</small>
                    {u.inChapter === false && <Renamed />}
                  </div>
                  <span className="oc-un-n"><b>{num(u.questions).toLocaleString()}</b> {num(u.questions) === 1 ? 'question' : 'questions'}</span>
                  <span className="oc-un-n"><b>{num(u.answers).toLocaleString()}</b> {num(u.answers) === 1 ? 'answer' : 'answers'}</span>
                  {canEdit && outcomesInUse.length > 0 && (
                    <Menu
                      items={[
                        { heading: `Map ${u.topic} to` },
                        ...outcomesInUse.map((o) => ({ id: o.id, label: `${o.code}  ${o.statement.length > 48 ? `${o.statement.slice(0, 48)}…` : o.statement}`, onSelect: () => mapTo(o, u) })),
                      ]}
                      trigger={<Button size="sm" icon="link" busy={mapping === k} aria-label={`Map ${u.topic} to an outcome`}>Map</Button>}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {defined.length > 0 && (
        <div className="oc-defs">
          <button type="button" className="oc-fold" aria-expanded={defs} onClick={() => setDefs((v) => !v)}>
            <Icon name="chevron" size={14} />
            How these are counted
          </button>
          {defs && (
            <dl className="oc-dl">
              {defined.map(([k, label]) => <div key={k}><dt>{label}</dt><dd>{definitions[k]}</dd></div>)}
            </dl>
          )}
        </div>
      )}
    </section>
  );
}

/* ---------------------------------------------------- questions one by one */

function OverrideDialog({ state, onOpenChange, outcomesInUse, overrides, source, onSave }) {
  const id = useId();
  const open = Boolean(state);
  const [chapters, setChapters] = useState(null);
  const [chapterId, setChapterId] = useState('');
  const [chapter, setChapter] = useState({ data: null, error: '' });
  const [q, setQ] = useState('');
  const [chosen, setChosen] = useState(null);
  const [mode, setMode] = useState('outcomes');
  const [picked, setPicked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const inUse = useMemo(() => new Set(outcomesInUse.map((o) => o.id)), [outcomesInUse]);
  const preset = useCallback((questionId) => {
    const ov = overrides.find((x) => x.questionId === questionId);
    setMode(ov?.excluded ? 'exclude' : 'outcomes');
    setPicked(new Set(list(ov?.outcomes).map((x) => x.id).filter((x) => inUse.has(x))));
  }, [overrides, inUse]);

  // Each opening starts clean, or on the question being changed.
  useEffect(() => {
    if (!open) return;
    setError('');
    setBusy(false);
    setQ('');
    if (state.override?.question) {
      const ov = state.override;
      setChosen({ id: ov.questionId, ...ov.question });
      setChapterId(ov.question.contentId ?? '');
      preset(ov.questionId);
    } else {
      setChosen(null);
      setChapterId('');
      setMode('outcomes');
      setPicked(new Set());
    }
  }, [open, state]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || chapters) return undefined;
    let alive = true;
    source.chapters().then((rows) => { if (alive) setChapters(list(rows)); }, (err) => { if (alive) setError(err.message || 'The chapters did not load.'); });
    return () => { alive = false; };
  }, [open, chapters, source]);

  useEffect(() => {
    if (!open || !chapterId) return undefined;
    let alive = true;
    setChapter({ data: null, error: '' });
    source.chapter(chapterId).then(
      (data) => { if (alive) setChapter({ data, error: '' }); },
      (err) => { if (alive) setChapter({ data: null, error: err.message || 'That chapter did not load.' }); },
    );
    return () => { alive = false; };
  }, [open, chapterId, source]);

  const questions = useMemo(() => {
    const all = list(chapter.data?.questions);
    const rank = (x) => (x.status === 'active' ? 0 : 1);
    return [...all].sort((x, y) => rank(x) - rank(y));
  }, [chapter.data]);
  const needle = q.trim().toLowerCase();
  const shown = needle ? questions.filter((x) => `${x.text} ${x.topic}`.toLowerCase().includes(needle)) : questions;
  const ready = chosen && (mode === 'exclude' || picked.size > 0);

  async function save() {
    setBusy(true);
    setError('');
    try {
      await onSave(chosen.id, mode === 'exclude' ? { exclude: true } : { outcomeIds: outcomesInUse.filter((o) => picked.has(o.id)).map((o) => o.id) });
      onOpenChange(false);
    } catch (err) {
      setError(err.message || 'The server refused that.');
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      locked={busy}
      wide
      title={state?.override ? 'Change where this question goes' : 'Map one question'}
      description="In this class only. It holds through edits to the question, and for answers already given once the question is deleted."
      footer={(
        <>
          <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" busy={busy} disabled={!ready} onClick={save}>Save</Button>
        </>
      )}
    >
      <div className="stack stack-4 oc-ovd">
        {chosen ? (
          <div className="oc-ovd-q">
            <div className="grow stack stack-1">
              <span className="oc-k">The question</span>
              <p className="oc-ovd-text">{chosen.text}</p>
              <span className="oc-ov-meta">
                {chosen.topic && <span>{chosen.topic}</span>}
                {chosen.level && <Level level={chosen.level} />}
                {chosen.kind && <span>{KIND_LABEL[chosen.kind] ?? chosen.kind}</span>}
              </span>
            </div>
            {!state?.override && <Button size="sm" variant="ghost" onClick={() => setChosen(null)}>Choose another</Button>}
          </div>
        ) : (
          <div className="stack stack-3">
            <Field label="Chapter" htmlFor={`${id}-ch`}>
              <select id={`${id}-ch`} className="select" value={chapterId} disabled={!chapters} onChange={(e) => { setChapterId(e.target.value); setQ(''); }}>
                <option value="">{chapters ? 'Choose a chapter' : 'Reading the chapters'}</option>
                {list(chapters).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </Field>
            {chapter.error && <Note tone="bad" role="alert">{chapter.error}</Note>}
            {chapterId && !chapter.data && !chapter.error && <div className="skel" style={{ height: 120 }} aria-busy="true" />}
            {chapter.data && (
              <>
                {questions.length > 6 && (
                  <label className="search">
                    <Icon name="search" />
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find by words in the question or its topic" aria-label="Find a question" />
                  </label>
                )}
                {questions.length === 0 ? <p className="oc-quiet">This chapter has no questions yet.</p> : shown.length === 0 ? (
                  <p className="oc-quiet">No question matches “{q.trim()}”.</p>
                ) : (
                  <ul className="oc-qs" aria-label="Questions of this chapter">
                    {shown.map((x) => {
                      const has = overrides.some((ov) => ov.questionId === x.id);
                      return (
                        <li key={x.id}>
                          <button type="button" className="oc-q" onClick={() => { setChosen({ ...x, contentId: chapterId }); preset(x.id); }}>
                            <span className="oc-q-text">{x.text}</span>
                            <span className="oc-ov-meta">
                              {x.topic && <span>{x.topic}</span>}
                              {x.level && <Level level={x.level} />}
                              {STATUS[x.status] && <span>{STATUS[x.status]}</span>}
                              {has && <span className="oc-q-has">Mapped one by one already</span>}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
          </div>
        )}

        {chosen && (
          <fieldset className="oc-ovd-where">
            <legend className="oc-k">Where its answers go in this class</legend>
            <label className="check oc-radio">
              <input type="radio" name={`${id}-mode`} checked={mode === 'outcomes'} onChange={() => setMode('outcomes')} />
              To these outcomes, in place of its topic’s
            </label>
            {mode === 'outcomes' && (
              outcomesInUse.length === 0 ? <p className="oc-quiet">This class has no outcome in use to map it to.</p> : (
                <ul className="oc-ovd-outs">
                  {outcomesInUse.map((o) => (
                    <li key={o.id}>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={picked.has(o.id)}
                          onChange={() => setPicked((s) => { const n = new Set(s); if (n.has(o.id)) n.delete(o.id); else n.add(o.id); return n; })}
                        />
                        <b className="mono">{o.code}</b>
                        <span className="clip">{o.statement}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )
            )}
            <label className="check oc-radio">
              <input type="radio" name={`${id}-mode`} checked={mode === 'exclude'} onChange={() => setMode('exclude')} />
              Kept out of every outcome in this class
            </label>
          </fieldset>
        )}
        {error && <Note tone="bad" role="alert">{error}</Note>}
      </div>
    </Dialog>
  );
}

function Overrides({ data, canEdit, source, on, start }) {
  const overrides = list(data.overrides);
  const outcomesInUse = list(data.outcomes).filter((o) => !o.archived);
  const [dialog, setDialog] = useState(() => {
    if (start?.override === 'new') return {};
    const ov = start?.override && overrides.find((x) => x.questionId === start.override);
    return ov ? { override: ov } : null;
  });
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  async function clear(ov) {
    setBusyId(ov.questionId);
    setNotice('');
    setError('');
    try {
      const res = await on.clearOverride(ov.questionId);
      setNotice(res?.message || 'The question follows its topic again.');
    } catch (err) {
      setError(err.message || 'The server refused that.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="card ac-card oc-card" aria-labelledby="oc-ov-h">
      <div className="ac-head">
        <div className="sec">
          <h2 id="oc-ov-h">Questions mapped one by one</h2>
          <p>A question here goes to the outcomes named, in place of its topic’s, or to none. In this class only.</p>
        </div>
        {canEdit && <Button icon="plus" onClick={() => { setNotice(''); setError(''); setDialog({}); }}>Map one question</Button>}
      </div>
      {(notice || error) && (
        <div className="oc-notes">
          {notice && <Note tone="ok" role="status">{notice}</Note>}
          {error && <Note tone="bad" role="alert">{error}</Note>}
        </div>
      )}
      {overrides.length === 0 ? (
        <p className="oc-quiet oc-pad-b">None. Every question follows the outcomes its topic is mapped to.</p>
      ) : (
        <ul className="oc-ovs">
          {overrides.map((ov) => {
            const qn = ov.question;
            return (
              <li key={ov.questionId} className="oc-ov" data-gone={qn ? undefined : 'true'} aria-busy={busyId === ov.questionId || undefined}>
                <div className="oc-ov-main">
                  <p className="oc-ov-q">{qn ? qn.text : 'A deleted question'}</p>
                  {qn ? (
                    <span className="oc-ov-meta">
                      {qn.chapter && <span className="clip" title={qn.chapter}>{qn.chapter}</span>}
                      {qn.topic && <span>{qn.topic}</span>}
                      {qn.level && <Level level={qn.level} />}
                      {qn.kind && <span>{KIND_LABEL[qn.kind] ?? qn.kind}</span>}
                      {STATUS[qn.status] && <span>{STATUS[qn.status]}</span>}
                    </span>
                  ) : ov.note && <p className="oc-ov-note">{ov.note}</p>}
                </div>
                <div className="oc-ov-to" aria-label="Where its answers go">
                  {ov.excluded ? <Chip className="chip-line">Excluded from this class</Chip> : list(ov.outcomes).map((x) => (
                    <Chip key={x.id} className="chip-line oc-ov-code">
                      {x.code ?? 'An outcome'}{x.archived && <span className="oc-ov-arch"> archived</span>}
                    </Chip>
                  ))}
                </div>
                {canEdit && (
                  <div className="oc-ov-acts">
                    {qn && <Button size="sm" variant="ghost" icon="edit" onClick={() => setDialog({ override: ov })} aria-label="Change where this question goes">Change</Button>}
                    <Tip label="Follow its topic again">
                      <Button size="sm" variant="ghost" icon="undo" busy={busyId === ov.questionId} onClick={() => clear(ov)} aria-label={qn ? 'Remove this override: the question follows its topic again' : 'Remove this override'} />
                    </Tip>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {canEdit && (
        <OverrideDialog
          state={dialog}
          onOpenChange={(v) => { if (!v) setDialog(null); }}
          outcomesInUse={outcomesInUse}
          overrides={overrides}
          source={source}
          onSave={on.override}
        />
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- the view */

/**
 * The tab, drawn from what it is handed.
 *
 *   data      GET /outcomes (or a write's reply, through listOf)
 *   coverage  { data, loading, error } from GET /outcomes/coverage
 *   source    { chapters(), chapter(id), classes() } for the pickers
 *   on        { create, update, restore, reorder, remove, mapTopics, override,
 *               clearOverride, copy, exportCsv, reload, reloadCoverage }; each
 *               write resolves with the server's reply or throws its sentence
 *   start     what the gallery opens on: { editing, tab, chapter, mapError,
 *               adding, copy, override, notice, rowError }
 */
export function OutcomesView({ loading, error, notFound, locked, data, coverage, classId, source, on, start }) {
  if (loading) return <Skeleton />;

  if (!data) {
    return (
      <div className="card">
        <Empty
          icon={locked ? 'lock' : notFound ? 'search' : 'alert'}
          title={locked ? 'Course outcomes need the teacher key or an account' : notFound ? (error || 'That class was not found.') : 'The course outcomes did not load'}
          action={!notFound && !locked && on?.reload && <Button variant="primary" icon="refresh" onClick={on.reload}>Try again</Button>}
        >
          {notFound ? 'It may belong to an account you cannot read, or the link may be wrong.' : locked ? 'Unlock the console, or sign in.' : error}
        </Empty>
      </div>
    );
  }

  const canEdit = data.canEdit === true;
  const outcomesInUse = list(data.outcomes).filter((o) => !o.archived);

  return (
    <div className="oc stack stack-5">
      <OutcomeList data={data} canEdit={canEdit} source={source} on={on} start={start} classId={classId} />
      <Coverage coverage={coverage} outcomesInUse={outcomesInUse} canEdit={canEdit} on={on} />
      <Overrides data={data} canEdit={canEdit} source={source} on={on} start={start} />
      {data.privacy && <p className="cl-foot-privacy"><Icon name="shield" />{data.privacy}</p>}
    </div>
  );
}

/* ============================================================== container */

export default function Outcomes({ classId }) {
  const { account, loading: accountLoading } = useViewer();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState(0);
  const [coverage, setCoverage] = useState({ data: null, loading: false, error: '' });
  const coverageReq = useRef(0);

  const loadCoverage = useCallback(async () => {
    const req = ++coverageReq.current;
    setCoverage((c) => ({ ...c, loading: true }));
    try {
      const res = await api.outcomeCoverage(classId);
      if (req === coverageReq.current) setCoverage({ data: res, loading: false, error: '' });
    } catch (err) {
      if (req === coverageReq.current) setCoverage((c) => ({ ...c, loading: false, error: err.message || 'The coverage did not load.' }));
    }
  }, [classId]);

  const load = useCallback(async () => {
    try {
      const res = await api.outcomes(classId);
      setData(listOf(res));
      setError('');
      setStatus(0);
    } catch (err) {
      setError(err.message || 'The course outcomes did not load.');
      setStatus(err.status ?? 0);
      if (err.status === 404 || err.status === 401) setData(null);
    }
  }, [classId]);

  // Waits for the account: a read sent before it settles carries no bearer token.
  useEffect(() => {
    if (accountLoading) return;
    setData(null);
    setError('');
    load();
    loadCoverage();
  }, [accountLoading, account?.id, load, loadCoverage]);

  const on = useMemo(() => {
    const take = (res) => {
      setData(listOf(res));
      loadCoverage();
      return res;
    };
    const cid = encodeURIComponent(classId);
    return {
      create: async (body) => take(await api.createOutcome(classId, body)),
      update: async (id, patch) => take(await api.updateOutcome(classId, id, patch)),
      restore: async (id) => take(await api.updateOutcome(classId, id, { archived: false })),
      reorder: async (ids) => take(await api.reorderOutcomes(classId, ids)),
      remove: async (id) => take(await api.removeOutcome(classId, id)),
      mapTopics: async (id, topics) => take(await api.mapOutcomeTopics(classId, id, topics)),
      override: async (questionId, body) => take(await api.overrideQuestion(classId, questionId, body)),
      clearOverride: async (questionId) => take(await api.clearOverride(classId, questionId)),
      copy: async (fromClassId) => take(await api.copyOutcomes(classId, fromClassId)),
      exportCsv: () => api.downloadCsv(`/classes/${cid}/outcomes`),
      reload: () => { load(); loadCoverage(); },
      reloadCoverage: loadCoverage,
    };
  }, [classId, load, loadCoverage]);

  // What the pickers offer: the chapters this viewer may read, one chapter's
  // topics and questions (read once per tab), and the classes to copy from.
  const source = useMemo(() => {
    const chapters = new Map();
    return {
      chapters: async () => list((await api.listContents())?.contents).map((c) => ({ id: c._id ?? c.id, title: c.title ?? '' })),
      chapter: (id) => {
        if (!chapters.has(id)) {
          chapters.set(id, Promise.all([api.getContent(id), api.getBank(id)]).then(([c, bank]) => ({
            id,
            title: c?.content?.title ?? '',
            topics: list(c?.content?.topics),
            questions: list(bank?.questions).map((q) => ({
              id: q._id ?? q.id, text: q.text ?? '', topic: q.topic ?? '', level: q.bloom ?? null, kind: q.kind ?? null, status: q.status ?? null,
            })),
          })).catch((err) => { chapters.delete(id); throw err; }));
        }
        return chapters.get(id);
      },
      classes: async () => list((await api.listClasses())?.classes).map((c) => ({
        id: c.id ?? c._id, courseName: c.courseName ?? '', section: c.section ?? '', termLabel: c.termLabel ?? '',
      })),
    };
  }, []);

  return (
    <OutcomesView
      loading={accountLoading || (data === null && !error)}
      error={error}
      notFound={status === 404}
      locked={status === 401}
      data={data}
      coverage={coverage}
      classId={classId}
      source={source}
      on={on}
    />
  );
}
