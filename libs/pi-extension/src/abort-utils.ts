export function throwIfAborted(
  signal: AbortSignal | undefined,
  label: string,
): void {
  if (!signal?.aborted) return;
  throw abortError(label, signal);
}

export function abortError(label: string, signal: AbortSignal): Error {
  const reason = signal.reason;
  const suffix =
    reason instanceof Error
      ? reason.message
      : reason === undefined
        ? 'aborted'
        : String(reason);
  const err = new Error(`${label} aborted: ${suffix}`);
  err.name = 'AbortError';
  return err;
}

export async function abortable<T>(
  promise: PromiseLike<T>,
  signal: AbortSignal | undefined,
  label: string,
): Promise<T> {
  if (!signal) return promise;
  throwIfAborted(signal, label);
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      const listener = () => reject(abortError(label, signal));
      signal.addEventListener('abort', listener, { once: true });
      promise.then(
        () => signal.removeEventListener('abort', listener),
        () => signal.removeEventListener('abort', listener),
      );
    }),
  ]);
}

export async function delay(
  ms: number,
  signal: AbortSignal | undefined,
  label: string,
): Promise<void> {
  if (!signal) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
    return;
  }
  throwIfAborted(signal, label);
  await new Promise<void>((resolve, reject) => {
    const listener = () => {
      clearTimeout(timeout);
      reject(abortError(label, signal));
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', listener);
      resolve();
    }, ms);
    signal.addEventListener('abort', listener, { once: true });
  });
}
