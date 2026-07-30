import { cpSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Scenario, ScenarioReferenceRole } from './scenario.js';

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
