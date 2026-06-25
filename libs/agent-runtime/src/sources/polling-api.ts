import { existsSync } from 'node:fs';

import type { Task, TaskStatus } from '@moltnet/tasks';
import type { Agent } from '@themoltnet/sdk';
import { MoltNetError } from '@themoltnet/sdk';
import { pino } from 'pino';

import type { AgentRuntimeLogger } from '../runtime.js';
import type { ClaimedTask, TaskSource } from './types.js';

/**
 * Structural shape of the runtime slot store needed by the affinity filter.
 * Declared here so `libs/agent-runtime` does not depend on
 * `apps/agent-daemon`. The daemon's concrete remote slot store
 * satisfies this by duck typing.
 */
export interface ContinuationSlotRegistry {
  findLatestSlotByTaskAttempt(
    teamId: string,
    taskId: string,
    attemptN: number,
  ):
    | Promise<{ session?: { sessionDir?: string | null } | null } | null>
    | { session?: { sessionDir?: string | null } | null }
    | null;
}

export interface ContinuationSessionRegistry {
  findRuntimeSessionByTaskAttempt(
    teamId: string,
    taskId: string,
    attemptN: number,
  ): Promise<unknown> | unknown;
}

/**
 * Claim-time affinity filter for warm-resume continuations.
 *
 * - No `continueFrom` → claimable (true).
 * - `continueFrom` set + remote session exists → claimable (true).
 * - `continueFrom` set + no slot in the store → not claimable (the producer
 *   context is unavailable to this daemon).
 * - `continueFrom` set + slot exists but its `sessionDir` is missing on
 *   disk → not claimable (stale slot row, slot directory was wiped).
 * - `continueFrom` set + slot exists + `sessionDir` present on disk →
 *   claimable.
 *
 * Pure predicate over `(task, slotRegistry)` — no side effects.
 */
export async function isContinuationClaimableByThisDaemon(
  task: {
    teamId: string;
    input?: { continueFrom?: { taskId: string; attemptN: number } };
  },
  slotRegistry: ContinuationSlotRegistry,
  sessionRegistry?: ContinuationSessionRegistry,
): Promise<
  | { claimable: true }
  | {
      claimable: false;
      reason: 'missing_producer_slot' | 'missing_session_dir';
      continueFrom: { taskId: string; attemptN: number };
      sessionDir?: string | null;
    }
