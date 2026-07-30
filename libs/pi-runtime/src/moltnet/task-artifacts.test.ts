import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import {
  createGondolinToolDefinitions,
  resolveTaskWorktreePath,
} from '../runtime/execute-pi-task.js';
import {
  createMoltNetTools,
  type MoltNetTaskContext,
  type MoltNetToolsConfig,
} from './tools.js';

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABmJLR0QA/wD/AP+gvaeTAAABi0lEQVQ4jdWSv0tbYRSGn3MTok1RnCQoRFsKoYNQiktF3DREKHV0cLR7wYJj7VaH0NGhg39EkMQGaQgSpbUaCcErSixB2nQJdSghTc79nPTmxoSAW9/p4/x4zvvCB/+PjBF2Py9zkAi2lq3bV+X4IefHGc6+L3UEJJMBhFX++ndIuBAXUPfHsSSML5DuCJifr+OzphEJMWjFvc2K/YhyUSkVZntGySajZLYa7GyNuQ4cXoGUeDzhuX66Obz2J/X0gwcwE9sGuQTnZWuECCL59mXEvANW70CEIyyJAPgBMOKA8cxUr+o1QRjoryJiarQRMEZcgE9sjIm2jrx4c7W+93HogTHCyOLv9237z8DKuIVfJ+Nc2g3KhTl6KZeOkk01SSfC3sZPe4Ny8YKLYqjr8tcvIXLpEtnUxk3J/QcMroBUQHOc5e86+ZaJYcw+UCHYWHHTeFwcBKn3xVF9jeoP1CmgTQfV56iOovqJZv9bpqZqnQE3Kh2O8c9ZQPUJxoFG00YlweR0uWu8++oaz1SX517RnkIAAAAASUVORK5CYII=',
  'base64',
);

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

type CapturedDownloadPath =
  | { taskId: string; attemptN: number; cid: string }
  | { taskId: string; cid: string };

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
  capturedDownloads?: CapturedDownloadPath[];
  cwd: string;
  downloadBody?: Buffer | string;
  downloadContentType?: string;
  taskCtx?: MoltNetTaskContext | null;
  teamId?: string | null;
  openWorkspaceFileForRead?: MoltNetToolsConfig['openWorkspaceFileForRead'];
}): MoltNetToolsConfig {
  const captured = input.captured ?? [];
  const capturedDownloads = input.capturedDownloads ?? [];
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
        listPage: vi.fn(async () => ({
          artifacts: [
            {
              id: 'artifact-1',
              cid: 'bafkreia',
              title: 'result.txt',
            },
          ],
          nextCursor: null,
        })),
        download: vi.fn(async (artifactPath: CapturedDownloadPath) => {
          capturedDownloads.push(artifactPath);
          return {
            artifactId: 'artifact-1',
            cid: 'bafkreia',
            contentEncoding: null,
            contentType: input.downloadContentType ?? 'text/plain',
            sha256: 'a'.repeat(64),
            stream: Readable.from([input.downloadBody ?? 'artifact bytes']),
          };
        }),
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
    openWorkspaceFileForRead: input.openWorkspaceFileForRead,
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

  it('uploads a guest-backed workspace file when provided by the VM reader', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'moltnet-pi-artifact-'));
    const captured: CapturedUpload[] = [];
    try {
      const openWorkspaceFileForRead = vi.fn(async (filePath: string) => {
        expect(filePath).toBe('review.patch');
        return {
          stream: Readable.from(['diff --git a/file b/file\n']),
          isFile: true,
        };
      });
      const tool = findTool(
        makeConfig({ captured, cwd, openWorkspaceFileForRead }),
        'moltnet_upload_task_artifact',
      );

      const result = await callTool(tool, {
        filePath: 'review.patch',
        kind: 'patch',
        title: 'review.patch',
        contentType: 'text/x-diff',
      });

      expect(openWorkspaceFileForRead).toHaveBeenCalledWith('review.patch');
      expect(captured).toEqual([
        {
          path: { taskId: 'task-123', attemptN: 2 },
          query: {
            kind: 'patch',
            title: 'review.patch',
            contentType: 'text/x-diff',
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

  it('rejects missing workspace files with an actionable error', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'moltnet-pi-artifact-'));
    try {
      const tool = findTool(
        makeConfig({ cwd }),
        'moltnet_upload_task_artifact',
      );

      await expect(
        callTool(tool, {
          filePath: 'missing.patch',
          kind: 'patch',
          title: 'missing.patch',
        }),
      ).rejects.toThrow(/input path does not exist/i);
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

  it('rejects symlinks escaping the workspace', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'moltnet-pi-artifact-'));
    const outside = await mkdtemp(path.join(tmpdir(), 'moltnet-pi-outside-'));
    try {
      await writeFile(path.join(outside, 'secret.txt'), 'hello');
      await symlink(path.join(outside, 'secret.txt'), path.join(cwd, 'leak'));
      const tool = findTool(
        makeConfig({ cwd }),
        'moltnet_upload_task_artifact',
      );

      await expect(
        callTool(tool, {
          filePath: 'leak',
          kind: 'report',
          title: 'leak',
        }),
      ).rejects.toThrow(/escapes workspace/i);
    } finally {
      await rm(cwd, { force: true, recursive: true });
      await rm(outside, { force: true, recursive: true });
    }
  });
});

