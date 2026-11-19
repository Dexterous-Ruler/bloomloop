/**
 * A lesson's concept panel as its professor reviews it (Batch 8, H9a and H9b;
 * `sections` on each lesson of GET /api/hub/topics/:id/lessons and
 * /api/hub/lessons/:id): the introduction, the fact cards, the explanation
 * steps with the term in bold, the code example with its caption, and the
 * common mistakes, each with the slides it cites. The sections are written
 * with the lesson, so they are an AI draft exactly while it is one; the
 * server's label says so. A slides-only lesson has none, and its note says why.
 * Terms and code stay in English; the rest comes as the server rendered it.
 */

import RichText from '../hub/RichText.jsx';
import { DraftTag } from '../teach/ItemStats.jsx';
import { Icon } from '../ui/index.jsx';
import { list } from './QueueParts.jsx';

import '../styles/material8.css';

function Cite({ cite }) {
  return cite ? <span className="hq-cite"><Icon name="deck" size={13} />{cite}</span> : null;
}

/** @param sections  the staff view's sections, or undefined on a server before Batch 8 */
export default function LessonSections({ sections }) {
  if (!sections) return null;
  if (!sections.available) return sections.note ? <p className="hq-note m8-sec-none">{sections.note}</p> : null;
  const facts = list(sections.facts);
  const steps = list(sections.steps);
  const mistakes = list(sections.mistakes);
  const { intro, example } = sections;

  return (
    <section className="m8-sec" data-draft={sections.aiDraft ? 'true' : undefined} aria-label="Concept panel">
      <header className="m8-sec-head">
        <span className="hq-step-k">Concept panel{sections.aiDraft && <DraftTag />}</span>
        {sections.label && <p className={sections.aiDraft ? 'hq-who-draft' : 't-meta'}>{sections.label}</p>}
      </header>

      {intro && (
        <div className="m8-sec-part">
          <h5>Introduction</h5>
          <RichText html={intro.html} text={intro.text} />
          <Cite cite={intro.cite} />
        </div>
      )}

      {facts.length > 0 && (
        <ul className="m8-facts" aria-label="Facts">
          {facts.map((f, i) => (
            <li key={f.kind ?? i} className="m8-fact">
              <span className="m8-fact-k">{f.label}</span>
              <RichText html={f.html} text={f.text} />
              <Cite cite={f.cite} />
            </li>
          ))}
        </ul>
      )}

      {steps.length > 0 && (
        <div className="m8-sec-part">
          <h5>Explanation</h5>
          <ol className="m8-steps">
            {steps.map((s, i) => (
              <li key={i}>
                <b>{s.term}</b>
                <RichText html={s.html} text={s.text} />
                <Cite cite={s.cite} />
              </li>
            ))}
          </ol>
        </div>
      )}

      {example && (
        <div className="m8-sec-part">
          <h5>Code example{example.language && example.language !== 'text' && <span className="m8-lang mono">{example.language}</span>}</h5>
          {/* The server's highlighted block; the code itself as text when it sends none. */}
          {example.html
            ? <RichText className="m8-code" html={example.html} />
            : <pre className="hub-code"><code>{example.body}</code></pre>}
          {(example.captionHtml || example.caption) && <RichText className="m8-caption" html={example.captionHtml} text={example.caption} />}
          <Cite cite={example.cite} />
        </div>
      )}

      {mistakes.length > 0 && (
        <div className="m8-sec-part">
          <h5>Common mistakes</h5>
          <ul className="m8-mistakes">
            {mistakes.map((m, i) => (
              <li key={i}>
                <RichText html={m.html} text={m.text} />
                <Cite cite={m.cite} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
