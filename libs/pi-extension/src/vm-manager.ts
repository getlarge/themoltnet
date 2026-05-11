import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';

import type { VM } from '@earendil-works/gondolin';
import {
  createHttpHooks,
  createShadowPathPredicate,
  MemoryProvider,
  RealFSProvider,
  ShadowProvider,
  VmCheckpoint,
} from '@earendil-works/gondolin';

const GUEST_WORKSPACE = '/workspace';
/**
 * Memory-backed VFS mount used by the daemon to inject task-context
 * skills (#943 slice 1.5). Sibling of /workspace, NOT a sub-path —
 * Gondolin mounts can't nest. The agent's Gondolin-bound Read tool
 * accepts paths under this prefix (see toGuestPath in tool-operations.ts).
 *
 * Why MemoryProvider rather than a path under /workspace:
 *   - Injected skills are ephemeral by intent: per-task-attempt input
 *     scoped to the VM lifetime. MemoryProvider models that exactly —
 *     in-memory, per-VM-instance, zero host artefacts, automatic
 *     cleanup on VM close.
 *   - Writing under /workspace fails in worktrees because we symlink
 *     `.moltnet/` to the main repo (so credentials are reachable from
 *     worktrees), and Gondolin's RealFSProvider correctly refuses to
 *     create paths whose ancestors' realpath escapes the mount root.
 *     That refusal is a deliberate sandbox-escape protection, not a
 *     bug. See diary semantic entry cd27d9d3-efdc-4aec-ac0d-5fd8ce258d1f
 *     and episodic 7affbfeb-18a2-4963-aeac-c177eb2afa2d for the full
 *     investigation and the alternatives we rejected.
 */
export const GUEST_TASK_SKILLS_MOUNT = '/moltnet-task-skills';

import type { SandboxConfig } from './snapshot.js';

export interface VmConfig {
  /** Absolute path to the qcow2 checkpoint. */
  checkpointPath: string;
  /** MoltNet agent name (used to resolve credentials). */
  agentName: string;
  /** Host directory to mount at /workspace in the VM. */
  mountPath: string;
  /** Additional hosts to allow in egress policy. */
  extraAllowedHosts?: string[];
  /** Full sandbox config (vfs shadows, env overrides). */
  sandboxConfig?: SandboxConfig;
}

export interface VmCredentials {
  moltnetJson: string;
  agentEnvRaw: string;
  /**
   * Pi OAuth/API-key auth blob. Null when neither `~/.pi/agent/auth.json`
   * (or its `PI_AUTH_PATH` override) is present — in that case the daemon
   * relies on Pi's env-var providers (`ANTHROPIC_API_KEY`, etc.) carried
   * via `agentEnv` and the host environment instead. CI uses this path.
   */
  piAuthJson: string | null;
  agentEnv: Record<string, string | undefined>;
  gitconfig: string | null;
  sshPrivateKey: string | null;
  sshPublicKey: string | null;
  allowedSigners: string | null;
  /** Raw PEM content of the GitHub App private key, or null if not configured. */
  githubAppPem: string | null;
  /** VM-local filename for the GitHub App PEM (basename of host path), or null. */
  githubAppPemFilename: string | null;
}

export interface ManagedVm {
  vm: VM;
  credentials: VmCredentials;
  mountPath: string;
  guestWorkspace: string;
  agentDir: string;
}

/**
 * Resolve the main worktree root (where .moltnet/ lives — it's untracked,
 * only exists in the main worktree, not in git worktrees).
 */
export function findMainWorktree(): string {
  const output = execFileSync('git', ['worktree', 'list', '--porcelain'], {
    encoding: 'utf8',
  });
  for (const block of output.split('\n\n')) {
    const lines = block.split('\n');
    const wt = lines.find((l) => l.startsWith('worktree '));
    if (wt && !lines.some((l) => l === 'bare'))
      return wt.replace('worktree ', '');
  }
  throw new Error('Could not find main git worktree');
}

