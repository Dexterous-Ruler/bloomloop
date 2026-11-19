// AI-proposed prerequisite links (Phase 6, decision H3, under decision 5).
//
// On the professor's button only, never in anything a student waits on: the
// professor picks some of their own chapters, the model reads those chapters'
// topic names with a bounded piece of each topic's slide text, and proposes
// DIRECT links (A is needed before B, with no listed topic in between), each
// with a one-line reason. Every proposal is stored as `proposed`, an AI draft
// that nothing uses until the professor confirms it (or rejects it, or adds
// links by hand).
//
// What the model returns is held to that here, not trusted (parseProposals):
//   - only topics it was shown, by the short label it was shown (T1, T2 ...);
//   - never a topic before itself, never a pair already linked either way
//     (whatever that link's state: a rejected link is not proposed again);
//   - never a link that would close a loop with the confirmed links or with
//     the proposals already taken;
//   - never a link a longer chain already implies (not direct);
//   - a reason of at most MAX_REASON characters, as plain text.
// Each refusal is named in `skipped`, so the professor can see what was dropped.
//
// With no model key the offline generator proposes nothing, and says so
// (OFFLINE_NOTE): links cannot be guessed from templates.
//
// Tests drive parseProposals with fixture responses and proposeLinks with a
// stand-in `callModel`; nothing here is called with a real key in a test.

import { GoogleGenAI, Type } from '@google/genai';

import { config, hasGemini } from '../config.js';
import { contextForTopic } from './generate.js';
import { holdsContact } from './roster.js';
import { impliedByChain, wouldLoop } from './hubGraph.js';
import { topicSlideText } from './hubTopics.js';

/** The most topics one request shows the model; the professor picks fewer chapters for more. */
export const MAX_PROPOSAL_TOPICS = 60;
/** The most chapters one request covers. */
export const MAX_PROPOSAL_CHAPTERS = 10;
/** Slide text per topic, in characters: enough to tell what the topic covers. */
export const MAX_TOPIC_CONTEXT = 500;
/** One line. */
export const MAX_REASON = 160;
/** The most proposals one reply may add. */
export const MAX_PROPOSALS = 80;

const CALL_TIMEOUT_MS = 60000;

export const OFFLINE_NOTE = 'No links were proposed: proposing them needs the AI model, and none is set up on this server. '
  + 'Add the links you know by hand; they count straight away.';

export const PROPOSED_NOTE = 'These are AI drafts. None is used until you confirm it; reject the ones that are wrong.';

const collapse = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/**
 * The model's input: each active topic of the chosen chapters with a short
 * label, its chapter, and a bounded piece of its slide text (the deck's kept
 * words for those slides, else the part of the chapter's text about it).
 *
 * `chapters`: [{ content, topics }] with each chapter's active topic records.
 *
 * @returns {{ entries: { label, topic, chapter, context }[], byLabel: Map<string, object>, dropped: number }}
 */
export function proposalInput(chapters = []) {
  const entries = [];
  let dropped = 0;
  for (const { content, topics } of chapters) {
    for (const topic of topics) {
      if (entries.length >= MAX_PROPOSAL_TOPICS) { dropped += 1; continue; }
      const context = topicSlideText(content, topic.name, MAX_TOPIC_CONTEXT)
        ?? collapse(contextForTopic(content.rawText ?? '', topic.name, MAX_TOPIC_CONTEXT)).slice(0, MAX_TOPIC_CONTEXT);
      entries.push({ label: `T${entries.length + 1}`, topic, chapter: content.title ?? '', context });
    }
  }
  return { entries, byLabel: new Map(entries.map((e) => [e.label, e])), dropped };
}

