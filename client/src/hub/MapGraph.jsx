/**
 * The prerequisite map: every topic of a class, placed from its links alone.
 * Nothing about where a topic sits is stored; a professor's chapter of any
 * shape draws without a fixed column or row.
 *
 * How it is laid out (layoutMap, a small Sugiyama layout):
 *  1. Layers. A topic sits one layer after the latest of its prerequisites:
 *     its longest path back to a topic with no prerequisite.
 *  2. A link that skips layers gets a waypoint in each layer it crosses, so
 *     it runs through a gap of its own instead of through a topic.
 *  3. Order within a layer. Course order first, then a few barycentre sweeps
 *     (each topic moves towards the mean place of its neighbours), keeping
 *     the order with the fewest crossings.
 *  4. Places. Each topic is pulled towards its neighbours and pushed apart
 *     from the one before it, so most links come out nearly straight.
 *
 * Layers run left to right when the card is wide and top to bottom when it
 * is narrow (a phone); the map scrolls sideways inside its card if it is
 * still too wide. The page itself never does.
 *
 * A link is solid once the earlier topic is mastered and dashed before, and
 * every topic says its state in words beside a mark, so nothing rests on
 * colour.
 *
 * Used by Prereqs.jsx for one topic's prerequisite chain (the student API
 * sends no class-wide link list): the chain's links come from each
 * prerequisite's `via`.
 */

import { useLayoutEffect, useMemo, useRef, useState } from 'react';

import { EASE, gsap, reduced } from '../lib/motion.js';
import RichText from './RichText.jsx';

/* ------------------------------------------------------------ the states */

import { STATE_WORD } from './states.js';
import StateMark from './StateMark.jsx';

export { STATE_WORD };

/** A topic's state as a shape: one copy for the hub, in StateMark.jsx. */
export { default as StateMark } from './StateMark.jsx';

/* ------------------------------------------------------------ the layout */

/**
 * Sizes, in px. `main` runs along the layers, `cross` across them: a topic is
 * main × cross when the layers run across, cross × main when they run down.
 */
const ACROSS = { main: 156, cross: 88, gap: 34, sep: 16, way: 14 };
const DOWN = { main: 64, cross: 150, gap: 30, sep: 14, way: 14 };

/**
 * @param ids    every topic id, in course order (units, then chapters)
 * @param links  [{ from, to }]: `from` comes before `to`
 * @param dims   ACROSS or DOWN (with `main` adjusted to fit, if wanted)
 * @param down   true to run the layers top to bottom
 * @returns { nodes: [{ id, layer, idx, x, y, w, h }], edges: [{ from, to, d, tip }], width, height, depth }
 */
