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
const SKILL_VERSION = 'legreffier-v0.1.0';
const SKILL_FALLBACK = 'main';

interface SkillDefinition {
  name: string;
  files: string[];
}

function skillFileUrl(name: string, ref: string, file: string): string {
  return `https://raw.githubusercontent.com/getlarge/themoltnet/${ref}/.claude/skills/${name}/${file}`;
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
): Promise<Map<string, string> | null> {
  for (const ref of [SKILL_VERSION, SKILL_FALLBACK]) {
    const files = new Map<string, string>();
    let ok = true;

    for (const file of skill.files) {
      let res: Response;
      try {
        res = await fetch(skillFileUrl(skill.name, ref, file));
      } catch {
        ok = false;
        break;
      }

      if (!res.ok) {
        ok = false;
        break;
      }

      files.set(file, await res.text());
    }

    if (ok) {
      return files;
    }
  }

  return null;
}

/**
 * Install MoltNet skills into the given skill directory.
 * Fetches from GitHub pinned to the CLI release tag.
 *
 * @param repoDir - Root of the target repository
 * @param skillDir - Relative path for skill files (e.g. '.claude/skills', '.agents/skills')
 */
export async function downloadSkills(
  repoDir: string,
  skillDir: string,
): Promise<void> {
  for (const skill of SKILLS) {
    const files = await downloadSkillFiles(skill);
    if (!files) {
      process.stderr.write(
        `Warning: could not download skill "${skill.name}", skipping.\n`,
      );
      continue;
    }

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

export const GITHUB_GUARD_HOOK_COMMAND =
  'command -v moltnet >/dev/null 2>&1 && moltnet github guard 2>/dev/null || true';

export const CLAUDE_GITHUB_GUARD_HOOK_COMMAND =
  '"$CLAUDE_PROJECT_DIR"/.claude/hooks/moltnet-github-guard.sh';

const CLAUDE_GITHUB_GUARD_HOOK_SCRIPT = `#!/bin/sh
command -v moltnet >/dev/null 2>&1 || exit 0
moltnet github guard 2>/dev/null || true
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
  const existing =
    hooks && typeof hooks === 'object' && !Array.isArray(hooks)
      ? (hooks as HookSettings)
      : {};
  const preToolUse = Array.isArray(existing.PreToolUse)
    ? existing.PreToolUse.map((entry) => ({
        ...entry,
        hooks: Array.isArray(entry.hooks)
          ? entry.hooks.filter((hook) => !isGitHubGuardHook(hook))
          : [],
      }))
    : [];
  const bashMatcherIndex = preToolUse.findIndex(
    (entry) => entry.matcher === 'Bash',
  );

  if (bashMatcherIndex >= 0) {
    preToolUse[bashMatcherIndex] = {
      ...preToolUse[bashMatcherIndex],
      hooks: [
        ...preToolUse[bashMatcherIndex].hooks,
        { type: 'command', command },
      ],
    };
  } else {
    preToolUse.push({
      matcher: 'Bash',
      hooks: [{ type: 'command', command }],
    });
  }

  return { ...existing, PreToolUse: preToolUse };
}

function isGitHubGuardHook(hook: unknown): boolean {
  return (
    !!hook &&
    typeof hook === 'object' &&
    'command' in hook &&
    typeof hook.command === 'string' &&
    /\bgithub(?:\s+|-)guard\b/.test(hook.command)
  );
}

/** Register the shared Claude guard and install its executable hook script. */
export async function writeClaudeGuardHook(repoDir: string): Promise<void> {
  const dir = join(repoDir, '.claude');
  const hooksDir = join(dir, 'hooks');
  const scriptPath = join(hooksDir, 'moltnet-github-guard.sh');
  const settingsPath = join(dir, 'settings.json');
  await mkdir(hooksDir, { recursive: true });
  await writeFile(scriptPath, CLAUDE_GITHUB_GUARD_HOOK_SCRIPT, 'utf-8');
  await chmod(scriptPath, 0o755);

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
          existing.hooks,
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
    '- denies unknown commands, while GraphQL mutations require a scoped token.',
    '',
    'Installation permissions are cached with the token in `gh-token-cache.json`.',
    'Writes are atomic, and refresh failures are cached briefly to avoid retry storms.',
    'The first relevant write lazily refreshes legacy or expired cache state. By',
    'default unavailable optional permission state fails open silently; set',
    '`MOLTNET_GITHUB_GUARD_STRICT=1` to fail closed instead. Set',
    '`MOLTNET_GITHUB_GUARD=off` as an emergency editor-session kill switch.',
    '',
    'For writes the App can perform, use the canonical command-scoped form:',
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
    'The token assignment authorizes only that `gh` process. It must not authorize a',
    'different `gh` command later in a chain. Never use an empty or unverified token',
    'substitution: `gh` would silently fall back to the human login.',
    '',
  ].join('\n');
}

/**
 * Build a Starlark `.rules` file for Codex with prefix_rule() entries
 * that allow the commands the legreffier skill needs.
 */
export function buildCodexRules(_agentName: string): string {
  return [
    '# Codex sandbox rules for LeGreffier',
    '#',
    '# Allow the commands that the legreffier skill needs to run.',
    '# The GitHub guard owns authorship policy; these rules only reduce prompts.',
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
    '# MoltNet CLI — signing, entry, & token generation',
    'prefix_rule(',
    '    pattern = ["npx", "@themoltnet/cli"],',
    '    decision = "allow",',
    ')',
    'prefix_rule(',
    '    pattern = ["npx", "@themoltnet/cli", "sign"],',
    '    decision = "allow",',
    ')',
    'prefix_rule(',
    '    pattern = ["npx", "@themoltnet/cli", "entry", "commit"],',
    '    decision = "allow",',
    ')',
    'prefix_rule(',
    '    pattern = ["npx", "@themoltnet/cli", "entry", "create-signed"],',
    '    decision = "allow",',
    ')',
    'prefix_rule(',
    '    pattern = ["npx", "@themoltnet/cli", "entry", "verify"],',
    '    decision = "allow",',
    ')',
    'prefix_rule(',
    '    pattern = ["npx", "@themoltnet/cli", "github", "token"],',
    '    decision = "allow",',
    ')',
    'prefix_rule(',
    '    pattern = ["moltnet", "agents", "activation"],',
    '    decision = "allow",',
    ')',
    'prefix_rule(',
    '    pattern = ["moltnet", "sign"],',
    '    decision = "allow",',
    ')',
    'prefix_rule(',
    '    pattern = ["moltnet", "entry", "commit"],',
    '    decision = "allow",',
    ')',
    'prefix_rule(',
    '    pattern = ["moltnet", "entry", "create-signed"],',
    '    decision = "allow",',
    ')',
    'prefix_rule(',
    '    pattern = ["moltnet", "entry", "verify"],',
    '    decision = "allow",',
    ')',
    'prefix_rule(',
    '    pattern = ["moltnet", "github", "token"],',
    '    decision = "allow",',
    ')',
    'prefix_rule(',
    '    pattern = ["moltnet", "task", "list"],',
    '    decision = "allow",',
    ')',
    'prefix_rule(',
    '    pattern = ["moltnet", "task", "get"],',
    '    decision = "allow",',
    ')',
    'prefix_rule(',
    '    pattern = ["moltnet", "task", "attempts"],',
    '    decision = "allow",',
    ')',
    'prefix_rule(',
    '    pattern = ["moltnet", "task", "tail"],',
    '    decision = "allow",',
    ')',
    'prefix_rule(',
    '    pattern = ["moltnet", "pack", "list"],',
    '    decision = "allow",',
    ')',
    'prefix_rule(',
    '    pattern = ["moltnet", "pack", "get"],',
    '    decision = "allow",',
    ')',
    'prefix_rule(',
    '    pattern = ["moltnet", "rendered-pack", "list"],',
    '    decision = "allow",',
    ')',
    'prefix_rule(',
    '    pattern = ["moltnet", "rendered-pack", "get"],',
    '    decision = "allow",',
    ')',
    'prefix_rule(',
    '    pattern = ["npx", "@themoltnet/cli", "task", "list"],',
    '    decision = "allow",',
    ')',
    'prefix_rule(',
    '    pattern = ["npx", "@themoltnet/cli", "task", "get"],',
    '    decision = "allow",',
    ')',
    'prefix_rule(',
    '    pattern = ["npx", "@themoltnet/cli", "task", "attempts"],',
    '    decision = "allow",',
    ')',
    'prefix_rule(',
    '    pattern = ["npx", "@themoltnet/cli", "task", "tail"],',
    '    decision = "allow",',
    ')',
    'prefix_rule(',
    '    pattern = ["npx", "@themoltnet/cli", "pack", "list"],',
    '    decision = "allow",',
    ')',
    'prefix_rule(',
    '    pattern = ["npx", "@themoltnet/cli", "pack", "get"],',
    '    decision = "allow",',
    ')',
    'prefix_rule(',
    '    pattern = ["npx", "@themoltnet/cli", "rendered-pack", "list"],',
    '    decision = "allow",',
    ')',
    'prefix_rule(',
    '    pattern = ["npx", "@themoltnet/cli", "rendered-pack", "get"],',
    '    decision = "allow",',
    ')',
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
  ].join('\n');
}

export interface SettingsLocalOptions {
  repoDir: string;
  agentName: string;
  appId: string;
  pemPath: string;
  installationId: string;
  clientId: string;
  clientSecret: string;
}

/** Build the permission allow-list for the legreffier skill. */
export function buildPermissions(agentName: string): string[] {
  return [
    // Read-only git commands used by session activation & commit workflow
    'Bash(git config *)',
    'Bash(git diff *)',
    'Bash(git log *)',
    'Bash(git rev-parse *)',
    'Bash(git worktree list)',
    // Signing CLI (native binary)
    'Bash(moltnet sign *)',
    'Bash(moltnet entry commit *)',
    'Bash(moltnet entry create-signed *)',
    'Bash(moltnet entry verify *)',
    'Bash(moltnet github token *)',
    'Bash(moltnet agents activation *)',
    'Bash(moltnet task list *)',
    'Bash(moltnet task get *)',
    'Bash(moltnet task attempts *)',
    'Bash(moltnet task tail *)',
    'Bash(moltnet pack list *)',
    'Bash(moltnet pack get *)',
    'Bash(moltnet rendered-pack list *)',
    'Bash(moltnet rendered-pack get *)',
    // Signing CLI (npm package — equivalent commands)
    'Bash(npx @themoltnet/cli *)',
    'Bash(npx @themoltnet/cli sign *)',
    'Bash(npx @themoltnet/cli entry commit *)',
    'Bash(npx @themoltnet/cli entry create-signed *)',
    'Bash(npx @themoltnet/cli entry verify *)',
    'Bash(npx @themoltnet/cli github token *)',
    'Bash(npx @themoltnet/cli agents activation *)',
    'Bash(npx @themoltnet/cli task list *)',
    'Bash(npx @themoltnet/cli task get *)',
    'Bash(npx @themoltnet/cli task attempts *)',
    'Bash(npx @themoltnet/cli task tail *)',
    'Bash(npx @themoltnet/cli pack list *)',
    'Bash(npx @themoltnet/cli pack get *)',
    'Bash(npx @themoltnet/cli rendered-pack list *)',
    'Bash(npx @themoltnet/cli rendered-pack get *)',
    // Worktree symlink creation
    'Bash(ln -s *)',
    // Session activation env export
    'Bash(echo "GIT_CONFIG_GLOBAL=*")',
    // All MCP tools for this agent's server
    `mcp__${agentName}__*`,
  ];
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
  clientSecret,
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
      ...existing.env,
      [`${prefix}_GITHUB_APP_ID`]: appId,
      [`${prefix}_GITHUB_APP_PRIVATE_KEY_PATH`]: pemPath,
      [`${prefix}_GITHUB_APP_INSTALLATION_ID`]: installationId,
      [`${prefix}_CLIENT_ID`]: clientId,
      [`${prefix}_CLIENT_SECRET`]: clientSecret,
      GIT_CONFIG_GLOBAL: `.moltnet/${agentName}/gitconfig`,
    },
  };
  await writeFile(filePath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}
