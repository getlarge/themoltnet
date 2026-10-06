import { makeStrictJsonSchema } from '@earendil-works/pi-ai/api/constrained-sampling';
import { metrics } from '@opentelemetry/api';
import {
  AggregationTemporality,
  type CollectionResult,
  MeterProvider,
  MetricReader,
} from '@opentelemetry/sdk-metrics';
import { BUILT_IN_TASK_TYPES } from '@themoltnet/agent-runtime';
import type { TSchema } from 'typebox';
import { Value } from 'typebox/value';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createSubmitOutputTool,
  extractFinalMessageJson,
  UnknownTaskTypeForSubmitToolError,
} from './submit-output-tool.js';
import {
  __resetTaskOutputCounterForTests,
  type TaskOutputParseCode,
} from './task-output.js';

/**
 * The tool is constructed via pi-coding-agent's `defineTool` — its
 * `execute` is reachable through the wrapped definition. The submit
 * transport schema is the task contract; Pi validates arguments before
 * execute, while the handler enforces task-specific cross-field rules.
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

const verification = {
  inputCid: 'bafy-input',
  results: [
    {
      id: 'criterion-1',
      kind: 'assertion' as const,
      status: 'pass' as const,
    },
  ],
  passed: true,
};

const submitOutputOnlyFreeformInput = {
  brief: 'do the thing',
  successCriteria: {
    version: 1 as const,
    gates: [
      {
        id: 'submit-output',
        kind: 'submit-tool-call' as const,
        description:
          'Call `submit_freeform_output` exactly once with valid structured output.',
        required: true,
      },
    ],
  },
};

describe('createSubmitOutputTool', () => {
  it.each([
    ['valid', validFulfillBriefOutput, true],
    ['envelope', { output: validFulfillBriefOutput }, true],
    ['stringified array', { ...validFulfillBriefOutput, commits: '[]' }, true],
    [
      'JSON5 stringified array',
      {
        ...validFulfillBriefOutput,
        commits: '[{sha:"abcdef123",message:"m",diaryEntryId:null,},]',
      },
      true,
    ],
    [
      'single commit',
      {
        ...validFulfillBriefOutput,
        commits: { sha: 'abcdef123', message: 'm', diaryEntryId: null },
      },
      true,
    ],
    [
      'bare diary id',
      {
        ...validFulfillBriefOutput,
        diaryEntryIds: '11111111-1111-4111-8111-111111111111',
      },
      true,
    ],
    [
      'stringified commit item',
      {
        ...validFulfillBriefOutput,
        commits: [
          JSON.stringify({
            sha: 'abcdef123',
            message: 'm',
            diaryEntryId: null,
          }),
        ],
      },
      true,
    ],
    ['unknown key', { ...validFulfillBriefOutput, extra: true }, false],
  ] as const)(
    'aligns %s with the schema verdict',
    async (_name, input, accepted) => {
      const handle = createSubmitOutputTool('fulfill_brief');
      let prepared: unknown;
      try {
        prepared = handle.tool.prepareArguments?.(input);
      } catch {
        expect(accepted).toBe(false);
        return;
      }
      const result = await callExecute(handle)(prepared);
      expect(!result.isError).toBe(accepted);
    },
  );
  it('records syntax repairs for JSON5 inside submitted tool arguments', async () => {
    const handle = createSubmitOutputTool('fulfill_brief');
    const prepared = handle.tool.prepareArguments?.({
      ...validFulfillBriefOutput,
      commits: '[{sha:"abcdef123",message:"m",diaryEntryId:null,},]',
    });

    const result = await callExecute(handle)(prepared);

    expect(result.isError).not.toBe(true);
    expect(handle.getCaptured()).toMatchObject({
      commits: [{ sha: 'abcdef123', message: 'm', diaryEntryId: null }],
    });
    expect(handle.getCapturedRepairs()).toEqual([
      { kind: 'json_string', path: '/commits' },
      { kind: 'lenient_json', path: '/commits' },
    ]);
  });

  it('repairs a missing comma in a stringified submitted object', async () => {
    const handle = createSubmitOutputTool('fulfill_brief');
    const prepared = handle.tool.prepareArguments?.({
      ...validFulfillBriefOutput,
      commits: '[{"sha":"abcdef123" "message":"m","diaryEntryId":null}]',
    });

    const result = await callExecute(handle)(prepared);

    expect(result.isError).not.toBe(true);
    expect(handle.getCapturedRepairs()).toEqual([
      { kind: 'json_string', path: '/commits' },
      { kind: 'missing_comma', path: '/commits' },
    ]);
  });
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

  it('exposes the submit tool name on the handle for re-prompt copy', () => {
    const handle = createSubmitOutputTool('fulfill_brief');
    expect(handle.toolName).toBe('submit_fulfill_brief_output');
  });

  it('advertises the task schema and requests constrained sampling', () => {
    const handle = createSubmitOutputTool('pr_review');
    const tool = handle.tool as unknown as {
      parameters: {
        type?: string;
        properties?: Record<string, unknown>;
        required?: string[];
        additionalProperties?: unknown;
      };
      promptSnippet?: string;
      promptGuidelines?: string[];
      constrainedSampling?: unknown;
    };
    expect(tool.parameters.type).toBe('object');
    expect(Object.keys(tool.parameters.properties ?? {})).toEqual([
      'scores',
      'composite',
      'verdict',
    ]);
    expect(tool.parameters.required).toEqual([
      'scores',
      'composite',
      'verdict',
    ]);
    expect(tool.parameters.additionalProperties).toBe(false);
    expect(tool.constrainedSampling).toEqual({
      type: 'json_schema',
      strict: 'prefer',
    });
    expect(tool.promptSnippet).toContain('submit_pr_review_output');
    expect(tool.promptSnippet).toContain('Agent submission schema');
    expect(tool.promptSnippet).toContain('"scores"');
    expect(tool.promptSnippet).toContain('"composite"');
    expect(tool.promptSnippet).toContain('"verdict"');
    expect(tool.promptSnippet).not.toContain('"traceparent"');
    expect(tool.promptGuidelines?.join('\n')).not.toContain('task prompt');
  });

  it('supports strict mode for ordinary and contracted freeform tools', () => {
    const compatible = createSubmitOutputTool('fulfill_brief');
    const freeform = createSubmitOutputTool('freeform');
    const contracted = createSubmitOutputTool('freeform', {
      input: {
        outputContract: {
          version: 1,
          schema: {
            type: 'object',
            properties: {
              confidence: { type: 'number', minimum: 0, maximum: 1 },
            },
            required: ['confidence'],
            additionalProperties: false,
          },
        },
      },
    });

    expect(() =>
      makeStrictJsonSchema(compatible.tool.parameters as TSchema),
    ).not.toThrow();
    expect(() =>
      makeStrictJsonSchema(freeform.tool.parameters as TSchema),
    ).not.toThrow();
    expect(() =>
      makeStrictJsonSchema(contracted.tool.parameters as TSchema),
    ).not.toThrow();
    expect(contracted.tool.parameters.properties?.result).toMatchObject({
      type: 'object',
    });
  });

  it('prepares stringified values before Pi validates the tool call', () => {
    // Arrange
    const handle = createSubmitOutputTool('pr_review');
    const tool = handle.tool as unknown as {
      prepareArguments: (args: unknown) => unknown;
    };

    // Assert
    expect(
      tool.prepareArguments({
        scores: '[{"criterionId":"c1","score":1,"rationale":"ok"}]',
        composite: '0.8',
        verdict: 'approve',
      }),
    ).toEqual({
      scores: [{ criterionId: 'c1', score: 1, rationale: 'ok' }],
      composite: 0.8,
      verdict: 'approve',
    });
  });

  it('records arguments rejected before execute and exposes the validation failure', () => {
    const handle = createSubmitOutputTool('fulfill_brief');

    expect(() =>
      handle.tool.prepareArguments?.({
        ...validFulfillBriefOutput,
        summary: undefined,
      }),
    ).toThrow('Output failed validation (invalid call 1)');
    expect(handle.getInvalidCallCount()).toBe(1);
    expect(handle.getLastValidationFailure()).toMatchObject({
      code: 'output_validation_failed',
      message: expect.stringContaining('summary'),
    });
    expect(handle.getCaptured()).toBeNull();
  });

  it('reports repairs on the accepted call and none on an untouched submission', async () => {
    const repaired = createSubmitOutputTool('fulfill_brief');
    const prepared = repaired.tool.prepareArguments?.({
      output: { ...validFulfillBriefOutput, commits: '[]' },
    });
    await callExecute(repaired)(prepared);
    expect(repaired.getCapturedRepairKinds()).toEqual(
      expect.arrayContaining(['output_envelope', 'json_string']),
    );

    const untouched = createSubmitOutputTool('fulfill_brief');
    await callExecute(untouched)(
      untouched.tool.prepareArguments?.(validFulfillBriefOutput),
    );
    expect(untouched.getCapturedRepairKinds()).toEqual([]);
  });

  it('omits Pi strict-mode null placeholders for optional fields', () => {
    const handle = createSubmitOutputTool('freeform');
    const prepared = handle.tool.prepareArguments?.({
      summary: 'done',
      branch: null,
      artifacts: [
        {
          kind: 'file',
          title: 'notes',
          description: null,
          url: null,
          path: '/tmp/notes',
        },
      ],
      diaryEntryIds: null,
      verification: null,
    });

    expect(prepared).toEqual({
      summary: 'done',
      artifacts: [{ kind: 'file', title: 'notes', path: '/tmp/notes' }],
    });
    expect(Value.Check(handle.tool.parameters, prepared)).toBe(true);

    const fulfill = createSubmitOutputTool('fulfill_brief');
    const nullable = fulfill.tool.prepareArguments?.(validFulfillBriefOutput);
    expect(nullable).toMatchObject({ pullRequestUrl: null });
  });

  it('captures strict null placeholders with submit-only gate verification', async () => {
    const handle = createSubmitOutputTool('freeform', {
      input: submitOutputOnlyFreeformInput,
      inputCid: 'bafy-input',
    });
    const prepared = handle.tool.prepareArguments?.({
      summary: 'done',
      branch: null,
      artifacts: null,
      diaryEntryIds: null,
      verification: null,
    });

    const result = await callExecute(handle)(prepared);

    expect(result.isError).toBeFalsy();
    expect(handle.getCaptured()).toMatchObject({
      summary: 'done',
      verification: {
        inputCid: 'bafy-input',
        passed: true,
        results: [expect.objectContaining({ id: 'submit-output' })],
      },
    });
    expect(handle.getCaptured()).not.toHaveProperty('branch');
    expect(handle.getCapturedRepairKinds()).toEqual(
      expect.arrayContaining(['submit_gate_verification', 'optional_null']),
    );
  });

  it('ignores an invalid duplicate after capture without changing failure state', async () => {
    const handle = createSubmitOutputTool('fulfill_brief');
    const execute = callExecute(handle);
    await execute(handle.tool.prepareArguments?.(validFulfillBriefOutput));

    const duplicate = handle.tool.prepareArguments?.({ branch: 123 });
    const result = await execute(duplicate);

    expect(result.terminate).toBe(true);
    expect(result.content[0]?.text).toContain('already captured');
    expect(handle.getCaptured()).toEqual(validFulfillBriefOutput);
    expect(handle.getCallCount()).toBe(1);
    expect(handle.getInvalidCallCount()).toBe(0);
    expect(handle.getLastValidationFailure()).toBeNull();
  });

  it('counts multiple Pi-side schema rejections before a valid capture', async () => {
    const handle = createSubmitOutputTool('fulfill_brief');
    expect(() => handle.tool.prepareArguments?.({ branch: 'a' })).toThrow();
    expect(() => handle.tool.prepareArguments?.({ branch: 'b' })).toThrow();

    await callExecute(handle)(
      handle.tool.prepareArguments?.(validFulfillBriefOutput),
    );

    expect(handle.getInvalidCallCount()).toBe(2);
    expect(handle.getCallCount()).toBe(1);
    expect(handle.getCaptured()).toEqual(validFulfillBriefOutput);
  });

  it('decodes array and number fields sent as JSON strings', async () => {
    // Arrange
    const handle = createSubmitOutputTool('pr_review');
    const scores = [{ criterionId: 'c1', score: 1, rationale: 'ok' }];

    // Act
    const result = await callExecute(handle)({
      scores: JSON.stringify(scores),
      composite: '0.8',
      verdict: 'looks fine',
    });

    // Assert
    expect(result.isError).toBeFalsy();
    expect(handle.getCaptured()).toEqual({
      scores,
      composite: 0.8,
      verdict: 'looks fine',
    });
  });

  it('keeps string fields verbatim even when they parse as JSON', async () => {
    // Arrange
    const handle = createSubmitOutputTool('pr_review');

    // Act
    await callExecute(handle)({
      scores: [{ criterionId: 'c1', score: 1, rationale: 'ok' }],
      composite: 1,
      verdict: '[1]',
    });

    // Assert
    expect(handle.getCaptured()?.verdict).toBe('[1]');
  });

  it('reports a stringified field that decodes to the wrong type', async () => {
    // Arrange
    const handle = createSubmitOutputTool('pr_review');

    // Act
    const result = await callExecute(handle)({
      scores: '{"criterionId":"c1"}',
      composite: 'high',
      verdict: 'v',
    });

    // Assert
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('output/scores');
    expect(result.content[0]?.text).toContain('output/composite');
    expect(handle.getCaptured()).toBeNull();
  });

  it('lets malformed nested verification reach the executor for repair', async () => {
    const handle = createSubmitOutputTool('freeform', {
      input: submitOutputOnlyFreeformInput,
      inputCid: 'bafy-input',
    });
    const malformed = {
      summary: 'done',
      artifacts: [],
      verification: {
        inputCid: 'wrong',
        results: [{ id: 'submit-output', kind: 'wrong', status: 'pass' }],
        passed: true,
      },
    };
    const prepared = handle.tool.prepareArguments?.(malformed);
    expect(Value.Check(handle.tool.parameters, prepared)).toBe(true);
    const result = await callExecute(handle)(prepared);
    expect(result.isError).toBeFalsy();
    expect(handle.getCaptured()?.verification).toEqual({
      inputCid: 'bafy-input',
      results: [
        {
          id: 'submit-output',
          kind: 'gate',
          status: 'pass',
          detail: 'submit_freeform_output accepted valid args',
        },
      ],
      passed: true,
    });
  });

  it('captures a valid payload and invokes the completion boundary', async () => {
    const onValidCapture = vi.fn();
    const handle = createSubmitOutputTool('fulfill_brief', { onValidCapture });
    expect(handle.getCaptured()).toBeNull();
    expect(handle.getCallCount()).toBe(0);

    const result = await callExecute(handle)(validFulfillBriefOutput);

    expect(result.isError).toBeFalsy();
    expect(handle.getCaptured()).toEqual(validFulfillBriefOutput);
    expect(handle.getCallCount()).toBe(1);
    expect(onValidCapture).toHaveBeenCalledTimes(1);
    expect(result.content[0].text).toContain('captured');
    expect(result.terminate).toBe(true);
  });

  it('returns a tool error WITHOUT terminate:true on schema-invalid args', async () => {
    const handle = createSubmitOutputTool('fulfill_brief');
    const result = await callExecute(handle)({
      branch: {}, // cannot be coerced to the required string
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
    expect(handle.getInvalidCallCount()).toBe(1);
    expect(handle.getLastValidationFailure()?.code).toBe(
      'output_validation_failed',
    );
  });

  it('lets the model recover after a schema-invalid first call', async () => {
    const handle = createSubmitOutputTool('fulfill_brief');
    const exec = callExecute(handle);

    const bad = await exec({ branch: 99 });
    expect(bad.isError).toBe(true);
    expect(handle.getCaptured()).toBeNull();

    const good = await exec(validFulfillBriefOutput);
    expect(good.isError).toBeFalsy();
    expect(handle.getCaptured()).toEqual(validFulfillBriefOutput);
    expect(handle.getCallCount()).toBe(1);
  });

  it('accepts an unambiguous sole output envelope after strict revalidation', async () => {
    const handle = createSubmitOutputTool('fulfill_brief');
    const result = await callExecute(handle)({
      output: validFulfillBriefOutput,
    });

    expect(result.isError).toBeFalsy();
    expect(handle.getCaptured()).toEqual(validFulfillBriefOutput);
  });

  it('rejects an ambiguous output envelope with sibling fields', async () => {
    const handle = createSubmitOutputTool('fulfill_brief');
    const result = await callExecute(handle)({
      output: validFulfillBriefOutput,
      note: 'ambiguous',
    });

    expect(result.isError).toBe(true);
    expect(handle.getCaptured()).toBeNull();
    expect(result.content[0].text).toContain('Required top-level fields');
  });

  it('adds repair guidance for invalid freeform artifacts and verification', async () => {
    const handle = createSubmitOutputTool('freeform');
    const result = await callExecute(handle)({
      summary: 'done',
      artifacts: { kind: 'note', title: 'Result' },
      verification: 'submit-output passed',
    });

    expect(result.isError).toBe(true);
    expect(result.terminate).not.toBe(true);
    expect(result.content[0].text).toContain(
      'Tool args must be the output object directly',
    );
    expect(result.content[0].text).toContain('`artifacts` must be an array');
    expect(result.content[0].text).toContain(
      '`verification` must be an object',
    );
    expect(result.content[0].text).toContain('Minimal valid freeform retry');
    expect(handle.getCaptured()).toBeNull();
  });

  it('preserves required result in contracted freeform retry guidance', async () => {
    const handle = createSubmitOutputTool('freeform', {
      input: {
        outputContract: {
          version: 1,
          schema: {
            type: 'object',
            properties: { category: { type: 'string' } },
            required: ['category'],
            additionalProperties: false,
          },
        },
      },
    });
    const response = await callExecute(handle)({
      summary: 'Done.',
      result: { category: 'technical' },
      artifacts: 'invalid',
    });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain(
      'preserve the required `result`',
    );
    expect(response.content[0].text).not.toContain(
      'Minimal valid freeform retry',
    );
    expect(handle.getCaptured()).toBeNull();
  });

  it('repairs freeform submit-output-only verification and artifact shape', async () => {
    const handle = createSubmitOutputTool('freeform', {
      input: submitOutputOnlyFreeformInput,
      inputCid: 'bafy-input',
    });
    const result = await callExecute(handle)({
      summary: 'done',
      artifacts: { kind: 'note', title: 'Result', body: 'done' },
      verification: 'submit-output passed',
    });

    expect(result.isError).toBeFalsy();
    expect(handle.getCaptured()).toEqual({
      summary: 'done',
      artifacts: [{ kind: 'note', title: 'Result', body: 'done' }],
      verification: {
        inputCid: 'bafy-input',
        results: [
          {
            id: 'submit-output',
            kind: 'gate',
            status: 'pass',
            detail: 'submit_freeform_output accepted valid args',
          },
        ],
        passed: true,
      },
    });
  });

  it('repairs submit-only verification while preserving a contracted result', async () => {
    const handle = createSubmitOutputTool('freeform', {
      input: {
        ...submitOutputOnlyFreeformInput,
        outputContract: {
          version: 1,
          schema: {
            type: 'object',
            properties: {
              changes: { type: 'array', items: { type: 'string' } },
            },
            required: ['changes'],
            additionalProperties: false,
          },
        },
      },
      inputCid: 'bafy-input',
    });

    const response = await callExecute(handle)({
      summary: 'No documented changes',
      result: { changes: [] },
      verification: {
        inputCid: 'wrong',
        results: [
          { id: 'submit-output', kind: 'submit-tool-call', status: 'pass' },
        ],
        passed: true,
      },
    });

    expect(response.isError).toBeFalsy();
    expect(handle.getCaptured()).toMatchObject({
      result: { changes: [] },
      verification: {
        inputCid: 'bafy-input',
        results: [{ id: 'submit-output', kind: 'gate', status: 'pass' }],
        passed: true,
      },
    });
  });

  it('repairs run_eval submit-output-only verification (not just freeform)', async () => {
    // The repair used to be freeform-only, so weaker models that mis-type the
    // `verification` object failed run_eval on verification alone. It now
    // applies to any producer type whose sole gate is the submit-output gate.
    const handle = createSubmitOutputTool('run_eval', {
      input: {
        scenario: { prompt: 'do the thing' },
        variantLabel: 'x:baseline',
        execution: { mode: 'vitro', workspace: 'none' },
        context: [],
        successCriteria: {
          version: 1 as const,
          gates: [
            {
              id: 'submit-output',
              kind: 'submit-tool-call' as const,
              description:
                'Call `submit_run_eval_output` exactly once with valid structured output.',
              required: true,
            },
          ],
        },
      },
      inputCid: 'bafy-input',
    });
    const result = await callExecute(handle)({
      response: 'answer',
      verification: 'submit-output passed', // wrong type — must be repaired
    });

    expect(result.isError).toBeFalsy();
    expect(handle.getCaptured()).toEqual({
      response: 'answer',
      verification: {
        inputCid: 'bafy-input',
        results: [
          {
            id: 'submit-output',
            kind: 'gate',
            status: 'pass',
            detail: 'submit_run_eval_output accepted valid args',
          },
        ],
        passed: true,
      },
    });
  });

  it('does not synthesize freeform verification when non-submit criteria exist', async () => {
    const handle = createSubmitOutputTool('freeform', {
      input: {
        ...submitOutputOnlyFreeformInput,
        successCriteria: {
          ...submitOutputOnlyFreeformInput.successCriteria,
          assertions: [
            {
              id: 'has-summary',
              path: 'summary',
              op: 'exists' as const,
            },
          ],
        },
      },
      inputCid: 'bafy-input',
    });
    const result = await callExecute(handle)({
      summary: 'done',
      verification: 'submit-output passed',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(
      '`verification` must be an object',
    );
    expect(handle.getCaptured()).toBeNull();
  });

  it('accepts a valid call after repeated invalid calls in the same session', async () => {
    const handle = createSubmitOutputTool('pr_review');
    const exec = callExecute(handle);
    for (let call = 0; call < 3; call += 1) {
      const invalid = await exec({ output: {} });
      expect(invalid.isError).toBe(true);
      expect(invalid.terminate).not.toBe(true);
      expect(invalid.content[0].text).toContain('output/scores');
    }

    const validAfterErrors = await exec({
      scores: [
        {
          criterionId: 'complexity',
          score: 1,
          rationale: 'The change is straightforward.',
        },
      ],
      composite: 1,
      verdict: 'Low complexity.',
    });

    expect(validAfterErrors.isError).toBeFalsy();
    expect(handle.getCaptured()).toEqual({
      scores: [
        {
          criterionId: 'complexity',
          score: 1,
          rationale: 'The change is straightforward.',
        },
      ],
      composite: 1,
      verdict: 'Low complexity.',
    });
    expect(handle.getInvalidCallCount()).toBe(3);
    expect(handle.getCallCount()).toBe(1);
  });

  it('rejects producer output missing verification when input.successCriteria is set', async () => {
    const handle = createSubmitOutputTool('run_eval', {
      input: {
        scenario: { prompt: 'do it' },
        variantLabel: 'baseline',
        execution: { mode: 'vitro', workspace: 'none' },
        context: [],
        successCriteria: { version: 1 as const },
      },
    });
    const result = await callExecute(handle)({
      response: 'done',
    });

    expect(result.isError).toBe(true);
    expect(result.terminate).not.toBe(true);
    expect(result.content[0].text).toMatch(/verification is required/i);
    expect(handle.getCaptured()).toBeNull();
  });

  it('accepts producer output with verification when input.successCriteria is set', async () => {
    const handle = createSubmitOutputTool('run_eval', {
      input: {
        scenario: { prompt: 'do it' },
        variantLabel: 'baseline',
        execution: { mode: 'vitro', workspace: 'none' },
        context: [],
        successCriteria: { version: 1 as const },
      },
    });
    const result = await callExecute(handle)({
      response: 'done',
      verification,
    });

    expect(result.isError).toBeFalsy();
    expect(handle.getCaptured()).toEqual({
      response: 'done',
      verification,
    });
  });

  it('keeps the first valid capture and completes only once', async () => {
    const onValidCapture = vi.fn();
    const handle = createSubmitOutputTool('fulfill_brief', { onValidCapture });
    const exec = callExecute(handle);

    await exec(validFulfillBriefOutput);
    const second = {
      ...validFulfillBriefOutput,
      summary: 'duplicate submission must not supersede the first',
    };
    const duplicate = await exec(second);

    expect(duplicate.content[0].text).toContain('duplicate');
    expect(duplicate.terminate).toBe(true);
    expect(handle.getCaptured()).toEqual(validFulfillBriefOutput);
    expect(handle.getCallCount()).toBe(1);
    expect(onValidCapture).toHaveBeenCalledTimes(1);
  });

  it('works for every built-in task type', async () => {
    // Smoke-test the schema lookup path for every task type the prompts
    // reference. We don't construct full valid payloads for each — that
    // would couple this test to every output shape — we just verify the
    // tool factory accepts the type and the produced tool has the right
    // name. Validation is exercised in dedicated cases above.
    for (const t of Object.keys(BUILT_IN_TASK_TYPES)) {
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

describe('final-message submit', () => {
  it.each([
    ['bare object', '  {"summary":"done"}\n', '{"summary":"done"}'],
    ['json fence', '```json\n{"summary":"done"}\n```', '{"summary":"done"}'],
    ['plain fence', '```\n{"summary":"done"}\n```', '{"summary":"done"}'],
    ['prose before', 'Here it is: {"summary":"done"}', null],
    ['prose after fence', '```json\n{"a":1}\n```\nDone.', null],
    ['array', '[{"summary":"done"}]', null],
    ['prose only', 'done', null],
  ])('extracts JSON only from a whole-message object: %s', (_, text, want) => {
    expect(extractFinalMessageJson(text)).toBe(want);
  });

  it('captures a valid JSON-only final message through the submit pipeline', () => {
    const handle = createSubmitOutputTool('freeform');

    const result = handle.submitFinalMessage(
      '```json\n{"summary": "done", "artifacts": "[]"}\n```',
    );

    expect(result).toBe('captured');
    expect(handle.getCaptured()).toEqual({ summary: 'done', artifacts: [] });
    expect(handle.getCapturedSource()).toBe('final_message');
    expect(handle.getCapturedRepairKinds()).toEqual(['json_string']);
    expect(handle.getCallCount()).toBe(1);
    expect(handle.getInvalidCallCount()).toBe(0);
  });

  it('records lenient JSON syntax repairs on a final message', () => {
    const handle = createSubmitOutputTool('freeform');

    expect(handle.submitFinalMessage("{summary: 'done'}")).toBe('captured');
    expect(handle.getCapturedRepairKinds()).toEqual(['lenient_json']);
  });

  it('records a validation failure for an invalid JSON-only final message', () => {
    const handle = createSubmitOutputTool('freeform');

    const result = handle.submitFinalMessage('{"artifacts": []}');

    expect(result).toBe('invalid');
    expect(handle.getCaptured()).toBeNull();
    expect(handle.getCapturedSource()).toBeNull();
    expect(handle.getInvalidCallCount()).toBe(1);
    expect(handle.getLastValidationFailure()).toMatchObject({
      code: 'output_validation_failed',
    });
    expect(handle.getLastValidationFailure()?.message).toContain('summary');
  });

  it('leaves state untouched for prose or unparseable text', () => {
    const handle = createSubmitOutputTool('freeform');

    expect(handle.submitFinalMessage('All done, see the PR.')).toBe('not_json');
    expect(handle.submitFinalMessage('{"summary": "done"')).toBe('not_json');
    expect(handle.getInvalidCallCount()).toBe(0);
    expect(handle.getLastValidationFailure()).toBeNull();
  });

  it('keeps the first tool capture when a final message follows', async () => {
    const handle = createSubmitOutputTool('freeform');
    await callExecute(handle)({ summary: 'from tool' });

    expect(handle.submitFinalMessage('{"summary":"from text"}')).toBe(
      'captured',
    );
    expect(handle.getCaptured()).toEqual({ summary: 'from tool' });
    expect(handle.getCapturedSource()).toBe('submit_tool');
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
