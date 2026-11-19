// Phase 5 - class questions: one approved bank question put to every phone in a
// room at once, then a pause, a discussion and a re-vote (peer instruction).
//
// The rest of a room is adaptive: each phone is served its own next question
// (services/selector.js). A class question is the professor's: the room's owner
// picks one approved question of the room, every phone in a room where phones
// answer (Student devices or Mixed) is sent it, and each phone parks its own
// question, votes with a confidence tap, and goes back to where it was.
//
//   open     round 1: every phone may vote, and change its vote until the round
//            closes. The professor sees how many have voted, not what.
//   paused   round 1 is closed. The professor sees the distribution, the share
//            right and the confidence taps; the projector may show the counts.
//            The class discusses.
//   revote   round 2: every phone votes again, a phone that missed round 1
//            included.
//   closed   finished, with its key revealed or not. The class-level changes
//            (wrong to right, right to wrong, ...) are counted once round 2 has
//            closed.
//
// A professor may close from any round (no re-vote, or no pause at all).
//
// EVIDENCE. Every vote is an answers row (0008), written once and never
// overwritten, with the class question's id and its round (0023). Within a
// round only the latest vote counts: a vote a phone changed is kept with
// `final` false, as a retried attempt is. A vote that arrives once its round
// has closed is kept too, `final` false and saying so in `detail`, and is never
// counted. Nothing is ever discarded.
//
// WHY A CLASS QUESTION MOVES NO LEVEL. The ladder (services/mastery.js) reads
// each student's answers to questions chosen for THEIR level, one at a time and
// on their own. A class question was chosen for the whole class, not for any
// one student's level, and its round 2 follows a discussion with classmates, so
// neither round is evidence of what the student can do alone at a level. No vote
// touches a profile: the history, the levels, the working level, the bands and
// the insights never see one. In attainment (services/attainment.js) round 1 is
// an ordinary digital answer, counted when its question is mapped to an
// outcome; round 2 is its own evidence type, "re-vote after discussion", shown
// and never counted.
//
// KEY SAFETY. Before the professor reveals the key, no phone or projector
// payload built here carries it: the phone's question goes through forStudent()
// (questionTypes.js), the vote's acknowledgement says nothing about right or
// wrong, and the wall's counts leave out everything that would tell the key
// (the share right and the changes) until it is revealed. Once a question has
// been asked to the class it is never served adaptively in that room again
// (askedQuestionIds, read by the live loop's bank): not after the reveal, and
// not after a discussion without one either, since a discussed question is no
// longer a student's own work.
//
// Nor does a phone get the bank question's id with a class question: its
// question is named by the class question's id (phoneQuestion). Sent to every
// phone, the bank id was one to send back as the phone's own answer, here or in
// another open room on the same chapter that still serves the question, and be
// marked on, key and all, before the reveal. And no row kept with a class
// question (a vote, or an answer sent as a phone's own) is ever answered back
// through student:answer (sockets/index.js handleAnswer): its stored mark, sent
// again, told a phone the key one option at a time.

import { LABEL as LEVEL_LABEL } from '../bloom.js';
import { LABEL as KIND_LABEL, forStudent, isUngraded, score } from '../questionTypes.js';
import { CONFIDENCE, CONFIDENCE_CHOICES, CONFIDENCE_NOTE, confidenceCounts, confidenceOf } from './confidence.js';
import { allAnswers } from './evidence.js';
import { SOURCE_LABEL, phoneProvenance, sourceOf } from './honesty.js';
// Phase 6 (decision H15): formulas and code as HTML, an additive field.
import { phoneRichSync } from './richText.js';
import { figureForStudent } from '../figures/index.js';

const fail = (message, status) => Object.assign(new Error(message), { status });

/** The kinds a class question may be: those whose options every phone can vote on. */
export const CLASS_KINDS = Object.freeze(['mcq', 'truefalse', 'poll', 'multi']);

export const CLASS_STATES = Object.freeze(['open', 'paused', 'revote', 'closed']);

