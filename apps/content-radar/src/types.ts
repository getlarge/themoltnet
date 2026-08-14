import type {
  Logger,
  SdkTaskAttempt,
  TaskClient,
} from '@themoltnet/tasks-orchestrator';

/**
 * Content radar turns two independent evidence streams — what the operator
 * actually shipped, and what the watched market announced — into correlated
 * writing tracks, then drafts one evidence dossier per accepted track.
 *
 * The trusted/untrusted split mirrors `apps/multi-lens-review`: agents produce
 * candidate bodies, trusted code issues every identifier those bodies are
 * allowed to cite. An agent can therefore propose a track or a claim, but it
 * cannot invent a source.
 */

export const WATCHLIST_CONTENT_TYPE =
  'application/vnd.themoltnet.content-radar-watchlist+json;version=1';
export const SIGNAL_LEDGER_CONTENT_TYPE =
  'application/vnd.themoltnet.content-radar-signal-ledger+json;version=1';
export const DOSSIER_CONTENT_TYPE = 'text/markdown;charset=utf-8';

export const WORK_SIGNALS_ARTIFACT_KIND = 'content-radar-work-signals';
export const MARKET_SIGNALS_ARTIFACT_KIND = 'content-radar-market-signals';
export const TRACK_PLAN_ARTIFACT_KIND = 'content-radar-track-plan';
export const DOSSIER_ARTIFACT_KIND = 'content-radar-dossier';
export const WIREFRAME_ARTIFACT_KIND = 'content-radar-wireframe';

/** Bounds enforced by trusted code, never by prompt text alone. */
export const MAX_REPOS = 6;
export const MAX_WATCH_SEGMENTS = 4;
export const MAX_WORK_SIGNALS_PER_REPO = 12;
export const MAX_MARKET_SIGNALS_PER_SEGMENT = 15;
export const MAX_TRACKS = 6;
export const MAX_DRAFT_TASKS = 4;
export const MAX_SIGNALS_PER_TRACK = 8;
export const MAX_CLAIMS_PER_DOSSIER = 40;

/** Output formats a track can be drafted for. */
export const TRACK_FORMATS = ['article', 'post', 'video_script'] as const;
export type TrackFormat = (typeof TRACK_FORMATS)[number];

/** Where a work signal came from. Extend deliberately: each kind is a lane. */
export const WORK_SIGNAL_KINDS = [
  'pull_request',
  'issue',
  'release',
  'diary_entry',
  'commit_series',
] as const;
export type WorkSignalKind = (typeof WORK_SIGNAL_KINDS)[number];

/**
 * One repository the scan phase inspects. `slug` is the trusted short name used
 * to derive signal ids, so it must be stable across runs of the same watchlist.
 */
export interface RepoTarget {
  slug: string;
  repository: string;
  sinceDays: number;
  /** Optional diary the scan agent may search for rationale behind the work. */
  diaryId?: string;
  focus?: string;
}

/**
 * One watchlist segment the sweep phase queries. Queries are host-authored:
 * the agent chooses how to search within the segment but cannot widen it to
 * organisations the operator never listed.
 */
export interface WatchSegment {
  slug: string;
  title: string;
  organisations: string[];
  queries: string[];
  sinceDays: number;
}

export interface Watchlist {
  version: 1;
  repos: RepoTarget[];
  segments: WatchSegment[];
  /** Free-text steer for correlation, e.g. the season's talk themes. */
  editorialFocus?: string;
}

/** The hashed, staged watchlist the run is bound to. */
export interface WatchlistManifest {
  watchlist: Watchlist;
  sha256: string;
  artifact: StagedArtifact;
}

export interface StagedArtifact {
  cid: string;
  title: string;
  contentType: string;
  sizeBytes: number;
}

/**
 * A signal after trusted code has stamped it. `id` is issued here, never by the
 * model, and is the only token downstream phases may cite.
 */
export interface WorkSignal {
  id: string;
  repoSlug: string;
  kind: WorkSignalKind;
  title: string;
  reference: string;
  summary: string;
  evidence: string;
  occurredAt?: string;
}

export interface MarketSignal {
  id: string;
  segmentSlug: string;
  organisation: string;
  title: string;
  url: string;
  summary: string;
  publishedAt?: string;
}

export interface SignalLedger {
  work: WorkSignal[];
  market: MarketSignal[];
}

/** Agent-proposed track, before trusted validation. */
export interface TrackCandidate {
  id: string;
  title: string;
  thesis: string;
  format: TrackFormat;
  workSignalIds: string[];
  marketSignalIds: string[];
  rationale: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface TrackPlan {
  version: 1;
  tracks: TrackCandidate[];
  discarded?: Array<{ title: string; reason: string }>;
}

/** One traceable assertion inside a dossier. */
export interface DossierClaim {
  signalId: string;
  claim: string;
}

export interface TrackDossier {
  version: 1;
  trackId: string;
  slug: string;
  workingTitle: string;
  description: string;
  tags: string[];
  claims: DossierClaim[];
  openQuestions: string[];
  dossierArtifact: StagedArtifact;
  wireframeArtifact: StagedArtifact;
}

/** Compact reference to an accepted phase output, stored durably. */
export interface AcceptedOutputReference {
  taskId: string;
  attemptN: number;
  outputCid: string;
}

export interface ContentRadarPhaseOutputs {
  workScans: AcceptedOutputReference[];
  marketSweeps: AcceptedOutputReference[];
  correlation?: AcceptedOutputReference;
  drafts: AcceptedOutputReference[];
}

export interface ContentRadarProfileRouting {
  defaultProfileId: string;
  scanProfileId?: string;
  sweepProfileId?: string;
  correlateProfileId?: string;
  draftProfileId?: string;
}

export interface ContentRadarCostDiagnostics {
  inputTokens: number;
  outputTokens: number;
  tasksCreated: number;
}

export interface ContentRadarDiagnostics {
  cost: ContentRadarCostDiagnostics;
  workSignals: number;
  marketSignals: number;
  tracksPlanned: number;
  tracksDrafted: number;
  watchlistSha256: string;
}

export interface ContentRadarInput {
  teamId: string;
  diaryId: string;
  correlationId: string;
  watchlistManifest: WatchlistManifest;
  /** Cap on drafted tracks; trusted code clamps it to {@link MAX_DRAFT_TASKS}. */
  maxDrafts: number;
  pollIntervalSec?: number;
  concurrency?: number;
  profileRouting?: ContentRadarProfileRouting;
}

export interface ArtifactStore {
  stage(
    bytes: Uint8Array,
    options: { contentType: string },
    context: { teamId: string },
  ): Promise<{ cid: string; contentType?: string; sizeBytes: number }>;
}

export interface ContentRadarDeps {
  tasks: TaskClient;
  artifacts: ArtifactStore;
  logger?: Logger;
}

export interface ContentRadarOutput {
  correlationId: string;
  outcome: 'drafted' | 'no_tracks';
  ledger: SignalLedger;
  plan: TrackPlan;
  dossiers: TrackDossier[];
  phaseOutputs: ContentRadarPhaseOutputs;
  diagnostics: ContentRadarDiagnostics;
}

/**
 * The only content-radar result Absurd persists: references and counts, never
 * agent-produced bodies. Callers hydrate prose from MoltNet on demand.
 */
export interface ContentRadarDurableOutput {
  correlationId: string;
  outcome: ContentRadarOutput['outcome'];
  phaseOutputs: ContentRadarPhaseOutputs;
  diagnostics: ContentRadarDiagnostics;
}

export type AttemptUsage = SdkTaskAttempt['usage'];
