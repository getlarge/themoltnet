import { describe, expect, it } from 'vitest';

import { abortable, delay, throwIfAborted } from './abort-utils.js';

describe('abort-utils', () => {
  it('throws immediately when the signal is already aborted', async () => {
    const ac = new AbortController();
    ac.abort(new Error('stop'));

    expect(() => throwIfAborted(ac.signal, 'work')).toThrow(
      'work aborted: stop',
    );
    await expect(
      abortable(Promise.resolve('ok'), ac.signal, 'work'),
    ).rejects.toThrow('work aborted: stop');
  });

  it('rejects an in-flight promise when the signal aborts', async () => {
    const ac = new AbortController();
    const pending = new Promise<string>(() => {
      // Intentionally left pending so abort controls the result.
    });
    const result = abortable(pending, ac.signal, 'resume');

    ac.abort('cancelled');

    await expect(result).rejects.toThrow('resume aborted: cancelled');
  });

  it('rejects a delay when the signal aborts', async () => {
    const ac = new AbortController();
    const result = delay(10_000, ac.signal, 'backoff');

    ac.abort(new Error('shutdown'));

    await expect(result).rejects.toThrow('backoff aborted: shutdown');
  });
});
