import {
  type ConvergenceInput,
  type EvidenceResult,
  type ReviewResult,
  type Revision,
  sameRevision,
} from './contracts.js';

export type EvidenceObservation = Omit<
  ConvergenceInput,
  'repairRounds' | 'maxRepairRounds'
>;
export interface EvidenceSources {
  current(this: void): Promise<{
    revision: Revision;
    control: ConvergenceInput['control'];
  }>;
  assessment(
    this: void,
    revision: Revision,
  ): Promise<EvidenceResult | undefined>;
  checks(
    this: void,
    revision: Revision,
  ): Promise<Record<string, EvidenceResult>>;
  reviews(
    this: void,
    revision: Revision,
  ): Promise<Record<string, ReviewResult>>;
  /** undefined means coverage could not be established, never zero conversations. */
  humanThreads(this: void, revision: Revision): Promise<number | undefined>;
}

/** Fresh observation for each convergence poll; provider adapters retain their evidence revisions. */
export function createEvidenceObserver(
  policy: Pick<
    ConvergenceInput,
    'requiredChecks' | 'requiredLanes' | 'auditLanes'
  >,
  sources: EvidenceSources,
): () => Promise<EvidenceObservation> {
  return async () => {
    const before = await sources.current();
    const empty = (state: typeof before): EvidenceObservation => ({
      ...policy,
      current: state.revision,
      control: state.control,
      checks: {},
      reviews: {},
      unresolvedHumanThreads: 0,
    });
    if (before.control !== 'active') return empty(before);
    const reads = await Promise.allSettled([
      sources.assessment(before.revision),
      sources.checks(before.revision),
      sources.reviews(before.revision),
      sources.humanThreads(before.revision),
    ] as const);
    const failures = reads.filter((read) => read.status === 'rejected');
    if (failures.length)
      throw new AggregateError(
        failures.map((read) => read.reason as unknown),
        'Convergence evidence read failed',
      );
    const assessment = fulfilled(reads[0]);
    const checks = fulfilled(reads[1]);
    const reviews = fulfilled(reads[2]);
    const threads = fulfilled(reads[3]);
    const after = await sources.current();
    if (
      !sameRevision(before.revision, after.revision) ||
      after.control !== 'active'
    )
      return empty(after);
    if (
      threads !== undefined &&
      (!Number.isSafeInteger(threads) || threads < 0)
    )
      throw new Error('Invalid human conversation count');
    return {
      ...empty(after),
      assessment,
      checks,
      reviews,
      unresolvedHumanThreads: threads ?? 0,
      ...(threads === undefined
        ? { coverageGaps: ['human-threads:incomplete'] }
        : {}),
    };
  };
}

function fulfilled<T>(result: PromiseSettledResult<T>): T {
  if (result.status !== 'fulfilled')
    throw new Error('Unreachable evidence read');
  return result.value;
}
