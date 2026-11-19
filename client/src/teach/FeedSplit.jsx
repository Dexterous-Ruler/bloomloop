/**
 * The two halves of a Mixed or Teacher-led room (Phase 3): what phones
 * answered, and what the professor recorded. Each under the server's own
 * label, side by side and never added together: there is no total, and no
 * figure here is folded into accuracy or a level. A Teacher-led room has no
 * digital half (no phone answers), so only the records show.
 *
 * Staff only, with the server's privacy sentence under the records.
 *
 * @param feed  teacher:grid's `feed`: { mode, digital?{ label, joined, answered, answers },
 *              teacher{ label, observations{ understood, participated, revision, support, observed },
 *              wheel{ picks, answered, pending }, tallies, activities, privacy } }
 */

import { useId } from 'react';

import { Icon } from '../ui/index.jsx';

// The server's names for the four marks (services/records.js OBSERVATION_KINDS).
const MARKS = [
  ['understood', 'Understood'],
  ['participated', 'Participated'],
  ['revision', 'Needs revision'],
  ['support', 'Needs additional support'],
];

const Fig = ({ n, label }) => (
  <div className="fs-fig">
    <dt>{label}</dt>
    <dd>{n ?? 0}</dd>
  </div>
);

export default function FeedSplit({ feed }) {
  const id = useId();
  if (!feed || (!feed.digital && !feed.teacher)) return null;
  const { digital, teacher } = feed;
  const obs = teacher?.observations ?? {};
  const wheel = teacher?.wheel ?? {};

  return (
    <div className="fs" data-halves={digital && teacher ? '2' : '1'} role="group" aria-label="Digital answers and teacher records, counted apart">
      {digital && (
        <section className="fs-half" aria-labelledby={`${id}-d`}>
          <h3 className="fs-label" id={`${id}-d`}><Icon name="wifi" size={14} />{digital.label}</h3>
          <dl className="fs-figs">
            <Fig n={digital.joined} label="Joined" />
            <Fig n={digital.answered} label="Answered" />
            <Fig n={digital.answers} label="Answers" />
          </dl>
          <p className="fs-sub">Phones only. Accuracy and levels come from these answers alone.</p>
        </section>
      )}

      {teacher && (
        <section className="fs-half" aria-labelledby={`${id}-t`}>
          <h3 className="fs-label" id={`${id}-t`}><Icon name="note" size={14} />{teacher.label}</h3>
          <dl className="fs-figs">
            <Fig n={obs.observed} label="Observed" />
            <Fig n={wheel.picks} label="Wheel picks" />
            <Fig n={teacher.tallies} label="Hand tallies" />
            <Fig n={teacher.activities} label="Activities" />
          </dl>
          <ul className="fs-break" aria-label="Observations and wheel picks in detail">
            {MARKS.map(([k, label]) => <li key={k}>{label} <b>{obs[k] ?? 0}</b></li>)}
            <li>Picks answered <b>{wheel.answered ?? 0}</b></li>
            <li>Picks pending <b>{wheel.pending ?? 0}</b></li>
          </ul>
          {teacher.privacy && <p className="fs-privacy"><Icon name="eyeOff" size={14} />{teacher.privacy}</p>}
        </section>
      )}
    </div>
  );
}
