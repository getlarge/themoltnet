import type { UsageState } from '@earendil-works/pi-durable';
import type {
  TaskModelUsage,
  TaskToolUsage,
  TaskUsage,
  TaskUsageCost,
} from '@moltnet/tasks';

type Bucket = UsageState['models'][string];
type Counters = Omit<TaskModelUsage, 'provider' | 'model'>;

const EMPTY_STATE: UsageState = { models: {}, tools: {} };

/**
 * Usage added since `baseline`, bucket by bucket. The harness keeps one
 * session-wide `pi.usage` per conversation, so an attempt that continues an
 * earlier conversation must subtract what was already there.
 */
export function usageSince(
  current: UsageState,
  baseline: UsageState | undefined,
): UsageState {
  const base = baseline ?? EMPTY_STATE;
  return {
    models: subtractBuckets(current.models, base.models),
    tools: subtractBuckets(current.tools, base.tools),
  };
}

/**
 * The attempt's `TaskUsage` from a usage delta. Keeps the harness's per-model
 * and per-tool split and its cost estimate. A bucket with tokens but a zero
 * cost has no price in the harness catalog: it gets no `cost`, and the
 * attempt total is marked incomplete rather than reporting a fabricated zero.
 */
export function taskUsageFromState(
  state: UsageState,
  primary: { provider: string; model: string },
): TaskUsage {
  const models: TaskModelUsage[] = Object.entries(state.models)
    .map(([key, bucket]) => ({ ...splitModelKey(key), ...counters(bucket) }))
    .filter(hasTokens);
  const tools: TaskToolUsage[] = Object.entries(state.tools)
    .map(([tool, bucket]) => ({ tool, ...counters(bucket, false) }))
    .filter(hasTokens);
  const all: Counters[] = [...models, ...tools];
  const reasoning = all.filter((b) => b.reasoningTokens !== undefined);
  const cost = sumCost(all);
  return {
    inputTokens: sum(all, (b) => b.inputTokens),
    outputTokens: sum(all, (b) => b.outputTokens),
    cacheReadTokens: sum(all, (b) => b.cacheReadTokens),
    cacheWriteTokens: sum(all, (b) => b.cacheWriteTokens),
    ...(reasoning.length
      ? { reasoningTokens: sum(reasoning, (b) => b.reasoningTokens ?? 0) }
      : {}),
    provider: primary.provider,
    model: primary.model,
    ...(cost ? { cost } : {}),
    ...(models.length ? { models } : {}),
    ...(tools.length ? { tools } : {}),
  };
}

function subtractBuckets(
  current: Record<string, Bucket>,
  baseline: Record<string, Bucket>,
): Record<string, Bucket> {
  const out: Record<string, Bucket> = {};
  for (const [key, bucket] of Object.entries(current)) {
    const before = Object.hasOwn(baseline, key) ? baseline[key] : undefined;
    // Define rather than assign: a tool may be called `__proto__`.
    Object.defineProperty(out, key, {
      value: before ? subtract(bucket, before) : bucket,
      enumerable: true,
    });
  }
  return out;
}

function subtract(after: Bucket, before: Bucket): Bucket {
  const diff = (a: number | undefined, b: number | undefined) =>
    Math.max(0, (a ?? 0) - (b ?? 0));
  return {
    input: diff(after.input, before.input),
    output: diff(after.output, before.output),
    cacheRead: diff(after.cacheRead, before.cacheRead),
    cacheWrite: diff(after.cacheWrite, before.cacheWrite),
    totalTokens: diff(after.totalTokens, before.totalTokens),
    ...(after.cacheWrite1h !== undefined
      ? { cacheWrite1h: diff(after.cacheWrite1h, before.cacheWrite1h) }
      : {}),
    ...(after.reasoning !== undefined
      ? { reasoning: diff(after.reasoning, before.reasoning) }
      : {}),
    cost: {
      input: diff(after.cost.input, before.cost.input),
      output: diff(after.cost.output, before.cost.output),
      cacheRead: diff(after.cost.cacheRead, before.cost.cacheRead),
      cacheWrite: diff(after.cost.cacheWrite, before.cost.cacheWrite),
      total: diff(after.cost.total, before.cost.total),
    },
  };
}

/** `provider/modelId`; model ids may contain `/` themselves (OpenRouter). */
function splitModelKey(key: string): { provider: string; model: string } {
  const slash = key.indexOf('/');
  return slash < 0
    ? { provider: 'unknown', model: key }
    : { provider: key.slice(0, slash), model: key.slice(slash + 1) };
}

function counters(bucket: Bucket, complete = true): Counters {
  const tokens = {
    inputTokens: tokenCount(bucket.input),
    outputTokens: tokenCount(bucket.output),
    cacheReadTokens: tokenCount(bucket.cacheRead),
    cacheWriteTokens: tokenCount(bucket.cacheWrite),
    ...(bucket.reasoning !== undefined
      ? { reasoningTokens: tokenCount(bucket.reasoning) }
      : {}),
  };
  const total = amount(bucket.cost.total);
  return total > 0
    ? {
        ...tokens,
        cost: {
          currency: 'USD',
          total,
          input: amount(bucket.cost.input),
          output: amount(bucket.cost.output),
          cacheRead: amount(bucket.cost.cacheRead),
          cacheWrite: amount(bucket.cost.cacheWrite),
          // Tool buckets merge calls to different models without price coverage.
          complete,
        },
      }
    : tokens;
}

function sumCost(buckets: Counters[]): TaskUsageCost | undefined {
  const costs = buckets.flatMap((b) => (b.cost ? [b.cost] : []));
  if (!costs.length) return undefined;
  return {
    currency: 'USD',
    total: sum(costs, (c) => c.total),
    input: sum(costs, (c) => c.input),
    output: sum(costs, (c) => c.output),
    cacheRead: sum(costs, (c) => c.cacheRead),
    cacheWrite: sum(costs, (c) => c.cacheWrite),
    complete: costs.length === buckets.length && costs.every((c) => c.complete),
  };
}

function hasTokens(bucket: Counters): boolean {
  return (
    bucket.inputTokens +
      bucket.outputTokens +
      bucket.cacheReadTokens +
      bucket.cacheWriteTokens >
    0
  );
}

function sum<T>(items: T[], pick: (item: T) => number): number {
  return items.reduce((total, item) => total + pick(item), 0);
}

function tokenCount(value: number | undefined): number {
  return Math.round(amount(value));
}

function amount(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : 0;
}
