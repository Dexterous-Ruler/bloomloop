// Batch 8 - "Suggest a teaching move" (docs/UI_ZIP_AUDIT.md L1) and activity
// prompts written for the chapter (C2), under decisions 1 and 5.
//
// On the live screen a professor presses "Suggest a move". The server asks the
// model, in the background (decision 5: only on a professor's button, never in
// anything a student waits on, and it moves no level), for ONE two-minute
// activity that needs no device, aimed at the level where the class is stuck.
// Asked for one of the room's five activity kinds instead, the same call writes
// that activity's prompt for the chapter (C2). "Another idea" asks again, with
// the room's earlier suggestions to avoid; "Use it" records the suggestion as an
// activity through the activities route, which points back at it.
//
// What the model is given, and nothing else:
//   - the room's AGGREGATE figures (moveBasis): how many students are working at
//     each level with the level's right and answered counts, how many are below
//     40% overall (the support band) of how many placed, how many present
//     students have not answered, and how many are present. Never a name, a roll
//     number or one student's figures.
//   - the chapter's title, one of its topics, the slide numbers that topic came
//     from and a bounded piece of the professor's own text for it (decision 1).
// What comes back is held to the rules here, not trusted (parseMove): one of the
// five kinds (the one asked for, when one was); plain text of bounded length
// with no contact details and none of the words that label students; slide
// numbers only from those offered. A reply that breaks a rule is refused whole,
// and the professor is told the model could not make one: never a repaired or
// invented suggestion. With no model on the server, nothing is asked and the
// reply says so plainly (OFFLINE_MESSAGE); a template is never passed off as a
// suggestion.
//
// Every suggestion is kept (teaching_moves, 0034, append-only) with the figures
// it was built from, so it can be read later, beside the activity it became.
// Tests drive parseMove with fixture replies and the background path with a
// stand-in model (useModelForTests); no test calls a real model.

import crypto from 'node:crypto';
import { GoogleGenAI, Type } from '@google/genai';

import { config, hasGemini } from '../config.js';
import { LEVELS, LABEL } from '../bloom.js';
import { ACTIVITY_KINDS } from './records.js';
import { classLevels, focusCard, roomFigures, MIN_BAND_ANSWERS } from './insights.js';
import { allAnswers } from './evidence.js';
import { contextForTopic } from './generate.js';
import { slidesOfTopic, topicSlideText } from './hubTopics.js';
import { holdsContact } from './roster.js';

const fail = (message, status) => Object.assign(new Error(message), { status });

/** Beside every suggestion, as the design has it. */
export const AI_LABEL = 'AI suggestion, your call';
export const PURPOSES = Object.freeze(['move', 'prompt']);
const KIND_IDS = ACTIVITY_KINDS.map((k) => k.id);
const kindLabel = (id) => ACTIVITY_KINDS.find((k) => k.id === id)?.label ?? id;

/** The stored limits (teaching_moves_text_check). */
export const MAX_TITLE = 80;
export const MAX_BODY = 600;
/** What the model may write: read aloud or projected in a two-minute slot. */
export const MAX_MODEL_BODY = 500;
/** The part of the professor's text the model is shown. */
export const MAX_CONTEXT = 1500;
/** Earlier suggestions in the room the model is told not to repeat. */
export const MAX_EARLIER = 5;
const CALL_TIMEOUT_MS = 45000;
/** How long a finished request's state is kept for the screen to read. */
const REQUEST_TTL_MS = 15 * 60 * 1000;

export const OFFLINE_MESSAGE = 'Suggestions need the AI model, and this server has none set up, so no suggestion was made. '
  + 'Choose an activity yourself; it is recorded the same way.';
export const FAILED_MESSAGE = 'The AI model could not make a usable suggestion this time. Try again, or choose an activity yourself.';
export const NO_FOCUS_MESSAGE = 'No graded answers yet, so there is nowhere the class is stuck to aim a move at. '
  + 'Ask for one activity\'s prompt instead, or wait for answers.';
export const BUSY_MESSAGE = 'A suggestion for this room is being written now. Wait for it to arrive.';
export const STAFF_NOTE = 'Built from the room\'s counts only, never a name. Staff only: a suggestion is never shown on a phone or the projector.';

