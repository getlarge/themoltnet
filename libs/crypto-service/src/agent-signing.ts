import { toSSHPublicKey } from './ssh.js';

/**
 * Non-secret identity of the agent a daemon runs as. Everything here may be
 * projected into a sandbox guest; nothing here can sign.
 */
export interface AgentIdentity {
  agentName: string;
  identityId: string;
  /** `ed25519:<base64>` */
  publicKey: string;
  fingerprint: string;
  gitName: string;
  gitEmail: string;
}

/**
 * The seam between key storage and everything that needs a signature.
 *
 * Implementations hold (or proxy to) the Ed25519 identity key; consumers never
 * see key material. The operations are purpose-bound on purpose: there is no
 * "sign these bytes" method, so a broker exposing this interface cannot be
 * turned into a general signing oracle.
 */
export interface AgentSigningCapability {
  readonly identity: AgentIdentity;
  /** Sign a pending MoltNet signing request owned by this identity. */
  signDiaryEntry(input: {
    signingRequestId: string;
  }): Promise<{ signingRequestId: string }>;
  /**
   * Sign a validated SSHSIG envelope in the `git` namespace. The enforceable
   * boundary is the namespace, which covers every git object signature
   * (commits and tags); it is not commit-only.
   */
  signGitCommit(input: { sshsig: Uint8Array }): Promise<{
    /** Raw 64-byte Ed25519 signature over the envelope. */
    signature: Uint8Array;
  }>;
}

/** Git `user.signingKey` literal: git signs through ssh-agent, no key file. */
export function sshPublicKeyLiteral(publicKey: string): string {
  return `key::${toSSHPublicKey(publicKey)}`;
}

/** One `allowed_signers` line restricted to commit/tag signatures. */
export function allowedSignersLine(identity: AgentIdentity): string {
  return `${identity.gitEmail} namespaces="git" ${toSSHPublicKey(identity.publicKey)}`;
}

/**
 * A gitconfig that carries identity and verification settings only: no key
 * paths, no credential helper, nothing a guest could exfiltrate.
 */
export function nonSecretGitconfig(
  identity: AgentIdentity,
  paths: { allowedSignersFile: string; mountPath: string },
): string {
  return [
    '[user]',
    `\tname = ${identity.gitName}`,
    `\temail = ${identity.gitEmail}`,
    `\tsigningKey = ${sshPublicKeyLiteral(identity.publicKey)}`,
    '[gpg]',
    '\tformat = ssh',
    '[gpg "ssh"]',
    `\tallowedSignersFile = ${paths.allowedSignersFile}`,
    // No `commit.gpgsign = true`: signing is opt-in via `git commit -S`, so a
    // profile that allows git without the agent-signing capability is not
    // forced to route every commit through a policy-denied signer.
    '[url "https://github.com/"]',
    '\tinsteadOf = git@github.com:',
    '[safe]',
    `\tdirectory = ${paths.mountPath}`,
    '',
  ].join('\n');
}
