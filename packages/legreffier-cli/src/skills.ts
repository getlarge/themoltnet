import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { isDeepStrictEqual, promisify } from 'node:util';

import type { AgentType } from './ui/types.js';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

export const MANAGED_SKILLS = [
  'legreffier',
  'legreffier-explore',
  'legreffier-onboarding',
] as const;

const AGENT_NAMES: Record<AgentType, string> = {
  claude: 'claude-code',
  codex: 'codex',
  opencode: 'opencode',
};

interface SkillLockEntry {
  source?: unknown;
  ref?: unknown;
  sourceType?: unknown;
  skillPath?: unknown;
  computedHash?: unknown;
  [key: string]: unknown;
}

interface SkillsLock {
  version: number;
  skills: Record<string, SkillLockEntry>;
}

export type SkillsCliRunner = (args: string[], cwd: string) => Promise<void>;

function resolvePackageVersion(): string {
  const packageJsonUrl = new URL('../package.json', import.meta.url);
  const packageJson = JSON.parse(readFileSync(packageJsonUrl, 'utf-8')) as {
    version?: unknown;
  };
  if (
    typeof packageJson.version !== 'string' ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
      packageJson.version,
    )
  ) {
    throw new Error(
      'Cannot resolve the LeGreffier release tag: invalid package version',
    );
  }
  return packageJson.version;
}

export async function runSkillsCli(args: string[], cwd: string): Promise<void> {
  const cliPath = require.resolve('skills/bin/cli.mjs');
  try {
    await execFileAsync(process.execPath, [cliPath, ...args], {
      cwd,
      env: {
        ...process.env,
        DISABLE_TELEMETRY: '1',
        DO_NOT_TRACK: '1',
      },
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    const detail = error as Error & { stderr?: string; stdout?: string };
    const output = (detail.stderr || detail.stdout || detail.message).trim();
    throw new Error(`Skills CLI failed: ${output}`, { cause: error });
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readLock(lockPath: string): Promise<SkillsLock> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(lockPath, 'utf-8'));
  } catch (error) {
    throw new Error(`Invalid skills-lock.json: ${(error as Error).message}`);
  }
  if (!isObject(parsed) || parsed.version !== 1 || !isObject(parsed.skills)) {
    throw new Error(
      'Invalid skills-lock.json: expected version 1 with a skills object',
    );
  }
  return parsed as unknown as SkillsLock;
}

async function collectFiles(
  baseDir: string,
  currentDir: string,
  files: Array<{ path: string; content: Buffer }>,
): Promise<void> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      if (entry.name === '.git' || entry.name === 'node_modules') return;
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await collectFiles(baseDir, fullPath, files);
      } else if (entry.isFile()) {
        files.push({
          path: relative(baseDir, fullPath).split('\\').join('/'),
          content: await readFile(fullPath),
        });
      }
    }),
  );
}

export async function computeSkillFolderHash(
  skillDir: string,
): Promise<string> {
  const files: Array<{ path: string; content: Buffer }> = [];
  await collectFiles(skillDir, skillDir, files);
  files.sort((a, b) => a.path.localeCompare(b.path));
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file.path);
    hash.update(file.content);
  }
  return hash.digest('hex');
}

export async function validateManagedSkillsLock(
  repoDir: string,
  expected: { source: string; ref: string },
  preservedSkills: Record<string, SkillLockEntry> = {},
): Promise<void> {
  const lock = await readLock(join(repoDir, 'skills-lock.json'));

  for (const [name, entry] of Object.entries(preservedSkills)) {
    if (!isDeepStrictEqual(lock.skills[name], entry)) {
      throw new Error(
        `Invalid skills-lock.json: unrelated skill "${name}" was not preserved`,
      );
    }
  }

  for (const name of MANAGED_SKILLS) {
    const entry = lock.skills[name];
    if (!isObject(entry)) {
      throw new Error(`Invalid skills-lock.json: missing entry for "${name}"`);
    }
    const expectedPath = `.agents/skills/${name}/SKILL.md`;
    if (
      entry.source !== expected.source ||
      entry.ref !== expected.ref ||
      entry.sourceType !== 'github' ||
      entry.skillPath !== expectedPath ||
      typeof entry.computedHash !== 'string' ||
      !/^[0-9a-f]{64}$/.test(entry.computedHash)
    ) {
      throw new Error(
        `Invalid skills-lock.json: malformed managed entry for "${name}"`,
      );
    }
    const installedHash = await computeSkillFolderHash(
      join(repoDir, dirname(expectedPath)),
    );
    if (installedHash !== entry.computedHash) {
      throw new Error(
        `Installed skill "${name}" does not match skills-lock.json hash`,
      );
    }
  }
}

export async function installManagedSkills(
  repoDir: string,
  agentTypes: AgentType[],
  runner: SkillsCliRunner = runSkillsCli,
): Promise<void> {
  const version = resolvePackageVersion();
  const source = 'getlarge/themoltnet';
  const ref = `legreffier-v${version}`;
  const lockPath = join(repoDir, 'skills-lock.json');
  let previousLock: string | undefined;
  let preservedSkills: Record<string, SkillLockEntry> = {};

  try {
    previousLock = await readFile(lockPath, 'utf-8');
    const existing = await readLock(lockPath);
    preservedSkills = Object.fromEntries(
      Object.entries(existing.skills).filter(
        ([name]) =>
          !MANAGED_SKILLS.includes(name as (typeof MANAGED_SKILLS)[number]),
      ),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const agents = [...new Set(agentTypes.map((agent) => AGENT_NAMES[agent]))];
  if (agents.length === 0) return;
  // Skills CLI copies directly into `.claude/skills` when Claude is the only
  // target. Add one universal-path target so it owns the canonical
  // `.agents/skills` tree and creates Claude's relative symlinks. This installs
  // no Codex configuration; it only selects the shared skill discovery path.
  if (
    agents.includes('claude-code') &&
    !agents.includes('codex') &&
    !agents.includes('opencode')
  ) {
    agents.push('codex');
  }

  try {
    await runner(
      [
        'add',
        `${source}#${ref}`,
        '--skill',
        ...MANAGED_SKILLS,
        '--agent',
        ...agents,
        '--yes',
      ],
      repoDir,
    );
    await validateManagedSkillsLock(repoDir, { source, ref }, preservedSkills);
  } catch (error) {
    if (previousLock === undefined) await rm(lockPath, { force: true });
    else await writeFile(lockPath, previousLock, 'utf-8');
    throw error;
  }
}
