# Legreffier Local MCP Server — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local MCP server that wraps AxLearn with diary-backed storage, enabling self-improving codebase Q&A through MCP tools.

**Architecture:** A minimal Fastify + `@getlarge/fastify-mcp` server in `tools/src/legreffier-local/` exposes 5 MCP tools (`legreffier_ask`, `legreffier_feedback`, `legreffier_traces`, `legreffier_optimize`, `legreffier_status`). An `AxStorage` adapter maps AxLearn traces/checkpoints to diary entries via `@moltnet/api-client`. The AxLearn instance stays in memory for incremental learning across Claude Code sessions.

**Tech Stack:** `@ax-llm/ax` (AxLearn), `@getlarge/fastify-mcp`, `@moltnet/api-client`, `@anthropic-ai/claude-agent-sdk` (AxAI adapter), TypeBox

**Issue:** #418
**Research doc:** `docs/research/local-context-packs-axrag-self-improvement.md`

---

## File Structure

```
tools/src/legreffier-local/
├── main.ts              # Entry point — Fastify setup + MCP plugin + tool registration
├── ax-storage.ts        # AxStorage adapter backed by diary entries via API client
├── ax-agent-sdk.ts      # AxAIClaudeAgentSDK — AxBaseAI adapter for Claude Agent SDK
├── agent.ts             # AxLearn instance factory + session management
├── tools.ts             # MCP tool schemas + handler functions + registration
├── types.ts             # Shared types (config, deps, tool inputs)
└── __tests__/
    ├── ax-storage.test.ts   # AxStorage adapter unit tests (mocked API client)
    └── tools.test.ts        # Tool handler unit tests (mocked agent)
```

**Existing files to reference (read-only):**

- `apps/mcp-server/src/app.ts` — Fastify + fastify-mcp registration pattern
- `apps/mcp-server/src/info-tools.ts` — Simple tool registration example
- `apps/mcp-server/src/utils.ts` — `textResult`, `errorResult` helpers
- `apps/mcp-server/src/schemas.ts` — TypeBox schema patterns for MCP tools

**Files to modify:**

- `tools/package.json` — Add `@getlarge/fastify-mcp`, `@anthropic-ai/claude-agent-sdk`, `fastify` deps + `legreffier-local` script

---

## Chunk 1: AxStorage Adapter + Types

### Task 1: Add dependencies to tools/package.json

**Files:**

- Modify: `tools/package.json`

- [ ] **Step 1: Add dependencies**

Add to `dependencies` in `tools/package.json`:

```json
{
  "@anthropic-ai/claude-agent-sdk": "catalog:",
  "@getlarge/fastify-mcp": "catalog:",
  "fastify": "catalog:"
}
```

Add to `scripts`:

```json
{
  "legreffier-local": "tsx src/legreffier-local/main.ts"
}
```

- [ ] **Step 2: Run pnpm install**

Run: `cd /Users/edouard/Dev/getlarge/themoltnet/.worktrees/spike-legreffier-local-mcp && pnpm install`
Expected: Dependencies resolve successfully.

- [ ] **Step 3: Commit**

```bash
git add tools/package.json pnpm-lock.yaml
git commit -m "chore(tools): add fastify-mcp + claude-agent-sdk deps for legreffier-local"
```

### Task 2: Create shared types

**Files:**

- Create: `tools/src/legreffier-local/types.ts`

- [ ] **Step 1: Write types file**

```typescript
/**
 * Legreffier Local MCP — Shared Types
 */

import type { Client } from '@moltnet/api-client';
import type { AxAIService, AxLearn, AxGen } from '@ax-llm/ax';
import type { FastifyBaseLogger } from 'fastify';

/** Agent input/output signature. */
export interface AgentInput {
  question: string;
  codeContext?: string;
}

export interface AgentOutput {
  answer: string;
  confidence: 'high' | 'medium' | 'low';
}

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
```

- [ ] **Step 2: Commit**

```bash
git add tools/src/legreffier-local/types.ts
git commit -m "feat(legreffier-local): add shared types"
```

### Task 3: Implement AxStorage adapter (tests first)

**Files:**

- Create: `tools/src/legreffier-local/__tests__/ax-storage.test.ts`
- Create: `tools/src/legreffier-local/ax-storage.ts`

- [ ] **Step 1: Write failing tests for AxStorage**