/* ---------------------------------------------------------------- basis -- */

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * The room's aggregate figures a suggestion is built from, pure. `figures` is
 * roomFigures(), `levels` classLevels(). Counts only: no name or roll number
 * goes in, so none can come out.
 */
export function moveBasis({ figures, levels }) {
  const working = Object.fromEntries(LEVELS.map((l) => [l, 0]));
  for (const s of figures.students) if (s.answers > 0) working[s.workingLevel] += 1;
  const level = focusCard(figures, levels).figures.level;
  const notAnswered = figures.present - figures.answered;
  const basis = {
    present: figures.present,
    graded: figures.graded,
    notAnswered,
    support: { count: figures.support, banded: figures.banded },
    levels: LEVELS.map((l) => ({
      level: l, label: LABEL[l], working: working[l], answers: levels[l].answers, correct: levels[l].correct,
    })),
    focus: level
      ? { level, label: LABEL[level], working: working[level], answers: levels[level].answers, correct: levels[level].correct }
      : null,
  };
  return { ...basis, sentence: basisSentence(basis) };
}

/** "Based on ..." in words, as the design's line under a suggestion. */
export function basisSentence(b) {
  const parts = [];
  if (b.focus) {
    parts.push(`${plural(b.focus.working, 'student', 'students')} working at ${b.focus.label}`);
    parts.push(b.focus.answers
      ? `${b.focus.correct} of ${plural(b.focus.answers, `${b.focus.label} answer`, `${b.focus.label} answers`)} right`
      : `no ${b.focus.label} answers yet`);
  } else {
    parts.push('no graded answers yet');
  }
  parts.push(b.support.count === null || b.support.count === undefined
    ? `nobody with ${MIN_BAND_ANSWERS} graded answers yet`
    : `${b.support.count} of ${b.support.banded} below 40% overall`);
  parts.push(`${plural(b.notAnswered, 'present student', 'present students')} not answered yet`);
  return `Based on ${parts.join(', ')}.`;
}

/* --------------------------------------------------------------- topic -- */

const key = (v) => String(v ?? '').trim().toLowerCase();

/**
 * Which of the chapter's topics a suggestion draws on, pure. `wanted`, when
 * sent, must be one of them. Otherwise the topic whose final graded answers in
 * this room went worst at the focus level (at any level when there is none),
 * with at least two answers; otherwise the chapter's first topic.
 *
 * @returns {{ topic: string, why: string }}
 */
export function chooseTopic({ topics = [], answers = [], focus = null, wanted } = {}) {
  const list = topics.map((t) => String(t ?? '').trim()).filter(Boolean);
  if (wanted !== undefined && wanted !== null && String(wanted).trim()) {
    const hit = list.find((t) => key(t) === key(wanted));
    if (!hit) throw fail('topic must be one of the chapter\'s topics.', 400);
    return { topic: hit, why: 'chosen by the professor' };
  }
  const tally = new Map();
  for (const a of answers) {
    if (a?.final === false || a?.ungraded || typeof a?.correct !== 'boolean') continue;
    if (focus && a.bloom !== focus) continue;
    const t = list.find((x) => key(x) === key(a.topic));
    if (!t) continue;
    const held = tally.get(t) ?? { answers: 0, correct: 0 };
    held.answers += 1;
    if (a.correct) held.correct += 1;
    tally.set(t, held);
  }
  const ranked = [...tally.entries()].filter(([, v]) => v.answers >= 2)
    .sort(([ta, a], [tb, b]) => a.correct / a.answers - b.correct / b.answers || b.answers - a.answers || ta.localeCompare(tb));
  if (ranked.length) {
    const [topic, v] = ranked[0];
    return { topic, why: `${v.correct} of ${v.answers} right${focus ? ` at ${LABEL[focus]}` : ''} in this room, the fewest of any topic` };
  }
  return { topic: list[0] ?? '', why: list.length ? 'the chapter\'s first topic' : 'the chapter lists no topics' };
}

/**
 * The professor's own material for the topic (decision 1): its slide numbers
 * and the deck's kept words for them, else the part of the chapter's text about
 * it, at most MAX_CONTEXT characters.
 */
