import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  createMoltNetTools,
  type MoltNetTaskContext,
  type MoltNetToolsConfig,
} from './tools.js';

interface CapturedUpload {
  path: { taskId: string; attemptN: number };
  query: {
    kind: string;
    title: string;
    contentType: string;
    contentEncoding?: string;
  };
  options: { teamId: string };
}

function makeTaskContext(): MoltNetTaskContext {
  return {
    taskId: 'task-123',
    taskType: 'fulfill_brief',
    attemptN: 2,
    diaryId: 'diary-123',
    correlationId: null,
  };
}

function makeConfig(input: {
  captured?: CapturedUpload[];
  cwd: string;
  taskCtx?: MoltNetTaskContext | null;
  teamId?: string | null;
}): MoltNetToolsConfig {
  const captured = input.captured ?? [];
  const agent = {
    tasks: {
      artifacts: {
        upload: vi.fn(async (artifactPath, _body, query, options) => {
          captured.push({ path: artifactPath, query, options });
          return {
            id: 'artifact-1',
            teamId: options.teamId,
            taskId: artifactPath.taskId,
            attemptN: artifactPath.attemptN,
            kind: query.kind,
            title: query.title,
            contentType: query.contentType,
            contentEncoding: query.contentEncoding ?? null,
            sizeBytes: 5,
            sha256: 'a'.repeat(64),
            cid: 'bafkreia',
            createdByAgentId: 'agent-1',
            expiresAt: null,
            createdAt: '2026-06-27T10:00:00.000Z',
          };
        }),
        list: vi.fn(async () => [
          {
            id: 'artifact-1',
            cid: 'bafkreia',
            title: 'result.txt',
          },
        ]),
      },
    },
  };

  return {
    getAgent: () =>
      agent as unknown as ReturnType<MoltNetToolsConfig['getAgent']>,
    getDiaryId: () => 'diary-123',
    getTeamId: () => input.teamId ?? 'team-123',
    getSessionErrors: () => [],
    clearSessionErrors: () => {},
    getHostCwd: () => input.cwd,
    getTaskContext: () =>
      input.taskCtx === undefined ? makeTaskContext() : input.taskCtx,
  };
}

function findTool(config: MoltNetToolsConfig, name: string) {
  const tool = createMoltNetTools(config).find((t) => t.name === name);
  if (!tool) throw new Error(`${name} not registered`);
  return tool;
}

function callTool(
  tool: ReturnType<typeof findTool>,
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

describe('moltnet_upload_task_artifact', () => {
  it('uploads a workspace file to the active task attempt', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'moltnet-pi-artifact-'));
    const captured: CapturedUpload[] = [];
    try {
      await writeFile(path.join(cwd, 'result.txt'), 'hello');
      const tool = findTool(
        makeConfig({ captured, cwd }),
        'moltnet_upload_task_artifact',
      );

      const result = await callTool(tool, {
        filePath: 'result.txt',
        kind: 'report',
        title: 'result.txt',
        contentType: 'text/plain',
      });

      expect(captured).toEqual([
        {
          path: { taskId: 'task-123', attemptN: 2 },
          query: {
            kind: 'report',
            title: 'result.txt',
            contentType: 'text/plain',
            contentEncoding: undefined,
          },
          options: { teamId: 'team-123' },
        },
      ]);
      expect(JSON.stringify(result)).toContain('bafkreia');
    } finally {
      await rm(cwd, { force: true, recursive: true });
    }
  });

  it('rejects upload outside an active task attempt', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'moltnet-pi-artifact-'));
    try {
      await writeFile(path.join(cwd, 'result.txt'), 'hello');
      const tool = findTool(
        makeConfig({ cwd, taskCtx: null }),
        'moltnet_upload_task_artifact',
      );

      await expect(
        callTool(tool, {
          filePath: 'result.txt',
          kind: 'report',
          title: 'result.txt',
        }),
      ).rejects.toThrow(/active task attempt/i);
    } finally {
      await rm(cwd, { force: true, recursive: true });
    }
  });

  it('rejects paths escaping the workspace', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'moltnet-pi-artifact-'));
    const outside = await mkdtemp(path.join(tmpdir(), 'moltnet-pi-outside-'));
    try {
      await writeFile(path.join(outside, 'secret.txt'), 'hello');
      const tool = findTool(
        makeConfig({ cwd }),
        'moltnet_upload_task_artifact',
      );

      await expect(
        callTool(tool, {
          filePath: path.join(outside, 'secret.txt'),
          kind: 'report',
          title: 'secret.txt',
        }),
      ).rejects.toThrow(/escapes workspace/i);
    } finally {
      await rm(cwd, { force: true, recursive: true });
      await rm(outside, { force: true, recursive: true });
    }
  });
});
