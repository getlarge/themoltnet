import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import console from 'node:console';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const userFolder = resolve(tmpdir(), 'moltnet-n8n-nodes-dev');
const runtimeFolder = resolve(userFolder, 'runtime');
const nodeModulesFolder = resolve(userFolder, '.n8n/custom/node_modules');
const packageLink = resolve(nodeModulesFolder, '@themoltnet/n8n-nodes-moltnet');
const localWorkflowPath = resolve(userFolder, 'create-and-wait.workflow.json');
const n8nBinary = resolve(
  runtimeFolder,
  'node_modules/.bin',
  process.platform === 'win32' ? 'n8n.cmd' : 'n8n',
);

function runBuild() {
  const result = spawnSync('pnpm', ['exec', 'vite', 'build'], {
    cwd: packageRoot,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function linkPackage() {
  mkdirSync(dirname(packageLink), { recursive: true });

  // existsSync() follows symlinks, so it returns false for a link left behind
  // by a removed worktree. lstatSync() still sees that directory entry.
  const existingLink = lstatSync(packageLink, { throwIfNoEntry: false });
  if (existingLink) {
    if (!existingLink.isSymbolicLink()) {
      throw new Error(
        `Refusing to replace non-symlink development path: ${packageLink}`,
      );
    }
    unlinkSync(packageLink);
  }

  symlinkSync(packageRoot, packageLink, 'dir');
}

function ensureN8nRuntime() {
  mkdirSync(runtimeFolder, { recursive: true });
  writeFileSync(
    resolve(runtimeFolder, 'package.json'),
    JSON.stringify(
      {
        name: 'moltnet-n8n-development-runtime',
        private: true,
        dependencies: {
          n8n: 'latest',
          sqlite3: 'latest',
        },
        // npm 12 blocks dependency install scripts by default. n8n's local
        // SQLite driver needs this single native install to run the editor.
        allowScripts: {
          sqlite3: true,
        },
      },
      null,
      2,
    ),
  );

  if (existsSync(n8nBinary)) return;

  console.log('Installing the isolated n8n development runtime...');
  const result = spawnSync('npm', ['install', '--no-audit', '--no-fund'], {
    cwd: runtimeFolder,
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function writeLocalWorkflow() {
  const workflow = JSON.parse(
    readFileSync(
      resolve(packageRoot, 'examples/create-and-wait.workflow.json'),
      'utf8',
    ),
  );
  for (const node of workflow.nodes ?? []) {
    if (node.type === '@themoltnet/n8n-nodes-moltnet.moltNet') {
      node.type = 'CUSTOM.moltNet';
    }
  }
  writeFileSync(localWorkflowPath, JSON.stringify(workflow, null, 2));
}

runBuild();
linkPackage();
ensureN8nRuntime();
writeLocalWorkflow();

const children = [
  spawn('pnpm', ['exec', 'vite', 'build', '--watch'], {
    cwd: packageRoot,
    stdio: 'inherit',
  }),
  spawn(n8nBinary, [], {
    cwd: runtimeFolder,
    stdio: 'inherit',
    env: {
      ...process.env,
      DB_SQLITE_POOL_SIZE: '10',
      N8N_DEV_RELOAD: 'true',
      // This isolated editor is intentionally served over local HTTP. Keep the
      // override scoped to this development child; production n8n should use
      // secure cookies behind HTTPS.
      N8N_SECURE_COOKIE: 'false',
      N8N_USER_FOLDER: userFolder,
    },
  }),
];

let stopping = false;

function stop(signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => stop(signal));
}

for (const child of children) {
  child.on('error', (error) => {
    console.error(error);
    stop();
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    if (!stopping && code !== 0) {
      console.error(
        `Development child exited (${signal ?? `status ${String(code)}`})`,
      );
      process.exitCode = code ?? 1;
      stop();
    }
  });
}

console.log('MoltNet n8n development editor: http://localhost:5678');
console.log(`Local importable workflow: ${localWorkflowPath}`);