export function materialFor(content, topic) {
  const slides = topic ? slidesOfTopic(content, topic) : [];
  const fromSlides = topic ? topicSlideText(content, topic, MAX_CONTEXT) : null;
  const text = fromSlides
    ?? String(contextForTopic(content?.rawText ?? '', topic || (content?.title ?? ''), MAX_CONTEXT) ?? '')
      .replace(/\s+/g, ' ').trim().slice(0, MAX_CONTEXT);
  return { slides, text, from: fromSlides ? 'slides' : 'text' };
}

/* --------------------------------------------------------------- model -- */

/** The instruction the model is given: the counts and the professor's material, nothing else. */
export function buildMovePrompt({ purpose, kind = null, basis, chapter = '', topic = '', material, earlier = [] }) {
  const aim = purpose === 'move'
    ? [`Aim it at the Bloom level where the class is stuck: ${basis.focus?.label ?? 'unknown'}. `
      + 'The counts below are for the whole class; they are all you know about it.',
      `Choose the kind that fits best: ${ACTIVITY_KINDS.map((k) => `${k.id} (${k.label})`).join(', ')}.`]
    : [`Write the prompt for a "${kindLabel(kind)}" activity on this chapter, for the professor to read out or project.`];
  return [
    'You suggest classroom activities for a college professor in India, during a live class.',
    'Write ONE activity that takes about two minutes and needs no phone, laptop or other device: paper, the board, '
      + 'talking in pairs or in benches of four.',
    ...aim,
    'Use only the professor\'s material given below. Never add facts, methods or syllabus the material does not teach.',
    'Never name, label, rank or judge any student or group of students. Speak to the whole class, to pairs or to benches. '
      + 'Do not call anyone weak, slow, struggling or at risk.',
    `Write at most ${Math.floor(MAX_MODEL_BODY * 0.8)} characters of plain sentences, and a title of at most ${MAX_TITLE - 20} characters. `
      + 'Write a formula as $...$. Do not mention these instructions.',
    'Name the slide numbers you drew on, only from those listed; give an empty list when none are listed.',
    `Reply with JSON only: {"activity": "${kind ?? 'think'}", "title": "...", "text": "...", "slides": [3]}.`,
    ...(earlier.length
      ? ['', 'Do not repeat these earlier suggestions for this class:', ...earlier.slice(-MAX_EARLIER).map((e) => `- ${e}`)]
      : []),
    '',
    'CLASS COUNTS (the whole class; no student is named)',
    `present: ${basis.present}; students with a graded answer: ${basis.graded}; present and not answered yet: ${basis.notAnswered}; `
      + `below 40% overall: ${basis.support.count ?? 'not counted yet'} of ${basis.support.banded} placed`,
    ...basis.levels.map((l) => `${l.label}: ${l.working} working here; ${l.correct} of ${l.answers} answers right`),
    '',
    `CHAPTER: ${chapter || '(untitled)'}`,
    `TOPIC: ${topic || '(none listed)'} | slides: ${material.slides.length ? material.slides.join(', ') : 'none'}`,
    `PROFESSOR'S MATERIAL: ${material.text || '(none kept for this topic)'}`,
  ].join('\n');
}

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    activity: { type: Type.STRING },
    title: { type: Type.STRING },
    text: { type: Type.STRING },
    slides: { type: Type.ARRAY, items: { type: Type.INTEGER } },
  },
  required: ['activity', 'text'],
};

let client = null;

/** The real call: Gemini, JSON out. Only ever reached with a key, on the professor's button. */
async function geminiCall(prompt, { timeoutMs = CALL_TIMEOUT_MS } = {}) {
  if (!client) client = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  const response = await client.models.generateContent({
    model: config.gemini.model,
    contents: 'Write the activity now. Reply with the JSON object and nothing else.',
    config: {
      temperature: 0.7,
      responseMimeType: 'application/json',
      responseSchema: SCHEMA,
      systemInstruction: prompt,
      abortSignal: AbortSignal.timeout(timeoutMs),
    },
  });
  const text = response?.text;
  if (!text) throw new Error('the model returned an empty response');
  return text;
}

// Tests only: a stand-in for the model, so the background path can be driven
// with fixture replies through the real parsing. Never set by the server.
let standIn = null;
export function useModelForTests(fn) {
  standIn = typeof fn === 'function' ? fn : null;
}

/** Whether a suggestion can be asked for on this server now. */
export const modelReady = () => Boolean(standIn) || hasGemini();

const collapse = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const tidy = (v) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/[ \t\f\v]+/g, ' ').replace(/ *\n */g, '\n')
  .replace(/\n{3,}/g, '\n\n').trim();
