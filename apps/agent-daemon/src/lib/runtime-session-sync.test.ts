import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';

import type { Task } from '@moltnet/tasks';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  ListedRuntimeSlotContext,
  RuntimeSlotStore,
} from './execution-plan-cache.js';
import { syncRuntimeSessions } from './runtime-session-sync.js';
import type { RuntimeSessionStore } from './runtime-sessions.js';

const gzipAsync = promisify(gzip);

const TEAM_ID = '99999999-9999-4999-8999-999999999999';
const TASK_ID = '11111111-1111-4111-8111-111111111111';
const PROFILE_ID = '22222222-2222-4222-8222-222222222222';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((dir) => rm(dir, { force: true, recursive: true })),
  );
});

describe('syncRuntimeSessions', () => {
  it('uploads missing remote sessions from local slot files', async () => {
    const sessionDir = await makeSessionDir('session-a.jsonl', '{"ok":true}\n');
    const uploadAttemptFinal = vi.fn().mockResolvedValue(undefined);

    const result = await syncRuntimeSessions(
      makeDeps({
        sessionDir,
        remote: null,
        uploadAttemptFinal,
      }),
      { agentName: 'legreffier', teamId: TEAM_ID },
    );

    expect(result).toEqual({
      alreadyCurrent: 0,
      failedUpload: 0,
      missingLocalFile: 0,
      scanned: 1,
      uploaded: 1,
      wouldUpload: 0,
    });
    expect(uploadAttemptFinal).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptN: 1,
        sessionDir,
        sessionKind: 'root',
        sourceRuntimeProfileId: PROFILE_ID,
        taskId: TASK_ID,
        teamId: TEAM_ID,
      }),
    );
  });

  it('reports missing local session files without uploading', async () => {
    const uploadAttemptFinal = vi.fn();

    const result = await syncRuntimeSessions(
      makeDeps({
        sessionDir: join(tmpdir(), 'moltnet-missing-session-dir'),
        remote: null,
        uploadAttemptFinal,
      }),
      { agentName: 'legreffier', teamId: TEAM_ID },
    );

    expect(result.missingLocalFile).toBe(1);
    expect(uploadAttemptFinal).not.toHaveBeenCalled();
  });

  it('skips already-current remote sessions', async () => {
    const content = '{"ok":"current"}\n';
    const sessionDir = await makeSessionDir('session-current.jsonl', content);
    const fingerprint = await compressedFingerprint(content);
    const uploadAttemptFinal = vi.fn();

    const result = await syncRuntimeSessions(
      makeDeps({
        sessionDir,
        remote: {
          id: 'session-1',
          sha256: fingerprint.sha256,
          sizeBytes: fingerprint.bytes,
        },
        uploadAttemptFinal,
      }),
      { agentName: 'legreffier', teamId: TEAM_ID },
    );

    expect(result.alreadyCurrent).toBe(1);
    expect(uploadAttemptFinal).not.toHaveBeenCalled();
  });

  it('counts stale sessions in dry-run mode', async () => {
    const sessionDir = await makeSessionDir('session-stale.jsonl', '{}\n');
    const uploadAttemptFinal = vi.fn();

    const result = await syncRuntimeSessions(
      makeDeps({
        sessionDir,
        remote: {
          id: 'session-1',
          sha256: '0'.repeat(64),
          sizeBytes: 1,
        },
        uploadAttemptFinal,
      }),
      { agentName: 'legreffier', dryRun: true, teamId: TEAM_ID },
    );

    expect(result.wouldUpload).toBe(1);
    expect(uploadAttemptFinal).not.toHaveBeenCalled();
  });
});

function makeDeps(input: {
  remote: { id: string; sha256: string; sizeBytes: number } | null;
  sessionDir: string;
  uploadAttemptFinal: RuntimeSessionStore['uploadAttemptFinal'];
}) {
  const slot = {
    slot: {
      expiresAtMs: Date.now() + 1000,
      id: 'slot-1',
      lastAttemptN: 1,
      lastTaskId: TASK_ID,
      runtimeProfileId: PROFILE_ID,
      taskType: 'freeform',
    },
    session: {
      sessionDir: input.sessionDir,
      sessionPath: null,
    },
    workspace: null,
  } satisfies ListedRuntimeSlotContext;
  const runtimeSlotStore = {
    listSlots: vi.fn().mockResolvedValue([slot]),
  } as unknown as RuntimeSlotStore;
  const runtimeSessionStore = {
    findRuntimeSessionByTaskAttempt: vi.fn().mockResolvedValue(input.remote),
    hydrateSession: vi.fn(),
    uploadAttemptFinal: input.uploadAttemptFinal,
  } as unknown as RuntimeSessionStore;
  return {
    runtimeSessionStore,
    runtimeSlotStore,
    taskReader: {
      get: vi.fn().mockResolvedValue({
        id: TASK_ID,
        input: { brief: 'sync me' },
      } as unknown as Task),
    },
  };
}

async function makeSessionDir(name: string, content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'moltnet-session-sync-'));
  tempRoots.push(dir);
  await writeFile(join(dir, name), content);
  return dir;
}

async function compressedFingerprint(
  content: string,
): Promise<{ bytes: number; sha256: string }> {
  const compressed = await gzipAsync(content);
  return {
    bytes: compressed.byteLength,
    sha256: createHash('sha256').update(compressed).digest('hex'),
  };
}
