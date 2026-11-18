/**
 * The class as marbles in six tubes: one marble per student, one tube per level.
 *
 * This is the picture the product exists to show - where everyone is working
 * and who just moved. A student who steps up a level leaves their tube and
 * drops into the next, and is ringed for a moment so the eye finds them.
 *
 * The marbles are rigid bodies (Rapier, 2D), because a pile has to behave like
 * a pile: when one leaves, the ones above it settle. But physics is only ever
 * the answer to a change. The board is first drawn already packed with every
 * body asleep, nothing moves until a student joins or changes level, and once
 * the pile is at rest the simulation takes itself off the ticker. With reduced
 * motion, or if the engine cannot load, the same packed layout is redrawn -
 * the board never depends on the animation to be correct.
 *
 * Rapier is 3 MB of WebAssembly, so it is imported here on demand and never
 * reaches a phone.
 *
 * `tray` puts everyone in one wide bin: the projector uses it to show the room
 * filling up before anyone has a level worth sorting by.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { LABEL, LEVELS } from '../lib/bloom.js';
import { gsap, reduced } from '../lib/motion.js';
import { onThemeChange, token } from '../lib/theme.js';
import { Level } from '../ui/index.jsx';

const SCALE = 40;      // pixels per physics metre
const WALL = 3;        // half-thickness of a divider in px; drawn as a hairline
const MAX_R = 12;
const MIN_R = 4;
const FLASH_MS = 1600;
const SHORT = ['Rem', 'Und', 'App', 'Ana', 'Eva', 'Cre'];

const levelIndex = (l) => Math.max(0, LEVELS.indexOf(l));

// One engine per page. Rapier's init() only checks whether it is loaded before
// it starts, so two boards (or one board rebuilt while the first load is in
// flight) would each instantiate it, and the later one swaps the WebAssembly
// memory out from under a world the earlier one already built.
let engine = null;
function loadEngine() {
  engine ??= import('@dimforge/rapier2d-compat')
    .then(async (mod) => { const R = mod.default ?? mod; await R.init(); return R; })
    .catch((err) => { engine = null; throw err; });
  return engine;
}

/** The largest marble that lets the fullest bin fit in four fifths of the height. */
function radiusFor(binW, height, counts) {
  const most = Math.max(1, ...counts);
  for (let r = MAX_R; r > MIN_R; r -= 1) {
    const perRow = Math.max(1, Math.floor((binW - 2 * WALL - 4) / (2 * r + 2)));
    if (Math.ceil(most / perRow) * (2 * r + 2) <= height * 0.8) return r;
  }
  return MIN_R;
}

/** Where every marble sits at rest: rows from the floor up, centred in its bin. */
function pack(rows, w, height, bins) {
  const binW = w / bins;
  const groups = Array.from({ length: bins }, () => []);
  rows.forEach((r) => groups[bins === 1 ? 0 : levelIndex(r.workingLevel)].push(r));
  const radius = radiusFor(binW, height, groups.map((g) => g.length));
  const pitch = 2 * radius + 2;
  const perRow = Math.max(1, Math.floor((binW - 2 * WALL - 4) / pitch));
  const at = new Map();
  groups.forEach((g, bin) => {
    g.forEach((row, n) => {
      const line = Math.floor(n / perRow);
      const inLine = Math.min(perRow, g.length - line * perRow);
      const x = bin * binW + binW / 2 + ((n % perRow) - (inLine - 1) / 2) * pitch;
      at.set(row.rollNo, { x, y: height - radius - 1 - line * pitch, bin });
    });
  });
  return { at, radius, binW };
}

function makeBody(st, x, y, asleep) {
  const { R, world, layout } = st;
  const body = world.createRigidBody(
    R.RigidBodyDesc.dynamic().setTranslation(x / SCALE, y / SCALE).setLinearDamping(0.4).setAngularDamping(1).setCcdEnabled(true),
  );
  world.createCollider(R.ColliderDesc.ball(layout.radius / SCALE).setRestitution(0.2).setFriction(0.45).setDensity(1), body);
  if (asleep) body.sleep();
  return body;
}

