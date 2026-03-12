#!/usr/bin/env npx tsx
/**
 * tasksmith/derive.ts — Derive SWE-bench-style task records from harvested commits.
 *
 * Reads:  tasksmith/candidates/commits.jsonl
 * Writes: tasksmith/candidates/tasks/{task_id}.json
 *         tasksmith/candidates/tasks/index.jsonl
 *
 * Usage: npx tsx tasksmith/derive.ts
 *
 * Review fixes applied:
 * 1. No gold-fix file paths leaked into problem_statement (subsystems only)
 * 2. pass_to_pass includes downstream monorepo dependents
 * 3. Test-based fail_to_pass distinguishes modified vs added test files
 * 4. Codegen checks all changed generated files, not a hard-coded list
 * 5. Family classification is kept from harvest.ts (accepted as first pass)
 */

import { exec as execCb } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execCb);

const EXEC_OPTS = { encoding: 'utf8' as const, maxBuffer: 10 * 1024 * 1024 };
const __dirname =
  import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CandidateCommit {
  commit_sha: string;
  parent_sha: string;
  subject: string;
  date: string;
  has_diary_trailer: boolean;
  diary_entry_ids: string[];
  changed_files: string[];
  family: string;
  secondary_families: string[];
  subsystems: string[];
  task_shape: 'high' | 'medium' | 'low';
  confidence: 'high' | 'medium' | 'low';
}

interface CommitGroup {
  group_id: string;
  start_commit_sha: string;
  end_commit_sha: string;
  fixture_ref: string;
  commit_shas: string[];
  subjects: string[];
  has_diary_trailer: boolean;
  diary_entry_ids: string[];
  changed_files: string[];
  family: string;
  secondary_families: string[];
  subsystems: string[];
  confidence: 'high' | 'medium' | 'low';
  grouping_reason: string;
}

