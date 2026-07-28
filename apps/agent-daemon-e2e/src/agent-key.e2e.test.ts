/**
 * E2E: Agent daemon authenticates with a team-bound agent key.
 *
 * Runs against the live Docker Compose stack (rest-api + Ory + DB). Proves the
 * PR-2 daemon adoption slice end to end:
 *  - startup validation accepts a key bound to the daemon's `--team`;
 *  - startup validation fails fast when the key is bound to a different team
 *    (the actionable fatal that replaces an obscure mid-poll 403);
 *  - a full claim → execute → complete task loop runs while authenticated with
 *    the key (no OAuth2 round-trip), so the whole daemon flow works key-only;
 *  - the production daemon wiring — `MOLTNET_AGENT_KEY`, `.moltnet/<agent>/`
 *    credential resolution, and the `once` entry point — honours env precedence
 *    and blocks a wrong `--team` before any work starts.
 *
 * The executor is stubbed — the pi/Gondolin path lives in its own suites; here
 * we only care that the agent key carries the daemon through the lifecycle.
 */

import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { computeJsonCid } from '@moltnet/crypto-service';
// eslint-disable-next-line @nx/enforce-module-boundaries -- This e2e suite intentionally exercises the daemon app entry point.
import { runOnce } from '@themoltnet/agent-daemon/cli/once.js';
// eslint-disable-next-line @nx/enforce-module-boundaries -- This e2e suite intentionally exercises daemon app internals.
import {
  resolveAgentContext,
  validateStartupBinding,
} from '@themoltnet/agent-daemon/lib/agent-context.js';
// eslint-disable-next-line @nx/enforce-module-boundaries -- This e2e suite intentionally exercises daemon app internals.
import { finalizeTask } from '@themoltnet/agent-daemon/lib/finalize.js';
import {
  AgentRuntime,
  type AgentRuntimeLogger,
  ApiTaskReporter,
  PollingApiTaskSource,
} from '@themoltnet/agent-runtime';
import { type Agent, connect } from '@themoltnet/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildProducerVerification } from './fixtures.js';
import { createDaemonTestHarness, type DaemonTestHarness } from './setup.js';

const silentLogger: AgentRuntimeLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
};

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
  // Captured for the CLI/entry-point wiring tests below.
  let keySecret: string;
  let clientId: string;
  let clientSecret: string;

  beforeAll(async () => {
    harness = await createDaemonTestHarness();
    const creds = await harness.createAgent('e2e-daemon-key');
    teamId = creds.personalTeamId;
    diaryId = creds.privateDiaryId;
    identityId = creds.identityId;
    clientId = creds.clientId;
    clientSecret = creds.clientSecret;

    oauthAgent = await connect({
      apiUrl: harness.restApiUrl,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
    });

    const issued = await oauthAgent.agentKeys.create(
      { agentId: identityId, name: 'daemon-e2e-key', ttlDays: 1 },
      { teamId, idempotencyKey: randomUUID() },
    );
    keySecret = issued.secret;

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
    // team mismatch into an actionable startup fatal. The message must name both
    // teams and the recovery step so an operator can act without guessing.
    const error = await validateStartupBinding({
      agent: keyAgent,
      teamId: otherTeam,
    }).then(
      () => null,
      (err: unknown) => (err instanceof Error ? err : new Error(String(err))),
    );
    expect(error, 'expected a startup validation failure').not.toBeNull();
    const message = error?.message ?? '';
    expect(message).toContain(teamId); // the team the key is actually bound to
    expect(message).toContain(otherTeam); // the requested --team
    expect(message).toMatch(/Restart with --team|issue a key/); // recovery guidance
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
          verification: buildProducerVerification(claimedTask.task.inputCid, {
            detail:
              'submit tool criterion satisfied in daemon agent-key e2e stub',
          }),
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

  // The tests above call the SDK/validation helpers directly. These two exercise
  // the *production* daemon wiring — the `MOLTNET_AGENT_KEY` env var, the
  // `.moltnet/<agent>/` credential resolution, and the `once` entry point — so a
  // broken env precedence or an un-wired startup check can't stay green.
  const AGENT_NAME = 'e2e-key-daemon';

  function writeKeyAgentDir(): string {
    const root = mkdtempSync(join(tmpdir(), 'daemon-key-wiring-'));
    const agentDir = join(root, '.moltnet', AGENT_NAME);
    mkdirSync(agentDir, { recursive: true });
    // Real OAuth2 credentials live in config. If env precedence broke, connect()
    // would fall back to them and whoami would carry no credentialBinding — so
    // the presence of a binding proves MOLTNET_AGENT_KEY won.
    writeFileSync(
      join(agentDir, 'moltnet.json'),
      JSON.stringify({
        identity_id: identityId,
        oauth2: { client_id: clientId, client_secret: clientSecret },
        endpoints: { api: harness.restApiUrl },
      }),
      'utf8',
    );
    return root;
  }

  it('resolveAgentContext authenticates via MOLTNET_AGENT_KEY over config OAuth2', async () => {
    const root = writeKeyAgentDir();
    const previousKey = process.env.MOLTNET_AGENT_KEY;
    process.env.MOLTNET_AGENT_KEY = keySecret;
    try {
      const ctx = await resolveAgentContext(AGENT_NAME, { agentRootDir: root });
      const whoami = await ctx.agent.agents.whoami();
      // Binding present + correct ⇒ the env key was used, not the config OAuth2.
      expect(whoami.credentialBinding?.boundTeamId).toBe(teamId);
    } finally {
      if (previousKey === undefined) delete process.env.MOLTNET_AGENT_KEY;
      else process.env.MOLTNET_AGENT_KEY = previousKey;
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('the `once` entry point fails fast on a wrong --team with MOLTNET_AGENT_KEY set', async () => {
    const root = writeKeyAgentDir();
    const otherTeam = randomUUID();
    const previousKey = process.env.MOLTNET_AGENT_KEY;
    process.env.MOLTNET_AGENT_KEY = keySecret;
    try {
      // Startup validation runs right after resolveAgentContext, before profile
      // resolution — the bogus --profile/--task-id are never reached.
      const error = await runOnce([
        '--agent',
        AGENT_NAME,
        '--agent-root',
        root,
        '--task-id',
        randomUUID(),
        '--profile',
        'unused-profile',
        '--team',
        otherTeam,
      ]).then(
        () => null,
        (err: unknown) => (err instanceof Error ? err : new Error(String(err))),
      );
      expect(
        error,
        'expected `once` to reject before starting work',
      ).not.toBeNull();
      const message = error?.message ?? '';
      expect(message).toContain(teamId); // the key's real bound team
      expect(message).toContain(otherTeam); // the wrong --team requested
    } finally {
      if (previousKey === undefined) delete process.env.MOLTNET_AGENT_KEY;
      else process.env.MOLTNET_AGENT_KEY = previousKey;
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});