/**
 * The fewest votes in a round before the projector shows that round's counts.
 * Under it the counts could be a few students' own votes, and the wall is the
 * one screen the whole class reads (the same rule as the progress screen's
 * MIN_ANSWERED_FOR_LEVELS in services/projector.js).
 */
export const MIN_VOTES_FOR_WALL = 5;

/** Written as `detail` on a vote that arrived after its round closed: kept, never counted. */
export const LATE_DETAIL = 'Arrived after this round closed: kept, not counted.';

/**
 * Written as `detail` on an answer a phone sent to this question as its OWN
 * question (student:answer) after the question was put to the class: the
 * question had been served to it adaptively before. Kept with the class
 * question, never counted: by then it may have been discussed, or its key
 * shown, so it is not the student's own work at a level.
 */
export const OWN_QUESTION_DETAIL = 'Sent as the student\'s own question after it was put to the class: kept, not counted.';

/**
 * Written as `detail` on a vote for a round that had not opened (round 2 sent
 * while round 1 is open, or after a close with no re-vote). Kept, never counted:
 * it is no vote in any round there was, and "arrived after this round closed"
 * would be untrue of it.
 */
export const EARLY_DETAIL = 'Sent for a round that had not opened: kept, not counted.';

/**
 * Written as `detail` on a vote sent while the professor had paused the room.
 * Kept, never counted, as an answer sent then is refused: the pause holds the
 * class question too, and the phone votes again once the room carries on.
 */
export const PAUSED_DETAIL = 'Sent while the room was paused: kept, not counted.';

/**
 * Written as `detail` on a vote from a phone not signed in as the student, under
 * a roll number whose vote in that round came from a phone signed in as them
 * (decision 7). Rooms stay account-free, so such a phone votes like any other
 * until then; but a typed roll number proves nothing about who holds the
 * phone, and its vote must not replace the signed-in student's own.
 */
export const UNVERIFIED_DETAIL = 'Sent from a phone not signed in as the student, after their signed-in phone voted in '
  + 'this round: kept, not counted.';

/** Rows kept with a class question that no count reads. */
const NOT_COUNTED = [LATE_DETAIL, OWN_QUESTION_DETAIL, EARLY_DETAIL, PAUSED_DETAIL, UNVERIFIED_DETAIL];

/** What a phone is told about its vote that was kept and not counted, by why. */
const NOT_COUNTED_MESSAGE = {
  [LATE_DETAIL]: 'Voting had closed for that round, so this vote was kept but not counted.',
  [OWN_QUESTION_DETAIL]: 'Voting had closed for that round, so this vote was kept but not counted.',
  [EARLY_DETAIL]: 'That round of voting had not opened, so this vote was kept but not counted.',
  [PAUSED_DETAIL]: 'Your professor has paused the room, so this vote was kept but not counted. Vote again when the room '
    + 'carries on.',
  [UNVERIFIED_DETAIL]: 'A phone signed in as this roll number\'s student has voted in this round, so this vote, from a '
    + 'phone that is not signed in, was kept but not counted.',
};

/**
 * The lock every change to a room's class questions takes (lockProfile in
 * sockets/index.js), and that a room delete waits out. '#' is outside
 * ROLL_SHAPE, so it is never a student's own lock.
 */
export const CLASS_LOCK = '#class';

/** Said with every staff read of a class question. */
export const CLASS_NOTE = 'Counts only: no student is named. A class question moves no student\'s level: it was not chosen '
  + 'for any one student\'s level, and its re-vote follows the class\'s discussion. In attainment its first round counts as '
  + 'a digital answer when its question is mapped to an outcome; the re-vote is shown under its own label and never counted. '
  + 'Once asked, the question is not served to any phone on its own in this room again.';

const PHONE_MESSAGE = {
  open: 'Your professor has put this question to the whole class. Choose your answer and say how sure you are.',
  paused: 'Voting is paused. Talk it over with the people around you.',
  revote: 'Vote again, now that you have talked it over. You can keep your answer or change it.',
};

