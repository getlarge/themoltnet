import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

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
    name: 'legreffier-scan',
    files: [
      'SKILL.md',
      'references/scan-flows.md',
      'references/path-discovery.md',
      'references/content-templates.md',
    ],
  },
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

export function buildGhTokenRule(): string {
  return [
    '# GitHub CLI Authentication (MoltNet agents)',
    '',
    '> **STRICT RULE — read this before every `gh` call.**',
    '>',
    '> When `GIT_CONFIG_GLOBAL` is set (matches `.moltnet/<agent>/gitconfig`), the',
    '> default is: you **MUST NOT** run bare `gh <command>`. You **MUST** prefix',
    '> every `gh` call with a `GH_TOKEN` resolved from an **absolute path** to',
    '> `moltnet.json`. Running bare `gh` silently falls back to the human personal',
    '> token and attributes the action to the wrong identity — this is a',
    '> correctness bug, not a warning.',
    '>',
    '> **Exception — `human` authorship mode**: when `MOLTNET_COMMIT_AUTHORSHIP=human`',
    '> in `.moltnet/<agent>/env`, `gh pr ...` and `gh issue ...` **must** run bare',
    '> (no `GH_TOKEN`) so the PR/issue appears as authored by the human. All other',
    '> `gh` calls (including `gh api repos/.../contents/...`) still require the agent',
    '> token. `git push` is not a `gh` call and always uses the agent token via the',
    '> gitconfig-configured credential helper.',
    '',
    '## The only correct form',
    '',
    '```bash',
    '# 1. Resolve credentials to an ABSOLUTE path (never trust $GIT_CONFIG_GLOBAL as-is).',
    'CREDS="$(cd "$(dirname "$GIT_CONFIG_GLOBAL")" 2>/dev/null && pwd)/moltnet.json"',
    '',
    '# 2. Refuse to proceed if the file does not exist at that absolute path.',
    '[ -f "$CREDS" ] || { echo "FATAL: moltnet.json not found at $CREDS" >&2; exit 1; }',
    '',
    '# 3. Call gh with GH_TOKEN inlined.',
    'GH_TOKEN=$($MOLTNET_CLI github token --credentials "$CREDS") gh <command>',
    '```',
    '',
    'The credentials file (`moltnet.json`) always lives next to the `gitconfig`',
    'inside the same `.moltnet/<agent>/` directory, regardless of which agent is',
    'active. The token is cached locally (~1 hour lifetime, 5-min expiry buffer),',
    'so repeated calls are fast after the first API hit.',
    '',
    '## Why absolute paths are mandatory',
    '',
    '`GIT_CONFIG_GLOBAL` is almost always a **relative path** (e.g. `.moltnet/<agent>/gitconfig`).',
    'Every git worktree has a different CWD from the main worktree root, so',
    '`$(dirname "$GIT_CONFIG_GLOBAL")` resolves differently depending on where you are.',
    'When it resolves to a non-existent directory:',
    '',
    '- `$MOLTNET_CLI github token` prints `no credentials found` to stderr,',
    '- the command substitution yields an empty `GH_TOKEN`,',
    '- `gh` silently falls back to your personal token,',
    '- the resulting API call is attributed to the **human**, not the agent.',
    '',
    'This failure is invisible in normal output. The `cd ... && pwd` dance in step 1',
    'is the only reliable way to get an absolute path that works across worktrees.',
    '',
    '## Forbidden patterns',
    '',
    '- `gh <command>` — bare, no `GH_TOKEN`. **Never** (except the `human` mode',
    '  write-op carve-out for `gh pr` / `gh issue` described in the header above).',
    '- `GH_TOKEN=$(... --credentials "$(dirname "$GIT_CONFIG_GLOBAL")/moltnet.json") gh ...`',
    '  — uses the raw relative path. Breaks in worktrees.',
    '- `GH_TOKEN=$(... --credentials "./moltnet.json") gh ...` — relative. Breaks.',
    '- `GH_TOKEN=$(... --credentials "~/.moltnet/...") gh ...` — `~` is not expanded',
    '  inside double quotes; use `$HOME` or the literal absolute path.',
    '',
    '## Allowed `gh` subcommands',
    '',
    'The GitHub App only has these permissions:',
    '',
    '- `gh pr ...` (pull_requests: write)',
    '- `gh issue ...` (issues: write)',
    '- `gh api repos/{owner}/{repo}/contents/...` (contents: write)',
    '- `gh repo view`, `gh repo clone` (metadata: read + contents: read)',
    '',
    'Do NOT use `GH_TOKEN` for other `gh` commands (releases, actions, packages, etc.).',
    '',
    '## 401 recovery',
    '',
    'If you get a 401 error, the cached token may be stale. Delete',
    '`gh-token-cache.json` next to `moltnet.json` and retry.',
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
    '# GH_TOKEN is injected inline; see $legreffier skill for details.',
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
    '# MoltNet CLI — signing, diary, & token generation',
    'prefix_rule(',
    '    pattern = ["npx", "@themoltnet/cli", "sign"],',
    '    decision = "allow",',
    ')',
    'prefix_rule(',
    '    pattern = ["npx", "@themoltnet/cli", "diary", "commit"],',
    '    decision = "allow",',
    ')',
    'prefix_rule(',
    '    pattern = ["npx", "@themoltnet/cli", "diary", "create-signed"],',
    '    decision = "allow",',
    ')',
    'prefix_rule(',
    '    pattern = ["npx", "@themoltnet/cli", "diary", "verify"],',
    '    decision = "allow",',
    ')',
    'prefix_rule(',
    '    pattern = ["npx", "@themoltnet/cli", "github", "token"],',
    '    decision = "allow",',
    ')',
    'prefix_rule(',
    '    pattern = ["moltnet", "sign"],',
    '    decision = "allow",',
    ')',
    'prefix_rule(',
    '    pattern = ["moltnet", "diary", "commit"],',
    '    decision = "allow",',
    ')',
    'prefix_rule(',
    '    pattern = ["moltnet", "diary", "create-signed"],',
    '    decision = "allow",',
    ')',
    'prefix_rule(',
    '    pattern = ["moltnet", "diary", "verify"],',
    '    decision = "allow",',
    ')',
    'prefix_rule(',
    '    pattern = ["moltnet", "github", "token"],',
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
    'Bash(moltnet diary commit *)',
    'Bash(moltnet diary create-signed *)',
    'Bash(moltnet diary verify *)',
    'Bash(moltnet github token *)',
    // Signing CLI (npm package — equivalent commands)
    'Bash(npx @themoltnet/cli sign *)',
    'Bash(npx @themoltnet/cli diary commit *)',
    'Bash(npx @themoltnet/cli diary create-signed *)',
    'Bash(npx @themoltnet/cli diary verify *)',
    'Bash(npx @themoltnet/cli github token *)',
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
    },
  };
  await writeFile(filePath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}
