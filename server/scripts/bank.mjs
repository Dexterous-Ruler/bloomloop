// Phase 2 - the approval gate, end to end.
//
//   node server/scripts/bank.mjs
//
// Drives a REAL server (the same createApp and attachSockets the production
// server uses) on the in-process store, with the shared teacher key and offline
// generation, and checks what the approval gate changed:
//
//   provenance   a generated question is a draft carrying its model, the slides
//                its topic came from (a .pptx built here) and its rule checks
//   the gate     a room on a bank of drafts is refused with a clear message;
//                approve one or all, and the room serves; a rejected question
//                and a draft are never served, nor accepted as an answer
//   own          a professor's own question is created active, checked as advice
//   up / down    Harder and Easier write a new draft one level up or down and
//                leave the original alone; the ends of the ladder are refused
//   ownership    the shared key gets the same 404 on another professor's bank
//                as on one that does not exist
//
// Never calls Gemini or any network service: the key is blanked below whatever
// server/.env says. Exits non-zero on any failure.

import http from 'node:http';
import { Server } from 'socket.io';
import { io as ioClient } from 'socket.io-client';
import AdmZip from 'adm-zip';

const SRC = new URL('../src/', import.meta.url).href;
const { initStore, getRepo, closeStore } = await import(`${SRC}repo/index.js`);
const { createApp } = await import(`${SRC}app.js`);
const { attachSockets } = await import(`${SRC}sockets/index.js`);
const { config } = await import(`${SRC}config.js`);
const { SAMPLE } = await import(`${SRC}sampleContent.js`);
const { LEVELS } = await import(`${SRC}bloom.js`);
const { CHECK_IDS, isSelectedResponse } = await import(`${SRC}services/checks.js`);

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

