/**
 * How a chapter's questions did in each language in the hub (docs/API.md,
 * Phase 6, GET /api/hub/chapters/:id/languages): each student's first graded
 * hub answer to each question, split by the language it was shown in, with
 * Phase 5's thresholds. A gap between languages is a reason to check the
 * translation before reading it as a gap in understanding.
 *
 * Phase 5's translation warning is reused as it is: TranslationLine (the
 * report's line, from teach/ItemStats.jsx) above the list, and the same warn
 * note ItemDetail draws under a question with a warning. Counts only, no
 * student is named. Nothing here changes anything, so there are no controls.
 */

import { useCallback, useId, useState } from 'react';
import { Link } from 'react-router-dom';

import { staffHub } from '../hub/hubApi.js';
import { KIND_LABEL } from '../lib/kinds.js';
import { TranslationLine } from '../teach/ItemStats.jsx';
import { Chip, Icon, Level, Note, Segmented } from '../ui/index.jsx';
import { QueueFailed, QueueLoading, StaleRead, list, pickFilter, plural, useQueue } from './QueueParts.jsx';

const pct = (p) => (typeof p === 'number' && Number.isFinite(p) ? `${Math.round(p * 100)}%` : '—');

/** One question: each language's answers, right and share right, and the warning when there is one. */
function Row({ item }) {
  const langs = list(item.languages);
  const warn = item.warning?.text;
  return (
    <li className="hq-row hq-lang" data-warn={warn ? 'true' : undefined}>
      <div className="hq-row-q">
        <span className="hq-meta">
          <Level level={item.bloom} />
          <span>{KIND_LABEL[item.kind] ?? item.kind}</span>
          <i className="it-dot" aria-hidden="true" />
          <span>{plural(item.students ?? 0, 'student')} answered</span>
          {warn && <Chip tone="warn" icon="alert">Check the translation</Chip>}
        </span>
        <p className="hq-qtext">{item.text}</p>
      </div>
      {warn && <Note tone="warn" icon="alert" role="note">{warn}</Note>}
      {langs.length > 0 && (
        <table className="hq-lang-tbl">
          <caption className="sr-only">Answers to this question by language</caption>
          <thead>
            <tr><th scope="col">Language</th><th scope="col">Answers</th><th scope="col">Right</th><th scope="col">Share right</th></tr>
          </thead>
          <tbody>
            {langs.map((l) => (
              <tr key={l.language}>
                <th scope="row">
                  {l.name}
                  {l.original && <span className="hq-lang-orig">the question’s own</span>}
                </th>
                <td className="mono">{l.answers}</td>
                <td className="mono">{l.correct}</td>
                <td>
                  <span className="hq-lang-share">
                    <b className="mono">{pct(l.share)}</b>
                    <span className="hq-lang-bar" aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, (l.share ?? 0) * 100))}%` }} /></span>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {item.note && <p className="hq-note">{item.note}</p>}
    </li>
  );
}

/**
 * @param data  the GET reply
 * @param translationsHref  where "Check the translations" goes (the chapter's Translations tab)
 */
export function LanguagesView({ data, error, filter, onFilter, translationsHref = '?tab=translations' }) {
  const items = list(data.items);
  const warnings = list(data.warnings);
  const [showIdle, setShowIdle] = useState(false);
  const idleId = useId();
  const answered = items.filter((i) => (i.students ?? 0) > 0);
  const idle = items.filter((i) => !((i.students ?? 0) > 0));
  const options = [
    { id: 'gap', label: 'A gap between languages', count: warnings.length },
    { id: 'all', label: 'All answered', count: answered.length },
  ];
  const shown = pickFilter(options, filter);
  const rows = shown === 'gap' ? answered.filter((i) => i.warning) : answered;

  return (
    <div className="hq">
      {answered.length > 0 && (
        <div className="hq-bar">
          <Segmented label="Show" options={options} value={shown} onChange={onFilter} />
          {warnings.length > 0 && <Link className="btn" to={translationsHref}><Icon name="type" />Check the translations</Link>}
        </div>
      )}
      <TranslationLine translation={{ warnings: warnings.length, note: data.note }} className="hq-trans-line" />
      {data.method && <p className="hq-note">{data.method}</p>}
      {data.stored && <Note role="note">{data.stored}</Note>}
      <StaleRead error={error} />

      {items.length === 0 ? (
        <div className="card hq-empty"><Icon name="bank" size={18} /><p>This chapter has no approved questions yet, so there is nothing to compare.</p></div>
      ) : answered.length === 0 ? (
        <div className="card hq-empty">
          <Icon name="info" size={18} />
          <p>Nobody has answered this chapter’s questions in the hub yet, so there is nothing to compare between languages.</p>
        </div>
      ) : (
        <ul className="card hq-list">
          {rows.map((i) => <Row key={i.questionId} item={i} />)}
        </ul>
      )}

      {answered.length > 0 && idle.length > 0 && (
        <div className="hq-idle">
          <button type="button" className="hq-disclose" aria-expanded={showIdle} aria-controls={idleId} onClick={() => setShowIdle((v) => !v)}>
            <Icon name={showIdle ? 'chevronUp' : 'chevron'} size={14} />
            {plural(idle.length, 'question')} nobody has answered in the hub yet
          </button>
          {showIdle && (
            <ul id={idleId} className="card hq-list">
              {idle.map((i) => <Row key={i.questionId} item={i} />)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default function Languages({ contentId }) {
  const read = useCallback(() => staffHub.languages(contentId), [contentId]);
  const q = useQueue(read);
  const [filter, setFilter] = useState('');

  if (!q.data) {
    if (q.error) return <QueueFailed error={q.error} onRetry={() => q.reload()} busy={q.loading} what="The language statistics" />;
    return <QueueLoading rows={2} />;
  }
  return <LanguagesView data={q.data} error={q.error} filter={filter} onFilter={setFilter} />;
}
