/**
 * Editing one question, in a sheet beside the bank it came from.
 *
 * Level and interaction are one decision: the level offers only its own
 * interactions, so retagging a question can change how it is asked, and the
 * editor fills in the shape the new interaction needs rather than leaving the
 * teacher to guess what the server will refuse.
 */

import { useState } from 'react';

import { api } from '../lib/api.js';
import { LABEL, LEVELS } from '../lib/bloom.js';
import { BLANK_MARK, KIND_LABEL, KIND_SHAPE } from '../lib/kinds.js';
import { Button, Dialog, Field, Icon, Level, Note, Segmented } from '../ui/index.jsx';

const KEYS = ['A', 'B', 'C', 'D', 'E', 'F'];

// What each kind sends. Anything not listed for the chosen kind stays out of
// the request, so a retag cannot smuggle a stale answer key along with it.
const FIELDS = {
  mcq: ['options', 'answerIdx'],
  truefalse: ['answerBool'],
  match: ['pairs'],
  categorise: ['buckets'],
  blank: ['accept'],
  cloze: ['blanks'],
  numeric: ['value', 'tolerance', 'unit'],
  multi: ['options', 'answerIdxs'],
  order: ['sequence'],
  rank: ['sequence', 'criterion'],
  open: ['rubric'],
};

const markers = (text) => String(text ?? '').split(BLANK_MARK).length - 1;
const arr = (v) => (Array.isArray(v) ? v : []);
const numText = (v) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : '');

/** One set of accepted answers per marker in the text, keeping what was typed. */
function syncBlanks(text, blanks) {
  const n = markers(text);
  return Array.from({ length: n }, (_, i) => ({ accept: arr(blanks[i]?.accept).length ? arr(blanks[i].accept) : [''] }));
}

function seed(q) {
  return {
    text: q.text ?? '',
    bloom: q.bloom,
    kind: q.kind ?? 'mcq',
    options: arr(q.options),
    answerIdx: Number.isInteger(q.answerIdx) ? q.answerIdx : 0,
    answerIdxs: arr(q.answerIdxs).map(Number),
    answerBool: typeof q.answerBool === 'boolean' ? q.answerBool : true,
    pairs: arr(q.pairs).map((p) => ({ left: p?.left ?? '', right: p?.right ?? '' })),
    buckets: arr(q.buckets).map((b) => ({ name: b?.name ?? '', items: arr(b?.items) })),
    sequence: arr(q.sequence),
    criterion: q.criterion ?? '',
    accept: arr(q.accept),
    blanks: arr(q.blanks).map((b) => ({ accept: arr(b?.accept) })),
    value: numText(q.value),
    tolerance: numText(q.tolerance),
    unit: q.unit ?? '',
    rubric: arr(q.rubric),
  };
}

/** The empty shape a kind needs, for whatever the draft does not already have. */
function fill(kind, d) {
  const next = {};
  const need = (field, value) => { if (!arr(d[field]).length) next[field] = value; };
  if (kind === 'mcq' || kind === 'multi') need('options', ['', '', '', '']);
  if (kind === 'multi' && !d.answerIdxs.length) next.answerIdxs = [d.answerIdx];
  if (kind === 'mcq' && d.answerIdxs.length) next.answerIdx = Math.min(...d.answerIdxs);
  if (kind === 'match') need('pairs', [{ left: '', right: '' }, { left: '', right: '' }, { left: '', right: '' }]);
  if (kind === 'categorise') need('buckets', [{ name: '', items: ['', ''] }, { name: '', items: ['', ''] }]);
  if (kind === 'blank') need('accept', ['']);
  if (kind === 'cloze') next.blanks = syncBlanks(d.text, d.blanks);
  if (kind === 'numeric' && String(d.tolerance).trim() === '') next.tolerance = '0';
  if (kind === 'order' || kind === 'rank') need('sequence', ['', '', '']);
  if (kind === 'open') need('rubric', ['', '']);
  return next;
}