/** The instruction the model is given. Built from the professor's own material only. */
export function buildProposalPrompt({ entries }, confirmed = []) {
  const labelOf = new Map(entries.map((e) => [String(e.topic._id), e.label]));
  const known = confirmed
    .map((l) => [labelOf.get(String(l.prerequisiteId)), labelOf.get(String(l.topicId))])
    .filter(([a, b]) => a && b)
    .map(([a, b]) => `${a} before ${b}`);
  return [
    'You help a college professor map which topics of their own course a student must understand before another.',
    'Below are topics from the professor\'s chapters, each with a label, its chapter and a short extract of the professor\'s slides.',
    'Propose DIRECT prerequisite links only: "prerequisite" must be understood before "topic", and no other listed topic sits '
      + 'between them. Never propose a link that follows from two others (if A comes before B and B before C, do not propose A before C).',
    'Use only the labels given. Never invent a topic. Propose a link only when the extracts or the topics\' plain meaning make it clear; '
      + 'it is better to propose fewer links than wrong ones.',
    `Give each link a one-line reason, at most ${MAX_REASON} characters, that a professor can check against the slides.`,
    'Reply with JSON only: {"links": [{"prerequisite": "T1", "topic": "T2", "reason": "..."}]}.',
    known.length ? `Already confirmed by the professor (do not repeat): ${known.join('; ')}.` : '',
    '',
    'TOPICS',
    ...entries.map((e) => `${e.label} | ${collapse(e.topic.name)} | chapter: ${collapse(e.chapter)}${e.context ? ` | slides: ${e.context}` : ''}`),
  ].filter((line) => line !== '').join('\n');
}

const LINK_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    links: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          prerequisite: { type: Type.STRING },
          topic: { type: Type.STRING },
          reason: { type: Type.STRING },
        },
        required: ['prerequisite', 'topic', 'reason'],
      },
    },
  },
  required: ['links'],
};

let client = null;

/** The real call: Gemini, JSON out. Only ever reached with a key, on the professor's button. */
async function geminiCall(prompt, { timeoutMs = CALL_TIMEOUT_MS } = {}) {
  if (!client) client = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  const response = await client.models.generateContent({
    model: config.gemini.model,
    contents: 'Propose the direct prerequisite links now. Reply with the JSON object and nothing else.',
    config: {
      temperature: 0.2,
      responseMimeType: 'application/json',
      responseSchema: LINK_SCHEMA,
      systemInstruction: prompt,
      abortSignal: AbortSignal.timeout(timeoutMs),
    },
  });
  const text = response?.text;
  if (!text) throw new Error('the model returned an empty response');
  return text;
}

const stripFence = (text) => String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();

/** One reason as kept: plain, one line, at most MAX_REASON characters, no contact details. */
function cleanReason(raw) {
  const text = collapse(typeof raw === 'string' ? raw : '');
  if (!text || holdsContact(text)) return '';
  return text.length <= MAX_REASON ? text : `${text.slice(0, MAX_REASON - 3).replace(/\s+\S*$/, '')}...`;
}

/**
 * The model's reply held to the rules in the header. `text` is the reply as
 * the model sent it; `byLabel` from proposalInput; `links` every link the
 * professor already has (any state), for duplicates, loops and chains.
 *
 * @returns {{ proposals: { prerequisiteId, topicId, reason }[], skipped: { prerequisite, topic, why }[] }}
 * @throws when the reply is not JSON holding a list of links
 */
