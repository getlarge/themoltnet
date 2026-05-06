import { metrics } from '@opentelemetry/api';
import {
  AggregationTemporality,
  type CollectionResult,
  MeterProvider,
  MetricReader,
} from '@opentelemetry/sdk-metrics';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createSubmitOutputTool,
  resolveSubmitTools,
  UnknownTaskTypeForSubmitToolError,
} from './submit-output-tool.js';
import {
  __resetTaskOutputCounterForTests,
  type TaskOutputParseCode,
} from './task-output.js';

/**
 * The tool is constructed via pi-coding-agent's `defineTool` — its
 * `execute` is reachable through the wrapped definition. The submit
 * tool registers the task type's *Output schema directly as its
 * parameters, so tool args ARE the payload (no `{ output: ... }`
 * envelope).
 */
function callExecute(handle: ReturnType<typeof createSubmitOutputTool>) {
  const tool = handle.tool as unknown as {
    execute: (
      id: string,
      params: unknown,
    ) => Promise<{
      content: Array<{ type: 'text'; text: string }>;
      details?: Record<string, unknown>;
      isError?: boolean;
      terminate?: boolean;
    }>;
  };
  return (params: unknown) => tool.execute('id', params);
}

class CollectingReader extends MetricReader {
  protected async onShutdown(): Promise<void> {}
  protected async onForceFlush(): Promise<void> {}
  selectAggregationTemporality(): AggregationTemporality {
    return AggregationTemporality.CUMULATIVE;
  }
  async snapshot(): Promise<CollectionResult> {
    return this.collect();
  }
}

const validFulfillBriefOutput = {
  branch: 'feat/x',
  commits: [],
  pullRequestUrl: null,
  diaryEntryIds: [],
  summary: 's',
};

describe('createSubmitOutputTool', () => {
  it('throws UnknownTaskTypeForSubmitToolError on unknown task types', () => {
    expect(() => createSubmitOutputTool('not_a_real_type')).toThrow(
      UnknownTaskTypeForSubmitToolError,
    );
  });

  it('registers the tool as `submit_<task_type>_output`', () => {
    const handle = createSubmitOutputTool('fulfill_brief');
    expect((handle.tool as unknown as { name: string }).name).toBe(
      'submit_fulfill_brief_output',
    );
  });

  it("registers the task type's *Output schema as the tool parameters (no opaque blob)", () => {
    const handle = createSubmitOutputTool('fulfill_brief');
    const tool = handle.tool as unknown as {
      parameters: { type?: string; properties?: Record<string, unknown> };
    };
    // The schema is the FulfillBriefOutput TObject — top-level type is
    // 'object' and the model sees the actual field names at planning
    // time. This is the bug fix in this commit: the previous wrapper
    // (Type.Object({ output: Type.Unknown() })) advertised no field
    // shape and made tool calls effectively un-guided.
    expect(tool.parameters.type).toBe('object');
    expect(Object.keys(tool.parameters.properties ?? {})).toEqual(
      expect.arrayContaining([
        'branch',
        'commits',
        'pullRequestUrl',
        'diaryEntryIds',
        'summary',
      ]),
    );
  });

  it('captures a valid payload and returns terminate:true on success', async () => {
    const handle = createSubmitOutputTool('fulfill_brief');
    expect(handle.getCaptured()).toBeNull();
    expect(handle.getCallCount()).toBe(0);

    const result = await callExecute(handle)(validFulfillBriefOutput);

    expect(result.isError).toBeFalsy();
    // terminate:true is the property that distinguishes the preferred
    // path from the fallback — it ends the session immediately on
    // capture and prevents wasted post-call LLM tokens.
    expect(result.terminate).toBe(true);
    expect(handle.getCaptured()).toEqual(validFulfillBriefOutput);
    expect(handle.getCallCount()).toBe(1);
    expect(result.content[0].text).toContain('captured');
  });

  it('returns a tool error WITHOUT terminate:true on schema-invalid args', async () => {
    const handle = createSubmitOutputTool('fulfill_brief');
    const result = await callExecute(handle)({
      branch: 123, // wrong type — schema requires string
      commits: [],
      pullRequestUrl: null,
      diaryEntryIds: [],
      summary: 's',
    });

    expect(result.isError).toBe(true);
    // Schema-error path must NOT terminate the session — the model
    // needs the chance to recover with a corrected call.
    expect(result.terminate).not.toBe(true);
    expect(result.content[0].text).toMatch(/validation/i);
    expect(handle.getCaptured()).toBeNull();
    expect(handle.getCallCount()).toBe(0);
  });

  it('lets the model recover after a schema-invalid first call', async () => {
    const handle = createSubmitOutputTool('fulfill_brief');
    const exec = callExecute(handle);

    const bad = await exec({ branch: 99 });
    expect(bad.isError).toBe(true);
    expect(handle.getCaptured()).toBeNull();

    const good = await exec(validFulfillBriefOutput);
    expect(good.isError).toBeFalsy();
    expect(good.terminate).toBe(true);
    expect(handle.getCaptured()).toEqual(validFulfillBriefOutput);
    expect(handle.getCallCount()).toBe(1);
  });

  it('keeps the latest valid capture when called more than once', async () => {
    const handle = createSubmitOutputTool('fulfill_brief');
    const exec = callExecute(handle);

    await exec(validFulfillBriefOutput);
    const second = {
      ...validFulfillBriefOutput,
      summary: 'second submission supersedes the first',
    };
    await exec(second);

    expect(handle.getCaptured()).toEqual(second);
    expect(handle.getCallCount()).toBe(2);
  });

  it('works for every built-in task type', async () => {
    // Smoke-test the schema lookup path for every task type the prompts
    // reference. We don't construct full valid payloads for each — that
    // would couple this test to every output shape — we just verify the
    // tool factory accepts the type and the produced tool has the right
    // name. Validation is exercised in dedicated cases above.
    const types = [
      'fulfill_brief',
      'assess_brief',
      'curate_pack',
      'render_pack',
      'judge_pack',
    ];
    for (const t of types) {
      const handle = createSubmitOutputTool(t);
      expect((handle.tool as unknown as { name: string }).name).toBe(
        `submit_${t}_output`,
      );
    }
  });

  it('rejects judge_pack output where score=1 contradicts a failing assertion (#999 P1)', async () => {
    // Without the cross-field validator wired into validateTaskOutput,
    // the LLM can call submit_judge_pack_output with `score: 1` while
    // emitting an assertion that has `passed: false`. Schema-only
    // validation lets that through and the bad payload propagates into
    // composite scores and judge attestations. The submit tool MUST
    // reject and let the agent recover.
    const handle = createSubmitOutputTool('judge_pack');
    const exec = callExecute(handle);
    const result = await exec({
      scores: [
        {
          criterionId: 'grounding',
          score: 1,
          assertions: [
            { id: 'c1', text: 'ok', passed: true, evidence: 'src abc' },
            {
              id: 'c2',
              text: 'fab',
              passed: false,
              evidence: 'no supporting span',
            },
          ],
        },
      ],
      composite: 1,
      verdict: 'inconsistent',
    });
    expect(result.isError).toBe(true);
    expect(result.terminate).not.toBe(true);
    expect(result.content[0].text).toMatch(/llm_checklist|score=1/i);
    expect(handle.getCaptured()).toBeNull();
  });
});

