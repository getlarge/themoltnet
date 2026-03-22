/**
 * criteria-scorer.ts — Machine-checkable criteria evaluation
 *
 * Evaluates structured criteria items (file_exists, pattern_present,
 * export_exists, test_passes, type_checks, behavioral) against a working
 * directory and produces weighted composite scores.
 */

import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { type Static, Type } from '@sinclair/typebox';

import { runShellCommand } from './process.js';

// ── Schema ───────────────────────────────────────────────────────────────────

export const CriteriaItemSchema = Type.Object({
  description: Type.String(),
  check_type: Type.Union([
    Type.Literal('test_passes'),
    Type.Literal('file_exists'),
    Type.Literal('export_exists'),
    Type.Literal('pattern_present'),
    Type.Literal('type_checks'),
    Type.Literal('behavioral'),
  ]),
  weight: Type.Number({ minimum: 0, maximum: 1 }),
  // Type-specific optional fields
  module: Type.Optional(Type.String()),
  symbol: Type.Optional(Type.String()),
  path: Type.Optional(Type.String()),
  pattern: Type.Optional(Type.String()),
  /** Shell command for test_passes / type_checks check types. */
  command: Type.Optional(Type.String()),
});

export type CriteriaItem = Static<typeof CriteriaItemSchema>;

// ── Result ───────────────────────────────────────────────────────────────────

export interface CriteriaResult {
  item: CriteriaItem;
  passed: boolean;
  score: number;
  evidence: string;
}

// ── Evaluators ───────────────────────────────────────────────────────────────

function fail(item: CriteriaItem, evidence: string): CriteriaResult {
  return { item, passed: false, score: 0, evidence };
}

function pass(item: CriteriaItem, evidence: string): CriteriaResult {
  return { item, passed: true, score: 1, evidence };
}

async function evaluateFileExists(
  item: CriteriaItem,
  cwd: string,
): Promise<CriteriaResult> {
  if (!item.path) {
    return fail(item, 'path not specified');
  }
  const fullPath = resolve(cwd, item.path);
  try {
    await access(fullPath);
    return pass(item, `${item.path} exists`);
  } catch {
    return fail(item, `${item.path} not found`);
  }
}

async function evaluatePatternPresent(
  item: CriteriaItem,
  cwd: string,
): Promise<CriteriaResult> {
  if (!item.pattern) {
    return fail(item, 'pattern not specified');
  }
  if (!item.path) {
    return fail(item, 'path not specified');
  }
  const fullPath = resolve(cwd, item.path);
  try {
    const content = await readFile(fullPath, 'utf8');
    if (content.includes(item.pattern)) {
      return pass(item, `pattern "${item.pattern}" found in ${item.path}`);
    }
    return fail(item, `pattern "${item.pattern}" not found in ${item.path}`);
  } catch {
    return fail(item, `${item.path} not found`);
  }
}

async function evaluateExportExists(
  item: CriteriaItem,
  cwd: string,
): Promise<CriteriaResult> {
  if (!item.symbol) {
    return fail(item, 'symbol not specified');
  }
  if (!item.path) {
    return fail(item, 'path not specified');
  }
  const fullPath = resolve(cwd, item.path);
  try {
    const content = await readFile(fullPath, 'utf8');
    // Match export declarations containing the symbol name.
    // Covers: export function Foo, export const Foo, export type Foo,
    // export interface Foo, export { Foo }, export { X as Foo }
    const exportPattern = new RegExp(
      `export\\s+(?:(?:function|const|let|var|type|interface|class|enum|abstract\\s+class)\\s+${escapeRegExp(item.symbol)}\\b|\\{[^}]*\\b${escapeRegExp(item.symbol)}\\b[^}]*\\})`,
    );
    if (exportPattern.test(content)) {
      return pass(item, `export "${item.symbol}" found in ${item.path}`);
    }
    return fail(item, `export "${item.symbol}" not found in ${item.path}`);
  } catch {
    return fail(item, `${item.path} not found`);
  }
}

async function evaluateTestPasses(
  item: CriteriaItem,
  cwd: string,
): Promise<CriteriaResult> {
  if (!item.command) {
    return fail(item, 'command not specified');
  }
  const result = await runShellCommand(item.command, cwd);
  if (result.passed) {
    return pass(item, truncateEvidence(result.output));
  }
  return fail(item, truncateEvidence(result.output));
}

async function evaluateTypeChecks(
  item: CriteriaItem,
  cwd: string,
): Promise<CriteriaResult> {
  const cmd = item.command ?? 'pnpm run typecheck';
  const result = await runShellCommand(cmd, cwd);
  if (result.passed) {
    return pass(item, truncateEvidence(result.output));
  }
  return fail(item, truncateEvidence(result.output));
}

function evaluateBehavioral(item: CriteriaItem): CriteriaResult {
  return fail(item, 'requires LLM judge — cannot be machine-checked');
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function truncateEvidence(output: string, maxLen = 500): string {
  if (!output) return '(no output)';
  return output.length > maxLen ? output.slice(0, maxLen) + '...' : output;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Evaluate a single criterion against a working directory.
 */
export async function evaluateCriterion(
  item: CriteriaItem,
  cwd: string,
): Promise<CriteriaResult> {
  switch (item.check_type) {
    case 'file_exists':
      return evaluateFileExists(item, cwd);
    case 'pattern_present':
      return evaluatePatternPresent(item, cwd);
    case 'export_exists':
      return evaluateExportExists(item, cwd);
    case 'test_passes':
      return evaluateTestPasses(item, cwd);
    case 'type_checks':
      return evaluateTypeChecks(item, cwd);
    case 'behavioral':
      return evaluateBehavioral(item);
  }
}

/**
 * Evaluate all criteria items against a working directory.
 */
export async function evaluateCriteria(
  items: CriteriaItem[],
  cwd: string,
): Promise<CriteriaResult[]> {
  const results: CriteriaResult[] = [];
  for (const item of items) {
    results.push(await evaluateCriterion(item, cwd));
  }
  return results;
}

/**
 * Compute a weighted composite score from criteria results.
 * Returns a value between 0 and 1.
 */
export function computeCriteriaScore(results: CriteriaResult[]): number {
  if (results.length === 0) return 0;
  const totalWeight = results.reduce((sum, r) => sum + r.item.weight, 0);
  if (totalWeight === 0) return 0;
  const weightedSum = results.reduce(
    (sum, r) => sum + r.score * r.item.weight,
    0,
  );
  return weightedSum / totalWeight;
}
