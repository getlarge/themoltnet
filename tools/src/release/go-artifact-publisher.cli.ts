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

export function createCliRunOptions(argv = process.argv, env = process.env) {
  const { values } = parseArgs({
    args: argv.slice(2),
    allowPositionals: false,
    options: {
      config: {
        type: 'string',
      },
      'dry-run': {
        type: 'boolean',
      },
      'skip-upload': {
        type: 'boolean',
      },
      verbose: {
        type: 'boolean',
      },
    },
  });

  return {
    configPath: values.config ?? null,
    dryRun: values['dry-run'] === true || env.NX_DRY_RUN === 'true',
    verbose: values.verbose === true,
    skipUpload: values['skip-upload'] === true,
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

export function main(
  argv = process.argv,
  env = process.env,
  cwd = process.cwd(),
) {
  const { configPath, dryRun, verbose, skipUpload } = createCliRunOptions(
    argv,
    env,
  );
  if (!configPath) {
    throw new Error('Usage: go-artifact-publisher.cli.ts --config <path>');
  }

  const config = readGoArtifactPublisherConfig(
    resolveConfigPath(cwd, configPath),
  );

  return runGoArtifactPublisher(applyCliOverrides(config, { skipUpload }), {
    cwd,
    dryRun,
    verbose,
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
