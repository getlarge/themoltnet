#!/usr/bin/env -S npx tsx
/**
 * run-eval — Eval runner for MoltNet context quality experiments
 *
 * Usage:
 *   pnpm run-eval evals/add-rest-api-route
 *   pnpm run-eval evals/add-rest-api-route baseline
 *   pnpm run-eval evals/add-rest-api-route scan_tiles
 *
 * Environment variables:
 *   MOLTNET_CREDENTIALS_PATH  path to moltnet.json (default: .moltnet/legreffier/moltnet.json)
 *
 * Context variants are defined in each eval's scenario.json.
 * Compiled context is injected into .legreffier/context/session-pack.md in the worktree.
 */

import { execFileSync, execSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { basename, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { compileDiary, createClient, createConfig } from '@moltnet/api-client';

// ── Types ─────────────────────────────────────────────────────────────────────

interface MoltnetCredentials {
  oauth2: { client_id: string; client_secret: string };
  endpoints: { api: string };
}

interface CompileLayer {
  include_tags: string[];
  token_budget: number;
}

type ContextVariant =
  | null
  | { source: 'diaries_compile'; include_tags: string[]; token_budget: number }
  | { source: 'multi_compile'; layers: CompileLayer[] };

interface Scenario {
  fixture: { ref: string };
  setup?: { commands: string[] };
  context_variants: Record<string, ContextVariant>;
}

// ── Args ──────────────────────────────────────────────────────────────────────

const { positionals } = parseArgs({
  allowPositionals: true,
  options: {},
  strict: false,
});

const evalDir = positionals[0];
const requestedVariant = positionals[1] ?? 'all';

if (!evalDir) {
  console.error('Usage: pnpm run-eval <eval-dir> [variant]');
  process.exit(1);
}

const evalDirAbs = resolve(evalDir);
const evalName = basename(evalDirAbs);

for (const f of ['scenario.json', 'task.md', 'criteria.json']) {
  if (!existsSync(`${evalDirAbs}/${f}`)) {
    console.error(`Error: ${evalDirAbs}/${f} not found`);
    process.exit(1);
  }
}

// ── Credentials + API client ──────────────────────────────────────────────────

const credentialsPath = resolve(
  process.env.MOLTNET_CREDENTIALS_PATH ?? '.moltnet/legreffier/moltnet.json',
);

const credentials: MoltnetCredentials = JSON.parse(
  readFileSync(credentialsPath, 'utf8'),
);

const apiUrl = credentials.endpoints.api;

async function getAccessToken(): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: credentials.oauth2.client_id,
    client_secret: credentials.oauth2.client_secret,
    scope: 'diary:read diary:write',
  });

  const res = await fetch(`${apiUrl}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OAuth2 token exchange failed (${res.status}): ${err}`);
  }

  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

const apiClient = createClient(createConfig({ baseUrl: apiUrl }));

// ── Scenario ──────────────────────────────────────────────────────────────────

const scenario: Scenario = JSON.parse(
  readFileSync(`${evalDirAbs}/scenario.json`, 'utf8'),
);
const taskPrompt = readFileSync(`${evalDirAbs}/task.md`, 'utf8');

// ── Worktree management ───────────────────────────────────────────────────────

const worktrees: string[] = [];

function createWorktree(variant: string): string {
  const tmpDir = execSync('mktemp -d', { encoding: 'utf8' }).trim();
  const worktreeDir = `${tmpDir}/${evalName}-${variant}`;
  worktrees.push(worktreeDir);
  console.log(
    `==> Creating worktree at ${scenario.fixture.ref} in ${worktreeDir}`,
  );
  execSync(`git worktree add "${worktreeDir}" "${scenario.fixture.ref}"`, {
    stdio: 'inherit',
  });
  return worktreeDir;
}

function cleanupWorktrees() {
  for (const path of worktrees) {
    try {
      const list = execSync('git worktree list', { encoding: 'utf8' });
      if (list.includes(path)) {
        execSync(`git worktree remove --force "${path}"`, { stdio: 'pipe' });
      } else {
        execSync(`rm -rf "${path}"`, { stdio: 'pipe' });
      }
    } catch {
      // best-effort
    }
  }
}

