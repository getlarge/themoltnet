/**
 * Snapshot builder with auto-build and caching.
 *
 * On first run (or when the recipe changes), builds a Gondolin VM snapshot
 * with the full dev toolchain. Caches in a platform-appropriate directory:
 *   - macOS: ~/Library/Caches/moltnet/gondolin/
 *   - Linux: ~/.cache/moltnet/gondolin/
 *
 * The cache key is a hash of the recipe (Node version, packages, Alpine base).
 * When any input changes, a new snapshot is built automatically.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

import {
  createHttpHooks,
  ensureImageSelector,
  loadGuestAssets,
  VM,
} from '@earendil-works/gondolin';

export interface SnapshotRecipe {
  nodeVersion: string;
  packages: string[];
  alpinePackages: string[];
  overlaySize: string;
}

const DEFAULT_RECIPE: SnapshotRecipe = {
  nodeVersion: '22.22.2',
  packages: [
    '@mariozechner/pi-coding-agent',
    '@mariozechner/pi-ai',
    '@themoltnet/sdk',
  ],
  alpinePackages: [
    'ca-certificates',
    'curl',
    'git',
    'jq',
    'libgcc',
    'libstdc++',
    'python3',
    'tar',
    'xz',
  ],
  overlaySize: '3G',
};

const SETUP_ALLOWED_HOSTS = [
  'dl-cdn.alpinelinux.org',
  '*.alpinelinux.org',
  'registry.npmjs.org',
  '*.npmjs.org',
  'nodejs.org',
  '*.nodejs.org',
  'unofficial-builds.nodejs.org',
  'github.com',
  '*.github.com',
  '*.githubusercontent.com',
  'objects.githubusercontent.com',
];

function getCacheDir(): string {
  if (process.platform === 'darwin') {
    return path.join(
      process.env.HOME ?? '/tmp',
      'Library',
      'Caches',
      'moltnet',
      'gondolin',
    );
  }
  const xdgCache = process.env.XDG_CACHE_HOME;
  const base = xdgCache ?? path.join(process.env.HOME ?? '/tmp', '.cache');
  return path.join(base, 'moltnet', 'gondolin');
}

function computeRecipeHash(recipe: SnapshotRecipe): string {
  const h = createHash('sha256');
  h.update(JSON.stringify(recipe));
  return h.digest('hex').slice(0, 12);
}

function getSnapshotPath(recipe: SnapshotRecipe): string {
  const hash = computeRecipeHash(recipe);
  const dir = path.join(getCacheDir(), `v1-${hash}`);
  return path.join(dir, 'pi-agent.qcow2');
}

export interface EnsureSnapshotOptions {
  recipe?: SnapshotRecipe;
  onProgress?: (message: string) => void;
  /** Max number of old snapshots to keep (default 1). */
  maxCached?: number;
}

/**
 * Ensure a cached snapshot exists, building one if needed.
 * Returns the absolute path to the qcow2 checkpoint file.
 */
export async function ensureSnapshot(
  options: EnsureSnapshotOptions = {},
): Promise<string> {
  const recipe = options.recipe ?? DEFAULT_RECIPE;
  const log = options.onProgress ?? (() => {});
  const maxCached = options.maxCached ?? 1;

  const snapshotPath = getSnapshotPath(recipe);
  const snapshotDir = path.dirname(snapshotPath);

  if (existsSync(snapshotPath)) {
    log(`snapshot cache hit: ${snapshotPath}`);
    return snapshotPath;
  }

  log('snapshot cache miss — building (this takes 1-3 minutes)...');

  mkdirSync(snapshotDir, { recursive: true });
  const overlayPath = path.join(snapshotDir, 'build.overlay.qcow2');

  // Clean up any stale build artifacts
  if (existsSync(overlayPath)) rmSync(overlayPath);
  if (existsSync(snapshotPath)) rmSync(snapshotPath);

  // Resolve alpine-base image
  log('resolving alpine-base image...');
  const resolvedImage = await ensureImageSelector('alpine-base');
  const assets = loadGuestAssets(resolvedImage.assetDir);

  // Create qcow2 overlay backed by rootfs
  log(`creating qcow2 overlay (${recipe.overlaySize})...`);
  execFileSync(
    'qemu-img',
    [
      'create',
      '-f',
      'qcow2',
      '-F',
      'raw',
      '-b',
      assets.rootfsPath,
      overlayPath,
      recipe.overlaySize,
    ],
    { stdio: 'pipe' },
  );

  const { httpHooks } = createHttpHooks({ allowedHosts: SETUP_ALLOWED_HOSTS });

  log('booting VM for setup...');
  const vm = await VM.create({
    httpHooks,
    env: {
      PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    },
    sandbox: {
      rootDiskPath: overlayPath,
      rootDiskFormat: 'qcow2',
      rootDiskReadOnly: false,
      rootDiskDeleteOnClose: false,
    },
  });

  try {
    await buildSnapshot(vm, recipe, log);
    log('creating checkpoint...');
    await vm.checkpoint(snapshotPath);
    log(`snapshot saved: ${snapshotPath}`);
  } finally {
    try {
      await vm.close();
    } catch {
      // may already be closed by checkpoint
    }
    if (existsSync(overlayPath)) rmSync(overlayPath, { force: true });
  }

  // Prune old snapshots
  pruneOldSnapshots(maxCached, snapshotDir);

  return snapshotPath;
}

