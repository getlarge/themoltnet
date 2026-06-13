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

export interface AbortableResourceOptions<T> {
  promise: PromiseLike<T>;
  signal: AbortSignal | undefined;
  label: string;
  cleanup: (resource: T) => Promise<void> | void;
  onCleanupError?: (err: unknown) => void;
}

function cleanupLateResource<T>(
  resourcePromise: Promise<T>,
  opts: Pick<AbortableResourceOptions<T>, 'cleanup' | 'onCleanupError'>,
): void {
  void resourcePromise.then(
    async (resource) => {
      try {
        await opts.cleanup(resource);
      } catch (err) {
        opts.onCleanupError?.(err);
      }
    },
    () => {
      // Allocation failed before a resource existed.
    },
  );
}

export async function abortableResource<T>(
  opts: AbortableResourceOptions<T>,
): Promise<T> {
  const { signal } = opts;
  if (!signal) return opts.promise;
  throwIfAborted(signal, opts.label);

  const resourcePromise = Promise.resolve(opts.promise);
  const abortPromise = new Promise<never>((_, reject) => {
    const abort = () => {
      cleanupLateResource(resourcePromise, opts);
      reject(abortError(opts.label, signal));
    };
    signal.addEventListener('abort', abort, { once: true });
    resourcePromise.then(
      () => signal.removeEventListener('abort', abort),
      () => signal.removeEventListener('abort', abort),
    );
  });

  return Promise.race([resourcePromise, abortPromise]);
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
