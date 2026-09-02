import { afterEach, describe, expect, it, vi } from 'vitest';

import localWorkflow from '../examples/create-and-wait.local.workflow.json';
import workflow from '../examples/create-and-wait.workflow.json';
import { MoltNet } from '../nodes/MoltNet/MoltNet.node.js';
import { createExecuteContext, FakeMoltNetApi } from './harness.js';

describe('shipped Create to Wait workflow', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('feeds the real Create output into the real Wait operation', async () => {
    const api = new FakeMoltNetApi({
      statuses: ['running', 'completed'],
    });
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    vi.stubGlobal('fetch', api.fetch);
    const createNode = workflow.nodes.find(
      ({ name }) => name === 'MoltNet Create',
    );
    const waitNode = workflow.nodes.find(({ name }) => name === 'MoltNet Wait');
    expect(createNode).toBeDefined();
    expect(waitNode).toBeDefined();
    expect(createNode?.type).toBe('@themoltnet/n8n-nodes-moltnet.moltNet');
    expect(waitNode?.type).toBe('@themoltnet/n8n-nodes-moltnet.moltNet');

    const [created] = await new MoltNet().execute.call(
      createExecuteContext({
        parameters: createNode!.parameters,
        typeVersion: createNode!.typeVersion,
      }),
    );
    const taskIdExpression = waitNode!.parameters.taskId;
    expect(taskIdExpression).toMatchObject({
      __rl: true,
      mode: 'id',
      value: '={{$json.id}}',
    });

    const execution = new MoltNet().execute.call(
      createExecuteContext({
        items: created,
        parameters: {
          ...waitNode!.parameters,
          taskId: { __rl: true, mode: 'id', value: created[0].json.id },
          pollInterval: 5,
          timeout: 30,
        },
        typeVersion: waitNode!.typeVersion,
      }),
    );
    await vi.runAllTimersAsync();
    const [waited] = await execution;

    expect(waited[0].json).toMatchObject({
      taskId: api.taskId,
      status: 'completed',
      terminal: true,
      accepted: true,
      state: { answer: 42 },
    });
  });

  it('provides a repository-local workflow for the custom directory loader', () => {
    const moltNetNodes = localWorkflow.nodes.filter(({ name }) =>
      name.startsWith('MoltNet '),
    );

    expect(moltNetNodes).toHaveLength(2);
    expect(moltNetNodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'MoltNet Create',
          type: 'CUSTOM.moltNet',
          typeVersion: 1,
        }),
        expect.objectContaining({
          name: 'MoltNet Wait',
          type: 'CUSTOM.moltNet',
          typeVersion: 1,
        }),
      ]),
    );
  });
});
