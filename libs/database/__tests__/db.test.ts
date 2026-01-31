import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('db module', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.DATABASE_URL;
  });

  it('does not throw on import when DATABASE_URL is missing', async () => {
    // The module should import without error — lazy init means no connection
    await expect(import('../src/db.js')).resolves.toBeDefined();
  });

  it('getDatabase throws if DATABASE_URL is not set', async () => {
    const { getDatabase } = await import('../src/db.js');
    expect(() => getDatabase()).toThrow(
      'DATABASE_URL environment variable is required',
    );
  });

  it('exports createDatabase factory', async () => {
    const { createDatabase } = await import('../src/db.js');
    expect(typeof createDatabase).toBe('function');
  });
});
