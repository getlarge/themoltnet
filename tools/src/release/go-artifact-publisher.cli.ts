import { join } from 'node:path';

import {
  readGoArtifactPublisherConfig,
  runGoArtifactPublisher,
} from './go-artifact-publisher';

function readOption(name: string) {
  const prefix = `${name}=`;
  const index = process.argv.indexOf(name);
  if (index >= 0) {
    return process.argv[index + 1] ?? null;
  }
  const option = process.argv.find((arg) => arg.startsWith(prefix));
  return option ? option.slice(prefix.length) : null;
}

const configPath = readOption('--config');
if (!configPath) {
  throw new Error('Usage: go-artifact-publisher.cli.ts --config <path>');
}

const dryRun = process.argv.includes('--dry-run');
const verbose = process.argv.includes('--verbose');
const skipUpload = process.argv.includes('--skip-upload');
const cwd = process.cwd();
const config = readGoArtifactPublisherConfig(join(cwd, configPath));

runGoArtifactPublisher(
  skipUpload
    ? {
        ...config,
        artifactStore: {
          provider: 'none',
        },
      }
    : config,
  {
    cwd,
    dryRun,
    verbose,
  },
);
