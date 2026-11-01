import { cpSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildGitFixtureRepo } from './git-repo.js';
import {
  GIT_SEED_PROMPT_PLACEHOLDERS,
  type Scenario,
  type ScenarioReferenceRole,
} from './scenario.js';

export interface ScenarioArtifactStager {
  stage(
    bytes: Uint8Array,
    metadata: { contentType: string },
    context: { teamId: string },
  ): Promise<{
    cid: string;
    contentType: string;
    sizeBytes: number;
    artifactSource?: 'staged';
  }>;
}

export interface StagedScenarioInputArtifact {
  artifact: {
    artifactSource: 'staged';
    cid: string;
    contentType: string;
    sizeBytes: number;
    kind: string;
    title: string;
  };
  role: ScenarioReferenceRole;
}

/**
 * Stage every declared input artifact through the real task-artifact boundary.
 * The returned records can be passed directly to TaskBuilder.artifactReference.
 */
export async function stageScenarioInputArtifacts(
  stager: ScenarioArtifactStager,
  scenario: Scenario,
  teamId: string,
): Promise<StagedScenarioInputArtifact[]> {
  return Promise.all(
    (scenario.fixtures?.inputArtifacts ?? []).map(async (fixture) => {
      const staged = await stager.stage(
        readFileSync(fixture.sourcePath),
        { contentType: fixture.contentType },
        { teamId },
      );
      return {
        artifact: {
          ...staged,
          artifactSource: 'staged' as const,
          kind: fixture.kind,
          title: fixture.title,
        },
        role: fixture.role,
      };
    }),
  );
}

/**
 * Materialize a validated scenario seed into a fresh shared-mount root.
 * readScenario rejects links and out-of-scenario paths before this is called.
 */
export function seedScenarioWorkspace(
  scenario: Scenario,
  targetRoot: string,
): void {
  const sourceRoot = scenario.fixtures?.workspaceSeedPath;
  if (!sourceRoot) {
    return;
  }
  mkdirSync(targetRoot, { recursive: true });
  for (const entry of readdirSync(sourceRoot, { withFileTypes: true })) {
    cpSync(join(sourceRoot, entry.name), join(targetRoot, entry.name), {
      recursive: entry.isDirectory(),
      errorOnExist: true,
      force: false,
    });
  }
}

/** Full commit ids of a materialized gitSeed repository. */
export interface ScenarioGitRevisions {
  base: string;
  head: string;
}

/** Branch that keeps the head commit reachable while `main` sits at base. */
export const GIT_SEED_HEAD_BRANCH = 'pr-head';

/**
 * Materialize a validated gitSeed into `targetRoot` as a git repository whose
 * main checkout sits at the base commit (like a CI checkout of the PR base)
 * and whose head commit is the base's child, reachable via
 * `GIT_SEED_HEAD_BRANCH`. Only the declared trees are copied, so hidden
 * scenario files never enter the repository. Returns null for scenarios
 * without a gitSeed.
 */
export function seedScenarioGitRepo(
  scenario: Scenario,
  targetRoot: string,
): ScenarioGitRevisions | null {
  const gitSeed = scenario.fixtures?.gitSeed;
  if (!gitSeed) {
    return null;
  }
  const [base, head] = buildGitFixtureRepo({
    root: targetRoot,
    commits: [
      { tree: gitSeed.basePath, message: `${scenario.slug}: base` },
      { tree: gitSeed.headPath, message: `${scenario.slug}: head` },
    ],
    checkoutIndex: 0,
    extraBranches: { [GIT_SEED_HEAD_BRANCH]: 1 },
  });
  return { base, head };
}

/** Replace `{{gitSeed.base}}` / `{{gitSeed.head}}` with real commit ids. */
export function renderGitSeedPrompt(
  prompt: string,
  revisions: ScenarioGitRevisions,
): string {
  return prompt
    .replaceAll(GIT_SEED_PROMPT_PLACEHOLDERS.base, revisions.base)
    .replaceAll(GIT_SEED_PROMPT_PLACEHOLDERS.head, revisions.head);
}
