import type { NodeInitializer } from 'node-red';
import { describe, expect, it } from 'vitest';

import taskBuilder from '../src/nodes/task-builder.js';
import { type FakeNode, FakeRed } from './fake-red.js';

/**
 * Stub `moltnet-agent` carrying team/diary context. The builder is offline — it
 * only reads `teamId`/`diaryId` synchronously, never `getAgent()` — so no SDK
 * fake is needed here.
 */
function agentStub(): NodeInitializer {
  return ((RED: FakeRed) => {
    RED.nodes.registerType('moltnet-agent', function (this: FakeNode) {
      RED.nodes.createNode(this);
      this.teamId = 'team-1';
      this.diaryId = 'diary-1';
    });
  }) as unknown as NodeInitializer;
}

function setup(def: Record<string, unknown>) {
  const red = new FakeRed();
  red.load(agentStub());
  red.load(taskBuilder);
  red.create('moltnet-agent', 'a1');
  const node = red.create('moltnet-task-builder', 'n1', {
    agent: 'a1',
    ...def,
  });
  return { red, node };
}

describe('moltnet-task-builder', () => {
  it('builds a freeform body with brief + agent team/diary', async () => {
    const { red, node } = setup({
      taskType: 'freeform',
      brief: 'Do the thing',
    });
    const { outputs } = await red.input(node, { payload: {} });
    const payload = outputs[0].payload as Record<string, unknown>;
    expect(payload.taskType).toBe('freeform');
    expect(payload.teamId).toBe('team-1');
    expect(payload.diaryId).toBe('diary-1');
    expect((payload.input as { brief: string }).brief).toBe('Do the thing');
  });

  it('errors (red ring, done(err)) when brief is empty', async () => {
    const { red, node } = setup({ taskType: 'freeform', brief: '' });
    // The node reports failure via done(err) (the harness rejects) and a red
    // ring status — matching the existing done-only convention in tasks-create.
    await expect(red.input(node, { payload: {} })).rejects.toBeTruthy();
    expect(node.statuses.at(-1)).toMatchObject({ fill: 'red', shape: 'ring' });
  });

  it('overrides agent team/diary via node config fields', async () => {
    const { red, node } = setup({
      taskType: 'freeform',
      brief: 'b',
      teamId: 'team-override',
      teamIdType: 'str',
      diaryId: 'diary-override',
      diaryIdType: 'str',
    });
    const { outputs } = await red.input(node, { payload: {} });
    const payload = outputs[0].payload as Record<string, unknown>;
    expect(payload.teamId).toBe('team-override');
    expect(payload.diaryId).toBe('diary-override');
  });

  it('overrides agent team via a msg path', async () => {
    const { red, node } = setup({
      taskType: 'freeform',
      brief: 'b',
      teamId: 'ctx.team',
      teamIdType: 'msg',
    });
    const { outputs } = await red.input(node, {
      payload: {},
      ctx: { team: 'team-from-msg' },
    } as Record<string, unknown>);
    const payload = outputs[0].payload as Record<string, unknown>;
    expect(payload.teamId).toBe('team-from-msg');
    // diary still falls back to the agent default
    expect(payload.diaryId).toBe('diary-1');
  });
});

describe('moltnet-task-builder context mappings', () => {
  it('pulls a context value from a msg path and JSON-stringifies objects', async () => {
    const { red, node } = setup({
      taskType: 'freeform',
      brief: 'b',
      contexts: [
        {
          slug: 'forecast',
          binding: 'context_inline',
          valueType: 'msg',
          value: 'forecast',
        },
      ],
    });
    const { outputs } = await red.input(node, {
      payload: {},
      forecast: { temp: 21 },
    } as Record<string, unknown>);
    const payload = outputs[0].payload as Record<string, unknown>;
    const ctx = (
      payload.input as {
        context: { slug: string; binding: string; content: string }[];
      }
    ).context;
    expect(ctx[0]).toEqual({
      slug: 'forecast',
      binding: 'context_inline',
      content: JSON.stringify({ temp: 21 }),
    });
  });

  it('passes a literal str context value through unchanged', async () => {
    const { red, node } = setup({
      taskType: 'freeform',
      brief: 'b',
      contexts: [
        {
          slug: 'note',
          binding: 'context_inline',
          valueType: 'str',
          value: 'hello',
        },
      ],
    });
    const { outputs } = await red.input(node, { payload: {} });
    const payload = outputs[0].payload as Record<string, unknown>;
    const ctx = (payload.input as { context: { content: string }[] }).context;
    expect(ctx[0].content).toBe('hello');
  });
});

