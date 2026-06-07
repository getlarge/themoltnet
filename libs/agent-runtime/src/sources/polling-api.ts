import { existsSync } from 'node:fs';

import type { Task, TaskStatus } from '@moltnet/tasks';
import type { Agent } from '@themoltnet/sdk';
import { MoltNetError } from '@themoltnet/sdk';
import { pino } from 'pino';

import type { AgentRuntimeLogger } from '../runtime.js';
import type { ClaimedTask, TaskSource } from './types.js';

/**
 * Structural shape of the slot registry needed by the affinity filter.
 * Declared here so `libs/agent-runtime` does not depend on
 * `apps/agent-daemon`. The daemon's concrete `DaemonSlotRegistry`
 * satisfies this by duck typing.
 */
export interface ContinuationSlotRegistry {
  findLatestProducerSlotByTaskAttempt(
    taskId: string,
    attemptN: number,
  ):
    | Promise<{ session?: { sessionDir?: string | null } | null } | null>
    | { session?: { sessionDir?: string | null } | null }
    | null;
}

/**
 * Claim-time affinity filter for warm-resume continuations.
 *
 * - No `continueFrom` → claimable (true).
 * - `continueFrom` set + no slot in registry → not claimable (some other
 *   daemon owns the warm slot, or it's been reaped).
 * - `continueFrom` set + slot exists but its `sessionDir` is missing on
 *   disk → not claimable (stale registry row, slot directory was wiped).
 * - `continueFrom` set + slot exists + `sessionDir` present on disk →
 *   claimable.
 *
 * Pure predicate over `(task, slotRegistry)` — no side effects.
 */
export async function isContinuationClaimableByThisDaemon(
  task: { input?: { continueFrom?: { taskId: string; attemptN: number } } },
  slotRegistry: ContinuationSlotRegistry,
): Promise<boolean> {
  const cf = task.input?.continueFrom;
  if (!cf) return true;
  const slot = await slotRegistry.findLatestProducerSlotByTaskAttempt(
    cf.taskId,
    cf.attemptN,
  );
  if (!slot) return false;
  const sessionDir = slot.session?.sessionDir;
  if (!sessionDir || !existsSync(sessionDir)) return false;
  return true;
}

export interface PollingApiTaskSourceOptions {
  agent: Agent;
  /** Required by the list endpoint — daemon scopes itself to one team. */
  teamId: string;
  /**
   * Whitelist of task types this daemon will execute. The list endpoint
   * accepts repeated `taskTypes` query params, so a configured whitelist is
   * sent in one list request per tick. An empty/undefined list means "any
   * type" (one untyped list call per tick) — only safe when the agent really
   * can execute every registered task type.
   */
  taskTypes?: string[];
  /**
   * Daemon's `(provider, model)` pair. When set, forwarded to the list
   * endpoint so the server returns only tasks whose `allowedExecutors`
   * is empty or includes this exact pair. Both must be set together;
   * otherwise no executor filtering is applied. Mirrors the advisory
   * routing of `taskTypes`.
   */
  provider?: string;
  model?: string;
  /**
   * Optional further filter applied client-side after listing. Useful when
   * an agent should only act on tasks tied to specific diaries. Server has
   * no diary filter on `GET /tasks`, so this is post-filtered.
   */
  diaryIds?: string[];
  /** Lease TTL passed to `claim` so the proposer/runtime contract holds. */
  leaseTtlSec: number;
  /** Page size per list call. Defaults to 10 — we only need one claimable. */
  listLimit?: number;
  /** Idle backoff floor (ms). */
  pollIntervalMs?: number;
  /** Idle backoff ceiling (ms). */
  maxPollIntervalMs?: number;
  /**
   * AbortSignal that resolves `claim()` to `null` promptly when the daemon
   * is asked to shut down. Without this, a long sleep delays drain.
   */
  signal?: AbortSignal;
  /**
   * When true, return `null` (drain the runtime) the first time the queue
   * has no claimable tasks, instead of sleeping and retrying. Used by the
   * `drain` daemon mode for batch eval runs.
   */
  stopWhenEmpty?: boolean;
  /**
   * Slot registry used for the claim-time affinity filter on
   * `freeform.continueFrom` tasks. When omitted, the affinity filter is a
   * no-op (continuations are always claimable) — appropriate for
   * non-pi daemon entry points (e.g. drain/e2e harnesses) that don't
   * manage warm slots.
   */
  slotRegistry?: ContinuationSlotRegistry;
  /** Logger; defaults to a self-named pino instance. */
  logger?: AgentRuntimeLogger;
  /**
   * When true, also log successful list/claim outcomes (candidate
   * counts, claim success). Useful for debugging why a daemon appears
   * idle when tasks exist on the server. 4xx claim skips are logged
   * unconditionally regardless of this flag.
   */
  debug?: boolean;
}

