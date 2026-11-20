/**
 * The review queue, drawn from sample data. Development only.
 *
 * The screen takes its server calls as `services`, so these entries hand it a
 * small in-memory stand-in for /api/review with the server's own rules: newest
 * first, cursor paging (`next` back as `before`), the override rule, an
 * idempotent decision, a 403 for a head of department and a 409 while a room
 * is being deleted. Every item has the shape of the queue item in docs/API.md.
 * Nothing here talks to the server.
 */

import { useState } from 'react';

import { ReviewScreen } from '../account/Review.jsx';

/* ------------------------------------------------------------------ helpers */

const NOW = Date.now();
const minsAgo = (m) => new Date(NOW - m * 60000).toISOString();
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** The same sample on every reload: a seeded generator, not Math.random. */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const hex = (r, n = 24) => Array.from({ length: n }, () => Math.floor(r() * 16).toString(16)).join('');
const round3 = (n) => Math.round(n * 1000) / 1000;
const PASS = 0.7;

/* ------------------------------------------------------------------- sample */

const ROOMS = [
  { code: 'TRN4KX', title: 'Unit III: Transport layer', status: 'open' },
  { code: 'RTG5NA', title: 'Routing algorithms', status: 'closed' },
  { code: 'DLK8HQ', title: 'Deadlocks', status: 'closed' },
  { code: 'MEM3VZ', title: 'Memory management', status: 'closed' },
  { code: 'SQJ7WP', title: 'SQL joins and subqueries', status: 'closed' },
];

const STUDENTS = [
  ['21CS01', 'Asha Rao'], ['21CS02', 'Kabir Mehta'], ['21CS03', 'Ishaan Kulkarni'], ['21CS04', 'Meher Siddiqui'],
  ['21CS05', 'Rhea Fernandes'], ['21CS06', 'Vihaan Bhat'], ['21CS07', 'Tara Menon'], ['21CS08', 'Arjun Pillai'],
  ['21CS09', 'Zoya Khan'], ['21CS10', 'Neel Joshi'], ['21CS11', 'Diya Shetty'], ['21CS12', 'Omar Sheikh'],
];

/* Each question, the room it ran in, when, and the answers the class wrote with
   the points the rubric matcher found in each. */
const QUESTIONS = [
  {
    room: 0, from: 38, to: 21, topic: 'Connection set-up', bloom: 'understand',
    text: 'Explain in your own words why TCP opens a connection with a three-way handshake.',
    rubric: ['both sides choose sequence numbers', 'each side acknowledges the other', 'stale duplicate segments are rejected'],
    answers: [
      ['Both sides pick a starting sequence number and each one acknowledges the other’s, so neither starts sending until it knows its numbers arrived.', 2],
      ['The client sends SYN, the server replies SYN-ACK and the client sends ACK. Each side acknowledges the other side’s sequence number, and an old duplicate SYN from an earlier connection is rejected because the numbers do not match.', 3],
      ['So the server knows the client is there.', 0],
      ['Three messages because two is not enough to be reliable.', 0],
      ['Each side chooses sequence numbers and both acknowledge them, otherwise a delayed packet could open a connection nobody asked for.', 2],
    ],
  },
  {
    room: 0, from: 18, to: 3, topic: 'Flow and congestion control', bloom: 'analyse',
    text: 'Compare flow control and congestion control. What problem does each solve, and which window does each use?',
    rubric: ['flow control protects the receiver', 'congestion control protects the network', 'receive window versus congestion window'],
    answers: [
      ['Flow control stops a fast sender from overrunning a slow receiver, using the window the receiver advertises. Congestion control stops senders from overloading the routers in between, using the congestion window.', 1],
      ['Flow control protects the receiver. Congestion control protects the network.', 2],
      ['They are the same thing, both slow the sender down.', 0],
      ['Flow control is end to end between two hosts. Congestion control is about the whole network and uses slow start.', 1],
    ],
  },
  {
    room: 1, from: 230, to: 196, topic: 'Link-state and distance-vector', bloom: 'evaluate',
    text: 'Judge whether link-state or distance-vector routing suits a campus network of 40 routers. Give one reason each way.',
    rubric: ['link-state converges faster', 'distance-vector needs less memory and processing', 'a judgement for the campus, with a reason'],
    answers: [
      ['Link-state, because every router has the whole map and it converges faster after a link fails. Distance-vector would use less memory, but forty routers is not many.', 2],
      ['Distance vector because it is simpler.', 0],
      ['Link-state converges faster and avoids count to infinity; distance-vector needs less memory and processing. For a campus of 40 routers I would pick link-state (OSPF), because the routers can afford the memory.', 3],
      ['OSPF.', 0],
    ],
  },
  {
    room: 2, from: 1500, to: 1470, topic: 'Coffman conditions', bloom: 'evaluate',
    stimulus: {
      kind: 'passage',
      text: 'A print server runs two processes. P1 locks the printer, then asks for the spool file. P2 locks the spool file, then asks for the printer. Neither lock is released until the job finishes, and neither process can take a lock from the other.',
    },
    text: 'Can this system deadlock? Judge it, and say which condition you would break to prevent it.',
    rubric: ['hold and wait is present', 'circular wait between the two processes', 'break one condition, such as ordering the resources'],
    answers: [
      ['Yes. P1 holds the printer and waits for the spool file while P2 holds the spool file and waits for the printer, so they wait on each other in a circle. I would make both take the locks in the same order, printer first.', 1],
      ['Yes, it can deadlock because of circular wait. Break it by ordering the resources.', 2],
      ['No, because the jobs finish eventually.', 0],
      ['Hold and wait is present and there is circular wait between the two processes. Requesting both locks at once breaks hold and wait.', 3],
    ],
  },
  {
    room: 2, from: 1466, to: 1450, topic: 'Banker’s algorithm', bloom: 'apply',
    text: 'When does the banker’s algorithm refuse a request? Use the idea of a safe state.',
    rubric: ['the request would leave an unsafe state', 'no sequence lets every process finish'],
    answers: [
      ['It refuses if granting it would leave the system in an unsafe state, where there is no order in which every process can still finish.', 1],
      ['When there are not enough resources available.', 0],
      ['If after granting, no sequence lets every process finish, the state is unsafe and the request has to wait.', 2],
    ],
  },
  {
    room: 3, from: 4340, to: 4310, topic: 'Paging', bloom: 'create',
    text: 'Design a page-replacement policy for a phone that must keep the foreground app responsive. Justify it.',
    rubric: ['keep the foreground app’s pages resident', 'evict least recently used background pages', 'justify with the cost of a page fault'],
    answers: [
      ['Pin the foreground app’s working set so it is never evicted, and use LRU across the background apps only. A fault in the foreground app shows up as a stutter, so it costs more than one in a background app.', 2],
      ['Use FIFO because it is simple.', 0],
      ['Keep the foreground app’s pages resident and evict least recently used background pages first, because a page fault costs a storage read of several milliseconds and the user would notice it.', 3],
      ['LRU for everything. The foreground app is used most, so it stays in memory anyway.', 1],
    ],
  },
];

