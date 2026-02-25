import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const SKILLS: Array<{ name: string; url: string }> = [
  {
    name: 'legreffier',
    url: 'https://raw.githubusercontent.com/getlarge/themoltnet/main/.claude/skills/legreffier/SKILL.md',
  },
  {
    name: 'accountable-commit',
    url: 'https://raw.githubusercontent.com/getlarge/themoltnet/main/.claude/skills/accountable-commit/SKILL.md',
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
  appSlug: string;
  pemPath: string;
  installationId: string;
}

/** Write .claude/settings.local.json with LeGreffier bot identity. */
export async function writeSettingsLocal({
  repoDir,
  appSlug,
  pemPath,
  installationId,
}: SettingsLocalOptions): Promise<void> {
  const dir = join(repoDir, '.claude');
  await mkdir(dir, { recursive: true });
  const settings = {
    env: {
      GITHUB_APP_ID: appSlug,
      GITHUB_APP_PRIVATE_KEY_PATH: pemPath,
      GITHUB_APP_INSTALLATION_ID: installationId,
    },
  };
  await writeFile(
    join(dir, 'settings.local.json'),
    JSON.stringify(settings, null, 2) + '\n',
    'utf-8',
  );
}
