// Phase 1 - the review queue for written answers.
//
// A written answer (kind 'open') is marked by matching rubric words the moment
// it arrives. That mark counts at once, so a class never waits on a professor,
// but it is a first reading, so the answer is stored as 'provisional'. This is
// where a professor reads it and confirms or overrides it.
//
// Three rules hold for every decision made here:
//   evidence  the response and the machine's mark (auto_*) are never touched.
//             The professor's mark is written beside them on the answer row,
//             and every decision is appended to answer_reviews (0010), so a
//             later decision never erases an earlier one.
//   numbers   the student's history entry and level tally move by the
//             difference (applyReview in services/mastery.js), so the grid,
//             analytics and the CSV all read the human decision. The working
//             level is not rewound; the ladder's next decision reads the
//             corrected history.
//   access    reading needs a room the caller may read, deciding one they may
//             write (ownership.js). A room they may not read answers 404,
//             exactly like one that does not exist, so ids cannot be probed.
//
// Batch 9 (E3, E4): the queue also holds drawings (kind 'drawing'), which the
// machine never marks: each arrives with no mark at all, so it can only be
// marked here (an override), never confirmed. Its picture is read through the
// image route by staff who may read the room (`drawing.url`); a phone never
// gets it. A written answer's item says which length it was asked as.
//
// The note is not private. It is shown to the student, word for word, beside the
// mark in their own answer history (redactForStudent in services/evidence.js;
// PRODUCT_DECISIONS.md). It is a comment to the student, and the screen that
// takes it must say so; a remark meant only for colleagues does not go here.
//
//   GET  /api/review?code=&status=&limit=&before=   the queue, newest first;
//                                                   `before` is the previous page's `next`
//   GET  /api/review/:answerId                      one answer and its log
//   POST /api/review/:answerId                      confirm or override

import express from 'express';

import { getRepo } from '../repo/index.js';
import { assertCanRead, assertCanWrite, readable } from '../ownership.js';
import { isRecordId } from '../ids.js';
import { applyReview, sessionSettings } from '../services/mastery.js';
import { OPEN_LENGTHS, PASS_MARK, REVIEWED_KINDS, kindLabel, openLength } from '../questionTypes.js';
import { mediaUrl } from '../services/media.js';
import { lockProfile, broadcastGrid, roomDeleting } from '../sockets/index.js';
import { importedRooms } from '../services/roomImport.js';
import { figureForStaff } from '../figures/index.js';

const router = express.Router();

const fail = (message, status) => Object.assign(new Error(message), { status });

/** The queue's filters. 'auto' is not one: no written answer is ever 'auto'. */
const STATUSES = ['provisional', 'confirmed', 'overridden', 'all'];

/** The kinds a professor reviews: written answers, and the kinds the machine never marks (Batch 9). */
export const QUEUE_KINDS = Object.freeze(['open', ...REVIEWED_KINDS]);

/** Said when a drawing is confirmed: there is no machine mark to keep. */
export const DRAWING_NO_CONFIRM = 'A drawing has no machine mark to confirm: give it a mark of your own.';
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
/**
 * The same ceiling as answer_reviews_note_check in 0010. The note is shown to the
 * student (see the header), so this is the length of a comment they will read.
 */
export const MAX_NOTE = 1000;

/** Scores are stored as numeric(4,3); rounding here makes a repeated POST compare equal. */
const round3 = (n) => Math.round(Number(n) * 1000) / 1000;

/** ?limit= off the query string, or an honest 400. */
function limitFrom(raw) {
  if (raw === undefined || raw === '') return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) {
    throw fail(`limit must be a whole number from 1 to ${MAX_LIMIT}.`, 400);
  }
  return n;
}

/*
 * The queue pages by a cursor - the last item a page showed, as its answer time
 * and id - and not by offset. The queue moves while a professor works through
 * it: reviewing an answer takes it out of the default view, so asking for "the
 * 50 after the first 50" next skipped every answer that had moved up into the
 * gap, and an answer arriving at the top pushed every offset along by one. A
 * cursor names a place in the order itself, which neither of those moves.
 *
 * Opaque to the caller and safe in a URL: base64url of [answeredAt, id], in the
 * store's own spelling, so the store compares it exactly as it sorted it.
 */
const cursorOf = (answer) =>
  Buffer.from(JSON.stringify([answer.answeredAt, String(answer._id)])).toString('base64url');

function cursorFrom(raw) {
  if (raw === undefined || raw === '') return null;
  try {
    const [answeredAt, id] = JSON.parse(Buffer.from(String(raw), 'base64url').toString('utf8'));
    if (typeof answeredAt === 'string' && Number.isFinite(Date.parse(answeredAt)) && isRecordId(String(id))) {
      return { answeredAt, id: String(id) };
    }
  } catch {
    // Not one of ours: the 400 below.
  }
  throw fail('before must be the `next` value of the previous page.', 400);
}