/* Decisions already taken in the older rooms: [question, student] -> the
   decisions, oldest first. A decision is [kind, score, correct, note]. */
const REVIEWED = {
  '3:0': [['override', 1, true, 'Exactly right. "Wait on each other in a circle" is circular wait, and ordering the locks breaks it.']],
  '3:1': [['confirm', null, null, '']],
  '3:2': [['confirm', null, null, 'Look at whether either process lets go of what it holds while it waits.']],
  '3:4': [['confirm', null, null, ''], ['override', 0.833, true, 'Full marks for the conditions; the fix needed one more line on why it works.']],
  '4:0': [['override', 1, true, 'This is the safe-state test in full.']],
  '4:3': [['confirm', null, null, '']],
  '4:6': [['confirm', null, null, '']],
  '4:8': [['override', 0.5, false, 'Right idea, but say what "not enough" is measured against: the safe state.']],
  '5:0': [['override', 0.9, true, 'A real design with a reason. The pinning idea is good.']],
  '5:1': [['confirm', null, null, 'FIFO can evict the app you are using. Think about what the user notices.']],
  '5:2': [['confirm', null, null, '']],
  '5:3': [['confirm', null, null, '']],
  '5:5': [['override', 0.667, false, '']],
  '5:7': [['confirm', null, null, '']],
  '5:9': [['confirm', null, null, '']],
};

