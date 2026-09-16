import type { ToolPolicyDecisionReason } from './gate.js';

/**
 * Deterministic escape-technique corpus for the tool-policy gate (issue #2275
 * §5). No LLM, no VM: every case is a `bash` command run through the real shell
 * analyzer and the real gate, with the decision asserted.
 *
 * The corpus has two jobs:
 *
 * 1. **Regression fence.** A change that widens the gate turns a `block` case
 *    into a failing test rather than a quiet policy hole.
 * 2. **Honest documentation of grant semantics.** Some cases are allowed *by
 *    design* because the operator asked for a broad grant. Those carry
 *    `documentsGrantBreadth: true` so a reader can tell "this is what you bought"
 *    from "this is contained".
 *
 * Adding a case: pick the fixture whose shape you are testing, run the command
 * through the gate, and record the decision you observe **only if it is the
 * decision you want**. A case whose observed decision is wrong does not belong
 * here with its observed value — see the note on unfixed gaps at the bottom.
 */

/** The policy shapes a case can be evaluated against. */
export type EscapePolicyShape =
  /** Structured tools only, no shell grants at all. */
  | 'no-shell'
  /** Tool grants that happen to share a name with a shell program. */
  | 'tool-grant-only'
  /** A multi-token argv-prefix rule: `ls -la`. */
  | 'narrow-shell'
  /** A three-token argv-prefix rule on a subcommand: `gh pr view`. */
  | 'multi-token-shell'
  /** One-token rules on programs whose flags can name another command. */
  | 'one-token-escape-flags'
  /** A one-token rule: `git`, i.e. "any git invocation". */
  | 'one-token-shell'
  /** A one-token rule on a GTFOBins-escapable program: `find`. */
  | 'one-token-escapable';

export interface EscapePolicyFixture {
  /** Runtime/MCP tool names the policy allows. */
  tools: string[];
  /** Shell argv-prefix rules, the only authority for shell invocations. */
  shellCommands: Array<{ argvPrefix: [string, ...string[]] }>;
}

/**
 * The policy each shape resolves to. The E2E suite creates real runtime
 * policies from these same values, so a live REST-resolved policy and the unit
 * fixture cannot drift apart.
 */
export const ESCAPE_POLICY_FIXTURES: Record<
  EscapePolicyShape,
  EscapePolicyFixture
> = {
  'no-shell': { tools: ['read'], shellCommands: [] },
  'tool-grant-only': {
    tools: ['ls', 'grep', 'find', 'gh', 'git'],
    shellCommands: [],
  },
  'narrow-shell': { tools: [], shellCommands: [{ argvPrefix: ['ls', '-la'] }] },
  'multi-token-shell': {
    tools: [],
    shellCommands: [{ argvPrefix: ['gh', 'pr', 'view'] }],
  },
  'one-token-escape-flags': {
    tools: [],
    shellCommands: [
      { argvPrefix: ['tar'] },
      { argvPrefix: ['rsync'] },
      { argvPrefix: ['ssh'] },
      { argvPrefix: ['scp'] },
      { argvPrefix: ['xargs'] },
    ],
  },
  'one-token-shell': { tools: [], shellCommands: [{ argvPrefix: ['git'] }] },
  'one-token-escapable': {
    tools: [],
    shellCommands: [{ argvPrefix: ['find'] }],
  },
};

export interface ToolPolicyEscapeCase {
  name: string;
  policyShape: EscapePolicyShape;
  command: string;
  expectedAllow: boolean;
  reasonCode: ToolPolicyDecisionReason;
  /** Executable names the decision must report, when it reports any. */
  missing?: string[];
  /** Short technique family, for grouping failures in test output. */
  technique: string;
  /**
   * Set when the case is allowed because the operator granted it broadly, not
   * because the gate contained anything. These are the cost of a broad rule,
   * stated out loud.
   */
  documentsGrantBreadth?: true;
  /** Included in the smaller live-policy E2E subset. */
  e2e?: true;
  source: string;
}