/* ------------------------------------------------------------ the rounds -- */

/** The round a state takes votes in, or null when it takes none. */
export const votingRound = (state) => (state === 'open' ? 1 : state === 'revote' ? 2 : null);

/** The round a class question is in, or ended in. */
export const roundOf = (cq) => (cq?.revoteAt || cq?.state === 'revote' ? 2 : 1);

/** Has this round closed? Round 1 closes at the pause (or the close); round 2 at the close. */
export function roundClosed(cq, round) {
  if (round === 1) return cq?.state !== 'open';
  return cq?.state === 'closed' && Boolean(cq?.revoteAt);
}

const ACTIONS = {
  pause: {
    from: ['open'],
    refused: {
      paused: 'Voting on this question is already paused.',
      revote: 'This is the re-vote: close it once the class has voted.',
      closed: 'That class question is closed.',
    },
  },
  revote: {
    from: ['paused'],
    refused: {
      open: 'Pause the first vote before opening the re-vote, so the class can discuss it.',
      revote: 'The re-vote is already open.',
      closed: 'That class question is closed.',
    },
  },
  close: {
    from: ['open', 'paused', 'revote'],
    refused: { closed: 'That class question is already closed.' },
  },
};

/**
 * The change one of the professor's actions makes, as a patch for the store, or
 * an honest 409 (400 for a reveal that cannot be). `reveal` is for `close` only:
 * a poll has no key to reveal.
 */
export function transition(cq, action, { at = new Date().toISOString(), by = null, reveal = false } = {}) {
  const rule = ACTIONS[action];
  if (!rule) throw fail(`Unknown action ${action}.`, 400);
  if (!rule.from.includes(cq.state)) throw fail(rule.refused[cq.state] ?? 'That cannot be done to this class question now.', 409);
  if (action === 'pause') return { state: 'paused', pausedAt: at };
  if (action === 'revote') return { state: 'revote', revoteAt: at };
  if (reveal && isUngraded(kindOf(cq))) {
    throw fail('A poll has no right answer to reveal. Close it without revealing.', 400);
  }
  return { state: 'closed', closedAt: at, closedBy: by, revealed: reveal === true };
}

/* ----------------------------------------------------------- the question -- */

const snapOf = (cq) => (cq?.questionSnapshot && typeof cq.questionSnapshot === 'object' ? cq.questionSnapshot : {});
const kindOf = (cq) => snapOf(cq).kind ?? 'mcq';
const letter = (i) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[i] ?? String(i + 1);

/** The question as it was asked, in the shape forStudent() and score() take. */
export const asQuestion = (cq) => ({ ...snapOf(cq), _id: String(cq?.questionId ?? snapOf(cq).id ?? '') });

/** The seed every phone is served a class question with: one board for the whole class. */
const seedOf = (cq) => `class:${cq?._id}`;

/** The options as the class discusses them: a letter and a label each. True or false is A and B. */
export function optionsOf(snapshot = {}) {
  if ((snapshot.kind ?? 'mcq') === 'truefalse') return [{ key: 'A', label: 'True' }, { key: 'B', label: 'False' }];
  return (Array.isArray(snapshot.options) ? snapshot.options : []).map((label, i) => ({ key: letter(i), label: String(label ?? '') }));
}

/**
 * Which options a response picked, as positions in optionsOf, each once and in
 * order; [] for one that picks nothing that exists. Read the way score() reads
 * it, so a vote is counted on the option it was marked on.
 */
export function pickedOf(snapshot = {}, response = null) {
  const kind = snapshot.kind ?? 'mcq';
  const n = optionsOf(snapshot).length;
  const inRange = (i) => Number.isInteger(i) && i >= 0 && i < n;
  if (kind === 'truefalse') return typeof response === 'boolean' ? [response ? 0 : 1] : [];
  if (kind === 'multi') {
    const sent = (Array.isArray(response) ? response : []).map(Number).filter(inRange);
    return [...new Set(sent)].sort((a, b) => a - b);
  }
  const i = Number(response);
  return inRange(i) ? [i] : [];
}

