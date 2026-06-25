import { Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import {
  createRuntimeSessionStorage,
  RuntimeSessionStorageNotConfiguredError,
} from './runtime-session-storage.js';

describe('createRuntimeSessionStorage', () => {
  it('returns a disabled storage adapter when S3 credentials are incomplete', async () => {
    const storage = createRuntimeSessionStorage({
      RUNTIME_SESSION_STORAGE_BUCKET: 'runtime-sessions',
      RUNTIME_SESSION_STORAGE_FORCE_PATH_STYLE: true,
      RUNTIME_SESSION_STORAGE_REGION: 'auto',
    });

    await expect(
      storage.putObject({
        body: Readable.from(['content']),
        contentType: 'application/x-ndjson',
        key: 'sessions/test.jsonl.gz',
      }),
    ).rejects.toBeInstanceOf(RuntimeSessionStorageNotConfiguredError);
    await expect(
      storage.getObject('sessions/test.jsonl.gz'),
    ).rejects.toBeInstanceOf(RuntimeSessionStorageNotConfiguredError);
    await expect(
      storage.deleteObject('sessions/test.jsonl.gz'),
    ).rejects.toBeInstanceOf(RuntimeSessionStorageNotConfiguredError);
  });
});
