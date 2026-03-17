import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { AxAIService } from '@ax-llm/ax';
import { ax } from '@ax-llm/ax';
import type { TasksmithTask } from '@moltnet/context-evals';

import { gitDiff } from './gh-client.js';
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
  test_file_contents:string "contents of changed test files",
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

const SEED_INSTRUCTION = `You are analyzing a merged GitHub PR to extract a benchmark task.

GOAL: Determine if this PR represents a testable behavioral change and extract structured task fields.

TEST COMMANDS:
- Use exact pnpm --filter <package> vitest run <path> commands
- Add --testNamePattern "<pattern>" when only specific tests are relevant
- fail_to_pass: tests that should FAIL on the pre-PR state and PASS on the post-PR state
- pass_to_pass: existing tests that should PASS on both states (regression safety net)

PROBLEM STATEMENT:
- Describe the symptom or requirement, NOT the implementation
- Do not leak function names, variable names, or implementation details from the diff
- Write as if filing a bug report or feature request

VIABILITY:
- Mark NOT viable if: no testable behavioral change, pure config/CI, only affects external services
- Mark NOT viable if: tests only assert on snapshot/formatting changes

CRITERIA:
- 3-5 behavioral expectations an evaluator can check without the gold solution
- Use check_types: test_passes, file_exists, export_exists, pattern_present, type_checks, behavioral
- Weights should sum to approximately 1.0

FAMILIES: bugfix (fixes broken behavior), feature (adds new capability), refactor (changes structure, same behavior), test (adds test coverage), infra (build/CI/tooling)`;

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
    fail_to_pass: extraction.failToPass,
    pass_to_pass: extraction.passToPass,
    confidence: 'high',
  };
}

// ── Context building ──

async function readTestFileContents(
  repoRoot: string,
  testFiles: string[],
  maxTokens: number,
): Promise<string> {
  const parts: string[] = [];
  let totalChars = 0;
  const maxChars = maxTokens * CHARS_PER_TOKEN;

  for (const file of testFiles) {
    if (totalChars >= maxChars) break;
    try {
      const content = await readFile(resolve(repoRoot, file), 'utf8');
      const truncated = content.slice(0, maxChars - totalChars);
      parts.push(`--- ${file} ---\n${truncated}`);
      totalChars += truncated.length;
    } catch {
      // file may not exist at HEAD if PR was from a different branch
    }
  }
  return parts.join('\n\n');
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
  repoRoot: string,
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
    repoRoot,
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

  return {
    task: assembleTasksmithTask(candidate, extraction),
    criteria: extraction.criteria,
  };
}

export { SEED_INSTRUCTION };
