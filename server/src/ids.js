// Record ids look different depending on which store is behind the repository:
//   Supabase / Postgres -> uuid v4, 36 chars with dashes
//   MongoDB / in-process -> 24-char hex ObjectId
// Nothing above the repository layer should care, so id validation lives here
// and accepts either shape. Validating at all is still worth it: it turns a
// database cast error (a 500, mid-demo) into an honest 400.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OBJECT_ID = /^[0-9a-f]{24}$/i;

export function isRecordId(value) {
  const s = String(value ?? '').trim();
  return UUID.test(s) || OBJECT_ID.test(s);
}
