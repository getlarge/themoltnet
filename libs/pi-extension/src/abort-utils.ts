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

export interface AbortableResourceOptions<T> {
  promise: PromiseLike<T>;
  signal: AbortSignal | undefined;
  label: string;
  cleanup: (resource: T) => Promise<void> | void;
  onCleanupError?: (err: unknown) => void;
}

export async function abortableResource<T>(
  opts: AbortableResourceOptions<T>,
): Promise<T> {
  const { signal } = opts;
  if (!signal) return opts.promise;
  throwIfAborted(signal, opts.label);

  let abortWon = false;
  const resourcePromise = Promise.resolve(opts.promise);
  const abortPromise = new Promise<never>((_, reject) => {
    const listener = () => {
      abortWon = true;
      reject(abortError(opts.label, signal));
    };
    signal.addEventListener('abort', listener, { once: true });
    void resourcePromise.finally(() => {
      signal.removeEventListener('abort', listener);
    });
  });

  try {
    return await Promise.race([resourcePromise, abortPromise]);
  } catch (err) {
    if (abortWon) {
      void resourcePromise.then(
        async (resource) => {
          try {
            await opts.cleanup(resource);
          } catch (cleanupErr) {
            opts.onCleanupError?.(cleanupErr);
          }
        },
        () => {
          // The resource never materialized, so there is nothing to clean up.
        },
      );
    }
    throw err;
  }
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
