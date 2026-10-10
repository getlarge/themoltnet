import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';

import { type ClassifyInput, validateClassifyOutput } from '@moltnet/tasks';
import { writePiConfig } from '@themoltnet/pi-runtime/pi-config';
import { type Agent, connect } from '@themoltnet/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createDaemonRunRoots,
  runDaemonOnce,
  startHttpStub,
} from './fixtures.js';
import { createDaemonTestHarness, type DaemonTestHarness } from './setup.js';

const LIVE_FLAG = 'MOLTNET_AGENT_DAEMON_LIVE_LLM_E2E';
const FIXTURE_KEY = 'classifier-e2e-fixture-key';
const input: ClassifyInput = {
  version: 1,
  state: { message: 'Please cancel my subscription immediately.' },
  questions: {
    cancel: {
      type: 'bool',
      instructions: 'Does the customer explicitly request cancellation?',
      criteria: {
        true: 'Explicit cancellation request',
        false: 'No cancellation request',
      },
    },
    department: {
      type: 'choice',
      instructions: 'Which department should handle this request?',
      criteria: {
        billing: 'Subscriptions and payments',
        technical: 'Technical problems',
      },
    },
    urgency: {
      type: 'score',
      instructions: 'How urgent is the request?',
      criteria: ['No urgency stated', 'Action requested immediately'],
    },
  },
};
const answers = {
  cancel: { type: 'bool', probability: 0.99 },
  department: {
    type: 'choice',
    choice: 'billing',
    probabilities: { billing: 0.95, technical: 0.05 },
    confidence: 0.9,
  },
  urgency: { type: 'score', score: 1, confidence: 0.9 },
};
const wireResponse = {
  answers: { ...answers, cancel: { type: 'noul', noul: 0.99 } },
  usage: { input_tokens: 42, output_tokens: 0 },
};

