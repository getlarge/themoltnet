/**
 * Integration tests for runGepaOptimization and runBaseline.
 *
 * Key architecture (from ax-llm + gepa-ai source):
 * - bestScore flows through metricFn via program.forward() → Pareto archive
 * - gepaAdapter.evaluate() is only an acceptance gate, not the score source
 * - program.forward() is overridden to call evaluateOne directly
 * - metricFn extracts the score from forward's prediction ({score: N})
 */
import type {
  AxAIService,
  AxGEPAAdapter,
  AxGEPAEvaluationBatch,
} from '@ax-llm/ax';
import { describe, expect, it, vi } from 'vitest';

import type { EvalTraceEntry, TaskExample } from './gepa.js';
import {
  buildMetricFn,
  buildReplicas,
  runBaseline,
  runGepaOptimization,
} from './gepa.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

interface TestTask {
  id: string;
  taskPrompt: string;
}

interface TestTrace {
  taskId: string;
  instruction: string;
}

function createMockAI(): AxAIService {
  return {
    getId: () => 'mock-id',
    getName: () => 'mock',
    getFeatures: () => ({ functions: false, streaming: false }),
    getModelList: () => [],
    getMetrics: () => ({
      latency: {
        chat: { mean: 0, p95: 0, p99: 0, samples: [] },
        embed: { mean: 0, p95: 0, p99: 0, samples: [] },
      },
      errors: {
        chat: { count: 0, rate: 0, total: 0 },
        embed: { count: 0, rate: 0, total: 0 },
      },
    }),
    getLogger: () => () => {},
    getLastUsedChatModel: () => 'mock-model',
    getLastUsedEmbedModel: () => undefined,
    getLastUsedModelConfig: () => ({}),
    getOptions: () => ({}),
    setOptions: () => {},
    getModelInfo: () => [
      {
        name: 'mock-model',
        currency: 'usd',
        characterIsToken: true,
        promptTokenCostPer1M: 0,
        completionTokenCostPer1M: 0,
      },
    ],
    embed: vi.fn().mockResolvedValue({ embeddings: [] }),
    chat: vi.fn().mockResolvedValue({
      results: [{ content: 'Eval Score: 0.5', index: 0, finishReason: 'stop' }],
      modelUsage: {
        ai: 'mock',
        model: 'mock-model',
        tokens: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      },
    }),
  } as unknown as AxAIService;
}

function createMockAdapter(
  scoreFn: (instruction: string) => number = () => 0.7,
): AxGEPAAdapter<TestTask, TestTrace, string> {
  return {
    evaluate: vi.fn(
      (
        batch: readonly TestTask[],
        candidate: Readonly<Record<string, string>>,
        captureTraces?: boolean,
      ): AxGEPAEvaluationBatch<TestTrace, string> => {
        const instruction = candidate.instruction ?? '';
        const scores = batch.map(() => scoreFn(instruction));
        const trajectories = captureTraces
          ? batch.map((task) => ({
              taskId: task.id,
              instruction,
            }))
          : null;
        return { outputs: batch.map(() => 'ok'), scores, trajectories };
      },
    ),
    make_reflective_dataset: vi.fn(() => ({ instruction: [] })),
    propose_new_texts: vi.fn(() => ({})),
  };
}

function createTasks(count: number): TestTask[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `task-${i}`,
    taskPrompt: `Prompt for task ${i}`,
  }));
}

function buildExamples(tasks: TestTask[]): TaskExample[] {
  return tasks.map((task) => ({
    id: task.id,
    taskPrompt: task.taskPrompt,
  }));
}

// ── runGepaOptimization ─────────────────────────────────────────────────────