const stripFence = (text) => String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();

/**
 * Words that label or judge students: a suggestion holding one is refused. The
 * model is told never to use them; this is the check that it did not.
 */
export const LABELLING = /\b(weak(?:er|est)?\s+(?:students?|learners?|ones|group|benches)|slow\s+learners?|dull|lazy|backward|at[- ]risk|low[- ]perform\w*|below[- ]average|toppers?|struggling\s+(?:students?|learners?|ones)|poor\s+(?:students?|performers?)|weak\s+ones)\b/i;

/**
 * The model's reply held to the rules in the header.
 *
 * @returns {{ activityKind, title, body, sourceRef }}
 * @throws with the reason when the reply cannot be used
 */
export function parseMove(text, { kind = null, slides = [], topic = '' } = {}) {
  let raw;
  try {
    raw = JSON.parse(stripFence(text));
  } catch {
    throw new Error('the model\'s reply was not JSON');
  }
  const item = Array.isArray(raw) ? raw[0] : (raw?.suggestion ?? raw);
  if (!item || typeof item !== 'object') throw new Error('the model\'s reply held no suggestion');
  const activityKind = collapse(item.activity).toLowerCase();
  if (!KIND_IDS.includes(activityKind)) throw new Error('it named an activity kind the room does not have');
  if (kind && activityKind !== kind) throw new Error('it was not the activity kind asked for');
  const body = typeof item.text === 'string' ? tidy(item.text) : '';
  if (!body) throw new Error('it came with no text');
  if (body.length > MAX_MODEL_BODY) throw new Error(`it was longer than ${MAX_MODEL_BODY} characters`);
  let title = collapse(item.title);
  if (title.length > MAX_TITLE) title = `${title.slice(0, MAX_TITLE - 1).replace(/\s+\S*$/, '')}…`;
  for (const words of [body, title]) {
    if (holdsContact(words)) throw new Error('it held an email address or a phone number');
    if (LABELLING.test(words)) throw new Error('it labelled or judged students');
  }
  const offered = new Set(slides);
  const cited = [...new Set((Array.isArray(item.slides) ? item.slides : []).filter((n) => Number.isInteger(n) && offered.has(n)))]
    .sort((a, b) => a - b);
  // It read these slides' words; one that cites none of them still drew on
  // them, so it cites them all rather than none (as explanations do).
  const used = cited.length ? cited : [...offered].sort((a, b) => a - b);
  const sourceRef = used.length ? { kind: 'slides', slides: used, topic } : { kind: 'text', topic };
  return { activityKind, title, body, sourceRef };
}

/* -------------------------------------------------------------- the room -- */

/** The kind asked for: one of the five, or null for a move aimed by the counts. */
export function moveKindFrom(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  if (!KIND_IDS.includes(raw)) throw fail(`kind must be one of ${KIND_IDS.join(', ')}.`, 400);
  return raw;
}

/**
 * Everything a suggestion for this room is built from, read now. A move (no
 * kind) needs a level to aim at: 409 with NO_FOCUS_MESSAGE before any answer.
 */
export async function moveInput(repo, session, { kind = null, topic } = {}) {
  const [profiles, roster, marks, content, earlier] = await Promise.all([
    repo.listProfiles(session._id),
    session.classId ? repo.listClassStudents(session.classId) : [],
    session.classId ? repo.listAttendance(session._id) : [],
    repo.getContent(session.contentId),
    repo.listTeachingMoves(session._id),
  ]);
  const figures = roomFigures({ session, profiles, roster, marks });
  const basis = moveBasis({ figures, levels: classLevels(profiles) });
  const purpose = kind ? 'prompt' : 'move';
  if (purpose === 'move' && !basis.focus) throw fail(NO_FOCUS_MESSAGE, 409);
  const answers = await allAnswers(repo, { sessionId: session._id, final: true, classVotes: false });
  const chosen = chooseTopic({ topics: content?.topics ?? [], answers, focus: basis.focus?.level ?? null, wanted: topic });
  const material = materialFor(content, chosen.topic);
  return {
    purpose,
    kind,
    basis: { ...basis, topicWhy: chosen.why },
    chapter: content?.title ?? session.title ?? '',
    topic: chosen.topic,
    material,
    earlier: earlier.filter((m) => m.purpose === purpose).map((m) => collapse(`${m.title}: ${m.body}`).slice(0, 200)),
  };
}

