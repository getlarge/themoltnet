/**
 * Snapshot builder with auto-build and caching.
 *
 * Builds a Gondolin VM snapshot in two layers:
 *   1. Base (always): Alpine essentials, git, gh CLI, MoltNet CLI, agent user
 *   2. User setup commands (optional): arbitrary shell commands on top of the base
 *
 * Consumers provide raw shell commands — no abstraction over package managers
 * or runtimes. The base provides curl, git, tar, jq; everything else is up to
 * the setup commands.
 *
 * Caches in a platform-appropriate directory:
 *   - macOS: ~/Library/Caches/moltnet/gondolin/
 *   - Linux: ~/.cache/moltnet/gondolin/
 *
 * The cache key is a hash of the full config. When any input changes,
 * a new snapshot is built automatically.
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

// ---------------------------------------------------------------------------
// Sandbox config (loaded from sandbox.json or --sandbox-config flag)
// ---------------------------------------------------------------------------

export interface SandboxConfig {
  /** Snapshot build settings. */
  snapshot?: {
    /** Shell commands to run after the base setup. */
    setupCommands?: string[];
    /** Additional hosts to allow network access during build. */
    allowedHosts?: string[];
    /** Overlay disk size (default '3G'). */
    overlaySize?: string;
  };
  /** VFS shadow settings — hide host paths from the guest. */
  vfs?: {
    /** Paths (relative to workspace root) to shadow from the host mount. */
    shadow?: string[];
    /** What to do with writes to shadowed paths: 'deny' or 'tmpfs' (default 'tmpfs'). */
    shadowMode?: 'deny' | 'tmpfs';
  };
  /** Environment variable overrides for the guest VM (applied on top of defaults). */
  env?: Record<string, string>;
}

/** Extract snapshot-specific config for backwards compat with ensureSnapshot. */
export type SnapshotConfig = NonNullable<SandboxConfig['snapshot']>;

// ---------------------------------------------------------------------------
// Base constants (always installed)
// ---------------------------------------------------------------------------

/** Alpine packages required by every snapshot. */
const BASE_ALPINE_PACKAGES = [
  'ca-certificates',
  'curl',
  'git',
  'jq',
  'ripgrep',
  'tar',
  'xz',
];

/** gh CLI version installed in every snapshot. */
const GH_VERSION = '2.74.0';

/** MoltNet CLI version — downloaded as a binary, no Node needed. */
const MOLTNET_CLI_VERSION = '1.28.0';

/** Hosts reachable during snapshot build. */
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

// ---------------------------------------------------------------------------
// Default config (base only — no extra setup)
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: SnapshotConfig = {};

// ---------------------------------------------------------------------------
// Cache management
// ---------------------------------------------------------------------------

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

function computeConfigHash(config: SnapshotConfig): string {
  const h = createHash('sha256');
  // Include base constants so hash changes if we bump gh/cli versions
  h.update(
    JSON.stringify({
      baseAlpine: BASE_ALPINE_PACKAGES,
      ghVersion: GH_VERSION,
      cliVersion: MOLTNET_CLI_VERSION,
      config,
    }),
  );
  return h.digest('hex').slice(0, 12);
}

