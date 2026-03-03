import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parse, stringify } from 'smol-toml';

import { buildGhTokenRule, downloadSkills } from '../setup.js';
import type { AgentAdapter, AgentAdapterOptions } from './types.js';

interface CodexToml {
  mcp_servers?: Record<
    string,
    { url?: string; env_http_headers?: Record<string, string> }
  >;
  [key: string]: unknown;
}

export class CodexAdapter implements AgentAdapter {
  readonly type = 'codex' as const;

  async writeMcpConfig(opts: AgentAdapterOptions): Promise<void> {
    const dir = join(opts.repoDir, '.codex');
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, 'config.toml');

    let existing: CodexToml = {};
    try {
      const raw = await readFile(filePath, 'utf-8');
      existing = parse(raw) as CodexToml;
    } catch {
      // file doesn't exist or isn't valid TOML — start fresh
    }

    const servers = (existing.mcp_servers ?? {}) as CodexToml['mcp_servers'] &
      object;
    servers[opts.agentName] = {
      url: opts.mcpUrl,
      env_http_headers: {
        'X-Client-Id': `${opts.prefix}_CLIENT_ID`,
        'X-Client-Secret': `${opts.prefix}_CLIENT_SECRET`,
      },
    };

    const merged: CodexToml = { ...existing, mcp_servers: servers };
    await writeFile(filePath, stringify(merged) + '\n', 'utf-8');
  }

  async writeSkills(repoDir: string): Promise<void> {
    await downloadSkills(repoDir, '.agents/skills');
  }

  /**
   * Write a sourceable env file at `.moltnet/<name>/env` with the OAuth2
   * credentials that Codex needs in the shell environment.
   */
  async writeSettings(opts: AgentAdapterOptions): Promise<void> {
    const envDir = join(opts.repoDir, '.moltnet', opts.agentName);
    await mkdir(envDir, { recursive: true });

    const q = (v: string) => `'${v.replace(/'/g, "'\\''")}'`;
    const lines = [
      `${opts.prefix}_CLIENT_ID=${q(opts.clientId)}`,
      `${opts.prefix}_CLIENT_SECRET=${q(opts.clientSecret)}`,
      `${opts.prefix}_GITHUB_APP_ID=${q(opts.appSlug)}`,
      `${opts.prefix}_GITHUB_APP_PRIVATE_KEY_PATH=${q(opts.pemPath)}`,
      `${opts.prefix}_GITHUB_APP_INSTALLATION_ID=${q(opts.installationId)}`,
    ];
    await writeFile(join(envDir, 'env'), lines.join('\n') + '\n', 'utf-8');
  }

  async writeRules(opts: AgentAdapterOptions): Promise<void> {
    const dir = join(opts.repoDir, '.codex', 'rules');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'legreffier-gh.md'),
      buildGhTokenRule(opts.agentName),
      'utf-8',
    );
  }
}
