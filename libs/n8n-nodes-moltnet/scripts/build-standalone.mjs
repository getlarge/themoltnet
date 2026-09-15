import { execFileSync } from 'node:child_process';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(packageRoot, '../..');
const overlayRoot = resolve(packageRoot, 'standalone/overlay');
const apiClientRoot = resolve(repositoryRoot, 'libs/api-client/src');
const standaloneRepository =
  'git+https://github.com/getlarge/n8n-nodes-moltnet.git';

const copiedPaths = [
  'CHANGELOG.md',
  'LICENSE.md',
  'README.md',
  '__tests__/MoltNet.node.spec.ts',
  '__tests__/credentials.spec.ts',
  '__tests__/harness.ts',
  '__tests__/workflow.spec.ts',
  'credentials',
  'examples',
  'nodes',
  'scripts/check-pack.mjs',
  'vite.config.mjs',
  'vitest.config.ts',
];
const apiBindingPaths = [
  'api-bindings.ts',
  'generated-api-bindings/client/client.ts',
  'generated-api-bindings/client/index.ts',
  'generated-api-bindings/client/types.ts',
  'generated-api-bindings/custom.gen.ts',
  'generated-api-bindings/index.ts',
  'generated-api-bindings/sdk.gen.ts',
  'generated-api-bindings/types.gen.ts',
];

function parseArguments(argv) {
  const args = [...argv];
  const output = args.shift();
  let sourceRef;
  let sourceSha;
  while (args.length > 0) {
    const flag = args.shift();
    const value = args.shift();
    if (flag === '--source-ref') sourceRef = value;
    else if (flag === '--source-sha') sourceSha = value;
    else throw new Error(`Unknown argument ${String(flag)}`);
  }
  if (!output || !sourceRef || !sourceSha) {
    throw new Error(
      'usage: node scripts/build-standalone.mjs <output-directory> --source-ref <tag> --source-sha <sha>',
    );
  }
  if (!/^[0-9a-f]{40}$/u.test(sourceSha)) {
    throw new Error('--source-sha must be a full 40-character Git SHA');
  }
  return { output: resolve(output), sourceRef, sourceSha };
}

async function assertEmptyOutput(output) {
  const existing = await readdir(output).catch((error) => {
    if (error?.code === 'ENOENT') return [];
    throw error;
  });
  if (existing.length > 0) {
    throw new Error(`${output} is not empty; pass a new or empty directory`);
  }
  await mkdir(output, { recursive: true });
}

async function normalizedManifest() {
  const temporary = await mkdtemp(join(tmpdir(), 'moltnet-n8n-manifest-'));
  try {
    const packed = JSON.parse(
      execFileSync(
        'pnpm',
        ['pack', '--pack-destination', temporary, '--json'],
        { cwd: packageRoot, encoding: 'utf8' },
      ),
    );
    const packResult = Array.isArray(packed)
      ? packed[0]
      : packed.filename
        ? packed
        : Object.values(packed)[0];
    if (!packResult || typeof packResult.filename !== 'string') {
      throw new Error('pnpm pack did not return a package filename');
    }
    const tarball = isAbsolute(packResult.filename)
      ? packResult.filename
      : resolve(temporary, packResult.filename);
    return JSON.parse(
      execFileSync('tar', ['-xOf', tarball, 'package/package.json'], {
        encoding: 'utf8',
      }),
    );
  } finally {
    await rm(temporary, { force: true, recursive: true });
  }
}

function standaloneManifest(manifest) {
  const result = JSON.parse(JSON.stringify(manifest));
  result.homepage = 'https://github.com/getlarge/n8n-nodes-moltnet#readme';
  result.bugs = {
    url: 'https://github.com/getlarge/n8n-nodes-moltnet/issues',
  };
  result.repository = { type: 'git', url: standaloneRepository };
  result.scripts = {
    build: 'vite build',
    'check:pack': 'node scripts/check-pack.mjs',
    dev: 'n8n-node dev',
    lint: 'n8n-node lint',
    test: 'vitest run',
    typecheck: 'tsc --build tsconfig.json --emitDeclarationOnly',
  };
  delete result.devDependencies['@moltnet/api-client'];
  delete result.nx;
  return result;
}

async function updatePackageLock(output, manifest) {
  const path = resolve(output, 'package-lock.json');
  const lock = JSON.parse(await readFile(path, 'utf8'));
  lock.name = manifest.name;
  lock.version = manifest.version;
  const root = lock.packages?.[''];
  if (!root) throw new Error('Standalone package-lock is missing packages[""]');
  root.name = manifest.name;
  root.version = manifest.version;
  root.license = manifest.license;
  root.devDependencies = manifest.devDependencies;
  root.peerDependencies = manifest.peerDependencies;
  root.engines = manifest.engines;
  await writeFile(path, `${JSON.stringify(lock, null, 2)}\n`);
}

async function prependGeneratedNotice(output, sourceRef, sourceSha) {
  const path = resolve(output, 'README.md');
  const readme = await readFile(path, 'utf8');
  const notice = [
    '> [!IMPORTANT]',
    '> This repository is generated from',
    `> [getlarge/themoltnet ${sourceRef}](https://github.com/getlarge/themoltnet/tree/${sourceSha}/libs/n8n-nodes-moltnet).`,
    '> Make changes in the monorepo; direct edits here are overwritten by the next release.',
    '',
  ].join('\n');
  await writeFile(path, `${notice}\n${readme}`);
  await writeFile(
    resolve(output, 'SOURCE.md'),
    [
      '# Generated source',
      '',
      `- Repository: https://github.com/getlarge/themoltnet`,
      `- Ref: \`${sourceRef}\``,
      `- Commit: \`${sourceSha}\``,
      '',
    ].join('\n'),
  );
}

export async function buildStandalone({ output, sourceRef, sourceSha }) {
  await assertEmptyOutput(output);
  for (const relative of copiedPaths) {
    await cp(resolve(packageRoot, relative), resolve(output, relative), {
      force: true,
      recursive: true,
    });
  }
  await cp(overlayRoot, output, { force: true, recursive: true });
  for (const relative of apiBindingPaths) {
    const target = resolve(output, 'vendor/moltnet-api-bindings', relative);
    await mkdir(dirname(target), { recursive: true });
    await cp(resolve(apiClientRoot, relative), target);
  }

  const manifest = standaloneManifest(await normalizedManifest());
  await writeFile(
    resolve(output, 'package.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await updatePackageLock(output, manifest);
  await prependGeneratedNotice(output, sourceRef, sourceSha);
}

const invokedDirectly =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
  buildStandalone(parseArguments(process.argv.slice(2))).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  });
}
