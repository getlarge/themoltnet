export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed';

/**
 * How trusted code treats a changed file. Only `source` and `docs` reach the
 * model; the rest stay in the manifest so coverage stays honest.
 */
export type FileCategory = 'source' | 'docs' | 'test' | 'generated' | 'binary';

export interface ChangedFile {
  path: string;
  previousPath?: string;
  status: FileStatus;
  additions: number;
  deletions: number;
  category: FileCategory;
}

export interface ChangeSet {
  baseRevision: string;
  headRevision: string;
  files: ChangedFile[];
}

export interface DiffBlock {
  path: string;
  category: FileCategory;
  /** `### path (status)` header followed by the (possibly truncated) hunks. */
  text: string;
}

export interface BoundedDiff {
  blocks: DiffBlock[];
  /** Concatenated `blocks[].text`. */
  text: string;
  bytes: number;
  includedPaths: string[];
  /** Included but cut at the per-file cap. */
  truncatedPaths: string[];
  /** Eligible for model context but dropped by the total budget. */
  omittedPaths: string[];
}

export const CONTRACT_KINDS = [
  'cli',
  'api',
  'sdk',
  'config',
  'install',
  'migration',
  'deployment',
  'contributor-workflow',
] as const;
export type ContractKind = (typeof CONTRACT_KINDS)[number];

export interface Evidence {
  path: string;
  detail: string;
}

/** Stage 1 result: public behavior changes backed by changed code. */
export interface ContractChange {
  id: string;
  kind: ContractKind;
  summary: string;
  evidence: Evidence[];
  /** Exact identifiers (flags, env vars, routes, symbols) to search docs for. */
  searchTerms: string[];
}

export interface ContractExtraction {
  version: 1;
  changes: ContractChange[];
}

export const OUTCOMES = [
  'covered',
  'updates-needed',
  'not-needed',
  'incomplete',
] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const FINDING_ISSUES = ['missing', 'incorrect', 'unnecessary'] as const;
export type FindingIssue = (typeof FINDING_ISSUES)[number];

export interface DocsFinding {
  changeId: string;
  /** What is wrong with the documentation; absent means unclassified. */
  issue?: FindingIssue;
  evidence: Evidence;
  docsPath: string;
  section?: string;
  update: string;
}

/** Stage 2 result as returned by the model, before trusted resolution. */
export interface CoverageCheck {
  version: 1;
  outcome: Exclude<Outcome, 'incomplete'>;
  findings: DocsFinding[];
}

export type DocsSelectionReason =
  | 'changed-in-pr'
  | 'routing-map'
  | 'nearest-readme'
  | 'symbol-search';

export interface SelectedDoc {
  path: string;
  reasons: DocsSelectionReason[];
  /** Heading-bounded excerpt at the head revision, capped in bytes. */
  excerpt: string;
  /** Present when the doc does not exist at head (new location proposal). */
  missing?: boolean;
}

/**
 * Per-stage timing from server timestamps plus transcript events, so poll
 * delay never skews the phase split. Phases, in runtime order:
 * queued → claimed (queue) → started (first heartbeat, before any VM work)
 * → `execute_start` (snapshot, worktree, VM resume, guest projection)
 * → first model event (prompt assembly, first token) → completed.
 */
export interface StageTiming {
  taskId: string;
  queuedAt: string | null;
  claimedAt: string | null;
  startedAt: string | null;
  executeStartAt: string | null;
  firstModelEventAt: string | null;
  completedAt: string | null;
  queueMs: number | null;
  openMs: number | null;
  /** Snapshot, worktree, VM resume, and guest projection. */
  setupMs: number | null;
  firstModelEventMs: number | null;
  modelMs: number | null;
  /** started → completed. */
  executionMs: number | null;
  /** Client-observed create call → terminal state, including poll delay. */
  observedMs: number;
  toolCalls: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  model: string | null;
}

export interface CoverageGap {
  scope: string;
  reason: string;
}

export interface DocsImpactReport {
  version: 1;
  repo: string;
  pr: number;
  baseRevision: string;
  headRevision: string;
  status: 'completed' | 'failed';
  /** Absent when status is `failed`: a failure never reads as a clean result. */
  outcome?: Outcome;
  findings: DocsFinding[];
  gaps: CoverageGap[];
  /** Search terms dropped because they matched too many docs. */
  searchTermsDropped: string[];
  /** Mechanical fixes applied to model output before validation. */
  repairs: Array<{ stage: 'extract' | 'coverage'; repair: string }>;
  error?: string;
  manifest: {
    files: number;
    byCategory: Record<FileCategory, number>;
    diffBytes: number;
  };
  selectedDocs: Array<Pick<SelectedDoc, 'path' | 'reasons' | 'missing'>>;
  contractChanges: ContractChange[];
  timings: {
    ingestMs: number;
    retrievalMs: number;
    stages: Partial<Record<'extract' | 'coverage', StageTiming>>;
    totalMs: number;
  };
}
