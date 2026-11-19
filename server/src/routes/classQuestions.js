// Phase 5 - class questions and the confidence counts, under /api/session/:code/...
//
//   class-questions                 GET   every class question asked in the room, oldest first
//   class-questions                 POST  { questionId }: put one approved question to every phone
//   class-questions/:id             GET   one, as it stands
//   class-questions/:id/pause       POST  round 1 closes; the class discusses
//   class-questions/:id/revote      POST  round 2 opens: every phone votes again
//   class-questions/:id/close       POST  { reveal? }: it ends, with its key revealed or not
//   confidence                      GET   the room's confidence taps by right and wrong
//
// The rules and every payload are in services/classQuestions.js; the state
// changes run in the live loop (startClassQuestion, changeClassQuestion in
// sockets/index.js), which tells the phones, the professor's screens and the
// projector. Each change answers with the class question as the professor's
// screen gets it.
//
// Mounted at /api/session after the room, records, projector and insight
// routers (app.js), with requireTeacher on every route rather than at the
// mount: GET /api/session/:code (one segment) is the phones' and stays open, and
// every path here is two segments or more. A phone never reaches these: it
// votes over the socket.
//
// Who (ownership.js): the read rule for GET, so an HOD reads the department's
// rooms; the write rule for the rest, so only the room's owner runs a class
// question and an HOD gets 403. A room the caller may not read is the same 404
// as one that does not exist, word for word, and so is a class question of
// another room.

import express from 'express';

import { getRepo } from '../repo/index.js';
import { requireTeacher } from '../auth.js';
import { assertCanRead, assertCanWrite } from '../ownership.js';
import { isRecordId } from '../ids.js';
import { CLASS_KINDS, CLASS_NOTE, classQuestionBody, runningOf } from '../services/classQuestions.js';
import { CONFIDENCE_CHOICES, roomConfidence } from '../services/confidence.js';
import { changeClassQuestion, isOnline, startClassQuestion } from '../sockets/index.js';

const router = express.Router();

const fail = (message, status) => Object.assign(new Error(message), { status });

async function findRoom(rawCode) {
  const code = String(rawCode ?? '').trim().toUpperCase();
  return code ? getRepo().getSessionByCode(code) : null;
}

const readRoom = async (code, viewer) => assertCanRead(viewer, await findRoom(code), 'That room');
const writeRoom = async (code, viewer) => assertCanWrite(viewer, await findRoom(code), 'That room');

const bodyOf = (session, cq) => classQuestionBody(getRepo(), session, cq, { isOnline });

/** One class question of this room, or the one 404 (another room's included). */
async function classQuestionOf(session, rawId) {
  const id = String(rawId ?? '').trim();
  const cq = isRecordId(id) ? await getRepo().getClassQuestion(id) : null;
  if (!cq || String(cq.sessionId) !== String(session._id)) throw fail('That class question was not found.', 404);
  return cq;
}

/** Every class question of the room, oldest first, each as it stands; and which is running. */
router.get('/:code/class-questions', requireTeacher, async (req, res, next) => {
  try {
    const session = await readRoom(req.params.code, req.viewer);
    const list = await getRepo().listClassQuestions(session._id);
    const running = runningOf(list);
    res.json({
      room: { code: session.code, title: session.title ?? '', status: session.status },
      kinds: CLASS_KINDS,
      running: running ? String(running._id) : null,
      classQuestions: await Promise.all(list.map((cq) => bodyOf(session, cq))),
      confidenceChoices: CONFIDENCE_CHOICES,
      note: CLASS_NOTE,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Put one approved question of the room to every phone: 201 with the class
 * question. 409 for a room that is not open, a Teacher-led room, a class
 * question already running, or a question already asked to the class here; 400
 * for a question this room may not serve or one without options to vote on.
 */
router.post('/:code/class-questions', requireTeacher, async (req, res, next) => {
  try {
    const session = await writeRoom(req.params.code, req.viewer);
    const questionId = typeof req.body?.questionId === 'string' ? req.body.questionId.trim() : '';
    if (!isRecordId(questionId)) throw fail('Choose one of this room\'s approved questions to put to the class.', 400);
    const cq = await startClassQuestion(req.app.get('io'), session, { questionId, by: req.viewer?.id ?? null });
    res.status(201).json(await bodyOf(session, cq));
  } catch (err) {
    next(err);
  }
});

router.get('/:code/class-questions/:id', requireTeacher, async (req, res, next) => {
  try {
    const session = await readRoom(req.params.code, req.viewer);
    res.json(await bodyOf(session, await classQuestionOf(session, req.params.id)));
  } catch (err) {
    next(err);
  }
});

/** pause, revote and close, each the write rule and then the room's own 404 for a class question not its own. */
function change(action) {
  return async (req, res, next) => {
    try {
      const session = await writeRoom(req.params.code, req.viewer);
      const cq = await classQuestionOf(session, req.params.id);
      let reveal = false;
      if (action === 'close' && req.body?.reveal !== undefined && req.body?.reveal !== null) {
        if (typeof req.body.reveal !== 'boolean') throw fail('Say whether to show the class the answer as you close it: yes or no.', 400);
        reveal = req.body.reveal;
      }
      const updated = await changeClassQuestion(req.app.get('io'), session, cq._id, action, { by: req.viewer?.id ?? null, reveal });
      res.json(await bodyOf(session, updated));
    } catch (err) {
      next(err);
    }
  };
}

router.post('/:code/class-questions/:id/pause', requireTeacher, change('pause'));
router.post('/:code/class-questions/:id/revote', requireTeacher, change('revote'));
router.post('/:code/class-questions/:id/close', requireTeacher, change('close'));

/**
 * The room's confidence taps (services/confidence.js roomConfidence): counts by
 * tap and by right and wrong, for the room and per question, never per
 * student. Read rule.
 */
router.get('/:code/confidence', requireTeacher, async (req, res, next) => {
  try {
    const session = await readRoom(req.params.code, req.viewer);
    res.json({
      room: { code: session.code, title: session.title ?? '', status: session.status },
      ...(await roomConfidence(getRepo(), session)),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
