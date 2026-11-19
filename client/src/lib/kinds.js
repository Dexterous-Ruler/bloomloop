// Mirror of the interaction labels in server/src/questionTypes.js. Labels only —
// which level gets which interaction, and every scoring rule, stays on the
// server, because the client must never be the thing that decides what a
// question is. Same shape as bloom.js and for the same reason.
//
// Listed in the server's own KINDS order, so the two files can be read side by
// side and a missing kind shows up as a gap rather than as a lookup that quietly
// falls through to the raw id.

export const KIND_LABEL = {
  mcq: 'Choose one',
  truefalse: 'True or false',
  match: 'Match the pairs',
  categorise: 'Sort into groups',
  blank: 'Fill in the blank',
  cloze: 'Complete the passage',
  numeric: 'Work out the value',
  multi: 'Choose all that apply',
  order: 'Put these in order',
  rank: 'Rank them',
  open: 'Write your answer',
  hottext: 'Pick the words',
  dropdown: 'Choose for each gap',
  table: 'Complete the table',
  grid: 'Tick every match',
  // Named for what it asks and not for what it measures, because it measures
  // nothing — it is in no level's set on the server and carries no answer key.
  poll: 'Have your say',
};

/** Four characters or so, for a bar label under a stat card. */
export const KIND_TICK = {
  mcq: 'One',
  truefalse: 'T/F',
  match: 'Match',
  categorise: 'Sort',
  blank: 'Blank',
  cloze: 'Cloze',
  numeric: 'Value',
  multi: 'Multi',
  order: 'Order',
  rank: 'Rank',
  open: 'Open',
  hottext: 'Words',
  dropdown: 'Gaps',
  table: 'Table',
  grid: 'Grid',
};

/**
 * What a teacher has to supply for this kind, said in the editor before they
 * press Save rather than after. Guidance, not authority: the server's validator
 * decides, and a rejection shows its wording and not this.
 */
export const KIND_SHAPE = {
  mcq: 'Exactly four options, one of them correct.',
  truefalse: 'A statement, not a question — one a student can call true or false.',
  match: 'Three to five pairs. Each term matches one meaning and no other.',
  categorise: 'Two to four groups, four to ten items in all, and no empty group.',
  blank: 'One ____ in the text, plus every answer you would accept for it.',
  cloze: 'Two to four ____ in the passage, each with its own accepted answers.',
  numeric: 'A value, how far out a student may be, and the unit if there is one.',
  multi: 'Four to six options, at least two correct, never all of them.',
  order: 'Three to five items in the correct order. The student sees them shuffled.',
  rank: 'Three to five items in order, and the criterion they are ranked against.',
  open: 'Two to five rubric points, each a few words a real answer would use.',
  hottext: 'A sentence of 3 to 40 words, what to pick in it, and the words that meet it: at least one, never all.',
  dropdown: 'Two to four ____ in the text, each with two to five choices and one of them right.',
  table: 'Two to four columns and two to six rows. Each cell is given or written by the student, and at least one is written.',
  grid: 'Two to six rows and two to five columns. Tick every pairing that holds: at least one, never all of them.',
};

/**
 * Where a blank goes in the text of a blank or a cloze item. Mirrors BLANK_MARK
 * in server/src/questionTypes.js: the server writes the marker and the answer
 * key reads it back, so the two must agree on the exact string or a cloze
 * passage renders with its gaps still in it.
 */
export const BLANK_MARK = '____';