interface TaskRecord {
  task_id: string;
  fixture_ref: string;
  gold_fix_ref: string;
  source_commit_ref: string;
  source_commit_refs?: string[];
  problem_statement: string;
  family: string;
  secondary_families: string[];
  subsystems: string[];
  changed_files: string[];
  fail_to_pass: string[];
  pass_to_pass: string[];
  diary_entry_ids: string[];
  confidence: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPO_ROOT = join(__dirname, '..');
const CANDIDATES_FILE = join(REPO_ROOT, 'tasksmith/candidates/commits.jsonl');
const GROUPS_FILE = join(REPO_ROOT, 'tasksmith/candidates/commit-groups.jsonl');
const TASKS_DIR = join(REPO_ROOT, 'tasksmith/candidates/tasks');
const INDEX_FILE = join(TASKS_DIR, 'index.jsonl');

const WORKSPACE_MAP: Record<string, string> = {
  'apps/rest-api': '@moltnet/rest-api',
  'apps/mcp-server': '@moltnet/mcp-server',
  'apps/landing': '@moltnet/landing',
  'libs/database': '@moltnet/database',
  'libs/diary-service': '@moltnet/diary-service',
  'libs/auth': '@moltnet/auth',
  'libs/crypto-service': '@moltnet/crypto-service',
  'libs/api-client': '@moltnet/api-client',
  'libs/models': '@moltnet/models',
  'libs/observability': '@moltnet/observability',
  'libs/embedding-service': '@moltnet/embedding-service',
  'libs/sdk': '@themoltnet/sdk',
  'libs/bootstrap': '@moltnet/bootstrap',
  'libs/context-distill': '@moltnet/context-distill',
  'packages/cli': '@themoltnet/cli',
  'packages/github-agent': '@themoltnet/github-agent',
  'packages/legreffier-cli': '@themoltnet/legreffier-cli',
};

/**
 * Downstream dependents: if workspace X changes, these consumers must also
 * be typechecked because they import from X and could break.
 *
 * Fix #2: monorepo-aware pass_to_pass.
 */
const DOWNSTREAM_DEPS: Record<string, string[]> = {
  '@moltnet/models': [
    '@moltnet/rest-api',
    '@moltnet/mcp-server',
    '@moltnet/api-client',
    '@moltnet/diary-service',
    '@themoltnet/sdk',
  ],
  '@moltnet/auth': ['@moltnet/rest-api', '@moltnet/mcp-server'],
  '@moltnet/database': [
    '@moltnet/rest-api',
    '@moltnet/diary-service',
    '@moltnet/bootstrap',
  ],
  '@moltnet/diary-service': ['@moltnet/rest-api'],
  '@moltnet/crypto-service': ['@moltnet/rest-api', '@themoltnet/sdk'],
  '@moltnet/observability': ['@moltnet/rest-api', '@moltnet/mcp-server'],
  '@moltnet/embedding-service': ['@moltnet/rest-api'],
  '@moltnet/api-client': ['@moltnet/mcp-server', '@themoltnet/sdk'],
  '@moltnet/bootstrap': ['@moltnet/rest-api'],
  '@moltnet/context-distill': ['@moltnet/rest-api'],
};

const TEST_AWARE_FAMILIES = new Set([
  'rest-api-route',
  'service-logic',
  'mcp-tooling',
  'auth-permissions',
  'workflow',
  'sdk-package',
  'cli-package',
  'github-agent-package',
]);

/**
 * Generated file paths that codegen commits may touch.
 * Fix #4: check ALL changed generated files, not a hard-coded 3.
 */
const CODEGEN_GLOBS = [
  'apps/rest-api/public/openapi.json',
  'libs/api-client/src/generated/',
  'cmd/moltnet-api-client/',
];

function isCodegenFile(f: string): boolean {
  return CODEGEN_GLOBS.some((g) => f === g || f.startsWith(g));
}

// ---------------------------------------------------------------------------
// Async git helpers
// ---------------------------------------------------------------------------

async function gitDiff(
  parentSha: string,
  commitSha: string,
  file?: string,
): Promise<string> {
  const pathSpec = file ? ` -- ${file}` : '';
  try {
    const { stdout } = await exec(
      `git diff ${parentSha}..${commitSha}${pathSpec}`,
      { ...EXEC_OPTS, cwd: REPO_ROOT },
    );
    return stdout;
  } catch {
    return '';
  }
}

/**
 * Fix #3: Check whether a file exists at a given git ref.
 * Distinguishes "test file was modified" (strong verifier) from
 * "test file was added" (weak — fails because absent, not because wrong).
 */
async function fileExistsAtRef(
  ref: string,
  filePath: string,
): Promise<boolean> {
  try {
    await exec(`git cat-file -e ${ref}:${filePath}`, {
      encoding: 'utf8',
    });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Concurrency helper
// ---------------------------------------------------------------------------

async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a CommitGroup into a CandidateCommit-like shape so it flows
 * through the same derive pipeline. The key differences:
 * - parent_sha = group.fixture_ref (parent of first commit)
 * - commit_sha = group.end_commit_sha (last commit = gold fix)
 * - subject is synthesized from group subjects
 * - changed_files is the union across all members
 */
function groupToCandidate(group: CommitGroup): CandidateCommit & { _group: CommitGroup } {
  // Use the last commit's subject as the primary, but flag as group
  const lastSubject = group.subjects[group.subjects.length - 1];
  return {
    commit_sha: group.end_commit_sha,
    parent_sha: group.fixture_ref,
    subject: lastSubject,
    date: '', // not used for derivation
    has_diary_trailer: group.has_diary_trailer,
    diary_entry_ids: group.diary_entry_ids,
    changed_files: group.changed_files,
    family: group.family,
    secondary_families: group.secondary_families,
    subsystems: group.subsystems,
    task_shape: 'high', // groups are inherently higher quality
    confidence: group.confidence,
    _group: group,
  };
}

function slugify(text: string, maxLen = 40): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen)
    .replace(/-+$/, '');
}

function fileToWorkspacePrefix(filePath: string): string | undefined {
  const prefixes = Object.keys(WORKSPACE_MAP).sort(
    (a, b) => b.length - a.length,
  );
  for (const prefix of prefixes) {
    if (filePath.startsWith(prefix + '/') || filePath === prefix) {
      return prefix;
    }
  }
  return undefined;
}

function fileToWorkspace(filePath: string): string | undefined {
  const prefix = fileToWorkspacePrefix(filePath);
  return prefix ? WORKSPACE_MAP[prefix] : undefined;
}

function affectedWorkspaces(files: string[]): string[] {
  const ws = new Set<string>();
  for (const f of files) {
    const w = fileToWorkspace(f);
    if (w) ws.add(w);
  }
  return [...ws];
}

function isTestFile(f: string): boolean {
  return /\.(test|e2e\.test)\.ts$/.test(f);
}

function workspaceRelativePath(filePath: string): string | undefined {
  const prefix = fileToWorkspacePrefix(filePath);
  if (!prefix) return undefined;
  return relative(prefix, filePath);
}

// ---------------------------------------------------------------------------
// rg pattern extraction
// ---------------------------------------------------------------------------

/**
 * Massively expanded blocklist. Any token that could plausibly appear
 * in unrelated code (JS keywords, common library names, generic verbs,
 * test helpers, HTTP/DB terms) is banned.
 */
const GENERIC_TOKENS = new Set([
  // JS/TS keywords & built-ins
  'string',
  'number',
  'boolean',
  'object',
  'undefined',
  'function',
  'return',
  'import',
  'export',
  'default',
  'require',
  'module',
  'console',
  'Promise',
  'resolve',
  'reject',
  'throws',
  'typeof',
  'extends',
  'implements',
  'abstract',
  'private',
  'protected',
  'public',
  'static',
  'readonly',
  'declare',
  'namespace',
  'keyof',
  'async',
  'await',
  'Buffer',
  'Error',
  'Array',
  'Object',
  'Record',
  'Partial',
  // Test framework
  'describe',
  'expect',
  'beforeEach',
  'afterEach',
  'beforeAll',
  'afterAll',
  'should',
  'toEqual',
  'toBeDefined',
  'toHaveBeenCalled',
  'length',
  'status',
  'toStrictEqual',
  'toContain',
  'toMatch',
  'toThrow',
  'toBeNull',
  'toHaveLength',
  'toHaveProperty',
  'toBeUndefined',
  'toBeTruthy',
  'toBeFalsy',
  'mockReturnValue',
  'mockResolvedValue',
  'mockImplementation',
  // HTTP / REST
  'request',
  'response',
  'handler',
  'middleware',
  'headers',
  'params',
  'options',
  'method',
  'create',
  'update',
  'delete',
  'remove',
  'insert',
  'select',
  'values',
  'schema',
  'plugin',
  'register',
  'server',
  'client',
  'routes',
  'config',
  'message',
  'result',
  'callback',
  'payload',
  // Generic nouns/verbs that appear everywhere
  'description',
  'statement',
  'content',
  'context',
  'service',
  'factory',
  'instance',
  'interface',
  'abstract',
  'implements',
  'constructor',
  'property',
  'element',
  'render',
  'component',
  'container',
  'wrapper',
  'utils',
  'helper',
  'manager',
  'provider',
  'controller',
  'repository',
  'version',
  'enabled',
  'disabled',
  'visible',
  'hidden',
  'loading',
  'success',
  'failure',
  'pending',
  'active',
  'inactive',
  'filter',
  'format',
  'transform',
  'process',
  'handle',
  'execute',
  'validate',
  'serialize',
  'parse',
  'stringify',
  'encode',
  'decode',
  'Encode',
  'Decode',
  // Common in generated Go code
  'Params',
  'Client',
  'Server',
  'Handler',
  'Response',
  'Request',
  'String',
  'OptString',
  'OptBool',
  'OptInt',
  'Struct',
  // Logging/observability
  'logger',
  'debug',
  'warning',
  // Common short identifiers
  'value',
  'index',
  'items',
  'entry',
  'query',
  'table',
  'column',
  'field',
  'count',
  'total',
  'source',
  'target',
  'input',
  'output',
  'parent',
  'children',
  'token',
  'secret',
  'password',
  'email',
  'unknown',
  'separated',
]);

/**
 * Check whether a token looks domain-specific enough to be a useful rg probe.
 *
 * Requirements (at least one):
 * - camelCase compound: has internal uppercase (e.g. excludeTags, diaryEntryId)
 * - snake_case compound: has underscore between letters (e.g. diary_entry_id)
 * - PascalCase with 2+ segments: starts uppercase, has another uppercase after
 * - Contains a project-specific prefix: moltnet, diary, keto, ory, dbos, fastify
 *
 * Rejects:
 * - ALL_CAPS constants (too generic: STATUS, CONFIG, etc.)
 * - Single-word lowercase (even if long: "description", "statement")
 */
function isDomainSpecific(token: string): boolean {
  // Reject ALL_CAPS
  if (/^[A-Z][A-Z0-9_]+$/.test(token)) return false;

  // camelCase: lowercase start, then at least one uppercase letter
  if (/^[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*$/.test(token)) return true;

  // snake_case compound: letters_letters
  if (/^[a-z]+_[a-z]+/.test(token)) return true;

  // PascalCase with 2+ segments (e.g. DiaryEntry, ExcludeTags)
  if (/^[A-Z][a-z]+[A-Z][a-zA-Z]*$/.test(token)) return true;

  // Project-specific prefixes — always interesting
  const domainPrefixes = [
    'moltnet',
    'diary',
    'keto',
    'ory',
    'dbos',
    'fastify',
    'drizzle',
    'vouch',
    'nugget',
    'legreffier',
    'openclaw',
    'consolidat',
    'distill',
  ];
  const lower = token.toLowerCase();
  if (domainPrefixes.some((p) => lower.includes(p))) return true;

  return false;
}

function extractRgPatterns(diffText: string, maxPatterns = 3): string[] {
  const lines = diffText.split('\n');
  const candidates: string[] = [];

  for (const line of lines) {
    if (!line.startsWith('+') || line.startsWith('+++')) continue;

    const content = line.slice(1).trim();
    if (!content || content.length < 8) continue;
    if (/^[{})\];,]$/.test(content)) continue;
    // Skip import/require lines — tokens from them appear in all files
    if (/^\s*(import|require|from)\b/.test(content)) continue;

    const tokens = content.match(/[a-zA-Z_][a-zA-Z0-9_]{5,}/g);
    if (!tokens) continue;

    for (const token of tokens) {
      if (GENERIC_TOKENS.has(token)) continue;
      if (!isDomainSpecific(token)) continue;
      if (!candidates.includes(token)) {
        candidates.push(token);
      }
    }

    if (candidates.length >= maxPatterns * 3) break;
  }

