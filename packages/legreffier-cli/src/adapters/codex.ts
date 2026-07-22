import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parse, stringify } from 'smol-toml';

import {
  buildCodexRules,
  installCanonicalSkills,
  mergeGitHubGuardHook,
} from '../setup.js';
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
    // `.agents/skills/` is the canonical tree Codex reads natively.
    await installCanonicalSkills(repoDir);
  }

  async writeSettings(opts: AgentAdapterOptions): Promise<void> {
    const dir = join(opts.repoDir, '.codex');
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, 'hooks.json');

    let existing: Record<string, unknown> = {};
    try {
      existing = JSON.parse(await readFile(filePath, 'utf-8')) as Record<
        string,
        unknown
      >;
    } catch {
      // file doesn't exist or isn't valid JSON — start fresh
    }

    await writeFile(
      filePath,
      JSON.stringify(mergeGitHubGuardHook(existing), null, 2) + '\n',
      'utf-8',
    );
  }

  async writeRules(opts: AgentAdapterOptions): Promise<void> {
    const dir = join(opts.repoDir, '.codex', 'rules');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'legreffier.rules'),
      buildCodexRules(opts.agentName),
      'utf-8',
    );
  }
}
