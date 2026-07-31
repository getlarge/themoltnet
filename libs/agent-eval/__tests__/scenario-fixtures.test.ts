import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Scenario } from '../src/scenario.js';
import {
  seedScenarioWorkspace,
  stageScenarioInputArtifacts,
} from '../src/scenario-fixtures.js';

describe('scenario fixtures', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'agent-eval-fixtures-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('stages declared files with their task-reference metadata', async () => {
    // Arrange
    const inputPath = join(root, 'manifest.json');
    writeFileSync(inputPath, '{"version":1}\n');
    const scenario = {
      fixtures: {
        inputArtifacts: [
          {
            path: 'manifest.json',
            sourcePath: inputPath,
            role: 'reviewed_diff',
            kind: 'review-manifest',
            title: 'manifest.json',
            contentType: 'application/json',
          },
        ],
      },
    } as Scenario;
    const stage = vi.fn().mockResolvedValue({
      cid: 'bafkreimanifest',
      contentType: 'application/json',
      sizeBytes: 14,
      artifactSource: 'staged',
    });

    // Act
    const staged = await stageScenarioInputArtifacts(
      { stage },
      scenario,
      'team-1',
    );

    // Assert
    expect(stage).toHaveBeenCalledWith(
      readFileSync(inputPath),
      { contentType: 'application/json' },
      { teamId: 'team-1' },
    );
    expect(staged).toEqual([
      {
        role: 'reviewed_diff',
        artifact: {
          artifactSource: 'staged',
          cid: 'bafkreimanifest',
          contentType: 'application/json',
          sizeBytes: 14,
          kind: 'review-manifest',
          title: 'manifest.json',
        },
      },
    ]);
  });

  it('copies a workspace seed into a fresh sandbox root', () => {
    // Arrange
    const seedRoot = join(root, 'seed');
    const sandboxRoot = join(root, 'sandbox');
    mkdirSync(join(seedRoot, 'src'), { recursive: true });
    writeFileSync(join(seedRoot, 'README.md'), '# Fixture\n');
    writeFileSync(
      join(seedRoot, 'src', 'index.ts'),
      'export const value = 1;\n',
    );
    const scenario = {
      fixtures: {
        workspaceSeedPath: seedRoot,
        inputArtifacts: [],
      },
    } as Scenario;

    // Act
    seedScenarioWorkspace(scenario, sandboxRoot);

    // Assert
    expect(readFileSync(join(sandboxRoot, 'README.md'), 'utf8')).toBe(
      '# Fixture\n',
    );
    expect(readFileSync(join(sandboxRoot, 'src', 'index.ts'), 'utf8')).toBe(
      'export const value = 1;\n',
    );
  });

  it('is a no-op when a scenario has no fixtures', async () => {
    const stage = vi.fn();
    const scenario = {} as Scenario;

    await expect(
      stageScenarioInputArtifacts({ stage }, scenario, 'team-1'),
    ).resolves.toEqual([]);
    seedScenarioWorkspace(scenario, join(root, 'sandbox'));

    expect(stage).not.toHaveBeenCalled();
  });
});
