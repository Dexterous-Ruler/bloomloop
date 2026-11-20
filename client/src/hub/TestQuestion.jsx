/**
 * One question in a self-test or a Get Ready check, and the words for an
 * answer and a right answer afterwards. No hints here, ever, and nothing that
 * says right or wrong until the server has said it.
 *
 * The question arrives as the server shows it (forStudent: no key) with
 * `rich` beside the plain text. Choose one, true or false and choose all are
 * drawn here as real radios and checkboxes with the server's HTML options.
 * Every other kind (match, order, blank, numeric, cloze, ...) is the room
 * phone's own control (learn/Answer.jsx), drawn inside this card: its one
 * button sits in a dock slot here instead of the phone's bottom bar.
 *
 * Responses are what the server reads for each kind: an option's shown index,
 * true or false, a list of indices, a typed string, and so on.
 */

import { forwardRef, useId, useState } from 'react';

import Answer from '../learn/Answer.jsx';
import { DockSlot } from '../learn/parts.jsx';
import Stimulus from '../learn/Stimulus.jsx';
import { labelOf } from '../lib/kinds.js';
import { Icon, Level } from '../ui/index.jsx';
import RichText from './RichText.jsx';

const KEYS = 'ABCDEFGHIJKL';
/** The kinds drawn here; the rest go through the phone's control. */
export const CHOICE_KINDS = new Set(['mcq', 'truefalse', 'multi']);
const kindOf = (q) => q?.kind ?? 'mcq';

/** Whether a response counts as an answer. */
export function isAnswered(response) {
  if (response === undefined || response === null || response === '') return false;
  if (Array.isArray(response)) return response.some((x) => x !== null && x !== undefined && x !== '');
  if (typeof response === 'object') return Object.values(response).some((v) => v !== null && v !== undefined && v !== '' && v !== false);
  return true;
}

const txt = (it) => (typeof it === 'string' ? it : it?.t ?? it?.text ?? '');
const list = (v) => (Array.isArray(v) ? v : []);

/** The options as drawn: plain text for words, the server's HTML for the page. */
export function optionsOf(q) {
  if (kindOf(q) === 'truefalse') return [{ value: true, text: 'True' }, { value: false, text: 'False' }];
  return list(q?.options).map((o, i) => ({ value: i, text: txt(o), html: q?.rich?.options?.[i] }));
}

/* ---------------------------------------------------------------- words */

/** A response in words, for "Your answer". Null when there is none. */
export function answerWords(q, r) {
  if (!q || !isAnswered(r)) return null;
  const opts = list(q.options).map(txt);
  switch (kindOf(q)) {
    case 'mcq': return opts[Number(r)] ?? null;
    case 'truefalse': return r === true || r === 'true' ? 'True' : 'False';
    case 'multi': return list(r).map((i) => opts[i]).filter(Boolean).join('; ') || null;
    case 'blank':
    case 'open': return String(Array.isArray(r) ? r[0] ?? '' : r);
    case 'numeric': return `${r}${q.unit ? ` ${q.unit}` : ''}`;
    case 'cloze': return list(r).map((w, i) => `(${i + 1}) ${w || 'no answer'}`).join('  ');
    case 'order':
    case 'rank': return list(r).map((i) => txt(q.items?.[i])).filter(Boolean).join(', then ');
    case 'match': return list(q.left).map((l, i) => `${txt(l)}: ${txt(q.right?.[r?.[i]]) || 'no match'}`).join('; ');
    case 'categorise': {
      const groups = list(q.groups).map((g, gi) => ({
        g: txt(g),
        items: Object.entries(r ?? {}).filter(([, b]) => Number(b) === gi).map(([pos]) => txt(q.items?.[Number(pos)])),
      })).filter((x) => x.items.length);
      return groups.map((x) => `${x.g}: ${x.items.join(', ')}`).join('; ') || null;
    }
    case 'hottext': return list(r).map((i) => txt(q.tokens?.[i])).filter(Boolean).join(', ') || null;
    case 'dropdown': return list(r).map((pos, i) => `(${i + 1}) ${txt(q.gaps?.[i]?.options?.[pos]) || 'no choice'}`).join('  ');
    case 'table': return Object.entries(r ?? {}).filter(([, v]) => v).map(([k, v]) => {
      const [ri, ci] = k.split(':').map(Number);
      return `${txt(q.rows?.[ri]?.header)}, ${txt(q.columns?.[ci])}: ${v}`;
    }).join('; ') || null;
    case 'grid': return Object.keys(r ?? {}).filter((k) => r[k]).map((k) => {
      const [ri, ci] = k.split(':').map(Number);
      return `${txt(q.rows?.[ri])} with ${txt(q.columns?.[ci])}`;
    }).join('; ') || null;
    default: return typeof r === 'string' || typeof r === 'number' ? String(r) : null;
  }
}

/** The server's solution in words, for "Right answer". Null when it sent none. */
export function solutionWords(q, s) {
  if (!q || s === null || s === undefined) return null;
  switch (kindOf(q)) {
    case 'categorise': return answerWords(q, Object.fromEntries(list(s).map((b, pos) => [pos, b])));
    case 'grid': return answerWords(q, Object.fromEntries(list(s).map((k) => [k, true])));
    case 'order':
    case 'rank': return list(s).map(txt).join(', then ') || null;
    case 'open': return list(s).length ? `A full answer covers: ${list(s).map(txt).join('; ')}.` : null;
    case 'cloze': return list(s).map((w, i) => `(${i + 1}) ${w}`).join('  ');
    case 'blank': return String(s);
    default: return answerWords(q, s);
  }
}

