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
} from '@ax-llm/ax';

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

type AIProvider = 'openai' | 'anthropic' | 'google-gemini';

export interface BuildAIOptions {
  aiKey?: string;
  model?: string;
}

function detectProviderFromModel(model: string): AIProvider | undefined {
  if (/^claude-/i.test(model)) return 'anthropic';
  if (/^gpt-|^o[1-9]|^chatgpt-/i.test(model)) return 'openai';
  if (/^gemini/i.test(model)) return 'google-gemini';
  return undefined;
}

function detectProviderFromKey(key: string): AIProvider | undefined {
  if (key.startsWith('AIza')) return 'google-gemini';
  if (key.startsWith('sk-ant-')) return 'anthropic';
  if (key.startsWith('sk-')) return 'openai';
  return undefined;
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
  }
}

/**
 * Build an AxAI instance for GEPA student/teacher roles.
 *
 * Provider is determined by (in order):
 * 1. Model name prefix (unambiguous: claude-* → anthropic, gpt-* → openai, gemini-* → google)
 * 2. Key prefix (fallback when model is not specified)
 *
 * When model implies a provider, the matching key is resolved from env
 * automatically — no need to pass aiKey explicitly.
 */
export function buildAI(options: BuildAIOptions): AxAI {
  const { aiKey: explicitKey, model } = options;
  const envConfig = loadContextEvalsConfig();

  const providerFromModel = model ? detectProviderFromModel(model) : undefined;

  let key = explicitKey || '';
  if (!key && providerFromModel) {
    key = resolveKeyForProvider(providerFromModel, envConfig) || '';
  }
  if (!key) {
    key =
      envConfig.GOOGLE_API_KEY ||
      envConfig.OPENAI_API_KEY ||
      envConfig.ANTHROPIC_API_KEY ||
      '';
  }

  const provider =
    providerFromModel || (key ? detectProviderFromKey(key) : undefined);

  if (!provider) {
    throw new Error(
      'Cannot determine AI provider. Pass --model (e.g. gpt-4o-mini, gemini-2.0-flash) or set an API key env var.',
    );
  }

  if (!key) {
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

export function resolveAIKey(explicitKey: string, model?: string): string {
  if (explicitKey) return explicitKey;
  if (!model) return '';
  const envConfig = loadContextEvalsConfig();
  const provider = detectProviderFromModel(model);
  if (!provider) return '';
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
