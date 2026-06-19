export interface UniqueViolationTarget {
  resource: string;
  id?: string;
  keys?: Record<string, string>;
}

export interface UniqueViolationInfo {
  constraint: string;
  target?: UniqueViolationTarget;
}

export class UniqueViolationError extends Error {
  readonly code = '23505';
  readonly constraint: string;
  readonly target?: UniqueViolationTarget;

  constructor(info: UniqueViolationInfo, options?: { cause?: unknown }) {
    super(`Unique constraint violation: ${info.constraint}`, options);
    this.name = 'UniqueViolationError';
    this.constraint = info.constraint;
    this.target = info.target;
  }
}

interface PgUniqueViolationCandidate {
  code?: unknown;
  constraint?: unknown;
  cause?: unknown;
}

export function getUniqueViolationConstraint(err: unknown): string | null {
  const visited = new Set<unknown>();
  let current: unknown = err;

  while (current && typeof current === 'object' && !visited.has(current)) {
    visited.add(current);
    const candidate = current as PgUniqueViolationCandidate;

    if (
      candidate.code === '23505' &&
      typeof candidate.constraint === 'string' &&
      candidate.constraint.length > 0
    ) {
      return candidate.constraint;
    }

    current = candidate.cause;
  }

  return null;
}

export function translateUniqueViolation(
  err: unknown,
  expected: UniqueViolationInfo | readonly UniqueViolationInfo[],
): UniqueViolationError | null {
  const constraint = getUniqueViolationConstraint(err);
  if (!constraint) return null;

  const candidates: readonly UniqueViolationInfo[] = Array.isArray(expected)
    ? expected
    : [expected];
  const match: UniqueViolationInfo | undefined = candidates.find(
    (candidate: UniqueViolationInfo) => candidate.constraint === constraint,
  );
  if (!match) return null;

  return new UniqueViolationError(match, { cause: err });
}
