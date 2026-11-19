// Serve tokens for the hub's practice and lessons (Batch 8, the shared question
// bank, decision (c)).
//
// Practice and a lesson used to take an answer to any question the student
// could reach, so a student could answer (and see the key of) a question the
// hub never put in front of them, one id at a time. Now the reply that serves a
// question carries a token: an HMAC over the account, the question, the mode
// and an expiry, signed with a server secret (config.hub.serveTokenSecret). The
// answer must bring it back. Nothing is stored: the signature is the record, so
// there is no table and a restart forgets nothing.
//
// Shape: "<expiry in seconds since 1970>.<base64url HMAC-SHA256>". The account,
// question and mode are not in the token; the server supplies them from the
// request, so a token for one question or one student proves nothing about
// another. Compared in constant time.

import crypto from 'node:crypto';

import { config } from '../config.js';

/** The modes a token is issued for: what practice serves, and a lesson's questions. */
export const SERVE_MODES = Object.freeze(['practice', 'review', 'lesson']);

export const TOKEN_MISSING = 'This answer was not sent with the question it answers, so it was not taken. '
  + 'Open the question again and answer it there.';
export const TOKEN_EXPIRED = 'This question was given to you too long ago to be answered now, so this answer was not taken. '
  + 'Open the question again and answer it there.';

const lower = (v) => String(v ?? '').trim().toLowerCase();

/** Practice and review are one loop: a question served for one is answered in either. */
const family = (mode) => (mode === 'lesson' ? 'lesson' : 'practice');

function signature(accountId, questionId, mode, expiry) {
  return crypto.createHmac('sha256', String(config.hub.serveTokenSecret))
    .update(`${lower(accountId)}|${lower(questionId)}|${family(mode)}|${expiry}`, 'utf8')
    .digest('base64url');
}

/** A token for one question served to one account in one mode. */
export function serveToken({ accountId, questionId, mode, now = new Date() }) {
  const hours = Number(config.hub.serveTokenHours) > 0 ? Number(config.hub.serveTokenHours) : 168;
  const expiry = Math.floor(now.getTime() / 1000) + Math.round(hours * 3600);
  return `${expiry}.${signature(accountId, questionId, mode, expiry)}`;
}

/**
 * Was this question served to this account in this mode, and not too long ago?
 *
 * @returns {{ ok: true } | { ok: false, why: 'missing'|'expired', message: string }}
 */
export function checkServeToken(token, { accountId, questionId, mode, now = new Date() }) {
  const m = /^(\d{9,12})\.([A-Za-z0-9_-]{43})$/.exec(String(token ?? '').trim());
  if (!m) return { ok: false, why: 'missing', message: TOKEN_MISSING };
  const want = Buffer.from(signature(accountId, questionId, mode, m[1]));
  const got = Buffer.from(m[2]);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return { ok: false, why: 'missing', message: TOKEN_MISSING };
  if (Number(m[1]) * 1000 < now.getTime()) return { ok: false, why: 'expired', message: TOKEN_EXPIRED };
  return { ok: true };
}

/** The 409 an answer gets without a good token. Nothing is stored; the device keeps it. */
export function assertServed(token, who) {
  const verdict = checkServeToken(token, who);
  if (!verdict.ok) throw Object.assign(new Error(verdict.message), { status: 409, code: `serve-token-${verdict.why}` });
}