export function loadCredentials(agentDir: string): VmCredentials {
  const moltnetJson = readFileSync(path.join(agentDir, 'moltnet.json'), 'utf8');
  const agentEnvRaw = readFileSync(path.join(agentDir, 'env'), 'utf8');

  // Pi auth resolution: explicit PI_AUTH_PATH override wins, else default
  // `~/.pi/agent/auth.json`. When neither exists we leave piAuthJson null;
  // pi-headless then resolves provider creds from env vars
  // (ANTHROPIC_API_KEY, OPENAI_API_KEY, …) at runtime. This is the path
  // CI uses — the daemon never materialises an auth.json there.
  const piAuthPath =
    process.env.PI_AUTH_PATH ??
    path.join(process.env.HOME ?? '', '.pi', 'agent', 'auth.json');
  const piAuthJson = existsSync(piAuthPath)
    ? readFileSync(piAuthPath, 'utf8')
    : null;

  // Read gitconfig + SSH keys for VM-side git signing
  const gitconfigPath = path.join(agentDir, 'gitconfig');
  const gitconfig = existsSync(gitconfigPath)
    ? readFileSync(gitconfigPath, 'utf8')
    : null;

  const sshDir = path.join(agentDir, 'ssh');
  const sshPrivateKey = existsSync(path.join(sshDir, 'id_ed25519'))
    ? readFileSync(path.join(sshDir, 'id_ed25519'), 'utf8')
    : null;
  const sshPublicKey = existsSync(path.join(sshDir, 'id_ed25519.pub'))
    ? readFileSync(path.join(sshDir, 'id_ed25519.pub'), 'utf8')
    : null;
  const allowedSigners = existsSync(path.join(sshDir, 'allowed_signers'))
    ? readFileSync(path.join(sshDir, 'allowed_signers'), 'utf8')
    : null;

  // Read GitHub App PEM if configured in moltnet.json.
  // The path is host-absolute and must be rewritten to a VM-local path before
  // injecting the JSON into the guest — done in resumeVm.
  let githubAppPem: string | null = null;
  let githubAppPemFilename: string | null = null;
  const moltnetConfigParsed = JSON.parse(moltnetJson) as {
    github?: { private_key_path?: string };
  };
  const pemPath = moltnetConfigParsed.github?.private_key_path;
  if (pemPath) {
    if (!existsSync(pemPath)) {
      process.stderr.write(
        `[pi-extension] Warning: github.private_key_path not found at ${pemPath} — ` +
          'moltnet github token will fail inside the guest\n',
      );
    } else {
      githubAppPem = readFileSync(pemPath, 'utf8');
      githubAppPemFilename = path.basename(pemPath);
    }
  }

  return {
    moltnetJson,
    agentEnvRaw,
    piAuthJson,
    agentEnv: parseEnv(agentEnvRaw),
    gitconfig,
    sshPrivateKey,
    sshPublicKey,
    allowedSigners,
    githubAppPem,
    githubAppPemFilename,
  };
}

/**
 * Apply agent env vars to the host process, mirroring `moltnet start`.
 * Resolves relative paths (e.g. GIT_CONFIG_GLOBAL) against the repo root.
 */
export function activateAgentEnv(
  agentEnv: Record<string, string | undefined>,
  repoRoot: string,
): void {
  for (const [k, v] of Object.entries(agentEnv)) {
    if (v === undefined || v === null || v === '') continue;

    let resolved = v;
    // Resolve relative GIT_CONFIG_GLOBAL against repo root (same as Go CLI)
    if (k === 'GIT_CONFIG_GLOBAL' && !path.isAbsolute(v)) {
      resolved = path.join(repoRoot, v);
    }

    process.env[k] = resolved;
  }
}

const BASE_ALLOWED_HOSTS = [
  'api.openai.com',
  '*.openai.com',
  'chat.openai.com',
  'chatgpt.com',
  '*.chatgpt.com',
  'registry.npmjs.org',
  'github.com',
  '*.github.com',
  '*.githubusercontent.com',
  // Go module proxy + storage backend
  'proxy.golang.org',
  'sum.golang.org',
  'golang.org',
  'storage.googleapis.com',
  '*.googlesource.com',
];

/**
 * Run a shell command in the guest and throw if it fails. Mirror of
 * `run()` in `snapshot.ts` for the resume-side hook chain — every
 * setup step is essential to a healthy session, so a silent non-zero
 * exit (e.g. a mount that fails into the FUSE write path, or a
 * consumer-provided resume command that fails to install pnpm) must
 * surface immediately rather than fall through to cryptic agent
 * errors later.
 */
async function vmRun(vm: VM, label: string, command: string): Promise<void> {
  // Wrap with `set -o pipefail` inside the script (not on the sh command
  // line, which busybox ash on Alpine doesn't accept as a flag). This
  // ensures pipelines like `foo | tail` propagate foo's non-zero exit
  // instead of masking it behind tail's success.
  const wrapped = `set -eu\nset -o pipefail\n${command}`;
  const r = await vm.exec(['sh', '-c', wrapped]);
  if (r.exitCode !== 0) {
    const tail = [r.stderr, r.stdout].filter(Boolean).join('\n').slice(-800);
    throw new Error(
      `resume step "${label}" failed (exit ${r.exitCode}):\n${tail}`,
    );
  }
}

