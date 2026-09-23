/**
 * How to observe a cache write in a test, and how not to.
 *
 * Query's notifyManager schedules observer notifications on a macrotask
 * (`defaultScheduler = systemSetTimeoutZero`). `await act(async () => …)`
 * drains microtasks only, so a `setQueryData` inside it lands in the cache and
 * the component has not re-rendered by the time the block returns. Reading a
 * variable captured during render then shows the previous value and looks like
 * the write was ignored.
 *
 * This cost a wrong conclusion once — that Query could not accept a write after
 * a failed read — so it is pinned here rather than left as folklore. Assert on
 * the DOM through `waitFor`, not on a captured render value inside `act`.
 */
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

function Presets({ read }: { read: () => Promise<string[]> }) {
  const { data = [], isError } = useQuery<string[]>({
    queryKey: ['presets'],
    queryFn: read,
  });
  return (
    <div>
      <span data-testid="state">{isError ? 'error' : 'ok'}</span>
      <ul>
        {data.map((entry) => (
          <li key={entry}>{entry}</li>
        ))}
      </ul>
    </div>
  );
}

describe('a cache write after a failed read', () => {
  it('reaches the component', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const read = vi
      .fn<() => Promise<string[]>>()
      .mockRejectedValue(new Error('storage unavailable'));
    render(
      <QueryClientProvider client={client}>
        <Presets read={read} />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('state').textContent).toBe('error'),
    );

    // `setData` dispatches a `success` action, and `successState` clears the
    // error, so the query leaves the error state rather than swallowing this.
    client.setQueryData(['presets'], ['committed']);

    await waitFor(() => expect(screen.queryByText('committed')).not.toBeNull());
    expect(screen.getByTestId('state').textContent).toBe('ok');
  });
});
