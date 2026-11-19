// Store selection happens once, at boot. Everything downstream imports the repo
// and never asks which implementation it got.
//
// Order of preference: Supabase (primary) -> MongoDB Atlas -> in-process.
// Every fallback is announced loudly rather than silently, because "the demo ran
// but nothing saved" is a worse outcome than a noisy console.

import mongoose from 'mongoose';
import { config, hasSupabase, hasMongo } from '../config.js';
import { createSupabaseRepo, probeSupabase } from './supabaseRepo.js';
import { createMongoRepo } from './mongoRepo.js';
import { createMemoryRepo } from './memoryRepo.js';

let repo = createMemoryRepo();

export function getRepo() {
  return repo;
}

export async function initStore({ log = console.log } = {}) {
  if (hasSupabase()) {
    try {
      // Probe before committing: a wrong key or an unrun migration should fail
      // here, at boot, and not on the first student join.
      const { warnings = [] } = (await probeSupabase()) ?? {};
      repo = createSupabaseRepo();
      log(`[store] Supabase connected (${new URL(config.supabase.url).host}).`);
      // Rooms run; some routes will not until a migration is applied. Each line
      // names the file, so the fix is in the boot log rather than in a 500.
      for (const warning of warnings) log(`[store] WARNING: ${warning}`);
      return repo;
    } catch (err) {
      log(`[store] Supabase connection FAILED: ${err.message}`);
      log('[store] Check SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY, and that');
      log('[store] every file in supabase/migrations/ has been run, in order.');
    }
  }

  if (hasMongo()) {
    try {
      mongoose.set('strictQuery', true);
      await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 8000 });
      repo = createMongoRepo();
      log(`[store] MongoDB connected (${mongoose.connection.name}).`);
      return repo;
    } catch (err) {
      log(`[store] MongoDB connection FAILED: ${err.message}`);
    }
  }

  repo = createMemoryRepo();
  if (!hasSupabase() && !hasMongo()) {
    log('[store] No SUPABASE_URL or MONGO_URI set - running on the in-process store.');
  } else {
    log('[store] Falling back to the in-process store so the session can still run.');
  }
  log('[store] Sessions work; nothing survives a restart.');
  return repo;
}

export async function closeStore() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
}
