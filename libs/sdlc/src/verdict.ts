import {
  type ConvergenceInput,
  type EvidenceResult,
  sameRevision,
  type Verdict,
} from './contracts.js';

/** Pure decision. The caller must re-read the revision before publishing it. */
export function evaluateConvergence(input: ConvergenceInput): Verdict {
  if (
    !Number.isInteger(input.repairRounds) ||
    input.repairRounds < 0 ||
    !Number.isInteger(input.maxRepairRounds) ||
    input.maxRepairRounds < 0 ||
    !Number.isInteger(input.unresolvedHumanThreads) ||
    input.unresolvedHumanThreads < 0
  ) {
    throw new Error('Invalid convergence counters');
  }
  if (input.control !== 'active') return { status: input.control, reasons: [] };
  const waiting: string[] = [];
  const repair: string[] = [];
  const human: string[] = [...(input.coverageGaps ?? [])];
  const inspect = (key: string, result?: EvidenceResult) => {
    if (!result || !sameRevision(result.revision, input.current)) {
      waiting.push(`${key}:missing-or-stale`);
    } else if (result.status === 'pending') {
      waiting.push(`${key}:pending`);
    } else if (result.status === 'incomplete') {
      human.push(`${key}:incomplete`);
    } else if (result.status === 'failed') {
      repair.push(`${key}:failed`);
    }
  };
  inspect('assessment', input.assessment);
  for (const name of new Set(input.requiredChecks))
    inspect(
      `check:${name}`,
      Object.hasOwn(input.checks, name) ? input.checks[name] : undefined,
    );
  const lanes = new Set([...input.requiredLanes, ...input.auditLanes]);
  if (lanes.size === 0) human.push('review:no-coverage');
  // Findings from any current review count, even if its lane is no longer required.
  for (const name of lanes)
    inspect(
      `review:${name}`,
      Object.hasOwn(input.reviews, name) ? input.reviews[name] : undefined,
    );
  const findings = [
    ...(input.retainedFindings ?? []),
    ...Object.values(input.reviews)
      .filter((review) => sameRevision(review.revision, input.current))
      .flatMap((review) => review.findings),
  ];
  for (const finding of findings) {
    const verified =
      finding.verification &&
      sameRevision(finding.verification.revision, input.current) &&
      finding.verification.evidence.trim().length > 0;
    if (
      verified &&
      (finding.disposition === 'fixed' || finding.disposition === 'rejected')
    )
      continue;
    if (
      verified &&
      finding.disposition === 'follow-up' &&
      finding.origin === 'pre-existing'
    )
      continue;
    repair.push(`finding:${finding.id}`);
  }
  if (input.unresolvedHumanThreads) human.push('human-threads:unresolved');
  const unique = (reasons: string[]) => [...new Set(reasons)];
  if (human.length)
    return {
      status: 'needs-human',
      reasons: unique([...human, ...repair, ...waiting]),
    };
  // Never launch a repair from a partial set of current review results.
  if (waiting.length)
    return { status: 'waiting', reasons: unique([...waiting, ...repair]) };
  if (repair.length)
    return {
      status:
        input.repairRounds < input.maxRepairRounds ? 'repair' : 'needs-human',
      reasons: unique(repair),
    };
  return { status: 'ready', reasons: [] };
}