/** Ask the model once and hold its reply to the rules. Throws with the reason. */
export async function draftMove(input, { callModel = null } = {}) {
  const call = callModel ?? standIn ?? geminiCall;
  const text = await call(buildMovePrompt(input), { timeoutMs: CALL_TIMEOUT_MS });
  return parseMove(text, { kind: input.kind, slides: input.material.slides, topic: input.topic });
}

/** One suggestion as a staff screen gets it. `used`: ids of the activities recorded from it. */
export function moveView(m, { used = [] } = {}) {
  return {
    id: String(m._id),
    purpose: m.purpose,
    kind: m.activityKind,
    kindLabel: kindLabel(m.activityKind),
    title: m.title ?? '',
    text: m.body,
    focus: m.focusLevel ? { level: m.focusLevel, label: LABEL[m.focusLevel] ?? m.focusLevel } : null,
    topic: m.topic ?? '',
    basis: m.basis ?? {},
    sourceRef: m.sourceRef ?? null,
    label: AI_LABEL,
    model: m.model,
    askedBy: m.askedBy ?? null,
    askedAt: m.askedAt ?? null,
    used,
  };
}

/* ---------------------------------------------------------- background -- */

// The requests in flight and just finished, in this process: requestId ->
// { ownerKey, sessionId, state, suggestionId, message, at }. A restart loses
// them (the suggestion, once kept, is in the store and in the list); the
// screen then reads the list.
const requests = new Map();
const running = new Set(); // sessionIds with a request in flight

function sweep(now = Date.now()) {
  for (const [id, r] of requests) if (r.state !== 'running' && now - r.at > REQUEST_TTL_MS) requests.delete(id);
}

/** A request's state for its owner in its room, or null (one null for "none" and "not yours"). */
export function moveRequest(requestId, { ownerKey, sessionId }) {
  const r = requests.get(String(requestId ?? ''));
  if (!r || r.ownerKey !== String(ownerKey) || r.sessionId !== String(sessionId)) return null;
  return { id: String(requestId), state: r.state, suggestionId: r.suggestionId ?? null, message: r.message ?? null };
}

/**
 * Start a suggestion for this room in the background. Returns at once:
 * { state: 'offline', message } with no model (nothing asked, nothing kept), or
 * { state: 'running', requestId }. When the model's reply is kept the request
 * becomes 'done' with the suggestion's id; when it cannot be used, 'failed'
 * with FAILED_MESSAGE. `notify(event)` hears the outcome (the route pushes it to
 * the room's teacher screens). Never rejects after it has returned.
 */
export function startMove(repo, { session, input, askedBy = null, ownerKey, notify = null }) {
  if (!modelReady()) return { state: 'offline', message: OFFLINE_MESSAGE };
  const sessionId = String(session._id);
  if (running.has(sessionId)) throw fail(BUSY_MESSAGE, 409);
  sweep();
  const requestId = crypto.randomUUID();
  requests.set(requestId, { ownerKey: String(ownerKey), sessionId, state: 'running', at: Date.now() });
  running.add(sessionId);
  const settle = (patch) => {
    requests.set(requestId, { ...requests.get(requestId), ...patch, at: Date.now() });
    running.delete(sessionId);
    if (notify) {
      try {
        notify({ requestId, ...patch });
      } catch (err) {
        console.error('[teaching-moves] push failed:', err);
      }
    }
  };
  Promise.resolve()
    .then(() => draftMove(input))
    .then(async (made) => {
      const kept = await repo.addTeachingMove({
        sessionId,
        purpose: input.purpose,
        activityKind: made.activityKind,
        title: made.title,
        body: made.body,
        focusLevel: input.basis.focus?.level ?? null,
        topic: input.topic,
        basis: input.basis,
        sourceRef: made.sourceRef,
        model: standIn ? 'stand-in' : config.gemini.model,
        askedBy,
      });
      settle({ state: 'done', suggestionId: String(kept._id), suggestion: moveView(kept) });
    })
    .catch((err) => {
      console.error('[teaching-moves] no suggestion:', err.message);
      settle({ state: 'failed', message: FAILED_MESSAGE });
    });
  return { state: 'running', requestId };
}