export default function Marbles({ rows, selected, onSelect, frozen = false, height = 240, tray = false, caption = true }) {
  const stage = useRef(null);
  const canvas = useRef(null);
  const sim = useRef(null);
  const latest = useRef({ rows, selected });
  const [width, setWidth] = useState(0);
  const [tip, setTip] = useState(null);
  const bins = tray ? 1 : LEVELS.length;

  latest.current = { rows, selected };

  const counts = useMemo(() => LEVELS.map((l) => rows.filter((r) => r.workingLevel === l).length), [rows]);

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(stage.current);
    return () => ro.disconnect();
  }, []);

  // The world, rebuilt whenever the stage changes size.
  useEffect(() => {
    if (!width) return undefined;
    const cv = canvas.current;
    const ctx = cv.getContext('2d');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(width * dpr);
    cv.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const st = {
      width, layout: pack(latest.current.rows, width, height, bins), beads: new Map(),
      world: null, R: null, on: false, acc: 0, idle: 0, frames: 0, dead: false, hover: null, tone: {},
    };
    st.layout.at.forEach((p, roll) => st.beads.set(roll, { ...p }));
    sim.current = st;

    // Read from the stage itself, not the page root, so a board placed on a
    // forest panel (.on-panel) is drawn in that panel's turned-over tokens.
    const readTones = () => {
      const el = stage.current ?? undefined;
      st.tone = {
        fills: LEVELS.map((_, i) => token(`--l${i + 1}`, el)),
        text: token('--text', el), line: token('--line-2', el), glass: token('--raised', el),
        // The tray is one colour: the projector shows who has arrived, never how anyone is doing.
        tray: token('--primary', el),
      };
    };
    readTones();

    const draw = () => {
      const { rows: list, selected: sel } = latest.current;
      const r = st.layout.radius;
      const { fills, text, line, glass, tray: one } = st.tone;
      const now = performance.now();
      ctx.clearRect(0, 0, width, height);

      // The tubes: a tinted glass per bin, open at the top, with a faint
      // highlight down the left wall and a floor line so they read as glass.
      for (let i = 0; i < bins; i += 1) {
        const x0 = i * st.layout.binW + 4;
        const w = st.layout.binW - 8;
        ctx.beginPath();
        ctx.roundRect(x0, 8, w, height - 8, [8, 8, 18, 18]);
        ctx.fillStyle = glass; ctx.fill();
        ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.stroke();
        ctx.globalAlpha = 0.5;
        ctx.beginPath(); ctx.moveTo(x0 + 4.5, 18); ctx.lineTo(x0 + 4.5, height - 22);
        ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.stroke();
        ctx.globalAlpha = 1;
      }

      let flashing = false;
      list.forEach((row) => {
        const b = st.beads.get(row.rollNo);
        if (!b) return;
        const fill = bins === 1 ? one : fills[levelIndex(row.workingLevel)];
        ctx.globalAlpha = row.online === false ? 0.4 : 1;
        ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
        ctx.fillStyle = fill; ctx.fill();
        // A rim in the text colour at low strength, so the palest levels still
        // have an edge on either ground.
        ctx.globalAlpha *= 0.32;
        ctx.strokeStyle = text; ctx.lineWidth = 1; ctx.stroke();
        // And a small specular dot: a marble, not a disc.
        if (r >= 6) {
          ctx.globalAlpha = row.online === false ? 0.2 : 0.45;
          ctx.beginPath(); ctx.arc(b.x - r * 0.35, b.y - r * 0.38, r * 0.28, 0, Math.PI * 2);
          ctx.fillStyle = '#FFFFFF'; ctx.fill();
        }
        ctx.globalAlpha = 1;

        const isSel = row.rollNo === sel;
        if (isSel || row.rollNo === st.hover) {
          ctx.beginPath(); ctx.arc(b.x, b.y, r + 3, 0, Math.PI * 2);
          ctx.strokeStyle = text; ctx.lineWidth = isSel ? 2 : 1; ctx.stroke();
        }
        // Just moved: a ring that widens and fades once.
        if (b.flash) {
          const t = (now - b.flash) / FLASH_MS;
          if (t >= 1) b.flash = 0;
          else {
            flashing = true;
            ctx.globalAlpha = 1 - t;
            ctx.beginPath(); ctx.arc(b.x, b.y, r + 3 + t * 14, 0, Math.PI * 2);
            ctx.strokeStyle = text; ctx.lineWidth = 1.5; ctx.stroke();
            ctx.globalAlpha = 1;
          }
        }
      });
      return flashing;
    };
    st.draw = draw;

    const tick = (_t, deltaMs) => {
      if (st.dead) return;
      let moving = false;
      if (st.world) {
        st.acc = Math.min(st.acc + deltaMs / 1000, 0.05);
        while (st.acc >= 1 / 60) { st.world.step(); st.acc -= 1 / 60; }
        st.beads.forEach((b) => {
          if (!b.body) return;
          const t = b.body.translation();
          b.x = t.x * SCALE; b.y = t.y * SCALE;
          if (!b.body.isSleeping()) moving = true;
        });
      }
      const flashing = draw();
      st.idle = moving || flashing ? 0 : st.idle + 1;
      st.frames += 1;
      // The engine putting every body to sleep is the signal; the frame cap is
      // for the pile that never quite stops trembling.
      if (st.idle > 20 || st.frames > 720) { gsap.ticker.remove(tick); st.on = false; }
    };
    st.wake = () => {
      if (reduced() || st.dead) { draw(); return; }
      st.frames = 0; st.idle = 0;
      st.beads.forEach((b) => b.body?.wakeUp());
      if (!st.on) { st.on = true; gsap.ticker.add(tick); }
    };

    draw();
    const offTheme = onThemeChange(() => { readTones(); draw(); });

    let cancelled = false;
    if (!reduced()) {
      loadEngine().then((R) => {
        if (cancelled) return;
        const world = new R.World({ x: 0, y: 34 });
        const fixed = world.createRigidBody(R.RigidBodyDesc.fixed());
        const box = (cx, cy, hw, hh) => world.createCollider(
          R.ColliderDesc.cuboid(hw / SCALE, hh / SCALE).setTranslation(cx / SCALE, cy / SCALE).setFriction(0.5), fixed,
        );
        box(width / 2, height + 10, width, 10);
        // Walls run far above the stage, so a marble dropped in from the top
        // cannot bounce over a divider into the wrong level.
        for (let i = 0; i <= bins; i += 1) box(i * st.layout.binW, height / 2 - 400, WALL + 1, height / 2 + 400);
        st.R = R; st.world = world;
        st.beads.forEach((b) => { b.body = makeBody(st, b.x, b.y, true); });
      }).catch(() => { /* the packed layout stands */ });
    }

    return () => {
      cancelled = true; st.dead = true;
      offTheme();
      gsap.ticker.remove(tick);
      st.world?.free();
      sim.current = null;
    };
  }, [width, height, bins]);

  // Reconcile the roster with the board.
  useEffect(() => {
    const st = sim.current;
    if (!st) return;
    const next = pack(rows, st.width, height, bins);
    const physical = Boolean(st.world) && !reduced() && !frozen;
    // A different marble size means every body is the wrong size: start over
    // from the packed layout rather than animate forty marbles growing.
    const resized = next.radius !== st.layout.radius;
    st.layout = next;
    let changed = false;

    const present = new Set(rows.map((r) => r.rollNo));
    st.beads.forEach((b, roll) => {
      if (present.has(roll)) return;
      if (b.body) st.world.removeRigidBody(b.body);
      st.beads.delete(roll);
      changed = true;
    });

    rows.forEach((row) => {
      const want = next.at.get(row.rollNo);
      const have = st.beads.get(row.rollNo);
      const moved = Boolean(have) && have.bin !== want.bin;
      if (!physical || resized) {
        if (have?.body) st.world.removeRigidBody(have.body);
        const body = st.world && !reduced() ? makeBody(st, want.x, want.y, true) : undefined;
        st.beads.set(row.rollNo, { ...want, body, flash: moved ? performance.now() : have?.flash ?? 0 });
        if (moved) changed = true;
        return;
      }
      const dropX = want.bin * next.binW + next.binW / 2 + (Math.random() - 0.5) * (next.binW - 4 * next.radius) * 0.6;
      if (!have) {
        // Someone joined: they drop in from above their tube.
        st.beads.set(row.rollNo, { x: dropX, y: -next.radius, bin: want.bin, body: makeBody(st, dropX, -next.radius, false), flash: 0 });
        changed = true;
      } else if (moved) {
        // Someone moved: out of the old pile, in at the top of the new one.
        have.bin = want.bin;
        have.flash = performance.now();
        have.body.setTranslation({ x: dropX / SCALE, y: -next.radius / SCALE }, true);
        have.body.setLinvel({ x: 0, y: 0 }, true);
        changed = true;
      }
    });

    if (changed) st.wake(); else st.draw();
  }, [rows, frozen, width, height, bins]);

  useEffect(() => { sim.current?.draw(); }, [selected]);

  const hitAt = (e) => {
    const st = sim.current;
    if (!st) return null;
    const box = canvas.current.getBoundingClientRect();
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;
    const reach = (st.layout.radius + 3) ** 2;
    let hit = null;
    st.beads.forEach((b, roll) => { if ((b.x - x) ** 2 + (b.y - y) ** 2 <= reach) hit = { roll, x: b.x, y: b.y }; });
    return hit;
  };

  const onMove = (e) => {
    const st = sim.current;
    const hit = hitAt(e);
    if (!st || (hit?.roll ?? null) === st.hover) return;
    st.hover = hit?.roll ?? null;
    st.draw();
    if (!hit) { setTip(null); return; }
    const row = rows.find((r) => r.rollNo === hit.roll);
    setTip({ x: hit.x, y: hit.y - st.layout.radius - 8, text: row?.name ? `${hit.roll} · ${row.name}` : hit.roll });
  };
  const onLeave = () => { if (sim.current) { sim.current.hover = null; sim.current.draw(); } setTip(null); };

  return (
    <div className="marbles">
      <div className="marbles-stage" ref={stage} style={{ height }}>
        <canvas
          ref={canvas}
          style={{ width: '100%', height, cursor: tip && onSelect ? 'pointer' : 'default' }}
          role="img"
          aria-label={tray
            ? `${rows.length} students in the room`
            : `Students by working level: ${LEVELS.map((l, i) => `${LABEL[l]} ${counts[i]}`).join(', ')}.`}
          onPointerMove={onMove}
          onPointerLeave={onLeave}
          onClick={(e) => { const hit = hitAt(e); if (hit) onSelect?.(hit.roll); }}
        />
        {tip && <span className="marbles-tip" style={{ left: tip.x, top: tip.y }}>{tip.text}</span>}
      </div>
      {caption && !tray && (
        <div className="marbles-rail">
          {LEVELS.map((l, i) => (
            <div key={l} data-level={l}>
              <Level level={l} />
              <span className="marbles-short"><i className="swatch" />{SHORT[i]}</span>
              <b className="mono">{counts[i]}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
