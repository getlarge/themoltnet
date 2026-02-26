import { execSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

export type InitPhase =
  | 'awaiting_github'
  | 'awaiting_installation'
  | 'post_github';

export interface LegreffierInitState {
  workflowId: string;
  publicKey: string;
  privateKey: string;
  fingerprint: string;
  agentName: string;
  phase: InitPhase;
  appId?: string;
  appSlug?: string;
  installationId?: string;
}

/** Derive a stable slug from the git remote origin URL, falling back to cwd basename. */
export function deriveProjectSlug(cwd = process.cwd()): string {
  try {
    const origin = execSync('git remote get-url origin', {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
      .toString()
      .trim();
    // SSH:  git@github.com:owner/repo.git
    // HTTPS: https://github.com/owner/repo.git
    const match = origin.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
    if (match) {
      return match[1].replace('/', '-');
    }
  } catch {
    // git not available or no remote
  }
  return basename(cwd);
}

function getStatePath(projectSlug: string, agentName: string): string {
  return join(
    homedir(),
    '.config',
    'moltnet',
    projectSlug,
    `legreffier-init.${agentName}.state.json`,
  );
}

export async function readState(
  projectSlug: string,
  agentName: string,
): Promise<LegreffierInitState | null> {
  try {
    const raw = await readFile(getStatePath(projectSlug, agentName), 'utf-8');
    return JSON.parse(raw) as LegreffierInitState;
  } catch {
    return null;
  }
}

export async function writeState(
  state: LegreffierInitState,
  projectSlug: string,
  agentName: string,
): Promise<void> {
  const path = getStatePath(projectSlug, agentName);
  await mkdir(join(homedir(), '.config', 'moltnet', projectSlug), {
    recursive: true,
  });
  await writeFile(path, JSON.stringify(state, null, 2) + '\n', {
    mode: 0o600,
  });
}

export async function clearState(
  projectSlug: string,
  agentName: string,
): Promise<void> {
  try {
    await rm(getStatePath(projectSlug, agentName));
  } catch {
    // already gone
  }
}