describe('submit-tool OTel counter recording', () => {
  let provider: MeterProvider;
  let reader: CollectingReader;

  beforeEach(() => {
    reader = new CollectingReader();
    provider = new MeterProvider({ readers: [reader] });
    metrics.setGlobalMeterProvider(provider);
    __resetTaskOutputCounterForTests();
  });

  afterEach(async () => {
    await provider.shutdown();
    metrics.disable();
    __resetTaskOutputCounterForTests();
  });

  async function dataPointsFor(code: TaskOutputParseCode) {
    const collected = await reader.snapshot();
    const out: Array<Record<string, unknown>> = [];
    for (const sm of collected.resourceMetrics.scopeMetrics) {
      for (const m of sm.metrics) {
        if (m.descriptor.name !== 'agent_runtime.task_output.parse_result') {
          continue;
        }
        for (const dp of m.dataPoints) {
          if ((dp.attributes.code as string) === code) {
            out.push({ ...dp.attributes });
          }
        }
      }
    }
    return out;
  }

  it('records output_validation_failed when the model submits invalid args', async () => {
    const handle = createSubmitOutputTool('fulfill_brief', {
      model: 'claude-sonnet-4-6',
    });
    await callExecute(handle)({ branch: 99 });
    const points = await dataPointsFor('output_validation_failed');
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({
      task_type: 'fulfill_brief',
      model: 'claude-sonnet-4-6',
      code: 'output_validation_failed',
    });
  });

  it('does NOT record on the success path (executor records captured_via_tool)', async () => {
    // The success-path counter is recorded by the executor when it
    // computes outputCid — keeping it there lets a cid-compute failure
    // surface as `output_cid_compute_failed` instead of double-counting.
    const handle = createSubmitOutputTool('fulfill_brief', { model: 'm' });
    await callExecute(handle)(validFulfillBriefOutput);
    expect(await dataPointsFor('captured_via_tool')).toHaveLength(0);
    expect(await dataPointsFor('output_validation_failed')).toHaveLength(0);
  });
});

describe('resolveSubmitTools', () => {
  it('returns a populated handle + tools array for known task types', () => {
    const r = resolveSubmitTools('fulfill_brief');
    expect(r.handle).not.toBeNull();
    expect(r.tools).toHaveLength(1);
  });

  it('returns null handle + empty tools for unknown task types', () => {
    const r = resolveSubmitTools('totally_made_up');
    expect(r.handle).toBeNull();
    expect(r.tools).toEqual([]);
  });
});

describe('resolveSubmitTools error narrowing contract', () => {
  // The catch block in resolveSubmitTools narrows on
  // UnknownTaskTypeForSubmitToolError. Verifying that contract directly
  // by re-implementing the catch shape in a test fixture: if the
  // production catch ever broadened to `catch {}`, this assertion would
  // still pass — so the real safety comes from the source review +
  // typecheck (the production code uses `instanceof` narrowing, not a
  // duck-type check).
  //
  // What this test pins: the sentinel class chain. If anyone renames or
  // removes UnknownTaskTypeForSubmitToolError, every call site that
  // depends on it (resolveSubmitTools, plus any future caller) breaks
  // at compile time, not silently at runtime.
  it('UnknownTaskTypeForSubmitToolError extends Error and carries the taskType', () => {
    const err = new UnknownTaskTypeForSubmitToolError('weird');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(UnknownTaskTypeForSubmitToolError);
    expect(err.taskType).toBe('weird');
    expect(err.name).toBe('UnknownTaskTypeForSubmitToolError');
  });
});
