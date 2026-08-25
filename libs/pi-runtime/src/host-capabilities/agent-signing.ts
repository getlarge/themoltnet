import { createHash } from 'node:crypto';

import {
  type AgentSigningCapability,
  allowedSignersLine,
  nonSecretGitconfig,
} from '@moltnet/crypto-service/agent-signing';
import {
  defineHostCapability,
  type HostCapabilityContext,
} from '@themoltnet/agent-runtime';
import { Type } from 'typebox';

export const GUEST_SIGNER_SOCKET = '/run/moltnet/signer.sock';
export const GUEST_GITCONFIG_PATH = '/home/agent/.config/moltnet/gitconfig';
export const GUEST_ALLOWED_SIGNERS_PATH =
  '/home/agent/.config/moltnet/allowed_signers';

const UUID_PATTERN =
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

/** State the daemon injects for this capability. */
export interface AgentSigningInjected {
  signer: AgentSigningCapability;
}

function isSigner(value: unknown): value is AgentSigningCapability {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AgentSigningCapability).signGitCommit === 'function' &&
    typeof (value as AgentSigningCapability).signDiaryEntry === 'function'
  );
}

function requireSigner(
  ctx: HostCapabilityContext<AgentSigningInjected>,
): AgentSigningCapability {
  const signer = (ctx.injected as { signer?: unknown }).signer;
  if (!isSigner(signer)) {
    const error = new Error('no signer injected into this session');
    error.name = 'SignerUnavailable';
    throw error;
  }
  return signer;
}

function digestBase64(value: string): string {
  return `sha256:${createHash('sha256')
    .update(Buffer.from(value, 'base64'))
    .digest('hex')
    .slice(0, 16)}`;
}

/**
 * Stock signing capability: the guest keeps `git commit -S` and
 * `moltnet entry create-signed`; signatures are produced on the host through
 * the injected `AgentSigningCapability`. The guest receives only the signer
 * origin, an ssh-agent socket served by the CLI, and a non-secret gitconfig.
 */
export const agentSigningCapability =
  defineHostCapability<AgentSigningInjected>({
    name: 'agent-signing',
    operations: {
      'sign-git-commit': {
        request: Type.Object(
          { sshsig: Type.String({ minLength: 1, maxLength: 8192 }) },
          { additionalProperties: false },
        ),
        response: Type.Object({ signature: Type.String() }),
        maxBodyBytes: 12 * 1024,
        async handle(input: { sshsig: string }, ctx) {
          const { signature } = await requireSigner(ctx).signGitCommit({
            sshsig: new Uint8Array(Buffer.from(input.sshsig, 'base64')),
          });
          return { signature: Buffer.from(signature).toString('base64') };
        },
        evidence: (input: { sshsig: string }) => ({
          sshsigDigest: digestBase64(input.sshsig),
        }),
      },
      'sign-diary-entry': {
        request: Type.Object(
          { signingRequestId: Type.String({ pattern: UUID_PATTERN }) },
          { additionalProperties: false },
        ),
        response: Type.Object({ signingRequestId: Type.String() }),
        maxBodyBytes: 1024,
        handle: (input: { signingRequestId: string }, ctx) =>
          requireSigner(ctx).signDiaryEntry(input),
        evidence: (input: { signingRequestId: string }) => ({
          signingRequestId: input.signingRequestId,
        }),
      },
    },
    guest: {
      env: {
        MOLTNET_SIGNER_URL: '${origin}',
        SSH_AUTH_SOCK: GUEST_SIGNER_SOCKET,
        GIT_CONFIG_GLOBAL: GUEST_GITCONFIG_PATH,
      },
      files: [
        {
          path: GUEST_GITCONFIG_PATH,
          mode: 0o644,
          content: (identity, { mountPath }) =>
            nonSecretGitconfig(identity, {
              allowedSignersFile: GUEST_ALLOWED_SIGNERS_PATH,
              mountPath,
            }),
        },
        {
          path: GUEST_ALLOWED_SIGNERS_PATH,
          mode: 0o644,
          content: (identity) => `${allowedSignersLine(identity)}\n`,
        },
      ],
      services: [
        {
          id: 'signer-agent',
          command: [
            'moltnet',
            'capability',
            'serve',
            'agent-signing',
            '--adapter',
            'ssh-agent',
            '--socket',
            GUEST_SIGNER_SOCKET,
          ],
          readiness: { path: GUEST_SIGNER_SOCKET, timeoutMs: 8_000 },
        },
      ],
    },
  });
