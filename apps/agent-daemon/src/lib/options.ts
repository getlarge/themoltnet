/**
 * Shared option parsing for daemon subcommands.
 *
 * Every subcommand accepts the same agent/provider/model + reporter knobs,
 * so we factor the validation out to keep the entry points thin.
 */
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
  agent: 'legreffier',
  provider: 'openai-codex',
  model: 'gpt-5.3-codex',
  leaseTtlSec: 300,
  heartbeatIntervalMs: 60_000,
  maxBatchSize: 50,
  flushIntervalMs: 200,
} as const;

export function parseCommonOptions(args: CommonRawArgs): CommonOptions {
  const agent = args.agent ?? DEFAULTS.agent;
  if (!/^[a-zA-Z0-9_-]+$/.test(agent)) {
    throw new Error(
      `Invalid --agent "${agent}": must match /^[a-zA-Z0-9_-]+$/`,
    );
  }
  const opts: CommonOptions = {
    agent,
    provider: args.provider ?? DEFAULTS.provider,
    model: args.model ?? DEFAULTS.model,
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
