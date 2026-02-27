import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parse, stringify } from 'smol-toml';

import { downloadSkills } from '../setup.js';
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

  /** No-op — Codex reads env vars from the shell, not a settings file. */
  async writeSettings(_opts: AgentAdapterOptions): Promise<void> {
    // Codex has no settings.local.json equivalent.
    // Env vars (PREFIX_CLIENT_ID, PREFIX_CLIENT_SECRET) must be set in the shell.
  }
}
