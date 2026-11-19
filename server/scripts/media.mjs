// Phase 2 - images and passages as question stimuli, end to end.
//
//   node server/scripts/media.mjs
//
// Drives a REAL server (the same createApp and attachSockets the production
// server uses) on the in-process store, with the shared teacher key and offline
// generation, and checks:
//
//   upload      PNG, JPEG and WebP are taken, each told by its bytes; SVG, a file
//               named and typed as a PNG that is not one, an oversized file, a
//               missing description and no credentials are refused
//   ownership   another professor's chapter gets the same 404 as no chapter, and
//               their upload cannot be put on a question or read with the key
//   serving     the teacher reads an image at any time, with the type, nosniff,
//               the long private cache and the sha256 ETag (a 304 on revalidate);
//               a phone, with no credential, only while a room runs on the chapter
//               and an approved question shows the image
//   stimuli     an upload attached to a question (alt filled from the upload, the
//               slide-only check cleared), a passage with a citation shared by
//               several questions, and both reaching a phone through the socket
//
// Never calls Gemini or any network service: the key is blanked below whatever
// server/.env says. Exits non-zero on any failure.

import crypto from 'node:crypto';
import http from 'node:http';
import { Server } from 'socket.io';
import { io as ioClient } from 'socket.io-client';

const SRC = new URL('../src/', import.meta.url).href;
const { initStore, getRepo, closeStore } = await import(`${SRC}repo/index.js`);
const { createApp } = await import(`${SRC}app.js`);
const { attachSockets } = await import(`${SRC}sockets/index.js`);
const { config } = await import(`${SRC}config.js`);
const { SAMPLE } = await import(`${SRC}sampleContent.js`);

// The in-process store and the offline templates, whatever .env says: this
// suite must not touch a database or a model, nor depend on reaching one.
config.supabase.url = '';
config.supabase.serviceKey = '';
config.mongoUri = '';
config.gemini.apiKey = '';
await initStore({ log: () => {} });
const repo = getRepo();

