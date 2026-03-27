#!/bin/bash
set -euo pipefail

export PATH="$HOME/.local/bin:$PATH"

# Collect agent output files
FILES=""
for f in /app/*; do
  [ -f "$f" ] || continue
  FILES="$FILES
=== $(basename "$f") ===
$(cat "$f")"
done

if [ -z "$FILES" ]; then
  echo "No files found in /app"
  mkdir -p /logs/verifier
  echo '{"reward": 0}' > /logs/verifier/reward.json
  exit 0
fi

# Read criteria
CRITERIA=$(cat /tests/criteria.json)

# Build criteria list for prompt
CRITERIA_LIST=$(node -e "
  const c = JSON.parse(require('fs').readFileSync('/tests/criteria.json','utf8'));
  c.checklist.forEach((x,i) => console.log((i+1)+'. \"'+x.name+'\" (max '+x.max_score+'): '+x.description));
  console.log('\nContext: '+c.context);
")

# Run claude as judge (same mechanism as agent phase — direct CLI invocation)
RESULT=$(claude --output-format json --max-turns 1 --permission-mode bypassPermissions -p "You are an eval judge. The agent produced these files:

$FILES

Score the agent's work against this weighted checklist. For EACH criterion, determine a score from 0 to max_score.

Criteria:
$CRITERIA_LIST

Output ONLY a JSON array — one object per criterion:
[{ \"name\": \"criterion name\", \"score\": <number>, \"max_score\": <number>, \"evidence\": \"one sentence\" }]
No markdown fences. No explanation outside the JSON." 2>/dev/null) || true

# Parse result and write reward
node -e "
  const fs = require('fs');
  const raw = process.argv[1];
  if (!raw) {
    console.error('No judge output');
    fs.mkdirSync('/logs/verifier', { recursive: true });
    fs.writeFileSync('/logs/verifier/reward.json', JSON.stringify({ reward: 0 }));
    process.exit(0);
  }
  let text;
  try {
    const parsed = JSON.parse(raw);
    text = parsed.result || '';
  } catch {
    text = raw;
  }
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) {
    console.error('Judge did not produce JSON array. Raw:', text.slice(0, 500));
    fs.mkdirSync('/logs/verifier', { recursive: true });
    fs.writeFileSync('/logs/verifier/reward.json', JSON.stringify({ reward: 0 }));
    process.exit(0);
  }
  const scored = JSON.parse(match[0]);
  const total = scored.reduce((s, c) => s + c.score, 0);
  const max = scored.reduce((s, c) => s + c.max_score, 0);
  const normalizedReward = max > 0 ? total / max : 0;
  const details = {};
  scored.forEach(c => {
    const key = c.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    details[key] = { score: c.score, max_score: c.max_score, evidence: c.evidence };
    console.log('  ' + c.score + '/' + c.max_score + ' ' + c.name + ': ' + c.evidence);
  });
  console.log('Total: ' + total + '/' + max + ' (' + (normalizedReward * 100).toFixed(1) + '%)');
  fs.mkdirSync('/logs/verifier', { recursive: true });
  fs.writeFileSync('/logs/verifier/reward.json', JSON.stringify({ reward: normalizedReward }, null, 2));
  fs.writeFileSync('/logs/verifier/scores.json', JSON.stringify(details, null, 2));
" "$RESULT"