/* -------------------------------------------------------------- options */

/**
 * The options as a group of radios (checkboxes for choose-all). Before the
 * server has marked, the chosen one takes the ink outline that means "the one
 * you picked", never green or red. With `solution` (after marking), the right
 * option is marked right and a wrong choice wrong, each in words too.
 */
export function TestOptions({ question, value, onChange, disabled = false, solution, labelledBy, lang }) {
  const kind = kindOf(question);
  const multi = kind === 'multi';
  const tf = kind === 'truefalse';
  const marked = solution !== undefined && solution !== null;
  const opts = optionsOf(question);
  const name = useId();
  const isOn = (v) => (multi ? list(value).includes(v) : isAnswered(value) && (tf ? String(value) === String(v) : Number(value) === v));
  const isRight = (v) => marked && (multi ? list(solution).includes(v) : tf ? String(solution) === String(v) : Number(solution) === v);
  const pick = (v) => {
    if (!multi) { onChange?.(v); return; }
    const now = list(value);
    const next = now.includes(v) ? now.filter((x) => x !== v) : [...now, v].sort((a, b) => a - b);
    onChange?.(next.length ? next : null);
  };
  return (
    <div className="hub-test-opts" role={multi ? 'group' : 'radiogroup'} aria-labelledby={labelledBy} data-two={tf ? 'true' : undefined}>
      {opts.map((o, i) => {
        const on = isOn(o.value);
        const mark = !marked ? undefined : isRight(o.value) ? 'yes' : on ? 'no' : 'dim';
        const locked = disabled || marked;
        return (
          <label key={i} className="hub-test-opt" data-on={on ? 'true' : undefined} data-mark={mark} data-locked={locked ? 'true' : undefined}>
            <input
              className="hub-test-input"
              type={multi ? 'checkbox' : 'radio'}
              value={String(o.value)}
              name={name}
              checked={on}
              disabled={locked}
              onChange={() => pick(o.value)}
            />
            <span className="hub-test-key" data-multi={multi ? 'true' : undefined} aria-hidden="true">
              {mark === 'yes' ? <Icon name="check" size={14} /> : mark === 'no' ? <Icon name="close" size={14} /> : tf ? (i === 0 ? 'T' : 'F') : KEYS[i] ?? i + 1}
            </span>
            <span className="hub-test-opt-body">
              <RichText as="span" className="hub-test-opt-t" html={o.html} text={o.text} lang={kindOf(question) === 'truefalse' ? undefined : lang} />
              {mark === 'yes' && <span className="hub-test-opt-tag">Right answer{on ? ', your answer' : ''}</span>}
              {mark === 'no' && <span className="hub-test-opt-tag">Your answer</span>}
            </span>
          </label>
        );
      })}
    </div>
  );
}

/**
 * The control for a question of any kind. Choice kinds call `onChoose` on
 * each change; the other kinds build an answer and call `onSubmit` from their
 * own button. `result` (the server's reply after marking, with `solution`) and
 * `sent` (the response sent) lock and mark the control as the phone does.
 */
export function Respond({ question, value, onChoose, onSubmit, disabled = false, busy = false, result = null, sent = null, labelledBy, lang }) {
  const [slot, setSlot] = useState(null);
  if (CHOICE_KINDS.has(kindOf(question))) {
    return (
      <TestOptions
        question={question}
        value={value}
        onChange={onChoose}
        disabled={disabled || busy}
        solution={result ? result.solution : undefined}
        labelledBy={labelledBy}
        lang={lang}
      />
    );
  }
  return (
    <div className="hub-test-built" data-locked={disabled ? 'true' : undefined} lang={lang}>
      <DockSlot.Provider value={slot}>
        <fieldset className="hub-test-built-f" disabled={disabled}>
          <Answer question={question} result={result} busy={busy} sent={sent} onSubmit={(r) => onSubmit?.(r)} />
        </fieldset>
      </DockSlot.Provider>
      <div className="hub-test-dock" ref={setSlot} />
    </div>
  );
}

/**
 * One question as a card: "Question 4 of 10", its topic, level and kind, a
 * passage when it has one, the text (the server's HTML), who wrote it, and
 * `children` (the control and the card's foot). Focusable, so moving between
 * questions can take a screen reader to the new one.
 */
export const TestQuestion = forwardRef(function TestQuestion(
  { question, number, of, topicName, lang, languageNote, children, className = '', textId }, ref,
) {
  const id = useId();
  const kind = kindOf(question);
  // A cloze or dropdown passage is the control itself: the phone's control draws it.
  const passageIsControl = kind === 'cloze' || kind === 'dropdown';
  return (
    <article ref={ref} className={`card hub-test-q ${className}`} tabIndex={-1} aria-labelledby={`${id}-n`}>
      <header className="hub-test-q-head">
        <span id={`${id}-n`} className="hub-test-q-n">{of ? `Question ${number} of ${of}` : `Question ${number}`}</span>
        <span className="hub-test-q-meta">
          {topicName && <span>{topicName}</span>}
          <span>{labelOf(question) || kind}</span>
          <Level level={question.bloom} />
        </span>
      </header>
      {question.stimulus && <Stimulus stimulus={question.stimulus} />}
      {!passageIsControl && (
        <div id={textId}>
          <RichText className="hub-test-text" html={question.rich?.text} text={question.text} lang={lang} />
        </div>
      )}
      {languageNote && <p className="hub-test-langnote">{languageNote}</p>}
      {question.provenance?.text && <p className="hub-test-prov">{question.provenance.text}</p>}
      {children}
    </article>
  );
});
