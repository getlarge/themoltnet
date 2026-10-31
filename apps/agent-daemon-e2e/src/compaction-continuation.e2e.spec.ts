/**
 * Regression for #2878: real daemon + API-backed Durable store, scripted model.
 * To validate a release, set MOLTNET_AGENT_DAEMON_E2E_BIN to an absolute daemon
 * executable and run this spec through Nx with --skipNxCache.
 */
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import type { Server, ServerResponse } from 'node:http';

import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai';
import {
  createRegistry,
  Harness,
  LiveDoc,
  MemoryStorage,
  ROOT_CONVERSATION_ID,
  type Seq,
  type StorageWrite,
} from '@earendil-works/pi-durable';
import { writePiConfig } from '@themoltnet/pi-runtime/pi-config';
import { type Agent, connect } from '@themoltnet/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createDaemonRunRoots,
  runDaemonOnce,
  startHttpStub,
} from './fixtures.js';
import { createDaemonTestHarness, type DaemonTestHarness } from './setup.js';

const PROVIDER = 'compaction-fixture';
const MODEL = 'compaction-model';
const KEY_ENV = 'OLLAMA_API_KEY';
const HISTORY_MARKER = 'Synthetic parent history retained across correction.';

function summaryGate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

type ModelRequest = {
  messages?: Array<{ role: string; content: unknown }>;
  tools?: Array<{ function?: { name?: string } }>;
};

function respond(response: ServerResponse, first: boolean) {
  const delta = first
    ? { role: 'assistant', content: `${HISTORY_MARKER}\n${'x'.repeat(90_000)}` }
    : {
        role: 'assistant',
        tool_calls: [
          {
            index: 0,
            id: `call-${randomUUID()}`,
            type: 'function',
            function: {
              name: 'submit_freeform_output',
              arguments: JSON.stringify({ summary: 'Corrected output.' }),
            },
          },
        ],
      };
  const chunk = {
    id: `chatcmpl-${randomUUID()}`,
    object: 'chat.completion.chunk',
    created: 1,
    model: MODEL,
  };
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  response.write(
    `data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`,
  );
  // A large but in-window response triggers background, not blocking, compaction
  // at the next generation boundary with Pi's default compaction policy.
  const usage = first
    ? { prompt_tokens: 35_000, completion_tokens: 25_000, total_tokens: 60_000 }
    : { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 };
  response.write(
    `data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: first ? 'stop' : 'tool_calls' }], usage })}\n\n`,
  );
  response.end('data: [DONE]\n\n');
}

/** Read through the authenticated SDK, replay locally, and never acquire a writer. */
async function inspectAttempt(agent: Agent, taskId: string, teamId: string) {
  const store = await agent.runtimeSessions.getDurableForAttempt(taskId, 1, {
    teamId,
  });
  if (!store) throw new Error('Attempt has no Durable store');
  const storage = new MemoryStorage();
  let seq = 0;
  do {
    const page = await agent.runtimeSessions.read(store.storeId, seq, {
      teamId,
    });
    try {
      for await (const commit of page.items) {
        expect(commit.seq).toBe(seq + 1);
        storage
          .prepareCommit(
            commit.writes as unknown as StorageWrite[],
            commit.seq as Seq,
          )
          .apply();
        seq = commit.seq;
      }
    } finally {
      page.close();
    }
  } while (seq < store.headSeq);
  const harness = await Harness.open(
    storage,
    { models: createModels(), registry: createRegistry() },
    BACKGROUND_CONTEXT,
  );
  try {
    return {
      storeId: store.storeId,
      inspection: await harness.inspect(BACKGROUND_CONTEXT),
      tasks: (await storage.scanTasks({}, 100, undefined, BACKGROUND_CONTEXT))
        .items,
      submissions: (
        await storage.scanSubmissions({}, 100, undefined, BACKGROUND_CONTEXT)
      ).items,
      entries: (
        await storage.scanEntries(
          { conversationId: ROOT_CONVERSATION_ID },
          100,
          undefined,
          BACKGROUND_CONTEXT,
        )
      ).items,
      live: await harness.snapshot(
        LiveDoc,
        ROOT_CONVERSATION_ID,
        BACKGROUND_CONTEXT,
      ),
      usage: await harness.usage(BACKGROUND_CONTEXT),
    };
  } finally {
    await harness.close(BACKGROUND_CONTEXT);
  }
}

