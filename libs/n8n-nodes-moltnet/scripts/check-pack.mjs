import { execFileSync } from 'node:child_process';
import console from 'node:console';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(packageRoot, '../..');
const temporaryRoot = mkdtempSync(join(tmpdir(), 'moltnet-n8n-pack-'));
const extractedRoot = join(temporaryRoot, 'extracted');
const consumerRoot = join(temporaryRoot, 'consumer');

const requiredFiles = [
  'dist/credentials/MoltNetAgentApi.credentials.js',
  'dist/credentials/MoltNetOAuth2Api.credentials.js',
  'dist/nodes/MoltNet/MoltNet.node.js',
  'dist/nodes/MoltNet/MoltNet.node.json',
  'dist/nodes/MoltNet/moltnet-mark.svg',
  'dist/nodes/MoltNet/moltnet-mark.dark.svg',
  'examples/create-and-wait.workflow.json',
  'README.md',
  'LICENSE.md',
];
const credentialSources = [
  {
    repository: 'dist/credentials/MoltNetAgentApi.credentials.js',
    portal: 'credentials/MoltNetAgentApi.credentials.ts',
    source: 'credentials/MoltNetAgentApi.credentials.ts',
  },
  {
    repository: 'dist/credentials/MoltNetOAuth2Api.credentials.js',
    portal: 'credentials/MoltNetOAuth2Api.credentials.ts',
    source: 'credentials/MoltNetOAuth2Api.credentials.ts',
  },
];
const forbiddenRuntimePatterns = [
  [/\bglobalThis\b/u, 'uses the restricted global globalThis'],
  [/\b(?:setTimeout|setInterval)\s*\(/u, 'uses restricted timer globals'],
  [/\bfetch\s*\(/u, 'uses fetch instead of n8n HTTP transport'],
  [/\bprocess\./u, 'accesses the process global'],
  [/\b(?:__dirname|__filename)\b/u, 'uses restricted path globals'],
  [/["']node:/u, 'imports a Node.js built-in module'],
  [
    /\bsleepWithAbort\b/u,
    'uses an n8n-workflow export unavailable in supported n8n hosts',
  ],
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function listFiles(root, prefix = '') {
  return readdirSync(resolve(root, prefix), { withFileTypes: true }).flatMap(
    (entry) => {
      const relative = join(prefix, entry.name);
      return entry.isDirectory() ? listFiles(root, relative) : [relative];
    },
  );
}

try {
  for (const credential of credentialSources) {
    try {
      execFileSync('git', ['ls-files', '--error-unmatch', credential.portal], {
        cwd: repositoryRoot,
        stdio: 'pipe',
      });
    } catch {
      throw new Error(
        `Creator Portal requires ${credential.portal} to be tracked from the Git repository root`,
      );
    }

    const portalCredentialPath = resolve(repositoryRoot, credential.portal);
    const credentialSource = readFileSync(
      resolve(packageRoot, credential.source),
      'utf8',
    );
    assert(
      readFileSync(portalCredentialPath, 'utf8') === credentialSource,
      `${credential.portal} must be a byte-identical checked-in copy of the package credential source`,
    );

    try {
      execFileSync(
        'git',
        ['ls-files', '--error-unmatch', credential.repository],
        {
          cwd: packageRoot,
          stdio: 'pipe',
        },
      );
    } catch {
      throw new Error(
        `Creator Portal requires ${credential.repository} to be tracked at the exact n8n manifest path`,
      );
    }
  }

  // Run the repository-wide entrypoint, source-leak, relative-import,
  // declaration, private-dependency, and provenance checks first. The rest of
  // this script adds the n8n manifest, CommonJS, host-peer, and cloud-safety
  // probes that are specific to community nodes.
  execFileSync(
    'pnpm',
    ['exec', 'tsx', '../../tools/src/check-pack.ts', '--package', packageRoot],
    { cwd: packageRoot, stdio: 'inherit' },
  );

  const packed = JSON.parse(
    execFileSync(
      'pnpm',
      ['pack', '--pack-destination', temporaryRoot, '--json'],
      { cwd: packageRoot, encoding: 'utf8' },
    ),
  );
  const filename = Array.isArray(packed)
    ? packed[0]?.filename
    : packed.filename;
  assert(typeof filename === 'string', 'pnpm pack did not return a filename');

  const tarball = resolve(packageRoot, filename);
  mkdirSync(extractedRoot, { recursive: true });
  execFileSync('tar', ['-xzf', tarball, '-C', extractedRoot]);

  const packedRoot = join(extractedRoot, 'package');
  const manifest = JSON.parse(readFileSync(join(packedRoot, 'package.json')));
  const files = listFiles(packedRoot);

  assert(
    Object.keys(manifest.dependencies ?? {}).length === 0,
    'Published package must have no runtime dependencies',
  );
  assert(
    manifest.author?.email === 'ed@getlarge.eu',
    'Published package author.email must match the npm owner for n8n Creator Portal submission',
  );
  assert(
    manifest.peerDependencies?.['n8n-workflow'] === '*',
    'n8n-workflow must remain a host peer dependency',
  );

  for (const file of requiredFiles) {
    assert(files.includes(file), `Packed package is missing ${file}`);
  }

  const codex = JSON.parse(
    readFileSync(
      join(packedRoot, 'dist/nodes/MoltNet/MoltNet.node.json'),
      'utf8',
    ),
  );
  assert(
    codex.node === `${manifest.name}.moltNet`,
    'Node codex identifier must be the fully-qualified package and node name',
  );
  assert(
    JSON.stringify(codex.categories) === JSON.stringify(['Development']),
    'Node codex categories must contain only supported n8n categories',
  );

  for (const entry of manifest.n8n.nodes.concat(manifest.n8n.credentials)) {
    assert(
      files.includes(entry),
      `n8n manifest points to missing file ${entry}`,
    );
  }

  for (const file of files.filter((entry) => entry.endsWith('.js'))) {
    const source = readFileSync(join(packedRoot, file), 'utf8');
    assert(
      !/require\(["'](?:@themoltnet\/sdk|@moltnet\/)/u.test(source),
      `${file} retains an unresolved private/workspace import`,
    );
    for (const [pattern, failure] of forbiddenRuntimePatterns) {
      assert(!pattern.test(source), `${file} ${failure}`);
    }
  }

  mkdirSync(consumerRoot, { recursive: true });
  writeFileSync(
    join(consumerRoot, 'package.json'),
    JSON.stringify({ name: 'n8n-pack-consumer', private: true }, null, 2),
  );
  execFileSync(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--legacy-peer-deps',
      '--offline',
      tarball,
    ],
    {
      cwd: consumerRoot,
      stdio: 'pipe',
      env: {
        ...process.env,
        npm_config_cache: join(temporaryRoot, 'npm-cache'),
      },
    },
  );

  const hostModule = resolve(packageRoot, 'node_modules/n8n-workflow');
  assert(existsSync(hostModule), 'Local n8n-workflow host module is missing');
  const consumerModules = join(consumerRoot, 'node_modules');
  mkdirSync(consumerModules, { recursive: true });
  const consumerHost = join(consumerModules, 'n8n-workflow');
  if (!existsSync(consumerHost)) symlinkSync(hostModule, consumerHost, 'dir');

  const installedRoot = join(consumerModules, '@themoltnet/n8n-nodes-moltnet');
  execFileSync(
    process.execPath,
    [
      '-e',
      [
        `const agentCredentials = require(${JSON.stringify(join(installedRoot, requiredFiles[0]))});`,
        `const oauthCredentials = require(${JSON.stringify(join(installedRoot, requiredFiles[1]))});`,
        `const node = require(${JSON.stringify(join(installedRoot, requiredFiles[2]))});`,
        "if (typeof agentCredentials.MoltNetAgentApi !== 'function') process.exit(2);",
        "if (typeof oauthCredentials.MoltNetOAuth2Api !== 'function') process.exit(3);",
        "if (typeof node.MoltNet !== 'function') process.exit(4);",
      ].join('\n'),
    ],
    { cwd: consumerRoot, stdio: 'inherit' },
  );

  console.log(
    `Validated ${manifest.name}@${manifest.version} tarball and CommonJS entries`,
  );
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
