import { randomUUID } from 'node:crypto';

import {
  buildScenarioRunEvalInput,
  type BuildScenarioRunEvalOptions,
  type Scenario,
  seedScenarioWorkspace,
  stageScenarioInputArtifacts,
} from '@moltnet/agent-eval';
import type { Agent } from '@themoltnet/sdk';

/**
 * Shared fixtures for the agent-daemon e2e suites.
 *
 * Producer verification is the gate payload a task producer attaches to its
 * output; the server re-checks it on `/complete`. Every daemon e2e suite stubs
 * the same shape, so it lives here once to avoid drift when the task-completion
 * contract changes. Callers override `id`/`detail` for suite-specific labelling.
 */

export function buildProducerVerification(
  inputCid: string,
  options: { id?: string; detail?: string } = {},
) {
  return {
    inputCid,
    results: [
      {
        id: options.id ?? 'submit-output',
        kind: 'gate' as const,
        status: 'pass' as const,
        detail:
          options.detail ??
          'submit tool criterion satisfied in daemon e2e stub',
      },
    ],
    passed: true,
  };
}

/** Build one fixture-backed producer task without duplicating task contracts. */
export async function createScenarioProducerTask(args: {
  agent: Agent;
  scenario: Scenario;
  sandboxRoot: string;
  teamId: string;
  diaryId: string;
  title: string;
  contextPolicy?: BuildScenarioRunEvalOptions['contextPolicy'];
}) {
  const {
    agent,
    scenario,
    sandboxRoot,
    teamId,
    diaryId,
    title,
    contextPolicy,
  } = args;
  seedScenarioWorkspace(scenario, sandboxRoot);
  const inputArtifacts = await stageScenarioInputArtifacts(
    agent.tasks.artifacts,
    scenario,
    teamId,
  );
  const builder =
    scenario.taskType === 'freeform'
      ? agent.tasks
          .buildFreeform({
            brief: scenario.prompt,
            execution: { workspace: scenario.execution.workspace },
          })
          .title(title)
          .diary(diaryId)
          .correlationId(randomUUID())
          .maxAttempts(1)
          .team(teamId)
      : agent.tasks
          .buildRunEval(buildScenarioRunEvalInput(scenario, { contextPolicy }))
          .title(title)
          .diary(diaryId)
          .correlationId(randomUUID())
          .maxAttempts(1)
          .team(teamId);
  for (const inputArtifact of inputArtifacts) {
    builder.artifactReference(inputArtifact.artifact, inputArtifact.role);
  }
  return agent.tasks.create(builder.build());
}