/**
 * Resume a VM from a checkpoint, inject credentials, configure egress +
 * TLS. Returns the managed VM handle.
 */
export async function resumeVm(config: VmConfig): Promise<ManagedVm> {
  const mainRepo = findMainWorktree();
  const agentDir = path.join(mainRepo, '.moltnet', config.agentName);

  if (!existsSync(agentDir)) {
    throw new Error(
      `Agent directory not found: ${agentDir}. Run: moltnet register --name ${config.agentName}`,
    );
  }

  const creds = loadCredentials(agentDir);
  const moltnetConfig = JSON.parse(creds.moltnetJson);
  const apiHost = new URL(moltnetConfig.endpoints.api).hostname;

  const allowedHosts = [
    ...BASE_ALLOWED_HOSTS,
    apiHost,
    ...(config.extraAllowedHosts ?? []),
  ];

  const { httpHooks, env: secretEnv } = createHttpHooks({ allowedHosts });

  // Build VM-side agent env vars from credentials.
  // GIT_CONFIG_GLOBAL must point to the VM-side path, not host-side.
  const vmAgentDir = `/home/agent/.moltnet/${config.agentName}`;
  const vmAgentEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(creds.agentEnv)) {
    if (v === undefined || v === '') continue;
    if (k === 'GIT_CONFIG_GLOBAL') {
      // Remap to VM-side credentials path
      vmAgentEnv[k] = `${vmAgentDir}/gitconfig`;
    } else if (k.endsWith('_PRIVATE_KEY_PATH')) {
      // Remap key paths to VM-side
      vmAgentEnv[k] = `${vmAgentDir}/${path.basename(v)}`;
    } else {
      vmAgentEnv[k] = v;
    }
  }
  // Pin MOLTNET_CREDENTIALS_PATH to the VM-side moltnet.json so that
  // `moltnet github token` (and other subcommands) find the right agent
  // without auto-discovery ambiguity (workspace mount exposes multiple
  // .moltnet/<agent>/ dirs that confuse auto-discovery).
  vmAgentEnv.MOLTNET_CREDENTIALS_PATH = `${vmAgentDir}/moltnet.json`;

  // Build workspace VFS provider (with optional shadows)
  const vfsConfig = config.sandboxConfig?.vfs;
  let workspaceProvider: RealFSProvider | ShadowProvider = new RealFSProvider(
    config.mountPath,
  );
  if (vfsConfig?.shadow?.length) {
    const predicate = createShadowPathPredicate(vfsConfig.shadow);
    workspaceProvider = new ShadowProvider(workspaceProvider, {
      shouldShadow: predicate,
      writeMode: vfsConfig.shadowMode ?? 'tmpfs',
    });
  }

  // Merge env: defaults < sandbox config overrides
  const envOverrides = config.sandboxConfig?.env ?? {};
  const vmEnv = {
    ...secretEnv,
    ...vmAgentEnv,
    PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/lib/go/bin',
    HOME: '/home/agent',
    NODE_NO_WARNINGS: '1',
    NODE_EXTRA_CA_CERTS: '/etc/ssl/certs/ca-certificates.crt',
    ...envOverrides,
  };

  const resources = config.sandboxConfig?.resources;
  const cp = VmCheckpoint.load(config.checkpointPath);
  const vm = await cp.resume({
    httpHooks,
    env: vmEnv,
    ...(resources?.memory && { memory: resources.memory }),
    ...(resources?.cpus && { cpus: resources.cpus }),
    vfs: {
      mounts: {
        [GUEST_WORKSPACE]: workspaceProvider,
        // Memory-backed mount for task-context skill injection (#943).
        // Per-VM-instance, never persisted, never shared.
        [GUEST_TASK_SKILLS_MOUNT]: new MemoryProvider(),
      },
    },
  });

  // Fix TLS: append Gondolin MITM CA to system trust store.
  // Unofficial-builds Node ships its own OpenSSL which can't load
  // NODE_EXTRA_CA_CERTS from /etc/gondolin/mitm/ca.crt (error 8000000D).
  await vm.exec(`sh -c '
    cp /etc/gondolin/mitm/ca.crt /usr/local/share/ca-certificates/gondolin-mitm.crt
    update-ca-certificates 2>/dev/null
    cat /etc/gondolin/mitm/ca.crt >> /etc/ssl/certs/ca-certificates.crt
  '`);

  // Fix DNS: ensure working resolvers (VM gateway DNS may not forward correctly)
  await vm.exec(`sh -c 'echo "nameserver 8.8.8.8
nameserver 1.1.1.1" > /etc/resolv.conf'`);

  // Tell git that the workspace mount is trusted regardless of UID. The host
  // workspace is bind-mounted into /workspace via Gondolin's RealFSProvider,
  // so the on-disk owner is the host's UID (typically 501) — not the guest's
  // 'agent' user (also UID 501 by happy coincidence, but git checks against
  // file ownership at the filesystem level). Without this, every git command
  // inside the VM emits 'detected dubious ownership' and exits 128. Setting
  // this system-wide rather than per-user covers both root (post-resume
  // setup) and agent (task workload) callers.
  await vmRun(
    vm,
    'git safe.directory',
    `git config --system --add safe.directory '*'`,
  );

  // Overlay-mount a guest-kernel tmpfs at /workspace/node_modules so package
  // installs (pnpm/npm) bypass the Gondolin FUSE bridge entirely. Without
  // this, every file write during install traverses guest-FUSE →
  // virtio-RPC → host RealFSProvider, costing ~80× more wall-clock than a
  // plain Linux mount (diary 47b67636: 240s vs 3s for identical pnpm
  // install). The kernel resolves mount points before FUSE, so writes to
  // /workspace/node_modules/... never reach sandboxfs or the host. Side
  // effect: the host worktree's existing node_modules (if any) is fully
  // hidden by the mount and remains untouched — no host pollution. tmpfs
  // is per-VM: install is discarded on VM exit; the pnpm content store
  // is the persistence point (configured separately by the consumer via
  // sandbox.json env / resumeCommands). A silent mount failure would
  // route writes through the FUSE bridge — the exact problem this fix
  // exists to solve — so vmRun fails loudly if the mount doesn't take.
  await vmRun(
    vm,
    'tmpfs /workspace/node_modules',
    `mkdir -p /workspace/node_modules && mount -t tmpfs -o size=4G,mode=0755,uid=501,gid=501 tmpfs /workspace/node_modules`,
  );

  // Consumer-provided per-resume commands. Repo-specific bootstrap
  // (corepack-install a pinned pnpm, `pnpm fetch`, etc.) belongs here,
  // not in vm-manager — pi-extension stays repo-agnostic. Sequential,
  // first failure aborts resume via vmRun.
  for (const [i, cmd] of (
    config.sandboxConfig?.resumeCommands ?? []
  ).entries()) {
    await vmRun(vm, `resumeCommands[${i}]`, cmd);
  }

  // Inject credentials into VM-side agent directory structure:
  //   /home/agent/.moltnet/<agentName>/{moltnet.json,env,gitconfig,ssh/}
  // Mirrors host layout so legreffier skill and CLI work identically.
  const vmSshDir = `${vmAgentDir}/ssh`;
  await vm.exec(`mkdir -p ${vmAgentDir}/ssh /home/agent/.pi/agent`);

  if (creds.piAuthJson !== null) {
    await vm.fs.writeFile('/home/agent/.pi/agent/auth.json', creds.piAuthJson, {
      mode: 0o600,
    });
  }
  // else: rely on env-var provider auth (ANTHROPIC_API_KEY, …) carried via
  // agentEnv and the host environment.

  // Rewrite moltnet.json with VM-local paths before injecting into the guest.
  // The host-absolute paths (ssh private_key_path, github private_key_path)
  // are invalid inside the VM — replace them with paths under vmAgentDir.
  const vmMoltnetJson = rewriteMoltnetJsonPaths(
    creds.moltnetJson,
    vmAgentDir,
    vmSshDir,
    creds.githubAppPemFilename,
  );
  await vm.fs.writeFile(`${vmAgentDir}/moltnet.json`, vmMoltnetJson, {
    mode: 0o600,
  });

  await vm.fs.writeFile(`${vmAgentDir}/env`, creds.agentEnvRaw, {
    mode: 0o600,
  });

  // Inject gitconfig with VM-side signing key path and relative worktree
  // paths. `worktree.useRelativePaths = true` (git >= 2.48) makes
  // `git worktree add` write relative pointers — the only form that is
  // simultaneously valid inside the VM (where the mount appears at
  // `/workspace`) and on the host (where it appears at the real mount
  // path). Without it the guest writes `/workspace/...` absolute paths
  // that get persisted via RealFSProvider and leave corrupt worktree
  // metadata on the host.
  if (creds.gitconfig) {
    const vmSigningKey = `${vmSshDir}/id_ed25519`;
    let vmGitconfig = creds.gitconfig.replace(
      /signingKey\s*=\s*.+/g,
      `signingKey = ${vmSigningKey}`,
    );
    vmGitconfig = ensureRelativeWorktreePaths(vmGitconfig);
    await vm.fs.writeFile(`${vmAgentDir}/gitconfig`, vmGitconfig, {
      mode: 0o644,
    });
  }

  // Inject SSH keys for commit signing
  if (creds.sshPrivateKey) {
    await vm.fs.writeFile(`${vmSshDir}/id_ed25519`, creds.sshPrivateKey, {
      mode: 0o600,
    });
  }
  if (creds.sshPublicKey) {
    await vm.fs.writeFile(`${vmSshDir}/id_ed25519.pub`, creds.sshPublicKey, {
      mode: 0o644,
    });
  }
  if (creds.allowedSigners) {
    await vm.fs.writeFile(`${vmSshDir}/allowed_signers`, creds.allowedSigners, {
      mode: 0o644,
    });
  }

  // Inject GitHub App PEM so `moltnet github token` works inside the guest.
  // The filename is the basename of the host path (e.g. "legreffier.pem"),
  // matching the path written into vmMoltnetJson above.
  if (creds.githubAppPem && creds.githubAppPemFilename) {
    await vm.fs.writeFile(
      `${vmAgentDir}/${creds.githubAppPemFilename}`,
      creds.githubAppPem,
      { mode: 0o600 },
    );
  }

  await vm.exec('chown -R agent:agent /home/agent/.pi /home/agent/.moltnet');

  return {
    vm,
    credentials: creds,
    mountPath: config.mountPath,
    guestWorkspace: GUEST_WORKSPACE,
    agentDir,
  };
}