  return candidates.slice(0, maxPatterns);
}

// ---------------------------------------------------------------------------
// Task ID
// ---------------------------------------------------------------------------

function generateTaskId(candidate: CandidateCommit & { _group?: CommitGroup }): string {
  const subject = candidate._group
    ? candidate._group.subjects[candidate._group.subjects.length - 1]
    : candidate.subject;
  const match = subject.match(/\):\s*(.+)$/);
  const description = match ? match[1] : subject;
  const slug = slugify(description);
  const shaShort = candidate.commit_sha.slice(0, 8);
  if (candidate._group) {
    return `grp-${candidate.family}-${slug}-${shaShort}`;
  }
  return `${candidate.family}-${slug}-${shaShort}`;
}

// ---------------------------------------------------------------------------
// Problem statement — Fix #1: no file path leakage
// ---------------------------------------------------------------------------

function generateProblemStatement(candidate: CandidateCommit & { _group?: CommitGroup }): string {
  const { subsystems } = candidate;

  let statement: string;

  if (candidate._group) {
    // Group: synthesize from all subjects
    const subjects = candidate._group.subjects;
    const descs = subjects.map((s) => {
      const match = s.match(/^[a-z]+\([^)]*\):\s*(.+)$/);
      return match ? match[1] : s;
    });
    // Determine dominant commit type
    const types = subjects.map((s) => s.match(/^([a-z]+)\(/)?.[1] || 'other');
    const hasFix = types.includes('fix');
    const hasFeat = types.includes('feat');
    if (hasFix) {
      statement = `Fix: ${descs.join('; ')}.`;
    } else if (hasFeat) {
      statement = `Implement: ${descs.join('; ')}.`;
    } else {
      statement = descs.join('; ') + '.';
    }
  } else {
    const { subject } = candidate;
    if (subject.startsWith('fix(')) {
      const desc = subject.replace(/^fix\([^)]*\):\s*/, '');
      statement = `The ${desc}. This needs to be fixed.`;
    } else if (subject.startsWith('feat(')) {
      const desc = subject.replace(/^feat\([^)]*\):\s*/, '');
      statement = `Implement: ${desc}.`;
    } else if (subject.startsWith('refactor(')) {
      const desc = subject.replace(/^refactor\([^)]*\):\s*/, '');
      statement = `Refactor: ${desc}.`;
    } else if (subject.startsWith('test(')) {
      const desc = subject.replace(/^test\([^)]*\):\s*/, '');
      statement = `Add/fix tests: ${desc}.`;
    } else if (subject.startsWith('chore(') && /regen/i.test(subject)) {
      statement = 'Generated API clients are stale and need regeneration.';
    } else {
      statement = subject;
    }
  }

  if (subsystems.length > 0) {
    statement += `\n\nAffected subsystems: ${subsystems.join(', ')}`;
  }

  return statement;
}

