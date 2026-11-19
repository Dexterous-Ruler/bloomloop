import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import { Server } from 'socket.io';

import { config, hasGemini, hasClassroom } from './config.js';
import { initStore, getRepo } from './repo/index.js';
import { createApp } from './app.js';
import { attachSockets } from './sockets/index.js';
import {
  enterLaptopMode, laptopBanner, laptopRequested, laptopSocketOptions, watchAddresses,
} from './laptop.js';
import { createArchiveWriter } from './services/laptopArchive.js';
import { loadFigureEngines } from './figures/index.js';

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

async function main() {
  // Phase 7: laptop mode (`--laptop`, laptop.js) switches every network service
  // off before the store is chosen, so the laptop never waits on one it cannot
  // reach. Every other start is as before.
  const laptop = laptopRequested() ? enterLaptopMode() : null;

  fs.mkdirSync(config.uploadsDir, { recursive: true });

  // Batch 8: the figure engines (Graphviz, RDKit) load while the store starts,
  // and are waited for (at most a few seconds) before the server listens, so a
  // diagram or molecule is drawn on the first request. A failure or a slow load
  // is logged, not fatal: every other figure needs neither engine, a render
  // asked for meanwhile says it is being prepared, and a save waits for them.
  const engines = loadFigureEngines().catch((err) => console.error('[figures] the drawing engines did not load:', err?.message ?? err));

  await initStore();

  await Promise.race([engines, new Promise((resolve) => { setTimeout(resolve, 5000).unref(); })]);

  const app = createApp();
  const server = http.createServer(app);
  const io = new Server(server, laptop ? laptopSocketOptions() : { cors: { origin: '*' }, pingTimeout: 20000 });

  attachSockets(io);
  app.set('io', io);

  // Laptop mode: every room to the laptop's disk, at each close and on the interval.
  const writer = laptop
    ? createArchiveWriter({ getRepo, dir: laptop.archiveDir, intervalMs: laptop.intervalMs, source: laptop }).start()
    : null;
  const stopWatching = laptop ? watchAddresses() : null;

  server.listen(config.port, '0.0.0.0', () => {
    if (laptop) {
      for (const line of laptopBanner({ clientBuilt: fs.existsSync(config.clientDist) })) console.log(line);
      return;
    }
    const bar = '='.repeat(60);
    console.log(`\n${bar}`);
    console.log('  BloomLoop server up');
    console.log(bar);
    // The key rides in the URL so the teacher just clicks this once; the console
    // stores it and strips it from the address bar. Students never get it.
    console.log(`  Teacher console : http://localhost:${config.port}/?key=${config.teacherKey}`);
    console.log('                    ^ open THIS link - it unlocks the console');
    for (const ip of lanAddresses()) {
      console.log(`  Students join   : http://${ip}:${config.port}/join   <- phones use this`);
    }
    console.log('');
    const STORE_LABEL = {
      supabase: 'Supabase (Postgres)',
      mongo: 'MongoDB Atlas',
      memory: 'in-process - NOTHING IS SAVED',
    };
    console.log(`  generation : ${hasGemini() ? 'Gemini ' + config.gemini.model : 'OFFLINE FALLBACK (no GEMINI_API_KEY)'}`);
    console.log(`  store      : ${STORE_LABEL[getRepo().kind] ?? getRepo().kind}`);
    console.log(`  classroom  : ${hasClassroom() ? 'Tier 2 wired' : 'Tier 1 CSV only'}`);
    if (!fs.existsSync(config.clientDist)) {
      console.log('');
      console.log('  NOTE: client/dist not built. Run `npm run build` for the single-URL');
      console.log('        demo mode, or `npm run dev` for the Vite dev server.');
    }
    console.log(`${bar}\n`);
  });

  const shutdown = () => {
    console.log('\n[server] shutting down');
    setTimeout(() => process.exit(0), 3000).unref();
    if (!writer) {
      server.close(() => process.exit(0));
      return;
    }
    // Laptop mode: every room written once more before the process goes.
    stopWatching();
    writer.stop()
      .then(() => console.log(`[laptop] rooms saved to ${writer.folder}`))
      .catch((err) => console.error(`[laptop] the last save failed: ${err.message}`))
      .finally(() => server.close(() => process.exit(0)));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[server] failed to start:', err);
  process.exit(1);
});
