import { type Static, Type } from '@sinclair/typebox';

// ── Task output type (formerly from @moltnet/context-evals) ──

const NonEmptyString = Type.String({ minLength: 1 });
const NonEmptyStringArray = Type.Array(NonEmptyString);

export const TasksmithTaskSchema = Type.Object({
  task_id: NonEmptyString,
  fixture_ref: NonEmptyString,
  gold_fix_ref: NonEmptyString,
  source_commit_ref: NonEmptyString,
  source_commit_refs: Type.Optional(NonEmptyStringArray),
  problem_statement: NonEmptyString,
  family: NonEmptyString,
  secondary_families: Type.Optional(NonEmptyStringArray),
  subsystems: Type.Optional(NonEmptyStringArray),
  changed_files: Type.Optional(NonEmptyStringArray),
  fail_to_pass: Type.Array(NonEmptyString, { minItems: 1 }),
  pass_to_pass: Type.Array(NonEmptyString),
  diary_entry_ids: Type.Optional(NonEmptyStringArray),
  confidence: Type.Optional(NonEmptyString),
});

export type TasksmithTask = Static<typeof TasksmithTaskSchema>;

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

// ── Extraction result (Phase 2 output) ──

export const CriteriaItemSchema = Type.Object({
  description: Type.String(),
  check_type: Type.Union([
    Type.Literal('test_passes'),
    Type.Literal('file_exists'),
    Type.Literal('export_exists'),
    Type.Literal('pattern_present'),
    Type.Literal('type_checks'),
    Type.Literal('behavioral'),
  ]),
  weight: Type.Number({ minimum: 0, maximum: 1 }),
  // Type-specific optional fields
  module: Type.Optional(Type.String()),
  symbol: Type.Optional(Type.String()),
  path: Type.Optional(Type.String()),
  pattern: Type.Optional(Type.String()),
});

export type CriteriaItem = Static<typeof CriteriaItemSchema>;

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
