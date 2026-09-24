#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const sourceDir = path.join(repoRoot, 'deploy/self-host');
const imageProjects = {
  console: 'apps/console',
  'db-migrate': 'libs/database',
  'mcp-server': 'apps/mcp-server',
  'rest-api': 'apps/rest-api',
};

function parseArgs(argv) {
  const result = { output: undefined, skipDigests: false, version: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--skip-digests') {
      result.skipDigests = true;
    } else if (argument === '--output') {
      result.output = argv[++index];
      if (!result.output || result.output.startsWith('--')) {
        throw new Error('--output requires a value');
      }
    } else if (argument === '--version') {
      result.version = argv[++index];
      if (!result.version || result.version.startsWith('--')) {
        throw new Error('--version requires a value');
      }
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!result.version) {
    throw new Error('--version requires a value');
  }
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
  const resolved = path.relative(repoRoot, realpathSync(source));
  if (
    relative === '' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative) ||
    resolved.startsWith(`..${path.sep}`) ||
    path.isAbsolute(resolved)
  ) {
    throw new Error(`Compose bind source is outside the repository: ${source}`);
  }
  if (!statSync(source).isFile()) {
    throw new Error(`Compose bind source is not a file: ${source}`);
  }
  return relative;
}

function validationEnvironment() {
  const compose = readFileSync(path.join(sourceDir, 'compose.yaml'), 'utf8');
  const required = [...compose.matchAll(/\$\{([A-Z][A-Z0-9_]*):\?/g)];
  return Object.fromEntries(
    required.map(([, name]) => [name, 'bundle-validation-secret']),
  );
}

function discoverBindSources() {
  const rendered = run(
    'docker',
    [
      'compose',
      '--env-file',
      '.env.example',
      '-f',
      'compose.yaml',
      'config',
      '--format',
      'json',
    ],
    { capture: true, cwd: sourceDir, env: validationEnvironment() },
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
  if (image.includes('@')) {
    throw new Error(`Expected a tagged image, got digest reference: ${image}`);
  }
  const slash = image.lastIndexOf('/');
  const colon = image.lastIndexOf(':');
  return colon > slash ? image.slice(0, colon) : image;
}

function currentImages() {
  const versions = JSON.parse(
    readFileSync(path.join(repoRoot, '.release-please-manifest.json'), 'utf8'),
  );
  return Object.fromEntries(
    Object.entries(imageProjects).map(([name, project]) => {
      const projectJson = JSON.parse(
        readFileSync(path.join(repoRoot, project, 'package.json'), 'utf8'),
      );
      const repository = projectJson.nx?.release?.docker?.repositoryName;
      const version = versions[project];
      if (!repository || !version) {
        throw new Error(`Missing Docker release metadata for ${project}`);
      }
      return [name, `ghcr.io/${repository}:${version}`];
    }),
  );
}

function writeImageLock(destination, skipDigests) {
  const images = currentImages();
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
  const releaseSignerPublicKey = run(
    'bash',
    ['tools/release/release-signer-pubkey.sh', repoRoot],
    { capture: true },
  ).trim();
  if (!/^ssh-ed25519 [A-Za-z0-9+/]+={0,2}$/.test(releaseSignerPublicKey)) {
    throw new Error('Invalid release signer public key');
  }
  lines.push(`RELEASE_SIGNER_PUBKEY=${releaseSignerPublicKey}`);
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
      'config',
      '--quiet',
    ],
    {
      cwd: path.join(bundleRoot, 'deploy/self-host'),
      env: validationEnvironment(),
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

  const bundleSource = path.join(bundleRoot, 'deploy/self-host');
  mkdirSync(bundleSource, { recursive: true });
  for (const name of ['.env.example', 'README.md', 'compose.yaml']) {
    cpSync(path.join(sourceDir, name), path.join(bundleSource, name));
  }
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
