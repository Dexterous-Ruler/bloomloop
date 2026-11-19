// Phase 4 - course outcomes, their mappings, coverage and the roster import from CSV, end to end.
//
//   node server/scripts/outcomes.mjs
//
// Drives a REAL server (the same createApp and attachSockets the production
// server uses) on the in-process store, and checks:
//
//   import      a class list as a CSV file: the dry run says exactly what would
//               be added, refused (with lines and reasons), duplicated (in the
//               file, on the roster) and left unread (phone, email); the real
//               import adds those rows and stores nothing else; a removed
//               student is reported, never restored; a comma, semicolon or tab
//               file; the size and row limits; the JSON list answers as before
//   outcomes    create, edit, reorder; one code per class
//   mappings    an outcome to topics of a chapter, with weights; a topic to
//               several outcomes; a question mapped straight to an outcome, or
//               excluded from all
//   coverage    approved questions and answers per outcome and topic, an
//               outcome with no evidence shown as such, every counted answer
//               mapped, excluded or unmapped; a renamed topic's answers stay
//               counted, as unmapped under the old name, until it is mapped
//   remove      an outcome with evidence is archived and still named; one with
//               none is deleted, and taken off the override naming it
//   copy        into a second section: the outcomes and their mappings, nothing
//               linked afterwards; a clash copies nothing
//   who         another professor gets the same 404 as for nothing at all; the
//               HOD of the department reads, and every write is 403 and changes
//               nothing; a student account 403; no credentials 401
//
// Answers are written with the store's own recordAnswer, in the shape the live
// loop writes them, so every count is known in advance; one more is given by a
// real phone over Socket.io, to show a live answer is counted the same way.
//
// Signed-in accounts need Supabase Auth, which this suite must never reach: as in
// roster.mjs, the server is pointed at http://supabase.invalid and the three
// calls it makes about accounts are answered here, in-process. Any other request
// off this machine is refused outright.
//
// Never calls Gemini, Supabase or any network service. Exits non-zero on any failure.

import http from 'node:http';
import { Server } from 'socket.io';
import { io as ioClient } from 'socket.io-client';

const SRC = new URL('../src/', import.meta.url).href;
const { initStore, getRepo, closeStore } = await import(`${SRC}repo/index.js`);
const { createApp } = await import(`${SRC}app.js`);
const { attachSockets } = await import(`${SRC}sockets/index.js`);
const { config } = await import(`${SRC}config.js`);

// The in-process store and no model, whatever .env says.
config.supabase.url = '';
config.supabase.serviceKey = '';
config.supabase.anonKey = '';
config.mongoUri = '';
config.gemini.apiKey = '';
await initStore({ log: () => {} });
const repo = getRepo();

// ------------------------------------------------- the accounts stand-in --
//
// HOD (CSE) <- professor A <- a student; professor B under another HOD (ECE).

const FAKE_ORIGIN = 'http://supabase.invalid';
const ID = {
  hod: 'a0000000-0000-4000-8000-000000000001',
  profA: 'a0000000-0000-4000-8000-000000000002',
  profB: 'a0000000-0000-4000-8000-000000000003',
  hodOther: 'a0000000-0000-4000-8000-000000000004',
  student: 'a0000000-0000-4000-8000-000000000005',
};
const account = (id, role, department, reportsTo, rollNo = null) => ({
  id, role, full_name: role, email: `${role}-${id.slice(-1)}@example.test`, code: `BL-TEST0${id.slice(-1)}`,
  department, reports_to: reportsTo, roll_no: rollNo, active: true,
  created_at: '2026-11-19T08:00:00+00:00', updated_at: '2026-11-19T08:00:00+00:00',
});
const ACCOUNTS = new Map([
  account(ID.hod, 'hod', 'CSE', null),
  account(ID.profA, 'professor', 'CSE', ID.hod),
  account(ID.student, 'student', 'CSE', ID.profA, '21CS01'),
  account(ID.hodOther, 'hod', 'ECE', null),
  account(ID.profB, 'professor', 'ECE', ID.hodOther),
].map((a) => [a.id, a]));
const TOKENS = { hod: 'tok-hod', profA: 'tok-prof-a', profB: 'tok-prof-b', hodOther: 'tok-hod-other', student: 'tok-student' };
const BY_TOKEN = new Map(Object.entries(TOKENS).map(([who, token]) => [token, ID[who]]));

const below = (root) => {
  const out = [];
  const walk = (id) => {
    for (const a of ACCOUNTS.values()) if (a.reports_to === id) { out.push(a); walk(a.id); }
  };
  walk(root);
  return out;
};

const reply = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});

let refusedOffMachine = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url ?? String(input));
  if (url.hostname === '127.0.0.1') return realFetch(input, init);
  if (url.origin !== FAKE_ORIGIN) {
    refusedOffMachine += 1;
    throw new Error(`outcomes.mjs refuses to reach ${url.origin}`);
  }
  if (url.pathname === '/auth/v1/user') {
    const token = (new Headers(init.headers).get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    const id = BY_TOKEN.get(token);
    return id ? reply({ id, aud: 'authenticated' }) : reply({ code: 401, msg: 'invalid JWT' }, 401);
  }
  if (url.pathname === '/rest/v1/accounts') {
    const id = (url.searchParams.get('id') ?? '').replace(/^eq\./, '');
    return reply(ACCOUNTS.has(id) ? [ACCOUNTS.get(id)] : []);
  }
  if (url.pathname === '/rest/v1/rpc/accounts_below') {
    return reply(below(JSON.parse(init.body ?? '{}').root));
  }
  return reply({ message: `not answered by outcomes.mjs: ${url.pathname}` }, 404);
};
// Set after the store is chosen, so the store stays in-process.
config.supabase.url = FAKE_ORIGIN;
config.supabase.serviceKey = 'outcomes-test-service-key';

