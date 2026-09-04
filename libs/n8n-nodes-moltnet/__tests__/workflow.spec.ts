import { afterEach, describe, expect, it, vi } from 'vitest';

import localWorkflow from '../examples/create-and-wait.local.workflow.json';
import workflow from '../examples/create-and-wait.workflow.json';
import { MoltNet } from '../nodes/MoltNet/MoltNet.node.js';
import { createExecuteContext, FakeMoltNetApi } from './harness.js';

describe('shipped Create and Wait workflow', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('feeds the real Create output into the real Get Result operation', async () => {
    const api = new FakeMoltNetApi({ terminalStatus: 'completed' });
    vi.stubGlobal('fetch', api.fetch);
    const createNode = workflow.nodes.find(
      ({ name }) => name === 'MoltNet Create',
    );
    const resultNode = workflow.nodes.find(
      ({ name }) => name === 'MoltNet Get Result',
    );
    expect(createNode).toBeDefined();
    expect(resultNode).toBeDefined();
    expect(createNode?.type).toBe('@themoltnet/n8n-nodes-moltnet.moltNet');
    expect(resultNode?.type).toBe('@themoltnet/n8n-nodes-moltnet.moltNet');

    const [created] = await new MoltNet().execute.call(
      createExecuteContext({
        parameters: createNode!.parameters,
        typeVersion: createNode!.typeVersion,
      }),
    );
    expect(resultNode!.parameters.taskId).toMatchObject({
      __rl: true,
      mode: 'id',
      value: '={{$json.taskId || $json.id}}',
    });

    const [result] = await new MoltNet().execute.call(
      createExecuteContext({
        items: created,
        parameters: {
          ...resultNode!.parameters,
          taskId: { __rl: true, mode: 'id', value: created[0].json.id },
        },
        typeVersion: resultNode!.typeVersion,
      }),
    );

    expect(result[0].json).toMatchObject({
      taskId: api.taskId,
      status: 'completed',
      terminal: true,
      accepted: true,
      state: { answer: 42 },
    });
  });

  it('uses n8n Wait and IF nodes for non-blocking polling', () => {
    expect(workflow.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Wait 5 Seconds',
          type: 'n8n-nodes-base.wait',
        }),
        expect.objectContaining({
          name: 'Task Finished?',
          type: 'n8n-nodes-base.if',
        }),
      ]),
    );
    expect(workflow.connections['Task Finished?'].main[1]).toEqual([
      { index: 0, node: 'Wait 5 Seconds', type: 'main' },
    ]);
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
          name: 'MoltNet Get Result',
          type: 'CUSTOM.moltNet',
          typeVersion: 1,
        }),
      ]),
    );
  });
});
