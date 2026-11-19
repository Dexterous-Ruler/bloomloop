// Batch 8 (docs/UI_ZIP_AUDIT.md gap L2): the class a room was opened for, on the
// staff reads of the room, so the live head can read "Data Structures · SY-CS A"
// beside the chapter without a second read. Staff only: never on the phones'
// GET /api/session/:code, which is open to anyone holding the code.

/** A class as a room read names it: its id, course, section and term. */
export const classLabel = (cls) => (cls
  ? { id: String(cls._id), courseName: cls.courseName ?? '', section: cls.section ?? '', termLabel: cls.termLabel ?? '' }
  : null);

/**
 * classId -> classLabel for these rooms' classes, one read per class. A class
 * that cannot be read (deleted since, or a store hiccup) is left out: its rooms
 * then read `class: null` beside their `classId`, and nothing else fails.
 */
export async function roomClasses(repo, sessions = []) {
  const ids = [...new Set(sessions.map((s) => s?.classId).filter(Boolean).map(String))];
  const out = new Map();
  await Promise.all(ids.map(async (id) => {
    const cls = await repo.getClass(id).catch(() => null);
    if (cls) out.set(id, classLabel(cls));
  }));
  return out;
}

/** One room's class, or null for a room opened for no class. */
export async function roomClass(repo, session) {
  if (!session?.classId) return null;
  return (await roomClasses(repo, [session])).get(String(session.classId)) ?? null;
}
