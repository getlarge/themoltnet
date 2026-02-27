import type { AgentType } from '../ui/types.js';
import { ClaudeAdapter } from './claude.js';
import { CodexAdapter } from './codex.js';
import type { AgentAdapter } from './types.js';

export const adapters: Record<AgentType, AgentAdapter> = {
  claude: new ClaudeAdapter(),
  codex: new CodexAdapter(),
};

export type { AgentAdapter, AgentAdapterOptions } from './types.js';
