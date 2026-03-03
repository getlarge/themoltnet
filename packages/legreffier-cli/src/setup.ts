import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Pinned to the release tag — updated by release-please. */
const SKILL_VERSION = 'legreffier-v0.1.0';
const SKILL_FALLBACK = 'main';

const SKILL_PATH = '.claude/skills/legreffier/SKILL.md';

function skillUrl(ref: string): string {
  return `https://raw.githubusercontent.com/getlarge/themoltnet/${ref}/${SKILL_PATH}`;
}

const SKILLS: Array<{ name: string; urls: string[] }> = [
  {
    name: 'legreffier',
    urls: [skillUrl(SKILL_VERSION), skillUrl(SKILL_FALLBACK)],
  },
];

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
    let content: string | null = null;

    for (const url of skill.urls) {
      let res: Response;
      try {
        res = await fetch(url);
      } catch {
        // Network error — try next URL
        continue;
      }
      if (res.ok) {
        content = await res.text();
        break;
      }
      // Non-200 — try next URL (e.g. pinned tag missing, fall back to main)
    }

    if (!content) {
      process.stderr.write(
        `Warning: could not download skill "${skill.name}", skipping.\n`,
      );
      continue;
    }

    const destDir = join(repoDir, skillDir, skill.name);
    await mkdir(destDir, { recursive: true });
    await writeFile(join(destDir, 'SKILL.md'), content, 'utf-8');
  }
}

export function buildGhTokenRule(agentName: string): string {
  return [
    '# GitHub CLI Authentication (LeGreffier)',
    '',
    `When \`GIT_CONFIG_GLOBAL\` is set to \`.moltnet/${agentName}/gitconfig\`,`,
    'authenticate all `gh` CLI commands as the GitHub App by prefixing them with:',
    '',
    '```bash',
    'GH_TOKEN=$(moltnet github token --credentials "$(dirname "$GIT_CONFIG_GLOBAL")/moltnet.json") gh <command>',
    '```',
    '',
    'This ensures `gh pr create`, `gh issue create`, etc. use the',
    "GitHub App's identity instead of the user's personal token.",
    '',
    'The token is short-lived (~1 hour) and generated on each invocation.',
    '',
  ].join('\n');
}

export interface SettingsLocalOptions {
  repoDir: string;
  agentName: string;
  appSlug: string;
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
    'Bash(moltnet github token *)',
    // Signing CLI (npm package — equivalent commands)
    'Bash(npx @themoltnet/cli sign *)',
    'Bash(npx @themoltnet/cli github token *)',
    // Worktree symlink creation
    'Bash(ln -s *)',
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
  appSlug,
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
      [`${prefix}_GITHUB_APP_ID`]: appSlug,
      [`${prefix}_GITHUB_APP_PRIVATE_KEY_PATH`]: pemPath,
      [`${prefix}_GITHUB_APP_INSTALLATION_ID`]: installationId,
      [`${prefix}_CLIENT_ID`]: clientId,
      [`${prefix}_CLIENT_SECRET`]: clientSecret,
    },
  };
  await writeFile(filePath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}
