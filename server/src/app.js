import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';

import { config, hasGemini, hasSupabase, hasMongo, hasClassroom } from './config.js';
import { getRepo } from './repo/index.js';
// The v2 shim, not the v1 key-only guard: it accepts a professor/hod bearer
// token OR the legacy shared key. Without this a professor who signs in properly
// would still be locked out of the console she was just routed to, and the demo
// key would remain the only way in - the opposite of what v2 is for.
import { requireAuth, requireTeacher } from './auth.js';
import { releaseBanks } from './sockets/index.js';

import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import analyticsRoutes from './routes/analytics.js';
import contentRoutes from './routes/content.js';
import generateRoutes from './routes/generate.js';
import bankRoutes from './routes/bank.js';
import sessionRoutes from './routes/session.js';
import exportRoutes from './routes/export.js';
import classroomRoutes from './routes/classroom.js';

/**
 * Any successful write to a question bank drops the live loop's cached copy of
 * it, so a session already in progress reads the edit rather than the version
 * it happened to load when the first student joined.
 *
 * It sits at the mount rather than inside the routers because "bank" and
 * "generate" between them have eight write paths, and the one that eventually
 * gets added without the call is the one that would matter. Hung on `finish` so
 * a request that failed authorization or validation invalidates nothing.
 */
function freshBank(req, res, nextFn) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.on('finish', () => {
      if (res.statusCode < 400) releaseBanks();
    });
  }
  nextFn();
}

export function createApp() {
  const app = express();

  // Same-origin plus whatever CORS_ORIGINS names, never a blanket wildcard.
  //
  // The client and the API are served from one origin, so a browser making a
  // legitimate call sends no Origin header at all and lands in the first branch.
  // The old `cors()` echoed every origin, which let any page on the internet
  // call this API with a teacher key a visitor had already been given - and the
  // answer-key routes are exactly what that would reach. A phone on the class
  // hotspot hits the LAN address directly, which is same-origin too.
  const allowed = new Set(
    String(process.env.CORS_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  );
  app.use(
    cors({
      origin(origin, cb) {
        // No Origin: a same-origin fetch, a curl, or a native app. Not a
        // cross-site request, so there is nothing for CORS to decide.
        if (!origin) return cb(null, true);
        return cb(null, allowed.has(origin));
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '2mb' }));

  // One place to see whether the demo is running on real services or fallbacks.
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      store: getRepo().kind,
      gemini: hasGemini() ? 'live' : 'fallback',
      // `store` is what actually connected; these say what was configured, so a
      // silent fallback (configured but unreachable) is visible in the console.
      supabase: hasSupabase() ? 'configured' : 'not-configured',
      mongo: hasMongo() ? 'configured' : 'not-configured',
      classroom: hasClassroom() ? 'configured' : 'tier1-only',
      time: new Date().toISOString(),
    });
  });

  // Identity first. Every mount below this line asks "who is this?", and the
  // answer now comes from a token this router hands out, so it has to resolve
  // ahead of them. It is deliberately ungated at the mount: /signup and
  // /bootstrap are reached by a browser that has no account yet, and each route
  // inside applies its own check.
  app.use('/api/auth', authRoutes);

  // Every role's landing screen. Ungated at the mount because a student has to
  // reach it too; the route inside resolves the viewer and the shape follows
  // from their role, so there is no id in the request to authorize against.
  app.use('/api/dashboard', dashboardRoutes);

  // Same rule as the dashboard: the role shapes it, the scope fills it, and the
  // only id the caller may name is one already in their own subject list.
  app.use('/api/analytics', analyticsRoutes);

  // Teacher-only. The bank carries answerIdx and the content list carries the
  // contentIds that reach it, so both are gated - see auth.js.
  app.use('/api/content', requireTeacher, contentRoutes);
  app.use('/api/generate', requireTeacher, freshBank, generateRoutes);
  app.use('/api/bank', requireTeacher, freshBank, bankRoutes);

  // Mixed: students read GET /:code, everything else is the teacher's. Gated
  // per-route inside the router rather than at the mount.
  app.use('/api/session', sessionRoutes);

  // The export router is mounted at /api per the contract, so the guard is
  // scoped to its one path instead of the whole prefix.
  // No path-matching guard here any more: export.js gates its own route, so the
  // guard and the route cannot disagree about spelling or case.
  app.use('/api', exportRoutes);

  // Three doors into one router, because three different people knock on it.
  //
  //   /callback   Google's redirect, landing on a browser that carries none of
  //               our headers. Cannot be gated at all; it authenticates itself
  //               with the single-use state this server issued.
  //   /link*      a student linking their OWN Google account. Any signed-in
  //               account, not a teacher - the whole point is that a student can
  //               do it without one. Those routes repeat requireAuth internally
  //               so this exception cannot silently ungate them.
  //   everything  the teacher's: course lists, rosters, grade posting.
  //   else
  app.use(
    '/api/classroom',
    (req, res, next) => {
      if (req.path === '/callback') return next();
      if (req.path === '/link' || req.path.startsWith('/link/')) return requireAuth(req, res, next);
      return requireTeacher(req, res, next);
    },
    classroomRoutes,
  );

  // In demo mode the built client is served from the same origin as the API, so
  // phones on the hotspot need exactly one URL and there is no CORS or proxy in
  // the loop.
  if (fs.existsSync(config.clientDist)) {
    // Asset filenames carry a content hash, so they can be cached hard. The
    // shell must NOT be: it names those hashed files, and a browser holding a
    // stale index.html after a rebuild asks for assets that no longer exist and
    // gets a white screen - the worst possible thing to discover on stage.
    const noStore = { 'Cache-Control': 'no-store, must-revalidate' };

    /**
     * The public half of the configuration, handed to the browser at runtime.
     *
     * One image has to work in every environment. Vite inlines import.meta.env
     * when the bundle is built, .env files are kept out of the image, and the
     * platform supplies its variables to the running container - so anything the
     * client needs and the build did not have has to arrive this way or not at
     * all. Only public values are allowed through here; the service role key is
     * on the same config object and must never join them.
     */
    const shellHtml = (() => {
      const file = path.join(config.clientDist, 'index.html');
      let cached = null;
      let stamp = 0;
      return () => {
        const mtime = fs.statSync(file).mtimeMs;
        if (cached && mtime === stamp) return cached;
        const boot = {
          supabaseUrl: config.supabase.url,
          supabaseAnonKey: config.supabase.anonKey,
        };
        // JSON inside a <script> has to survive a literal "</script>" in a value.
        const json = JSON.stringify(boot).replace(/</g, '\\u003c');
        cached = fs
          .readFileSync(file, 'utf8')
          .replace('</head>', `<script>window.__BLOOMLOOP__=${json};</script></head>`);
        stamp = mtime;
        return cached;
      };
    })();

    app.use(
      express.static(config.clientDist, {
        // index.html is served by the handler below, which has to inject before
        // sending; letting the static middleware answer it first would ship the
        // file unmodified and leave the browser with no configuration.
        index: false,
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('index.html')) res.set(noStore);
          else res.set('Cache-Control', 'public, max-age=31536000, immutable');
        },
      }),
    );

    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.set(noStore).type('html').send(shellHtml());
    });
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status || 500;
    if (status >= 500) console.error('[api]', err);
    res.status(status).json({ error: err.message || 'Internal error' });
  });

  return app;
}