```typescript
/**
 * AxStorage diary adapter — unit tests
 *
 * Tests the mapping between AxLearn's AxStorage interface and MoltNet diary entries.
 * API client is fully mocked — no network calls.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createDiaryAxStorage } from '../ax-storage.js';

// Mock the API client functions
const mockCreateEntry = vi.fn();
const mockSearchDiary = vi.fn();
const mockListEntries = vi.fn();
const mockUpdateEntry = vi.fn();

vi.mock('@moltnet/api-client', () => ({
  createDiaryEntry: (...args: unknown[]) => mockCreateEntry(...args),
  searchDiary: (...args: unknown[]) => mockSearchDiary(...args),
  listDiaryEntries: (...args: unknown[]) => mockListEntries(...args),
  updateDiaryEntryById: (...args: unknown[]) => mockUpdateEntry(...args),
}));

describe('createDiaryAxStorage', () => {
  const client = {} as any;
  const diaryId = 'diary-uuid-123';
  const bearerToken = 'test-token';
  const sessionId = 'session-uuid-456';

  let storage: ReturnType<typeof createDiaryAxStorage>;

  beforeEach(() => {
    vi.clearAllMocks();
    storage = createDiaryAxStorage({ client, diaryId, bearerToken, sessionId });
  });

  describe('save', () => {
    it('saves a trace as a procedural diary entry with correct tags', async () => {
      mockCreateEntry.mockResolvedValue({ data: { id: 'entry-1' } });

      const trace = {
        type: 'trace' as const,
        id: 'trace-abc',
        name: 'test-agent',
        input: { question: 'how does auth work?' },
        output: { answer: 'JWT tokens', confidence: 'high' },
        startTime: new Date('2026-03-16T10:00:00Z'),
        endTime: new Date('2026-03-16T10:00:05Z'),
        durationMs: 5000,
      };

      await storage.save('test-agent', trace);

      expect(mockCreateEntry).toHaveBeenCalledOnce();
      const call = mockCreateEntry.mock.calls[0][0];
      expect(call.path.diaryId).toBe(diaryId);
      expect(call.body.entryType).toBe('procedural');
      expect(call.body.tags).toEqual(
        expect.arrayContaining([
          'axlearn:trace',
          'axlearn:agent:test-agent',
          'axlearn:session:session-uuid-456',
        ]),
      );
      // Content should be JSON-serialized trace
      const content = JSON.parse(call.body.content);
      expect(content.id).toBe('trace-abc');
      expect(content.input.question).toBe('how does auth work?');
    });

    it('saves a checkpoint as a reflection diary entry with version tag', async () => {
      mockCreateEntry.mockResolvedValue({ data: { id: 'entry-2' } });

      const checkpoint = {
        type: 'checkpoint' as const,
        name: 'test-agent',
        version: 3,
        createdAt: new Date('2026-03-16T12:00:00Z'),
        instruction: 'You are a helpful assistant.',
        examples: [{ input: { question: 'q' }, output: { answer: 'a' } }],
        score: 0.85,
      };

      await storage.save('test-agent', checkpoint);

      expect(mockCreateEntry).toHaveBeenCalledOnce();
      const call = mockCreateEntry.mock.calls[0][0];
      expect(call.body.entryType).toBe('reflection');
      expect(call.body.tags).toEqual(
        expect.arrayContaining([
          'axlearn:checkpoint',
          'axlearn:agent:test-agent',
          'axlearn:v:3',
        ]),
      );
      expect(call.body.importance).toBe(8); // Checkpoints are high importance
    });
  });

  describe('load', () => {
    it('loads traces via searchDiary with correct tag filters', async () => {
      const now = new Date();
      mockSearchDiary.mockResolvedValue({
        data: {
          entries: [
            {
              id: 'entry-1',
              content: JSON.stringify({
                type: 'trace',
                id: 'trace-abc',
                name: 'test-agent',
                input: { question: 'q' },
                output: { answer: 'a', confidence: 'high' },
                startTime: now.toISOString(),
                endTime: now.toISOString(),
                durationMs: 100,
              }),
              tags: ['axlearn:trace', 'axlearn:agent:test-agent'],
              createdAt: now.toISOString(),
            },
          ],
        },
      });

      const result = await storage.load('test-agent', {
        type: 'trace',
        limit: 5,
      });

      expect(mockSearchDiary).toHaveBeenCalledOnce();
      const call = mockSearchDiary.mock.calls[0][0];
      expect(call.body.tags).toEqual(
        expect.arrayContaining(['axlearn:trace', 'axlearn:agent:test-agent']),
      );
      expect(call.body.limit).toBe(5);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('trace');
      expect((result[0] as any).id).toBe('trace-abc');
    });

    it('loads checkpoints via listDiaryEntries with tag filter', async () => {
      mockListEntries.mockResolvedValue({
        data: {
          entries: [
            {
              id: 'entry-2',
              content: JSON.stringify({
                type: 'checkpoint',
                name: 'test-agent',
                version: 3,
                createdAt: '2026-03-16T12:00:00Z',
                instruction: 'Be helpful.',
                score: 0.85,
              }),
              tags: [
                'axlearn:checkpoint',
                'axlearn:agent:test-agent',
                'axlearn:v:3',
              ],
              createdAt: '2026-03-16T12:00:00Z',
            },
          ],
        },
      });

      const result = await storage.load('test-agent', {
        type: 'checkpoint',
        limit: 1,
      });

      expect(mockListEntries).toHaveBeenCalledOnce();
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('checkpoint');
      expect((result[0] as any).version).toBe(3);
    });

    it('filters traces by hasFeedback when requested', async () => {
      mockSearchDiary.mockResolvedValue({ data: { entries: [] } });

      await storage.load('test-agent', {
        type: 'trace',
        hasFeedback: true,
      });

      const call = mockSearchDiary.mock.calls[0][0];
      expect(call.body.tags).toEqual(
        expect.arrayContaining(['axlearn:has-feedback']),
      );
    });

    it('returns empty array when API returns no entries', async () => {
      mockSearchDiary.mockResolvedValue({ data: { entries: [] } });

      const result = await storage.load('test-agent', { type: 'trace' });
      expect(result).toEqual([]);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/edouard/Dev/getlarge/themoltnet/.worktrees/spike-legreffier-local-mcp && pnpm --filter @moltnet/tools vitest run src/legreffier-local/__tests__/ax-storage.test.ts`
