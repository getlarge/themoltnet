import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  handleTasksAttemptsList,
  handleTasksConsoleLink,
  handleTasksCreate,
  handleTasksGet,
  handleTasksList,
  handleTasksMessagesList,
  handleTasksSchemas,
} from '../src/task-tools.js';
import type { HandlerContext, McpDeps } from '../src/types.js';
import {
  createMockContext,
  createMockDeps,
  DIARY_ID,
  getTextContent,
  parseResult,
  sdkErr,
  sdkOk,
} from './helpers.js';

vi.mock('@moltnet/api-client', () => ({
  createTask: vi.fn(),
  getTask: vi.fn(),
  listTaskAttempts: vi.fn(),
  listTaskMessages: vi.fn(),
  listTasks: vi.fn(),
  listTaskSchemas: vi.fn(),
}));

import {
  createTask,
  getTask,
  listTaskAttempts,
  listTaskMessages,
  listTasks,
  listTaskSchemas,
} from '@moltnet/api-client';

const TASK_ID = '110e8400-e29b-41d4-a716-446655440091';
const TEAM_ID = '220e8400-e29b-41d4-a716-446655440091';
const ATTEMPT_N = 1;

const taskInput = {
  diaryId: DIARY_ID,
  taskPrompt: 'Curate task-management context',
};

const mockTask = {
  id: TASK_ID,
  taskType: 'curate_pack',
  teamId: TEAM_ID,
  diaryId: DIARY_ID,
  outputKind: 'artifact',
  input: taskInput,
  inputSchemaCid: 'bafy-schema',
  inputCid: 'bafy-input',
  criteriaCid: null,
  references: [],
  correlationId: null,
  imposedByAgentId: '330e8400-e29b-41d4-a716-446655440091',
  imposedByHumanId: null,
  acceptedAttemptN: null,
  requiredExecutorTrustLevel: 'selfDeclared',
  status: 'queued',
  queuedAt: '2026-04-26T10:00:00.000Z',
  completedAt: null,
  expiresAt: null,
  cancelledByAgentId: null,
  cancelledByHumanId: null,
  cancelReason: null,
  maxAttempts: 1,
  dispatchTimeoutSec: null,
  runningTimeoutSec: null,
};

