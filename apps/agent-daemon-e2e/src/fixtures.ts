import { randomUUID } from 'node:crypto';

import {
  buildScenarioRunEvalInput,
  type BuildScenarioRunEvalOptions,
  type Scenario,
  seedScenarioWorkspace,
  stageScenarioInputArtifacts,
} from '@moltnet/agent-eval';
import {
  writeAgentCredentials,
  type WrittenAgentCredentials,
} from '@moltnet/agent-eval/agent-credentials';
import { AGENT_CREDENTIAL_SCOPES } from '@moltnet/models';
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

/**
 * Provision the daemon credentials a live eval needs: mint a team-bound agent
 * key through the suite's OAuth2 agent, then write the `agent_key_ref` config
 * and the provider-held secret.
 *
 * This is the production path — `moltnet agents keys create --store` does the
 * same two steps — and it is now the only one the daemon accepts, since #2160
 * retired OAuth2 client_credentials there. The OAuth2 `agent` passed in is the
 * *issuer*, mirroring an operator running the CLI; it is never what the daemon
 * authenticates with.
 *
 * Sets `MOLTNET_SECRET_ROOT` on the current process because the daemon runs
 * in-process in these suites (`runOnce(...)`), so it reads the same env.
 */
export async function provisionDaemonCredentials(input: {
  agent: Agent;
  agentRoot: string;
  agentName: string;
  /**
   * The agent the key is issued *for* — what `agentKeys.create`'s `agentId`
   * is matched against.
   *
   * Deliberately separate from `identityId` even though the two hold the same
   * value today. #2163 makes `agents.id` an internal identifier distinct from
   * the Kratos `identity_id`, and this one follows `agents.id` while
   * `identityId` below does not. Both are `uuid`, so collapsing them into one
   * field would let that rebase pass a Kratos identity here and still
   * typecheck — the failure mode #2163 documents as having hidden every one
   * of its own bugs.
   */
  agentId: string;
  /**
   * The agent's Ory Kratos identity. Anchors the keyring entry
   * (`agent-key/<identity_id>`) and `moltnet.json`'s `identity_id`, both of
   * which #2163 explicitly leaves on `identity_id` pending its own migration.
   */
  identityId: string;
  teamId: string;
  publicKey: string;
  privateKey: string;
  fingerprint: string;
  apiUrl: string;
}): Promise<WrittenAgentCredentials> {
  const issued = await input.agent.agentKeys.create(
    {
      agentId: input.agentId,
      name: `${input.agentName}-daemon-${randomUUID().slice(0, 8)}`,
      scopes: [...AGENT_CREDENTIAL_SCOPES],
      ttlDays: 1,
    },
    { teamId: input.teamId, idempotencyKey: randomUUID() },
  );
  const written = writeAgentCredentials({
    agentRoot: input.agentRoot,
    agentName: input.agentName,
    identityId: input.identityId,
    agentKeySecret: issued.secret,
    publicKey: input.publicKey,
    privateKey: input.privateKey,
    fingerprint: input.fingerprint,
    apiUrl: input.apiUrl,
  });
  // The daemon runs in-process in these suites (`runOnce(...)`), so it reads
  // this process's env — there is no child to pass it to. Centralised here so
  // a suite cannot forget it and fail with an opaque agent_key_ref error.

  process.env.MOLTNET_SECRET_ROOT = written.secretRoot;
  return written;
}