// ---------------------------------------------------------------------------
// fail_to_pass — Fix #3 (test file existence) + Fix #4 (codegen breadth)
// ---------------------------------------------------------------------------

async function generateFailToPass(
  candidate: CandidateCommit,
): Promise<string[]> {
  const { parent_sha, commit_sha, changed_files, family } = candidate;
  const checks: string[] = [];

  // --- Helper: generate rg probes only for files that exist at fixture ---
  async function rgProbesForFiles(
    files: string[],
    patternsPerFile = 2,
  ): Promise<string[]> {
    const probes: string[] = [];
    const existingFiles = await Promise.all(
      files.map(async (file) => ({
        file,
        exists: await fileExistsAtRef(parent_sha, file),
      })),
    );
    const validFiles = existingFiles
      .filter((f) => f.exists)
      .map((f) => f.file);

    const diffPromises = validFiles.map(async (file) => {
      const diff = await gitDiff(parent_sha, commit_sha, file);
      return { file, patterns: extractRgPatterns(diff, patternsPerFile) };
    });
    const results = await Promise.all(diffPromises);
    for (const { file, patterns } of results) {
      for (const p of patterns) {
        probes.push(`rg -n '${p}' ${file}`);
      }
    }
    return probes;
  }

  // --- Codegen: check ALL changed generated files (Fix #4) ---
  if (family === 'codegen') {
    const genFiles = changed_files.filter(isCodegenFile);
    return rgProbesForFiles(genFiles, 2);
  }

  // --- Database migration ---
  if (family === 'database-migration') {
    const migrationFiles = changed_files.filter(
      (f) => f.startsWith('libs/database/drizzle/') && f.endsWith('.sql'),
    );
    const schemaFile = changed_files.includes('libs/database/src/schema.ts')
      ? 'libs/database/src/schema.ts'
      : null;
    const filesToCheck = [
      ...migrationFiles,
      ...(schemaFile ? [schemaFile] : []),
    ];
    return rgProbesForFiles(filesToCheck, 2);
  }

  // --- Test-aware families ---
  if (TEST_AWARE_FAMILIES.has(family)) {
    const testFiles = changed_files.filter(isTestFile);

    if (testFiles.length > 0) {
      // Fix #3: Only use test files that ALREADY EXIST on the fixture.
      // A test file added by the gold fix would fail on the fixture because
      // it's absent, not because the behavior is wrong — that's a weak verifier.
      const existenceChecks = await Promise.all(
        testFiles.map(async (tf) => ({
          file: tf,
          existsOnFixture: await fileExistsAtRef(parent_sha, tf),
        })),
      );
      const modifiedTests = existenceChecks
        .filter((c) => c.existsOnFixture)
        .map((c) => c.file);

      if (modifiedTests.length > 0) {
        for (const tf of modifiedTests) {
          const ws = fileToWorkspace(tf);
          const relPath = workspaceRelativePath(tf);
          if (ws && relPath) {
            checks.push(`pnpm --filter ${ws} run test -- ${relPath}`);
          }
        }
        return checks;
      }
      // All test files are new — fall through to rg checks
    }

    // No usable test files — try package-level test before grep fallback.
    // Package-level test is a stronger verifier than source-file grep probes.
    const primaryWorkspaces = affectedWorkspaces(changed_files);
    if (primaryWorkspaces.length === 1) {
      checks.push(`pnpm --filter ${primaryWorkspaces[0]} run test`);
      return checks;
    }

    // Multiple workspaces or none — fall back to rg probes
    const sourceFiles = changed_files.filter(
      (f) => !isTestFile(f) && !f.endsWith('.md') && f !== 'pnpm-lock.yaml',
    );
    const probes = await rgProbesForFiles(sourceFiles.slice(0, 5), 2);
    checks.push(...probes.slice(0, 3));
    return checks;
  }

  // --- Fallback: any other family ---
  const testFiles = changed_files.filter(isTestFile);
  if (testFiles.length > 0) {
    const existenceChecks = await Promise.all(
      testFiles.map(async (tf) => ({
        file: tf,
        existsOnFixture: await fileExistsAtRef(parent_sha, tf),
      })),
    );
    const modifiedTests = existenceChecks
      .filter((c) => c.existsOnFixture)
      .map((c) => c.file);

    for (const tf of modifiedTests) {
      const ws = fileToWorkspace(tf);
      const relPath = workspaceRelativePath(tf);
      if (ws && relPath) {
        checks.push(`pnpm --filter ${ws} run test -- ${relPath}`);
      }
    }
    if (checks.length > 0) return checks;
  }

  // rg checks — only probe files that exist at the fixture
  const sourceFiles = changed_files.filter(
    (f) => !isTestFile(f) && !f.endsWith('.md') && f !== 'pnpm-lock.yaml',
  );
  const rgChecks = await rgProbesForFiles(sourceFiles.slice(0, 5), 2);
  checks.push(...rgChecks.slice(0, 3));

  // Last resort: package-level test
  if (checks.length === 0) {
    const workspaces = affectedWorkspaces(changed_files);
    for (const ws of workspaces) {
      checks.push(`pnpm --filter ${ws} run test`);
    }
  }

  return checks;
}

