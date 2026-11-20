/**
 * One question: the level it is at, what it asks, and - once it is marked -
 * what the server said about the answer. The interaction itself is Answer,
 * chosen by the question's kind; this carries what is the same for all of them.
 */

import { Fragment, useEffect, useState } from 'react';

import { LABEL } from '../lib/bloom.js';
import { BLANK_MARK, labelOf } from '../lib/kinds.js';
import Mark from '../fx/Mark.jsx';
import { Button, Icon, Ladder, Level } from '../ui/index.jsx';
import Answer, { FIGURE_KINDS } from './Answer.jsx';
import Stimulus from './Stimulus.jsx';
import { Dock, Held, NextUp, SaveState, Sure, pieces, rt } from './parts.jsx';

const VERDICT = {
  yes: { mark: 'check', word: 'Correct' },
  part: { mark: 'minus', word: 'Partly there' },
  no: { mark: 'close', word: 'Not this time' },
};

/**
 * @param sent   the response submitted for this question and not yet marked, or null
 * @param auto   the next question is on a timer, so the dock shows it running
 * @param trail  the levels of the questions served so far, newest last
 * @param foot   what the session says under every question (focus mode)
 * @param retry  { triesLeft, detail } after a wrong attempt the room lets them retry
 * @param triesLeft  goes this question allows, before any are spent
 * @param readAloud  the student's professor turned on the read-aloud support
 * @param sure   the confidence tap: { choices, value, onChange }, or null for none
 * @param save   where this question's answer is in the outbox: { state, note }, or null
 * @param onward with no result to move on from (offline, or an answer the server
 *               kept or refused), the way to the next question, or null
 *
 * The page arrives block by block, six at most, so this renders no more than
 * that: the answer is one block however many pieces its kind has.
 */
/** What read-aloud says: the question, then each choice with its letter. */
function spokenText(question) {
  const parts = [String(question.text ?? '').replaceAll(BLANK_MARK, 'blank')];
  const options = Array.isArray(question.options) ? question.options : [];
  options.forEach((o, i) => parts.push(`${String.fromCharCode(65 + i)}. ${o}`));
  if (question.kind === 'truefalse') parts.push('True, or false.');
  return parts.join('. ');
}

/**
 * Read the question aloud with the phone's own voice. Never starts by itself:
 * a room of phones talking at once would be worse than no support.
 */
function ReadAloud({ question }) {
  const [speaking, setSpeaking] = useState(false);
  const can = typeof window !== 'undefined' && 'speechSynthesis' in window;
  useEffect(() => () => { if (can) window.speechSynthesis.cancel(); }, [can, question._id]);
  if (!can) return null;
  const toggle = () => {
    const synth = window.speechSynthesis;
    if (speaking) { synth.cancel(); setSpeaking(false); return; }
    const u = new SpeechSynthesisUtterance(spokenText(question));
    u.lang = 'en-IN';
    u.rate = 0.95;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    synth.cancel();
    synth.speak(u);
    setSpeaking(true);
  };
  return (
    <Button size="sm" icon={speaking ? 'stop' : 'play'} onClick={toggle} aria-pressed={speaking}>
      {speaking ? 'Stop reading' : 'Read aloud'}
    </Button>
  );
}

/**
 * The room's time per question, counted on this phone. It only informs: when
 * it runs out the student is told they can still answer, and Submit stays
 * exactly as it was, because the server takes a late answer like any other.
 * Read out once when it ends, not every second.
 */
function Clock({ seconds, paused }) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    if (paused || left <= 0) return undefined;
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left, paused]);
  const up = left <= 0;
  const m = Math.floor(Math.max(0, left) / 60);
  const ss = String(Math.max(0, left) % 60).padStart(2, '0');
  return (
    <>
      <span className="ln-clock" data-up={up ? 'true' : undefined} role="timer" aria-label={up ? 'Time is up' : `${left} seconds left`}>
        <Icon name="timer" size={14} />
        <span className="num">{up ? '0:00' : `${m}:${ss}`}</span>
      </span>
      <p className="ln-clock-up" role="status">{up ? 'Time is up. You can still answer, and it will count.' : ''}</p>
    </>
  );
}

