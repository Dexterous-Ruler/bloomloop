import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import { Server } from 'socket.io';

import { config, hasGemini, hasClassroom } from './config.js';
import { initStore, getRepo } from './repo/index.js';
import { createApp } from './app.js';
import { attachSockets } from './sockets/index.js';

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
  fs.mkdirSync(config.uploadsDir, { recursive: true });

  await initStore();

  const app = createApp();
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: '*' }, pingTimeout: 20000 });

  attachSockets(io);
  app.set('io', io);

  server.listen(config.port, '0.0.0.0', () => {
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
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[server] failed to start:', err);
  process.exit(1);
});
