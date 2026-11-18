// Demo seeding. Build order step 7 in completion.md is "seed weak profile, run two
// phones", and this is that step made repeatable: one command produces a session
// whose grid already contains a student inside the below-40% band and a student
// at the top of the ladder, so the divergence is visible the moment two phones
// join instead of after five minutes of tapping on stage.
//
//   npm run seed            -> generates a bank from the sample chapter and seeds
//   npm run seed -- --code DEMO24
//
// Prints the room code and the two roll numbers to use on the two phones.

import { initStore, getRepo, closeStore } from './repo/index.js';
import { generateBank } from './services/generate.js';
import { emptyProfile, applyAnswer, isSlowLearner, overallAccuracy } from './services/mastery.js';
import { selectNext } from './services/selector.js';
import { LEVELS, LABEL } from './bloom.js';
import { SAMPLE } from './sampleContent.js';

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function randomCode() {
  let out = '';
  for (let i = 0; i < 6; i += 1) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

/**
 * Drive a profile to a target overall accuracy by actually answering items from
 * the bank through applyAnswer. Seeding the counters directly would be quicker
 * but would produce a profile the mastery model itself would never generate -
 * and the history has to be real, because the selector reads it to avoid
 * re-serving items.
 */
function drive(profile, questions, { attempts, correctRate }) {
  let current = profile;
  for (let i = 0; i < attempts; i += 1) {
    const pick = selectNext(current, questions);
    if (!pick) break;
    // Deterministic rather than random, so the seeded grid looks the same at
    // every dry run. Spread, not front-loaded: handing a weak student their
    // correct answers first promotes them a level before the below-40% band
    // engages, leaving Apply attempts on the row of a student the demo is
    // describing as capped.
    const correct = ((i * 37) % 100) < correctRate * 100;
    ({ profile: current } = applyAnswer(current, {
      questionId: pick.question._id,
      bloom: pick.question.bloom,
      correct,
    }));
  }
  return current;
}

async function main() {
  await initStore();
  const repo = getRepo();

  // Seeding runs in its own process. On the in-process store that heap dies with
  // this script, so the room code printed below would be one the running server
  // has never heard of - the failure would only show up when a phone tried to
  // join it, on stage. Refuse instead.
  if (repo.kind === 'memory') {
    console.error('\n[seed] Refusing to seed: no database is configured.');
    console.error('[seed] Seeding writes from a separate process, so with the in-process');
    console.error('[seed] store the seeded session would not exist in the running server.');
    console.error('[seed] Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or MONGO_URI) and retry.');
    console.error('[seed] Without a database, run the demo live instead - it works fully.\n');
    await closeStore();
    process.exit(2);
  }

  console.log('\n[seed] creating content from the sample chapter...');
  const content = await repo.createContent({
    title: SAMPLE.title,
    kind: 'syllabus',
    rawText: SAMPLE.rawText,
    topics: SAMPLE.topics,
  });

  console.log(`[seed] generating a bank across ${SAMPLE.topics.length} topics...`);
  const started = Date.now();
  const { questions, source, warnings } = await generateBank({
    content,
    topics: SAMPLE.topics,
  });
  const saved = await repo.insertQuestions(
    questions.map((q) => ({ ...q, contentId: content._id })),
  );
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`[seed] ${saved.length} questions in ${secs}s (source: ${source})`);
  if (warnings?.length) console.log(`[seed] warnings: ${warnings.join(' | ')}`);

  const counts = LEVELS.map((l) => `${LABEL[l]} ${saved.filter((q) => q.bloom === l).length}`);
  console.log(`[seed] spread: ${counts.join(' · ')}`);

  const code = (arg('code') || randomCode()).toUpperCase();
  const session = await repo.createSession({
    code,
    contentId: content._id,
    title: SAMPLE.title,
  });

  // Roll 07 - the student this project exists for. Answers mostly wrong, so the
  // model drops them into the below-40% band and the ceiling engages.
  let weak = emptyProfile({ sessionId: session._id, rollNo: '07', name: 'Seeded (weak)' });
  weak = drive(weak, saved, { attempts: 8, correctRate: 0.25 });
  await repo.saveProfile(weak);

  // Roll 02 - answers almost everything right, climbs the ladder.
  let strong = emptyProfile({ sessionId: session._id, rollNo: '02', name: 'Seeded (strong)' });
  strong = drive(strong, saved, { attempts: 10, correctRate: 0.9 });
  await repo.saveProfile(strong);

  const show = (p) =>
    `roll ${p.rollNo}: ${Math.round((overallAccuracy(p) ?? 0) * 100)}% overall, ` +
    `working level ${LABEL[p.workingLevel]}${isSlowLearner(p) ? ', SLOW-LEARNER BAND' : ''}`;

  const bar = '='.repeat(58);
  console.log(`\n${bar}`);
  console.log(`  ROOM CODE:  ${code}`);
  console.log(bar);
  console.log(`  ${show(weak)}`);
  console.log(`  ${show(strong)}`);
  console.log('');
  console.log('  Phone A -> join with code above, roll number 07');
  console.log('  Phone B -> join with code above, roll number 02');
  console.log('  Both resume their seeded profile, so the first question each');
  console.log('  receives is already at a different Bloom level.');
  console.log(`${bar}\n`);

  await closeStore();
}

main().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
