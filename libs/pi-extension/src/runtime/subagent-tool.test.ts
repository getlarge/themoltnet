/**
 * Unit tests for the subagent custom tool. We do NOT boot a real
 * AgentSession — instead we inject a fake `buildAgentSession` that
 * returns a stub session whose `prompt()` synchronously invokes the
 * inner submit tool with caller-controlled args. That gives us full
 * coverage of the tool's logic (contract resolution, schema
 * validation, capture, error paths) without any pi runtime or VM.
 */
import type {
  AgentSession,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import {
  __resetSubagentOutputContractsForTests,
  registerSubagentOutputContract,
} from '@themoltnet/agent-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BuildAgentSessionArgs } from './agent-session-factory.js';
import { createSubagentTool } from './subagent-tool.js';

const SubagentResult = Type.Object({
  verdict: Type.String({ minLength: 1 }),
  score: Type.Number({ minimum: 0, maximum: 1 }),
});

const stubArgs = (
  overrides: Partial<Parameters<typeof createSubagentTool>[0]> = {},
) => ({
  mountPath: '/workspace',
  piAuthDir: '/home/agent/.pi/agent',
  modelHandle: {} as Parameters<typeof createSubagentTool>[0]['modelHandle'],
  agentName: 'test-agent',
  inheritedCustomTools: [],
  parentRuntimeInstructor: '# Parent runtime instructor (test stub)',
  parentTaskId: 'parent-task-id',
  parentTaskType: 'judge_eval_variant',
  parentAttemptN: 1,
  ...overrides,
});

/**
 * Build a fake `AgentSession` whose `prompt()` invokes the
 * `submit_subagent_output` tool from the supplied `customTools` with
 * the given args. Returns the constructed prompt + the captured
 * BuildAgentSessionArgs for assertion.
 */
function makeFakeSessionFactory(
  innerSubmitArgs: Record<string, unknown> | null,
): {
  build: (args: BuildAgentSessionArgs) => Promise<AgentSession>;
  capturedBuildArgs: BuildAgentSessionArgs | null;
  innerSubmitInvocations: number;
} {
  const state = {
    capturedBuildArgs: null as BuildAgentSessionArgs | null,
    innerSubmitInvocations: 0,
  };

  const build = async (args: BuildAgentSessionArgs): Promise<AgentSession> => {
    state.capturedBuildArgs = args;
    const submitTool = args.customTools.find(
      (t) => t.name === 'submit_subagent_output',
    );
    if (!submitTool) {
      throw new Error(
        'fake session factory: customTools did not include submit_subagent_output',
      );
    }

    const prompt = vi.fn(async (_text: string) => {
      if (innerSubmitArgs === null) {
        // Simulate a session that ends without calling submit at all.
        return;
      }
      state.innerSubmitInvocations += 1;
      const exec = (
        submitTool as unknown as {
          execute: (
            id: string,
            params: Record<string, unknown>,
            signal: AbortSignal | undefined,
            onUpdate: undefined,
            ctx: unknown,
          ) => Promise<unknown>;
        }
      ).execute;
      await exec(
        'fake-call-id',
        innerSubmitArgs,
        undefined,
        undefined,
        {} as unknown,
      );
    });

    return {
      prompt,
      // pi's AgentSession has many more fields; we cast through unknown
      // because the subagent-tool only ever calls `prompt`.
    } as unknown as AgentSession;
  };

  return {
    build,
    get capturedBuildArgs() {
      return state.capturedBuildArgs;
    },
    get innerSubmitInvocations() {
      return state.innerSubmitInvocations;
    },
  };
}

async function callOuter(
  tool: ToolDefinition,
  params: { task: string; output_schema: string },
) {
  const exec = (
    tool as unknown as {
      execute: (
        id: string,
        params: Record<string, unknown>,
        signal: AbortSignal | undefined,
        onUpdate: undefined,
        ctx: unknown,
      ) => Promise<{
        content: { type: 'text'; text: string }[];
        details: Record<string, unknown>;
        isError?: boolean;
      }>;
    }
  ).execute;
  return exec('outer-id', params, undefined, undefined, {} as unknown);
}

describe('createSubagentTool', () => {
  beforeEach(() => {
    __resetSubagentOutputContractsForTests();
    registerSubagentOutputContract({
      name: 'sample',
      description: 'Sample contract for tests.',
      parametersSchema: SubagentResult,
    });
  });

  it('returns a tool with the expected shape', () => {
    const factory = makeFakeSessionFactory(null);
    const handle = createSubagentTool({
      ...stubArgs(),
      buildAgentSession: factory.build,
    });
    expect(handle.tool.name).toBe('subagent');
    expect(typeof handle.tool.description).toBe('string');
    expect(handle.getCallCount()).toBe(0);
  });

  it('errors loudly on unknown output_schema', async () => {
    const factory = makeFakeSessionFactory(null);
    const handle = createSubagentTool({
      ...stubArgs(),
      buildAgentSession: factory.build,
    });
    const result = await callOuter(handle.tool, {
      task: 'go',
      output_schema: 'no_such_contract',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/unknown output_schema/);
    expect(handle.getCallCount()).toBe(0);
    expect(factory.capturedBuildArgs).toBeNull();
  });

  it('errors when the inner session never submits', async () => {
    const factory = makeFakeSessionFactory(null);
    const handle = createSubagentTool({
      ...stubArgs(),
      buildAgentSession: factory.build,
    });
    const result = await callOuter(handle.tool, {
      task: 'do nothing',
      output_schema: 'sample',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/never submitt|without calling/);
    expect(factory.innerSubmitInvocations).toBe(0);
  });

  it('returns the captured payload on success and increments callCount', async () => {
    const payload = { verdict: 'good', score: 0.9 };
    const factory = makeFakeSessionFactory(payload);
    const handle = createSubagentTool({
      ...stubArgs(),
      buildAgentSession: factory.build,
    });
    const result = await callOuter(handle.tool, {
      task: 'grade this',
      output_schema: 'sample',
    });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0].text)).toEqual(payload);
    expect(handle.getCallCount()).toBe(1);
    expect(factory.innerSubmitInvocations).toBe(1);
  });

  it('increments getCallCount across multiple successful calls', async () => {
    // Successive parent invocations should accrue. The handle's
    // counter is read by execute-pi-task to emit a per-attempt
    // subagent_summary event, so anything > 1 needs to be observable.
    const payload = { verdict: 'ok', score: 0.5 };
    const factory = makeFakeSessionFactory(payload);
    const handle = createSubagentTool({
      ...stubArgs(),
      buildAgentSession: factory.build,
    });
    await callOuter(handle.tool, { task: 'a', output_schema: 'sample' });
    expect(handle.getCallCount()).toBe(1);
    await callOuter(handle.tool, { task: 'b', output_schema: 'sample' });
    expect(handle.getCallCount()).toBe(2);
    await callOuter(handle.tool, { task: 'c', output_schema: 'sample' });
    expect(handle.getCallCount()).toBe(3);
    // The fake factory counts inner submit invocations; should match.
    expect(factory.innerSubmitInvocations).toBe(3);
  });

  it('does not increment getCallCount when output_schema is unknown', async () => {
    const factory = makeFakeSessionFactory(null);
    const handle = createSubagentTool({
      ...stubArgs(),
      buildAgentSession: factory.build,
    });
    await callOuter(handle.tool, {
      task: 'go',
      output_schema: 'unknown_contract',
    });
    expect(handle.getCallCount()).toBe(0);
  });

  it('passes parent runtime instructor + subagent preamble in appendSystemPrompt', async () => {
    const payload = { verdict: 'ok', score: 0.5 };
    const factory = makeFakeSessionFactory(payload);
    const handle = createSubagentTool({
      ...stubArgs({
        parentRuntimeInstructor: '## SENTINEL_PARENT_INSTRUCTOR',
      }),
      buildAgentSession: factory.build,
    });
    await callOuter(handle.tool, {
      task: 'work',
      output_schema: 'sample',
    });
    const append = factory.capturedBuildArgs?.appendSystemPrompt ?? [];
    expect(append).toHaveLength(2);
    expect(append[0]).toContain('SENTINEL_PARENT_INSTRUCTOR');
    expect(append[1]).toMatch(/You are a subagent/);
    expect(append[1]).toMatch(/sample/); // contract name in the preamble
  });

  it('inherits the caller-supplied customTools and adds submit_subagent_output', async () => {
    const payload = { verdict: 'ok', score: 0.5 };
    const factory = makeFakeSessionFactory(payload);
    const fakeInherited: ToolDefinition[] = [
      {
        name: 'fake_inherited_tool',
        label: 'Fake',
        description: 'fake',
        parameters: Type.Object({}),

        execute: (async () => ({ content: [], details: {} })) as any,
      } as ToolDefinition,
    ];
    const handle = createSubagentTool({
      ...stubArgs({ inheritedCustomTools: fakeInherited }),
      buildAgentSession: factory.build,
    });
    await callOuter(handle.tool, { task: 'work', output_schema: 'sample' });
    const tools = factory.capturedBuildArgs?.customTools ?? [];
    expect(tools.map((t) => t.name)).toEqual([
      'fake_inherited_tool',
      'submit_subagent_output',
    ]);
  });

  it('emits per-subagent OTel attrs (parent task id + contract + index)', async () => {
    const payload = { verdict: 'ok', score: 0.5 };
    const factory = makeFakeSessionFactory(payload);
    const handle = createSubagentTool({
      ...stubArgs({
        parentTaskId: 'P-123',
        parentTaskType: 'judge_eval_variant',
        parentAttemptN: 2,
      }),
      buildAgentSession: factory.build,
    });
    await callOuter(handle.tool, { task: 'work', output_schema: 'sample' });
    const attrs = factory.capturedBuildArgs?.otelSpanAttrs ?? {};
    expect(attrs['moltnet.task.id']).toBe('P-123');
    expect(attrs['moltnet.task.type']).toBe('judge_eval_variant');
    expect(attrs['moltnet.task.attempt']).toBe(2);
    expect(attrs['moltnet.subagent.contract']).toBe('sample');
    expect(attrs['moltnet.subagent.index']).toBe(1);
  });

  it('errors when the inner submit args fail schema validation', async () => {
    // Inner payload missing required `verdict` — the inner submit
    // tool's schema check fires inside the fake session's prompt(),
    // captured stays null, outer returns "never submitted".
    // (We rely on the inner tool's defineTool schema validator.)
    const badPayload = { score: 0.5 } as Record<string, unknown>;
    const factory = makeFakeSessionFactory(badPayload);
    const handle = createSubagentTool({
      ...stubArgs(),
      buildAgentSession: factory.build,
    });
    const result = await callOuter(handle.tool, {
      task: 'work',
      output_schema: 'sample',
    });
    // Inner tool returned isError:true; capture stayed null; outer
    // surfaces "never submitted" because no successful capture happened.
    expect(result.isError).toBe(true);
  });
});
