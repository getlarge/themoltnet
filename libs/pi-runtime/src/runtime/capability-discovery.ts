import type { VM } from '@earendil-works/gondolin';

export interface GuestExecutableCapabilities {
  available: string[];
  unavailable: string[];
}

/**
 * Verify only executables relevant to the resolved session policy.
 * Candidate names are positional arguments, never interpolated shell source.
 */
export async function discoverGuestExecutables(
  vm: Pick<VM, 'exec'>,
  candidates: readonly string[],
): Promise<GuestExecutableCapabilities> {
  const unique = [...new Set(candidates)].sort();
  if (unique.length === 0) return { available: [], unavailable: [] };

  const result = await vm.exec([
    'sh',
    '-c',
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
  ]);
  if (result.exitCode !== 0) {
    throw new Error(
      `Guest executable capability probe failed (exit ${result.exitCode})`,
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
