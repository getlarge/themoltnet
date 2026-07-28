import { parseArgs } from 'node:util';

import type { MultiLensReviewInput } from './types.js';

export const HELP = `moltnet-multi-lens-review — fan out N specialist code reviews (security, correctness, performance, test-coverage) in parallel and join them into one server-gated verdict.

Usage:
  MULTI_LENS_REVIEW_DATABASE_URL=<url> moltnet-multi-lens-review --team <uuid> --diary <uuid> \\
    --target "libs/foo — the change in bar.ts" \\
    [--diff "<diff text>" | --diff-file <path>] \\
    [--lens security --lens correctness ...] [--synthesis "how to consolidate"] \\
    [--profile <uuid|name>] [--lens-profile <lens>=<uuid|name> ...] \\
    [--synthesis-profile <uuid|name>] [--correlation-id <uuid>] \\
    [--queue <name>] [--agent-dir <path>] [--poll-interval <sec>] [--concurrency <n>]

Repeat --lens to override the default lenses. --profile pins every task to one
runtime profile; repeated --lens-profile and --synthesis-profile override it for
specific tasks. Pass --correlation-id to resume a run after a crash (rerun with
the SAME id — the Absurd idempotency key is derived from it, so completed steps
replay instead of re-fanning-out). The Postgres URL is read from the
MULTI_LENS_REVIEW_DATABASE_URL environment variable — not argv — so the
credential is not exposed via shell history or process listings.`;

export interface RuntimeProfileRoutingRefs {
  defaultProfile: string;
  lensProfiles?: Record<string, string>;
  synthesisProfile?: string;
}

export interface CliConfig {
  databaseUrl: string;
  queueName?: string;
  agentDir?: string;
  input: MultiLensReviewInput;
  profileRoutingRefs?: RuntimeProfileRoutingRefs;
}

export type CliParseResult =
  | { kind: 'help' }
  | { kind: 'run'; config: CliConfig };

export interface CliParseDeps {
  env: NodeJS.ProcessEnv;
  readFile(path: string): string;
  randomUUID(): string;
}

/** Centralized process-env read for the executable entrypoint. */
export function currentProcessEnv(): NodeJS.ProcessEnv {
  return process.env;
}

function positiveInt(raw: string, flag: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${flag} must be a positive integer (got "${raw}")`);
  }
  return value;
}

function nonEmpty(raw: string, flag: string): string {
  const value = raw.trim();
  if (!value) throw new Error(`${flag} must not be empty`);
  return value;
}

function parseLensProfiles(
  values: string[] | undefined,
): Record<string, string> | undefined {
  if (!values?.length) return undefined;
  const parsed: Record<string, string> = {};
  for (const value of values) {
    const separator = value.indexOf('=');
    if (separator <= 0 || separator === value.length - 1) {
      throw new Error(
        `--lens-profile must use <lens>=<uuid|name> (got "${value}")`,
      );
    }
    const lens = nonEmpty(value.slice(0, separator), '--lens-profile lens');
    if (Object.hasOwn(parsed, lens)) {
      throw new Error(`--lens-profile was repeated for lens "${lens}"`);
    }
    parsed[lens] = nonEmpty(
      value.slice(separator + 1),
      '--lens-profile profile',
    );
  }
  return parsed;
}

export function parseCliConfig(
  argv: string[],
  deps: CliParseDeps,
): CliParseResult {
  const { values } = parseArgs({
    args: argv,
    options: {
      help: { type: 'boolean', short: 'h' },
      team: { type: 'string' },
      diary: { type: 'string' },
      target: { type: 'string' },
      diff: { type: 'string' },
      'diff-file': { type: 'string' },
      lens: { type: 'string', multiple: true },
      synthesis: { type: 'string' },
      profile: { type: 'string' },
      'lens-profile': { type: 'string', multiple: true },
      'synthesis-profile': { type: 'string' },
      'correlation-id': { type: 'string' },
      queue: { type: 'string' },
      'agent-dir': { type: 'string' },
      'poll-interval': { type: 'string' },
      concurrency: { type: 'string' },
    },
    allowPositionals: false,
    strict: true,
  });

  if (values.help) return { kind: 'help' };

  const databaseUrl = deps.env.MULTI_LENS_REVIEW_DATABASE_URL ?? '';
  if (!values.team) throw new Error('--team is required');
  if (!values.diary) throw new Error('--diary is required');
  if (!values.target) throw new Error('--target is required');
  if (values.diff && values['diff-file']) {
    throw new Error('pass at most one of --diff or --diff-file');
  }
  if (!databaseUrl) {
    throw new Error(
      'MULTI_LENS_REVIEW_DATABASE_URL environment variable is required',
    );
  }

  const lensProfiles = parseLensProfiles(values['lens-profile']);
  if (
    !values.profile &&
    (lensProfiles || values['synthesis-profile'] !== undefined)
  ) {
    throw new Error(
      '--profile is required when profile routing overrides are supplied',
    );
  }

  const diff = values['diff-file']
    ? deps.readFile(values['diff-file'])
    : values.diff;
  const profileRoutingRefs = values.profile
    ? {
        defaultProfile: nonEmpty(values.profile, '--profile'),
        ...(lensProfiles ? { lensProfiles } : {}),
        ...(values['synthesis-profile']
          ? {
              synthesisProfile: nonEmpty(
                values['synthesis-profile'],
                '--synthesis-profile',
              ),
            }
          : {}),
      }
    : undefined;

  return {
    kind: 'run',
    config: {
      databaseUrl,
      queueName: values.queue,
      agentDir: values['agent-dir'],
      profileRoutingRefs,
      input: {
        teamId: values.team,
        diaryId: values.diary,
        target: values.target,
        diff,
        lenses: values.lens,
        synthesisBrief: values.synthesis,
        correlationId: values['correlation-id'] ?? deps.randomUUID(),
        pollIntervalSec:
          values['poll-interval'] === undefined
            ? undefined
            : positiveInt(values['poll-interval'], '--poll-interval'),
        concurrency:
          values.concurrency === undefined
            ? undefined
            : positiveInt(values.concurrency, '--concurrency'),
      },
    },
  };
}