export function parseProposals(text, { byLabel, links = [] }) {
  let raw;
  try {
    raw = JSON.parse(stripFence(text));
  } catch {
    throw new Error('the model\'s reply was not JSON');
  }
  const list = Array.isArray(raw) ? raw : raw?.links;
  if (!Array.isArray(list)) throw new Error('the model\'s reply held no list of links');

  const pairKey = (a, b) => `${a}\u0000${b}`;
  const held = new Map();
  for (const l of links) {
    held.set(pairKey(String(l.prerequisiteId), String(l.topicId)), l.state);
    held.set(pairKey(String(l.topicId), String(l.prerequisiteId)), `${l.state}-reversed`);
  }
  const proposals = [];
  const skipped = [];
  const nameOf = (label) => byLabel.get(label)?.topic.name ?? String(label ?? '').slice(0, 40);

  for (const item of list) {
    const pLabel = collapse(item?.prerequisite).toUpperCase();
    const tLabel = collapse(item?.topic).toUpperCase();
    const skip = (why) => skipped.push({ prerequisite: nameOf(pLabel), topic: nameOf(tLabel), why });
    const p = byLabel.get(pLabel);
    const t = byLabel.get(tLabel);
    if (!p || !t) { skip('it named a topic that was not offered'); continue; }
    if (proposals.length >= MAX_PROPOSALS) { skip(`more than ${MAX_PROPOSALS} links were proposed at once`); continue; }
    const pid = String(p.topic._id);
    const tid = String(t.topic._id);
    if (pid === tid) { skip('a topic cannot come before itself'); continue; }
    const state = held.get(pairKey(pid, tid));
    if (state === 'rejected') { skip('you rejected this link before'); continue; }
    if (state) { skip('these two topics are already linked'); continue; }
    if (proposals.some((x) => x.prerequisiteId === pid && x.topicId === tid)) { skip('it was proposed twice'); continue; }
    const asLinks = [...links, ...proposals.map((x) => ({ ...x, state: 'confirmed' }))];
    if (wouldLoop(asLinks, pid, tid)) { skip('it would make a loop with the other links'); continue; }
    const reason = cleanReason(item?.reason);
    if (!reason) { skip('it came with no usable reason'); continue; }
    proposals.push({ prerequisiteId: pid, topicId: tid, reason });
  }

  // Direct links only: one a longer chain of the others already implies is
  // dropped, whichever order the model listed them in.
  const direct = proposals.filter((x) => !impliedByChain(links, x.prerequisiteId, x.topicId,
    proposals.filter((y) => y !== x)));
  for (const x of proposals) {
    if (!direct.includes(x)) {
      skipped.push({
        prerequisite: [...byLabel.values()].find((e) => String(e.topic._id) === x.prerequisiteId)?.topic.name ?? '',
        topic: [...byLabel.values()].find((e) => String(e.topic._id) === x.topicId)?.topic.name ?? '',
        why: 'a longer chain of links already implies it, so it is not direct',
      });
    }
  }
  return { proposals: direct, skipped };
}

/**
 * Ask for proposals. With no key (and no stand-in `callModel`) nothing is asked
 * and nothing is proposed: { source: 'offline', proposals: [], note: OFFLINE_NOTE }.
 * Never throws for a model problem: a failed call is a warning and no proposals.
 *
 * @returns {Promise<{ source: 'llm'|'offline', model: string|null, proposals, skipped, warnings: string[], note: string, topicsShown: number, topicsLeftOut: number }>}
 */
export async function proposeLinks({ chapters = [], links = [], callModel = null } = {}) {
  const input = proposalInput(chapters);
  const base = { skipped: [], warnings: [], topicsShown: input.entries.length, topicsLeftOut: input.dropped };
  if (input.dropped) {
    base.warnings.push(`Only the first ${MAX_PROPOSAL_TOPICS} topics were shown to the model; choose fewer chapters to cover the rest.`);
  }
  if (!callModel && !hasGemini()) {
    return { ...base, source: 'offline', model: null, proposals: [], note: OFFLINE_NOTE };
  }
  if (input.entries.length < 2) {
    return { ...base, source: 'llm', model: null, proposals: [], note: 'Two or more topics are needed before any can come before another.' };
  }
  const prompt = buildProposalPrompt(input, links.filter((l) => l.state === 'confirmed'));
  try {
    const text = await (callModel ?? geminiCall)(prompt, { timeoutMs: CALL_TIMEOUT_MS });
    const { proposals, skipped } = parseProposals(text, { byLabel: input.byLabel, links });
    return {
      ...base,
      skipped,
      source: 'llm',
      model: callModel ? 'stand-in' : config.gemini.model,
      proposals,
      note: proposals.length ? PROPOSED_NOTE : 'The model proposed no new links for these chapters.',
    };
  } catch (err) {
    return {
      ...base,
      source: 'llm',
      model: null,
      proposals: [],
      warnings: [...base.warnings, `The model could not propose links: ${err.message}.`],
      note: 'No links were proposed. Try again, or add the links you know by hand.',
    };
  }
}
