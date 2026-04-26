// No defaults for agent/provider/model — those values are operator-specific
// and silently misconfigure on any other machine. Required, not optional.
import { BUILT_IN_TASK_TYPES } from '@moltnet/tasks';

import { knownTaskTypesList } from './help.js';

export interface CommonOptions {
  agent: string;
  provider: string;
  model: string;
  leaseTtlSec: number;
  heartbeatIntervalMs: number;
  maxBatchSize: number;
  flushIntervalMs: number;
}

export interface CommonRawArgs {
  agent?: string;
  provider?: string;
  model?: string;
  'lease-ttl-sec'?: string;
  'heartbeat-interval-ms'?: string;
  'max-batch-size'?: string;
  'flush-interval-ms'?: string;
}

const DEFAULTS = {
  leaseTtlSec: 300,
  heartbeatIntervalMs: 60_000,
  maxBatchSize: 50,
  flushIntervalMs: 200,
} as const;

export class MissingRequiredOptionError extends Error {
  constructor(public readonly flag: string) {
    super(`Missing required flag: --${flag}`);
    this.name = 'MissingRequiredOptionError';
  }
}

export function parseCommonOptions(args: CommonRawArgs): CommonOptions {
  if (!args.agent) throw new MissingRequiredOptionError('agent');
  if (!args.provider) throw new MissingRequiredOptionError('provider');
  if (!args.model) throw new MissingRequiredOptionError('model');

  if (!/^[a-zA-Z0-9_-]+$/.test(args.agent)) {
    throw new Error(
      `Invalid --agent "${args.agent}": must match /^[a-zA-Z0-9_-]+$/`,
    );
  }
  const opts: CommonOptions = {
    agent: args.agent,
    provider: args.provider,
    model: args.model,
    leaseTtlSec: parsePositiveInt(
      args['lease-ttl-sec'],
      'lease-ttl-sec',
      DEFAULTS.leaseTtlSec,
    ),
    heartbeatIntervalMs: parseNonNegativeInt(
      args['heartbeat-interval-ms'],
      'heartbeat-interval-ms',
      DEFAULTS.heartbeatIntervalMs,
    ),
    maxBatchSize: parsePositiveInt(
      args['max-batch-size'],
      'max-batch-size',
      DEFAULTS.maxBatchSize,
    ),
    flushIntervalMs: parseNonNegativeInt(
      args['flush-interval-ms'],
      'flush-interval-ms',
      DEFAULTS.flushIntervalMs,
    ),
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
    model: { type: 'string', short: 'm' },
    provider: { type: 'string', short: 'p' },
    'lease-ttl-sec': { type: 'string' },
    'heartbeat-interval-ms': { type: 'string' },
    'max-batch-size': { type: 'string' },
    'flush-interval-ms': { type: 'string' },
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
