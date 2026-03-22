import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  computeCriteriaScore,
  type CriteriaItem,
  type CriteriaResult,
  evaluateCriteria,
  evaluateCriterion,
} from '../src/criteria-scorer.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

let testDir: string;

beforeEach(async () => {
  testDir = resolve(tmpdir(), `criteria-test-${Date.now()}`);
  await mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

// ── file_exists ──────────────────────────────────────────────────────────────

describe('file_exists', () => {
  it('passes when the file exists', async () => {
    // Arrange
    const filePath = resolve(testDir, 'src/index.ts');
    await mkdir(resolve(testDir, 'src'), { recursive: true });
    await writeFile(filePath, 'export const x = 1;', 'utf8');

    const item: CriteriaItem = {
      description: 'index.ts exists',
      check_type: 'file_exists',
      weight: 1,
      path: 'src/index.ts',
    };

    // Act
    const result = await evaluateCriterion(item, testDir);

    // Assert
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
    expect(result.evidence).toContain('exists');
  });

  it('fails when the file does not exist', async () => {
    // Arrange
    const item: CriteriaItem = {
      description: 'missing.ts exists',
      check_type: 'file_exists',
      weight: 1,
      path: 'src/missing.ts',
    };

    // Act
    const result = await evaluateCriterion(item, testDir);

    // Assert
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
    expect(result.evidence).toContain('not found');
  });

  it('fails when path is not specified', async () => {
    // Arrange
    const item: CriteriaItem = {
      description: 'no path',
      check_type: 'file_exists',
      weight: 1,
    };

    // Act
    const result = await evaluateCriterion(item, testDir);

    // Assert
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
  });
});

// ── pattern_present ──────────────────────────────────────────────────────────

describe('pattern_present', () => {
  it('passes when the pattern is found in the file', async () => {
    // Arrange
    const filePath = resolve(testDir, 'src/widget.ts');
    await mkdir(resolve(testDir, 'src'), { recursive: true });
    await writeFile(
      filePath,
      'export function createWidget() { return {}; }',
      'utf8',
    );

    const item: CriteriaItem = {
      description: 'createWidget function exists',
      check_type: 'pattern_present',
      weight: 0.5,
      path: 'src/widget.ts',
      pattern: 'createWidget',
    };

    // Act
    const result = await evaluateCriterion(item, testDir);

    // Assert
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
  });

  it('fails when the pattern is not found', async () => {
    // Arrange
    const filePath = resolve(testDir, 'src/widget.ts');
    await mkdir(resolve(testDir, 'src'), { recursive: true });
    await writeFile(filePath, 'export const x = 1;', 'utf8');

    const item: CriteriaItem = {
      description: 'createWidget function exists',
      check_type: 'pattern_present',
      weight: 0.5,
      path: 'src/widget.ts',
      pattern: 'createWidget',
    };

    // Act
    const result = await evaluateCriterion(item, testDir);

    // Assert
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
  });

  it('fails when pattern is missing', async () => {
    // Arrange
    const item: CriteriaItem = {
      description: 'no pattern',
      check_type: 'pattern_present',
      weight: 0.5,
      path: 'src/widget.ts',
    };

    // Act
    const result = await evaluateCriterion(item, testDir);

    // Assert
    expect(result.passed).toBe(false);
  });
});

// ── export_exists ────────────────────────────────────────────────────────────

describe('export_exists', () => {
  it('passes when the export is found in the file', async () => {
    // Arrange
    const filePath = resolve(testDir, 'src/index.ts');
    await mkdir(resolve(testDir, 'src'), { recursive: true });
    await writeFile(
      filePath,
      'export function doStuff() {}\nexport type Widget = { id: string };\n',
      'utf8',
    );

    const item: CriteriaItem = {
      description: 'Widget is exported',
      check_type: 'export_exists',
      weight: 0.3,
      path: 'src/index.ts',
      symbol: 'Widget',
    };

    // Act
    const result = await evaluateCriterion(item, testDir);

    // Assert
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
  });

  it('fails when the export is not found', async () => {
    // Arrange
    const filePath = resolve(testDir, 'src/index.ts');
    await mkdir(resolve(testDir, 'src'), { recursive: true });
    await writeFile(filePath, 'export function doStuff() {}\n', 'utf8');

    const item: CriteriaItem = {
      description: 'Widget is exported',
      check_type: 'export_exists',
      weight: 0.3,
      path: 'src/index.ts',
      symbol: 'Widget',
    };

    // Act
    const result = await evaluateCriterion(item, testDir);

    // Assert
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
  });

  it('fails when symbol is not specified', async () => {
    // Arrange
    const item: CriteriaItem = {
      description: 'missing symbol',
      check_type: 'export_exists',
      weight: 0.3,
      path: 'src/index.ts',
    };

    // Act
    const result = await evaluateCriterion(item, testDir);

    // Assert
    expect(result.passed).toBe(false);
  });
});

// ── test_passes ──────────────────────────────────────────────────────────────

describe('test_passes', () => {
  it('passes when the command succeeds', async () => {
    // Arrange
    const item: CriteriaItem = {
      description: 'echo test passes',
      check_type: 'test_passes',
      weight: 0.4,
      command: 'echo "ok"',
    };

    // Act
    const result = await evaluateCriterion(item, testDir);

    // Assert
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
    expect(result.evidence).toContain('ok');
  });

  it('fails when the command fails', async () => {
    // Arrange
    const item: CriteriaItem = {
      description: 'failing test',
      check_type: 'test_passes',
      weight: 0.4,
      command: 'exit 1',
    };

    // Act
    const result = await evaluateCriterion(item, testDir);

    // Assert
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
  });

  it('fails when command is not specified', async () => {
    // Arrange
    const item: CriteriaItem = {
      description: 'no command',
      check_type: 'test_passes',
      weight: 0.4,
    };

    // Act
    const result = await evaluateCriterion(item, testDir);

    // Assert
    expect(result.passed).toBe(false);
  });
});

// ── type_checks ──────────────────────────────────────────────────────────────

describe('type_checks', () => {
  it('delegates to runShellCommand with the command field', async () => {
    // Arrange
    const item: CriteriaItem = {
      description: 'typecheck passes',
      check_type: 'type_checks',
      weight: 0.3,
      command: 'echo "types ok"',
    };

    // Act
    const result = await evaluateCriterion(item, testDir);

    // Assert
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
  });

  it('defaults to pnpm run typecheck when no command given', async () => {
    // Arrange — no pnpm/typescript here so it will fail, but we verify
    // it attempts the default command.
    const item: CriteriaItem = {
      description: 'typecheck with default',
      check_type: 'type_checks',
      weight: 0.3,
    };

    // Act
    const result = await evaluateCriterion(item, testDir);

    // Assert
    expect(result.passed).toBe(false);
    expect(result.evidence).toBeTruthy();
  });
});

// ── behavioral ───────────────────────────────────────────────────────────────

describe('behavioral', () => {
  it('returns not-passed with LLM judge note', async () => {
    // Arrange
    const item: CriteriaItem = {
      description: 'user-facing error messages are helpful',
      check_type: 'behavioral',
      weight: 0.2,
    };

    // Act
    const result = await evaluateCriterion(item, testDir);

    // Assert
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
    expect(result.evidence).toContain('LLM judge');
  });
});

// ── computeCriteriaScore ─────────────────────────────────────────────────────

describe('computeCriteriaScore', () => {
  it('computes a weighted composite score', () => {
    // Arrange
    const results: CriteriaResult[] = [
      {
        item: {
          description: 'a',
          check_type: 'file_exists',
          weight: 0.6,
          path: 'a.ts',
        },
        passed: true,
        score: 1,
        evidence: 'exists',
      },
      {
        item: {
          description: 'b',
          check_type: 'file_exists',
          weight: 0.4,
          path: 'b.ts',
        },
        passed: false,
        score: 0,
        evidence: 'not found',
      },
    ];

    // Act
    const score = computeCriteriaScore(results);

    // Assert
    expect(score).toBeCloseTo(0.6, 5);
  });

  it('returns 0 when all criteria fail', () => {
    // Arrange
    const results: CriteriaResult[] = [
      {
        item: {
          description: 'a',
          check_type: 'file_exists',
          weight: 0.5,
          path: 'a.ts',
        },
        passed: false,
        score: 0,
        evidence: 'not found',
      },
      {
        item: {
          description: 'b',
          check_type: 'file_exists',
          weight: 0.5,
          path: 'b.ts',
        },
        passed: false,
        score: 0,
        evidence: 'not found',
      },
    ];

    // Act
    const score = computeCriteriaScore(results);

    // Assert
    expect(score).toBe(0);
  });

  it('returns 1 when all criteria pass', () => {
    // Arrange
    const results: CriteriaResult[] = [
      {
        item: {
          description: 'a',
          check_type: 'file_exists',
          weight: 0.7,
          path: 'a.ts',
        },
        passed: true,
        score: 1,
        evidence: 'exists',
      },
      {
        item: {
          description: 'b',
          check_type: 'file_exists',
          weight: 0.3,
          path: 'b.ts',
        },
        passed: true,
        score: 1,
        evidence: 'exists',
      },
    ];

    // Act
    const score = computeCriteriaScore(results);

    // Assert
    expect(score).toBeCloseTo(1, 5);
  });

  it('returns 0 for empty results', () => {
    expect(computeCriteriaScore([])).toBe(0);
  });
});

// ── evaluateCriteria ─────────────────────────────────────────────────────────

describe('evaluateCriteria', () => {
  it('evaluates all items and returns results', async () => {
    // Arrange
    const filePath = resolve(testDir, 'present.txt');
    await writeFile(filePath, 'hello', 'utf8');

    const items: CriteriaItem[] = [
      {
        description: 'present.txt exists',
        check_type: 'file_exists',
        weight: 0.5,
        path: 'present.txt',
      },
      {
        description: 'missing.txt exists',
        check_type: 'file_exists',
        weight: 0.5,
        path: 'missing.txt',
      },
    ];

    // Act
    const results = await evaluateCriteria(items, testDir);

    // Assert
    expect(results).toHaveLength(2);
    expect(results[0].passed).toBe(true);
    expect(results[1].passed).toBe(false);
  });
});
