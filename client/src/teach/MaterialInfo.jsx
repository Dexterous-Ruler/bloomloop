/**
 * What the Material screen says about a chapter beyond its topic list (Batch 8,
 * design-zip gaps M1, M2 and M5; GET /api/content/:id):
 *
 *   topicSources   where each topic came from: "Slides 3–4", "Line 3", or a
 *                  note saying why neither is known
 *   levelSupport   for every topic, ticked or not, which of the six levels the
 *                  material can carry, each with the server's reason
 *   lastUsed       the newest room opened on the chapter (the library list)
 *
 * Each piece hides when its field is absent: a server before Batch 8 sends
 * none of them, and the screen reads as it did.
 */

import { useEffect, useRef, useState } from 'react';

import { api } from '../lib/api.js';
import { LABEL, LEVELS } from '../lib/bloom.js';
import { Icon, Tip } from '../ui/index.jsx';

import '../styles/material8.css';

/** The Batch 8 parts of a GET /api/content/:id reply; null where the server sent none. */
export function chapterInfo(res) {
  return {
    sources: Array.isArray(res?.topicSources) ? res.topicSources : null,
    support: res?.levelSupport && Array.isArray(res.levelSupport.topics) ? res.levelSupport : null,
    lastUsed: res?.lastUsed ?? null,
  };
}

/**
 * The chapter read again whenever its topic list changes (a rename or an added
 * topic moves both the sources and the grid). The last answer stays on screen
 * while the next is read; a failed read hides the pieces.
 */
export function useChapterInfo(contentId, topicsKey) {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    if (!contentId) { setInfo(null); return undefined; }
    let alive = true;
    api.getContent(contentId).then(
      (res) => { if (alive) setInfo(chapterInfo(res)); },
      () => { if (alive) setInfo(null); },
    );
    return () => { alive = false; };
  }, [contentId, topicsKey]);
  return info;
}

const SOURCE_ICON = { slides: 'deck', line: 'material' };

/** Under a topic's name: where it came from, or the server's note on why that is not known. */
export function TopicSource({ source }) {
  const text = source?.label || source?.note;
  if (!text) return null;
  return (
    <small className="m8-src" data-none={source.label ? undefined : 'true'}>
      <Icon name={SOURCE_ICON[source.kind] ?? 'help'} size={12} />
      <span>{text}</span>
    </small>
  );
}

/* ------------------------------------------------------- the level grid */

const STATE_WORD = { on: 'Ticked', off: 'Not ticked', no: 'Not supported by the material' };
const andList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** The key, in the same three marks the cells use. */
function Key() {
  return (
    <ul className="m8-key" aria-label="Key">
      {['on', 'off', 'no'].map((s) => (
        <li key={s}>
          <i className="m8-cell" data-cell={s} aria-hidden="true">{s === 'on' && <Icon name="check" size={11} />}</i>
          {STATE_WORD[s]}
        </li>
      ))}
    </ul>
  );
}

/**
 * Every topic against the six levels: ticked (the topic is ticked and the
 * material supports the level), not ticked, or not supported by the material.
 * Each cell's reason is its tooltip and the line under the grid; the grid is
 * one stop on Tab, and the arrow keys, Home and End move through it.
 *
 * @param support   levelSupport { topics: [{ topic, supports, levels: [{ level, label, supported, kind, reason }] }], note }
 * @param selected  the ticked topics' names
 */