/** Every answer, with its review log, as the server would return them. */
function buildSample() {
  const r = seeded(20261119);
  const items = [];
  const logs = {};
  QUESTIONS.forEach((q, qi) => {
    const room = ROOMS[q.room];
    const qid = hex(r);
    // Most of the class answers; a few in the older rooms did not.
    const who = STUDENTS.filter((_, si) => qi < 2 || qi === 5 || (si * 7 + qi) % 6 !== 0);
    who.forEach(([rollNo, name], si) => {
      const [response, points] = q.answers[(si * 3 + qi) % q.answers.length];
      const autoScore = round3(points / q.rubric.length);
      const autoCorrect = autoScore >= PASS;
      const at = q.from - ((q.from - q.to) * si) / Math.max(1, who.length - 1) - r() * 0.8;
      const answeredAt = minsAgo(at);
      const answerId = hex(r);
      const item = {
        answerId,
        room: { ...room },
        student: { rollNo, name },
        topic: q.topic,
        bloom: q.bloom,
        kind: 'open',
        // Batch 9 (E3): the server's label and limit; every written answer here is a short one.
        kindLabel: 'Short answer',
        length: 'short',
        maxWords: 60,
        question: { id: qid, text: q.text, rubric: q.rubric, modelAnswer: null, stimulus: q.stimulus ?? null },
        response,
        autoCorrect,
        autoScore,
        autoDetail: `${points}/${q.rubric.length} rubric points`,
        correct: autoCorrect,
        score: autoScore,
        reviewStatus: 'provisional',
        reviewedBy: null,
        reviewedAt: null,
        reviewNote: '',
        attempt: (si + qi) % 5 === 0 ? 2 : 1,
        servedAt: new Date(new Date(answeredAt).getTime() - (50 + Math.floor(r() * 240)) * 1000).toISOString(),
        answeredAt,
      };
      const decisions = REVIEWED[`${qi}:${si}`];
      if (decisions) {
        let t = new Date(answeredAt).getTime() + 3 * 3600000;
        logs[answerId] = decisions.map(([decision, score, correct, note]) => {
          t += 40 * 60000;
          const row = {
            id: hex(r),
            decision,
            correct: decision === 'confirm' ? autoCorrect : correct,
            score: decision === 'confirm' ? autoScore : score,
            note,
            reviewedBy: 'a3f0c2d4-5b6e-4c7d-8e9f-0a1b2c3d4e5f',
            reviewedAt: new Date(t).toISOString(),
          };
          Object.assign(item, {
            correct: row.correct,
            score: row.score,
            reviewStatus: decision === 'confirm' ? 'confirmed' : 'overridden',
            reviewedBy: row.reviewedBy,
            reviewedAt: row.reviewedAt,
            reviewNote: note,
          });
          return row;
        });
      }
      items.push(item);
    });
  });
  return { items, logs };
}

const SAMPLE = buildSample();
const EMPTY = { items: [], logs: {} };

// One answer reviewed twice, with a note: for the entry that opens on it.
const WITH_LOG = SAMPLE.items.find((i) => (SAMPLE.logs[i.answerId]?.length ?? 0) > 1);

/* ----------------------------------------------------------- the stand-in */

const fail = (message, status) => Object.assign(new Error(message), { status });
const newestFirst = (a, b) => b.answeredAt.localeCompare(a.answeredAt) || b.answerId.localeCompare(a.answerId);

/**
 * GET and POST /api/review and GET /api/session, played out in memory.
 *
 * @param data     { items, logs }
 * @param role     who is asking; an HOD is refused a decision (403)
 * @param never    the reads never answer: the first-read skeleton
 * @param failFor  reads fail for this many ms after the screen opens, then work
 * @param refuse   every decision is refused with { status, message }
 */
