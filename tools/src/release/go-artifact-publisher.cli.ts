import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import {
  type GoArtifactPublisherConfig,
  readGoArtifactPublisherConfig,
  runGoArtifactPublisher,
} from './go-artifact-publisher';

export function resolveConfigPath(cwd: string, configPath: string) {
  return isAbsolute(configPath) ? configPath : join(cwd, configPath);
}

function normalizeBooleanOptionValues(args: string[]) {
  // Nx forwards booleans as --dryRun=true, while node:util parseArgs expects
  // boolean options without explicit values.
  const booleanOptions = new Set([
    'dry-run',
    'dryRun',
    'skip-upload',
    'skipUpload',
    'provenance',
    'verbose',
    'yes',
  ]);
  return args.flatMap((arg) => {
    const match = /^--([^=]+)=(true|false)$/.exec(arg);
    if (!match || !booleanOptions.has(match[1])) {
      return [arg];
    }
    return match[2] === 'true' ? [`--${match[1]}`] : [];
  });
}

export function createCliRunOptions(argv = process.argv, env = process.env) {
  const { values } = parseArgs({
    args: normalizeBooleanOptionValues(argv.slice(2)),
    allowPositionals: false,
    options: {
      config: {
        type: 'string',
      },
      'dry-run': {
        type: 'boolean',
      },
      dryRun: {
        type: 'boolean',
      },
      'skip-upload': {
        type: 'boolean',
      },
      skipUpload: {
        type: 'boolean',
      },
      verbose: {
        type: 'boolean',
      },
      registry: {
        type: 'string',
      },
      tag: {
        type: 'string',
      },
      access: {
        type: 'string',
      },
      otp: {
        type: 'string',
      },
      provenance: {
        type: 'boolean',
      },
      userconfig: {
        type: 'string',
      },
      yes: {
        type: 'boolean',
      },
    },
  });

  return {
    configPath: values.config ?? null,
    dryRun:
      values['dry-run'] === true ||
      values.dryRun === true ||
      env.NX_DRY_RUN === 'true',
    verbose: values.verbose === true,
    skipUpload: values['skip-upload'] === true || values.skipUpload === true,
    useLocalReplaces: env.GO_RELEASE_USE_LOCAL_REPLACES === 'true',
  };
}

export function applyCliOverrides(
  config: GoArtifactPublisherConfig,
  options: { skipUpload?: boolean },
) {
  if (!options.skipUpload) {
    return config;
  }
  return {
    ...config,
    artifactStore: {
      provider: 'none' as const,
    },
  };
}

export async function main(
  argv = process.argv,
  env = process.env,
  cwd = process.cwd(),
) {
  const { configPath, dryRun, verbose, skipUpload, useLocalReplaces } =
    createCliRunOptions(argv, env);
  if (!configPath) {
    throw new Error('Usage: go-artifact-publisher.cli.ts --config <path>');
  }

  const config = readGoArtifactPublisherConfig(
    resolveConfigPath(cwd, configPath),
  );

  return runGoArtifactPublisher(applyCliOverrides(config, { skipUpload }), {
    cwd,
    dryRun,
    useLocalReplaces,
    verbose,
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  });
}
