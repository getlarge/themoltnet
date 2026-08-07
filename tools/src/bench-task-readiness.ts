import { readFile } from 'node:fs/promises';

export interface TaskReadinessSample {
  runId: string;
  scenario: string;
  coldCategory:
    | 'cell_provisioning'
    | 'daemon_start'
    | 'snapshot_build'
    | 'vm_resume'
    | 'warm_continuation';
  topology: 'baseline' | 'compact' | 'split';
  authMode: 'oauth2' | 'agent_key';
  oryPlacement: 'managed' | 'local_postgres' | 'local_sqlite';
  virtualization: 'none' | 'kvm' | 'tcg';
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

interface Distribution {
  count: number;
  min: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
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
    throughputPerMinute: number;
    queuedToFirstUsefulMs: Distribution | null;
    phaseMs: Record<string, Distribution>;
    resources: Record<string, Distribution>;
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
        const readiness = successful.flatMap((sample) => {
          if (!sample.firstUsefulReceivedAt) return [];
          return [
            Date.parse(sample.firstUsefulReceivedAt) -
              Date.parse(sample.queuedAt),
          ];
        });
        const starts = group.map((sample) => Date.parse(sample.queuedAt));
        const ends = group.map((sample) =>
          Date.parse(
            sample.completedAt ??
              sample.firstUsefulReceivedAt ??
              sample.queuedAt,
          ),
        );
        const elapsedMinutes = Math.max(
          1 / 60_000,
          (Math.max(...ends) - Math.min(...starts)) / 60_000,
        );
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
          throughputPerMinute: round(successful.length / elapsedMinutes),
          queuedToFirstUsefulMs: distribution(readiness),
          phaseMs: distributionsByKey(group.map((sample) => sample.phaseMs)),
          resources: distributionsByKey(
            group.map((sample) => sample.resources),
          ),
        };
      }),
  };
}

function validateSample(sample: TaskReadinessSample): void {
  if (!sample.runId || !sample.scenario) {
    throw new Error('runId and scenario are required');
  }
  const queuedAt = Date.parse(sample.queuedAt);
  if (!Number.isFinite(queuedAt)) throw new Error('queuedAt must be ISO-8601');
  if (sample.success && !sample.firstUsefulReceivedAt) {
    throw new Error(`successful sample ${sample.runId} has no useful event`);
  }
  if (
    sample.firstUsefulReceivedAt &&
    Date.parse(sample.firstUsefulReceivedAt) < queuedAt
  ) {
    throw new Error(
      `sample ${sample.runId} has a useful event before queueing`,
    );
  }
}

function distributionsByKey(
  rows: Array<Record<string, number> | undefined>,
): Record<string, Distribution> {
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
        const stats = distribution(value);
        return stats ? [[key, stats]] : [];
      }),
  );
}

function distribution(values: readonly number[]): Distribution | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    min: round(sorted[0]),
    p50: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    p99: round(percentile(sorted, 0.99)),
    max: round(sorted[sorted.length - 1]),
    mean: round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length),
  };
}

function percentile(sorted: readonly number[], quantile: number): number {
  const rank = Math.max(0, Math.ceil(quantile * sorted.length) - 1);
  return sorted[rank];
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  if (!inputPath) {
    throw new Error('Usage: bench:task-readiness <samples.jsonl>');
  }
  const lines = (await readFile(inputPath, 'utf8'))
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  const samples = lines.map((line, index) => {
    try {
      return JSON.parse(line) as TaskReadinessSample;
    } catch (error) {
      throw new Error(
        `Invalid JSON on line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
  process.stdout.write(
    `${JSON.stringify(buildTaskReadinessReport(samples), null, 2)}\n`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