export function layoutMap(ids, links, dims, down = false) {
  const known = new Set(ids);
  const seen = new Set();
  const edges = [];
  for (const l of links ?? []) {
    const k = `${l.from}>${l.to}`;
    if (!known.has(l.from) || !known.has(l.to) || l.from === l.to || seen.has(k)) continue;
    seen.add(k);
    edges.push({ from: l.from, to: l.to });
  }

  // 1. Layers: the longest path from a topic with no prerequisite (Kahn's order).
  const layer = Object.fromEntries(ids.map((id) => [id, 0]));
  const waiting = Object.fromEntries(ids.map((id) => [id, 0]));
  const after = Object.fromEntries(ids.map((id) => [id, []]));
  edges.forEach((e) => { waiting[e.to] += 1; after[e.from].push(e.to); });
  const queue = ids.filter((id) => waiting[id] === 0);
  for (let i = 0; i < queue.length; i += 1) {
    for (const to of after[queue[i]]) {
      layer[to] = Math.max(layer[to], layer[queue[i]] + 1);
      waiting[to] -= 1;
      if (waiting[to] === 0) queue.push(to);
    }
  }
  // A loop in the links would leave its topics part placed; a link that would
  // run backwards is not drawn. The server confirms links, so this is a guard.
  const drawn = edges.filter((e) => layer[e.to] > layer[e.from]);
  const depth = ids.length ? Math.max(...ids.map((id) => layer[id])) + 1 : 0;

  // 2. Rows of items: topics, and a waypoint wherever a link skips a layer.
  let rows = Array.from({ length: depth }, () => []);
  const item = {};
  ids.forEach((id) => {
    item[id] = { id, layer: layer[id], way: false, up: [], down: [] };
    rows[layer[id]].push(item[id]);
  });
  const chains = drawn.map((e) => {
    const chain = [item[e.from]];
    for (let L = layer[e.from] + 1; L < layer[e.to]; L += 1) {
      const w = { layer: L, way: true, up: [], down: [] };
      rows[L].push(w);
      chain.push(w);
    }
    chain.push(item[e.to]);
    for (let k = 1; k < chain.length; k += 1) { chain[k - 1].down.push(chain[k]); chain[k].up.push(chain[k - 1]); }
    return { ...e, chain };
  });

  // 3. Order within each layer: barycentre sweeps, keeping the fewest crossings.
  const number = () => rows.forEach((r) => r.forEach((it, i) => { it.pos = i; }));
  const mean = (list, key) => (list.length ? list.reduce((s, n) => s + n[key], 0) / list.length : null);
  const sortBy = (r, side) => {
    const b = new Map(r.map((it) => [it, mean(it[side], 'pos') ?? it.pos]));
    r.sort((p, q) => b.get(p) - b.get(q));
    r.forEach((it, i) => { it.pos = i; });
  };
  const crossings = () => {
    let n = 0;
    for (let L = 0; L < depth - 1; L += 1) {
      const segs = rows[L].flatMap((a) => a.down.map((b) => [a.pos, b.pos]));
      for (let i = 0; i < segs.length; i += 1) {
        for (let j = i + 1; j < segs.length; j += 1) {
          if ((segs[i][0] - segs[j][0]) * (segs[i][1] - segs[j][1]) < 0) n += 1;
        }
      }
    }
    return n;
  };
  number();
  let best = rows.map((r) => [...r]);
  let fewest = Infinity;
  for (let pass = 0; pass < 4; pass += 1) {
    for (let L = 1; L < depth; L += 1) sortBy(rows[L], 'up');
    for (let L = depth - 2; L >= 0; L -= 1) sortBy(rows[L], 'down');
    const n = crossings();
    if (n < fewest) { fewest = n; best = rows.map((r) => [...r]); }
  }
  rows = best;
  number();
  // Then swap neighbours in a layer wherever that removes a crossing.
  const swap = (r, i) => { [r[i], r[i + 1]] = [r[i + 1], r[i]]; r[i].pos = i; r[i + 1].pos = i + 1; };
  for (let round = 0, better = true; better && round < 6; round += 1) {
    better = false;
    for (const r of rows) {
      for (let i = 0; i < r.length - 1; i += 1) {
        swap(r, i);
        const n = crossings();
        if (n < fewest) { fewest = n; better = true; } else swap(r, i);
      }
    }
  }

  // 4. Places across the layers: pulled towards neighbours, kept apart in order.
  const { main, cross, gap, sep, way } = dims;
  const size = (it) => (it.way ? way : cross);
  rows.forEach((r) => { let c = 0; r.forEach((it) => { it.c = c + size(it) / 2; c += size(it) + sep; }); });
  const place = (r, side) => {
    const want = r.map((it) => mean(it[side], 'c') ?? it.c);
    const c = [];
    r.forEach((it, i) => {
      c[i] = i === 0 ? want[0] : Math.max(want[i], c[i - 1] + (size(r[i - 1]) + size(it)) / 2 + sep);
    });
    const shift = c.reduce((s, v, i) => s + (want[i] - v), 0) / (r.length || 1);
    r.forEach((it, i) => { it.c = c[i] + shift; });
  };
  for (let pass = 0; pass < 4; pass += 1) {
    for (let L = 1; L < depth; L += 1) place(rows[L], 'up');
    for (let L = depth - 2; L >= 0; L -= 1) place(rows[L], 'down');
  }
  const all = rows.flat();
  const lo = all.length ? Math.min(...all.map((it) => it.c - size(it) / 2)) : 0;
  all.forEach((it) => { it.c -= lo; });
  const extent = all.length ? Math.max(...all.map((it) => it.c + size(it) / 2)) : 0;
  const length = depth ? depth * main + (depth - 1) * gap : 0;
  const at = (L) => L * (main + gap);
  const pt = (m, c) => (down ? `${c.toFixed(1)},${m.toFixed(1)}` : `${m.toFixed(1)},${c.toFixed(1)}`);

  const nodes = rows.flatMap((r) => r.filter((it) => !it.way).map((it, idx) => ({
    id: it.id, layer: it.layer, idx, c: it.c,
    x: down ? it.c - cross / 2 : at(it.layer),
    y: down ? at(it.layer) : it.c - cross / 2,
    w: down ? cross : main,
    h: down ? main : cross,
  })));

  // Each link is one path, so a dash runs on unbroken through its waypoints;
  // it stops short of the topic it leads to, where a small arrowhead sits.
  const out = chains.map(({ from, to, chain }) => {
    let d = `M${pt(at(chain[0].layer) + main, chain[0].c)}`;
    let end = null;
    for (let k = 1; k < chain.length; k += 1) {
      const a = chain[k - 1];
      const b = chain[k];
      const m0 = at(a.layer) + main;
      const m1 = at(b.layer) - (b.way ? 0 : 5);
      const mid = (m0 + m1) / 2;
      d += ` C${pt(mid, a.c)} ${pt(mid, b.c)} ${pt(m1, b.c)}`;
      if (b.way) d += ` L${pt(at(b.layer) + main, b.c)}`;
      else end = [m1, b.c];
    }
    const [m, c] = end;
    const tip = `M${pt(m - 6, c - 4)} L${pt(m, c)} L${pt(m - 6, c + 4)}z`;
    return { from, to, d, tip };
  });

  return { nodes, edges: out, depth, width: down ? extent : length, height: down ? length : extent };
}