describe('moltnet-task-builder references + gates + execution', () => {
  it('adds a reference from an outputRef on a msg path', async () => {
    const { red, node } = setup({
      taskType: 'freeform',
      brief: 'b',
      referencesFrom: 'result.outputRef',
      referencesRole: 'judged_work',
    });
    const { outputs } = await red.input(node, {
      payload: {},
      result: {
        outputRef: { taskId: 't1', outputCid: 'bafy', role: 'context' },
      },
    } as Record<string, unknown>);
    const payload = outputs[0].payload as Record<string, unknown>;
    expect(payload.references).toEqual([
      { taskId: 't1', outputCid: 'bafy', role: 'judged_work' },
    ]);
  });

  it('adds submit-output gate and execution workspace', async () => {
    const { red, node } = setup({
      taskType: 'freeform',
      brief: 'b',
      submitOutputGate: true,
      workspace: 'none',
    });
    const { outputs } = await red.input(node, { payload: {} });
    const payload = outputs[0].payload as Record<string, unknown>;
    const input = payload.input as {
      successCriteria?: { gates?: { id: string }[] };
      execution?: { workspace?: string };
    };
    expect(
      input.successCriteria?.gates?.some((g) => g.id === 'submit-output'),
    ).toBe(true);
    expect(input.execution?.workspace).toBe('none');
  });
});

describe('moltnet-task-builder taskType + title + tags', () => {
  it('defaults to freeform and sets title + tags (CSV) on the body', async () => {
    const { red, node } = setup({
      brief: 'b',
      title: 'Triage issue',
      tags: 'triage, issue-1',
    });
    const { outputs } = await red.input(node, { payload: {} });
    const payload = outputs[0].payload as Record<string, unknown>;
    expect(payload.taskType).toBe('freeform');
    expect(payload.title).toBe('Triage issue');
    expect(payload.tags).toEqual(['triage', 'issue-1']);
  });

  it('builds a non-freeform task type via the generic builder', async () => {
    const { red, node } = setup({ taskType: 'fulfill_brief', brief: 'do it' });
    const { outputs } = await red.input(node, { payload: {} });
    const payload = outputs[0].payload as Record<string, unknown>;
    expect(payload.taskType).toBe('fulfill_brief');
    expect((payload.input as { brief: string }).brief).toBe('do it');
  });

  it('lets msg.payload override the node taskType/title/tags', async () => {
    const { red, node } = setup({
      taskType: 'freeform',
      brief: 'b',
      title: 'node title',
      tags: 'node-tag',
    });
    const { outputs } = await red.input(node, {
      payload: { title: 'msg title', tags: ['msg-tag'] },
    } as Record<string, unknown>);
    const payload = outputs[0].payload as Record<string, unknown>;
    // msg wins, config fills gaps (mirrors tasks-create precedence).
    expect(payload.title).toBe('msg title');
    expect(payload.tags).toEqual(['msg-tag']);
  });

  it('omits title/tags when neither config nor msg set them', async () => {
    const { red, node } = setup({ taskType: 'freeform', brief: 'b' });
    const { outputs } = await red.input(node, { payload: {} });
    const payload = outputs[0].payload as Record<string, unknown>;
    expect(payload.title).toBeUndefined();
    expect(payload.tags).toBeUndefined();
  });
});