/** The key as positions in optionsOf, or null for a poll. Staff-only, and the phone's only once revealed. */
export function keyOf(snapshot = {}) {
  const kind = snapshot.kind ?? 'mcq';
  if (kind === 'mcq') return Number.isInteger(Number(snapshot.answerIdx)) ? [Number(snapshot.answerIdx)] : [];
  if (kind === 'truefalse') return typeof snapshot.answerBool === 'boolean' ? [snapshot.answerBool ? 0 : 1] : [];
  if (kind === 'multi') return [...new Set((snapshot.answerIdxs ?? []).map(Number))].sort((a, b) => a - b);
  return null;
}

const keyLetters = (snapshot) => keyOf(snapshot)?.map(letter) ?? null;

/** A stimulus as a screen shows it: the picture or the passage, built field by field. */
function stimulusView(s) {
  if (!s || typeof s !== 'object') return null;
  if (s.kind === 'image') return { kind: 'image', url: String(s.url ?? ''), alt: String(s.alt ?? '') };
  if (s.kind === 'passage') return { kind: 'passage', text: String(s.text ?? '') };
  // A figure (Batch 8): already drawn when it comes through forStudent(), drawn
  // here from its spec when it comes from a stored snapshot. Either way only the
  // drawing, its description and its table.
  if (s.kind === 'figure') {
    const f = 'svg' in s ? s : figureForStudent(s.spec);
    return { kind: 'figure', type: f.type ?? null, title: f.title ?? '', svg: f.svg ?? null, description: f.description ?? '', table: f.table ?? null };
  }
  return null;
}

/* ---------------------------------------------------------------- votes -- */

const later = (a, b) => String(a.answeredAt ?? '').localeCompare(String(b.answeredAt ?? ''))
  || String(a._id ?? '').localeCompare(String(b._id ?? ''));

/** Each student's vote in force in one round: their latest counted vote. roll number -> row. */
export function votesInForce(rows = [], round = 1) {
  const out = new Map();
  for (const a of rows) {
    if (Number(a?.round) !== round || a.final === false) continue;
    const roll = String(a.rollNo);
    const held = out.get(roll);
    if (!held || later(a, held) > 0) out.set(roll, a);
  }
  return out;
}

const shareDown = (part, whole) => (whole ? Math.floor((part * 10000) / whole) / 10000 : null);

/** How many votes each option got. A multi vote counts once on every option it ticked. */
export function distribution(snapshot = {}, votes = []) {
  const options = optionsOf(snapshot).map((o) => ({ ...o, votes: 0 }));
  let unreadable = 0;
  for (const v of votes) {
    const picked = pickedOf(snapshot, v.response);
    if (!picked.length) unreadable += 1;
    for (const i of picked) options[i].votes += 1;
  }
  return { options, unreadable };
}

/** How many of these votes were right, of how many, and the share (rounded down). Null for a poll. */
function rightOf(snapshot, votes) {
  if (isUngraded(snapshot.kind ?? 'mcq')) return null;
  const n = votes.filter((v) => v.correct === true).length;
  return { students: n, of: votes.length, share: shareDown(n, votes.length) };
}

/** Confidence taps alone, as the wall shows them: how many of each, never with right or wrong. */
function tapsOnly(votes) {
  const out = Object.fromEntries([...CONFIDENCE, 'none'].map((k) => [k, 0]));
  for (const v of votes) out[confidenceOf(v) ?? 'none'] += 1;
  return out;
}

/**
 * One round for staff: how many voted, how many changed their vote, and how
 * many answers were kept but not counted (a vote that arrived after the round
 * closed, or an answer a phone sent to this question as its own afterwards);
 * and, once the round has closed, the distribution, the share right and the
 * confidence taps by right and wrong. While a round is open the professor sees
 * only how many have voted: the distribution comes with the pause, so the votes
 * are the class's own. Null for a round not yet opened.
 */
