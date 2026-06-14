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

import { abortableResource, delay, throwIfAborted } from './abort-utils.js';
import type { ResumeCommand, SandboxConfig } from './snapshot.js';

/**
 * Memory-backed VFS mount used by the daemon to inject task-context
 * skills (#943 slice 1.5). This is a separate top-level mount because
 * Gondolin mounts can't nest. The agent's Gondolin-bound Read tool accepts
 * paths under this prefix (see toGuestPath in tool-operations.ts).
 *
 * Why MemoryProvider rather than a path under the workspace mount:
 *   - Injected skills are ephemeral by intent: per-task-attempt input
 *     scoped to the VM lifetime. MemoryProvider models that exactly —
 *     in-memory, per-VM-instance, zero host artefacts, automatic
 *     cleanup on VM close.
 *   - Writing under the workspace mount fails in worktrees because we symlink
 *     `.moltnet/` to the main repo (so credentials are reachable from
 *     worktrees), and Gondolin's RealFSProvider correctly refuses to
 *     create paths whose ancestors' realpath escapes the mount root.
 *     That refusal is a deliberate sandbox-escape protection, not a
 *     bug. See diary semantic entry cd27d9d3-efdc-4aec-ac0d-5fd8ce258d1f
 *     and episodic 7affbfeb-18a2-4963-aeac-c177eb2afa2d for the full
 *     investigation and the alternatives we rejected.
 */
export const GUEST_TASK_SKILLS_MOUNT = '/moltnet-task-skills';

export interface VmConfig {
  /** Absolute path to the qcow2 checkpoint. */
  checkpointPath: string;
  /** MoltNet agent name (used to resolve credentials). */
  agentName: string;
  /** Host directory to mount into the VM. */
  mountPath: string;
  /** Effective workspace shape selected by the caller. */
  workspaceMode?: 'shared_mount' | 'dedicated_worktree' | 'scratch_mount';
  /** Additional hosts to allow in egress policy. */
  extraAllowedHosts?: string[];
  /** Full sandbox config (vfs shadows, env overrides). */
  sandboxConfig?: SandboxConfig;
  /** Abort resume/setup work, closing any live VM owned by resumeVm. */
  signal?: AbortSignal;
}

export interface VmCredentials {
  moltnetJson: string;
  agentEnvRaw: string;
  /**
   * Pi OAuth/API-key auth blob. Null when neither `~/.pi/agent/auth.json`
   * (resolved via `PI_CODING_AGENT_DIR` when set) is present — in that
   * case the daemon relies on Pi's env-var providers (`ANTHROPIC_API_KEY`,
   * etc.) carried via `agentEnv` and the host environment instead. CI uses
   * this path.
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

export function shouldRunResumeCommand(
  entry: string | ResumeCommand,
  ctx: {
    workspaceMode: 'shared_mount' | 'dedicated_worktree' | 'scratch_mount';
  },
): boolean {
  if (typeof entry === 'string') {
    return true;
  }
  const workspaceModes = entry.when?.workspaceMode;
  if (workspaceModes && !workspaceModes.includes(ctx.workspaceMode)) {
    return false;
  }
  return true;
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

  // Pi auth resolution: use the agent dir Pi already expects. CI writes
  // `auth.json` under `PI_CODING_AGENT_DIR`; local runs fall back to the
  // canonical `~/.pi/agent` dir when the override is unset.
  const piAgentDir =
    process.env.PI_CODING_AGENT_DIR ??
    path.join(process.env.HOME ?? '', '.pi', 'agent');
  const piAuthPath = path.join(piAgentDir, 'auth.json');
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
async function vmRun(
  vm: VM,
  label: string,
  command: string,
  signal?: AbortSignal,
): Promise<void> {
  // Wrap with `set -o pipefail` inside the script (not on the sh command
  // line, which busybox ash on Alpine doesn't accept as a flag). This
  // ensures pipelines like `foo | tail` propagate foo's non-zero exit
  // instead of masking it behind tail's success.
  const wrapped = `set -eu\nset -o pipefail\n${command}`;
  throwIfAborted(signal, `resume step "${label}"`);
  const r = await vm.exec(['sh', '-c', wrapped], { signal });
  if (r.exitCode !== 0) {
    const tail = [r.stderr, r.stdout].filter(Boolean).join('\n').slice(-800);
    throw new Error(
      `resume step "${label}" failed (exit ${r.exitCode}):\n${tail}`,
    );
  }
}

function nonErrorMessage(err: unknown): string {
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err) ?? 'unknown error';
  } catch {
    return 'unknown error';
  }
}

/**
 * Resume a VM from a checkpoint, inject credentials, configure egress +
 * TLS. Returns the managed VM handle.
 */
export async function resumeVm(config: VmConfig): Promise<ManagedVm> {
  throwIfAborted(config.signal, 'VM resume');
  const mainRepo = findMainWorktree();
  const agentDir = path.join(mainRepo, '.moltnet', config.agentName);
  const guestWorkspace = path.resolve(config.mountPath);

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
    MOLTNET_GUEST_WORKSPACE: guestWorkspace,
  };

