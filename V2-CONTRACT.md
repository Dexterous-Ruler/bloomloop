# BloomLoop v2 — identity, roles and hierarchy

Frozen contract for Phase 1. Build against this; do not change a signature here.
Everything in `CONTRACT.md` (v1) still holds unless contradicted below.

---

## 1. Who exists

`public.accounts` (already migrated — do not alter the schema):

```
id uuid (= auth.users.id) · role 'hod'|'professor'|'student' · full_name · email
code text UNIQUE          -- human code, format BL-XXXXXX (Crockford base32, no I/L/O/U)
department text · reports_to uuid -> accounts.id · roll_no text (students)
active bool · created_at · updated_at
```

**The hierarchy is one edge.** student → professor → hod → null. A DB trigger
enforces it; do not re-implement that check in JS, just surface the error.
`public.accounts_below(uuid)` returns every descendant at any depth.

Ownership: `contents.owner_id` and `sessions.owner_id` point at the professor
who created them. `profiles.account_id` is the student's account **or null** —
guest join by room code + roll number is still supported and must stay working.

## 2. Permissions — the whole rule set

| | HOD | Professor | Student |
|---|---|---|---|
| See own department tree | ✅ all professors + their students | own students only | self only |
| Content / question banks | read any in department | full CRUD on own | none |
| Start / end a session | no | ✅ own | no |
| Live grid | any session in department | own sessions | no |
| Take a session | no | no | ✅ |
| Own results & history | — | — | ✅ read-only. *(19 Nov 2026, Phase 6: students with accounts now reach the Learning Hub as well as their own results.)* |
| Exports | department-wide | own sessions | own results |
| Create accounts | ✅ professors | ✅ students | no |

**Students have no write access anywhere except submitting their own answers.**

## 3. Auth

Supabase Auth (email + password) issues the JWT. The browser holds the session;
every API call sends `Authorization: Bearer <access_token>`.

The server verifies the token with the Supabase **service-role** client and
loads the account. Authorization is decided **only** on the server — RLS is on
with no policies, so nothing but our server can read the tables at all.

`TEACHER_KEY` stays as a break-glass fallback for the demo path only: when a
request carries a valid teacher key AND no bearer token, treat it as a
professor with id `null`. Do not extend it further; new work uses real accounts.

### Endpoints (`server/src/routes/auth.js`, mounted at `/api/auth`)

| Method + path | Who | Body | Returns |
|---|---|---|---|
| `POST /signup` | public | `{email,password,fullName,inviteCode}` | `{account}` — role/department/reports_to come from the invite |
| `GET /me` | any signed-in | | `{account, canSee:{...}}` |
| `POST /invite` | hod, professor | `{role, fullName?, email?, rollNo?}` | `{invite:{code, role, expiresAt}}` — hod may invite professors, professor may invite students |
| `GET /team` | hod, professor | | `{tree:[{account, children:[…]}]}` |
| `PATCH /account/:id` | hod (own dept), self (name only) | `{fullName?,active?,rollNo?}` | `{account}` |

`POST /bootstrap` exists once: if the accounts table is empty it creates the
first HOD from `{email,password,fullName,department}`. It must refuse forever
after, on any non-empty table.

### Server helpers (`server/src/auth.js`)

```js
requireAuth              // 401 unless a valid bearer token resolves to an active account
requireRole('hod',…)     // 403 unless account.role is in the list
requireTeacher           // v1 shim: professor/hod bearer token OR the legacy key
loadAccount(req)         // -> account | null, cached on req
canSeeAccount(viewer, targetId)  // hierarchy check, used by every read
scopeFor(viewer)         // -> {ownerIds:[…]} the set of professors whose data this viewer may read
```

## 4. Codes

`code` is `BL-` + 6 chars of Crockford base32 (`0123456789ABCDEFGHJKMNPQRSTVWXYZ`
— no I, L, O or U). Generated on account creation, retried on collision.
It is an identifier, never a secret: it is safe to print on a roster.

Invite codes are separate, single-use, 8 chars, and expire in 14 days.
Table `public.invites` — create it in your migration if it does not exist:
`code text pk · role app_role · department text · reports_to uuid · created_by uuid ·
 email text · roll_no text · full_name text · expires_at timestamptz · used_by uuid · used_at timestamptz`.

## 5. Client

`client/src/auth.js` owns the Supabase browser client and exports:

```js
supabase                 // the browser client (anon key only — NEVER the service key)
signIn(email,password) · signUp(payload) · signOut() · onAuthChange(cb)
useAccount()             // React hook -> {account, loading, error, refresh}
```

`api.js` must attach `Authorization: Bearer <token>` to every request when a
session exists, keeping the existing `x-teacher-key` header as the fallback.

Routing after sign-in is by role:
`hod → /admin` · `professor → /` (the existing console) · `student → /me`.
`/join` stays public — an anonymous student can still enter a room code.

**The anon key is public by design and belongs in the client. The service-role
key must never appear in `client/`, in any bundle, or in any log.**
