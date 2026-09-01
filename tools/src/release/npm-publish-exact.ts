export interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface CommandSpec {
  command: string;
  args: string[];
  cwd?: string;
  timeoutMs?: number;
}

export type CommandRunner = (
  command: CommandSpec,
) => CommandResult | Promise<CommandResult>;

export type RegistryState =
  | { state: 'published'; integrity: string }
  | { state: 'missing' };

export interface PublishExactVersionOptions {
  packageName: string;
  version: string;
  expectedIntegrity: string;
  packageFilter?: string;
  cwd?: string;
  maxAttempts?: number;
  retryDelayMs?: number;
  commandTimeoutMs?: number;
}

export interface PublishExactVersionResult {
  state: 'already-published' | 'published' | 'reconciled';
  publishAttempts: number;
}

export function classifyExactVersion(
  result: CommandResult,
  expectedIntegrity: string,
): RegistryState {
  if (result.exitCode === 0) {
    let publishedIntegrity: unknown;
    try {
      publishedIntegrity = JSON.parse(result.stdout) as unknown;
    } catch {
      throw new Error(
        `npm returned invalid integrity JSON: ${JSON.stringify(result.stdout.trim())}`,
      );
    }
    if (typeof publishedIntegrity !== 'string') {
      throw new Error(
        `npm returned an invalid integrity value: ${JSON.stringify(publishedIntegrity)}`,
      );
    }
    if (publishedIntegrity === expectedIntegrity) {
      return { state: 'published', integrity: publishedIntegrity };
    }
    throw new Error(
      `Published artifact integrity mismatch: expected ${JSON.stringify(expectedIntegrity)}, received ${JSON.stringify(publishedIntegrity)}`,
    );
  }

  const diagnostic = `${result.stdout}\n${result.stderr}`;
  if (/\bE404\b|404 Not Found/i.test(diagnostic)) return { state: 'missing' };
  throw new Error(
    `Unable to determine npm registry state (exit ${String(result.exitCode)}): ${diagnostic.trim()}`,
  );
}

export async function inspectExactVersion(
  packageName: string,
  version: string,
  expectedIntegrity: string,
  commandRunner: CommandRunner,
  commandTimeoutMs: number,
): Promise<RegistryState> {
  const result = await commandRunner({
    command: 'npm',
    args: ['view', `${packageName}@${version}`, 'dist.integrity', '--json'],
    timeoutMs: commandTimeoutMs,
  });
  return classifyExactVersion(result, expectedIntegrity);
}

export async function publishExactVersion(
  options: PublishExactVersionOptions,
  commandRunner: CommandRunner,
  wait: (durationMs: number) => Promise<void> = defaultWait,
): Promise<PublishExactVersionResult> {
  const maxAttempts = options.maxAttempts ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 30_000;
  const commandTimeoutMs = options.commandTimeoutMs ?? 600_000;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new TypeError('maxAttempts must be a positive integer');
  }
  if (!Number.isFinite(commandTimeoutMs) || commandTimeoutMs <= 0) {
    throw new TypeError('commandTimeoutMs must be a positive number');
  }
  if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(options.expectedIntegrity)) {
    throw new TypeError('expectedIntegrity must be a sha512 SRI value');
  }

  let lastPublishFailure: CommandResult | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const registryState = await inspectExactVersion(
      options.packageName,
      options.version,
      options.expectedIntegrity,
      commandRunner,
      commandTimeoutMs,
    );
    if (registryState.state === 'published') {
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
      timeoutMs: commandTimeoutMs,
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
    options.expectedIntegrity,
    commandRunner,
    commandTimeoutMs,
  );
  if (finalState.state === 'published') {
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
