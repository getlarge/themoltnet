import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import { type Static, Type } from '@sinclair/typebox';

// ── Schema ────────────────────────────────────────────────────────────────────

const NonEmptyString = Type.String({ minLength: 1 });

export const SkillEvalTaskSchema = Type.Object({
  id: NonEmptyString,
  baseCommit: NonEmptyString,
  taskPrompt: NonEmptyString,
  patchFiles: Type.Array(NonEmptyString, { minItems: 1 }),
  skillPath: NonEmptyString,
  env: Type.Optional(Type.Record(Type.String(), Type.String())),
  expected: Type.Optional(Type.Unknown()),
});

export type SkillEvalTask = Static<typeof SkillEvalTaskSchema>;

// ── Trace ─────────────────────────────────────────────────────────────────────

export interface SkillEvalTrace {
  taskId: string;
  worktreeDir?: string;
  taskPrompt: string;
  executor: 'anthropic-sdk';
  sessionId?: string;
  turnCount?: number;
  durationMs?: number;
  costUsd?: number;
  toolCallCount?: number;
  toolSummaries?: string[];
  /** Opaque result from the skill-specific scorer. */
  scoreResult: unknown;
}

// ── Scorer interface ──────────────────────────────────────────────────────────

export interface SkillScorer<TExpected = unknown, TScoreResult = unknown> {
  /** Score the worktree state after the agent finishes. */
  score(worktreeDir: string, expected: TExpected): Promise<TScoreResult>;
  /** Extract a numeric score (0.0–1.0) from the scorer's result. */
  toNumeric(result: TScoreResult): number;
  /** Build reflective feedback string from the scorer's result. */
  toFeedback(result: TScoreResult, task: SkillEvalTask): string;
}

// ── Adapter options ───────────────────────────────────────────────────────────

export interface SkillEvalAdapterOptions {
  preamble: string;
  epilogue: string;
  mcpServers: Record<string, McpServerConfig>;
  agentConfigDir: string;
  agentName: string;
  scorer: SkillScorer;
  claudeModel?: string;
  verbose?: boolean;
}
