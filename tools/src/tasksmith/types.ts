import { type CriteriaItem, CriteriaItemSchema } from '@moltnet/context-evals';
import { type Static, Type } from '@sinclair/typebox';

export { type CriteriaItem, CriteriaItemSchema };

// ── PR candidate (Phase 1 output) ──

export const PrCandidateSchema = Type.Object({
  number: Type.Number(),
  title: Type.String(),
  body: Type.String(),
  baseRefName: Type.String(),
  headRefOid: Type.String(),
  mergeCommitOid: Type.String(),
  labels: Type.Array(Type.String()),
  closedAt: Type.String(),
  changedFiles: Type.Array(Type.String()),
  changedTestFiles: Type.Array(Type.String()),
  fixtureRef: Type.String(),
  goldFixRef: Type.String(),
  linkedIssueBody: Type.Optional(Type.String()),
});

export type PrCandidate = Static<typeof PrCandidateSchema>;

export interface ExtractionResult {
  isViable: boolean;
  failToPass: string[];
  passToPass: string[];
  problemStatement: string;
  family: 'bugfix' | 'feature' | 'refactor' | 'test' | 'infra';
  subsystems: string[];
  criteria: CriteriaItem[];
  /** LLM's reason if not viable */
  skipReason?: string;
}

// ── Verification result (Phase 3 output) ──

export interface CommandCheck {
  command: string;
  passed: boolean;
  output: string;
  durationMs: number;
}

export interface VerificationResult {
  pr: number;
  status:
    | 'verified'
    | 'unit_verified'
    | 'extracted_unverified'
    | 'fixture_already_green'
    | 'fix_doesnt_pass'
    | 'extraction_not_viable'
    | 'discovery_error';
  redCheck?: { passed: boolean; commands: CommandCheck[]; durationMs: number };
  greenCheck?: {
    passed: boolean;
    commands: CommandCheck[];
    durationMs: number;
  };
  regressionCheck?: { passed: boolean; removed: string[] };
  /** Docker-dependent commands deferred to the Docker verification phase. */
  deferredDockerCommands?: {
    failToPass: string[];
    passToPass: string[];
  };
  skipReason?: string;
}

// ── Harvest state ──

export interface HarvestState {
  processed_prs: number[];
  last_run: string;
  errors?: Record<number, string>;
}

// ── CLI options ──

export interface HarvestOptions {
  prs?: number[];
  force?: boolean;
  skipVerify?: boolean;
  verifyOnly?: boolean;
  studentProvider?: string;
  studentModel?: string;
  teacherProvider?: string;
  teacherModel?: string;
  concurrency?: number;
  debug?: boolean;
}