/**
 * Who wrote the question and whether it was checked, in the server's own
 * sentence (`question.provenance.text`, honest indicators): a quiet line, not
 * a warning, and never the words for how it was made inside the product. A
 * server that sends none gets nothing said.
 */
export function Provenance({ question }) {
  const text = question?.provenance?.text;
  return typeof text === 'string' && text ? <p className="ln-prov">{text}</p> : null;
}

export default function Question({
  item, result, awaiting, sent, level, trail, auto, foot, onSubmit, onNext,
  retry = null, triesLeft = 1, readAloud = false, timer = null, paused = false, sure = null, save = null, onward = null,
}) {
  const question = item?.question;

  if (!question) {
    return (
      <>
        {/* The ladder fills while the server picks. Over hall wifi this is on
            screen for whole seconds, and a wait that shows what it is doing
            reads as arrival, not as a stall. */}
        <div className="ln-seek" role="status">
          <Ladder size={56} />
          <b>Finding a question at your level</b>
          <span className="t-small muted">Picked for you from your teacher's bank.</span>
        </div>
        <div className="ln-card" aria-hidden="true">
          <div className="skel" style={{ width: 132, height: 30, borderRadius: 'var(--r-full)' }} />
          <div className="stack stack-2">
            <div className="skel" style={{ width: '100%', height: 26 }} />
            <div className="skel" style={{ width: '70%', height: 26 }} />
          </div>
          <div className="ln-opts">
            {[0, 1, 2, 3].map((i) => <div key={i} className="skel" style={{ height: 60, borderRadius: 15 }} />)}
          </div>
        </div>
        {foot && <div className="ln-foot">{foot}</div>}
        <Dock>
          <Button size="xl" block icon="refresh" onClick={() => onNext(true)}>Ask again</Button>
        </Dock>
      </>
    );
  }

  const kind = question.kind ?? 'mcq';
  /* No verdict on an ungraded item. The server stamps `ungraded` from its own
     list, so a second ungraded kind is silent here the day it is added; the
     kind is checked as well because a poll must never be marked on screen,
     whatever the payload carries.

     A poll scores correct:true for every well-formed answer, by design, so the
     shared path would put a tick on an opinion. A student must not think they
     got a poll wrong, and must not be told they got it right either. Answer
     says what happened instead. */
  // Nor on one that waits for a person (a drawing, batch 9): it has no mark
  // yet, and the kind says so in the server's own sentence.
  const marked = result && !result.ungraded && !result.awaitingReview && kind !== 'poll';
  const partial = marked && !result.correct && result.score > 0 && result.score < 1;
  const tone = !marked ? null : result.correct ? 'yes' : partial ? 'part' : 'no';

  return (
    <>
      <article className="ln-card" aria-label={`Question ${item.index}`}>
        <div className="ln-head">
          <Level level={question.bloom} size="lg" solid />
          {/* A packed question answered offline has no number on the server's
              count yet, so it says where it is in the pack instead. */}
          <span className="ln-qn num">{item.tag || `Q${item.index}`}</span>
          {/* This student's own path: one bar per question served, as tall as
              its level, so a step up or down shows here before it is
              announced. */}
          {trail.length > 1 && (
            <span className="ln-trail" role="img" aria-label={`Levels of your last ${trail.length} questions: ${trail.map((l) => LABEL[l] ?? l).join(', ')}`}>
              {trail.map((l, i) => (
                <i key={i} className="swatch" data-level={l} data-current={i === trail.length - 1 ? 'true' : undefined} />
              ))}
            </span>
          )}
          {/* Remounted per question, so each starts from the room's full time. */}
          {timer && !result && <Clock key={`clock:${question._id}:${item.index}`} seconds={timer} paused={paused} />}
        </div>

        {/* Above the question, and remounted with it: the fold belongs to the
            question being asked, so the next item on the same reading opens
            expanded. */}
        {/* The figure kinds draw their own figure, to answer on it. */}
        {!FIGURE_KINDS.has(kind) && <Stimulus key={`stim:${question._id}`} stimulus={question.stimulus} html={question.rich?.passage} />}

        <div className="ln-ask">
          <span className="ln-kind">
            {/* The raw id when kinds.js has a gap, so the separator is never
                left hanging off the front of the topic. */}
            {labelOf({ kind, length: question.length })}
            {question.topic ? <span>{` · ${question.topic}`}</span> : null}
          </span>
          {/* A cloze or dropdown passage is not a prompt with an answer under
              it: the passage IS the interaction, and Answer renders it with the
              gaps in place. Printing it here too would show it twice. */}
          {kind !== 'cloze' && kind !== 'dropdown' && (
            <h1
              className="ln-text wrap-any"
              data-long={String(question.text ?? '').length > 160 ? 'true' : undefined}
              /* The server's HTML when the text holds a formula or code. A
                 blank's marker is drawn as the gap it stands for, not printed
                 as four underscores. */
              {...(kind === 'blank'
                ? {
                  children: pieces(question.text, question.rich?.text).map((part, i) => (
                    <Fragment key={i}>{i > 0 && <span className="ln-blank" role="img" aria-label="blank" />}<span {...part} /></Fragment>
                  )),
                }
                : rt(question.rich?.text, question.text))}
            />
          )}
          <Provenance question={question} />
          {readAloud && <ReadAloud question={question} />}
        </div>

        {retry && !result && (
          <div className="ln-retry" role="status">
            <Icon name="refresh" size={20} />
            <span className="grow">
              <b>Not quite.</b> {retry.triesLeft === 1 ? 'You have one more go.' : `You have ${retry.triesLeft} more goes.`}
              {retry.detail ? ` ${retry.detail}.` : ''} Change your answer and send it again.
            </span>
            <span className="ln-goes" aria-hidden="true">
              {Array.from({ length: Math.min(retry.triesLeft, 5) }, (_, i) => <i key={i} />)}
            </span>
          </div>
        )}

        {/* Above the answer, because a single choice is sent on the tap that
            makes it: the tap has to be reachable before that. Locked once the
            answer is on its way. */}
        {sure && (
          <Sure
            choices={sure.choices}
            value={sure.value}
            onChange={sure.onChange}
            locked={Boolean(result) || awaiting || sent !== null}
          />
        )}

        <div className="ln-answer">
          {/* Held on this phone, or kept or refused by the server: the answer
              is given, so its Submit goes. */}
          <Held.Provider value={['queued', 'held', 'uncounted', 'refused'].includes(save?.state)}>
            <Answer key={`ans:${question._id}`} question={question} result={result} busy={awaiting} sent={sent} onSubmit={onSubmit} />
          </Held.Provider>
        </div>
      </article>

      <div className="ln-foot">
        {/* Where this answer is: on this phone, sent, or marked. */}
        {save && <SaveState state={save.state} note={save.note} live />}
        {/* The server's own sentence for this phone when it sent one, which
            says the level and why without naming a band. */}
        {!result && <p className="said">{item.reason || `Chosen because you are working at ${LABEL[level] ?? level}.`}</p>}
        {!result && !retry && triesLeft > 1 && (
          <p className="t-small muted">You have {triesLeft} goes at this question.</p>
        )}
        {foot}
      </div>

      {!result && onward && (
        <Dock>
          <Button variant="primary" size="xl" block onClick={onward}>
            Next question <Icon name="forward" />
          </Button>
        </Dock>
      )}

      {result && (
        <Dock>
          {auto && <i className="ln-auto" aria-hidden="true" />}
          {marked && (
            <div className="ln-verdict" data-tone={tone} role="status">
              <span className="ln-disc"><Mark kind={VERDICT[tone].mark} size={28} /></span>
              <div className="grow">
                <b>{VERDICT[tone].word}</b>
                {result.detail && <span className="t-small">{result.detail}</span>}
              </div>
            </div>
          )}
          {/* A written answer's first mark is the machine's reading of it
              against the rubric, and a professor can still confirm or change
              it. Said so plainly, so a student is not surprised later. */}
          {marked && result.provisional && (
            <p className="t-small dim" role="note">Your teacher may review this mark.</p>
          )}
          {/* What comes next and why, in the server's words: the levels of the
              next questions, the answers that rests on, and its sentence. */}
          <NextUp next={result.profile?.next} fallback={result.reason || ''} />
          <Button variant={marked ? 'ink' : 'primary'} size="xl" block busy={awaiting} onClick={() => onNext(true)}>
            Next question <Icon name="forward" />
          </Button>
        </Dock>
      )}
    </>
  );
}
