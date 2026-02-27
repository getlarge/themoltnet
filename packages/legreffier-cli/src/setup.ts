import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { AgentType } from './ui/types.js';

/** Agent-specific directory where skills are installed. */
const SKILL_DIRS: Record<AgentType, string> = {
  claude: '.claude/skills',
  // codex: '.agents/skills',
};

/** Pinned to the release tag — updated by release-please. */
const SKILL_VERSION = 'legreffier-v0.1.0';

const SKILLS: Array<{ name: string; url: string }> = [
  {
    name: 'legreffier',
    url: `https://raw.githubusercontent.com/getlarge/themoltnet/${SKILL_VERSION}/.claude/skills/legreffier/SKILL.md`,
  },
];

/**
 * Install MoltNet skills for the given agent types.
 * Fetches from GitHub pinned to the CLI release tag.
 * Installs into each agent's skill directory (e.g. .claude/skills/, .agents/skills/).
 */
export async function downloadSkills(
  repoDir: string,
  agentTypes: AgentType[],
): Promise<void> {
  const dirs = agentTypes
    .map((t) => SKILL_DIRS[t])
    .filter((d): d is string => !!d);
  if (dirs.length === 0) return;

  for (const skill of SKILLS) {
    const res = await fetch(skill.url);
    if (!res.ok) {
      throw new Error(`Failed to download skill ${skill.name} (${res.status})`);
    }
    const content = await res.text();

    for (const skillDir of dirs) {
      const destDir = join(repoDir, skillDir, skill.name);
      await mkdir(destDir, { recursive: true });
      await writeFile(join(destDir, 'SKILL.md'), content, 'utf-8');
    }
  }
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
    // Signing CLI
    'Bash(moltnet sign *)',
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