export function roundView(cq, rows = [], round = 1) {
  if (round === 2 && !cq?.revoteAt) return null;
  const snapshot = snapOf(cq);
  const mine = rows.filter((a) => Number(a?.round) === round);
  const notCounted = mine.filter((a) => a.final === false && NOT_COUNTED.includes(a.detail)).length;
  const votes = [...votesInForce(rows, round).values()];
  const base = {
    round,
    open: votingRound(cq.state) === round,
    voted: votes.length,
    changedVotes: mine.filter((a) => a.final === false).length - notCounted,
    notCounted,
  };
  if (!roundClosed(cq, round)) return { ...base, distribution: null, right: null, confidence: null };
  return {
    ...base,
    distribution: distribution(snapshot, votes),
    right: rightOf(snapshot, votes),
    confidence: confidenceCounts(votes),
  };
}

const sameVote = (snapshot, a, b) => JSON.stringify(pickedOf(snapshot, a.response)) === JSON.stringify(pickedOf(snapshot, b.response));

/**
 * The class-level changes from round 1 to round 2, once round 2 has closed;
 * null before. Counts only. `both` students voted in both rounds; of them, for a
 * question with a key: wrong to right, right to wrong, right both times, wrong
 * both times on the same answer, and wrong both times on a different answer.
 * For a poll, which has no right answer: kept and changed. `onlyBefore` and
 * `onlyAfter` voted in one round only (a phone that missed round 1 may vote in
 * round 2).
 */
export function changesView(cq, rows = []) {
  if (!roundClosed(cq, 2)) return null;
  const snapshot = snapOf(cq);
  const before = votesInForce(rows, 1);
  const after = votesInForce(rows, 2);
  const both = [...before.keys()].filter((roll) => after.has(roll));
  const out = { both: both.length, onlyBefore: before.size - both.length, onlyAfter: after.size - both.length };
  if (isUngraded(snapshot.kind ?? 'mcq')) {
    const kept = both.filter((roll) => sameVote(snapshot, before.get(roll), after.get(roll))).length;
    return { ...out, kept, changed: both.length - kept };
  }
  const counts = { wrongToRight: 0, rightToWrong: 0, rightToRight: 0, wrongToSameWrong: 0, wrongToOtherWrong: 0 };
  for (const roll of both) {
    const a = before.get(roll);
    const b = after.get(roll);
    const wasRight = a.correct === true;
    const isRight = b.correct === true;
    if (!wasRight && isRight) counts.wrongToRight += 1;
    else if (wasRight && !isRight) counts.rightToWrong += 1;
    else if (wasRight) counts.rightToRight += 1;
    else if (sameVote(snapshot, a, b)) counts.wrongToSameWrong += 1;
    else counts.wrongToOtherWrong += 1;
  }
  return { ...out, ...counts };
}

/* ------------------------------------------------------------- the views -- */

/**
 * A class question as the professor's screens get it (GET, and teacher:class-
 * question): the question with its key, where it stands, each round, and the
 * changes. `phones` is how many joined the room and how many are online now,
 * and `answeredAlone` how many answered this question on their own in this
 * room before it was put to the class (answeredAloneOf): each was shown its
 * answer then, so the professor is told, in a count and a sentence.
 */
