import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const MOLTNET_GITCONFIG_RE = /\.moltnet\/([^/]+)\/gitconfig$/;

export function resolveAgentName(
  nameFlag: string | undefined,
  gitConfigGlobal: string | undefined,
): string {
  if (nameFlag) return nameFlag;

  if (gitConfigGlobal) {
    const match = MOLTNET_GITCONFIG_RE.exec(gitConfigGlobal);
    if (match) return match[1];
  }

  throw new Error(
    'agent name required — use --name or set GIT_CONFIG_GLOBAL=.moltnet/<name>/gitconfig',
  );
}

export function resolveCredentialsPath(agentName: string, dir: string): string {
  return join(dir, '.moltnet', agentName, 'moltnet.json');
}

export function printGitHubToken(agentName: string, dir: string): void {
  const credPath = resolveCredentialsPath(agentName, dir);
  const token = execFileSync(
    'npx',
    ['@themoltnet/cli', 'github', 'token', '--credentials', credPath],
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
  ).trim();
  process.stdout.write(token);
}
