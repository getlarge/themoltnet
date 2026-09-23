/**
 * Pins the two cache properties the run center depends on: one entry per
 * catalogue identity, and one polling owner per key.
 */
import { useQuery } from '@tanstack/react-query';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestWrapper } from '../test-query-client.js';
import { catalogueQuery, runCenterKeys } from './queries.js';
import { runCenterActions } from './run-center-bridge.js';
import type { AgentServerCatalogue } from './types.js';

const catalogue = {
  teams: [],
  projects: [],
  defaultTeamId: null,
} as unknown as AgentServerCatalogue;

/** Reads the shared catalogue; only `polls` declares an interval. */
function Reader({ identity, polls }: { identity: string; polls?: boolean }) {
  useQuery({
    ...catalogueQuery(identity),
    ...(polls ? { refetchInterval: 60_000 } : {}),
  });
  return null;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('catalogue query', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(runCenterActions, 'catalogue').mockResolvedValue(catalogue);
  });
  afterEach(() => {
    vi.useRealTimers();
    // Not `restoreAllMocks`: it would also drop the shared `matchMedia` stub
    // that the theme provider needs, taking down later suites.
    vi.mocked(runCenterActions.catalogue).mockRestore();
  });

  it('reads once for several views sharing an identity', async () => {
    const Wrapper = createTestWrapper();
    render(
      <Wrapper>
        <Reader identity="agent-a" />
        <Reader identity="agent-a" />
        <Reader identity="agent-a" />
      </Wrapper>,
    );
    await flush();
    expect(runCenterActions.catalogue).toHaveBeenCalledTimes(1);
  });

  it('keeps a separate entry per identity', async () => {
    const Wrapper = createTestWrapper();
    render(
      <Wrapper>
        <Reader identity="agent-a" />
        <Reader identity="agent-b" />
      </Wrapper>,
    );
    await flush();
    expect(runCenterActions.catalogue).toHaveBeenCalledTimes(2);
    expect(runCenterActions.catalogue).toHaveBeenCalledWith('agent-a');
    expect(runCenterActions.catalogue).toHaveBeenCalledWith('agent-b');
  });

  it('polls once when a single owner declares the interval', async () => {
    const Wrapper = createTestWrapper();
    render(
      <Wrapper>
        <Reader identity="agent-a" polls />
        <Reader identity="agent-a" />
        <Reader identity="agent-a" />
      </Wrapper>,
    );
    await flush();
    expect(runCenterActions.catalogue).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    // One tick, one read — the non-owners share it rather than fetching too.
    expect(runCenterActions.catalogue).toHaveBeenCalledTimes(2);
  });

  it('collapses same-interval owners into one read per tick', async () => {
    const Wrapper = createTestWrapper();
    render(
      <Wrapper>
        <Reader identity="agent-a" polls />
        <Reader identity="agent-a" polls />
      </Wrapper>,
    );
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    // `refetchInterval` is per-observer, so both timers fire — but the two
    // fetches are concurrent on one key, and Query dedupes those into a single
    // in-flight request. Identical intervals therefore cost nothing extra.
    expect(runCenterActions.catalogue).toHaveBeenCalledTimes(2);
  });

  it('reads once per distinct interval when owners disagree', async () => {
    const Wrapper = createTestWrapper();
    function Fast() {
      useQuery({ ...catalogueQuery('agent-a'), refetchInterval: 20_000 });
      return null;
    }
    render(
      <Wrapper>
        <Reader identity="agent-a" polls />
        <Fast />
      </Wrapper>,
    );
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    // The 20s timer fires at 20/40/60s and the 60s timer at 60s; only the
    // coinciding pair dedupes. Staggered intervals on one key are the real
    // cost, which is why polling is lifted to a single owner.
    expect(
      vi.mocked(runCenterActions.catalogue).mock.calls.length,
    ).toBeGreaterThan(2);
  });

  it('does not read until an identity is selected', async () => {
    const Wrapper = createTestWrapper();
    render(
      <Wrapper>
        <Reader identity="" />
      </Wrapper>,
    );
    await flush();
    expect(runCenterActions.catalogue).not.toHaveBeenCalled();
  });

  it('scopes keys so one identity can be invalidated alone', () => {
    expect(runCenterKeys.catalogue('agent-a')).toEqual([
      'run-center',
      'catalogue',
      'agent-a',
    ]);
    // The family root is a prefix of each leaf, so invalidating it covers all.
    expect(runCenterKeys.catalogue('agent-a').slice(0, 2)).toEqual([
      ...runCenterKeys.catalogues(),
    ]);
  });
});
