import type { CommandHelp } from './help.js';

/**
 * Long-form option names that consume the next argument as a value.
 * Used by `resolveHelpCommand` to skip over option values when scanning
 * for the first positional subcommand.
 */
const VALUE_OPTIONS_LONG = new Set([
  '--name',
  '--agent',
  '--api-url',
  '--dir',
  '--org',
  '--from',
  '--diary',
]);

/**
 * Short-form option names that consume the next argument as a value.
 * Kept in sync with `parseArgs` options in index.tsx.
 */
const VALUE_OPTIONS_SHORT = new Set(['-n', '-a', '-o']);

function isValueOption(arg: string): boolean {
  if (VALUE_OPTIONS_LONG.has(arg)) return true;
  if (VALUE_OPTIONS_SHORT.has(arg)) return true;
  return false;
}

/**
 * Resolve which command's help to print for `legreffier <...> --help`.
 *
 * Scans `rawArgs` linearly, skipping option flags and their values, and
 * returns the first positional argument that matches a known command. If
 * no positional is found (or the positional is not a known command),
 * returns `null` so the caller prints root help.
 *
 * Unlike `rawArgs.find((a) => !a.startsWith('-'))`, this correctly handles
 * flags-before-subcommand orderings like:
 *
 *   legreffier --name jobi port --help
 *
 * where the naive scan would return "jobi" instead of "port".
 *
 * Unknown positionals (typos, etc.) fall back to root help rather than
 * silently matching nothing, so users see the full command list.
 */
export function resolveHelpCommand(
  rawArgs: string[],
  commands: CommandHelp[],
): CommandHelp | null {
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === undefined) continue;

    // --help / -h are the triggers; never treat them as a value or positional.
    if (arg === '--help' || arg === '-h') continue;

    // --flag=value form — never a positional, never consumes next arg.
    if (arg.startsWith('--') && arg.includes('=')) continue;

    // Value-taking long option → skip the next arg (its value).
    if (arg.startsWith('--')) {
      if (isValueOption(arg)) i++;
      continue;
    }

    // Short option cluster (-n, -o, -a). Skip next arg if it's a value
    // option. Unknown short flags are treated as value-less to stay permissive.
    if (arg.startsWith('-') && arg.length > 1) {
      if (isValueOption(arg)) i++;
      continue;
    }

    // First non-option token is the candidate subcommand.
    const match = commands.find((c) => c.command === arg);
    return match ?? null;
  }

  return null;
}
