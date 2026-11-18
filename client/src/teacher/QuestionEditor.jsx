/**
 * The question editor.
 *
 * One question, opened from the bank, with controls that suit the kind it is:
 * option rows with a correct-answer radio, pair rows, group columns, a
 * true/false toggle, a value and its tolerance, accepted answers tied to the
 * ____ markers in a passage, an ordered list with the criterion it is ordered
 * against.
 *
 * Two rules run through the whole screen:
 *
 *   1. The interaction is chosen by the Bloom LEVEL. "Change type" offers only
 *      the kinds that level is asked through, and that list arrives WITH THE
 *      BANK from the server's own KINDS_FOR_LEVEL - this screen never works it
 *      out, so what a teacher is offered and what the server will accept cannot
 *      drift apart.
 *   2. The server validates. Every shape hint here is guidance printed before
 *      the press; the sentence shown when a save is refused is the validator's
 *      own, verbatim, because it is written to be read by a teacher.
 */

import { useState } from 'react';

import { api } from '../api.js';
import { LEVELS, LABEL } from '../bloom.js';
import { BLANK_MARK, KIND_LABEL, KIND_SHAPE } from '../kinds.js';
import Icon from '../ui/Icon.jsx';
import { Card, PageHead } from '../ui/Shell.jsx';

/** Six, not four: a multi-select item is allowed up to six options. */
const KEYS = ['A', 'B', 'C', 'D', 'E', 'F'];

/**
 * Which fields travel for which kind. The server decides what a valid question
 * is; this only decides what is worth sending, so that a save carries the whole
 * item the teacher is looking at and nothing left over from a kind they moved
 * away from.
 */
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
/** Empty stays empty rather than becoming 0, so an unanswered field reads as unanswered. */
const numText = (v) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : '');

/**
 * One blank per marker, always. The markers in the passage are the truth: adding
 * a ____ adds a blank to fill in, deleting one takes its answers away with it,
 * and the two can never be out of step long enough for a teacher to fill in a
 * blank that no longer exists.
 */
function syncBlanks(text, blanks) {
  const n = markers(text);
  return Array.from({ length: n }, (_, i) => ({ accept: arr(blanks[i]?.accept).length ? arr(blanks[i].accept) : [''] }));
}

/**
 * The draft. Every kind's fields are held at once, so swapping the type and
 * swapping back returns the work rather than an empty form - the server keeps
 * them on the stored question for exactly the same reason.
 */
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

/**
 * What the new kind needs and the draft has not got yet. Only ever fills gaps:
 * four options already written stay written when a "Choose one" becomes a
 * "Choose all that apply".
 */
function fill(kind, d) {
  const next = {};
  const need = (field, value) => { if (!arr(d[field]).length) next[field] = value; };

  if (kind === 'mcq' || kind === 'multi') need('options', ['', '', '', '']);
  // The answer key survives the trip between the two option kinds. Carried
  // across it is still an answer the teacher chose; left behind, "Choose one"
  // would quietly mark option A correct on a question they never re-keyed.
  if (kind === 'multi' && !d.answerIdxs.length) next.answerIdxs = [d.answerIdx];
  if (kind === 'mcq' && d.answerIdxs.length) next.answerIdx = Math.min(...d.answerIdxs);
  if (kind === 'match') need('pairs', [{ left: '', right: '' }, { left: '', right: '' }, { left: '', right: '' }]);
  if (kind === 'categorise') need('buckets', [{ name: '', items: ['', ''] }, { name: '', items: ['', ''] }]);
  if (kind === 'blank') need('accept', ['']);
  if (kind === 'cloze') next.blanks = syncBlanks(d.text, d.blanks);
  // Exact is a real default and costs nothing to change. The value itself is
  // never guessed at - it is the answer, and nobody but the teacher knows it.
  if (kind === 'numeric' && String(d.tolerance).trim() === '') next.tolerance = '0';
  if (kind === 'order' || kind === 'rank') need('sequence', ['', '', '']);
  if (kind === 'open') need('rubric', ['', '']);
  return next;
}

