// The classroom projector (Phase 3, 0018): a read-only screen for the wall.
//
// The projector is often a second machine with nobody signed in on it, so it
// does not use the professor's credentials. The professor makes a projector
// link for one room (routes/projector.js); its token is random, handed over once
// and kept only as a SHA-256 (projector_links.token_hash), and works while the
// room is not closed, the link is not revoked and it is less than
// PROJECTOR_LINK_HOURS old. The projector connects with it over the socket
// (projector:watch) and is sent projector:* events and nothing else.
//
// What a wall may show is a short list, and the list is the whole design:
//
//   question  the projected question's text and options, and its key only once
//             the professor reveals it. A question of the room's set, or a
//             question asked aloud (a tally). A bank question's key is revealed
//             only in a Teacher-led room: anywhere else a phone may still be
//             served that question (screenChangeFrom).
//   diagram   a stimulus (an image or a passage) of one of the room's questions.
//   progress  how many are present and have answered, and how many answers the
//             class has given at each Bloom level once at least
//             MIN_ANSWERED_FOR_LEVELS students have answered. Counts, never a
//             person: under that, the counts would be one student's own.
//   pick      the wheel's latest pick: roll number and first name, or the roll
//             number alone with the names toggle off.
//   class     a class question (Phase 5, services/classQuestions.js) on the
//             question screen: its text and options, how many have voted, and,
//             only when the professor chooses to show counts, each closed
//             round's votes per option and confidence taps once at least
//             MIN_VOTES_FOR_WALL voted in it. The key, the share right and the
//             changes from round 1 to round 2 only once the professor revealed
//             the key as the question closed.
//
// Never a name beyond the pick's first name, never a score, accuracy, band,
// observation or any teacher record, and no answer key before the reveal. Every
// payload is built field by field and then passed through toProjector(), which
// drops anything its whitelist (PROJECTOR_FIELDS) does not name, so a field
// added to a builder by mistake still cannot reach the wall.
//
// What the screen shows is kept in this process's memory, like the live loop's
// presence map: one server process owns every socket. After a restart the
// projector shows an empty question screen until the professor picks again,
// with first names off for any room opened before the restart (screenOf); the
// links themselves are in the store and keep working.

import crypto from 'node:crypto';

import { LEVELS, LABEL } from '../bloom.js';
import { forStudent } from '../questionTypes.js';
import { hydrate, sessionSettings } from './mastery.js';
import { servableFor } from './selector.js';
import { presentCount as rosterPresent } from './roster.js';
import { OPTION_KEYS, roomPeople } from './records.js';
import { pickForProjector } from './wheel.js';
import { MIN_VOTES_FOR_WALL, votesOf, wallQuestion } from './classQuestions.js';
import { figureAtStep, stepCount } from '../figures/index.js';

const fail = (message, status) => Object.assign(new Error(message), { status });

// ------------------------------------------------------------------ links --

/** 32 random bytes, base64url: 43 characters, 256 bits. */
export const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;
export const newToken = () => crypto.randomBytes(32).toString('base64url');
/**
 * What the store keeps. A plain SHA-256 is enough: the token is 256 random bits,
 * so there is nothing to guess and nothing a salt would protect.
 */
export const tokenHash = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

/**
 * How long a link works after it is made. A link is made for a class, and one
 * left open on a shared classroom machine would otherwise show the room's wall
 * (picks with first names, questions, revealed keys) to whoever sat down at it
 * for as long as the room stays open, which can be days. Long enough for a
 * teaching day; the professor makes a new link for the next class.
 */
export const PROJECTOR_LINK_HOURS = 12;
const LINK_LIFETIME_MS = PROJECTOR_LINK_HOURS * 60 * 60 * 1000;

/** When a link stops working, as an ISO time, or null when its creation time cannot be read. */
function linkExpiresAt(link) {
  const made = new Date(link?.createdAt ?? NaN).getTime();
  return Number.isFinite(made) ? new Date(made + LINK_LIFETIME_MS).toISOString() : null;
}

