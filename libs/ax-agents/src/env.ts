/* eslint-disable no-restricted-syntax -- this IS the config module for ax-agents */
/**
 * Minimal env helpers for ax-agents adapters.
 *
 * No TypeBox dependency — just reads the env vars the adapters need.
 */

export interface AgentConfig {
  CLAUDE_CODE_EXECUTABLE?: string;
  CODEX_EXECUTABLE?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_AUTH_TOKEN?: string;
  OPENAI_API_KEY?: string;
}

/**
 * Resolve adapter config from an env record.
 * Callers can pass process.env or a custom override map.
 */
export function resolveConfig(
  env: Record<string, string | undefined> = process.env,
): AgentConfig {
  return {
    CLAUDE_CODE_EXECUTABLE: env.CLAUDE_CODE_EXECUTABLE,
    CODEX_EXECUTABLE: env.CODEX_EXECUTABLE,
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
    ANTHROPIC_AUTH_TOKEN: env.ANTHROPIC_AUTH_TOKEN,
    OPENAI_API_KEY: env.OPENAI_API_KEY,
  };
}

/**
 * Build a clean env for agent SDK subprocesses.
 *
 * Strips vars that leak from interactive sessions and break eval subprocesses:
 * - CLAUDECODE — nested-session guard (immediate exit)
 * - CLAUDE_CODE_OAUTH_TOKEN — causes 401 when used against the API
 */
export function getRuntimeEnv(): Record<string, string | undefined> {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_OAUTH_TOKEN;
  return env;
}
