import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { assertSecretGuardCapability } from '../secret-guard-capability.js';
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

export const OPENCODE_SECRET_GUARD_PLUGIN = `import type { Plugin } from '@opencode-ai/plugin';

const GUARD_ARGUMENT_KEYS = [
  'command',
  'file_path',
  'filePath',
  'path',
  'directory',
  'include',
  'glob',
  'patch',
  'patchText',
] as const;

function normalizeGuardArgs(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return {};
  const source = args as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};
  for (const key of GUARD_ARGUMENT_KEYS) {
    if (key in source) normalized[key] = source[key];
  }
  return normalized;
}

export const MoltNetSecretGuard: Plugin = async () => ({
  'tool.execute.before': async (input, output) => {
    const payload = JSON.stringify({
      tool_name: input.tool,
      tool_input: normalizeGuardArgs(output.args),
    });
    let result;
    try {
      result = Bun.spawnSync(['moltnet', 'secrets', 'guard'], { stdin: payload });
    } catch {
      throw new Error('MoltNet secret guard is unavailable; protected credential access is blocked.');
    }
    if (result.exitCode !== 0) {
      throw new Error('MoltNet secret guard failed; protected credential access is blocked.');
    }
    const text = result.stdout.toString().trim();
    if (!text) return;
    let decision;
    try {
      decision = JSON.parse(text);
    } catch {
      throw new Error('MoltNet secret guard returned malformed output; protected credential access is blocked.');
    }
    const hook = decision.hookSpecificOutput;
    if (hook?.permissionDecision === 'deny') {
      throw new Error(hook.permissionDecisionReason ?? 'MoltNet blocked protected credential access.');
    }
  },
});
`;

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

  async writeSettings(opts: AgentAdapterOptions): Promise<void> {
    await assertSecretGuardCapability();
    const dir = join(opts.repoDir, '.opencode', 'plugins');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'moltnet-secret-guard.ts'),
      OPENCODE_SECRET_GUARD_PLUGIN,
      'utf-8',
    );
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
