/**
 * End-to-end proof of the stock `agent-signing` capability inside a real
 * Gondolin VM: the guest runs `git commit -S` and `git verify-commit` with
 * the CLI's ssh-agent adapter, and signs a diary request through
 * `moltnet capability call`, while the Ed25519 seed exists only on the host.
 *
 * Opt-in: MOLTNET_PI_VM_INTEGRATION=1. The guest needs this branch's CLI, so
 * the test cross-compiles apps/moltnet-cli for the guest (or uses
 * MOLTNET_CLI_LINUX_BINARY) and projects it as /home/agent/bin/moltnet.
 */
/* eslint-disable no-restricted-syntax -- opt-in real-VM test reads its gate and toolchain from the environment, not daemon config */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildSigningBytes, cryptoService } from '@moltnet/crypto-service';
import * as ed from '@noble/ed25519';
import {
  createHostCapabilityRouter,
  createLocalSeedSigner,
} from '@themoltnet/agent-runtime';
import { ensureSnapshot, resumeVm } from '@themoltnet/sandbox-gondolin';
import { describe, expect, it, vi } from 'vitest';

import { agentSigningCapability } from './agent-signing.js';

const describeVm =
  process.env.MOLTNET_PI_VM_INTEGRATION === '1' ? describe : describe.skip;

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');
const GUEST_CLI = '/home/agent/bin/moltnet';

function guestCliBinary(): Uint8Array {
  const configured = process.env.MOLTNET_CLI_LINUX_BINARY;
  if (configured) return readFileSync(configured);
  const out = path.join(
    mkdtempSync(path.join(tmpdir(), 'moltnet-cli-')),
    'moltnet',
  );
  execFileSync('go', ['build', '-o', out, '.'], {
    cwd: path.join(REPO_ROOT, 'apps/moltnet-cli'),
    env: {
      ...process.env,
      CGO_ENABLED: '0',
      GOOS: 'linux',
      GOARCH: process.arch === 'arm64' ? 'arm64' : 'amd64',
    },
    stdio: 'pipe',
  });
  return readFileSync(out);
}

