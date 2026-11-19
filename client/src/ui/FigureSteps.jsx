/**
 * A stepped figure (batch 8): Back, Next and Replay through figure.steps, a
 * caption per step and progress dots. Every step's drawing is in the payload,
 * so it works offline. Hub lessons; never loaded by the phone.
 *
 *   <FigureSteps figure={{ svg, description, table, steps: [{ caption, svg, description }] }} />
 *
 * Step 0 is the figure itself; steps 1..n are the server's own drawings with
 * their parts lit up (or, for a call stack, the stack at that moment). The line
 * under the drawing is one live region, always on the page, so a screen
 * reader hears each step's caption as it changes (a call stack draws its
 * caption into the picture, so there the caption is for screen readers
 * only). Back is never disabled
 * outright (aria-disabled), so focus is not dropped on the first step, and
 * Next turns into Replay on the last one.
 */
import { useState } from 'react';

import Figure from '../learn/Figure.jsx';
import { Button, Icon } from './index.jsx';

export default function FigureSteps({ figure }) {
  // Back to the start when another figure arrives (compared by its drawing, so
  // a parent that rebuilds the same figure object does not reset it).
  const [place, setPlace] = useState({ of: figure?.svg, at: 0 });
  const at = place.of === figure?.svg ? place.at : 0;
  const setAt = (next) => setPlace({ of: figure?.svg, at: next });
  if (!figure) return null;
  const steps = Array.isArray(figure.steps) ? figure.steps : [];
  if (steps.length === 0) return <Figure figure={figure} />;

  const n = steps.length;
  const now = Math.min(at, n);
  const frame = now ? steps[now - 1] : null;
  const last = now === n;

  return (
    <Figure
      className="fig-steps"
      figure={{
        svg: frame?.svg ?? figure.svg,
        description: frame?.description ?? figure.description,
        table: figure.table,
      }}
    >
      <p className="fig-steps-now" aria-live="polite">
        {now
          ? <><b>Step {now} of {n}</b>{frame.caption && <span className={figure.type === 'stack' ? 'sr-only' : undefined}>{frame.caption}</span>}</>
          : <span className="muted">The whole figure, then {n} {n === 1 ? 'step' : 'steps'} through it.</span>}
      </p>
      <div className="fig-steps-bar">
        <Button
          size="sm"
          icon="back"
          aria-disabled={now === 0}
          onClick={() => { if (now > 0) setAt(now - 1); }}
        >
          Back
        </Button>
        <span className="fig-dots" aria-hidden="true">
          {steps.map((_, i) => <i key={i} data-on={i < now ? 'true' : undefined} />)}
        </span>
        {/* One button, so focus stays on it when Next becomes Replay. */}
        <Button
          size="sm"
          variant={last ? undefined : 'primary'}
          icon={last ? 'refresh' : undefined}
          onClick={() => setAt(last ? 0 : now + 1)}
        >
          {last ? 'Replay' : <>Next<Icon name="forward" /></>}
        </Button>
      </div>
    </Figure>
  );
}
