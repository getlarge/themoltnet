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

// Qwen via DashScope OpenAI-compatible endpoint
const QWEN_API_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
const QWEN_DEFAULT_MODEL = 'qwen-plus' as const;

export interface BuildAIOptions {
  aiKey: string;
  model?: string;
}

/**
 * Build an AxAI instance from a key + optional model override.
 *
 * GEPA terminology:
 * - **studentAI**: the model whose prompts are being optimized (cheap/fast).
 * - **teacherAI**: a more capable model that proposes better instructions
 *   during the reflection step (optional but recommended).
 *
 * Use this function for both roles — pass different model strings.
 */
export function buildAI(options: BuildAIOptions): AxAI {
  const { aiKey: key, model: modelOverride } = options;
  const envConfig = loadContextEvalsConfig();

  if (!key) {
    throw new Error(
      'No AI key found. Set GOOGLE_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, or DASHSCOPE_API_KEY, or pass --ai-key',
    );
  }

  // Google Gemini (key starts with "AIza")
  if (key.startsWith('AIza') || envConfig.GOOGLE_API_KEY === key) {
    return AxAI.create({
      name: 'google-gemini',
      apiKey: key,
      config: {
        model: (modelOverride ||
          AxAIGoogleGeminiModel.Gemini20Flash) as AxAIGoogleGeminiModel,
      },
    });
  }

  // Qwen / DashScope key (starts with "sk-" but routed via dashscope)
  if (envConfig.DASHSCOPE_API_KEY === key) {
    return AxAI.create({
      name: 'openai',
      apiKey: key,
      apiURL: QWEN_API_URL,
      config: {
        model: (modelOverride || QWEN_DEFAULT_MODEL) as AxAIOpenAIModel,
      },
    });
  }

  if (key.startsWith('sk-ant-') || envConfig.ANTHROPIC_API_KEY === key) {
    return AxAI.create({
      name: 'anthropic',
      apiKey: key,
      config: {
        model: (modelOverride ||
          AxAIAnthropicModel.Claude35Haiku) as AxAIAnthropicModel,
      },
    });
  }

  return AxAI.create({
    name: 'openai',
    apiKey: key,
    config: {
      model: (modelOverride || AxAIOpenAIModel.GPT4OMini) as AxAIOpenAIModel,
    },
  });
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

export function resolveAIKey(explicitKey: string): string {
  if (explicitKey) return explicitKey;
  const envConfig = loadContextEvalsConfig();
  return (
    envConfig.GOOGLE_API_KEY ||
    envConfig.OPENAI_API_KEY ||
    envConfig.ANTHROPIC_API_KEY ||
    envConfig.DASHSCOPE_API_KEY ||
    ''
  );
}

// ── Pack file loading ────────────────────────────────────────────────────────

export async function loadPackFile(
  repoRoot: string,
  packFile: string,
): Promise<string> {
  const resolvedPath = resolve(repoRoot, packFile);
  return readFile(resolvedPath, 'utf8');
}
