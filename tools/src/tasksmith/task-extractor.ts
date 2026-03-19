import type { AxAIService } from '@ax-llm/ax';
import { ax } from '@ax-llm/ax';
import type { TasksmithTask } from '@moltnet/context-evals';

import { gitDiff, gitFileExistsAtRef, gitShowFileAtRef } from './gh-client.js';
import type { CriteriaItem, ExtractionResult, PrCandidate } from './types.js';

// ── Token budgeting ──

const CHARS_PER_TOKEN = 4;

export function truncateToTokenBudget(text: string, maxTokens: number): string {
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

// ── ax() program ──

const extractorProgram = ax(`
  pr_diff:string "unified diff of the PR",
  pr_body:string "PR title, body, and linked issue text",
  test_file_contents:string "test files labeled [NEW] (added by PR) or [MODIFIED] (existed before PR)",
  changed_files:string "list of all changed file paths"
  ->
  is_viable:boolean "true if this PR can produce a verifiable task",
  fail_to_pass:json "array of test commands that should fail on fixture and pass on fix",
  pass_to_pass:json "array of test commands that should pass on both fixture and fix",
  problem_statement:string "SWE-bench-style problem description without leaking the solution",
  family:class "bugfix, feature, refactor, test, infra",
  subsystems:json "array of affected workspace packages",
  criteria:json "array of behavioral success criteria checkable without the gold solution",
  skip_reason:string "reason if not viable, empty otherwise"
`);

// ── Seed instruction ──

const SEED_INSTRUCTION = `You are analyzing a merged GitHub PR to extract a SWE-bench-style benchmark task.

GOAL: Extract test commands that FAIL on the pre-PR code (fixture) and PASS on the post-PR code (gold fix).

TEST FILE LABELS:
- Test files are labeled [NEW] or [MODIFIED].
- [NEW] = file was ADDED by this PR. Full content is shown. The file does not exist on fixture.
- [MODIFIED] = file existed before the PR. Only the DIFF is shown — lines starting with + are additions.
- Unchanged test files are pass_to_pass candidates (regression guard).

TEST COMMANDS — CRITICAL:
You MUST target the SPECIFIC test file path in every command. NEVER use "pnpm --filter <pkg> test" or "pnpm --filter <pkg> run test" alone — running the full suite passes on fixture because existing tests still pass. Only the NEW or MODIFIED tests fail on fixture.

FORMAT: pnpm --filter <package> vitest run <relative-path-to-test-file>

For [NEW] files — target the exact file:
  pnpm --filter @moltnet/api-client vitest run __tests__/retry-fetch.test.ts

For [MODIFIED] files — target the file AND specific new test names:
  pnpm --filter @moltnet/rest-api vitest run __tests__/config.test.ts --testNamePattern "new test name"

The path must be relative to the package root (not the repo root). Look at the test file path in the diff, strip the package prefix.
Example: if changed_files has "libs/api-client/__tests__/retry-fetch.test.ts" and the package is @moltnet/api-client at libs/api-client/, the path is "__tests__/retry-fetch.test.ts".

fail_to_pass: commands targeting [NEW] test files or new test cases in [MODIFIED] files.
pass_to_pass: commands targeting unchanged test files as regression guards. Use the same format: pnpm --filter <package> vitest run <path>.
Prefer unit tests over e2e tests. E2e tests often pass on fixture because they test broad behavior.

PROBLEM STATEMENT:
- Describe the symptom or requirement, NOT the implementation
- Do not leak function names, variable names, or implementation details from the diff
- Write as if filing a bug report or feature request

VIABILITY:
- Mark NOT viable if: no testable behavioral change, pure config/CI, only affects external services
- Mark NOT viable if: tests only assert on snapshot/formatting changes
- Mark NOT viable if: no [NEW] test files and no new test cases in [MODIFIED] files

CRITERIA:
- 3-5 behavioral expectations an evaluator can check without the gold solution
- Use check_types: test_passes, file_exists, export_exists, pattern_present, type_checks, behavioral
- Weights should sum to approximately 1.0

FAMILIES: bugfix (fixes broken behavior), feature (adds new capability), refactor (changes structure, same behavior), test (adds test coverage), infra (build/CI/tooling)`;

// ── Command normalization ──

/**
 * Known package name aliases → correct pnpm filter names.
 * The LLM often confuses @moltnet/ (internal) with @themoltnet/ (published)
 * or omits the scope entirely.
 */
const PACKAGE_ALIASES: Record<string, string> = {
  // Wrong scope (LLM uses @themoltnet/ for internal packages)
  '@themoltnet/landing': '@moltnet/landing',
  '@themoltnet/rest-api': '@moltnet/rest-api',
  '@themoltnet/mcp-server': '@moltnet/mcp-server',
  '@themoltnet/api-client': '@moltnet/api-client',
  '@themoltnet/diary-service': '@moltnet/diary-service',
  '@themoltnet/database': '@moltnet/database',
  '@themoltnet/crypto-service': '@moltnet/crypto-service',
  '@themoltnet/observability': '@moltnet/observability',
  '@themoltnet/auth': '@moltnet/auth',
  // Wrong name for legreffier (dir name vs package name)
  '@moltnet/legreffier-cli': '@themoltnet/legreffier',
  '@themoltnet/legreffier-cli': '@themoltnet/legreffier',
  'legreffier-cli': '@themoltnet/legreffier',
  // Missing scope entirely
  'rest-api': '@moltnet/rest-api',
  'mcp-server': '@moltnet/mcp-server',
  landing: '@moltnet/landing',
  'api-client': '@moltnet/api-client',
  'crypto-service': '@moltnet/crypto-service',
  database: '@moltnet/database',
  'diary-service': '@moltnet/diary-service',
  observability: '@moltnet/observability',
  'context-evals': '@moltnet/context-evals',
  'context-distill': '@moltnet/context-distill',
};

/**
 * Fix common LLM mistakes in test commands:
 * - Replace jest flags (--testPathPattern) with `-- <pattern>` for vitest
 * - Fix `pnpm --filter <pkg> exec vitest` → `pnpm --filter <pkg> vitest`
 * - Remove `--reporter=verbose` (noise, sometimes breaks)
 * - Ensure `run` subcommand is present for vitest
 * - Strip repo-root path prefixes from test file paths
 * - Fix wrong package names in --filter (scope confusion, missing scope)
 * - Rewrite `vitest run` to `test` when packages don't have a vitest script
 * - Escape shell pipe `|` inside test name patterns
 * - Fix Go test commands missing `cd` prefix
 */
export function normalizeTestCommand(cmd: string): string {
  // Go test commands: ensure they run from the correct directory
  if (cmd.includes('go test')) {
    let goNormalized = cmd;

    // If command doesn't already have `cd`, prefix with `cd cmd/moltnet &&`
    if (!goNormalized.startsWith('cd ')) {
      goNormalized = `cd cmd/moltnet && ${goNormalized}`;
    }

    // Avoid `cd cmd/moltnet && go test ./cmd/moltnet/...`, which resolves to
    // `cmd/moltnet/cmd/moltnet/...` and fails on both fixture and gold.
    goNormalized = goNormalized.replace(
      /go test \.\/cmd\/moltnet\/\.\.\./g,
      'go test ./...',
    );
    goNormalized = goNormalized.replace(
      /go test \.\/cmd\/moltnet\/(?=\s|$)/g,
      'go test .',
    );

    return goNormalized;
  }

  let normalized = cmd;

  // Fix: wrong package names in --filter
  const filterMatch = normalized.match(/pnpm --filter (\S+)/);
  if (filterMatch) {
    const pkg = filterMatch[1];
    const corrected = PACKAGE_ALIASES[pkg];
    if (corrected) {
      normalized = normalized.replace(
        `pnpm --filter ${pkg}`,
        `pnpm --filter ${corrected}`,
      );
    }
  }

  // Fix: --testPathPattern is jest, not vitest. Convert to `-- <pattern>`.
  const testPathMatch = normalized.match(/--testPathPattern[= ]+'?([^' ]+)'?/);
  if (testPathMatch) {
    normalized = normalized.replace(/--testPathPattern[= ]+'?[^' ]+'?/, '');
    const pattern = testPathMatch[1];
    // If there's already a `--`, append after it; otherwise add `-- <pattern>`
    if (normalized.includes(' -- ')) {
      normalized = normalized.trimEnd() + ' ' + pattern;
    } else {
      normalized = normalized.trimEnd() + ' -- ' + pattern;
    }
  }

  // Fix: `exec vitest run` → `vitest run` (exec is unnecessary with pnpm filter)
  normalized = normalized.replace(
    /(\bpnpm --filter [^ ]+) exec vitest/,
    '$1 vitest',
  );

  // Fix: `pnpm --filter <pkg> vitest run ...` → `pnpm --filter <pkg> test ...`
  // Packages have a `test` script (wrapping vitest), not a `vitest` script.
  normalized = normalized.replace(
    /(\bpnpm --filter [^ ]+) vitest run\b/,
    '$1 test',
  );

  // Fix: `pnpm --filter <pkg> test -- <args>` → `pnpm --filter <pkg> test <args>`
  // The extra `--` often causes vitest to ignore file targeting and run broadly.
  normalized = normalized.replace(
    /(\bpnpm --filter [^ ]+(?: run)? test)\s+--\s+/,
    '$1 ',
  );

  // Fix: `test --run <file>` is interpreted as a name filter, not a file path.
  // Rewrite to a positional file argument when the RHS looks like a test path.
  normalized = normalized.replace(
    /(\bpnpm --filter [^ ]+(?: run)? test)\s+--run\s+((?:__tests__|src|test)\/\S+)/,
    '$1 $2',
  );

  // Remove --reporter=verbose (sometimes causes issues, not needed for pass/fail)
  normalized = normalized.replace(/\s*--reporter[= ]?verbose\s*/g, ' ');

  // Fix: unescaped shell pipe `|` in test name patterns.
  // e.g. `run test pack-cid|provenance` → shell interprets `|` as pipe.
  // Wrap the pattern argument in quotes if it contains `|`.
  normalized = normalized.replace(
    /(\brun test(?:\s+--\s+)?)\s+(\S*\|[^\s'"]+)/,
    (_, prefix, pattern) => `${prefix} '${pattern}'`,
  );

  // Strip repo-root path prefixes from test file paths.
  // e.g. `libs/auth/__tests__/foo.test.ts` → `__tests__/foo.test.ts`
  // `apps/rest-api/__tests__/foo.test.ts` → `__tests__/foo.test.ts`
  normalized = normalized.replace(
    /\b(?:libs|apps|packages)\/[^/ ]+\/((?:__tests__|src|test)\/[^ ]+)/g,
    '$1',
  );

  // Collapse multiple spaces
  normalized = normalized.replace(/\s{2,}/g, ' ').trim();

  return normalized;
}

function getPackageRoot(filePath: string): string | null {
  const parts = filePath.split('/');
  if (parts.length < 2) return null;
  if (!['apps', 'libs', 'packages'].includes(parts[0])) return null;
  return `${parts[0]}/${parts[1]}`;
}

function stripPackageRoot(filePath: string): string {
  const root = getPackageRoot(filePath);
  return root ? filePath.slice(root.length + 1) : filePath;
}

function extractChangedFileArg(command: string): string | null {
  const pathMatch = command.match(/\b((?:__tests__|src|test)\/[^\s'"]+)/);
  if (pathMatch) return pathMatch[1];

  const basenameMatch = command.match(
    /\b([A-Za-z0-9._-]+\.test\.[jt]sx?|[A-Za-z0-9._-]+)\b$/,
  );
  if (!basenameMatch) return null;

  const token = basenameMatch[1];
  if (token === 'test') return null;
  return token;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function extractTouchedTestNames(diff: string): string[] {
  const names = new Set<string>();
  let currentTestName: string | null = null;

  const testDeclPattern =
    /(?:^|[=(,\s])(?:it|test)(?:\.(?:only|skip|todo|concurrent|fails|each))?\s*\(\s*(['"`])(.+?)\1/;

  for (const rawLine of diff.split('\n')) {
    if (rawLine.startsWith('@@')) {
      currentTestName = null;
      continue;
    }
    if (
      rawLine.startsWith('diff ') ||
      rawLine.startsWith('index ') ||
      rawLine.startsWith('--- ') ||
      rawLine.startsWith('+++ ')
    ) {
      continue;
    }

    const line = rawLine.replace(/^[ +-]/, '');
    const declMatch = line.match(testDeclPattern);
    if (declMatch) {
      currentTestName = declMatch[2];
      if (rawLine.startsWith('+')) names.add(currentTestName);
      continue;
    }

    if (rawLine.startsWith('+') && currentTestName) {
      names.add(currentTestName);
    }
  }

  return [...names];
}

async function repairCommandForCandidate(
  cmd: string,
  candidate: PrCandidate,
): Promise<string> {
  let repaired = normalizeTestCommand(cmd);

  if (repaired.includes('go test')) {
    return repaired;
  }

  const filterMatch = repaired.match(/pnpm --filter (\S+)/);
  if (!filterMatch) return repaired;
  const pkg = filterMatch[1];

  const packageTests = candidate.changedTestFiles
    .filter((file) => {
      const root = getPackageRoot(file);
      if (!root) return false;

      if (root.startsWith('apps/')) return pkg === `@moltnet/${root.slice(5)}`;
      if (root.startsWith('libs/')) {
        const name = root.slice(5);
        return (
          pkg === `@moltnet/${name}` ||
          pkg === `@themoltnet/${name}` ||
          (name === 'sdk' && pkg === '@themoltnet/sdk') ||
          (name === 'design-system' && pkg === '@themoltnet/design-system')
        );
      }
      if (root === 'packages/legreffier-cli')
        return pkg === '@themoltnet/legreffier';
      if (root === 'packages/github-agent')
        return pkg === '@themoltnet/github-agent';
      if (root === 'packages/cli') return pkg === '@themoltnet/cli';
      return false;
    })
    .map((file) => ({
      fullPath: file,
      relativePath: stripPackageRoot(file),
      basename: file.split('/').at(-1) ?? file,
    }));

  if (packageTests.length === 0) return repaired;

  const currentTarget = extractChangedFileArg(repaired);
  const matchedTarget =
    (currentTarget
      ? packageTests.find(
          (file) =>
            file.relativePath === currentTarget ||
            file.basename === currentTarget ||
            file.basename.includes(currentTarget) ||
            file.relativePath.endsWith(currentTarget),
        )
      : undefined) ?? (packageTests.length === 1 ? packageTests[0] : undefined);

  if (matchedTarget) {
    const hasExactPath = repaired.includes(matchedTarget.relativePath);
    const hasAnyPath = /\b(?:__tests__|src|test)\//.test(repaired);

    if (!hasExactPath) {
      if (hasAnyPath) {
        repaired = repaired.replace(
          /\b(?:__tests__|src|test)\/[^\s'"]+/,
          matchedTarget.relativePath,
        );
      } else {
        repaired = repaired.replace(
          /(\bpnpm --filter \S+(?: run)? test\b)/,
          `$1 ${matchedTarget.relativePath}`,
        );
      }
    }

    // If the original command ended with a basename token like
    // `diary-service.test` or `setup`, drop it once we have the exact file path.
    if (
      currentTarget &&
      currentTarget !== matchedTarget.relativePath &&
      currentTarget !== matchedTarget.basename
    ) {
      repaired = repaired.replace(
        new RegExp(`\\s+${escapeRegExp(currentTarget)}(?=\\s|$)`),
        '',
      );
    }

    const basenameWithoutExt = matchedTarget.basename.replace(
      /\.(test|spec)\.[^.]+$/,
      '',
    );
    if (currentTarget === basenameWithoutExt) {
      repaired = repaired.replace(
        new RegExp(`\\s+${escapeRegExp(currentTarget)}(?=\\s|$)`),
        '',
      );
    }

    if (!/(\s-t\s|--testNamePattern)/.test(repaired)) {
      const existsOnFixture = await gitFileExistsAtRef(
        candidate.fixtureRef,
        matchedTarget.fullPath,
      );
      if (existsOnFixture) {
        const diff = await gitDiff(
          candidate.fixtureRef,
          candidate.goldFixRef,
          matchedTarget.fullPath,
        );
        const newTestNames = extractTouchedTestNames(diff);
        if (newTestNames.length > 0) {
          repaired += ` -t "${newTestNames.join('|')}"`;
        }
      }
    }
  }

  return normalizeTestCommand(repaired);
}

export async function repairCommandsForCandidate(
  commands: string[],
  candidate: PrCandidate,
): Promise<string[]> {
  const repaired: string[] = [];
  for (const command of commands) {
    repaired.push(await repairCommandForCandidate(command, candidate));
  }
  return repaired;
}

// ── Assembly ──

export function assembleTasksmithTask(
  candidate: PrCandidate,
  extraction: ExtractionResult,
): TasksmithTask {
  return {
    task_id: `pr-${candidate.number}`,
    fixture_ref: candidate.fixtureRef,
    gold_fix_ref: candidate.goldFixRef,
    source_commit_ref: candidate.goldFixRef,
    problem_statement: extraction.problemStatement,
    family: extraction.family,
    subsystems: extraction.subsystems,
    changed_files: candidate.changedFiles,
    fail_to_pass: extraction.failToPass.map(normalizeTestCommand),
    pass_to_pass: extraction.passToPass.map(normalizeTestCommand),
    confidence: 'high',
  };
}

// ── Context building ──

/**
 * Build test file context with NEW/MODIFIED classification.
 * - [NEW] files: show full content from gold ref (the whole file is new)
 * - [MODIFIED] files: show only the diff (added lines = new test cases)
 */
async function readTestFileContents(
  fixtureRef: string,
  goldRef: string,
  testFiles: string[],
  maxTokens: number,
): Promise<string> {
  const parts: string[] = [];
  let totalChars = 0;
  const maxChars = maxTokens * CHARS_PER_TOKEN;

  for (const file of testFiles) {
    if (totalChars >= maxChars) break;

    const existsOnFixture = await gitFileExistsAtRef(fixtureRef, file);

    let content: string;
    if (existsOnFixture) {
      // MODIFIED: show the diff so the LLM sees which test cases are new
      const fileDiff = await gitDiff(fixtureRef, goldRef, file);
      if (!fileDiff) continue;
      content = `--- ${file} [MODIFIED — diff shows added/changed tests] ---\n${fileDiff}`;
    } else {
      // NEW: show full file content from gold ref
      const fullContent = await gitShowFileAtRef(goldRef, file);
      if (!fullContent) continue;
      content = `--- ${file} [NEW — entire file added by this PR] ---\n${fullContent}`;
    }

    const truncated = content.slice(0, maxChars - totalChars);
    parts.push(truncated);
    totalChars += truncated.length;
  }
  const result = parts.join('\n\n');
  return result || '(no test file context available)';
}

function buildPrBody(candidate: PrCandidate): string {
  const parts = [`# ${candidate.title}`, candidate.body];
  if (candidate.linkedIssueBody) {
    parts.push(`\n## Linked Issue\n${candidate.linkedIssueBody}`);
  }
  return truncateToTokenBudget(parts.join('\n\n'), 2000);
}

// ── Extraction ──

export async function extractTask(
  candidate: PrCandidate,
  ai: AxAIService,
  _repoRoot: string,
  instruction?: string,
): Promise<
  { task: TasksmithTask; criteria: CriteriaItem[] } | { skipReason: string }
> {
  const diff = truncateToTokenBudget(
    await gitDiff(candidate.fixtureRef, candidate.goldFixRef),
    8000,
  );
  const prBody = buildPrBody(candidate);
  const testContents = await readTestFileContents(
    candidate.fixtureRef,
    candidate.goldFixRef,
    candidate.changedTestFiles,
    4000,
  );

  extractorProgram.setInstruction(instruction ?? SEED_INSTRUCTION);

  const result = await extractorProgram.forward(ai, {
    pr_diff: diff,
    pr_body: prBody,
    test_file_contents: testContents,
    changed_files: candidate.changedFiles.join('\n'),
  });

  if (!result.is_viable) {
    return { skipReason: (result.skip_reason as string) || 'not viable' };
  }

  const extraction: ExtractionResult = {
    isViable: true,
    failToPass: result.fail_to_pass as string[],
    passToPass: result.pass_to_pass as string[],
    problemStatement: result.problem_statement as string,
    family: result.family as ExtractionResult['family'],
    subsystems: result.subsystems as string[],
    criteria: result.criteria as CriteriaItem[],
  };

  const task = assembleTasksmithTask(candidate, extraction);
  task.fail_to_pass = await repairCommandsForCandidate(
    task.fail_to_pass,
    candidate,
  );
  task.pass_to_pass = await repairCommandsForCandidate(
    task.pass_to_pass,
    candidate,
  );

  return {
    task,
    criteria: extraction.criteria,
  };
}

export { SEED_INSTRUCTION };