function payload(d) {
  const out = { text: d.text, bloom: d.bloom, kind: d.kind };
  for (const field of FIELDS[d.kind] ?? []) {
    if (field === 'value' || field === 'tolerance') out[field] = String(d[field]).trim() === '' ? null : Number(d[field]);
    else if (field === 'blanks') out.blanks = syncBlanks(d.text, d.blanks);
    else out[field] = d[field];
  }
  return out;
}

/** A list of one-line entries, optionally with a "this one is right" control. */
function Lines({ items, onChange, pick, markOf, min = 0, max = 99, placeholder, addLabel = 'Add one' }) {
  const set = (i, v) => onChange(items.map((it, j) => (j === i ? v : it)));
  return (
    <div className="stack stack-2">
      {items.map((it, i) => (
        <div key={i} className="ed-row" data-on={pick?.on(i) ? 'true' : undefined}>
          {pick ? (
            <label className="ed-mark">
              <input
                type={pick.mode === 'one' ? 'radio' : 'checkbox'}
                name={pick.name}
                checked={pick.on(i)}
                onChange={() => pick.toggle(i)}
                aria-label={`Option ${KEYS[i] ?? i + 1} is correct`}
              />
              {markOf ? markOf(i) : KEYS[i] ?? i + 1}
            </label>
          ) : (
            <span className="ed-mark">{markOf ? markOf(i) : i + 1}</span>
          )}
          <input className="input grow" value={it ?? ''} placeholder={placeholder} aria-label={`${placeholder ?? 'Row'} ${i + 1}`} onChange={(e) => set(i, e.target.value)} />
          <Button
            variant="ghost" size="sm" icon="close"
            aria-label={`Remove row ${i + 1}`}
            title={items.length <= min ? `${min} is the fewest this kind allows` : undefined}
            disabled={items.length <= min}
            onClick={() => onChange(items.filter((_, j) => j !== i))}
          />
        </div>
      ))}
      <div>
        <Button size="sm" icon="plus" disabled={items.length >= max} title={items.length >= max ? `${max} is the most this kind allows` : undefined} onClick={() => onChange([...items, ''])}>
          {addLabel}
        </Button>
      </div>
    </div>
  );
}

