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
  'ory-tools': 'libs/database',
  'mcp-server': 'apps/mcp-server',
  'rest-api': 'apps/rest-api',
};

function parseArgs(argv) {
  const result = {
    imageTag: undefined,
    output: undefined,
    skipDigests: false,
    version: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--skip-digests') {
      result.skipDigests = true;
    } else if (argument === '--image-tag') {
      result.imageTag = argv[++index];
      if (!result.imageTag || result.imageTag.startsWith('--')) {
        throw new Error('--image-tag requires a value');
      }
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
  if (
    result.imageTag &&
    !/^[0-9A-Za-z_][0-9A-Za-z_.-]{0,127}$/.test(result.imageTag)
  ) {
    throw new Error(`Invalid Docker image tag: ${result.imageTag}`);
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

function validationEnvironment({ includeImages }) {
  const compose = ['deploy/self-host/compose.yaml', 'deploy/ory/compose.yaml']
    .map((file) => readFileSync(path.join(repoRoot, file), 'utf8'))
    .join('\n');
  const required = [...compose.matchAll(/\$\{([A-Z][A-Z0-9_]*):\?/g)];
  return Object.fromEntries(
    required
      .filter(([, name]) => includeImages || !name.endsWith('_IMAGE'))
      .map(([, name]) => [name, 'bundle-validation-secret']),
  );
}

function discoverBindSources() {
  const rendered = run(
    'docker',
    [
      'compose',
      '--env-file',
      '.env.example',
      '--profile',
      '*',
      '-f',
      'compose.yaml',
      '-f',
      'compose.tracing.yaml',
      'config',
      '--format',
      'json',
    ],
    {
      capture: true,
      cwd: sourceDir,
      env: validationEnvironment({ includeImages: true }),
    },
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

function currentImages(imageTag) {
  const workspace = JSON.parse(
    readFileSync(path.join(repoRoot, 'nx.json'), 'utf8'),
  );
  const registry = workspace.release?.docker?.registryUrl;
  if (!registry) {
    throw new Error('Missing Docker release registry URL in nx.json');
  }
  const versions = JSON.parse(
    readFileSync(path.join(repoRoot, '.release-please-manifest.json'), 'utf8'),
  );
  return Object.fromEntries(
    Object.entries(imageProjects).map(([name, project]) => {
      const projectJson = JSON.parse(
        readFileSync(path.join(repoRoot, project, 'package.json'), 'utf8'),
      );
      const repository = projectJson.nx?.release?.docker?.repositoryName;
      const version = imageTag ?? versions[project];
      if (!repository || !version) {
        throw new Error(`Missing Docker release metadata for ${project}`);
      }
      return [name, `${registry}/${repository}:${version}`];
    }),
  );
}

function writeImageLock(destination, skipDigests, imageTag) {
  const images = currentImages(imageTag);
  const lines = [];
  const verifiedImages = new Map();
  for (const [name, image] of Object.entries(images)) {
    const variable = `${name.replaceAll('-', '_').toUpperCase()}_IMAGE`;
    if (skipDigests) {
      lines.push(`${variable}=${image}`);
      continue;
    }
    if (!verifiedImages.has(image)) {
      const manifest = JSON.parse(
        run(
          'docker',
          [
            'buildx',
            'imagetools',
            'inspect',
            image,
            '--format',
            '{{json .Manifest}}',
          ],
          { capture: true },
        ),
      );
      const digest = manifest.digest;
      if (typeof digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(digest)) {
        throw new Error(`Registry returned an invalid digest for ${image}`);
      }
      for (const architecture of ['amd64', 'arm64']) {
        if (
          !(manifest.manifests ?? []).some(
            (entry) =>
              entry.platform?.os === 'linux' &&
              entry.platform?.architecture === architecture &&
              /^sha256:[a-f0-9]{64}$/.test(entry.digest ?? ''),
          )
        ) {
          throw new Error(`${image} is missing linux/${architecture}`);
        }
      }
      const reference = `${imageWithoutTag(image)}@${digest}`;
      const results = JSON.parse(
        run(
          'gh',
          [
            'attestation',
            'verify',
            `oci://${reference}`,
            '--repo',
            'getlarge/themoltnet',
            '--signer-workflow',
            'getlarge/themoltnet/.github/workflows/release.yml',
            '--bundle-from-oci',
            '--format',
            'json',
          ],
          { capture: true },
        ),
      );
      if (
        !Array.isArray(results) ||
        !results.some((result) => result?.verificationResult)
      ) {
        throw new Error(`No verified release provenance for ${reference}`);
      }
      // Preserve the selected release version as well as its immutable digest.
      verifiedImages.set(image, `${image}@${digest}`);
    }
    lines.push(`${variable}=${verifiedImages.get(image)}`);
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
  for (const files of [
    ['compose.yaml'],
    ['compose.yaml', 'compose.tracing.yaml'],
  ]) {
    run(
      'docker',
      [
        'compose',
        '--env-file',
        '.env.example',
        '--env-file',
        '.env.release',
        '--profile',
        '*',
        ...files.flatMap((file) => ['-f', file]),
        'config',
        '--quiet',
      ],
      {
        cwd: path.join(bundleRoot, 'deploy/self-host'),
        env: validationEnvironment({ includeImages: false }),
      },
    );
  }
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
  for (const name of [
    '.env.example',
    'README.md',
    'compose.yaml',
    'compose.tracing.yaml',
    'maintain.sh',
  ]) {
    cpSync(path.join(sourceDir, name), path.join(bundleSource, name));
  }
  mkdirSync(path.join(bundleRoot, 'deploy/ory'), { recursive: true });
  for (const name of ['compose.yaml', 'README.md']) {
    cpSync(
      path.join(repoRoot, 'deploy/ory', name),
      path.join(bundleRoot, 'deploy/ory', name),
    );
  }
  // All other module assets are copied from effective bind mounts below.
  // Never recursively package an operator's local environment or state files.
  for (const source of discoverBindSources()) {
    const relative = assertRepositoryPath(source);
    const destination = path.join(bundleRoot, relative);
    mkdirSync(path.dirname(destination), { recursive: true });
    cpSync(source, destination, { recursive: true });
  }

  writeImageLock(
    path.join(bundleRoot, 'deploy/self-host/.env.release'),
    args.skipDigests,
    args.imageTag,
  );
  validateBundle(bundleRoot);
  process.stdout.write(`${bundleRoot}\n`);
}

main();
