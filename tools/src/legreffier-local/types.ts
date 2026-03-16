/**
 * Legreffier Local MCP — Shared Types
 */

import type { AxAIService, AxGen, AxLearn } from '@ax-llm/ax';
import type { Client } from '@moltnet/api-client';
import type { FastifyBaseLogger } from 'fastify';

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

/** Server configuration loaded from environment. */
export interface ServerConfig {
  /** MoltNet REST API base URL (default: http://localhost:8000) */
  apiBaseUrl: string;
  /** Diary ID to use for storage */
  diaryId: string;
  /** Bearer token for API auth */
  bearerToken: string;
  /** Port for MCP SSE transport (default: 0 = random) */
  port: number;
  /** Teacher model for optimization (default: claude-opus-4-6) */
  teacherModel: string;
  /** Student model for forward calls (default: claude-sonnet-4-6) */
  studentModel: string;
  /** Idle timeout in ms before auto-shutdown (default: 7200000 = 2h) */
  idleTimeoutMs: number;
}

/** Dependencies injected into tool handlers. */
export interface LocalMcpDeps {
  agent: AxLearn<AgentInput, AgentOutput>;
  gen: AxGen<AgentInput, AgentOutput>;
  studentAi: AxAIService;
  client: Client;
  config: ServerConfig;
  logger: FastifyBaseLogger;
  /** Current session UUID (generated on server start). */
  sessionId: string;
  /** Tracks trace index within session for easy feedback targeting. */
  traceCounter: number;
  /** Map of session-local index → trace ID for feedback targeting. */
  traceIndex: Map<number, string>;
  /** Last activity timestamp for idle shutdown. */
  lastActivity: number;
  /** Server start timestamp for uptime calculation. */
  startTime: number;
}