process.on('exit', cleanupWorktrees);
process.on('SIGINT', () => process.exit(1));

// ── Setup ─────────────────────────────────────────────────────────────────────

function runSetup(worktreeDir: string) {
  // Copy eval files into the worktree so the nested Claude session can access them.
  copyFileSync(`${evalDirAbs}/task.md`, `${worktreeDir}/eval-task.md`);
  copyFileSync(
    `${evalDirAbs}/criteria.json`,
    `${worktreeDir}/eval-criteria.json`,
  );

  for (const cmd of scenario.setup?.commands ?? []) {
    console.log(`    $ ${cmd}`);
    execSync(cmd, { cwd: worktreeDir, stdio: 'inherit' });
  }
}

// ── Context compilation ───────────────────────────────────────────────────────

async function compileLayer(
  diaryId: string,
  token: string,
  includeTags: string[],
  tokenBudget: number,
): Promise<string> {
  const { data, error } = await compileDiary({
    client: apiClient,
    path: { id: diaryId },
    body: { tokenBudget, includeTags, taskPrompt: taskPrompt.slice(0, 2000) },
    headers: { Authorization: `Bearer ${token}` },
  });

  if (error || !data) {
    throw new Error(`compileDiary failed: ${JSON.stringify(error)}`);
  }

  return data.entries
    .map(
      (e: { id: string; content: string }) =>
        `---\n## ${e.id.slice(0, 8)}\n\n${e.content}\n`,
    )
    .join('\n');
}

async function fetchContext(variant: string, diaryId: string): Promise<string> {
  const variantConfig = scenario.context_variants[variant];

  if (!variantConfig) return '';

  const token = await getAccessToken();

  if (variantConfig.source === 'diaries_compile') {
    console.log(
      `==> Compiling context: variant=${variant} tags=${variantConfig.include_tags.join(',')} budget=${variantConfig.token_budget}`,
    );
    return compileLayer(
      diaryId,
      token,
      variantConfig.include_tags,
      variantConfig.token_budget,
    );
  }

  if (variantConfig.source === 'multi_compile') {
    const parts: string[] = [];
    for (let i = 0; i < variantConfig.layers.length; i++) {
      const layer = variantConfig.layers[i];
      console.log(
        `==> Compiling layer ${i}: tags=${layer.include_tags.join(',')} budget=${layer.token_budget}`,
      );
      parts.push(
        await compileLayer(
          diaryId,
          token,
          layer.include_tags,
          layer.token_budget,
        ),
      );
    }
    return parts.join('\n');
  }

  return '';
}

// ── Context injection ─────────────────────────────────────────────────────────

function injectContext(worktreeDir: string, variant: string, content: string) {
  if (!content) {
    console.log(`==> No context for variant '${variant}' (baseline)`);
    return;
  }

  const contextDir = `${worktreeDir}/.legreffier/context`;
  mkdirSync(contextDir, { recursive: true });
  const packPath = `${contextDir}/session-pack.md`;
  writeFileSync(
    packPath,
    `# LeGreffier Context Pack\n# Variant: ${variant}\n# Eval: ${evalName}\n# Generated: ${new Date().toISOString()}\n\n${content}`,
    'utf8',
  );
  console.log(
    `==> Context injected: ${packPath} (${Buffer.byteLength(content)} bytes)`,
  );
}

// ── Task + eval ───────────────────────────────────────────────────────────────

function runClaude(worktreeDir: string, prompt: string, flags: string[] = []) {
  // execFileSync avoids shell interpretation of special chars in the prompt.
  // Unset CLAUDECODE to allow nested Claude sessions.
  const env = { ...process.env, CLAUDECODE: undefined };
  try {
    execFileSync('claude', [...flags, prompt], {
      cwd: worktreeDir,
      stdio: 'inherit',
      env,
    });
  } catch {
    console.warn('claude exited with non-zero status');
  }
}

