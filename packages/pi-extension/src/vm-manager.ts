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
  RealFSProvider,
  VmCheckpoint,
} from '@earendil-works/gondolin';

const GUEST_WORKSPACE = '/workspace';

export interface VmConfig {
  /** Absolute path to the qcow2 checkpoint. */
  checkpointPath: string;
  /** MoltNet agent name (used to resolve credentials). */
  agentName: string;
  /** Host directory to mount at /workspace in the VM. */
  mountPath: string;
  /** Additional hosts to allow in egress policy. */
  extraAllowedHosts?: string[];
}

export interface VmCredentials {
  moltnetJson: string;
  agentEnvRaw: string;
  piAuthJson: string;
  agentEnv: Record<string, string | undefined>;
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

  return {
    moltnetJson,
    agentEnvRaw,
    piAuthJson,
    agentEnv: parseEnv(agentEnvRaw),
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

  const cp = VmCheckpoint.load(config.checkpointPath);
  const vm = await cp.resume({
    httpHooks,
    env: {
      ...secretEnv,
      PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      HOME: '/home/agent',
      NODE_NO_WARNINGS: '1',
      NODE_EXTRA_CA_CERTS: '/etc/ssl/certs/ca-certificates.crt',
    },
    vfs: {
      mounts: {
        [GUEST_WORKSPACE]: new RealFSProvider(config.mountPath),
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

  // Inject credentials (never baked in snapshot)
  await vm.fs.writeFile('/home/agent/.pi/agent/auth.json', creds.piAuthJson, {
    mode: 0o600,
  });
  await vm.fs.writeFile(
    '/home/agent/.moltnet/moltnet.json',
    creds.moltnetJson,
    { mode: 0o600 },
  );
  await vm.fs.writeFile('/home/agent/.moltnet/env', creds.agentEnvRaw, {
    mode: 0o600,
  });
  await vm.exec('chown -R agent:agent /home/agent/.pi /home/agent/.moltnet');

  return {
    vm,
    credentials: creds,
    mountPath: config.mountPath,
    guestWorkspace: GUEST_WORKSPACE,
    agentDir,
  };
}
