/**
 * One question in the Learning Hub: a practice or review question, or one of a
 * lesson's retrieval questions, as the server sends it (forStudent fields,
 * `rich`, `provenance`; never a key).
 *
 * Every kind the hub serves is answered the way the room phone answers it.
 * Choose one, true or false and choose all are drawn here, because their
 * options can carry formulas (`rich.options`) and the phone draws options as
 * plain text; every other kind is the phone's own Answer (learn/Answer.jsx),
 * with its Submit put into this card through the phone's DockSlot.
 *
 * Before the reply: the question (`rich` first), its provenance sentence, the
 * server's `why` and language note, and the hints the student asks for, one at
 * a time. After it: right or wrong, the right answer (`solution`), feedback on
 * the option chosen, the explanation with its label, a provisional mark's
 * note, and the topic's new state. Never a key before the reply.
 *
 * One attempt id per shown question, for its hints and its answer. Once a
 * hint is opened the id is kept in this tab's session storage until the answer
 * is sent, so a reload asks the server for the hints already opened (GET)
 * instead of losing them. Answers go
 * through pending.js: a 409 or no connection keeps the answer on this device.
 */

import { Fragment, useEffect, useId, useRef, useState } from 'react';

import { BLANK_MARK, KIND_LABEL } from '../lib/kinds.js';
import Answer from '../learn/Answer.jsx';
import { DockSlot, Held } from '../learn/parts.jsx';
import Stimulus from '../learn/Stimulus.jsx';
import { Button, Icon, Level } from '../ui/index.jsx';
import { newId } from './hubApi.js';
import RichText from './RichText.jsx';

const KEYS = 'ABCDEFGHIJ';
/** The kinds drawn here; every other kind is the phone's Answer. */
const CHOICE = new Set(['mcq', 'truefalse', 'multi']);

/** The verdict in the room phone's words. */
const VERDICT = {
  yes: { icon: 'check', word: 'Correct' },
  part: { icon: 'minus', word: 'Partly there' },
  no: { icon: 'close', word: 'Not this time' },
};

export const qid = (q) => String(q?._id ?? q?.id ?? '');

const answersSaid = (n) => `based on ${n} ${n === 1 ? 'answer' : 'answers'}`;

/** 'hi' or 'mr' for text shown translated: `language` comes as a tag or as { language, note }. */
const langOf = (l) => {
  const tag = typeof l === 'string' ? l : l?.language;
  return tag === 'hi' || tag === 'mr' ? tag : undefined;
};

/** The option a piece of feedback is about, as its letter: it comes as the option's text (or its index). */
function letterOf(q, option) {
  if (q.kind === 'truefalse') return option === true || option === 0 || option === 'True' ? 'True' : 'False';
  const i = typeof option === 'number' ? option : (q.options ?? []).indexOf(option);
  return i >= 0 ? KEYS[i] : null;
}

/* --------------------------------------------------------- attempt ids */

const SLOT = 'bloomloop.hubAttempt:';
function store() {
  try { return window.sessionStorage; } catch { return null; }
}

/**
 * The attempt id for the question shown in `slot`: the one this tab kept for
 * it when a hint was opened (a reload), or a new one. `restored` says which.
 * Reads only: a render may run twice.
 */
export function attemptFor(slot) {
  const held = store()?.getItem(SLOT + slot);
  return held ? { attemptId: held, restored: true } : { attemptId: newId(), restored: false };
}

/** A hint is being opened under this id: keep it, so a reload asks for the hints with the same id. */
function keep(slot, attemptId) {
  try { store()?.setItem(SLOT + slot, attemptId); } catch { /* storage off: the id lives as long as the card */ }
}

/** The answer is sent (or kept to send): the next showing of this question gets a new id. */
function forget(slot) {
  try { store()?.removeItem(SLOT + slot); } catch { /* nothing kept */ }
}

/* ------------------------------------------------------------- parts */

/** The options of a choice kind, rich first. True or false is True, then False. */
function optionsOf(q) {
  if (q.kind === 'truefalse') return [{ value: true, text: 'True' }, { value: false, text: 'False' }];
  const html = Array.isArray(q.rich?.options) ? q.rich.options : [];
  return (q.options ?? []).map((o, i) => ({ value: i, text: String(o), html: html[i] }));
}

