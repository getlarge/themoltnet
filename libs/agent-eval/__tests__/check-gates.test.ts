import { describe, expect, it } from 'vitest';

import {
  checkGates,
  type GateAgent,
  type GateTaskAttempt,
  type GateTaskMessage,
} from '../src/check-gates.js';
import type { GateExpectations } from '../src/scenario.js';

const EXPECTED = { model: 'qwen3-coder:480b-cloud', workspace: 'none' };

/** A valid RunEvalOutput payload (no successCriteria => no verification). */
const VALID_OUTPUT = {
  response: 'Completed the task and submitted output.',
  totalTokens: 1234,
  durationMs: 4567,
  traceparent: '00-abc-def-01',
};

function messages(
  overrides: {
    executeStart?: Partial<{
      model: string;
      workspaceMode: string;
      provider: string;
    }> | null;
    promptSections?: Array<{ id: string }> | null;
    tools?: string[];
    promptBuildError?: string;
  } = {},
): GateTaskMessage[] {
  const out: GateTaskMessage[] = [];
  if (overrides.promptBuildError) {
    out.push({
      kind: 'error',
      payload: { message: overrides.promptBuildError, phase: 'prompt_build' },
    });
  }
  if (overrides.executeStart !== null) {
    out.push({
      kind: 'info',
      payload: {
        event: 'execute_start',
        model: overrides.executeStart?.model ?? EXPECTED.model,
        provider: overrides.executeStart?.provider ?? 'ollama-cloud',
        workspaceMode: overrides.executeStart?.workspaceMode ?? 'none',
      },
    });
  }
  if (overrides.promptSections !== null) {
    out.push({
      kind: 'info',
      payload: {
        event: 'prompt_assembled',
        taskType: 'run_eval',
        sections: overrides.promptSections ?? [
          { id: 'run_eval.scenario', source: 'task_input', char_count: 40 },
          { id: 'final_output', source: 'final_output', char_count: 120 },
        ],
      },
    });
  }
  for (const tool of overrides.tools ?? []) {
    out.push({ kind: 'tool_call_start', payload: { tool_name: tool } });
  }
  return out;
}

function fakeAgent(
  msgs: GateTaskMessage[],
  attempt: GateTaskAttempt | null,
): GateAgent {
  return {
    tasks: {
      listMessages: () => Promise.resolve(msgs),
      listAttempts: () => Promise.resolve(attempt ? [attempt] : []),
    },
  };
}

const completedAttempt: GateTaskAttempt = {
  attemptN: 1,
  status: 'completed',
  output: VALID_OUTPUT,
};

describe('checkGates', () => {
  it('passes a clean attempt against default gates', async () => {
    // Arrange
    const agent = fakeAgent(messages(), completedAttempt);
    const gates: GateExpectations = {};

    // Act
    const result = await checkGates(agent, 't1', 1, gates, EXPECTED);

    // Assert
    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it('fails when execute_start is absent', async () => {
    const agent = fakeAgent(messages({ executeStart: null }), completedAttempt);

    const result = await checkGates(agent, 't1', 1, {}, EXPECTED);

    expect(result.passed).toBe(false);
    expect(result.failures.map((f) => f.gate)).toContain('execute_start');
  });

  it('fails when the model does not match the pinned model', async () => {
    const agent = fakeAgent(
      messages({ executeStart: { model: 'some-other-model' } }),
      completedAttempt,
    );

    const result = await checkGates(agent, 't1', 1, {}, EXPECTED);

    expect(result.passed).toBe(false);
    expect(result.failures.map((f) => f.gate)).toContain('model');
  });

  it('fails when workspace mode disagrees with the eval declaration', async () => {
    const agent = fakeAgent(
      messages({ executeStart: { workspaceMode: 'shared_mount' } }),
      completedAttempt,
    );

    const result = await checkGates(agent, 't1', 1, {}, EXPECTED);

    expect(result.failures.map((f) => f.gate)).toContain('workspace_mode');
  });

  it('fails when a required prompt section is missing', async () => {
    const agent = fakeAgent(
      messages({
        promptSections: [{ id: 'run_eval.scenario' }],
      }),
      completedAttempt,
    );
    const gates: GateExpectations = {
      requirePromptSections: ['run_eval.scenario', 'final_output'],
    };

    const result = await checkGates(agent, 't1', 1, gates, EXPECTED);

    expect(result.passed).toBe(false);
    expect(result.failures.map((f) => f.gate)).toContain('prompt_section');
  });

  it('fails when a forbidden tool was called (diary discipline)', async () => {
    const agent = fakeAgent(messages({ tools: ['bash'] }), completedAttempt);
    const gates: GateExpectations = { forbidToolCalls: ['bash'] };

    const result = await checkGates(agent, 't1', 1, gates, EXPECTED);

    expect(result.failures.map((f) => f.gate)).toContain('tool_forbidden');
  });

  it('fails when a required tool was not called (artifact upload)', async () => {
    const agent = fakeAgent(messages({ tools: [] }), completedAttempt);
    const gates: GateExpectations = {
      requireToolCalls: ['moltnet_upload_task_artifact'],
    };

    const result = await checkGates(agent, 't1', 1, gates, EXPECTED);

    expect(result.failures.map((f) => f.gate)).toContain('tool_required');
  });

  it('flags a prompt_build failure', async () => {
    const agent = fakeAgent(
      messages({ promptBuildError: 'boom' }),
      completedAttempt,
    );

    const result = await checkGates(agent, 't1', 1, {}, EXPECTED);

    expect(result.failures.map((f) => f.gate)).toContain('prompt_build');
  });

  it('fails when the accepted attempt has no captured output', async () => {
    const agent = fakeAgent(messages(), {
      attemptN: 1,
      status: 'completed',
      output: null,
    });

    const result = await checkGates(agent, 't1', 1, {}, EXPECTED);

    expect(result.failures.map((f) => f.gate)).toContain('submit');
  });

  it('fails when the captured output is not a valid RunEvalOutput', async () => {
    const agent = fakeAgent(messages(), {
      attemptN: 1,
      status: 'completed',
      output: { response: 'x' }, // missing required totalTokens/durationMs/traceparent
    });

    const result = await checkGates(agent, 't1', 1, {}, EXPECTED);

    expect(result.passed).toBe(false);
    expect(result.failures.map((f) => f.gate)).toContain('output_schema');
  });

  it('fails when the attempt did not complete', async () => {
    const agent = fakeAgent(messages(), {
      attemptN: 1,
      status: 'failed',
      output: null,
    });

    const result = await checkGates(agent, 't1', 1, {}, EXPECTED);

    expect(result.failures.map((f) => f.gate)).toContain('submit');
  });

  it('skips the submit gate when requireCleanSubmit is false', async () => {
    // A scenario that only asserts prompt assembly, not a clean submit.
    const agent = fakeAgent(messages(), {
      attemptN: 1,
      status: 'failed',
      output: null,
    });
    const gates: GateExpectations = { requireCleanSubmit: false };

    const result = await checkGates(agent, 't1', 1, gates, EXPECTED);

    // No submit-related failures; only the (satisfied) message-stream gates ran.
    expect(result.failures.map((f) => f.gate)).not.toContain('submit');
    expect(result.passed).toBe(true);
  });
});
