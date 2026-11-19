/**
 * The figure builder (batch 8): a professor describes a figure and the server
 * draws it. Used by the bank editor (a question's 'Figure' stimulus) and by a
 * lesson's "Add a figure" (hubstaff/Lessons.jsx).
 *
 *   GET  /api/figures/kinds     what the engines accept: families with their
 *                               default numbers, chart kinds, diagram shapes,
 *                               optics elements, pattern pieces, the caps
 *   POST /api/figures/preview   { spec, step? } -> { spec, figure, atStep? },
 *                               or 400 with one sentence
 *
 * A type is picked first and starts from a drawable example, so there is a
 * picture from the first second. Every change is previewed (debounced); a
 * refusal is the server's own sentence, shown beside the last drawing that
 * worked, never a guess made here. The same check runs when the question is
 * saved, so a figure that previews is a figure that saves.
 *
 * Steps (plot, geometry, diagram: parts lit up with a caption; stack: the
 * frames at each step with a caption) are what the projector and a lesson step
 * through. The parts to light up come from the last drawing, by the names the
 * server gave them.
 */

import { useEffect, useId, useRef, useState } from 'react';

import Figure from '../learn/Figure.jsx';
import { api } from '../lib/api.js';
import { Button, Dialog, Icon, Note, Segmented } from '../ui/index.jsx';
import {
  ChartForm, DiagramForm, FrameList, GeometryForm, Group, MoleculeForm, NumberlineForm, OpticsForm,
  PatternForm, PlotForm, StackForm, TextField, TimelineForm, CHART_KINDS,
} from './FigureForms.jsx';
import {
  CHART_LABEL, DEFAULT_LIMITS, HIGHLIGHT_STEPS, TYPES, TYPE_LABEL, draftKey, plural, specOut, starter, typeOfKey,
} from './figureSpec.js';
import '../styles/figedit.css';

const arr = (v) => (Array.isArray(v) ? v : []);

/* ------------------------------------------------------------- the kinds */

let kindsAsked = null;

/**
 * What the engines accept, asked once per page. `state` is 'loading', 'ready',
 * or 'absent' when the server has no figure routes (a 404 or 405): the figure
 * controls then hide, as a screen does for a route its server lacks.
 */
export function useFigureKinds(services = api) {
  const [got, setGot] = useState({ state: 'loading', kinds: null, error: '' });
  useEffect(() => {
    let live = true;
    const ask = services === api ? (kindsAsked ??= api.figureKinds()) : services.figureKinds?.() ?? Promise.reject(Object.assign(new Error('No figures'), { status: 404 }));
    ask.then(
      (kinds) => { if (live) setGot({ state: 'ready', kinds, error: '' }); },
      (err) => {
        if (services === api) kindsAsked = null;
        if (live) setGot({ state: err?.status === 404 || err?.status === 405 ? 'absent' : 'failed', kinds: null, error: err?.message ?? '' });
      },
    );
    return () => { live = false; };
  }, [services]);
  return got;
}

/* ------------------------------------------------------------- the preview */

/**
 * The server's drawing of `spec` (at `step`), asked a moment after the last
 * change. `figure` is the last drawing that worked, `fresh` says whether it is
 * this spec's, and `error` is the server's sentence for this spec.
 */
function usePreview(spec, step, services) {
  const key = spec ? JSON.stringify(spec) : '';
  const [got, setGot] = useState({ key: '', figure: null, spec: null, atStep: null, error: '', busy: false });
  const seq = useRef(0);
  const first = useRef(true);

  useEffect(() => {
    if (!key) return undefined;
    const n = ++seq.current;
    setGot((g) => ({ ...g, busy: true }));
    const wait = first.current ? 0 : 380;
    first.current = false;
    const t = setTimeout(() => {
      services.previewFigure(JSON.parse(key), step).then(
        (reply) => {
          if (n !== seq.current) return;
          setGot({ key, figure: reply.figure, spec: reply.spec, atStep: reply.atStep ?? null, error: '', busy: false });
        },
        (err) => {
          if (n !== seq.current) return;
          setGot((g) => ({ ...g, key, error: err?.message || 'The preview did not come back.', busy: false, status: err?.status }));
        },
      );
    }, wait);
    return () => clearTimeout(t);
  }, [key, step, services]);

  return { ...got, fresh: got.key === key && !got.error && Boolean(got.figure) };
}

/* ----------------------------------------------------------- the type glyphs */