export const TOOL_POLICY_ESCAPE_CASES: ToolPolicyEscapeCase[] = [
  // ---------------------------------------------------------------- no-shell
  {
    name: 'a structured-tool-only policy authorizes no shell program',
    policyShape: 'no-shell',
    command: 'ls',
    expectedAllow: false,
    reasonCode: 'tool_not_permitted',
    missing: ['ls'],
    technique: 'plain-command',
    e2e: true,
    source: 'issue-2275',
  },
  {
    name: 'refuses a shell interpreter',
    policyShape: 'no-shell',
    command: 'sh -c ls',
    expectedAllow: false,
    reasonCode: 'arbitrary_code_interpreter',
    missing: ['sh'],
    technique: 'arbitrary-code-interpreter',
    e2e: true,
    source: 'issue-2275',
  },
  {
    name: 'refuses a language interpreter',
    policyShape: 'no-shell',
    command: 'python -c "print(1)"',
    expectedAllow: false,
    reasonCode: 'arbitrary_code_interpreter',
    missing: ['python'],
    technique: 'arbitrary-code-interpreter',
    source: 'issue-2275',
  },
  {
    name: 'refuses process substitution as unresolvable',
    policyShape: 'no-shell',
    command: 'diff <(ls) <(ls)',
    expectedAllow: false,
    reasonCode: 'shell_command_unresolvable',
    technique: 'process-substitution',
    source: 'issue-2275',
  },
  {
    name: 'resolves a heredoc body to its executable and refuses it',
    policyShape: 'no-shell',
    command: 'cat <<EOF\nhi\nEOF',
    expectedAllow: false,
    reasonCode: 'tool_not_permitted',
    missing: ['cat'],
    technique: 'heredoc',
    source: 'issue-2275',
  },
  {
    name: 'refuses a shell builtin that runs nothing',
    policyShape: 'no-shell',
    command: ':',
    expectedAllow: false,
    reasonCode: 'tool_not_permitted',
    missing: [':'],
    technique: 'null-builtin',
    source: 'issue-2275',
  },

  // -------------------------------------------------------- tool-grant-only
  // One property, exercised across the programs an operator is most likely to
  // list: a tool grant never authorizes a shell invocation of the same name.
  {
    name: 'a shell program granted only as a tool name is refused',
    policyShape: 'tool-grant-only',
    command: 'gh pr merge 1725',
    expectedAllow: false,
    reasonCode: 'tool_not_permitted',
    missing: ['gh'],
    technique: 'tool-name-as-executable',
    e2e: true,
    source: 'issue-2275',
  },
  {
    name: 'an ls tool grant does not authorize the ls program',
    policyShape: 'tool-grant-only',
    command: 'ls -la',
    expectedAllow: false,
    reasonCode: 'tool_not_permitted',
    missing: ['ls'],
    technique: 'tool-name-as-executable',
    source: 'issue-2275',
  },
  {
    name: 'a grep tool grant does not authorize the grep program',
    policyShape: 'tool-grant-only',
    command: 'grep needle missing',
    expectedAllow: false,
    reasonCode: 'tool_not_permitted',
    missing: ['grep'],
    technique: 'tool-name-as-executable',
    source: 'issue-2275',
  },
  {
    name: 'a find tool grant does not authorize a GTFOBins file write',
    policyShape: 'tool-grant-only',
    command: 'find . -fprint proof.txt',
    expectedAllow: false,
    reasonCode: 'tool_not_permitted',
    missing: ['find'],
    technique: 'gtfobins-file-write',
    source: 'issue-2275',
  },
  {
    name: 'a find tool grant does not authorize deletion',
    policyShape: 'tool-grant-only',
    command: 'find . -delete',
    expectedAllow: false,
    reasonCode: 'tool_not_permitted',
    missing: ['find'],
    technique: 'destructive-flag',
    source: 'issue-2275',
  },

  // ------------------------------------------------------------ narrow-shell
  // Rule: ['ls', '-la'].
  {
    name: 'allows the exact granted invocation',
    policyShape: 'narrow-shell',
    command: 'ls -la',
    expectedAllow: true,
    reasonCode: 'shell_command_prefix_allowed',
    technique: 'plain-command',
    e2e: true,
    source: 'issue-2275',
  },
  {
    name: 'a subshell does not change the invocation being authorized',
    policyShape: 'narrow-shell',
    command: '(ls -la)',
    expectedAllow: true,
    reasonCode: 'shell_command_prefix_allowed',
    technique: 'grouping',
    source: 'issue-2275',
  },
  {
    name: 'a brace group does not change the invocation being authorized',
    policyShape: 'narrow-shell',
    command: '{ ls -la; }',
    expectedAllow: true,
    reasonCode: 'shell_command_prefix_allowed',
    technique: 'grouping',
    source: 'issue-2275',
  },
  {
    name: 'every element of a sequence is authorized separately',
    policyShape: 'narrow-shell',
    command: 'ls -la; ls -la',
    expectedAllow: true,
    reasonCode: 'shell_command_prefix_allowed',
    technique: 'sequence',
    source: 'issue-2275',
  },
  {
    name: 'a benign environment assignment prefix does not hide the executable',
    policyShape: 'narrow-shell',
    command: 'LS_COLORS=x ls -la',
    expectedAllow: true,
    reasonCode: 'shell_command_prefix_allowed',
    technique: 'env-assignment-prefix',
    source: 'issue-2275',
  },
  {
    name: 'refuses a PATH prefix that could substitute the executable',
    policyShape: 'narrow-shell',
    // The rule matches `ls -la`, but PATH decides which `ls` that argv names.
    command: 'PATH=/tmp ls -la',
    expectedAllow: false,
    reasonCode: 'unsafe_environment_assignment',
    missing: ['PATH'],
    technique: 'env-assignment-prefix',
    e2e: true,
    source: 'issue-2275',
  },
  {
    name: 'refuses a loader preload prefix',
    policyShape: 'narrow-shell',
    command: 'LD_PRELOAD=/tmp/evil.so ls -la',
    expectedAllow: false,
    reasonCode: 'unsafe_environment_assignment',
    missing: ['LD_PRELOAD'],
    technique: 'env-assignment-prefix',
    source: 'issue-2275',
  },
  {
    name: 'refuses a loader search-path prefix',
    policyShape: 'narrow-shell',
    command: 'LD_LIBRARY_PATH=/tmp ls -la',
    expectedAllow: false,
    reasonCode: 'unsafe_environment_assignment',
    missing: ['LD_LIBRARY_PATH'],
    technique: 'env-assignment-prefix',
    source: 'issue-2275',
  },
  {
    name: 'refuses a shell startup-file prefix',
    policyShape: 'narrow-shell',
    command: 'BASH_ENV=/tmp/x ls -la',
    expectedAllow: false,
    reasonCode: 'unsafe_environment_assignment',
    missing: ['BASH_ENV'],
    technique: 'env-assignment-prefix',
    source: 'issue-2275',
  },
  {
    name: 'refuses a field-separator prefix',
    policyShape: 'narrow-shell',
    command: 'IFS=x ls -la',
    expectedAllow: false,
    reasonCode: 'unsafe_environment_assignment',
    missing: ['IFS'],
    technique: 'env-assignment-prefix',
    source: 'issue-2275',
  },
  {
    name: 'refuses an env wrapper the policy does not grant',
    policyShape: 'narrow-shell',
    command: 'env ls -la',
    expectedAllow: false,
    reasonCode: 'tool_not_permitted',
    missing: ['env'],
    technique: 'wrapper',
    e2e: true,
    source: 'issue-2275',
  },
  {
    name: 'refuses a timeout wrapper the policy does not grant',
    policyShape: 'narrow-shell',
    command: 'timeout 5 ls -la',
    expectedAllow: false,
    reasonCode: 'tool_not_permitted',
    missing: ['timeout'],
    technique: 'wrapper',
    source: 'issue-2275',
  },
  {
    name: 'refuses a nice wrapper the policy does not grant',
    policyShape: 'narrow-shell',
    command: 'nice ls -la',
    expectedAllow: false,
    reasonCode: 'tool_not_permitted',
    missing: ['nice'],
    technique: 'wrapper',
    source: 'issue-2275',
  },
  {
    name: 'refuses the command builtin used as a wrapper',
    policyShape: 'narrow-shell',
    command: 'command ls -la',
    expectedAllow: false,
    reasonCode: 'tool_not_permitted',
    missing: ['command'],
    technique: 'wrapper',
    source: 'issue-2275',
  },
  {
    name: 'refuses a backslash-escaped command name as unresolvable',
    policyShape: 'narrow-shell',
    command: '\\ls -la',
    expectedAllow: false,
    reasonCode: 'shell_command_unresolvable',
    technique: 'quoted-command-name',
    e2e: true,
    source: 'issue-2275',
  },
  {
    name: 'resolves a quoted command name rather than refusing it',
    policyShape: 'narrow-shell',
    // `"ls" -la` *is* `ls -la`, so matching the resolved argv is both correct
    // and safe: quoting cannot make a command resolve to something the rule
    // does not grant, it can only fail to hide what it does grant.
    command: '"ls" -la',
    expectedAllow: true,
    reasonCode: 'shell_command_prefix_allowed',
    technique: 'quoted-command-name',
    source: 'issue-2275',
  },
  {
    name: 'refuses a concatenated command name as unresolvable',
    policyShape: 'narrow-shell',
    command: "l''s -la",
    expectedAllow: false,
    reasonCode: 'shell_command_unresolvable',
    technique: 'quoted-command-name',
    source: 'issue-2275',
  },
  {
    name: 'refuses a command name built by substitution as unresolvable',
    policyShape: 'narrow-shell',
    command: '$(echo ls) -la',
    expectedAllow: false,
    reasonCode: 'shell_command_unresolvable',
    technique: 'command-substitution-name',
    source: 'issue-2275',
  },
  {
    name: 'fails closed on a quoted flag rather than normalizing it',
    policyShape: 'narrow-shell',
    // Semantically identical to the granted `ls -la`, and still refused: the
    // rule matches statically known tokens, so a quoted flag does not match.
    // Fail-closed is the intended direction for this ambiguity.
    command: 'ls -l"a"',
    expectedAllow: false,
    reasonCode: 'tool_not_permitted',
    missing: ['ls'],
    technique: 'quoted-flag',
    source: 'issue-2275',
  },
  {
    name: 'refuses stderr redirection despite a matching rule',
    policyShape: 'narrow-shell',
    command: 'ls -la 2> proof.txt',
    expectedAllow: false,
    reasonCode: 'shell_output_redirection_not_permitted',
    missing: ['ls'],
    technique: 'redirection',
    e2e: true,
    source: 'issue-2275',
  },
  {
    name: 'refuses append redirection despite a matching rule',
    policyShape: 'narrow-shell',
    command: 'ls -la >> proof.txt',
    expectedAllow: false,
    reasonCode: 'shell_output_redirection_not_permitted',
    missing: ['ls'],
    technique: 'redirection',
    source: 'issue-2275',
  },
  {
    name: 'refuses a file-descriptor duplication redirect',
    policyShape: 'narrow-shell',
    command: 'ls -la 1>&2',
    expectedAllow: false,
    reasonCode: 'shell_output_redirection_not_permitted',
    missing: ['ls'],
    technique: 'redirection-fd',
    source: 'issue-2275',
  },
  {
    name: 'refuses the shorthand file-descriptor redirect',
    policyShape: 'narrow-shell',
    command: 'ls -la >&2',
    expectedAllow: false,
    reasonCode: 'shell_output_redirection_not_permitted',
    missing: ['ls'],
    technique: 'redirection-fd',
    source: 'issue-2275',
  },
  {
    name: 'refuses reaching a writer through a pipe',
    policyShape: 'narrow-shell',
    command: 'ls -la | tee proof.txt',
    expectedAllow: false,
    reasonCode: 'tool_not_permitted',
    missing: ['tee'],
    technique: 'pipe-to-writer',
    source: 'issue-2275',
  },

  // --------------------------------------------------------- one-token-shell
  // Rule: ['git'] — "any git invocation".
  {
    name: 'a one-token rule allows any arguments to that program',
    policyShape: 'one-token-shell',
    command: 'git push origin main',
    expectedAllow: true,
    reasonCode: 'shell_command_prefix_allowed',
    technique: 'plain-command',
    documentsGrantBreadth: true,
    e2e: true,
    source: 'issue-2275',
  },
  {
    name: 'both sides of a pipe may match the same one-token rule',
    policyShape: 'one-token-shell',
    command: 'git status | git apply',
    expectedAllow: true,
    reasonCode: 'shell_command_prefix_allowed',
    technique: 'pipe',
    documentsGrantBreadth: true,
    source: 'issue-2275',
  },
  {
    name: 'refuses an interpreter reached through a git config override',
    policyShape: 'one-token-shell',
    command: 'git -c core.pager=sh log',
    expectedAllow: false,
    reasonCode: 'arbitrary_code_interpreter',
    missing: ['sh'],
    technique: 'arbitrary-code-interpreter',
    e2e: true,
    source: 'issue-2275',
  },
  {
    name: 'refuses an interpreter reached through a difftool escape flag',
    policyShape: 'one-token-shell',
    command: 'git difftool -x sh',
    expectedAllow: false,
    reasonCode: 'arbitrary_code_interpreter',
    missing: ['sh'],
    technique: 'arbitrary-code-interpreter',
    e2e: true,
    source: 'issue-2275',
  },
  {
    name: 'a quoted subcommand does not hide a scoped escape flag',
    policyShape: 'one-token-shell',
    command: 'git "difftool" -x sh',
    expectedAllow: false,
    reasonCode: 'arbitrary_code_interpreter',
    missing: ['sh'],
    technique: 'quoted-scope-evasion',
    e2e: true,
    source: 'issue-2275',
  },
  {
    name: 'a concatenated subcommand does not hide a scoped escape flag',
    policyShape: 'one-token-shell',
    command: 'git diff""tool -x sh',
    expectedAllow: false,
    reasonCode: 'arbitrary_code_interpreter',
    missing: ['sh'],
    technique: 'quoted-scope-evasion',
    source: 'issue-2275',
  },
  {
    name: 'a quoted flag does not hide a scoped escape flag',
    policyShape: 'one-token-shell',
    command: 'git difftool "-x" sh',
    expectedAllow: false,
    reasonCode: 'arbitrary_code_interpreter',
    missing: ['sh'],
    technique: 'quoted-scope-evasion',
    source: 'issue-2275',
  },
  {
    name: 'refuses an attached-form difftool escape flag',
    policyShape: 'one-token-shell',
    command: 'git difftool -xsh',
    expectedAllow: false,
    reasonCode: 'arbitrary_code_interpreter',
    missing: ['sh'],
    technique: 'attached-escape-flag',
    source: 'issue-2275',
  },
  {
    name: 'refuses an attached-form rebase escape flag',
    policyShape: 'one-token-shell',
    command: 'git rebase -xsh main',
    expectedAllow: false,
    reasonCode: 'arbitrary_code_interpreter',
    missing: ['sh'],
    technique: 'attached-escape-flag',
    source: 'issue-2275',
  },
  {
    name: 'refuses an inline-form filter-branch filter',
    policyShape: 'one-token-shell',
    command: 'git filter-branch --tree-filter=sh HEAD',
    expectedAllow: false,
    reasonCode: 'arbitrary_code_interpreter',
    missing: ['sh'],
    technique: 'attached-escape-flag',
    source: 'issue-2275',
  },
  {
    name: 'refuses a git program hook set through the environment',
    policyShape: 'one-token-shell',
    command: 'GIT_SSH_COMMAND=sh git fetch',
    expectedAllow: false,
    reasonCode: 'unsafe_environment_assignment',
    missing: ['GIT_SSH_COMMAND'],
    technique: 'env-assignment-prefix',
    source: 'issue-2275',
  },
  {
    name: 'a subcommand name used as a pathspec does not arm a scoped flag',
    policyShape: 'one-token-shell',
    // Everything after `--` is a path, never a subcommand.
    command: 'git log -- rebase',
    expectedAllow: true,
    reasonCode: 'shell_command_prefix_allowed',
    technique: 'scoped-flag-namesake',
    documentsGrantBreadth: true,
    source: 'issue-2275',
  },
  {
    name: 'refuses an interpreter reached through the long difftool flag',
    policyShape: 'one-token-shell',
    command: 'git difftool --extcmd=sh',
    expectedAllow: false,
    reasonCode: 'arbitrary_code_interpreter',
    missing: ['sh'],
    technique: 'arbitrary-code-interpreter',
    source: 'issue-2275',
  },
  {
    name: 'refuses an interpreter reached through a rebase exec flag',
    policyShape: 'one-token-shell',
    command: 'git rebase -x sh main',
    expectedAllow: false,
    reasonCode: 'arbitrary_code_interpreter',
    missing: ['sh'],
    technique: 'arbitrary-code-interpreter',
    source: 'issue-2275',
  },
  {
    name: 'refuses an interpreter reached through a filter-branch filter',
    policyShape: 'one-token-shell',
    command: 'git filter-branch --tree-filter sh HEAD',
    expectedAllow: false,
    reasonCode: 'arbitrary_code_interpreter',
    missing: ['sh'],
    technique: 'arbitrary-code-interpreter',
    source: 'issue-2275',
  },
  {
    name: 'refuses an interpreter reached through a sequence-editor override',
    policyShape: 'one-token-shell',
    command: 'git -c sequence.editor=sh rebase -i',
    expectedAllow: false,
    reasonCode: 'arbitrary_code_interpreter',
    missing: ['sh'],
    technique: 'arbitrary-code-interpreter',
    source: 'issue-2275',
  },
  {
    name: 'refuses an interpreter reached through a credential-helper override',
    policyShape: 'one-token-shell',
    command: 'git -c credential.helper=sh fetch',
    expectedAllow: false,
    reasonCode: 'arbitrary_code_interpreter',
    missing: ['sh'],
    technique: 'arbitrary-code-interpreter',
    source: 'issue-2275',
  },
  {
    name: 'a scoped escape flag does not refuse its benign namesake',
    policyShape: 'one-token-shell',
    // `git clean -x` takes no value: the fix for the flags above must not turn
    // an ordinary clean into a refusal.
    command: 'git clean -x -d',
    expectedAllow: true,
    reasonCode: 'shell_command_prefix_allowed',
    technique: 'scoped-flag-namesake',
    documentsGrantBreadth: true,
    e2e: true,
    source: 'issue-2275',
  },
  {
    name: 'refuses redirection even under a one-token rule',
    policyShape: 'one-token-shell',
    command: 'git diff > proof.txt',
    expectedAllow: false,
    reasonCode: 'shell_output_redirection_not_permitted',
    missing: ['git'],
    technique: 'redirection',
    source: 'issue-2275',
  },
  {
    name: 'refuses an xargs wrapper around a granted program',
    policyShape: 'one-token-shell',
    command: 'xargs git',
    expectedAllow: false,
    reasonCode: 'tool_not_permitted',
    missing: ['xargs'],
    technique: 'wrapper',
    source: 'issue-2275',
  },

  // ------------------------------------------------------ multi-token-shell
  // Rule: ['gh', 'pr', 'view'] — a subcommand path, the shape an operator
  // reaches for when a program's own verbs carry the authority distinction.
  {
    name: 'allows an invocation that extends the granted prefix',
    policyShape: 'multi-token-shell',
    command: 'gh pr view 1725',
    expectedAllow: true,
    reasonCode: 'shell_command_prefix_allowed',
    technique: 'plain-command',
    e2e: true,
    source: 'issue-2275',
  },
  {
    name: 'allows an invocation exactly as long as the granted prefix',
    policyShape: 'multi-token-shell',
    command: 'gh pr view',
    expectedAllow: true,
    reasonCode: 'shell_command_prefix_allowed',
    technique: 'plain-command',
    source: 'issue-2275',
  },
  {
    name: 'refuses a sibling subcommand under the same program',
    policyShape: 'multi-token-shell',
    command: 'gh pr merge 1725',
    expectedAllow: false,
    reasonCode: 'tool_not_permitted',
    missing: ['gh'],
    technique: 'sibling-subcommand',
    e2e: true,
    source: 'issue-2275',
  },
  {
    name: 'refuses an invocation shorter than the granted prefix',
    policyShape: 'multi-token-shell',
    command: 'gh pr',
    expectedAllow: false,
    reasonCode: 'tool_not_permitted',
    missing: ['gh'],
    technique: 'short-of-prefix',
    source: 'issue-2275',
  },
  {
    name: 'refuses the bare program under a subcommand-path rule',
    policyShape: 'multi-token-shell',
    command: 'gh',
    expectedAllow: false,
    reasonCode: 'tool_not_permitted',
    missing: ['gh'],
    technique: 'short-of-prefix',
    source: 'issue-2275',
  },
  {
    name: 'refuses redirection under a subcommand-path rule',
    policyShape: 'multi-token-shell',
    command: 'gh pr view 1725 > out.txt',
    expectedAllow: false,
    reasonCode: 'shell_output_redirection_not_permitted',
    missing: ['gh'],
    technique: 'redirection',
    source: 'issue-2275',
  },
  {
    name: 'refuses a wrapper around a granted subcommand path',
    policyShape: 'multi-token-shell',
    command: 'env gh pr view 1725',
    expectedAllow: false,
    reasonCode: 'tool_not_permitted',
    missing: ['env'],
    technique: 'wrapper',
    source: 'issue-2275',
  },
  {
    name: 'a dynamic token after the prefix does not break the match',
    policyShape: 'multi-token-shell',
    // The rule constrains the prefix only, so arguments beyond it are free —
    // including ones the analyzer cannot resolve statically.
    command: 'gh pr view "$NUM"',
    expectedAllow: true,
    reasonCode: 'shell_command_prefix_allowed',
    technique: 'dynamic-trailing-token',
    documentsGrantBreadth: true,
    source: 'issue-2275',
  },
  {
    name: 'every invocation in a compound must match, not just the first',
    policyShape: 'multi-token-shell',
    command: 'gh pr view 1 && gh pr merge 1',
    expectedAllow: false,
    reasonCode: 'tool_not_permitted',
    missing: ['gh'],
    technique: 'compound-partial-match',
    e2e: true,
    source: 'issue-2275',
  },

  // -------------------------------------------------- one-token-escape-flags
  // One-token rules on tar, rsync, ssh, scp and xargs. Each program is granted
  // broadly, and each can be told to run another program through a flag — the
  // case the analyzer's escape-flag table exists for.
  {
    name: 'a one-token tar rule allows an ordinary archive',
    policyShape: 'one-token-escape-flags',
    command: 'tar -cf a.tar dir',
    expectedAllow: true,
    reasonCode: 'shell_command_prefix_allowed',
    technique: 'plain-command',
    documentsGrantBreadth: true,
    source: 'issue-2275',
  },
  {
    name: 'refuses an interpreter passed to tar --to-command',
    policyShape: 'one-token-escape-flags',
    command: "tar --to-command='sh -c id' -cf a.tar dir",
    expectedAllow: false,
    reasonCode: 'arbitrary_code_interpreter',
    missing: ['sh'],
    technique: 'arbitrary-code-interpreter',
    e2e: true,
    source: 'issue-2275',
  },
  {
    name: 'refuses an interpreter passed to a tar checkpoint action',
    policyShape: 'one-token-escape-flags',
    command: 'tar --checkpoint-action=exec=sh -cf a.tar d',
    expectedAllow: false,
    reasonCode: 'arbitrary_code_interpreter',
    missing: ['sh'],
    technique: 'arbitrary-code-interpreter',
    source: 'issue-2275',
  },
  {
    name: 'a one-token rsync rule allows an ordinary sync',
    policyShape: 'one-token-escape-flags',
    command: 'rsync -a src dst',
    expectedAllow: true,
    reasonCode: 'shell_command_prefix_allowed',
    technique: 'plain-command',
    documentsGrantBreadth: true,
    source: 'issue-2275',
  },
  {
    name: 'refuses an interpreter passed as the rsync remote shell',
    policyShape: 'one-token-escape-flags',
    command: 'rsync -e sh host:/x /y',
    expectedAllow: false,
    reasonCode: 'arbitrary_code_interpreter',
    missing: ['sh'],
    technique: 'arbitrary-code-interpreter',
    source: 'issue-2275',
  },
  {
    name: 'refuses an interpreter passed as the inline rsync remote shell',
    policyShape: 'one-token-escape-flags',
    command: 'rsync --rsh=sh host:/x /y',
    expectedAllow: false,
    reasonCode: 'arbitrary_code_interpreter',
    missing: ['sh'],
    technique: 'arbitrary-code-interpreter',
    source: 'issue-2275',
  },
  {
    name: 'a one-token ssh rule allows an ordinary connection',
    policyShape: 'one-token-escape-flags',
    command: 'ssh host',
    expectedAllow: true,
    reasonCode: 'shell_command_prefix_allowed',
    technique: 'plain-command',
    documentsGrantBreadth: true,
    source: 'issue-2275',
  },
  {
    name: 'refuses an interpreter passed as an ssh proxy command',
    policyShape: 'one-token-escape-flags',
    command: 'ssh -o ProxyCommand=sh host',
    expectedAllow: false,
    reasonCode: 'arbitrary_code_interpreter',
    missing: ['sh'],
    technique: 'arbitrary-code-interpreter',
    source: 'issue-2275',
  },
  {
    name: 'refuses an attached-form ssh proxy command',
    policyShape: 'one-token-escape-flags',
    command: 'ssh -oProxyCommand=sh host',
    expectedAllow: false,
    reasonCode: 'arbitrary_code_interpreter',
    missing: ['sh'],
    technique: 'attached-escape-flag',
    source: 'issue-2275',
  },
  {
    name: 'a benign ssh option is not mistaken for a command',
    policyShape: 'one-token-escape-flags',
    command: 'ssh -o StrictHostKeyChecking=no host',
    expectedAllow: true,
    reasonCode: 'shell_command_prefix_allowed',
    technique: 'benign-keyed-option',
    documentsGrantBreadth: true,
    source: 'issue-2275',
  },
  {
    name: 'refuses an interpreter passed as the scp transfer program',
    policyShape: 'one-token-escape-flags',
    command: 'scp -S sh a b',
    expectedAllow: false,
    reasonCode: 'arbitrary_code_interpreter',
    missing: ['sh'],
    technique: 'arbitrary-code-interpreter',
    source: 'issue-2275',
  },
  {
    name: 'refuses an attached-form scp transfer program',
    policyShape: 'one-token-escape-flags',
    command: 'scp -Ssh a b',
    expectedAllow: false,
    reasonCode: 'arbitrary_code_interpreter',
    missing: ['sh'],
    technique: 'attached-escape-flag',
    source: 'issue-2275',
  },
  {
    name: 'refuses an interpreter launched by a granted xargs',
    policyShape: 'one-token-escape-flags',
    command: 'xargs sh',
    expectedAllow: false,
    reasonCode: 'arbitrary_code_interpreter',
    missing: ['sh'],
    technique: 'wrapper',
    source: 'issue-2275',
  },
  {
    name: 'refuses redirection under a one-token escapable grant',
    policyShape: 'one-token-escape-flags',
    command: 'tar -cf a.tar dir > out.txt',
    expectedAllow: false,
    reasonCode: 'shell_output_redirection_not_permitted',
    missing: ['tar'],
    technique: 'redirection',
    source: 'issue-2275',
  },

  // ----------------------------------------------------- one-token-escapable
  // Rule: ['find'] on a program GTFOBins documents as able to write files and
  // launch other programs. These cases state the cost of that grant plainly.
  {
    name: 'a one-token find rule permits a GTFOBins file write',
    policyShape: 'one-token-escapable',
    command: 'find . -fprint proof.txt',
    expectedAllow: true,
    reasonCode: 'shell_command_prefix_allowed',
    technique: 'gtfobins-file-write',
    documentsGrantBreadth: true,
    source: 'issue-2275',
  },
  {
    name: 'a one-token find rule permits deletion',
    policyShape: 'one-token-escapable',
    command: 'find . -delete',
    expectedAllow: true,
    reasonCode: 'shell_command_prefix_allowed',
    technique: 'destructive-flag',
    documentsGrantBreadth: true,
    source: 'issue-2275',
  },
  {
    name: 'a nested -exec program must itself be authorized',
    policyShape: 'one-token-escapable',
    // The analyzer resolves `-exec`'s program, so granting `find` does not
    // silently grant everything `find` can launch.
    command: 'find . -exec cat {} ;',
    expectedAllow: false,
    reasonCode: 'tool_not_permitted',
    missing: ['cat'],
    technique: 'nested-exec',
    e2e: true,
    source: 'issue-2275',
  },
  {
    name: 'refuses an interpreter launched through -exec',
    policyShape: 'one-token-escapable',
    command: 'find . -exec sh -c ls ;',
    expectedAllow: false,
    reasonCode: 'arbitrary_code_interpreter',
    missing: ['sh'],
    technique: 'arbitrary-code-interpreter',
    source: 'issue-2275',
  },
];

/** The smaller subset the live-policy E2E replays against real runtime policies. */
export const TOOL_POLICY_ESCAPE_E2E_CASES = TOOL_POLICY_ESCAPE_CASES.filter(
  (testCase) => testCase.e2e === true,
);
