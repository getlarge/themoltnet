import {
  chmod,
  cp,
  mkdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

/** Pinned to the release tag — updated by release-please. */
const SKILL_VERSION = 'main';

interface SkillDefinition {
  name: string;
  files: string[];
}

/** Canonical source-of-truth directory for skill files (see CANONICAL_SKILL_DIR). */
const SKILL_SOURCE_DIR = '.agents/skills';

function skillFileUrl(name: string, ref: string, file: string): string {
  return `https://raw.githubusercontent.com/getlarge/themoltnet/${ref}/${SKILL_SOURCE_DIR}/${name}/${file}`;
}

const SKILLS: SkillDefinition[] = [
  { name: 'legreffier', files: ['SKILL.md'] },
  {
    name: 'legreffier-explore',
    files: ['SKILL.md', 'references/exploration-pack-plan.yaml'],
  },
  {
    name: 'legreffier-onboarding',
    files: ['SKILL.md'],
  },
];

async function downloadSkillFiles(
  skill: SkillDefinition,
): Promise<Map<string, string>> {
  const ref = SKILL_VERSION;
  const files = new Map<string, string>();

  for (const file of skill.files) {
    const url = skillFileUrl(skill.name, ref, file);
    let res: Response;
    try {
      res = await fetch(url);
    } catch (err) {
      throw new Error(
        `Failed to download skill "${skill.name}" file "${file}" from ${url}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!res.ok) {
      throw new Error(
        `Failed to download skill "${skill.name}" file "${file}" from ${url}: HTTP ${res.status}`,
      );
    }

    files.set(file, await res.text());
  }

  return files;
}

/**
 * Install MoltNet skills into the given skill directory.
 * Fetches from GitHub pinned to the CLI release tag.
 *
 * @param repoDir - Root of the target repository
 * @param skillDir - Relative path for skill files (e.g. '.claude/skills', '.agents/skills')
 */
/**
 * Install MoltNet skills into the given skill directory.
 * Fetches from GitHub pinned to the CLI release tag.
 *
 * @param repoDir - Root of the target repository
 * @param skillDir - Relative path for skill files (e.g. '.claude/skills', '.agents/skills')
 * @throws when any skill file cannot be downloaded — setup must not silently
 *   report success when skills are missing (issue #1867).
 */
export async function downloadSkills(
  repoDir: string,
  skillDir: string,
): Promise<void> {
  for (const skill of SKILLS) {
    const files = await downloadSkillFiles(skill);

    const destDir = join(repoDir, skillDir, skill.name);
    await mkdir(destDir, { recursive: true });

    for (const [file, content] of files) {
      const filePath = join(destDir, file);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, content, 'utf-8');
    }
  }
}

/**
 * Canonical, single-source-of-truth location for installed skills.
 *
 * Every managed agent tree links back to this directory instead of holding a
 * duplicate copy: Codex reads `.agents/skills/` natively, opencode discovers it
 * natively too, and Claude's `.claude/skills/` is populated with relative
 * symlinks into here. Storing the real bytes once avoids drift between trees
 * (see issue #1393).
 */
export const CANONICAL_SKILL_DIR = '.agents/skills';

const GITHUB_GUARD_CLI_COMMAND = 'moltnet github guard';
const SECRET_GUARD_CLI_COMMAND = 'moltnet secrets guard';

export const GITHUB_GUARD_HOOK_COMMAND = `command -v moltnet >/dev/null 2>&1 && ${GITHUB_GUARD_CLI_COMMAND} 2>/dev/null || true`;

export const CLAUDE_GITHUB_GUARD_HOOK_COMMAND =
  '"$CLAUDE_PROJECT_DIR"/.claude/hooks/moltnet-github-guard.sh';

export const CLAUDE_GITHUB_GUARD_HOOK_SCRIPT = `#!/bin/sh
command -v moltnet >/dev/null 2>&1 || exit 0
${GITHUB_GUARD_CLI_COMMAND} 2>/dev/null || true
`;

export const SECRET_GUARD_HOOK_COMMAND = SECRET_GUARD_CLI_COMMAND;
export const CLAUDE_SECRET_GUARD_HOOK_COMMAND =
  '"$CLAUDE_PROJECT_DIR"/.claude/hooks/moltnet-secret-guard.sh';
export const CLAUDE_SECRET_GUARD_HOOK_SCRIPT = `#!/bin/sh
deny='{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"MoltNet secret guard is unavailable; protected credential access is blocked."}}'
command -v moltnet >/dev/null 2>&1 || { printf '%s\\n' "$deny"; exit 0; }
${SECRET_GUARD_CLI_COMMAND} 2>/dev/null || printf '%s\\n' "$deny"
`;

interface CommandHook {
  type: 'command';
  command: string;
}

interface ToolHookMatcher {
  matcher: string;
  hooks: CommandHook[];
}

interface HookSettings {
  PreToolUse?: ToolHookMatcher[];
  [event: string]: unknown;
}

export function mergeGitHubGuardHook(
  hooks: unknown,
  command = GITHUB_GUARD_HOOK_COMMAND,
): HookSettings {
  return mergePreToolUseGuard(hooks, {
    matchers: ['Bash'],
    command,
    placement: 'append',
    isManaged: isGitHubGuardHook,
  });
}

const SECRET_GUARD_MATCHERS = [
  'Bash',
  'Read',
  'Grep',
  'Write',
  'Edit',
  'Glob',
  'apply_patch',
];

export function mergeSecretGuardHook(
  hooks: unknown,
  command = SECRET_GUARD_HOOK_COMMAND,
): HookSettings {
  return mergePreToolUseGuard(hooks, {
    matchers: SECRET_GUARD_MATCHERS,
    command,
    placement: 'prepend',
    isManaged: isSecretGuardHook,
  });
}

interface GuardHookSpec {
  matchers: string[];
  command: string;
  placement: 'prepend' | 'append';
  isManaged: (hook: unknown) => boolean;
}

function mergePreToolUseGuard(
  hooks: unknown,
  spec: GuardHookSpec,
): HookSettings {
  const existing =
    hooks && typeof hooks === 'object' && !Array.isArray(hooks)
      ? (hooks as HookSettings)
      : {};
  const preToolUse = Array.isArray(existing.PreToolUse)
    ? existing.PreToolUse.map((entry) => ({
        ...entry,
        hooks: Array.isArray(entry.hooks)
          ? entry.hooks.filter((hook) => !spec.isManaged(hook))
          : [],
      }))
    : [];

  for (const matcher of spec.matchers) {
    const index = preToolUse.findIndex((entry) => entry.matcher === matcher);
    if (index >= 0) {
      const guard = { type: 'command' as const, command: spec.command };
      preToolUse[index] = {
        ...preToolUse[index],
        hooks:
          spec.placement === 'prepend'
            ? [guard, ...preToolUse[index].hooks]
            : [...preToolUse[index].hooks, guard],
      };
    } else {
      preToolUse.push({
        matcher,
        hooks: [{ type: 'command', command: spec.command }],
      });
    }
  }

  return { ...existing, PreToolUse: preToolUse };
}

function hookCommand(hook: unknown): string | undefined {
  if (!hook || typeof hook !== 'object' || !('command' in hook)) return;
  return typeof hook.command === 'string' ? hook.command.trim() : undefined;
}

function isGitHubGuardHook(hook: unknown): boolean {
  const command = hookCommand(hook);
  return (
    command === GITHUB_GUARD_CLI_COMMAND ||
    command === GITHUB_GUARD_HOOK_COMMAND ||
    command === CLAUDE_GITHUB_GUARD_HOOK_COMMAND
  );
}

function isSecretGuardHook(hook: unknown): boolean {
  const command = hookCommand(hook);
  return (
    command === SECRET_GUARD_HOOK_COMMAND ||
    command === CLAUDE_SECRET_GUARD_HOOK_COMMAND
  );
}

/** Register the shared Claude guard and install its executable hook script. */
export async function writeClaudeGuardHook(repoDir: string): Promise<void> {
  const dir = join(repoDir, '.claude');
  const hooksDir = join(dir, 'hooks');
  const scriptPath = join(hooksDir, 'moltnet-github-guard.sh');
  const secretScriptPath = join(hooksDir, 'moltnet-secret-guard.sh');
  const settingsPath = join(dir, 'settings.json');
  await mkdir(hooksDir, { recursive: true });
  await writeFile(scriptPath, CLAUDE_GITHUB_GUARD_HOOK_SCRIPT, 'utf-8');
  await chmod(scriptPath, 0o755);
  await writeFile(secretScriptPath, CLAUDE_SECRET_GUARD_HOOK_SCRIPT, 'utf-8');
  await chmod(secretScriptPath, 0o755);

  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(await readFile(settingsPath, 'utf-8')) as Record<
      string,
      unknown
    >;
  } catch {
    // file doesn't exist or isn't valid JSON — start fresh
  }

  await writeFile(
    settingsPath,
    JSON.stringify(
      {
        ...existing,
        hooks: mergeGitHubGuardHook(
          mergeSecretGuardHook(
            existing.hooks,
            CLAUDE_SECRET_GUARD_HOOK_COMMAND,
          ),
          CLAUDE_GITHUB_GUARD_HOOK_COMMAND,
        ),
      },
      null,
      2,
    ) + '\n',
    'utf-8',
  );
}

/**
 * Install the canonical skill tree under `.agents/skills/` (real files).
 * Idempotent — re-running overwrites files with the latest release payload.
 */
export async function installCanonicalSkills(repoDir: string): Promise<void> {
  await downloadSkills(repoDir, CANONICAL_SKILL_DIR);
}

/**
 * Link an agent's skill directory to the canonical `.agents/skills/` copy.
 *
 * Creates one **relative** symlink per skill — `<skillDir>/<name>` →
 * `../../.agents/skills/<name>` — so heavy skill payloads are stored once and
 * the link resolves in fresh clones and git worktrees. Skills missing from the
 * canonical tree (e.g. a failed download) are skipped silently; the missing
 * payload was already warned about by `installCanonicalSkills`.
 *
 * Falls back to copying the real files (with a warning) when the platform
 * cannot create symlinks — e.g. Windows checkouts without developer mode or
 * `git config core.symlinks=false`. A no-op when `skillDir` is the canonical
 * dir itself.
 */
export async function linkSkills(
  repoDir: string,
  skillDir: string,
): Promise<void> {
  if (skillDir === CANONICAL_SKILL_DIR) return;

  for (const skill of SKILLS) {
    const canonicalPath = join(repoDir, CANONICAL_SKILL_DIR, skill.name);
    try {
      await stat(canonicalPath);
    } catch {
      // Canonical copy missing (download failed/skipped) — nothing to link to.
      continue;
    }

    const linkPath = join(repoDir, skillDir, skill.name);
    await mkdir(dirname(linkPath), { recursive: true });
    // Replace any stale link, real dir, or copy left by a previous run so the
    // link is recreated cleanly and points at the current canonical tree.
    await rm(linkPath, { recursive: true, force: true });

    const relTarget = relative(dirname(linkPath), canonicalPath);
    try {
      await symlink(relTarget, linkPath, 'dir');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'ENOSYS') {
        process.stderr.write(
          `Warning: symlinks unsupported on this platform; copying skill "${skill.name}" into ${skillDir} instead.\n`,
        );
        await cp(canonicalPath, linkPath, { recursive: true });
      } else {
        throw err;
      }
    }
  }
}

export function buildGhTokenRule(): string {
  return [
    '# GitHub CLI Authentication (MoltNet agents)',
    '',
    '> **STRICT RULE — keep the generated `PreToolUse` guard enabled.**',
    '',
    'LeGreffier setup installs `moltnet github guard` for Bash tool calls in both',
    'Claude Code and Codex. The guard parses each shell command independently and:',
    '',
    '- allows read-only `gh` operations;',
    '- allows writes carrying a command-scoped MoltNet-issued `GH_TOKEN`;',
    '- denies a bare write when the GitHub App has the required write capability;',
    '- allows the user token as a fallback when the App installation explicitly',
    '  lacks the required permission;',
    '- allows bare visible `gh pr` and `gh issue` writes in `human` authorship mode;',
    '- denies unknown commands, while GraphQL mutations require a scoped token;',
    '- resolves shell variables assigned to **statically determinable** values, so a',
    '  scoped token, endpoint, or payload passed via `$VAR` (e.g.',
    '  `--credentials "$CREDS"`, `--input "$JSON"`) is verified without executing',
    '  anything. A value derived from a command substitution (`$(dirname …)`), or a',
    '  variable assigned more than once (including a conditional `case` re-assignment),',
    '  stays opaque and is denied — the guard never runs shell to learn it.',
    '',
    'Installation permissions are cached with the token in `gh-token-cache.json`.',
    'Writes are atomic, and refresh failures are cached briefly to avoid retry storms.',
    'The first relevant write lazily refreshes legacy or expired cache state. By',
    'default unavailable optional permission state fails open silently; set',
    '`MOLTNET_GITHUB_GUARD_STRICT=1` to fail closed instead. Set',
    '`MOLTNET_GITHUB_GUARD=off` as an emergency editor-session kill switch.',
    '',
    'For writes the App can perform, use the first-class execution wrapper',
    '(recommended — the guard recognises it structurally, no shell variable',
    'provenance required):',
    '',
    '```bash',
    'moltnet github exec -- gh <command>',
    '# or, if `moltnet` is not installed:',
    'npx @themoltnet/cli github exec -- gh <command>',
    '```',
    '',
    'This resolves credentials from the activated context, mints a command-scoped',
    'App token, and runs exactly one `gh` child process. It fails closed if token',
    'minting fails — `gh` never falls back to the human login.',
    '',
    'Alternatively, use the manual command-scoped form (the guard verifies the',
    'token when the credentials path is a literal or single statically-assigned',
    'variable):',
    '',
    '```bash',
    'CFG="$GIT_CONFIG_GLOBAL"',
    'case "$CFG" in /*) ;; *) CFG="$(git rev-parse --show-toplevel)/$CFG" ;; esac',
    'CREDS="$(dirname "$CFG")/moltnet.json"',
    '[ -f "$CREDS" ] || { echo "FATAL: moltnet.json not found at $CREDS" >&2; exit 1; }',
    'GH_TOKEN=$(moltnet github token --credentials "$CREDS") gh <command>',
    '# Published CLI fallback:',
    'GH_TOKEN=$(npx @themoltnet/cli github token --credentials "$CREDS") gh <command>',
    '```',
    '',
    'The `$(dirname "$CFG")` derivation above is dynamic, so the guard cannot',
    'pre-verify the token minted from it — it will fall through to the normal',
    '"attribute with a scoped token" deny when the App holds the permission. When you',
    'need the guard to attribute the token (for example submitting a multi-comment PR',
    'review via `gh api`, the only endpoint that carries line-anchored threads), pass',
    'the credentials path as a literal or a single statically-assigned variable so the',
    'guard can verify it:',
    '',
    '```bash',
    '# Absolute creds path assigned once, statically → the guard verifies the token.',
    'CREDS=/abs/path/.moltnet/<AGENT_NAME>/moltnet.json',
    'GH_TOKEN=$(moltnet github token --credentials "$CREDS") \\',
    '  gh api --method POST repos/<owner>/<repo>/pulls/<N>/reviews --input review.json',
    '```',
    '',
    'The token assignment authorizes only that `gh` process. It must not authorize a',
    'different `gh` command later in a chain. Never use an empty or unverified token',
    'substitution: `gh` would silently fall back to the human login.',
    '',
  ].join('\n');
}

/**
 * Single source of truth for MoltNet CLI sub-commands that the legreffier
 * skill needs to run outside the Codex sandbox. Both `buildCodexRules` and
 * `buildPermissions` derive their native `moltnet …` and `npx @themoltnet/cli
 * …` entries from this matrix so the two invocation forms cannot drift (issue
 * #1877).
 */
interface CliAllowEntry {
  /** Sub-command path after the binary, e.g. ["diary", "list"]. */
  command: string[];
  /** Human-readable comment used in the generated rules file. */
  comment: string;
}

const MOLTNET_CLI_ALLOWLIST: CliAllowEntry[] = [
  // Signing & entry workflow
  { command: ['sign'], comment: 'Signing' },
  { command: ['entry', 'commit'], comment: 'Entry commit' },
  { command: ['entry', 'create-signed'], comment: 'Entry create-signed' },
  { command: ['entry', 'verify'], comment: 'Entry verify' },
  { command: ['github', 'token'], comment: 'GitHub token generation' },
  { command: ['github', 'exec'], comment: 'GitHub exec wrapper (issue #1824)' },
  { command: ['agents', 'activation'], comment: 'Agent activation' },
  // Diary memory reads (issue #1877)
  { command: ['diary', 'list'], comment: 'Diary list' },
  { command: ['diary', 'get'], comment: 'Diary get' },
  { command: ['diary', 'tags'], comment: 'Diary tags' },
  { command: ['entry', 'list'], comment: 'Entry list' },
  { command: ['entry', 'get'], comment: 'Entry get' },
  { command: ['entry', 'search'], comment: 'Entry search' },
  { command: ['relations', 'list'], comment: 'Relations list' },
  // Task reads
  { command: ['task', 'list'], comment: 'Task list' },
  { command: ['task', 'get'], comment: 'Task get' },
  { command: ['task', 'attempts'], comment: 'Task attempts' },
  { command: ['task', 'tail'], comment: 'Task tail' },
  // Pack reads
  { command: ['pack', 'list'], comment: 'Pack list' },
  { command: ['pack', 'get'], comment: 'Pack get' },
  { command: ['rendered-pack', 'list'], comment: 'Rendered-pack list' },
  { command: ['rendered-pack', 'get'], comment: 'Rendered-pack get' },
];

/** Build a Starlark prefix_rule pattern for the native `moltnet` binary. */
function nativePattern(command: string[]): string {
  return '[' + ['"moltnet"', ...command.map((c) => `"${c}"`)].join(', ') + ']';
}

/** Build a Starlark prefix_rule pattern for `npx @themoltnet/cli`. */
function npxPattern(command: string[]): string {
  return (
    '[' +
    ['"npx"', '"@themoltnet/cli"', ...command.map((c) => `"${c}"`)].join(', ') +
    ']'
  );
}

/** Build a Claude `Bash(…)` permission string for the native binary. */
function nativePermission(command: string[]): string {
  return `Bash(moltnet ${command.join(' ')} *)`;
}

/** Build a Claude `Bash(…)` permission string for the npx form. */
function npxPermission(command: string[]): string {
  return `Bash(npx @themoltnet/cli ${command.join(' ')} *)`;
}

/**
 * Build a Starlark `.rules` file for Codex with prefix_rule() entries
 * that allow the commands the legreffier skill needs.
 *
 * Codex loads project rules at startup. After regenerating this file, the
 * operator must restart the trusted project session for the new rules to take
 * effect (issue #1877).
 */
export function buildCodexRules(_agentName: string): string {
  const lines: string[] = [
    '# Codex sandbox rules for LeGreffier',
    '#',
    '# Allow the commands that the legreffier skill needs to run.',
    '# The GitHub guard owns authorship policy; these rules only reduce prompts.',
    '#',
    '# After regenerating this file, restart the Codex trusted project session',
    '# so the new rules are loaded (Codex reads project rules at startup only).',
    '',
    '# Read-only git commands (session activation & commit workflow)',
    'prefix_rule(',
    '    pattern = ["git", "config"],',
    '    decision = "allow",',
    ')',
    'prefix_rule(',
    '    pattern = ["git", "diff"],',
    '    decision = "allow",',
    ')',
    'prefix_rule(',
    '    pattern = ["git", "log"],',
    '    decision = "allow",',
    ')',
    'prefix_rule(',
    '    pattern = ["git", "rev-parse"],',
    '    decision = "allow",',
    ')',
    'prefix_rule(',
    '    pattern = ["git", "worktree", "list"],',
    '    decision = "allow",',
    ')',
    '',
    '# MoltNet CLI — signing, entry, memory reads, & token generation',
    '# Native binary and npx forms are generated from the same allowlist.',
  ];

  for (const entry of MOLTNET_CLI_ALLOWLIST) {
    lines.push(`# ${entry.comment}`);
    lines.push('prefix_rule(');
    lines.push(`    pattern = ${nativePattern(entry.command)},`);
    lines.push('    decision = "allow",');
    lines.push(')');
    lines.push('prefix_rule(');
    lines.push(`    pattern = ${npxPattern(entry.command)},`);
    lines.push('    decision = "allow",');
    lines.push(')');
  }

  lines.push(
    '',
    '# GitHub CLI — read-only subcommands (write ops prompt the user)',
    'prefix_rule(',
    '    pattern = ["gh", "pr", "view"],',
    '    decision = "allow",',
    ')',
    'prefix_rule(',
    '    pattern = ["gh", "pr", "list"],',
    '    decision = "allow",',
    ')',
    'prefix_rule(',
    '    pattern = ["gh", "issue", "view"],',
    '    decision = "allow",',
    ')',
    'prefix_rule(',
    '    pattern = ["gh", "issue", "list"],',
    '    decision = "allow",',
    ')',
    'prefix_rule(',
    '    pattern = ["gh", "repo", "view"],',
    '    decision = "allow",',
    ')',
    '',
    '# Worktree symlink creation',
    'prefix_rule(',
    '    pattern = ["ln", "-s"],',
    '    decision = "allow",',
    ')',
    '',
    '# Session activation env export',
    'prefix_rule(',
    '    pattern = ["echo"],',
    '    decision = "allow",',
    ')',
    '',
  );

  return lines.join('\n');
}

export interface SettingsLocalOptions {
  repoDir: string;
  agentName: string;
  appId: string;
  pemPath: string;
  installationId: string;
  clientId: string;
  /** @deprecated Secrets are injected by `moltnet start`, never persisted. */
  clientSecret?: string;
}

/** Build the permission allow-list for the legreffier skill. */
export function buildPermissions(agentName: string): string[] {
  const perms: string[] = [
    // Read-only git commands used by session activation & commit workflow
    'Bash(git config *)',
    'Bash(git diff *)',
    'Bash(git log *)',
    'Bash(git rev-parse *)',
    'Bash(git worktree list)',
  ];

  // MoltNet CLI commands — native and npx forms derived from the same
  // allowlist so they cannot drift (issue #1877).
  for (const entry of MOLTNET_CLI_ALLOWLIST) {
    perms.push(nativePermission(entry.command));
    perms.push(npxPermission(entry.command));
  }

  perms.push(
    // Worktree symlink creation
    'Bash(ln -s *)',
    // Session activation env export
    'Bash(echo "GIT_CONFIG_GLOBAL=*")',
    // All MCP tools for this agent's server
    `mcp__${agentName}__*`,
  );

  return perms;
}

/** Convert an agent name to an uppercase env-var prefix, e.g. "my-agent" → "MY_AGENT". */
export function toEnvPrefix(agentName: string): string {
  return agentName.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

/** Merge agent env vars into .claude/settings.local.json, preserving existing entries. */
export async function writeSettingsLocal({
  repoDir,
  agentName,
  appId,
  pemPath,
  installationId,
  clientId,
}: SettingsLocalOptions): Promise<void> {
  const dir = join(repoDir, '.claude');
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, 'settings.local.json');

  let existing: {
    env?: Record<string, string>;
    enabledMcpjsonServers?: string[];
    permissions?: { allow?: string[]; deny?: string[] };
    hooks?: HookSettings;
  } = {};
  try {
    existing = JSON.parse(await readFile(filePath, 'utf-8'));
  } catch {
    // file doesn't exist or isn't valid JSON — start fresh
  }

  const prefix = toEnvPrefix(agentName);
  const existingEnv = { ...existing.env };
  delete existingEnv[`${prefix}_CLIENT_SECRET`];
  const existingServers: string[] = Array.isArray(
    existing.enabledMcpjsonServers,
  )
    ? existing.enabledMcpjsonServers
    : [];
  const enabledMcpjsonServers = existingServers.includes(agentName)
    ? existingServers
    : [...existingServers, agentName];

  const newPerms = buildPermissions(agentName);
  const existingAllow: string[] = Array.isArray(existing.permissions?.allow)
    ? existing.permissions.allow
    : [];
  const mergedAllow = [
    ...existingAllow,
    ...newPerms.filter((p) => !existingAllow.includes(p)),
  ];

  const settings = {
    ...existing,
    enabledMcpjsonServers,
    permissions: {
      ...existing.permissions,
      allow: mergedAllow,
    },
    env: {
      ...existingEnv,
      [`${prefix}_GITHUB_APP_ID`]: appId,
      [`${prefix}_GITHUB_APP_PRIVATE_KEY_PATH`]: pemPath,
      [`${prefix}_GITHUB_APP_INSTALLATION_ID`]: installationId,
      [`${prefix}_CLIENT_ID`]: clientId,
      GIT_CONFIG_GLOBAL: `.moltnet/${agentName}/gitconfig`,
    },
  };
  await writeFile(filePath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}
