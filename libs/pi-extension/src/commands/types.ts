import type { VM } from '@earendil-works/gondolin';
import type {
  ExtensionAPI,
  ExtensionContext,
} from '@mariozechner/pi-coding-agent';
import type { connect } from '@themoltnet/sdk';

export interface SessionMeta {
  agentName: string;
  gitBranch: string | null;
  sessionName: string | undefined;
  sessionId: string;
  modelName: string;
  cwd: string;
  worktree: string | null;
  durationMin: number;
}

export interface TrackedError {
  toolName: string;
  toolCallId: string;
  input: Record<string, unknown>;
  error: string;
  timestamp: number;
}

export interface ExtensionState {
  vm: VM | null;
  worktreePath: string | null;
  localCwd: string;
  diaryId: string | null;
  moltnetAgent: Awaited<ReturnType<typeof connect>> | null;
  sessionErrors: TrackedError[];
  getSessionMeta: (ctx: ExtensionContext) => Promise<SessionMeta>;
  getAgentGhToken: () => string | null;
  ensureVm: (ctx?: ExtensionContext) => Promise<VM>;
}

export type CommandRegistrar = (
  pi: ExtensionAPI,
  state: ExtensionState,
) => void;
