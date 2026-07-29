import type { Logger, TaskClient } from '@themoltnet/tasks-orchestrator';

export const REVIEW_LANES = [
  'correctness',
  'dry-codebase-fit',
  'security',
  'performance',
  'design-api-backcompat',
  'tests',
  'operability',
  'readability',
] as const;

export type ReviewLane = (typeof REVIEW_LANES)[number];

/** Correctness and codebase fit are never optional for a reviewable topic. */
export const MANDATORY_REVIEW_LANES = [
  'correctness',
  'dry-codebase-fit',
] as const satisfies readonly ReviewLane[];

/** Backward-compatible alias for callers that imported the old constant. */
export const DEFAULT_LENSES = REVIEW_LANES;

export type ReviewFileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied';

export interface ReviewFileRecord {
  path: string;
  previousPath?: string;
  status: ReviewFileStatus;
  additions: number;
  deletions: number;
  changedLoc: number;
  byteSize: number;
  language: string;
  binary: boolean;
  generated: boolean;
  generatedSignals: string[];
  reviewable: boolean;
  exclusionReason?: string;
  requiredLanes: ReviewLane[];
}

export interface ReviewArtifactRecord {
  cid: string;
  title: string;
  contentType: string;
  sizeBytes: number;
}

export interface ReviewFileArtifactRecord extends ReviewFileRecord {
  /**
   * Intrinsically excluded binaries have no artifact. A model-excluded text
   * file retains its immutable classification artifact for the audit ledger.
   */
  artifact?: ReviewArtifactRecord;
}

export interface CoverageLedger {
  reviewableFiles: string[];
  excludedFiles: Array<{
    path: string;
    reason: string;
    source: 'intrinsic' | 'model';
    evidence?: string;
  }>;
  primaryOwners: Record<string, string | null>;
  laneCoverage: Record<string, ReviewLane[]>;
  complete: boolean;
}

export interface ReviewPreflight {
  version: 1;
  rawDiffBytes: number;
  totalFiles: number;
  reviewableFiles: number;
  reviewableBytes: number;
  changedLoc: number;
  requiresPlanning: boolean;
  files: ReviewFileRecord[];
  coverage: CoverageLedger;
}

/**
 * Immutable workflow input. The raw whole diff is deliberately absent: only a
 * bounded manifest and individually staged reviewable file patches cross the
 * trusted ingestion boundary.
 */
export interface ReviewManifest extends Omit<ReviewPreflight, 'files'> {
  files: ReviewFileArtifactRecord[];
  manifestArtifact: ReviewArtifactRecord;
}

export interface ReviewTopic {
  id: string;
  title: string;
  primaryFiles: string[];
  contextFiles?: string[];
  lanes: ReviewLane[];
}

export interface TopicPlan {
  version: 1;
  excludedFiles: ModelFileExclusion[];
  topics: ReviewTopic[];
}

export interface DesignPreflight {
  verdict: 'PROCEED' | 'PIVOT' | 'ASK';
  summary: string;
  questions?: string[];
  excludedFiles: ModelFileExclusion[];
}

export interface ModelFileExclusion {
  path: string;
  reason: string;
  evidence: string;
}

export interface LaneFinding {
  severity: 'blocker' | 'major' | 'minor' | 'nit';
  path: string;
  location?: string;
  description: string;
  impact: string;
  fix: string;
}

export interface LaneResult {
  version: 1;
  topicId: string;
  lane: ReviewLane;
  findings: LaneFinding[];
  reviewedFiles: string[];
  summary: string;
}

export interface TopicVerdict {
  version: 1;
  topicId: string;
  recommendation: 'approve' | 'approve-with-nits' | 'request-changes';
  findings: LaneFinding[];
  coveredFiles: string[];
  coveredLanes: ReviewLane[];
  summary: string;
}

export interface GlobalVerdict {
  version: 1;
  recommendation: 'approve' | 'approve-with-nits' | 'request-changes';
  findings: LaneFinding[];
  summary: string;
  coverageComplete: boolean;
}

export interface ReviewCostDiagnostics {
  tasks: number;
  artifacts: number;
  artifactBytes: number;
  inputTokens: number;
  outputTokens: number;
}

export interface ReviewDiagnostics {
  topics: Array<{
    id: string;
    primaryFiles: number;
    contextFiles: number;
    bytes: number;
    lanes: ReviewLane[];
  }>;
  coverage: CoverageLedger;
  cost: ReviewCostDiagnostics;
}

/**
 * Runtime-profile affinity for every fixed graph phase. Existing lens and
 * synthesis fields remain aliases so older callers keep their routing.
 */
export interface RuntimeProfileRouting {
  defaultProfileId: string;
  plannerProfileId?: string;
  preflightProfileId?: string;
  laneProfileIds?: Partial<Record<ReviewLane, string>>;
  /** @deprecated Use laneProfileIds. */
  lensProfileIds?: Record<string, string>;
  topicReducerProfileId?: string;
  globalSynthesisProfileId?: string;
  /** @deprecated Use globalSynthesisProfileId. */
  synthesisProfileId?: string;
}

export interface MultiLensReviewInput {
  teamId: string;
  diaryId: string;
  correlationId: string;
  target: string;
  reviewManifest: ReviewManifest;
  /**
   * Legacy caller-requested lanes. Trusted classification remains additive:
   * these may add known lanes to every topic but can never remove required
   * lanes.
   */
  lenses?: string[];
  synthesisBrief?: string;
  profileRouting?: RuntimeProfileRouting;
  pollIntervalSec?: number;
  concurrency?: number;
  /** GitHub Actions is unattended; ASK returns questions instead of pausing. */
  unattended?: boolean;
}

export interface ReviewArtifactStore {
  stage(
    bytes: Uint8Array,
    metadata: { contentType: string },
    context: { teamId: string },
  ): Promise<{ cid: string; contentType?: string; sizeBytes: number }>;
  download(
    taskId: string,
    cid: string,
    context: { teamId: string },
  ): Promise<Uint8Array>;
}

export interface MultiLensReviewDeps {
  tasks: TaskClient;
  artifacts: ReviewArtifactStore;
  logger?: Logger;
}

export interface MultiLensReviewOutput {
  correlationId: string;
  outcome: 'completed' | 'pivot' | 'questions';
  plan: TopicPlan;
  preflight: DesignPreflight;
  topicVerdicts: TopicVerdict[];
  verdictTaskId?: string;
  verdict?: GlobalVerdict;
  diagnostics: ReviewDiagnostics;
}