async function buildSnapshot(
  vm: VM,
  recipe: SnapshotRecipe,
  log: (msg: string) => void,
): Promise<void> {
  async function run(label: string, cmd: string): Promise<void> {
    log(label);
    const r = await vm.exec(cmd);
    if (r.exitCode !== 0) {
      const output = [r.stderr, r.stdout]
        .filter(Boolean)
        .join('\n')
        .slice(0, 800);
      throw new Error(
        `snapshot build "${label}" failed (exit ${r.exitCode}):\n${output}`,
      );
    }
  }

  // Resize filesystem to fill overlay
  await run(
    'resizing rootfs...',
    'apk add --no-cache e2fsprogs-extra >/dev/null 2>&1 && resize2fs /dev/vda 2>/dev/null',
  );

  // Install Alpine packages from main repo
  const alpinePkgs = recipe.alpinePackages.join(' ');
  await run(
    `installing Alpine packages: ${alpinePkgs}`,
    `apk add --no-cache ${alpinePkgs}`,
  );

  // Install gh CLI from GitHub releases (not in Alpine main repo)
  const ghVersion = '2.74.0';
  await run(
    `installing gh ${ghVersion}...`,
    `sh -eu -c '
      curl -fsSL "https://github.com/cli/cli/releases/download/v${ghVersion}/gh_${ghVersion}_linux_arm64.tar.gz" -o /tmp/gh.tar.gz
      tar -xzf /tmp/gh.tar.gz -C /tmp
      mv /tmp/gh_${ghVersion}_linux_arm64/bin/gh /usr/local/bin/gh
      chmod +x /usr/local/bin/gh
      rm -rf /tmp/gh.tar.gz /tmp/gh_${ghVersion}_linux_arm64
      gh --version
    '`,
  );

  // Install Node.js from unofficial-builds (Alpine's npm 11.x is broken)
  await run(
    `installing Node ${recipe.nodeVersion} (unofficial-builds arm64-musl)...`,
    `sh -eu -c '
      curl -fsSL "https://unofficial-builds.nodejs.org/download/release/v${recipe.nodeVersion}/node-v${recipe.nodeVersion}-linux-arm64-musl.tar.xz" -o /tmp/node.tar.xz
      tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1
      rm /tmp/node.tar.xz
      node --version
    '`,
  );

  // Install pnpm + tsx globally
  await run('installing pnpm + tsx...', 'npm install -g pnpm tsx 2>/dev/null');

  // Create workspace with project packages
  const npmPkgs = recipe.packages.join(' ');
  await run(
    `installing workspace packages: ${npmPkgs}`,
    `sh -eu -c '
      mkdir -p /workspace
      cd /workspace
      echo '"'"'{"type":"module"}'"'"' > package.json
      npm install ${npmPkgs} 2>/dev/null
    '`,
  );

  // Create agent user
  await run(
    'creating agent user...',
    `sh -eu -c '
      addgroup -g 501 agent 2>/dev/null || true
      adduser -D -u 501 -G agent -h /home/agent -s /bin/sh agent 2>/dev/null || true
      mkdir -p /home/agent/.pi/agent /home/agent/.moltnet /home/agent/.cache
      chown -R agent:agent /home/agent /workspace
      chmod 644 /etc/gondolin/mitm/ca.crt 2>/dev/null || true
    '`,
  );
}

function pruneOldSnapshots(maxCached: number, currentDir: string): void {
  const cacheRoot = getCacheDir();
  if (!existsSync(cacheRoot)) return;

  const entries = readdirSync(cacheRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('v1-'))
    .map((e) => {
      const fullPath = path.join(cacheRoot, e.name);
      const stat = statSync(fullPath);
      return { path: fullPath, mtime: stat.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);

  // Keep maxCached + the current one
  for (const entry of entries.slice(maxCached + 1)) {
    if (entry.path !== currentDir) {
      rmSync(entry.path, { recursive: true, force: true });
    }
  }
}