describe('moltnet_list_task_artifacts', () => {
  it('returns a paginated artifact page', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'moltnet-pi-artifact-'));
    try {
      const tool = findTool(makeConfig({ cwd }), 'moltnet_list_task_artifacts');

      const result = await callTool(tool, {
        limit: 1,
        cursor: 'cursor-1',
      });
      const item = result.content[0];
      expect(item.type).toBe('text');
      const page = JSON.parse('text' in item ? item.text : '') as {
        artifacts: unknown[];
        nextCursor: string | null;
      };

      expect(page.artifacts).toHaveLength(1);
      expect(page.nextCursor).toBeNull();
    } finally {
      await rm(cwd, { force: true, recursive: true });
    }
  });
});

describe('moltnet_download_task_artifact', () => {
  it('downloads artifact content into a new workspace file', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'moltnet-pi-artifact-'));
    const capturedDownloads: CapturedDownloadPath[] = [];
    try {
      const tool = findTool(
        makeConfig({ cwd, capturedDownloads }),
        'moltnet_download_task_artifact',
      );

      const result = await callTool(tool, {
        attemptN: 2,
        cid: 'bafkreia',
        outputPath: 'scratch/inputs/result.txt',
      });

      await expect(
        readFile(path.join(cwd, 'scratch/inputs/result.txt'), 'utf8'),
      ).resolves.toBe('artifact bytes');
      expect(JSON.stringify(result)).toContain('result.txt');
      expect(JSON.stringify(result)).toContain('artifact-1');
      expect(capturedDownloads).toEqual([
        { taskId: 'task-123', attemptN: 2, cid: 'bafkreia' },
      ]);
    } finally {
      await rm(cwd, { force: true, recursive: true });
    }
  });

  it('downloads a bound input artifact without an attempt number', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'moltnet-pi-artifact-'));
    const capturedDownloads: CapturedDownloadPath[] = [];
    try {
      await mkdir(path.join(cwd, 'inputs'));
      const tool = findTool(
        makeConfig({ cwd, capturedDownloads }),
        'moltnet_download_task_artifact',
      );

      const result = await callTool(tool, {
        cid: 'bafkreiinput',
        outputPath: 'inputs/brief.pdf',
      });

      await expect(
        readFile(path.join(cwd, 'inputs/brief.pdf'), 'utf8'),
      ).resolves.toBe('artifact bytes');
      expect(capturedDownloads).toEqual([
        { taskId: 'task-123', cid: 'bafkreiinput' },
      ]);
      const content = result.content[0];
      expect(content?.type).toBe('text');
      if (!content || content.type !== 'text') {
        throw new Error('expected text tool output');
      }
      expect(JSON.parse(content.text)).not.toHaveProperty('attemptN');
    } finally {
      await rm(cwd, { force: true, recursive: true });
    }
  });

  it.each([
    { name: 'shared mount', worktree: false },
    { name: 'dedicated worktree', worktree: true },
  ])(
    'keeps bound image reads and relative writes in the active $name cwd',
    async ({ worktree }) => {
      const mountPath = await mkdtemp(
        path.join(tmpdir(), 'moltnet-pi-artifact-'),
      );
      const cwdPath = worktree
        ? resolveTaskWorktreePath(mountPath, 'task-1624')
        : mountPath;
      const artifactPath = path.join(cwdPath, 'inputs', 'inspection.png');
      const writePath = path.join(cwdPath, 'outputs', 'analysis.txt');
      const capturedDownloads: CapturedDownloadPath[] = [];
      const vmAccess = vi.fn((filePath: string) => access(filePath));
      const vmReadFile = vi.fn((filePath: string) => readFile(filePath));
      const vmExec = vi.fn((_command: string[]) =>
        Promise.resolve({
          exitCode: 0,
          ok: true,
          stderr: '',
          stdout: 'image/png\n',
        }),
      );
      const vm = {
        exec: vmExec,
        fs: {
          access: vmAccess,
          readFile: vmReadFile,
        },
      };

      try {
        await mkdir(path.dirname(artifactPath), { recursive: true });
        const downloadTool = findTool(
          makeConfig({
            capturedDownloads,
            cwd: cwdPath,
            downloadBody: PNG_BYTES,
            downloadContentType: 'image/png',
          }),
          'moltnet_download_task_artifact',
        );

        await callTool(downloadTool, {
          cid: 'bafkreiinput',
          outputPath: 'inputs/inspection.png',
        });

        const toolConfig = {
          vm: vm as never,
          cwdPath,
          guestWorkspace: mountPath,
        };
        const readTool = createGondolinToolDefinitions(toolConfig).find(
          (tool) => tool.name === 'read',
        );
        if (!readTool) throw new Error('read tool not registered');

        const result = await readTool.execute(
          'call-id',
          { path: 'inputs/inspection.png' },
          new AbortController().signal,
          () => {},
          null as never,
        );
        const writeTool = createGondolinToolDefinitions(toolConfig).find(
          (tool) => tool.name === 'write',
        );
        if (!writeTool) throw new Error('write tool not registered');

        await writeTool.execute(
          'call-id',
          {
            content: 'analysis complete',
            path: 'outputs/analysis.txt',
          },
          new AbortController().signal,
          () => {},
          null as never,
        );

        await expect(readFile(artifactPath)).resolves.toEqual(PNG_BYTES);
        expect(capturedDownloads).toEqual([
          { taskId: 'task-123', cid: 'bafkreiinput' },
        ]);
        expect(vmAccess).toHaveBeenCalledWith(artifactPath);
        expect(vmReadFile).toHaveBeenCalledWith(artifactPath);
        const execCommands = vmExec.mock.calls.map(([command]) =>
          command.join('\n'),
        );
        expect(execCommands).toEqual(
          expect.arrayContaining([expect.stringContaining(writePath)]),
        );
        expect(result.content).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              text: expect.stringContaining('Read image file [image/png]'),
              type: 'text',
            }),
            expect.objectContaining({
              data: expect.stringMatching(/.+/),
              mimeType: 'image/png',
              type: 'image',
            }),
          ]),
        );
        // Shared mount is the equal-path control; worktree is the divergence.
        if (worktree) {
          const lossyMountPath = path.join(
            mountPath,
            'inputs',
            'inspection.png',
          );
          expect(vmAccess).not.toHaveBeenCalledWith(lossyMountPath);
          expect(vmReadFile).not.toHaveBeenCalledWith(lossyMountPath);
          expect(execCommands.join('\n')).not.toContain(
            path.join(mountPath, 'outputs', 'analysis.txt'),
          );
        }
      } finally {
        await rm(mountPath, { force: true, recursive: true });
      }
    },
  );

  it('rejects download paths escaping the workspace', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'moltnet-pi-artifact-'));
    const outside = await mkdtemp(path.join(tmpdir(), 'moltnet-pi-outside-'));
    try {
      const tool = findTool(
        makeConfig({ cwd }),
        'moltnet_download_task_artifact',
      );

      await expect(
        callTool(tool, {
          attemptN: 2,
          cid: 'bafkreia',
          outputPath: path.join(outside, 'result.txt'),
        }),
      ).rejects.toThrow(/escapes workspace/i);
    } finally {
      await rm(cwd, { force: true, recursive: true });
      await rm(outside, { force: true, recursive: true });
    }
  });

  it('rejects a missing child beneath a symlink that escapes the workspace', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'moltnet-pi-artifact-'));
    const outside = await mkdtemp(path.join(tmpdir(), 'moltnet-pi-outside-'));
    try {
      await symlink(outside, path.join(cwd, 'outside-link'));
      const tool = findTool(
        makeConfig({ cwd }),
        'moltnet_download_task_artifact',
      );

      await expect(
        callTool(tool, {
          attemptN: 2,
          cid: 'bafkreia',
          outputPath: 'outside-link/nested/result.txt',
        }),
      ).rejects.toThrow(/escapes workspace/i);
      await expect(access(path.join(outside, 'nested'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      await rm(cwd, { force: true, recursive: true });
      await rm(outside, { force: true, recursive: true });
    }
  });
});