describe('background compaction correction continuation (e2e)', () => {
  let harness: DaemonTestHarness;
  let agent: Agent;
  let creds: Awaited<ReturnType<DaemonTestHarness['createAgent']>>;
  let server: Server;
  let providerUrl: string;
  let summaryStarted = summaryGate();
  let generationRequests: ModelRequest[] = [];
  let summaryRequests = 0;
  const heldResponses = new Set<ServerResponse>();
  const roots: string[] = [];

  beforeAll(async () => {
    harness = await createDaemonTestHarness();
    creds = await harness.createAgent('e2e-compaction-continuation');
    agent = await connect({
      apiUrl: harness.restApiUrl,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
    });
    const stub = await startHttpStub((request, response) => {
      if (request.url !== '/v1/chat/completions') {
        response.writeHead(404).end();
        return;
      }
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const body = JSON.parse(
          Buffer.concat(chunks).toString('utf8'),
        ) as ModelRequest;
        if (
          !body.tools?.some(
            (tool) => tool.function?.name === 'submit_freeform_output',
          )
        ) {
          summaryRequests++;
          heldResponses.add(response);
          response.once('close', () => heldResponses.delete(response));
          // Never return a summary: parent shutdown must leave summarize pending.
          summaryStarted.resolve();
          return;
        }
        generationRequests.push(body);
        if (generationRequests.length === 2) {
          // Ensure summarization has started before allowing the parent to submit.
          const timer = setTimeout(
            () => response.writeHead(500).end('Compaction did not start'),
            15_000,
          );
          void summaryStarted.promise.then(() => {
            clearTimeout(timer);
            if (!response.writableEnded) respond(response, false);
          });
        } else respond(response, generationRequests.length === 1);
      });
    });
    server = stub.server;
    providerUrl = `${stub.url}/v1`;
  }, 120_000);

  afterAll(async () => {
    for (const response of heldResponses) response.destroy();
    server?.closeAllConnections();
    await new Promise<void>((resolve) => {
      if (server) server.close(() => resolve());
      else resolve();
    });
    for (const root of roots) rmSync(root, { recursive: true, force: true });
    await harness?.teardown();
  });

  it.each([
    { label: 'default', mode: undefined },
    { label: 'extend', mode: 'extend' },
    { label: 'fork', mode: 'fork' },
  ] as const)(
    'cleans pending summarize before a $label correction',
    async ({ mode }) => {
      summaryStarted = summaryGate();
      generationRequests = [];
      summaryRequests = 0;
      const { sandboxRoot, agentRoot, piDir } =
        createDaemonRunRoots('compaction-e2e');
      roots.push(sandboxRoot, agentRoot, piDir);
      const configureModel = (contextWindow: number) =>
        writePiConfig({
          piDir,
          providers: {
            [PROVIDER]: {
              api: 'openai-completions',
              baseUrl: providerUrl,
              apiKeyEnvRef: `$${KEY_ENV}`,
              models: [{ id: MODEL, contextWindow }],
            },
          },
        });
      configureModel(100_000);
      const teamId = creds.personalTeamId;
      const profile = await agent.runtimeProfiles.create(
        {
          name: `compaction-${randomUUID()}`,
          runtimeKind: 'gondolin_pi',
          models: { generation: { provider: PROVIDER, model: MODEL } },
          maxTurns: 3,
          defaultWorkspaceMode: 'shared_mount',
          allowedWorkspaceModes: ['shared_mount'],
          requiredEnv: [KEY_ENV],
          requiredTools: [],
          sandbox: { resources: { cpus: 2, memory: '2G' } },
        },
        { teamId },
      );
      const run = (taskId: string) =>
        runDaemonOnce({
          credentials: {
            agent,
            agentRoot,
            agentName: creds.name,
            agentId: creds.agentId,
            teamId,
            publicKey: creds.keyPair.publicKey,
            privateKey: creds.keyPair.privateKey,
            fingerprint: creds.keyPair.fingerprint,
            apiUrl: harness.restApiUrl,
          },
          sandboxRoot,
          piDir,
          taskId,
          profileId: profile.id,
          env: { [KEY_ENV]: 'fixture-key' },
          executable: process.env.MOLTNET_AGENT_DAEMON_E2E_BIN,
        });
      try {
        const parent = await agent.tasks.create(
          {
            taskType: 'freeform',
            diaryId: creds.privateDiaryId,
            maxAttempts: 1,
            input: { brief: 'Return a structured summary.' },
          },
          { teamId },
        );
        expect(await run(parent.id)).toBe(0);
        expect((await agent.tasks.get(parent.id)).status).toBe('completed');
        const before = await inspectAttempt(agent, parent.id, teamId);
        expect(summaryRequests).toBe(1);
        expect(generationRequests).toHaveLength(2);
        expect(before.inspection.submissions).toEqual([]);
        expect(before.submissions).toEqual([
          expect.objectContaining({ status: 'done' }),
        ]);
        expect(before.inspection.tasks).toHaveLength(1);
        const compaction = before.inspection.tasks[0].record;
        expect(compaction).toMatchObject({
          kind: 'pi.compaction',
          version: 1,
          background: true,
          conversationId: ROOT_CONVERSATION_ID,
          state: { status: 'pending', checkpoint: { phase: 'summarize' } },
        });
        expect(compaction.owner).toBeUndefined();
        expect(before.live?.compactions).toHaveLength(1);
        expect(
          before.tasks
            .filter((record) => record.id !== compaction.id)
            .every((record) => record.state.status === 'terminal'),
        ).toBe(true);

        // Keep the correction below its new compaction threshold so any summary
        // request now would be an erroneous resumption of the inherited task.
        configureModel(1_000_000);
        const correction = await agent.tasks.create(
          {
            taskType: 'freeform',
            diaryId: creds.privateDiaryId,
            maxAttempts: 1,
            input: {
              brief: 'Correct the previous output and submit it.',
              continueFrom: {
                taskId: parent.id,
                attemptN: 1,
                ...(mode ? { mode } : {}),
              },
            },
          },
          { teamId },
        );
        expect(await run(correction.id)).toBe(0);
        expect((await agent.tasks.get(correction.id)).status).toBe('completed');
        expect(summaryRequests).toBe(1);
        expect(generationRequests).toHaveLength(3);
        expect(JSON.stringify(generationRequests[2].messages)).toContain(
          HISTORY_MARKER,
        );
        const after = await inspectAttempt(agent, correction.id, teamId);
        expect(after.storeId === before.storeId).toBe(mode !== 'fork');
        expect(
          after.tasks.find((record) => record.id === compaction.id)?.state,
        ).toMatchObject({ status: 'terminal', outcome: { status: 'aborted' } });
        expect(after.inspection.tasks).toEqual([]);
        expect(after.inspection.submissions).toEqual([]);
        expect(after.live?.compactions).toBeUndefined();
        expect(after.entries).toEqual(
          expect.arrayContaining([...before.entries]),
        );
        const modelKey = `${PROVIDER}/${MODEL}`;
        expect(
          after.usage.models[modelKey].input -
            before.usage.models[modelKey].input,
        ).toBe(100);
        expect(
          after.usage.models[modelKey].output -
            before.usage.models[modelKey].output,
        ).toBe(10);
        const [attempt] = await agent.tasks.listAttempts(correction.id);
        expect(attempt.usage).toMatchObject({
          inputTokens: 100,
          outputTokens: 10,
        });
        const messages = await agent.tasks.listMessages(correction.id, 1, {
          kind: ['info'],
        });
        expect(messages.map((message) => message.payload)).toContainEqual(
          expect.objectContaining({
            event: 'parent_background_compactions_reconciled',
            taskCount: 1,
            taskIds: [compaction.id],
          }),
        );
      } finally {
        for (const response of heldResponses) response.destroy();
        await agent.runtimeProfiles.delete(profile.id);
      }
    },
    180_000,
  );
});