Expected: FAIL — `createDiaryAxStorage` does not exist.

- [ ] **Step 3: Implement AxStorage adapter**

```typescript
/**
 * AxStorage adapter backed by MoltNet diary entries.
 *
 * Maps AxLearn's AxStorage interface to diary entry CRUD:
 * - Traces → procedural entries tagged axlearn:trace
 * - Checkpoints → reflection entries tagged axlearn:checkpoint
 * - Queries → searchDiary (traces) or listDiaryEntries (checkpoints)
 */

import type {
  AxCheckpoint,
  AxStorage,
  AxStorageQuery,
  AxTrace,
} from '@ax-llm/ax';
import {
  createDiaryEntry,
  listDiaryEntries,
  searchDiary,
  updateDiaryEntryById,
} from '@moltnet/api-client';
import type { Client } from '@moltnet/api-client';

export interface DiaryStorageOptions {
  client: Client;
  diaryId: string;
  bearerToken: string;
  sessionId: string;
}

export function createDiaryAxStorage(options: DiaryStorageOptions): AxStorage {
  const { client, diaryId, bearerToken, sessionId } = options;
  const auth = () => bearerToken;

  /** Map from trace ID to diary entry ID (for feedback updates). */
  const traceEntryMap = new Map<string, string>();

  const save = async (
    name: string,
    item: AxTrace | AxCheckpoint,
  ): Promise<void> => {
    if (item.type === 'trace') {
      const trace = item as AxTrace;
      const tags = [
        'axlearn:trace',
        `axlearn:agent:${name}`,
        `axlearn:session:${sessionId}`,
      ];
      if (trace.feedback) {
        tags.push('axlearn:has-feedback');
      }

      // Check if this trace already exists (feedback update)
      const existingEntryId = traceEntryMap.get(trace.id);
      if (existingEntryId) {
        await updateDiaryEntryById({
          client,
          auth,
          path: { entryId: existingEntryId },
          body: {
            content: JSON.stringify(trace),
            tags,
          },
        });
        return;
      }

      const { data } = await createDiaryEntry({
        client,
        auth,
        path: { diaryId },
        body: {
          content: JSON.stringify(trace),
          title: `axlearn trace: ${truncate(stringifyInput(trace.input), 80)}`,
          entryType: 'procedural',
          tags,
          importance: 5,
        },
      });
      if (data?.id) {
        traceEntryMap.set(trace.id, data.id);
      }
    } else {
      const checkpoint = item as AxCheckpoint;
      const tags = [
        'axlearn:checkpoint',
        `axlearn:agent:${name}`,
        `axlearn:v:${checkpoint.version}`,
      ];

      await createDiaryEntry({
        client,
        auth,
        path: { diaryId },
        body: {
          content: JSON.stringify(checkpoint),
          title: `axlearn checkpoint v${checkpoint.version} (score: ${checkpoint.score?.toFixed(2) ?? 'n/a'})`,
          entryType: 'reflection',
          tags,
          importance: 8,
        },
      });
    }
  };

  const load = async (
    name: string,
    query: AxStorageQuery,
  ): Promise<(AxTrace | AxCheckpoint)[]> => {
    if (query.type === 'trace') {
      const tags = ['axlearn:trace', `axlearn:agent:${name}`];
      if (query.hasFeedback) {
        tags.push('axlearn:has-feedback');
      }

      const { data } = await searchDiary({
        client,
        auth,
        body: {
          diaryId,
          tags,
          limit: query.limit ?? 50,
          offset: query.offset,
          entryTypes: ['procedural'],
        },
      });

      return parseEntries(data?.entries);
    }

    // Checkpoints: use list with tag filter
    const tags = [`axlearn:checkpoint`, `axlearn:agent:${name}`];
    if (query.version !== undefined) {
      tags.push(`axlearn:v:${query.version}`);
    }

    const { data } = await listDiaryEntries({
      client,
      auth,
      path: { diaryId },
      query: {
        tags: tags.join(','),
        limit: query.limit ?? 10,
      },
    });

    return parseEntries(data?.entries);
  };

  return { save, load };
}

function parseEntries(
  entries: Array<{ content: string }> | undefined,
): (AxTrace | AxCheckpoint)[] {
  if (!entries?.length) return [];
  return entries
    .map((e) => {
      try {
        const parsed = JSON.parse(e.content);
        // Restore Date objects from ISO strings
        if (parsed.type === 'trace') {
          parsed.startTime = new Date(parsed.startTime);
          parsed.endTime = new Date(parsed.endTime);
        }
        if (parsed.type === 'checkpoint' && parsed.createdAt) {
          parsed.createdAt = new Date(parsed.createdAt);
        }
        return parsed;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function stringifyInput(input: Record<string, unknown>): string {
  const question = input.question;
  if (typeof question === 'string') return question;
  return JSON.stringify(input);
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 3) + '...';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/edouard/Dev/getlarge/themoltnet/.worktrees/spike-legreffier-local-mcp && pnpm --filter @moltnet/tools vitest run src/legreffier-local/__tests__/ax-storage.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/src/legreffier-local/ax-storage.ts tools/src/legreffier-local/__tests__/ax-storage.test.ts
git commit -m "feat(legreffier-local): add AxStorage adapter backed by diary entries"
```

