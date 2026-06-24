/**
 * Reusable seeding helpers for console e2e tests that need a real agent
 * provisioning + invitation flow.
 *
 * Console e2e tests run as a human in the browser (Kratos cookie auth),
 * but only agents can claim/complete tasks. Several flows we want to
 * test — warm-slot continuations (#1303), daemon-attributed completions,
 * tasks-by-agent filtering — require both sides interacting on the same
 * team. This module wires that handshake:
 *
 *   1. Bootstrap a fresh agent against the e2e Docker stack
 *      (`@moltnet/bootstrap`).
 *   2. Connect the agent to the rest-api via `@themoltnet/sdk`.
 *   3. The human (already registered) creates an invite for their
 *      personal team; the agent accepts it.
 *   4. The agent can now create/claim/complete tasks in the human's
 *      team — and the human's console sees them.
 *
 * For tests that only need the human side (the common case), keep using
 * the existing helpers in `./index.ts`. Pull in this module when an
 * agent identity is load-bearing for what's under test.
 */

import { createE2EAgentHarness, type GenesisAgent } from '@moltnet/bootstrap';
import { computeJsonCid } from '@moltnet/crypto-service';
import { type Agent, connect } from '@themoltnet/sdk';

export interface SeedCompletedFreeformOptions {
  agent: Agent;
  teamId: string;
  diaryId: string;
  /** Brief field on the source task input. */
  brief: string;
  /** Optional top-level title on the source task. */
  title?: string;
  /** Optional correlationId — required for cross-attempt slot affinity. */
  correlationId?: string;
  /**
   * Optional profile pinning on the source task. Tests that exercise
   * the continuation's profile-allowlist inheritance contract should
   * set this so the asserts have a concrete pin to compare against.
   */
  allowedProfiles?: { profileId: string }[];
  /** Profile attestation to send when claiming a profile-pinned task. */
  claimProfileId?: string;
  requiredExecutorTrustLevel?:
    | 'selfDeclared'
    | 'agentSigned'
    | 'releaseVerifiedTool'
    | 'sandboxAttested';
  /**
   * How far in the future to push `daemonState.slotResumableUntil`. The
   * server doesn't enforce a max but the UI gates on "now < this", so 1h
   * is a safe default for an interactive test run.
   */
  slotTtlMs?: number;
}

export interface SeededFreeformAttempt {
  taskId: string;
  attemptN: number;
  slotResumableUntil: string;
}

/**
 * Drive the rest-api through the create → claim → heartbeat → complete
 * cycle on a freeform task, planting a future `daemonState.slotResumableUntil`
 * so the resulting attempt looks warm-resumable to the UI gating logic.
 *
 * The agent must already be a member of `teamId` (use
 * `inviteAgentToHumanTeam` first when the team belongs to a human).
 */
export async function seedCompletedFreeformAttempt(
  options: SeedCompletedFreeformOptions,
): Promise<SeededFreeformAttempt> {
  const {
    agent,
    teamId,
    diaryId,
    brief,
    title,
    correlationId,
    allowedProfiles,
    claimProfileId,
    requiredExecutorTrustLevel,
    slotTtlMs = 60 * 60 * 1000,
  } = options;

  const created = await agent.tasks.create(
    {
      taskType: 'freeform',
      diaryId,
      ...(title ? { title } : {}),
      ...(correlationId ? { correlationId } : {}),
      ...(allowedProfiles?.length ? { allowedProfiles } : {}),
      ...(requiredExecutorTrustLevel ? { requiredExecutorTrustLevel } : {}),
      input: {
        brief,
      },
    },
    { teamId },
  );

  const claimed = await agent.tasks.claim(created.id, {
    leaseTtlSec: 120,
    ...(claimProfileId ? { profileId: claimProfileId } : {}),
  });
  const attemptN = claimed.attempt.attemptN;
  // Heartbeat flips claimed → running. /complete returns 409 otherwise.
  await agent.tasks.heartbeat(created.id, attemptN, {
    leaseTtlSec: 120,
  });

  const output = {
    summary: `Console e2e seed output for ${brief.slice(0, 32)}, two sentences long enough to satisfy schema minLength.`,
    verification: {
      inputCid: claimed.task.inputCid,
      results: [
        {
          id: 'submit-output',
          kind: 'gate' as const,
          status: 'pass' as const,
          detail: 'submit-output gate satisfied by seed helper',
        },
      ],
      passed: true,
    },
  };
  const outputCid = await computeJsonCid(output);
  const slotResumableUntil = new Date(Date.now() + slotTtlMs).toISOString();

  await agent.tasks.complete(created.id, attemptN, {
    output,
    outputCid,
    usage: { inputTokens: 1, outputTokens: 1 },
    daemonState: {
      reportedAt: new Date().toISOString(),
      slotResumableUntil,
    },
  });

  return {
    taskId: created.id,
    attemptN,
    slotResumableUntil,
  };
}

export interface ConnectedAgent {
  agent: Agent;
  genesis: GenesisAgent;
  teardown(): Promise<void>;
}

/**
 * Bootstrap a fresh genesis agent and return both the SDK `Agent`
 * handle (for task ops) and the raw `GenesisAgent` (for direct
 * credential access, e.g. when the test needs to call rest-api endpoints
 * the SDK doesn't expose yet).
 *
 * Reads `REST_API_URL`, `DATABASE_URL`, `ORY_*` env vars to override
 * the standard docker-compose.e2e ports, so CI matrices that bind
 * different hostnames keep working. The bootstrap library itself stays
 * config-source agnostic; pushing env reads to the call site keeps it
 * testable.
 *
 * Caller must invoke `teardown()` in `afterAll` to close pooled
 * connections from `createE2EAgentHarness`.
 */
export async function provisionAgent(
  name: string,
  options: { apiUrl?: string } = {},
): Promise<ConnectedAgent> {
  const env = process.env;
  const harness = await createE2EAgentHarness({
    restApiUrl: options.apiUrl ?? env.REST_API_URL,
    databaseUrl: env.DATABASE_URL,
    hydraPublicUrl: env.ORY_HYDRA_PUBLIC_URL,
    hydraAdminUrl: env.ORY_HYDRA_ADMIN_URL,
    ketoReadUrl: env.ORY_KETO_PUBLIC_URL,
    ketoWriteUrl: env.ORY_KETO_ADMIN_URL,
    kratosAdminUrl: env.ORY_KRATOS_ADMIN_URL,
  });
  const genesis = await harness.createAgent(name);
  const agent = await connect({
    apiUrl: harness.restApiUrl,
    clientId: genesis.clientId,
    clientSecret: genesis.clientSecret,
  });
  return {
    agent,
    genesis,
    teardown: () => harness.teardown(),
  };
}
