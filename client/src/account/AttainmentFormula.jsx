/**
 * The attainment formula (Phase 4): how a class's report was made, and the
 * owner's editor for the formula in force.
 *
 *   GET /api/attainment/presets
 *   GET and PUT /api/classes/:id/attainment/config        (docs/API.md)
 *
 * A formula is data the server checks whole. Nothing here decides whether a
 * formula is valid: a bad field is the server's 400 sentence, and nothing is
 * saved. A saved version is never changed; a save makes the next one, and a
 * 409 means another save took that number first, so the formula is read again
 * and the same changes can be sent again.
 *
 * The examples are shown by their own names ("Example: ..."). None is called
 * a standard, and the default is never presented as the college's formula:
 * until the owner saves one, the report says it uses an example. Teacher
 * records have no switch: they never count (decision 3).
 *
 *   <FormulaPart />    the report's "How this report was made"
 *   <FormulaEditor />  the editor, drawn from what it is handed (gallery)
 *   default <FormulaEdit classId open onOpenChange current onSaved />
 *                      the editor with its reads and the save
 */

import { useEffect, useRef, useState } from 'react';

import { api } from '../lib/api.js';
import { Button, Chip, Dialog, Field, Icon, Note, Segmented } from '../ui/index.jsx';
import { dateOf, dayOf } from './dashParts.jsx';
import {
  COUNTABLE, Definitions, list, mk, num, plural, pctRule, typesFrom,
} from './StudentAttainment.jsx';

const ATTEMPTS = {
  final: 'Final attempts: an attempt followed by a retry is left out',
  best: 'The best attempt at each question, across attempts and rooms',
};
const STATUS = { waiting: 'Waiting', open: 'Open', paused: 'Paused', closed: 'Closed' };

/** "2026-11-19" is a calendar day in India's time, not a moment: read as local midnight so no zone moves it. */
function dayLabel(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day ?? ''));
  return m ? dayOf(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toISOString()) : '';
}

/** The name a formula goes by: an example's own name, or this class's version. */
export function formulaName(f) {
  if (!f) return 'No formula read';
  if (f.source === 'example') return f.preset?.name ?? 'The default example';
  return `This class's own formula, version ${f.version}`;
}

/** Where the formula came from, in a sentence. Never "standard", never the college's. */
export function formulaSource(f) {
  if (!f) return '';
  if (f.source === 'example') return 'No formula has been saved for this class, so the default example is used: an example to start from.';
  const when = f.savedAt ? `Saved ${dateOf(f.savedAt)}` : 'Saved';
  return `${when} by the class's owner.${f.preset?.name ? ` It is the same as “${f.preset.name}”.` : ''}`;
}

function levelsLine(levels) {
  const ls = list(levels);
  if (!ls.length) return '—';
  return `${ls.map((l) => `level ${l.level} from ${pctRule(l.minShare)}`).join(', ')} of the students counted; level 0 below ${pctRule(ls[0].minShare)}`;
}

/** A room weight, said with what became of its room. */
function weightLine(w) {
  if (w.found === false) return `${w.code ? `${w.code}, ` : ''}a room deleted or no longer readable: weight ${mk(w.weight)}, ignored`;
  return `${w.code ?? 'A room'} counts ${mk(w.weight)}${w.inReport === false ? ' (not in this report)' : ''}`;
}

/**
 * The formula's settings, as a definition list.
 * @param roomWeights  the view's weights ({ code, weight, found, inReport? })
 */
export function FormulaFacts({ config, roomWeights, evidenceTypes }) {
  const c = config ?? {};
  const ev = c.evidence ?? {};
  const types = typesFrom(evidenceTypes);
  const on = types.filter((t) => !t.never && ev[t.id]);
  const off = types.filter((t) => !t.never && ev[t.id] === false);
  const never = types.filter((t) => t.never);
  const weights = list(roomWeights ?? c.roomWeights);
  return (
    <dl className="atn-facts">
      <div><dt>A student attains</dt><dd>with {pctRule(c.studentThreshold)} of the marks possible</dd></div>
      <div><dt>Minimum counted answers</dt><dd>{c.minAnswers ?? '—'} per outcome or level; with fewer, “Not enough evidence”, never “Not attained”</dd></div>
      <div><dt>Class levels</dt><dd>{levelsLine(c.levels)}</dd></div>
      <div><dt>Counted</dt><dd>{on.length ? on.map((t) => t.label).join(', ') : 'Nothing'}</dd></div>
      <div><dt>Shown, not counted</dt><dd>{off.length ? off.map((t) => t.label).join(', ') : 'Nothing'}; polls are a count only</dd></div>
      {never.map((t) => <div key={t.id}><dt>{t.label}</dt><dd>Never counted, by any formula: shown under their own label</dd></div>)}
      <div><dt>Teacher records</dt><dd>Never counted: they have their own section</dd></div>
      <div><dt>Attempts</dt><dd>{ATTEMPTS[c.attempts] ?? c.attempts ?? '—'}</dd></div>
      <div>
        <dt>Room weights</dt>
        <dd>{weights.length ? weights.map(weightLine).join('; ') : 'None: every room counts 1'}</dd>
      </div>
    </dl>
  );
}