function getSnapshotPath(config: SnapshotConfig): string {
  const hash = computeConfigHash(config);
  const dir = path.join(getCacheDir(), `v2-${hash}`);
  return path.join(dir, 'snapshot.qcow2');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface EnsureSnapshotOptions {
  config?: SnapshotConfig;
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
  const config = options.config ?? DEFAULT_CONFIG;
  const log = options.onProgress ?? (() => {});
  const maxCached = options.maxCached ?? 1;

  const snapshotPath = getSnapshotPath(config);
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
  const overlaySize = config.overlaySize ?? '3G';
  log(`creating qcow2 overlay (${overlaySize})...`);
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
      overlaySize,
    ],
    { stdio: 'pipe' },
  );

  const allAllowedHosts = [
    ...SETUP_ALLOWED_HOSTS,
    ...(config.allowedHosts ?? []),
  ];
  const { httpHooks } = createHttpHooks({ allowedHosts: allAllowedHosts });

  log('booting VM for setup...');
  const vm = await VM.create({
    httpHooks,
    env: {
      PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/lib/go/bin',
      HOME: '/root',
      GOROOT: '/usr/lib/go',
      GOPATH: '/root/go',
    },
    sandbox: {
      rootDiskPath: overlayPath,
      rootDiskFormat: 'qcow2',
      rootDiskReadOnly: false,
      rootDiskDeleteOnClose: false,
    },
  });

  try {
    await buildSnapshot(vm, config, log);
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

// ---------------------------------------------------------------------------
// Build phases
// ---------------------------------------------------------------------------

/** Helper: run a command in the VM, throw on failure. */
async function run(
  vm: VM,
  log: (msg: string) => void,
  label: string,
  cmd: string,
): Promise<void> {
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

async function buildSnapshot(
  vm: VM,
  config: SnapshotConfig,
  log: (msg: string) => void,
): Promise<void> {
  // ── Base layer (always) ─────────────────────────────────────────────

  // Resize filesystem to fill overlay
  await run(
    vm,
    log,
    'resizing rootfs...',
    'apk add --no-cache e2fsprogs-extra >/dev/null 2>&1 && resize2fs /dev/vda 2>/dev/null',
  );

  // Install base Alpine packages
  await run(
    vm,
    log,
    `installing base packages: ${BASE_ALPINE_PACKAGES.join(' ')}`,
    `apk add --no-cache ${BASE_ALPINE_PACKAGES.join(' ')}`,
  );

  // Install gh CLI from GitHub releases
  await run(
    vm,
    log,
    `installing gh ${GH_VERSION}...`,
    `sh -eu -c '
      curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_arm64.tar.gz" -o /tmp/gh.tar.gz
      tar -xzf /tmp/gh.tar.gz -C /tmp
      mv /tmp/gh_${GH_VERSION}_linux_arm64/bin/gh /usr/local/bin/gh
      chmod +x /usr/local/bin/gh
      rm -rf /tmp/gh.tar.gz /tmp/gh_${GH_VERSION}_linux_arm64
      gh --version
    '`,
  );

  // Install MoltNet CLI binary directly from npm registry (no Node required)
  await run(
    vm,
    log,
    `installing moltnet CLI ${MOLTNET_CLI_VERSION}...`,
    `sh -eu -c '
      curl -fsSL "https://registry.npmjs.org/@themoltnet/cli-linux-arm64/-/cli-linux-arm64-${MOLTNET_CLI_VERSION}.tgz" -o /tmp/moltnet.tgz
      tar -xzf /tmp/moltnet.tgz -C /tmp
      mv /tmp/package/bin/moltnet /usr/local/bin/moltnet
      chmod +x /usr/local/bin/moltnet
      rm -rf /tmp/moltnet.tgz /tmp/package
    '`,
  );

  // Create agent user and workspace
  await run(
    vm,
    log,
    'creating agent user...',
    `sh -eu -c '
      addgroup -g 501 agent 2>/dev/null || true
      adduser -D -u 501 -G agent -h /home/agent -s /bin/sh agent 2>/dev/null || true
      mkdir -p /home/agent/.moltnet /home/agent/.cache /workspace
      chown -R agent:agent /home/agent /workspace
      chmod 644 /etc/gondolin/mitm/ca.crt 2>/dev/null || true
    '`,
  );

  // ── User setup commands (optional) ─────────────────────────────────

  if (config.setupCommands?.length) {
    for (let i = 0; i < config.setupCommands.length; i++) {
      await run(
        vm,
        log,
        `setup [${i + 1}/${config.setupCommands.length}]...`,
        config.setupCommands[i],
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Pruning
// ---------------------------------------------------------------------------

function pruneOldSnapshots(maxCached: number, currentDir: string): void {
  const cacheRoot = getCacheDir();
  if (!existsSync(cacheRoot)) return;

  const entries = readdirSync(cacheRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('v'))
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
