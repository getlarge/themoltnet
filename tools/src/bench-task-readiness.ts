import { readFile } from 'node:fs/promises';

import {
  TASK_READINESS_AUTH_MODES,
  TASK_READINESS_COLD_CATEGORIES,
  TASK_READINESS_ORY_PLACEMENTS,
  TASK_READINESS_TOPOLOGIES,
  TASK_READINESS_VIRTUALIZATION_MODES,
  type TaskReadinessAuthMode,
  type TaskReadinessColdCategory,
  type TaskReadinessOryPlacement,
  type TaskReadinessTopology,
  type TaskReadinessVirtualizationMode,
} from '@moltnet/tasks';

import {
  type BenchmarkDistribution,
  benchmarkDistribution,
} from './benchmark-stats.js';

export interface TaskReadinessSample {
  runId: string;
  scenario: string;
  coldCategory: TaskReadinessColdCategory;
  topology: TaskReadinessTopology;
  authMode: TaskReadinessAuthMode;
  oryPlacement: TaskReadinessOryPlacement;
  virtualization: TaskReadinessVirtualizationMode;
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
  groups: Array<{
    key: string;
    dimensions: Pick<
      TaskReadinessSample,
      | 'scenario'
      | 'coldCategory'
      | 'topology'
      | 'authMode'
      | 'oryPlacement'
      | 'virtualization'
    >;
    tasks: number;
    successes: number;
    errors: number;
    errorRate: number;
    throughputPerMinute: number | null;
    queuedToFirstUsefulMs: BenchmarkDistribution | null;
    phaseMs: Record<string, BenchmarkDistribution>;
    resources: Record<string, BenchmarkDistribution>;
  }>;
}

const dimensions = [
  'scenario',
  'coldCategory',
  'topology',
  'authMode',
  'oryPlacement',
  'virtualization',
] as const;

export function buildTaskReadinessReport(
  samples: readonly TaskReadinessSample[],
  generatedAt = new Date().toISOString(),
): TaskReadinessReport {
  const grouped = new Map<string, TaskReadinessSample[]>();
  for (const sample of samples) {
    validateSample(sample);
    const key = dimensions.map((field) => sample[field]).join('|');
    const group = grouped.get(key) ?? [];
    group.push(sample);
    grouped.set(key, group);
  }

  return {
    schemaVersion: 1,
    generatedAt,
    groups: [...grouped.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, group]) => {
        const successful = group.filter((sample) => sample.success);
        const readiness = group.flatMap((sample) => {
          if (!sample.firstUsefulReceivedAt) return [];
          return [
            Date.parse(sample.firstUsefulReceivedAt) -
              Date.parse(sample.queuedAt),
          ];
        });
        const bounds = group.reduce(
          (acc, sample) => {
            const start = Date.parse(sample.queuedAt);
            const end = Date.parse(
              sample.completedAt ??
                sample.firstUsefulReceivedAt ??
                sample.queuedAt,
            );
            return {
              earliestStart: Math.min(acc.earliestStart, start),
              latestEnd: Math.max(acc.latestEnd, end),
            };
          },
          { earliestStart: Infinity, latestEnd: -Infinity },
        );
        const elapsedMinutes =
          (bounds.latestEnd - bounds.earliestStart) / 60_000;
        const first = group[0];
        return {
          key,
          dimensions: {
            scenario: first.scenario,
            coldCategory: first.coldCategory,
            topology: first.topology,
            authMode: first.authMode,
            oryPlacement: first.oryPlacement,
            virtualization: first.virtualization,
          },
          tasks: group.length,
          successes: successful.length,
          errors: group.length - successful.length,
          errorRate: round((group.length - successful.length) / group.length),
          throughputPerMinute:
            elapsedMinutes > 0
              ? round(successful.length / elapsedMinutes)
              : null,
          queuedToFirstUsefulMs: benchmarkDistribution(readiness),
          phaseMs: distributionsByKey(group.map((sample) => sample.phaseMs)),
          resources: distributionsByKey(
            group.map((sample) => sample.resources),
          ),
        };
      }),
  };
}

function validateSample(sample: TaskReadinessSample): void {
  if (
    typeof sample.runId !== 'string' ||
    sample.runId.length === 0 ||
    typeof sample.scenario !== 'string' ||
    sample.scenario.length === 0
  ) {
    throw new Error('runId and scenario are required');
  }
  if (typeof sample.queuedAt !== 'string') {
    throw new Error('queuedAt must be ISO-8601');
  }
  const queuedAt = Date.parse(sample.queuedAt);
  if (!Number.isFinite(queuedAt)) throw new Error('queuedAt must be ISO-8601');
  validateDimension(
    'coldCategory',
    sample.coldCategory,
    TASK_READINESS_COLD_CATEGORIES,
  );
  validateDimension('topology', sample.topology, TASK_READINESS_TOPOLOGIES);
  validateDimension('authMode', sample.authMode, TASK_READINESS_AUTH_MODES);
  validateDimension(
    'oryPlacement',
    sample.oryPlacement,
    TASK_READINESS_ORY_PLACEMENTS,
  );
  validateDimension(
    'virtualization',
    sample.virtualization,
    TASK_READINESS_VIRTUALIZATION_MODES,
  );
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

function validateDimension(
  name: string,
  value: unknown,
  allowed: readonly string[],
): void {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new Error(`${name} must be one of: ${allowed.join(', ')}`);
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
