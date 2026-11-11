import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';

import { baselineDataset } from '../src/dataset.js';
import { screenEntry } from '../src/review/screening.js';
afterEach(() => vi.unstubAllGlobals());
it('refuses remote model routing and retains a bounded failure record', async () => {
  const root = await mkdtemp(join(tmpdir(), 'review-screen-unit-'));
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve({
        models: [
          {
            name: 'nimble:latest',
            digest: 'test',
            remote_host: 'https://example.com',
          },
        ],
      }),
  });
  vi.stubGlobal('fetch', fetchMock);
  const record = await screenEntry(baselineDataset().entries[0], root);
  expect(record.error).toBe('Screening requires a local model');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(await readdir(join(root, 'screening'))).toEqual([`${record.id}.json`]);
});
it('rejects malformed probabilities instead of reporting a clear screen', async () => {
  const root = await mkdtemp(join(tmpdir(), 'review-screen-unit-'));
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            models: [{ name: 'nimble:latest', digest: 'test' }],
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            answers: { credentials: { type: 'noul', noul: 2 } },
          }),
      }),
  );
  const record = await screenEntry(baselineDataset().entries[0], root);
  expect(record.error).toBe('Invalid local classifier probability');
});
