// Supabase / Postgres implementation of the repository interface.
//
// Run supabase/schema.sql once in the Supabase SQL editor before using this.
//
// Two translations happen here and nowhere else:
//   snake_case columns  <->  camelCase document fields
//   `id` (uuid)         <->  `_id` (what every caller above this layer reads)
// Everything above the repository keeps speaking the document shape from the
// project report section 5, so swapping the store changed no other file.
//
// Connects with the service role key, which bypasses row level security. The
// schema enables RLS with no policies, so this key is the only way in - which is
// exactly why it must never reach the client bundle.

import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { PAYLOAD_FIELDS } from '../questionTypes.js';

const fail = (op) => (error) => {
  throw new Error(`[supabase] ${op}: ${error.message ?? error}`);
};

/** Throw on a Postgres error, otherwise hand back the rows. */
function unwrap(op, { data, error }) {
  if (error) fail(op)(error);
  return data;
}

// ---------------------------------------------------------------- mappers --

const outContent = (r) =>
  r && {
    _id: r.id,
    title: r.title,
    kind: r.kind,
    rawText: r.raw_text ?? '',
    topics: Array.isArray(r.topics) ? r.topics : [],
    ownerId: r.owner_id ?? null,
    createdAt: r.created_at,
  };

const inContent = (d) => ({
  title: d.title,
  kind: d.kind,
  raw_text: d.rawText ?? '',
  topics: Array.isArray(d.topics) ? d.topics : [],
  // null is meaningful: it marks a pre-accounts row, which only the legacy
  // teacher-key path may reach. See ownership.js.
  owner_id: d.ownerId ?? null,
});

// Everything kind-specific lives in one jsonb column and is spread back out on
// read, so the rest of the server only ever sees a flat question document and a
// new kind needs no migration. options/answer_idx stay as real columns because
// mcq and multi use them and the existing rows depend on them.
// Imported, never retyped: a second copy of this list drifting out of date is
// exactly how every match, order, blank and open question once arrived empty.
const PAYLOAD_KEYS = PAYLOAD_FIELDS;

const outQuestion = (r) =>
  r && {
    _id: r.id,
    contentId: r.content_id,
    topic: r.topic ?? '',
    text: r.text,
    kind: r.kind ?? 'mcq',
    options: Array.isArray(r.options) ? r.options : [],
    answerIdx: r.answer_idx,
    bloom: r.bloom,
    status: r.status,
    source: r.source,
    createdAt: r.created_at,
    ...(r.payload && typeof r.payload === 'object' ? r.payload : {}),
  };

const inQuestion = (d) => {
  const payload = {};
  for (const k of PAYLOAD_KEYS) if (d[k] !== undefined) payload[k] = d[k];
  return {
    content_id: d.contentId,
    topic: d.topic ?? '',
    text: d.text,
    kind: d.kind ?? 'mcq',
    // Only mcq/multi carry options; the column is nullable for the rest.
    options: Array.isArray(d.options) && d.options.length ? d.options : null,
    answer_idx: Number.isInteger(d.answerIdx) ? d.answerIdx : null,
    bloom: d.bloom,
    status: d.status ?? 'active',
    source: d.source ?? 'llm',
    payload,
  };
};

const outSession = (r) =>
  r && {
    _id: r.id,
    code: r.code,
    contentId: r.content_id,
    title: r.title ?? '',
    status: r.status,
    ownerId: r.owner_id ?? null,
    startedAt: r.started_at,
    closedAt: r.closed_at,
    pausedAt: r.paused_at ?? null,
    // Phase 7 room settings. `mastery_goal` is a Postgres numeric, and PostgREST
    // hands numerics back as STRINGS to keep arbitrary precision - so without
    // this Number() the goal arrives as '0.80', every === against 0.8 is false,
    // and the room silently falls back to the default it was already set to.
    // The one place it would have shown is the one place it matters: a teacher
    // who picked 100% getting an 80% bar.
    masteryGoal: Number(r.mastery_goal),
    reattempts: Number(r.reattempts) || 0,
    redemption: r.redemption === true,
  };

