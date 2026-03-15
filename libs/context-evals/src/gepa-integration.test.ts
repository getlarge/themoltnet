/**
 * Integration tests for runGepaOptimization.
 *
 * Uses a mock AxGEPAAdapter and fake AxAIService to verify that scores,
 * traces, and bestScore flow correctly through the GEPA pipeline.
 *
 * When gepaAdapter is provided, GEPA uses adapter.evaluate() for all
 * scoring. The tracing adapter wrapper intercepts these calls, so traces
 * are always populated regardless of whether program.forward() works.
 */
import type {
  AxAIService,
  AxGEPAAdapter,
  AxGEPAEvaluationBatch,
} from '@ax-llm/ax';
import { describe, expect, it, vi } from 'vitest';

import type { EvalTraceEntry, TaskExample } from './gepa.js';
import { runBaseline, runGepaOptimization } from './gepa.js';

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
    getModelInfo: () => [
      {
        name: 'mock-model',
        currency: 'usd',
        characterIsToken: true,
        promptTokenCostPer1M: 0,
        completionTokenCostPer1M: 0,
      },
    ],
    getFeatures: () => ({ functions: false, streaming: false }),
    getName: () => 'mock',
    getModelList: () => [],
    chat: vi.fn().mockResolvedValue({
      results: [{ content: 'mock response' }],
      modelUsage: { promptTokens: 0, completionTokens: 0 },
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

// ── Tests ────────────────────────────────────────────────────────────────────

describe('runGepaOptimization', () => {
  it('calls adapter.evaluate with instruction candidates', async () => {
    const adapter = createMockAdapter(() => 0.85);
    const spy = vi.spyOn(adapter, 'evaluate');
    const tasks = createTasks(2);

    await runGepaOptimization({
      tasks,
      adapter,
      seedInstruction: 'test seed',
      studentAI: createMockAI(),
      numTrials: 1,
      maxMetricCalls: 4,
      buildExamples,
      evaluateOne: () => Promise.resolve({ score: 0.85 }),
    });

    expect(spy).toHaveBeenCalled();
    for (const call of spy.mock.calls) {
      const candidate = call[1] as Record<string, string>;
      expect(candidate).toHaveProperty('instruction');
    }
  });

  it('bestScore reflects adapter.evaluate scores (not 0)', async () => {
    const adapter = createMockAdapter(() => 0.85);
    const tasks = createTasks(2);

    const result = await runGepaOptimization({
      tasks,
      adapter,
      seedInstruction: 'test seed',
      studentAI: createMockAI(),
      numTrials: 1,
      maxMetricCalls: 4,
      buildExamples,
      evaluateOne: () => Promise.resolve({ score: 0.85 }),
    });

    // bestScore is derived from adapter traces, not GEPA's Pareto front
    expect(result.bestScore).toBeGreaterThan(0);
    expect(result.bestScore).toBeCloseTo(0.85, 1);
  });

  it('traces are populated from adapter.evaluate calls', async () => {
    const adapter = createMockAdapter(() => 0.75);
    const tasks = createTasks(2);

    const result = await runGepaOptimization({
      tasks,
      adapter,
      seedInstruction: 'seed',
      studentAI: createMockAI(),
      numTrials: 1,
      maxMetricCalls: 4,
      buildExamples,
      evaluateOne: () => Promise.resolve({ score: 0.75 }),
    });

    expect(result.traces.length).toBeGreaterThan(0);
    for (const trace of result.traces) {
      expect(trace.averageScore).toBe(0.75);
      expect(trace.scores).toEqual(expect.arrayContaining([0.75]));
      expect(trace.round).toBeGreaterThan(0);
      expect(trace.timestamp).toBeTruthy();
      expect(trace.instructionLength).toBeGreaterThan(0);
    }
  });

  it('onEvalComplete fires for each adapter.evaluate call', async () => {
    const adapter = createMockAdapter(() => 0.6);
    const tasks = createTasks(2);
    const callbackTraces: EvalTraceEntry<TestTrace>[] = [];

    const result = await runGepaOptimization({
      tasks,
      adapter,
      seedInstruction: 'seed',
      studentAI: createMockAI(),
      numTrials: 1,
      maxMetricCalls: 4,
      buildExamples,
      evaluateOne: () => Promise.resolve({ score: 0.6 }),
      onEvalComplete: (entry) => {
        callbackTraces.push(entry);
      },
    });

    expect(callbackTraces).toHaveLength(result.traces.length);
    for (let i = 0; i < callbackTraces.length; i++) {
      expect(callbackTraces[i].averageScore).toBe(
        result.traces[i].averageScore,
      );
      expect(callbackTraces[i].round).toBe(result.traces[i].round);
    }
  });

  it('returns a bestInstruction string', async () => {
    const adapter = createMockAdapter(() => 0.5);
    const tasks = createTasks(2);
    const seed = 'original seed instruction';

    const result = await runGepaOptimization({
      tasks,
      adapter,
      seedInstruction: seed,
      studentAI: createMockAI(),
      numTrials: 1,
      maxMetricCalls: 2,
      buildExamples,
      evaluateOne: () => Promise.resolve({ score: 0.5 }),
    });

    expect(result.bestInstruction).toBeTruthy();
    expect(typeof result.bestInstruction).toBe('string');
  });
});

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
});
