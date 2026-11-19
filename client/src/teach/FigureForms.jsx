/**
 * One form per figure type (batch 8), for the figure builder.
 *
 * Each form edits the spec as the server reads it (GET /api/figures/kinds and
 * server/src/figures/spec.js) and nothing more. It never decides that a spec is
 * wrong: the builder previews every change, and the server's one sentence says
 * what to fix. A number box sends a number when what is typed reads as one,
 * and the text as typed when it does not, so the sentence can name it.
 *
 * Calm by default: the fields every figure of a type needs are shown, and the
 * rest sit behind "Also" buttons and "More" disclosures, so a straight line
 * is four boxes and not forty.
 */

import { useEffect, useId, useState } from 'react';

import { Button, Icon, Segmented } from '../ui/index.jsx';
import {
  ARROW_LABEL, CHART_LABEL, FAMILY, LAYOUT_LABEL, OPTICS_LABEL, SHAPE_LABEL,
  dateText, dropFromSteps, idsIn, nextId, readDate, readNumber,
} from './figureSpec.js';

const arr = (v) => (Array.isArray(v) ? v : []);
const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);

/* ------------------------------------------------------------ the fields */

/** A number box that keeps what is being typed ("-", "2.") and sends a number once it reads as one. */
export function NumField({ label, value, onChange, hint, wide = false, min, max, step }) {
  const id = useId();
  const [text, setText] = useState(value === undefined || value === null ? '' : String(value));
  // Follow the value when it changes from outside (a reset, a family's defaults).
  useEffect(() => {
    setText((t) => (readNumber(t) === value || (value === undefined && t.trim() === '') ? t : value === undefined || value === null ? '' : String(value)));
  }, [value]);
  return (
    <label className="fe-f" data-wide={wide ? 'true' : undefined} htmlFor={id}>
      <span className="fe-f-k">{label}</span>
      <input
        id={id}
        className="input input-sm num"
        inputMode="decimal"
        value={text}
        min={min}
        max={max}
        step={step}
        title={hint}
        onChange={(e) => { setText(e.target.value); onChange(readNumber(e.target.value)); }}
      />
    </label>
  );
}

