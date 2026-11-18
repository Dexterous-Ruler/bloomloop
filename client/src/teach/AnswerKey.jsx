/**
 * The answer key of one question, as a teacher checks it.
 *
 * Each interaction has its own shape of "right": a letter, a pairing, a
 * grouping, an order, a set of accepted spellings, a rubric. This draws each
 * one the way it is read, and when a stored question arrives with nothing to
 * answer it says so rather than drawing an empty key.
 */

import { BLANK_MARK, KIND_LABEL } from '../lib/kinds.js';
import { Icon, Note } from '../ui/index.jsx';

const KEYS = ['A', 'B', 'C', 'D', 'E', 'F'];
const list = (v) => (Array.isArray(v) ? v : []);

function Missing({ kind }) {
  return (
    <Note icon="alert">
      Stored as "{KIND_LABEL[kind] ?? kind}" but it arrived with nothing to answer, so no student can be served it. Discard it.
    </Note>
  );
}

function Line({ mark, right, tag, children }) {
  return (
    <li className="tc-key-row" data-right={right ? 'true' : undefined}>
      <span className="tc-key-mark">{mark}</span>
      <span className="tc-key-text">{children}</span>
      {tag && <span className="tc-key-tag">{right && <Icon name="check" size={14} />}{tag}</span>}
    </li>
  );
}

export default function AnswerKey({ q }) {
  const kind = q.kind ?? 'mcq';

  if (kind === 'mcq' || kind === 'multi') {
    const options = list(q.options);
    if (options.length === 0) return <Missing kind={kind} />;
    const right = new Set(kind === 'multi' ? list(q.answerIdxs).map(Number) : [Number(q.answerIdx)]);
    return (
      <ul className="tc-key tc-key-2">
        {options.map((o, i) => <Line key={i} mark={KEYS[i] ?? i + 1} right={right.has(i)} tag={right.has(i) ? 'correct' : null}>{o}</Line>)}
      </ul>
    );
  }

  if (kind === 'truefalse') {
    if (typeof q.answerBool !== 'boolean') return <Missing kind={kind} />;
    return (
      <ul className="tc-key tc-key-2">
        {[true, false].map((v) => (
          <Line key={String(v)} mark={v ? 'T' : 'F'} right={v === q.answerBool} tag={v === q.answerBool ? 'correct' : null}>{v ? 'True' : 'False'}</Line>
        ))}
      </ul>
    );
  }

  if (kind === 'match') {
    const pairs = list(q.pairs);
    if (pairs.length === 0) return <Missing kind={kind} />;
    return (
      <ul className="tc-key">
        {pairs.map((p, i) => (
          <li key={i} className="tc-key-pair">
            <span className="strong">{p.left}</span>
            <Icon name="forward" className="muted" />
            <span>{p.right}</span>
          </li>
        ))}
      </ul>
    );
  }

  if (kind === 'categorise') {
    const buckets = list(q.buckets);
    if (buckets.length === 0) return <Missing kind={kind} />;
    return (
      <div className="tc-key-groups">
        {buckets.map((b, i) => (
          <div key={i} className="tc-key-group">
            <span className="strong">{b?.name}</span>
            <ul>{list(b?.items).map((it, j) => <li key={j}>{it}</li>)}</ul>
          </div>
        ))}
      </div>
    );
  }

  if (kind === 'order' || kind === 'rank') {
    const sequence = list(q.sequence);
    const criterion = String(q.criterion ?? '').trim();
    if (sequence.length === 0 || (kind === 'rank' && !criterion)) return <Missing kind={kind} />;
    return (
      <div className="stack stack-2">
        {kind === 'rank' && <p className="t-small dim">Ranked by: {criterion}</p>}
        <ol className="tc-key">
          {sequence.map((t, i) => <Line key={i} mark={i + 1} right>{t}</Line>)}
        </ol>
      </div>
    );
  }

  if (kind === 'blank') {
    const accept = list(q.accept);
    if (accept.length === 0) return <Missing kind={kind} />;
    return (
      <ul className="tc-key tc-key-2">
        {accept.map((a, i) => <Line key={i} mark={i === 0 ? '=' : 'or'} right tag={i === 0 ? 'accepted' : null}>{a}</Line>)}
      </ul>
    );
  }

  if (kind === 'cloze') {
    const blanks = list(q.blanks);
    const parts = String(q.text ?? '').split(BLANK_MARK);
    if (blanks.length === 0 || parts.length - 1 !== blanks.length) return <Missing kind={kind} />;
    return (
      <p className="tc-key-cloze">
        {parts.map((part, i) => (
          <span key={i}>{part}{i < parts.length - 1 && <mark>{blanks[i]?.accept?.[0]}</mark>}</span>
        ))}
      </p>
    );
  }

  if (kind === 'numeric') {
    const value = Number(q.value);
    if (!Number.isFinite(value)) return <Missing kind={kind} />;
    const tol = Number(q.tolerance);
    const spread = Number.isFinite(tol) && tol > 0 ? tol : 0;
    const unit = String(q.unit ?? '').trim();
    return (
      <ul className="tc-key">
        <Line mark="=" right tag={spread ? 'accepted' : 'exact'}>
          <span className="mono">{value}{spread ? ` ± ${spread}` : ''}{unit ? ` ${unit}` : ''}</span>
        </Line>
      </ul>
    );
  }

  if (kind === 'open') {
    const rubric = list(q.rubric);
    if (rubric.length === 0) return <Missing kind={kind} />;
    return (
      <div className="stack stack-2">
        <p className="t-small dim">A full answer makes these points:</p>
        <ol className="tc-key">{rubric.map((r, i) => <Line key={i} mark={i + 1}>{r}</Line>)}</ol>
      </div>
    );
  }

  return <Missing kind={kind} />;
}
