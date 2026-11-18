// Operator CLI for the account hierarchy. The first HOD cannot sign herself up
// - there is no invite to sign up against - so somebody has to make her from
// outside the browser, and after that every professor and student comes from an
// invite code that has to be read off a terminal and handed over.
//
//   node server/scripts/accounts.mjs bootstrap --email hod@college.edu --password "..." --name "R. Iyer" --department "CSE"
//   node server/scripts/accounts.mjs invite --role professor --by BL-4K2P7Q
//   node server/scripts/accounts.mjs list --under BL-4K2P7Q
//
// It talks to the RUNNING server over HTTP and holds no database credentials of
// its own. That is the point: the service-role key stays in one process, and
// authorisation stays in one place - a script that could write to Postgres
// directly would be a second, unaudited way to mint an HOD.

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const BASE = (arg('base', 'http://localhost:5050') || '').replace(/\/+$/, '');
const TOKEN = arg('token', process.env.BLOOMLOOP_TOKEN || '');
const KEY = arg('key', process.env.TEACHER_KEY || '');

const USAGE = `
Usage:
  node server/scripts/accounts.mjs bootstrap --email <e> --password <p> --name "<full name>" --department "<dept>"
  node server/scripts/accounts.mjs invite --role professor|student --by <code> [--name "<full name>"] [--email <e>] [--roll <n>]
  node server/scripts/accounts.mjs list [--under <code>]

Options:
  --base <url>    server to talk to            (default http://localhost:5050)
  --token <jwt>   access token of the signed-in HOD/professor  (env BLOOMLOOP_TOKEN)
  --key <key>     legacy teacher key fallback                  (env TEACHER_KEY)
`;

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

function authHeaders() {
  const headers = {};
  // Both are sent when both are present; the server picks. A bearer token is a
  // real account and always wins - the key can only ever act as a professor.
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  if (KEY) headers['x-teacher-key'] = KEY;
  return headers;
}

async function request(method, path, body) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...authHeaders(),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(`cannot reach ${BASE} - is the server running? (${err.message})`);
  }

  const ct = res.headers.get('content-type') || '';
  const payload = ct.includes('json') ? await res.json().catch(() => ({})) : await res.text();
  if (!res.ok) {
    const detail =
      typeof payload === 'string' ? payload.trim().slice(0, 300) : payload.error || res.statusText;
    throw Object.assign(new Error(detail || `${method} ${path} failed`), { status: res.status });
  }
  return payload;
}

/**
 * The auth router owns the account payload and may hand back Postgres casing or
 * camelCase. An operator tool that prints an empty NAME column because of a
 * naming choice is worse than useless the night before a demo, so read both.
 */
function field(obj, ...names) {
  for (const name of names) {
    const value = obj?.[name];
    if (value !== undefined && value !== null) return value;
  }
  return '';
}

function table(columns, rows) {
  if (!rows.length) {
    console.log('  (nothing to show)');
    return;
  }
  const widths = columns.map((head, i) =>
    Math.max(head.length, ...rows.map((row) => String(row[i] ?? '').length)),
  );
  const line = (cells) =>
    `  ${cells.map((cell, i) => String(cell ?? '').padEnd(widths[i])).join('  ')}`.trimEnd();

  console.log(line(columns));
  console.log(`  ${widths.map((w) => '-'.repeat(w)).join('  ')}`);
  rows.forEach((row) => console.log(line(row)));
}

const ACCOUNT_COLUMNS = ['CODE', 'ROLE', 'NAME', 'DEPARTMENT', 'ROLL', 'EMAIL', 'ACTIVE'];

const accountRow = (account, indent = '') => [
  `${indent}${field(account, 'code')}`,
  field(account, 'role'),
  field(account, 'fullName', 'full_name'),
  field(account, 'department'),
  field(account, 'rollNo', 'roll_no'),
  field(account, 'email'),
  field(account, 'active') === false ? 'no' : 'yes',
];

async function bootstrap() {
  const body = {
    email: arg('email'),
    password: arg('password'),
    fullName: arg('name'),
    department: arg('department'),
  };
  const missing = Object.entries(body)
    .filter(([, value]) => !value)
    .map(([key]) => `--${key === 'fullName' ? 'name' : key}`);
  if (missing.length) fail(`bootstrap needs ${missing.join(', ')}\n${USAGE}`);

  const { account } = await request('POST', '/api/auth/bootstrap', body);

  console.log('\nFirst HOD created.\n');
  table(ACCOUNT_COLUMNS, [accountRow(account)]);
  console.log(
    '\n  Bootstrap refuses from here on - the accounts table is no longer empty.',
  );
  console.log(`  Sign in at ${BASE}/signin, then invite professors with:`);
  console.log(
    `    node server/scripts/accounts.mjs invite --role professor --by ${field(account, 'code')}\n`,
  );
}

async function invite() {
  const role = String(arg('role') || '').toLowerCase();
  const by = arg('by');
  if (role !== 'professor' && role !== 'student') {
    fail(`invite needs --role professor or --role student (got "${arg('role') || ''}")`);
  }
  if (!by) fail('invite needs --by <code> - the code of the account the invitee reports to');

  const created = await request('POST', '/api/auth/invite', {
    role,
    // A routing hint, never an authorisation: the server re-checks the caller's
    // own token or key against this account before it writes anything.
    by,
    fullName: arg('name') || undefined,
    email: arg('email') || undefined,
    rollNo: arg('roll') || undefined,
  });

  const record = created.invite || created;
  console.log('');
  table(
    ['INVITE CODE', 'ROLE', 'REPORTS TO', 'EXPIRES'],
    [
      [
        field(record, 'code'),
        field(record, 'role') || role,
        field(record, 'reportsTo', 'reports_to') || by,
        field(record, 'expiresAt', 'expires_at'),
      ],
    ],
  );
  console.log(`\n  Single use. They redeem it at ${BASE}/signup\n`);
}

async function list() {
  const under = arg('under');
  const query = under ? `?under=${encodeURIComponent(under)}` : '';
  const payload = await request('GET', `/api/auth/team${query}`);

  // The tree is nested {account, children}; flatten it depth-first and indent
  // the code column, so who reports to whom survives being printed flat.
  const rows = [];
  const walk = (nodes, depth) => {
    for (const node of nodes ?? []) {
      const account = node.account ?? node;
      rows.push(accountRow(account, '  '.repeat(depth)));
      walk(node.children, depth + 1);
    }
  };
  walk(payload.tree ?? payload.accounts ?? [], 0);

  console.log(under ? `\nAccounts under ${under}\n` : '\nAccounts you can see\n');
  table(ACCOUNT_COLUMNS, rows);
  console.log(`\n  ${rows.length} account${rows.length === 1 ? '' : 's'}\n`);
}

const COMMANDS = { bootstrap, invite, list };
const command = COMMANDS[process.argv[2]];

if (!command) {
  console.error(process.argv[2] ? `\n  unknown command "${process.argv[2]}"` : '');
  console.error(USAGE);
  process.exit(1);
}

try {
  await command();
} catch (err) {
  console.error(`\n  ${err.status ? `${err.status} ` : ''}${err.message}`);
  if (err.status === 401 || err.status === 403) {
    console.error('  Pass --token <access token> for the inviting account, or --key <teacher key>.');
  }
  console.error('');
  process.exit(1);
}