async function execGuest(
  vm: Awaited<ReturnType<typeof resumeVm>>['vm'],
  command: string,
): Promise<string> {
  const proc = vm.exec(['/bin/sh', '-lc', command], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  let output = '';
  if ('output' in proc && typeof proc.output === 'function') {
    for await (const chunk of proc.output()) {
      output +=
        typeof chunk.data === 'string'
          ? chunk.data
          : Buffer.from(chunk.data).toString('utf8');
    }
  }
  const result = await proc;
  if ('stdout' in result) output += String(result.stdout ?? '');
  if ('stderr' in result) output += String(result.stderr ?? '');
  if (result.exitCode !== 0) {
    throw new Error(
      `guest command failed (${result.exitCode}):\n${command}\n${output}`,
    );
  }
  return output;
}

describeVm('agent-signing capability in a real Gondolin VM', () => {
  it('signs commits and diary requests from the guest without a key in the guest', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'moltnet-agent-signing-e2e-'));
    const workspace = path.join(root, 'workspace');
    mkdirSync(workspace, { recursive: true });

    const keyPair = await cryptoService.generateKeyPair();
    const identity = {
      agentName: 'legreffier',
      identityId: '2f1c0b9e-aaaa-4bbb-8ccc-dddddddddddd',
      publicKey: keyPair.publicKey,
      fingerprint: keyPair.fingerprint,
      gitName: 'LeGreffier',
      gitEmail: 'legreffier@example.test',
    };
    const requestId = '11111111-2222-4333-8444-555555555555';
    const nonce = '5a0e4c4e-4d5e-4c5e-8b5e-5e5e5e5e5e5e';
    const submitted: string[] = [];
    const agent = {
      crypto: {
        signingRequests: {
          get: vi.fn(() =>
            Promise.resolve({
              id: requestId,
              agentId: identity.identityId,
              verificationMethod: 'agent-ed25519',
              status: 'pending',
              message: 'bafkreitest',
              nonce,
              signingInput: Buffer.from(
                buildSigningBytes('bafkreitest', nonce),
              ).toString('base64'),
            }),
          ),
          submit: vi.fn((_id: string, body: { signature: string }) => {
            submitted.push(body.signature);
            return Promise.resolve({ id: requestId, status: 'completed' });
          }),
        },
      },
    };
    const signer = createLocalSeedSigner({
      privateKeySeed: keyPair.privateKey,
      agent: agent as never,
      identity,
    });
    const evidence: Array<[Record<string, unknown>, string]> = [];
    const router = createHostCapabilityRouter({
      capabilities: [agentSigningCapability],
      context: {
        taskId: 't',
        attemptN: 1,
        teamId: 'team',
        agent: agent as never,
        identity,
      },
      injected: { signer },
      paths: { mountPath: workspace },
      logger: {
        info: (obj, msg) => evidence.push([obj, msg]),
        warn: (obj, msg) => evidence.push([obj, msg]),
      },
    });
    router.setPolicy({ enforcement: 'off', allowedTools: new Set() });

    const binary = guestCliBinary();
    const projection = {
      env: router.guestProjection.env,
      files: [
        ...router.guestProjection.files,
        { path: GUEST_CLI, content: binary, mode: 0o755 },
      ],
      services: router.guestProjection.services.map((service) => ({
        ...service,
        command: [GUEST_CLI, ...service.command.slice(1)],
      })),
    };

    const checkpointPath = await ensureSnapshot();
    let managed: Awaited<ReturnType<typeof resumeVm>> | undefined;
    try {
      managed = await resumeVm({
        checkpointPath,
        agentName: 'legreffier',
        agentRootDir: root,
        guestCredentialMode: 'host-authenticated',
        mountPath: workspace,
        hostOrigins: router.origins,
        guestProjection: projection,
      });

      const output = await execGuest(
        managed.vm,
        `
set -eu
for i in $(seq 1 50); do [ -S "$SSH_AUTH_SOCK" ] && break; sleep 0.2; done
if ! [ -S "$SSH_AUTH_SOCK" ]; then
  echo no-agent-socket
  echo "--- diagnostics"
  ls -la /home/agent/bin /run/moltnet /run/moltnet/services 2>&1 || true
  ${GUEST_CLI} --version 2>&1 || true
  env | grep -E 'MOLTNET_SIGNER_URL|SSH_AUTH_SOCK|GIT_CONFIG_GLOBAL' || true
  timeout 3 ${GUEST_CLI} capability serve agent-signing --adapter ssh-agent --socket /tmp/probe.sock 2>&1 || true
  exit 1
fi
cd "${managed.guestWorkspace}" || { echo "cd failed"; exit 1; }
git init -q signed-repo && cd signed-repo
echo "stage: committing"
if ! git commit -q -S --allow-empty -m "signed inside the guest" 2>&1; then
  echo "stage: commit failed; probing signer"
  ls -la "$SSH_AUTH_SOCK" /home/agent/.config/moltnet 2>&1 || true
  git config --global --list 2>&1 | head -20 || true
  ${GUEST_CLI} capability call agent-signing sign-git-commit --json '{"sshsig":"AA=="}' 2>&1 || true
  exit 1
fi
echo "stage: verifying"
git verify-commit HEAD 2>&1
git log -1 --show-signature | grep -c 'Good "git" signature' || true
${GUEST_CLI} capability call agent-signing sign-diary-entry --json '{"signingRequestId":"${requestId}"}'
echo "key-files=$(find /home/agent -name 'id_ed25519' 2>/dev/null | wc -l | tr -d ' ')"
echo "seed-env=$(env | grep -c '${keyPair.privateKey}' || true)"
`,
      );

      expect(output).toMatch(
        /Good "git" signature for legreffier@example\.test/,
      );
      expect(output).toContain('"signingRequestId": "' + requestId + '"');
      expect(output).toContain('key-files=0');
      expect(output).toContain('seed-env=0');
      expect(output).not.toContain(keyPair.privateKey);

      expect(submitted).toHaveLength(1);
      const verified = await ed.verifyAsync(
        Buffer.from(submitted[0], 'base64'),
        buildSigningBytes('bafkreitest', nonce),
        cryptoService.parsePublicKey(keyPair.publicKey),
      );
      expect(verified).toBe(true);

      const allowed = evidence.filter(
        ([, msg]) => msg === 'host_capability.allowed',
      );
      expect(allowed.map(([obj]) => obj.operation)).toEqual(
        expect.arrayContaining(['sign-git-commit', 'sign-diary-entry']),
      );
      expect(JSON.stringify(evidence)).not.toContain(keyPair.privateKey);
    } finally {
      await managed?.services.stop();
      await managed?.vm.close();
      rmSync(root, { recursive: true, force: true });
    }
  }, 1_200_000);
});
