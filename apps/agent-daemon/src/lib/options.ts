// No default for agent — it is operator-specific and silently
// misconfigures on any other machine. Required, not optional.
import { BUILT_IN_TASK_TYPES } from '@moltnet/tasks';

import { knownTaskTypesList } from './help.js';

export interface CommonOptions {
  agent: string;
  leaseTtlSec: number;
  heartbeatIntervalMs: number;
  maxBatchSize: number;
  flushIntervalMs: number;
  /**
   * Cap on the number of tool-use turns per attempt. `0` disables.
   * Matches the Anthropic Agent SDK `maxTurns` semantics: only counts
   * turns whose stopReason !== 'end_turn'. See issue #1094.
   */
  maxTurns: number;
  /**
   * Cap on the number of `bash` tool timeouts per attempt. `0`
   * disables. Catches the death-spiral pattern from task `a3762f44`.
   * See issue #1094.
   */
  maxBashTimeouts: number;
  /**
   * Local daemon-slot retention TTL, independent of task claim lease.
   * `0` disables resumable slot persistence/reuse entirely.
   */
  warmSessionTtlSec: number;
  debug: boolean;
}

export interface CommonRawArgs {
  agent?: string;
  'lease-ttl-sec'?: string;
  'heartbeat-interval-ms'?: string;
  'max-batch-size'?: string;
  'flush-interval-ms'?: string;
  'max-turns'?: string;
  'max-bash-timeouts'?: string;
  'warm-session-ttl-sec'?: string;
  debug?: boolean;
}

export interface ParseCommonOptionsOptions {
  runtimeDefaults?: Partial<
    Pick<
      CommonOptions,
      | 'leaseTtlSec'
      | 'heartbeatIntervalMs'
      | 'maxBatchSize'
      | 'warmSessionTtlSec'
    >
  >;
}

const DEFAULTS = {
  leaseTtlSec: 300,
  heartbeatIntervalMs: 60_000,
  maxBatchSize: 50,
  flushIntervalMs: 200,
  // 0 = disabled. Operator opts in. Recommended 30 for fulfill_brief
  // per issue #1094 (matches the typical depth of a successful agent run).
  maxTurns: 0,
  // 3 timeouts in one attempt is decisive: at this point the model is
  // either stuck in a loop or running operations the sandbox can't
  // complete within reasonable bounds. Either way, terminating is
  // cheaper than letting the host job timeout fire.
  maxBashTimeouts: 3,
  warmSessionTtlSec: 1800,
} as const;

export class MissingRequiredOptionError extends Error {
  constructor(public readonly flag: string) {
    super(`Missing required flag: --${flag}`);
    this.name = 'MissingRequiredOptionError';
  }
}

export function parseCommonOptions(
  args: CommonRawArgs,
  options: ParseCommonOptionsOptions = {},
): CommonOptions {
  const runtimeDefaults = {
    leaseTtlSec: options.runtimeDefaults?.leaseTtlSec ?? DEFAULTS.leaseTtlSec,
    heartbeatIntervalMs:
      options.runtimeDefaults?.heartbeatIntervalMs ??
      DEFAULTS.heartbeatIntervalMs,
    maxBatchSize:
      options.runtimeDefaults?.maxBatchSize ?? DEFAULTS.maxBatchSize,
    warmSessionTtlSec:
      options.runtimeDefaults?.warmSessionTtlSec ?? DEFAULTS.warmSessionTtlSec,
  };
  if (!args.agent) throw new MissingRequiredOptionError('agent');

  if (!/^[a-zA-Z0-9_-]+$/.test(args.agent)) {
    throw new Error(
      `Invalid --agent "${args.agent}": must match /^[a-zA-Z0-9_-]+$/`,
    );
  }
  const opts: CommonOptions = {
    agent: args.agent,
    leaseTtlSec: parsePositiveInt(
      args['lease-ttl-sec'],
      'lease-ttl-sec',
      runtimeDefaults.leaseTtlSec,
    ),
    heartbeatIntervalMs: parseNonNegativeInt(
      args['heartbeat-interval-ms'],
      'heartbeat-interval-ms',
      runtimeDefaults.heartbeatIntervalMs,
    ),
    maxBatchSize: parsePositiveInt(
      args['max-batch-size'],
      'max-batch-size',
      runtimeDefaults.maxBatchSize,
    ),
    flushIntervalMs: parseNonNegativeInt(
      args['flush-interval-ms'],
      'flush-interval-ms',
      DEFAULTS.flushIntervalMs,
    ),
    maxTurns: parseNonNegativeInt(
      args['max-turns'],
      'max-turns',
      DEFAULTS.maxTurns,
    ),
    maxBashTimeouts: parseNonNegativeInt(
      args['max-bash-timeouts'],
      'max-bash-timeouts',
      DEFAULTS.maxBashTimeouts,
    ),
    warmSessionTtlSec: parseNonNegativeInt(
      args['warm-session-ttl-sec'],
      'warm-session-ttl-sec',
      runtimeDefaults.warmSessionTtlSec,
    ),
    debug: args.debug === true,
  };
  return opts;
}

function parsePositiveInt(
  raw: string | undefined,
  name: string,
  defaultValue: number,
): number {
  if (raw === undefined) return defaultValue;
  const v = Number(raw);
  if (!Number.isInteger(v) || v < 1) {
    throw new Error(`Invalid --${name} "${raw}": must be a positive integer`);
  }
  return v;
}

function parseNonNegativeInt(
  raw: string | undefined,
  name: string,
  defaultValue: number,
): number {
  if (raw === undefined) return defaultValue;
  const v = Number(raw);
  if (!Number.isInteger(v) || v < 0) {
    throw new Error(
      `Invalid --${name} "${raw}": must be a non-negative integer`,
    );
  }
  return v;
}

export function commonOptionDefs() {
  return {
    agent: { type: 'string', short: 'a' },
    'lease-ttl-sec': { type: 'string' },
    'heartbeat-interval-ms': { type: 'string' },
    'max-batch-size': { type: 'string' },
    'flush-interval-ms': { type: 'string' },
    'max-turns': { type: 'string' },
    'max-bash-timeouts': { type: 'string' },
    'warm-session-ttl-sec': { type: 'string' },
    debug: { type: 'boolean' },
  } as const;
}

// `hasOwnProperty.call` rather than `in` — the `in` operator matches keys on
// Object.prototype (toString, hasOwnProperty, …) which would let those slip
// through as "valid" task types.
export function validateTaskTypes(types: readonly string[]): string[] {
  const unknown = types.filter(
    (t) => !Object.prototype.hasOwnProperty.call(BUILT_IN_TASK_TYPES, t),
  );
  if (unknown.length > 0) {
    throw new Error(
      `Unknown task type(s): ${unknown.join(', ')}. ` +
        `Known types: ${knownTaskTypesList()}.`,
    );
  }
  return [...types];
}
