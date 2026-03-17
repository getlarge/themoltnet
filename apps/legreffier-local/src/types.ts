/**
 * Legreffier Local MCP — Shared Types
 */

import type { AxAIService, AxGen, AxLearn } from '@ax-llm/ax';
import type { Agent } from '@themoltnet/sdk';
import type { FastifyBaseLogger } from 'fastify';

import type { ServerConfigEnv } from './config.js';

/** Agent input/output signature. Index signatures required by AxGenIn/AxGenOut. */
export type AgentInput = {
  [key: string]: string | undefined;
  question: string;
  codeContext?: string;
};

export type AgentOutput = {
  [key: string]: string | undefined;
  answer: string;
  confidence: 'high' | 'medium' | 'low';
};

/** Immutable context injected at startup. */
export interface LocalMcpContext {
  agent: AxLearn<AgentInput, AgentOutput>;
  gen: AxGen<AgentInput, AgentOutput>;
  studentAi: AxAIService;
  /** Authenticated SDK agent — handles token refresh, diary CRUD, etc. */
  sdkAgent: Agent;
  /** Diary ID resolved at startup. */
  diaryId: string;
  config: ServerConfigEnv;
  logger: FastifyBaseLogger;
  /** Current session UUID (generated on server start). */
  sessionId: string;
}

/** Mutable session state — mutated by tool handlers. */
export interface LocalMcpState {
  /** Tracks trace index within session for easy feedback targeting. */
  traceCounter: number;
  /** Map of session-local index → trace ID for feedback targeting. */
  traceIndex: Map<number, string>;
  /** Last activity timestamp for idle shutdown. */
  lastActivity: number;
  /** Server start timestamp for uptime calculation. */
  startTime: number;
}

/** Combined deps passed to tool handlers. */
export type LocalMcpDeps = LocalMcpContext & LocalMcpState;