const app = createApp();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
attachSockets(io);
app.set('io', io);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const H = { 'x-teacher-key': config.teacherKey };

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}`);
  if (ok) pass += 1; else fail += 1;
};

async function call(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { ...H, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const get = (p) => call('GET', p);
const post = (p, body = {}) => call('POST', p, body);
const patch = (p, body) => call('PATCH', p, body);

/** POST /api/media as a browser form would send it. `alt: null` leaves the field out; undefined is the default. */
async function upload({ bytes, name = 'image.png', type = 'image/png', contentId, alt = 'A labelled diagram of a leaf', headers = H }) {
  const form = new FormData();
  if (contentId !== undefined) form.append('contentId', contentId);
  if (alt !== null) form.append('alt', alt);
  if (bytes !== undefined) form.append('file', new Blob([bytes], { type }), name);
  const res = await fetch(`${base}/api/media`, { method: 'POST', headers, body: form });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

/** GET an image, raw. */
async function image(url, headers = {}) {
  const res = await fetch(base + url, { headers });
  return { status: res.status, headers: res.headers, buf: Buffer.from(await res.arrayBuffer()) };
}

function connect() {
  const s = ioClient(base, { transports: ['websocket'], reconnection: false });
  return new Promise((resolve, reject) => {
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
}

function either(socket, events, ms = 4000) {
  return new Promise((resolve, reject) => {
    const handlers = {};
    const timer = setTimeout(() => {
      for (const [e, h] of Object.entries(handlers)) socket.off(e, h);
      reject(new Error(`timeout waiting for ${events.join(' / ')}`));
    }, ms);
    for (const e of events) {
      handlers[e] = (p) => {
        clearTimeout(timer);
        for (const [e2, h] of Object.entries(handlers)) socket.off(e2, h);
        resolve({ name: e, payload: p });
      };
      socket.on(e, handlers[e]);
    }
  });
}

/** A phone joins the room and reports the first question it is served. */
async function phoneJoins(code, rollNo) {
  const s = await connect();
  const first = either(s, ['server:question', 'server:exhausted', 'session:rejected']);
  s.emit('student:join', { code, rollNo, name: rollNo });
  const event = await first;
  s.close();
  return event;
}

// ------------------------------------------------------------ fixtures --

// A real 1x1 PNG. The JPEG and WebP carry their signatures and filler, which is
// all the server reads of them; the server never decodes an image.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(60)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x40, 0, 0, 0]), Buffer.from('WEBPVP8L'), crypto.randomBytes(52)]);
const SVG = Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.cookie)</script></svg>');
const HTML = Buffer.from('<!doctype html><script>alert(document.cookie)</script>');
const GIF = Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const MAX = config.media.maxBytes;
const sized = (n) => Buffer.concat([PNG.subarray(0, 8), Buffer.alloc(n - 8, 7)]);

const content = await post('/api/content', { title: 'Leaves', text: SAMPLE.rawText });
const contentId = content.body.contentId;
const second = await post('/api/content', { title: 'Another chapter', text: SAMPLE.rawText });
const NOWHERE = 'ffffffffffffffffffffffff';

// --------------------------------------------------------------- upload --

console.log('\nupload: PNG, JPEG and WebP, each told by its own bytes');
const up = {};
for (const [key, bytes, name, type, mime] of [
  ['png', PNG, 'leaf.png', 'image/png', 'image/png'],
  ['jpeg', JPEG, 'leaf.jpg', 'image/jpeg', 'image/jpeg'],
  ['webp', WEBP, 'leaf.webp', 'image/webp', 'image/webp'],
]) {
  const r = await upload({ bytes, name, type, contentId, alt: `  A ${key} of a leaf,\n in cross-section  ` });
  const m = r.body.media;
  up[key] = m;
  check(`a ${key.toUpperCase()} is taken`, r.status === 201 && m?.mime === mime && m?.bytes === bytes.length
    && m?.sha256 === sha(bytes) && m?.url === `/api/media/${m?._id}` && m?.contentId === contentId,
  `${r.status} ${r.body.error ?? `${m?.mime} ${m?.bytes} bytes`}`);
}
check('its description is kept, whitespace tidied', up.png?.alt === 'A png of a leaf, in cross-section', JSON.stringify(up.png?.alt));
check('created by nobody on the shared key', up.png?.ownerId === null);
{
  const r = await upload({ bytes: PNG, name: 'photo.jpg', type: 'image/jpeg', contentId });
  check('a PNG sent as photo.jpg, image/jpeg, is stored as the PNG it is', r.status === 201 && r.body.media?.mime === 'image/png',
    `${r.status} ${r.body.media?.mime}`);
  up.relabelled = r.body.media;
}

console.log('\nupload: what a camera wrote into the file is taken out');
{
  const seg = (marker, body) => {
    const b = Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1');
    const head = Buffer.from([0xff, marker, 0, 0]);
    head.writeUInt16BE(b.length + 2, 2);
    return Buffer.concat([head, b]);
  };
  const SOI = Buffer.from([0xff, 0xd8]);
  const picture = [seg(0xdb, Buffer.alloc(65, 1)), seg(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])), Buffer.from([0x12, 0x34, 0xff, 0xd9])];
  // As a phone writes it: Exif saying where it was taken, a comment, and a second
  // picture after the end of the first.
  const photo = Buffer.concat([
    SOI, seg(0xe1, 'Exif\0\0MM\0\x2a\0\0\0\x08\0\0\0\0\0\0GPS 12.9716N 77.5946E'), seg(0xfe, 'taken at 12 Home Street'),
    ...picture, Buffer.from('a second picture, GPS and all', 'latin1'),
  ]);
  const clean = Buffer.concat([SOI, ...picture]);
  const r = await upload({ bytes: photo, name: 'IMG_0001.jpg', type: 'image/jpeg', contentId });
  const m = r.body.media;
  check('a JPEG carrying a location is stored without it: size and hash are of what is kept', r.status === 201
    && m?.bytes === clean.length && m?.sha256 === sha(clean), `${r.status} ${r.body.error ?? `${m?.bytes} bytes`}`);
  const served = await image(m?.url ?? '/api/media/x', H);
  check('and served without it, the picture itself byte for byte', served.status === 200 && served.buf.equals(clean)
    && !served.buf.includes(Buffer.from('GPS')) && !served.buf.includes(Buffer.from('Home Street')), `${served.status} ${served.buf.length} bytes`);
}

console.log('\nupload: what is refused');
{
  const svg = await upload({ bytes: SVG, name: 'diagram.svg', type: 'image/svg+xml', contentId });
  check('an SVG is refused, saying why', svg.status === 415 && /SVG/.test(svg.body.error ?? '') && /script/.test(svg.body.error ?? ''),
    `${svg.status} ${svg.body.error}`);
  const asPng = await upload({ bytes: SVG, name: 'diagram.png', type: 'image/png', contentId });
  check('the same SVG named diagram.png and typed image/png is refused too', asPng.status === 415 && /SVG/.test(asPng.body.error ?? ''),
    `${asPng.status} ${asPng.body.error}`);
  const html = await upload({ bytes: HTML, name: 'photo.jpg', type: 'image/jpeg', contentId });
  check('a page of script named photo.jpg, typed image/jpeg, is refused by its contents', html.status === 415
    && /checked by its contents/.test(html.body.error ?? ''), `${html.status} ${html.body.error}`);
  const gif = await upload({ bytes: GIF, name: 'leaf.gif', type: 'image/gif', contentId });
  check('a GIF is refused', gif.status === 415, `${gif.status}`);

  const big = await upload({ bytes: sized(MAX + 1), contentId });
  check(`one byte over the limit (${MAX} bytes) is refused with 413 and the limit named`, big.status === 413
    && /500 KB limit/.test(big.body.error ?? ''), `${big.status} ${big.body.error}`);
  const edge = await upload({ bytes: sized(MAX), contentId });
  check('exactly the limit is taken', edge.status === 201, `${edge.status} ${edge.body.error ?? ''}`);
  up.unused = edge.body.media;

  const noAlt = await upload({ bytes: PNG, contentId, alt: null });
  const blankAlt = await upload({ bytes: PNG, contentId, alt: '   ' });
  check('no description, or a blank one, is refused', noAlt.status === 400 && blankAlt.status === 400
    && /Describe the image/.test(noAlt.body.error ?? ''), `${noAlt.status} / ${blankAlt.status}`);
  const longAlt = await upload({ bytes: PNG, contentId, alt: 'x'.repeat(1001) });
  check('a description over 1000 characters is refused', longAlt.status === 400, `${longAlt.status}`);
  const noFile = await upload({ contentId });
  check('no file is refused', noFile.status === 400, `${noFile.status} ${noFile.body.error}`);
  const json = await post('/api/media', { contentId, alt: 'x', file: PNG.toString('base64') });
  check('JSON instead of a form is refused, saying what to send', json.status === 400 && /multipart/.test(json.body.error ?? ''),
    `${json.status}`);
  const anon = await upload({ bytes: PNG, contentId, headers: {} });
  check('no credentials, no upload', anon.status === 401, `${anon.status}`);
}

// ------------------------------------------------------------ ownership --

console.log('\nanother professor\'s chapter: the same 404 as no chapter at all');
const theirs = await repo.createContent({
  title: 'Not yours', kind: 'syllabus', rawText: SAMPLE.rawText, topics: SAMPLE.topics.slice(0, 1),
  ownerId: '33333333-3333-4333-8333-333333333333',
});
const theirMedia = await repo.createMedia({
  ownerId: '33333333-3333-4333-8333-333333333333', contentId: theirs._id, mime: 'image/png', bytes: PNG.length,
  sha256: sha(PNG), data: PNG, alt: 'Theirs',
});
{
  const a = await upload({ bytes: PNG, contentId: theirs._id });
  const b = await upload({ bytes: PNG, contentId: NOWHERE });
  const c = await upload({ bytes: PNG, contentId: 'not-an-id' });
  const d = await upload({ bytes: PNG });
  check('uploading onto their chapter is refused like a chapter that does not exist', a.status === 404
    && [b, c, d].every((r) => r.status === a.status && r.body.error === a.body.error)
    && a.body.error === 'That content was not found.', `"${a.body.error}" / "${b.body.error}" / "${c.body.error}" / "${d.body.error}"`);
  const svgTheirs = await upload({ bytes: SVG, name: 'x.svg', type: 'image/svg+xml', contentId: theirs._id });
  check('and says nothing about the file first', svgTheirs.status === 404, `${svgTheirs.status}`);
  const read = await image(`/api/media/${theirMedia._id}`, H);
  check('the shared key cannot read their upload', read.status === 404, `${read.status}`);
}

// -------------------------------------------------------------- serving --

console.log('\nserving to a teacher');
const PNG_URL = up.png.url;
{
  const r = await image(PNG_URL, H);
  check('the teacher gets the bytes, byte for byte', r.status === 200 && r.buf.equals(PNG), `${r.status}`);
  check('as the type its bytes were checked to be', r.headers.get('content-type') === 'image/png', r.headers.get('content-type'));
  check('with nosniff', r.headers.get('x-content-type-options') === 'nosniff');
  check('cached long, privately', r.headers.get('cache-control') === 'private, max-age=31536000, immutable', r.headers.get('cache-control'));
  check('under its sha256', r.headers.get('etag') === `"${sha(PNG)}"`, r.headers.get('etag'));
  check('and running nothing if opened on its own', /sandbox/.test(r.headers.get('content-security-policy') ?? ''));
  // Cache-Control sent explicitly, as a browser revalidating does: Node's fetch
  // otherwise adds "no-cache" to any request carrying If-None-Match, which
  // rightly asks the server for the full response.
  const again = await image(PNG_URL, { ...H, 'If-None-Match': `"${sha(PNG)}"`, 'Cache-Control': 'max-age=0' });
  check('a revalidation with that ETag is a 304 with nothing sent', again.status === 304 && again.buf.length === 0, `${again.status}`);
  const keyed = await image(`${PNG_URL}?key=${config.teacherKey}`);
  check('the key in the url works, for an <img> in the console', keyed.status === 200 && keyed.buf.equals(PNG), `${keyed.status}`);
  const relabelled = await image(up.relabelled.url, H);
  check('the PNG sent as a JPEG is served as image/png', relabelled.headers.get('content-type') === 'image/png');
}

console.log('\nserving to a phone, before any room');
{
  const r = await image(PNG_URL);
  check('no credential, no room: 404', r.status === 404 && JSON.parse(r.buf.toString()).error === 'That image was not found.', `${r.status}`);
  check('and the refusal is not cached', r.headers.get('cache-control') === 'no-store', r.headers.get('cache-control'));
  const wrongKey = await image(PNG_URL, { 'x-teacher-key': 'WRONG' });
  check('a wrong key is judged as a phone: the same 404, not a 401', wrongKey.status === 404, `${wrongKey.status}`);
  const missing = await image(`/api/media/${NOWHERE}`, H);
  const malformed = await image('/api/media/not-an-id', H);
  check('an id that does not exist, or is not an id, is the same 404', missing.status === 404 && malformed.status === 404
    && missing.buf.equals(r.buf) && malformed.buf.equals(r.buf));
}

// -------------------------------------------------------------- stimuli --

console.log('\nan image on a question');
await post('/api/generate', { contentId, topics: SAMPLE.topics.slice(0, 2), plan: { perTopic: 12 } });
await post(`/api/bank/${contentId}/approve-all`);
let active = (await get(`/api/bank/${contentId}`)).body.questions.filter((q) => q.status === 'active');
const target = active.find((q) => q.kind === 'mcq');
{
  // With nothing attached: since 19 Nov 2026 a passage clears the check too, and
  // an offline-template question may carry a shared reading, so it goes first.
  const pointed = await patch(`/api/bank/question/${target._id}`, { text: 'Which term does the diagram label X?', stimulus: null });
  const flag = (q) => q?.checks?.find((c) => c.id === 'slide-only-reference');
  check('a stem pointing at a diagram, with nothing attached, is flagged by the slide-only check',
    pointed.status === 200 && flag(pointed.body.question)?.ok === false, `${pointed.status} ${pointed.body.error ?? ''}`);
  const attached = await patch(`/api/bank/question/${target._id}`, {
    stimulus: { kind: 'image', url: `/API/Media/${up.png._id.toUpperCase()}` },
  });
  const s = attached.body.question?.stimulus;
  check('attaching the upload is accepted', attached.status === 200, `${attached.status} ${attached.body.error ?? ''}`);
  check('stored under its canonical url, with the upload\'s description', s?.url === PNG_URL && s?.alt === up.png.alt,
    JSON.stringify(s));
  check('and the slide-only check now passes', flag(attached.body.question)?.ok === true);
  check('the question stays approved', attached.body.question?.status === 'active');
}
{
  const other = active.find((q) => q.kind === 'mcq' && q._id !== target._id);
  const before = await repo.getQuestion(other._id);
  const mine2 = await upload({ bytes: PNG, contentId: second.body.contentId });
  const tries = [];
  for (const url of [theirMedia._id, NOWHERE, mine2.body.media._id].map((id) => `/api/media/${id}`).concat('/api/media/nope')) {
    tries.push(await patch(`/api/bank/question/${other._id}`, { stimulus: { kind: 'image', url, alt: 'x' } }));
  }
  check('their upload, a missing one, my other chapter\'s and a malformed url are one 404, word for word',
    tries.every((t) => t.status === 404 && t.body.error === 'That image was not found.'), tries.map((t) => `${t.status} ${t.body.error}`).join(' / '));
  // Spellings a browser resolves to the same route. Each used to be stored as given.
  const spelt = [];
  for (const url of [`/api/./media/${theirMedia._id}`, `/./api/media/${theirMedia._id}`, `/api/x/../media/${theirMedia._id}`, `${base}/api/media/${theirMedia._id}`]) {
    spelt.push(await patch(`/api/bank/question/${other._id}`, { stimulus: { kind: 'image', url, alt: 'x' } }));
  }
  const bulkSpelt = await post('/api/bank/bulk', { ids: [other._id], action: 'stimulus', stimulus: { kind: 'image', url: `/api/./media/${theirMedia._id}`, alt: 'x' } });
  check('and so is their upload under any other spelling that reaches the same route', spelt.every((t) => t.status === 404 && t.body.error === 'That image was not found.')
    && bulkSpelt.body.changed === 0 && bulkSpelt.body.refused?.[0]?.reason === 'That image was not found.',
  `${spelt.map((t) => t.status).join(' / ')}; bulk ${bulkSpelt.body.changed} changed`);
  check('and the question is left as it was', JSON.stringify(await repo.getQuestion(other._id)) === JSON.stringify(before));
  const mineSpelt = await patch(`/api/bank/question/${other._id}`, { stimulus: { kind: 'image', url: `${base}/api/./media/${up.relabelled._id}`, alt: 'A leaf' } });
  check('my own upload under another spelling is stored canonical, so phones can be served it', mineSpelt.status === 200
    && mineSpelt.body.question?.stimulus?.url === up.relabelled.url, `${mineSpelt.status} ${JSON.stringify(mineSpelt.body.question?.stimulus)}`);
  await patch(`/api/bank/question/${other._id}`, { stimulus: null });
}
let own = null;
{
  const r = await post(`/api/bank/${contentId}/questions`, {
    text: 'Which layer does the photograph show?', bloom: 'remember', kind: 'mcq',
    options: ['Palisade layer.', 'Cuticle.', 'Xylem.', 'Phloem.'], answerIdx: 0,
    stimulus: { kind: 'image', url: up.jpeg.url, alt: 'A micrograph of a leaf' },
  });
  own = r.body.question;
  check('a professor\'s own question can carry an upload, with its own description', r.status === 201
    && own?.stimulus?.url === up.jpeg.url && own?.stimulus?.alt === 'A micrograph of a leaf', `${r.status} ${r.body.error ?? ''}`);
  const bad = await post(`/api/bank/${contentId}/questions`, {
    text: 'Which?', bloom: 'remember', kind: 'mcq', options: ['a1', 'b2', 'c3', 'd4'], answerIdx: 0,
    stimulus: { kind: 'image', url: `/api/media/${theirMedia._id}`, alt: 'x' },
  });
  check('but not their upload', bad.status === 404 && bad.body.error === 'That image was not found.', `${bad.status}`);
}
let draft = null;
{
  const r = await post(`/api/bank/question/${active.find((q) => q.bloom === 'remember' && q._id !== target._id)._id}/regenerate`, { direction: 'harder' });
  draft = r.body.question;
  const put = await patch(`/api/bank/question/${draft._id}`, { stimulus: { kind: 'image', url: up.webp.url } });
  check('a draft can carry one too', put.status === 200 && put.body.question?.status === 'draft' && put.body.question?.stimulus?.url === up.webp.url,
    `${put.status} ${put.body.error ?? ''}`);
}

console.log('\na passage shared by several questions');
const PASSAGE = {
  kind: 'passage',
  text: 'The transport layer gives each application its own conversation. TCP numbers every byte and resends what is lost; UDP sends each datagram once and moves on.',
  sourceRef: 'Kurose and Ross, ch. 3',
};
active = (await get(`/api/bank/${contentId}`)).body.questions.filter((q) => q.status === 'active');
const ids = active.map((q) => q._id);
{
  const missing = await post('/api/bank/bulk', { ids, action: 'stimulus' });
  check('sharing with no stimulus named is refused', missing.status === 400, `${missing.status} ${missing.body.error}`);
  const long = await post('/api/bank/bulk', { ids: ids.slice(0, 2), action: 'stimulus', stimulus: { ...PASSAGE, text: 'x'.repeat(4001) } });
  check('a passage over 4000 characters is refused on every question, with the validator\'s words',
    long.body.changed === 0 && long.body.refused?.length === 2 && long.body.refused.every((r) => r.reason === 'stimulus text is over 4000 characters'));
  const cite = await patch(`/api/bank/question/${ids[0]}`, { stimulus: { ...PASSAGE, sourceRef: 'x'.repeat(301) } });
  check('a citation over 300 characters is refused', cite.status === 400 && /sourceRef is over 300/.test(cite.body.error ?? ''), `${cite.status}`);

  const shared = await post('/api/bank/bulk', { ids, action: 'stimulus', stimulus: PASSAGE });
  check('one passage onto every approved question at once', shared.status === 200 && shared.body.changed === ids.length && shared.body.refused.length === 0,
    `${shared.body.changed} of ${ids.length}, refused ${JSON.stringify(shared.body.refused?.slice(0, 2))}`);
  const stored = await Promise.all(ids.map((id) => repo.getQuestion(id)));
  check('each holds its own equal copy, citation included', stored.every((q) => JSON.stringify(q.stimulus) === JSON.stringify(PASSAGE)));
  check('and stays approved, its checks re-run', stored.every((q) => q.status === 'active' && Array.isArray(q.checks)));
}

// ----------------------------------------------------------------- room --

console.log('\nthe room: a passage and an image reach the phone');
const opened = await post('/api/session', { contentId, title: 'Leaves, period 2' });
const code = opened.body.code;
check('the room opens', opened.status === 200 && Boolean(code), `${opened.status} ${opened.body.error ?? ''}`);
{
  const e = await phoneJoins(code, 'MEDIA-01');
  const st = e.payload?.question?.stimulus;
  check('a phone is served a question with the passage', e.name === 'server:question' && st?.kind === 'passage', e.name);
  check('the text and nothing else: no citation, no stray field', JSON.stringify(st) === JSON.stringify({ kind: 'passage', text: PASSAGE.text }),
    JSON.stringify(st));
}
{
  const shared = await post('/api/bank/bulk', { ids, action: 'stimulus', stimulus: { kind: 'image', url: PNG_URL } });
  check('the image onto every approved question, with the room open', shared.body.changed === ids.length, `${shared.body.changed} of ${ids.length}`);
  const e = await phoneJoins(code, 'MEDIA-02');
  const st = e.payload?.question?.stimulus;
  check('a phone joining now is served a question with the image',
    e.name === 'server:question' && JSON.stringify(st) === JSON.stringify({ kind: 'image', url: PNG_URL, alt: up.png.alt }), JSON.stringify(st));
  const r = await image(st?.url ?? PNG_URL);
  check('and loads it with no credential at all', r.status === 200 && r.buf.equals(PNG) && r.headers.get('content-type') === 'image/png',
    `${r.status}`);
}
{
  const onDraft = await image(up.webp.url);
  check('an image only a draft shows is still not served to phones', onDraft.status === 404, `${onDraft.status}`);
  const replaced = await image(up.jpeg.url);
  check('nor one no approved question shows any more (replaced by the shared image)', replaced.status === 404, `${replaced.status}`);
  const unused = await image(up.unused.url);
  check('nor one attached to nothing', unused.status === 404, `${unused.status}`);
  const theirsNow = await image(`/api/media/${theirMedia._id}`);
  check('nor another chapter\'s', theirsNow.status === 404, `${theirsNow.status}`);
}
{
  await post(`/api/session/${code}/pause`);
  const paused = await image(PNG_URL);
  check('while the room is paused, the phones still load it', paused.status === 200, `${paused.status}`);
  await post(`/api/session/${code}/resume`);
  await post(`/api/session/${code}/close`);
  const closed = await image(PNG_URL);
  check('once the room closes, a phone gets 404', closed.status === 404, `${closed.status}`);
  const teacher = await image(PNG_URL, H);
  check('the teacher still reads it', teacher.status === 200 && teacher.buf.equals(PNG), `${teacher.status}`);
}
{
  const off = await post('/api/bank/bulk', { ids: ids.slice(0, 3), action: 'stimulus', stimulus: null });
  const after = await Promise.all(ids.slice(0, 3).map((id) => repo.getQuestion(id)));
  check('null takes the stimulus off again', off.body.changed === 3 && after.every((q) => q.stimulus === null), `${off.body.changed}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
io.close();
server.close();
await closeStore().catch(() => {});
process.exit(fail ? 1 : 0);
