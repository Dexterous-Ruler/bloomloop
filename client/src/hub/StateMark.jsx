/**
 * A topic's state as a shape, so it reads without colour: a hollow ring (not
 * started), a broken ring (not sure yet), half filled (in progress), a filled
 * tick (mastered), a clock (needs review), a target (the main topic), a
 * square (earlier material, on none of the student's classes), a faint dot
 * (no state known). Always drawn beside the word. One copy for every hub
 * screen; its colours are in styles/hub.css (.hub-mark). The server says
 * 'needs-review'; 'review' is the same mark.
 */
export default function StateMark({ state, size = 14 }) {
  const shown = state === 'review' ? 'needs-review' : state;
  let body;
  if (shown === 'earlier') {
    body = <><rect x="1.8" y="1.8" width="10.4" height="10.4" rx="2.6" className="s" /><path d="M4.6 7h4.8" className="s" /></>;
  } else if (shown === 'none') {
    body = <circle cx="7" cy="7" r="2.2" className="f" />;
  } else if (shown === 'mastered') {
    body = <><circle cx="7" cy="7" r="6.4" className="f" /><path d="M4.1 7.2l2 2 3.8-4.1" className="k" /></>;
  } else if (shown === 'in-progress') {
    body = <><circle cx="7" cy="7" r="5.6" className="s" /><path d="M7 1.4a5.6 5.6 0 0 1 0 11.2z" className="f" /></>;
  } else if (shown === 'not-sure') {
    body = <circle cx="7" cy="7" r="5.6" className="s" strokeDasharray="2.2 2.2" />;
  } else if (shown === 'needs-review') {
    body = <><circle cx="7" cy="7" r="5.6" className="s" /><path d="M7 4.1v3.2l2.1 1.3" className="s" /></>;
  } else if (shown === 'target') {
    body = <><circle cx="7" cy="7" r="5.8" className="s" /><circle cx="7" cy="7" r="2.9" className="s" /><circle cx="7" cy="7" r="1" className="f" /></>;
  } else {
    body = <circle cx="7" cy="7" r="5.6" className="s" />;
  }
  return (
    <svg className="hub-mark" data-state={shown} width={size} height={size} viewBox="0 0 14 14" aria-hidden="true" focusable="false">
      {body}
    </svg>
  );
}
