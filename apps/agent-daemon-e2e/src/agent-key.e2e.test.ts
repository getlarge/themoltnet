/**
 * E2E: Agent daemon authenticates with a team-bound agent key.
 *
 * Runs against the live Docker Compose stack (rest-api + Ory + DB). Proves the
 * PR-2 daemon adoption slice end to end:
 *  - startup validation accepts a key bound to the daemon's `--team`;
 *  - startup validation fails fast when the key is bound to a different team
 *    (the actionable fatal that replaces an obscure mid-poll 403);
 *  - a full claim → execute → complete task loop runs while authenticated with
 *    the key (no OAuth2 round-trip), so the whole daemon flow works key-only.
 *
 * The executor is stubbed — the pi/Gondolin path lives in its own suites; here
 * we only care that the agent key carries the daemon through the lifecycle.
 */

import { randomUUID } from 'node:crypto';

import { computeJsonCid } from '@moltnet/crypto-service';
import { validateStartupBinding } from '@themoltnet/agent-daemon/lib/agent-context.js';
import { finalizeTask } from '@themoltnet/agent-daemon/lib/finalize.js';
import {
  AgentRuntime,
  type AgentRuntimeLogger,
  ApiTaskReporter,
  PollingApiTaskSource,
} from '@themoltnet/agent-runtime';
import { type Agent, connect } from '@themoltnet/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDaemonTestHarness, type DaemonTestHarness } from './setup.js';

const silentLogger: AgentRuntimeLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
};

function buildProducerVerification(inputCid: string) {
  return {
    inputCid,
    results: [
      {
        id: 'submit-output',
        kind: 'gate' as const,
        status: 'pass' as const,
        detail: 'submit tool criterion satisfied in daemon agent-key e2e stub',
      },
    ],
    passed: true,
  };
}

describe('Agent daemon agent-key auth (e2e)', () => {
  let harness: DaemonTestHarness;
  // The agent's OAuth2 facade — used only to provision (issue the key, propose
  // the task). The daemon-side flow under test uses `keyAgent`.
  let oauthAgent: Agent;
  // Connected with the team-bound agent key — what the daemon uses in PR-2.
  let keyAgent: Agent;
  let teamId: string;
  let diaryId: string;
  let identityId: string;

  beforeAll(async () => {
    harness = await createDaemonTestHarness();
    const creds = await harness.createAgent('e2e-daemon-key');
    teamId = creds.personalTeamId;
    diaryId = creds.privateDiaryId;
    identityId = creds.identityId;

    oauthAgent = await connect({
      apiUrl: harness.restApiUrl,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
    });

    const issued = await oauthAgent.agentKeys.create(
      { agentId: identityId, name: 'daemon-e2e-key', ttlDays: 1 },
      { teamId, idempotencyKey: randomUUID() },
    );

    // Env-only secret in production; here it flows straight into connect().
    keyAgent = await connect({
      apiUrl: harness.restApiUrl,
      agentKey: issued.secret,
    });
  }, 120_000);

  afterAll(async () => {
    await harness?.teardown();
  });

  it('startup validation accepts a team-bound key for its own team', async () => {
    const whoami = await validateStartupBinding({ agent: keyAgent, teamId });

    // credentialBinding only appears under agent-key auth — its presence proves
    // the connection really used the key rather than falling back to OAuth2.
    expect(whoami.subjectType).toBe('agent');
    expect(whoami.identityId).toBe(identityId);
    expect(whoami.credentialBinding?.boundTeamId).toBe(teamId);
  });

  it('startup validation fails fast when the key is bound to a different team', async () => {
    const otherTeam = randomUUID();

    // whoami still succeeds (the key is valid); the pure binding check turns the
    // team mismatch into an actionable startup fatal naming the real bound team.
    await expect(
      validateStartupBinding({ agent: keyAgent, teamId: otherTeam }),
    ).rejects.toThrow(teamId);
  });

  it('runs a full claim → execute → complete loop authenticated with the agent key', async () => {
    // Propose with the OAuth2 facade; claim + execute + complete + finalize all
    // run through `keyAgent`, so every task-lifecycle call is key-authenticated.
    const created = await oauthAgent.tasks.create(
      {
        taskType: 'curate_pack',
        diaryId,
        input: {
          diaryId,
          taskPrompt: 'e2e daemon agent-key smoke',
        },
      },
      { teamId },
    );

    const runtime = new AgentRuntime({
      source: new PollingApiTaskSource({
        agent: keyAgent,
        teamId,
        taskTypes: ['curate_pack'],
        leaseTtlSec: 60,
        stopWhenEmpty: true,
        logger: silentLogger,
      }),
      makeReporter: () =>
        new ApiTaskReporter({
          tasks: keyAgent.tasks,
          leaseTtlSec: 60,
          heartbeatIntervalMs: 0,
        }),
      executeTask: async (claimedTask, reporter) => {
        await reporter.open({
          taskId: claimedTask.task.id,
          attemptN: claimedTask.attemptN,
        });
        const stubOutput = {
          packId: '00000000-0000-4000-8000-000000000001',
          packCid:
            'bafyreidlnv7nu7y4kdxkxv5e2onbpoq5o3i6gw7r6xkk7d3w5b3xrylkqe',
          entries: [
            {
              entryId: '00000000-0000-4000-8000-000000000002',
              rank: 1,
              rationale: 'e2e agent-key stub entry',
            },
          ],
          recipeParams: {},
          summary:
            'e2e agent-key stub curation summary, two sentences satisfy minLength.',
          verification: buildProducerVerification(claimedTask.task.inputCid),
        };
        const output = {
          taskId: claimedTask.task.id,
          attemptN: claimedTask.attemptN,
          status: 'completed' as const,
          output: stubOutput,
          outputCid: await computeJsonCid(stubOutput),
          usage: { inputTokens: 1, outputTokens: 1 },
          durationMs: 1,
        };
        await reporter.finalize(output.usage);
        await reporter.close();
        return output;
      },
    });

    const outputs = await runtime.start();
    expect(outputs).toHaveLength(1);
    const [output] = outputs;
    expect(output.taskId).toBe(created.id);
    expect(output.status).toBe('completed');

    await finalizeTask(keyAgent, output);

    const final = await keyAgent.tasks.get(created.id);
    expect(final.status).toBe('completed');
    expect(final.acceptedAttemptN).toBe(1);
  }, 60_000);
});
