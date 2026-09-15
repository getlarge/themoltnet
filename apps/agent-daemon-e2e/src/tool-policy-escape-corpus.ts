export interface ToolPolicyEscapeCase {
  name: string;
  policyShape: 'tool-grant-only' | 'narrow-shell' | 'one-token-shell';
  command: string;
  expectedAllow: boolean;
  reasonCode:
    | 'policy_allowed'
    | 'shell_command_prefix_allowed'
    | 'shell_output_redirection_not_permitted'
    | 'tool_not_permitted';
  missing?: string[];
  technique: string;
  source: 'issue-2275';
}

/**
 * Deterministic, no-LLM escape corpus for the daemon's resolved tool policy.
 * Keep new bypass techniques here so the live-policy E2E exercises the same
 * analyzer and gate path as a real daemon session.
 */
export const TOOL_POLICY_ESCAPE_CASES: ToolPolicyEscapeCase[] = [
  {
    name: 'allows a command matching a narrow ls shell rule',
    policyShape: 'narrow-shell',
    command: 'ls -la',
    expectedAllow: true,
    reasonCode: 'shell_command_prefix_allowed',
    technique: 'plain-command',
    source: 'issue-2275',
  },
  {
    name: 'blocks stderr redirection despite a matching narrow ls grant',
    policyShape: 'narrow-shell',
    command: 'ls -la 2> proof.txt',
    expectedAllow: false,
    reasonCode: 'shell_output_redirection_not_permitted',
    missing: ['ls'],
    technique: 'stderr-redirection',
    source: 'issue-2275',
  },
  {
    name: 'blocks a different ls command through an ls tool grant',
    policyShape: 'tool-grant-only',
    command: 'ls -l missing 2> proof.txt',
    expectedAllow: false,
    reasonCode: 'tool_not_permitted',
    missing: ['ls'],
    technique: 'stderr-redirection',
    source: 'issue-2275',
  },
  {
    name: 'blocks stdout redirection through a grep tool grant',
    policyShape: 'tool-grant-only',
    command: 'grep needle missing > proof.txt',
    expectedAllow: false,
    reasonCode: 'tool_not_permitted',
    missing: ['grep'],
    technique: 'stdout-redirection',
    source: 'issue-2275',
  },
  {
    name: 'blocks find file output through a find tool grant',
    policyShape: 'tool-grant-only',
    command: 'find . -fprint proof.txt',
    expectedAllow: false,
    reasonCode: 'tool_not_permitted',
    missing: ['find'],
    technique: 'gtfobins-file-write',
    source: 'issue-2275',
  },
  {
    name: 'blocks find deletion through a find tool grant',
    policyShape: 'tool-grant-only',
    command: 'find . -delete',
    expectedAllow: false,
    reasonCode: 'tool_not_permitted',
    missing: ['find'],
    technique: 'curated-delete-flag',
    source: 'issue-2275',
  },
  {
    name: 'allows any git arguments through a one-token git shell rule',
    policyShape: 'one-token-shell',
    command: 'git push origin main',
    expectedAllow: true,
    reasonCode: 'shell_command_prefix_allowed',
    technique: 'plain-command',
    source: 'issue-2275',
  },
  {
    name: 'blocks stdout redirection despite a one-token git shell rule',
    policyShape: 'one-token-shell',
    command: 'git diff > proof.txt',
    expectedAllow: false,
    reasonCode: 'shell_output_redirection_not_permitted',
    missing: ['git'],
    technique: 'stdout-redirection',
    source: 'issue-2275',
  },
  {
    name: 'blocks a shell program granted only as a tool name',
    policyShape: 'tool-grant-only',
    command: 'gh pr merge 1725',
    expectedAllow: false,
    reasonCode: 'tool_not_permitted',
    missing: ['gh'],
    technique: 'tool-name-as-executable',
    source: 'issue-2275',
  },
];