describe('Task tools', () => {
  let deps: McpDeps;
  let context: HandlerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = {
      ...createMockDeps(),
      consoleBaseUrl: 'https://console.example.com/',
    };
    context = createMockContext();
  });

  describe('tasks_schemas', () => {
    it('returns registered task schemas from REST', async () => {
      vi.mocked(listTaskSchemas).mockResolvedValue(
        sdkOk({
          items: [
            {
              taskType: 'curate_pack',
              outputKind: 'artifact',
              inputSchemaCid: 'bafy-schema',
              inputSchema: { type: 'object' },
            },
          ],
        }) as never,
      );

      const result = await handleTasksSchemas({}, deps, context);

      expect(listTaskSchemas).toHaveBeenCalledWith(
        expect.objectContaining({
          client: deps.client,
          auth: expect.any(Function),
        }),
      );
      expect(parseResult<{ items: unknown[] }>(result).items).toHaveLength(1);
    });

    it('returns an auth error without a token', async () => {
      const result = await handleTasksSchemas(
        {},
        deps,
        createMockContext(null),
      );

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('Not authenticated');
    });
  });

  describe('tasks_create', () => {
    it('validates input then creates a task with a console URL', async () => {
      vi.mocked(createTask).mockResolvedValue(sdkOk(mockTask, 201) as never);

      const result = await handleTasksCreate(
        {
          task_type: 'curate_pack',
          team_id: TEAM_ID,
          diary_id: DIARY_ID,
          input: taskInput,
          max_attempts: 2,
        },
        deps,
        context,
      );

      expect(createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            taskType: 'curate_pack',
            teamId: TEAM_ID,
            diaryId: DIARY_ID,
            input: taskInput,
            maxAttempts: 2,
          }),
        }),
      );
      const parsed = parseResult<typeof mockTask & { consoleUrl: string }>(
        result,
      );
      expect(parsed.id).toBe(TASK_ID);
      expect(parsed.consoleUrl).toBe(
        `https://console.example.com/tasks/${TASK_ID}`,
      );
    });

    it('fails locally when the task input does not match the schema', async () => {
      const result = await handleTasksCreate(
        {
          task_type: 'curate_pack',
          team_id: TEAM_ID,
          diary_id: DIARY_ID,
          input: {},
        },
        deps,
        context,
      );

      expect(result.isError).toBe(true);
      expect(createTask).not.toHaveBeenCalled();
      expect(getTextContent(result)).toContain('task_validation_failed');
      expect(getTextContent(result)).toContain('diaryId');
    });

    it('returns REST errors', async () => {
      vi.mocked(createTask).mockResolvedValue(
        sdkErr({
          error: 'Forbidden',
          message: 'Forbidden',
          statusCode: 403,
          detail: 'Not authorized to impose tasks on this diary',
        }) as never,
      );

      const result = await handleTasksCreate(
        {
          task_type: 'curate_pack',
          team_id: TEAM_ID,
          diary_id: DIARY_ID,
          input: taskInput,
        },
        deps,
        context,
      );

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain(
        'Not authorized to impose tasks on this diary',
      );
    });
  });

  describe('tasks_get and tasks_list', () => {
    it('returns one task with a console URL', async () => {
      vi.mocked(getTask).mockResolvedValue(sdkOk(mockTask) as never);

      const result = await handleTasksGet({ id: TASK_ID }, deps, context);

      expect(getTask).toHaveBeenCalledWith(
        expect.objectContaining({ path: { id: TASK_ID } }),
      );
      expect(parseResult<{ consoleUrl: string }>(result).consoleUrl).toBe(
        `https://console.example.com/tasks/${TASK_ID}`,
      );
    });

    it('lists tasks with filters and annotates each item', async () => {
      vi.mocked(listTasks).mockResolvedValue(
        sdkOk({
          items: [mockTask],
          total: 1,
          nextCursor: 'cursor-2',
        }) as never,
      );

      const result = await handleTasksList(
        {
          team_id: TEAM_ID,
          status: 'queued',
          task_type: 'curate_pack',
          diary_id: DIARY_ID,
          imposed_by_agent_id: '330e8400-e29b-41d4-a716-446655440091',
          claimed_by_agent_id: '330e8400-e29b-41d4-a716-446655440092',
          has_attempts: true,
          queued_after: '2026-04-28T10:00:00.000Z',
          queued_before: '2026-04-29T10:00:00.000Z',
          completed_after: '2026-04-28T12:00:00.000Z',
          completed_before: '2026-04-29T12:00:00.000Z',
          limit: 10,
        },
        deps,
        context,
      );

      expect(listTasks).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({
            teamId: TEAM_ID,
            status: 'queued',
            taskType: 'curate_pack',
            diaryId: DIARY_ID,
            imposedByAgentId: '330e8400-e29b-41d4-a716-446655440091',
            claimedByAgentId: '330e8400-e29b-41d4-a716-446655440092',
            hasAttempts: true,
            queuedAfter: '2026-04-28T10:00:00.000Z',
            queuedBefore: '2026-04-29T10:00:00.000Z',
            completedAfter: '2026-04-28T12:00:00.000Z',
            completedBefore: '2026-04-29T12:00:00.000Z',
            limit: 10,
          }),
        }),
      );
      const parsed = parseResult<{ items: Array<{ consoleUrl: string }> }>(
        result,
      );
      expect(parsed.items[0]?.consoleUrl).toBe(
        `https://console.example.com/tasks/${TASK_ID}`,
      );
    });
  });

  describe('attempts and messages', () => {
    it('lists task attempts', async () => {
      vi.mocked(listTaskAttempts).mockResolvedValue(
        sdkOk([
          {
            taskId: TASK_ID,
            attemptN: ATTEMPT_N,
            claimedByAgentId: '330e8400-e29b-41d4-a716-446655440091',
            runtimeId: null,
            claimedAt: '2026-04-26T10:00:01.000Z',
            startedAt: null,
            completedAt: null,
            status: 'claimed',
            output: null,
            outputCid: null,
            claimedExecutorFingerprint: null,
            claimedExecutorManifest: null,
            completedExecutorFingerprint: null,
            completedExecutorManifest: null,
            error: null,
            usage: null,
            contentSignature: null,
            signedAt: null,
          },
        ]) as never,
      );

      const result = await handleTasksAttemptsList(
        { task_id: TASK_ID },
        deps,
        context,
      );

      expect(listTaskAttempts).toHaveBeenCalledWith(
        expect.objectContaining({ path: { id: TASK_ID } }),
      );
      expect(parseResult<{ items: unknown[] }>(result).items).toHaveLength(1);
    });

    it('lists task messages with cursor parameters', async () => {
      vi.mocked(listTaskMessages).mockResolvedValue(
        sdkOk([
          {
            taskId: TASK_ID,
            attemptN: ATTEMPT_N,
            seq: 3,
            timestamp: '2026-04-26T10:00:02.000Z',
            kind: 'text_delta',
            payload: { text: 'hello' },
          },
        ]) as never,
      );

      const result = await handleTasksMessagesList(
        {
          task_id: TASK_ID,
          attempt_n: ATTEMPT_N,
          after_seq: 2,
          limit: 50,
        },
        deps,
        context,
      );

      expect(listTaskMessages).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: TASK_ID, n: ATTEMPT_N },
          query: { afterSeq: 2, limit: 50 },
        }),
      );
      expect(parseResult<{ items: unknown[] }>(result).items).toHaveLength(1);
    });
  });

  describe('tasks_console_link', () => {
    it('returns a console URL when configured', async () => {
      const result = await handleTasksConsoleLink(
        { id: TASK_ID },
        deps,
        context,
      );

      expect(parseResult<{ consoleUrl: string }>(result).consoleUrl).toBe(
        `https://console.example.com/tasks/${TASK_ID}`,
      );
    });

    it('removes repeated trailing slashes from the console base URL', async () => {
      const result = await handleTasksConsoleLink(
        { id: TASK_ID },
        {
          ...deps,
          consoleBaseUrl: 'https://console.example.com////',
        },
        context,
      );

      expect(parseResult<{ consoleUrl: string }>(result).consoleUrl).toBe(
        `https://console.example.com/tasks/${TASK_ID}`,
      );
    });

    it('omits consoleUrl when not configured', async () => {
      const result = await handleTasksConsoleLink(
        { id: TASK_ID },
        createMockDeps(),
        context,
      );

      expect(parseResult<{ consoleUrl?: string }>(result).consoleUrl).toBe(
        undefined,
      );
    });
  });
});
