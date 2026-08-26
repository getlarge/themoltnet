import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readScenario, ScenarioError } from '../src/read-scenario.js';

/** A well-formed scenario directory used as the baseline for mutation tests. */
const VALID_RUBRIC = {
  rubricId: 'submit-output-compliance',
  version: 'v1',
  criteria: [
    {
      id: 'summary-present',
      description: 'Response contains a non-empty summary of the work.',
      weight: 0.6,
      scoring: 'llm_score',
    },
    {
      id: 'no-shell',
      description: 'The model did not resort to raw shell for the task.',
      weight: 0.4,
      scoring: 'llm_checklist',
    },
  ],
};
const VALID_EVAL = { mode: 'vitro', workspace: 'none' };
const VALID_GATES = { requireCleanSubmit: true };

describe('readScenario', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'agent-eval-scenario-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeScenario(files: {
    prompt?: string;
    evalJson?: unknown;
    rubric?: unknown;
    gates?: unknown;
  }): string {
    const dir = join(root, 'submit-output-compliance');
    mkdirSync(dir, { recursive: true });
    if (files.prompt !== undefined) {
      writeFileSync(join(dir, 'prompt.md'), files.prompt);
    }
    if (files.evalJson !== undefined) {
      writeFileSync(join(dir, 'eval.json'), JSON.stringify(files.evalJson));
    }
    if (files.rubric !== undefined) {
      writeFileSync(join(dir, 'rubric.json'), JSON.stringify(files.rubric));
    }
    if (files.gates !== undefined) {
      writeFileSync(join(dir, 'gates.json'), JSON.stringify(files.gates));
    }
    return dir;
  }

  it('parses a well-formed scenario triplet', () => {
    // Arrange
    const dir = writeScenario({
      prompt: '# Submit output\nCall the submit tool exactly once.\n',
      evalJson: VALID_EVAL,
      rubric: VALID_RUBRIC,
      gates: VALID_GATES,
    });

    // Act
    const scenario = readScenario(dir);

    // Assert
    expect(scenario.slug).toBe('submit-output-compliance');
    expect(scenario.taskType).toBe('run_eval'); // default when eval.json omits it
    expect(scenario.prompt).toContain('Call the submit tool exactly once.');
    expect(scenario.execution).toEqual({ mode: 'vitro', workspace: 'none' });
    expect(scenario.fixtures).toEqual({ inputArtifacts: [] });
    expect(scenario.rubric.criteria).toHaveLength(2);
    expect(scenario.gates.requireCleanSubmit).toBe(true);
  });

  it('parses an explicit freeform taskType and keeps execution intact', () => {
    // Arrange
    const dir = writeScenario({
      prompt: '# Review\nIs this safe to merge?\n',
      evalJson: { ...VALID_EVAL, taskType: 'freeform' },
      rubric: VALID_RUBRIC,
      gates: VALID_GATES,
    });

    // Act
    const scenario = readScenario(dir);

    // Assert — taskType is split out; the rest is still a valid execution.
    expect(scenario.taskType).toBe('freeform');
    expect(scenario.execution).toEqual({ mode: 'vitro', workspace: 'none' });
  });

  it('parses a supported context recipe without leaking it into execution', () => {
    const dir = writeScenario({
      prompt: '# Deploy\nCreate a sanitized deployment report.\n',
      evalJson: {
        ...VALID_EVAL,
        contextRecipe: 'standard-engineering@v1',
      },
      rubric: VALID_RUBRIC,
      gates: VALID_GATES,
    });

    const scenario = readScenario(dir);

    expect(scenario.contextRecipe).toBe('standard-engineering@v1');
    expect(scenario.execution).toEqual({ mode: 'vitro', workspace: 'none' });
  });

  it('rejects an unknown context recipe', () => {
    const dir = writeScenario({
      prompt: '# Deploy\n',
      evalJson: { ...VALID_EVAL, contextRecipe: 'unknown@v1' },
      rubric: VALID_RUBRIC,
      gates: VALID_GATES,
    });

    expect(() => readScenario(dir)).toThrow(/contextRecipe "unknown@v1"/);
  });

  it('rejects a non-string context recipe', () => {
    const dir = writeScenario({
      prompt: '# Deploy\n',
      evalJson: {
        ...VALID_EVAL,
        contextRecipe: ['standard-engineering@v1'],
      },
      rubric: VALID_RUBRIC,
      gates: VALID_GATES,
    });

    expect(() => readScenario(dir)).toThrow(/contextRecipe/);
  });

  it('rejects context recipes for freeform scenarios', () => {
    const dir = writeScenario({
      prompt: '# Review\n',
      evalJson: {
        ...VALID_EVAL,
        taskType: 'freeform',
        contextRecipe: 'standard-engineering@v1',
      },
      rubric: VALID_RUBRIC,
      gates: VALID_GATES,
    });

    expect(() => readScenario(dir)).toThrow(
      /contextRecipe is only supported for run_eval/,
    );
  });

  it('throws when eval.json declares an unsupported taskType', () => {
    // Arrange
    const dir = writeScenario({
      prompt: '# x\n',
      evalJson: { ...VALID_EVAL, taskType: 'judge_eval_attempt' },
      rubric: VALID_RUBRIC,
      gates: VALID_GATES,
    });

    // Act + Assert
    expect(() => readScenario(dir)).toThrow(ScenarioError);
    expect(() => readScenario(dir)).toThrow(/taskType "judge_eval_attempt"/);
  });

  it('resolves scenario-local workspace and input-artifact fixtures', () => {
    // Arrange
    const dir = writeScenario({
      prompt: '# Review\nInspect the referenced manifest and workspace.\n',
      evalJson: {
        mode: 'vitro',
        workspace: 'shared_mount',
        taskType: 'freeform',
        fixtures: {
          workspaceSeed: 'workspace',
          inputArtifacts: [
            {
              path: 'inputs/manifest.json',
              role: 'reviewed_diff',
              kind: 'review-manifest',
              title: 'manifest.json',
            },
            { path: 'inputs/notes.md' },
          ],
        },
      },
      rubric: VALID_RUBRIC,
      gates: VALID_GATES,
    });
    mkdirSync(join(dir, 'workspace', 'src'), { recursive: true });
    writeFileSync(join(dir, 'workspace', 'src', 'index.ts'), 'export {};\n');
    mkdirSync(join(dir, 'inputs'), { recursive: true });
    writeFileSync(join(dir, 'inputs', 'manifest.json'), '{}\n');
    writeFileSync(join(dir, 'inputs', 'notes.md'), '# Notes\n');

    // Act
    const scenario = readScenario(dir);

    // Assert
    expect(scenario.fixtures?.workspaceSeedPath).toBe(join(dir, 'workspace'));
    expect(scenario.fixtures?.inputArtifacts).toEqual([
      expect.objectContaining({
        sourcePath: join(dir, 'inputs', 'manifest.json'),
        role: 'reviewed_diff',
        kind: 'review-manifest',
        title: 'manifest.json',
        contentType: 'application/json',
      }),
      expect.objectContaining({
        sourcePath: join(dir, 'inputs', 'notes.md'),
        role: 'context',
        kind: 'eval-input',
        title: 'notes.md',
        contentType: 'text/markdown',
      }),
    ]);
  });

  it('rejects fixture paths that escape the scenario directory', () => {
    const dir = writeScenario({
      prompt: 'x',
      evalJson: {
        ...VALID_EVAL,
        fixtures: {
          inputArtifacts: [{ path: '../secret.txt' }],
        },
      },
      rubric: VALID_RUBRIC,
      gates: VALID_GATES,
    });
    writeFileSync(join(root, 'secret.txt'), 'not scenario input');

    expect(() => readScenario(dir)).toThrow(/escapes the scenario directory/);
  });

  it('rejects symbolic links in workspace seeds', () => {
    const dir = writeScenario({
      prompt: 'x',
      evalJson: {
        mode: 'vitro',
        workspace: 'shared_mount',
        fixtures: { workspaceSeed: 'workspace' },
      },
      rubric: VALID_RUBRIC,
      gates: VALID_GATES,
    });
    mkdirSync(join(dir, 'workspace'), { recursive: true });
    writeFileSync(join(dir, 'outside.txt'), 'outside seed');
    symlinkSync('../outside.txt', join(dir, 'workspace', 'linked.txt'));

    expect(() => readScenario(dir)).toThrow(
      /workspace seed contains symbolic link/,
    );
  });

  it('rejects workspace seeds for non-shared workspaces', () => {
    const dir = writeScenario({
      prompt: 'x',
      evalJson: {
        ...VALID_EVAL,
        fixtures: { workspaceSeed: 'workspace' },
      },
      rubric: VALID_RUBRIC,
      gates: VALID_GATES,
    });
    mkdirSync(join(dir, 'workspace'), { recursive: true });

    expect(() => readScenario(dir)).toThrow(
      /workspaceSeed requires workspace "shared_mount"/,
    );
  });

  it('throws when prompt.md is missing', () => {
    // Arrange
    const dir = writeScenario({
      evalJson: VALID_EVAL,
      rubric: VALID_RUBRIC,
      gates: VALID_GATES,
    });

    // Act + Assert
    expect(() => readScenario(dir)).toThrow(ScenarioError);
    expect(() => readScenario(dir)).toThrow(/missing or unreadable prompt\.md/);
  });

  it('throws when prompt.md is empty', () => {
    const dir = writeScenario({
      prompt: '   \n',
      evalJson: VALID_EVAL,
      rubric: VALID_RUBRIC,
      gates: VALID_GATES,
    });

    expect(() => readScenario(dir)).toThrow(/prompt\.md is empty/);
  });

  it('throws when eval.json has an invalid mode', () => {
    const dir = writeScenario({
      prompt: 'x',
      evalJson: { mode: 'nonsense', workspace: 'none' },
      rubric: VALID_RUBRIC,
      gates: VALID_GATES,
    });

    expect(() => readScenario(dir)).toThrow(/eval\.json failed schema/);
  });

  it('throws when rubric weights do not sum to 1', () => {
    const dir = writeScenario({
      prompt: 'x',
      evalJson: VALID_EVAL,
      rubric: {
        ...VALID_RUBRIC,
        criteria: [
          { ...VALID_RUBRIC.criteria[0], weight: 0.3 },
          { ...VALID_RUBRIC.criteria[1], weight: 0.3 },
        ],
      },
      gates: VALID_GATES,
    });

    expect(() => readScenario(dir)).toThrow(/rubric\.json/);
  });

  it('throws when rubric.json has an unknown scoring mode', () => {
    const dir = writeScenario({
      prompt: 'x',
      evalJson: VALID_EVAL,
      rubric: {
        ...VALID_RUBRIC,
        criteria: [
          { ...VALID_RUBRIC.criteria[0], scoring: 'vibes' },
          VALID_RUBRIC.criteria[1],
        ],
      },
      gates: VALID_GATES,
    });

    expect(() => readScenario(dir)).toThrow(/rubric\.json failed schema/);
  });

  it('throws when gates.json carries an unknown field', () => {
    const dir = writeScenario({
      prompt: 'x',
      evalJson: VALID_EVAL,
      rubric: VALID_RUBRIC,
      gates: { requireCleanSubmit: true, bogusField: 1 },
    });

    expect(() => readScenario(dir)).toThrow(/gates\.json failed schema/);
  });

  it('throws when rubric.json is malformed JSON', () => {
    const dir = writeScenario({
      prompt: 'x',
      evalJson: VALID_EVAL,
      gates: VALID_GATES,
    });
    writeFileSync(join(dir, 'rubric.json'), '{ not json');

    expect(() => readScenario(dir)).toThrow(/rubric\.json is not valid JSON/);
  });
});
