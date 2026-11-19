/**
 * The passage or image a question hangs off, above the question it is about.
 *
 * A stimulus is not a kind: it rides on the base object, so one passage can
 * carry a choice at Remember and an open response at Create. This therefore
 * sits above all sixteen interactions and knows nothing about any of them.
 *
 * Collapsible by design. On a phone a long passage and the answer controls
 * want the same space: pinned open, the question is buried; behind a link,
 * nobody opens it. So it arrives open but capped - it scrolls inside itself -
 * and one tap folds it to a line when the student needs the room to answer.
 */

import { useId, useState } from 'react';

import { Icon } from '../ui/index.jsx';
import Figure from './Figure.jsx';
import { rt } from './parts.jsx';

/** `html`: the passage as the server built it (`question.rich.passage`), when it holds a formula or code. */
export default function Stimulus({ stimulus, html }) {
  const [open, setOpen] = useState(true);
  // An image that never arrived: hall wifi, a host that is down. The alt text
  // is then the only evidence on screen, which is why the server refuses an
  // image stimulus without one.
  const [broken, setBroken] = useState(false);
  const bodyId = useId();

  if (!stimulus) return null;
  const isImage = stimulus.kind === 'image';
  // Batch 8: a figure the server drew ({ svg, description, table, title }).
  const isFigure = stimulus.kind === 'figure';
  const peek = isFigure ? (stimulus.title ?? '') : isImage ? (stimulus.alt ?? '') : String(stimulus.text ?? '');
  const what = isFigure ? 'figure' : isImage ? 'image' : 'passage';

  return (
    <section className="ln-stim">
      <button
        type="button"
        className="ln-stim-head"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="book" />
        <span className="strong">{isFigure ? 'Figure' : isImage ? 'Image' : 'Passage'}</span>
        {/* Folded, it still says what it was, so opening it is never a tap into
            the dark. */}
        <span className="clip grow muted">{open ? '' : peek}</span>
        <span className="muted">{open ? 'Hide' : 'Show'}</span>
        <Icon name={open ? 'chevron' : 'chevronRight'} />
      </button>

      {open && (
        <div
          className={`ln-stim-body${isFigure ? ' ln-stim-fig' : ''}`}
          id={bodyId}
          /* It scrolls, so it has to be focusable, or a keyboard cannot read
             past the first screenful. Labelled, because an unnamed region is
             announced as "group". A figure is not capped, so it does not scroll. */
          tabIndex={isFigure ? undefined : 0}
          role="region"
          aria-label={`The ${what} this question is about`}
        >
          {isFigure ? <Figure figure={stimulus} /> : isImage
            ? (broken
              ? <p>{stimulus.alt}</p>
              : <img src={stimulus.url} alt={stimulus.alt ?? ''} onError={() => setBroken(true)} />)
            : <p {...rt(html, stimulus.text)} />}
        </div>
      )}
    </section>
  );
}
