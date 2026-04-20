/**
 * VM lifecycle manager: resume checkpoint, inject credentials, configure
 * egress, fix TLS, and provide clean shutdown.
 */
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

  return {
    moltnetJson,
    agentEnvRaw,
    piAuthJson,
    agentEnv: parseEnv(agentEnvRaw),
    gitconfig,
    sshPrivateKey,
    sshPublicKey,
    allowedSigners,
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
  const vmAgentEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(creds.agentEnv)) {
    if (v === undefined || v === '') continue;
    if (k === 'GIT_CONFIG_GLOBAL') {
      // Remap to VM-side credentials path
      vmAgentEnv[k] = `/home/agent/.moltnet/${config.agentName}/gitconfig`;
    } else if (k.endsWith('_PRIVATE_KEY_PATH')) {
      // Remap key paths to VM-side
      vmAgentEnv[k] =
        `/home/agent/.moltnet/${config.agentName}/${path.basename(v)}`;
    } else {
      vmAgentEnv[k] = v;
    }
  }

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

  // Inject credentials into VM-side agent directory structure:
  //   /home/agent/.moltnet/<agentName>/{moltnet.json,env,gitconfig,ssh/}
  // Mirrors host layout so legreffier skill and CLI work identically.
  const vmAgentDir = `/home/agent/.moltnet/${config.agentName}`;
  const vmSshDir = `${vmAgentDir}/ssh`;
  await vm.exec(`mkdir -p ${vmAgentDir}/ssh /home/agent/.pi/agent`);

  await vm.fs.writeFile('/home/agent/.pi/agent/auth.json', creds.piAuthJson, {
    mode: 0o600,
  });
  await vm.fs.writeFile(`${vmAgentDir}/moltnet.json`, creds.moltnetJson, {
    mode: 0o600,
  });
  await vm.fs.writeFile(`${vmAgentDir}/env`, creds.agentEnvRaw, {
    mode: 0o600,
  });

  // Inject gitconfig with VM-side signing key path
  if (creds.gitconfig) {
    const vmSigningKey = `${vmSshDir}/id_ed25519`;
    const vmGitconfig = creds.gitconfig.replace(
      /signingKey\s*=\s*.+/g,
      `signingKey = ${vmSigningKey}`,
    );
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

  await vm.exec('chown -R agent:agent /home/agent/.pi /home/agent/.moltnet');

  return {
    vm,
    credentials: creds,
    mountPath: config.mountPath,
    guestWorkspace: GUEST_WORKSPACE,
    agentDir,
  };
}
