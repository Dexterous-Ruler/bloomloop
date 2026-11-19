/**
 * A topic's state in the student's own words. One copy, so the map, a topic
 * and the self-test always say the same thing. Never a rank.
 *
 *   not-sure      fewer than 3 attempts: provisional
 *   mastered      estimated 80% or more, from at least 5 attempts
 *   needs-review  a spaced review is due (the server's id; `review` kept as an alias)
 *   target        the topic a path leads to (the map only)
 */
export const STATE_WORD = {
  'not-started': 'Not started',
  'not-sure': 'Not sure yet',
  'in-progress': 'In progress',
  mastered: 'Mastered',
  'needs-review': 'Needs review',
  review: 'Needs review',
  target: 'Main topic',
};
