import type { TaskUsage } from './wire.js';

/** The attempt fields spend is read from; any task type, any status. */
export interface SpendAttempt {
  usage: TaskUsage | null;
  claimedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

/**
 * What a producer task cost across every attempt it took, failed retries
 * included: an eval comparing models must charge a model for the attempts it
 * needed, not only the accepted one.
 */
export interface ProducerSpend {
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  /** Sum of harness cost estimates, USD; a lower bound unless `costComplete`. */
  estimatedCostUsd: number;
  /** False for missing usage, unfinished attempts, or incomplete pricing. */
  costComplete: boolean;
  /** Summed attempt wall time, start (or claim) to completion. */
  durationMs: number;
}

export function summarizeProducerSpend(
  attempts: readonly SpendAttempt[],
): ProducerSpend {
  const spend: ProducerSpend = {
    attempts: attempts.length,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    estimatedCostUsd: 0,
    costComplete: true,
    durationMs: 0,
  };
  for (const attempt of attempts) {
    if (!attempt.completedAt) spend.costComplete = false;
    const usage = attempt.usage;
    if (usage) {
      spend.inputTokens += usage.inputTokens;
      spend.outputTokens += usage.outputTokens;
      spend.cacheReadTokens += usage.cacheReadTokens ?? 0;
      spend.cacheWriteTokens += usage.cacheWriteTokens ?? 0;
      spend.reasoningTokens += usage.reasoningTokens ?? 0;
      spend.estimatedCostUsd += usage.cost?.total ?? 0;
      // Zero counters without an explicit pricing verdict can be missing
      // runtime telemetry (not proof that a failed attempt was free).
      if (usage.cost?.complete !== true) spend.costComplete = false;
    } else spend.costComplete = false;
    const start = Date.parse(attempt.startedAt ?? attempt.claimedAt);
    const end = attempt.completedAt ? Date.parse(attempt.completedAt) : NaN;
    if (Number.isFinite(start) && Number.isFinite(end) && end > start)
      spend.durationMs += end - start;
  }
  return spend;
}

/** Sum several producers' spend, e.g. every run of one scenario. */
export function mergeProducerSpend(
  spends: readonly ProducerSpend[],
): ProducerSpend {
  return spends.reduce<ProducerSpend>(
    (total, spend) => ({
      attempts: total.attempts + spend.attempts,
      inputTokens: total.inputTokens + spend.inputTokens,
      outputTokens: total.outputTokens + spend.outputTokens,
      cacheReadTokens: total.cacheReadTokens + spend.cacheReadTokens,
      cacheWriteTokens: total.cacheWriteTokens + spend.cacheWriteTokens,
      reasoningTokens: total.reasoningTokens + spend.reasoningTokens,
      estimatedCostUsd: total.estimatedCostUsd + spend.estimatedCostUsd,
      costComplete: total.costComplete && spend.costComplete,
      durationMs: total.durationMs + spend.durationMs,
    }),
    summarizeProducerSpend([]),
  );
}

/** `tokens=… cost=$…` for summaries; `≥` marks a cost missing some usage. */
export function formatProducerSpend(spend: ProducerSpend): string {
  const tokens = spend.inputTokens + spend.outputTokens;
  const cost =
    spend.estimatedCostUsd > 0 || spend.costComplete
      ? `${spend.costComplete ? '' : '≥'}$${spend.estimatedCostUsd.toFixed(4)}`
      : 'unpriced';
  return `tokens=${tokens} cost=${cost} attempts=${spend.attempts}`;
}

export interface WorkflowSpendTask {
  taskId: string;
  stage: string;
}

export interface WorkflowSpendRecord extends WorkflowSpendTask {
  spend: ProducerSpend;
  missing: boolean;
  models: Array<{ model: string; spend: ProducerSpend }>;
}

export interface WorkflowSpendReport {
  version: 1;
  discoveryIncomplete?: boolean;
  records: WorkflowSpendRecord[];
}

/** Only aggregate accounting leaves the collector; task output stays private. */
export async function collectWorkflowSpend(
  tasks: readonly WorkflowSpendTask[],
  readAttempts: (taskId: string) => Promise<readonly SpendAttempt[]>,
): Promise<WorkflowSpendReport> {
  const records: WorkflowSpendRecord[] = [];
  for (const task of new Map(
    tasks.map((item) => [item.taskId, item]),
  ).values()) {
    try {
      const attempts = await readAttempts(task.taskId);
      const groups = new Map<string, SpendAttempt[]>();
      for (const attempt of attempts) {
        const usage = attempt.usage;
        // models/tools are subdivisions of the top-level counters, not extra spend.
        const parts =
          usage?.models?.length || usage?.tools?.length
            ? [
                ...(usage.models ?? []).map((part) => ({
                  model: `${part.provider}/${part.model}`,
                  usage: part,
                })),
                ...(usage.tools ?? []).map((part) => ({
                  model: `tool:${part.tool} (model unknown)`,
                  usage: part,
                })),
              ]
            : [
                {
                  model: usage?.model
                    ? `${usage.provider ?? 'unknown'}/${usage.model}`
                    : 'unknown',
                  usage,
                },
              ];
        for (const part of parts) {
          const group = groups.get(part.model) ?? [];
          group.push({ ...attempt, usage: part.usage ?? null });
          groups.set(part.model, group);
        }
      }
      const spend = summarizeProducerSpend(attempts);
      if (!attempts.length) spend.costComplete = false;
      records.push({
        ...task,
        spend,
        missing: !attempts.length || attempts.some((a) => !a.usage),
        models: [...groups].map(([model, values]) => ({
          model,
          spend: summarizeProducerSpend(values),
        })),
      });
    } catch {
      records.push({
        ...task,
        spend: { ...summarizeProducerSpend([]), costComplete: false },
        missing: true,
        models: [],
      });
    }
  }
  return { version: 1, records };
}

/** Reused task IDs from a workflow rerun are counted once, not per consumer. */
export function mergeWorkflowSpend(
  reports: readonly WorkflowSpendReport[],
): WorkflowSpendReport {
  return {
    version: 1,
    ...(reports.some((report) => report.discoveryIncomplete)
      ? { discoveryIncomplete: true }
      : {}),
    records: [
      ...new Map(
        reports.flatMap((r) => r.records).map((r) => [r.taskId, r]),
      ).values(),
    ],
  };
}

function cell(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\\|`[\]]/g, '\\$&')
    .replace(/[\r\n]/g, ' ')
    .replace(/@/g, '@\u200b');
}

function cost(spend: ProducerSpend): string {
  if (!spend.costComplete && spend.estimatedCostUsd === 0) return 'unknown';
  return `${spend.costComplete ? '' : '≥'}$${spend.estimatedCostUsd.toFixed(4)}`;
}

export function formatWorkflowSpend(report: WorkflowSpendReport): string {
  const records = mergeWorkflowSpend([report]).records;
  const groups = new Map<
    string,
    { stage: string; model: string; spends: ProducerSpend[] }
  >();
  for (const record of records) {
    for (const model of record.models.length
      ? record.models
      : [{ model: 'unknown', spend: record.spend }]) {
      const key = JSON.stringify([record.stage, model.model]);
      const group = groups.get(key) ?? {
        stage: record.stage,
        model: model.model,
        spends: [],
      };
      group.spends.push(model.spend);
      groups.set(key, group);
    }
  }
  const lines = [
    '### Agent workflow spend',
    '',
    'Estimated USD at standard catalog rates, including failed attempts and retries; not provider invoices or off-peak charges.',
    '',
    '| Stage | Model | Attempts | Input tokens | Output tokens | Cache read / write | Estimated cost |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const group of groups.values()) {
    const s = mergeProducerSpend(group.spends);
    lines.push(
      `| ${cell(group.stage)} | ${cell(group.model)} | ${s.attempts} | ${s.inputTokens} | ${s.outputTokens} | ${s.cacheReadTokens} / ${s.cacheWriteTokens} | ${cost(s)} |`,
    );
  }
  const total = mergeProducerSpend(records.map((r) => r.spend));
  if (report.discoveryIncomplete) total.costComplete = false;
  lines.push(
    `| **Total** | | ${total.attempts} | ${total.inputTokens} | ${total.outputTokens} | ${total.cacheReadTokens} / ${total.cacheWriteTokens} | ${records.length ? cost(total) : 'unknown'} |`,
    '',
  );
  const missing = records.filter((r) => r.missing).length;
  const priced = records.filter((r) => r.spend.costComplete).length;
  lines.push(
    `Pricing coverage: ${priced}/${records.length} fully priced tasks; ${missing} with missing telemetry. “≥” marks a known lower bound. Model rows can share an attempt; the total counts each attempt once.`,
    '',
  );
  if (report.discoveryIncomplete)
    lines.push(
      'Task discovery is incomplete; additional tasks may be missing from these totals.',
      '',
    );
  return lines.join('\n');
}
