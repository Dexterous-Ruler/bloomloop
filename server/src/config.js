import dotenv from 'dotenv';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(__dirname, '..', '..');

// Resolve server/.env from THIS file rather than from process.cwd(). The bare
// `dotenv/config` import reads ./.env relative to wherever node was launched,
// so starting the server from the repo root - `node server/src/index.js`, the
// obvious thing to type - loaded no configuration at all and fell through to
// the offline generator and the in-process store, with a boot banner that
// looked like the keys were missing rather than merely unread.
dotenv.config({ path: path.join(__dirname, '..', '.env') });

export const config = {
  port: Number(process.env.PORT) || 5050,

  /**
   * Teacher-only routes are gated on this. Students and teachers share one
   * origin, so without it the question bank - answer keys included - is two
   * unauthenticated GETs away from any phone that can read the room code off
   * the projector.
   *
   * Generated fresh at boot unless TEACHER_KEY is set, and printed in the boot
   * banner as a ready-to-click URL, so the teacher never has to type it.
   */
  teacherKey: process.env.TEACHER_KEY || crypto.randomBytes(4).toString('hex').toUpperCase(),

  // Primary store. The service role key bypasses row level security, so it stays
  // server-side only and never reaches the client bundle.
  supabase: {
    url: process.env.SUPABASE_URL || '',
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    // The publishable half, and the only one the browser is ever given. It is
    // public by design - row level security still applies to it, and every table
    // has RLS on with no policies, so on its own it can read nothing.
    //
    // Served to the client at RUNTIME rather than compiled into the bundle.
    // Vite inlines import.meta.env at build time, .dockerignore keeps .env files
    // out of the image, and Koyeb injects environment variables into the running
    // container - so a build-time-only key means the deployed app has no auth at
    // all, and every account sign-in silently becomes impossible in production.
    anonKey: process.env.SUPABASE_ANON_KEY || '',
  },

  mongoUri: process.env.MONGO_URI || '',

  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    temperature: 0.4, // consistency over creativity - completion.md section 7
    maxRetries: 3,
  },

  classroom: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectPath: '/api/classroom/callback',
    // Google matches the redirect_uri against a registered list, character for
    // character. The origin the browser happened to use is usually right and is
    // what we fall back to - but not when the app is reached through a tunnel
    // or a preview host, which is registered nowhere. Setting this pins it.
    redirectUri: (process.env.GOOGLE_REDIRECT_URI || '').trim(),
  },

  media: {
    // Per image a professor uploads to hang a question off (routes/media.js).
    // Every phone in the room downloads it over the same hall wifi, often at
    // the same moment, and a photo straight off a phone camera is ten times this.
    maxBytes: Number(process.env.MEDIA_MAX_BYTES) || 500 * 1024,
  },

  uploadsDir: path.join(ROOT, 'server', 'uploads'),
  clientDist: path.join(ROOT, 'client', 'dist'),
};

export const hasGemini = () => Boolean(config.gemini.apiKey);
export const hasSupabase = () => Boolean(config.supabase.url && config.supabase.serviceKey);
export const hasMongo = () => Boolean(config.mongoUri);
export const hasClassroom = () =>
  Boolean(config.classroom.clientId && config.classroom.clientSecret);
