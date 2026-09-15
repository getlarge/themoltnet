// No default for agent — it is operator-specific and silently
// misconfigures on any other machine. Required, not optional.
import { MAX_RUNTIME_WARM_RETENTION_SEC } from '@moltnet/runtime-profiles';
import { BUILT_IN_TASK_TYPES } from '@moltnet/tasks';

import { knownTaskTypesList } from './help.js';

export interface IdentityProcessOptions {
  agent: string;
  debug: boolean;
}

export interface LocalOperationalSettings {
  heartbeatIntervalMs: number;
  /** Retention for both reusable sessions and reusable workspaces. */
  warmRetentionSec: number;
}

export interface RuntimeCommandOptions {
  identity: IdentityProcessOptions;
  operations: LocalOperationalSettings;
}

export interface IdentityRawArgs {
  agent?: string;
  'agent-root'?: string;
  'git-author'?: string;
  debug?: boolean;
}

export interface RuntimeRawArgs extends IdentityRawArgs {
  'heartbeat-interval-ms'?: string;
  'warm-retention-sec'?: string;
}

export const DEFAULT_LOCAL_OPERATIONAL_SETTINGS: LocalOperationalSettings = {
  heartbeatIntervalMs: 60_000,
  warmRetentionSec: 1800,
};

export class MissingRequiredOptionError extends Error {
  constructor(public readonly flag: string) {
    super(`Missing required flag: --${flag}`);
    this.name = 'MissingRequiredOptionError';
  }
}

export function parseIdentityProcessOptions(
  args: IdentityRawArgs,
): IdentityProcessOptions {
  if (!args.agent) throw new MissingRequiredOptionError('agent');
  if (!/^[a-zA-Z0-9_-]+$/.test(args.agent)) {
    throw new Error(
      `Invalid --agent "${args.agent}": must match /^[a-zA-Z0-9_-]+$/`,
    );
  }
  return { agent: args.agent, debug: args.debug === true };
}

export function parseLocalOperationalSettings(
  args: RuntimeRawArgs,
): LocalOperationalSettings {
  return {
    heartbeatIntervalMs: parseNonNegativeInt(
      args['heartbeat-interval-ms'],
      'heartbeat-interval-ms',
      DEFAULT_LOCAL_OPERATIONAL_SETTINGS.heartbeatIntervalMs,
    ),
    warmRetentionSec: parseNonNegativeInt(
      args['warm-retention-sec'],
      'warm-retention-sec',
      DEFAULT_LOCAL_OPERATIONAL_SETTINGS.warmRetentionSec,
      MAX_RUNTIME_WARM_RETENTION_SEC,
    ),
  };
}

export function parseRuntimeCommandOptions(
  args: RuntimeRawArgs,
): RuntimeCommandOptions {
  return {
    identity: parseIdentityProcessOptions(args),
    operations: parseLocalOperationalSettings(args),
  };
}

function parseNonNegativeInt(
  raw: string | undefined,
  name: string,
  defaultValue: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (raw === undefined) return defaultValue;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new Error(
      `Invalid --${name} "${raw}": must be a non-negative integer no greater than ${maximum}`,
    );
  }
  return value;
}

export function identityOptionDefs() {
  return {
    agent: { type: 'string', short: 'a' },
    'agent-root': { type: 'string' },
    'git-author': { type: 'string' },
    debug: { type: 'boolean' },
  } as const;
}

export function runtimeCommandOptionDefs() {
  return {
    ...identityOptionDefs(),
    'heartbeat-interval-ms': { type: 'string' },
    'warm-retention-sec': { type: 'string' },
  } as const;
}

// `hasOwnProperty.call` rather than `in` — the `in` operator matches keys on
// Object.prototype (toString, hasOwnProperty, …) which would let those slip
// through as "valid" task types.
export function validateTaskTypes(types: readonly string[]): string[] {
  const unknown = types.filter(
    (taskType) =>
      !Object.prototype.hasOwnProperty.call(BUILT_IN_TASK_TYPES, taskType),
  );
  if (unknown.length > 0) {
    throw new Error(
      `Unknown task type(s): ${unknown.join(', ')}. ` +
        `Known types: ${knownTaskTypesList()}.`,
    );
  }
  return [...types];
}