/** Small line drawings, one per type, in the icon set's weight. */
const GLYPH = {
  plot: <><path d="M3 17h14M3 17V3" /><path d="M4.5 15c2.5-1 4-9 7-9 2.2 0 3.3 3.5 4.5 6" /></>,
  chart: <><path d="M3 17h14" /><path d="M6 17v-6M10 17V5M14 17v-9" strokeWidth="2.6" /></>,
  numberline: <><path d="M2 10h16M5 8v4M10 8v4M15 8v4" /><circle cx="12.5" cy="10" r="1.6" fill="currentColor" /></>,
  geometry: <><path d="M4 16 10 4l6 12Z" /><path d="M6.4 16a2.6 2.6 0 0 0-.8-2" /></>,
  timeline: <><path d="M2 12h16" /><circle cx="5" cy="12" r="1.4" /><circle cx="11" cy="12" r="1.4" /><circle cx="15.5" cy="12" r="1.4" /><path d="M5 10.6V6M11 10.6V8" /></>,
  diagram: <><rect x="3" y="2.5" width="7" height="5" rx="1.2" /><rect x="10" y="12.5" width="7" height="5" rx="1.2" /><path d="M6.5 7.5V15h3.5" /></>,
  molecule: <><path d="M10 2.8 16 6.3v7L10 16.9l-6-3.5v-7Z" /><path d="M10 2.8V0.5" /></>,
  pattern: <><circle cx="4.5" cy="10" r="2.3" /><rect x="8" y="7.7" width="4.6" height="4.6" /><path d="M15.6 7.4 18 12.4h-4.8Z" /></>,
  stack: <><rect x="4" y="13" width="12" height="4" rx="1" /><rect x="4" y="8" width="12" height="4" rx="1" /><rect x="4" y="3" width="12" height="4" rx="1" strokeDasharray="2 1.6" /></>,
};

export function TypeGlyph({ type, size = 20 }) {
  return (
    <svg className="fe-glyph" width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {GLYPH[type] ?? null}
    </svg>
  );
}