/* ------------------------------------------------------------- the graph */

/** The width of an element, kept current. */
function useWidth(ref) {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

/** Below this width the layers run top to bottom. */
const NARROW = 600;

/**
 * @param ids         topic ids, nearest the roots first where it matters
 * @param topics      { [id]: { name, nameHtml?, state?, label? } }: `label` is
 *                    the server's word for the state; without a state the
 *                    node says nothing about one
 * @param links       [{ from, to }]
 * @param targetId    the topic the map leads to
 * @param targetWord  what that topic is called on its node ('Main topic', 'This topic')
 * @param picked      the chosen topic id
 * @param onPick      (id) => void
 * @param label       what the map is, for a screen reader
 */
export function MapGraph({ ids, topics, links, targetId, targetWord = STATE_WORD.target, picked, onPick, label }) {
  const frame = useRef(null);
  const board = useRef(null);
  const buttons = useRef({});
  // The frame's padding (8px a side) keeps focus rings and the hover lift in view.
  const width = Math.max(0, useWidth(frame) - 16);
  const down = width > 0 && width < NARROW;

  const layout = useMemo(() => {
    if (down) return layoutMap(ids, links, DOWN, true);
    // Across: topics widen to fill the card, between 112 and 172 px each;
    // a map deeper than that scrolls sideways.
    const depth = layoutMap(ids, links, ACROSS).depth || 1;
    const fit = width ? Math.floor((width - (depth - 1) * ACROSS.gap) / depth) : ACROSS.main;
    return layoutMap(ids, links, { ...ACROSS, main: Math.max(112, Math.min(172, fit)) });
  }, [ids, links, down, width]);

  // A map wider than its card opens scrolled to the chosen topic.
  const shown = ids.join('|');
  useLayoutEffect(() => {
    const el = frame.current;
    const n = layout.nodes.find((x) => x.id === picked);
    if (el && n && el.scrollWidth > el.clientWidth) el.scrollLeft = Math.max(0, 8 + n.x + n.w / 2 - el.clientWidth / 2);
    // Only when the map is drawn anew, not on every choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, down]);

  // The map arrives a layer at a time. Once per class, not on every resize.
  useLayoutEffect(() => {
    const el = board.current;
    if (!el || reduced()) return undefined;
    const nodes = [...el.querySelectorAll('.hub-map-node')];
    const lines = el.querySelector('.hub-map-lines');
    const tl = gsap.timeline();
    tl.fromTo(nodes, { opacity: 0, y: 6 }, {
      opacity: 1, y: 0, duration: 0.42, ease: EASE, clearProps: 'opacity,transform',
      stagger: (i) => Number(nodes[i].dataset.layer) * 0.06,
    });
    if (lines) tl.fromTo(lines, { opacity: 0 }, { opacity: 1, duration: 0.5, ease: EASE, clearProps: 'opacity' }, 0.12);
    const guard = setTimeout(() => tl.progress(1), 1400);
    return () => { clearTimeout(guard); tl.kill(); gsap.set([...nodes, lines].filter(Boolean), { clearProps: 'opacity,transform' }); };
  }, [shown]);

  const byLayer = useMemo(() => {
    const m = [];
    layout.nodes.forEach((n) => { (m[n.layer] ??= []).push(n); });
    return m;
  }, [layout]);
  const near = useMemo(() => {
    if (!picked) return new Set();
    return new Set(links.filter((l) => l.from === picked || l.to === picked).map((l) => `${l.from}>${l.to}`));
  }, [links, picked]);

  // Arrow keys move along the map: across the layers on the axis they run,
  // within a layer on the other. Tab still reaches every topic in order.
  const onKey = (e) => {
    const id = e.target?.dataset?.id;
    const n = layout.nodes.find((x) => x.id === id);
    if (!n) return;
    const along = down ? { ArrowDown: 1, ArrowUp: -1 } : { ArrowRight: 1, ArrowLeft: -1 };
    const within = down ? { ArrowRight: 1, ArrowLeft: -1 } : { ArrowDown: 1, ArrowUp: -1 };
    let to = null;
    if (e.key in along) {
      const row = byLayer[n.layer + along[e.key]];
      if (row) to = row.reduce((b, x) => (Math.abs(x.c - n.c) < Math.abs(b.c - n.c) ? x : b));
    } else if (e.key in within) {
      to = byLayer[n.layer][n.idx + within[e.key]] ?? null;
    } else if (e.key === 'Home') to = layout.nodes[0];
    else if (e.key === 'End') to = layout.nodes[layout.nodes.length - 1];
    else return;
    e.preventDefault();
    if (to) buttons.current[to.id]?.focus();
  };

  return (
    <div className="hub-map-frame" ref={frame} data-dir={down ? 'down' : 'across'}>
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div
        className="hub-map-board"
        ref={board}
        role="group"
        aria-label={label}
        style={{ width: layout.width, height: layout.height }}
        onKeyDown={onKey}
      >
        <svg className="hub-map-lines" width={layout.width} height={layout.height} aria-hidden="true" focusable="false">
          {layout.edges.map((e) => {
            const met = topics[e.from]?.state === 'mastered';
            const on = near.has(`${e.from}>${e.to}`);
            return (
              <g key={`${e.from}>${e.to}`} className="hub-map-link" data-met={met ? 'true' : 'false'} data-on={on ? 'true' : undefined}>
                <path d={e.d} className="ln" />
                <path d={e.tip} className="tip" />
              </g>
            );
          })}
        </svg>
        {layout.nodes.map((n) => {
          const t = topics[n.id];
          const main = n.id === targetId;
          const word = t.label ?? STATE_WORD[t.state] ?? '';
          return (
            <button
              key={n.id}
              ref={(el) => { buttons.current[n.id] = el; }}
              type="button"
              className="hub-map-node"
              data-id={n.id}
              data-layer={n.layer}
              data-state={t.state}
              data-main={main ? 'true' : undefined}
              aria-pressed={picked === n.id}
              title={t.name}
              style={{ left: n.x, top: n.y, width: n.w, height: n.h }}
              onClick={() => onPick(n.id)}
            >
              <RichText as="span" className="hub-map-name" html={t.nameHtml} text={t.name} />
              <span className="hub-map-state">
                <StateMark state={main ? 'target' : t.state ?? 'none'} />
                {main ? targetWord : word}
                {main && word && <span className="sr-only">, {word}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
