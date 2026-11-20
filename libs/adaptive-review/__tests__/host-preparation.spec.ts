import { describe, expect, it, vi } from 'vitest';

import { reuseHostPreparation } from '../src/host-preparation.js';
import { hostTimeoutSeconds } from '../src/host-settings.js';
import type { StandaloneReviewServices } from '../src/standalone.js';

it('reuses host preparation across wakes but refreshes currency and retries failed preparation', async () => {
  vi.useFakeTimers();
  try {
    const profiles = vi.fn(async () => []);
    const connect = vi.fn(async () => ({ profiles }));
    const revisions = vi.fn(async () => ({ base: 'base', head: 'head' }));
    const ensureGit = vi.fn(async () => {});
    const services = reuseHostPreparation({
      github: { revisions },
      connect,
      ensureGit,
    } as unknown as StandaloneReviewServices);
    const prepared = { base: 'base', head: 'head' } as Parameters<
      typeof services.ensureGit
    >[0];
    await services.ensureGit(prepared);
    await services.ensureGit(prepared);
    const client = await services.connect('team');
    expect(await services.connect('team')).toBe(client);
    await client.profiles('team');
    await client.profiles('team');
    await services.github.revisions('repo', 1);
    await services.github.revisions('repo', 1);
    expect(ensureGit).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(profiles).toHaveBeenCalledTimes(1);
    expect(revisions).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_001);
    await client.profiles('team');
    await services.github.revisions('repo', 1);
    expect(profiles).toHaveBeenCalledTimes(2);
    expect(revisions).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});

describe('Actions host deadline', () => {
  it('clamps the host after provider setup and reserves cleanup time', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000_000);
      const source = { ADAPTIVE_JOB_STARTED_MS: String(Date.now()) };
      expect(hostTimeoutSeconds(source)).toBe(7200);
      vi.advanceTimersByTime(20 * 60_000);
      expect(hostTimeoutSeconds(source)).toBe(103 * 60);
      vi.advanceTimersByTime(104 * 60_000);
      expect(() => hostTimeoutSeconds(source)).toThrow('No review host time');
    } finally {
      vi.useRealTimers();
    }
  });
});