function connect() {
  const s = ioClient(base, { transports: ['websocket'], reconnection: false });
  return new Promise((resolve, reject) => {
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
}

/** Resolves with whichever of the events arrives first. */
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

// ---------------------------------------------------------- the deck --

// The sample chapter as a real .pptx: every topic over two slides, its title
// repeated on the second, the way a lecturer continues a topic. So topic i is
// read from slides 2i+1 and 2i+2.
function buildDeck() {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const slide = (lines) =>
    '<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree>' +
    `${lines.map((l) => `<a:p><a:r><a:t>${esc(l)}</a:t></a:r></a:p>`).join('')}</p:spTree></p:cSld></p:sld>`;
  const zip = new AdmZip();
  let n = 0;
  for (const para of SAMPLE.rawText.trim().split(/\n\s*\n/)) {
    const [title, ...body] = para.split('\n').map((l) => l.trim()).filter(Boolean);
    const half = Math.ceil(body.length / 2);
    for (const part of [body.slice(0, half), body.slice(half)]) {
      n += 1;
      zip.addFile(`ppt/slides/slide${n}.xml`, Buffer.from(slide([title, ...part]), 'utf8'));
    }
  }
  return { buffer: zip.toBuffer(), slides: n };
}

const deck = buildDeck();
const form = new FormData();
form.append('file', new Blob([deck.buffer]), 'Transport layer.pptx');
const upload = await fetch(`${base}/api/content?ocr=off`, { method: 'POST', headers: H, body: form });
const uploaded = await upload.json();
const contentId = uploaded.contentId;
const content = (await get(`/api/content/${contentId}`)).body.content;
const topics = uploaded.topics.slice(0, 3);

console.log('\nprovenance: a generated question is a draft that says where it came from');
check('the deck uploads and its topics are read', upload.status === 201 && topics.length === 3,
  `${uploaded.topics?.length} topics from ${deck.slides} slides`);
check('the content keeps the slides each topic was read from',
  JSON.stringify(content.topicSlides?.[topics[0]]) === '[1,2]' && JSON.stringify(content.topicSlides?.[topics[2]]) === '[5,6]',
  JSON.stringify(content.topicSlides));

const gen = await post('/api/generate', { contentId, topics, plan: { perTopic: 12 } });
check('generation answers', gen.status === 200, gen.body.error ?? '');
check('it reports drafts, not a bank a room can serve',
  gen.body.generated >= 30 && gen.body.drafts === gen.body.generated && gen.body.bankCount === 0,
  `generated ${gen.body.generated}, drafts ${gen.body.drafts}, bankCount ${gen.body.bankCount}, flagged ${gen.body.flagged}`);

let bank = (await get(`/api/bank/${contentId}`)).body;
const generated = bank.questions;
check('every generated question is saved as a draft', generated.length > 0 && generated.every((q) => q.status === 'draft'));
check('with model "offline-template" (the key is blank, so no model was asked)',
  generated.every((q) => q.model === 'offline-template' && q.source === 'fallback'));
check('with the slides of its topic',
  generated.every((q) => JSON.stringify(q.sourceRef) === JSON.stringify({ kind: 'slides', slides: content.topicSlides[q.topic] })),
  JSON.stringify(generated[0]?.sourceRef));
check('with its rule checks filled',
  generated.every((q) => Array.isArray(q.checks) && q.checks.length >= 2
    && q.checks.every((c) => CHECK_IDS.includes(c.id) && typeof c.ok === 'boolean' && c.message)));
check('created by nobody on the shared-key path, approved by nobody yet',
  generated.every((q) => q.createdBy === null && q.approvedBy === null && q.approvedAt === null));
check('the bank counts them as drafts, not as active', bank.active === 0 && bank.drafts === generated.length
  && LEVELS.every((l) => bank.counts[l] === 0));
const listed = (await get('/api/content')).body.contents.find((c) => c._id === contentId);
check('the content list shows them as drafts waiting', listed?.questionCount === 0 && listed?.draftCount === generated.length,
  `questionCount ${listed?.questionCount}, draftCount ${listed?.draftCount}`);

{
  const pasted = await post('/api/content', { title: 'Pasted', text: SAMPLE.rawText });
  const g = await post('/api/generate', { contentId: pasted.body.contentId, topics: SAMPLE.topics.slice(0, 1), plan: { perTopic: 6 } });
  const qs = (await get(`/api/bank/${pasted.body.contentId}`)).body.questions;
  check('pasted text gives drafts with no slide reference', g.status === 200 && qs.length > 0
    && qs.every((q) => q.status === 'draft' && q.sourceRef === null));
}

// ------------------------------------------------------------- the gate --

console.log('\nthe gate: a room serves approved questions only');
{
  const refused = await post('/api/session', { contentId, title: 'All drafts' });
  check('a room on a bank of drafts is refused', refused.status === 409, `HTTP ${refused.status}`);
  check('and the message says why and what to do',
    /waiting for your approval/.test(refused.body.error ?? '') && /approve them in the question bank first/.test(refused.body.error ?? ''),
    refused.body.error);
}

// A draft edited to carry a flaw: still a draft after the edit, and its checks
// follow the new wording.
const remember = generated.filter((q) => q.bloom === 'remember' && q.kind === 'mcq');
const flawed = remember[0];
{
  const options = [...flawed.options];
  const spare = options.findIndex((_, i) => i !== flawed.answerIdx);
  options[spare] = 'None of the above.';
  const edited = await patch(`/api/bank/question/${flawed._id}`, { options });
  check('editing a draft keeps it a draft', edited.status === 200 && edited.body.question?.status === 'draft');
  check('and runs its checks again on the new wording',
    edited.body.question?.checks?.some((c) => c.id === 'all-none-of-the-above' && c.ok === false));

  const approved = await post(`/api/bank/question/${flawed._id}/approve`);
  const q = approved.body.question;
  check('a draft whose checks fail can still be approved', approved.status === 200 && q?.status === 'active' && approved.body.changed === true);
  check('but the reply says which checks failed',
    approved.body.failedChecks?.some((c) => c.id === 'all-none-of-the-above' && c.message), JSON.stringify(approved.body.failedChecks));
  check('approval records when, and nobody on the shared key', Boolean(q?.approvedAt) && q?.approvedBy === null);
  const again = await post(`/api/bank/question/${flawed._id}/approve`);
  check('approving again changes nothing', again.status === 200 && again.body.changed === false && again.body.question?.approvedAt === q?.approvedAt);

  const edit2 = await patch(`/api/bank/question/${flawed._id}`, { text: `${flawed.text} (edited)` });
  check('editing an active question keeps it active and approved',
    edit2.status === 200 && edit2.body.question?.status === 'active' && edit2.body.question?.approvedAt === q?.approvedAt);
}

const rejected = remember[1];
{
  const r = await post(`/api/bank/question/${rejected._id}/reject`);
  check('reject sets the existing discarded status', r.status === 200 && r.body.question?.status === 'discarded' && r.body.changed === true);
}

// The console's older "restore" (PATCH status active) on a draft is an approval
// too, and is recorded as one.
const restored = remember[2];
{
  const r = await patch(`/api/bank/question/${restored._id}`, { status: 'active' });
  check('a draft set active by PATCH is approved, with the time recorded',
    r.status === 200 && r.body.question?.status === 'active' && Boolean(r.body.question?.approvedAt));
  const d = await patch(`/api/bank/question/${restored._id}`, { status: 'draft' });
  check('nothing can be PATCHed back into a draft', d.status === 400);
}

{
  const all = await post(`/api/bank/${contentId}/approve-all`);
  const waiting = generated.length - 3;
  check('approve-all approves every remaining draft', all.status === 200 && all.body.approved === waiting,
    `${all.body.approved} of ${waiting}`);
  check('and leaves the rejected one rejected', (await repo.getQuestion(rejected._id)).status === 'discarded');
  check('its reply lists the approved questions that failed a check, with the checks',
    Array.isArray(all.body.flagged) && all.body.flagged.every((f) => f.id && f.failedChecks.length > 0),
    `${all.body.flagged?.length} flagged`);
  check('and the bank a room can serve', all.body.bankCount === generated.length - 1, `bankCount ${all.body.bankCount}`);
  bank = (await get(`/api/bank/${contentId}`)).body;
  check('the bank now counts them as active', bank.active === generated.length - 1 && bank.drafts === 0);
  const again = await post(`/api/bank/${contentId}/approve-all`);
  check('a second approve-all finds nothing to approve', again.status === 200 && again.body.approved === 0);
}

// ------------------------------------------------------------ Harder / Easier --

console.log('\nHarder and Easier');
const active = (await get(`/api/bank/${contentId}`)).body.questions.filter((q) => q.status === 'active');
const pick = (level) => active.find((q) => q.bloom === level && String(q._id) !== String(flawed._id));
const newDrafts = [];
{
  const from = pick('remember');
  const before = await repo.getQuestion(from._id);
  const r = await post(`/api/bank/question/${from._id}/regenerate`, { direction: 'harder' });
  const q = r.body.question;
  check('harder writes a new question one level up', r.status === 200 && q?.bloom === 'understand' && r.body.direction === 'harder',
    `${r.status} ${r.body.error ?? q?.bloom}`);
  check('as a draft, from the generator', q?.status === 'draft' && q?.model === 'offline-template' && Array.isArray(q?.checks));
  check('on the same topic, from the same slides', q?.topic === from.topic && JSON.stringify(q?.sourceRef) === JSON.stringify(from.sourceRef));
  const after = await repo.getQuestion(from._id);
  check('and leaves the original exactly as it was', JSON.stringify(after) === JSON.stringify(before));
  if (q) newDrafts.push(q);
}
{
  const from = pick('understand');
  const r = await post(`/api/bank/question/${from._id}/regenerate`, { direction: 'easier' });
  const q = r.body.question;
  check('easier writes a new draft one level down', r.status === 200 && q?.bloom === 'remember' && q?.status === 'draft'
    && (await repo.getQuestion(from._id)).status === 'active', `${r.status} ${r.body.error ?? q?.bloom}`);
  if (q) newDrafts.push(q);
}
{
  const from = pick('evaluate');
  const r = await post(`/api/bank/question/${from._id}/regenerate`, { direction: 'harder' });
  const q = r.body.question;
  check('harder from Evaluate gives a Create draft that is written, never picked',
    r.status === 200 && q?.bloom === 'create' && q?.kind === 'open' && !isSelectedResponse(q?.kind),
    `${r.status} ${r.body.error ?? `${q?.bloom} ${q?.kind}`}`);
  if (q) newDrafts.push(q);
}
{
  const bottom = await post(`/api/bank/question/${pick('remember')._id}/regenerate`, { direction: 'easier' });
  check('easier on Remember is refused', bottom.status === 400 && /bottom of the ladder/.test(bottom.body.error ?? ''), bottom.body.error);
  const top = await post(`/api/bank/question/${pick('create')._id}/regenerate`, { direction: 'harder' });
  check('harder on Create is refused', top.status === 400 && /top of the ladder/.test(top.body.error ?? ''), top.body.error);
  const odd = await post(`/api/bank/question/${pick('apply')._id}/regenerate`, { direction: 'sideways' });
  check('any other direction is refused', odd.status === 400);
}
{
  const from = pick('apply');
  const r = await post(`/api/bank/question/${from._id}/regenerate`);
  check('a plain regenerate still replaces at the same level, as a draft, discarding the old one',
    r.status === 200 && r.body.question?.bloom === 'apply' && r.body.question?.status === 'draft'
    && (await repo.getQuestion(from._id)).status === 'discarded', `${r.status} ${r.body.error ?? ''}`);
  check('and, since the old one was in use, the reply says it has left rooms until the new one is approved',
    r.body.warnings?.some((w) => /left rooms/.test(w) && /approve/.test(w)), JSON.stringify(r.body.warnings));
  if (r.body.question) newDrafts.push(r.body.question);
}

// ------------------------------------------------------- write your own --

console.log('\nwrite your own');
let own = null;
{
  const r = await post(`/api/bank/${contentId}/questions`, {
    topic: topics[0],
    text: 'Which protocol gives a connectionless, best-effort service?',
    bloom: 'remember',
    kind: 'mcq',
    options: ['UDP.', 'TCP.', 'All of the above.', 'ARP.'],
    answerIdx: 0,
  });
  own = r.body.question;
  check('a professor\'s own question is created active', r.status === 201 && own?.status === 'active', `${r.status} ${r.body.error ?? ''}`);
  check('with no model, no slides, and no creator on the shared key',
    own?.model === null && own?.sourceRef === null && own?.createdBy === null);
  check('labelled as not written by the model', own?.source === 'fallback');
  check('its rule checks run as advice, named in the reply',
    Array.isArray(own?.checks) && r.body.failedChecks?.some((c) => c.id === 'all-none-of-the-above'));

  const poll = await post(`/api/bank/${contentId}/questions`, {
    text: 'How confident are you about the three-way handshake?', bloom: 'understand', kind: 'poll', options: ['Very', 'Somewhat', 'Not yet'],
  });
  check('a poll can be written', poll.status === 201 && poll.body.question?.kind === 'poll');
  const cross = await post(`/api/bank/${contentId}/questions`, {
    text: 'Which protocol?', bloom: 'create', kind: 'mcq', options: ['UDP.', 'TCP.', 'IP.', 'ARP.'], answerIdx: 0,
  });
  check('a kind from another level is refused with the reason', cross.status === 400 && /cannot cross levels/.test(cross.body.error ?? ''));
  const bad = await post(`/api/bank/${contentId}/questions`, { text: 'Which protocol?', bloom: 'remember', kind: 'mcq', options: ['UDP.'], answerIdx: 0 });
  check('a malformed one gets the validator\'s words', bad.status === 400 && bad.body.error === 'mcq needs exactly 4 options');
}

// ------------------------------------------------------------- the room --

console.log('\nthe room serves approved questions, never a draft or a rejected one');
{
  const opened = await post('/api/session', { contentId, title: 'Approved bank' });
  check('after approval the room opens', opened.status === 200 && Boolean(opened.body.code), `${opened.status} ${opened.body.error ?? ''}`);

  const stored = await repo.listQuestions(contentId, { includeDiscarded: true });
  const servable = new Set(stored.filter((q) => q.status === 'active').map((q) => String(q._id)));
  const drafts = stored.filter((q) => q.status === 'draft');
  check('the bank still holds drafts and a rejected question beside the approved ones',
    drafts.length === newDrafts.length && stored.some((q) => String(q._id) === String(rejected._id) && q.status === 'discarded'));

  const s = await connect();
  const accepted = either(s, ['session:accepted', 'session:rejected']);
  const firstQ = either(s, ['server:question', 'server:exhausted']);
  s.emit('student:join', { code: opened.body.code, rollNo: 'BANK-1', name: 'Bank' });
  const acc = await accepted;
  check('the phone is told the size of the approved bank only', acc.payload?.bankCount === servable.size,
    `${acc.payload?.bankCount} vs ${servable.size} active`);

  // A phone naming a draft's id is not marked and nothing is stored.
  let event = await firstQ;
  const forged = await (async () => {
    const reply = either(s, ['server:result', 'server:question', 'server:exhausted']);
    s.emit('student:answer', { questionId: String(drafts[0]._id), response: 0, answerId: 'bank-forged-0001' });
    return reply;
  })();
  const forgedRows = await repo.listAnswers({ sessionId: opened.body.sessionId, rollNo: 'BANK-1' });
  check('an answer naming a draft is not marked, and nothing of it is stored',
    forged.name !== 'server:result' && forgedRows.length === 0, `${forged.name}, ${forgedRows.length} row(s)`);
  if (forged.name === 'server:question') event = forged;

  // A rejected draft is discarded, which the fallback for "discarded after it
  // was served" takes; but it was never approved, so it was never served either.
  const forgedRejected = await (async () => {
    const reply = either(s, ['server:result', 'server:question', 'server:exhausted']);
    s.emit('student:answer', { questionId: String(rejected._id), response: rejected.answerIdx ?? 0, answerId: 'bank-forged-0002' });
    return reply;
  })();
  const rejectedRows = await repo.listAnswers({ sessionId: opened.body.sessionId, rollNo: 'BANK-1' });
  check('an answer naming a rejected draft is not marked, and nothing of it is stored',
    forgedRejected.name !== 'server:result' && rejectedRows.length === 0,
    `${forgedRejected.name}${forgedRejected.payload?.solution !== undefined ? ` (solution ${JSON.stringify(forgedRejected.payload.solution)})` : ''}, ${rejectedRows.length} row(s)`);
  if (forgedRejected.name === 'server:question') event = forgedRejected;

  // Answer everything the room will give this student.
  const served = [];
  for (let i = 0; i < 120 && event.name === 'server:question'; i += 1) {
    served.push(String(event.payload.question._id));
    const result = either(s, ['server:result', 'session:rejected']);
    s.emit('student:answer', { questionId: event.payload.question._id, response: 0, answerId: `bank-${String(i).padStart(4, '0')}-a` });
    await result;
    const nextQ = either(s, ['server:question', 'server:exhausted']);
    s.emit('student:next');
    event = await nextQ;
  }
  check('the student is served questions until the room runs out', served.length > 0 && event.name === 'server:exhausted',
    `${served.length} served`);
  check('every one served is approved', served.every((id) => servable.has(id)));
  check('no draft is ever served', !served.some((id) => drafts.some((d) => String(d._id) === id)));
  check('the rejected question is never served', !served.includes(String(rejected._id)));

  // The snapshot is the question as asked. Who approved it, and when, describe
  // the bank's row, and an approval given later would make one unchanged
  // question look like two versions of it.
  const kept = await repo.listAnswers({ sessionId: opened.body.sessionId, rollNo: 'BANK-1' });
  check('each answer\'s snapshot keeps the model, but not the approval bookkeeping',
    kept.length > 0 && kept.every((a) => !('approvedAt' in a.questionSnapshot) && !('approvedBy' in a.questionSnapshot))
    && kept.some((a) => a.questionSnapshot.model === 'offline-template'),
    JSON.stringify(Object.keys(kept[0]?.questionSnapshot ?? {})));
  s.close();

  // A replacing generate deletes the bank and writes drafts, which no room
  // serves: during a class every phone would be left with nothing to answer.
  const before = await repo.listQuestions(contentId, { includeDiscarded: true });
  const replace = await post('/api/generate', { contentId, topics, plan: { perTopic: 6 } });
  const after = await repo.listQuestions(contentId, { includeDiscarded: true });
  check('a replacing generate is refused while a room on the chapter is running', replace.status === 409
    && /running/.test(replace.body.error ?? '') && /append/.test(replace.body.error ?? ''), `${replace.status} ${replace.body.error ?? ''}`);
  check('and nothing in the bank was deleted', after.length === before.length
    && after.every((q) => before.some((b) => b._id === q._id && b.status === q.status)), `${before.length} -> ${after.length}`);
  const append = await post('/api/generate', { contentId, topics: topics.slice(0, 1), plan: { perTopic: 6 }, mode: 'append' });
  check('adding drafts to it is still allowed', append.status === 200 && append.body.removed === 0 && append.body.generated > 0,
    `${append.status} ${append.body.error ?? ''}`);
  const closed = await post(`/api/session/${opened.body.code}/close`);
  const later = await post('/api/generate', { contentId, topics: topics.slice(0, 1), plan: { perTopic: 6 } });
  check('once the room is closed, a replacing generate answers as before', closed.status === 200 && later.status === 200
    && later.body.removed === after.length + append.body.generated, `${closed.status} ${later.status} ${later.body.error ?? `removed ${later.body.removed}`}`);
}

// ----------------------------------------- split and merge of a rejected draft --

console.log('\nsplit and merge of a rejected draft keep it out of rooms');
{
  const chapter = (await post('/api/content', { title: 'Layers', text: SAMPLE.rawText })).body.contentId;
  const sort = (groups) => ({
    contentId: chapter, topic: 'Layers', text: 'Sort each protocol into its layer.', kind: 'categorise', bloom: 'understand',
    buckets: groups.map(([name, items]) => ({ name, items })), status: 'draft', model: 'offline-template', source: 'fallback',
  });
  const [one, two, four] = await repo.insertQuestions([
    sort([['Transport', ['TCP', 'UDP']], ['Network', ['IP', 'ICMP']]]),
    sort([['Link', ['Ethernet', 'PPP']], ['Application', ['HTTP', 'DNS']]]),
    sort([['Transport', ['TCP', 'UDP']], ['Network', ['IP', 'ICMP']], ['Link', ['Ethernet', 'PPP']], ['Application', ['HTTP', 'DNS']]]),
  ]);
  for (const q of [one, two, four]) await post(`/api/bank/question/${q._id}/reject`);
  const merged = await post('/api/bank/merge', { ids: [one._id, two._id] });
  check('merging two rejected drafts gives a draft, approved by nobody', merged.status === 200
    && merged.body.question?.status === 'draft' && merged.body.question?.approvedAt === null,
  `${merged.status} ${merged.body.error ?? `${merged.body.question?.status} ${merged.body.question?.approvedAt}`}`);
  const split = await post(`/api/bank/question/${four._id}/split`);
  check('splitting a rejected draft gives two drafts, approved by nobody', split.status === 200 && split.body.questions?.length === 2
    && split.body.questions.every((q) => q.status === 'draft' && q.approvedAt === null),
  `${split.status} ${split.body.error ?? JSON.stringify(split.body.questions?.map((q) => q.status))}`);
  check('so none of them is in what a room may serve', (await repo.countQuestions(chapter)) === 0);
}

// ---------------------------------------------------------- ownership --

console.log('\nanother professor\'s bank: the shared key gets the same 404 as for nothing at all');
{
  const theirs = await repo.createContent({
    title: 'Not yours', kind: 'syllabus', rawText: SAMPLE.rawText, topics: SAMPLE.topics.slice(0, 1),
    ownerId: '33333333-3333-4333-8333-333333333333',
  });
  const [draft, live] = await repo.insertQuestions([
    { contentId: theirs._id, topic: 'T', text: 'Their draft?', kind: 'mcq', options: ['a1', 'b2', 'c3', 'd4'], answerIdx: 0, bloom: 'remember', status: 'draft', model: 'offline-template', source: 'fallback' },
    { contentId: theirs._id, topic: 'T', text: 'Their question?', kind: 'mcq', options: ['a1', 'b2', 'c3', 'd4'], answerIdx: 0, bloom: 'remember' },
  ]);
  const NOWHERE = 'ffffffffffffffffffffffff';

  const same = async (label, theirsPath, nowherePath, body) => {
    const a = await post(theirsPath, body);
    const b = await post(nowherePath, body);
    check(label, a.status === 404 && b.status === 404 && a.body.error === b.body.error, `${a.status} "${a.body.error}" / ${b.status} "${b.body.error}"`);
  };
  await same('approve-all on their bank', `/api/bank/${theirs._id}/approve-all`, `/api/bank/${NOWHERE}/approve-all`);
  await same('writing a question into their bank', `/api/bank/${theirs._id}/questions`, `/api/bank/${NOWHERE}/questions`,
    { text: 'Mine?', bloom: 'remember', kind: 'mcq', options: ['a1', 'b2', 'c3', 'd4'], answerIdx: 0 });
  await same('approving their draft', `/api/bank/question/${draft._id}/approve`, `/api/bank/question/${NOWHERE}/approve`);
  await same('rejecting their question', `/api/bank/question/${live._id}/reject`, `/api/bank/question/${NOWHERE}/reject`);
  await same('Harder on their question', `/api/bank/question/${live._id}/regenerate`, `/api/bank/question/${NOWHERE}/regenerate`,
    { direction: 'harder' });
  const read = await get(`/api/bank/${theirs._id}`);
  check('reading their bank', read.status === 404);

  const after = await repo.listQuestions(theirs._id, { includeDiscarded: true });
  check('and nothing of theirs changed', after.length === 2 && after.find((q) => q._id === draft._id).status === 'draft'
    && after.find((q) => q._id === live._id).status === 'active');
  const anon = await fetch(`${base}/api/bank/${contentId}/approve-all`, { method: 'POST' });
  check('no credentials, no approval', anon.status === 401, `HTTP ${anon.status}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
io.close();
server.close();
await closeStore().catch(() => {});
process.exit(fail ? 1 : 0);