/** Past its lifetime. A link whose creation time cannot be read works for nobody. */
export function linkExpired(link, now = new Date()) {
  const ends = linkExpiresAt(link);
  return !ends || Date.parse(ends) <= now.getTime();
}

/** A link as a teacher's screen gets it: never its hash, and the token only once, when it is made. */
export function linkView(link, now = new Date()) {
  return {
    id: String(link._id),
    createdAt: link.createdAt ?? null,
    createdBy: link.createdBy ?? null,
    expiresAt: linkExpiresAt(link),
    revokedAt: link.revokedAt ?? null,
    revokedBy: link.revokedBy ?? null,
    active: !link.revokedAt && !linkExpired(link, now),
  };
}

/**
 * The fewest students who must have answered before the wall shows answers per
 * level. With one phone answering, the counts per level are exactly that
 * student's own (and, over time, which levels they are held to), and the wall
 * is the one screen the whole class reads.
 */
export const MIN_ANSWERED_FOR_LEVELS = 5;

/** Said with every projector read, so the screen that runs it can say what the wall shows. */
export const PROJECTOR_RULE = 'The projector shows the question (its key only once you reveal it, and a bank '
  + 'question\'s key only in a Teacher-led room, where no phone can still be served it), a diagram, counts for the '
  + `class (per level only once ${MIN_ANSWERED_FOR_LEVELS} students have answered), and the wheel's pick as a roll `
  + 'number and first name. Never a score, accuracy, band, observation or any other name. '
  + `A projector link works for ${PROJECTOR_LINK_HOURS} hours from when it is made. A class question shows how many have `
  + 'voted; its votes per option and confidence taps only when you choose to show counts, once a round has closed and '
  + `${MIN_VOTES_FOR_WALL} or more voted in it; and its key, share right and changes only once you reveal the key as it closes.`;

// ------------------------------------------------------------ whitelist --

/**
 * A figure on the wall (Batch 8): the drawing at the step the professor chose,
 * its description and table, and where it is in its steps. Never its spec.
 */
const FIGURE_WALL_FIELDS = ['type', 'title', 'svg', 'description', 'table', 'step', 'stepCount', 'caption'];

/**
 * Every key any projector:* payload may carry, by path. An object's keys are
 * checked against its path's entry; an array's items against `path[]`. Anything
 * else is dropped by toProjector(), and server/scripts/modes.mjs walks every
 * event a projector receives in a whole room run against its own copy of this.
 */
export const PROJECTOR_FIELDS = {
  'projector:state': ['code', 'title', 'status', 'mode', 'roomMode', 'question', 'diagram', 'progress', 'pick'],
  'projector:state.question': ['source', 'text', 'kind', 'options', 'stimulus', 'revealed', 'correct', 'round', 'state', 'voted', 'counts'],
  'projector:state.question.options[]': ['key', 'label'],
  'projector:state.question.stimulus': ['kind', 'url', 'alt', 'text', ...FIGURE_WALL_FIELDS],
  'projector:state.question.stimulus.table': ['caption', 'columns', 'rows'],
  'projector:state.question.correct[]': null,
  // A class question's counts (Phase 5): numbers per option and per tap, never a name.
  'projector:state.question.counts': ['minVotes', 'before', 'after', 'changes'],
  'projector:state.question.counts.before': ['voted', 'options', 'correct', 'confidence'],
  'projector:state.question.counts.before.options[]': ['key', 'votes'],
  'projector:state.question.counts.before.correct': ['students', 'share'],
  'projector:state.question.counts.before.confidence': ['sure', 'think_so', 'guessing', 'none'],
  'projector:state.question.counts.after': ['voted', 'options', 'correct', 'confidence'],
  'projector:state.question.counts.after.options[]': ['key', 'votes'],
  'projector:state.question.counts.after.correct': ['students', 'share'],
  'projector:state.question.counts.after.confidence': ['sure', 'think_so', 'guessing', 'none'],
  'projector:state.question.counts.changes': ['both', 'onlyBefore', 'onlyAfter', 'wrongToRight', 'rightToWrong',
    'rightToRight', 'wrongToSameWrong', 'wrongToOtherWrong', 'kept', 'changed'],
  'projector:state.diagram': ['stimulus'],
  'projector:state.diagram.stimulus': ['kind', 'url', 'alt', 'text', ...FIGURE_WALL_FIELDS],
  'projector:state.diagram.stimulus.table': ['caption', 'columns', 'rows'],
  'projector:state.progress': ['present', 'classSize', 'answered', 'levels', 'minAnswered'],
  'projector:state.progress.levels[]': ['level', 'label', 'answers'],
  'projector:state.pick': ['rollNo', 'firstName'],
  'projector:closed': ['code', 'reason'],
  'projector:refused': ['reason'],
};

