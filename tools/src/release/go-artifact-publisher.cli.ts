import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  type GoArtifactPublisherConfig,
  readGoArtifactPublisherConfig,
  runGoArtifactPublisher,
} from './go-artifact-publisher';

export function resolveConfigPath(cwd: string, configPath: string) {
  return isAbsolute(configPath) ? configPath : join(cwd, configPath);
}

export function createCliRunOptions(argv = process.argv, env = process.env) {
  return {
    configPath: readOptionFromArgv(argv, '--config'),
    dryRun: argv.includes('--dry-run') || env.NX_DRY_RUN === 'true',
    verbose: argv.includes('--verbose'),
    skipUpload: argv.includes('--skip-upload'),
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

function readOptionFromArgv(argv: string[], name: string) {
  const prefix = `${name}=`;
  const index = argv.indexOf(name);
  if (index >= 0) {
    return argv[index + 1] ?? null;
  }
  const option = argv.find((arg) => arg.startsWith(prefix));
  return option ? option.slice(prefix.length) : null;
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