export function TextField({ label, value, onChange, placeholder, mono = false, grow = false, max }) {
  const id = useId();
  return (
    <label className="fe-f" data-grow={grow ? 'true' : undefined} htmlFor={id}>
      <span className="fe-f-k">{label}</span>
      <input
        id={id}
        className={`input input-sm${mono ? ' mono' : ''}`}
        value={value ?? ''}
        placeholder={placeholder}
        maxLength={max ? max * 2 : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

export function Pick({ label, value, onChange, options, grow = false }) {
  const id = useId();
  return (
    <label className="fe-f" data-grow={grow ? 'true' : undefined} htmlFor={id}>
      <span className="fe-f-k">{label}</span>
      <select id={id} className="select input-sm" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function Flag({ label, checked, onChange }) {
  return (
    <label className="check fe-flag">
      <input type="checkbox" checked={Boolean(checked)} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** A disclosure for the fields most figures never need. */
export function More({ label = 'More', children }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <div className="fe-more">
      <button type="button" className="fe-more-btn" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        <Icon name={open ? 'chevron' : 'chevronRight'} size={14} />{label}
      </button>
      {open && <div id={id} className="fe-more-body">{children}</div>}
    </div>
  );
}

/** A group: a small heading, what it holds, and its rows. */
export function Group({ title, meta, children, action }) {
  return (
    <section className="fe-group" aria-label={title}>
      <header className="fe-group-head">
        <h5>{title}</h5>
        {meta && <span className="t-meta">{meta}</span>}
        {action && <span className="push">{action}</span>}
      </header>
      {children}
    </section>
  );
}

/**
 * A list of rows of one kind, with a remove button per row and an add button
 * that greys out at the server's cap. `row(item, i, patch)` draws one row.
 */
export function Rows({ title, items, max, addLabel, onAdd, onRemove, row, noun, min = 0, hint }) {
  const list = arr(items);
  const full = max != null && list.length >= max;
  return (
    <Group title={title} meta={max != null ? `${list.length} of ${max}` : null}>
      {hint && <p className="hint">{hint}</p>}
      {list.length > 0 && (
        <ol className="fe-rows">
          {list.map((it, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <li key={it?.id ?? i} className="fe-row">
              <span className="fe-row-n mono" aria-hidden="true">{i + 1}</span>
              <div className="fe-row-body">{row(it, i)}</div>
              <Button
                variant="ghost" size="sm" icon="close"
                aria-label={`Remove ${noun} ${i + 1}`}
                disabled={list.length <= min}
                title={list.length <= min ? `The figure needs at least ${min}` : undefined}
                onClick={() => onRemove(i)}
              />
            </li>
          ))}
        </ol>
      )}
      <div>
        <Button size="sm" icon="plus" disabled={full} title={full ? `${max} is the most a figure takes` : undefined} onClick={onAdd}>{addLabel}</Button>
      </div>
    </Group>
  );
}

/** The optional lists a type has, offered as quiet "add" buttons until one is in use. */
function Also({ items }) {
  const unused = items.filter((it) => !it.used);
  if (!unused.length) return null;
  return (
    <div className="fe-also">
      <span className="t-meta">Also</span>
      {unused.map((it) => <Button key={it.label} size="sm" variant="ghost" icon="plus" onClick={it.onAdd}>{it.label}</Button>)}
    </div>
  );
}

/* ------------------------------------------------------------ list helpers */

/** Patch item i of list `key`, remove it, or add one: each returns the next spec. */
const at = (spec, key, i, patch) => ({ ...spec, [key]: arr(spec[key]).map((it, j) => (j === i ? { ...it, ...patch } : it)) });
const without = (spec, key, i) => {
  const gone = arr(spec[key])[i];
  const next = { ...spec, [key]: arr(spec[key]).filter((_, j) => j !== i) };
  return gone?.id ? dropFromSteps(next, [gone.id]) : next;
};
const plus = (spec, key, item) => ({ ...spec, [key]: [...arr(spec[key]), item] });

/** The server's own words for a part (an equation, "A (1, 3)"), from the last preview. */
const partSaid = (parts, id) => arr(parts).find((p) => String(p.part).toLowerCase() === String(id ?? '').toLowerCase())?.label;

function Said({ text }) {
  return text ? <p className="fe-said"><Icon name="ok" size={12} />Drawn as {text}</p> : null;
}

/* -------------------------------------------------------------------- plot */

function familyDefaults(kinds, family) {
  return { ...(kinds?.families?.[family] ?? {}) };
}

export function PlotForm({ spec, set, parts, limits, kinds }) {
  const families = Object.keys(kinds?.families ?? FAMILY);
  const axisRow = (key, name) => (
    <div className="fe-line">
      <span className="fe-axis mono" aria-hidden="true">{name}</span>
      <NumField label={`${name} from`} value={spec[key]?.min} onChange={(v) => set({ ...spec, [key]: { ...spec[key], min: v } })} />
      <NumField label="to" value={spec[key]?.max} onChange={(v) => set({ ...spec, [key]: { ...spec[key], max: v } })} />
      <TextField label="Name on the axis" grow value={spec[key]?.label} placeholder={name} onChange={(v) => set({ ...spec, [key]: { ...spec[key], label: v } })} />
    </div>
  );
  const setStep = (key, v) => {
    const a = { ...spec[key] };
    if (v === undefined) delete a.step; else a.step = v;
    set({ ...spec, [key]: a });
  };

  return (
    <>
      <Group title="Axes">
        {axisRow('x', 'x')}
        {axisRow('y', 'y')}
        <More label="Tick spacing and grid">
          <div className="fe-line">
            <NumField label="x ticks every" value={spec.x?.step} onChange={(v) => setStep('x', v)} />
            <NumField label="y ticks every" value={spec.y?.step} onChange={(v) => setStep('y', v)} />
            <Flag label="Show the grid" checked={spec.grid !== false} onChange={(v) => set({ ...spec, grid: v })} />
          </div>
        </More>
      </Group>

      <Rows
        title="Functions"
        noun="function"
        items={spec.functions}
        max={limits.functions}
        addLabel="Add a function"
        onAdd={() => set(plus(spec, 'functions', { id: nextId('f', idsIn(spec)), family: 'linear', params: familyDefaults(kinds, 'linear'), label: '' }))}
        onRemove={(i) => set(without(spec, 'functions', i))}
        row={(f, i) => {
          const patch = (p) => set(at(spec, 'functions', i, p));
          const pickFamily = (family) => {
            const next = { ...f, family };
            if (family === 'step') {
              delete next.params;
              next.pieces = arr(f.pieces).length ? f.pieces : [{ from: -2, to: 0, y: 1 }, { from: 0, to: 2, y: 2 }];
            } else {
              delete next.pieces;
              next.params = familyDefaults(kinds, family);
            }
            set({ ...spec, functions: spec.functions.map((g, j) => (j === i ? next : g)) });
          };
          return (
            <>
              <div className="fe-line">
                <Pick label="Kind" value={f.family} onChange={pickFamily} options={families.map((k) => ({ id: k, label: FAMILY[k]?.label ?? cap(k) }))} />
                <TextField label="Label" value={f.label} placeholder="f" onChange={(v) => patch({ label: v })} />
              </div>
              {f.family !== 'step' ? (
                <>
                  <p className="fe-eq mono">{FAMILY[f.family]?.form}</p>
                  <div className="fe-line">
                    {Object.keys(kinds?.families?.[f.family] ?? f.params ?? {}).map((k) => (
                      <NumField key={k} label={k} value={f.params?.[k]} onChange={(v) => patch({ params: { ...f.params, [k]: v } })} />
                    ))}
                  </div>
                </>
              ) : (
                <StepPieces pieces={f.pieces} max={limits.stepPieces} onChange={(pieces) => patch({ pieces })} />
              )}
              <Said text={partSaid(parts, f.id)} />
              <More label="Range and line">
                <div className="fe-line">
                  <NumField label="Only from x" value={f.domain?.[0]} onChange={(v) => patch({ domain: v === undefined && f.domain?.[1] === undefined ? undefined : [v ?? '', f.domain?.[1] ?? ''] })} />
                  <NumField label="to x" value={f.domain?.[1]} onChange={(v) => patch({ domain: v === undefined && f.domain?.[0] === undefined ? undefined : [f.domain?.[0] ?? '', v ?? ''] })} />
                  <Flag label="Dashed" checked={f.dashed} onChange={(v) => patch({ dashed: v })} />
                </div>
              </More>
            </>
          );
        }}
      />

      {(arr(spec.points).length > 0) && <PlotPoints spec={spec} set={set} parts={parts} limits={limits} />}
      {arr(spec.segments).length > 0 && <PlotSegments spec={spec} set={set} limits={limits} />}
      {arr(spec.shade).length > 0 && <PlotShade spec={spec} set={set} limits={limits} />}
      <Also
        items={[
          { label: 'A point', used: arr(spec.points).length > 0, onAdd: () => set(plus(spec, 'points', { id: nextId('p', idsIn(spec)), x: 1, y: 1, label: '' })) },
          { label: 'A segment', used: arr(spec.segments).length > 0, onAdd: () => set(plus(spec, 'segments', { id: nextId('s', idsIn(spec)), from: [0, 0], to: [1, 1], label: '' })) },
          { label: 'Shading', used: arr(spec.shade).length > 0, onAdd: () => set(plus(spec, 'shade', { id: nextId('sh', idsIn(spec)), from: 0, to: 1, label: '' })) },
        ]}
      />
    </>
  );
}

function StepPieces({ pieces, max, onChange }) {
  const list = arr(pieces);
  const set = (i, p) => onChange(list.map((q, j) => (j === i ? { ...q, ...p } : q)));
  return (
    <div className="fe-sub">
      {list.map((p, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <div key={i} className="fe-line">
          <NumField label="From x" value={p.from} onChange={(v) => set(i, { from: v })} />
          <NumField label="to x" value={p.to} onChange={(v) => set(i, { to: v })} />
          <NumField label="Height y" value={p.y} onChange={(v) => set(i, { y: v })} />
          <Flag label="Left end filled" checked={p.fromClosed} onChange={(v) => set(i, { fromClosed: v })} />
          <Flag label="Right end filled" checked={p.toClosed} onChange={(v) => set(i, { toClosed: v })} />
          <Button variant="ghost" size="sm" icon="close" aria-label={`Remove piece ${i + 1}`} disabled={list.length <= 1} onClick={() => onChange(list.filter((_, j) => j !== i))} />
        </div>
      ))}
      <div>
        <Button
          size="sm" variant="ghost" icon="plus"
          disabled={list.length >= max}
          onClick={() => {
            const last = list[list.length - 1];
            const from = typeof last?.to === 'number' ? last.to : 0;
            onChange([...list, { from, to: from + 1, y: 0 }]);
          }}
        >
          Add a piece
        </Button>
      </div>
    </div>
  );
}

function PlotPoints({ spec, set, parts, limits }) {
  return (
    <Rows
      title="Points"
      noun="point"
      items={spec.points}
      max={limits.plotPoints}
      addLabel="Add a point"
      onAdd={() => set(plus(spec, 'points', { id: nextId('p', idsIn(spec)), x: 0, y: 0, label: '' }))}
      onRemove={(i) => set(without(spec, 'points', i))}
      row={(p, i) => (
        <>
          <div className="fe-line">
            <NumField label="x" value={p.x} onChange={(v) => set(at(spec, 'points', i, { x: v }))} />
            <NumField label="y" value={p.y} onChange={(v) => set(at(spec, 'points', i, { y: v }))} />
            <TextField label="Label" value={p.label} placeholder="A" onChange={(v) => set(at(spec, 'points', i, { label: v }))} />
            <Flag label="Open circle" checked={p.open} onChange={(v) => set(at(spec, 'points', i, { open: v }))} />
          </div>
          <Said text={partSaid(parts, p.id)} />
        </>
      )}
    />
  );
}

function PlotSegments({ spec, set, limits }) {
  const end = (g, i, which, k, v) => {
    const pair = [...arr(g[which])];
    pair[k] = v ?? '';
    set(at(spec, 'segments', i, { [which]: pair }));
  };
  return (
    <Rows
      title="Segments"
      noun="segment"
      items={spec.segments}
      max={limits.segments}
      addLabel="Add a segment"
      onAdd={() => set(plus(spec, 'segments', { id: nextId('s', idsIn(spec)), from: [0, 0], to: [1, 1], label: '' }))}
      onRemove={(i) => set(without(spec, 'segments', i))}
      row={(g, i) => (
        <>
          <div className="fe-line">
            <NumField label="From x" value={g.from?.[0]} onChange={(v) => end(g, i, 'from', 0, v)} />
            <NumField label="y" value={g.from?.[1]} onChange={(v) => end(g, i, 'from', 1, v)} />
            <NumField label="To x" value={g.to?.[0]} onChange={(v) => end(g, i, 'to', 0, v)} />
            <NumField label="y" value={g.to?.[1]} onChange={(v) => end(g, i, 'to', 1, v)} />
          </div>
          <div className="fe-line">
            <TextField label="Label" grow value={g.label} onChange={(v) => set(at(spec, 'segments', i, { label: v }))} />
            <Flag label="Dashed" checked={g.dashed} onChange={(v) => set(at(spec, 'segments', i, { dashed: v }))} />
            <Flag label="Arrowhead" checked={g.arrow} onChange={(v) => set(at(spec, 'segments', i, { arrow: v }))} />
          </div>
        </>
      )}
    />
  );
}

function PlotShade({ spec, set, limits }) {
  const fns = arr(spec.functions).filter((f) => f.family !== 'step');
  return (
    <Rows
      title="Shading"
      noun="shaded region"
      items={spec.shade}
      max={limits.shades}
      addLabel="Add shading"
      onAdd={() => set(plus(spec, 'shade', { id: nextId('sh', idsIn(spec)), from: 0, to: 1, label: '' }))}
      onRemove={(i) => set(without(spec, 'shade', i))}
      row={(h, i) => (
        <div className="fe-line">
          <NumField label="From x" value={h.from} onChange={(v) => set(at(spec, 'shade', i, { from: v }))} />
          <NumField label="to x" value={h.to} onChange={(v) => set(at(spec, 'shade', i, { to: v }))} />
          <Pick
            label="Under"
            value={h.under ?? ''}
            onChange={(v) => set(at(spec, 'shade', i, { under: v || undefined }))}
            options={[{ id: '', label: 'The whole height' }, ...fns.map((f, j) => ({ id: f.id, label: f.label || `Function ${spec.functions.indexOf(f) + 1 || j + 1}` }))]}
          />
          <TextField label="Label" value={h.label} onChange={(v) => set(at(spec, 'shade', i, { label: v }))} />
        </div>
      )}
    />
  );
}

/* ------------------------------------------------------------------- chart */

export function ChartForm({ spec, set, limits }) {
  const axis = (key, v) => set({ ...spec, [key]: { ...(spec[key] ?? {}), ...v } });
  const axisNames = spec.chart !== 'pie' && (
    <div className="fe-line">
      <TextField label="Across the bottom" grow value={spec.x?.label} onChange={(v) => axis('x', { label: v })} />
      {spec.chart !== 'dot' && spec.chart !== 'box' && (
        <TextField label="Up the side" grow value={spec.y?.label} onChange={(v) => axis('y', { label: v })} />
      )}
    </div>
  );

  if (spec.chart === 'bar' || spec.chart === 'line') {
    return (
      <>
        <SeriesGrid spec={spec} set={set} limits={limits} />
        <Group title="Axes">
          {axisNames}
          <More label="Range up the side">
            <div className="fe-line">
              <NumField label="Lowest" value={spec.y?.min} onChange={(v) => axis('y', { min: v })} />
              <NumField label="Highest" value={spec.y?.max} onChange={(v) => axis('y', { max: v })} />
            </div>
          </More>
        </Group>
      </>
    );
  }

  if (spec.chart === 'pie') {
    return (
      <Rows
        title="Slices"
        noun="slice"
        items={spec.slices}
        max={limits.slices}
        min={2}
        addLabel="Add a slice"
        onAdd={() => set(plus(spec, 'slices', { label: '', value: 10 }))}
        onRemove={(i) => set(without(spec, 'slices', i))}
        row={(p, i) => (
          <div className="fe-line">
            <TextField label="Label" grow value={p.label} onChange={(v) => set(at(spec, 'slices', i, { label: v }))} />
            <NumField label="Value" value={p.value} onChange={(v) => set(at(spec, 'slices', i, { value: v }))} />
          </div>
        )}
      />
    );
  }

  if (spec.chart === 'histogram') {
    return (
      <>
        <Rows
          title="Bins"
          noun="bin"
          items={spec.bins}
          max={limits.bins}
          min={1}
          hint="Each bin starts where the one before it ends."
          addLabel="Add a bin"
          onAdd={() => {
            const last = arr(spec.bins)[arr(spec.bins).length - 1];
            const width = typeof last?.to === 'number' && typeof last?.from === 'number' ? last.to - last.from : 10;
            const from = typeof last?.to === 'number' ? last.to : 0;
            set(plus(spec, 'bins', { from, to: from + width, count: 0 }));
          }}
          onRemove={(i) => set(without(spec, 'bins', i))}
          row={(b, i) => (
            <div className="fe-line">
              <NumField label="From" value={b.from} onChange={(v) => set(at(spec, 'bins', i, { from: v }))} />
              <NumField label="to" value={b.to} onChange={(v) => set(at(spec, 'bins', i, { to: v }))} />
              <NumField label="How many" value={b.count} onChange={(v) => set(at(spec, 'bins', i, { count: v }))} />
            </div>
          )}
        />
        <Group title="Axes">{axisNames}</Group>
      </>
    );
  }

  if (spec.chart === 'dot') return <><DotValues spec={spec} set={set} limits={limits} /><Group title="Axis">{axisNames}</Group></>;

  return (
    <>
      <Rows
        title="Boxes"
        noun="box"
        items={spec.boxes}
        max={limits.boxes}
        min={1}
        hint="The five numbers, lowest to highest."
        addLabel="Add a box"
        onAdd={() => set(plus(spec, 'boxes', { label: '', min: 0, q1: 25, median: 50, q3: 75, max: 100 }))}
        onRemove={(i) => set(without(spec, 'boxes', i))}
        row={(b, i) => (
          <>
            <div className="fe-line">
              <TextField label="Label" grow value={b.label} onChange={(v) => set(at(spec, 'boxes', i, { label: v }))} />
            </div>
            <div className="fe-line">
              {[['min', 'Lowest'], ['q1', 'Lower quartile'], ['median', 'Median'], ['q3', 'Upper quartile'], ['max', 'Highest']].map(([k, l]) => (
                <NumField key={k} label={l} value={b[k]} onChange={(v) => set(at(spec, 'boxes', i, { [k]: v }))} />
              ))}
            </div>
          </>
        )}
      />
      <Group title="Axis">{axisNames}</Group>
    </>
  );
}

/** A bar or line chart's numbers as a small table: categories down, series across. */
function SeriesGrid({ spec, set, limits }) {
  const cats = arr(spec.categories);
  const series = arr(spec.series);
  const setCat = (i, v) => set({ ...spec, categories: cats.map((c, j) => (j === i ? v : c)) });
  const setVal = (s, i, v) => set({ ...spec, series: series.map((r, j) => (j === s ? { ...r, values: cats.map((_, k) => (k === i ? v : r.values?.[k])) } : r)) });
  const addCat = () => set({ ...spec, categories: [...cats, ''], series: series.map((r) => ({ ...r, values: [...arr(r.values).slice(0, cats.length), 0] })) });
  const dropCat = (i) => set({ ...spec, categories: cats.filter((_, j) => j !== i), series: series.map((r) => ({ ...r, values: arr(r.values).filter((_, j) => j !== i) })) });
  const addSeries = () => set({ ...spec, series: [...series, { name: '', values: cats.map(() => 0) }] });
  const dropSeries = (s) => set({ ...spec, series: series.filter((_, j) => j !== s) });

  return (
    <Group title="The numbers" meta={`${cats.length} ${cats.length === 1 ? 'category' : 'categories'}, ${series.length} ${series.length === 1 ? 'series' : 'series'}`}>
      <div className="fe-grid-wrap">
        <table className="fe-grid">
          <thead>
            <tr>
              <th scope="col">Category</th>
              {series.map((r, s) => (
                // eslint-disable-next-line react/no-array-index-key
                <th key={s} scope="col">
                  <span className="fe-grid-h">
                    <input
                      className="input input-sm"
                      value={r.name ?? ''}
                      placeholder={series.length > 1 ? `Series ${s + 1} name` : 'Series name'}
                      aria-label={`Name of series ${s + 1}`}
                      onChange={(e) => set({ ...spec, series: series.map((q, j) => (j === s ? { ...q, name: e.target.value } : q)) })}
                    />
                    {series.length > 1 && <Button variant="ghost" size="sm" icon="close" aria-label={`Remove series ${s + 1}`} onClick={() => dropSeries(s)} />}
                  </span>
                </th>
              ))}
              <td />
            </tr>
          </thead>
          <tbody>
            {cats.map((c, i) => (
              // eslint-disable-next-line react/no-array-index-key
              <tr key={i}>
                <th scope="row">
                  <input className="input input-sm" value={c ?? ''} aria-label={`Category ${i + 1}`} onChange={(e) => setCat(i, e.target.value)} />
                </th>
                {series.map((r, s) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <td key={s}>
                    <GridNum value={r.values?.[i]} label={`${c || `Category ${i + 1}`}, ${r.name || `series ${s + 1}`}`} onChange={(v) => setVal(s, i, v)} />
                  </td>
                ))}
                <td>
                  <Button variant="ghost" size="sm" icon="close" aria-label={`Remove category ${i + 1}`} disabled={cats.length <= 1} onClick={() => dropCat(i)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="cluster cluster-1">
        <Button size="sm" icon="plus" disabled={cats.length >= limits.categories} onClick={addCat}>Add a category</Button>
        <Button size="sm" variant="ghost" icon="plus" disabled={series.length >= limits.series} title={series.length >= limits.series ? `${limits.series} series is the most` : undefined} onClick={addSeries}>Add a series</Button>
      </div>
    </Group>
  );
}

function GridNum({ value, label, onChange }) {
  const [text, setText] = useState(value === undefined || value === null ? '' : String(value));
  useEffect(() => { setText((t) => (readNumber(t) === value ? t : value === undefined || value === null ? '' : String(value))); }, [value]);
  return <input className="input input-sm num" inputMode="decimal" value={text} aria-label={label} onChange={(e) => { setText(e.target.value); onChange(readNumber(e.target.value)); }} />;
}

/** A dot plot's values as one line of numbers. */
function DotValues({ spec, set, limits }) {
  const id = useId();
  const [text, setText] = useState(arr(spec.values).join(', '));
  const n = arr(spec.values).length;
  return (
    <Group title="Values" meta={`${n} of ${limits.dots}`}>
      <label className="fe-f" data-grow="true" htmlFor={id}>
        <span className="fe-f-k">Every value, one dot each</span>
        <textarea
          id={id}
          className="textarea fe-values mono"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const parts = e.target.value.split(/[\s,;]+/).filter(Boolean);
            set({ ...spec, values: parts.map(readNumber) });
          }}
        />
      </label>
      <p className="hint">Separate them with commas or spaces. A value that repeats is a taller stack of dots.</p>
    </Group>
  );
}

/* -------------------------------------------------------------- numberline */

export function NumberlineForm({ spec, set, limits }) {
  return (
    <>
      <Group title="The line">
        <div className="fe-line">
          <NumField label="From" value={spec.min} onChange={(v) => set({ ...spec, min: v })} />
          <NumField label="to" value={spec.max} onChange={(v) => set({ ...spec, max: v })} />
          <NumField label="A tick every" value={spec.step} onChange={(v) => set({ ...spec, step: v })} />
          <NumField label="Number every n ticks" value={spec.labelEvery} onChange={(v) => set({ ...spec, labelEvery: v })} />
        </div>
      </Group>
      {arr(spec.points).length > 0 && (
        <Rows
          title="Points"
          noun="point"
          items={spec.points}
          max={limits.numberPoints}
          addLabel="Add a point"
          onAdd={() => set(plus(spec, 'points', { id: nextId('p', idsIn(spec)), value: 0, label: '' }))}
          onRemove={(i) => set(without(spec, 'points', i))}
          row={(p, i) => (
            <div className="fe-line">
              <NumField label="At" value={p.value} onChange={(v) => set(at(spec, 'points', i, { value: v }))} />
              <TextField label="Label" value={p.label} placeholder="a" onChange={(v) => set(at(spec, 'points', i, { label: v }))} />
              <Flag label="Open circle" checked={p.open} onChange={(v) => set(at(spec, 'points', i, { open: v }))} />
            </div>
          )}
        />
      )}
      {arr(spec.intervals).length > 0 && (
        <Rows
          title="Intervals"
          noun="interval"
          items={spec.intervals}
          max={limits.intervals}
          addLabel="Add an interval"
          onAdd={() => set(plus(spec, 'intervals', { id: nextId('i', idsIn(spec)), from: 0, to: 1, label: '' }))}
          onRemove={(i) => set(without(spec, 'intervals', i))}
          row={(v, i) => (
            <div className="fe-line">
              <NumField label="From" value={v.from} onChange={(x) => set(at(spec, 'intervals', i, { from: x }))} />
              <NumField label="to" value={v.to} onChange={(x) => set(at(spec, 'intervals', i, { to: x }))} />
              <Flag label="Left end open" checked={v.fromOpen} onChange={(x) => set(at(spec, 'intervals', i, { fromOpen: x }))} />
              <Flag label="Right end open" checked={v.toOpen} onChange={(x) => set(at(spec, 'intervals', i, { toOpen: x }))} />
              <TextField label="Label" value={v.label} onChange={(x) => set(at(spec, 'intervals', i, { label: x }))} />
            </div>
          )}
        />
      )}
      {arr(spec.rays).length > 0 && (
        <Rows
          title="Rays"
          noun="ray"
          items={spec.rays}
          max={limits.rays}
          addLabel="Add a ray"
          onAdd={() => set(plus(spec, 'rays', { id: nextId('r', idsIn(spec)), from: 0, direction: 'right', label: '' }))}
          onRemove={(i) => set(without(spec, 'rays', i))}
          row={(r, i) => (
            <div className="fe-line">
              <NumField label="From" value={r.from} onChange={(x) => set(at(spec, 'rays', i, { from: x }))} />
              <Pick label="Towards" value={r.direction} onChange={(x) => set(at(spec, 'rays', i, { direction: x }))} options={[{ id: 'right', label: 'The right' }, { id: 'left', label: 'The left' }]} />
              <Flag label="Open start" checked={r.open} onChange={(x) => set(at(spec, 'rays', i, { open: x }))} />
              <TextField label="Label" value={r.label} onChange={(x) => set(at(spec, 'rays', i, { label: x }))} />
            </div>
          )}
        />
      )}
      <Also
        items={[
          { label: 'A point', used: arr(spec.points).length > 0, onAdd: () => set(plus(spec, 'points', { id: nextId('p', idsIn(spec)), value: 0, label: '' })) },
          { label: 'An interval', used: arr(spec.intervals).length > 0, onAdd: () => set(plus(spec, 'intervals', { id: nextId('i', idsIn(spec)), from: 0, to: 1, label: '' })) },
          { label: 'A ray', used: arr(spec.rays).length > 0, onAdd: () => set(plus(spec, 'rays', { id: nextId('r', idsIn(spec)), from: 0, direction: 'right', label: '' })) },
        ]}
      />
    </>
  );
}

/* ---------------------------------------------------------------- geometry */

/** A corner or an end: one of the named points, or the pair a stored spec gave. */
function PointPick({ label, value, points, onChange }) {
  const pair = Array.isArray(value);
  const options = [
    ...(value === undefined || value === '' ? [{ id: '', label: 'Choose a point' }] : []),
    ...points.map((p) => ({ id: p.id, label: p.label && p.label !== p.id ? `${p.id} (${p.label})` : p.id })),
    ...(pair ? [{ id: '__pair', label: `(${value.join(', ')})` }] : []),
  ];
  return <Pick label={label} value={pair ? '__pair' : value} options={options} onChange={(v) => { if (v !== '__pair') onChange(v); }} />;
}

export function GeometryForm({ spec, set, limits, parts }) {
  const points = arr(spec.points);
  const first = points[0]?.id ?? '';
  const second = points[1]?.id ?? first;
  const third = points[2]?.id ?? second;
  const view = spec.view ?? {};
  const setView = (k, v) => set({ ...spec, view: { ...view, [k]: v } });
  const lists = [
    { key: 'segments', title: 'Segments', noun: 'segment', max: limits.segments, prefix: 's', make: () => ({ from: first, to: second, label: '' }) },
    { key: 'rays', title: 'Rays', noun: 'ray', max: limits.rays, prefix: 'r', make: () => ({ from: first, through: second, label: '' }) },
    { key: 'polygons', title: 'Shapes', noun: 'shape', max: limits.polygons, prefix: 'shape', make: () => ({ points: points.slice(0, 3).map((p) => p.id), label: '' }) },
    { key: 'circles', title: 'Circles', noun: 'circle', max: limits.circles, prefix: 'c', make: () => ({ centre: first, radius: 1, label: '' }) },
    { key: 'angles', title: 'Angles', noun: 'angle', max: limits.angles, prefix: 'a', make: () => ({ at: first, from: second, to: third, label: '' }) },
    { key: 'vectors', title: 'Arrows', noun: 'arrow', max: limits.vectors, prefix: 'v', make: () => ({ from: first, dx: 1, dy: 0, label: '' }) },
  ];
  const add = (l) => set(plus(spec, l.key, { id: nextId(l.prefix, idsIn(spec)), ...l.make() }));

  const rowOf = {
    segments: (g, i, patch) => (
      <div className="fe-line">
        <PointPick label="From" value={g.from} points={points} onChange={(v) => patch({ from: v })} />
        <PointPick label="To" value={g.to} points={points} onChange={(v) => patch({ to: v })} />
        <TextField label="Label" value={g.label} placeholder="5 cm" onChange={(v) => patch({ label: v })} />
        <Pick label="Equal-length marks" value={String(g.marks ?? 0)} onChange={(v) => patch({ marks: Number(v) })} options={[0, 1, 2, 3].map((n) => ({ id: String(n), label: n === 0 ? 'None' : String(n) }))} />
        <Flag label="Dashed" checked={g.dashed} onChange={(v) => patch({ dashed: v })} />
      </div>
    ),
    rays: (r, i, patch) => (
      <div className="fe-line">
        <PointPick label="From" value={r.from} points={points} onChange={(v) => patch({ from: v })} />
        <PointPick label="Through" value={r.through} points={points} onChange={(v) => patch({ through: v })} />
        <TextField label="Label" value={r.label} onChange={(v) => patch({ label: v })} />
      </div>
    ),
    polygons: (g, i, patch) => <Corners shape={g} points={points} max={limits.polygonCorners} patch={patch} />,
    circles: (c, i, patch) => (
      <div className="fe-line">
        <PointPick label="Centre" value={c.centre} points={points} onChange={(v) => patch({ centre: v })} />
        <NumField label="Radius" value={c.radius} onChange={(v) => patch({ radius: v })} />
        <TextField label="Label" value={c.label} onChange={(v) => patch({ label: v })} />
      </div>
    ),
    angles: (a, i, patch) => (
      <div className="fe-line">
        <PointPick label="At" value={a.at} points={points} onChange={(v) => patch({ at: v })} />
        <PointPick label="From" value={a.from} points={points} onChange={(v) => patch({ from: v })} />
        <PointPick label="To" value={a.to} points={points} onChange={(v) => patch({ to: v })} />
        <TextField label="Label" value={a.label} placeholder="x" onChange={(v) => patch({ label: v })} />
        <Flag label="Right angle" checked={a.right} onChange={(v) => patch({ right: v })} />
      </div>
    ),
    vectors: (v, i, patch) => (
      <div className="fe-line">
        <PointPick label="From" value={v.from} points={points} onChange={(x) => patch({ from: x })} />
        <NumField label="Across" value={v.dx} onChange={(x) => patch({ dx: x })} />
        <NumField label="Up" value={v.dy} onChange={(x) => patch({ dy: x })} />
        <TextField label="Label" value={v.label} placeholder="F" onChange={(x) => patch({ label: x })} />
      </div>
    ),
  };

  return (
    <>
      <Group title="Frame">
        <div className="fe-line">
          <NumField label="Left edge" value={view.xMin} onChange={(v) => setView('xMin', v)} />
          <NumField label="Right edge" value={view.xMax} onChange={(v) => setView('xMax', v)} />
          <NumField label="Bottom edge" value={view.yMin} onChange={(v) => setView('yMin', v)} />
          <NumField label="Top edge" value={view.yMax} onChange={(v) => setView('yMax', v)} />
        </div>
        <div className="fe-line">
          <Flag label="Grid" checked={spec.grid} onChange={(v) => set({ ...spec, grid: v })} />
          <Flag label="Axes" checked={spec.axes} onChange={(v) => set({ ...spec, axes: v })} />
        </div>
      </Group>
      <Rows
        title="Points"
        noun="point"
        items={points}
        max={limits.geoPoints}
        hint="Each point has a name the lines, shapes and angles below refer to."
        addLabel="Add a point"
        onAdd={() => { const id = nextId('', idsIn(spec)); set(plus(spec, 'points', { id, x: 0, y: 0, label: id })); }}
        onRemove={(i) => set(without(spec, 'points', i))}
        row={(p, i) => (
          <div className="fe-line">
            <span className="fe-id mono" title="The name other parts use">{p.id}</span>
            <NumField label="x" value={p.x} onChange={(v) => set(at(spec, 'points', i, { x: v }))} />
            <NumField label="y" value={p.y} onChange={(v) => set(at(spec, 'points', i, { y: v }))} />
            <TextField label="Label shown" value={p.label} onChange={(v) => set(at(spec, 'points', i, { label: v }))} />
            <Flag label="Hidden" checked={p.hidden} onChange={(v) => set(at(spec, 'points', i, { hidden: v }))} />
          </div>
        )}
      />
      {lists.filter((l) => arr(spec[l.key]).length > 0).map((l) => (
        <Rows
          key={l.key}
          title={l.title}
          noun={l.noun}
          items={spec[l.key]}
          max={l.max}
          addLabel={`Add ${l.noun === 'arrow' ? 'an arrow' : `a ${l.noun}`}`}
          onAdd={() => add(l)}
          onRemove={(i) => set(without(spec, l.key, i))}
          row={(it, i) => (
            <>
              {rowOf[l.key](it, i, (p) => set(at(spec, l.key, i, p)))}
              <Said text={partSaid(parts, it.id)} />
            </>
          )}
        />
      ))}
      <Also items={lists.map((l) => ({ label: cap(l.noun === 'arrow' ? 'an arrow' : `a ${l.noun}`), used: arr(spec[l.key]).length > 0, onAdd: () => add(l) }))} />
    </>
  );
}

/** A shape's corners, picked in order from the named points. */
function Corners({ shape, points, max, patch }) {
  const corners = arr(shape.points);
  return (
    <div className="stack stack-2">
      <div className="fe-line">
        <TextField label="Label" value={shape.label} onChange={(v) => patch({ label: v })} />
        <Flag label="Shaded" checked={shape.shaded} onChange={(v) => patch({ shaded: v })} />
      </div>
      <div className="fe-corners">
        <span className="fe-f-k">Corners, in order</span>
        <span className="fe-corner-list mono" aria-live="polite">{corners.length ? corners.map((c) => (Array.isArray(c) ? `(${c.join(', ')})` : c)).join(' → ') : 'None yet'}</span>
        <div className="cluster cluster-1" role="group" aria-label="Add a corner">
          {points.map((p) => (
            <button key={p.id} type="button" className="fe-chip" disabled={corners.length >= max} onClick={() => patch({ points: [...corners, p.id] })}>
              <Icon name="plus" size={12} />{p.id}
            </button>
          ))}
          <Button size="sm" variant="ghost" disabled={!corners.length} onClick={() => patch({ points: corners.slice(0, -1) })}>Undo the last</Button>
        </div>
      </div>
    </div>
  );
}

export function OpticsForm({ spec, set, kinds }) {
  const o = spec.optics ?? {};
  const patch = (p) => set({ ...spec, optics: { ...o, ...p } });
  const elements = arr(kinds?.optics).length ? kinds.optics : Object.keys(OPTICS_LABEL);
  const plane = o.element === 'plane-mirror';
  return (
    <Group title="The lens or mirror">
      <div className="fe-line">
        <Pick label="Element" grow value={o.element} onChange={(v) => patch({ element: v })} options={elements.map((e) => ({ id: e, label: OPTICS_LABEL[e] ?? e }))} />
      </div>
      <div className="fe-line">
        {!plane && <NumField label="Focal length" value={o.focal} onChange={(v) => patch({ focal: v })} />}
        <NumField label="Object distance" value={o.objectDistance} onChange={(v) => patch({ objectDistance: v })} />
        <NumField label="Object height" value={o.objectHeight} onChange={(v) => patch({ objectHeight: v })} />
      </div>
      <p className="hint">The image, the rays and where they meet are worked out from the {plane ? 'mirror' : 'lens or mirror'} formula, never drawn by hand. Use the same unit for every distance.</p>
    </Group>
  );
}

/* ---------------------------------------------------------------- timeline */

export function TimelineForm({ spec, set, limits }) {
  return (
    <Rows
      title="Events"
      noun="event"
      items={spec.events}
      max={limits.events}
      min={2}
      hint="A year (−326 for 326 BCE), or a date as 1947-08-15. They are put in order for you."
      addLabel="Add an event"
      onAdd={() => set(plus(spec, 'events', { id: nextId('e', idsIn(spec)), date: '', label: '' }))}
      onRemove={(i) => set(without(spec, 'events', i))}
      row={(e, i) => (
        <div className="fe-line">
          <DateField value={e.date} onChange={(v) => set(at(spec, 'events', i, { date: v }))} />
          <TextField label="What happened" grow value={e.label} onChange={(v) => set(at(spec, 'events', i, { label: v }))} />
        </div>
      )}
    />
  );
}

function DateField({ value, onChange }) {
  const id = useId();
  const [text, setText] = useState(dateText(value));
  useEffect(() => { setText((t) => (readDate(t) === value ? t : dateText(value))); }, [value]);
  return (
    <label className="fe-f" htmlFor={id}>
      <span className="fe-f-k">Date</span>
      <input id={id} className="input input-sm mono fe-date" value={text} placeholder="1947-08-15" onChange={(e) => { setText(e.target.value); onChange(readDate(e.target.value)); }} />
    </label>
  );
}

/* ----------------------------------------------------------------- diagram */

export function DiagramForm({ spec, set, limits, kinds, parts }) {
  const d = kinds?.diagram ?? {};
  const layouts = arr(d.layouts).length ? d.layouts : Object.keys(LAYOUT_LABEL);
  const shapes = arr(d.shapes).length ? d.shapes : Object.keys(SHAPE_LABEL);
  const lines = arr(d.lines).length ? d.lines : ['solid', 'dashed', 'dotted'];
  const arrows = arr(d.arrows).length ? d.arrows : Object.keys(ARROW_LABEL);
  const nodes = arr(spec.nodes);
  const boxName = (id) => {
    const i = nodes.findIndex((n) => n.id === id);
    return i < 0 ? id : nodes[i].label || `Box ${i + 1}`;
  };
  const removeBox = (i) => {
    const gone = nodes[i]?.id;
    const edges = arr(spec.edges);
    const cut = edges.filter((e) => e.from === gone || e.to === gone).map((e) => e.id).filter(Boolean);
    set(dropFromSteps({ ...spec, nodes: nodes.filter((_, j) => j !== i), edges: edges.filter((e) => e.from !== gone && e.to !== gone) }, [gone, ...cut]));
  };

  return (
    <>
      <Group title="Kind">
        <Segmented label="Kind of diagram" value={spec.layout ?? 'flowchart'} onChange={(v) => set({ ...spec, layout: v })} options={layouts.map((l) => ({ id: l, label: LAYOUT_LABEL[l] ?? l }))} />
        {(spec.layout ?? 'flowchart') !== 'cycle' && (spec.layout ?? 'flowchart') !== 'network' && (spec.layout ?? 'flowchart') !== 'mindmap' && (
          <Segmented label="Direction" value={spec.direction ?? 'down'} onChange={(v) => set({ ...spec, direction: v })} options={[{ id: 'down', label: 'Top to bottom' }, { id: 'right', label: 'Left to right' }]} />
        )}
      </Group>
      <Rows
        title="Boxes"
        noun="box"
        items={nodes}
        max={limits.nodes}
        min={1}
        addLabel="Add a box"
        onAdd={() => set(plus(spec, 'nodes', { id: nextId('n', idsIn(spec)), label: '' }))}
        onRemove={removeBox}
        row={(n, i) => (
          <div className="fe-line">
            <TextField label="Words in the box" grow value={n.label} onChange={(v) => set(at(spec, 'nodes', i, { label: v }))} />
            <Pick label="Shape" value={n.shape ?? ''} onChange={(v) => set(at(spec, 'nodes', i, { shape: v || undefined }))} options={[{ id: '', label: 'Usual for this kind' }, ...shapes.map((s) => ({ id: s, label: SHAPE_LABEL[s] ?? s }))]} />
          </div>
        )}
      />
      <Rows
        title={spec.layout === 'mindmap' || spec.layout === 'network' ? 'Links' : 'Arrows'}
        noun="arrow"
        items={spec.edges}
        max={limits.edges}
        addLabel={spec.layout === 'mindmap' || spec.layout === 'network' ? 'Add a link' : 'Add an arrow'}
        onAdd={() => set(plus(spec, 'edges', { id: nextId('e', idsIn(spec)), from: nodes[0]?.id ?? '', to: nodes[1]?.id ?? nodes[0]?.id ?? '', label: '' }))}
        onRemove={(i) => set(without(spec, 'edges', i))}
        row={(e, i) => {
          const patch = (p) => set(at(spec, 'edges', i, p));
          const opts = nodes.map((n) => ({ id: n.id, label: boxName(n.id) }));
          return (
            <>
              <div className="fe-line">
                <Pick label="From" value={e.from} onChange={(v) => patch({ from: v })} options={opts} />
                <Pick label="To" value={e.to} onChange={(v) => patch({ to: v })} options={opts} />
                <TextField label="Label" value={e.label} placeholder="yes" onChange={(v) => patch({ label: v })} />
              </div>
              <More label="Line and arrowhead">
                <div className="fe-line">
                  <Pick label="Line" value={e.style ?? ''} onChange={(v) => patch({ style: v || undefined })} options={[{ id: '', label: 'Usual' }, ...lines.map((l) => ({ id: l, label: cap(l) }))]} />
                  <Pick label="Arrowhead" value={e.arrow ?? ''} onChange={(v) => patch({ arrow: v || undefined })} options={[{ id: '', label: 'Usual for this kind' }, ...arrows.map((a) => ({ id: a, label: ARROW_LABEL[a] ?? a }))]} />
                </div>
              </More>
              <Said text={partSaid(parts, e.id)} />
            </>
          );
        }}
      />
    </>
  );
}

/* ---------------------------------------------------------------- molecule */

export function MoleculeForm({ spec, set, formula, limits }) {
  return (
    <Group title="The molecule">
      <div className="fe-line">
        <TextField label="SMILES" grow mono value={spec.smiles} placeholder="CCO" max={limits.smiles} onChange={(v) => set({ ...spec, smiles: v })} />
      </div>
      <p className="hint">The structure written as SMILES, such as CCO for ethanol or c1ccccc1 for benzene. The chemistry engine must read it, and works out the formula itself.</p>
      <div className="fe-line">
        <TextField label="Name" grow value={spec.name} placeholder="Ethanol" onChange={(v) => set({ ...spec, name: v })} />
        <TextField label="Formula, to check against" mono value={spec.formula} placeholder={formula || 'C2H6O'} onChange={(v) => set({ ...spec, formula: v.trim() ? v : undefined })} />
      </div>
      {formula && <p className="fe-said"><Icon name="ok" size={12} />Worked out from the structure: <span className="mono">{formula}</span></p>}
    </Group>
  );
}

/* ----------------------------------------------------------------- pattern */

const PATTERN_SHAPE_LABEL = (s) => cap(s);

export function PatternForm({ spec, set, limits, kinds }) {
  const items = arr(spec.items);
  const [sel, setSel] = useState(0);
  const p = kinds?.pattern ?? {};
  const shapes = arr(p.shapes).length ? p.shapes : ['circle', 'square', 'triangle', 'diamond', 'pentagon', 'hexagon', 'star', 'cross', 'arrow', 'semicircle'];
  const fills = arr(p.fills).length ? p.fills : ['solid', 'outline', 'dotted'];
  const colours = arr(p.colours).length ? p.colours : ['green', 'gold', 'blue', 'grey'];
  const i = Math.min(sel, Math.max(0, items.length - 1));
  const it = items[i];
  const patch = (q) => set({ ...spec, items: items.map((x, j) => (j === i ? { ...x, ...q } : x)) });
  const move = (d) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    set({ ...spec, items: next });
    setSel(j);
  };

  return (
    <Group title="The sequence" meta={`${items.length} of ${limits.patternItems}`}>
      <div className="fe-strip" role="group" aria-label="Items in order">
        {items.map((x, j) => (
          // eslint-disable-next-line react/no-array-index-key
          <button key={j} type="button" className="fe-tile" aria-pressed={j === i} onClick={() => setSel(j)}>
            <span className="mono">{j + 1}</span>
            {x.blank ? 'Blank' : `${(x.count ?? 1) > 1 ? `${x.count} × ` : ''}${PATTERN_SHAPE_LABEL(x.shape ?? '?')}`}
          </button>
        ))}
        <Button size="sm" icon="plus" disabled={items.length >= limits.patternItems} onClick={() => { set({ ...spec, items: [...items, { ...(items[items.length - 1]?.blank ? { shape: 'circle' } : items[items.length - 1] ?? { shape: 'circle' }) }] }); setSel(items.length); }}>Add</Button>
      </div>
      {it && (
        <div className="fe-tile-ed">
          <div className="fe-line">
            <Pick
              label={`Item ${i + 1}`}
              value={it.blank ? '__blank' : it.shape}
              onChange={(v) => (v === '__blank' ? set({ ...spec, items: items.map((x, j) => (j === i ? { blank: true } : x)) }) : patch({ blank: undefined, shape: v }))}
              options={[...shapes.map((s) => ({ id: s, label: PATTERN_SHAPE_LABEL(s) })), { id: '__blank', label: 'The blank to fill in' }]}
            />
            {!it.blank && (
              <>
                <Pick label="Fill" value={it.fill ?? 'solid'} onChange={(v) => patch({ fill: v })} options={fills.map((f) => ({ id: f, label: cap(f) }))} />
                <Pick label="Colour" value={it.colour ?? 'green'} onChange={(v) => patch({ colour: v })} options={colours.map((c) => ({ id: c, label: cap(c) }))} />
              </>
            )}
          </div>
          {!it.blank && (
            <div className="fe-line">
              <Pick label="Size" value={it.size ?? 'medium'} onChange={(v) => patch({ size: v })} options={['small', 'medium', 'large'].map((s) => ({ id: s, label: cap(s) }))} />
              <NumField label="How many" value={it.count ?? 1} onChange={(v) => patch({ count: v })} />
              <NumField label="Turned, degrees" value={it.rotate ?? 0} onChange={(v) => patch({ rotate: v })} />
            </div>
          )}
          <div className="cluster cluster-1">
            <Button size="sm" variant="ghost" icon="back" disabled={i === 0} onClick={() => move(-1)}>Earlier</Button>
            <Button size="sm" variant="ghost" icon="forward" disabled={i >= items.length - 1} onClick={() => move(1)}>Later</Button>
            <Button size="sm" variant="ghost" icon="close" disabled={items.length <= 2} onClick={() => { set({ ...spec, items: items.filter((_, j) => j !== i) }); setSel(Math.max(0, i - 1)); }}>Remove</Button>
          </div>
        </div>
      )}
    </Group>
  );
}

/* ------------------------------------------------------------------- stack */

/** Frames, bottom to top, for a stack or one step of it. */
export function FrameList({ frames, onChange, max, title = 'Frames', hint }) {
  const list = arr(frames);
  const used = list.map((f) => f.id);
  return (
    <Rows
      title={title}
      noun="frame"
      items={list}
      max={max}
      hint={hint}
      addLabel="Push a frame"
      onAdd={() => onChange([...list, { id: nextId('frame', used), label: '', note: '' }])}
      onRemove={(i) => onChange(list.filter((_, j) => j !== i))}
      row={(f, i) => (
        <div className="fe-line">
          <TextField label={i === 0 ? 'Bottom frame' : i === list.length - 1 ? 'Top frame' : 'Frame'} grow value={f.label} placeholder="fact(3)" onChange={(v) => onChange(list.map((x, j) => (j === i ? { ...x, label: v } : x)))} />
          <TextField label="Note" value={f.note} placeholder="n = 3" onChange={(v) => onChange(list.map((x, j) => (j === i ? { ...x, note: v } : x)))} />
        </div>
      )}
    />
  );
}

export function StackForm({ spec, set, limits }) {
  return (
    <FrameList
      frames={spec.frames}
      max={limits.frames}
      title="Frames at the start"
      hint="Bottom first. The steps below push and pop from here."
      onChange={(frames) => set({ ...spec, frames })}
    />
  );
}

/** The chart kinds, for the builder's switch. */
export const CHART_KINDS = Object.keys(CHART_LABEL);
