import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const SKILLS: Array<{ name: string; url: string }> = [
  {
    name: 'legreffier',
    url: 'https://raw.githubusercontent.com/getlarge/themoltnet/main/.claude/skills/legreffier/SKILL.md',
  },
];

/** Download MoltNet skills into <repoDir>/.claude/skills/<name>/SKILL.md */
export async function downloadSkills(repoDir: string): Promise<void> {
  for (const skill of SKILLS) {
    const dir = join(repoDir, '.claude', 'skills', skill.name);
    await mkdir(dir, { recursive: true });
    const res = await fetch(skill.url);
    if (!res.ok) {
      throw new Error(`Failed to download skill ${skill.name} (${res.status})`);
    }
    const content = await res.text();
    await writeFile(join(dir, 'SKILL.md'), content, 'utf-8');
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

  let existing: { env?: Record<string, string> } = {};
  try {
    existing = JSON.parse(await readFile(filePath, 'utf-8'));
  } catch {
    // file doesn't exist or isn't valid JSON — start fresh
  }

  const prefix = toEnvPrefix(agentName);
  const settings = {
    ...existing,
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