/** The values the reply's `solution` says are right, in the options' terms. */
function rightOf(q, solution) {
  if (solution === null || solution === undefined) return [];
  if (q.kind === 'multi') return Array.isArray(solution) ? solution : [];
  return [solution];
}

const isChosen = (choice, value) => (Array.isArray(choice) ? choice.includes(value) : choice === value);

/** The question's own words: `rich.text` when the server sent one, else the plain text, a blank drawn as a gap. */
function Stem({ q, lang }) {
  if (q.kind === 'cloze' || q.kind === 'dropdown') return null; // the passage is the answer: Answer draws it
  if (q.rich?.text) return <RichText className="hub-q-stem" html={q.rich.text} lang={lang} />;
  const text = String(q.text ?? '');
  return (
    <div className="hub-rich hub-q-stem" lang={lang}>
      {q.kind === 'blank'
        ? text.split(BLANK_MARK).map((part, i) => (
          <Fragment key={i}>{i > 0 && <span className="ln-blank" role="img" aria-label="blank" />}{part}</Fragment>
        ))
        : text}
    </div>
  );
}

/** A passage or image the question hangs off: the rich passage when sent, else the phone's own fold. */
function Passage({ q, lang }) {
  if (!q.stimulus) return null;
  if (q.rich?.passage) {
    return (
      <section className="hub-q-passage" aria-label="The passage this question is about">
        <span className="hub-q-eyebrow">Passage</span>
        <RichText html={q.rich.passage} lang={lang} />
      </section>
    );
  }
  return <Stimulus stimulus={q.stimulus} />;
}

