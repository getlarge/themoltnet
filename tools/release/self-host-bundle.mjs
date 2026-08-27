#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const sourceDir = path.join(repoRoot, 'deploy/self-host');

function parseArgs(argv) {
  const result = { output: undefined, skipDigests: false, version: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--skip-digests') {
      result.skipDigests = true;
    } else if (argument === '--output') {
      result.output = argv[++index];
    } else if (argument === '--version') {
      result.version = argv[++index];
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!result.version) throw new Error('--version is required');
  if (!/^[0-9A-Za-z][0-9A-Za-z._-]*$/.test(result.version)) {
    throw new Error(`Invalid bundle version: ${result.version}`);
  }
  return result;
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
    stdio: options.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });
}

function assertRepositoryPath(source) {
  const relative = path.relative(repoRoot, source);
  if (
    relative === '' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Compose bind source is outside the repository: ${source}`);
  }
  return relative;
}

function discoverBindSources() {
  const backupEnvironment = {
    BACKUP_S3_ACCESS_KEY_ID: 'bundle-validation',
    BACKUP_S3_BUCKET: 'bundle-validation',
    BACKUP_S3_ENDPOINT: 'https://s3.example.com',
    BACKUP_S3_REGION: 'bundle-validation',
    BACKUP_S3_SECRET_ACCESS_KEY: 'bundle-validation',
  };
  const rendered = run(
    'docker',
    [
      'compose',
      '--env-file',
      '.env.example',
      '-f',
      'compose.yaml',
      '-f',
      'compose.backup.yaml',
      'config',
      '--format',
      'json',
    ],
    { capture: true, cwd: sourceDir, env: backupEnvironment },
  );
  const model = JSON.parse(rendered);
  const sources = new Set();
  for (const service of Object.values(model.services ?? {})) {
    for (const volume of service.volumes ?? []) {
      if (volume.type === 'bind') {
        sources.add(
          path.isAbsolute(volume.source)
            ? path.resolve(volume.source)
            : path.resolve(sourceDir, volume.source),
        );
      }
    }
  }
  return [...sources].sort();
}

function imageWithoutTag(image) {
  const slash = image.lastIndexOf('/');
  const colon = image.lastIndexOf(':');
  return colon > slash ? image.slice(0, colon) : image;
}

function writeImageLock(destination, skipDigests) {
  const images = JSON.parse(
    readFileSync(path.join(sourceDir, 'images.json'), 'utf8'),
  );
  const lines = [];
  for (const [name, image] of Object.entries(images)) {
    const variable = `${name.replaceAll('-', '_').toUpperCase()}_IMAGE`;
    if (skipDigests) {
      lines.push(`${variable}=${image}`);
      continue;
    }
    const digest = run(
      'docker',
      [
        'buildx',
        'imagetools',
        'inspect',
        image,
        '--format',
        '{{.Manifest.Digest}}',
      ],
      { capture: true },
    ).trim();
    if (!/^sha256:[a-f0-9]{64}$/.test(digest)) {
      throw new Error(
        `Registry returned an invalid digest for ${image}: ${digest}`,
      );
    }
    lines.push(`${variable}=${imageWithoutTag(image)}@${digest}`);
  }
  writeFileSync(destination, `${lines.join('\n')}\n`, { mode: 0o644 });
}

function validateBundle(bundleRoot) {
  run(
    'docker',
    [
      'compose',
      '--env-file',
      '.env.example',
      '--env-file',
      '.env.release',
      '-f',
      'compose.yaml',
      '-f',
      'compose.backup.yaml',
      'config',
      '--quiet',
    ],
    {
      cwd: path.join(bundleRoot, 'deploy/self-host'),
      env: {
        BACKUP_S3_ACCESS_KEY_ID: 'bundle-validation',
        BACKUP_S3_BUCKET: 'bundle-validation',
        BACKUP_S3_ENDPOINT: 'https://s3.example.com',
        BACKUP_S3_REGION: 'bundle-validation',
        BACKUP_S3_SECRET_ACCESS_KEY: 'bundle-validation',
      },
    },
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const bundleName = `moltnet-self-host-${args.version}`;
  const bundleRoot = path.resolve(
    args.output ?? path.join(repoRoot, bundleName),
  );
  if (existsSync(bundleRoot)) {
    throw new Error(`Bundle destination already exists: ${bundleRoot}`);
  }

  cpSync(sourceDir, path.join(bundleRoot, 'deploy/self-host'), {
    recursive: true,
  });
  for (const source of discoverBindSources()) {
    const relative = assertRepositoryPath(source);
    const destination = path.join(bundleRoot, relative);
    mkdirSync(path.dirname(destination), { recursive: true });
    cpSync(source, destination, { recursive: true });
  }

  writeImageLock(
    path.join(bundleRoot, 'deploy/self-host/.env.release'),
    args.skipDigests,
  );
  validateBundle(bundleRoot);
  process.stdout.write(`${bundleRoot}\n`);
}

main();