describe('runGepaOptimization', () => {
  it('bestScore reflects evaluateOne scores via program.forward override', async () => {
    const result = await runGepaOptimization({
      tasks: createTasks(2),
      adapter: createMockAdapter(() => 0.85),
      seedInstruction: 'test seed',
      studentAI: createMockAI(),
      numTrials: 0,
      maxMetricCalls: 4,
      buildExamples,
      evaluateOne: (_task: TestTask, _instruction: string) =>
        Promise.resolve({ score: 0.85 }),
    });

    expect(result.bestScore).toBeGreaterThan(0);
    expect(result.bestScore).toBeCloseTo(0.85, 1);
  });

  it('traces are populated from evaluateOne calls', async () => {
    const result = await runGepaOptimization({
      tasks: createTasks(2),
      adapter: createMockAdapter(() => 0.75),
      seedInstruction: 'seed',
      studentAI: createMockAI(),
      numTrials: 0,
      maxMetricCalls: 4,
      buildExamples,
      evaluateOne: (task: TestTask, instruction: string) =>
        Promise.resolve({
          score: 0.75,
          trace: { taskId: task.id, instruction },
        }),
    });

    expect(result.traces.length).toBeGreaterThan(0);
    for (const trace of result.traces) {
      expect(trace.score).toBe(0.75);
      expect(trace.eval).toBeGreaterThan(0);
      expect(trace.timestamp).toBeTruthy();
      expect(trace.instructionLength).toBeGreaterThan(0);
      expect(trace.taskId).toMatch(/^task-/);
    }
  });

  it('trace entries contain per-task data from evaluateOne', async () => {
    const result = await runGepaOptimization({
      tasks: createTasks(2),
      adapter: createMockAdapter(() => 0.8),
      seedInstruction: 'seed',
      studentAI: createMockAI(),
      numTrials: 0,
      maxMetricCalls: 4,
      buildExamples,
      evaluateOne: (task: TestTask, instruction: string) =>
        Promise.resolve({
          score: 0.8,
          trace: { taskId: task.id, instruction },
        }),
    });

    expect(result.traces.length).toBeGreaterThan(0);
    for (const entry of result.traces) {
      expect(entry.taskId).toMatch(/^task-/);
      expect(entry.score).toBe(0.8);
      expect(entry.trace).toBeDefined();
      expect(entry.trace?.taskId).toMatch(/^task-/);
    }
  });

  it('onEvalComplete fires for each evaluation round', async () => {
    const callbackTraces: EvalTraceEntry<TestTrace>[] = [];

    const result = await runGepaOptimization({
      tasks: createTasks(2),
      adapter: createMockAdapter(() => 0.6),
      seedInstruction: 'seed',
      studentAI: createMockAI(),
      numTrials: 0,
      maxMetricCalls: 4,
      buildExamples,
      evaluateOne: (_task: TestTask, _instruction: string) =>
        Promise.resolve({ score: 0.6 }),
      onEvalComplete: (entry) => {
        callbackTraces.push(entry);
      },
    });

    expect(callbackTraces).toHaveLength(result.traces.length);
    for (let i = 0; i < callbackTraces.length; i++) {
      expect(callbackTraces[i].score).toBe(result.traces[i].score);
      expect(callbackTraces[i].eval).toBe(result.traces[i].eval);
    }
  });

  it('onEvalComplete errors are caught and logged', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const result = await runGepaOptimization({
      tasks: createTasks(2),
      adapter: createMockAdapter(() => 0.7),
      seedInstruction: 'seed',
      studentAI: createMockAI(),
      numTrials: 0,
      maxMetricCalls: 4,
      buildExamples,
      evaluateOne: (_task: TestTask, _instruction: string) =>
        Promise.resolve({ score: 0.7 }),
      onEvalComplete: () => {
        throw new Error('callback error');
      },
    });

    expect(result).toBeDefined();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[GEPA-trace]'),
      expect.any(Error),
    );
    consoleErrorSpy.mockRestore();
  });

  it('returns a bestInstruction string', async () => {
    const seed = 'original seed instruction';
    const result = await runGepaOptimization({
      tasks: createTasks(2),
      adapter: createMockAdapter(() => 0.5),
      seedInstruction: seed,
      studentAI: createMockAI(),
      numTrials: 0,
      maxMetricCalls: 2,
      buildExamples,
      evaluateOne: (_task: TestTask, _instruction: string) =>
        Promise.resolve({ score: 0.5 }),
    });

    expect(result.bestInstruction).toBeTruthy();
    expect(typeof result.bestInstruction).toBe('string');
  });

  it('handles single task by creating replica', async () => {
    const result = await runGepaOptimization({
      tasks: createTasks(1),
      adapter: createMockAdapter(() => 0.8),
      seedInstruction: 'seed',
      studentAI: createMockAI(),
      numTrials: 0,
      maxMetricCalls: 4,
      buildExamples,
      evaluateOne: (_task: TestTask, _instruction: string) =>
        Promise.resolve({ score: 0.8 }),
    });

    expect(result.bestScore).toBeGreaterThan(0);
    expect(result.traces.length).toBeGreaterThan(0);
  });

  it('deduplicates replica task IDs in trace entries', async () => {
    const result = await runGepaOptimization({
      tasks: createTasks(1),
      adapter: createMockAdapter(() => 0.9),
      seedInstruction: 'seed',
      studentAI: createMockAI(),
      numTrials: 0,
      maxMetricCalls: 4,
      buildExamples,
      evaluateOne: (_task: TestTask, _instruction: string) =>
        Promise.resolve({ score: 0.9 }),
    });

    for (const entry of result.traces) {
      expect(entry.taskId).not.toBe('task-0-replica');
    }
  });

  it('evaluateOne receives real tasks, never replicas', async () => {
    const evaluatedTaskIds: string[] = [];
    await runGepaOptimization({
      tasks: createTasks(1),
      adapter: createMockAdapter(() => 0.7),
      seedInstruction: 'seed',
      studentAI: createMockAI(),
      numTrials: 0,
      maxMetricCalls: 4,
      buildExamples,
      evaluateOne: (task: TestTask, _instruction: string) => {
        evaluatedTaskIds.push(task.id);
        return Promise.resolve({ score: 0.7 });
      },
    });

    expect(evaluatedTaskIds.length).toBeGreaterThan(0);
    expect(evaluatedTaskIds.every((id) => id === 'task-0')).toBe(true);
  });

  it('different scores per task are preserved in traces', async () => {
    const result = await runGepaOptimization({
      tasks: createTasks(2),
      adapter: createMockAdapter(() => 0.7),
      seedInstruction: 'seed',
      studentAI: createMockAI(),
      numTrials: 0,
      maxMetricCalls: 4,
      buildExamples,
      evaluateOne: (task: TestTask, _instruction: string) => {
        const score = task.id === 'task-0' ? 0.9 : 0.5;
        return Promise.resolve({ score });
      },
    });

    expect(result.traces.length).toBeGreaterThan(0);
    // With per-eval traces, each trace has a single score per task
    const scores = result.traces.map((t) => t.score);
    expect(scores).toContain(0.9);
    expect(scores).toContain(0.5);
  });

  it('eval numbers are sequential starting from 1', async () => {
    const result = await runGepaOptimization({
      tasks: createTasks(2),
      adapter: createMockAdapter(() => 0.7),
      seedInstruction: 'seed',
      studentAI: createMockAI(),
      numTrials: 0,
      maxMetricCalls: 6,
      buildExamples,
      evaluateOne: (_task: TestTask, _instruction: string) =>
        Promise.resolve({ score: 0.7 }),
    });

    for (let i = 0; i < result.traces.length; i++) {
      expect(result.traces[i].eval).toBe(i + 1);
    }
  });

  it('adapter.evaluate is still called by GEPA for proposal gating', async () => {
    const adapter = createMockAdapter(() => 0.8);
    const spy = vi.spyOn(adapter, 'evaluate');

    await runGepaOptimization({
      tasks: createTasks(2),
      adapter,
      seedInstruction: 'seed',
      studentAI: createMockAI(),
      numTrials: 1,
      maxMetricCalls: 6,
      buildExamples,
      evaluateOne: (_task: TestTask, _instruction: string) =>
        Promise.resolve({ score: 0.8 }),
    });

    // GEPA calls adapter.evaluate for acceptance gating
    expect(spy).toHaveBeenCalled();
  });
});

