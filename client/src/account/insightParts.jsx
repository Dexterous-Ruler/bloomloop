/**
 * The instruments the student's home and analytics both draw: the big ladder,
 * the trend line, accuracy by level (as rows, and as asked-against-right
 * pairs), how a class spreads by accuracy, the hardest topics, and strongest
 * and weakest said in sentences.
 *
 * Every one of them draws exactly what it is handed. None of them fills a gap
 * with an estimate: a missing value is drawn as missing and said as missing.
 */

import { useId, useRef, useState } from 'react';

import { LABEL, LEVELS } from '../lib/bloom.js';
import { Level } from '../ui/index.jsx';
import { BAND, MIN_EVIDENCE, asPct, bands, hardest, levelN, plural } from './insightData.js';

const SHORT = { remember: 'Rem', understand: 'Und', apply: 'App', analyse: 'Ana', evaluate: 'Eva', create: 'Cre' };

/** Six rows in taxonomy order, whatever came back: a missing level cannot shift a column. */
const sixRows = (bloom) => LEVELS.map((level) => (bloom ?? []).find((r) => r.level === level)
  ?? { level, seen: 0, correct: 0, accuracy: null });

/* ------------------------------------------------------------ the ladder */

/**
 * The climb, large: six rungs rising, each in its level colour with its number
 * and name, lit up to `level`. Drawn for a forest panel.
 */