describe('Daemon classification through native Pi HTTP transport', () => {
  let harness: DaemonTestHarness;
  let agent: Agent;
  let creds: Awaited<ReturnType<DaemonTestHarness['createAgent']>>;

  beforeAll(async () => {
    harness = await createDaemonTestHarness();
    creds = await harness.createAgent('e2e-classifier-daemon');
    agent = await connect({
      apiUrl: harness.restApiUrl,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
    });
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  async function runClassification(provider: {
    id: string;
    baseUrl: string;
    model: string;
    key: string;
  }) {
    const roots = createDaemonRunRoots('classifier-e2e');
    let profileId: string | undefined;
    try {
      writePiConfig({
        piDir: roots.piDir,
        providers: {
          [provider.id]: {
            api: 'typesafe-system-one',
            baseUrl: provider.baseUrl,
            apiKeyEnvRef: '$E2E_CLASSIFIER_API_KEY',
            models: [{ id: provider.model, type: 'classifier' }],
          },
        },
      });
      const profile = await agent.runtimeProfiles.create(
        {
          name: `classifier-e2e-${randomUUID()}`,
          runtimeKind: 'gondolin_pi',
          models: {
            classification: { provider: provider.id, model: provider.model },
          },
          defaultWorkspaceMode: 'shared_mount',
          allowedWorkspaceModes: ['shared_mount'],
          requiredEnv: [],
          requiredTools: [],
          sandbox: {},
        },
        { teamId: creds.personalTeamId },
      );
      profileId = profile.id;
      const task = await agent.tasks.create(
        {
          taskType: 'classify',
          title: 'Classify a cancellation request',
          diaryId: creds.privateDiaryId,
          // Leave retry budget so failure assertions cannot pass through exhaustion.
          maxAttempts: 2,
          input,
        },
        { teamId: creds.personalTeamId },
      );
      const exitCode = await runDaemonOnce({
        ...roots,
        taskId: task.id,
        profileId,
        env: { E2E_CLASSIFIER_API_KEY: provider.key },
        credentials: {
          agent,
          agentRoot: roots.agentRoot,
          agentName: creds.name,
          agentId: creds.agentId,
          teamId: creds.personalTeamId,
          apiUrl: harness.restApiUrl,
          ...creds.keyPair,
        },
      });
      const final = await agent.tasks.get(task.id);
      const attempts = await agent.tasks.listAttempts(task.id);
      expect(attempts).toHaveLength(1);
      return { exitCode, final, attempt: attempts[0] };
    } finally {
      if (profileId) await agent.runtimeProfiles.delete(profileId);
      for (const root of Object.values(roots))
        rmSync(root, { recursive: true, force: true });
    }
  }

  it.each(['success', 'unauthorized', 'invalid-answer'] as const)(
    'persists the %s outcome through the real daemon and Pi',
    async (scenario) => {
      const requests: Array<{
        method?: string;
        url?: string;
        authorization?: string;
        body: unknown;
      }> = [];
      const stub = await startHttpStub((request, response) => {
        let body = '';
        request.setEncoding('utf8');
        request.on('data', (chunk: string) => {
          body += chunk;
        });
        request.on('end', () => {
          requests.push({
            method: request.method,
            url: request.url,
            authorization: request.headers.authorization,
            body: JSON.parse(body),
          });
          response.setHeader('Content-Type', 'application/json');
          response.statusCode = scenario === 'unauthorized' ? 401 : 200;
          response.end(
            JSON.stringify(
              scenario === 'unauthorized'
                ? { error: { message: 'Invalid API key' } }
                : scenario === 'invalid-answer'
                  ? {
                      ...wireResponse,
                      answers: {
                        ...wireResponse.answers,
                        cancel: { type: 'noul', noul: 2 },
                      },
                    }
                  : wireResponse,
            ),
          );
        });
      });
      try {
        const result = await runClassification({
          id: 'classifier-fixture',
          baseUrl: `${stub.url}/v1`,
          model: 'fixture-jev',
          key: FIXTURE_KEY,
        });
        expect(requests).toEqual([
          {
            method: 'POST',
            url: '/v1/systemone',
            authorization: `Bearer ${FIXTURE_KEY}`,
            body: {
              model: 'fixture-jev',
              state: input.state,
              questions: {
                ...input.questions,
                cancel: { ...input.questions.cancel, type: 'noul' },
              },
            },
          },
        ]);
        if (scenario === 'success') {
          expect(result.exitCode).toBe(0);
          expect(result.final.status).toBe('completed');
          expect(result.final.acceptedAttemptN).toBe(result.attempt.attemptN);
          const output = {
            version: 1,
            provider: 'classifier-fixture',
            model: 'fixture-jev',
            answers,
            usage: { inputTokens: 42, outputTokens: 0 },
          };
          expect(result.attempt.output).toEqual(output);
          // The completion API verifies the submitted CID before storing the JSONB output.
          expect(result.attempt.outputCid).toMatch(/^b[a-z2-7]+$/);
          expect(result.attempt.status).toBe('completed');
        } else {
          expect(result.final.status).toBe('failed');
          expect(result.final.acceptedAttemptN).toBeNull();
          expect(result.attempt.status).toBe('failed');
          expect(result.attempt.output).toBeNull();
          expect(result.attempt.error).toMatchObject({
            code:
              scenario === 'unauthorized'
                ? 'llm_auth_error'
                : 'classification_failed',
            retryable: false,
          });
          expect(JSON.stringify(result.attempt)).not.toContain(FIXTURE_KEY);
        }
      } finally {
        await new Promise<void>((resolve, reject) => {
          stub.server.close((error) => (error ? reject(error) : resolve()));
        });
      }
    },
    120_000,
  );

  it.skipIf(process.env[LIVE_FLAG] !== '1')(
    'completes a live Jev classification task',
    async () => {
      const key = process.env.TYPESAFE_API_KEY;
      if (!key) throw new Error(`${LIVE_FLAG}=1 requires TYPESAFE_API_KEY`);
      const model =
        process.env.MOLTNET_AGENT_DAEMON_CLASSIFIER_MODEL ?? 'jev-latest';
      const { exitCode, final, attempt } = await runClassification({
        id: 'typesafe',
        baseUrl: 'https://api.typesafe.ai/v1',
        model,
        key,
      });
      expect(exitCode).toBe(0);
      expect(final.status).toBe('completed');
      expect(final.acceptedAttemptN).toBe(attempt.attemptN);
      expect(attempt.status).toBe('completed');
      expect(attempt.output).toMatchObject({
        version: 1,
        provider: 'typesafe',
        model,
      });
      expect(validateClassifyOutput(attempt.output, input)).toBeNull();
      expect(attempt.outputCid).toMatch(/^b[a-z2-7]+$/);
    },
    120_000,
  );
});
