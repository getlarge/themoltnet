/**
 * Tests for the task-context enforcement on `moltnet_create_entry`.
 *
 * Issue #979: during an active task, the tool must (1) force the entry into
 * the task diary regardless of the env-derived diary, (2) reject explicit
 * `diaryId` parameters that mismatch the task diary, (3) inject provenance
 * tags. Outside a task, behaviour is unchanged.
 */

import { describe, expect, it } from 'vitest';

import {
  createMoltNetTools,
  type MoltNetTaskContext,
  type MoltNetToolsConfig,
} from './tools.js';

interface CapturedCreate {
  diaryId: string;
  body: {
    title: string;
    content: string;
    tags: string[];
    importance: number;
  };
}

interface FakeAgent {
  entries: {
    create: (
      diaryId: string,
      body: CapturedCreate['body'],
    ) => Promise<{ id: string; title: string; createdAt: string }>;
  };
  packs: unknown;
}

function makeFakeAgent(captured: CapturedCreate[]) {
  const agent: FakeAgent = {
    entries: {
      create: async (diaryId, body) => {
        captured.push({ diaryId, body });
        return {
          id: 'entry-fake',
          title: body.title,
          createdAt: '2026-04-29T00:00:00Z',
        };
      },
    },
    packs: {},
  };
  return agent;
}

function configFor(
  agent: FakeAgent,
  envDiaryId: string | null,
  taskCtx: MoltNetTaskContext | null,
): MoltNetToolsConfig {
  return {
    getAgent: () =>
      agent as unknown as ReturnType<MoltNetToolsConfig['getAgent']>,
    getDiaryId: () => envDiaryId,
    getTeamId: () => null,
    getSessionErrors: () => [],
    clearSessionErrors: () => {},
    getTaskContext: () => taskCtx,
  };
}

function findCreateEntryTool(config: MoltNetToolsConfig) {
  const tools = createMoltNetTools(config);
  const tool = tools.find((t) => t.name === 'moltnet_create_entry');
  if (!tool) throw new Error('moltnet_create_entry not registered');
  return tool;
}

// Adapter — pi tool.execute takes (toolCallId, params, signal, onProgress, ctx).
function callExecute(
  tool: ReturnType<typeof findCreateEntryTool>,
  params: Record<string, unknown>,
) {
  return tool.execute(
    'call-id',
    params as Parameters<typeof tool.execute>[1],
    new AbortController().signal,
    () => {},
    null as unknown as Parameters<typeof tool.execute>[4],
  );
}

describe('moltnet_create_entry — task-context enforcement', () => {
  const taskCtx: MoltNetTaskContext = {
    taskId: 'task-123',
    taskType: 'fulfill_brief',
    attemptN: 2,
    diaryId: 'task-diary',
  };

  it('lands the entry in the task diary even when env diary differs', async () => {
    // Arrange
    const captured: CapturedCreate[] = [];
    const agent = makeFakeAgent(captured);
    const config = configFor(agent, 'env-diary', taskCtx);
    const tool = findCreateEntryTool(config);

    // Act
    await callExecute(tool, {
      title: 'hello',
      content: 'body',
    });

    // Assert
    expect(captured).toHaveLength(1);
    expect(captured[0].diaryId).toBe('task-diary');
  });

  it('rejects an explicit diaryId mismatching the task diary', async () => {
    // Arrange
    const captured: CapturedCreate[] = [];
    const agent = makeFakeAgent(captured);
    const config = configFor(agent, 'task-diary', taskCtx);
    const tool = findCreateEntryTool(config);

    // Act / Assert
    await expect(
      callExecute(tool, {
        title: 'hello',
        content: 'body',
        diaryId: 'some-other-diary',
      }),
    ).rejects.toThrow(/does not match the active task diary/);
    expect(captured).toHaveLength(0);
  });

  it('accepts an explicit diaryId equal to the task diary', async () => {
    // Arrange
    const captured: CapturedCreate[] = [];
    const agent = makeFakeAgent(captured);
    const config = configFor(agent, 'env-diary', taskCtx);
    const tool = findCreateEntryTool(config);

    // Act
    await callExecute(tool, {
      title: 'hello',
      content: 'body',
      diaryId: 'task-diary',
    });

    // Assert
    expect(captured[0].diaryId).toBe('task-diary');
  });

  it('injects task / task_type / attempt provenance tags during a task', async () => {
    // Arrange
    const captured: CapturedCreate[] = [];
    const agent = makeFakeAgent(captured);
    const config = configFor(agent, 'env-diary', taskCtx);
    const tool = findCreateEntryTool(config);

    // Act
    await callExecute(tool, {
      title: 'hello',
      content: 'body',
      tags: ['custom-tag'],
    });

    // Assert
    expect(captured[0].body.tags).toEqual([
      'task:task-123',
      'task_type:fulfill_brief',
      'task_attempt:2',
      'custom-tag',
    ]);
  });

  it('does not duplicate an auto-tag the agent supplied explicitly', async () => {
    // Arrange
    const captured: CapturedCreate[] = [];
    const agent = makeFakeAgent(captured);
    const config = configFor(agent, 'env-diary', taskCtx);
    const tool = findCreateEntryTool(config);

    // Act
    await callExecute(tool, {
      title: 'hello',
      content: 'body',
      tags: ['task:task-123', 'extra'],
    });

    // Assert
    expect(captured[0].body.tags).toEqual([
      'task:task-123',
      'task_type:fulfill_brief',
      'task_attempt:2',
      'extra',
    ]);
  });
});

describe('moltnet_create_entry — interactive (no task context)', () => {
  it('uses the env-derived diary when no task context is set', async () => {
    // Arrange
    const captured: CapturedCreate[] = [];
    const agent = makeFakeAgent(captured);
    const config = configFor(agent, 'env-diary', null);
    const tool = findCreateEntryTool(config);

    // Act
    await callExecute(tool, { title: 'hello', content: 'body' });

    // Assert
    expect(captured[0].diaryId).toBe('env-diary');
    expect(captured[0].body.tags).toEqual([]);
  });

  it('honours an explicit diaryId override outside a task', async () => {
    // Arrange
    const captured: CapturedCreate[] = [];
    const agent = makeFakeAgent(captured);
    const config = configFor(agent, 'env-diary', null);
    const tool = findCreateEntryTool(config);

    // Act
    await callExecute(tool, {
      title: 'hello',
      content: 'body',
      diaryId: 'override-diary',
    });

    // Assert
    expect(captured[0].diaryId).toBe('override-diary');
  });

  it('does not inject provenance tags outside a task', async () => {
    // Arrange
    const captured: CapturedCreate[] = [];
    const agent = makeFakeAgent(captured);
    const config = configFor(agent, 'env-diary', null);
    const tool = findCreateEntryTool(config);

    // Act
    await callExecute(tool, {
      title: 'hello',
      content: 'body',
      tags: ['user-tag'],
    });

    // Assert
    expect(captured[0].body.tags).toEqual(['user-tag']);
  });
});
