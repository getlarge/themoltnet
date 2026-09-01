import { afterEach, describe, expect, it, vi } from 'vitest';

import workflow from '../examples/create-and-wait.workflow.json';
import { MoltNet } from '../nodes/MoltNet/MoltNet.node.js';
import { createExecuteContext, FakeMoltNetApi } from './harness.js';

describe('shipped Create to Wait workflow', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('feeds the real Create output into the real Wait operation', async () => {
    const api = new FakeMoltNetApi({
      statuses: ['running', 'completed'],
    });
    vi.stubGlobal('fetch', api.fetch);
    const createNode = workflow.nodes.find(
      ({ name }) => name === 'MoltNet Create',
    );
    const waitNode = workflow.nodes.find(({ name }) => name === 'MoltNet Wait');
    expect(createNode).toBeDefined();
    expect(waitNode).toBeDefined();

    const [created] = await new MoltNet().execute.call(
      createExecuteContext({ parameters: createNode!.parameters }),
    );
    const taskIdExpression = waitNode!.parameters.taskId;
    expect(taskIdExpression).toBe('={{$json.id}}');

    const [waited] = await new MoltNet().execute.call(
      createExecuteContext({
        items: created,
        parameters: {
          ...waitNode!.parameters,
          taskId: created[0].json.id,
          pollInterval: 0.001,
          timeout: 1,
        },
      }),
    );

    expect(waited[0].json).toMatchObject({
      taskId: api.taskId,
      status: 'completed',
      terminal: true,
      accepted: true,
      state: { answer: 42 },
    });
  });
});
