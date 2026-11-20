/**
 * The instruments the student's home and analytics both draw: the big ladder,
 * the trend line, accuracy by level (as rows, and as asked-against-right
 * pairs), how a class spreads by accuracy, the hardest topics, and strongest
 * and weakest said in sentences. Then the evidence under them, which the
 * professor's overview draws too: topic by level as a grid of cells, and the
 * stored answers themselves, paged and filtered.
 *
 * Every one of them draws exactly what it is handed. None of them fills a gap
 * with an estimate: a missing value is drawn as missing and said as missing.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { LABEL, LEVELS } from '../lib/bloom.js';
import { labelOf } from '../lib/kinds.js';
import { Button, Chip, Icon, Level } from '../ui/index.jsx';
import {
  BAND, MIN_EVIDENCE, REVIEW, STEPS, asPct, bands, cellsOf, day, dayTime, hardest, levelN, markOf, plural, saidLines,
  stepOf,
} from './insightData.js';

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

/* ------------------------------------------------------- topic by level */

/** The scale under a grid. The cells carry their own words, so this is for the eye. */
export function HeatLegend() {
  return (
    <div className="in-heat-legend" aria-hidden="true">
      <span>0%</span>
      {STEPS.map((s) => <i key={s.step} data-step={s.step} title={s.label} />)}
      <span>100%</span>
      <i data-empty="true" />
      <span>Not asked</span>
    </div>
  );
}

function HeatCell({ topic, cell, on, onPick }) {
  if (!cell.seen) return <span className="in-cell" data-empty="true"><span className="sr-only">not asked</span></span>;
  const words = `${cell.correct} of ${cell.seen} right`;
  const face = <span aria-hidden="true">{cell.correct}<i>/</i>{cell.seen}</span>;
  const step = stepOf(cell.accuracy ?? cell.correct / cell.seen);
  if (!onPick) {
    return <span className="in-cell" data-step={step} title={`${topic}, ${LABEL[cell.level]}: ${words}`}>{face}<span className="sr-only">{words}</span></span>;
  }
  return (
    <button
      type="button"
      className="in-cell"
      data-step={step}
      aria-pressed={on}
      aria-label={`${topic}, ${LABEL[cell.level]}: ${words}. ${on ? 'Showing these answers' : 'Show these answers'}`}
      title={`${topic}, ${LABEL[cell.level]}: ${words}`}
      onClick={() => onPick(on ? null : { topic, level: cell.level })}
    >
      {face}
    </button>
  );
}

/**
 * Topic by level as small cells on one green: darker is stronger, each cell
 * says right of asked, and a cell nobody was asked is left empty. A level's
 * colour is only on its column head, beside its number and name.
 *
 * With `onPick`, a cell that has answers in it is a button: it narrows the
 * answer list beside it to that topic at that level, and pressing it again
 * lets go. `picked` is the { topic, level } in force.
 *
 * @param report  the server's topic report (topicLevels), topics most answered first
 */