function makeServices({ data = SAMPLE, role = 'professor', never = false, failFor = 0, refuse = null } = {}) {
  const store = {
    items: data.items.map((i) => ({ ...i })),
    logs: Object.fromEntries(Object.entries(data.logs).map(([k, v]) => [k, v.map((row) => ({ ...row }))])),
  };
  const born = Date.now();
  const down = () => failFor > 0 && Date.now() - born < failFor;

  return {
    async listSessions() {
      await wait(300);
      if (down()) throw fail('Failed to fetch', 0);
      return { rooms: ROOMS.map((room, i) => ({ ...room, startedAt: minsAgo(40 + i * 1440) })) };
    },

    async reviewQueue({ status = 'provisional', code, limit = 50, before } = {}) {
      if (never) return new Promise(() => {});
      await wait(500);
      if (down()) throw fail('Failed to fetch', 0);
      if (code && !ROOMS.some((room) => room.code === code)) throw fail('That room was not found.', 404);
      let list = store.items
        .filter((i) => status === 'all' || i.reviewStatus === status)
        .filter((i) => !code || i.room.code === code)
        .sort(newestFirst);
      if (before) {
        let at;
        let id;
        try { [at, id] = JSON.parse(atob(before)); } catch { throw fail('That page cursor was not issued by this server.', 400); }
        list = list.filter((i) => i.answeredAt < at || (i.answeredAt === at && i.answerId < id));
      }
      const page = list.slice(0, limit);
      const hasMore = list.length > limit;
      const last = page[page.length - 1];
      return {
        items: page.map((i) => ({ ...i })),
        status,
        limit,
        hasMore,
        next: hasMore ? btoa(JSON.stringify([last.answeredAt, last.answerId])) : null,
      };
    },

    async reviewItem(answerId) {
      await wait(350);
      const item = store.items.find((i) => i.answerId === answerId);
      if (!item) throw fail('That answer was not found.', 404);
      return { item: { ...item }, log: (store.logs[answerId] ?? []).map((row) => ({ ...row })) };
    },

    async review(answerId, body = {}) {
      await wait(700);
      if (refuse) throw fail(refuse.message, refuse.status);
      const item = store.items.find((i) => i.answerId === answerId);
      if (!item) throw fail('That answer was not found.', 404);
      if (role === 'hod') throw fail('That answer belongs to another teacher - you can read it but not change it.', 403);

      // The server's rule, word for word in effect.
      const note = String(body.note ?? '').trim();
      if (note.length > 1000) throw fail('note must be at most 1000 characters.', 400);
      const hasCorrect = body.correct !== undefined && body.correct !== null;
      const hasScore = body.score !== undefined && body.score !== null;
      let want;
      if (body.decision === 'confirm') {
        if (hasCorrect || hasScore) throw fail("confirm keeps the machine's mark and takes none of its own - send decision 'override' to change it.", 400);
        want = { reviewStatus: 'confirmed', correct: item.autoCorrect, score: round3(item.autoScore) };
      } else if (body.decision === 'override') {
        if (!hasCorrect && !hasScore) throw fail('An override needs a mark: send correct (true or false), score (0 to 1), or both.', 400);
        if (hasScore && (typeof body.score !== 'number' || body.score < 0 || body.score > 1)) throw fail('score must be a number from 0 to 1.', 400);
        const score = hasScore ? round3(body.score) : (body.correct ? 1 : 0);
        want = { reviewStatus: 'overridden', correct: hasCorrect ? body.correct : score >= PASS, score };
      } else {
        throw fail("decision must be 'confirm' or 'override'.", 400);
      }

      const inForce = item.reviewStatus === want.reviewStatus && item.correct === want.correct
        && round3(item.score) === want.score && (item.reviewNote ?? '') === note;
      if (!inForce) {
        const reviewedAt = new Date().toISOString();
        const row = { id: hex(seeded(Date.now())), decision: body.decision, correct: want.correct, score: want.score, note, reviewedBy: null, reviewedAt };
        store.logs[answerId] = [...(store.logs[answerId] ?? []), row];
        Object.assign(item, { ...want, reviewedBy: null, reviewedAt, reviewNote: note });
      }
      return {
        item: { ...item },
        changed: !inForce,
        logged: !inForce,
        profile: { found: true, adjusted: !inForce },
        log: (store.logs[answerId] ?? []).map((row) => ({ ...row })),
      };
    },
  };
}

/** One screen with its own stand-in, made once so its decisions persist. */
function Demo({ initialStatus, initialOpen, ...options }) {
  const [services] = useState(() => makeServices(options));
  return <ReviewScreen services={services} initialStatus={initialStatus} initialOpen={initialOpen} />;
}

/* ------------------------------------------------------------------ entries */

export default [
  {
    id: 'review-waiting',
    title: 'Review answers',
    role: 'professor',
    note: `${SAMPLE.items.filter((i) => i.reviewStatus === 'provisional').length} written answers waiting in four rooms: more than one page, so Load more pages by cursor.`,
    render: () => <Demo />,
  },
  {
    id: 'review-log',
    title: 'Review answers, an answer reviewed twice',
    role: 'professor',
    note: 'The All view, opened on an answer that was confirmed and then changed, with notes.',
    render: () => <Demo initialStatus="all" initialOpen={WITH_LOG?.answerId ?? null} />,
  },
  {
    id: 'review-hod',
    title: 'Review answers, read only for a head of department',
    role: 'hod',
    note: 'Every answer and decision, and no decision form.',
    render: () => <Demo role="hod" />,
  },
  {
    id: 'review-key',
    title: 'Review answers, shared teacher key',
    note: 'No account: the rooms nobody owns.',
    render: () => <Demo role={null} />,
  },
  {
    id: 'review-empty',
    title: 'Review answers, nothing waiting',
    role: 'professor',
    note: 'No written answer has been sent in any room yet.',
    render: () => <Demo data={EMPTY} />,
  },
  {
    id: 'review-loading',
    title: 'Review answers, first read',
    role: 'professor',
    note: 'The reads never answer, so the skeleton stays.',
    render: () => <Demo never />,
  },
  {
    id: 'review-failed',
    title: 'Review answers, the read failed',
    role: 'professor',
    note: 'The server is unreachable for the first two seconds; Try again then works.',
    render: () => <Demo failFor={2000} />,
  },
  {
    id: 'review-409',
    title: 'Review answers, room being deleted',
    role: 'professor',
    note: 'Every decision is refused with the server’s 409. Type a note and decide: the note stays.',
    render: () => (
      <Demo refuse={{ status: 409, message: 'That room is being deleted; its answers are being archived. Nothing was changed.' }} />
    ),
  },
];