/**
 * Rewrite host-absolute paths inside moltnet.json to VM-local equivalents.
 *
 * Fields rewritten:
 *   ssh.private_key_path  → <vmSshDir>/<basename of original>
 *   ssh.public_key_path   → <vmSshDir>/<basename of original>
 *   git.config_path       → <vmAgentDir>/gitconfig
 *   github.private_key_path → <vmAgentDir>/<pemFilename>  (if present)
 *
 * All other fields are passed through unchanged.
 * Throws if moltnetJson is not valid JSON — callers must not inject a broken
 * moltnet.json into the guest.
 */
export function rewriteMoltnetJsonPaths(
  moltnetJson: string,
  vmAgentDir: string,
  vmSshDir: string,
  githubAppPemFilename: string | null,
): string {
  const config = JSON.parse(moltnetJson) as Record<string, unknown>;

  if (config.ssh && typeof config.ssh === 'object') {
    const ssh = config.ssh as Record<string, unknown>;
    const origPrivate =
      typeof ssh.private_key_path === 'string' ? ssh.private_key_path : null;
    const origPublic =
      typeof ssh.public_key_path === 'string' ? ssh.public_key_path : null;
    config.ssh = {
      ...ssh,
      ...(origPrivate !== null && {
        private_key_path: `${vmSshDir}/${path.basename(origPrivate)}`,
      }),
      ...(origPublic !== null && {
        public_key_path: `${vmSshDir}/${path.basename(origPublic)}`,
      }),
    };
  }

  if (config.git && typeof config.git === 'object') {
    const git = { ...(config.git as Record<string, unknown>) };
    git.config_path = `${vmAgentDir}/gitconfig`;
    config.git = git;
  }

  if (
    githubAppPemFilename &&
    config.github &&
    typeof config.github === 'object'
  ) {
    const github = { ...(config.github as Record<string, unknown>) };
    github.private_key_path = `${vmAgentDir}/${githubAppPemFilename}`;
    config.github = github;
  }

  return JSON.stringify(config);
}

/**
 * Ensure `[worktree] useRelativePaths = true` is set in the given
 * gitconfig text. If the section exists, rewrite the key; otherwise
 * append a new section.
 */
export function ensureRelativeWorktreePaths(gitconfig: string): string {
  const sectionRe = /^\[worktree\]\s*$/m;
  const keyRe = /^(\[worktree\][\s\S]*?^)\s*useRelativePaths\s*=\s*\S+\s*$/m;

  if (keyRe.test(gitconfig)) {
    return gitconfig.replace(/^(\s*useRelativePaths\s*=\s*)\S+\s*$/m, '$1true');
  }
  if (sectionRe.test(gitconfig)) {
    return gitconfig.replace(
      sectionRe,
      '[worktree]\n\tuseRelativePaths = true',
    );
  }
  const sep = gitconfig.endsWith('\n') ? '' : '\n';
  return `${gitconfig}${sep}[worktree]\n\tuseRelativePaths = true\n`;
}