export function classQuestionView(cq, rows = [], { joined = 0, online = 0, answeredAlone = 0 } = {}) {
  const snapshot = snapOf(cq);
  const kind = kindOf(cq);
  return {
    id: String(cq._id),
    seq: cq.seq,
    questionId: cq.questionId ?? null,
    state: cq.state,
    round: roundOf(cq),
    voting: votingRound(cq.state) !== null,
    revealed: cq.revealed === true,
    startedAt: cq.startedAt ?? null,
    startedBy: cq.startedBy ?? null,
    pausedAt: cq.pausedAt ?? null,
    revoteAt: cq.revoteAt ?? null,
    closedAt: cq.closedAt ?? null,
    closedBy: cq.closedBy ?? null,
    question: {
      text: String(snapshot.text ?? ''),
      kind,
      kindLabel: KIND_LABEL[kind] ?? kind,
      level: snapshot.bloom ?? null,
      levelLabel: LEVEL_LABEL[snapshot.bloom] ?? null,
      topic: snapshot.topic ?? '',
      source: snapshot.source ?? 'llm',
      // Who wrote it, as the bank labels it (Phase 5). Not the approval: the
      // snapshot keeps none, and only a question the room serves can be asked.
      sourceLabel: SOURCE_LABEL[sourceOf(snapshot)],
      options: optionsOf(snapshot),
      // The professor's own screen: the key is always theirs to see.
      correct: keyLetters(snapshot),
      stimulus: stimulusView(snapshot.stimulus),
    },
    phones: { joined, online, answeredAlone },
    ...(answeredAlone ? { answeredAloneNote: answeredAloneNote(answeredAlone) } : {}),
    rounds: [roundView(cq, rows, 1), roundView(cq, rows, 2)].filter(Boolean),
    changes: changesView(cq, rows),
    confidenceChoices: CONFIDENCE_CHOICES,
    confidenceNote: CONFIDENCE_NOTE,
    note: CLASS_NOTE,
  };
}

/** Said to the professor when phones in the room had answered the question on their own first. */
export function answeredAloneNote(n) {
  return n === 1
    ? 'One phone in this room answered this question on its own before you put it to the class, and was shown its '
      + 'answer then. Its vote is not counted in attainment; close the question if that matters to the discussion.'
    : `${n} phones in this room answered this question on their own before you put it to the class, and were shown its `
      + 'answer then. Their votes are not counted in attainment; close the question if that matters to the discussion.';
}

/**
 * How many students in the room gave a final answer of their own (not a vote)
 * to this class question's bank question: each was sent its key with their
 * result. Polls have no key, so none. Counts roll numbers, never names them.
 *
 * The question is matched by its bank id, or by the id its snapshot keeps when
 * the bank id is gone (Phase 7): a question deleted from the bank since, or a
 * room imported from laptop mode, whose questions were never in this bank.
 */
export function answeredAloneOf(cq, ownFinal = []) {
  if (isUngraded(kindOf(cq))) return 0;
  const idOf = (row) => String(row?.questionId ?? row?.questionSnapshot?.id ?? '').toLowerCase();
  const id = idOf(cq);
  if (!id) return 0;
  return new Set(ownFinal
    .filter((a) => !a.classQuestionId && a.final !== false && idOf(a) === id)
    .map((a) => String(a.rollNo))).size;
}

/**
 * class:question, to a phone: the question as forStudent() gives it (no key),
 * its options as letters for the class to discuss, where it stands and whether
 * it takes a vote now. `mine` is this phone's own vote in force in the current
 * round ({ response, confidence }), sent when a phone joins or reconnects
 * mid-question; null otherwise. Never a count, a distribution or a classmate.
 */
export function phoneQuestion(cq, { mine = null } = {}) {
  const shown = forStudent(asQuestion(cq), seedOf(cq), null);
  return {
    id: String(cq._id),
    seq: cq.seq,
    round: roundOf(cq),
    state: cq.state,
    voting: votingRound(cq.state) !== null,
    // Who wrote it, in a student's words (Phase 5). From the question as
    // asked: its snapshot keeps the source and model but not the approval, so
    // an AI question reads "chosen by your professor", which putting it to the
    // class is. Named by the class question's id, never the bank question's
    // (KEY SAFETY above): a phone votes by the class question's id anyway.
    // `rich` (Phase 6, H15): HTML for the fields of `shown` holding a formula
    // or a code block, {} otherwise; built synchronously, so a code block is
    // highlighted once the highlighter has loaded (services/richText.js).
    question: { ...shown, _id: String(cq._id), provenance: phoneProvenance(snapOf(cq)), rich: phoneRichSync(shown) },
    options: optionsOf(snapOf(cq)),
    confidence: CONFIDENCE_CHOICES,
    mine,
    message: PHONE_MESSAGE[cq.state] ?? '',
  };
}

