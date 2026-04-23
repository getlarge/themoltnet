import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';

import type { VM } from '@earendil-works/gondolin';
import {
  createHttpHooks,
  createShadowPathPredicate,
  RealFSProvider,
  ShadowProvider,
  VmCheckpoint,
} from '@earendil-works/gondolin';

const GUEST_WORKSPACE = '/workspace';

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
  piAuthJson: string;
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

  const piAuthPath = path.join(
    process.env.HOME ?? '',
    '.pi',
    'agent',
    'auth.json',
  );
  if (!existsSync(piAuthPath)) {
    throw new Error(
      `Pi OAuth credentials not found at ${piAuthPath}. Run: pi login`,
    );
  }
  const piAuthJson = readFileSync(piAuthPath, 'utf8');

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

  // Inject credentials into VM-side agent directory structure:
  //   /home/agent/.moltnet/<agentName>/{moltnet.json,env,gitconfig,ssh/}
  // Mirrors host layout so legreffier skill and CLI work identically.
  const vmSshDir = `${vmAgentDir}/ssh`;
  await vm.exec(`mkdir -p ${vmAgentDir}/ssh /home/agent/.pi/agent`);

  await vm.fs.writeFile('/home/agent/.pi/agent/auth.json', creds.piAuthJson, {
    mode: 0o600,
  });

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