/**
 * The payload as the whitelist allows it. Plain values (strings, numbers,
 * booleans, null) pass; an object keeps only the keys its path names; an array
 * keeps its items, each judged at `path[]`. A path the whitelist does not name
 * at all, or names as null, carries no object: only a plain value survives there.
 */
export function toProjector(event, payload, path = event) {
  if (payload === null || ['string', 'number', 'boolean'].includes(typeof payload)) return payload;
  if (Array.isArray(payload)) {
    return payload.map((item) => toProjector(event, item, `${path}[]`)).filter((v) => v !== undefined);
  }
  const allowed = PROJECTOR_FIELDS[path];
  if (typeof payload !== 'object' || !allowed) return undefined;
  const out = {};
  for (const key of allowed) {
    if (!(key in payload)) continue;
    const value = toProjector(event, payload[key], `${path}.${key}`);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** The one way anything reaches a projector. */
export function emitProjector(target, event, payload) {
  target.emit(event, toProjector(event, payload));
}

// ------------------------------------------------------------ the screen --

export const PROJECTOR_MODES = ['question', 'diagram', 'progress'];

/** The handoff's own defaults: the question screen, names on; a class question's counts off until chosen. */
const DEFAULT_SCREEN = {
  mode: 'question', question: null, revealed: false, diagram: null, pickId: null, showNames: true, showCounts: false, step: 0,
};

const screens = new Map(); // sessionId -> what the professor has put on the wall

// The screens are in memory, so a restart forgets them. A room opened since
// this process started has never had a screen anywhere else, and gets the
// handoff's default. A room opened before it may have had first names turned
// off, and guessing "on" would put a name on the wall at the next draw with no
// sign the setting went back: names stay off there until the professor turns
// them on again (GET /:code/projector says which is in force).
const PROCESS_STARTED = Date.now();
function defaultScreen(session) {
  const opened = new Date(session?.startedAt ?? NaN).getTime();
  return Number.isFinite(opened) && opened >= PROCESS_STARTED ? DEFAULT_SCREEN : { ...DEFAULT_SCREEN, showNames: false };
}

export const screenOf = (session) => ({ ...defaultScreen(session), ...(screens.get(String(session._id)) ?? {}) });

/** Forget a room's screen: it closed, or was deleted. */
export const forgetScreen = (sessionId) => screens.delete(String(sessionId));

/** A professor's change, once screenChangeFrom() has checked it against the room. */
export function setScreen(session, screen) {
  screens.set(String(session._id), screen);
}

/** After a wheel draw: the new pick goes up, as the handoff's projector shows it. */
export function showPick(session, pickId) {
  setScreen(session, { ...screenOf(session), pickId: String(pickId) });
}

const sameId = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

/** The on-or-off switches of the screen, as a refusal names them to a professor (never by the field). */
const SWITCHES = {
  revealed: 'Showing the answer on the projector',
  showNames: 'Showing the picked student\'s name',
  showCounts: 'Showing a class question\'s counts',
};

/**
 * A professor's change to the screen, checked against the room, or an honest 400.
 *
 *   mode       question | diagram | progress
 *   question   { questionId } of the room's servable set, { tallyId } of the
 *              room's tallies, { classQuestionId } of the room's class
 *              questions (Phase 5), or null. A new question starts unrevealed.
 *   revealed   true or false: the question's key on the wall. Not for a class
 *              question, whose key goes up only when the professor closes it
 *              with the key revealed.
 *   showCounts true or false: a class question's counts on the wall
 *   diagram    { questionId } of a servable question carrying a stimulus, or null
 *   showNames  true or false: the pick's first name, or its roll number alone
 *   pick       null takes the pick down; { pickId } puts one of the room's up
 *
 * `room` gives what to check against: servable (questions), tallies, picks,
 * classQuestions, and the room's mode. A mode left out is taken as one that serves phones, so a
 * caller that forgets it gets the strict rule below, never the loose one.
 *
 * A bank question's key goes up only in a Teacher-led room (409 otherwise). In
 * any other room a phone that has not answered that question yet may still be
 * served it, and the wall would have shown the class its answer. A question
 * asked aloud from the bank (a tally with a questionId) carries the bank's key,
 * so the same holds; one the professor typed in is no bank question.
 */
export function screenChangeFrom(body = {}, current, {
  servable = [], tallies = [], picks = [], classQuestions = [], mode = 'devices',
} = {}) {
  const next = { ...current };
  let touched = false;
  const bool = (key) => {
    if (typeof body[key] !== 'boolean') throw fail(`${SWITCHES[key]} is either on or off.`, 400);
    next[key] = body[key];
    touched = true;
  };

  if (body.mode !== undefined) {
    if (!PROJECTOR_MODES.includes(body.mode)) {
      throw fail('The projector shows a question, a diagram or the class\'s progress: choose one of those.', 400);
    }
    next.mode = body.mode;
    touched = true;
  }
  if (body.question !== undefined) {
    next.question = questionRef(body.question, { servable, tallies, classQuestions });
    next.revealed = false;
    touched = true;
  }
  if (body.revealed !== undefined) {
    if (next.question?.source === 'class' && body.revealed === true) {
      throw fail('A class question\'s key goes on the wall when you close it with the key revealed, not before.', 400);
    }
    bool('revealed');
  }
  if (body.diagram !== undefined) {
    if (body.diagram === null) next.diagram = null;
    else {
      const q = servable.find((x) => sameId(x._id, body.diagram?.questionId));
      if (!q) {
        throw fail('That question is not one this room serves, so its diagram cannot be shown: pick one of its approved questions.', 400);
      }
      if (!q.stimulus) throw fail('That question has no diagram or passage to show: pick one that carries a stimulus.', 400);
      next.diagram = { questionId: String(q._id) };
    }
    touched = true;
  }
  // A new question or diagram starts at its figure's first picture (Batch 8).
  if (body.question !== undefined || body.diagram !== undefined || body.mode !== undefined) next.step = 0;
  if (body.step !== undefined) {
    const steps = stepCount(steppedFigureOn(next, servable));
    if (!steps) {
      throw fail('What the projector shows has no steps to move through: show a question or diagram whose figure has steps.', 400);
    }
    if (!Number.isInteger(body.step) || body.step < 0 || body.step > steps) {
      throw fail(`This figure has ${steps} step${steps === 1 ? '' : 's'}: choose one from 0 (the figure itself) to ${steps}.`, 400);
    }
    next.step = body.step;
    touched = true;
  }
  if (body.showNames !== undefined) bool('showNames');
  if (body.showCounts !== undefined) bool('showCounts');
  if (body.pick !== undefined) {
    if (body.pick === null) next.pickId = null;
    else {
      const p = picks.find((x) => sameId(x._id, body.pick?.pickId));
      if (!p) throw fail('That pick is not one of this room\'s wheel.', 400);
      next.pickId = String(p._id);
    }
    touched = true;
  }
  if (!touched) {
    throw fail('Nothing was changed: choose what the projector shows, or switch the answer, names or counts on or off.', 400);
  }
  if (next.revealed && next.question && mode !== 'teacher-led' && keyStillServable(next.question, tallies)) {
    throw fail('That key cannot go on the wall: this room\'s phones may still be served this question, and a phone '
      + 'that has not answered it yet would have been shown its answer. A bank question\'s key is revealed on the '
      + 'projector only in a Teacher-led room; nothing was changed.', 409);
  }
  return next;
}

/**
 * The figure spec the screen's step moves (Batch 8, gap P1): the diagram's in
 * diagram mode, the bank question's in question mode. Null when neither shows a
 * figure.
 */
function steppedFigureOn(screen, servable) {
  const id = screen.mode === 'diagram' ? screen.diagram?.questionId
    : screen.mode === 'question' && screen.question?.source === 'bank' ? screen.question.id : null;
  const q = id ? servable.find((x) => sameId(x._id, id)) : null;
  return q?.stimulus?.kind === 'figure' ? q.stimulus.spec : null;
}

/** Is the key of the question on the screen one of the bank's? A tally that cannot be found is treated as if it were. */
function keyStillServable(question, tallies) {
  if (question.source === 'bank' || question.source === 'class') return true;
  const t = tallies.find((x) => sameId(x._id, question.id));
  return !t || Boolean(t.questionId);
}

function questionRef(raw, { servable, tallies, classQuestions = [] }) {
  if (raw === null) return null;
  const named = ['questionId', 'tallyId', 'classQuestionId'].filter((k) => raw?.[k] !== undefined);
  if (named.length > 1) {
    throw fail('Choose one thing to show: a question of the room, a question asked aloud or a class question.', 400);
  }
  if (raw?.classQuestionId !== undefined) {
    const c = classQuestions.find((x) => sameId(x._id, raw.classQuestionId));
    if (!c) throw fail('That class question was not asked in this room: choose one that was.', 400);
    return { source: 'class', id: String(c._id) };
  }
  if (raw?.questionId !== undefined) {
    const q = servable.find((x) => sameId(x._id, raw.questionId));
    if (!q) throw fail('That question is not one this room serves: pick one of its approved questions.', 400);
    return { source: 'bank', id: String(q._id) };
  }
  if (raw?.tallyId !== undefined) {
    const t = tallies.find((x) => sameId(x._id, raw.tallyId));
    if (!t) throw fail('That question was not asked aloud in this room: choose one that was.', 400);
    return { source: 'tally', id: String(t._id) };
  }
  throw fail('Choose what the question screen shows: a question of the room, a question asked aloud, a class question, '
    + 'or nothing.', 400);
}

/** The professor's screen state as their own screen gets it (ids, not content). */
export function screenView(screen) {
  return {
    mode: screen.mode,
    question: screen.question ? { source: screen.question.source, id: screen.question.id } : null,
    revealed: screen.revealed === true,
    diagram: screen.diagram ? { questionId: screen.diagram.questionId } : null,
    pickId: screen.pickId ?? null,
    showNames: screen.showNames !== false,
    showCounts: screen.showCounts === true,
    // The figure's step on the wall (Batch 8): 0 is the figure itself.
    step: Number.isInteger(screen.step) ? screen.step : 0,
  };
}

// --------------------------------------------------------- the payload --

const letter = (i) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[i] ?? String(i + 1);

/**
 * A stimulus as a wall may show it: the picture or the passage, nothing a
 * professor keeps beside it. A figure is drawn at the screen's step.
 */
function stimulusForWall(s, step = 0) {
  if (!s || typeof s !== 'object') return null;
  if (s.kind === 'figure') return figureAtStep(s.spec, step);
  if (s.kind === 'image') return { kind: 'image', url: String(s.url ?? ''), alt: String(s.alt ?? '') };
  if (s.kind === 'passage') return { kind: 'passage', text: String(s.text ?? '') };
  return null;
}

/** The kinds whose figure a phone gets drawn under tokens (questionTypes.js forStudent). */
const TOKENISED_KINDS = ['hotspot', 'label'];

/** forStudent()'s own copy of a stimulus, as the wall carries it: a figure as drawn, at no step. */
function tokenisedForWall(s) {
  if (s?.kind !== 'figure') return stimulusForWall(s);
  return {
    kind: 'figure', type: s.type ?? null, title: s.title ?? '', svg: s.svg ?? null, description: s.description ?? '',
    table: s.table ?? null, step: 0, stepCount: 0, caption: '',
  };
}

/**
 * A bank question for the wall, through forStudent(), the one place that
 * decides what a student may see, so no answer field is ever in reach. Options
 * are shown for the kinds whose options are a plain list (mcq, multi, poll and
 * true/false); any other kind is shown as its stem, for the class to answer
 * aloud. The key, only once revealed, is the options' letters.
 */
function bankQuestionForWall(q, revealed, step = 0) {
  const seen = forStudent(q, `projector:${q._id}`, null);
  const kind = seen.kind;
  let options = [];
  if (['mcq', 'multi', 'poll'].includes(kind) && Array.isArray(seen.options)) {
    options = seen.options.map((label, i) => ({ key: letter(i), label: String(label ?? '') }));
  } else if (kind === 'truefalse') {
    options = [{ key: 'A', label: 'True' }, { key: 'B', label: 'False' }];
  }
  let correct = null;
  if (revealed) {
    if (kind === 'mcq' && Number.isInteger(q.answerIdx)) correct = [letter(q.answerIdx)];
    else if (kind === 'multi' && Array.isArray(q.answerIdxs)) correct = [...q.answerIdxs].map(Number).sort((a, b) => a - b).map(letter);
    else if (kind === 'truefalse' && typeof q.answerBool === 'boolean') correct = [q.answerBool ? 'A' : 'B'];
  }
  return {
    source: 'bank',
    text: String(seen.text ?? ''),
    kind,
    options,
    // A figure from the stored question, so it can be drawn at the wall's step;
    // a stimulus holds no answer, and forStudent() has already built the rest.
    // Except on a tap or label question before its answer is revealed, where
    // the parts' own names are the answer: the wall then shows the copy
    // forStudent() drew under tokens (dealt for the projector), unstepped,
    // since a step lights a part up by name.
    stimulus: q.stimulus?.kind === 'figure' && (revealed === true || !TOKENISED_KINDS.includes(kind))
      ? stimulusForWall(q.stimulus, step)
      : tokenisedForWall(seen.stimulus),
    revealed: revealed === true,
    correct,
  };
}

/** A question asked aloud (a tally) for the wall: its text and A to D, never its hands. */
function tallyForWall(t, revealed) {
  const correct = Number.isInteger(t.correct) ? t.correct : null;
  return {
    source: 'tally',
    text: String(t.text ?? ''),
    kind: 'mcq',
    options: OPTION_KEYS.map((key, i) => ({ key, label: String(t.labels?.[i] ?? '') })),
    stimulus: null,
    revealed: revealed === true,
    correct: revealed && correct !== null ? [OPTION_KEYS[correct]] : null,
  };
}

/**
 * The class's progress as counts: answers given at each level (graded answers;
 * a poll is at a level only by position), how many students have answered at
 * all, and how many are present. In a class room "present" is attendance
 * (present or late) out of the roster; in a room with no class it is the
 * phones that joined, and there is no class size. Never a person, a score or an
 * accuracy: a wall is the one place a class reads together.
 *
 * The counts per level are null until MIN_ANSWERED_FOR_LEVELS students have
 * answered (`minAnswered` says how many, so the wall can say why it waits).
 */
function progressForWall({ session, profiles, roster, marks }) {
  const answers = Object.fromEntries(LEVELS.map((l) => [l, 0]));
  let answered = 0;
  for (const raw of profiles) {
    const { history } = hydrate(raw);
    if (history.length) answered += 1;
    for (const h of history) if (!h.ungraded && h.bloom in answers) answers[h.bloom] += 1;
  }
  const att = session.classId ? rosterPresent(roster, marks) : null;
  return {
    present: att ? att.present : profiles.length,
    classSize: att ? att.classSize : null,
    answered,
    levels: answered >= MIN_ANSWERED_FOR_LEVELS
      ? LEVELS.map((level) => ({ level, label: LABEL[level], answers: answers[level] }))
      : null,
    minAnswered: MIN_ANSWERED_FOR_LEVELS,
  };
}

/**
 * Everything projector:state carries for this room now, from the store. Reads
 * only what the screen needs. `repo` is getRepo().
 */
export async function projectorPayload(repo, session) {
  const screen = screenOf(session);
  const needsBank = screen.mode === 'diagram' || (screen.mode === 'question' && screen.question?.source === 'bank');
  const needsPeople = screen.mode === 'progress' || Boolean(screen.pickId);
  const onClass = screen.mode === 'question' && screen.question?.source === 'class';
  const [bank, tallies, picks, profiles, roster, marks, cq] = await Promise.all([
    needsBank ? repo.listQuestions(session.contentId).then((qs) => servableFor(session, qs)) : [],
    screen.mode === 'question' && screen.question?.source === 'tally' ? repo.listTallies(session._id) : [],
    screen.pickId ? repo.listWheelPicks(session._id) : [],
    needsPeople ? repo.listProfiles(session._id) : [],
    needsPeople && session.classId ? repo.listClassStudents(session.classId) : [],
    needsPeople && session.classId ? repo.listAttendance(session._id) : [],
    onClass ? repo.getClassQuestion(screen.question.id) : null,
  ]);

  let question = null;
  let diagram = null;
  let progress = null;
  if (screen.mode === 'question' && screen.question) {
    if (screen.question.source === 'bank') {
      // A question discarded since it went up is simply no longer shown.
      const q = bank.find((x) => sameId(x._id, screen.question.id));
      question = q ? bankQuestionForWall(q, screen.revealed, screen.step ?? 0) : null;
    } else if (screen.question.source === 'class') {
      // Only this room's: a class question of another room is never shown.
      question = cq && sameId(cq.sessionId, session._id)
        ? wallQuestion(cq, await votesOf(repo, cq), { showCounts: screen.showCounts === true })
        : null;
    } else {
      const t = tallies.find((x) => sameId(x._id, screen.question.id));
      question = t ? tallyForWall(t, screen.revealed) : null;
    }
  } else if (screen.mode === 'diagram' && screen.diagram) {
    const q = bank.find((x) => sameId(x._id, screen.diagram.questionId));
    const stimulus = q ? stimulusForWall(q.stimulus, screen.step ?? 0) : null;
    diagram = stimulus ? { stimulus } : null;
  } else if (screen.mode === 'progress') {
    progress = progressForWall({ session, profiles, roster, marks });
  }

  let pick = null;
  if (screen.pickId) {
    const p = picks.find((x) => sameId(x._id, screen.pickId));
    if (p) {
      const person = roomPeople({ session, roster, marks, profiles }).find((x) => x.rollNo === p.rollNo);
      pick = pickForProjector(p, person?.name ?? '', { showName: screen.showNames !== false });
    }
  }

  return {
    code: session.code,
    title: session.title ?? '',
    status: session.status,
    mode: screen.mode,
    // How the room runs ('devices', 'teacher-led' or 'mixed'), not what the
    // screen shows (`mode`): the wall hides the join code in a Teacher-led
    // room, which no phone joins.
    roomMode: sessionSettings(session).mode,
    question,
    diagram,
    progress,
    pick,
  };
}

// ------------------------------------------------------------ the wall --

const roomOf = (code) => `projector:${String(code).toUpperCase()}`;

/** The projector sockets watching a room, or one link of it. */
function wallSockets(io, { sessionId, linkId = null }) {
  return [...io.sockets.sockets.values()].filter((s) => {
    const p = s.data.projector;
    return p && !p.closed && p.sessionId === String(sessionId) && (!linkId || p.linkId === String(linkId));
  });
}

export const watchingCount = (io, session) => (io ? wallSockets(io, { sessionId: session._id }).length : 0);

/**
 * Send the room's screen to every projector watching it. With `onlyIf`, only
 * when the screen is in that mode (the grid's broadcast calls this after every
 * join and answer, and only the progress screen moves with those). Never throws:
 * a projector that missed one push gets the next.
 */
export async function pushProjector(io, repo, session, { onlyIf = null } = {}) {
  try {
    if (!io || !session || !io.sockets.adapter.rooms.get(roomOf(session.code))?.size) return;
    if (onlyIf && screenOf(session).mode !== onlyIf) return;
    // A link that ran out while its projector watched: told, and dropped, before
    // the room's screen goes out, so it never gets this one.
    const now = Date.now();
    for (const socket of wallSockets(io, { sessionId: session._id })) {
      if (Date.parse(socket.data.projector.expiresAt ?? '') <= now) dropWall(socket, session, LINK_ENDED);
    }
    emitProjector(io.to(roomOf(session.code)), 'projector:state', await projectorPayload(repo, session));
  } catch (err) {
    console.error('[projector] push failed:', err);
  }
}

const LINK_ENDED = `This projector link no longer works: a link works for ${PROJECTOR_LINK_HOURS} hours. `
  + 'Ask your professor for a new one.';

/** One projector told it is done: it leaves the room and stays marked a projector. */
function dropWall(socket, session, reason) {
  emitProjector(socket, 'projector:closed', { code: session.code, reason });
  socket.leave(roomOf(session.code));
  socket.data.projector = { ...socket.data.projector, closed: true };
}

/**
 * Tell a room's projectors (or one link's) that they are done, and stop sending
 * them anything: they leave the room, and stay marked as projectors, so nothing
 * meant for a phone or a teacher can reach them on that connection either.
 */
export function closeWall(io, { session, linkId = null, reason }) {
  if (!io || !session) return;
  for (const socket of wallSockets(io, { sessionId: session._id, linkId })) dropWall(socket, session, reason);
}

/**
 * Claim what this connection is, at once: 'projector', or 'room' for a phone or
 * a teacher's screen. The first ask decides and the other is refused for good.
 * Decided synchronously, before any await, because a check made after one let a
 * connection that sent student:join and projector:watch together become both:
 * each handler's check ran while the other was still waiting on the store.
 * sockets/index.js claims 'room' for every phone and teacher event.
 */
export function claimConnection(socket, role) {
  if (socket.data.claim && socket.data.claim !== role) return false;
  socket.data.claim = role;
  return true;
}

/**
 * projector:watch { token }. The link must exist, not be revoked, be less than
 * PROJECTOR_LINK_HOURS old, and belong to a room that is not closed; then this
 * connection is the room's projector and gets the screen. Every refusal of the
 * link itself is one sentence, the same for a token that never existed, one
 * that was revoked and one that ran out, so a token cannot be probed.
 *
 * A connection that is already a phone or a teacher's screen, or has asked to
 * be one, cannot also be a projector (claimConnection): the promise is that a
 * projector connection carries projector events and nothing else.
 */
export async function watchWall(io, repo, socket, payload) {
  const refuse = (reason) => emitProjector(socket, 'projector:refused', { reason });
  if (socket.data.student || socket.data.teacher || !claimConnection(socket, 'projector')) {
    refuse('This connection is already a phone or a teacher\'s screen. Open the projector link in its own window.');
    return;
  }
  const token = typeof payload?.token === 'string' ? payload.token.trim() : '';
  const link = TOKEN_SHAPE.test(token) ? await repo.getProjectorLinkByHash(tokenHash(token)) : null;
  const session = link && !link.revokedAt && !linkExpired(link) ? await repo.getSession(link.sessionId) : null;
  if (!session) {
    refuse('That projector link does not work: it may have been turned off. Ask your professor for a new one.');
    return;
  }
  if (session.status === 'closed') {
    refuse('That room is closed, so its projector link no longer works.');
    return;
  }
  const before = socket.data.projector;
  if (before && !before.closed && before.code !== session.code) socket.leave(roomOf(before.code));
  socket.data.projector = {
    code: session.code, sessionId: String(session._id), linkId: String(link._id), expiresAt: linkExpiresAt(link), closed: false,
  };
  socket.join(roomOf(session.code));
  emitProjector(socket, 'projector:state', await projectorPayload(repo, session));
}