/**
 * class:closed, to a phone: the class question is over and the phone goes back
 * to its own question. The key only when the professor revealed it: `answer`
 * in the same terms a response takes (an option's position, true or false, or
 * the positions to tick), and `correct` as letters.
 */
export function phoneClosed(cq) {
  const revealed = cq.revealed === true;
  return {
    id: String(cq._id),
    revealed,
    answer: revealed ? score(asQuestion(cq), null, seedOf(cq), null).solution : null,
    correct: revealed ? keyLetters(snapOf(cq)) : null,
    message: revealed
      ? 'Voting is closed, and the answer is shown. Back to your own questions now.'
      : 'Voting is closed. Back to your own questions now.',
  };
}

/**
 * A vote as its phone gets it back: what it sent, never whether it was right.
 * A vote not counted came after its round closed, for a round not yet open,
 * while the room was paused, or from a phone not signed in after the signed-in
 * one voted (each says which); or, sent again, was replaced since by a later
 * vote of the same phone.
 */
export function phoneVote(cq, row, { counted }) {
  let message = 'Vote saved. You can change it until your professor closes the vote.';
  if (!counted) {
    message = NOT_COUNTED_MESSAGE[row.detail]
      ?? 'You changed this vote afterwards: your latest vote is the one that counts.';
  }
  return {
    id: String(cq._id),
    round: Number(row.round),
    counted,
    mine: { response: row.response ?? null, confidence: confidenceOf(row) },
    message,
  };
}

/** A phone's own vote in force in the round it would vote in now (or last voted in), or null. */
export function mineNow(cq, rows = [], rollNo) {
  const v = votesInForce(rows.filter((a) => String(a.rollNo) === String(rollNo)), roundOf(cq)).get(String(rollNo));
  return v ? { response: v.response ?? null, confidence: confidenceOf(v) } : null;
}

/**
 * The class question for the projector (services/projector.js passes it through
 * its whitelist). The question and its options; how many have voted in the
 * current round, a count; and, only when the professor chose to show counts
 * (`showCounts`), each closed round's votes per option and confidence taps,
 * once at least MIN_VOTES_FOR_WALL voted in it. Never a name. The key, the
 * share right and the changes only once the key is revealed (a poll's changes,
 * which tell no key, once round 2 has closed).
 */
export function wallQuestion(cq, rows = [], { showCounts = false } = {}) {
  const snapshot = snapOf(cq);
  const seen = forStudent(asQuestion(cq), seedOf(cq), null);
  const revealed = cq.revealed === true;
  const graded = !isUngraded(kindOf(cq));
  const roundCounts = (round) => {
    if (!roundClosed(cq, round)) return null;
    const votes = [...votesInForce(rows, round).values()];
    if (votes.length < MIN_VOTES_FOR_WALL) return null;
    const right = revealed && graded ? rightOf(snapshot, votes) : null;
    return {
      voted: votes.length,
      options: distribution(snapshot, votes).options.map((o) => ({ key: o.key, votes: o.votes })),
      correct: right ? { students: right.students, share: right.share } : null,
      confidence: tapsOnly(votes),
    };
  };
  let changes = null;
  if (showCounts && (revealed || !graded)) {
    const c = changesView(cq, rows);
    if (c && c.both >= MIN_VOTES_FOR_WALL) changes = c;
  }
  return {
    source: 'class',
    text: String(seen.text ?? ''),
    kind: seen.kind,
    options: optionsOf(snapshot),
    stimulus: stimulusView(seen.stimulus),
    revealed,
    correct: revealed ? keyLetters(snapshot) : null,
    round: roundOf(cq),
    state: cq.state,
    voted: votesInForce(rows, roundOf(cq)).size,
    counts: showCounts
      ? { minVotes: MIN_VOTES_FOR_WALL, before: roundCounts(1), after: roundCounts(2), changes }
      : null,
  };
}

