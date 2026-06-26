import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';

import type { Task } from '@moltnet/tasks';

import type { RuntimeSlotStore } from './execution-plan-cache.js';
import {
  resolveParentRuntimeSession,
  resolveRuntimeSessionKind,
  type RuntimeSessionStore,
} from './runtime-sessions.js';
import { resolveLatestPiSessionPath } from './session-files.js';

export interface RuntimeSessionSyncInput {
  agentName: string;
  dryRun?: boolean;
  limit?: number;
  runtimeProfileId?: string;
  sessionRootDir?: string;
  state?: 'active' | 'idle';
  teamId: string;
}

export interface RuntimeSessionSyncDeps {
  runtimeSessionStore: RuntimeSessionStore;
  runtimeSlotStore: RuntimeSlotStore;
  taskReader: {
    get(taskId: string): Promise<Task>;
  };
}

export interface RuntimeSessionSyncResult {
  alreadyCurrent: number;
  failedUpload: number;
  missingLocalFile: number;
  scanned: number;
  unsafeSessionPath: number;
  uploaded: number;
  wouldUpload: number;
}

export async function syncRuntimeSessions(
  deps: RuntimeSessionSyncDeps,
  input: RuntimeSessionSyncInput,
): Promise<RuntimeSessionSyncResult> {
  const result: RuntimeSessionSyncResult = {
    alreadyCurrent: 0,
    failedUpload: 0,
    missingLocalFile: 0,
    scanned: 0,
    unsafeSessionPath: 0,
    uploaded: 0,
    wouldUpload: 0,
  };
  const slots = await deps.runtimeSlotStore.listSlots({
    agentName: input.agentName,
    limit: input.limit,
    runtimeProfileId: input.runtimeProfileId,
    state: input.state,
    teamId: input.teamId,
  });

  for (const slot of slots) {
    result.scanned++;
    if (!slot.session?.sessionDir) {
      result.missingLocalFile++;
      continue;
    }
    if (
      input.sessionRootDir &&
      !(await isPathInsideRoot(slot.session.sessionDir, input.sessionRootDir))
    ) {
      result.unsafeSessionPath++;
      continue;
    }
    const sessionPath = resolveLatestPiSessionPath(slot.session.sessionDir);
    if (!sessionPath || !(await fileExists(sessionPath))) {
      result.missingLocalFile++;
      continue;
    }

    const remote =
      await deps.runtimeSessionStore.findRuntimeSessionByTaskAttempt(
        input.teamId,
        slot.slot.lastTaskId,
        slot.slot.lastAttemptN,
      );
    if (remote) {
      const local = await computeCompressedSessionFingerprint(sessionPath);
      if (remote.sha256 === local.sha256 && remote.sizeBytes === local.bytes) {
        result.alreadyCurrent++;
        continue;
      }
    }

    if (input.dryRun) {
      result.wouldUpload++;
      continue;
    }

    try {
      const task = await deps.taskReader.get(slot.slot.lastTaskId);
      const claim = {
        attemptN: slot.slot.lastAttemptN,
        task: {
          id: task.id,
          input: task.input,
          teamId: input.teamId,
        },
      };
      const parent = await resolveParentRuntimeSession(
        deps.runtimeSessionStore,
        claim,
      );
      await deps.runtimeSessionStore.uploadAttemptFinal({
        attemptN: slot.slot.lastAttemptN,
        parentSessionId: parent?.id ?? null,
        sessionDir: slot.session.sessionDir,
        sessionKind: resolveRuntimeSessionKind(claim),
        sourceRuntimeProfileId: slot.slot.runtimeProfileId,
        sourceSlotId: slot.slot.id,
        taskId: slot.slot.lastTaskId,
        teamId: input.teamId,
      });
      result.uploaded++;
    } catch {
      result.failedUpload++;
    }
  }

  return result;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}

async function isPathInsideRoot(path: string, root: string): Promise<boolean> {
  const resolvedPath = resolve(path);
  const resolvedRoot = resolve(root);
  if (!isResolvedPathInsideRoot(resolvedPath, resolvedRoot)) return false;
  let realResolvedPath: string;
  let realResolvedRoot: string;
  try {
    [realResolvedPath, realResolvedRoot] = await Promise.all([
      realpath(path),
      realpath(root),
    ]);
  } catch {
    return true;
  }
  return isResolvedPathInsideRoot(realResolvedPath, realResolvedRoot);
}

function isResolvedPathInsideRoot(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

async function computeCompressedSessionFingerprint(
  path: string,
): Promise<{ bytes: number; sha256: string }> {
  const hash = createHash('sha256');
  let bytes = 0;
  const sink = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      bytes += chunk.byteLength;
      hash.update(chunk);
      callback();
    },
  });
  await pipeline(createReadStream(path), createGzip(), sink);
  return { bytes, sha256: hash.digest('hex') };
}
