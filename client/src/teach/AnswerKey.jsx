/**
 * The answer key of one question, as a teacher checks it.
 *
 * Each interaction has its own shape of "right": a letter, a pairing, a
 * grouping, an order, a set of accepted spellings, a rubric, the words to pick,
 * a choice per gap, the cells to write, the ticks on a grid. This draws each
 * one the way it is read, and when a stored question arrives with nothing to
 * answer it says so rather than drawing an empty key. A passage or image the
 * question hangs off is drawn above its key.
 */

import { Fragment } from 'react';

import { BLANK_MARK, KIND_LABEL } from '../lib/kinds.js';
import { Icon, Note } from '../ui/index.jsx';
import { StimulusView } from './Media.jsx';

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

function Key({ q }) {
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

  if (kind === 'hottext') {
    const tokens = list(q.tokens);
    const right = new Set(list(q.answerIdxs).map(Number));
    const criterion = String(q.criterion ?? '').trim();
    if (tokens.length === 0 || right.size === 0) return <Missing kind={kind} />;
    return (
      <div className="stack stack-2">
        {criterion && <p className="t-small dim">To pick: {criterion}</p>}
        <p className="au-key-hot">
          {tokens.map((t, i) => (
            <Fragment key={i}>
              {i > 0 && ' '}
              {right.has(i) ? <mark>{t}<span className="sr-only"> (picked)</span></mark> : t}
            </Fragment>
          ))}
        </p>
        <p className="t-meta">{right.size} of {tokens.length} words are picked in the key.</p>
      </div>
    );
  }

  if (kind === 'dropdown') {
    const gaps = list(q.blanks);
    const parts = String(q.text ?? '').split(BLANK_MARK);
    if (gaps.length === 0 || parts.length - 1 !== gaps.length) return <Missing kind={kind} />;
    return (
      <div className="stack stack-3">
        <p className="tc-key-cloze">
          {parts.map((part, i) => (
            <span key={i}>{part}{i < parts.length - 1 && <mark>{list(gaps[i]?.options)[gaps[i]?.answerIdx]}</mark>}</span>
          ))}
        </p>
        <ol className="au-key-gaps">
          {gaps.map((g, i) => (
            <li key={i}>
              <span className="tc-key-mark">Gap {i + 1}</span>
              <span className="au-key-opts">
                {list(g?.options).map((o, j) => (
                  <span key={j} className="au-key-opt" data-right={j === g.answerIdx ? 'true' : undefined}>
                    {j === g.answerIdx && <Icon name="check" size={12} />}
                    {o}
                    {j === g.answerIdx && <span className="sr-only"> (right)</span>}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  if (kind === 'table') {
    const columns = list(q.columns);
    const rows = list(q.rows);
    if (columns.length === 0 || rows.length === 0) return <Missing kind={kind} />;
    return (
      <div className="stack stack-2">
        <div className="au-key-wrap">
          <table className="au-key-tbl">
            <thead>
              <tr>
                <td />
                {columns.map((c, j) => <th key={j} scope="col">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <th scope="row">{r?.header}</th>
                  {columns.map((_, j) => {
                    const cell = list(r?.cells)[j] ?? {};
                    const accept = list(cell.accept);
                    return accept.length ? (
                      <td key={j} data-right="true">
                        <span className="au-key-write">
                          <Icon name="edit" size={12} />
                          <span className="sr-only">The student writes: </span>
                          <b>{accept[0]}</b>
                          {accept.length > 1 && <span className="dim"> or {accept.slice(1).join(' or ')}</span>}
                        </span>
                      </td>
                    ) : (
                      <td key={j}>{cell.given}</td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="t-meta">Cells with a pencil are written by the student, and every answer shown there is accepted. The rest are given.</p>
      </div>
    );
  }

  if (kind === 'grid') {
    const rows = list(q.rows);
    const columns = list(q.columns);
    const answers = list(q.answers);
    if (rows.length === 0 || columns.length === 0 || answers.length !== rows.length) return <Missing kind={kind} />;
    return (
      <div className="au-key-wrap">
        <table className="au-key-tbl au-key-grid">
          <thead>
            <tr>
              <td />
              {columns.map((c, j) => <th key={j} scope="col">{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <th scope="row">{r}</th>
                {columns.map((_, j) => {
                  const on = list(answers[i])[j] === true;
                  return (
                    <td key={j} data-right={on ? 'true' : undefined}>
                      {on
                        ? <><Icon name="check" size={14} /><span className="sr-only">ticked</span></>
                        : <><span aria-hidden="true">–</span><span className="sr-only">not ticked</span></>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return <Missing kind={kind} />;
}

export default function AnswerKey({ q }) {
  if (!q.stimulus) return <Key q={q} />;
  return (
    <div className="stack stack-3">
      <StimulusView stimulus={q.stimulus} figure={q.figure ?? null} />
      <Key q={q} />
    </div>
  );
}
