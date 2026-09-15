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
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { resolvePackFilename } from './pack-result.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(packageRoot, '../..');
const overlayRoot = resolve(packageRoot, 'standalone/overlay');
const apiClientRoot = resolve(repositoryRoot, 'libs/api-client/src');
const sharedCheckPack = resolve(repositoryRoot, 'tools/src/check-pack.ts');
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
  'scripts/dev.mjs',
  'scripts/pack-result.mjs',
  'vite.config.mjs',
  'vitest.config.ts',
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
    const tarball = resolvePackFilename(
      execFileSync(
        'pnpm',
        ['pack', '--pack-destination', temporary, '--json'],
        {
          cwd: packageRoot,
          encoding: 'utf8',
        },
      ),
      temporary,
    );
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
    dev: 'node scripts/dev.mjs',
    lint: 'n8n-node lint',
    test: 'vitest run',
    typecheck: 'tsc --build tsconfig.json --emitDeclarationOnly',
  };
  delete result.devDependencies['@moltnet/api-client'];
  delete result.nx;
  return result;
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
  const vendoredBindings = resolve(output, 'vendor/moltnet-api-bindings');
  await mkdir(vendoredBindings, { recursive: true });
  await cp(
    resolve(apiClientRoot, 'api-bindings.ts'),
    resolve(vendoredBindings, 'api-bindings.ts'),
  );
  await cp(
    resolve(apiClientRoot, 'generated-api-bindings'),
    resolve(vendoredBindings, 'generated-api-bindings'),
    {
      recursive: true,
      filter: (source) => !source.endsWith('/client/plugin.ts'),
    },
  );
  await cp(sharedCheckPack, resolve(output, 'scripts/check-pack-shared.ts'));

  const manifest = standaloneManifest(await normalizedManifest());
  await writeFile(
    resolve(output, 'package.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
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
