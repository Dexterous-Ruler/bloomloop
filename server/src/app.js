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
import reviewRoutes from './routes/review.js';
import mediaRoutes from './routes/media.js';
import classRoutes from './routes/classes.js';
import outcomeRoutes from './routes/outcomes.js';
import attainmentRoutes, { presetRoutes as attainmentPresetRoutes } from './routes/attainment.js';
import recordRoutes from './routes/records.js';
import projectorRoutes from './routes/projector.js';
import insightRoutes from './routes/insights.js';
import classQuestionRoutes from './routes/classQuestions.js';
import misconceptionRoutes, { classMisconceptionRoutes } from './routes/misconceptions.js';
// ---- Phase 6: the hub's content backbone ----
import hubRoutes from './routes/hub.js';
// ---- Phase 6: practice, mastery, the error log and reviews ----
import hubPracticeRoutes from './routes/hubPractice.js';
// ---- Phase 6: lessons and languages ----
import hubLessonRoutes from './routes/hubLessons.js';
import hubLanguageRoutes from './routes/hubLanguages.js';
// ---- Phase 6: Get Ready, refresher paths, self-tests, goals and the hub home ----
import hubPathRoutes from './routes/hubPaths.js';
// ---- Phase 6: the tutor ----
import hubTutorRoutes from './routes/hubTutor.js';
// ---- Batch 8: figures ----
import { figureRoutes, lessonFigureRoutes } from './routes/figures.js';
import { importBodyRefused, importRoutes, laptopRoutes, saveRoomsOnClose } from './routes/laptop.js';
import { laptopOrigin } from './laptop.js';
import recordSyncRoutes from './routes/recordSync.js';
// ---- Batch 8: the live room's suggestions ----
import teachingMoveRoutes from './routes/teachingMoves.js';
import examGuardRoutes from './routes/examGuard.js';

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
        // In laptop mode only (Phase 7), a page on this laptop's own LAN or
        // loopback address and port as well; false on every other server.
        return cb(null, allowed.has(origin) || laptopOrigin(origin));
      },
      credentials: true,
    }),
  );
  // A room archive may be 4 MiB (0039), so its import alone takes a larger body;
  // every other route keeps 2 MB. A body parsed here is not parsed again below.
  app.use('/api/imports/rooms', express.json({ limit: '6mb' }));
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

  // ---- Phase 7: laptop mode and room imports ----
  // Laptop mode (laptop.js): a room closed or deleted is written to the
  // laptop's disk at once. Ahead of the room routers, which answer the close;
  // it does nothing on a server that is not in laptop mode.
  app.use('/api/session', saveRoomsOnClose);
  // Is this server a laptop in laptop mode, and where are its rooms saved.
  // Staff only, gated inside.
  app.use('/api/laptop', laptopRoutes);
  // A room archive saved by laptop mode, imported as a closed room the caller
  // owns, and the list of imports. Staff only, gated inside; an HOD reads and
  // never imports. A body the JSON parser refused is answered with a sentence.
  app.use('/api/imports/rooms', importRoutes);
  app.use('/api/imports', importBodyRefused);

  // Teacher-only. The bank carries answerIdx and the content list carries the
  // contentIds that reach it, so both are gated - see auth.js.
  app.use('/api/content', requireTeacher, contentRoutes);
  app.use('/api/generate', requireTeacher, freshBank, generateRoutes);
  app.use('/api/bank', requireTeacher, freshBank, bankRoutes);

  // ---- Phase 7: replay-safe teacher records ----
  // Ahead of the routers that write them: a teacher-record or attendance write
  // carrying a replay key (Idempotency-Key) is answered from the key's kept
  // reply when it was done before, and otherwise goes on to its own router, its
  // reply kept under the key. A request without a key passes straight through.
  // Gated per route, with the write's own rule, like the routers it fronts.
  app.use('/api/session', recordSyncRoutes);

  // Mixed: students read GET /:code, everything else is the teacher's. Gated
  // per-route inside the router rather than at the mount.
  app.use('/api/session', sessionRoutes);
  // The teacher-record store (Phase 3): /api/session/:code/observations, wheel,
  // tallies, activities, insights. After the room router, and gated per route,
  // because GET /api/session/:code (one segment) is the phones' and stays open.
  app.use('/api/session', recordRoutes);
  // The projector's controls (Phase 3): /api/session/:code/projector and its
  // links. Gated per route for the same reason. The projector itself connects
  // over the socket with a link's token and never calls these.
  app.use('/api/session', projectorRoutes);
  // Live insights and the student card (Phase 3): /api/session/:code/insights
  // and /api/session/:code/students/:roll/card. Staff-only, gated per route for
  // the same reason; the same insights are pushed to teacher screens only.
  app.use('/api/session', insightRoutes);
  // Class questions and the confidence counts (Phase 5):
  // /api/session/:code/class-questions and /api/session/:code/confidence. The
  // room's owner runs a class question; the phones vote over the socket and
  // never call these. Gated per route for the same reason.
  app.use('/api/session', classQuestionRoutes);
  // How many students chose each option linked to a misunderstanding (Phase 5):
  // /api/session/:code/misconceptions. Staff-only, gated per route for the same
  // reason; the class's own is at /api/classes/:id/misconceptions below.
  app.use('/api/session', misconceptionRoutes);
  // ---- Batch 8: the live room's suggestions ----
  // "Suggest a move" and activity prompts written for the chapter (gaps L1 and
  // C2): /api/session/:code/teaching-moves. On the professor's button only, in
  // the background, from the room's counts and the chapter's own material
  // (decisions 1 and 5); kept with what they were built from. Staff-only,
  // gated per route for the same reason as the routers above.
  app.use('/api/session', teachingMoveRoutes);

  // ---- Batch 9: exam integrity (decision E5) ----
  // /api/session/:code/exam: the room's exam mode, its students' signals, the
  // newest screen picture per student (served from memory, never kept in a
  // table) and the collusion check. Staff-only, gated per route for the same
  // reason as the routers above; the phones use the socket and never call these.
  app.use('/api/session', examGuardRoutes);

  // Teacher-only: class rosters are names and roll numbers, and nothing a phone
  // needs. Whose class is whose is checked inside, by ownership.js.
  app.use('/api/classes', requireTeacher, classRoutes);
  // A class's course outcomes and their mappings (Phase 4):
  // /api/classes/:id/outcomes. Staff-only like the class, whose ownership they
  // follow; no path here is one the class router answers.
  app.use('/api/classes', requireTeacher, outcomeRoutes);
  // Attainment and the marks register (Phase 4): /api/classes/:id/attainment...
  // and /api/classes/:id/register, staff-only like the class; and the example
  // formulas at /api/attainment/presets, for any teacher.
  app.use('/api/classes', requireTeacher, attainmentRoutes);
  app.use('/api/attainment', requireTeacher, attainmentPresetRoutes);
  // The class's misconception counts (Phase 5): /api/classes/:id/misconceptions,
  // staff-only like the class, whose ownership they follow.
  app.use('/api/classes', requireTeacher, classMisconceptionRoutes);

  // Teacher-only: the queue carries students' written answers and the question
  // snapshots with their rubrics. Which rooms a teacher may read or decide on is
  // checked inside, per answer, by ownership.js.
  app.use('/api/review', requireTeacher, reviewRoutes);

  // ---- Phase 6: the hub's content backbone ----
  // The Learning Hub (/api/hub): units, the chapters a class covers, topic
  // records and prerequisite links. Accounts only, never the teacher key: the
  // router's own guard answers 503 without Supabase and needs a signed-in
  // account, and services/hubAccess.js decides who reaches which class (a
  // rostered student of the class's professor, its owner, the department's HOD).
  app.use('/api/hub', hubRoutes);

  // ---- Phase 6: practice, mastery, the error log and reviews ----
  // The hub's practice loop, a student's progress, error log, reviews and
  // weeks, staff's reads of them, and explanations (/api/hub/practice/...,
  // /progress, /review/due, /errors, /consistency, /classes/:id/progress,
  // /questions/:id/explanation, /explanations/...). Behind the same guard as
  // the backbone (accounts only, 503 without Supabase), after it, at paths it
  // does not answer. Nothing here is read by a room, attainment or the register.
  app.use('/api/hub', hubPracticeRoutes);

  // ---- Phase 6: lessons and languages ----
  // A topic's lessons from the professor's own slides (H11) and the English,
  // Hindi and Marathi switch (H12), under /api/hub beside the backbone. Each
  // router repeats the hub's gate (hubGate: 503 without Supabase, a signed-in
  // account, never the teacher key); the account is resolved once per request.
  // The paths are their own, so no request one answers reaches the other. A
  // lesson writes its retrieval questions into the bank as drafts only, which
  // no room serves, so the live loop's cached bank needs no refresh here: the
  // bank's own approve routes refresh it.
  app.use('/api/hub', hubLessonRoutes);
  app.use('/api/hub', hubLanguageRoutes);

  // ---- Phase 6: Get Ready, refresher paths, self-tests, goals and the hub home ----
  // A student's Get Ready checks (H9) and the refresher paths after them, their
  // self-tests (H10), their goals and the hub home (H16), and staff's reads of
  // Get Ready results and students by topic state (H17): /api/hub/home,
  // /getready..., /exams..., /goals..., /classes/:id/states and
  // /classes/:id/students/:id/getready. The same gate as every hub router, at
  // paths none of the others answers. Answers are hub attempts (never room
  // answers), so no room, attainment figure or register reads any of it.
  app.use('/api/hub', hubPathRoutes);

  // ---- Phase 6: the tutor ----
  // Hint ladders and feedback on wrong options (H13): a student opens approved
  // hints one at a time before answering, in practice, review sets and lessons
  // (never a self-test or Get Ready), and each one opened is recorded; staff
  // write, draft on the button (in the background) and approve them. Behind the
  // same gate (hubGate), at paths no other hub router answers. Nothing here is
  // read by a room, attainment or the register.
  app.use('/api/hub', hubTutorRoutes);

  // ---- Batch 8: figures ----
  // The professor's side of the figure engines (routes/figures.js): what they
  // accept, a preview, a chapter's slide pictures and a printable page, behind
  // requireTeacher (an HOD reads); and a stepped figure added to a lesson as a
  // new draft version, behind the hub's gate. A figure reaches a phone only as
  // a question's stimulus or a lesson step, drawn by the server.
  app.use('/api/figures', requireTeacher, figureRoutes);
  app.use('/api/hub', lessonFigureRoutes);

  // Mixed, like /api/session: the upload is the teacher's and gated inside;
  // GET /:id is open at the mount, because a phone's <img> carries no
  // credential, and each image is let through or refused by the rule in
  // services/media.js (a room running on its chapter, an approved question
  // showing it).
  app.use('/api/media', mediaRoutes);

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
          // The phone's service worker (/sw.js, built by client/sw/plugin.js)
          // keeps its name across builds, so it must never be cached hard: the
          // browser checks it for a new version on every visit, and a year's
          // cache would keep a phone on the old worker and its old shell.
          // no-cache lets it keep a copy but revalidate it each time (Batch 8).
          else if (path.basename(filePath) === 'sw.js') res.set('Cache-Control', 'no-cache');
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
