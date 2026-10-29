import type { AdaptiveReport } from '@moltnet/adaptive-review';

import {
  type AdaptiveReviewBinding,
  adaptiveReviewEvidence,
} from './adaptive-evidence.js';
import {
  type ConvergenceInput,
  type EvidenceResult,
  type ReviewResult,
  type Revision,
  sameRevision,
} from './contracts.js';
import { createEvidenceObserver, type EvidenceSources } from './evidence.js';
import { type GithubCheckBinding, readGithubChecks } from './github-checks.js';
import type { GithubRequest } from './github-coordination.js';
import { readGithubHumanThreads } from './github-threads.js';

/** Repository-specific reads behind the portable convergence observation boundary. */
export function createGithubEvidenceObserver(input: {
  request: GithubRequest;
  repository: string;
  pr: number;
  policy: Pick<
    ConvergenceInput,
    'requiredChecks' | 'requiredLanes' | 'auditLanes'
  >;
  current: EvidenceSources['current'];
  assessment: EvidenceSources['assessment'];
  /** Trusted, persisted dispatch receipts; do not synthesize these from check names. */
  ciBindings(this: void, revision: Revision): Promise<GithubCheckBinding[]>;
  /** Full internal reports with the binding persisted when their work was dispatched. */
  reviews(
    this: void,
    revision: Revision,
  ): Promise<Array<{ binding: AdaptiveReviewBinding; report: AdaptiveReport }>>;
}) {
  return createEvidenceObserver(input.policy, {
    current: input.current,
    assessment: input.assessment,
    humanThreads: (revision) => readGithubHumanThreads({ ...input, revision }),
    async checks(revision) {
      const bindings = await input.ciBindings(revision);
      const checks: Record<string, EvidenceResult> = {};
      for (const binding of bindings) {
        if (binding.repository.toLowerCase() !== input.repository.toLowerCase())
          throw new Error('CI evidence belongs to another repository');
        if (!sameRevision(binding.revision, revision)) continue;
        const result = await readGithubChecks(binding, input.request);
        for (const [name, evidence] of Object.entries(result)) {
          // Distinct suites claiming one logical policy check are ambiguous.
          checks[name] = Object.hasOwn(checks, name)
            ? { revision, status: 'incomplete' }
            : evidence;
        }
      }
      return checks;
    },
    async reviews(revision) {
      const reports = await input.reviews(revision);
      const reviews: Record<string, ReviewResult> = {};
      for (const { binding, report } of reports) {
        if (
          binding.repository.toLowerCase() !== input.repository.toLowerCase() ||
          binding.pr !== input.pr
        )
          throw new Error('Review evidence belongs to another change');
        if (!sameRevision(binding.revision, revision)) continue;
        const result = adaptiveReviewEvidence(report, binding);
        if (!result) continue;
        for (const [lane, evidence] of Object.entries(result)) {
          const previous = reviews[lane];
          if (!previous) reviews[lane] = evidence;
          else
            reviews[lane] = {
              revision,
              status: combinedStatus(previous.status, evidence.status),
              findings: [...previous.findings, ...evidence.findings],
            };
        }
      }
      return reviews;
    },
  });
}
function combinedStatus(
  a: EvidenceResult['status'],
  b: EvidenceResult['status'],
): EvidenceResult['status'] {
  for (const status of ['incomplete', 'pending', 'failed', 'passed'] as const)
    if (a === status || b === status) return status;
  return 'incomplete';
}
