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

/** Legacy default retained byte-for-byte for existing library callers. */
export const DEFAULT_LENSES = [
  'security',
  'correctness',
  'performance',
  'test-coverage',
] as const;

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
  /** SHA-256 of the exact immutable per-file patch bytes. */
  patchSha256: string;
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

export type ReviewFileManifestRecord = ReviewFileRecord;

/** @deprecated Use ReviewFileManifestRecord. */
export type ReviewFileArtifactRecord = ReviewFileManifestRecord;

export interface CoverageLedger {
  reviewableFiles: string[];
  excludedFiles: Array<{
    path: string;
    reason: string;
    source: 'intrinsic' | 'base-gitattributes';
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
 * Immutable workflow input. The raw whole diff and patch bodies are
 * deliberately absent: only a bounded manifest with per-file byte/hash
 * identity crosses the durable-workflow boundary.
 */
export interface ReviewManifest extends Omit<ReviewPreflight, 'files'> {
  files: ReviewFileManifestRecord[];
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
  generatedCandidates: GeneratedFileCandidate[];
  topics: ReviewTopic[];
}

export interface DesignPreflight {
  verdict: 'PROCEED' | 'PIVOT' | 'ASK';
  summary: string;
  questions?: string[];
}

/** Non-authoritative model classification; candidates remain reviewable. */
export interface GeneratedFileCandidate {
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

export interface TopicReviewResult {
  version: 1;
  topicId: string;
  laneResults: LaneResult[];
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
 * Immutable pointer to an accepted MoltNet task output. The output body stays
 * in remote content-addressed storage; durable orchestration persists only
 * this identity tuple.
 */
export interface AcceptedReviewOutputReference {
  taskId: string;
  attemptN: number;
  outputCid: string;
}

export interface ReviewPhaseOutputReferences {
  planner?: AcceptedReviewOutputReference & {
    planArtifact: ReviewArtifactRecord;
  };
  preflight?: AcceptedReviewOutputReference;
  topicReviews: Array<
    AcceptedReviewOutputReference & {
      topicId: string;
      lanes: ReviewLane[];
    }
  >;
  topicVerdictsArtifact?: ReviewArtifactRecord;
  globalSynthesis?: AcceptedReviewOutputReference;
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
  /**
   * Legacy name retained for CLI compatibility. It is now the default
   * combined topic-review profile; lane-specific profiles may split a topic.
   */
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
  /**
   * Exact reviewed commit. Repository-aware phases run in daemon-created
   * detached worktrees at this object id; planner and synthesis stay in
   * scratch workspaces.
   */
  reviewRevision: string;
  /**
   * Exact left endpoint used to create the supplied review diff. Repository
   * phases may use it for bounded Git inspection without switching revisions.
   */
  reviewBaseRevision: string;
  reviewManifest: ReviewManifest;
  /**
   * Reuse an already accepted planner task after trusted identity, manifest
   * references, and runtime-profile validation. The plan payload remains in
   * task-artifact storage; Absurd only carries this control-plane task ID.
   */
  plannerTaskId?: string;
  /**
   * Reuse an already accepted design-preflight task after trusted identity,
   * manifest, revision, output, and runtime-profile validation.
   */
  preflightTaskId?: string;
  /**
   * Reuse accepted topic-review tasks from an earlier interrupted run.
   * Trusted orchestration derives each task's topic/lane identity and rejects
   * stale revisions, artifacts, profiles, duplicate work, or invalid output.
   */
  topicReviewTaskIds?: string[];
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

/**
 * Trusted, replayable source for exact per-file patch bytes. Implementations
 * keep payloads outside Absurd and must return the bytes identified by the
 * manifest's size and SHA-256.
 */
export interface ReviewPatchSource {
  read(path: string): Promise<Uint8Array>;
}

export interface MultiLensReviewDeps {
  tasks: TaskClient;
  artifacts: ReviewArtifactStore;
  patches: ReviewPatchSource;
  logger?: Logger;
}

export interface MultiLensReviewOutput {
  correlationId: string;
  outcome: 'completed' | 'pivot' | 'questions';
  phaseOutputs: ReviewPhaseOutputReferences;
  plan: TopicPlan;
  preflight: DesignPreflight;
  topicVerdicts: TopicVerdict[];
  verdictTaskId?: string;
  verdict?: GlobalVerdict;
  diagnostics: ReviewDiagnostics;
}

/**
 * The only multi-lens result persisted by Absurd. Agent-produced bodies are
 * intentionally absent and can be hydrated from their immutable MoltNet
 * output references when a caller needs to render them.
 */
export interface MultiLensReviewDurableOutput {
  correlationId: string;
  outcome: MultiLensReviewOutput['outcome'];
  phaseOutputs: ReviewPhaseOutputReferences;
  diagnostics: ReviewDiagnostics;
}

/** Render-time view hydrated from remote accepted task outputs. */
export interface MultiLensReviewPublishedOutput extends MultiLensReviewDurableOutput {
  preflight?: DesignPreflight;
  verdict?: GlobalVerdict;
}
