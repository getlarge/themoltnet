import type { AgentType } from '../ui/types.js';
import { ClaudeAdapter } from './claude.js';
import { CodexAdapter } from './codex.js';
import { OpencodeAdapter } from './opencode.js';
import type { AgentAdapter } from './types.js';

export const adapters: Record<AgentType, AgentAdapter> = {
  claude: new ClaudeAdapter(),
  codex: new CodexAdapter(),
  opencode: new OpencodeAdapter(),
};

export type { AgentAdapter, AgentAdapterOptions } from './types.js';
