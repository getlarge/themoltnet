import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { buildGhTokenRule, installCanonicalSkills } from '../setup.js';
import type { AgentAdapter, AgentAdapterOptions } from './types.js';

interface OpencodeMcpServer {
  type: string;
  url: string;
  enabled?: boolean;
  headers?: Record<string, string>;
}

interface OpencodeConfig {
  $schema?: string;
  mcp?: Record<string, OpencodeMcpServer>;
  instructions?: string[];
  [key: string]: unknown;
}

const OPENCODE_SCHEMA = 'https://opencode.ai/config.json';

/** Repo-relative path of the generated GitHub-token rule. */
const RULE_REL_PATH = '.opencode/rules/legreffier-gh.md';

async function readOpencodeConfig(filePath: string): Promise<OpencodeConfig> {
  try {
    return JSON.parse(await readFile(filePath, 'utf-8')) as OpencodeConfig;
  } catch {
    // File doesn't exist or isn't valid JSON — start fresh.
    return {};
  }
}

/**
 * opencode (https://opencode.ai) adapter.
 *
 * opencode reads a single `opencode.json` with a `mcp` block (remote servers
 * with `{env:VAR}` header substitution) and discovers `SKILL.md` skills from
 * `.agents/skills/` natively — so the canonical skill tree is all it needs.
 * Credentials come from the shared `.moltnet/<agent>/env` file, exactly like
 * Codex; there is no inline-secrets settings file to write.
 */
export class OpencodeAdapter implements AgentAdapter {
  readonly type = 'opencode' as const;

  async writeMcpConfig(opts: AgentAdapterOptions): Promise<void> {
    const filePath = join(opts.repoDir, 'opencode.json');
    const existing = await readOpencodeConfig(filePath);

    const mcp = { ...(existing.mcp ?? {}) };
    mcp[opts.agentName] = {
      type: 'remote',
      url: opts.mcpUrl,
      enabled: true,
      headers: {
        'X-Client-Id': `{env:${opts.prefix}_CLIENT_ID}`,
        'X-Client-Secret': `{env:${opts.prefix}_CLIENT_SECRET}`,
      },
    };

    const merged: OpencodeConfig = {
      $schema: existing.$schema ?? OPENCODE_SCHEMA,
      ...existing,
      mcp,
    };
    await writeFile(filePath, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
  }

  async writeSkills(repoDir: string): Promise<void> {
    // opencode discovers `.agents/skills/` natively — the canonical tree is
    // all it needs, no per-agent copy or symlink.
    await installCanonicalSkills(repoDir);
  }

  async writeSettings(_opts: AgentAdapterOptions): Promise<void> {
    // no-op — credentials are sourced from the shared `.moltnet/<agent>/env`
    // file via opencode's `{env:...}` header substitution.
  }

  async writeRules(opts: AgentAdapterOptions): Promise<void> {
    const dir = join(opts.repoDir, '.opencode', 'rules');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'legreffier-gh.md'), buildGhTokenRule(), 'utf-8');

    // Register the rule in opencode's `instructions` so it loads into context.
    const filePath = join(opts.repoDir, 'opencode.json');
    const existing = await readOpencodeConfig(filePath);
    const instructions = Array.isArray(existing.instructions)
      ? existing.instructions
      : [];
    if (instructions.includes(RULE_REL_PATH)) return;

    const merged: OpencodeConfig = {
      $schema: existing.$schema ?? OPENCODE_SCHEMA,
      ...existing,
      instructions: [...instructions, RULE_REL_PATH],
    };
    await writeFile(filePath, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
  }
}
