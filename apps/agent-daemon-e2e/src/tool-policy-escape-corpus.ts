export interface ToolPolicyEscapeCase {
  name: string;
  policyShape: 'structured-only' | 'narrow-shell' | 'broad-executable';
  command: string;
  expectedAllow: boolean;
  reasonCode:
    | 'policy_allowed'
    | 'shell_command_prefix_allowed'
    | 'shell_output_redirection_requires_broad_permission'
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
    name: 'allows a narrowly granted structured-name executable',
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
    reasonCode: 'shell_output_redirection_requires_broad_permission',
    missing: ['ls'],
    technique: 'stderr-redirection',
    source: 'issue-2275',
  },
  {
    name: 'blocks a different ls command through a structured ls grant',
    policyShape: 'structured-only',
    command: 'ls -l missing 2> proof.txt',
    expectedAllow: false,
    reasonCode: 'tool_not_permitted',
    missing: ['ls'],
    technique: 'stderr-redirection',
    source: 'issue-2275',
  },
  {
    name: 'blocks stdout redirection through a structured grep grant',
    policyShape: 'structured-only',
    command: 'grep needle missing > proof.txt',
    expectedAllow: false,
    reasonCode: 'tool_not_permitted',
    missing: ['grep'],
    technique: 'stdout-redirection',
    source: 'issue-2275',
  },
  {
    name: 'blocks find file output through a structured find grant',
    policyShape: 'structured-only',
    command: 'find . -fprint proof.txt',
    expectedAllow: false,
    reasonCode: 'tool_not_permitted',
    missing: ['find'],
    technique: 'gtfobins-file-write',
    source: 'issue-2275',
  },
  {
    name: 'blocks find deletion through a structured find grant',
    policyShape: 'structured-only',
    command: 'find . -delete',
    expectedAllow: false,
    reasonCode: 'tool_not_permitted',
    missing: ['find'],
    technique: 'curated-delete-flag',
    source: 'issue-2275',
  },
  {
    name: 'preserves redirection for a non-colliding broad executable grant',
    policyShape: 'broad-executable',
    command: 'git diff > proof.txt',
    expectedAllow: true,
    reasonCode: 'policy_allowed',
    technique: 'stdout-redirection',
    source: 'issue-2275',
  },
];