// -------------------------------------------------------------- server --

const app = createApp();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
attachSockets(io);
app.set('io', io);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail && !ok ? ` - ${detail}` : ''}`);
  if (ok) pass += 1; else fail += 1;
};

/** `as`: one of the TOKENS' names, or null for no credentials. `type` sends `body` as that content type, unencoded. */
async function call(method, path, { body, as = 'profA', type } = {}) {
  const headers = {};
  if (as) headers.authorization = `Bearer ${TOKENS[as]}`;
  let payload;
  if (type) { headers['content-type'] = type; payload = body; } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(base + path, { method, headers, body: payload });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const get = (path, as) => call('GET', path, { as });
const post = (path, body, as) => call('POST', path, { body, as });
const put = (path, body, as) => call('PUT', path, { body, as });
const patch = (path, body, as) => call('PATCH', path, { body, as });
const del = (path, as) => call('DELETE', path, { as });

const NOWHERE = 'ffffffffffffffffffffffff'; // a well-formed id no store holds
const same404 = (label, a, b) => check(label, a.status === 404 && b.status === 404 && a.body.error === b.body.error,
  `${a.status} "${a.body.error}" / ${b.status} "${b.body.error}"`);

// ------------------------------------------------------------ fixtures --

const mcq = (contentId, topic, n, status = 'active') => ({
  contentId, topic, text: `${topic} question ${n}?`, kind: 'mcq', options: ['A', 'B', 'C', 'D'], answerIdx: 1,
  bloom: 'understand', source: 'llm', status,
});
const chapterA = await repo.createContent({
  title: 'Computer Networks: Unit 2', kind: 'syllabus', rawText: '', ownerId: ID.profA,
  topics: ['Layers', 'Routing', 'Switching', 'Addressing'],
});
const qs = await repo.insertQuestions([
  mcq(chapterA._id, 'Layers', 1), mcq(chapterA._id, 'Layers', 2), mcq(chapterA._id, 'Layers', 3), mcq(chapterA._id, 'Layers', 4),
  mcq(chapterA._id, 'Layers', 5, 'draft'),
  mcq(chapterA._id, 'Routing', 1), mcq(chapterA._id, 'Routing', 2), mcq(chapterA._id, 'Routing', 3),
  mcq(chapterA._id, 'Switching', 1), mcq(chapterA._id, 'Switching', 2),
  mcq(chapterA._id, 'Addressing', 1),
]);
const Q = (topic, n) => qs.find((q) => q.text === `${topic} question ${n}?`);
// A second chapter, for a real phone's answer that no outcome is mapped to.
const chapterC = await repo.createContent({ title: 'Algorithms', kind: 'syllabus', rawText: '', ownerId: ID.profA, topics: ['Sorting'] });
await repo.insertQuestions(Array.from({ length: 6 }, (_, i) => mcq(chapterC._id, 'Sorting', i + 1)));
// Professor B's chapter and question.
const chapterB = await repo.createContent({ title: 'Signals', kind: 'syllabus', rawText: '', ownerId: ID.profB, topics: ['Sampling'] });
const [theirQuestion] = await repo.insertQuestions([mcq(chapterB._id, 'Sampling', 1)]);

// ---------------------------------------------------- the CSV import --

console.log('\nthe roster from a CSV file');

const made = await post('/api/classes', { courseName: 'Computer Networks', section: 'TY-CS A', termLabel: 'Sem V' });
const classId = made.body.class?.id;
check('a professor makes a class', made.status === 201 && Boolean(classId));
{
  const seeded = await post(`/api/classes/${classId}/students`, { students: [
    { roll: '21CS01', name: 'Asha Rao' }, { roll: '21CS02', name: 'Bilal Khan' }, { roll: '21CS01', name: 'Twice' }] });
  check('the JSON list answers exactly as before: refused rows are { index, roll, name, reason }, no code',
    seeded.status === 200 && seeded.body.added?.length === 2
    && JSON.stringify(Object.keys(seeded.body.refused?.[0] ?? {}).sort()) === '["index","name","reason","roll"]',
    JSON.stringify(seeded.body.refused));
}
const studentsNow = async () => (await repo.listClassStudents(classId)).map((s) => ({ ...s }));
const idOfRoll = async (roll) => (await studentsNow()).find((s) => s.rollNo === roll)?._id;
await del(`/api/classes/${classId}/students/${await idOfRoll('21CS02')}`);

const CSV = [
  '﻿Roll No.,Student Name,Phone,Email',
  '21CS01,Asha Rao,9845012345,asha@example.com',
  '21CS02,Bilal Khan,,',
  '21CS03,"Rao, Chitra",9845012346,',
  '21cs04,Dev  Patel,,',
  '',
  '21CS03,Chitra again,,',
  ',No roll,,',
  '21CS09,Ravi 98450 12345,,',
  '21CS05,"Esha ""E"" Nair",,',
].join('\r\n') + '\r\n';
{
  const before = JSON.stringify(await studentsNow());
  const dry = await post(`/api/classes/${classId}/students/import`, { csv: CSV, dryRun: true });
  const b = dry.body;
  check('a dry run answers 200 and changes nothing', dry.status === 200 && b.dryRun === true && before === JSON.stringify(await studentsNow())
    && /Nothing was changed/.test(b.message ?? ''), `HTTP ${dry.status} ${b.error ?? ''}`);
  check('it says how the file was read: comma, its two columns, 8 rows, 1 blank line',
    b.read?.delimiter === 'comma' && b.read?.columns?.roll === 'Roll No.' && b.read?.columns?.name === 'Student Name'
    && b.read?.rows === 8 && b.read?.blankLines === 1, JSON.stringify(b.read));
  check('exactly what would be added, with lines: tidied, quoted commas and quotes kept',
    JSON.stringify(b.wouldAdd) === JSON.stringify([
      { line: 4, rollNo: '21CS03', name: 'Rao, Chitra', under18: false }, { line: 5, rollNo: '21CS04', name: 'Dev Patel', under18: false },
      { line: 10, rollNo: '21CS05', name: 'Esha "E" Nair', under18: false }]), JSON.stringify(b.wouldAdd));
  check('every refused row with its line, code and reason',
    JSON.stringify(b.refused?.map((r) => [r.line, r.code])) === JSON.stringify([
      [2, 'on-roster'], [3, 'removed'], [7, 'repeated'], [8, 'no-roll'], [9, 'bad-name']])
    && b.refused.every((r) => typeof r.reason === 'string' && r.reason.length > 10), JSON.stringify(b.refused?.map((r) => [r.line, r.code])));
  check('duplicates in the file name the line of the first copy',
    JSON.stringify(b.duplicates?.inFile) === JSON.stringify([{ line: 7, rollNo: '21CS03', firstLine: 4 }]), JSON.stringify(b.duplicates?.inFile));
  check('duplicates of the roster name the student already on it',
    b.duplicates?.onRoster?.length === 1 && b.duplicates.onRoster[0].line === 2 && b.duplicates.onRoster[0].onRoster?.name === 'Asha Rao');
  check('a removed student is reported, with the roster row and how to restore them',
    b.removed?.length === 1 && b.removed[0].line === 3 && b.removed[0].student?.active === false && /not restored/.test(b.restore ?? ''));
  check('the columns not read are named back: Phone, Email',
    JSON.stringify(b.ignoredColumns) === '["Phone","Email"]' && /Not read from the file: Phone, Email/.test(b.note ?? ''));
  check('and the size before and after', b.size === 1 && b.sizeAfter === 4, `${b.size} -> ${b.sizeAfter}`);
}
{
  // The same file sent as the body itself, as an upload would send it.
  const real = await call('POST', `/api/classes/${classId}/students/import`, { body: CSV, type: 'text/csv; charset=utf-8' });
  const b = real.body;
  check('the real import, from a text/csv body, adds exactly what the dry run said',
    real.status === 200 && b.dryRun === false
    && JSON.stringify(b.added?.map((s) => [s.line, s.rollNo, s.name])) === JSON.stringify([
      [4, '21CS03', 'Rao, Chitra'], [5, '21CS04', 'Dev Patel'], [10, '21CS05', 'Esha "E" Nair']]),
    `HTTP ${real.status} ${b.error ?? JSON.stringify(b.added)}`);
  check('and refuses the same rows', JSON.stringify(b.refused?.map((r) => r.line)) === '[2,3,7,8,9]' && b.size === 4);
  const stored = await studentsNow();
  check('the store holds a roll number and a name per student (and the under-18 mark, no) and nothing from the other columns',
    stored.every((s) => JSON.stringify(Object.keys(s).sort()) === '["_id","addedAt","classId","name","removedAt","rollNo","under18"]'
      && s.under18 === false)
    && !JSON.stringify(stored).includes('9845012345') && !JSON.stringify(stored).includes('asha@example.com'));
  check('the removed student was not restored', stored.find((s) => s.rollNo === '21CS02')?.removedAt !== null);
}
{
  const semi = await call('POST', `/api/classes/${classId}/students/import?dryRun=true`,
    { body: 'ROLLNO;Name;Notes\n21CS06;Farah Ali;sits at the front\n', type: 'text/csv' });
  check('a semicolon file is read as one (?dryRun=true on a text/csv body)',
    semi.status === 200 && semi.body.read?.delimiter === 'semicolon' && semi.body.wouldAdd?.[0]?.name === 'Farah Ali'
    && JSON.stringify(semi.body.ignoredColumns) === '["Notes"]');
  const tab = await call('POST', `/api/classes/${classId}/students/import`, { body: 'roll number\tstudent name\n21CS07\tGita Iyer\n', type: 'text/plain' });
  check('a tab-separated paste is read as one, and imported', tab.status === 200 && tab.body.read?.delimiter === 'tab'
    && tab.body.added?.[0]?.rollNo === '21CS07' && tab.body.size === 5);
}
{
  const noHeader = await post(`/api/classes/${classId}/students/import`, { csv: '21CS10,Hari\n21CS11,Isha\n' });
  check('a file without a header row is a 400 that says what it needs', noHeader.status === 400 && /must name the columns/.test(noHeader.body.error ?? ''));
  const long = `Roll,Name\n${Array.from({ length: 2001 }, (_, i) => `X${i},Name`).join('\n')}\n`;
  const tooLong = await post(`/api/classes/${classId}/students/import`, { csv: long, dryRun: true });
  check('more than 2,000 rows is a 400', tooLong.status === 400 && /2000 is the most/.test(tooLong.body.error ?? ''));
  const big = `Roll,Name\n1,${'a'.repeat(1024 * 1024)}\n`;
  const bigText = await call('POST', `/api/classes/${classId}/students/import`, { body: big, type: 'text/csv' });
  const bigJson = await post(`/api/classes/${classId}/students/import`, { csv: big });
  check('over 1 MB is a 413 in a sentence, sent as a file or as JSON',
    bigText.status === 413 && bigJson.status === 413 && /larger than 1 MB/.test(bigText.body.error ?? '') && /larger than 1 MB/.test(bigJson.body.error ?? ''),
    `${bigText.status} ${bigText.body.error} / ${bigJson.status} ${bigJson.body.error}`);
  const badFlag = await post(`/api/classes/${classId}/students/import?dryRun=maybe`, { csv: CSV });
  check('a dryRun that is not true or false is a 400', badFlag.status === 400);
  const unclosed = await post(`/api/classes/${classId}/students/import`, { csv: 'Roll,Name\n21CS10,"Hari\n' });
  check('a quote that never closes is a 400 naming its line', unclosed.status === 400 && /Line 2 opens a quote/.test(unclosed.body.error ?? ''));
  check('none of those changed the roster', (await studentsNow()).filter((s) => !s.removedAt).length === 5);
}

// ------------------------------------------------------------ outcomes --

console.log('\ncourse outcomes');

const create = (body, as) => post(`/api/classes/${classId}/outcomes`, body, as);
const first = await create({ code: 'co1', statement: 'Explain  the layered model of a network.', targetLevel: 'Understand' });
check('a professor creates CO1: code upper-cased, statement tidied, level lower-cased',
  first.status === 201 && first.body.outcome?.code === 'CO1' && first.body.outcome?.statement === 'Explain the layered model of a network.'
  && first.body.outcome?.targetLevel === 'understand' && first.body.outcome?.position === 1 && first.body.canEdit === true,
  `HTTP ${first.status} ${first.body.error ?? ''}`);
const CO = { CO1: first.body.outcome?.id };
for (const [code, statement, targetLevel] of [
  ['CO2', 'Analyse routing decisions in a network.', 'analyse'],
  ['CO3', 'Design an addressing plan for an organisation.', 'create'],
  ['CO4', 'Describe how switches forward frames.', null],
  ['CO5', 'Recall address classes.', 'remember'],
]) {
  const r = await create({ code, statement, targetLevel });
  CO[code] = r.body.outcome?.id;
  if (r.status !== 201) check(`creating ${code}`, false, `HTTP ${r.status} ${r.body.error ?? ''}`);
}
{
  const listed = await get(`/api/classes/${classId}/outcomes`);
  check('five outcomes, in the order made', listed.status === 200 && listed.body.outcomes?.map((o) => o.code).join() === 'CO1,CO2,CO3,CO4,CO5');
  const dup = await create({ code: 'CO1', statement: 'Again.' });
  check('a second CO1 in the class is a 409', dup.status === 409 && /already a course outcome/.test(dup.body.error ?? ''));
  const noStatement = await create({ code: 'CO9' });
  const analyze = await create({ code: 'CO9', statement: 'S', targetLevel: 'analyze' });
  const contact = await create({ code: 'CO9', statement: 'Mail hod@college.edu.in for help' });
  const badCode = await create({ code: 'CO#9', statement: 'S' });
  check('no statement, "analyze", an email address in the statement and a bad code are each a 400',
    [noStatement, analyze, contact, badCode].every((r) => r.status === 400), [noStatement, analyze, contact, badCode].map((r) => r.status).join());
  const edited = await patch(`/api/classes/${classId}/outcomes/${CO.CO1}`, { statement: 'Explain the layered model.', targetLevel: null });
  check('an outcome is edited', edited.status === 200 && edited.body.outcome?.statement === 'Explain the layered model.'
    && edited.body.outcome?.targetLevel === null);
  const nothing = await patch(`/api/classes/${classId}/outcomes/${CO.CO1}`, {});
  check('an edit that sends nothing is a 400', nothing.status === 400);
  const order = [CO.CO2, CO.CO1, CO.CO3, CO.CO4, CO.CO5];
  const reordered = await post(`/api/classes/${classId}/outcomes/reorder`, { ids: order });
  check('they are put in a new order', reordered.status === 200 && reordered.body.outcomes?.map((o) => o.code).join() === 'CO2,CO1,CO3,CO4,CO5'
    && reordered.body.outcomes.map((o) => o.position).join() === '1,2,3,4,5');
  const short = await post(`/api/classes/${classId}/outcomes/reorder`, { ids: order.slice(1) });
  const twice = await post(`/api/classes/${classId}/outcomes/reorder`, { ids: [CO.CO2, CO.CO2, CO.CO3, CO.CO4, CO.CO5] });
  check('a reorder that leaves one out or names one twice is a 400', short.status === 400 && twice.status === 400);
}

// ------------------------------------------------------------ mappings --

console.log('\nmapping outcomes to topics, and questions to outcomes');

const topics = (code, list, as) => put(`/api/classes/${classId}/outcomes/${CO[code]}/topics`, { topics: list }, as);
const A = String(chapterA._id);
{
  const co1 = await topics('CO1', [{ contentId: A, topic: '  layers ', weight: 2 }]);
  const mapped = co1.body.outcome?.topics;
  check('CO1 is mapped to a topic, kept as the chapter spells it, with its weight and the chapter named',
    co1.status === 200 && co1.body.outcome?.code === 'CO1'
    && JSON.stringify(mapped?.map((x) => [x.contentId, x.chapter, x.topic, x.weight, x.inChapter]))
      === JSON.stringify([[A, 'Computer Networks: Unit 2', 'Layers', 2, true]])
    && JSON.stringify(co1.body.outcomes?.find((o) => o.code === 'CO1')?.topics) === JSON.stringify(mapped),
    `HTTP ${co1.status} ${co1.body.error ?? JSON.stringify(mapped)}`);
  const co2 = await topics('CO2', [{ contentId: A, topic: 'Routing' }, { contentId: A, topic: 'Layers' }]);
  check('a topic may map to several outcomes: Layers to CO1 and CO2',
    co2.status === 200 && co2.body.outcomes?.find((o) => o.code === 'CO2')?.topics?.map((x) => [x.topic, x.weight]).join('|') === 'Layers,1|Routing,1');
  await topics('CO3', [{ contentId: A, topic: 'Addressing' }]);
  await topics('CO5', [{ contentId: A, topic: 'Addressing' }]);
  const unknown = await topics('CO4', [{ contentId: A, topic: 'Transport' }]);
  check('a topic the chapter does not carry is a 400 that lists the ones it does',
    unknown.status === 400 && /"Transport" is not a topic of "Computer Networks: Unit 2".*Layers; Routing; Switching; Addressing/.test(unknown.body.error ?? ''),
    unknown.body.error);
  same404('a chapter of another professor: the same 404 as a chapter that does not exist',
    await topics('CO4', [{ contentId: String(chapterB._id), topic: 'Sampling' }]), await topics('CO4', [{ contentId: NOWHERE, topic: 'Sampling' }]));
  const badWeight = await topics('CO4', [{ contentId: A, topic: 'Switching', weight: 0 }]);
  check('a weight of 0 is a 400', badWeight.status === 400);
  check('and none of those changed CO4', (await repo.listOutcomeTopics(classId)).every((l) => l.outcomeId !== CO.CO4));
}
const overrideQ = (questionId, body, as) => put(`/api/classes/${classId}/outcomes/questions/${questionId}`, body, as);
{
  const direct = await overrideQ(Q('Routing', 1)._id, { outcomeIds: [CO.CO3] });
  const ov = direct.body.overrides?.find((o) => o.questionId === String(Q('Routing', 1)._id));
  check('a Routing question is mapped straight to CO3, in place of its topic\'s outcomes',
    direct.status === 200 && ov?.excluded === false && ov?.outcomes?.map((o) => o.code).join() === 'CO3'
    && ov?.question?.topic === 'Routing', `HTTP ${direct.status} ${direct.body.error ?? ''}`);
  const excluded = await overrideQ(Q('Switching', 1)._id, { exclude: true });
  check('a Switching question is excluded from every outcome', excluded.status === 200
    && excluded.body.overrides?.find((o) => o.questionId === String(Q('Switching', 1)._id))?.excluded === true);
  await overrideQ(Q('Addressing', 1)._id, { outcomeIds: [CO.CO5] });
  same404('another professor\'s question: the same 404 as a question that does not exist',
    await overrideQ(theirQuestion._id, { exclude: true }), await overrideQ(NOWHERE, { exclude: true }));
  const both = await overrideQ(Q('Layers', 1)._id, { exclude: true, outcomeIds: [CO.CO1] });
  const foreign = await overrideQ(Q('Layers', 1)._id, { outcomeIds: [NOWHERE] });
  check('mapping and excluding at once, or naming an outcome not of this class, is a 400', both.status === 400 && foreign.status === 400);
}
{
  const cov = await get(`/api/classes/${classId}/outcomes/coverage`);
  const of = (code) => cov.body.outcomes?.find((o) => o.code === code);
  check('before any room: coverage counts approved questions (the draft left out) and no answers',
    cov.status === 200 && of('CO1')?.questions === 4 && of('CO1')?.answers === 0 && of('CO1')?.evidence === 'questions'
    && /No answers yet: 4 approved questions/.test(of('CO1')?.summary ?? ''), JSON.stringify(of('CO1')));
  check('an outcome with nothing mapped is shown as having no evidence',
    of('CO4')?.evidence === 'none' && /no topic or question is mapped/.test(of('CO4')?.summary ?? ''));
  check('the coverage says how it counts', ['answers', 'questions', 'resolution', 'renamedTopics', 'weights', 'evidence']
    .every((k) => typeof cov.body.definitions?.[k] === 'string') && /staff only/.test(cov.body.privacy ?? ''));
}

// --------------------------------------------------- answers in a room --

console.log('\nanswers from the class\'s rooms, counted per outcome');

const opened = await post('/api/session', { contentId: A, classId });
check('a room is opened for the class', opened.status === 200, `HTTP ${opened.status} ${opened.body.error ?? ''}`);
const sessionId = opened.body.sessionId;
let keyN = 0;
const snapshotOf = ({ _id, contentId, createdAt, status, ...rest }) => ({ id: String(_id), ...rest });
async function answered(rollNo, question, correct, extra = {}) {
  keyN += 1;
  const { answer } = await repo.recordAnswer({
    sessionId, answerKey: `outcomes-${keyN}`, rollNo, accountId: null, questionId: String(question._id),
    contentId: String(question.contentId), topic: question.topic, bloom: question.bloom, kind: 'mcq',
    questionSnapshot: snapshotOf(question), response: correct ? 1 : 0, attempt: 1, final: true,
    correct, score: correct ? 1 : 0, ungraded: false, autoCorrect: correct, autoScore: correct ? 1 : 0, reviewStatus: 'auto', ...extra,
  });
  return answer;
}
await answered('21CS01', Q('Layers', 1), true);
await answered('21CS01', Q('Layers', 2), false);
await answered('21CS01', Q('Routing', 1), true); // mapped straight to CO3
await answered('21CS01', Q('Routing', 2), true);
await answered('21CS01', Q('Switching', 1), true); // excluded
await answered('21CS01', Q('Switching', 2), false); // Switching is mapped to nothing
await answered('21CS03', Q('Layers', 1), true);
await answered('21CS03', Q('Routing', 2), false);
await answered('21CS03', Q('Layers', 3), false, { final: false }); // retried: never counted
await answered('21CS03', Q('Layers', 4), null, { ungraded: true, correct: null, score: null }); // a poll: assesses nothing

const coverage = async (as) => get(`/api/classes/${classId}/outcomes/coverage`, as);
{
  const cov = await coverage();
  const of = (code) => cov.body.outcomes?.find((o) => o.code === code);
  check('8 answers counted (a retried attempt and a poll left out): 6 mapped, 1 excluded, 1 unmapped, and they add up',
    JSON.stringify(cov.body.answers) === JSON.stringify({ counted: 8, mapped: 6, excluded: 1, unmapped: 1 }), JSON.stringify(cov.body.answers));
  check('CO1 (Layers): 3 answers from 2 students, under its one topic',
    of('CO1')?.answers === 3 && of('CO1')?.students === 2 && of('CO1')?.topics?.[0]?.answers === 3 && of('CO1')?.topics?.[0]?.questions === 4
    && of('CO1')?.evidence === 'answers', JSON.stringify(of('CO1')));
  check('CO2 (Layers and Routing): 5 answers; the Routing question mapped elsewhere is not under its topic',
    of('CO2')?.answers === 5 && JSON.stringify(of('CO2')?.topics?.map((t) => [t.topic, t.questions, t.answers])) === '[["Layers",4,3],["Routing",2,2]]',
    JSON.stringify(of('CO2')?.topics));
  check('CO3: the question mapped straight to it counts under `direct`',
    JSON.stringify(of('CO3')?.direct) === '{"questions":1,"answers":1}' && of('CO3')?.answers === 1);
  check('CO4 still has no evidence, and CO5 approved questions only',
    of('CO4')?.evidence === 'none' && of('CO5')?.evidence === 'questions' && of('CO5')?.answers === 0);
  check('the excluded question and its answer are counted as excluded', JSON.stringify(cov.body.excluded) === '{"questions":1,"answers":1}');
  check('the unmapped answer is counted under its topic, with its chapter, never dropped',
    JSON.stringify(cov.body.unmapped?.map((u) => [u.chapter, u.topic, u.inChapter, u.questions, u.answers]))
      === '[["Computer Networks: Unit 2","Switching",true,1,1]]', JSON.stringify(cov.body.unmapped));
  check('the rooms behind it are named', cov.body.rooms?.counted === 1 && cov.body.rooms?.codes?.[0] === opened.body.code);
}
{
  // A real phone in a second room of the class, on a chapter no outcome is mapped to.
  const room2 = await post('/api/session', { contentId: String(chapterC._id), classId });
  const s = ioClient(base, { transports: ['websocket'], reconnection: false });
  await new Promise((resolve, reject) => { s.once('connect', resolve); s.once('connect_error', reject); });
  const firstQ = new Promise((resolve) => s.once('server:question', resolve));
  s.emit('student:join', { code: room2.body.code, rollNo: '21CS04', name: 'Dev' });
  const { question } = await firstQ;
  const result = new Promise((resolve) => s.once('server:result', resolve));
  s.emit('student:answer', { questionId: question._id, response: 1, answerId: 'outcomes-live-0001' });
  await result;
  const phonePayload = JSON.stringify(question);
  s.disconnect();
  const cov = await coverage();
  check('a live phone\'s answer is counted too: 9 counted, the new one unmapped under its own chapter\'s topic',
    cov.body.answers?.counted === 9 && cov.body.answers?.unmapped === 2
    && cov.body.unmapped?.some((u) => u.chapter === 'Algorithms' && u.topic === 'Sorting' && u.answers === 1)
    && cov.body.rooms?.counted === 2, JSON.stringify(cov.body.answers));
  const publicRoom = await get(`/api/session/${room2.body.code}`, null);
  check('nothing about outcomes reaches a phone or the room\'s public read',
    !/outcome|coverage|CO1/i.test(phonePayload) && !/outcome|coverage/i.test(JSON.stringify(publicRoom.body)));
}

// ------------------------------------------------------ a renamed topic --

console.log('\na topic renamed after answers were given');

{
  const renamed = await call('PATCH', `/api/content/${A}`, { body: { topics: ['Layers', 'Routing', 'Packet switching', 'Addressing'] } });
  check('the chapter\'s topic "Switching" is renamed "Packet switching"', renamed.status === 200);
  let cov = await coverage();
  const switching = () => cov.body.unmapped?.find((u) => u.topic === 'Switching');
  check('its answer is still counted, as unmapped under the old name, now marked not in the chapter',
    switching()?.answers === 1 && switching()?.inChapter === false && cov.body.answers?.counted === 9);
  const newName = await topics('CO4', [{ contentId: A, topic: 'Packet switching' }]);
  cov = await coverage();
  check('mapping CO4 to the new name leaves that answer unmapped: questions and answers still carry the old one',
    newName.status === 200 && cov.body.outcomes?.find((o) => o.code === 'CO4')?.answers === 0 && switching()?.answers === 1);
  const both = await topics('CO4', [{ contentId: A, topic: 'Packet switching' }, { contentId: A, topic: 'Switching' }]);
  cov = await coverage();
  const co4 = cov.body.outcomes?.find((o) => o.code === 'CO4');
  check('the old name can still be mapped, because the evidence carries it; then CO4 has the answer',
    both.status === 200 && co4?.answers === 1 && co4?.topics?.find((t) => t.topic === 'Switching')?.inChapter === false
    && !switching() && cov.body.answers?.unmapped === 1 && cov.body.answers?.counted === 9, JSON.stringify(co4?.topics));
}

// ------------------------------------------------------------- remove --

console.log('\nremoving outcomes');

{
  const gone = await del(`/api/classes/${classId}/outcomes/${CO.CO5}`);
  check('CO5, with no answers, is deleted with its topic, and taken off the override that named only it',
    gone.status === 200 && gone.body.removed === 'deleted' && gone.body.topicsRemoved === 1
    && gone.body.outcome?.code === 'CO5' && gone.body.outcome?.topics?.[0]?.topic === 'Addressing'
    && JSON.stringify(gone.body.overridesChanged) === JSON.stringify({ narrowed: [], removed: [String(Q('Addressing', 1)._id)] })
    && /now follows its topic again/.test(gone.body.message ?? '')
    && !gone.body.outcomes?.some((o) => o.code === 'CO5') && !gone.body.overrides?.some((o) => o.questionId === String(Q('Addressing', 1)._id)),
    `HTTP ${gone.status} ${gone.body.error ?? gone.body.message}`);
  const archived = await del(`/api/classes/${classId}/outcomes/${CO.CO1}`);
  check('CO1, with 3 answers from 2 students, is archived, not deleted, and the reply says why',
    archived.status === 200 && archived.body.removed === 'archived' && archived.body.outcome?.archived === true
    && archived.body.outcome?.topics?.[0]?.topic === 'Layers'
    && JSON.stringify(archived.body.evidence) === '{"answers":3,"students":2}' && /archived, not deleted/.test(archived.body.message ?? ''),
    `HTTP ${archived.status} ${archived.body.error ?? archived.body.message}`);
  const cov = await coverage();
  const co1 = cov.body.outcomes?.find((o) => o.code === 'CO1');
  check('a later report still names it, with its evidence, listed after the outcomes in use',
    co1?.archived === true && co1?.answers === 3 && cov.body.outcomes?.at(-1)?.code === 'CO1');
  const edit = await patch(`/api/classes/${classId}/outcomes/${CO.CO1}`, { statement: 'Changed' });
  const map = await topics('CO1', []);
  const ov = await overrideQ(Q('Layers', 2)._id, { outcomeIds: [CO.CO1] });
  check('an archived outcome is kept as it was: not edited (409), not remapped (409), named by no new override (400)',
    edit.status === 409 && map.status === 409 && ov.status === 400, `${edit.status} ${map.status} ${ov.status}`);
  const fresh = await create({ code: 'CO1', statement: 'Explain encapsulation.' });
  check('its code is free for a new CO1', fresh.status === 201);
  CO.newCO1 = fresh.body.outcome?.id;
  const restore = await patch(`/api/classes/${classId}/outcomes/${CO.CO1}`, { archived: false });
  check('restoring the old CO1 while the code is taken is a 409', restore.status === 409);
  const again = await del(`/api/classes/${classId}/outcomes/${CO.CO1}`);
  check('removing it again changes nothing', again.status === 200 && again.body.removed === 'archived' && /already archived/.test(again.body.message ?? ''));
}

// ------------------------------------------------------------------ copy --

console.log('\ncopying outcomes into a second section');

const madeB = await post('/api/classes', { courseName: 'Computer Networks', section: 'TY-CS B', termLabel: 'Sem V' });
const classB = madeB.body.class?.id;
const outcomesOf = async (id) => (await get(`/api/classes/${id}/outcomes`)).body;
{
  const copied = await post(`/api/classes/${classB}/outcomes/copy`, { fromClassId: classId });
  const b = copied.body;
  check('the outcomes in use are copied, in order, with their topics and overrides; the archived one is not',
    copied.status === 201 && b.outcomes?.map((o) => o.code).join() === 'CO2,CO3,CO4,CO1'
    && JSON.stringify(b.copied) === JSON.stringify({ outcomes: 4, topics: 5, overrides: 2 }) && b.skipped?.archivedOutcomes === 1,
    `HTTP ${copied.status} ${b.error ?? JSON.stringify(b.copied)}`);
  const co3 = b.outcomes?.find((o) => o.code === 'CO3');
  const ov = b.overrides?.find((o) => o.questionId === String(Q('Routing', 1)._id));
  check('the copied override names the copy of CO3, not the original', ov?.outcomes?.[0]?.id === co3?.id && co3?.id !== CO.CO3);
  check('the copies are new rows', b.outcomes?.every((o) => !Object.values(CO).includes(o.id)));
  check('the copy says nothing is linked', /Nothing is linked/.test(b.message ?? ''));
  const theirCo2 = b.outcomes?.find((o) => o.code === 'CO2')?.id;
  await patch(`/api/classes/${classB}/outcomes/${theirCo2}`, { statement: 'Changed in section B only.' });
  await put(`/api/classes/${classB}/outcomes/${theirCo2}/topics`, { topics: [] });
  const a = await outcomesOf(classId);
  const aCo2 = a.outcomes?.find((o) => o.code === 'CO2');
  check('editing section B\'s CO2 leaves section A\'s as it was',
    aCo2?.statement === 'Analyse routing decisions in a network.' && aCo2?.topics?.length === 2);
  const before = JSON.stringify(await outcomesOf(classB));
  const clash = await post(`/api/classes/${classB}/outcomes/copy`, { fromClassId: classId });
  check('copying again clashes on every code and copies nothing (409)',
    clash.status === 409 && /Nothing was copied/.test(clash.body.error ?? '') && before === JSON.stringify(await outcomesOf(classB)));
  const self = await post(`/api/classes/${classB}/outcomes/copy`, { fromClassId: classB });
  check('a class cannot copy from itself (400)', self.status === 400);
  const theirClass = (await post('/api/classes', { courseName: 'Signals', section: 'SY-EC A' }, 'profB')).body.class?.id;
  same404('copying from another professor\'s class: the same 404 as a class that does not exist',
    await post(`/api/classes/${classB}/outcomes/copy`, { fromClassId: theirClass }), await post(`/api/classes/${classB}/outcomes/copy`, { fromClassId: NOWHERE }));
  const covB = await get(`/api/classes/${classB}/outcomes/coverage`);
  check('section B has no rooms yet, so no answers: its coverage says so, outcome by outcome',
    covB.status === 200 && covB.body.answers?.counted === 0 && covB.body.outcomes?.every((o) => o.answers === 0));
}

// -------------------------------------------------- who may do what --

console.log('\nanother professor, the HOD, a student, nobody');

const OID = () => CO.CO2;
const writes = (as, cls = classId) => [
  () => post(`/api/classes/${cls}/outcomes`, { code: 'CO8', statement: 'S' }, as),
  () => patch(`/api/classes/${cls}/outcomes/${OID()}`, { statement: 'S' }, as),
  () => post(`/api/classes/${cls}/outcomes/reorder`, { ids: [] }, as),
  () => put(`/api/classes/${cls}/outcomes/${OID()}/topics`, { topics: [] }, as),
  () => put(`/api/classes/${cls}/outcomes/questions/${Q('Layers', 1)._id}`, { exclude: true }, as),
  () => del(`/api/classes/${cls}/outcomes/questions/${Q('Routing', 1)._id}`, as),
  () => del(`/api/classes/${cls}/outcomes/${OID()}`, as),
  () => post(`/api/classes/${cls}/outcomes/copy`, { fromClassId: classB }, as),
  () => post(`/api/classes/${cls}/students/import`, { csv: 'Roll,Name\n21CS20,Hema\n', dryRun: true }, as),
];
{
  const reads = [
    [await get(`/api/classes/${classId}/outcomes`, 'profB'), await get(`/api/classes/${NOWHERE}/outcomes`, 'profB')],
    [await get(`/api/classes/${classId}/outcomes/coverage`, 'profB'), await get(`/api/classes/${NOWHERE}/outcomes/coverage`, 'profB')],
  ];
  same404('another professor reading the outcomes: the same 404 as no class at all', ...reads[0]);
  same404('or the coverage', ...reads[1]);
  const theirs = [];
  const none = [];
  for (const w of writes('profB')) theirs.push(await w());
  for (const w of writes('profB', NOWHERE)) none.push(await w());
  check('every write by another professor is the same 404, word for word, as for a class that does not exist',
    theirs.every((r, i) => r.status === 404 && r.body.error === none[i].body.error && none[i].status === 404),
    theirs.map((r, i) => `${r.status}/${none[i].status}`).join(', '));
  const other = await get(`/api/classes/${classId}/outcomes`, 'hodOther');
  check('an HOD of another department gets the 404 too', other.status === 404);
}
{
  const hodRead = await get(`/api/classes/${classId}/outcomes`, 'hod');
  const hodCov = await coverage('hod');
  check('the HOD reads the outcomes, marked read-only, and the coverage',
    hodRead.status === 200 && hodRead.body.canEdit === false && hodRead.body.outcomes?.length === 5
    && hodCov.status === 200 && hodCov.body.answers?.counted === 9);
  const snapshot = async () => JSON.stringify([await repo.listOutcomes(classId), await repo.listOutcomeTopics(classId),
    await repo.listQuestionOverrides(classId), await repo.listClassStudents(classId)]);
  const before = await snapshot();
  const results = [];
  for (const w of writes('hod')) results.push(await w());
  check('every HOD write is a 403, the dry-run import included, and changes nothing',
    results.every((r) => r.status === 403) && before === await snapshot(), results.map((r) => r.status).join(', '));
  const asStudent = await get(`/api/classes/${classId}/outcomes`, 'student');
  const anon = await get(`/api/classes/${classId}/outcomes`, null);
  check('a student account gets 403, and no credentials 401', asStudent.status === 403 && anon.status === 401,
    `${asStudent.status} ${anon.status}`);
}
{
  // The owner may still do all of it: the override removed, then the list.
  const removed = await del(`/api/classes/${classId}/outcomes/questions/${Q('Routing', 1)._id}`);
  const cov = await coverage();
  check('removing an override sends its question back to its topic: its answer moves from CO3 to CO2',
    removed.status === 200 && cov.body.outcomes?.find((o) => o.code === 'CO3')?.answers === 0
    && cov.body.outcomes?.find((o) => o.code === 'CO2')?.answers === 6);
  const none = await del(`/api/classes/${classId}/outcomes/questions/${Q('Routing', 1)._id}`);
  check('and a question with no override is a 404', none.status === 404);
  const archived = await del(`/api/classes/${classId}/outcomes/${CO.CO4}`);
  const restored = await patch(`/api/classes/${classId}/outcomes/${CO.CO4}`, { archived: false });
  check('an archived outcome whose code is free is restored, last in the order, its mappings intact',
    archived.body.removed === 'archived' && restored.status === 200 && restored.body.outcome?.archived === false
    && restored.body.outcomes?.filter((o) => !o.archived).at(-1)?.code === 'CO4' && restored.body.outcome?.topics?.length === 2,
    `${archived.body.removed} ${restored.status} ${restored.body.error ?? ''}`);
}
{
  // The cap holds for a restore as for a create: CO4 archived again, the class
  // filled to 50 in use, and CO4 may not come back over them.
  await del(`/api/classes/${classId}/outcomes/${CO.CO4}`);
  const inUse = (await repo.listOutcomes(classId)).filter((o) => !o.archivedAt).length;
  let made = 0;
  for (let i = inUse; i < 50; i += 1) {
    if ((await post(`/api/classes/${classId}/outcomes`, { code: `CAP${i}`, statement: `Outcome ${i} of the cap.` })).status === 201) made += 1;
  }
  const over = await post(`/api/classes/${classId}/outcomes`, { code: 'CAP50', statement: 'One past the cap.' });
  const before = JSON.stringify(await repo.listOutcomes(classId));
  const restore = await patch(`/api/classes/${classId}/outcomes/${CO.CO4}`, { archived: false });
  check('at 50 outcomes in use, restoring an archived one is the same 409 as creating one, and changes nothing',
    made === 50 - inUse && over.status === 409 && restore.status === 409
    && restore.body.error === 'This class already has 50 course outcomes, the most it may hold. Archive one before restoring CO4.'
    && over.body.error === 'This class already has 50 course outcomes, the most it may hold.'
    && before === JSON.stringify(await repo.listOutcomes(classId)),
    `${made} ${over.status} ${restore.status} ${restore.body.error ?? ''}`);
}

check('no request left this machine', refusedOffMachine === 0, `${refusedOffMachine} refused`);

console.log(`\n${pass} passed, ${fail} failed`);
globalThis.fetch = realFetch;
io.close();
server.close();
await closeStore().catch(() => {});
process.exit(fail ? 1 : 0);
