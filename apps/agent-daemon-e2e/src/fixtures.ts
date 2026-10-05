import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
// eslint-disable-next-line @nx/enforce-module-boundaries -- E2E fixtures run the daemon entry point.
import { runOnce } from '@themoltnet/agent-daemon/cli/once.js';
import type { Agent } from '@themoltnet/sdk';
import { vi } from 'vitest';

export function createDaemonRunRoots(prefix: string) {
  return {
    sandboxRoot: mkdtempSync(join(tmpdir(), `${prefix}-cwd-`)),
    agentRoot: mkdtempSync(join(tmpdir(), `${prefix}-agent-`)),
    piDir: mkdtempSync(join(tmpdir(), `${prefix}-pi-`)),
  };
}

/** Run the real daemon with isolated credentials, cwd, and test environment. */
export async function runDaemonOnce(input: {
  credentials: Parameters<typeof provisionDaemonCredentials>[0];
  sandboxRoot: string;
  piDir: string;
  taskId: string;
  profileId: string;
  env?: Record<string, string>;
}): Promise<number> {
  const oldCwd = process.cwd();
  const oldSecretRoot = process.env.MOLTNET_SECRET_ROOT;
  try {
    await provisionDaemonCredentials(input.credentials);
    for (const name of [
      'MOLTNET_CREDENTIALS_PATH',
      'MOLTNET_AGENT_KEY',
      'MOLTNET_AGENT_KEY_REF',
      'MOLTNET_CLIENT_ID',
      'MOLTNET_CLIENT_SECRET',
    ]) {
      vi.stubEnv(name, '');
    }
    vi.stubEnv('MOLTNET_API_URL', input.credentials.apiUrl);
    vi.stubEnv('PI_CODING_AGENT_DIR', input.piDir);
    for (const [name, value] of Object.entries(input.env ?? {})) {
      vi.stubEnv(name, value);
    }
    process.chdir(input.sandboxRoot);
    return await runOnce([
      '--task-id',
      input.taskId,
      '--agent',
      input.credentials.agentName,
      '--profile',
      input.profileId,
      '--team',
      input.credentials.teamId,
      '--agent-root',
      input.credentials.agentRoot,
    ]);
  } finally {
    process.chdir(oldCwd);
    if (oldSecretRoot === undefined) {
      delete process.env.MOLTNET_SECRET_ROOT;
    } else {
      process.env.MOLTNET_SECRET_ROOT = oldSecretRoot;
    }
    vi.unstubAllEnvs();
  }
}

/** Bind a provider/agent-server HTTP stub on an ephemeral loopback port. */
export async function startHttpStub(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<{ server: Server; url: string }> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('HTTP fixture did not bind a TCP port');
  }
  return { server, url: `http://127.0.0.1:${address.port}` };
}

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
            outputContract: scenario.outputContract,
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
   * The durable agent subject. The issued key, key reference, and canonical
   * config all anchor on this identifier.
   */
  agentId: string;
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
    subjectId: input.agentId,
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