// ---------------------------------------------------------------------------
// pass_to_pass — Fix #2: monorepo-aware with downstream deps
// ---------------------------------------------------------------------------

function generatePassToPass(candidate: CandidateCommit): string[] {
  const { changed_files } = candidate;
  const checks: string[] = [];

  const directWorkspaces = affectedWorkspaces(changed_files);
  const allWorkspaces = new Set(directWorkspaces);
  for (const ws of directWorkspaces) {
    const downstream = DOWNSTREAM_DEPS[ws];
    if (downstream) {
      for (const dep of downstream) allWorkspaces.add(dep);
    }
  }

  for (const ws of [...allWorkspaces].sort()) {
    checks.push(`pnpm --filter ${ws} run typecheck`);
  }

  const hasGoFiles = changed_files.some((f) => f.endsWith('.go'));
  if (hasGoFiles) {
    checks.push('pnpm run go:vet');
  }

  return checks;
}

// ---------------------------------------------------------------------------
// Effective family — derived from fail_to_pass workspaces
// ---------------------------------------------------------------------------

const WORKSPACE_TO_FAMILY: Record<string, string> = {
  '@moltnet/rest-api': 'rest-api-route',
  '@moltnet/mcp-server': 'mcp-tooling',
  '@moltnet/auth': 'auth-permissions',
  '@moltnet/database': 'service-logic',
  '@moltnet/diary-service': 'service-logic',
  '@moltnet/crypto-service': 'service-logic',
  '@moltnet/observability': 'observability',
  '@moltnet/api-client': 'codegen',
  '@themoltnet/sdk': 'sdk-package',
  '@themoltnet/cli': 'cli-package',
  '@themoltnet/legreffier-cli': 'cli-package',
  '@themoltnet/github-agent': 'github-agent-package',
};

