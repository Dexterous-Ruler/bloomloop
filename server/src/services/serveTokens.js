// Serve tokens for the hub's practice and lessons (Batch 8, the shared question
// bank, decision (c)).
//
// Practice and a lesson used to take an answer to any question the student
// could reach, so a student could answer (and see the key of) a question the
// hub never put in front of them, one id at a time. Now the reply that serves a
// question carries a token: an HMAC over the account, the question, the mode
// and when it was served, signed with the server's own secret (src/secrets.js).
// The answer brings it back. Nothing is stored: the signature is the record, so
// there is no table and a restart forgets nothing.
//
// A good token proves the hub served the question to that student, however long
// ago: a phone's outbox may hold an answer for days. An answer without one, or
// with one that does not check, is still kept, because nothing a student sends
// is discarded, but as unproven (hub_attempts.unproven, 0036): it counts
// nowhere, and its reply carries no mark, no key and no explanation, now or when
// it is sent again. That closes the hole without dropping the answers of a
// phone that has not yet learnt to send tokens.
//
// Shape: "<served at, in seconds since 1970>.<base64url HMAC-SHA256>". The
// account, question and mode are not in the token; the server supplies them
// from the request, so a token for one question or one student proves nothing
// about another. Compared in constant time.

import crypto from 'node:crypto';

import { secretFor } from '../secrets.js';

/** The modes a token is issued for: what practice serves, and a lesson's questions. */
export const SERVE_MODES = Object.freeze(['practice', 'review', 'lesson']);

/** What a student is told about an answer kept as unproven. */
export const UNPROVEN_NOTE = 'Your answer is saved, but it does not count and no mark or answer is shown for it: '
  + 'it could not be matched to a question the hub gave you. Open the question again and answer it there to have it marked.';

const lower = (v) => String(v ?? '').trim().toLowerCase();

/** Practice and review are one loop: a question served for one is answered in either. */
const family = (mode) => (mode === 'lesson' ? 'lesson' : 'practice');

function signature(accountId, questionId, mode, servedAt) {
  return crypto.createHmac('sha256', secretFor('serve-tokens'))
    .update(`${lower(accountId)}|${lower(questionId)}|${family(mode)}|${servedAt}`, 'utf8')
    .digest('base64url');
}

/** A token for one question served to one account in one mode. */
export function serveToken({ accountId, questionId, mode, now = new Date() }) {
  const servedAt = Math.floor(now.getTime() / 1000);
  return `${servedAt}.${signature(accountId, questionId, mode, servedAt)}`;
}

/**
 * Was this question served to this account in this mode?
 *
 * @returns {{ ok: boolean }}
 */
export function checkServeToken(token, { accountId, questionId, mode }) {
  const m = /^(\d{9,12})\.([A-Za-z0-9_-]{43})$/.exec(String(token ?? '').trim());
  if (!m) return { ok: false };
  const want = Buffer.from(signature(accountId, questionId, mode, m[1]));
  const got = Buffer.from(m[2]);
  return { ok: want.length === got.length && crypto.timingSafeEqual(want, got) };
}
