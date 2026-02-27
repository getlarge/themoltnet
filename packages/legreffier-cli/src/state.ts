import { execSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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

function getStatePath(configDir: string): string {
  return join(configDir, 'legreffier-init.state.json');
}

export async function readState(
  configDir: string,
): Promise<LegreffierInitState | null> {
  try {
    const raw = await readFile(getStatePath(configDir), 'utf-8');
    return JSON.parse(raw) as LegreffierInitState;
  } catch {
    return null;
  }
}

export async function writeState(
  state: LegreffierInitState,
  configDir: string,
): Promise<void> {
  await mkdir(configDir, { recursive: true });
  const path = getStatePath(configDir);
  await writeFile(path, JSON.stringify(state, null, 2) + '\n', {
    mode: 0o600,
  });
}

export async function clearState(configDir: string): Promise<void> {
  try {
    await rm(getStatePath(configDir));
  } catch {
    // already gone
  }
}
