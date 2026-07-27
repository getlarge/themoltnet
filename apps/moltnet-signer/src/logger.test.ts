import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSignerLogger } from './logger.js';

describe('createSignerLogger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('serializes only allowlisted operational fields', () => {
    const write = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    const logger = createSignerLogger();

    logger.error('ceremony.failed', {
      ceremonyId: 'ceremony-1',
      code: 'device_timeout',
      operation: 'sign',
      ...({
        digest: 'secret-digest',
        envelope: 'secret-envelope',
        signature: 'secret-signature',
      } as object),
    });

    const entry = JSON.parse(String(write.mock.calls[0]?.[0])) as Record<
      string,
      unknown
    >;
    expect(entry).toMatchObject({
      level: 'error',
      event: 'ceremony.failed',
      ceremonyId: 'ceremony-1',
      code: 'device_timeout',
      operation: 'sign',
    });
    expect(entry).not.toHaveProperty('digest');
    expect(entry).not.toHaveProperty('envelope');
    expect(entry).not.toHaveProperty('signature');
  });
});