/**
 * How the report was made: the formula it used, the rooms it counted and the
 * methodology paragraph word for word.
 *
 * @param formula      the report's `formula` (with roomWeights carrying inReport)
 * @param methodology  the report's paragraph
 * @param rooms        the report's rooms, oldest first
 * @param evidenceTypes the report's `evidenceTypes`, for their descriptions
 * @param inForce      the config reply's formula, when it is newer than the report's
 * @param canEdit      from the config reply; null while it loads
 */
export function FormulaPart({
  formula, methodology, rooms, evidenceTypes, definitions, windowed, inForce, canEdit, onEdit, notice,
}) {
  const newer = inForce && formula && inForce.version !== formula.version;
  return (
    <section className="card ac-card atn-how" id="atn-how" aria-labelledby="atn-how-h">
      <div className="ac-head">
        <div className="sec">
          <h2 id="atn-how-h">How this report was made</h2>
          <p>The formula it used, the rooms it counted and the methodology, word for word.</p>
        </div>
        {canEdit === true && <Button icon="plan" onClick={onEdit}>Change the formula</Button>}
        {canEdit === false && (
          <span className="cl-ro"><Icon name="eye" />Read only: the professor who keeps this class sets its formula.</span>
        )}
      </div>

      <div className="atn-how-body">
        {notice && <Note tone={notice.tone} role="status">{notice.text}</Note>}
        {newer && (
          <Note tone="warn">Version {inForce.version} is in force now; this report was made under version {formula.version}. Read the report again to use it.</Note>
        )}
        <div className="atn-formula">
          <div className="atn-formula-name">
            <span className="eyebrow">Formula</span>
            <b>{formula?.source === 'example' ? `“${formulaName(formula)}”` : formulaName(formula)}</b>
            <span className="atn-formula-src">
              <Chip>{formula?.source === 'saved' ? `Version ${formula.version}, saved` : `Version ${formula?.version ?? 0}, example`}</Chip>
              <span>{formulaSource(formula)}</span>
            </span>
          </div>
          <FormulaFacts config={formula?.config} roomWeights={formula?.roomWeights} evidenceTypes={evidenceTypes} />
        </div>

        <div className="atn-method">
          <span className="eyebrow">Methodology</span>
          <p>{methodology || 'The report came without its methodology.'}</p>
        </div>

        <div className="atn-how-grid">
          <div className="stack stack-2">
            <span className="eyebrow">Rooms counted, oldest first</span>
            {list(rooms).length === 0 ? (
              <p className="atn-none atn-none-flat">No room {windowed ? 'in this window' : 'of this class'} could be counted.</p>
            ) : (
              <ul className="atn-rooms">
                {list(rooms).map((r) => (
                  <li key={r.roomId ?? r.code}>
                    <span className="mono">{r.code}</span>
                    <span className="clip">{r.title || 'Untitled room'}</span>
                    <span className="t-meta">{dayLabel(r.day) || dayOf(r.startedAt)}</span>
                    <span className="t-meta">{STATUS[r.status] ?? r.status}{num(r.weight) && r.weight !== 1 ? `, weight ${mk(r.weight)}` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="t-meta">Deleted rooms and rooms not opened for this class are not counted. A deleted room’s answers stay in its archive.</p>
          </div>
          <div className="stack stack-2">
            <span className="eyebrow">Evidence types</span>
            <ul className="atn-types">
              {typesFrom(evidenceTypes).map((t) => (
                <li key={t.id}>
                  <b>{t.label}{t.never && <small className="atn-never">Never counted</small>}</b>
                  <span>{t.description}</span>
                </li>
              ))}
              <li><b>Polls</b><span>Not marked: counted only as a number.</span></li>
              <li><b>Teacher records</b><span>Observations, wheel picks, hand tallies and activities: their own section, never part of a figure.</span></li>
            </ul>
          </div>
        </div>
        <Definitions definitions={definitions} />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- the editor */

const blankLevels = [{ minShare: '50' }, { minShare: '60' }, { minShare: '70' }];
const pctText = (share) => (num(share) === null ? '' : String(Number((share * 100).toFixed(1))));
const share3 = (text) => (String(text).trim() === '' ? null : Math.round(Number(text) * 10) / 1000);
const whole = (text) => (String(text).trim() === '' ? null : Number(text));

/** A formula's config as editable text fields. `weights` names the rooms by code where it can. */
export function toDraft(config, weights) {
  const c = config ?? {};
  const named = new Map(list(weights).map((w) => [w.roomId, w]));
  return {
    studentThreshold: pctText(c.studentThreshold),
    minAnswers: c.minAnswers == null ? '' : String(c.minAnswers),
    levels: list(c.levels).length ? c.levels.map((l) => ({ minShare: pctText(l.minShare) })) : blankLevels,
    evidence: { digital: Boolean(c.evidence?.digital), aiProvisional: Boolean(c.evidence?.aiProvisional), humanReviewed: Boolean(c.evidence?.humanReviewed) },
    attempts: c.attempts ?? 'final',
    roomWeights: list(c.roomWeights).map((w) => ({
      roomId: w.roomId, code: w.code ?? named.get(w.roomId)?.code ?? '', weight: String(w.weight), found: named.get(w.roomId)?.found ?? w.found,
    })),
  };
}

/** Text fields back to a config, as the server reads one. Bad text goes as is, for the server to name. */
function fromDraft(d) {
  return {
    studentThreshold: share3(d.studentThreshold),
    minAnswers: whole(d.minAnswers),
    levels: d.levels.map((l, i) => ({ level: i + 1, minShare: share3(l.minShare) })),
    evidence: { ...d.evidence },
    attempts: d.attempts,
    roomWeights: d.roomWeights.filter((w) => w.roomId || w.code).map((w) => (w.code ? { code: w.code, weight: whole(w.weight) } : { roomId: w.roomId, weight: whole(w.weight) })),
  };
}

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// A room is its id until its row is pointed at another room by code.
const weightKey = (rows) => list(rows).map((w) => `${w.roomId || w.code}:${Number(w.weight)}`).sort().join('|');

/**
 * The body a save sends: the preset when one was chosen, and in `config` only
 * the fields that differ from where the draft started (evidence key by key).
 */
export function bodyOf(start, draft, baseConfig) {
  const next = fromDraft(draft);
  const base = baseConfig ?? {};
  const changed = {};
  if (next.studentThreshold !== base.studentThreshold) changed.studentThreshold = next.studentThreshold;
  if (next.minAnswers !== base.minAnswers) changed.minAnswers = next.minAnswers;
  if (!sameJson(next.levels, list(base.levels).map((l) => ({ level: l.level, minShare: l.minShare })))) changed.levels = next.levels;
  const ev = {};
  for (const t of COUNTABLE) if (Boolean(next.evidence[t.id]) !== Boolean(base.evidence?.[t.id])) ev[t.id] = next.evidence[t.id];
  if (Object.keys(ev).length) changed.evidence = ev;
  if (next.attempts !== base.attempts) changed.attempts = next.attempts;
  if (weightKey(draft.roomWeights.filter((w) => w.roomId || w.code)) !== weightKey(base.roomWeights)) changed.roomWeights = next.roomWeights;
  const body = {};
  if (start !== 'current') body.preset = start;
  if (Object.keys(changed).length) body.config = changed;
  return body;
}

function NumberIn({ id, value, onChange, suffix, min, max, step, disabled, label }) {
  return (
    <span className="atn-num">
      <input
        id={id}
        className="input input-sm"
        type="number"
        inputMode="decimal"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
      />
      {suffix && <span>{suffix}</span>}
    </span>
  );
}

/**
 * The editor, drawn from what it is handed. It keeps its own draft; `current`
 * is the config reply and `presets` the presets reply.
 *
 * @param rooms     the class's rooms ({ code, title, startedAt }) for room weights; null while they load
 * @param saving    a save is in flight
 * @param result    { changed, message } after a save
 * @param error     { status, message } after a refused save (400, 403...)
 * @param conflict  { message } after a 409; the formula has been read again
 * @param onSave    (body) => void
 * @param onReapply () => void: send the last body again
 * @param start     gallery only: the draft to open with, as { from, draft }
 */
export function FormulaEditor({
  open, onOpenChange, current, presets, presetsError, rooms, saving, result, error, conflict, onSave, onReapply, start,
}) {
  const f = current?.formula;
  const presetList = list(presets?.presets);
  const [from, setFrom] = useState(start?.from ?? 'current');
  const [draft, setDraft] = useState(() => start?.draft ?? toDraft(f?.config, f?.roomWeights));
  const opened = useRef(false);

  // A fresh draft each time the editor opens, and after a save that changed
  // the formula; never after a 409, so the changes are kept to send again.
  useEffect(() => {
    if (open && !opened.current && !start) { setFrom('current'); setDraft(toDraft(f?.config, f?.roomWeights)); }
    opened.current = open;
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (result?.changed && !start) { setFrom('current'); setDraft(toDraft(f?.config, f?.roomWeights)); }
  }, [result]); // eslint-disable-line react-hooks/exhaustive-deps

  const preset = presetList.find((p) => p.id === from);
  const baseConfig = from === 'current' ? f?.config : preset?.config;
  const body = baseConfig ? bodyOf(from, draft, baseConfig) : {};
  const nothing = !body.preset && !body.config;
  const fields = presets?.fields ?? current?.fields ?? {};
  const has = (k) => !Object.keys(fields).length || k in fields;
  // Only the countable types get a switch: a re-vote after discussion is never counted (a save naming it is a 400).
  const types = typesFrom(presets?.evidenceTypes).filter((t) => !t.never);
  const never = typesFrom(presets?.evidenceTypes).filter((t) => t.never);
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const choose = (id) => {
    setFrom(id);
    const p = presetList.find((x) => x.id === id);
    setDraft(id === 'current' ? toDraft(f?.config, f?.roomWeights) : toDraft(p?.config));
  };
  const methodology = from === 'current' ? current?.methodology : preset?.methodology;
  const unknownFields = Object.keys(fields).filter((k) => !['studentThreshold', 'minAnswers', 'levels', 'evidence', 'attempts', 'roomWeights'].includes(k));
  const roomCodes = list(rooms).map((r) => r.code);

  return (
    <Dialog
      sheet
      open={open}
      onOpenChange={onOpenChange}
      locked={saving}
      title="The attainment formula"
      description={f ? `${formulaName(f)}. Version ${f.version} is in force.` : 'Reading the formula in force.'}
      footer={(
        <>
          <span className="atn-foot-say t-meta">
            {nothing ? 'Nothing changed yet.' : `Saves as version ${(f?.version ?? 0) + 1}. Earlier versions are kept.`}
          </span>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Close</Button>
          <Button variant="primary" icon="check" busy={saving} disabled={nothing || !f} onClick={() => onSave(body)}>Save as a new version</Button>
        </>
      )}
    >
      <div className="stack atn-edit">
        {result && <Note tone={result.changed ? 'ok' : undefined} role="status">{result.message}</Note>}
        {error && (
          <Note tone="bad" role="alert">
            {error.message}
            {error.status === 400 && ' Nothing was saved.'}
          </Note>
        )}
        {conflict && (
          <Note tone="warn" role="alert">
            <span>{conflict.message || 'Another save took that version number first.'}</span>{' '}
            <span>The formula was read again: version {f?.version ?? '—'} is in force now. Your changes are still here.</span>
            <span className="atn-note-act">
              <Button size="sm" variant="ink" icon="refresh" busy={saving} onClick={onReapply}>Apply my changes again</Button>
            </span>
          </Note>
        )}

        <fieldset className="atn-fs">
          <legend>Start from</legend>
          {presetsError && <Note tone="bad">The examples did not load: {presetsError}</Note>}
          <div className="atn-starts" role="radiogroup" aria-label="Start from">
            <label className="atn-start" data-on={from === 'current' || undefined}>
              <input type="radio" name="atn-start" checked={from === 'current'} onChange={() => choose('current')} />
              <span>
                <b>The formula in force</b>
                <small>{f ? (f.source === 'saved' ? formulaName(f) : `${formulaName(f)}, version ${f.version}`) : '—'}</small>
              </span>
            </label>
            {presetList.map((p) => (
              <label key={p.id} className="atn-start" data-on={from === p.id || undefined}>
                <input type="radio" name="atn-start" checked={from === p.id} onChange={() => choose(p.id)} />
                <span>
                  <b>{p.name}</b>
                  {p.description && <small>{p.description}</small>}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="atn-fs">
          <legend>Each student</legend>
          {has('studentThreshold') && (
            <Field label="A student attains an outcome with" htmlFor="atn-thr" hint="Of the marks possible on its questions, from the evidence counted. Above 0, up to 100.">
              <NumberIn id="atn-thr" value={draft.studentThreshold} onChange={(v) => set({ studentThreshold: v })} suffix="% of the marks" min={0.1} max={100} step={0.1} />
            </Field>
          )}
          {has('minAnswers') && (
            <Field label="At least" htmlFor="atn-min" hint="With fewer, a student is “Not enough evidence”, never “Not attained”. 1 to 100.">
              <NumberIn id="atn-min" value={draft.minAnswers} onChange={(v) => set({ minAnswers: v })} suffix="counted answers on the outcome" min={1} max={100} step={1} />
            </Field>
          )}
          {has('attempts') && (
            <Field label="Which attempts count">
              <Segmented
                label="Which attempts count"
                value={draft.attempts}
                onChange={(v) => set({ attempts: v })}
                options={[{ id: 'final', label: 'Final attempts' }, { id: 'best', label: 'Best attempt' }]}
              />
              <span className="hint">{ATTEMPTS[draft.attempts]}</span>
            </Field>
          )}
        </fieldset>

        {has('levels') && (
          <fieldset className="atn-fs">
            <legend>Class levels</legend>
            <p className="t-meta">The class reaches a level when at least this share of the students counted attained the outcome; level 0 below the first. Both must rise from one level to the next.</p>
            <ol className="atn-levels">
              {draft.levels.map((l, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <li key={i}>
                  <label htmlFor={`atn-lv-${i}`}>Level {i + 1} from</label>
                  <NumberIn
                    id={`atn-lv-${i}`}
                    value={l.minShare}
                    onChange={(v) => set({ levels: draft.levels.map((x, j) => (j === i ? { minShare: v } : x)) })}
                    suffix="% of students counted"
                    min={0.1}
                    max={100}
                    step={0.1}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="close"
                    aria-label={`Remove level ${i + 1}`}
                    disabled={draft.levels.length <= 1}
                    onClick={() => set({ levels: draft.levels.filter((_, j) => j !== i) })}
                  />
                </li>
              ))}
            </ol>
            <Button size="sm" variant="ghost" icon="plus" disabled={draft.levels.length >= 10} onClick={() => set({ levels: [...draft.levels, { minShare: '' }] })}>
              Add a level
            </Button>
          </fieldset>
        )}

        {has('evidence') && (
          <fieldset className="atn-fs">
            <legend>Evidence counted</legend>
            <ul className="atn-ev">
              {types.map((t) => (
                <li key={t.id}>
                  <label className="atn-check">
                    <input
                      type="checkbox"
                      checked={Boolean(draft.evidence[t.id])}
                      onChange={(e) => set({ evidence: { ...draft.evidence, [t.id]: e.target.checked } })}
                    />
                    <span>
                      <b>{t.label}</b>
                      {t.description && <small>{t.description}</small>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <p className="said atn-fixed">
              {never.map((t) => `${t.label} never count towards a mark, under any formula: every report shows them under their own label. `).join('')}
              Teacher records (observations, wheel picks, hand tallies, activities) never count towards a mark. They are reported in their own section.
            </p>
          </fieldset>
        )}

        {has('roomWeights') && (
          <fieldset className="atn-fs">
            <legend>Room weights</legend>
            <p className="t-meta">How much a room’s answers count beside the rest. Rooms not listed count 1.</p>
            {draft.roomWeights.length > 0 && (
              <ul className="atn-weights">
                {draft.roomWeights.map((w, i) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <li key={i}>
                    {w.found === false ? (
                      <span className="atn-weight-gone">
                        {w.code ? <><span className="mono">{w.code}</span>: deleted or no longer readable, so ignored</> : 'A room deleted or no longer readable, so ignored'}
                      </span>
                    ) : (
                      <select
                        className="select input-sm"
                        aria-label={`Room for weight ${i + 1}`}
                        value={w.code}
                        onChange={(e) => set({ roomWeights: draft.roomWeights.map((x, j) => (j === i ? { ...x, code: e.target.value, roomId: undefined } : x)) })}
                      >
                        <option value="">Choose a room</option>
                        {w.code && !roomCodes.includes(w.code) && <option value={w.code}>{w.code}</option>}
                        {list(rooms).map((r) => (
                          <option key={r.code} value={r.code}>{r.code} · {r.title || 'Untitled room'}{r.startedAt ? ` · ${dayOf(r.startedAt)}` : ''}</option>
                        ))}
                      </select>
                    )}
                    <NumberIn
                      value={w.weight}
                      label={`Weight of ${w.code || `room ${i + 1}`}`}
                      onChange={(v) => set({ roomWeights: draft.roomWeights.map((x, j) => (j === i ? { ...x, weight: v } : x)) })}
                      suffix="times"
                      min={0.001}
                      max={100}
                      step={0.5}
                    />
                    <Button variant="ghost" size="sm" icon="close" aria-label={`Remove the weight of ${w.code || `room ${i + 1}`}`} onClick={() => set({ roomWeights: draft.roomWeights.filter((_, j) => j !== i) })} />
                  </li>
                ))}
              </ul>
            )}
            <Button
              size="sm"
              variant="ghost"
              icon="plus"
              disabled={rooms === null || draft.roomWeights.length >= 100}
              onClick={() => set({ roomWeights: [...draft.roomWeights, { code: '', weight: '2' }] })}
            >
              {rooms === null ? 'Reading the class’s rooms' : 'Weigh a room'}
            </Button>
          </fieldset>
        )}

        {unknownFields.length > 0 && (
          <Note>{unknownFields.map((k) => fields[k]).join(' ')} {plural(unknownFields.length, 'field')} cannot be changed here yet; saving keeps {unknownFields.length === 1 ? 'it' : 'them'} as they are.</Note>
        )}

        <div className="atn-method atn-method-edit">
          <span className="eyebrow">{from === 'current' ? 'The methodology of the formula in force' : 'The methodology of this example'}</span>
          {!nothing && <p className="t-meta">Your changes are not in it yet: the saved version’s own paragraph is written when you save.</p>}
          <p>{methodology || '—'}</p>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * The editor with its reads and its save. `current` is the config reply the
 * report page already holds; `onSaved(reply)` hands back the new one.
 * `onReread()` reads the config again (after a 409) and answers it.
 */
export default function FormulaEdit({ classId, open, onOpenChange, current, onSaved, onReread }) {
  const [presets, setPresets] = useState(null);
  const [presetsError, setPresetsError] = useState('');
  const [rooms, setRooms] = useState(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [conflict, setConflict] = useState(null);
  const last = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    setResult(null); setError(null); setConflict(null);
    if (!presets) {
      api.attainmentPresets().then((p) => { if (alive) setPresets(p); }, (err) => { if (alive) setPresetsError(err.message); });
    }
    api.listSessions().then(
      (res) => {
        if (!alive) return;
        const mine = list(res?.rooms ?? res).filter((r) => r.classId === classId);
        mine.sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
        setRooms(mine);
      },
      () => { if (alive) setRooms([]); },
    );
    return () => { alive = false; };
  }, [open, classId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(body) {
    last.current = body;
    setSaving(true); setResult(null); setError(null); setConflict(null);
    try {
      const reply = await api.saveAttainmentConfig(classId, body);
      setResult({ changed: Boolean(reply?.changed), message: reply?.message ?? '' });
      onSaved?.(reply);
    } catch (err) {
      if (err.status === 409) {
        setConflict({ message: err.message });
        await onReread?.();
      } else {
        setError({ status: err.status, message: err.message });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormulaEditor
      open={open}
      onOpenChange={onOpenChange}
      current={current}
      presets={presets}
      presetsError={presetsError}
      rooms={rooms}
      saving={saving}
      result={result}
      error={error}
      conflict={conflict}
      onSave={save}
      onReapply={() => last.current && save(last.current)}
    />
  );
}
