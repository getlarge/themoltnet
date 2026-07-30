import type { VM } from '@earendil-works/gondolin';

export interface GuestExecutableCapabilities {
  available: string[];
  unavailable: string[];
}

export interface GuestExecutableDiscoveryOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export class GuestExecutableProbeError extends Error {
  readonly code: 'capability_probe_failed' | 'capability_probe_timeout';

  constructor(
    code: 'capability_probe_failed' | 'capability_probe_timeout',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'GuestExecutableProbeError';
    this.code = code;
  }
}

const DEFAULT_PROBE_TIMEOUT_MS = 5_000;
const MAX_STDERR_DETAIL_LENGTH = 1_000;

/**
 * Verify only executables relevant to the resolved session policy.
 * Candidate names are positional arguments, never interpolated shell source.
 */
export async function discoverGuestExecutables(
  vm: Pick<VM, 'exec'>,
  candidates: readonly string[],
  options: GuestExecutableDiscoveryOptions = {},
): Promise<GuestExecutableCapabilities> {
  const unique = [...new Set(candidates)].sort();
  if (unique.length === 0) return { available: [], unavailable: [] };

  const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abortFromCaller = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', abortFromCaller, { once: true });
  if (options.signal?.aborted) abortFromCaller();

  let result: Awaited<ReturnType<VM['exec']>>;
  try {
    result = await vm.exec(
      [
        '/bin/sh',
        '-lc',
        [
          'index=0',
          'for executable in "$@"; do',
          '  if command -v "$executable" >/dev/null 2>&1; then',
          '    printf "%s\\n" "$index"',
          '  fi',
          '  index=$((index + 1))',
          'done',
        ].join('\n'),
        'moltnet-capability-probe',
        ...unique,
      ],
      { signal: controller.signal },
    );
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (timedOut) {
      throw new GuestExecutableProbeError(
        'capability_probe_timeout',
        `Guest executable capability probe timed out after ${timeoutMs}ms`,
        { cause: error },
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abortFromCaller);
  }

  if (result.exitCode !== 0) {
    const stderr = result.stderr.trim().slice(-MAX_STDERR_DETAIL_LENGTH);
    throw new GuestExecutableProbeError(
      'capability_probe_failed',
      `Guest executable capability probe failed (exit ${result.exitCode})${
        stderr ? `: ${stderr}` : ''
      }`,
    );
  }

  const availableIndexes = new Set(
    result.stdout
      .split('\n')
      .filter(Boolean)
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isSafeInteger(value) && value >= 0),
  );
  return {
    available: unique.filter((_, index) => availableIndexes.has(index)),
    unavailable: unique.filter((_, index) => !availableIndexes.has(index)),
  };
}