/**
 * One queue item. Everything a professor needs to decide without opening
 * anything else: who, which room, the question as the student saw it, what they
 * wrote, what the machine made of it, and what is in force now. `importedFrom`
 * on the room only for a room imported from a file laptop mode saved (Phase 7):
 * its marks are as the file gave them.
 */
function toItem(answer, session, name, importedFrom = null) {
  const snap = answer.questionSnapshot ?? {};
  const kind = answer.kind ?? snap.kind ?? 'open';
  // A drawing's picture (Batch 9), read by staff through the image route.
  const mediaId = kind === 'drawing' && typeof answer.response?.mediaId === 'string' ? answer.response.mediaId : null;
  return {
    answerId: String(answer._id),
    // The key the row was stored under, the phone's own answerId (Batch 8), so
    // the console can tie an outbox item to this row. `answerId` above is the
    // row's id, which the review routes take.
    answerKey: answer.answerKey ?? null,
    room: {
      code: session?.code ?? null, title: session?.title ?? '', status: session?.status ?? null,
      ...(importedFrom ? { importedFrom } : {}),
    },
    student: { rollNo: answer.rollNo, name: name ?? '' },
    topic: answer.topic ?? '',
    bloom: answer.bloom,
    kind: answer.kind,
    kindLabel: kindLabel({ ...snap, kind }),
    ...(kind === 'open' ? { length: openLength(snap), maxWords: OPEN_LENGTHS[openLength(snap)].maxWords } : {}),
    ...(kind === 'drawing' ? {
      drawing: mediaId ? { mediaId, url: mediaUrl(mediaId) } : null,
      text: typeof answer.response?.text === 'string' ? answer.response.text : '',
    } : {}),
    question: {
      id: answer.questionId ?? snap.id ?? null,
      text: snap.text ?? '',
      // From the snapshot, not the bank: the question may have been edited since.
      rubric: Array.isArray(snap.rubric) ? snap.rubric : [],
      // No question kind stores a model answer today (questionTypes.js has no
      // such field), so this is null until one does.
      modelAnswer: snap.modelAnswer ?? null,
      stimulus: snap.stimulus ?? null,
      // A figure (Batch 8) drawn from the snapshot's spec, as the student saw it.
      ...(snap.stimulus?.kind === 'figure' ? { figure: figureForStaff(snap.stimulus.spec) } : {}),
    },
    response: answer.response ?? null,
    autoCorrect: answer.autoCorrect ?? null,
    autoScore: answer.autoScore ?? null,
    autoDetail: answer.autoDetail ?? '',
    correct: answer.correct ?? null,
    score: answer.score ?? null,
    reviewStatus: answer.reviewStatus,
    reviewedBy: answer.reviewedBy ?? null,
    reviewedAt: answer.reviewedAt ?? null,
    reviewNote: answer.reviewNote ?? '',
    attempt: answer.attempt,
    servedAt: answer.servedAt ?? null,
    answeredAt: answer.answeredAt,
  };
}

const toLog = (r) => ({
  id: String(r._id),
  decision: r.decision,
  correct: r.correct,
  score: r.score,
  note: r.note ?? '',
  reviewedBy: r.reviewedBy ?? null,
  reviewedAt: r.reviewedAt,
});

/**
 * The answer and its room, if this viewer may read (or write) the room.
 * "No such answer", "a malformed id" and "not a room you may read" are one 404.
 */
async function loadAnswer(rawId, viewer, { write = false } = {}) {
  const repo = getRepo();
  const id = String(rawId ?? '').trim();
  const answer = isRecordId(id) ? await repo.getAnswer(id) : null;
  const session = answer ? await repo.getSession(answer.sessionId) : null;
  const row = answer && session;
  if (write) await assertCanWrite(viewer, row, 'That answer');
  else await assertCanRead(viewer, row, 'That answer');
  return { answer, session };
}

/**
 * The decision in the request body, or an honest 400.
 *
 * The override rule, which the professor's screen should state:
 *   - send `correct`, `score`, or both;
 *   - `score` alone: correct is score >= PASS_MARK (0.7), the same bar the
 *     rubric matcher applies, so a human score and a machine score mean the same;
 *   - `correct` alone: score is 1 for right and 0 for wrong;
 *   - both: taken as given. The professor's judgement is the authority, and
 *     partial credit they still count as right (or not) is theirs to give.
 * A confirm carries no mark: it keeps the machine's, and a body that also sends
 * one is refused rather than silently ignored.
 * `note` is optional, at most MAX_NOTE characters, and the student reads it.
 */
