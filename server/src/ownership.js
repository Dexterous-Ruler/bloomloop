// Whose data is this?
//
// The role guards answer "is this person a teacher". They say nothing about
// WHOSE deck, bank or session is being touched - so with only those in place,
// any signed-in professor could read, edit and delete every other professor's
// material, across departments. These helpers are the second half of the check
// and every content/bank/session route must call one of them.
//
// Read and write differ on purpose: an HOD may read everything beneath them
// (that is the entire point of the role) but may not edit a professor's bank.

import { scopeFor } from './auth.js';

const deny = (message, status) => Object.assign(new Error(message), { status });

/**
 * Rows created before accounts existed carry owner_id = null. The legacy
 * teacher-key path is allowed to reach them so the demo console keeps working;
 * a real signed-in account is not, because those rows belong to nobody and
 * handing them to an arbitrary professor would be a leak in the other direction.
 */
function allowsUnowned(scope) {
  return Boolean(scope?.includeUnowned);
}

export function ownerOf(row) {
  return row?.ownerId ?? row?.owner_id ?? null;
}

/** Can this viewer READ a row owned by ownerId? */
export async function canRead(viewer, ownerId) {
  const scope = await scopeFor(viewer);
  if (ownerId == null) return allowsUnowned(scope);
  if (viewer?.id && String(ownerId) === String(viewer.id)) return true;
  return (scope?.ownerIds ?? []).some((id) => String(id) === String(ownerId));
}

/**
 * Can this viewer WRITE a row owned by ownerId?
 *
 * Only the owner, plus the legacy key on unowned rows. An HOD deliberately
 * cannot: the permissions table grants them read across the department, not the
 * ability to delete a colleague's question bank.
 */
export async function canWrite(viewer, ownerId) {
  if (viewer?.role === 'student') return false;
  const scope = await scopeFor(viewer);
  if (ownerId == null) return allowsUnowned(scope);
  return Boolean(viewer?.id) && String(ownerId) === String(viewer.id);
}

/** Throws 404, not 403, so an outsider cannot probe which ids exist. */
export async function assertCanRead(viewer, row, what = 'That') {
  if (!row) throw deny(`${what} was not found.`, 404);
  if (!(await canRead(viewer, ownerOf(row)))) throw deny(`${what} was not found.`, 404);
  return row;
}

export async function assertCanWrite(viewer, row, what = 'That') {
  if (!row) throw deny(`${what} was not found.`, 404);
  if (!(await canRead(viewer, ownerOf(row)))) throw deny(`${what} was not found.`, 404);
  // Visible but not editable is a real 403: the viewer knows it exists.
  if (!(await canWrite(viewer, ownerOf(row)))) {
    throw deny(`${what} belongs to another teacher - you can read it but not change it.`, 403);
  }
  return row;
}

/** Filter a list down to what this viewer may see. */
export async function readable(viewer, rows) {
  const scope = await scopeFor(viewer);
  const mine = new Set((scope?.ownerIds ?? []).map(String));
  if (viewer?.id) mine.add(String(viewer.id));
  return (rows ?? []).filter((row) => {
    const owner = ownerOf(row);
    return owner == null ? allowsUnowned(scope) : mine.has(String(owner));
  });
}