/** Only the fields this kind is asked through, in the shape the server stores. */
function payload(d) {
  const out = { text: d.text, bloom: d.bloom, kind: d.kind };
  for (const field of FIELDS[d.kind] ?? []) {
    if (field === 'value' || field === 'tolerance') {
      // An empty box is not a zero. Sent as null it reaches the validator as a
      // missing value and comes back named, which is what the teacher needs.
      out[field] = String(d[field]).trim() === '' ? null : Number(d[field]);
    } else if (field === 'blanks') {
      out.blanks = syncBlanks(d.text, d.blanks);
    } else {
      out[field] = d[field];
    }
  }
  return out;
}

/* ------------------------------------------------------------- controls -- */

/**
 * A list of single-line values: the row's key on the left, the value filling
 * it, a way to take the row away. `pick` turns the key into a live radio or
 * checkbox, which is how the correct answer is set on an option list.
 */
function Rows({ items, onChange, pick, keyOf, min = 0, max = 99, placeholder, addLabel = 'Add one' }) {
  const set = (i, v) => onChange(items.map((it, j) => (j === i ? v : it)));
  return (
    <>
      {items.map((it, i) => (
        <div key={i} className={`erow${pick?.on(i) ? ' on' : ''}`}>
          {pick ? (
            <label className="ekey">
              <input
                type={pick.mode === 'one' ? 'radio' : 'checkbox'}
                name={pick.name}
                checked={pick.on(i)}
                onChange={() => pick.toggle(i)}
                aria-label={`Option ${KEYS[i] ?? i + 1} is correct`}
              />
              {keyOf ? keyOf(i) : KEYS[i] ?? i + 1}
            </label>
          ) : (
            <span className="ekey">{keyOf ? keyOf(i) : i + 1}</span>
          )}
          <input
            className="grow"
            value={it ?? ''}
            placeholder={placeholder}
            aria-label={`${placeholder ?? 'Row'} ${i + 1}`}
            onChange={(e) => set(i, e.target.value)}
          />
          <button
            type="button"
            className="iconbtn"
            aria-label={`Remove row ${i + 1}`}
            title={items.length <= min ? `${min} is the fewest this kind allows` : 'Remove this row'}
            disabled={items.length <= min}
            onClick={() => onChange(items.filter((_, j) => j !== i))}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn xs"
        style={{ marginTop: 10 }}
        disabled={items.length >= max}
        title={items.length >= max ? `${max} is the most this kind allows` : undefined}
        onClick={() => onChange([...items, ''])}
      >
        <Icon name="plus" size={11} />
        {addLabel}
      </button>
    </>
  );
}

/** A term and what it matches. Two pieces of prose, so the row wraps. */
function PairRows({ pairs, onChange }) {
  const set = (i, patch) => onChange(pairs.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  return (
    <>
      {pairs.map((p, i) => (
        <div key={i} className="epair">
          <input
            value={p.left ?? ''}
            placeholder="Term"
            aria-label={`Term ${i + 1}`}
            onChange={(e) => set(i, { left: e.target.value })}
          />
          <span className="j"><Icon name="forward" size={13} /></span>
          <input
            value={p.right ?? ''}
            placeholder="What it matches"
            aria-label={`Match for term ${i + 1}`}
            onChange={(e) => set(i, { right: e.target.value })}
          />
          <button
            type="button"
            className="iconbtn"
            aria-label={`Remove pair ${i + 1}`}
            title={pairs.length <= 3 ? 'Three pairs is the fewest a match allows' : 'Remove this pair'}
            disabled={pairs.length <= 3}
            onClick={() => onChange(pairs.filter((_, j) => j !== i))}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn xs"
        style={{ marginTop: 10 }}
        disabled={pairs.length >= 5}
        title={pairs.length >= 5 ? 'Five pairs is the most a match allows' : undefined}
        onClick={() => onChange([...pairs, { left: '', right: '' }])}
      >
        <Icon name="plus" size={11} />
        Add a pair
      </button>
    </>
  );
}

/* ----------------------------------------------------------------- body -- */

/** The payload editor for one kind. Every branch draws the answer key itself. */
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
      <Rows
        items={draft.options}
        min={4}
        max={many ? 6 : 4}
        placeholder="Option"
        addLabel="Add an option"
        pick={{ mode: many ? 'many' : 'one', name: 'correct', on, toggle }}
        onChange={(options) => set({
          options,
          // The key points at positions, so a removed option must not leave it
          // pointing at whatever slid into that slot.
          ...(many
            ? { answerIdxs: draft.answerIdxs.filter((i) => i < options.length) }
            : { answerIdx: Math.min(draft.answerIdx, Math.max(0, options.length - 1)) }),
        })}
      />
    );
  }

  if (kind === 'truefalse') {
    return (
      <div className="row" style={{ gap: 8 }}>
        {[true, false].map((v) => (
          <button
            key={String(v)}
            type="button"
            className={`btn${draft.answerBool === v ? ' pri' : ''}`}
            aria-pressed={draft.answerBool === v}
            onClick={() => set({ answerBool: v })}
          >
            {draft.answerBool === v && <Icon name="check" size={12} />}
            {v ? 'True' : 'False'}
          </button>
        ))}
      </div>
    );
  }

  if (kind === 'match') return <PairRows pairs={draft.pairs} onChange={(pairs) => set({ pairs })} />;

  if (kind === 'categorise') {
    const setBucket = (i, patch) => set({ buckets: draft.buckets.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
    return (
      <>
        <div className="ecols">
          {draft.buckets.map((b, i) => (
            <div className="ecol" key={i}>
              <div className="row">
                <input
                  className="grow"
                  value={b.name ?? ''}
                  placeholder="Group name"
                  aria-label={`Group ${i + 1} name`}
                  style={{ height: 40, fontWeight: 700 }}
                  onChange={(e) => setBucket(i, { name: e.target.value })}
                />
                <button
                  type="button"
                  className="iconbtn"
                  aria-label={`Remove group ${i + 1}`}
                  title={draft.buckets.length <= 2 ? 'Two groups is the fewest' : 'Remove this group'}
                  disabled={draft.buckets.length <= 2}
                  onClick={() => set({ buckets: draft.buckets.filter((_, j) => j !== i) })}
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
              {/* No floor on the items here: the group itself is what may not be
                  emptied, and the validator says so by name if one is. */}
              <Rows
                items={b.items}
                keyOf={() => '·'}
                placeholder="Item"
                addLabel="Add an item"
                onChange={(items) => setBucket(i, { items })}
              />
            </div>
          ))}
        </div>
        <button
          type="button"
          className="btn xs"
          style={{ marginTop: 12 }}
          disabled={draft.buckets.length >= 4}
          title={draft.buckets.length >= 4 ? 'Four groups is the most' : undefined}
          onClick={() => set({ buckets: [...draft.buckets, { name: '', items: [''] }] })}
        >
          <Icon name="plus" size={11} />
          Add a group
        </button>
      </>
    );
  }

  if (kind === 'blank') {
    return (
      <>
        <div className="hint" style={{ marginTop: 0, marginBottom: 10 }}>
          Everything here is accepted, so add the spellings and synonyms a student would reasonably
          type. Case and spacing are already ignored.
        </div>
        <Rows
          items={draft.accept}
          min={1}
          placeholder="Accepted answer"
          addLabel="Accept another"
          keyOf={(i) => (i === 0 ? '=' : 'or')}
          onChange={(accept) => set({ accept })}
        />
      </>
    );
  }

  if (kind === 'cloze') {
    const parts = String(draft.text).split(BLANK_MARK);
    const blanks = syncBlanks(draft.text, draft.blanks);
    if (blanks.length === 0) {
      return (
        <div className="note warn">
          <Icon name="alert" size={15} />
          <span>
            There is no {BLANK_MARK} in the passage yet. Type {BLANK_MARK} where each word should be
            taken out, and a set of accepted answers appears here for every one of them.
          </span>
        </div>
      );
    }
    // Each blank is shown with the words on either side of it, because "blank 3"
    // means nothing to somebody reading a passage they wrote ten minutes ago.
    const around = (i) => {
      const before = String(parts[i] ?? '').trim().split(/\s+/).slice(-4).join(' ');
      const after = String(parts[i + 1] ?? '').trim().split(/\s+/).slice(0, 4).join(' ');
      return `…${before} ${BLANK_MARK} ${after}…`;
    };
    return (
      <div className="stack">
        {blanks.map((b, i) => (
          <div key={i}>
            <div className="eyebrow">Blank {i + 1}</div>
            <div className="hint mono" style={{ marginTop: 5, marginBottom: 8 }}>{around(i)}</div>
            <Rows
              items={b.accept}
              min={1}
              placeholder="Accepted answer"
              addLabel="Accept another"
              keyOf={(j) => (j === 0 ? '=' : 'or')}
              onChange={(accept) => set({ blanks: blanks.map((x, j) => (j === i ? { accept } : x)) })}
            />
          </div>
        ))}
      </div>
    );
  }

  if (kind === 'numeric') {
    return (
      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        <div className="field" style={{ flex: '1 1 150px', marginBottom: 0 }}>
          <label htmlFor="q-value">Correct value</label>
          <input
            id="q-value"
            className="num"
            inputMode="decimal"
            value={draft.value}
            onChange={(e) => set({ value: e.target.value })}
          />
        </div>
        <div className="field" style={{ flex: '1 1 150px', marginBottom: 0 }}>
          <label htmlFor="q-tol">Tolerance</label>
          <input
            id="q-tol"
            className="num"
            inputMode="decimal"
            value={draft.tolerance}
            onChange={(e) => set({ tolerance: e.target.value })}
          />
          <div className="hint">How far out an answer may be. Zero means exact.</div>
        </div>
        <div className="field" style={{ flex: '1 1 150px', marginBottom: 0 }}>
          <label htmlFor="q-unit">Unit</label>
          <input
            id="q-unit"
            value={draft.unit}
            placeholder="kJ, %, cm"
            onChange={(e) => set({ unit: e.target.value })}
          />
          <div className="hint">
            Shown beside the box, and left empty when the answer has no unit. Nobody is marked on
            typing it.
          </div>
        </div>
      </div>
    );
  }

  if (kind === 'order' || kind === 'rank') {
    return (
      <>
        {kind === 'rank' && (
          <div className="field">
            <label htmlFor="q-criterion">Ranked against</label>
            <input
              id="q-criterion"
              value={draft.criterion}
              placeholder="strongest evidence first, most severe first, …"
              onChange={(e) => set({ criterion: e.target.value })}
            />
            <div className="hint">
              A ranking with no stated criterion is ordered by what? The server refuses one without it.
            </div>
          </div>
        )}
        <div className="hint" style={{ marginTop: 0, marginBottom: 10 }}>
          Written in the CORRECT order, top first. Every student sees them shuffled, in their own order.
        </div>
        <Rows
          items={draft.sequence}
          min={3}
          max={5}
          placeholder="Item"
          addLabel="Add an item"
          onChange={(sequence) => set({ sequence })}
        />
      </>
    );
  }

  if (kind === 'open') {
    return (
      <>
        <div className="hint" style={{ marginTop: 0, marginBottom: 10 }}>
          Each point is matched against the words a student actually writes, so use the content words a
          correct answer would use rather than a sentence about it.
        </div>
        <Rows
          items={draft.rubric}
          min={2}
          max={5}
          placeholder="Point a full answer must make"
          addLabel="Add a point"
          onChange={(rubric) => set({ rubric })}
        />
      </>
    );
  }

  return (
    <div className="note warn">
      <Icon name="alert" size={15} />
      <span>“{KIND_LABEL[kind] ?? kind}” has no editor on this screen yet.</span>
    </div>
  );
}

/* --------------------------------------------------------------- screen -- */

export default function QuestionEditor({ question, kinds, onClose, onDone }) {
  const [draft, setDraft] = useState(() => seed(question));
  const [busy, setBusy] = useState('');
  // The server's sentence, kept exactly as it arrived. Nothing on this screen
  // rewrites it, shortens it or replaces it with a generic failure.
  const [refused, setRefused] = useState('');

  const set = (patch) => {
    setRefused('');
    setDraft((d) => ({ ...d, ...patch }));
  };

  // The set this level is asked through, as the server sent it with the bank.
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
      // The level chooses the interaction, so a retag moves the kind with it
      // unless the one in hand is asked at the new level too.
      const kind = offered.includes(d.kind) ? d.kind : (offered[0] ?? d.kind);
      return { ...d, bloom, kind, ...fill(kind, d) };
    });
  }

  async function save() {
    setBusy('save');
    setRefused('');
    try {
      await api.editQuestion(question._id, payload(draft));
      await onDone();
    } catch (err) {
      setRefused(err.message);
    } finally {
      setBusy('');
    }
  }

  async function run(what, fn) {
    setBusy(what);
    setRefused('');
    try {
      await fn();
      await onDone();
    } catch (err) {
      setRefused(err.message);
    } finally {
      setBusy('');
    }
  }

  const blanks = markers(draft.text);

  return (
    <>
      <PageHead
        title="Edit question"
        sub={`${question.topic || 'Untitled topic'} · ${LABEL[question.bloom] ?? question.bloom} · ${label(question.kind ?? 'mcq')}`}
        onBack={onClose}
        actions={(
          <>
            <button type="button" className="btn" disabled={Boolean(busy)} onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn pri" disabled={Boolean(busy)} onClick={save}>
              {busy === 'save' ? <><span className="spin" />Saving…</> : <><Icon name="check" size={13} />Save changes</>}
            </button>
          </>
        )}
      />

      {refused && (
        <div className="note bad" style={{ marginBottom: 14 }}>
          <Icon name="alert" size={15} />
          <span>{refused}</span>
        </div>
      )}

      <div className="stack">
        <Card className="pad-lg">
          <div className="cardhead">
            <h3>Level and interaction</h3>
            <span className="sub">The level picks the interaction, so these two controls are one decision.</span>
          </div>

          <div className="eyebrow">Bloom level</div>
          <div className="row" style={{ gap: 7, marginTop: 9 }}>
            {LEVELS.map((l) => (
              <button
                key={l}
                type="button"
                className={`tag ${draft.bloom === l ? '' : 'soft '}${l}`}
                aria-pressed={draft.bloom === l}
                onClick={() => pickLevel(l)}
              >
                {/* The tick, not a colour: the ramp already spends its six
                    shades saying which level this is, and the palest of them
                    cannot also carry "and it is the one you chose". */}
                {draft.bloom === l && <Icon name="check" size={11} />}
                {LABEL[l]}
              </button>
            ))}
          </div>

          <div className="eyebrow" style={{ marginTop: 20 }}>Change type</div>
          <div className="row" style={{ gap: 7, marginTop: 9 }}>
            {swaps.map((k) => (
              <button
                key={k}
                type="button"
                className="fpill"
                aria-pressed={draft.kind === k}
                onClick={() => pickKind(k)}
              >
                {label(k)}
              </button>
            ))}
          </div>

          <div className="said" style={{ marginTop: 16 }}>
            <span>
              {LABEL[draft.bloom]} is asked as {swaps.map(label).join(' or ')}, and nothing else is
              offered — the level chooses the interaction, which is what stops the Bloom tag being a
              label on a screen of identical multiple choice. To ask this a different way, retag the
              level, and expect to rewrite the question with it.
            </span>
          </div>

          {retagged && (
            <div className="note info" style={{ marginTop: 14 }}>
              <Icon name="info" size={15} />
              <span>
                Moving this from {LABEL[question.bloom]} to {LABEL[draft.bloom]}
                {draft.kind !== (question.kind ?? 'mcq')
                  ? `, so it becomes a “${label(draft.kind)}” and needs that shape filling in below.`
                  : '. The interaction it already has is asked at both levels, so it carries over.'}
              </span>
            </div>
          )}
        </Card>

        <Card className="pad-lg">
          <div className="cardhead">
            <h3>Question</h3>
            <span className="sub">
              {(draft.kind === 'blank' || draft.kind === 'cloze')
                ? `${blanks} ${BLANK_MARK} marker${blanks === 1 ? '' : 's'} in the text`
                : 'What the student reads first'}
            </span>
          </div>
          <textarea
            value={draft.text}
            aria-label="Question text"
            style={{ minHeight: 96 }}
            onChange={(e) => set({ text: e.target.value })}
          />
          {/* About the stem, never about the payload — that is the next card's
              job, and saying it twice teaches a teacher to stop reading both. */}
          <div className="hint">
            {draft.kind === 'truefalse'
              ? 'A statement, not a question — “Photosynthesis needs light.”, never “Does photosynthesis need light?”'
              : draft.kind === 'blank' || draft.kind === 'cloze'
                ? `Type ${BLANK_MARK} wherever a word is taken out. Everything else is read as it is written.`
                : 'Plain, exam-ready English. No markdown, no numbering inside the stem.'}
          </div>
        </Card>

        <Card className="pad-lg">
          <div className="cardhead">
            <h3>{label(draft.kind)}</h3>
            <span className="sub">{KIND_SHAPE[draft.kind]}</span>
          </div>
          <Body draft={draft} set={set} />
        </Card>

        <Card className="pad-lg">
          <div className="cardhead">
            <h3>Split, rewrite or discard</h3>
            <span className="sub">
              These act on the question as it is stored. Save first if the edits above are worth keeping.
            </span>
          </div>
          <div className="row" style={{ gap: 9 }}>
            <button
              type="button"
              className="btn"
              disabled={Boolean(busy)}
              onClick={() => run('split', () => api.splitQuestion(question._id))}
            >
              {busy === 'split' ? <><span className="spin" />Splitting…</> : <><Icon name="split" size={13} />Split into two</>}
            </button>
            <button
              type="button"
              className="btn"
              disabled={Boolean(busy)}
              onClick={() => run('regen', () => api.regenerateQuestion(question._id))}
            >
              {busy === 'regen' ? <><span className="spin" />Rewriting…</> : <><Icon name="wand" size={13} />Regenerate</>}
            </button>
            <span className="grow" />
            {/* A discarded question is opened to be fixed, so the control it
                needs is the way back into the bank, not a second discard. */}
            {question.status === 'discarded' ? (
              <button
                type="button"
                className="btn"
                disabled={Boolean(busy)}
                onClick={() => run('restore', () => api.restoreQuestion(question._id))}
              >
                {busy === 'restore' ? <><span className="spin" />Restoring…</> : <><Icon name="refresh" size={13} />Restore to the bank</>}
              </button>
            ) : (
              <button
                type="button"
                className="btn danger"
                disabled={Boolean(busy)}
                onClick={() => run('discard', () => api.discardQuestion(question._id))}
              >
                {busy === 'discard' ? <><span className="spin" />Discarding…</> : <><Icon name="trash" size={13} />Discard</>}
              </button>
            )}
          </div>
          <div className="hint">
            Splitting keeps the original in the discarded pile, so nothing here is a one-way door.
          </div>
        </Card>
      </div>
    </>
  );
}