function decisionFrom(body, answer) {
  const decision = body?.decision;
  if (decision !== 'confirm' && decision !== 'override') {
    throw fail("decision must be 'confirm' or 'override'.", 400);
  }

  const rawNote = body.note ?? '';
  if (typeof rawNote !== 'string') throw fail('note must be text.', 400);
  const note = rawNote.trim();
  if (note.length > MAX_NOTE) throw fail(`note must be at most ${MAX_NOTE} characters.`, 400);

  const hasCorrect = body.correct !== undefined && body.correct !== null;
  const hasScore = body.score !== undefined && body.score !== null;

  if (decision === 'confirm') {
    if (hasCorrect || hasScore) {
      throw fail("confirm keeps the machine's mark and takes none of its own - send decision 'override' to change it.", 400);
    }
    if (typeof answer.autoCorrect !== 'boolean' || answer.autoScore === null || answer.autoScore === undefined
      || !Number.isFinite(Number(answer.autoScore))) {
      throw fail('This answer has no machine mark to confirm - override it instead.', 409);
    }
    return { decision, reviewStatus: 'confirmed', correct: answer.autoCorrect, score: round3(answer.autoScore), note };
  }

  if (!hasCorrect && !hasScore) {
    throw fail('An override needs a mark: send correct (true or false), score (0 to 1), or both.', 400);
  }
  if (hasCorrect && typeof body.correct !== 'boolean') throw fail('correct must be true or false.', 400);
  if (hasScore && (typeof body.score !== 'number' || !Number.isFinite(body.score) || body.score < 0 || body.score > 1)) {
    throw fail('score must be a number from 0 to 1.', 400);
  }
  const score = hasScore ? round3(body.score) : (body.correct ? 1 : 0);
  const correct = hasCorrect ? body.correct : score >= PASS_MARK;
  return { decision, reviewStatus: 'overridden', correct, score, note };
}

/**
 * Record one decision. Runs under the student's profile lock, so a review cannot
 * interleave with a live answer from the same student, nor with a second click
 * on the same button.
 *
 * Idempotent. A decision already in force - same status, same mark, same note -
 * writes nothing: no log row, no answer change. Anything that differs, the note
 * included, is a new decision and is logged. The profile is checked either way,
 * and adjusted only if it does not already agree, so a request whose profile
 * write failed is finished by simply sending it again.
 */
async function decide(repo, answerId, want, { viewer, session }) {
  // Read again under the lock: a request that waited here sees what the one
  // before it wrote.
  const answer = await repo.getAnswer(answerId);
  if (!answer) throw fail('That answer was not found.', 404);

  const inForce = answer.reviewStatus === want.reviewStatus
    && answer.correct === want.correct
    && answer.score !== null && answer.score !== undefined && round3(answer.score) === want.score
    && (answer.reviewNote ?? '') === want.note;

  let logged = null;
  let current = answer;
  if (!inForce) {
    const reviewedAt = new Date().toISOString();
    const reviewedBy = viewer?.id ?? null;
    // The log first: a decision is never in force on the answer without the row
    // that records it. If the update below fails, sending the request again logs
    // it again, which over-records a decision rather than losing one.
    logged = await repo.addAnswerReview({
      answerId: answer._id,
      sessionId: answer.sessionId,
      decision: want.decision,
      correct: want.correct,
      score: want.score,
      note: want.note,
      reviewedBy,
      reviewedAt,
    });
    // Review fields only. updateAnswer cannot reach the response or auto_*.
    current = await repo.updateAnswer(answer._id, {
      correct: want.correct,
      score: want.score,
      reviewStatus: want.reviewStatus,
      reviewedBy,
      reviewedAt,
      reviewNote: want.note,
    });
  }

  const stored = await repo.getProfile(answer.sessionId, answer.rollNo);
  let profile = { found: false, adjusted: false };
  if (stored) {
    const out = applyReview(stored, {
      answerId: answer.answerKey,
      correct: want.correct,
      score: want.score,
      review: want.reviewStatus,
      redemption: sessionSettings(session).redemption,
    });
    if (out.changed) await repo.saveProfile(out.profile);
    profile = { found: out.found, adjusted: out.changed };
  }
  return { answer: current, logged, profile, name: stored?.name ?? '' };
}

/* ------------------------------------------------------------------ routes */