export function TopicGrid({ report, first = 12, compact = false, picked, onPick, label = 'Right answers of those asked, for each topic at each level' }) {
  const [all, setAll] = useState(false);
  const topics = report?.topics ?? [];
  const rows = all ? topics : topics.slice(0, first);
  const untagged = report?.untagged ?? 0;

  return (
    <div className="in-heat-box" data-compact={compact ? 'true' : undefined}>
      <div className="in-heat-scroll">
        <table className="in-heat">
          <caption className="sr-only">{label}</caption>
          <thead>
            <tr>
              <th scope="col"><span className="sr-only">Topic</span></th>
              {LEVELS.map((l, i) => (
                <th key={l} scope="col" data-level={l}>
                  <span className="in-heat-lv"><i className="swatch" aria-hidden="true" />{i + 1}</span>
                  <span className="in-heat-name" aria-hidden="true"><span className="in-long">{LABEL[l]}</span><span className="in-short">{SHORT[l]}</span></span>
                  <span className="sr-only">{LABEL[l]}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((t, k) => (
              <tr key={t.topic} style={{ '--d': `${Math.min(k, 12) * 40}ms` }}>
                <th scope="row">
                  <span className="in-heat-topic" title={t.topic}>{t.topic}</span>
                  <small>{t.correct}/{t.seen} · {asPct(t.accuracy)}</small>
                </th>
                {cellsOf(t).map((c) => (
                  <td key={c.level}>
                    <HeatCell topic={t.topic} cell={c} onPick={onPick} on={picked?.topic === t.topic && picked?.level === c.level} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="in-heat-foot">
        <HeatLegend />
        {topics.length > first && (
          <button type="button" className="in-linkbtn" aria-expanded={all} onClick={() => setAll((v) => !v)}>
            {all ? `Show the first ${first}` : `Show all ${topics.length} topics`}
          </button>
        )}
      </div>
      {untagged > 0 && (
        <p className="hint">{plural(untagged, 'answer')} carried no topic, so {untagged === 1 ? 'it is' : 'they are'} counted in the levels but not here.</p>
      )}
    </div>
  );
}

/** The grid's shape while the report is on its way. */
export function TopicGridSkel({ rows = 4 }) {
  return (
    <div className="in-heat-skel" aria-busy="true" aria-label="Topics loading">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r}>
          <span className="skel" style={{ height: 12, width: `${70 - r * 10}%` }} />
          {LEVELS.map((l) => <span key={l} className="skel" />)}
        </div>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------- the answers */

const NO_FILTER = { level: '', topic: '' };
const BLANK = { status: 'loading', items: [], hasMore: false, error: '', moreBusy: false, moreError: '' };

/**
 * One student's stored answers, a page at a time, newest first, narrowed by
 * level and topic.
 *
 * `load(params)` is GET /api/analytics/:id/answers for that student, or the
 * gallery's stand-in. `key` is who they are; null asks for nothing. A new key
 * starts again with no filter, and nothing read for one person is ever drawn
 * under the next: rows are kept only under the key they were read for.
 * Narrowing the same person keeps their rows on screen, dimmed, until the
 * narrowed page lands, and so does a new `version`: the page was read again,
 * so the first page is asked for again with the filter kept.
 */
export function useAnswers(load, key, size = 10, version = 0) {
  const loader = useRef(load);
  loader.current = load;
  const seq = useRef(0);
  const [nonce, setNonce] = useState(0);
  const [chosen, setChosen] = useState({ key, ...NO_FILTER });
  const filters = chosen.key === key ? chosen : { key, ...NO_FILTER };
  const [page, setPage] = useState({ key: null, ...BLANK });

  useEffect(() => {
    if (key == null || !loader.current) return undefined;
    seq.current += 1;
    const id = seq.current;
    setPage((p) => (p.key === key ? { ...p, status: 'loading', error: '', moreError: '' } : { key, ...BLANK }));
    loader.current({ limit: size, offset: 0, level: filters.level, topic: filters.topic }).then(
      (res) => {
        if (seq.current === id) setPage({ key, ...BLANK, status: 'ready', items: res?.items ?? [], hasMore: Boolean(res?.hasMore) });
      },
      (err) => {
        if (seq.current === id) setPage({ key, ...BLANK, status: 'error', error: err?.message || 'The server did not answer.' });
      },
    );
    return () => { if (seq.current === id) seq.current += 1; };
  }, [key, filters.level, filters.topic, nonce, size, version]);

  const offset = page.key === key ? page.items.length : 0;
  const more = useCallback(() => {
    const id = seq.current;
    setPage((p) => ({ ...p, moreBusy: true, moreError: '' }));
    loader.current({ limit: size, offset, level: filters.level, topic: filters.topic }).then(
      (res) => {
        if (seq.current !== id) return;
        setPage((p) => {
          // An answer given since the first page moves every offset by one, so
          // the next page can repeat a row. It is drawn once.
          const have = new Set(p.items.map((a) => a.answerId));
          const fresh = (res?.items ?? []).filter((a) => !have.has(a.answerId));
          return { ...p, items: [...p.items, ...fresh], hasMore: Boolean(res?.hasMore), moreBusy: false };
        });
      },
      (err) => {
        if (seq.current === id) setPage((p) => ({ ...p, moreBusy: false, moreError: err?.message || 'The server did not answer.' }));
      },
    );
  }, [offset, filters.level, filters.topic, size]);

  const shown = key == null ? { ...BLANK, status: 'idle' } : page.key === key ? page : BLANK;
  return {
    ...shown,
    filters: { level: filters.level, topic: filters.topic },
    filtered: Boolean(filters.level || filters.topic),
    setFilters: (next) => setChosen({ key, level: filters.level, topic: filters.topic, ...(next ?? NO_FILTER) }),
    more,
    retry: () => setNonce((n) => n + 1),
  };
}

/**
 * Level and topic, as two small selects, and a way to let go of both. The
 * topics offered are the report's; one in force stays offered even if the
 * report has since lost it, so the select never lies about the list.
 */
export function AnswerFilters({ answers, topics = [] }) {
  const { filters, setFilters, filtered } = answers;
  // Nothing to narrow: a filter over an empty list would do nothing.
  if (answers.status === 'idle' || (answers.status === 'ready' && !answers.items.length && !filtered)) return null;
  const names = !filters.topic || topics.includes(filters.topic) ? topics : [filters.topic, ...topics];
  return (
    <div className="in-ans-filters">
      <select
        className="select input-sm"
        aria-label="Answers at which level"
        value={filters.level}
        onChange={(e) => setFilters({ level: e.target.value })}
      >
        <option value="">All levels</option>
        {LEVELS.map((l, i) => <option key={l} value={l}>{i + 1} · {LABEL[l]}</option>)}
      </select>
      {names.length > 0 && (
        <select
          className="select input-sm"
          aria-label="Answers on which topic"
          value={filters.topic}
          onChange={(e) => setFilters({ topic: e.target.value })}
        >
          <option value="">All topics</option>
          {names.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      )}
      {filtered && <button type="button" className="in-linkbtn" onClick={() => setFilters(null)}>Clear filter</button>}
    </div>
  );
}

/** Right, wrong, a share of the credit, or nothing to mark. Said in words as well as drawn. */
function AnswerMark({ item }) {
  const m = markOf(item);
  if (m.kind === 'poll') {
    return <span className="in-mark" data-tone="poll"><Icon name="minus" size={12} /><span className="sr-only">A poll, not marked</span></span>;
  }
  const right = m.kind === 'right';
  if (m.partial) {
    return (
      <span className="in-mark is-score" data-tone={right ? 'right' : 'wrong'}>
        <span aria-hidden="true">{Math.round(m.score * 100)}<small>%</small></span>
        <span className="sr-only">{asPct(m.score)} credit, counted as {right ? 'right' : 'wrong'}</span>
      </span>
    );
  }
  return (
    <span className="in-mark" data-tone={right ? 'right' : 'wrong'}>
      <Icon name={right ? 'check' : 'close'} size={12} />
      <span className="sr-only">{right ? 'Right' : 'Wrong'}</span>
    </span>
  );
}

/**
 * One stored answer: the question on one line (pressed, it opens in full),
 * what was sent, then where and when, the mark's review state and the
 * professor's note, which is written for the student and shown as written.
 */
function AnswerRow({ item, view }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const lines = saidLines(item);
  const review = REVIEW[item.review?.status];
  const note = String(item.review?.note ?? '').trim();
  const text = String(item.question?.text ?? '').trim();
  const facts = [
    labelOf(item),
    item.attempt > 1 ? `attempt ${item.attempt}` : null,
    dayTime(item.answeredAt) || null,
    item.room?.title || null,
  ].filter(Boolean).join(' · ');

  return (
    <li className="in-ans" data-open={open ? 'true' : undefined}>
      <AnswerMark item={item} />
      <div className="in-ans-main">
        <button type="button" className="in-ans-q" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
          <span className="in-ans-text">{text || 'The question text was not stored.'}</span>
          <Icon name="chevron" size={14} className="in-ans-chev" />
        </button>
        <div className="in-ans-said" id={id}>
          {lines.length === 0 ? (
            <span className="in-ans-none">No answer given</span>
          ) : open ? (
            <ul>{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
          ) : (
            <span className="in-ans-line">{lines.join(' · ')}</span>
          )}
          {open && facts && <p className="in-ans-facts">{facts}</p>}
        </div>
        <div className="in-ans-meta">
          {item.level && <Level level={item.level} />}
          {item.topic && <span className="in-ans-topic" title={item.topic}>{item.topic}</span>}
          <span className="mono">{item.room?.code || '——'}</span>
          <span>{day(item.answeredAt) || 'Undated'}</span>
          {item.final === false && <span>Tried again, not counted</span>}
          {review && <Chip tone={review.tone} title={review.why}>{review.label}</Chip>}
        </div>
        {note && (
          <p className="in-ans-note">
            <b>{view === 'student' ? 'From your professor' : 'Note to the student'}</b>
            <span>{note}</span>
          </p>
        )}
      </div>
    </li>
  );
}

function AnswerSkel({ n }) {
  return (
    <ol className="in-answers" aria-busy="true" aria-label="Answers loading">
      {Array.from({ length: n }, (_, i) => (
        <li key={i} className="in-ans">
          <span className="skel" style={{ width: 20, height: 20, borderRadius: 999 }} />
          <div className="in-ans-main">
            <span className="skel" style={{ height: 13, width: `${82 - i * 11}%` }} />
            <span className="skel" style={{ height: 11, width: `${54 - i * 8}%` }} />
            <span className="skel" style={{ height: 18, width: 150 }} />
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * The answers from useAnswers(), in every state they can be in: a shaped
 * skeleton, a failure with a way to ask again, nothing at all (`empty` says
 * why, in the caller's words), nothing under a filter, and the rows with
 * "Show more" while the server says there are older ones.
 *
 * @param view  'student' or 'teacher': only whose note it is changes
 */
export function AnswerList({ answers, view = 'student', empty, compact = false, label = 'Answers, newest first' }) {
  const { status, items, hasMore, error, moreBusy, moreError, filters, filtered } = answers;

  if (status === 'idle') return null;
  if (status === 'loading' && !items.length) return <AnswerSkel n={compact ? 3 : 4} />;
  if (status === 'error') {
    return (
      <div className="in-ans-state" role="alert">
        <p><b>The answers did not load.</b> {error}</p>
        <Button size="sm" icon="refresh" onClick={answers.retry}>Try again</Button>
      </div>
    );
  }
  if (!items.length) {
    return filtered ? (
      <div className="in-ans-state">
        <p>
          <b>Nothing under this filter.</b> No answers
          {filters.level ? ` at ${LABEL[filters.level]}` : ''}{filters.topic ? ` on ${filters.topic}` : ''}.
        </p>
        <Button size="sm" onClick={() => answers.setFilters(null)}>Show every answer</Button>
      </div>
    ) : (
      <div className="in-ans-state">{empty}</div>
    );
  }

  return (
    <div className="in-ans-wrap" aria-busy={status === 'loading' || moreBusy ? 'true' : undefined} data-stale={status === 'loading' ? 'true' : undefined}>
      <ol className="in-answers" aria-label={label}>
        {items.map((a, i) => <AnswerRow key={a.answerId || i} item={a} view={view} />)}
      </ol>
      {hasMore ? (
        <div className="in-ans-more">
          {moreError && <p className="in-ans-err" role="alert">The next answers did not load: {moreError}</p>}
          <Button size="sm" variant="ghost" icon={moreError ? 'refresh' : 'chevron'} busy={moreBusy} onClick={answers.more}>
            {moreError ? 'Try again' : 'Show more'}
          </Button>
        </div>
      ) : (
        <p className="in-ans-end">
          {plural(items.length, 'answer')}{filtered ? ' under this filter' : ''}. Nothing older is on record.
        </p>
      )}
    </div>
  );
}