---

## Chunk 2: AxAI Adapter + Agent Factory

### Task 4: Create AxAIClaudeAgentSDK adapter

This adapter wraps `@anthropic-ai/claude-agent-sdk` as an AxAI-compatible service so AxLearn can use Claude via keychain auth. The full implementation exists at `/Users/edouard/Dev/getlarge/themoltnet/libs/context-evals/src/ax-claude-agent-sdk.ts` (on the `fix/skill-eval-pipeline-training-examples` branch in the main worktree — not yet on `origin/main`).

**Files:**

- Create: `tools/src/legreffier-local/ax-agent-sdk.ts`

- [ ] **Step 1: Copy and simplify the adapter**

Copy the file from the main worktree:

```bash
cp /Users/edouard/Dev/getlarge/themoltnet/libs/context-evals/src/ax-claude-agent-sdk.ts \
   /Users/edouard/Dev/getlarge/themoltnet/.worktrees/spike-legreffier-local-mcp/tools/src/legreffier-local/ax-agent-sdk.ts
```

Then simplify:

1. Remove the imports of `getRuntimeEnv` and `loadContextEvalsConfig` from `./config.js`
2. Remove the import of `ResultPayload` from `./sdk-types.js`
3. Replace `loadContextEvalsConfig()` in `buildQueryOptions` with inline env reads:
   - `process.env.CLAUDE_CODE_EXECUTABLE` for pathToClaudeCodeExecutable
   - `process.env.ANTHROPIC_API_KEY` / `process.env.ANTHROPIC_AUTH_TOKEN` for auth