router.get('/', async (req, res, next) => {
  try {
    const status = String(req.query.status ?? 'provisional');
    if (!STATUSES.includes(status)) throw fail(`status must be one of ${STATUSES.join(', ')}.`, 400);
    const limit = limitFrom(req.query.limit);
    // Refused rather than ignored: a screen still sending it would page wrongly
    // without a word (see cursorOf).
    if (req.query.offset !== undefined) {
      throw fail('The queue pages with before=<next of the previous page>, not offset: reviewing an answer takes it out of the queue, so an offset skips answers.', 400);
    }
    const before = cursorFrom(req.query.before);

    const repo = getRepo();
    const code = String(req.query.code ?? '').trim().toUpperCase();
    let rooms;
    if (code) {
      // One room: the same 404 for a code that does not exist and one that is not theirs.
      rooms = [await assertCanRead(req.viewer, await repo.getSessionByCode(code), 'That room')];
    } else {
      rooms = await readable(req.viewer, await repo.listSessions());
    }
    if (rooms.length === 0) {
      res.json({ items: [], status, limit, hasMore: false, next: null });
      return;
    }

    // Final written answers only: a wrong attempt followed by a retry never
    // counted, so there is nothing for a review of it to change. One more row
    // than asked for says whether there is a next page without a count query.
    const rows = await repo.listAnswers({
      sessionIds: rooms.map((s) => String(s._id)),
      kind: [...QUEUE_KINDS],
      final: true,
      ...(status === 'all' ? {} : { reviewStatus: status }),
      ...(before ? { before } : {}),
      order: 'desc',
      limit: limit + 1,
    });
    const page = rows.slice(0, limit);
    const hasMore = rows.length > limit;

    // Names live on the profiles, one read per room on this page.
    const byId = new Map(rooms.map((s) => [String(s._id), s]));
    const names = new Map();
    for (const id of new Set(page.map((a) => String(a.sessionId)))) {
      const profiles = await repo.listProfiles(id);
      names.set(id, new Map(profiles.map((p) => [String(p.rollNo), p.name ?? ''])));
    }
    // The page's rooms imported from laptop mode (Phase 7), in one read.
    const imported = await importedRooms(repo, [...new Set(page.map((a) => String(a.sessionId)))].map((id) => byId.get(id)).filter(Boolean));

    res.json({
      items: page.map((a) => toItem(a, byId.get(String(a.sessionId)), names.get(String(a.sessionId))?.get(String(a.rollNo)),
        imported.get(String(a.sessionId)))),
      status,
      limit,
      hasMore,
      // Pass back as ?before= for the page after this one.
      next: hasMore ? cursorOf(page[page.length - 1]) : null,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:answerId', async (req, res, next) => {
  try {
    const { answer, session } = await loadAnswer(req.params.answerId, req.viewer);
    const repo = getRepo();
    const [profile, log, imported] = await Promise.all([
      repo.getProfile(answer.sessionId, answer.rollNo),
      repo.listAnswerReviews({ answerId: answer._id }),
      importedRooms(repo, [session]),
    ]);
    res.json({ item: toItem(answer, session, profile?.name, imported.get(String(session._id))), log: log.map(toLog) });
  } catch (err) {
    next(err);
  }
});

/**
 * Confirm or override one written answer.
 *
 * Only a caller who may write the room: its owner, or the shared key on a room
 * nobody owns. An HOD may read the queue but gets a 403 here. A closed room can
 * still be reviewed - marking after class is the normal case.
 */
router.post('/:answerId', async (req, res, next) => {
  try {
    const { answer, session } = await loadAnswer(req.params.answerId, req.viewer, { write: true });
    if (!QUEUE_KINDS.includes(answer.kind)) {
      throw fail('Only written answers and drawings are reviewed; this one was marked automatically.', 400);
    }
    if (answer.final === false) {
      throw fail('This attempt was followed by a retry, so it never counted. Review the final attempt.', 400);
    }
    if (answer.kind === 'drawing' && req.body?.decision === 'confirm') throw fail(DRAWING_NO_CONFIRM, 409);
    const want = decisionFrom(req.body ?? {}, answer);

    const repo = getRepo();
    const release = await lockProfile(answer.sessionId, answer.rollNo);
    let outcome;
    try {
      // The room is being archived and deleted. A decision written now would
      // miss the archive and go with the room, after this route had said it was
      // saved. Checked under the lock the delete waits on (holdRoomForDelete).
      if (roomDeleting(answer.sessionId)) {
        throw fail('That room is being deleted; its answers are being archived. Nothing was changed.', 409);
      }
      outcome = await decide(repo, answer._id, want, { viewer: req.viewer, session });
    } finally {
      release();
    }

    // Anyone watching the room sees the corrected row. A room nobody is watching
    // has nobody to tell, and the decision is saved either way, so a failed push
    // is logged rather than turned into an error for a review that worked.
    const io = req.app.get('io');
    if (io && outcome.profile.adjusted) {
      await broadcastGrid(io, session).catch((err) => console.error('[review] grid push failed:', err));
    }

    const log = await repo.listAnswerReviews({ answerId: answer._id });
    const imported = await importedRooms(repo, [session]);
    res.json({
      item: toItem(outcome.answer, session, outcome.name, imported.get(String(session._id))),
      changed: Boolean(outcome.logged) || outcome.profile.adjusted,
      logged: Boolean(outcome.logged),
      profile: outcome.profile,
      log: log.map(toLog),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