/* --------------------------------------------------------- starting one -- */

/**
 * Whether this question may be asked to the class now, or an honest refusal.
 * `room` is the room as stored now; `servable` what it may serve
 * (servableFor); `asked` its class questions so far. Only in a room where
 * phones answer, while it is open; one at a time; only an approved question of
 * the room; one whose options every phone can vote on; and never one already
 * asked to the class in this room.
 */
export function startable({ room, settings, question, servable = [], asked = [] }) {
  if (room.status === 'closed') throw fail('That room is closed, so it cannot take a class question.', 409);
  if (room.status === 'waiting') throw fail('That room has not started yet. Start it first, then ask the class.', 409);
  if (room.status === 'paused') throw fail('That room is paused. Resume it first, then ask the class.', 409);
  if (settings.mode === 'teacher-led') {
    throw fail('This room is Teacher-led, so no phone answers in it and a class question would have nobody to vote. '
      + 'Ask it aloud and count the hands instead.', 409);
  }
  if (asked.some((c) => c.state !== 'closed')) {
    throw fail('Another class question is still running in this room. Close it first.', 409);
  }
  const id = String(question?._id ?? '').toLowerCase();
  const q = question ? servable.find((x) => String(x._id).toLowerCase() === id) : null;
  if (!q) {
    throw fail('That question is not one this room may serve: pick an approved question of the room\'s own chapter '
      + '(and of its question set, when it has one).', 400);
  }
  const kind = q.kind ?? 'mcq';
  if (!CLASS_KINDS.includes(kind)) {
    throw fail(`A class question needs options every phone can vote on: choose one, true or false, have your say, or `
      + `choose all that apply. This question is "${KIND_LABEL[kind] ?? kind}", so serve it to phones one at a time or ask `
      + 'it aloud instead.', 400);
  }
  if (askedQuestionIds(asked).has(id)) {
    throw fail('That question has already been asked to the class in this room. Pick another one.', 409);
  }
  return q;
}

/* ---------------------------------------------------------------- reads -- */

/** The ids of the bank questions asked to the class in a room, lower case: never served adaptively there again. */
export const askedQuestionIds = (classQuestions = []) => new Set(classQuestions
  .map((c) => String(c.questionId ?? c.questionSnapshot?.id ?? '').toLowerCase()).filter(Boolean));

/** A room's bank without the questions it has asked to the class. */
export function withoutAsked(bank = [], classQuestions = []) {
  const asked = askedQuestionIds(classQuestions);
  return asked.size ? bank.filter((q) => !asked.has(String(q._id).toLowerCase())) : bank;
}

/** The class question running in a room (any state but closed), or null. */
export const runningOf = (classQuestions = []) => classQuestions.find((c) => c.state !== 'closed') ?? null;

/** Every vote of one class question, oldest first, all rounds, changed and late ones included. */
export const votesOf = (repo, cq) => allAnswers(repo, { sessionId: cq.sessionId, classQuestionId: String(cq._id) });

/** The staff body for one class question, read from the store. `isOnline(code, rollNo)` is the live loop's. */
export async function classQuestionBody(repo, session, cq, { isOnline = () => false } = {}) {
  const snapshot = snapOf(cq);
  const [rows, profiles, own] = await Promise.all([
    votesOf(repo, cq),
    repo.listProfiles(session._id),
    // The students' own final answers at the question's topic and level, the
    // narrowest read the store offers; answeredAloneOf picks the question's.
    isUngraded(kindOf(cq)) ? [] : allAnswers(repo, {
      sessionId: session._id, final: true, classVotes: false, topic: snapshot.topic ?? '', bloom: snapshot.bloom,
    }),
  ]);
  return classQuestionView(cq, rows, {
    joined: profiles.length,
    online: profiles.filter((p) => isOnline(session.code, p.rollNo)).length,
    answeredAlone: answeredAloneOf(cq, own),
  });
}
