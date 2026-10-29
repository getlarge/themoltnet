import {
  type ConvergenceInput,
  type Finding,
  sameRevision,
} from './contracts.js';

/** Disappearance from a report is not a verified disposition. */
export function retainFindings(
  previous: readonly Finding[],
  observation: Pick<ConvergenceInput, 'current' | 'reviews'>,
): Finding[] {
  const current = new Map<string, Finding[]>();
  for (const review of Object.values(observation.reviews)) {
    if (!sameRevision(review.revision, observation.current)) continue;
    for (const finding of review.findings) {
      if (!finding.id.trim()) throw new Error('Missing finding identity');
      current.set(finding.id, [...(current.get(finding.id) ?? []), finding]);
    }
  }
  const ledger = new Map(previous.map((finding) => [finding.id, finding]));
  for (const [id, reports] of current) {
    const first = reports[0];
    const agreed = reports.every(
      (finding) =>
        finding.origin === first.origin &&
        finding.disposition === first.disposition &&
        ((finding.verification === undefined &&
          first.verification === undefined) ||
          (finding.verification &&
            first.verification &&
            sameRevision(
              finding.verification.revision,
              first.verification.revision,
            ) &&
            finding.verification.evidence === first.verification.evidence)),
    );
    // Conflicting current adjudications never let map iteration order choose a pass.
    ledger.set(
      id,
      agreed ? first : { id, origin: 'unknown', disposition: 'open' },
    );
  }
  return [...ledger.values()].sort((a, b) => a.id.localeCompare(b.id));
}
