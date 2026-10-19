import {
  mergeProducerSpend,
  type ProducerSpend,
  type SpendAttempt,
  summarizeProducerSpend,
} from './producer-spend.js';

export interface EvalSpendContext {
  suite: string;
  collectedAt?: string;
  event?: string;
  schedule?: string;
  runId?: string;
  runAttempt?: string;
  job?: string;
  sourceSha?: string;
  corpusRevision?: string;
  pricingCatalogSha256?: string;
  restApiImage?: string;
}

export interface EvalSpendTask {
  taskId: string;
  scenario: string;
  provider: string;
  model: string;
  role: 'producer' | 'judge';
  /** Associates judge overhead with the model under evaluation. */
  producerTaskId?: string;
  /** Outcome of this sampling run; a later task may retry the same scenario. */
  evaluation?: { gatesPassed: boolean; judgedScore?: number };
}

export interface EvalSpendRecord extends EvalSpendTask {
  spend?: ProducerSpend;
  /** Missing telemetry is unknown spend, never a free task. */
  error?: 'attempts_unavailable' | 'no_attempts';
}

export interface EvalSpendTotal {
  tasks: number;
  fullyPricedTasks: number;
  partiallyPricedTasks: number;
  unpricedTasks: number;
  missingTasks: number;
  usage: ProducerSpend;
}

interface SpendTotals {
  producer: EvalSpendTotal;
  judge: EvalSpendTotal;
  combined: EvalSpendTotal;
}

export interface EvalSpendReport {
  schemaVersion: 1;
  context: EvalSpendContext;
  currency: 'USD';
  pricingBasis: 'standard-rate-estimate';
  records: EvalSpendRecord[];
  totals: SpendTotals;
  models: (SpendTotals & {
    provider: string;
    model: string;
    scenarios: number;
    gatesPassed: number;
    meanJudgedScore?: number;
  })[];
}

function total(records: readonly EvalSpendRecord[]): EvalSpendTotal {
  const result: EvalSpendTotal = {
    tasks: records.length,
    fullyPricedTasks: 0,
    partiallyPricedTasks: 0,
    unpricedTasks: 0,
    missingTasks: 0,
    usage: mergeProducerSpend(
      records.flatMap((r) => (r.spend ? [r.spend] : [])),
    ),
  };
  for (const record of records) {
    if (!record.spend) result.missingTasks++;
    else if (record.spend.costComplete) result.fullyPricedTasks++;
    else if (record.spend.estimatedCostUsd > 0) result.partiallyPricedTasks++;
    else result.unpricedTasks++;
  }
  if (result.missingTasks > 0) result.usage.costComplete = false;
  return result;
}

function totals(records: readonly EvalSpendRecord[]): SpendTotals {
  return {
    producer: total(records.filter((r) => r.role === 'producer')),
    judge: total(records.filter((r) => r.role === 'judge')),
    combined: total(records),
  };
}

/** Collect every registered task, including failed producers and failed judges. */
export async function collectEvalSpend(
  context: EvalSpendContext,
  tasks: readonly EvalSpendTask[],
  readAttempts: (taskId: string) => Promise<readonly SpendAttempt[]>,
): Promise<EvalSpendReport> {
  // Re-registering a task updates its descriptor without charging it twice.
  const unique = new Map(tasks.map((task) => [task.taskId, task]));
  const records: EvalSpendRecord[] = [];
  for (const task of unique.values()) {
    try {
      const attempts = await readAttempts(task.taskId);
      records.push(
        attempts.length
          ? { ...task, spend: summarizeProducerSpend(attempts) }
          : { ...task, error: 'no_attempts' },
      );
    } catch {
      // Error payloads may contain provider/transport details; retain only the
      // telemetry gap, and still report every other task in the run.
      records.push({ ...task, error: 'attempts_unavailable' });
    }
  }
  const groups = new Map<
    string,
    { owner: EvalSpendTask; records: EvalSpendRecord[] }
  >();
  for (const record of records) {
    const owner = unique.get(record.producerTaskId ?? '') ?? record;
    const key = JSON.stringify([owner.provider, owner.model]);
    const group = groups.get(key) ?? { owner, records: [] };
    group.records.push(record);
    groups.set(key, group);
  }
  return {
    schemaVersion: 1,
    context,
    currency: 'USD',
    pricingBasis: 'standard-rate-estimate',
    records,
    totals: totals(records),
    models: [...groups.values()].map(({ owner, records }) => {
      // Quality uses the final sampling run per scenario; spend uses all runs.
      const outcomes = [
        ...new Map(
          records
            .filter((r) => r.role === 'producer')
            .map((r) => [r.scenario, r.evaluation]),
        ).values(),
      ];
      const scores = outcomes.flatMap((r) =>
        r?.judgedScore === undefined ? [] : [r.judgedScore],
      );
      return {
        provider: owner.provider,
        model: owner.model,
        scenarios: outcomes.length,
        gatesPassed: outcomes.filter((r) => r?.gatesPassed).length,
        ...(scores.length
          ? {
              meanJudgedScore:
                scores.reduce((a, b) => a + b, 0) / scores.length,
            }
          : {}),
        ...totals(records),
      };
    }),
  };
}

function cost(total: EvalSpendTotal): string {
  const { estimatedCostUsd, costComplete } = total.usage;
  if (!costComplete && estimatedCostUsd === 0) return 'unknown';
  return `${costComplete ? '' : '≥'}$${estimatedCostUsd.toFixed(4)}`;
}

function escapeCell(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\\|`[\]]/g, '\\$&')
    .replace(/[\r\n]/g, ' ');
}

export function formatEvalSpendReport(report: EvalSpendReport): string {
  const lines = [
    `### Eval spend — ${escapeCell(report.context.suite)}`,
    '',
    'Estimated USD at standard catalog rates, including failed attempts and scenario retries. These estimates are not provider invoices or off-peak charges.',
    '',
    '| Model under evaluation | Gate pass | Mean composite | Producer | Judge overhead | Total | Attempts | Fully priced tasks |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const row of report.models) {
    lines.push(
      `| ${escapeCell(`${row.provider}/${row.model}`)} | ${row.gatesPassed}/${row.scenarios} | ${row.meanJudgedScore?.toFixed(3) ?? '—'} | ${cost(row.producer)} | ${cost(row.judge)} | ${cost(row.combined)} | ${row.combined.usage.attempts} | ${row.combined.fullyPricedTasks}/${row.combined.tasks} |`,
    );
  }
  const all = report.totals;
  lines.push(
    `| **All models** | — | — | ${cost(all.producer)} | ${cost(all.judge)} | ${cost(all.combined)} | ${all.combined.usage.attempts} | ${all.combined.fullyPricedTasks}/${all.combined.tasks} |`,
    '',
    `Pricing coverage: ${all.combined.fullyPricedTasks} fully priced, ${all.combined.partiallyPricedTasks} partially priced, ${all.combined.unpricedTasks} unpriced, ${all.combined.missingTasks} missing telemetry. “≥” marks a known lower bound.`,
    '',
  );
  return lines.join('\n');
}
