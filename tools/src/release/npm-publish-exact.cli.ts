import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { type CommandSpec, publishExactVersion } from './npm-publish-exact';

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
  };
}

function runCommand({ command, args, cwd }: CommandSpec) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: process.env,
  });
  return {
    exitCode: result.status,
    stdout: result.stdout ?? '',
    stderr:
      result.stderr ??
      (result.error ? `${result.error.name}: ${result.error.message}` : ''),
  };
}

export async function main(argv = process.argv): Promise<void> {
  const options = parsePublishOptions(argv);
  const result = await publishExactVersion(options, runCommand);
  process.stdout.write(
    `${options.packageName}@${options.version}: ${result.state} (${result.publishAttempts} publish attempts)\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  });
}
