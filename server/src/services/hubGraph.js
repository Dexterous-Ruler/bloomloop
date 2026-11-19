// Prerequisite links between topics (Phase 6, decision H3). Pure: no store.
//
// A link says one topic is needed before another: `prerequisiteId` before
// `topicId`. Links join topics across any chapters the same professor owns
// (earlier semesters too). Each has a provenance (ai | professor) and a state
// (proposed | confirmed | rejected). Only CONFIRMED links are ever used: a
// proposal is a draft until the professor confirms it (decision 5), and a
// rejected one is kept so the same proposal is not offered again.
//
// Links are stored DIRECT only (A before B, B before C). Longer chains are
// computed here from them, never stored, so removing one link can never leave a
// stale chain behind. Cycles are refused when a link is added or confirmed
// (wouldLoop, with the path that would close the loop, for the sentence), so the
// confirmed links always form a graph with no loop; every walk here still keeps
// a visited set, so a loop that got in some other way cannot hang a request.

export const LINK_STATES = Object.freeze(['proposed', 'confirmed', 'rejected']);
export const LINK_PROVENANCE = Object.freeze(['ai', 'professor']);

const id = (v) => String(v ?? '');

/** Only the links that are used. */
export const confirmedOnly = (links = []) => links.filter((l) => l?.state === 'confirmed');

/** topicId -> [its direct prerequisites], and prerequisiteId -> [its direct dependants], from confirmed links, in link order. */
function adjacency(links) {
  const before = new Map();
  const after = new Map();
  for (const l of confirmedOnly(links)) {
    const p = id(l.prerequisiteId);
    const t = id(l.topicId);
    if (!before.has(t)) before.set(t, []);
    if (!after.has(p)) after.set(p, []);
    if (!before.get(t).includes(p)) before.get(t).push(p);
    if (!after.get(p).includes(t)) after.get(p).push(t);
  }
  return { before, after };
}

/** Breadth first from `start` along `next`: [{ topicId, depth, via: [ids it was reached from] }], nearest first. */
function walk(start, next) {
  const out = new Map();
  let frontier = [id(start)];
  const seen = new Set(frontier);
  for (let depth = 1; frontier.length; depth += 1) {
    const ahead = [];
    for (const from of frontier) {
      for (const to of next.get(from) ?? []) {
        if (to === id(start)) continue;
        if (out.has(to)) {
          // Reached again at the same depth by another route: say so.
          const entry = out.get(to);
          if (entry.depth === depth && !entry.via.includes(from)) entry.via.push(from);
          continue;
        }
        if (seen.has(to)) continue;
        seen.add(to);
        out.set(to, { topicId: to, depth, via: [from] });
        ahead.push(to);
      }
    }
    frontier = ahead;
  }
  return [...out.values()];
}

/**
 * Everything a topic needs first, from confirmed direct links: the nearest
 * first (depth 1 is a direct prerequisite), each once, at the shortest distance
 * it is needed from. `via` names the topic(s) one step nearer the target that
 * need it.
 *
 * @returns {{ topicId: string, depth: number, via: string[] }[]}
 */
export function prerequisiteChain(topicId, links = []) {
  return walk(topicId, adjacency(links).before);
}

/**
 * Everything that needs a topic, from confirmed direct links: nearest first,
 * each once. `via` names the topic(s) one step nearer it.
 *
 * @returns {{ topicId: string, depth: number, via: string[] }[]}
 */
export function dependantsOf(topicId, links = []) {
  return walk(topicId, adjacency(links).after);
}

/**
 * Would confirming "prerequisiteId before topicId" close a loop? It would when
 * prerequisiteId already needs topicId, at any distance. Returns that path as
 * topic ids, from topicId to prerequisiteId (each needed before the next), so
 * the refusal can name it; null when there is no loop. A link from a topic to
 * itself is the shortest loop: [topicId].
 */
export function wouldLoop(links = [], prerequisiteId, topicId) {
  const p = id(prerequisiteId);
  const t = id(topicId);
  if (p === t) return [t];
  const { after } = adjacency(links);
  // Breadth first from topicId along "is needed before", remembering the way back.
  const back = new Map([[t, null]]);
  let frontier = [t];
  while (frontier.length) {
    const ahead = [];
    for (const from of frontier) {
      for (const to of after.get(from) ?? []) {
        if (back.has(to)) continue;
        back.set(to, from);
        if (to === p) {
          const path = [p];
          for (let at = from; at !== null; at = back.get(at)) path.unshift(at);
          return path;
        }
        ahead.push(to);
      }
    }
    frontier = ahead;
  }
  return null;
}

/**
 * The sentence for a refused loop, with the topics' names: what the professor
 * asked, and the chain already confirmed that it would close.
 */
export function loopSentence(path, nameOf, prerequisiteId, topicId) {
  const name = (v) => `"${nameOf(id(v)) ?? 'a topic'}"`;
  if (path.length === 1) return `${name(topicId)} cannot be a prerequisite of itself.`;
  return `${name(prerequisiteId)} cannot come before ${name(topicId)}: the confirmed links already put `
    + `${path.map(name).join(' before ')}, so this link would make a loop. A topic cannot be needed before itself.`;
}

/**
 * Topics in an order a student can take them: each after every one of its
 * confirmed prerequisites that is also in the list. Ties keep the list's order.
 * Topics a loop would hold back (none, while loops are refused) are added at
 * the end in list order rather than dropped.
 */
export function dependencyOrder(topicIds = [], links = []) {
  const ids = [...new Set(topicIds.map(id))];
  const inList = new Set(ids);
  // Prerequisites at any distance, so A -> X -> C orders A before C even when X
  // is not in the list.
  const needs = new Map(ids.map((t) => [t, new Set(prerequisiteChain(t, links).map((e) => e.topicId).filter((x) => inList.has(x)))]));
  const done = new Set();
  const out = [];
  while (out.length < ids.length) {
    const next = ids.find((t) => !done.has(t) && [...needs.get(t)].every((x) => done.has(x)));
    if (!next) break;
    done.add(next);
    out.push(next);
  }
  for (const t of ids) if (!done.has(t)) out.push(t);
  return out;
}

/**
 * Is "prerequisiteId before topicId" already implied by a longer chain of the
 * given links (confirmed ones, plus any `extra` treated as confirmed)? A direct
 * link that a chain already implies is not direct: the model is asked for
 * direct links only (H3), and this is how its answer is held to that.
 */
export function impliedByChain(links = [], prerequisiteId, topicId, extra = []) {
  const all = [...confirmedOnly(links), ...extra.map((e) => ({ ...e, state: 'confirmed' }))]
    .filter((l) => !(id(l.prerequisiteId) === id(prerequisiteId) && id(l.topicId) === id(topicId)));
  return prerequisiteChain(topicId, all).some((e) => e.topicId === id(prerequisiteId));
}
