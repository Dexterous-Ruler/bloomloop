// F6 tier 2 - the Google Classroom link the mentor called "very important".
//
// Everything in this file is optional by construction. The credentials may be
// absent, consent may never be granted, and the college wifi may block
// accounts.google.com; in every one of those cases each route still answers
// politely and points back at the tier 1 CSV, which is the path that always
// works. No route here may throw its way into the process - a broken Google
// integration must not be able to take the demo down.
//
// Plain fetch against the REST API, no googleapis SDK: Node 20 ships fetch and
// the contract forbids new dependencies.
//
// F7 adds a SECOND, much smaller Google flow to this file - the student's own.
// It shares the consent machinery below (one state map, one URL builder, one
// callback) and differs in the two ways that matter:
//
//   the teacher's   coursework scopes, offline access, tokens held in memory so
//                   grades can be posted on her behalf for the rest of the hour
//   the student's   openid/email/profile and nothing else, no refresh token, no
//                   stored token at all - the id_token is read once for its
//                   subject claim and the access token is revoked on the spot
//
// A student has no business granting BloomLoop coursework scopes, and a consent
// screen that asks for more than it needs is a consent screen nobody reads.

import { Router } from 'express';
import crypto from 'node:crypto';

import { config, hasClassroom, hasSupabase } from '../config.js';
import { requireAuth, loadAccount } from '../auth.js';
import { getRepo } from '../repo/index.js';
import {
  getGoogleLink,
  linkGoogle,
  listLinkedStudents,
  unlinkGoogle,
} from '../services/accounts.js';
import { hydrate, overallAccuracy } from '../services/mastery.js';
import { assertCanWrite } from '../ownership.js';

const router = Router();

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const API_BASE = 'https://classroom.googleapis.com/v1';

const SCOPES = [
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.students',
  'https://www.googleapis.com/auth/classroom.rosters.readonly',
];

/**
 * The student's scopes, in full. Three identity claims and not one thing more:
 * BloomLoop is asking a student "who are you on Google", and the answer to that
 * question does not require the ability to read their coursework.
 */
const IDENTITY_SCOPES = ['openid', 'email', 'profile'];

const TIER1_REASON =
  'Google Classroom is not configured - GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are unset. ' +
  'The CSV export is the configured hand-off path and needs nothing from Google.';

/**
 * What linking is FOR, in one sentence, written once.
 *
 * It travels with the status payload and is what the callback page prints, so
 * the screen a student reads before consenting and the screen they land on after
 * cannot drift into saying two different things about the same act. Same reason
 * HONESTY travels with the integrity payload in services/integrity.js.
 */
const LINK_PURPOSE =
  'Linking lets your professor place your session marks on your exact Google account when results ' +
  'are posted to Classroom, instead of matching your roll number to a name on the roster. ' +
  'BloomLoop asks Google only who you are - never for your coursework, your mail or your files - ' +
  'and keeps no access to your account afterwards.';

/** The same idea for the teacher, attached to a grade push rather than a consent screen. */
const MATCHING_NOTE =
  'Placed by identity means the student’s Google account was linked to their BloomLoop account, ' +
  'so the mark went to that exact Google user. Placed by roster means BloomLoop matched a roll number ' +
  'against the Classroom roster on name and email - a good guess, but a guess, and one that refuses ' +
  'to act at all when two students share a key. Of the identity placements, the ones from a student ' +
  'are accounts the student signed into Google to confirm; the ones from a roster were imported by a ' +
  'professor and the student never confirmed them.';

/** Nothing about the student link is required, and the UI must be able to say so verbatim. */
const LINK_OPTIONAL =
  'This is optional. A student who never links, or has no Google account at all, sits every session ' +
  'exactly as they do now and is graded exactly as they are now.';

const REQUEST_TIMEOUT_MS = 15000;
const STATE_TTL_MS = 10 * 60 * 1000;
// Treat a token that expires within the minute as already expired, so a slow
// round trip cannot land at Google just after the token died.
const EXPIRY_SKEW_MS = 60 * 1000;
const PAGE_SIZE = 100;
const MAX_PAGES = 20;