/** The nine types as a grid of choices. */
export function TypePicker({ value, onPick, types }) {
  const offered = TYPES.filter((t) => !types || types.includes(t.id));
  return (
    <div className="fe-types" role="radiogroup" aria-label="What kind of figure">
      {offered.map((t) => (
        <button
          key={t.id}
          type="button"
          role="radio"
          aria-checked={value === t.id}
          className="fe-type"
          onClick={() => onPick(t.id)}
        >
          <TypeGlyph type={t.id} />
          <span className="fe-type-t">
            <b>{t.label}</b>
            <small>{t.line}</small>
          </span>
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- the steps */

/**
 * The steps a figure walks through. Highlight types light up parts (named by
 * the last drawing); a stack sets the frames at each step.
 */
function StepsEditor({ spec, set, parts, limits, showing, onShow }) {
  const steps = arr(spec.steps);
  const stack = spec.type === 'stack';
  const full = steps.length >= limits.steps;
  const patch = (i, p) => set({ ...spec, steps: steps.map((s, j) => (j === i ? { ...s, ...p } : s)) });
  const remove = (i) => {
    set({ ...spec, steps: steps.filter((_, j) => j !== i) });
    if (showing > steps.length - 1) onShow(Math.max(0, steps.length - 1));
  };
  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    [next[i], next[j]] = [next[j], next[i]];
    set({ ...spec, steps: next });
  };
  const add = () => {
    const last = steps[steps.length - 1];
    const step = stack
      ? { frames: JSON.parse(JSON.stringify(arr(last?.frames ?? spec.frames))), caption: '' }
      : { highlight: [], caption: '' };
    set({ ...spec, steps: [...steps, step] });
    onShow(steps.length + 1);
  };

  return (
    <Group
      title="Steps"
      meta={steps.length ? `${steps.length} of ${limits.steps}` : 'Optional'}
    >
      <p className="hint">
        {stack
          ? 'Each step shows the stack as it stands then, with a caption. The projector and a lesson step through them in order.'
          : 'Each step lights up some parts of the figure, with a caption. The projector and a lesson step through them in order; the figure itself comes first.'}
      </p>
      {steps.length > 0 && (
        <ol className="fe-steps">
          {steps.map((s, i) => {
            const lit = new Set(arr(s.highlight).map((h) => String(h).toLowerCase()));
            return (
              // eslint-disable-next-line react/no-array-index-key
              <li key={i} className="fe-step" data-showing={showing === i + 1 ? 'true' : undefined}>
                <div className="fe-step-head">
                  <span className="fe-step-n">Step {i + 1}</span>
                  <span className="push cluster cluster-1">
                    <Button size="sm" variant={showing === i + 1 ? 'primary' : 'ghost'} icon="eye" aria-pressed={showing === i + 1} onClick={() => onShow(showing === i + 1 ? 0 : i + 1)}>
                      {showing === i + 1 ? 'Showing' : 'Show'}
                    </Button>
                    <Button size="sm" variant="ghost" icon="up" aria-label={`Move step ${i + 1} earlier`} disabled={i === 0} onClick={() => move(i, -1)} />
                    <Button size="sm" variant="ghost" icon="down" aria-label={`Move step ${i + 1} later`} disabled={i === steps.length - 1} onClick={() => move(i, 1)} />
                    <Button size="sm" variant="ghost" icon="close" aria-label={`Remove step ${i + 1}`} onClick={() => remove(i)} />
                  </span>
                </div>
                <TextField label="Caption" grow value={s.caption} placeholder={stack ? 'main calls fact(3).' : 'The angle at A.'} onChange={(v) => patch(i, { caption: v })} />
                {stack ? (
                  <FrameList frames={s.frames} max={limits.frames} title="The stack at this step" onChange={(frames) => patch(i, { frames })} />
                ) : parts.length ? (
                  <div className="fe-parts" role="group" aria-label={`Parts lit up in step ${i + 1}`}>
                    {parts.map((p) => {
                      const on = lit.has(String(p.part).toLowerCase());
                      return (
                        <button
                          key={p.part}
                          type="button"
                          className="fe-chip"
                          aria-pressed={on}
                          disabled={!on && lit.size >= limits.highlight}
                          onClick={() => patch(i, { highlight: on ? arr(s.highlight).filter((h) => String(h).toLowerCase() !== String(p.part).toLowerCase()) : [...arr(s.highlight), p.part] })}
                        >
                          {on && <Icon name="check" size={12} />}{p.label || p.part}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="t-meta">The parts to light up appear here once the figure is drawn.</p>
                )}
              </li>
            );
          })}
        </ol>
      )}
      <div>
        <Button size="sm" icon="plus" disabled={full} title={full ? `${limits.steps} steps is the most` : undefined} onClick={add}>
          {steps.length ? 'Add a step' : 'Add steps'}
        </Button>
      </div>
    </Group>
  );
}

/* ------------------------------------------------------------- the preview pane */

function Preview({ preview, step, onStep, stepCount }) {
  const shown = step > 0 && preview.atStep ? preview.atStep : preview.figure;
  const stale = !preview.fresh && Boolean(preview.figure);
  let status;
  if (preview.busy) status = <span className="fe-status" data-tone="busy"><span className="spinner" aria-hidden="true" />Drawing</span>;
  else if (preview.error) status = <span className="fe-status" data-tone="bad"><Icon name="alert" size={13} />Not drawn</span>;
  else if (preview.figure) status = <span className="fe-status" data-tone="ok"><Icon name="ok" size={13} />Drawn by the server</span>;

  return (
    <aside className="fe-preview" aria-label="Preview">
      <div className="fe-preview-head">
        <span className="eyebrow">Preview</span>
        <span aria-live="polite">{status}</span>
      </div>
      {stepCount > 0 && (
        // The figure itself, then each step lit up, as the projector shows them (Figure draws the caption).
        <Segmented
          label="Show the figure at"
          value={String(step)}
          onChange={(v) => onStep(Number(v))}
          options={[{ id: '0', label: 'Figure' }, ...Array.from({ length: stepCount }, (_, i) => ({ id: String(i + 1), label: `Step ${i + 1}` }))]}
        />
      )}
      {preview.error && (
        <p className="fe-refusal" role="status">
          <Icon name="alert" size={14} />
          <span>{preview.error}{stale ? ' The last drawing that worked is below.' : ''}</span>
        </p>
      )}
      {shown ? (
        <div className="fe-preview-fig" data-stale={stale ? 'true' : undefined}>
          <Figure figure={shown} />
        </div>
      ) : preview.error ? null : (
        <div className="skel fe-preview-skel" aria-label="Drawing the figure" />
      )}
      {preview.figure?.formula && (
        <p className="fe-formula">Formula <span className="mono">{preview.figure.formula}</span>, worked out from the structure</p>
      )}
    </aside>
  );
}

/* ------------------------------------------------------------- the builder */

/**
 * @param initial   a stored spec to edit, or null to start by picking a type
 * @param onState   ({ spec, figure, ok, busy, error }) after every change and
 *                  every preview: `ok` is true when the current spec drew
 * @param kinds     GET /api/figures/kinds (useFigureKinds)
 * @param services  { previewFigure } (lib/api.js), a stand-in in the gallery
 */
export function FigureBuilder({ initial = null, onState, kinds, services = api, types }) {
  const [key, setKey] = useState(() => draftKey(initial));
  const [drafts, setDrafts] = useState(() => (initial ? { [draftKey(initial)]: JSON.parse(JSON.stringify(initial)) } : {}));
  const [choosing, setChoosing] = useState(!initial);
  const [step, setStep] = useState(0);
  const spec = key ? drafts[key] ?? null : null;
  const sent = specOut(spec);
  const stepCount = arr(sent?.steps).length;
  const showStep = step > stepCount ? 0 : step;
  const preview = usePreview(sent, showStep, services);
  const limits = { ...DEFAULT_LIMITS, ...(kinds?.limits ?? {}) };
  const type = typeOfKey(key);
  const parts = arr(preview.figure?.parts);
  const formId = useId();

  useEffect(() => {
    onState?.({ spec: sent, figure: preview.fresh ? preview.figure : null, ok: preview.fresh, busy: preview.busy, error: preview.error });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(sent), preview.fresh, preview.busy, preview.error, preview.figure]);

  const set = (next) => setDrafts((d) => ({ ...d, [key]: next }));

  /** Switch to a type (or a chart kind, a geometry mode): its own draft if there is one, else its starter, keeping the title. */
  function go(nextKey) {
    const title = spec?.title ?? '';
    setDrafts((d) => (d[nextKey] ? d : { ...d, [nextKey]: { ...starter(nextKey), title } }));
    setKey(nextKey);
    setStep(0);
    setChoosing(false);
  }
  const pickType = (t) => go(t === 'chart' ? (key?.startsWith('chart.') ? key : 'chart.bar') : t === 'geometry' ? (key?.startsWith('geometry.') ? key : 'geometry.shapes') : t);

  if (!spec || choosing) {
    return (
      <div className="fe">
        <div className="stack stack-2">
          <p className="hint">Pick what to draw. It starts from an example you then change; the server draws it, with a description and its data, the same on every phone, the projector and printed pages.</p>
          <TypePicker value={type} onPick={pickType} types={types ?? kinds?.types} />
          {spec && <div><Button variant="ghost" size="sm" onClick={() => setChoosing(false)}>Keep the {TYPE_LABEL[type]?.toLowerCase()}</Button></div>}
        </div>
      </div>
    );
  }

  const formProps = { spec, set, parts, limits, kinds };
  let form;
  if (type === 'plot') form = <PlotForm {...formProps} />;
  else if (type === 'chart') form = <ChartForm {...formProps} />;
  else if (type === 'numberline') form = <NumberlineForm {...formProps} />;
  else if (key === 'geometry.optics') form = <OpticsForm {...formProps} />;
  else if (type === 'geometry') form = <GeometryForm {...formProps} />;
  else if (type === 'timeline') form = <TimelineForm {...formProps} />;
  else if (type === 'diagram') form = <DiagramForm {...formProps} />;
  else if (type === 'molecule') form = <MoleculeForm {...formProps} formula={preview.figure?.formula} />;
  else if (type === 'pattern') form = <PatternForm {...formProps} />;
  else form = <StackForm {...formProps} />;

  const stepped = HIGHLIGHT_STEPS.includes(type) || type === 'stack';
  const charts = arr(kinds?.charts).length ? kinds.charts : CHART_KINDS;

  return (
    <div className="fe">
      <div className="fe-head">
        <span className="fe-head-type"><TypeGlyph type={type} /><b>{TYPE_LABEL[type]}</b></span>
        <Button variant="ghost" size="sm" onClick={() => setChoosing(true)}>Change the type</Button>
      </div>
      {type === 'chart' && (
        <Segmented label="Kind of chart" value={spec.chart} onChange={(c) => go(`chart.${c}`)} options={charts.map((c) => ({ id: c, label: CHART_LABEL[c] ?? c }))} />
      )}
      {type === 'geometry' && (
        <Segmented
          label="What the drawing is"
          value={key}
          onChange={go}
          options={[{ id: 'geometry.shapes', label: 'Points, lines and shapes' }, { id: 'geometry.optics', label: 'Lens or mirror ray diagram' }]}
        />
      )}

      <div className="fe-cols">
        <Preview
          preview={preview}
          step={showStep}
          onStep={setStep}
          stepCount={stepCount}
        />
        <div className="fe-form" id={formId}>
          <div className="fe-line">
            <TextField label="Title, optional" grow value={spec.title} max={limits.title} onChange={(v) => set({ ...spec, title: v })} />
          </div>
          {form}
          {stepped && key !== 'geometry.optics' && (
            <StepsEditor spec={spec} set={set} parts={parts} limits={limits} showing={showStep} onShow={setStep} />
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- the dialog */

/**
 * The builder in its own wide dialog: the question editor (or a lesson) stays
 * calm, and the figure gets the room a preview beside a form needs.
 *
 * @param onUse(spec, figure)  the primary action; may return a promise (a
 *                             lesson saves here) and throw the server's sentence
 * @param children             extra fields under the builder (a lesson's words)
 */
export function FigureDialog({
  open, onOpenChange, initial = null, kinds, services = api, title = 'A figure', description,
  useLabel = 'Use this figure', onUse, children, types,
}) {
  const [state, setState] = useState({ spec: null, figure: null, ok: false, busy: false, error: '' });
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState('');
  const why = !state.spec ? 'Pick a kind of figure first'
    : state.busy ? 'Wait for the drawing'
      : !state.ok ? 'The figure has to draw first: fix what the preview says' : undefined;

  async function use() {
    setBusy(true);
    setRefused('');
    try {
      await onUse(state.spec, state.figure);
    } catch (err) {
      setRefused(err?.message || 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      locked={busy}
      title={title}
      description={description ?? 'Describe it and the server draws it. Nothing is drawn by hand, so every phone, the projector and printed pages show this same picture.'}
      footer={(
        <>
          <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" icon="check" busy={busy} disabled={Boolean(why)} title={why} onClick={use}>{useLabel}</Button>
        </>
      )}
    >
      <div className="stack">
        {open && <FigureBuilder initial={initial} kinds={kinds} services={services} onState={setState} types={types} />}
        {children}
        {refused && <Note tone="bad" role="alert">{refused}</Note>}
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------- a drawn figure, small */

/**
 * A figure as the professor's lists show it: the server's drawing, what kind it
 * is, the worked-out formula of a molecule, how many steps, and the server's
 * sentence when it could not be drawn (`ok: false`).
 */
export function FigureCard({ figure, spec, actions, compact = false }) {
  const type = figure?.type ?? spec?.type;
  const steps = figure?.stepCount ?? arr(spec?.steps).length;
  return (
    <figure className="fe-card" data-compact={compact ? 'true' : undefined}>
      <figcaption className="fe-card-head">
        <TypeGlyph type={type} size={16} />
        <span className="strong">{TYPE_LABEL[type] ?? 'Figure'}</span>
        {(figure?.title || spec?.title) && <span className="clip t-meta">{figure?.title || spec?.title}</span>}
        {steps > 0 && <span className="t-meta">· {plural(steps, 'step')}</span>}
        {actions && <span className="push cluster cluster-1">{actions}</span>}
      </figcaption>
      {figure?.ok === false ? (
        <p className="fe-card-bad"><Icon name="alert" size={14} /><span>This figure could not be drawn: {figure.reason ?? figure.description}</span></p>
      ) : figure ? (
        <div className="fe-card-body"><Figure figure={figure} /></div>
      ) : (
        <p className="fe-card-wait t-meta">The drawing appears here once the server has drawn it.</p>
      )}
      {figure?.formula && <p className="fe-formula">Formula <span className="mono">{figure.formula}</span>, worked out from the structure</p>}
    </figure>
  );
}

/* ------------------------------------------------------------- in the bank list */

/** "Graph" beside a figure question's kind in the bank list, with a molecule's formula. */
export function FigureTag({ q }) {
  if (q?.stimulus?.kind !== 'figure') return null;
  const type = q.figure?.type ?? q.stimulus.spec?.type;
  return (
    <span className="fe-qtag" title={q.figure?.description || undefined}>
      <TypeGlyph type={type} size={14} />
      {TYPE_LABEL[type] ?? 'Figure'}
      {q.figure?.formula && <span className="mono">{q.figure.formula}</span>}
    </span>
  );
}

/** The server's sentence when a figure question's figure could not be drawn (`figure.ok === false`). */
export function FigureProblem({ q }) {
  if (q?.figure?.ok !== false) return null;
  return (
    <span className="fe-qbad">
      <Icon name="alert" size={13} />
      <span>The figure could not be drawn: {q.figure.reason ?? q.figure.description}</span>
    </span>
  );
}
