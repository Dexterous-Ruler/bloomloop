// The server's own secret, for what it signs or deals and must work out again
// later (Batch 8): the Learning Hub's serve tokens (services/serveTokens.js) and
// the order a tap or label question deals its parts and labels in
// (questionTypes.js).
//
// Never a fixed string in the source: anyone can read the source, and with it
// mint a serve token for any question, or deal themselves the same cards as
// their phone and read the key off them. The secret is, in order:
//
//   SERVER_SECRET              set once for a deployment and kept: changing it
//                              voids every serve token still on a phone and
//                              re-deals every tap and label question;
//   the Supabase service-role  already server-only, so a deployment that sets
//   key, or the MongoDB URI    nothing new is still never guessable (rotating
//                              that key then has the effects above);
//   random, for this process   the in-memory store (tests, laptop mode), whose
//                              rooms and answers go when the process does.
//
// Read once, at first use, so laptop mode has switched the network services off
// first. Each use gets its own key, an HMAC of the secret and the use's label,
// so the base value itself is never used to sign anything.

import crypto from 'node:crypto';

import { config } from './config.js';

let base = null;
const keys = new Map();

/** The key for one use of the server's secret (a label such as 'serve-tokens'). */
export function secretFor(label) {
  base ??= config.serverSecret || config.supabase?.serviceKey || config.mongoUri || crypto.randomBytes(32).toString('hex');
  if (!keys.has(label)) keys.set(label, crypto.createHmac('sha256', String(base)).update(`bloomloop:${label}`, 'utf8').digest());
  return keys.get(label);
}
