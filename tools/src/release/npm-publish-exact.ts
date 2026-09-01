export interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface CommandSpec {
  command: string;
  args: string[];
  cwd?: string;
}

export type CommandRunner = (
  command: CommandSpec,
) => CommandResult | Promise<CommandResult>;

export type RegistryState = 'published' | 'missing';

export interface PublishExactVersionOptions {
  packageName: string;
  version: string;
  packageFilter?: string;
  cwd?: string;
  maxAttempts?: number;
  retryDelayMs?: number;
}

export interface PublishExactVersionResult {
  state: 'already-published' | 'published' | 'reconciled';
  publishAttempts: number;
}

export function classifyExactVersion(
  result: CommandResult,
  version: string,
): RegistryState {
  if (result.exitCode === 0) {
    const published = result.stdout.trim().replace(/^"|"$/g, '');
    if (published === version) return 'published';
    throw new Error(
      `npm returned an unexpected version for the exact package spec: ${JSON.stringify(published)}`,
    );
  }

  const diagnostic = `${result.stdout}\n${result.stderr}`;
  if (/\bE404\b|404 Not Found/i.test(diagnostic)) return 'missing';
  throw new Error(
    `Unable to determine npm registry state (exit ${String(result.exitCode)}): ${diagnostic.trim()}`,
  );
}

export async function inspectExactVersion(
  packageName: string,
  version: string,
  commandRunner: CommandRunner,
): Promise<RegistryState> {
  const result = await commandRunner({
    command: 'npm',
    args: ['view', `${packageName}@${version}`, 'version', '--json'],
  });
  return classifyExactVersion(result, version);
}

export async function publishExactVersion(
  options: PublishExactVersionOptions,
  commandRunner: CommandRunner,
  wait: (durationMs: number) => Promise<void> = defaultWait,
): Promise<PublishExactVersionResult> {
  const maxAttempts = options.maxAttempts ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 30_000;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new TypeError('maxAttempts must be a positive integer');
  }

  let lastPublishFailure: CommandResult | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const registryState = await inspectExactVersion(
      options.packageName,
      options.version,
      commandRunner,
    );
    if (registryState === 'published') {
      return {
        state: attempt === 1 ? 'already-published' : 'reconciled',
        publishAttempts: attempt - 1,
      };
    }

    const publishResult = await commandRunner({
      command: 'pnpm',
      args: [
        '--filter',
        options.packageFilter ?? options.packageName,
        'publish',
        '--no-git-checks',
        '--access',
        'public',
        '--provenance',
      ],
      cwd: options.cwd,
    });
    if (publishResult.exitCode === 0) {
      return { state: 'published', publishAttempts: attempt };
    }
    lastPublishFailure = publishResult;
    if (attempt < maxAttempts) await wait(retryDelayMs);
  }

  const finalState = await inspectExactVersion(
    options.packageName,
    options.version,
    commandRunner,
  );
  if (finalState === 'published') {
    return { state: 'reconciled', publishAttempts: maxAttempts };
  }

  const diagnostic = lastPublishFailure
    ? `${lastPublishFailure.stdout}\n${lastPublishFailure.stderr}`.trim()
    : 'unknown publish failure';
  throw new Error(
    `Failed to publish ${options.packageName}@${options.version} after ${maxAttempts} attempts: ${diagnostic}`,
  );
}

function defaultWait(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
