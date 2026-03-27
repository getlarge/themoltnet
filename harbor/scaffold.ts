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
ANTHROPIC_API_KEY = "\${ANTHROPIC_API_KEY}"
CLAUDE_CODE_OAUTH_TOKEN = "\${CLAUDE_CODE_OAUTH_TOKEN}"
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
  return `FROM node:22-slim

RUN apt-get update && apt-get install -y curl bash && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://claude.ai/install.sh | bash
ENV PATH="/root/.local/bin:\${PATH}"

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app
`;
}

function testSh(): string {
  return `#!/bin/bash
set -euo pipefail

cd /tests/judge
npm install --prefer-offline 2>/dev/null || npm install
cd /app

npx --prefix /tests/judge tsx /tests/judge/judge.ts
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
