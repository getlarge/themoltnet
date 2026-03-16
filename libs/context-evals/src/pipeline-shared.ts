/* eslint-disable no-console */
/**
 * pipeline-shared.ts — Shared utilities for gpack and skill-eval pipelines.
 *
 * Extracted from the original monolithic pipeline.ts to allow gpack (context
 * pack optimization) and skill-eval (skill section optimization) to share
 * common infrastructure without duplicating code.
 */

import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  AxAI,
  AxAIAnthropicModel,
  AxAIGoogleGeminiModel,
  AxAIOpenAIModel,
  type AxAIService,
} from '@ax-llm/ax';

import { AxAIClaudeAgentSDK } from './ax-claude-agent-sdk.js';
import { AxAICodexAgentSDK } from './ax-codex-agent-sdk.js';
export { AxAIClaudeAgentSDK } from './ax-claude-agent-sdk.js';
export { AxAICodexAgentSDK } from './ax-codex-agent-sdk.js';
import { loadContextEvalsConfig } from './config.js';
import type { EvalTrace } from './evaluate.js';
import { execFileText } from './process.js';

// ── Env + repo root ──────────────────────────────────────────────────────────

export async function resolveRepoRoot(): Promise<string> {
  return (await execFileText('git', ['rev-parse', '--show-toplevel'])).trim();
}

export async function loadEnvLocal(repoRoot: string): Promise<void> {
  const envLocalPath = resolve(repoRoot, '.env.local');
  try {
    await access(envLocalPath);
    process.loadEnvFile(envLocalPath);
  } catch {
    // optional
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

export function buildAverage(scores: number[]): number {
  return (
    scores.reduce((sum, score) => sum + score, 0) / Math.max(1, scores.length)
  );
}

export function buildCacheKey(taskId: string, content: string): string {
  return `${taskId}:${createHash('sha256').update(content).digest('hex').slice(0, 16)}`;
}

// ── AI provider ──────────────────────────────────────────────────────────────

export type AIProvider =
  | 'openai'
  | 'anthropic'
  | 'google-gemini'
  | 'claude-agent-sdk'
  | 'codex-agent-sdk';

export interface BuildAIOptions {
  provider: AIProvider;
  aiKey?: string;
  model?: string;
}

function resolveKeyForProvider(
  provider: AIProvider,
  envConfig: {
    GOOGLE_API_KEY?: string;
    OPENAI_API_KEY?: string;
    ANTHROPIC_API_KEY?: string;
  },
): string | undefined {
  switch (provider) {
    case 'google-gemini':
      return envConfig.GOOGLE_API_KEY;
    case 'anthropic':
      return envConfig.ANTHROPIC_API_KEY;
    case 'openai':
      return envConfig.OPENAI_API_KEY;
    case 'claude-agent-sdk':
    case 'codex-agent-sdk':
      return undefined;
  }
}

/**
 * Build an AxAIService instance for GEPA student/teacher roles.
 *
 * Caller specifies the provider explicitly. The matching API key is
 * resolved from env when not passed directly. `claude-agent-sdk`
 * needs no key — it authenticates via the host's credential store.
 */
export function buildAI(options: BuildAIOptions): AxAIService {
  const { provider, aiKey: explicitKey, model } = options;
  const envConfig = loadContextEvalsConfig();

  const key = explicitKey || resolveKeyForProvider(provider, envConfig) || '';

  if (
    !key &&
    provider !== 'claude-agent-sdk' &&
    provider !== 'codex-agent-sdk'
  ) {
    throw new Error(
      `Provider "${provider}" requires an API key. Set the corresponding env var or pass --ai-key.`,
    );
  }

  switch (provider) {
    case 'google-gemini':
      return AxAI.create({
        name: 'google-gemini',
        apiKey: key,
        config: {
          model: (model ||
            AxAIGoogleGeminiModel.Gemini20Flash) as AxAIGoogleGeminiModel,
        },
      });

    case 'anthropic':
      return AxAI.create({
        name: 'anthropic',
        apiKey: key,
        config: {
          model: (model ||
            AxAIAnthropicModel.Claude35Haiku) as AxAIAnthropicModel,
        },
      });

    case 'openai':
      return AxAI.create({
        name: 'openai',
        apiKey: key,
        config: {
          model: (model || AxAIOpenAIModel.GPT4OMini) as AxAIOpenAIModel,
        },
      });

    case 'claude-agent-sdk':
      return new AxAIClaudeAgentSDK({ model });

    case 'codex-agent-sdk':
      return new AxAICodexAgentSDK({ model });
  }
}

// ── Debug traces ─────────────────────────────────────────────────────────────

export interface DebugTraceArtifact {
  phase: 'baseline' | 'final';
  evals: string[];
  scores: number[];
  averageScore: number;
  traces: EvalTrace[];
}

export async function writeDebugArtifact(
  repoRoot: string,
  artifactName: string,
  artifact: DebugTraceArtifact,
): Promise<void> {
  const outDir = resolve(repoRoot, 'evals', 'runs');
  await mkdir(outDir, { recursive: true });
  const outPath = resolve(outDir, artifactName);
  await writeFile(outPath, JSON.stringify(artifact, null, 2), 'utf8');
  console.log(`[gpack] debug traces saved to ${outPath}`);
}

// ── Resolve AI key from args + env ───────────────────────────────────────────

export function resolveAIKey(
  explicitKey: string,
  provider?: AIProvider,
): string {
  if (explicitKey) return explicitKey;
  if (
    !provider ||
    provider === 'claude-agent-sdk' ||
    provider === 'codex-agent-sdk'
  ) {
    return '';
  }
  const envConfig = loadContextEvalsConfig();
  return resolveKeyForProvider(provider, envConfig) || '';
}

// ── Pack file loading ────────────────────────────────────────────────────────

export async function loadPackFile(
  repoRoot: string,
  packFile: string,
): Promise<string> {
  const resolvedPath = resolve(repoRoot, packFile);
  return readFile(resolvedPath, 'utf8');
}