4. Replace `getRuntimeEnv()` with `{}` (no special env forwarding needed for this spike)
5. Inline the `ResultPayload` type (it's just the shape of the `result` message from Claude Agent SDK):
   ```typescript
   interface ResultPayload {
     type: 'result';
     subtype: 'success' | 'error';
     result?: string;
     errors?: string[];
     usage?: {
       input_tokens: number;
       output_tokens: number;
       cache_creation_input_tokens?: number;
       cache_read_input_tokens?: number;
     };
     num_turns?: number;
     duration_ms?: number;
     duration_api_ms?: number;
     total_cost_usd?: number;
   }
   ```
6. Remove streaming (`runAgentQueryStream`) — not needed for AxLearn. Set `FEATURES.streaming` to `false`.

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/edouard/Dev/getlarge/themoltnet/.worktrees/spike-legreffier-local-mcp && pnpm --filter @moltnet/tools run typecheck`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add tools/src/legreffier-local/ax-agent-sdk.ts
git commit -m "feat(legreffier-local): add AxAIClaudeAgentSDK adapter for AxLearn"
```

### Task 5: Create agent factory

**Files:**

- Create: `tools/src/legreffier-local/agent.ts`

- [ ] **Step 1: Write agent factory**

```typescript
/**
 * AxLearn agent factory — creates and configures the self-improving agent.
 */

import { ax, AxLearn, type AxGen } from '@ax-llm/ax';
import type { Client } from '@moltnet/api-client';

import { AxAIClaudeAgentSDK } from './ax-agent-sdk.js';
import { createDiaryAxStorage } from './ax-storage.js';
import type { AgentInput, AgentOutput, ServerConfig } from './types.js';

export interface AgentBundle {
  agent: AxLearn<AgentInput, AgentOutput>;
  gen: AxGen<AgentInput, AgentOutput>;
  studentAi: AxAIClaudeAgentSDK;
}

export function createAgent(
  config: ServerConfig,
  sessionId: string,
  client: Client,
): AgentBundle {
  const storage = createDiaryAxStorage({
    client,
    diaryId: config.diaryId,
    bearerToken: config.bearerToken,
    sessionId,
  });

  const teacherAi = new AxAIClaudeAgentSDK({ model: config.teacherModel });
  const studentAi = new AxAIClaudeAgentSDK({ model: config.studentModel });

  const gen =
    ax<'question:string "User question about the codebase", codeContext?:string "Relevant code or docs" -> answer:string "Helpful answer", confidence:class "high, medium, low"'>(
      'question:string "User question about the codebase", codeContext?:string "Relevant code or docs" -> answer:string "Helpful answer", confidence:class "high, medium, low"',
    ) as unknown as AxGen<AgentInput, AgentOutput>;

  gen.setInstruction(
    'You are a MoltNet development assistant. Answer questions about the MoltNet codebase accurately and concisely. Cite specific files and patterns when possible. If you are unsure, say so and indicate low confidence.',
  );

  const agent = new AxLearn(gen, {
    name: 'legreffier-local',
    teacher: teacherAi,
    storage,
    budget: 5,
    generateExamples: false,
    useTraces: true,
  });

  return { agent, gen, studentAi };
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/edouard/Dev/getlarge/themoltnet/.worktrees/spike-legreffier-local-mcp && pnpm --filter @moltnet/tools run typecheck`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add tools/src/legreffier-local/agent.ts
git commit -m "feat(legreffier-local): add AxLearn agent factory with diary storage"
```

---

## Chunk 3: MCP Tools + Server Entry Point

### Task 6: Implement MCP tool handlers (tests first)

**Files:**

- Create: `tools/src/legreffier-local/__tests__/tools.test.ts`
- Create: `tools/src/legreffier-local/tools.ts`

- [ ] **Step 1: Write failing tests for tool handlers**

```typescript
/**
 * MCP tool handler tests — mocked agent, no network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  handleAsk,
  handleFeedback,
  handleTraces,
  handleStatus,
} from '../tools.js';
import type { LocalMcpDeps } from '../types.js';

function makeDeps(overrides: Partial<LocalMcpDeps> = {}): LocalMcpDeps {
  return {
    agent: {
      forward: vi
        .fn()
        .mockResolvedValue({ answer: 'test answer', confidence: 'high' }),
      getTraces: vi.fn().mockResolvedValue([]),
      addFeedback: vi.fn().mockResolvedValue(undefined),
      optimize: vi
        .fn()
        .mockResolvedValue({
          score: 0.8,
          improvement: 0.1,
          checkpointVersion: 1,
          stats: {
            trainingExamples: 3,
            validationExamples: 1,
            durationMs: 5000,
          },
        }),
      getGen: vi
        .fn()
        .mockReturnValue({ getInstruction: () => 'test instruction' }),
      getStorage: vi.fn(),
    } as any,
    gen: {} as any,
    studentAi: {} as any,
    client: {} as any,
    config: {
      apiBaseUrl: 'http://localhost:8000',
      diaryId: 'diary-1',
      bearerToken: 'tok',
      port: 0,
      teacherModel: 'opus',
      studentModel: 'sonnet',
      idleTimeoutMs: 7200000,
    },
    logger: {
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
    } as any,
    sessionId: 'session-123',
    traceCounter: 0,
    traceIndex: new Map(),
    lastActivity: Date.now(),
    startTime: Date.now(),
  };
}

describe('handleAsk', () => {
  it('calls agent.forward and returns answer with trace index', async () => {
    const deps = makeDeps();
    (deps.agent.forward as any).mockResolvedValue({
      answer: 'JWT auth',
      confidence: 'high',
    });

    const result = await handleAsk({ question: 'how does auth work?' }, deps);
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.answer).toBe('JWT auth');
    expect(parsed.confidence).toBe('high');
    expect(parsed.traceIndex).toBe(1);
    expect(deps.traceCounter).toBe(1);
  });
});

describe('handleFeedback', () => {
  it('adds feedback to the latest trace when no traceIndex given', async () => {
    const deps = makeDeps();
    deps.traceCounter = 1;
    deps.traceIndex.set(1, 'trace-id-abc');
    (deps.agent.getTraces as any).mockResolvedValue([{ id: 'trace-id-abc' }]);

    const result = await handleFeedback({ score: 0, comment: 'wrong' }, deps);

    expect(deps.agent.addFeedback).toHaveBeenCalledWith('trace-id-abc', {
      score: 0,
      comment: 'wrong',
    });
    expect(result.isError).toBeFalsy();
  });

  it('returns error when no traces exist', async () => {
    const deps = makeDeps();
    const result = await handleFeedback({ score: 1 }, deps);
    expect(result.isError).toBe(true);
  });
});

describe('handleTraces', () => {
  it('returns formatted trace list', async () => {
    const deps = makeDeps();
    const now = new Date();
    (deps.agent.getTraces as any).mockResolvedValue([
      {
        id: 'trace-1',
        input: { question: 'auth?' },
        output: { answer: 'JWT', confidence: 'high' },
        startTime: now,
        durationMs: 100,
        feedback: { score: 1 },
      },
    ]);

    const result = await handleTraces({ limit: 5 }, deps);
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.traces).toHaveLength(1);
    expect(parsed.traces[0].question).toBe('auth?');
    expect(parsed.traces[0].score).toBe(1);
  });
});

describe('handleStatus', () => {
  it('returns session info', async () => {
    const deps = makeDeps();
    (deps.agent.getTraces as any).mockResolvedValue([
      { feedback: { score: 0.8 } },
      { feedback: { score: 0.6 } },
    ]);

    const result = await handleStatus(deps);
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.sessionId).toBe('session-123');
    expect(parsed.traceCount).toBe(2);
    expect(parsed.avgScore).toBeCloseTo(0.7);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/edouard/Dev/getlarge/themoltnet/.worktrees/spike-legreffier-local-mcp && pnpm --filter @moltnet/tools vitest run src/legreffier-local/__tests__/tools.test.ts`
Expected: FAIL — handler functions don't exist.

- [ ] **Step 3: Implement tool handlers and registration**

```typescript
/**
 * Legreffier Local MCP — Tool handlers + registration
 */

import { Type, type Static } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import type { LocalMcpDeps } from './types.js';

// ── Schemas ───────────────────────────────────────────

export const AskSchema = Type.Object({
  question: Type.String({ description: 'Question about the codebase.' }),
  codeContext: Type.Optional(
    Type.String({
      description: 'Relevant code snippet or file content for context.',
    }),
  ),
});

export const FeedbackSchema = Type.Object({
  traceIndex: Type.Optional(
    Type.Integer({
      description: 'Trace index from this session (default: latest).',
    }),
  ),
  score: Type.Number({
    description: 'Quality score: 0 = bad, 1 = good.',
    minimum: 0,
    maximum: 1,
  }),
  label: Type.Optional(
    Type.String({ description: 'Short label (e.g. "wrong-scope").' }),
  ),
  comment: Type.Optional(Type.String({ description: 'Detailed feedback.' })),
});

export const TracesSchema = Type.Object({
  limit: Type.Optional(
    Type.Integer({
      description: 'Max traces to return (default: 5).',
      minimum: 1,
      maximum: 50,
    }),
  ),
});

export const OptimizeSchema = Type.Object({
  budget: Type.Optional(
    Type.Integer({
      description: 'Max optimization rounds (default: 5).',
      minimum: 1,
      maximum: 20,
    }),
  ),
});

export const StatusSchema = Type.Object({});

type AskInput = Static<typeof AskSchema>;
type FeedbackInput = Static<typeof FeedbackSchema>;
type TracesInput = Static<typeof TracesSchema>;
type OptimizeInput = Static<typeof OptimizeSchema>;

// ── Result helpers ────────────────────────────────────

interface CallToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

function textResult(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function errorResult(message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

// ── Handlers ──────────────────────────────────────────

export async function handleAsk(
  args: AskInput,
  deps: LocalMcpDeps,
): Promise<CallToolResult> {
  deps.lastActivity = Date.now();

  try {
    const result = await deps.agent.forward(deps.studentAi, {
      question: args.question,
      codeContext: args.codeContext,
    });

    // Get the trace that was just created
    const traces = await deps.agent.getTraces({ limit: 1 });
    const latestTrace = traces[0];

    deps.traceCounter++;
    if (latestTrace) {
      deps.traceIndex.set(deps.traceCounter, latestTrace.id);
    }

    return textResult({
      answer: result.answer,
      confidence: result.confidence,
      traceIndex: deps.traceCounter,
    });
  } catch (err) {
    deps.logger.error({ err }, 'legreffier_ask failed');
    return errorResult(
      err instanceof Error ? err.message : 'Forward call failed',
    );
  }
}

export async function handleFeedback(
  args: FeedbackInput,
  deps: LocalMcpDeps,
): Promise<CallToolResult> {
  deps.lastActivity = Date.now();

  const targetIndex = args.traceIndex ?? deps.traceCounter;
  const traceId = deps.traceIndex.get(targetIndex);

  if (!traceId) {
    return errorResult(
      `No trace found at index ${targetIndex}. Run legreffier_ask first.`,
    );
  }

  const feedback: { score?: number; label?: string; comment?: string } = {
    score: args.score,
  };
  if (args.label) feedback.label = args.label;
  if (args.comment) feedback.comment = args.comment;

  try {
    await deps.agent.addFeedback(traceId, feedback);
    return textResult({
      success: true,
      traceIndex: targetIndex,
      feedback,
    });
  } catch (err) {
    deps.logger.error({ err }, 'legreffier_feedback failed');
    return errorResult(err instanceof Error ? err.message : 'Feedback failed');
  }
}

export async function handleTraces(
  args: TracesInput,
  deps: LocalMcpDeps,
): Promise<CallToolResult> {
  deps.lastActivity = Date.now();

  const traces = await deps.agent.getTraces({ limit: args.limit ?? 5 });

  const formatted = traces.map((t, i) => ({
    index: deps.traceCounter - i,
    question: (t.input as Record<string, unknown>).question,
    answer: truncate(
      String((t.output as Record<string, unknown>).answer ?? ''),
      100,
    ),
    confidence: (t.output as Record<string, unknown>).confidence,
    score: t.feedback?.score ?? null,
    label: t.feedback?.label ?? null,
    durationMs: t.durationMs,
    time: t.startTime,
  }));

  return textResult({ traces: formatted });
}

export async function handleOptimize(
  args: OptimizeInput,
  deps: LocalMcpDeps,
): Promise<CallToolResult> {
  deps.lastActivity = Date.now();
  deps.logger.info('Starting optimization...');

  try {
    const result = await deps.agent.optimize({
      budget: args.budget,
    });

    return textResult({
      score: result.score,
      improvement: result.improvement,
      checkpointVersion: result.checkpointVersion,
      stats: result.stats,
    });
  } catch (err) {
    deps.logger.error({ err }, 'legreffier_optimize failed');
    return errorResult(
      err instanceof Error ? err.message : 'Optimization failed',
    );
  }
}

export async function handleStatus(
  deps: LocalMcpDeps,
): Promise<CallToolResult> {
  deps.lastActivity = Date.now();

  const traces = await deps.agent.getTraces({ limit: 100 });
  const scores = traces
    .map((t) => t.feedback?.score)
    .filter((s): s is number => s !== undefined);
  const avgScore =
    scores.length > 0
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : null;

  const instruction = deps.agent.getGen().getInstruction();

  return textResult({
    sessionId: deps.sessionId,
    traceCount: traces.length,
    tracesWithFeedback: scores.length,
    avgScore,
    currentInstruction: instruction ? truncate(instruction, 200) : null,
    uptimeSeconds: Math.round((Date.now() - deps.startTime) / 1000),
  });
}

// ── Registration ──────────────────────────────────────

export function registerTools(
  fastify: FastifyInstance,
  deps: LocalMcpDeps,
): void {
  fastify.mcpAddTool(
    {
      name: 'legreffier_ask',
      description:
        'Ask a question about the codebase. The answer is traced and can receive feedback for self-improvement.',
      inputSchema: AskSchema,
    },
    async (args: AskInput) => handleAsk(args, deps),
  );

  fastify.mcpAddTool(
    {
      name: 'legreffier_feedback',
      description:
        'Give feedback on a previous answer. Score 0-1 (0=bad, 1=good). Targets latest trace by default.',
      inputSchema: FeedbackSchema,
    },
    async (args: FeedbackInput) => handleFeedback(args, deps),
  );

  fastify.mcpAddTool(
    {
      name: 'legreffier_traces',
      description:
        'List recent traces (questions + answers + scores) from this session.',
      inputSchema: TracesSchema,
    },
    async (args: TracesInput) => handleTraces(args, deps),
  );

  fastify.mcpAddTool(
    {
      name: 'legreffier_optimize',
      description:
        'Run batch optimization. Teacher model reviews traces with feedback and produces an improved checkpoint.',
      inputSchema: OptimizeSchema,
    },
    async (args: OptimizeInput) => handleOptimize(args, deps),
  );

  fastify.mcpAddTool(
    {
      name: 'legreffier_status',
      description:
        'Show session status: trace count, avg score, checkpoint info.',
      inputSchema: StatusSchema,
    },
    async () => handleStatus(deps),
  );
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 3) + '...';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/edouard/Dev/getlarge/themoltnet/.worktrees/spike-legreffier-local-mcp && pnpm --filter @moltnet/tools vitest run src/legreffier-local/__tests__/tools.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/src/legreffier-local/tools.ts tools/src/legreffier-local/__tests__/tools.test.ts
git commit -m "feat(legreffier-local): add MCP tool handlers with tests"
```

### Task 7: Create server entry point

**Files:**

- Create: `tools/src/legreffier-local/main.ts`

- [ ] **Step 1: Write server entry point**

```typescript
#!/usr/bin/env -S npx tsx
/**
 * Legreffier Local MCP Server
 *
 * A local MCP server that wraps AxLearn with diary-backed storage
 * for self-improving codebase Q&A.
 *
 * Usage:
 *   pnpm legreffier-local
 *
 * Environment:
 *   MOLTNET_API_URL    — REST API base URL (default: http://localhost:8000)
 *   MOLTNET_DIARY_ID   — Diary UUID for storage (required)
 *   MOLTNET_TOKEN      — Bearer token for API auth (required)
 *   LEGREFFIER_PORT    — SSE port (default: 0 = random)
 *   LEGREFFIER_TEACHER — Teacher model (default: claude-opus-4-6)
 *   LEGREFFIER_STUDENT — Student model (default: claude-sonnet-4-6)
 *   LEGREFFIER_IDLE_MS — Idle timeout in ms (default: 7200000 = 2h)
 */

import { randomUUID } from 'node:crypto';

import mcpPlugin from '@getlarge/fastify-mcp';
import { createClient } from '@moltnet/api-client';
import Fastify from 'fastify';

import { createAgent } from './agent.js';
import { registerTools } from './tools.js';
import type { LocalMcpDeps, ServerConfig } from './types.js';

function loadConfig(): ServerConfig {
  const diaryId = process.env.MOLTNET_DIARY_ID;
  const bearerToken = process.env.MOLTNET_TOKEN;

  if (!diaryId) {
    console.error('MOLTNET_DIARY_ID is required');
    process.exit(1);
  }
  if (!bearerToken) {
    console.error('MOLTNET_TOKEN is required');
    process.exit(1);
  }

  return {
    apiBaseUrl: process.env.MOLTNET_API_URL ?? 'http://localhost:8000',
    diaryId,
    bearerToken,
    port: parseInt(process.env.LEGREFFIER_PORT ?? '0', 10),
    teacherModel: process.env.LEGREFFIER_TEACHER ?? 'claude-opus-4-6',
    studentModel: process.env.LEGREFFIER_STUDENT ?? 'claude-sonnet-4-6',
    idleTimeoutMs: parseInt(process.env.LEGREFFIER_IDLE_MS ?? '7200000', 10),
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const sessionId = randomUUID();

  const app = Fastify({ logger: { level: 'info' } });

  // Health check
  app.get('/healthz', () => ({ status: 'ok', sessionId }));

  // Register MCP plugin (no auth)
  await app.register(mcpPlugin, {
    serverInfo: { name: 'legreffier-local', version: '0.1.0' },
    capabilities: { tools: {} },
    enableSSE: true,
    sessionStore: 'memory',
    authorization: { enabled: false },
  });

  // Create API client + agent
  const client = createClient({ baseUrl: config.apiBaseUrl });
  const { agent, gen, studentAi } = createAgent(config, sessionId, client);

  // Build deps
  const deps: LocalMcpDeps = {
    agent,
    gen,
    studentAi,
    client,
    config,
    logger: app.log,
    sessionId,
    traceCounter: 0,
    traceIndex: new Map(),
    lastActivity: Date.now(),
    startTime: Date.now(),
  };

  // Register tools
  registerTools(app, deps);

  // Start server
  const address = await app.listen({ port: config.port, host: '127.0.0.1' });
  app.log.info({ address, sessionId }, 'Legreffier local MCP server started');

  // Idle shutdown timer
  const idleCheck = setInterval(() => {
    if (Date.now() - deps.lastActivity > config.idleTimeoutMs) {
      app.log.info('Idle timeout reached, shutting down');
      clearInterval(idleCheck);
      app.close();
    }
  }, 60_000);

  // Graceful shutdown
  const shutdown = async () => {
    clearInterval(idleCheck);
    app.log.info('Shutting down...');
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/edouard/Dev/getlarge/themoltnet/.worktrees/spike-legreffier-local-mcp && pnpm --filter @moltnet/tools run typecheck`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add tools/src/legreffier-local/main.ts
git commit -m "feat(legreffier-local): add MCP server entry point with idle shutdown"
```

---

## Chunk 4: Integration Testing + Claude Code Registration

### Task 8: Manual smoke test against local dev

**Files:**

- No new files — this is a verification step.

Prerequisites: Docker Compose stack running (`docker compose --env-file .env.local up -d`), a diary + bearer token available.

- [ ] **Step 1: Start the server manually**

```bash
cd /Users/edouard/Dev/getlarge/themoltnet/.worktrees/spike-legreffier-local-mcp
MOLTNET_DIARY_ID=<your-diary-id> MOLTNET_TOKEN=<your-token> pnpm legreffier-local
```

Expected: Server starts, prints address + session ID.

- [ ] **Step 2: Test health endpoint**

```bash
curl http://127.0.0.1:<port>/healthz
```

Expected: `{"status":"ok","sessionId":"..."}`

- [ ] **Step 3: Test MCP tool list via SSE**

```bash
curl http://127.0.0.1:<port>/mcp -H 'Accept: text/event-stream'
```

Expected: SSE stream with MCP protocol. Tools should be discoverable via `tools/list`.

### Task 9: Register in Claude Code settings

**Files:**

- Note: `.claude/settings.json` is user-local, do not commit. Document the config in the research doc.

- [ ] **Step 1: Document MCP registration**

Add to `docs/research/local-context-packs-axrag-self-improvement.md`:

```json
// Add to .claude/settings.json (user-local, not committed)
{
  "mcpServers": {
    "legreffier-local": {
      "args": ["tsx", "tools/src/legreffier-local/main.ts"],
      "command": "npx",
      "cwd": "/path/to/themoltnet",
      "env": {
        "MOLTNET_API_URL": "http://localhost:8000",
        "MOLTNET_DIARY_ID": "<your-diary-id>",
        "MOLTNET_TOKEN": "<your-token>"
      }
    }
  }
}
```

- [ ] **Step 2: Commit docs update**

```bash
git add docs/research/local-context-packs-axrag-self-improvement.md
git commit -m "docs: add Claude Code MCP registration instructions"
```

### Task 10: Run all tests + final verification

- [ ] **Step 1: Run full test suite**

```bash
cd /Users/edouard/Dev/getlarge/themoltnet/.worktrees/spike-legreffier-local-mcp
pnpm --filter @moltnet/tools vitest run src/legreffier-local/
```

Expected: All unit tests pass.

- [ ] **Step 2: Run typecheck**

```bash
pnpm --filter @moltnet/tools run typecheck
```

Expected: No type errors.

- [ ] **Step 3: Run lint**

```bash
pnpm --filter @moltnet/tools run lint
```

Expected: No lint errors (or only pre-existing ones).

- [ ] **Step 4: Final commit if needed**

```bash
git add -A
git commit -m "chore(legreffier-local): fix lint/type issues from final review"
```
