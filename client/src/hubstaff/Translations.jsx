/**
 * A chapter's translations into Hindi and Marathi, side by side with the
 * English (docs/API.md, Phase 6, "Languages (H12)" and "Professor: the review
 * queues").
 *
 *   GET   /api/hub/chapters/:id/translations
 *   POST  /api/hub/translations                     write one by hand (a draft)
 *   PATCH /api/hub/translations/:id                 edit a draft, checked again
 *   POST  /api/hub/translations/:id/approve         { confirmFlags? }
 *   POST  /api/hub/translations/:id/discard
 *   POST  /api/hub/chapters/:id/translations/generate   202, then /api/hub/translations/run/:runId
 *
 * Each item (a question, a lesson, an explanation, a hint, feedback on an
 * option) shows its English beside each translation, the translation's status,
 * who made it, whether it is out of date, and the check's findings split into
 * what blocks approval and what to check first. A 409 for flags is answered
 * with a second press that confirms them; a blocking finding needs an edit.
 * Every control hides when `canEdit` is false (an HOD).
 */

import { useCallback, useId, useMemo, useState } from 'react';

import { staffHub } from '../hub/hubApi.js';
import { DraftTag } from '../teach/ItemStats.jsx';
import { Button, Chip, Icon, Note, Segmented } from '../ui/index.jsx';
import { toast } from '../ui/toast.jsx';
import { Notes, QueueFailed, QueueLoading, RunLine, StaleRead, list, pickFilter, plural, saysRun, useQueue, useRun } from './QueueParts.jsx';

/** What each kind of item is called on screen. */
export const ITEM_KIND = {
  question: 'Question',
  lesson: 'Lesson',
  explanation: 'Explanation',
  hint: 'Hint',
  feedback: 'Option feedback',
};

/** A field of an item, named for a professor ("Step 2: working"). */
export function fieldName(key) {
  if (key === 'text') return 'Question';
  if (key === 'options') return 'Options';
  if (key === 'explanation') return 'Explanation';
  if (key === 'hint') return 'Hint';
  if (key === 'feedback') return 'Feedback';
  // Batch 8: a lesson's concept panel (an explanation step's term and the code stay in English).
  if (key === 'sections.intro') return 'Introduction';
  if (key === 'sections.facts') return 'Facts';
  if (key === 'sections.steps') return 'Explanation steps';
  if (key === 'sections.example.caption') return 'Code example: caption';
  if (key === 'sections.mistakes') return 'Common mistakes';
  const m =/^steps\.(\d+)\.(text|problem|steps|answer)$/.exec(key);
  if (m) {
    const n = Number(m[1]) + 1;
    return { text: `Step ${n}`, problem: `Step ${n}: the example`, steps: `Step ${n}: the working`, answer: `Step ${n}: the answer` }[m[2]];
  }
  return key;
}

const RUN_WORDS = {
  running: 'Translating',
  done: 'Translating finished',
  progress: (run) => [run.topic, run.written ? `${run.written} written` : ''].filter(Boolean).join(': '),
};

const per = (item, lang) => item.translations?.[lang] ?? { serving: null, drafts: [], shown: 'en' };
const stateOf = (item, lang) => {
  const t = per(item, lang);
  if (list(t.drafts).length) return 'review';
  if (t.serving?.stale) return 'stale';
  if (t.shown === lang) return 'shown';
  return 'none';
};
const firstText = (english) => {
  const v = Object.values(english ?? {})[0];
  return Array.isArray(v) ? v.join(' · ') : String(v ?? '');
};

/* ------------------------------------------------------------ the fields */

function Value({ value, lang }) {
  if (Array.isArray(value)) {
    return <ol className="hq-tr-list" lang={lang}>{value.map((v, i) => <li key={i}>{v || <span className="hq-tr-missing">Missing</span>}</li>)}</ol>;
  }
  if (value == null || value === '') return <span className="hq-tr-missing">Missing</span>;
  return <p className="hq-tr-text" lang={lang}>{value}</p>;
}