/** Choose one, true or false, choose all: native radios or checkboxes, drawn as rows. */
function Choices({ q, lang, choice, onChoose, locked, result, textId, kindId }) {
  const multi = q.kind === 'multi';
  const opts = optionsOf(q);
  const right = rightOf(q, result?.solution);
  const name = useId();

  const stateOf = (value) => {
    const mine = isChosen(choice, value);
    if (!result) return mine ? 'pick' : undefined;
    if (right.includes(value)) return mine || !multi ? 'yes' : 'miss';
    return mine ? 'no' : 'dim';
  };
  const tagOf = (value) => {
    if (!result) return null;
    const mine = isChosen(choice, value);
    if (right.includes(value)) return mine ? 'Your answer, correct' : multi ? 'Correct, not chosen' : 'Correct answer';
    return mine ? 'Your answer' : null;
  };
  const pick = (value) => {
    if (locked) return;
    if (!multi) { onChoose(value); return; }
    const list = Array.isArray(choice) ? choice : [];
    onChoose(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  };
  const short = q.kind !== 'truefalse' && opts.length > 2 && opts.every((o) => !o.html && o.text.length <= 24);

  return (
    <fieldset
      className="hub-q-opts"
      data-kind={q.kind}
      data-cols={short ? '2' : undefined}
      data-locked={locked ? 'true' : undefined}
      aria-labelledby={textId}
      aria-describedby={kindId}
    >
      {opts.map((o, i) => {
        const s = stateOf(o.value);
        const tag = tagOf(o.value);
        return (
          <label key={String(o.value)} className="hub-q-opt" data-state={s}>
            <input
              type={multi ? 'checkbox' : 'radio'}
              name={name}
              checked={isChosen(choice, o.value)}
              aria-disabled={locked || undefined}
              onChange={() => pick(o.value)}
            />
            <span className="hub-q-key" aria-hidden="true">
              {s === 'yes' || (multi && s === 'pick') ? <Icon name="check" size={14} /> : s === 'no' ? <Icon name="close" size={14} /> : KEYS[i]}
            </span>
            <span className="hub-q-opt-t">
              {o.html ? <RichText as="span" html={o.html} lang={lang} /> : <span className="wrap-any" lang={q.kind === 'truefalse' ? undefined : lang}>{o.text}</span>}
              {tag && <span className="hub-q-tag">{tag}</span>}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

/** The hints opened so far, each with its label, words, slide and who wrote it; `why` with the first. */
function Hints({ hints, why }) {
  if (!hints.length) return null;
  return (
    <div className="hub-q-hints">
      {why && <p className="hub-q-hintwhy">{why}</p>}
      <ol>
        {hints.map((h) => {
          const lang = langOf(h.language);
          return (
            <li key={h.position}>
              <span className="hub-q-hint-n">{h.label}</span>
              <RichText html={h.html} text={h.text} lang={lang} />
              <span className="hub-q-src">
                {[h.byLabel, h.cite].filter(Boolean).join(' · ')}
              </span>
              {h.languageNote && <span className="hub-q-langnote">{h.languageNote}</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** The topic's state after the answer, in the server's words, with N and when it comes back. */
function After({ topic }) {
  const s = topic?.state;
  if (!s) return null;
  return (
    <div className="hub-q-after">
      <p>
        <b>{topic.name}</b>
        <span>{s.label}</span>
        <span className="hub-q-meta">{answersSaid(s.answers ?? 0)}</span>
      </p>
      {s.sentence && <p className="hub-q-aftersay">{s.sentence}</p>}
      {s.review?.when && (
        <p className="hub-q-meta">
          Next review {s.review.when}. A short second session soon after the first is part of learning.
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- view */

/**
 * The card as drawn, from its state. No calls: QuestionCard below makes them.
 *
 * @param question  the server's question: forStudent fields + rich + provenance (+ closed in a lesson)
 * @param lang      'hi' | 'mr' when the question is shown translated, else undefined
 * @param note      the language note (English shown because no reviewed translation yet), or null
 * @param why       practice's sentence for why this question, or null
 * @param offer     the question's `hints`: { available, note }, or null for none
 * @param hintNote  show `offer.note` under the hint button (a lesson says it once for its questions)
 * @param hints     the hint replies opened so far: [{ position, label, html, cite, byLabel, ... }]
 * @param hintWhy   the hint plan's `why`, shown with the first hint
 * @param hintLeft  hints still to open (the last reply's `remaining`), or null before any
 * @param hintSaid  the server's message when no hint is left (hint: null)
 * @param choice    the option(s) chosen, for choose one / true or false / choose all
 * @param sent      the response sent for a phone-drawn kind, or null
 * @param result    the attempt's reply, or null before it
 * @param kept      { sentence } when the answer is kept on this device, else null
 * @param busy      'hint' | 'attempt' | null
 * @param error     { on: 'hint' | 'attempt', message } | null
 */
export function QuestionCardView({
  question: q, label, topicName, lang, note = null, why = null, offer = null, hintNote = true,
  hints = [], hintWhy = '', hintLeft = null, hintSaid = '', onHint,
  choice = null, onChoose, onCheck, sent = null, onSubmit,
  result = null, kept = null, busy = null, error = null,
}) {
  const uid = useId();
  const kind = q.kind ?? 'mcq';
  const drawn = CHOICE.has(kind);
  const answered = Boolean(result) || Boolean(kept);
  const locked = answered || busy === 'attempt';
  const closed = q.closed?.note ? q.closed : null;
  const [dock, setDock] = useState(null);
  const art = useRef(null);
  const marked = useRef(Boolean(result));
  const textId = `${uid}-q`;
  const kindId = `${uid}-k`;

  const available = offer?.available ?? 0;
  const left = hintLeft ?? available;
  const hintsOn = available > 0 && !answered && !closed;
  const ready = kind === 'multi' ? choice?.length > 0 : choice !== null && choice !== undefined;

  // The result has just landed: focus the option chosen, unless the student
  // has already moved elsewhere on the page.
  useEffect(() => {
    if (result && !marked.current && drawn) {
      const el = art.current;
      const here = el?.contains(document.activeElement) || document.activeElement === document.body;
      if (here) (el.querySelector('input:checked') ?? el.querySelector('input'))?.focus();
    }
    marked.current = Boolean(result);
  }, [result, drawn]);

  const graded = result && !result.ungraded;
  const tone = !graded ? null : result.correct ? 'yes' : result.score > 0 && result.score < 1 ? 'part' : 'no';
  const opts = drawn ? optionsOf(q) : [];
  const right = drawn ? rightOf(q, result?.solution) : [];
  const answerOpts = right.map((v) => opts.find((o) => o.value === v)).filter(Boolean);
  const feedback = Array.isArray(result?.optionFeedback) ? result.optionFeedback : [];
  const ex = result?.explanation;
  const exLang = langOf(ex?.language);
  const showWhy = (drawn && answerOpts.length > 0) || feedback.length > 0 || ex;

  return (
    <article className="hub-q" ref={art} aria-label={label || undefined} aria-labelledby={label ? undefined : textId}>
      <div className="hub-q-head">
        <Level level={q.bloom} />
        <span className="hub-q-kind" id={kindId}>{KIND_LABEL[kind] ?? kind}</span>
        {(label || topicName) && (
          <span className="hub-q-label">{[topicName, label].filter(Boolean).join(' · ')}</span>
        )}
      </div>

      <Passage q={q} lang={lang} />

      <div className="hub-q-text" id={textId}>
        <Stem q={q} lang={lang} />
      </div>

      {(q.provenance?.text || note) && (
        <p className="hub-q-prov">
          {q.provenance?.text}
          {note && <span className="hub-q-langnote">{note}</span>}
        </p>
      )}

      {closed ? (
        <p className="hub-q-closed" role="note"><Icon name="clock" size={15} />{closed.note}</p>
      ) : drawn ? (
        <Choices q={q} lang={lang} choice={choice} onChoose={onChoose} locked={locked} result={result} textId={textId} kindId={kindId} />
      ) : (
        <div className="hub-q-answer">
          <DockSlot.Provider value={dock}>
            <Held.Provider value={Boolean(kept)}>
              <Answer key={qid(q)} question={q} result={result} busy={busy === 'attempt'} sent={sent} onSubmit={onSubmit} />
            </Held.Provider>
          </DockSlot.Provider>
        </div>
      )}

      <Hints hints={hints} why={hintWhy} />

      {!result && !kept && !closed && (
        <div className="hub-q-foot">
          {hintsOn && (left > 0 && !hintSaid ? (
            <Button size="sm" variant="ghost" className="hub-q-hintbtn" icon={busy === 'hint' ? undefined : 'idea'} aria-busy={busy === 'hint' || undefined} onClick={onHint}>
              {busy === 'hint' && <span className="spinner" aria-hidden="true" />}
              {hints.length === 0 ? 'Show a hint' : 'Show the next hint'}
            </Button>
          ) : (
            <span className="hub-q-meta">{hintSaid || 'No more hints for this question.'}</span>
          ))}
          {drawn && (
            <Button variant="primary" className="hub-q-check" aria-busy={busy === 'attempt' || undefined} disabled={!ready} onClick={onCheck}>
              {busy === 'attempt' && <span className="spinner" aria-hidden="true" />}
              Check answer
            </Button>
          )}
          {!drawn && <div className="hub-q-dock" ref={setDock} />}
          {hintsOn && hintNote && offer?.note && <p className="hub-q-meta hub-q-hintnote">{offer.note}</p>}
        </div>
      )}

      {why && !answered && <p className="hub-q-said">{why}</p>}

      {error && <p className="hub-q-err" role="alert"><Icon name="alert" size={14} />{error.message}</p>}

      <div className="hub-q-result" role="status">
        {kept && (
          <p className="hub-q-kept">
            <Icon name="clock" size={15} />
            <span>
              {kept.sentence && <>{kept.sentence} </>}
              <b>Kept on this device, sent when it can be.</b>
            </span>
          </p>
        )}
        {result && (
          <>
            {tone && (
              <p className="hub-q-verdict" data-tone={tone}>
                <span className="hub-q-disc" aria-hidden="true"><Icon name={VERDICT[tone].icon} size={14} /></span>
                <b>{VERDICT[tone].word}</b>
                {result.detail && <span>{result.detail}</span>}
              </p>
            )}
            {result.provisionalNote && <p className="hub-q-meta">{result.provisionalNote}</p>}
            {result.note && <p className="hub-q-meta">{result.note}</p>}
            {showWhy && (
              <dl className="hub-q-why">
                {drawn && answerOpts.length > 0 && (
                  <div>
                    <dt>{answerOpts.length > 1 ? 'The answers' : 'The answer'}</dt>
                    <dd>
                      {answerOpts.map((o) => (
                        <span key={String(o.value)} className="hub-q-ans">
                          {o.html ? <RichText as="span" html={o.html} lang={lang} /> : o.text}
                        </span>
                      ))}
                    </dd>
                  </div>
                )}
                {feedback.map((f) => {
                  const which = letterOf(q, f.option);
                  return (
                    <div key={`f${String(f.option)}`}>
                      <dt>{feedback.length > 1 && which ? `About ${which}` : 'About your answer'}</dt>
                      <dd>
                        <RichText html={f.html} text={f.text} lang={langOf(f.language)} />
                        {f.language?.note && <span className="hub-q-langnote">{f.language.note}</span>}
                        <span className="hub-q-src">{[f.byLabel, f.cite].filter(Boolean).join(' · ')}</span>
                      </dd>
                    </div>
                  );
                })}
                {ex && (
                  <div>
                    <dt>Why</dt>
                    <dd>
                      <RichText html={ex.textHtml} text={ex.text} lang={exLang} />
                      {ex.label && <span className="hub-q-src">{ex.label}</span>}
                      {ex.note && <span className="hub-q-langnote">{ex.note}</span>}
                      {ex.language?.note && <span className="hub-q-langnote">{ex.language.note}</span>}
                    </dd>
                  </div>
                )}
              </dl>
            )}
            <After topic={result.topic} />
          </>
        )}
      </div>
    </article>
  );
}

/* --------------------------------------------------------- the card */

/**
 * The card, with its calls. Key it by the question's id, so a new question
 * starts clean.
 *
 * @param slot     where this question is shown, for its kept attempt id ("practice:<id>", "lesson:<lesson>:<id>")
 * @param send     (attemptId, response, timeMs) => the attempt's reply (hub.attempt / hub.lessonAttempt)
 * @param askHint  (attemptId, step) => the hint reply
 * @param opened   (attemptId) => the hints already opened, for a reload
 * @param onResult told the attempt's reply, or { kept: true } when the answer is kept on this device
 */
export default function QuestionCard({ question, slot, send, askHint, opened, onResult, ...shown }) {
  const kind = question.kind ?? 'mcq';
  const [{ attemptId, restored }] = useState(() => attemptFor(slot));
  const [choice, setChoice] = useState(kind === 'multi' ? [] : null);
  const [sent, setSent] = useState(null);
  const [hints, setHints] = useState([]);
  const [hintWhy, setHintWhy] = useState('');
  const [hintLeft, setHintLeft] = useState(null);
  const [hintSaid, setHintSaid] = useState('');
  const [result, setResult] = useState(null);
  const [kept, setKept] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const shownAt = useRef(Date.now());
  const offered = (shown.offer?.available ?? 0) > 0;

  // A reload: the hints this attempt had already opened come back from the
  // server. Once, when the card is shown (the callers make `opened` afresh on
  // every render).
  useEffect(() => {
    if (!restored || !offered || !opened) return undefined;
    let on = true;
    opened(attemptId)
      .then((r) => {
        if (!on || !r?.hints?.length) return;
        setHints(r.hints);
        setHintWhy(r.why ?? '');
        setHintLeft(r.remaining ?? 0);
      })
      .catch(() => { /* nothing opened, or not reachable: the button still works */ });
    return () => { on = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId]);

  const hint = () => {
    if (busy || result || kept) return;
    setBusy('hint');
    setError(null);
    keep(slot, attemptId);
    askHint(attemptId, hints.length + 1)
      .then((r) => {
        if (!r?.hint) { setHintSaid(r?.message ?? ''); setHintLeft(0); return; }
        setHints((list) => [...list.filter((h) => h.position !== r.hint.position), r.hint].sort((a, b) => a.position - b.position));
        if (r.why) setHintWhy((w) => w || r.why);
        setHintLeft(r.remaining ?? 0);
      })
      .catch((e) => setError({ on: 'hint', message: e.message }))
      .finally(() => setBusy(null));
  };

  const answer = (response) => {
    if (busy || result || kept) return;
    setBusy('attempt');
    setError(null);
    setSent(response);
    send(attemptId, response, Date.now() - shownAt.current)
      .then((r) => { forget(slot); setResult(r); onResult?.(r); })
      .catch((e) => {
        if (e.kept) {
          forget(slot);
          setKept({ sentence: e.offline ? 'No connection right now.' : e.message });
          onResult?.({ kept: true });
          return;
        }
        // Refused for good (a 400 or a 404): the sentence, and the answer can be changed.
        setSent(null);
        setError({ on: 'attempt', message: e.message });
      })
      .finally(() => setBusy(null));
  };

  return (
    <QuestionCardView
      question={question}
      {...shown}
      hints={hints}
      hintWhy={hintWhy}
      hintLeft={hintLeft}
      hintSaid={hintSaid}
      onHint={hint}
      choice={choice}
      onChoose={setChoice}
      onCheck={() => answer(choice)}
      sent={sent}
      onSubmit={answer}
      result={result}
      kept={kept}
      busy={busy}
      error={error}
    />
  );
}
