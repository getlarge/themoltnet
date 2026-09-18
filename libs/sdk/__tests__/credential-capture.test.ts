import type * as FsPromises from 'node:fs/promises';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { prepareCredentialPersistence } from '../src/credential-persistence.js';

const injection = vi.hoisted(() => ({ point: '' }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const file = await actual.open(...args);
      const write = file.writeFile.bind(file);
      const close = file.close.bind(file);
      if (injection.point === 'write')
        file.writeFile = async (...values) => {
          await write(...values);
          throw new Error('injected issued-secret');
        };
      if (injection.point === 'sync')
        file.sync = async () => {
          throw new Error('injected issued-secret');
        };
      if (injection.point === 'close')
        file.close = async () => {
          await close();
          throw new Error('injected issued-secret');
        };
      return file;
    },
  };
});
const directories: string[] = [];
afterEach(async () => {
  injection.point = '';
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
describe('capture failure recovery', () => {
  it.each(['write', 'sync', 'close'])(
    'reports a protected candidate after %s failure',
    async (point) => {
      const dir = await mkdtemp(join(tmpdir(), 'sdk-capture-'));
      directories.push(dir);
      injection.point = point;
      const recovery = await prepareCredentialPersistence(dir);
      const failure = await recovery
        .capture(
          { provider: 'file', key: 'agent-key/subject' },
          'issued-secret',
          { subjectId: 'subject' },
        )
        .catch((error: unknown) => error);
      expect(failure).toMatchObject({
        code: 'CREDENTIAL_PERSISTENCE_FAILED',
        recoveryPath: recovery.path,
      });
      expect(recovery.recoveryPath).toBe(recovery.path);
      expect((await stat(recovery.path)).mode & 0o777).toBe(0o600);
      expect(JSON.parse(await readFile(recovery.path, 'utf8')).secret).toBe(
        'issued-secret',
      );
      expect(String(failure)).not.toContain('issued-secret');
      expect(JSON.stringify(failure)).not.toContain('issued-secret');
    },
  );
});