// ── runBaseline ─────────────────────────────────────────────────────────────

describe('runBaseline', () => {
  it('returns scores from adapter.evaluate', async () => {
    const adapter = createMockAdapter(() => 0.9);
    const tasks = createTasks(3);

    const result = await runBaseline(adapter, tasks, 'test instruction');

    expect(result.scores).toEqual([0.9, 0.9, 0.9]);
    expect(result.averageScore).toBeCloseTo(0.9);
  });

  it('returns trajectories when adapter produces them', async () => {
    const adapter = createMockAdapter(() => 0.7);
    const tasks = createTasks(2);

    const result = await runBaseline(adapter, tasks, 'test instruction');

    expect(result.trajectories).toHaveLength(2);
    expect(result.trajectories![0]).toEqual({
      taskId: 'task-0',
      instruction: 'test instruction',
    });
  });

  it('passes instruction as candidate to adapter', async () => {
    const adapter = createMockAdapter(() => 0.5);
    const spy = vi.spyOn(adapter, 'evaluate');
    const tasks = createTasks(1);

    await runBaseline(adapter, tasks, 'my instruction');

    expect(spy).toHaveBeenCalledWith(
      tasks,
      { instruction: 'my instruction' },
      true,
    );
  });

  it('handles empty task list', async () => {
    const adapter = createMockAdapter();
    const result = await runBaseline(adapter, [], 'instruction');

    expect(result.scores).toEqual([]);
    expect(result.averageScore).toBe(0);
  });
});

// ── buildReplicas ───────────────────────────────────────────────────────────

describe('buildReplicas', () => {
  it('returns tasks unchanged when >= 2', () => {
    const tasks = [{ id: 'a' }, { id: 'b' }];
    expect(buildReplicas(tasks)).toBe(tasks);
  });

  it('duplicates single task with -replica suffix', () => {
    const tasks = [{ id: 'a', extra: 42 }];
    const result = buildReplicas(tasks);
    expect(result).toHaveLength(2);
    expect(result[1].id).toBe('a-replica');
    expect(result[1].extra).toBe(42);
  });
});

// ── buildMetricFn ───────────────────────────────────────────────────────────

describe('buildMetricFn', () => {
  it('caches by (taskId, instruction) content hash', async () => {
    const evaluator = vi.fn().mockResolvedValue({ score: 0.5 });
    const metric = buildMetricFn(evaluator);

    await metric('task-1', 'instruction-a');
    await metric('task-1', 'instruction-a');
    expect(evaluator).toHaveBeenCalledOnce();

    await metric('task-1', 'instruction-b');
    expect(evaluator).toHaveBeenCalledTimes(2);
  });

  it('does not cache across different task IDs', async () => {
    const evaluator = vi
      .fn()
      .mockResolvedValueOnce({ score: 0.4 })
      .mockResolvedValueOnce({ score: 0.9 });
    const metric = buildMetricFn(evaluator);

    const a = await metric('task-a', 'same');
    const b = await metric('task-b', 'same');
    expect(a.score).toBe(0.4);
    expect(b.score).toBe(0.9);
    expect(evaluator).toHaveBeenCalledTimes(2);
  });
});
