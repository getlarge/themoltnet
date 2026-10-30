/** A portable locator. Only an adapter interprets provider and key. */
export interface WorkItemRef {
  provider: string;
  repository: string;
  key: string;
}

/** Identity of the evidence required for one convergence decision. */
export interface Revision {
  base: string;
  head: string;
  policyDigest: string;
  briefDigest: string;
}

export function sameRevision(a: Revision, b: Revision): boolean {
  return (
    a.base === b.base &&
    a.head === b.head &&
    a.policyDigest === b.policyDigest &&
    a.briefDigest === b.briefDigest
  );
}

export interface AcceptedWork {
  taskId: string;
  attempt: number;
  outputCid: string;
}

export interface Handoff {
  version: 1;
  workItem: WorkItemRef;
  generation: string;
  correlationId: string;
  revision: Revision;
  acceptedWork: AcceptedWork;
}

export interface Finding {
  /** Stable problem identity, independent of lane and line location. */
  id: string;
  origin: 'introduced' | 'pre-existing' | 'unknown';
  disposition: 'open' | 'fixed' | 'rejected' | 'follow-up';
  /** Required before a disposition can count as settled. */
  verification?: { revision: Revision; evidence: string };
}

export interface EvidenceResult {
  revision: Revision;
  status: 'passed' | 'failed' | 'pending' | 'incomplete';
}

export interface ReviewResult extends EvidenceResult {
  findings: Finding[];
}

export interface ConvergenceInput {
  current: Revision;
  control: 'active' | 'paused' | 'cancelled';
  assessment?: EvidenceResult;
  checks: Record<string, EvidenceResult>;
  reviews: Record<string, ReviewResult>;
  /** Prior observations retained by the durable workflow until verified. */
  retainedFindings?: Finding[];
  requiredChecks: string[];
  requiredLanes: string[];
  /** Audit coverage is additional to the lanes selected by the filters. */
  auditLanes: string[];
  unresolvedHumanThreads: number;
  /** Missing provider coverage must never be interpreted as an empty result. */
  coverageGaps?: string[];
  repairRounds: number;
  maxRepairRounds: number;
}

export interface Verdict {
  status:
    | 'ready'
    | 'waiting'
    | 'repair'
    | 'needs-human'
    | 'paused'
    | 'cancelled';
  /** Codes and finding IDs only; private finding text never enters a summary. */
  reasons: string[];
}
