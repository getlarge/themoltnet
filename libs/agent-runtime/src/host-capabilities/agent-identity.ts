import {
  AGENT_SIGNING_PROTOCOL_VERSION,
  type AgentIdentity,
} from '@moltnet/crypto-service';

/**
 * Parse `Name <email>` without a backtracking regex (CodeQL: polynomial
 * regular expression on uncontrolled data). Returns undefined when malformed.
 */
function parseGitAuthor(
  value: string,
): { name: string; email: string } | undefined {
  const trimmed = value.trim();
  if (!trimmed.endsWith('>')) return undefined;
  const open = trimmed.lastIndexOf('<');
  if (open <= 0) return undefined;
  const name = trimmed.slice(0, open).trim();
  const email = trimmed.slice(open + 1, -1);
  const at = email.indexOf('@');
  if (
    name === '' ||
    name.startsWith('[') ||
    // eslint-disable-next-line no-control-regex -- git config rejects ASCII controls.
    /[\x00-\x1f\x7f]/.test(name) ||
    at <= 0 ||
    at === email.length - 1 ||
    email.indexOf('@', at + 1) !== -1 ||
    /[\s<>]/.test(email)
  ) {
    return undefined;
  }
  return { name, email };
}

/**
 * Build the non-secret identity projected to guests. Public key and
 * fingerprint come from the authenticated `whoami`. Existing or explicit Git
 * authorship always wins; configless agents receive a stable local-only
 * default so tasks that never commit do not fail during startup.
 */
export function resolveAgentIdentity(input: {
  agentName: string;
  whoami: {
    subjectId: string;
    subjectType: string;
    publicKey?: string;
    fingerprint?: string;
  };
  /** `Name <email>` from a CLI option or environment. */
  gitAuthor?: string;
  /** Non-secret git identity from host configuration, when available. */
  hostGit?: { name?: string; email?: string };
}): AgentIdentity {
  const { subjectId, subjectType, publicKey, fingerprint } = input.whoami;
  if (!subjectId || subjectType !== 'agent') {
    throw new Error(
      'whoami did not return a canonical agent subject; cannot build the agent identity',
    );
  }
  if (!publicKey || !fingerprint) {
    throw new Error(
      'whoami did not return publicKey and fingerprint; cannot build the agent identity',
    );
  }
  let gitName: string;
  let gitEmail: string;
  if (input.gitAuthor !== undefined) {
    const parsed = parseGitAuthor(input.gitAuthor);
    if (!parsed) {
      throw new Error('git author must look like "Name <email>"');
    }
    gitName = parsed.name;
    gitEmail = parsed.email;
  } else if (input.hostGit?.name && input.hostGit.email) {
    const parsed = parseGitAuthor(
      `${input.hostGit.name} <${input.hostGit.email}>`,
    );
    if (!parsed) {
      throw new Error('configured git authorship is unsafe or malformed');
    }
    gitName = parsed.name;
    gitEmail = parsed.email;
  } else {
    gitName = input.agentName;
    gitEmail = `${input.agentName}@localhost.invalid`;
  }
  return {
    protocolVersion: AGENT_SIGNING_PROTOCOL_VERSION,
    agentName: input.agentName,
    subjectId,
    subjectType: 'agent',
    publicKey,
    fingerprint,
    gitName,
    gitEmail,
  };
}