function Pairs({ pairs, onChange }) {
  const set = (i, patch) => onChange(pairs.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  return (
    <div className="stack stack-2">
      {pairs.map((p, i) => (
        <div key={i} className="ed-pair">
          <input className="input" value={p.left ?? ''} placeholder="Term" aria-label={`Term ${i + 1}`} onChange={(e) => set(i, { left: e.target.value })} />
          <Icon name="forward" className="muted" />
          <input className="input" value={p.right ?? ''} placeholder="What it matches" aria-label={`Match for term ${i + 1}`} onChange={(e) => set(i, { right: e.target.value })} />
          <Button
            variant="ghost" size="sm" icon="close"
            aria-label={`Remove pair ${i + 1}`}
            title={pairs.length <= 3 ? 'Three pairs is the fewest a match allows' : undefined}
            disabled={pairs.length <= 3}
            onClick={() => onChange(pairs.filter((_, j) => j !== i))}
          />
        </div>
      ))}
      <div>
        <Button size="sm" icon="plus" disabled={pairs.length >= 5} title={pairs.length >= 5 ? 'Five pairs is the most a match allows' : undefined} onClick={() => onChange([...pairs, { left: '', right: '' }])}>
          Add a pair
        </Button>
      </div>
    </div>
  );
}

function Body({ draft, set }) {
  const { kind } = draft;

  if (kind === 'mcq' || kind === 'multi') {
    const many = kind === 'multi';
    const on = (i) => (many ? draft.answerIdxs.includes(i) : draft.answerIdx === i);
    const toggle = (i) => set(
      many
        ? { answerIdxs: draft.answerIdxs.includes(i) ? draft.answerIdxs.filter((j) => j !== i) : [...draft.answerIdxs, i].sort((x, y) => x - y) }
        : { answerIdx: i },
    );
    return (
      <Lines
        items={draft.options}
        min={4}
        max={many ? 6 : 4}
        placeholder="Option"
        addLabel="Add an option"
        pick={{ mode: many ? 'many' : 'one', name: 'correct', on, toggle }}
        onChange={(options) => set({
          options,
          ...(many
            ? { answerIdxs: draft.answerIdxs.filter((i) => i < options.length) }
            : { answerIdx: Math.min(draft.answerIdx, Math.max(0, options.length - 1)) }),
        })}
      />
    );
  }

  if (kind === 'truefalse') {
    return (
      <Segmented
        label="The statement is"
        value={String(draft.answerBool)}
        onChange={(v) => set({ answerBool: v === 'true' })}
        options={[{ id: 'true', label: 'True' }, { id: 'false', label: 'False' }]}
      />
    );
  }

  if (kind === 'match') return <Pairs pairs={draft.pairs} onChange={(pairs) => set({ pairs })} />;

  if (kind === 'categorise') {
    const setBucket = (i, patch) => set({ buckets: draft.buckets.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
    return (
      <div className="stack stack-3">
        <div className="ed-cols">
          {draft.buckets.map((b, i) => (
            <div className="well stack stack-3" key={i}>
              <div className="cluster nowrap-flex">
                <input className="input grow" value={b.name ?? ''} placeholder="Group name" aria-label={`Group ${i + 1} name`} onChange={(e) => setBucket(i, { name: e.target.value })} />
                <Button
                  variant="ghost" size="sm" icon="close"
                  aria-label={`Remove group ${i + 1}`}
                  title={draft.buckets.length <= 2 ? 'Two groups is the fewest' : undefined}
                  disabled={draft.buckets.length <= 2}
                  onClick={() => set({ buckets: draft.buckets.filter((_, j) => j !== i) })}
                />
              </div>
              <Lines items={b.items} markOf={() => ''} placeholder="Item" addLabel="Add an item" onChange={(items) => setBucket(i, { items })} />
            </div>
          ))}
        </div>
        <div>
          <Button size="sm" icon="plus" disabled={draft.buckets.length >= 4} title={draft.buckets.length >= 4 ? 'Four groups is the most' : undefined} onClick={() => set({ buckets: [...draft.buckets, { name: '', items: [''] }] })}>
            Add a group
          </Button>
        </div>
      </div>
    );
  }

  if (kind === 'blank') {
    return (
      <div className="stack stack-3">
        <p className="hint">Everything here is accepted, so add the spellings and synonyms a student would reasonably type. Case and spacing are already ignored.</p>
        <Lines items={draft.accept} min={1} placeholder="Accepted answer" addLabel="Accept another" markOf={(i) => (i === 0 ? '=' : 'or')} onChange={(accept) => set({ accept })} />
      </div>
    );
  }

  if (kind === 'cloze') {
    const parts = String(draft.text).split(BLANK_MARK);
    const blanks = syncBlanks(draft.text, draft.blanks);
    if (blanks.length === 0) {
      return (
        <Note icon="alert">
          There is no {BLANK_MARK} in the passage yet. Type {BLANK_MARK} where each word should be taken out, and a set of accepted answers appears here for every one.
        </Note>
      );
    }
    const around = (i) => {
      const before = String(parts[i] ?? '').trim().split(/\s+/).slice(-4).join(' ');
      const after = String(parts[i + 1] ?? '').trim().split(/\s+/).slice(0, 4).join(' ');
      return `${before} ${BLANK_MARK} ${after}`;
    };
    return (
      <div className="stack">
        {blanks.map((b, i) => (
          <div key={i} className="stack stack-2">
            <div><span className="t-label">Blank {i + 1}</span> <span className="t-meta mono">{around(i)}</span></div>
            <Lines
              items={b.accept}
              min={1}
              placeholder="Accepted answer"
              addLabel="Accept another"
              markOf={(j) => (j === 0 ? '=' : 'or')}
              onChange={(accept) => set({ blanks: blanks.map((x, j) => (j === i ? { accept } : x)) })}
            />
          </div>
        ))}
      </div>
    );
  }

  if (kind === 'numeric') {
    return (
      <div className="grid-3">
        <Field label="Correct value" htmlFor="q-value">
          <input id="q-value" className="input num" inputMode="decimal" value={draft.value} onChange={(e) => set({ value: e.target.value })} />
        </Field>
        <Field label="Tolerance" htmlFor="q-tol" hint="How far out an answer may be. Zero means exact.">
          <input id="q-tol" className="input num" inputMode="decimal" value={draft.tolerance} onChange={(e) => set({ tolerance: e.target.value })} />
        </Field>
        <Field label="Unit" htmlFor="q-unit" hint="Shown beside the box. Nobody is marked on typing it.">
          <input id="q-unit" className="input" value={draft.unit} placeholder="kJ, %, cm" onChange={(e) => set({ unit: e.target.value })} />
        </Field>
      </div>
    );
  }

  if (kind === 'order' || kind === 'rank') {
    return (
      <div className="stack stack-3">
        {kind === 'rank' && (
          <Field label="Ranked against" htmlFor="q-criterion" hint="A ranking with no stated criterion is ordered by what? The server refuses one without it.">
            <input id="q-criterion" className="input" value={draft.criterion} placeholder="strongest evidence first, most severe first" onChange={(e) => set({ criterion: e.target.value })} />
          </Field>
        )}
        <p className="hint">Written in the correct order, top first. Every student sees them shuffled, each in their own order.</p>
        <Lines items={draft.sequence} min={3} max={5} placeholder="Item" addLabel="Add an item" onChange={(sequence) => set({ sequence })} />
      </div>
    );
  }

  if (kind === 'open') {
    return (
      <div className="stack stack-3">
        <p className="hint">Each point is matched against the words a student actually writes, so use the content words a correct answer would use, not a sentence about it.</p>
        <Lines items={draft.rubric} min={2} max={5} placeholder="Point a full answer must make" addLabel="Add a point" onChange={(rubric) => set({ rubric })} />
      </div>
    );
  }

  return <Note icon="alert">"{KIND_LABEL[kind] ?? kind}" has no editor yet.</Note>;
}

export default function Editor({ question, kinds, onClose, onDone }) {
  const [draft, setDraft] = useState(() => seed(question));
  const [busy, setBusy] = useState('');
  const [refused, setRefused] = useState('');

  const set = (patch) => { setRefused(''); setDraft((d) => ({ ...d, ...patch })); };

  // What this level may be asked as: the server's list, so the editor can
  // never offer a swap the server would refuse.
  const swaps = kinds?.forLevel?.[draft.bloom] ?? [draft.kind];
  const label = (k) => kinds?.label?.[k] ?? KIND_LABEL[k] ?? k;
  const retagged = draft.bloom !== question.bloom;

  function pickKind(kind) {
    if (kind === draft.kind) return;
    setRefused('');
    setDraft((d) => ({ ...d, kind, ...fill(kind, d) }));
  }

  function pickLevel(bloom) {
    if (bloom === draft.bloom) return;
    setRefused('');
    setDraft((d) => {
      const offered = kinds?.forLevel?.[bloom] ?? [];
      const kind = offered.includes(d.kind) ? d.kind : (offered[0] ?? d.kind);
      return { ...d, bloom, kind, ...fill(kind, d) };
    });
  }

  async function run(what, fn) {
    setBusy(what); setRefused('');
    try { await fn(); await onDone(); }
    catch (err) { setRefused(err.message); }
    finally { setBusy(''); }
  }
  const save = () => run('save', () => api.editQuestion(question._id, payload(draft)));

  const blanks = markers(draft.text);
  const fillIn = draft.kind === 'blank' || draft.kind === 'cloze';

  return (
    <Dialog
      sheet
      open
      onOpenChange={(v) => { if (!v) onClose(); }}
      locked={Boolean(busy)}
      title="Edit question"
      description={`${question.topic || 'Untitled topic'} · ${LABEL[question.bloom] ?? question.bloom} · ${label(question.kind ?? 'mcq')}`}
      footer={(
        <>
          <Button variant="ghost" disabled={Boolean(busy)} onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy === 'save'} disabled={Boolean(busy)} onClick={save}>Save changes</Button>
        </>
      )}
    >
      <div className="stack stack-5">
        {refused && <Note tone="bad">{refused}</Note>}

        <section className="stack stack-3">
          <h4>Level</h4>
          <div className="cluster">
            {LEVELS.map((l) => (
              <Level key={l} as="button" type="button" level={l} solid={draft.bloom === l} aria-pressed={draft.bloom === l} onClick={() => pickLevel(l)} />
            ))}
          </div>
          <div className="stack stack-2">
            <span className="t-label">Asked as</span>
            <Segmented label="Interaction" value={draft.kind} onChange={pickKind} options={swaps.map((k) => ({ id: k, label: label(k) }))} />
          </div>
          <p className="said">
            {LABEL[draft.bloom]} is asked as {swaps.map(label).join(' or ')} and nothing else, because the level decides the
            interaction. To ask this another way, change the level, and expect to rewrite the question with it.
          </p>
          {retagged && (
            <Note>
              Moving this from {LABEL[question.bloom]} to {LABEL[draft.bloom]}
              {draft.kind !== (question.kind ?? 'mcq')
                ? `, so it becomes "${label(draft.kind)}" and needs that shape filled in below.`
                : '. The interaction it has is asked at both levels, so it carries over.'}
            </Note>
          )}
        </section>

        <section className="stack stack-3">
          <div className="cluster between">
            <h4>Question</h4>
            {fillIn && <span className="t-meta">{blanks} {BLANK_MARK} marker{blanks === 1 ? '' : 's'} in the text</span>}
          </div>
          <textarea className="textarea" style={{ minHeight: 96 }} value={draft.text} aria-label="Question text" onChange={(e) => set({ text: e.target.value })} />
          <p className="hint">
            {draft.kind === 'truefalse'
              ? 'A statement, not a question: "Photosynthesis needs light." and never "Does photosynthesis need light?"'
              : fillIn
                ? `Type ${BLANK_MARK} wherever a word is taken out. Everything else is read as written.`
                : 'Plain, exam-ready English. No markdown and no numbering inside the stem.'}
          </p>
        </section>

        <section className="stack stack-3">
          <div className="stack stack-1">
            <h4>{label(draft.kind)}</h4>
            {KIND_SHAPE[draft.kind] && <p className="hint">{KIND_SHAPE[draft.kind]}</p>}
          </div>
          <Body draft={draft} set={set} />
        </section>

        <section className="stack stack-3">
          <div className="stack stack-1">
            <h4>Split, rewrite or discard</h4>
            <p className="hint">These act on the question as it is stored. Save first if the edits above are worth keeping. Splitting keeps the original in the discarded pile, so none of this is one-way.</p>
          </div>
          <div className="cluster">
            <Button icon="split" busy={busy === 'split'} disabled={Boolean(busy)} onClick={() => run('split', () => api.splitQuestion(question._id))}>Split into two</Button>
            <Button icon="refresh" busy={busy === 'regen'} disabled={Boolean(busy)} onClick={() => run('regen', () => api.regenerateQuestion(question._id))}>Rewrite it</Button>
            {question.status === 'discarded' ? (
              <Button icon="undo" busy={busy === 'restore'} disabled={Boolean(busy)} onClick={() => run('restore', () => api.restoreQuestion(question._id))}>Restore to the bank</Button>
            ) : (
              <Button variant="danger" icon="trash" busy={busy === 'discard'} disabled={Boolean(busy)} onClick={() => run('discard', () => api.discardQuestion(question._id))}>Discard</Button>
            )}
          </div>
        </section>
      </div>
    </Dialog>
  );
}
