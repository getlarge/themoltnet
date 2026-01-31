import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('db module', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('does not throw on import', async () => {
    // The module should import without error — lazy init means no connection
    await expect(import('../src/db.js')).resolves.toBeDefined();
  });

  it('getDatabase throws if url is not provided', async () => {
    const { getDatabase } = await import('../src/db.js');
    expect(() => getDatabase()).toThrow(
      'DATABASE_URL must be provided on first call to getDatabase()',
    );
  });

  it('exports createDatabase factory', async () => {
    const { createDatabase } = await import('../src/db.js');
    expect(typeof createDatabase).toBe('function');
  });
});
