import { readFile } from 'node:fs/promises';

import {
  type BenchmarkDistribution,
  benchmarkDistribution,
} from './benchmark-stats.js';

export interface TaskReadinessSample {
  runId: string;
  queuedAt: string;
  firstUsefulReceivedAt?: string;
  completedAt?: string;
  success: boolean;
  errorCode?: string;
  phaseMs?: Record<string, number>;
  resources?: {
    cpuPct?: number;
    ramBytes?: number;
    diskReadBytes?: number;
    diskWriteBytes?: number;
    networkBytes?: number;
  };
}

export interface TaskReadinessReport {
  schemaVersion: 1;
  generatedAt: string;
  tasks: number;
  successes: number;
  errors: number;
  errorRate: number;
  throughputPerMinute: number | null;
  queuedToFirstUsefulMs: BenchmarkDistribution | null;
  phaseMs: Record<string, BenchmarkDistribution>;
  resources: Record<string, BenchmarkDistribution>;
}

export function buildTaskReadinessReport(
  samples: readonly TaskReadinessSample[],
  generatedAt = new Date().toISOString(),
): TaskReadinessReport {
  for (const sample of samples) {
    validateSample(sample);
  }

  const successful = samples.filter((sample) => sample.success);
  const readiness = samples.flatMap((sample) => {
    if (!sample.firstUsefulReceivedAt) return [];
    return [
      Date.parse(sample.firstUsefulReceivedAt) - Date.parse(sample.queuedAt),
    ];
  });
  const bounds = samples.reduce(
    (acc, sample) => {
      const start = Date.parse(sample.queuedAt);
      const end = Date.parse(
        sample.completedAt ?? sample.firstUsefulReceivedAt ?? sample.queuedAt,
      );
      return {
        earliestStart: Math.min(acc.earliestStart, start),
        latestEnd: Math.max(acc.latestEnd, end),
      };
    },
    { earliestStart: Infinity, latestEnd: -Infinity },
  );
  const elapsedMinutes =
    samples.length > 0 ? (bounds.latestEnd - bounds.earliestStart) / 60_000 : 0;

  return {
    schemaVersion: 1,
    generatedAt,
    tasks: samples.length,
    successes: successful.length,
    errors: samples.length - successful.length,
    errorRate:
      samples.length > 0
        ? round((samples.length - successful.length) / samples.length)
        : 0,
    throughputPerMinute:
      elapsedMinutes > 0 ? round(successful.length / elapsedMinutes) : null,
    queuedToFirstUsefulMs: benchmarkDistribution(readiness),
    phaseMs: distributionsByKey(samples.map((sample) => sample.phaseMs)),
    resources: distributionsByKey(samples.map((sample) => sample.resources)),
  };
}

function validateSample(sample: TaskReadinessSample): void {
  if (typeof sample.runId !== 'string' || sample.runId.length === 0) {
    throw new Error('runId is required');
  }
  if (typeof sample.queuedAt !== 'string') {
    throw new Error('queuedAt must be ISO-8601');
  }
  const queuedAt = Date.parse(sample.queuedAt);
  if (!Number.isFinite(queuedAt)) throw new Error('queuedAt must be ISO-8601');
  if (typeof sample.success !== 'boolean') {
    throw new Error('success must be a boolean');
  }
  if (sample.success && !sample.firstUsefulReceivedAt) {
    throw new Error(`successful sample ${sample.runId} has no useful event`);
  }
  if (sample.firstUsefulReceivedAt) {
    if (typeof sample.firstUsefulReceivedAt !== 'string') {
      throw new Error(
        `sample ${sample.runId} firstUsefulReceivedAt must be ISO-8601`,
      );
    }
    const firstUsefulReceivedAt = Date.parse(sample.firstUsefulReceivedAt);
    if (!Number.isFinite(firstUsefulReceivedAt)) {
      throw new Error(
        `sample ${sample.runId} firstUsefulReceivedAt must be ISO-8601`,
      );
    }
    if (firstUsefulReceivedAt < queuedAt) {
      throw new Error(
        `sample ${sample.runId} has a useful event before queueing`,
      );
    }
  }
  if (sample.completedAt) {
    if (typeof sample.completedAt !== 'string') {
      throw new Error(`sample ${sample.runId} completedAt must be ISO-8601`);
    }
    const completedAt = Date.parse(sample.completedAt);
    if (!Number.isFinite(completedAt)) {
      throw new Error(`sample ${sample.runId} completedAt must be ISO-8601`);
    }
    if (completedAt < queuedAt) {
      throw new Error(`sample ${sample.runId} completed before queueing`);
    }
  }
}

function distributionsByKey(
  rows: Array<Record<string, number> | undefined>,
): Record<string, BenchmarkDistribution> {
  const values = new Map<string, number[]>();
  for (const row of rows) {
    for (const [key, value] of Object.entries(row ?? {})) {
      if (!Number.isFinite(value) || value < 0) continue;
      const group = values.get(key) ?? [];
      group.push(value);
      values.set(key, group);
    }
  }
  return Object.fromEntries(
    [...values.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .flatMap(([key, value]) => {
        const stats = benchmarkDistribution(value);
        return stats ? [[key, stats]] : [];
      }),
  );
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

export function parseTaskReadinessSample(
  line: string,
  lineNumber: number,
): TaskReadinessSample {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    throw new Error(
      `Invalid JSON on line ${lineNumber}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(parsed)) {
    throw new Error(
      `Invalid sample on line ${lineNumber}: expected a JSON object`,
    );
  }
  const sample = parsed as unknown as TaskReadinessSample;
  try {
    validateSample(sample);
  } catch (error) {
    throw new Error(
      `Invalid sample on line ${lineNumber}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return sample;
}

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  if (!inputPath) {
    throw new Error('Usage: bench:task-readiness <samples.jsonl>');
  }
  const lines = (await readFile(inputPath, 'utf8'))
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  const samples = lines.map((line, index) =>
    parseTaskReadinessSample(line, index + 1),
  );
  process.stdout.write(
    `${JSON.stringify(buildTaskReadinessReport(samples), null, 2)}\n`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