const outProfile = (r) =>
  r && {
    _id: r.id,
    sessionId: r.session_id,
    rollNo: r.roll_no,
    name: r.name ?? '',
    levels: r.levels ?? {},
    workingLevel: r.working_level,
    reason: r.reason ?? '',
    history: Array.isArray(r.history) ? r.history : [],
    // Flattened into one object at this boundary, like every other mapping here.
    // `tries` and `last` are part of the pin rather than fields of their own:
    // they describe the attempt in progress on THAT question, and they are
    // meaningless - and must not survive - once the pin is cleared.
    served: r.served_id
      ? {
          questionId: r.served_id,
          at: r.served_at,
          reason: r.served_why ?? '',
          tries: Number(r.served_tries) || 0,
          last: r.served_last ?? '',
        }
      : null,
    integrity: Array.isArray(r.integrity) ? r.integrity : [],
  };

/** Only the fields the caller actually sent, so a PATCH never blanks a column. */
function pick(patch, map) {
  const out = {};
  for (const [from, to] of Object.entries(map)) {
    if (patch[from] !== undefined) out[to] = patch[from];
  }
  return out;
}

// ------------------------------------------------------------------- repo --

export function createSupabaseRepo() {
  const db = createClient(config.supabase.url, config.supabase.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-application-name': 'bloomloop' } },
  });

  return {
    kind: 'supabase',

    // -- content --
    async createContent(doc) {
      const rows = unwrap(
        'createContent',
        await db.from('contents').insert(inContent(doc)).select().single(),
      );
      return outContent(rows);
    },

    async getContent(id) {
      const { data, error } = await db.from('contents').select('*').eq('id', id).maybeSingle();
      if (error) fail('getContent')(error);
      return outContent(data);
    },

    async listContents() {
      const rows = unwrap(
        'listContents',
        await db.from('contents').select('*').order('created_at', { ascending: false }),
      );
      return (rows ?? []).map(outContent);
    },

    async updateContent(id, patch) {
      const set = pick(patch, { title: 'title', rawText: 'raw_text', topics: 'topics' });
      if (Object.keys(set).length === 0) return this.getContent(id);
      const { data, error } = await db.from('contents').update(set).eq('id', id).select().maybeSingle();
      if (error) fail('updateContent')(error);
      return outContent(data);
    },

    // -- questions --
    async insertQuestions(docs) {
      if (!docs?.length) return [];
      // Chunked: a whole chapter can be a few hundred rows and PostgREST has a
      // request size ceiling.
      const out = [];
      const CHUNK = 200;
      for (let i = 0; i < docs.length; i += CHUNK) {
        const rows = unwrap(
          'insertQuestions',
          await db.from('questions').insert(docs.slice(i, i + CHUNK).map(inQuestion)).select(),
        );
        out.push(...(rows ?? []).map(outQuestion));
      }
      return out;
    },

    async listQuestions(contentId, { includeDiscarded = false } = {}) {
      let q = db.from('questions').select('*').eq('content_id', contentId);
      if (!includeDiscarded) q = q.eq('status', 'active');
      // PostgREST caps rows at 1000 by default; a chapter bank is far under that,
      // but say it explicitly rather than silently truncating a big one.
      const rows = unwrap('listQuestions', await q.limit(2000));
      return (rows ?? []).map(outQuestion);
    },

    async getQuestion(id) {
      const { data, error } = await db.from('questions').select('*').eq('id', id).maybeSingle();
      if (error) fail('getQuestion')(error);
      return outQuestion(data);
    },

    async updateQuestion(id, patch) {
      const set = pick(patch, {
        text: 'text',
        options: 'options',
        answerIdx: 'answer_idx',
        bloom: 'bloom',
        status: 'status',
        topic: 'topic',
        source: 'source',
        kind: 'kind',
      });
      const payload = {};
      for (const k of PAYLOAD_KEYS) if (patch[k] !== undefined) payload[k] = patch[k];
      if (Object.keys(payload).length) set.payload = payload;
      if (Object.keys(set).length === 0) return this.getQuestion(id);
      const { data, error } = await db.from('questions').update(set).eq('id', id).select().maybeSingle();
      if (error) fail('updateQuestion')(error);
      return outQuestion(data);
    },

    // Used by a replacing generate. Without it "generate" could only ever add,
    // which is how one deck accumulated 864 questions over six presses.
    async deleteQuestions(contentId) {
      const { error, count } = await db
        .from('questions')
        .delete({ count: 'exact' })
        .eq('content_id', contentId);
      if (error) fail('deleteQuestions')(error);
      return count ?? 0;
    },

    async countQuestions(contentId) {
      const { count, error } = await db
        .from('questions')
        .select('id', { count: 'exact', head: true })
        .eq('content_id', contentId)
        .eq('status', 'active');
      if (error) fail('countQuestions')(error);
      return count ?? 0;
    },

    // -- sessions --
    async createSession(doc) {
      const rows = unwrap(
        'createSession',
        await db
          .from('sessions')
          .insert({
            code: doc.code,
            content_id: doc.contentId,
            title: doc.title ?? '',
            status: doc.status ?? 'open',
            owner_id: doc.ownerId ?? null,
            // Written once, here, and never patched. updateSession() deliberately
            // has no mapping for these three: they change what an answer MEANS,
            // so changing them mid-room would leave the students who answered
            // before the change and the ones who answered after in one grid,
            // measured differently, with nothing on screen to say so.
            mastery_goal: doc.masteryGoal,
            reattempts: doc.reattempts,
            redemption: doc.redemption,
          })
          .select()
          .single(),
      );
      return outSession(rows);
    },

    async getSession(id) {
      const { data, error } = await db.from('sessions').select('*').eq('id', id).maybeSingle();
      if (error) fail('getSession')(error);
      return outSession(data);
    },

    async getSessionByCode(code) {
      const { data, error } = await db
        .from('sessions')
        .select('*')
        .eq('code', String(code).toUpperCase())
        .maybeSingle();
      if (error) fail('getSessionByCode')(error);
      return outSession(data);
    },

    async updateSession(id, patch) {
      const set = pick(patch, { status: 'status', title: 'title', closedAt: 'closed_at', pausedAt: 'paused_at' });
      if (Object.keys(set).length === 0) return this.getSession(id);
      const { data, error } = await db.from('sessions').update(set).eq('id', id).select().maybeSingle();
      if (error) fail('updateSession')(error);
      return outSession(data);
    },

    async deleteSession(id) {
      const { error } = await db.from('sessions').delete().eq('id', id);
      if (error) fail('deleteSession')(error);
      return true;
    },

    async listSessions() {
      const rows = unwrap(
        'listSessions',
        await db.from('sessions').select('*').order('started_at', { ascending: false }),
      );
      return (rows ?? []).map(outSession);
    },

    // -- profiles --
    async getProfile(sessionId, rollNo) {
      const { data, error } = await db
        .from('profiles')
        .select('*')
        .eq('session_id', sessionId)
        .eq('roll_no', String(rollNo))
        .maybeSingle();
      if (error) fail('getProfile')(error);
      return outProfile(data);
    },

    async saveProfile(profile) {
      // Upsert on (session_id, roll_no) - the unique constraint in schema.sql is
      // what stops a reconnecting student becoming a second row in the grid.
      const rows = unwrap(
        'saveProfile',
        await db
          .from('profiles')
          .upsert(
            {
              session_id: profile.sessionId,
              roll_no: String(profile.rollNo),
              name: profile.name ?? '',
              levels: profile.levels ?? {},
              working_level: profile.workingLevel,
              reason: profile.reason ?? '',
              history: profile.history ?? [],
              served_id: profile.served?.questionId ?? null,
              served_at: profile.served?.at ?? null,
              served_why: profile.served?.reason ?? null,
              // Zeroed rather than left alone when the pin goes, so the next
              // question a student is served can never inherit the retries the
              // last one had already spent.
              served_tries: profile.served?.tries ?? 0,
              served_last: profile.served?.last || null,
              integrity: profile.integrity ?? [],
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'session_id,roll_no' },
          )
          .select()
          .single(),
      );
      return outProfile(rows);
    },

    async listProfiles(sessionId) {
      const rows = unwrap(
        'listProfiles',
        await db.from('profiles').select('*').eq('session_id', sessionId).limit(500),
      );
      // Sorted in JS so '2' comes before '10', which a text column will not do.
      return (rows ?? [])
        .map(outProfile)
        .sort((a, b) =>
          String(a.rollNo).localeCompare(String(b.rollNo), undefined, { numeric: true }),
        );
    },
  };
}

/** Cheap connectivity + schema probe, run once at boot so failures are loud. */
export async function probeSupabase() {
  const db = createClient(config.supabase.url, config.supabase.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await db.from('contents').select('id', { count: 'exact', head: true });
  if (error) throw new Error(error.message);
}