/**
 * Compute effective family from the workspaces referenced in fail_to_pass.
 * If all verifiers target one family, that's the effective family.
 * Otherwise falls back to the declared family.
 */
function effectiveFamily(record: TaskRecord): string {
  const families = new Set<string>();
  for (const cmd of record.fail_to_pass) {
    const wsMatch = cmd.match(/--filter\s+(@[^\s]+)/);
    if (wsMatch) {
      const fam = WORKSPACE_TO_FAMILY[wsMatch[1]];
      if (fam) families.add(fam);
    }
    // rg commands target files — infer from path
    const rgMatch = cmd.match(/rg\s+-n\s+'[^']+'\s+(.+)$/);
    if (rgMatch) {
      const ws = fileToWorkspace(rgMatch[1]);
      if (ws) {
        const fam = WORKSPACE_TO_FAMILY[ws];
        if (fam) families.add(fam);
      }
    }
  }

  if (families.size === 1) return [...families][0];
  if (families.size === 0) return record.family;
  return record.family; // multiple — keep declared
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

function changedFilesOverlap(a: string[], b: string[]): number {
  const setB = new Set(b);
  const intersection = a.filter((f) => setB.has(f)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

function verifierShape(record: TaskRecord): string {
  return record.fail_to_pass
    .map((c) => {
      if (c.includes('vitest')) return 'vitest';
      if (c.startsWith('rg ')) return 'rg';
      return 'other';
    })
    .sort()
    .join(',');
}

/**
 * Normalize subject for dedup comparison. Strips conventional commit prefix,
 * lowercases, removes noise words, and collapses whitespace.
 */
function normalizeForDedup(taskId: string): string {
  // task_id already encodes family-slug-sha, extract the slug portion
  const parts = taskId.split('-');
  // Remove the last part (sha) and first part(s) (family)
  // family can be multi-segment like rest-api-route
  const sha = parts[parts.length - 1];
  const slug = taskId.replace(`-${sha}`, '');
  return slug;
}

/**
 * Check if two task slugs share a significant common prefix.
 * E.g. "sdk-package-extend-agent-facade-to-cover" and
 *      "sdk-package-add-coverage-for-new-agent-facade" share "sdk-package" + "agent-facade".
 */
function slugSimilarity(a: string, b: string): number {
  const wordsA = a.split('-');
  const wordsB = new Set(b.split('-'));
  const shared = wordsA.filter((w) => wordsB.has(w) && w.length > 2).length;
  const total = new Set([...wordsA, ...wordsB]).size;
  return total === 0 ? 0 : shared / total;
}

/**
 * Deduplicate near-identical tasks. Two tasks are duplicates if ANY of:
 * 1. >50% changed_files overlap (Jaccard) AND same verifier shape
 * 2. Same family AND >40% slug word overlap AND >30% file overlap
 *
 * When duplicates are found, keep the one with the most fail_to_pass checks.
 */
function deduplicateTasks(records: TaskRecord[]): TaskRecord[] {
  const kept: TaskRecord[] = [];

  for (const record of records) {
    const shape = verifierShape(record);
    const slug = normalizeForDedup(record.task_id);

    const dupIdx = kept.findIndex((existing) => {
      const fileOverlap = changedFilesOverlap(
        record.changed_files,
        existing.changed_files,
      );

      // Signal 1: high file overlap + same verifier shape
      if (verifierShape(existing) === shape && fileOverlap > 0.5) return true;

      // Signal 2: same family + similar subject + moderate file overlap
      if (
        record.family === existing.family &&
        slugSimilarity(slug, normalizeForDedup(existing.task_id)) > 0.4 &&
        fileOverlap > 0.3
      ) {
        return true;
      }

      return false;
    });

    if (dupIdx >= 0) {
      if (record.fail_to_pass.length > kept[dupIdx].fail_to_pass.length) {
        console.error(
          `[derive]   DEDUP replaced ${kept[dupIdx].task_id} with ${record.task_id}`,
        );
        kept[dupIdx] = record;
      } else {
        console.error(
          `[derive]   DEDUP dropped ${record.task_id} (dup of ${kept[dupIdx].task_id})`,
        );
      }
    } else {
      kept.push(record);
    }
  }

  return kept;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

type DeriveCandidate = CandidateCommit & { _group?: CommitGroup };

async function deriveOne(
  candidate: DeriveCandidate,
): Promise<TaskRecord | null> {
  const taskId = generateTaskId(candidate);
  const failToPass = await generateFailToPass(candidate);

  if (failToPass.length === 0) {
    console.error(
      `[derive]   SKIP ${taskId} — no meaningful fail_to_pass checks`,
    );
    return null;
  }

  const allRg = failToPass.every((c) => c.startsWith('rg '));
  if (allRg && failToPass.length < 2) {
    console.error(
      `[derive]   SKIP ${taskId} — only ${failToPass.length} rg probe (too weak)`,
    );
    return null;
  }

  const passToPass = generatePassToPass(candidate);
  const problemStatement = generateProblemStatement(candidate);

  return {
    task_id: taskId,
    fixture_ref: candidate.parent_sha,
    gold_fix_ref: candidate.commit_sha,
    source_commit_ref: candidate.commit_sha,
    source_commit_refs: candidate._group?.commit_shas,
    problem_statement: problemStatement,
    family: candidate.family,
    secondary_families: candidate.secondary_families,
    subsystems: candidate.subsystems,
    changed_files: candidate.changed_files,
    fail_to_pass: failToPass,
    pass_to_pass: passToPass,
    diary_entry_ids: candidate.diary_entry_ids,
    confidence: candidate.confidence,
  };
}

async function main() {
  // --- Load single-commit candidates ---
  let raw: string;
  try {
    raw = (await readFile(CANDIDATES_FILE, 'utf8')).trim();
  } catch {
    console.error('[derive] commits.jsonl not found — run harvest.ts first');
    process.exit(1);
  }

  if (!raw) {
    console.error('[derive] commits.jsonl is empty');
    process.exit(0);
  }

  const allCandidates: CandidateCommit[] = raw
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));

  // --- Load commit groups ---
  let groups: CommitGroup[] = [];
  try {
    const groupsRaw = (await readFile(GROUPS_FILE, 'utf8')).trim();
    if (groupsRaw) {
      groups = groupsRaw
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));
    }
  } catch {
    console.error('[derive] No commit-groups.jsonl found — skipping groups');
  }

  // --- Pool pruning for single commits ---
  const singleCandidates = allCandidates
    .filter((c) => c.task_shape !== 'low')
    .filter((c) => c.family !== 'mixed')
    .sort((a, b) => {
      if (a.has_diary_trailer && !b.has_diary_trailer) return -1;
      if (!a.has_diary_trailer && b.has_diary_trailer) return 1;
      if (a.task_shape === 'high' && b.task_shape !== 'high') return -1;
      if (a.task_shape !== 'high' && b.task_shape === 'high') return 1;
      const confOrder = { high: 0, medium: 1, low: 2 };
      return confOrder[a.confidence] - confOrder[b.confidence];
    })
    .slice(0, 150);

  // --- Pool pruning for groups ---
  // Exclude mixed groups; no task_shape filter (groups are inherently higher quality)
  const groupCandidates: DeriveCandidate[] = groups
    .filter((g) => g.family !== 'mixed')
    .map(groupToCandidate);

  // --- Dedup: skip single commits that are already part of a group ---
  const groupedShas = new Set(groups.flatMap((g) => g.commit_shas));
  const filteredSingles = singleCandidates.filter(
    (c) => !groupedShas.has(c.commit_sha),
  );

  const allDeriveInput: DeriveCandidate[] = [
    ...groupCandidates,
    ...filteredSingles,
  ];

  const lowSkipped = allCandidates.filter((c) => c.task_shape === 'low').length;
  const mixedSkipped = allCandidates.filter(
    (c) => c.task_shape !== 'low' && c.family === 'mixed',
  ).length;
  const singlesConsumedByGroups = singleCandidates.length - filteredSingles.length;
  console.error(
    `[derive] Singles: ${allCandidates.length} total, ${lowSkipped} low skipped, ${mixedSkipped} mixed skipped, ${filteredSingles.length} after pruning`,
  );
  console.error(
    `[derive] Groups: ${groups.length} total, ${groupCandidates.length} non-mixed, ${singlesConsumedByGroups} singles consumed by groups`,
  );
  console.error(
    `[derive] Total derive pool: ${allDeriveInput.length} (${groupCandidates.length} groups + ${filteredSingles.length} singles)`,
  );

  // Clear and recreate tasks directory
  await rm(TASKS_DIR, { recursive: true, force: true }).catch(() => {});
  await mkdir(TASKS_DIR, { recursive: true });

  let skipped = 0;
  const allRecords: TaskRecord[] = [];

  await mapConcurrent(allDeriveInput, 10, async (candidate) => {
    const record = await deriveOne(candidate);
    if (record) {
      allRecords.push(record);
    } else {
      skipped++;
    }
  });

  // Deduplicate: groups vs singles that overlap
  const deduped = deduplicateTasks(allRecords);
  const dupCount = allRecords.length - deduped.length;
  if (dupCount > 0) {
    console.error(`[derive] Deduplicated ${dupCount} near-identical tasks`);
  }

  // Write tasks
  const indexLines: string[] = [];
  for (const record of deduped) {
    const taskFile = join(TASKS_DIR, `${record.task_id}.json`);
    await writeFile(taskFile, JSON.stringify(record, null, 2) + '\n');
    indexLines.push(
      JSON.stringify({
        task_id: record.task_id,
        family: record.family,
        secondary_families: record.secondary_families,
        effective_family: effectiveFamily(record),
        fixture_ref: record.fixture_ref,
        gold_fix_ref: record.gold_fix_ref,
        confidence: record.confidence,
        is_group: !!record.source_commit_refs,
      }),
    );
  }

  await writeFile(INDEX_FILE, indexLines.join('\n') + '\n');

  const groupCount = deduped.filter((r) => r.source_commit_refs).length;
  const singleCount = deduped.length - groupCount;
  console.error(
    `[derive] Derived ${deduped.length} task records (${groupCount} groups + ${singleCount} singles), ${skipped} skipped, ${dupCount} deduped`,
  );
}

main().catch((err) => {
  console.error('[derive] Fatal:', err);
  process.exit(1);
});