/** The English and one translation, field by field. */
function SideBySide({ english, fields, lang, langName }) {
  return (
    <div className="hq-tr-grid" role="table" aria-label={`English and ${langName}`}>
      <div className="hq-tr-row hq-tr-headrow" role="row">
        <span role="columnheader"><span className="sr-only">Part</span></span>
        <span role="columnheader">English</span>
        <span role="columnheader">{langName}</span>
      </div>
      {Object.entries(english ?? {}).map(([key, en]) => (
        <div key={key} className="hq-tr-row" role="row">
          <span role="rowheader" className="hq-tr-field">{fieldName(key)}</span>
          <div role="cell" className="hq-tr-en"><span className="hq-tr-k" aria-hidden="true">English</span><Value value={en} /></div>
          <div role="cell" className="hq-tr-xx"><span className="hq-tr-k" aria-hidden="true">{langName}</span><Value value={fields?.[key]} lang={lang} /></div>
        </div>
      ))}
    </div>
  );
}

/** Edit every field against its English: a box per text, one per option. */
function FieldsEditor({ english, initial, lang, langName, saveLabel, onSave, onCancel }) {
  const id = useId();
  const [fields, setFields] = useState(() => {
    const out = {};
    for (const [key, en] of Object.entries(english ?? {})) {
      const had = initial?.[key];
      out[key] = Array.isArray(en) ? en.map((_, i) => (Array.isArray(had) ? had[i] ?? '' : '')) : (typeof had === 'string' ? had : '');
    }
    return out;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key, value, i) => setFields((f) => ({ ...f, [key]: i == null ? value : f[key].map((v, n) => (n === i ? value : v)) }));

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await onSave(fields);
    } catch (err) {
      setError(err?.message || 'The server did not answer.');
    }
    setBusy(false);
  };

  return (
    <div className="hq-tr-edit">
      {Object.entries(english ?? {}).map(([key, en]) => (
        <fieldset key={key} className="hq-tr-edit-f">
          <legend>{fieldName(key)}</legend>
          {Array.isArray(en) ? en.map((e, i) => (
            <div key={i} className="hq-tr-edit-pair">
              <label htmlFor={`${id}-${key}-${i}`} className="hq-tr-edit-en">{i + 1}. {e}</label>
              {/* A sentence in a list (a fact, a step, a mistake) gets room to wrap; an option stays one line. */}
              {String(e).length > 80
                ? <textarea id={`${id}-${key}-${i}`} className="textarea" rows={Math.min(5, Math.ceil(String(e).length / 70))} lang={lang} value={fields[key][i]} onChange={(ev) => set(key, ev.target.value, i)} />
                : <input id={`${id}-${key}-${i}`} className="input" lang={lang} value={fields[key][i]} onChange={(ev) => set(key, ev.target.value, i)} />}
            </div>
          )) : (
            <div className="hq-tr-edit-pair">
              <label htmlFor={`${id}-${key}`} className="hq-tr-edit-en">{en}</label>
              <textarea id={`${id}-${key}`} className="textarea" rows={Math.min(8, Math.max(2, Math.ceil(String(en).length / 70)))} lang={lang} value={fields[key]} onChange={(ev) => set(key, ev.target.value)} />
            </div>
          )}
        </fieldset>
      ))}
      {error && <p className="hq-refused" role="alert"><Icon name="alert" size={15} /><span>{error}</span></p>}
      <div className="hq-edit-foot">
        <span className="t-meta">In {langName}. Saved as a draft and checked against the English.</span>
        <span className="cluster cluster-1">
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button size="sm" variant="primary" icon="check" busy={busy} onClick={save}>{saveLabel}</Button>
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ one translation */

function Findings({ findings }) {
  const blocking = list(findings).filter((f) => f.blocking);
  const flags = list(findings).filter((f) => !f.blocking);
  return (
    <>
      {blocking.length > 0 && (
        <Note tone="bad" icon="alert" role="note">
          <b>To fix before it can be approved.</b>
          <ul className="hq-findings">{blocking.map((f, i) => <li key={f.id ?? i}>{f.message}</li>)}</ul>
        </Note>
      )}
      {flags.length > 0 && (
        <Note tone="warn" icon="flag" role="note">
          <b>To check before approving.</b>
          <ul className="hq-findings">{flags.map((f, i) => <li key={f.id ?? i}>{f.message}</li>)}</ul>
        </Note>
      )}
    </>
  );
}

function Version({ t, item, lang, langName, canEdit, act, describedBy }) {
  const [mode, setMode] = useState('');
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [said, setSaid] = useState(null);
  const draft = t.status === 'draft';

  const approve = async () => {
    setBusy('approve');
    setSaid(null);
    try {
      // Approved, the item may leave the filter once the list is read again: the sentence is a toast.
      toast((await act.approve(t.id, { confirmFlags: confirm }))?.message);
    } catch (err) {
      // A 409 for flags alone: the next press confirms they were checked.
      if (err?.status === 409 && !confirm && t.flags > 0 && t.blocking === 0 && !t.stale) setConfirm(true);
      setSaid({ tone: 'bad', text: err?.message || 'The server did not answer.' });
    }
    setBusy('');
  };

  const discard = async () => {
    setBusy('discard');
    setSaid(null);
    try {
      toast((await act.discard(t.id))?.message);
    } catch (err) {
      setSaid({ tone: 'bad', text: err?.message || 'The server did not answer.' });
    }
    setBusy('');
  };

  return (
    <div className="hq-tr-version" data-status={t.status} data-stale={t.stale ? 'true' : undefined}>
      <p className="hq-who">
        {t.provenanceLabel === 'AI draft' ? <DraftTag /> : <span className="hq-tr-prov">{t.provenanceLabel}</span>}
        <span className={draft ? 'hq-who-draft' : undefined}>{t.statusLabel}</span>
        {t.model && <span className="hq-model mono">{t.model}</span>}
      </p>
      {t.stale && t.staleNote && t.status !== 'approved' && <Note tone="warn" role="note">{t.staleNote}</Note>}
      <Findings findings={t.findings} />

      {mode === 'edit' ? (
        <FieldsEditor
          english={item.english}
          initial={t.fields}
          lang={lang}
          langName={langName}
          saveLabel="Save the draft"
          onCancel={() => setMode('')}
          onSave={async (fields) => {
            // The check's findings are drawn on the draft itself; the reply's sentence is a toast.
            toast((await act.edit(t.id, fields))?.message);
            setMode('');
            setConfirm(false);
          }}
        />
      ) : (
        <SideBySide english={item.english} fields={t.fields} lang={lang} langName={langName} />
      )}

      {said && <p className={`hq-said hq-said-${said.tone}`} role="alert">{said.text}</p>}
      {canEdit && draft && mode !== 'edit' && (
        <div className="hq-actions">
          <Button aria-describedby={describedBy} size="sm" variant="primary" icon="check" busy={busy === 'approve'} disabled={Boolean(busy) || t.blocking > 0 || t.stale} onClick={approve}>
            {confirm ? 'Approve: I checked them' : 'Approve'}
          </Button>
          <Button aria-describedby={describedBy} size="sm" icon="edit" disabled={Boolean(busy)} onClick={() => { setSaid(null); setMode('edit'); }}>Edit</Button>
          <Button aria-describedby={describedBy} size="sm" variant="ghost" icon="trash" busy={busy === 'discard'} disabled={Boolean(busy)} onClick={discard}>Discard</Button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ one item */

function Item({ item, lang, langName, canEdit, act, open, onToggle }) {
  const panel = useId();
  const [writing, setWriting] = useState(false);
  const tid = useId();
  const t = per(item, lang);
  const drafts = list(t.drafts);
  const state = stateOf(item, lang);
  const words = {
    review: drafts.length === 1 ? 'A draft to review' : `${drafts.length} drafts to review`,
    stale: 'Out of date: students see the English',
    shown: `Students see the ${langName}`,
    none: 'Not translated: students see the English',
  }[state];

  return (
    <li className="hq-row hq-q hq-tr" data-open={open ? 'true' : undefined} data-state={state}>
      <button type="button" className="hq-q-main" aria-expanded={open} aria-controls={panel} onClick={onToggle}>
        <span className="hq-row-q">
          <span className="hq-meta">
            <Chip className="chip-line hq-kind">{ITEM_KIND[item.kind] ?? item.kind}</Chip>
            {item.kind === 'lesson' && item.version != null && <span>Version {item.version}</span>}
            {item.status === 'draft' && <span>Not approved yet</span>}
            <span className={`hq-tr-state hq-tr-state-${state}`}>{words}</span>
          </span>
          <span id={tid} className="hq-qtext hq-clamp">{firstText(item.english)}</span>
        </span>
        <Icon name="chevron" className="hq-chev" />
      </button>

      {open && (
        <div id={panel} className="hq-q-open">
          {item.note && <p className="hq-note">{item.note}</p>}
          {drafts.map((d) => <Version key={d.id} t={d} item={item} lang={lang} langName={langName} canEdit={canEdit} act={act} describedBy={tid} />)}
          {t.serving && (
            <>
              {drafts.length > 0 && <h5 className="hq-tr-sub">Approved now</h5>}
              <Version t={t.serving} item={item} lang={lang} langName={langName} canEdit={canEdit} act={act} describedBy={tid} />
            </>
          )}
          {!t.serving && !drafts.length && !writing && (
            <div className="hq-tr-only">
              <p className="hq-tr-only-head">English only, for now.</p>
              <SideBySide english={item.english} fields={{}} lang={lang} langName={langName} />
            </div>
          )}
          {writing ? (
            <FieldsEditor
              english={item.english}
              initial={t.serving?.fields ?? null}
              lang={lang}
              langName={langName}
              saveLabel="Save as a draft"
              onCancel={() => setWriting(false)}
              onSave={async (fields) => {
                // It becomes a draft to review, so it may leave the filter: the sentence is a toast.
                toast((await act.write({ itemKind: item.kind, itemId: item.id, language: lang, fields }))?.message);
                setWriting(false);
              }}
            />
          ) : canEdit && drafts.length === 0 && (
            <div className="hq-actions">
              <Button aria-describedby={tid} size="sm" icon={t.serving ? 'edit' : 'plus'} onClick={() => setWriting(true)}>
                {t.serving ? 'Write a new version' : `Write it in ${langName}`}
              </Button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/* ------------------------------------------------------------ the view */

/**
 * @param data   the GET reply
 * @param lang   'hi' | 'mr', and onLang
 * @param run    useRun's state for "Translate", or null
 * @param act    { write(body), edit(id, fields), approve(id, { confirmFlags }), discard(id) }: promises of the reply
 * @param opened item keys (`kind:id`) shown open
 */
export function TranslationsView({ data, lang, onLang, filter, onFilter, run, onTranslate, onClearRun, act, error, opened: openedFrom }) {
  const canEdit = data.canEdit === true;
  const items = list(data.items);
  // The languages translated into: those the reply counts (English is the original).
  const langs = list(data.languages).filter((l) => (data.counts ? data.counts[l.tag] : l.tag !== 'en'));
  const choice = langs.find((l) => l.tag === lang) ?? langs[0] ?? { tag: 'hi', name: 'Hindi', native: 'हिन्दी' };
  const c = data.counts?.[choice.tag] ?? {};
  // An item with a draft to review opens by itself, in either language, until it is toggled.
  const [toggled, setToggled] = useState(() => new Map((openedFrom ?? []).map((k) => [k, true])));
  const isOpen = (item, key) => (toggled.has(key) ? toggled.get(key) : stateOf(item, choice.tag) === 'review');
  const toggle = (item, key) => setToggled((t) => new Map(t).set(key, !isOpen(item, key)));

  const options = [
    { id: 'review', label: 'To review', count: items.filter((i) => stateOf(i, choice.tag) === 'review').length },
    { id: 'stale', label: 'Out of date', count: items.filter((i) => stateOf(i, choice.tag) === 'stale').length },
    { id: 'none', label: 'Not translated', count: items.filter((i) => stateOf(i, choice.tag) === 'none').length },
    { id: 'all', label: 'All', count: items.length },
  ];
  const shown = pickFilter(options, filter);
  const rows = shown === 'all' ? items : items.filter((i) => stateOf(i, choice.tag) === shown);
  const notes = data.notes ?? {};

  return (
    <div className="hq">
      <div className="hq-bar">
        <span className="cluster cluster-3">
          <Segmented
            label="Language"
            options={langs.map((l) => ({ id: l.tag, label: <span lang={l.tag}>{l.native}</span>, count: data.counts?.[l.tag]?.drafts }))}
            value={choice.tag}
            onChange={onLang}
          />
          <Segmented label="Show" options={options} value={shown} onChange={onFilter} />
        </span>
        {canEdit && (
          <Button variant="primary" icon="spark" busy={run?.phase === 'running'} onClick={() => onTranslate(choice.tag)}>
            Translate into {choice.name}
          </Button>
        )}
      </div>
      <p className="hq-sum">
        <span><b className="mono">{c.shown ?? 0}</b> of {plural(c.items ?? items.length, 'item')} shown in {choice.name}</span>
        <span><b className="mono">{c.drafts ?? 0}</b> {c.drafts === 1 ? 'draft' : 'drafts'} waiting</span>
        {(c.outOfDate ?? 0) > 0 && <span><b className="mono">{c.outOfDate}</b> out of date</span>}
      </p>
      <Notes lead={[notes.model].filter((s) => !saysRun(run, s))} rest={{ students: notes.students, terms: notes.terms, keys: notes.keys, stale: notes.stale }} label="What is translated, and when students see it" />
      <StaleRead error={error} />
      <RunLine state={run} words={RUN_WORDS} onClear={onClearRun} />

      {items.length === 0 ? (
        <div className="card hq-empty"><Icon name="bank" size={18} /><p>This chapter has no approved question or lesson to translate yet.</p></div>
      ) : rows.length === 0 ? (
        <div className="card hq-empty"><Icon name="check" size={18} /><p>Nothing here under “{options.find((o) => o.id === shown)?.label}”.</p></div>
      ) : (
        <ul className="card hq-list">
          {rows.map((i) => {
            const key = `${i.kind}:${i.id}`;
            return <Item key={`${choice.tag}:${key}`} item={i} lang={choice.tag} langName={choice.name} canEdit={canEdit} act={act} open={isOpen(i, key)} onToggle={() => toggle(i, key)} />;
          })}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ the tab */

export default function Translations({ contentId }) {
  const read = useCallback(() => staffHub.translations(contentId), [contentId]);
  const q = useQueue(read);
  const run = useRun(staffHub.translationRun);
  const [lang, setLang] = useState('hi');
  const [filter, setFilter] = useState('');

  const act = useMemo(() => {
    const after = (r) => { q.reload({ quiet: true }); return r; };
    return {
      write: (body) => staffHub.writeTranslation(body).then(after),
      edit: (id, fields) => staffHub.editTranslation(id, fields).then(after),
      approve: (id, opts) => staffHub.approveTranslation(id, opts).then(after),
      discard: (id) => staffHub.discardTranslation(id).then(after),
    };
  }, [q.reload]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!q.data) {
    if (q.error) return <QueueFailed error={q.error} onRetry={() => q.reload()} busy={q.loading} what="The translations" />;
    return <QueueLoading />;
  }

  return (
    <TranslationsView
      data={q.data}
      error={q.error}
      lang={lang}
      onLang={setLang}
      filter={filter}
      onFilter={setFilter}
      run={run.state}
      onClearRun={run.clear}
      onTranslate={(language) => run.start(
        (runId) => staffHub.translate(contentId, { languages: [language], runId }),
        { onDone: () => q.reload({ quiet: true }) },
      )}
      act={act}
    />
  );
}
