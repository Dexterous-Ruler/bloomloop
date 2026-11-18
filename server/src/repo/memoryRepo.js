// In-process fallback store. Used when MONGO_URI is absent so a missing
// connection string cannot take the demo down. Same interface as mongoRepo -
// the rest of the server never learns which one it got.
//
// Nothing here survives a restart, and the server says so loudly at boot.

import crypto from 'node:crypto';

const oid = () => crypto.randomBytes(12).toString('hex');
const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

export function createMemoryRepo() {
  const contents = new Map();
  const questions = new Map();
  const sessions = new Map();
  const profiles = new Map(); // key: `${sessionId}:${rollNo}`

  return {
    kind: 'memory',

    async createContent(doc) {
      const _id = oid();
      const rec = { _id, createdAt: new Date().toISOString(), ...doc };
      contents.set(_id, rec);
      return clone(rec);
    },

    async getContent(id) {
      return clone(contents.get(String(id)) ?? null);
    },

    async listContents() {
      return clone([...contents.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
    },

    async updateContent(id, patch) {
      const rec = contents.get(String(id));
      if (!rec) return null;
      Object.assign(rec, patch);
      return clone(rec);
    },

    async insertQuestions(docs) {
      const made = docs.map((d) => {
        const _id = oid();
        const rec = { _id, status: 'active', source: 'llm', createdAt: new Date().toISOString(), ...d, contentId: String(d.contentId) };
        questions.set(_id, rec);
        return rec;
      });
      return clone(made);
    },

    async listQuestions(contentId, { includeDiscarded = false } = {}) {
      const all = [...questions.values()].filter((q) => q.contentId === String(contentId));
      return clone(includeDiscarded ? all : all.filter((q) => q.status === 'active'));
    },

    async getQuestion(id) {
      return clone(questions.get(String(id)) ?? null);
    },

    async updateQuestion(id, patch) {
      const rec = questions.get(String(id));
      if (!rec) return null;
      Object.assign(rec, patch);
      return clone(rec);
    },

    async deleteQuestions(contentId) {
      let n = 0;
      for (const [id, q] of questions) {
        if (q.contentId === String(contentId)) {
          questions.delete(id);
          n += 1;
        }
      }
      return n;
    },

    async countQuestions(contentId) {
      return [...questions.values()].filter(
        (q) => q.contentId === String(contentId) && q.status === 'active',
      ).length;
    },

    async createSession(doc) {
      const _id = oid();
      const rec = {
        _id,
        status: 'open',
        startedAt: new Date().toISOString(),
        closedAt: null,
        ...doc,
        contentId: String(doc.contentId),
      };
      sessions.set(_id, rec);
      return clone(rec);
    },

    async getSession(id) {
      return clone(sessions.get(String(id)) ?? null);
    },

    async getSessionByCode(code) {
      const rec = [...sessions.values()].find((s) => s.code === String(code).toUpperCase());
      return clone(rec ?? null);
    },

    async updateSession(id, patch) {
      const rec = sessions.get(String(id));
      if (!rec) return null;
      Object.assign(rec, patch);
      return clone(rec);
    },

    async deleteSession(id) {
      const key = String(id);
      // Cascades by hand: Postgres does this with ON DELETE CASCADE, and a
      // store that left orphaned profiles behind would report a different
      // student count from the same data.
      for (const [pid, profile] of profiles) {
        if (String(profile.sessionId) === key) profiles.delete(pid);
      }
      return sessions.delete(key);
    },

    async listSessions() {
      return clone([...sessions.values()].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)));
    },

    async getProfile(sessionId, rollNo) {
      return clone(profiles.get(`${sessionId}:${rollNo}`) ?? null);
    },

    async saveProfile(profile) {
      const key = `${profile.sessionId}:${profile.rollNo}`;
      const existing = profiles.get(key);
      const rec = { _id: existing?._id ?? oid(), ...clone(profile), sessionId: String(profile.sessionId) };
      profiles.set(key, rec);
      return clone(rec);
    },

    async listProfiles(sessionId) {
      return clone(
        [...profiles.values()]
          .filter((p) => p.sessionId === String(sessionId))
          .sort((a, b) => String(a.rollNo).localeCompare(String(b.rollNo), undefined, { numeric: true })),
      );
    },
  };
}
