// Teacher/student separation.
//
// There are no accounts anywhere in BloomLoop - that is a deliberate product
// decision, because asking sixty students to make accounts kills a ten-minute
// class activity. But teacher and student are served from the SAME origin, so
// "no accounts" cannot also mean "no boundary": without one, a student who can
// read the room code off the projector can walk the API to the full answer key.
//
// So the student side stays open (code + roll number, exactly as specified) and
// the teacher side - content, generation, the bank, opening sessions, the grid
// and exports - is gated on a single shared key that the teacher's browser
// picks up automatically from the URL printed in the boot banner.

import { timingSafeEqual } from 'node:crypto';
import { config } from './config.js';

const HEADER = 'x-teacher-key';

export function teacherKeyFrom(req) {
  const fromHeader = req.get(HEADER);
  const fromQuery = typeof req.query?.key === 'string' ? req.query.key : '';
  return String(fromHeader || fromQuery || '').trim();
}

export function isTeacher(req) {
  const supplied = Buffer.from(teacherKeyFrom(req));
  const expected = Buffer.from(config.teacherKey);
  // timingSafeEqual throws on a length mismatch, so that has to be checked
  // first - and an unequal length is already a definitive answer.
  if (supplied.length !== expected.length) return false;
  return timingSafeEqual(supplied, expected);
}

export function requireTeacher(req, _res, next) {
  if (isTeacher(req)) return next();
  next(
    Object.assign(
      new Error(
        'Teacher key required. Open the console using the URL printed in the server window.',
      ),
      { status: 401 },
    ),
  );
}
