/* eslint-disable no-useless-escape, no-console */
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const EVALS_DIR = join(ROOT, 'tiles', 'moltnet-practices', 'evals');
const TASKS_DIR = join(ROOT, 'harbor', 'tasks');
const TILE_DOCS_DIR = join(
  ROOT,
  '.tessl',
  'tiles',
  'getlarge',
  'moltnet-practices',
  'docs',
);

function taskToml(): string {
  return `version = "1.0"

[metadata]
author_name = "MoltNet"
difficulty = "medium"
category = "moltnet"
tags = ["moltnet", "tile-eval"]

[verifier]
timeout_sec = 300.0

[verifier.env]
ANTHROPIC_API_KEY = "\${ANTHROPIC_API_KEY:-}"
CLAUDE_CODE_OAUTH_TOKEN = "\${CLAUDE_CODE_OAUTH_TOKEN:-}"
JUDGE_MODEL = "claude-sonnet-4-6"

[agent]
timeout_sec = 900.0

[environment]
build_timeout_sec = 600.0
cpus = 2
memory_mb = 4096
storage_mb = 10240
`;
}

function dockerfile(): string {
  return `FROM docker/sandbox-templates:claude-code

USER root

RUN apt-get update && apt-get install -y jq && rm -rf /var/lib/apt/lists/*

# Strip apiKeyHelper so CLAUDE_CODE_OAUTH_TOKEN works
# (base image defaults to "apiKeyHelper": "echo proxy-managed" which overrides OAuth)
RUN mkdir -p /home/agent/.claude && \\
    if [ -f /home/agent/.claude/settings.json ]; then \\
      jq 'del(.apiKeyHelper) + {"defaultMode":"bypassPermissions","bypassPermissionsModeAccepted":true}' \\
        /home/agent/.claude/settings.json > /tmp/settings.json && \\
      mv /tmp/settings.json /home/agent/.claude/settings.json; \\
    else \\
      echo '{"defaultMode":"bypassPermissions","bypassPermissionsModeAccepted":true}' \\
        > /home/agent/.claude/settings.json; \\
    fi && \\
    echo '{"hasCompletedOnboarding":true}' > /home/agent/.claude.json && \\
    chown -R agent:agent /home/agent/.claude /home/agent/.claude.json

USER agent

WORKDIR /app
`;
}

function testSh(): string {
  return `#!/bin/bash
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
  console.log('\\nContext: '+c.context);
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
  const match = text.match(/\\[[\\\s\\\S]*\\]/);
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
    const key = c.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_\\\$/g, '');
    details[key] = { score: c.score, max_score: c.max_score, evidence: c.evidence };
    console.log('  ' + c.score + '/' + c.max_score + ' ' + c.name + ': ' + c.evidence);
  });
  console.log('Total: ' + total + '/' + max + ' (' + (normalizedReward * 100).toFixed(1) + '%)');
  fs.mkdirSync('/logs/verifier', { recursive: true });
  fs.writeFileSync('/logs/verifier/reward.json', JSON.stringify({ reward: normalizedReward }, null, 2));
  fs.writeFileSync('/logs/verifier/scores.json', JSON.stringify(details, null, 2));
" "\$RESULT"
`;
}

async function loadTileDocs(): Promise<string> {
  const files = ['index.md', 'database-patterns.md', 'incident-patterns.md'];
  const parts: string[] = [];
  for (const file of files) {
    const content = await readFile(join(TILE_DOCS_DIR, file), 'utf-8');
    parts.push(content);
  }
  return parts.join('\n\n---\n\n');
}

async function scaffoldTask(
  evalDir: string,
  name: string,
  withContext: boolean,
  tileDocs: string,
): Promise<void> {
  const variant = withContext ? `${name}-with-context` : name;
  const taskDir = join(TASKS_DIR, variant);

  await rm(taskDir, { recursive: true, force: true });
  await mkdir(join(taskDir, 'environment'), { recursive: true });
  await mkdir(join(taskDir, 'tests', 'judge'), { recursive: true });

  await writeFile(join(taskDir, 'task.toml'), taskToml());

  const taskMd = await readFile(join(evalDir, 'task.md'), 'utf-8');
  await writeFile(join(taskDir, 'instruction.md'), taskMd);

  await writeFile(join(taskDir, 'environment', 'Dockerfile'), dockerfile());

  if (withContext) {
    const claudeDir = join(taskDir, 'environment', '.claude');
    await mkdir(claudeDir, { recursive: true });
    await writeFile(
      join(claudeDir, 'CLAUDE.md'),
      `# MoltNet Development Practices\n\nThis context is from the moltnet-practices tile. Use it to inform your work.\n\n${tileDocs}`,
    );
  }

  await copyFile(
    join(evalDir, 'criteria.json'),
    join(taskDir, 'tests', 'criteria.json'),
  );

  await writeFile(join(taskDir, 'tests', 'test.sh'), testSh(), {
    mode: 0o755,
  });

  const judgeDir = join(ROOT, 'harbor', 'judge');
  await copyFile(
    join(judgeDir, 'package.json'),
    join(taskDir, 'tests', 'judge', 'package.json'),
  );
  await copyFile(
    join(judgeDir, 'judge.ts'),
    join(taskDir, 'tests', 'judge', 'judge.ts'),
  );

  console.log(`  ${variant}`);
}

async function main(): Promise<void> {
  console.log('Scaffolding Harbor tasks from tile evals...\n');

  const tileDocs = await loadTileDocs();
  const evalDirs = await readdir(EVALS_DIR, { withFileTypes: true });
  const evals = evalDirs
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  console.log(`Found ${evals.length} eval(s) in ${EVALS_DIR}\n`);

  await rm(TASKS_DIR, { recursive: true, force: true });
  await mkdir(TASKS_DIR, { recursive: true });

  for (const name of evals) {
    const evalDir = join(EVALS_DIR, name);
    await scaffoldTask(evalDir, name, false, tileDocs);
    await scaffoldTask(evalDir, name, true, tileDocs);
  }

  console.log(
    `\nDone: ${evals.length * 2} tasks (${evals.length} x 2 variants)`,
  );
}

main().catch((err) => {
  console.error('Scaffold failed:', err);
  process.exit(1);
});