// This is a demo, not a product: one teacher, one laptop, one class period. The
// tokens live in module memory and die with the process. A real deployment would
// need a per-user encrypted store, which is not something to build the night
// before a viva - and holding them here means a restart simply asks for consent
// again rather than leaking anything to disk.
const tokens = { access: '', refresh: '', expiresAt: 0 };

// state -> { at, redirectUri }. Anti-CSRF: a callback whose state we did not
// issue is somebody else's, and is refused.
const pendingStates = new Map();

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

const notConnected = () =>
  Object.assign(
    new Error('Not connected to Google Classroom - open Connect Google Classroom and grant consent first.'),
    { status: 400 },
  );

const isConnected = () =>
  Boolean(tokens.access) && (tokens.expiresAt > Date.now() || Boolean(tokens.refresh));

function statusPayload() {
  if (!hasClassroom()) return { configured: false, connected: false, reason: TIER1_REASON };
  if (!isConnected()) {
    return {
      configured: true,
      connected: false,
      reason: 'Credentials are set but no Google account is connected yet - click Connect Google Classroom.',
    };
  }
  return { configured: true, connected: true, reason: 'Connected. Grades can be pushed to a course.' };
}

/**
 * The origin the browser actually used, so the redirect_uri matches whatever the
 * teacher typed - localhost, the laptop's LAN IP, or a tunnel in front of it.
 * The forwarded headers are honoured because a tunnel terminates TLS and Google
 * refuses a plain-http redirect_uri for anything but localhost.
 */
function requestOrigin(req) {
  const first = (value, fallback) => String(value ?? fallback).split(',')[0].trim();
  const proto = first(req.headers['x-forwarded-proto'], req.protocol || 'http');
  const host = first(req.headers['x-forwarded-host'], req.get('host') || `localhost:${config.port}`);
  return `${proto}://${host}`;
}

/**
 * The redirect_uri to hand Google.
 *
 * GOOGLE_REDIRECT_URI wins when it is set, because Google compares this against
 * a registered list character for character and refuses anything else. Reached
 * through a Cloudflare quick tunnel or any other preview host, the request's own
 * origin is a URL nobody has registered - and the failure lands on Google's
 * error page, after consent, where it is nobody's idea of self-explanatory.
 */
const redirectUriFor = (req) =>
  config.classroom.redirectUri ||
  new URL(config.classroom.redirectPath, requestOrigin(req)).toString();

/**
 * A consent URL, and the anti-CSRF state that goes with it.
 *
 * One builder for both flows. What separates them is the scope list and the
 * `purpose` recorded against the state - see the two callers below.
 */
function consentUrl(req, { scopes, purpose, params = {} }) {
  const redirectUri = redirectUriFor(req);
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set('client_id', config.classroom.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', scopes.join(' '));
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set('state', issueState(redirectUri, purpose));
  return { url: url.toString(), redirectUri };
}

/** The teacher's: coursework scopes and a refresh token, so grades can be posted later. */
const teacherConsentUrl = (req) =>
  consentUrl(req, {
    scopes: SCOPES,
    purpose: { kind: 'teacher' },
    params: {
      // offline + consent is what makes Google hand over a refresh token, which
      // is what lets a session that outlasts the hour keep posting grades.
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
    },
  });

/**
 * The student's: three identity claims, nothing kept, nothing to come back for.
 *
 * Three deliberate differences from the teacher's URL above, each of them the
 * point rather than an oversight:
 *
 *   no access_type=offline      we are asking one question once. A refresh token
 *                               is a standing permission to ask again forever,
 *                               and we would then have to store it.
 *   no include_granted_scopes   it re-grants everything this Google account has
 *                               ever approved for this client. A professor who
 *                               connected Classroom and then links her own
 *                               identity would otherwise receive a token
 *                               carrying coursework scopes from an identity-only
 *                               consent screen - the exact opposite of what the
 *                               screen just told her she was agreeing to.
 *   prompt=select_account       a lab machine is often already signed into
 *                               somebody else's Google. Without this the browser
 *                               links whoever it happens to be, silently, and
 *                               the student ends up holding another student's
 *                               identity.
 */
const studentConsentUrl = (req, accountId) =>
  consentUrl(req, {
    scopes: IDENTITY_SCOPES,
    purpose: { kind: 'student', accountId },
    params: { prompt: 'select_account' },
  });

/**
 * Issue a state, and remember what it was for.
 *
 * `purpose` carries the account id on the student flow, and it lives HERE rather
 * than in a query parameter on the redirect for a reason: the callback arrives
 * from Google carrying no credentials of ours at all, so whatever it says about
 * whose account to write would have to be taken on trust. Keeping it server-side
 * against an unguessable single-use key means a callback cannot be replayed onto
 * a different account, and the only thing the browser gets to influence is
 * whether the exchange happens at all.
 */
function issueState(redirectUri, purpose = { kind: 'teacher' }) {
  const now = Date.now();
  for (const [key, entry] of pendingStates) {
    if (now - entry.at > STATE_TTL_MS) pendingStates.delete(key);
  }
  const state = crypto.randomBytes(16).toString('hex');
  pendingStates.set(state, { at: now, redirectUri, purpose });
  return state;
}

function consumeState(state) {
  const key = String(state ?? '');
  const entry = pendingStates.get(key);
  if (!entry) return null;
  pendingStates.delete(key);
  return Date.now() - entry.at > STATE_TTL_MS ? null : entry;
}

async function postToTokenEndpoint(params) {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = body.error_description || body.error || `Google token endpoint returned ${res.status}`;
    throw Object.assign(new Error(String(message)), { status: 502 });
  }
  return body;
}