export function LevelSupportGrid({ support, selected = [] }) {
  const [at, setAt] = useState(null);
  const table = useRef(null);
  const rows = (support?.topics ?? []).filter((t) => Array.isArray(t?.levels));
  if (!rows.length) return null;

  const ticked = new Set(selected);
  const cellOf = (r, c) => rows[r]?.levels?.find((l) => l.level === LEVELS[c]) ?? null;
  const stateOf = (r, c) => (cellOf(r, c)?.supported ? (ticked.has(rows[r].topic) ? 'on' : 'off') : 'no');
  const home = at ?? [0, 0];
  const focus = (r, c) => {
    const nr = Math.max(0, Math.min(rows.length - 1, r));
    const nc = Math.max(0, Math.min(LEVELS.length - 1, c));
    setAt([nr, nc]);
    table.current?.querySelector(`[data-rc="${nr}:${nc}"]`)?.focus();
  };
  const onKey = (e) => {
    const [r, c] = home;
    const move = {
      ArrowRight: [r, c + 1], ArrowLeft: [r, c - 1], ArrowDown: [r + 1, c], ArrowUp: [r - 1, c],
      Home: e.ctrlKey ? [0, 0] : [r, 0], End: e.ctrlKey ? [rows.length - 1, LEVELS.length - 1] : [r, LEVELS.length - 1],
    }[e.key];
    if (!move) return;
    e.preventDefault();
    focus(...move);
  };
  const shown = at ? cellOf(...at) : null;

  return (
    <section className="m8-grid" aria-labelledby="m8-grid-h">
      <div className="m8-grid-head">
        <div className="sec">
          <h3 id="m8-grid-h">Levels the material supports</h3>
          <p>Every topic, ticked or not, at each of the six levels.</p>
        </div>
        <Key />
      </div>
      <div className="m8-grid-wrap">
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <table ref={table} className="m8-table" role="grid" aria-labelledby="m8-grid-h" onKeyDown={onKey}>
          <thead>
            <tr>
              <th scope="col" className="m8-th-topic">Topic</th>
              {LEVELS.map((l, i) => (
                <th key={l} scope="col" data-level={l} className="m8-th-lv">
                  <i className="swatch" aria-hidden="true" />
                  <span className="m8-lvn" aria-hidden="true">{i + 1}</span>
                  <span className="m8-lvl">{LABEL[l]}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((t, r) => {
              const missing = LEVELS.filter((_, c) => stateOf(r, c) === 'no');
              return (
                <tr key={t.topic} data-on={ticked.has(t.topic) ? 'true' : 'false'}>
                  <th scope="row" className="m8-th-row">
                    <span className="m8-row-name">{t.topic}</span>
                    {missing.length > 0 && (
                      <small className="m8-row-no">
                        {missing.length === LEVELS.length
                          ? 'Not supported by the material at any level.'
                          : `Not supported by the material: ${andList(missing.map((l) => LABEL[l]))}.`}
                      </small>
                    )}
                  </th>
                  {LEVELS.map((l, c) => {
                    const cell = cellOf(r, c);
                    const state = stateOf(r, c);
                    const active = home[0] === r && home[1] === c;
                    return (
                      <Tip key={l} label={cell?.reason}>
                        <td
                          role="gridcell"
                          data-level={l}
                          data-rc={`${r}:${c}`}
                          tabIndex={active ? 0 : -1}
                          aria-label={`${t.topic}, ${LABEL[l]}: ${STATE_WORD[state]}. ${cell?.reason ?? ''}`}
                          // The reason is in the label already; the tooltip would read it twice.
                          aria-describedby={undefined}
                          aria-selected={at && active ? 'true' : undefined}
                          onFocus={() => setAt([r, c])}
                          onClick={() => setAt([r, c])}
                        >
                          <i className="m8-cell" data-cell={state} aria-hidden="true">{state === 'on' && <Icon name="check" size={11} />}</i>
                        </td>
                      </Tip>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {/* Touch has no hover: the cell last pressed or focused is read out here too. */}
      <p className="m8-grid-why" data-empty={shown ? undefined : 'true'}>
        {shown
          ? <><b>{rows[at[0]].topic} · {shown.label}.</b> {shown.reason}</>
          : 'Press or focus a square to read the reason for it.'}
      </p>
      {support.note && <p className="hint">{support.note}</p>}
    </section>
  );
}
