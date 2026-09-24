/**
 * The behaviours the hand-built catalogue layer kept regressing on, pinned
 * against the cache: no flashing status on a background refresh, no data loss
 * when one fails, and no polling from a hidden view.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestWrapper } from '../test-query-client.js';
import { runCenterActions } from './run-center-bridge.js';
import type { AgentServerCatalogue } from './types.js';
import {
  CATALOGUE_ERROR,
  nextCatalogueRefresh,
  useCatalogue,
} from './useCatalogue.js';

const catalogue = {
  teams: [],
  projects: [],
  defaultTeamId: 'team-a',
} as unknown as AgentServerCatalogue;

describe('useCatalogue', () => {
  beforeEach(() => {
    vi.spyOn(runCenterActions, 'catalogue');
  });
  afterEach(() => {
    vi.mocked(runCenterActions.catalogue).mockRestore();
  });

  it('reports the first load and then the catalogue', async () => {
    vi.mocked(runCenterActions.catalogue).mockResolvedValue(catalogue);
    const { result } = renderHook(() => useCatalogue('agent-a'), {
      wrapper: createTestWrapper(),
    });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.catalogue).toEqual(catalogue));
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('keeps retry stable across status renders and changes it with the identity', async () => {
    vi.mocked(runCenterActions.catalogue).mockResolvedValue(catalogue);
    const { result, rerender } = renderHook(
      ({ identity }: { identity: string }) => useCatalogue(identity),
      {
        wrapper: createTestWrapper(),
        initialProps: { identity: 'agent-a' },
      },
    );
    const retry = result.current.retry;
    await waitFor(() => expect(result.current.catalogue).toEqual(catalogue));
    rerender({ identity: 'agent-a' });
    expect(result.current.retry).toBe(retry);

    rerender({ identity: 'agent-b' });
    expect(result.current.retry).not.toBe(retry);
  });

  it('stays out of the loading state while refreshing in the background', async () => {
    vi.mocked(runCenterActions.catalogue).mockResolvedValue(catalogue);
    const { result } = renderHook(() => useCatalogue('agent-a'), {
      wrapper: createTestWrapper(),
    });
    await waitFor(() => expect(result.current.catalogue).toEqual(catalogue));

    // Hold the refetch open, so `loading` is sampled while it is genuinely in
    // flight. Asserting after it settles would pass even for `isFetching`.
    let release = () => {};
    vi.mocked(runCenterActions.catalogue).mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve(catalogue);
      }),
    );
    result.current.retry();
    await waitFor(() =>
      expect(runCenterActions.catalogue).toHaveBeenCalledTimes(2),
    );

    // The old `role="status"` message reappeared on every poll; it must not.
    expect(result.current.loading).toBe(false);
    expect(result.current.catalogue).toEqual(catalogue);
    release();
  });

  it('keeps the last good catalogue when a refresh fails', async () => {
    vi.mocked(runCenterActions.catalogue).mockResolvedValue(catalogue);
    const { result } = renderHook(() => useCatalogue('agent-a'), {
      wrapper: createTestWrapper(),
    });
    await waitFor(() => expect(result.current.catalogue).toEqual(catalogue));

    vi.mocked(runCenterActions.catalogue).mockRejectedValue(
      new Error('unreachable'),
    );
    result.current.retry();
    await waitFor(() => expect(result.current.stale).toBe(true));
    // A failed background read replaced a good catalogue with null before, and
    // then a full-page error hid the catalogue that was still usable.
    expect(result.current.catalogue).toEqual(catalogue);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('surfaces an error with no catalogue when the first load fails', async () => {
    vi.mocked(runCenterActions.catalogue).mockRejectedValue(
      new Error('unreachable'),
    );
    const { result } = renderHook(() => useCatalogue('agent-a'), {
      wrapper: createTestWrapper(),
    });
    await waitFor(() => expect(result.current.error).toBe(CATALOGUE_ERROR));
    expect(result.current.catalogue).toBeNull();
  });

  it('does not report loading without an identity', () => {
    const { result } = renderHook(() => useCatalogue(''), {
      wrapper: createTestWrapper(),
    });
    expect(result.current.loading).toBe(false);
    expect(runCenterActions.catalogue).not.toHaveBeenCalled();
  });
});

const unverified = {
  teams: [
    {
      teamId: 'team-a',
      teamName: 'team-a',
      available: false,
      blockers: [
        {
          code: 'agent_key_unavailable',
          message: 'This team credential could not be verified.',
          remedy: 'Renew it.',
        },
      ],
      diaries: [],
      defaultDiaryId: null,
    },
  ],
  projects: [],
  profiles: [],
  projectErrors: [],
  defaultTeamId: null,
} as unknown as AgentServerCatalogue;

describe('nextCatalogueRefresh', () => {
  it.each([
    [null, 60_000],
    [0, 5_000],
    [10_000, 5_000],
    [30_000, 15_000],
    [90_000, 45_000],
    [600_000, 60_000],
  ])('after %s ms degraded waits %s ms', (degradedFor, expected) => {
    expect(nextCatalogueRefresh(degradedFor)).toBe(expected);
  });
});

describe('useCatalogue polling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(runCenterActions, 'catalogue').mockResolvedValue(catalogue);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(runCenterActions.catalogue).mockRestore();
  });

  async function flush() {
    await vi.advanceTimersByTimeAsync(0);
  }

  it('refreshes on an interval for the owner', async () => {
    renderHook(() => useCatalogue('agent-a', { poll: true }), {
      wrapper: createTestWrapper(),
    });
    await flush();
    expect(runCenterActions.catalogue).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runCenterActions.catalogue).toHaveBeenCalledTimes(2);
  });

  it('stops polling while the view is hidden but keeps its data', async () => {
    const wrapper = createTestWrapper();
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) =>
        useCatalogue('agent-a', { poll: true, active }),
      { wrapper, initialProps: { active: true } },
    );
    await flush();
    expect(runCenterActions.catalogue).toHaveBeenCalledTimes(1);

    rerender({ active: false });
    await vi.advanceTimersByTimeAsync(180_000);
    expect(runCenterActions.catalogue).toHaveBeenCalledTimes(1);
    // Hidden is not unmounted: the view still renders what it had.
    expect(result.current.catalogue).toEqual(catalogue);

    rerender({ active: true });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(
      vi.mocked(runCenterActions.catalogue).mock.calls.length,
    ).toBeGreaterThan(1);
  });

  it('checks again soon while a team credential cannot be verified, then backs off', async () => {
    // Arrange: a renewal the API has not settled yet.
    vi.mocked(runCenterActions.catalogue).mockResolvedValue(unverified);
    renderHook(() => useCatalogue('agent-a', { poll: true }), {
      wrapper: createTestWrapper(),
    });
    await flush();

    // Act + Assert: quick checks first, not the minute-long normal poll.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(runCenterActions.catalogue).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(runCenterActions.catalogue).toHaveBeenCalledTimes(3);

    // Recovered: back to the normal interval.
    vi.mocked(runCenterActions.catalogue).mockResolvedValue(catalogue);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(runCenterActions.catalogue).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(runCenterActions.catalogue).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(runCenterActions.catalogue).toHaveBeenCalledTimes(5);
  });

  it('checks again soon after a failed read', async () => {
    // Arrange
    vi.mocked(runCenterActions.catalogue).mockRejectedValueOnce(
      new Error('timed out'),
    );
    const { result } = renderHook(
      () => useCatalogue('agent-a', { poll: true }),
      { wrapper: createTestWrapper() },
    );
    await flush();
    expect(result.current.error).toBe(CATALOGUE_ERROR);

    // Act: the recovery interval, plus a scheduler turn for the fetch to
    // settle and notify.
    await vi.advanceTimersByTimeAsync(5_100);

    // Assert
    expect(runCenterActions.catalogue).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBeNull();
    expect(result.current.catalogue).toEqual(catalogue);
  });

  it('does not poll from a follower', async () => {
    renderHook(() => useCatalogue('agent-a'), {
      wrapper: createTestWrapper(),
    });
    await flush();
    expect(runCenterActions.catalogue).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(runCenterActions.catalogue).toHaveBeenCalledTimes(1);
  });
});