  const resources = config.sandboxConfig?.resources;
  const workspaceMode = config.workspaceMode ?? 'shared_mount';
  const cp = VmCheckpoint.load(config.checkpointPath);
  const vm = await abortableResource({
    promise: cp.resume({
      httpHooks,
      env: vmEnv,
      ...(resources?.memory && { memory: resources.memory }),
      ...(resources?.cpus && { cpus: resources.cpus }),
      vfs: {
        mounts: {
          [guestWorkspace]: workspaceProvider,
          // Memory-backed mount for task-context skill injection (#943).
          // Per-VM-instance, never persisted, never shared.
          [GUEST_TASK_SKILLS_MOUNT]: new MemoryProvider(),
        },
      },
    }),
    signal: config.signal,
    label: 'VM resume',
    cleanup: (resumedVm) => resumedVm.close(),
    onCleanupError: (err) => {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[vm] aborted resume late vm.close() failed: ${message}\n`,
      );
    },
  });

  // Everything past cp.resume() owns the live VM. Any throw between
  // here and the final `return { vm, ... }` must close the VM, or the
  // qemu child process (visible in `process.getActiveResourcesInfo()`
  // as `ProcessWrap` + ~12 `PipeWrap` for its stdio fds) keeps the
  // Node event loop alive, and `executePiTask`'s own finally block
  // never runs because it depends on the resolved `managed` handle
  // we're about to return.
  try {
    // Fix TLS: append Gondolin MITM CA to system trust store.
    // Unofficial-builds Node ships its own OpenSSL which can't load
    // NODE_EXTRA_CA_CERTS from /etc/gondolin/mitm/ca.crt (error 8000000D).
    await vmRun(
      vm,
      'TLS certificates',
      `
    cp /etc/gondolin/mitm/ca.crt /usr/local/share/ca-certificates/gondolin-mitm.crt
    update-ca-certificates 2>/dev/null
    cat /etc/gondolin/mitm/ca.crt >> /etc/ssl/certs/ca-certificates.crt
  `,
      config.signal,
    );

    // Fix DNS: ensure working resolvers (VM gateway DNS may not forward
    // correctly) and wait for resolution to actually work before downstream
    // resumeCommands run. Without the wait we've observed EAI_AGAIN errors
    // on pnpm fetch when the resolver isn't ready yet at the moment of
    // first lookup — Gondolin's resumed VM is a fresh overlay so any
    // resolv.conf baked into the snapshot is replaced, and there's a brief
    // race between our write here and DHCP/udhcpc finishing.
    // Fix DNS: ensure working resolvers. Note Gondolin's MITM proxy returns
    // RFC 5737 placeholder IPs (192.0.2.1 IPv4, 2001:db8::1 IPv6) for every
    // hostname — actual routing happens transparently in the proxy. Node's
    // default dual-stack behavior can attempt the unreachable IPv6 first
    // and fail with EAI_AGAIN; consumers needing reliable resolution
    // should set NODE_OPTIONS=--dns-result-order=ipv4first via
    // sandbox.json#env (and curl --4 / similar for shell tools).
    await vmRun(
      vm,
      'DNS resolvers',
      `printf 'nameserver 8.8.8.8\\nnameserver 1.1.1.1\\n' > /etc/resolv.conf`,
      config.signal,
    );

    // Tell git that the workspace mount is trusted regardless of UID. The host
    // workspace is bind-mounted into the VM via Gondolin's RealFSProvider,
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
      config.signal,
    );

    // Consumer-provided per-resume commands. Repo-specific bootstrap
    // (corepack-install a pinned pnpm, `pnpm fetch`, kernel tmpfs mounts
    // for paths the consumer wants out of the Gondolin FUSE hot path —
    // see diary 17f0ac6f for the pnpm-install-100×-faster recipe) belongs
    // here, not in vm-manager. pi-extension stays repo-agnostic.
    // Sequential, first failure aborts resume via vmRun. Per-step opt-in
    // retries (object form: `{ run, retries, retryBackoffMs }`) cover
    // network-bound idempotent steps that race DHCP/registry availability
    // on a fresh resume (e.g. pnpm install, go mod download).
    for (const [i, entry] of (
      config.sandboxConfig?.resumeCommands ?? []
    ).entries()) {
      if (!shouldRunResumeCommand(entry, { workspaceMode })) {
        continue;
      }
      const { run, retries, backoffMs } =
        typeof entry === 'string'
          ? { run: entry, retries: 0, backoffMs: 2000 }
          : {
              run: entry.run,
              retries: entry.retries ?? 0,
              backoffMs: entry.retryBackoffMs ?? 2000,
            };
      const label = `resumeCommands[${i}]`;
      let lastErr: unknown;
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          await vmRun(vm, label, run, config.signal);
          lastErr = undefined;
          break;
        } catch (err) {
          lastErr = err;
          if (attempt === retries) break;
          await delay((attempt + 1) * backoffMs, config.signal, label);
        }
      }
      if (lastErr) {
        throw lastErr instanceof Error
          ? lastErr
          : new Error(nonErrorMessage(lastErr));
      }
    }

    // Inject credentials into VM-side agent directory structure:
    //   /home/agent/.moltnet/<agentName>/{moltnet.json,env,gitconfig,ssh/}
    // Mirrors host layout so legreffier skill and CLI work identically.
    const vmSshDir = `${vmAgentDir}/ssh`;
    await vm.exec(`mkdir -p ${vmAgentDir}/ssh /home/agent/.pi/agent`, {
      signal: config.signal,
    });

    if (creds.piAuthJson !== null) {
      // See MoltNet diary entry 09336c5e-e45a-475f-b9cd-1e0ab635e093.
      await vm.fs.writeFile(
        '/home/agent/.pi/agent/auth.json',
        creds.piAuthJson,
        {
          mode: 0o600,
          signal: config.signal,
        },
      );
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
      signal: config.signal,
    });

    await vm.fs.writeFile(`${vmAgentDir}/env`, creds.agentEnvRaw, {
      mode: 0o600,
      signal: config.signal,
    });

    // Inject gitconfig with VM-side signing key path. The workspace is mounted
    // at the same absolute path in the VM as on the host, so git worktree
    // metadata can keep normal absolute paths without the
    // extensions.relativeworktrees repository extension that breaks older git
    // libraries.
    if (creds.gitconfig) {
      const vmSigningKey = `${vmSshDir}/id_ed25519`;
      const vmGitconfig = creds.gitconfig.replace(
        /signingKey\s*=\s*.+/g,
        `signingKey = ${vmSigningKey}`,
      );
      await vm.fs.writeFile(`${vmAgentDir}/gitconfig`, vmGitconfig, {
        mode: 0o644,
        signal: config.signal,
      });
    }

    // Inject SSH keys for commit signing
    if (creds.sshPrivateKey) {
      await vm.fs.writeFile(`${vmSshDir}/id_ed25519`, creds.sshPrivateKey, {
        mode: 0o600,
        signal: config.signal,
      });
    }
    if (creds.sshPublicKey) {
      await vm.fs.writeFile(`${vmSshDir}/id_ed25519.pub`, creds.sshPublicKey, {
        mode: 0o644,
        signal: config.signal,
      });
    }
    if (creds.allowedSigners) {
      await vm.fs.writeFile(
        `${vmSshDir}/allowed_signers`,
        creds.allowedSigners,
        {
          mode: 0o644,
          signal: config.signal,
        },
      );
    }

    // Inject GitHub App PEM so `moltnet github token` works inside the guest.
    // The filename is the basename of the host path (e.g. "legreffier.pem"),
    // matching the path written into vmMoltnetJson above.
    if (creds.githubAppPem && creds.githubAppPemFilename) {
      await vm.fs.writeFile(
        `${vmAgentDir}/${creds.githubAppPemFilename}`,
        creds.githubAppPem,
        { mode: 0o600, signal: config.signal },
      );
    }

    await vm.exec('chown -R agent:agent /home/agent/.pi /home/agent/.moltnet', {
      signal: config.signal,
    });

    // Setup dynamic Git credential helper to bypass unstable SSH proxy.
    // This allows raw `git push/pull` to use MoltNet GitHub tokens via HTTPS.
    const gitCredHelperPath = `${vmSshDir}/git-credential-moltnet`;
    const credHelperScript = `#!/bin/sh
echo "username=x-access-token"
echo "password=$(moltnet github token --credentials ${vmSshDir}/moltnet.json)"
`;
    await vm.fs.writeFile(gitCredHelperPath, credHelperScript, { mode: 0o755, signal: config.signal });
    await vmRun(
      vm,
      'git credential helper',
      `git config --global credential.helper ${gitCredHelperPath} && \
       git config --global url."https://github.com/".insteadOf "git@github.com:"`,
      config.signal,
    );

    return {
      vm,
      credentials: creds,
      mountPath: config.mountPath,
      guestWorkspace,
      agentDir,
    };
  } catch (err) {
    // Anything after cp.resume() owns the live VM. If setup throws
    // (TLS, DNS, safe.directory, tmpfs mounts, resumeCommands, …),
    // close the qemu process before rethrowing — otherwise the
    // ProcessWrap + ~12 PipeWrap handles leak and Node's event
    // loop sticks around forever after the daemon's main() resolves.
    try {
      await vm.close();
    } catch (closeErr) {
      const m = closeErr instanceof Error ? closeErr.message : String(closeErr);
      process.stderr.write(`[vm] post-throw vm.close() failed: ${m}\n`);
    }
    throw err;
  }
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
