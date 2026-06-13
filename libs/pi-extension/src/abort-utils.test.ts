import { describe, expect, it } from 'vitest';

import { abortableResource, delay, throwIfAborted } from './abort-utils.js';

describe('abort-utils', () => {
  it('throws immediately when the signal is already aborted', () => {
    const ac = new AbortController();
    ac.abort(new Error('stop'));

    expect(() => throwIfAborted(ac.signal, 'work')).toThrow(
      'work aborted: stop',
    );
  });

  it('cleans up a resource that resolves after cancellation wins', async () => {
    const ac = new AbortController();
    let resolveResource!: (resource: { close: () => Promise<void> }) => void;
    const resourcePromise = new Promise<{ close: () => Promise<void> }>(
      (resolve) => {
        resolveResource = resolve;
      },
    );
    const cleanupCalls: string[] = [];

    const result = abortableResource({
      promise: resourcePromise,
      signal: ac.signal,
      label: 'resource allocation',
      cleanup: async (resource) => {
        await resource.close();
        cleanupCalls.push('closed');
      },
    });

    ac.abort(new Error('shutdown'));
    await expect(result).rejects.toThrow(
      'resource allocation aborted: shutdown',
    );

    resolveResource({
      close: () => {
        cleanupCalls.push('close-called');
        return Promise.resolve();
      },
    });
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(cleanupCalls).toEqual(['close-called', 'closed']);
  });

  it('rejects a delay when the signal aborts', async () => {
    const ac = new AbortController();
    const result = delay(10_000, ac.signal, 'backoff');

    ac.abort(new Error('shutdown'));

    await expect(result).rejects.toThrow('backoff aborted: shutdown');
  });
});
