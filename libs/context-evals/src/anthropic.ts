import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  McpServerConfig,
  SDKMessage,
  Settings,
} from '@anthropic-ai/claude-agent-sdk';
import { query } from '@anthropic-ai/claude-agent-sdk';

import { getRuntimeEnv, loadContextEvalsConfig } from './config.js';

export interface ClaudeQueryOptions {
  cwd: string;
  prompt: string;
  model?: string;
  maxTurns: number;
  clientApp: string;
  stderr?: (data: string) => void;
  mcpServers?: Record<string, McpServerConfig>;
  extraEnv?: Record<string, string>;
}

export async function createClaudeQuery({
  cwd,
  prompt,
  model,
  maxTurns,
  clientApp,
  stderr,
  mcpServers,
  extraEnv,
}: ClaudeQueryOptions): Promise<AsyncIterable<SDKMessage> & { close(): void }> {
  const config = loadContextEvalsConfig();
  const resolvedModel =
    model ?? config.GPACK_AGENT_MODEL ?? 'claude-sonnet-4-6';

  const runtimeEnv = getRuntimeEnv();

  const localSettings = await readFile(
    join(cwd, '.claude', 'settings.local.json'),
    'utf-8',
  )
    .then((data) => JSON.parse(data) as Settings)
    .catch(() => ({}));

  return query({
    prompt,
    options: {
      cwd,
      model: resolvedModel,
      ...(config.CLAUDE_CODE_EXECUTABLE
        ? { pathToClaudeCodeExecutable: config.CLAUDE_CODE_EXECUTABLE }
        : {}),
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      tools: { type: 'preset', preset: 'claude_code' },
      persistSession: false,
      includePartialMessages: false,
      maxTurns,
      // settingSources: ['local'],
      // Flag-layer settings override project/local file settings.
      // Disable hooks so worktree SessionStart / PreToolUse hooks from
      // .claude/settings.json don't fire (they depend on env vars and
      // scripts that may not work inside an eval worktree).
      settings: { ...localSettings, disableAllHooks: true },
      ...(mcpServers ? { mcpServers } : {}),
      debug: true,
      env: {
        ...runtimeEnv,
        CLAUDE_AGENT_SDK_CLIENT_APP: clientApp,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        ...(config.ANTHROPIC_API_KEY
          ? { ANTHROPIC_API_KEY: config.ANTHROPIC_API_KEY }
          : {}),
        ...(config.ANTHROPIC_AUTH_TOKEN
          ? { ANTHROPIC_AUTH_TOKEN: config.ANTHROPIC_AUTH_TOKEN }
          : {}),
        ...extraEnv,
      },
      ...(stderr ? { stderr } : {}),
    },
  }) as AsyncIterable<SDKMessage> & { close(): void };
}