const DEFAULT_LIST_LIMIT = 10;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_MAX_POLL_INTERVAL_MS = 30_000;

/**
 * Long-running pull-based source for the daemon mode.
 *
 * Each `claim()` call:
 *   1. Lists queued tasks for the configured team/type filter.
 *   2. Walks the candidates in `created_at` order, attempting to `claim` each.
 *      A 409 is the expected race outcome (another claimer beat us); skip and
 *      try the next candidate. A 403/404 means the task is no longer ours to
 *      take (cancelled, gone) — skip. Other errors propagate.
 *   3. On the first successful claim, returns the `ClaimedTask`.
 *   4. If no candidate yields a claim, sleeps with exponential backoff +
 *      jitter, then retries. Backoff resets on every successful claim.
 *
 * Returns `null` only when the abort signal fires — i.e. graceful shutdown.
 * Otherwise loops forever.
 */
export class PollingApiTaskSource implements TaskSource {
  private currentBackoffMs: number;
  private readonly minBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly listLimit: number;
  private readonly logger: AgentRuntimeLogger;

  constructor(private readonly opts: PollingApiTaskSourceOptions) {
    this.minBackoffMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.maxBackoffMs = opts.maxPollIntervalMs ?? DEFAULT_MAX_POLL_INTERVAL_MS;
    if (this.maxBackoffMs < this.minBackoffMs) {
      throw new Error(
        `PollingApiTaskSource: maxPollIntervalMs (${this.maxBackoffMs}) ` +
          `must be >= pollIntervalMs (${this.minBackoffMs})`,
      );
    }
    if (Boolean(opts.provider) !== Boolean(opts.model)) {
      throw new Error(
        'PollingApiTaskSource: provider and model must be set together',
      );
    }
    this.listLimit = opts.listLimit ?? DEFAULT_LIST_LIMIT;
    this.currentBackoffMs = this.minBackoffMs;
    // Bind teamId once so every log line from this source carries it.
    const base = opts.logger ?? pino({ name: 'polling-api-source' });
    this.logger = base.child({ teamId: opts.teamId });
  }

  async claim(): Promise<ClaimedTask | null> {
    while (!this.aborted()) {
      let cursor: string | undefined;
      let hadListError = false;
      do {
        const page = await this.listCandidates(cursor);
        hadListError = hadListError || page.hadListError;
        const claimed = await this.tryClaimOne(page.candidates);
        if (claimed) {
          this.currentBackoffMs = this.minBackoffMs;
          return claimed;
        }
        cursor = page.nextCursor;
      } while (cursor && !this.aborted());
      // Drain mode bails out only when the queue is *known* empty —
      // i.e. every list call this round succeeded and returned no
      // claimable candidates. A transient list failure is indeterminate;
      // keep polling so a 5xx on the API doesn't masquerade as a drained
      // queue and exit the daemon early.
      if (this.opts.stopWhenEmpty && !hadListError) return null;
      await this.sleepWithBackoff();
    }
    return null;
  }

  async close(): Promise<void> {
    // Stateless; nothing to release. The HTTP client is owned by `agent`.
  }

  private aborted(): boolean {
    return this.opts.signal?.aborted === true;
  }