export function BigLadder({ level, now = 'Now' }) {
  const lit = levelN(level);
  return (
    <div
      className="in-ladder"
      role="img"
      aria-label={level ? `Working at ${LABEL[level]}, level ${lit} of 6` : 'No level yet: none of the six is lit'}
    >
      {LEVELS.map((l, i) => (
        <div key={l} data-level={l} data-on={i < lit ? 'true' : undefined} data-now={i + 1 === lit ? 'true' : undefined}>
          {i + 1 === lit && <em>{now}</em>}
          <i style={{ '--d': `${i * 70}ms` }} />
          <span><b>{i + 1}</b><span className="in-ladder-name">{LABEL[l]}</span></span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ the trend */

const W = 800;
const H = 200;

/** Up to five indices spread across n, always including the two ends. */
function ticks(n) {
  if (n <= 5) return [...Array(n).keys()];
  return [...new Set([0, Math.round((n - 1) / 4), Math.round((n - 1) / 2), Math.round((3 * (n - 1)) / 4), n - 1])];
}

/**
 * Accuracy session by session: a line that draws itself in over a faint area,
 * the sessions before the range dashed, the 40% support band in gold, and a
 * crosshair that reads out the exact value under the pointer (or the arrow
 * keys, once the chart has focus).
 *
 * @param points    [{ v: 0..1, label, title, detail }], oldest first
 * @param previous  [v], the same number of sessions just before, oldest first
 */
export function TrendChart({ points, previous = [], name, prevName = 'Previous sessions', label }) {
  const grad = useId().replace(/:/g, '');
  const box = useRef(null);
  const [at, setAt] = useState(null);
  const n = points.length;
  if (!n) return null;

  const i = at ?? n - 1;
  const x = (k) => (n === 1 ? W / 2 : (k / (n - 1)) * W);
  const y = (v) => H - Math.max(0, Math.min(1, v)) * H;
  const pts = points.map((p, k) => `${x(k).toFixed(1)},${y(p.v).toFixed(1)}`);
  const prevPts = previous.slice(0, n).map((v, k) => (v == null ? null : `${x(k).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean);
  const here = points[i];
  const was = previous[i];

  const pick = (clientX) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || !r.width) return;
    setAt(Math.max(0, Math.min(n - 1, Math.round(((clientX - r.left) / r.width) * (n - 1)))));
  };
  const onKey = (e) => {
    const go = { ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: n - 1 }[e.key];
    if (go === undefined) return;
    e.preventDefault();
    setAt(Math.max(0, Math.min(n - 1, go)));
  };
  const pos = (k, v) => ({ left: `${(x(k) / W) * 100}%`, top: `${(y(v) / H) * 100}%` });

  return (
    <div className="in-trend">
      <div className="in-trend-read">
        <b className="in-trend-v">{asPct(here.v)}</b>
        <span className="in-trend-ctx" aria-live="polite">
          <strong>{here.label || 'No date'}</strong>
          {here.title ? ` · ${here.title}` : ''}
          {here.detail ? ` · ${here.detail}` : ''}
          {was != null ? ` · previous ${asPct(was)}` : ''}
        </span>
        <span className="in-legend">
          <span><i className="in-key-line" />{name}</span>
          {prevPts.length > 0 && <span><i className="in-key-dash" />{prevName}</span>}
          <span><i className="in-key-band" />Support band, {Math.round(BAND * 100)}%</span>
        </span>
      </div>

      <div className="in-trend-plot">
        <div className="in-trend-y" aria-hidden="true"><span>100%</span><span>50%</span><span>0</span></div>
        <div
          className="in-trend-box"
          ref={box}
          tabIndex={0}
          role="group"
          aria-label={`${label}. ${n === 1 ? 'One session.' : `${n} sessions, from ${asPct(points[0].v)} to ${asPct(points[n - 1].v)}.`} Arrow keys read each one.`}
          onMouseMove={(e) => pick(e.clientX)}
          onMouseLeave={() => setAt(null)}
          onKeyDown={onKey}
          onBlur={() => setAt(null)}
        >
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
            <defs>
              <linearGradient id={grad} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" className="in-grad-top" />
                <stop offset="1" className="in-grad-end" />
              </linearGradient>
            </defs>
            <line className="in-grid" x1="0" x2={W} y1="0" y2="0" />
            <line className="in-grid" x1="0" x2={W} y1={H / 2} y2={H / 2} />
            <line className="in-grid in-grid-base" x1="0" x2={W} y1={H} y2={H} />
            <line className="in-band" x1="0" x2={W} y1={y(BAND)} y2={y(BAND)} />
            {n > 1 && <path className="in-area" d={`M0,${H} L${pts.join(' L')} L${W},${H} Z`} fill={`url(#${grad})`} />}
            {prevPts.length > 1 && <polyline className="in-prev" points={prevPts.join(' ')} />}
            {n > 1 && <polyline className="in-line" points={pts.join(' ')} />}
            {at != null && <line className="in-cross" x1={x(i)} x2={x(i)} y1="0" y2={H} />}
          </svg>
          {/* Dots are elements, not SVG circles: the chart stretches to its
              box, and a stretched circle is an oval. */}
          <i className="in-dot in-dot-end" style={pos(n - 1, points[n - 1].v)} />
          {at != null && <i className="in-dot in-dot-at" style={pos(i, here.v)} />}
        </div>
        <div className="in-trend-x" aria-hidden="true">
          {ticks(n).map((k) => (
            <span key={k} style={{ left: `${(x(k) / W) * 100}%` }} data-edge={k === 0 ? 'start' : k === n - 1 ? 'end' : undefined}>
              {points[k].label}
            </span>
          ))}
        </div>
      </div>
      {n === 1 && <p className="hint">One session so far. A trend needs two.</p>}
    </div>
  );
}

/* ------------------------------------------------------- level, as rows */

/**
 * Accuracy at each level as six thin labelled bars, with a tick for where it
 * stood before the latest session when that can be worked out exactly.
 * Fewer than three answers at a level draws faded: it is too thin to judge.
 *
 * @param earlier  { level: 0..1 | null } or null
 */
export function LevelRows({ bloom, earlier, current }) {
  return (
    <ul className="in-lrows">
      {sixRows(bloom).map((r, i) => {
        const was = earlier?.[r.level];
        const thin = r.seen > 0 && r.seen < MIN_EVIDENCE;
        return (
          <li key={r.level} data-level={r.level} data-current={current === r.level ? 'true' : undefined} data-thin={thin ? 'true' : undefined}>
            <Level level={r.level} />
            <span className="in-lrow-track">
              {r.seen > 0 && <i style={{ width: `${Math.max(2, (r.accuracy ?? 0) * 100)}%`, '--d': `${i * 60}ms` }} />}
              {was != null && r.seen > 0 && <b className="in-lrow-was" style={{ left: `${was * 100}%` }} title={`Before your latest session: ${asPct(was)}`} />}
            </span>
            <span className="in-lrow-fig">
              {r.seen > 0
                ? <><strong>{asPct(r.accuracy)}</strong><small>{r.correct}/{r.seen}</small></>
                : <small>Not asked yet</small>}
              {was != null && r.seen > 0 && <span className="sr-only">, {asPct(was)} before your latest session</span>}
              {thin && <span className="sr-only">, too few answers to judge</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------------------------------------------- level, asked and right */

/**
 * Two bars at each level: how many questions were asked there, and how many
 * of those were right, in the level's colour. Read together, "how well" and
 * "on how much" cannot be mistaken for each other.
 */
export function LevelPairs({ bloom, current }) {
  const rows = sixRows(bloom);
  const top = Math.max(1, ...rows.map((r) => r.seen ?? 0));
  return (
    <div className="in-pairs-wrap">
      <div
        className="in-pairs"
        role="img"
        aria-label={rows.map((r) => (r.seen
          ? `${LABEL[r.level]}: ${r.correct} right of ${r.seen} asked, ${asPct(r.accuracy)}`
          : `${LABEL[r.level]}: not asked`)).join('. ')}
      >
        {rows.map((r, i) => (
          <div key={r.level} className="in-pair" data-level={r.level} data-current={current === r.level ? 'true' : undefined} style={{ '--d': `${i * 60}ms` }}>
            <div className="in-pair-bars">
              <span className="in-pair-asked" style={{ height: `${(r.seen / top) * 100}%` }}>{r.seen > 0 && <em>{r.seen}</em>}</span>
              <span className="in-pair-right" style={{ height: `${(r.correct / top) * 100}%` }}>{r.seen > 0 && <em>{r.correct}</em>}</span>
            </div>
            <span className="in-pair-pct" data-thin={r.seen > 0 && r.seen < MIN_EVIDENCE ? 'true' : undefined}>{r.seen ? asPct(r.accuracy) : '—'}</span>
            <span className="in-pair-name"><i className="swatch" /><span className="in-long">{LABEL[r.level]}</span><span className="in-short">{SHORT[r.level]}</span></span>
          </div>
        ))}
      </div>
      <div className="in-legend in-legend-under">
        <span><i className="in-key-asked" />Asked</span>
        <span><i className="in-key-right" />Right, in the level’s colour</span>
        {current && <span><i className="in-key-now" />Where the last session ended</span>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ the spread */

/**
 * How many people sit in each band of twenty points. The two bands under 40%
 * are drawn in the support-band gold. Nobody without answers is drawn: they
 * have no accuracy, which is not the same as 0%.
 */
export function Spread({ values, one = 'student', many = 'students' }) {
  const { counts, none } = bands(values);
  const top = Math.max(1, ...counts);
  const total = counts.reduce((a, b) => a + b, 0);
  return (
    <div className="in-spread">
      <div
        className="in-spread-bars"
        role="img"
        aria-label={counts.map((c, k) => `${k * 20} to ${(k + 1) * 20}%: ${c}`).join(', ')}
      >
        {counts.map((c, k) => (
          <div key={k} className="in-spread-col" data-low={k < 2 ? 'true' : undefined} style={{ '--d': `${k * 60}ms` }}>
            <b>{c}</b>
            <span className="in-spread-track"><i style={{ height: `${c ? Math.max(5, (c / top) * 100) : 0}%` }} /></span>
            <small>{k * 20}–{(k + 1) * 20}</small>
          </div>
        ))}
      </div>
      <p className="hint">
        {total ? `${plural(total, one)} with answers, by accuracy in percent.` : `No ${many} with answers yet.`}
        {none > 0 ? ` ${none} with none ${none === 1 ? 'is' : 'are'} left out, not counted as 0%.` : ''}
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- topics */

function TopicRow({ t, k, thin }) {
  const pct = t.seen ? (t.correct / t.seen) * 100 : 0;
  return (
    <li className="in-topic" data-thin={thin ? 'true' : undefined} data-low={!thin && t.accuracy < BAND ? 'true' : undefined}>
      <span className="in-topic-k">{thin ? '·' : String(k + 1).padStart(2, '0')}</span>
      <span className="in-topic-name">{t.topic}</span>
      <span className="in-topic-ct">{t.correct} of {t.seen} right</span>
      <span className="in-topic-pct">{asPct(t.accuracy)}</span>
      <span className="in-topic-bar" aria-hidden="true"><i style={{ width: `${pct}%`, '--d': `${k * 50}ms` }} /></span>
    </li>
  );
}

/** Topics, hardest first, then the ones too thin to call hard. */
export function Hardest({ topics }) {
  const { judged, thin } = hardest(topics);
  return (
    <ol className="in-topics">
      {judged.map((t, k) => <TopicRow key={t.topic} t={t} k={k} />)}
      {thin.length > 0 && (
        <li className="in-topics-sep" aria-hidden={judged.length ? undefined : 'true'}>
          Fewer than {MIN_EVIDENCE} answers: too few to call hard
        </li>
      )}
      {thin.map((t, k) => <TopicRow key={t.topic} t={t} k={judged.length + k} thin />)}
    </ol>
  );
}

/* --------------------------------------------------------------- in words */

const ADVICE = {
  you: 'That is where the next hour goes.',
  they: 'The level to aim their next questions at.',
  classes: 'The level to aim the next bank at.',
};

const names = (rows, withCount) =>
  rows.map((r) => `${LABEL[r.level] ?? r.level}${withCount ? ` (${r.seen})` : ''}`).join(', ');

/**
 * Strongest and weakest, in words.
 *
 * `confident` is the server's flag. It is false when fewer than two levels
 * have MIN_EVIDENCE answers behind them, and in that state `best` can still
 * hold the one level that qualified. Naming it would call someone "best at
 * Create" off a lucky answer, so when the flag is false no level is named,
 * whatever is in the field. Levels too thin to judge are listed as exactly
 * that, with their counts.
 *
 * @param who  'you' | 'they' | 'classes' - whose record this is, for the advice
 */
export function InWords({ bloom, best, weakest, confident, who }) {
  const thin = bloom.filter((r) => r.seen > 0 && r.seen < MIN_EVIDENCE);
  const unmet = bloom.filter((r) => !r.seen);
  const tally = (r) => `${r.correct} of ${r.seen} right (${asPct(r.accuracy)})`;

  return (
    <div className="in-words">
      {!confident || !best || !weakest ? (
        <p>
          Not enough to compare yet. Two levels need at least {MIN_EVIDENCE} answers each before one
          can be called stronger than the other, so nothing is named.
        </p>
      ) : best.accuracy === weakest.accuracy ? (
        <p>No gap to name. Every level with enough answers is at {asPct(best.accuracy)}.</p>
      ) : (
        <>
          <p>Strongest at <Level level={best.level} />, with {tally(best)}.</p>
          <p>Weakest at <Level level={weakest.level} />, with {tally(weakest)}. {ADVICE[who]}</p>
        </>
      )}
      {thin.length > 0 && <p className="muted">Too few answers to judge: {names(thin, true)}.</p>}
      {unmet.length > 0 && <p className="muted">Not asked yet: {names(unmet)}.</p>}
    </div>
  );
}
