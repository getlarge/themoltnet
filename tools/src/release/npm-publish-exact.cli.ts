import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { type CommandSpec, publishExactVersion } from './npm-publish-exact';

export const defaultCommandTimeoutMs = 600_000;

export function parsePublishOptions(argv = process.argv) {
  const { values } = parseArgs({
    args: argv.slice(2),
    allowPositionals: false,
    options: {
      package: { type: 'string' },
      version: { type: 'string' },
      filter: { type: 'string' },
      cwd: { type: 'string' },
      attempts: { type: 'string', default: '3' },
      'retry-delay-ms': { type: 'string', default: '30000' },
      'command-timeout-ms': {
        type: 'string',
        default: String(defaultCommandTimeoutMs),
      },
    },
  });
  if (!values.package || !values.version) {
    throw new Error(
      'Usage: npm-publish-exact.cli.ts --package <name> --version <version>',
    );
  }
  return {
    packageName: values.package,
    version: values.version,
    packageFilter: values.filter,
    cwd: values.cwd,
    maxAttempts: Number(values.attempts),
    retryDelayMs: Number(values['retry-delay-ms']),
    commandTimeoutMs: Number(values['command-timeout-ms']),
  };
}

export function runCommand({ command, args, cwd, timeoutMs }: CommandSpec) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: process.env,
    timeout: timeoutMs ?? defaultCommandTimeoutMs,
  });
  return {
    exitCode: result.status,
    stdout: result.stdout ?? '',
    stderr: [
      result.stderr ?? '',
      result.error ? `${result.error.name}: ${result.error.message}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

export function computeLocalPackageIntegrity(
  options: ReturnType<typeof parsePublishOptions>,
): string {
  const packDirectory = mkdtempSync(join(tmpdir(), 'moltnet-npm-pack-'));
  try {
    const packResult = runCommand({
      command: 'pnpm',
      args: [
        '--filter',
        options.packageFilter ?? options.packageName,
        'pack',
        '--json',
        '--pack-destination',
        packDirectory,
      ],
      cwd: options.cwd,
      timeoutMs: options.commandTimeoutMs,
    });
    if (packResult.exitCode !== 0) {
      throw new Error(
        `Unable to pack ${options.packageName}@${options.version}: ${`${packResult.stdout}\n${packResult.stderr}`.trim()}`,
      );
    }

    const pack = JSON.parse(packResult.stdout) as {
      filename?: unknown;
      name?: unknown;
      version?: unknown;
    };
    if (
      pack.name !== options.packageName ||
      pack.version !== options.version ||
      typeof pack.filename !== 'string'
    ) {
      throw new Error(
        `pnpm pack returned unexpected package metadata: ${JSON.stringify(pack)}`,
      );
    }
    const tarballPath = isAbsolute(pack.filename)
      ? resolve(pack.filename)
      : resolve(options.cwd ?? process.cwd(), pack.filename);
    const resolvedPackDirectory = `${resolve(packDirectory)}${sep}`;
    if (!tarballPath.startsWith(resolvedPackDirectory)) {
      throw new Error('pnpm pack returned a tarball outside its destination');
    }
    return `sha512-${createHash('sha512')
      .update(readFileSync(tarballPath))
      .digest('base64')}`;
  } finally {
    rmSync(packDirectory, { recursive: true, force: true });
  }
}

export async function main(argv = process.argv): Promise<void> {
  const options = parsePublishOptions(argv);
  const expectedIntegrity = computeLocalPackageIntegrity(options);
  const result = await publishExactVersion(
    { ...options, expectedIntegrity },
    runCommand,
  );
  process.stdout.write(
    `${options.packageName}@${options.version}: ${result.state} (${result.publishAttempts} publish attempts)\n`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  });
}
