#!/usr/bin/env bash
# Every server suite, offline. Network settings are blanked in the environment first:
# dotenv never overrides a variable that is already set, even to an empty string, so a
# server/.env holding live keys cannot be read by any suite.
#   bash scripts/test-offline.sh [output-folder]
export SUPABASE_URL= SUPABASE_SERVICE_ROLE_KEY= SUPABASE_ANON_KEY= MONGO_URI= GEMINI_API_KEY=
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/.test-output}"; mkdir -p "$OUT"; : > "$OUT/summary.txt"
run() { local name="$1"; shift; local s=$(date +%s); "$@" > "$OUT/$name.txt" 2>&1; local code=$?; echo "$name exit=$code seconds=$(( $(date +%s)-s ))" | tee -a "$OUT/summary.txt"; }
cd "$ROOT/server" || exit 2
run unit npm test
run migrations npm run migrations
cd "$ROOT"
for s in liveloop security review evidence resume integrity roundtrip bank kinds media items roster records \
         modes insights outcomes attainment acceptance4 decisions classquestion misconceptions honesty keysafety \
         hub practice paths lessons tutor offline laptop recordsync figures figkinds zipgaps1 zipgaps2 \
         answerkinds examguard; do
  [ -f "server/scripts/$s.mjs" ] && run "$s" node "server/scripts/$s.mjs"
done
echo "Output in $OUT. Never run server/scripts/smoke.mjs this way: it is the one script meant for live keys."