> {
  const cf = task.input?.continueFrom;
  if (!cf) return { claimable: true };
  const remoteSession = await sessionRegistry?.findRuntimeSessionByTaskAttempt(
    task.teamId,
    cf.taskId,
    cf.attemptN,
  );
  if (remoteSession) return { claimable: true };

  const slot = await slotRegistry.findLatestSlotByTaskAttempt(
    task.teamId,
    cf.taskId,
    cf.attemptN,
  );
  if (!slot) {
    return {
      claimable: false,
      reason: 'missing_producer_slot',
      continueFrom: cf,
    };
  }
  const sessionDir = slot.session?.sessionDir;
  if (!sessionDir || !existsSync(sessionDir)) {
    return {
      claimable: false,
      reason: 'missing_session_dir',
      continueFrom: cf,
      sessionDir,
    };
  }
  return { claimable: true };
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
   * Selected runtime profile id. When set, forwarded to the list endpoint
   * so the server returns unrestricted tasks plus tasks allowing this
   * profile.
   */
  profileId?: string;
  /**
   * Ordered runtime profiles this source can claim with. The first profile
   * that sees a task wins, so unrestricted tasks use the first profile and
   * profile-pinned tasks use the first configured allowed profile.
   */
  profiles?: { profileId: string; leaseTtlSec?: number }[];
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
   * Runtime slot store used for the claim-time affinity filter on
   * `freeform.continueFrom` tasks. When omitted, the affinity filter is a
   * no-op (continuations are always claimable) — appropriate for
   * non-pi daemon entry points (e.g. drain/e2e harnesses) that don't
   * manage runtime slots.
   */
  slotRegistry?: ContinuationSlotRegistry;
  /**
   * Durable runtime session store used for remote continuation hydration. When
   * available, it supersedes local slot affinity for claim filtering.
   */
  sessionRegistry?: ContinuationSessionRegistry;
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
    this.listLimit = opts.listLimit ?? DEFAULT_LIST_LIMIT;
    this.currentBackoffMs = this.minBackoffMs;
    // Bind teamId once so every log line from this source carries it.
    const base = opts.logger ?? pino({ name: 'polling-api-source' });
    this.logger = base.child({ teamId: opts.teamId });
  }

  async claim(): Promise<ClaimedTask | null> {
    while (!this.aborted()) {
      const profiles = this.profileCandidates();
      const cursors = new Map<string, string | undefined>();
      const exhausted = new Set<string>();
      let hadListError = false;
      do {
        const page = await this.listCandidates(profiles, cursors, exhausted);
        hadListError = hadListError || page.hadListError;
        const claimed = await this.tryClaimOne(page.candidates);
        if (claimed) {
          this.currentBackoffMs = this.minBackoffMs;
          return claimed;
        }
      } while (exhausted.size < profiles.length && !this.aborted());
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

  private async listCandidates(
    profiles: readonly CandidateProfile[],
    cursors: Map<string, string | undefined>,
    exhausted: Set<string>,
  ): Promise<{
    candidates: CandidateTask[];
    hadListError: boolean;
  }> {
    const seen = new Set<string>();
    const out: CandidateTask[] = [];
    let hadListError = false;
    if (this.aborted()) return { candidates: out, hadListError };
    for (let i = 0; i < profiles.length; i += 1) {
      const profile = profiles[i];
      const key = profileKey(profile, i);
      if (exhausted.has(key)) continue;
      if (this.aborted()) break;
      try {
        const taskTypes =
          this.opts.taskTypes && this.opts.taskTypes.length > 0
            ? this.opts.taskTypes
            : undefined;
        const result = await this.opts.agent.tasks.list(
          {
            status: 'queued' satisfies TaskStatus,
            ...(taskTypes ? { taskTypes } : {}),
            ...(profile.profileId ? { profileId: profile.profileId } : {}),
            ...(cursors.get(key) ? { cursor: cursors.get(key) } : {}),
            limit: this.listLimit,
          },
          { teamId: this.opts.teamId },
        );
        if (result.nextCursor) {
          cursors.set(key, result.nextCursor);
        } else {
          exhausted.add(key);
        }
        if (this.opts.debug) {
          this.logger.debug(
            {
              taskTypes,
              profileId: profile.profileId,
              total: result.total,
              returned: result.items.length,
            },
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
            (item.diaryId === null ||
              !this.opts.diaryIds.includes(item.diaryId))
          ) {
            continue;
          }
          // Warm-resume affinity filter — skip continuations whose producer
          // slot cannot be resolved to a local sessionDir on this daemon. The
          // task lingers queued until a daemon with that context polls or the
          // server's dispatch_timeout_sec fires. See #1287, #1299.
          if (this.opts.slotRegistry) {
            const affinity = await isContinuationClaimableByThisDaemon(
              item,
              this.opts.slotRegistry,
              this.opts.sessionRegistry,
            );
            if (!affinity.claimable) {
              this.logger.debug(
                {
                  taskId: item.id,
                  taskType: item.taskType,
                  reason: affinity.reason,
                  continueFrom: affinity.continueFrom,
                  sessionDir: affinity.sessionDir,
                },
                'polling-api.continuation_skipped',
              );
              continue;
            }
          }
          // Belt-and-braces profile filter — silently skip profile-pinned
          // tasks whose allowedProfiles does not include this daemon's
          // selected profile. Empty array = no restriction.
          if (profile.profileId) {
            const allowed = item.allowedProfiles ?? [];
            if (
              allowed.length > 0 &&
              !allowed.some((p) => p.profileId === profile.profileId)
            ) {
              continue;
            }
          }
          // Defensive: re-check status in case the server didn't honour the
          // filter, or the task moved between list and read.
          if (item.status !== 'queued') continue;
          seen.add(item.id);
          out.push({ task: item, profile });
        }
      } catch (err) {
        // List failures (e.g. 5xx) are transient. Log + signal the caller
        // so drain-mode doesn't misread an empty result as a drained
        // queue. The poll loop backs off and retries; a real exit only
        // happens when the list call succeeded and returned nothing.
        hadListError = true;
        exhausted.add(key);
        this.logger.warn(
          {
            err,
            taskTypes: this.opts.taskTypes,
            profileId: profile.profileId,
          },
          'polling-api.list_failed',
        );
      }
    }
    return { candidates: out, hadListError };
  }

  private async tryClaimOne(
    candidates: readonly CandidateTask[],
  ): Promise<ClaimedTask | null> {
    for (const candidate of candidates) {
      if (this.aborted()) return null;
      const { task, profile } = candidate;
      try {
        const result = await this.opts.agent.tasks.claim(task.id, {
          leaseTtlSec: profile.leaseTtlSec ?? this.opts.leaseTtlSec,
          ...(profile.profileId ? { profileId: profile.profileId } : {}),
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
          ...(profile.profileId ? { profileId: profile.profileId } : {}),
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

  private profileCandidates(): CandidateProfile[] {
    if (this.opts.profiles && this.opts.profiles.length > 0) {
      return this.opts.profiles;
    }
    return [
      {
        ...(this.opts.profileId ? { profileId: this.opts.profileId } : {}),
        leaseTtlSec: this.opts.leaseTtlSec,
      },
    ];
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

interface CandidateProfile {
  profileId?: string;
  leaseTtlSec?: number;
}

interface CandidateTask {
  task: Task;
  profile: CandidateProfile;
}

function profileKey(profile: CandidateProfile, index: number): string {
  return profile.profileId ?? `legacy:${index}`;
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
