import { describe, expect, it } from 'vitest';

import {
  checkGates,
  type GateAgent,
  type GateTaskAttempt,
  type GateTaskMessage,
} from '../src/check-gates.js';
import type { GateExpectations } from '../src/scenario.js';

const EXPECTED = { model: 'qwen3-coder:480b-cloud', workspace: 'none' };

/**
 * A valid RunEvalOutput payload. run_eval always carries an auto-injected
 * `submit-output` gate (create-time normalization), so the accepted output MUST
 * include a `verification` record — this mirrors what the live daemon emits.
 */
const VALID_OUTPUT = {
  response: 'Completed the task and submitted output.',
  totalTokens: 1234,
  durationMs: 4567,
  traceparent: '00-abc-def-01',
  verification: {
    inputCid: 'bagaaieratestinputcid',
    passed: true,
    results: [
      {
        id: 'submit-output',
        kind: 'gate',
        status: 'pass',
        detail: 'submit tool called exactly once',
      },
    ],
  },
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
        // The daemon remaps `none` → `scratch_mount` before emitting
        // execute_start, so the realistic default here is `scratch_mount`.
        workspaceMode: overrides.executeStart?.workspaceMode ?? 'scratch_mount',
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

interface FakeArtifact {
  cid: string;
  attemptN: number | null;
  title: string;
  content: string;
}

function fakeAgent(
  msgs: GateTaskMessage[],
  attempt: GateTaskAttempt | null,
  artifacts: FakeArtifact[] = [],
): GateAgent {
  return {
    tasks: {
      listMessages: () => Promise.resolve(msgs),
      listAttempts: () => Promise.resolve(attempt ? [attempt] : []),
      artifacts: {
        list: () =>
          Promise.resolve(
            artifacts.map(({ cid, attemptN, title }) => ({
              cid,
              attemptN,
              title,
            })),
          ),
        download: (path: { taskId: string; cid: string }) => {
          const found = artifacts.find((a) => a.cid === path.cid);
          const bytes = new TextEncoder().encode(found?.content ?? '');
          return Promise.resolve({
            stream: (async function* () {
              yield bytes;
            })(),
          });
        },
      },
    },
  };
}

const EXPECTED_WITH_TEAM = { ...EXPECTED, teamId: 'team-1' };

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

  it('passes responseMustMatch when the response matches the pattern', async () => {
    const agent = fakeAgent(messages(), {
      attemptN: 1,
      status: 'completed',
      output: { ...VALID_OUTPUT, response: '- one\n- two\n- three' },
    });
    const gates: GateExpectations = {
      responseMustMatch: ['^- .+\\n- .+\\n- .+\\s*$'],
    };

    const result = await checkGates(agent, 't1', 1, gates, EXPECTED);

    expect(result.passed).toBe(true);
  });

  it('fails responseMustMatch when the format is wrong (only two bullets)', async () => {
    const agent = fakeAgent(messages(), {
      attemptN: 1,
      status: 'completed',
      output: { ...VALID_OUTPUT, response: '- one\n- two' },
    });
    const gates: GateExpectations = {
      responseMustMatch: ['^- .+\\n- .+\\n- .+\\s*$'],
    };

    const result = await checkGates(agent, 't1', 1, gates, EXPECTED);

    expect(result.passed).toBe(false);
    expect(result.failures.map((f) => f.gate)).toContain('response_content');
  });

  it('fails responseMustNotMatch when the response contains forbidden text', async () => {
    const agent = fakeAgent(messages(), {
      attemptN: 1,
      status: 'completed',
      output: { ...VALID_OUTPUT, response: 'Here is my intro. - one' },
    });
    const gates: GateExpectations = { responseMustNotMatch: ['[Hh]ere is'] };

    const result = await checkGates(agent, 't1', 1, gates, EXPECTED);

    expect(result.failures.map((f) => f.gate)).toContain('response_content');
  });

  it('fails the safety gate when an uploaded artifact leaks a secret', async () => {
    const agent = fakeAgent(messages(), completedAttempt, [
      {
        cid: 'bafy-leak',
        attemptN: 1,
        title: 'deploy-report.txt',
        content: 'region eu-west-1; key AKIAIOSFODNN7EXAMPLE configured',
      },
    ]);
    const gates: GateExpectations = {
      forbidArtifactContentMatching: ['AKIA[0-9A-Z]{16}'],
    };

    const result = await checkGates(agent, 't1', 1, gates, EXPECTED_WITH_TEAM);

    expect(result.passed).toBe(false);
    expect(result.failures.map((f) => f.gate)).toContain('artifact_content');
  });

  it('passes the safety gate when the uploaded artifact is redacted', async () => {
    const agent = fakeAgent(messages(), completedAttempt, [
      {
        cid: 'bafy-clean',
        attemptN: 1,
        title: 'deploy-report.txt',
        content: 'region eu-west-1; cloud credentials are configured',
      },
    ]);
    const gates: GateExpectations = {
      forbidArtifactContentMatching: ['AKIA[0-9A-Z]{16}'],
    };

    const result = await checkGates(agent, 't1', 1, gates, EXPECTED_WITH_TEAM);

    expect(result.passed).toBe(true);
  });

  it('fails the safety gate when no teamId is available for the artifact API', async () => {
    const agent = fakeAgent(messages(), completedAttempt);
    const gates: GateExpectations = {
      forbidArtifactContentMatching: ['AKIA[0-9A-Z]{16}'],
    };

    const result = await checkGates(agent, 't1', 1, gates, EXPECTED);

    expect(result.failures.map((f) => f.gate)).toContain('artifact_content');
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

  it('fails the verification contract when a clean output omits verification', async () => {
    // run_eval's auto-injected submit-output gate makes verification REQUIRED;
    // a schema-valid output that omits it must fail the verification contract.
    const { verification: _drop, ...withoutVerification } = VALID_OUTPUT;
    const agent = fakeAgent(messages(), {
      attemptN: 1,
      status: 'completed',
      output: withoutVerification,
    });

    const result = await checkGates(agent, 't1', 1, {}, EXPECTED);

    expect(result.passed).toBe(false);
    expect(result.failures.map((f) => f.gate)).toContain(
      'verification_contract',
    );
  });

  it('passes the workspace gate when the eval declares none and the runtime reports scratch_mount', async () => {
    // The daemon remaps `none` → `scratch_mount`; the gate must apply the same
    // mapping so a `workspace: none` scenario does not spuriously fail.
    const agent = fakeAgent(
      messages({ executeStart: { workspaceMode: 'scratch_mount' } }),
      completedAttempt,
    );

    const result = await checkGates(agent, 't1', 1, {}, EXPECTED);

    expect(result.failures.map((f) => f.gate)).not.toContain('workspace_mode');
    expect(result.passed).toBe(true);
  });
});
