import { LABEL } from '../bloom.js';
import { KIND_LABEL } from '../kinds.js';
import QuestionBody, { Stimulus } from './QuestionBody.jsx';

/* .skel is built for the light surfaces. On a phone in a dark hall it has to
   shimmer between the two dark greys, or the wait for a question is a white
   flash in the student's face. */
const SHEEN = 'linear-gradient(90deg, var(--d-2) 25%, var(--d-3) 37%, var(--d-2) 63%)';

function Skel({ w, h, r }) {
  return (
    <span
      className="skel"
      style={{ display: 'block', width: w, height: h, borderRadius: r, backgroundImage: SHEEN }}
    />
  );
}

/* S2 (unanswered) and S3 (answered). The interaction itself lives in
   QuestionBody, chosen by the question's kind — which is chosen by its Bloom
   level. This shell only carries the framing that is the same for all of them. */
export default function QuestionCard({ item, result, awaiting, level, trail, onSubmit, onNext }) {
  const question = item?.question;

  if (!question) {
    return (
      <>
        <div className="pips" style={{ marginTop: 16 }} aria-hidden="true">
          {Array.from({ length: 9 }).map((_, i) => <i key={i} />)}
        </div>

        {/* Shaped like the question that is coming, not the word "Loading":
            over hall wifi this is on screen for whole seconds, and a block that
            already has the question's shape makes the wait feel like arrival. */}
        <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 11 }} aria-hidden="true">
          <Skel w="38%" h={9} />
          <Skel w="100%" h={22} />
          <Skel w="72%" h={22} />
        </div>
        <div className="opts" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => <Skel key={i} w="100%" h={54} r="var(--r-tile)" />)}
        </div>

        <p className="hintline" role="status">Finding the right question for you…</p>
        <button type="button" className="btn lime" style={{ marginTop: 'auto' }} onClick={() => onNext(true)}>
          Ask again
        </button>
      </>
    );
  }

  const kind = question.kind ?? 'mcq';
  const partial = result && result.score > 0 && result.score < 1;
  // The pip on screen is only answered once a result is back for it.
  const answered = Math.max(0, trail.length - (result ? 0 : 1));

  return (
    <>
      <div className="row" style={{ marginTop: 16, justifyContent: 'space-between' }}>
        <span className={`tag lg ${question.bloom}`}>{LABEL[question.bloom]}</span>
        <span className="eyebrow on-d">Question {item.index}</span>
      </div>

      {/* This student's own trajectory: one pip per question served. Answered
          ones go lime, the one on screen keeps its own level colour, so a step
          up or down is visible in the strip before it is announced. */}
      <div className="pips" style={{ marginTop: 14 }} aria-hidden="true">
        {trail.map((l, i) => <i key={i} className={i < answered ? 'on' : `swatch ${l}`} />)}
        {Array.from({ length: Math.max(0, 9 - trail.length) }).map((_, i) => <i key={`e${i}`} />)}
      </div>

      {/* Above the question, and remounted with it: the collapse state belongs to
          the question being asked, not to the passage, so the next item on the
          same reading opens expanded rather than inheriting a fold made while
          answering the last one. Any kind may carry one — that is what lets a
          single passage hold an mcq at Remember and an open response at Create
          instead of being locked to one paid "Passage" item. */}
      <Stimulus key={question._id} stimulus={question.stimulus} />

      <div className="q-topic">
        {/* The raw id when the mirror in kinds.js has a gap, the way every other
            screen reads it. Rendering nothing leaves the separator below hanging
            off the front of the topic, which reads as a bug in the question
            rather than as a label nobody has written yet. */}
        {KIND_LABEL[kind] ?? kind}
        {question.topic ? ` · ${question.topic}` : ''}
      </div>
      {/* A cloze or dropdown passage is not a prompt with an answer under it —
          the passage IS the interaction, typed or chosen into where the blanks
          fall. QuestionBody renders the text itself for those two kinds, so
          printing it here as well would put the same paragraph on screen twice. */}
      {kind !== 'cloze' && kind !== 'dropdown' && <div className="q-text">{question.text}</div>}

      {question.source === 'fallback' && (
        <div style={{ marginTop: 14 }}>
          <span className="flag" title="Written by the offline template generator, not by the language model.">
            offline template
          </span>
        </div>
      )}

      {/* No verdict on an ungraded item, and `ungraded` rather than the kind
          because the server is the one that decides — it stamps the flag from
          UNGRADED_KINDS, so a second kind added to that list is silent here on
          the same day rather than on the day somebody remembers this line.

          A poll scores correct:true for every well-formed answer, by design, so
          the shared path would put a green ✓ Correct on an opinion. That is the
          mirror of the failure this phase was told to avoid: a student must not
          think they got a poll wrong, and they must not be told they got it
          right either. QuestionBody says what actually happened instead. */}
      {result && !result.ungraded && (
        <>
          <div className={`verdict ${result.correct ? 'yes' : 'no'}`}>
            <i>{result.correct ? '✓' : partial ? '½' : '✕'}</i>
            <b>{result.correct ? 'Correct' : partial ? 'Partly there' : 'Not this time'}</b>
          </div>
          {result.detail && <div className="why"><span>{result.detail}</span></div>}
        </>
      )}

      <div style={{ marginTop: result ? 0 : 18 }}>
        <QuestionBody question={question} result={result} busy={awaiting} onSubmit={onSubmit} />
      </div>

      {result ? (
        <>
          {/* The product's own sentence about why this student got this item —
              lime rule, because it is BloomLoop talking and not the marker. */}
          {result.reason && <div className="stu-said"><span>{result.reason}</span></div>}
          <button
            type="button"
            className="btn lime"
            style={{ marginTop: result.reason ? 16 : 'auto' }}
            disabled={awaiting}
            onClick={() => onNext(true)}
          >
            {awaiting ? <span className="spin" /> : null}
            Next question
          </button>
        </>
      ) : (
        <div className="stu-said">
          <span>This question was chosen because you are working at {LABEL[level]}.</span>
        </div>
      )}
    </>
  );
}