function storeTokens(body) {
  tokens.access = body.access_token || '';
  // Google only sends a refresh token on the first consent, so an absent one on
  // a refresh response must not wipe the one we already hold.
  if (body.refresh_token) tokens.refresh = body.refresh_token;
  tokens.expiresAt = Date.now() + (Number(body.expires_in) || 0) * 1000;
}

async function exchangeCode(code, redirectUri) {
  storeTokens(
    await postToTokenEndpoint({
      code,
      client_id: config.classroom.clientId,
      client_secret: config.classroom.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  );
}

/**
 * The student half of the exchange: swap the code for an id_token, read the
 * subject out of it, and give the access token straight back.
 *
 * Deliberately NOT storeTokens(). That pair is the teacher's grade-posting
 * credential, and letting a student's consent land in it would hand the next
 * grade push whichever student linked most recently - a spectacular way to write
 * one student's marks onto another's coursework.
 */
async function exchangeIdentityCode(code, redirectUri) {
  const body = await postToTokenEndpoint({
    code,
    client_id: config.classroom.clientId,
    client_secret: config.classroom.clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });

  const claims = claimsFromIdToken(body.id_token);
  // Handed back the moment we are done with it. We asked one question, Google
  // answered it in the id_token, and an access token we have no further use for
  // is nothing but a thing that can be stolen. Nothing is stored either way.
  await revokeToken(body.access_token);
  return claims;
}

/**
 * The claims inside an id_token, without checking its signature.
 *
 * This token did not come through a browser. We asked Google's token endpoint
 * for it directly, over TLS, in a request authenticated with our own client
 * secret, and read it off that response - which is the one case where verifying
 * the signature buys nothing, because there is no untrusted hop for a forgery to
 * enter through. Google documents exactly this exemption.
 *
 * The three checks below are not a substitute for that. They are cheap sanity
 * on a token minted for somebody else's client id or one that sat in a stalled
 * redirect for an hour, and they cost a millisecond.
 */
function claimsFromIdToken(idToken) {
  const parts = String(idToken ?? '').split('.');
  if (parts.length !== 3) throw fail('Google returned no identity token, so there is nothing to link.');

  let claims;
  try {
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw fail('Google’s identity token could not be read.');
  }

  const iss = String(claims.iss ?? '');
  if (iss !== 'accounts.google.com' && iss !== 'https://accounts.google.com') {
    throw fail('That identity token did not come from Google.');
  }
  if (String(claims.aud ?? '') !== config.classroom.clientId) {
    throw fail('That identity token was issued for a different application.');
  }
  if (!(Number(claims.exp) * 1000 > Date.now())) {
    throw fail('That sign-in took too long and Google’s answer has expired. Try again.');
  }

  const sub = String(claims.sub ?? '').trim();
  if (!sub) throw fail('Google did not say who signed in, so there is nothing to link.');

  // email_verified matters here: an unverified address is a string the account
  // holder typed, and it is only ever shown back to the student as "which Google
  // account is this". The subject is the identity; the address is a label.
  const email = claims.email && claims.email_verified !== false ? String(claims.email) : null;
  return { sub, email };
}

/**
 * Best effort, and silent on failure by design. The token expires within the
 * hour on its own, and a revoke that fails must not turn a link that succeeded
 * into an error page in front of a student.
 */
async function revokeToken(token) {
  if (!token) return;
  try {
    await fetch(REVOKE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    /* see above - nothing here is worth failing the link over */
  }
}

async function refreshAccessToken() {
  if (!tokens.refresh) throw notConnected();
  storeTokens(
    await postToTokenEndpoint({
      refresh_token: tokens.refresh,
      client_id: config.classroom.clientId,
      client_secret: config.classroom.clientSecret,
      grant_type: 'refresh_token',
    }),
  );
}

async function bearerToken() {
  if (!tokens.access && !tokens.refresh) throw notConnected();
  if (!tokens.access || tokens.expiresAt - EXPIRY_SKEW_MS <= Date.now()) await refreshAccessToken();
  if (!tokens.access) throw notConnected();
  return tokens.access;
}

async function callApi(path, { method = 'GET', body, query } = {}) {
  const token = await bearerToken();
  const url = new URL(`${API_BASE}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }

  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const payload = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (res.status === 401) {
      tokens.access = '';
      throw Object.assign(new Error('Google rejected the stored token - reconnect Google Classroom.'), {
        status: 400,
      });
    }
    const message = payload?.error?.message || `Google Classroom API returned ${res.status}`;
    throw Object.assign(new Error(String(message)), { status: res.status === 403 ? 400 : 502 });
  }
  return payload;
}

/** Follow nextPageToken so a class of 60 is not silently truncated at the first page. */
async function collect(path, key, query = {}) {
  const out = [];
  let pageToken;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const body = await callApi(path, { query: { ...query, pageSize: PAGE_SIZE, pageToken } });
    out.push(...(body[key] ?? []));
    pageToken = body.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

const norm = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Roll numbers are a BloomLoop credential, not a Google identity, so the join is
 * a best-effort match on the school email and the student's name. A key that two
 * students share is recorded as ambiguous and never used: skipping a grade is
 * recoverable, grading the wrong student is not.
 */
function rosterIndex(students) {
  const index = new Map();
  const add = (key, userId) => {
    if (!key) return;
    const known = index.get(key);
    if (known === undefined) index.set(key, userId);
    else if (known !== userId) index.set(key, null);
  };

  for (const student of students) {
    const userId = student?.userId;
    if (!userId) continue;
    const email = String(student?.profile?.emailAddress ?? '');
    const local = email.split('@')[0];
    add(norm(email), userId);
    add(norm(local), userId);
    add(norm(student?.profile?.name?.fullName), userId);
    // 'cs21b1042@college.edu' - the roll number is usually one of these runs.
    for (const run of local.match(/\d{2,}/g) ?? []) add(run, userId);
  }
  return index;
}

function matchStudent(index, profile) {
  for (const key of [norm(profile.rollNo), norm(profile.name)]) {
    const userId = key ? index.get(key) : undefined;
    if (userId) return userId;
  }
  return null;
}

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (ch) => {
    if (ch === '&') return '&amp;';
    if (ch === '<') return '&lt;';
    if (ch === '>') return '&gt;';
    if (ch === '"') return '&quot;';
    return '&#39;';
  });

/**
 * The callback lands in a popup tab that has no BloomLoop bundle behind it, so
 * the page has to be self-contained - no stylesheet, no script, no fetch.
 */
function page(heading, message) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BloomLoop and Google Classroom</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
         font: 16px/1.55 system-ui, -apple-system, 'Segoe UI', sans-serif;
         background: #0f1220; color: #f2f4ff; padding: 24px; }
  .card { max-width: 30rem; background: #191d33; border: 1px solid #2c3253;
          border-radius: 14px; padding: 28px 30px; }
  h1 { margin: 0 0 12px; font-size: 1.3rem; }
  p { margin: 0 0 10px; color: #c3c9ee; }
  .hint { color: #8b93c2; font-size: 0.9rem; }
</style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(heading)}</h1>
    <p>${escapeHtml(message)}</p>
    <p class="hint">You can close this tab and go back to BloomLoop.</p>
  </div>
</body>
</html>`;
}

/**
 * The honest no-op used by every route when the credentials are missing. HTML
 * for a browser that navigated here, JSON for the REST client - both 400, both
 * naming the tier 1 path.
 */
function degrade(req, res) {
  if (req.accepts(['json', 'html']) === 'html') {
    return res.status(400).type('html').send(page('Google Classroom is not configured', TIER1_REASON));
  }
  return res.status(400).json({ error: TIER1_REASON, configured: false, connected: false });
}

/** Nothing async in this file may reject into the void; everything lands on the error middleware. */
const guard = (handler) => (req, res, next) => {
  Promise.resolve()
    .then(() => handler(req, res, next))
    .catch(next);
};

router.get('/status', (_req, res) => {
  res.json(statusPayload());
});

/**
 * The consent URL as JSON, for a browser that already has credentials.
 *
 * This exists because /auth below cannot work for a signed-in professor. It is
 * reached by NAVIGATING, and a navigation carries no Authorization header and no
 * x-teacher-key - which is why "Connect Google Classroom" answered
 * "Teacher key required" no matter who was signed in. Fetching the URL from an
 * authenticated call and then sending the browser straight to Google skips the
 * problem entirely: the only thing that has to survive the round trip is the
 * anti-CSRF state, and Google carries that for us.
 */
router.get('/auth-url', (req, res) => {
  if (!hasClassroom()) return degrade(req, res);
  const { url, redirectUri } = teacherConsentUrl(req);
  res.json({ url, redirectUri });
});

/**
 * The same thing as a redirect, for the shared-key path. isTeacher() reads
 * ?key=, so this one link works from an address bar; a bearer token cannot ride
 * in a URL and should not try, so accounts use /auth-url above.
 */
router.get('/auth', (req, res) => {
  if (!hasClassroom()) return degrade(req, res);
  res.redirect(302, teacherConsentUrl(req).url);
});

router.get('/callback', async (req, res) => {
  if (!hasClassroom()) return degrade(req, res);

  // This one is browser-facing, so it answers with a page rather than an error
  // object no matter what went wrong.
  try {
    if (req.query.error) {
      return res
        .status(400)
        .type('html')
        .send(page('Consent was not granted', `Google said: ${req.query.error}. The CSV export still works.`));
    }

    const pending = consumeState(req.query.state);
    if (!pending) {
      return res
        .status(400)
        .type('html')
        .send(
          page(
            'That sign-in link is stale',
            'The anti-CSRF state did not match one this server issued in the last ten minutes. Start again from Connect Google Classroom.',
          ),
        );
    }

    const code = String(req.query.code ?? '');
    if (!code) {
      return res
        .status(400)
        .type('html')
        .send(page('No authorisation code came back', 'Google returned no code. Start again from Connect Google Classroom.'));
    }

    // Which flow this was is decided by the state WE issued, never by anything
    // in the query string. A callback cannot talk its way into the other branch.
    if (pending.purpose?.kind === 'student') {
      const { sub, email } = await exchangeIdentityCode(code, pending.redirectUri);
      await linkGoogle(pending.purpose.accountId, { sub, email, source: 'student' });
      return res
        .type('html')
        .send(
          page(
            'Google account linked',
            `${email ? `${email} is now linked to your BloomLoop account. ` : ''}${LINK_PURPOSE}`,
          ),
        );
    }

    await exchangeCode(code, pending.redirectUri);
    return res.type('html').send(page('Google Classroom connected', 'BloomLoop can now post grades to one of your courses.'));
  } catch (err) {
    return res.status(400).type('html').send(page('Could not complete the connection', err.message));
  }
});

// ------------------------------------------------- the student's own link --
//
// Three routes, all reached by a signed-in account rather than a teacher. The
// consent itself lands on /callback above, which is ungated because it arrives
// from Google carrying none of our headers.
//
// requireAuth is applied HERE as well as at the mount in app.js, and the
// duplication is deliberate: these three are the only routes in the file that a
// non-teacher may reach, so the mount guard has to make an exception for them.
// An exception in one file and the requirement in another is how a router ends
// up ungated after an unrelated edit. Resolving is memoised per request, so the
// second check costs nothing.

/**
 * Whether this account has linked, and what linking is for.
 *
 * Answers even when the server has no Google credentials at all. A student who
 * linked before the credentials were pulled must still be able to SEE that and
 * unlink it - degrading this to a 400 would strand them holding a link they
 * cannot inspect or remove.
 */
router.get(
  '/link',
  requireAuth,
  guard(async (req, res) => {
    const account = await loadAccount(req);
    const link = hasSupabase() ? await getGoogleLink(account.id) : { linked: false, email: null, linkedAt: null, source: null };
    res.json({
      ...link,
      configured: hasClassroom(),
      purpose: LINK_PURPOSE,
      optional: LINK_OPTIONAL,
      // Why the button is missing, rather than a button that fails when pressed.
      reason: hasClassroom() ? '' : TIER1_REASON,
    });
  }),
);

/**
 * The consent URL for this account, fetched rather than navigated to - same
 * reason as the teacher's /auth-url above: a navigation carries no bearer token,
 * so a route that needs to know who is asking cannot be reached by one.
 */
router.get(
  '/link/auth-url',
  requireAuth,
  guard(async (req, res) => {
    if (!hasClassroom()) return degrade(req, res);
    const account = await loadAccount(req);
    const { url, redirectUri } = studentConsentUrl(req, account.id);
    res.json({ url, redirectUri, purpose: LINK_PURPOSE });
  }),
);

/**
 * Unlink. Works whether or not Google is configured, because it touches nothing
 * but our own row: a student must always be able to take this back, and needing
 * a working Google integration to withdraw consent would be the wrong way round.
 */
router.delete(
  '/link',
  requireAuth,
  guard(async (req, res) => {
    const account = await loadAccount(req);
    const link = await unlinkGoogle(account.id);
    res.json({ ...link, configured: hasClassroom(), purpose: LINK_PURPOSE, optional: LINK_OPTIONAL, reason: '' });
  }),
);

router.get(
  '/courses',
  guard(async (req, res) => {
    if (!hasClassroom()) return degrade(req, res);

    // teacherId=me: only courses this account can actually create coursework in.
    const courses = await collect('/courses', 'courses', { courseStates: 'ACTIVE', teacherId: 'me' });
    res.json({ courses: courses.map((course) => ({ id: String(course.id), name: course.name ?? '' })) });
  }),
);

/**
 * The roster of one course: who Google says is in it.
 *
 * This is the input to the roster import on the professor's home screen, and the
 * whole reason it exists is `userId`. Every other way BloomLoop has of deciding
 * which Google student a roll number belongs to is a comparison of strings a
 * human chose - rosterIndex() above normalises names and email fragments because
 * for a hand-typed roster there is nothing else to compare, and it writes the
 * wrong student's mark whenever two of them normalise alike. Carried onto an
 * invite and then onto the account, this id turns that guess into equality.
 *
 * `linked` is a convenience for the import UI, not a security boundary: it says
 * a BloomLoop account in this professor's department already carries that id, so
 * the screen can grey the row out instead of issuing an invite that could never
 * be redeemed. Best effort - if the accounts table cannot be read the import
 * still works and POST /api/auth/invite refuses the duplicate itself.
 *
 * Real students' names and addresses, so it sits behind the same teacher gate as
 * every other route in this file (see app.js) and nothing here is cached.
 */
router.get(
  '/course/:id/students',
  guard(async (req, res, next) => {
    if (!hasClassroom()) return degrade(req, res);

    const courseId = String(req.params.id ?? '').trim();
    if (!courseId) return next(Object.assign(new Error('A course id is required.'), { status: 400 }));

    const students = await collect(`/courses/${encodeURIComponent(courseId)}/students`, 'students');

    // Scoped to the caller's own department, which is the only place a roll
    // number is unique and the only set of accounts they can act on anyway.
    let linked = new Set();
    try {
      const department = req.viewer?.department ?? '';
      if (department) {
        linked = new Set((await listLinkedStudents(department)).map((s) => String(s.googleSub)));
      }
    } catch (err) {
      // A Google roster that loads is worth more than a hint that does not, and
      // the invite route re-checks before writing anything.
      console.error('[classroom] could not read linked students:', err.message);
    }

    res.json({
      courseId,
      students: students
        // A row Google could not identify is not importable: the userId is the
        // only field here with any authority behind it.
        .filter((s) => s?.userId)
        .map((s) => ({
          userId: String(s.userId),
          name: s.profile?.name?.fullName ?? '',
          // Absent unless the connected account holds the roster scope and the
          // school publishes addresses, so nothing downstream may require it.
          email: s.profile?.emailAddress ?? '',
          linked: linked.has(String(s.userId)),
        })),
    });
  }),
);

router.post(
  '/post',
  guard(async (req, res, next) => {
    if (!hasClassroom()) return degrade(req, res);

    const { code, courseId } = req.body ?? {};
    const roomCode = String(code ?? '').trim().toUpperCase();
    const course = String(courseId ?? '').trim();
    if (!roomCode) return next(Object.assign(new Error('A session code is required.'), { status: 400 }));
    if (!course) return next(Object.assign(new Error('A courseId is required.'), { status: 400 }));

    const repo = getRepo();
    const session = await repo.getSessionByCode(roomCode);
    if (!session) {
      return next(Object.assign(new Error(`No session with code ${roomCode}`), { status: 404 }));
    }

    // Ownership, like every other session route. Without this, anyone who could
    // reach this endpoint and read a room code off a projector could pull ANOTHER
    // professor's class results into a Classroom course of their own choosing -
    // every student's accuracy, posted under someone else's name. It is a write
    // on that session's results, so it takes the write check rather than the
    // read one; an HOD reads the department and does not push its grades.
    await assertCanWrite(req.viewer, session, `Session ${roomCode}`);

    const profiles = await repo.listProfiles(session._id);
    if (profiles.length === 0) {
      return next(
        Object.assign(new Error(`No students have joined ${roomCode}, so there is nothing to post.`), {
          status: 400,
        }),
      );
    }

    const base = `/courses/${encodeURIComponent(course)}`;
    const roster = rosterIndex(await collect(`${base}/students`, 'students'));

    // maxPoints 100 so the draft grade is literally the accuracy percentage the
    // teacher just watched on the dashboard.
    const courseWork = await callApi(`${base}/courseWork`, {
      method: 'POST',
      body: {
        title: session.title ? `${session.title} (BloomLoop ${roomCode})` : `BloomLoop session ${roomCode}`,
        description:
          `Draft grades are each student's overall accuracy across the BloomLoop adaptive session ${roomCode}. ` +
          'Per-level Bloom detail is in the CSV export.',
        workType: 'ASSIGNMENT',
        state: 'PUBLISHED',
        maxPoints: 100,
      },
    });

    const courseWorkId = String(courseWork.id ?? '');
    const submissionsPath = `${base}/courseWork/${encodeURIComponent(courseWorkId)}/studentSubmissions`;

    // Classroom fans the submissions out asynchronously, so a list taken in the
    // same breath as the create can come back empty and skip the whole class.
    // One retry costs a second and turns that into a working demo.
    let submissions = await collect(submissionsPath, 'studentSubmissions');
    if (submissions.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      submissions = await collect(submissionsPath, 'studentSubmissions');
    }
    const submissionByUser = new Map(submissions.map((s) => [s.userId, s.id]));

    /**
     * Roll number -> the Google identity that student actually proved.
     *
     * This is the whole reason the id is stored. Without it every mark is placed
     * by matchStudent(), which compares normalised names and email fragments -
     * a good guess, and a guess is not what a grade should rest on. Two students
     * called A. Kumar in one course is not an exotic case.
     *
     * Scoped to the caller's own department, which is the only scope where a
     * roll number is unique, and failing soft: a lookup that cannot run leaves
     * every student on the fuzzy path they were on before, which is worse but
     * not broken.
     */
    const exact = new Map();
    try {
      const department = req.viewer?.department ?? '';
      if (department) {
        for (const s of await listLinkedStudents(department)) {
          const key = norm(s.rollNo);
          if (!key || !s.googleSub) continue;
          const known = exact.get(key);
          // The same ambiguity guard rosterIndex() applies, for the same reason.
          // (department, roll_no) is unique in the table, but the key used here
          // is NORMALISED - 'cs21' and 'CS-21' are two perfectly lawful rows that
          // collapse onto one key. Poisoned to null rather than letting the last
          // row read win silently: an identity we are not certain of is not an
          // identity, and must not be dressed up as one.
          if (known === undefined) exact.set(key, { sub: s.googleSub, source: s.linkSource ?? 'unknown' });
          else if (known && known.sub !== s.googleSub) exact.set(key, null);
        }
      }
    } catch (err) {
      console.error('[classroom] identity lookup failed, falling back to name matching:', err.message);
    }

    const skipped = [];
    // 'roster' rather than 'name', because that is the word MATCHING_NOTE uses
    // to explain it and the note travels in this same payload. A response whose
    // counters and whose caveat call one thing by two names makes the reader
    // work out that they are the same thing.
    const matchedBy = { identity: 0, roster: 0 };
    // Of the identity placements, where that identity came from. Both are exact
    // joins and both beat guessing, but 'student' means the student signed into
    // Google and Google confirmed them, while 'roster' means a professor
    // imported a list and the student never confirmed they are that person.
    // Not the same evidence, so not reported as one number.
    const identityFrom = { student: 0, roster: 0, unknown: 0 };
    let posted = 0;

    for (const raw of profiles) {
      const profile = hydrate(raw);
      const entry = { rollNo: profile.rollNo, name: profile.name };

      // Exact first, and once it answers there is no second opinion.
      //
      // A student who signed into Google from their own account has TOLD us
      // which Google user they are. Falling back to name matching after that -
      // which is what "linked, but no submission under that id" used to do -
      // can only ever move the mark away from the person we had already
      // identified, onto whoever else happened to normalise alike. A null here
      // is the ambiguity guard above firing, which is a different thing from
      // "not linked" and correctly lands on the fuzzy path.
      const link = exact.get(norm(profile.rollNo));
      const how = link ? 'identity' : 'roster';
      const userId = link ? link.sub : matchStudent(roster, profile);

      if (!userId) {
        skipped.push({ ...entry, via: how, reason: 'no Classroom student matches this roll number' });
        continue;
      }

      const submissionId = submissionByUser.get(userId);
      if (!submissionId) {
        skipped.push({
          ...entry,
          via: how,
          // Two different situations wearing one sentence helps nobody: one is
          // "Classroom has not caught up", the other is "we know exactly who
          // this is and they are not in this course".
          reason:
            how === 'identity'
              ? 'this student’s linked Google account is not in this course, and nothing was guessed in its place'
              : 'Classroom created no submission for this student',
        });
        continue;
      }

      const accuracy = overallAccuracy(profile);
      try {
        await callApi(`${submissionsPath}/${encodeURIComponent(submissionId)}`, {
          method: 'PATCH',
          query: { updateMask: 'draftGrade' },
          body: { draftGrade: accuracy === null ? 0 : Math.round(accuracy * 100) },
        });
        posted += 1;
        // Counted where the mark actually LANDED. Counting it at the match
        // instead would report an identity placement for a student who was then
        // skipped, and the number a teacher trusts would be describing marks
        // that were never written.
        matchedBy[how] += 1;
        if (link) identityFrom[link.source] = (identityFrom[link.source] ?? 0) + 1;
      } catch (err) {
        // One unwritable submission must not lose the other thirty grades.
        skipped.push({ ...entry, via: how, reason: err.message });
      }
    }

    res.json({
      ok: true,
      courseWorkId,
      posted,
      skipped,
      // Said out loud on purpose. "34 posted" hides the difference between a
      // mark placed on a verified identity and one placed on a name that looked
      // close enough, and only one of those is worth trusting unread.
      matchedBy,
      identityFrom,
      // The caveat travels with the payload rather than being restated on the
      // screen that renders it, so the two cannot drift and end up overclaiming
      // in different words. Same rule as HONESTY in services/integrity.js.
      matching: MATCHING_NOTE,
    });
  }),
);

export default router;