  private async listCandidates(cursor?: string): Promise<{
    candidates: Task[];
    hadListError: boolean;
    nextCursor?: string;
  }> {
    const seen = new Set<string>();
    const out: Task[] = [];
    let hadListError = false;
    let nextCursor: string | undefined;
    if (this.aborted()) return { candidates: out, hadListError };
    try {
      const taskTypes =
        this.opts.taskTypes && this.opts.taskTypes.length > 0
          ? this.opts.taskTypes
          : undefined;
      const result = await this.opts.agent.tasks.list({
        teamId: this.opts.teamId,
        status: 'queued' satisfies TaskStatus,
        ...(taskTypes ? { taskTypes } : {}),
        ...(this.opts.provider && this.opts.model
          ? { provider: this.opts.provider, model: this.opts.model }
          : {}),
        ...(cursor ? { cursor } : {}),
        limit: this.listLimit,
      });
      nextCursor = result.nextCursor;
      if (this.opts.debug) {
        this.logger.debug(
          { taskTypes, total: result.total, returned: result.items.length },
          'polling-api.list_ok',
        );
      }
      for (const item of result.items) {
        if (seen.has(item.id)) continue;
        if (
          this.opts.taskTypes &&
          this.opts.taskTypes.length > 0 &&
          !this.opts.taskTypes.includes(item.taskType)
        ) {
          continue;
        }
        if (
          this.opts.diaryIds &&
          this.opts.diaryIds.length > 0 &&
          (item.diaryId === null || !this.opts.diaryIds.includes(item.diaryId))
        ) {
          continue;
        }
        // Warm-resume affinity filter — skip continuations targeting a
        // warm slot this daemon doesn't own (or whose sessionDir is
        // gone). Other daemons skip too if they also don't own it; the
        // task lingers queued until the original daemon polls or the
        // server's dispatch_timeout_sec fires. See #1287, #1299.
        if (
          this.opts.slotRegistry &&
          !(await isContinuationClaimableByThisDaemon(
            item,
            this.opts.slotRegistry,
          ))
        ) {
          continue;
        }
        // Belt-and-braces executor filter — silently skip pinned tasks
        // whose `allowedExecutors` doesn't include this daemon's pair
        // (e.g. server filter race, daemon connecting to an old server,
        // or a buggy server that ignored the filter). Empty array =
        // no restriction. Skipping at this layer means we NEVER claim
        // such a task, so no attempt is recorded against it.
        if (this.opts.provider && this.opts.model) {
          const allowed = item.allowedExecutors ?? [];
          if (
            allowed.length > 0 &&
            !allowed.some(
              (e) =>
                e.provider === this.opts.provider &&
                e.model === this.opts.model,
            )
          ) {
            continue;
          }
        }
        // Defensive: re-check status in case the server didn't honour the
        // filter, or the task moved between list and read.
        if (item.status !== 'queued') continue;
        seen.add(item.id);
        out.push(item);
      }
    } catch (err) {
      // List failures (e.g. 5xx) are transient. Log + signal the caller
      // so drain-mode doesn't misread an empty result as a drained
      // queue. The poll loop backs off and retries; a real exit only
      // happens when the list call succeeded and returned nothing.
      hadListError = true;
      this.logger.warn(
        {
          err,
          taskTypes: this.opts.taskTypes,
        },
        'polling-api.list_failed',
      );
    }
    return { candidates: out, hadListError, nextCursor };
  }

  private async tryClaimOne(
    candidates: readonly Task[],
  ): Promise<ClaimedTask | null> {
    for (const task of candidates) {
      if (this.aborted()) return null;
      try {
        const result = await this.opts.agent.tasks.claim(task.id, {
          leaseTtlSec: this.opts.leaseTtlSec,
        });
        if (this.opts.debug) {
          this.logger.debug(
            {
              taskId: result.task.id,
              taskType: result.task.taskType,
              attemptN: result.attempt.attemptN,
            },
            'polling-api.claim_ok',
          );
        }
        return {
          task: result.task,
          attemptN: result.attempt.attemptN,
          traceHeaders: result.traceHeaders,
        };
      } catch (err) {
        const status = statusOf(err);
        // 409: another claimer won the race. Expected under load.
        // 403: lost permission (rare — diary grants changed mid-list).
        // 404: task vanished (cancelled). Move on.
        if (status === 409 || status === 403 || status === 404) {
          this.logger.debug(
            { taskId: task.id, status },
            'polling-api.claim_skipped',
          );
          continue;
        }
        // Anything else is unexpected — propagate so the runtime can decide.
        throw err;
      }
    }
    return null;
  }

  private async sleepWithBackoff(): Promise<void> {
    const base = this.currentBackoffMs;
    // Full jitter: random in [base/2, base * 1.5). Avoids thundering-herd
    // when multiple daemons (eventually) share a queue.
    const jittered = Math.floor(base * 0.5 + Math.random() * base);
    await abortableSleep(jittered, this.opts.signal);
    // Double for next idle tick, capped.
    this.currentBackoffMs = Math.min(
      this.maxBackoffMs,
      this.currentBackoffMs * 2,
    );
  }
}

function statusOf(err: unknown): number | undefined {
  if (err instanceof MoltNetError) return err.statusCode;
  if (err && typeof err === 'object' && 'statusCode' in err) {
    const v = (err as { statusCode?: unknown }).statusCode;
    if (typeof v === 'number') return v;
  }
  return undefined;
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
