import type { ArgsDef } from 'citty';

import { type AgentType, SUPPORTED_AGENTS } from '../ui/types.js';

/**
 * Regex for valid agent names: 2-39 chars, lowercase alphanumerics and
 * hyphens, must start and end with an alphanumeric. Matches the server-side
 * validation so a client-side failure gives immediate feedback rather than
 * a REST 400 after a keypair has been generated.
 */
const AGENT_NAME_RE = /^[a-z0-9][a-z0-9-]{0,37}[a-z0-9]$/;

const DEFAULT_API_URL = 'https://api.themolt.net';

/**
 * Common argument definitions shared across subcommands. Kept as plain
 * objects (not a merged record) so individual commands can pick the flags
 * they actually accept instead of inheriting every flag.
 */
export const commonArgs = {
  name: {
    type: 'string',
    description:
      'Agent name (2-39 lowercase alphanumerics or hyphens, e.g. `jobi`)',
    alias: 'n',
    valueHint: 'agent-name',
  },
  agent: {
    type: 'string',
    description:
      'Agent client to configure (repeatable: --agent claude --agent codex). Accepts: claude, codex.',
    alias: 'a',
    valueHint: 'claude|codex',
  },
  'api-url': {
    type: 'string',
    description:
      'MoltNet API base URL (default: $MOLTNET_API_URL or https://api.themolt.net)',
    valueHint: 'url',
  },
  dir: {
    type: 'string',
    description: 'Target repository root (default: current working directory)',
    valueHint: 'path',
  },
} as const satisfies ArgsDef;

/**
 * Collect repeated `--agent` / `-a` values from rawArgs.
 *
 * Citty wraps Node's `parseArgs` without `multiple: true`, which means
 * repeating `--agent claude --agent codex` keeps only the last value. The
 * hand-rolled CLI supported repeats and users' docs rely on that shape, so
 * we walk `rawArgs` ourselves to rebuild the full list before validating it
 * against the supported-agent allowlist.
 */
export function collectAgents(rawArgs: string[]): AgentType[] {
  const out: AgentType[] = [];
  for (let i = 0; i < rawArgs.length; i++) {
    const token = rawArgs[i];
    // `--` is the POSIX end-of-options sentinel. Anything after it is a
    // positional, even if it looks like a flag. Node's `parseArgs` stops
    // here, and the previous hand-rolled CLI (which used `parseArgs` under
    // the hood) did too — so we match that to avoid surprising users who
    // pass `-- --agent` as literal positional data.
    if (token === '--') break;
    let value: string | undefined;
    if (token === '--agent' || token === '-a') {
      value = rawArgs[i + 1];
      i++;
    } else if (token.startsWith('--agent=')) {
      value = token.slice('--agent='.length);
    } else if (token.startsWith('-a=')) {
      value = token.slice('-a='.length);
    }
    if (value === undefined) continue;
    if (!SUPPORTED_AGENTS.includes(value as AgentType)) {
      throw new CliValidationError(
        `Unsupported agent: ${value}. Supported: ${SUPPORTED_AGENTS.join(', ')}`,
      );
    }
    out.push(value as AgentType);
  }
  return out;
}

/**
 * Validate a `--name` arg. Throws with the same user-facing message as the
 * previous hand-rolled CLI so scripts and docs referencing it keep working.
 */
export function requireAgentName(name: unknown): string {
  if (typeof name !== 'string' || name.length === 0) {
    throw new CliValidationError('--name is required');
  }
  if (!AGENT_NAME_RE.test(name)) {
    throw new CliValidationError(
      `Invalid agent name: "${name}". Must be 2-39 lowercase alphanumeric characters or hyphens, starting and ending with a letter or digit.`,
    );
  }
  return name;
}

/** Resolve the target repo dir, defaulting to CWD. */
export function resolveDir(dir: unknown): string {
  if (typeof dir === 'string' && dir.length > 0) return dir;
  return process.cwd();
}

/** Resolve the API URL: --api-url flag > $MOLTNET_API_URL > default. */
export function resolveApiUrl(apiUrl: unknown): string {
  if (typeof apiUrl === 'string' && apiUrl.length > 0) return apiUrl;
  return process.env['MOLTNET_API_URL'] ?? DEFAULT_API_URL;
}

/**
 * Thrown by shared validators (`requireAgentName`, `collectAgents`,
 * `validatePortFromArg` adapters, etc.) when the user passed a bad flag
 * value. `withCleanErrors` catches these and prints a single-line
 * "Error: <msg>" on stderr + exit 1, instead of letting citty dump the
 * full stack via its default `console.error(error, "\n")` handler.
 */
export class CliValidationError extends Error {
  override readonly name = 'CliValidationError';
}

/**
 * Wrap a command handler so `CliValidationError`s print a single clean
 * line and exit 1. Unexpected errors (bugs, TypeErrors, network failures)
 * still bubble up with their full stack so we can debug them.
 */
export function withCleanErrors<T>(
  handler: (ctx: T) => void | Promise<void>,
): (ctx: T) => Promise<void> {
  return async (ctx: T) => {
    try {
      await handler(ctx);
    } catch (err) {
      if (err instanceof CliValidationError) {
        process.stderr.write(`Error: ${err.message}\n`);
        process.exit(1);
      }
      throw err;
    }
  };
}