function runTask(worktreeDir: string, variant: string) {
  console.log(`\n==> Running task (variant: ${variant})`);
  const prompt =
    `complete the task described in eval-task.md in the current directory.` +
    ` If .legreffier/context/session-pack.md exists, read it first as repo context.`;
  // Interactive session with auto-approved edits
  runClaude(worktreeDir, prompt, ['--permission-mode', 'acceptEdits']);
}

function runEvaluation(worktreeDir: string, variant: string): string {
  const runsDir = `${evalDirAbs}/runs`;
  mkdirSync(runsDir, { recursive: true });
  const runDate = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const resultFile = `${runsDir}/${runDate}-${variant}.md`;
  // Write result inside worktree so the nested Claude session can access it,
  // then copy out to the eval runs dir.
  const worktreeResult = `${worktreeDir}/eval-result.md`;

  console.log(`\n==> Evaluating (variant: ${variant})`);
  const prompt =
    `evaluate the solution against the criteria in eval-criteria.json.` +
    ` For each criterion: state pass/fail, give a score (0 to max_score), and one sentence of evidence.` +
    ` Write results to eval-result.md`;
  // Non-interactive: read files + write eval-result.md only
  runClaude(worktreeDir, prompt, ['--print', '--add-dir', worktreeDir]);

  if (existsSync(worktreeResult)) {
    copyFileSync(worktreeResult, resultFile);
    console.log(`==> Result saved to ${resultFile}`);
  } else {
    console.warn(`==> No result file produced for variant '${variant}'`);
  }
  return resultFile;
}

// ── Comparison ────────────────────────────────────────────────────────────────

function compareResults(resultFiles: Record<string, string>) {
  console.log('\n========================================');
  console.log('==> Comparing all variants');
  console.log('========================================');

  let combined = '';
  for (const [variant, file] of Object.entries(resultFiles)) {
    if (!existsSync(file)) continue;
    const content = readFileSync(file, 'utf8');
    console.log(`\n--- ${variant} ---\n${content}`);
    combined += `\n=== ${variant} ===\n${content}`;
  }

  const runsDir = `${evalDirAbs}/runs`;
  const runDate = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const summaryFile = `${runsDir}/${runDate}-summary.md`;

  const prompt =
    `Compare these eval results across context variants. For each criterion, show a score table across variants.` +
    ` Identify criteria that pass in baseline (context-independent) vs criteria where context helped.` +
    ` Write the summary to eval-summary.md.\n\n${combined}`;
  runClaude(process.cwd(), prompt, ['--print']);

  const localSummary = `${process.cwd()}/eval-summary.md`;
  if (existsSync(localSummary)) {
    copyFileSync(localSummary, summaryFile);
    console.log(`==> Summary saved to ${summaryFile}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function runVariant(
  variant: string,
  diaryId: string,
): Promise<string | null> {
  console.log('\n========================================');
  console.log(`==> Variant: ${variant}`);
  console.log('========================================');

  const worktreeDir = createWorktree(variant);
  runSetup(worktreeDir);

  const context = await fetchContext(variant, diaryId);
  injectContext(worktreeDir, variant, context);

  runTask(worktreeDir, variant);
  return runEvaluation(worktreeDir, variant);
}

async function main() {
  // Resolve diary ID: read from env or discover from scenario tags
  const diaryId = process.env.MOLTNET_DIARY_ID ?? '';
  if (!diaryId && requestedVariant !== 'baseline') {
    console.error(
      'MOLTNET_DIARY_ID env var required for non-baseline variants',
    );
    process.exit(1);
  }

  const variants = Object.keys(scenario.context_variants);
  const toRun = requestedVariant === 'all' ? variants : [requestedVariant];

  const resultFiles: Record<string, string> = {};

  for (const variant of toRun) {
    if (!(variant in scenario.context_variants)) {
      console.error(
        `Unknown variant '${variant}'. Available: ${variants.join(', ')}`,
      );
      process.exit(1);
    }
    const resultFile = await runVariant(variant, diaryId);
    if (resultFile) resultFiles[variant] = resultFile;
  }

  if (toRun.length > 1) {
    compareResults(resultFiles);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
