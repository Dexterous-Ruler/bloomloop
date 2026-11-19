/**
 * A class's latest room against the one before it, level by level (Batch 8,
 * gap A1), and the hardest list's way into the question bank (gap A3). Staff
 * only, in the class's "Across rooms" view (account/Classes.jsx).
 *
 *   <LevelChange c bands first />   c is GET /api/classes/:id/analytics `comparison`;
 *                                   nothing at all when it is null (fewer than two rooms)
 *   <BankLink item />               "Open in question bank" for a hardest item with
 *                                   its chapter (`contentId`) and `questionId`
 *
 * Decision 6: the three level bands first, the six levels one press away, as
 * the "Accuracy by level" card beside it reads. Every figure is the server's,
 * with the right and answered counts it rests on; the change is its signed
 * percentage points, or "not in both rooms" where either has no answer.
 * Each room's bar is named by its code, so the two are never told apart by
 * colour alone.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { LABEL, LEVELS } from '../lib/bloom.js';
import { Icon, Level, Segmented } from '../ui/index.jsx';

import '../styles/levels.css';

const list = (v) => (Array.isArray(v) ? v : []);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const pct = (v) => (num(v) === null ? '—' : `${Math.round(v * 100)}%`);
const day = (iso) => {
  const t = iso ? new Date(iso) : null;
  return t && !Number.isNaN(t.getTime()) ? t.toLocaleDateString([], { day: 'numeric', month: 'short' }) : '';
};

/** The change as signed points: "+12.5 pts", "−4 pts", "No change". Null: not in both rooms. */
function changeOf(change) {
  const c = num(change);
  if (c === null) return null;
  const n = Math.round(c * 10) / 10;
  if (n === 0) return { text: 'No change', icon: null };
  return { text: `${n > 0 ? '+' : '−'}${Math.abs(n)} pts`, icon: n > 0 ? 'up' : 'down', said: `${n > 0 ? 'up' : 'down'} ${Math.abs(n)} points` };
}

function RoomBar({ side, room, cell }) {
  const answers = num(cell?.answers) ?? 0;
  const acc = answers ? num(cell?.accuracy) : null;
  return (
    <div className="lc-cmp-bar" data-side={side} data-empty={acc === null ? 'true' : undefined}>
      <span className="lc-cmp-code" title={room?.title || undefined}>{room?.code ?? (side === 'latest' ? 'Latest' : 'Before')}</span>
      <span className="lc-cmp-track" aria-hidden="true"><i style={{ width: `${acc === null ? 0 : Math.max(acc * 100, 1.5)}%` }} /></span>
      <span className="lc-cmp-fig">
        <b>{pct(acc)}</b>
        <small>{answers ? `${cell.correct ?? 0} of ${answers} right` : 'no answers'}</small>
      </span>
    </div>
  );
}

export function LevelChange({ c, bands, first = 'bands' }) {
  const [reading, setReading] = useState(first);
  if (!c || typeof c !== 'object') return null;
  const prev = c.previous ?? {};
  const latest = c.latest ?? {};
  // The comparison's bands name no levels; the analytics' own levelBands do.
  const levelsOf = new Map(list(bands).map((b) => [b.id, list(b.levels)]));
  const rows = reading === 'levels'
    ? LEVELS.map((l) => list(c.levels).find((r) => r.level === l)).filter(Boolean)
    : list(c.levelBands);

  return (
    <section className="card ac-card lc-cmp" aria-labelledby="lc-cmp-h">
      <div className="ac-head">
        <div className="sec">
          <h2 id="lc-cmp-h">Against the room before</h2>
          <p>{c.sentence}</p>
        </div>
        <Segmented
          label="Read by"
          value={reading}
          onChange={setReading}
          options={[{ id: 'bands', label: 'Three bands' }, { id: 'levels', label: 'Six levels' }]}
        />
      </div>
      <div className="lc-cmp-key">
        <span><i className="lc-cmp-sw" data-side="previous" aria-hidden="true" />Before: <b>{prev.code}</b>{prev.title ? ` ${prev.title}` : ''}{day(prev.startedAt) ? `, ${day(prev.startedAt)}` : ''}</span>
        <span><i className="lc-cmp-sw" data-side="latest" aria-hidden="true" />Latest: <b>{latest.code}</b>{latest.title ? ` ${latest.title}` : ''}{day(latest.startedAt) ? `, ${day(latest.startedAt)}` : ''}</span>
      </div>
      <ul className="lc-cmp-rows">
        {rows.map((r) => {
          const ch = changeOf(r.change);
          const isLevel = reading === 'levels';
          const name = isLevel ? r.label ?? LABEL[r.level] : r.label;
          const mark = isLevel
            ? <Level level={r.level}>{LEVELS.indexOf(r.level) + 1}</Level>
            : <span className="cl-pairmark">{list(levelsOf.get(r.id)).map((l) => <Level key={l} level={l}>{LEVELS.indexOf(l) + 1}</Level>)}</span>;
          return (
            <li key={r.level ?? r.id} className="lc-cmp-row">
              <span className="lc-cmp-name">{mark}{name}</span>
              {ch ? (
                <span className="lc-cmp-ch">
                  {ch.icon && <Icon name={ch.icon} size={13} />}
                  <span aria-hidden={ch.said ? 'true' : undefined}>{ch.text}</span>
                  {ch.said && <span className="sr-only">{ch.said}</span>}
                </span>
              ) : (
                <span className="lc-cmp-ch" data-none="true">Not in both rooms</span>
              )}
              <div className="lc-cmp-pair">
                <RoomBar side="previous" room={prev} cell={r.previous} />
                <RoomBar side="latest" room={latest} cell={r.latest} />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The console's bank for the question's chapter, opened on the question
 * (`?content=…&view=bank&question=…`). Nothing when the item has no chapter.
 */
export const bankHref = (contentId, questionId) => `/?content=${encodeURIComponent(contentId)}&view=bank${questionId ? `&question=${encodeURIComponent(questionId)}` : ''}`;

export function BankLink({ item }) {
  if (!item?.contentId || !item?.questionId) return null;
  return (
    <Link className="lc-bank" to={bankHref(item.contentId, item.questionId)}>
      <Icon name="bank" size={14} />Open in question bank
    </Link>
  );
}
