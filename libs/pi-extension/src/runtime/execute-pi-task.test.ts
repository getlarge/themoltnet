/**
 * Focused tests for the final-output parsing helpers and the
 * cancellation-wiring helper. The full `executePiTask` flow needs a
 * booted Gondolin VM and is covered by the integration demo / a future
 * e2e once we have one that exercises pi against a real task type.
 */
import { Readable } from 'node:stream';

import { computeJsonCid } from '@moltnet/crypto-service';
import { metrics } from '@opentelemetry/api';
import {
  AggregationTemporality,
  type CollectionResult,
  MeterProvider,
  MetricReader,
} from '@opentelemetry/sdk-metrics';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildSubmitMissingPrompt,
  computeProviderErrorRetryDelay,
  createGondolinToolDefinitions,
  createSessionTurnState,
  describeToolErrorMessage,
  formatProviderErrorRetryNotification,
  formatProviderErrorRetryStatus,
  isBashTimeoutResult,
  makeSessionEventHandler,
  notifyProviderErrorRetryUi,
  openVmWorkspaceFileForRead,
  promptUntilSubmitted,
  promptWithProviderErrorRetries,
  resolveSubmitMissingConfig,
  sanitizeProviderErrorRetryReason,
  shouldEmitToolCallError,
  shouldRetryProviderErrorMessage,
  submitRepromptStopped,
  wireSessionAbort,
} from './execute-pi-task.js';
import {
  __resetTaskOutputCounterForTests,
  extractJsonObject,
  parseStructuredTaskOutput,
  recordTaskOutputParseResult,
  type TaskOutputParseCode,
} from './task-output.js';

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

describe('extractJsonObject', () => {
  it('returns null for empty input', () => {
    expect(extractJsonObject('')).toBeNull();
  });

  it('parses a bare JSON object', () => {
    const txt = '{"branch":"feat/foo","summary":"hi"}';
    expect(extractJsonObject(txt)).toEqual({
      branch: 'feat/foo',
      summary: 'hi',
    });
  });

  it('prefers the last top-level object when prose precedes it', () => {
    const txt = 'Here is my answer:\n\n{"ok":true,"n":2}';
    expect(extractJsonObject(txt)).toEqual({ ok: true, n: 2 });
  });

  it('recovers an object inside a ```json code fence', () => {
    const txt = 'done.\n\n```json\n{"a":1,"b":[1,2,3]}\n```\n';
    expect(extractJsonObject(txt)).toEqual({ a: 1, b: [1, 2, 3] });
  });

  it('ignores braces inside strings', () => {
    const txt = 'noise {"msg":"not {really} a nest","k":1}';
    expect(extractJsonObject(txt)).toEqual({
      msg: 'not {really} a nest',
      k: 1,
    });
  });

  it('handles nested objects', () => {
    const txt = '{"outer":{"inner":{"x":1}},"arr":[{"y":2}]}';
    expect(extractJsonObject(txt)).toEqual({
      outer: { inner: { x: 1 } },
      arr: [{ y: 2 }],
    });
  });

  it('returns null when no complete object exists', () => {
    expect(extractJsonObject('this is just text')).toBeNull();
    expect(extractJsonObject('{"incomplete":')).toBeNull();
  });

  it('falls back from malformed fence to raw text scan', () => {
    const txt = '```json\nnot json\n```\n\n{"real":true}';
    expect(extractJsonObject(txt)).toEqual({ real: true });
  });
});

describe('createGondolinToolDefinitions', () => {
  it('registers the full VM-routed built-in tool surface', () => {
    const tools = createGondolinToolDefinitions({
      vm: {} as never,
      mountPath: '/Users/ed/project',
      guestWorkspace: '/workspace',
    });

    expect(tools.map((tool) => tool.name)).toEqual([
      'read',
      'write',
      'edit',
      'bash',
      'ls',
      'find',
      'grep',
    ]);
  });
});

describe('provider error same-session retry helpers', () => {
  it('retries generic and transient provider diagnostics', () => {
    expect(shouldRetryProviderErrorMessage(null)).toBe(true);
    expect(shouldRetryProviderErrorMessage('provider returned 503')).toBe(true);
    expect(shouldRetryProviderErrorMessage('request timed out')).toBe(true);
    expect(shouldRetryProviderErrorMessage('EAI_AGAIN DNS lookup failed')).toBe(
      true,
    );
  });

  it('does not retry credential, billing, or model configuration failures', () => {
    expect(
      shouldRetryProviderErrorMessage('401 unauthorized: invalid api key'),
    ).toBe(false);
    expect(
      shouldRetryProviderErrorMessage('model pi-large is not available'),
    ).toBe(false);
    expect(shouldRetryProviderErrorMessage('insufficient_quota')).toBe(false);
  });

  it('computes capped exponential retry delays', () => {
    expect(computeProviderErrorRetryDelay(1, 2_000, 30_000)).toBe(2_000);
    expect(computeProviderErrorRetryDelay(2, 2_000, 30_000)).toBe(4_000);
    expect(computeProviderErrorRetryDelay(10, 2_000, 30_000)).toBe(30_000);
  });

  it('formats provider retry UI status and notifications', () => {
    const event = {
      event: 'provider_error_retry' as const,
      retry: 1,
      maxRetries: 2,
      delayMs: 1_500,
      reason: 'provider returned 503',
    };

    expect(formatProviderErrorRetryStatus(event)).toBe(
      'Provider retry 1/2 in 2s',
    );
    expect(formatProviderErrorRetryNotification(event)).toBe(
      'Provider error; retrying same Pi session (1/2).',
    );
  });

  it('notifies interactive UI adapters about provider retries', async () => {
    const setStatus = vi.fn();
    const notify = vi.fn();

    await notifyProviderErrorRetryUi(
      { hasUI: true, setStatus, notify },
      {
        event: 'provider_error_retry',
        retry: 1,
        maxRetries: 2,
        delayMs: 0,
        reason: 'provider returned 503',
      },
    );

    expect(setStatus).toHaveBeenCalledWith(
      'provider_retry',
      'Provider retry 1/2 in 0s',
    );
    expect(notify).toHaveBeenCalledWith(
      'Provider error; retrying same Pi session (1/2).',
      'warning',
    );
  });

  it('skips provider retry UI work for headless contexts', async () => {
    const setStatus = vi.fn();
    const notify = vi.fn();

    await notifyProviderErrorRetryUi(
      { hasUI: false, setStatus, notify },
      {
        event: 'provider_error_retry',
        retry: 1,
        maxRetries: 2,
        delayMs: 0,
        reason: 'provider returned 503',
      },
    );

    expect(setStatus).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('re-prompts the same session with a continuation after retryable provider metadata', async () => {
    const controller = new AbortController();
    const prompts: string[] = [];
    const retryEvents: unknown[] = [];
    let state: { llmAbort: boolean; llmErrorMessage: string | null } = {
      llmAbort: false,
      llmErrorMessage: null as string | null,
    };
    const session = {
      async prompt(text: string) {
        prompts.push(text);
        state =
          prompts.length === 1
            ? {
                llmAbort: true,
                llmErrorMessage: 'provider returned 503 unavailable',
              }
            : { llmAbort: false, llmErrorMessage: null };
      },
    };

    const result = await promptWithProviderErrorRetries({
      session,
      initialPrompt: 'do the task',
      cancelSignal: controller.signal,
      getProviderErrorState: () => state,
      maxRetries: 2,
      baseDelayMs: 0,
      maxDelayMs: 0,
      retryPrompt: 'Go on',
      onRetry: async (event) => {
        retryEvents.push(event);
      },
    });

    expect(result).toEqual({ runError: null, retryCount: 1 });
    expect(prompts).toEqual(['do the task', 'Go on']);
    expect(retryEvents).toHaveLength(1);
  });

  it('does not re-prompt for non-retryable provider configuration errors', async () => {
    const controller = new AbortController();
    const prompt = vi.fn(async () => {});

    const result = await promptWithProviderErrorRetries({
      session: { prompt },
      initialPrompt: 'do the task',
      cancelSignal: controller.signal,
      getProviderErrorState: () => ({
        llmAbort: true,
        llmErrorMessage: 'model pi-large is not available',
      }),
      maxRetries: 2,
      baseDelayMs: 0,
      maxDelayMs: 0,
      retryPrompt: 'Go on',
    });

    expect(result).toEqual({ runError: null, retryCount: 0 });
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it('surfaces thrown session.prompt failures without retrying', async () => {
    const controller = new AbortController();
    const promptErrors: string[] = [];

    const result = await promptWithProviderErrorRetries({
      session: {
        prompt: async () => {
          throw new Error('provider exploded before a turn');
        },
      },
      initialPrompt: 'do the task',
      cancelSignal: controller.signal,
      getProviderErrorState: () => ({
        llmAbort: false,
        llmErrorMessage: null,
      }),
      maxRetries: 2,
      baseDelayMs: 0,
      maxDelayMs: 0,
      retryPrompt: 'Go on',
      onPromptError: async (message) => {
        promptErrors.push(message);
      },
    });

    expect(result).toEqual({
      runError: {
        code: 'session_prompt_failed',
        message: 'provider exploded before a turn',
      },
      retryCount: 0,
    });
    expect(promptErrors).toEqual(['provider exploded before a turn']);
  });

  it('redacts and bounds provider retry reasons before task-message emission', async () => {
    const controller = new AbortController();
    const retryEvents: Array<{ reason: string }> = [];
    let state: { llmAbort: boolean; llmErrorMessage: string | null } = {
      llmAbort: true,
      llmErrorMessage:
        'provider 503 with token ghp_abcdefghijklmnopqrstuvwxyz ' +
        'x'.repeat(1_000),
    };
    const session = {
      async prompt() {
        if (retryEvents.length > 0) {
          state = { llmAbort: false, llmErrorMessage: null };
        }
      },
    };

    await promptWithProviderErrorRetries({
      session,
      initialPrompt: 'do the task',
      cancelSignal: controller.signal,
      getProviderErrorState: () => state,
      maxRetries: 1,
      baseDelayMs: 0,
      maxDelayMs: 0,
      retryPrompt: 'Go on',
      onRetry: async (event) => {
        retryEvents.push({ reason: event.reason });
      },
    });

    expect(retryEvents[0].reason).toContain('[redacted]');
    expect(retryEvents[0].reason).not.toContain(
      'ghp_abcdefghijklmnopqrstuvwxyz',
    );
    expect(retryEvents[0].reason.length).toBeLessThanOrEqual(500);
  });

  it('uses a generic provider retry reason when Pi omitted the diagnostic', () => {
    expect(sanitizeProviderErrorRetryReason(null)).toBe(
      'Pi turn ended with stopReason=error',
    );
  });
});

describe('makeSessionEventHandler (subscribe-handler characterization)', () => {
  type Ev = Parameters<ReturnType<typeof makeSessionEventHandler>>[0];

  function makeDeps(overrides?: {
    maxTurns?: number;
    maxBashTimeouts?: number;
  }) {
    const emitted: Array<{ kind: string; payload: Record<string, unknown> }> =
      [];
    const caps: Array<{ code: string; message: string }> = [];
    const state = createSessionTurnState();
    const usage = {
      provider: 'p',
      model: 'm',
      inputTokens: 0,
      outputTokens: 0,
    } as Parameters<typeof makeSessionEventHandler>[0]['usage'];
    const deps = {
      state,
      usage,
      maxTurns: overrides?.maxTurns ?? 0,
      maxBashTimeouts: overrides?.maxBashTimeouts ?? 3,
      emit: (kind: string, payload: Record<string, unknown>) => {
        emitted.push({ kind, payload });
        return Promise.resolve();
      },
      emitError: (
        phase: string,
        message: string,
        extra: Record<string, unknown> = {},
      ) => {
        emitted.push({ kind: 'error', payload: { phase, message, ...extra } });
        return Promise.resolve();
      },
      track: () => {},
      triggerCapAbort: (code: string, message: string) => {
        caps.push({ code, message });
      },
    } as Parameters<typeof makeSessionEventHandler>[0];
    return { deps, emitted, caps, state, usage };
  }

  function turnEnd(stopReason: string, extra?: Record<string, unknown>): Ev {
    return {
      type: 'turn_end',
      message: { role: 'assistant', stopReason, ...extra },
    } as unknown as Ev;
  }

  it('accumulates streamed assistant text', () => {
    const { deps, state } = makeDeps();
    const handler = makeSessionEventHandler(deps);
    handler({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'Hello ' },
    } as unknown as Ev);
    handler({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'world' },
    } as unknown as Ev);
    expect(state.assistantText).toBe('Hello world');
  });

  it('accumulates token usage from assistant turn_end events', () => {
    const { deps, usage } = makeDeps();
    const handler = makeSessionEventHandler(deps);
    handler(
      turnEnd('end_turn', {
        usage: { input: 10, output: 5, cacheRead: 3, cacheWrite: 2 },
      }),
    );
    handler(turnEnd('end_turn', { usage: { input: 1, output: 1 } }));
    expect(usage.inputTokens).toBe(11);
    expect(usage.outputTokens).toBe(6);
    expect(usage.cacheReadTokens).toBe(3);
    expect(usage.cacheWriteTokens).toBe(2);
  });

  it('applies last-turn-wins for the provider-error stop reason', () => {
    const { deps, state } = makeDeps();
    const handler = makeSessionEventHandler(deps);
    // An error turn sets the abort + diagnostic...
    handler(turnEnd('error', { errorMessage: 'model not found' }));
    expect(state.llmAbort).toBe(true);
    expect(state.llmErrorMessage).toBe('model not found');
    // ...a later clean turn (pi recovered) clears both.
    handler(turnEnd('end_turn'));
    expect(state.llmAbort).toBe(false);
    expect(state.llmErrorMessage).toBeNull();
  });

  it('counts only tool-use turns toward the max-turns cap', () => {
    const { deps, caps, state } = makeDeps({ maxTurns: 2 });
    const handler = makeSessionEventHandler(deps);
    handler(turnEnd('end_turn')); // text-only: not counted
    handler(turnEnd('aborted')); // not counted
    handler(turnEnd('error')); // not counted
    expect(state.toolUseTurnCount).toBe(0);
    handler(turnEnd('tool_use'));
    handler(turnEnd('tool_use'));
    expect(state.toolUseTurnCount).toBe(2);
    expect(caps).toEqual([
      {
        code: 'max_turns_exceeded',
        message: 'Aborted after 2 tool-use turns (cap 2).',
      },
    ]);
  });

  it('triggers the bash-timeout cap on repeated bash timeouts', () => {
    const { deps, caps, state } = makeDeps({ maxBashTimeouts: 2 });
    const handler = makeSessionEventHandler(deps);
    const timeout = {
      type: 'tool_execution_end',
      toolName: 'bash',
      isError: true,
      result: {
        content: [{ type: 'text', text: 'Command timed out after 30 seconds' }],
      },
    } as unknown as Ev;
    handler(timeout);
    expect(state.bashTimeoutCount).toBe(1);
    expect(caps).toHaveLength(0);
    handler(timeout);
    expect(state.bashTimeoutCount).toBe(2);
    expect(caps).toEqual([
      {
        code: 'max_bash_timeouts_exceeded',
        message: 'Aborted after 2 bash timeouts in this attempt (cap 2).',
      },
    ]);
  });
});

describe('submitRepromptStopped', () => {
  it('does not stop on a clean turn (all flags false)', () => {
    expect(
      submitRepromptStopped({
        cancelled: false,
        capAborted: false,
        llmAbort: false,
      }),
    ).toBe(false);
  });

  it('stops on cancel', () => {
    expect(
      submitRepromptStopped({
        cancelled: true,
        capAborted: false,
        llmAbort: false,
      }),
    ).toBe(true);
  });

  it('stops on cap-abort', () => {
    expect(
      submitRepromptStopped({
        cancelled: false,
        capAborted: true,
        llmAbort: false,
      }),
    ).toBe(true);
  });

  it('stops on a persisted provider error so it does not re-prompt a broken provider', () => {
    // A spent or non-retryable provider error leaves llmAbort set even though
    // promptWithProviderErrorRetries returns runError:null. Without this the
    // submit-missing loop would nudge a dead provider N more times.
    expect(
      submitRepromptStopped({
        cancelled: false,
        capAborted: false,
        llmAbort: true,
      }),
    ).toBe(true);
  });
});

describe('resolveSubmitMissingConfig', () => {
  function fakeHandle(opts: {
    captured?: Record<string, unknown> | null;
    exhausted?: { code: string; message: string } | null;
    toolName?: string;
  }) {
    return {
      toolName: opts.toolName ?? 'submit_freeform_output',
      getCaptured: () => opts.captured ?? null,
      getExhaustedValidationFailure: () => opts.exhausted ?? null,
    };
  }

  it('disables recovery when no submit tool is registered', () => {
    const config = resolveSubmitMissingConfig({ submitToolHandle: null });
    expect(config.maxSubmitMissingReprompts).toBe(0);
    expect(config.submitMissingPrompt).toBe('');
    expect(config.getSubmitState()).toBeNull();
  });

  it('defaults to 3 re-prompts and a tool-named prompt when a handle is present', () => {
    const config = resolveSubmitMissingConfig({
      submitToolHandle: fakeHandle({ toolName: 'submit_run_eval_output' }),
    });
    expect(config.maxSubmitMissingReprompts).toBe(3);
    expect(config.submitMissingPrompt).toContain('submit_run_eval_output');
  });

  it('honors explicit overrides for budget and prompt', () => {
    const config = resolveSubmitMissingConfig({
      submitToolHandle: fakeHandle({}),
      maxSubmitMissingReprompts: 1,
      submitMissingPrompt: 'custom nudge',
    });
    expect(config.maxSubmitMissingReprompts).toBe(1);
    expect(config.submitMissingPrompt).toBe('custom nudge');
  });

  it('maps captured/exhausted gate state off the handle', () => {
    const missing = resolveSubmitMissingConfig({
      submitToolHandle: fakeHandle({ captured: null, exhausted: null }),
    });
    expect(missing.getSubmitState()).toEqual({
      captured: false,
      exhausted: false,
    });

    const captured = resolveSubmitMissingConfig({
      submitToolHandle: fakeHandle({ captured: { summary: 'done' } }),
    });
    expect(captured.getSubmitState()).toEqual({
      captured: true,
      exhausted: false,
    });

    const exhausted = resolveSubmitMissingConfig({
      submitToolHandle: fakeHandle({
        exhausted: { code: 'output_validation_failed', message: 'spent' },
      }),
    });
    expect(exhausted.getSubmitState()).toEqual({
      captured: false,
      exhausted: true,
    });
  });
});

describe('buildSubmitMissingPrompt', () => {
  it('names the submit tool and demands a tool call over prose', () => {
    const prompt = buildSubmitMissingPrompt('submit_freeform_output');
    expect(prompt).toContain('submit_freeform_output');
    expect(prompt.toLowerCase()).toContain('did not call');
    expect(prompt.toLowerCase()).toContain('do not');
  });
});

describe('promptUntilSubmitted (submit-missing same-session recovery)', () => {
  function gateThatCapturesAfter(passes: number) {
    let calls = 0;
    return () => {
      // Reflect state AFTER each runPrompt: the gate is read once per loop
      // iteration following a prompt pass.
      calls += 1;
      return { captured: calls > passes, exhausted: false };
    };
  }

  it('re-prompts the same session when the model ends without a submit call', async () => {
    const prompts: string[] = [];
    const events: number[] = [];
    // Model ignores the first nudge, then submits on the second.
    const result = await promptUntilSubmitted({
      runPrompt: async (text) => {
        prompts.push(text);
        return { runError: null };
      },
      initialPrompt: 'do the task',
      submitMissingPrompt: 'call submit_freeform_output now',
      maxSubmitMissingReprompts: 3,
      getSubmitState: gateThatCapturesAfter(2),
      isStopped: () => false,
      onSubmitReprompt: (e) => {
        events.push(e.retry);
      },
    });

    expect(result).toEqual({ runError: null, submitReprompts: 2 });
    expect(prompts).toEqual([
      'do the task',
      'call submit_freeform_output now',
      'call submit_freeform_output now',
    ]);
    expect(events).toEqual([1, 2]);
  });

  it('does not re-prompt when the first pass already captured output', async () => {
    const prompts: string[] = [];
    const result = await promptUntilSubmitted({
      runPrompt: async (text) => {
        prompts.push(text);
        return { runError: null };
      },
      initialPrompt: 'do the task',
      submitMissingPrompt: 'call submit now',
      maxSubmitMissingReprompts: 3,
      getSubmitState: () => ({ captured: true, exhausted: false }),
      isStopped: () => false,
    });

    expect(result).toEqual({ runError: null, submitReprompts: 0 });
    expect(prompts).toEqual(['do the task']);
  });

  it('does not re-prompt once the invalid-args correction budget is exhausted', async () => {
    const prompts: string[] = [];
    const result = await promptUntilSubmitted({
      runPrompt: async (text) => {
        prompts.push(text);
        return { runError: null };
      },
      initialPrompt: 'do the task',
      submitMissingPrompt: 'call submit now',
      maxSubmitMissingReprompts: 3,
      getSubmitState: () => ({ captured: false, exhausted: true }),
      isStopped: () => false,
    });

    expect(result).toEqual({ runError: null, submitReprompts: 0 });
    expect(prompts).toEqual(['do the task']);
  });

  it('stops after the re-prompt budget and lets the caller fail submit-missing', async () => {
    const prompts: string[] = [];
    const result = await promptUntilSubmitted({
      runPrompt: async (text) => {
        prompts.push(text);
        return { runError: null };
      },
      initialPrompt: 'do the task',
      submitMissingPrompt: 'call submit now',
      maxSubmitMissingReprompts: 2,
      getSubmitState: () => ({ captured: false, exhausted: false }),
      isStopped: () => false,
    });

    expect(result).toEqual({ runError: null, submitReprompts: 2 });
    expect(prompts).toEqual([
      'do the task',
      'call submit now',
      'call submit now',
    ]);
  });

  it('propagates a provider runError from the initial pass without re-prompting', async () => {
    const prompts: string[] = [];
    const result = await promptUntilSubmitted({
      runPrompt: async (text) => {
        prompts.push(text);
        return {
          runError: { code: 'session_prompt_failed', message: 'boom' },
        };
      },
      initialPrompt: 'do the task',
      submitMissingPrompt: 'call submit now',
      maxSubmitMissingReprompts: 3,
      getSubmitState: () => ({ captured: false, exhausted: false }),
      isStopped: () => false,
    });

    expect(result).toEqual({
      runError: { code: 'session_prompt_failed', message: 'boom' },
      submitReprompts: 0,
    });
    expect(prompts).toEqual(['do the task']);
  });

  it('propagates a provider runError raised during a re-prompt pass', async () => {
    const prompts: string[] = [];
    const result = await promptUntilSubmitted({
      runPrompt: async (text) => {
        prompts.push(text);
        return prompts.length === 1
          ? { runError: null }
          : { runError: { code: 'session_prompt_failed', message: 'boom' } };
      },
      initialPrompt: 'do the task',
      submitMissingPrompt: 'call submit now',
      maxSubmitMissingReprompts: 3,
      getSubmitState: () => ({ captured: false, exhausted: false }),
      isStopped: () => false,
    });

    expect(result).toEqual({
      runError: { code: 'session_prompt_failed', message: 'boom' },
      submitReprompts: 1,
    });
    expect(prompts).toEqual(['do the task', 'call submit now']);
  });

  it('stops re-prompting when cancel or cap-abort intervenes', async () => {
    const prompts: string[] = [];
    const result = await promptUntilSubmitted({
      runPrompt: async (text) => {
        prompts.push(text);
        return { runError: null };
      },
      initialPrompt: 'do the task',
      submitMissingPrompt: 'call submit now',
      maxSubmitMissingReprompts: 3,
      getSubmitState: () => ({ captured: false, exhausted: false }),
      isStopped: () => true,
    });

    expect(result).toEqual({ runError: null, submitReprompts: 0 });
    expect(prompts).toEqual(['do the task']);
  });

  it('runs a single pass with no re-prompt when no submit tool is registered', async () => {
    const prompts: string[] = [];
    const result = await promptUntilSubmitted({
      runPrompt: async (text) => {
        prompts.push(text);
        return { runError: null };
      },
      initialPrompt: 'do the task',
      submitMissingPrompt: 'call submit now',
      maxSubmitMissingReprompts: 3,
      getSubmitState: () => null,
      isStopped: () => false,
    });

    expect(result).toEqual({ runError: null, submitReprompts: 0 });
    expect(prompts).toEqual(['do the task']);
  });
});

describe('openVmWorkspaceFileForRead', () => {
  it('opens VM workspace files as streams instead of buffering them', async () => {
    const stream = Readable.from(['artifact bytes']);
    const readFile = vi.fn();
    const readFileStream = vi.fn(async () => stream);
    const stat = vi.fn(async () => ({
      isFile: () => true,
      size: 14,
    }));

    const result = await openVmWorkspaceFileForRead({
      vm: { fs: { readFile, readFileStream, stat } } as never,
      cwdPath: '/host/workspace',
      guestWorkspace: '/guest/workspace',
      filePath: 'review.patch',
    });

    expect(stat).toHaveBeenCalledWith('/guest/workspace/review.patch');
    expect(readFileStream).toHaveBeenCalledWith(
      '/guest/workspace/review.patch',
    );
    expect(readFile).not.toHaveBeenCalled();
    expect(result).toEqual({
      stream,
      isFile: true,
      sizeBytes: 14,
      displayPath: 'review.patch',
    });
  });
});

describe('parseStructuredTaskOutput', () => {
  it('returns validated output and canonical CID for a valid task payload', async () => {
    const output = {
      branch: 'feat/tasks-api-output-validation',
      commits: [
        {
          sha: 'abcdef1',
          message: 'fix(tasks): validate output locally',
          diaryEntryId: '1851828e-b3a7-4130-a938-db6dd16477bd',
        },
      ],
      pullRequestUrl: null,
      diaryEntryIds: ['1851828e-b3a7-4130-a938-db6dd16477bd'],
      summary: 'Validated output before sending completion payloads.',
    };

    const result = await parseStructuredTaskOutput(
      JSON.stringify(output),
      'fulfill_brief',
    );

    expect(result).toEqual({
      output,
      outputCid: await computeJsonCid(output),
      error: null,
    });
  });

  it('returns a schema validation error for the wrong output shape', async () => {
    const result = await parseStructuredTaskOutput(
      JSON.stringify({
        branch: 123,
        commits: [],
        pullRequestUrl: null,
        diaryEntryIds: [],
      }),
      'fulfill_brief',
    );

    expect(result.output).toBeNull();
    expect(result.outputCid).toBeNull();
    expect(result.error).toEqual({
      code: 'output_validation_failed',
      message: expect.stringContaining('output/branch'),
    });
  });

  it('returns an unknown task type error when no schema is registered', async () => {
    const result = await parseStructuredTaskOutput(
      JSON.stringify({ anything: true }),
      'unknown_task_type',
    );

    expect(result.output).toBeNull();
    expect(result.outputCid).toBeNull();
    expect(result.error).toEqual({
      code: 'unknown_task_type',
      message: expect.stringContaining('Unknown task type'),
    });
  });

  it('enforces verification when the caller passes input.successCriteria', async () => {
    const result = await parseStructuredTaskOutput(
      JSON.stringify({
        response: 'done',
        totalTokens: 10,
        durationMs: 100,
        traceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01',
      }),
      'run_eval',
      {
        input: {
          scenario: { prompt: 'do it' },
          variantLabel: 'baseline',
          execution: { mode: 'vitro', workspace: 'none' },
          context: [],
          successCriteria: { version: 1 as const },
        },
      },
    );

    expect(result.output).toBeNull();
    expect(result.outputCid).toBeNull();
    expect(result.error).toEqual({
      code: 'output_validation_failed',
      message: expect.stringContaining('verification is required'),
    });
  });

  it('still accepts the same payload when no input is available', async () => {
    const output = {
      response: 'done',
      totalTokens: 10,
      durationMs: 100,
      traceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01',
    };

    const result = await parseStructuredTaskOutput(
      JSON.stringify(output),
      'run_eval',
    );

    expect(result).toEqual({
      output,
      outputCid: await computeJsonCid(output),
      error: null,
    });
  });
});

describe('agent_runtime.task_output.parse_result counter', () => {
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

  type DataPoint = {
    attributes: Record<string, unknown>;
    value: number;
  };
  type Snapshot = Record<TaskOutputParseCode, DataPoint[]>;

  async function snapshotByCode(): Promise<Snapshot> {
    const collected = await reader.snapshot();
    const out: Snapshot = {
      success: [],
      output_missing: [],
      output_validation_failed: [],
      unknown_task_type: [],
      output_cid_compute_failed: [],
      captured_via_tool: [],
    };
    for (const sm of collected.resourceMetrics.scopeMetrics) {
      for (const m of sm.metrics) {
        if (m.descriptor.name !== 'agent_runtime.task_output.parse_result') {
          continue;
        }
        for (const dp of m.dataPoints) {
          const code = dp.attributes.code as TaskOutputParseCode;
          out[code].push({
            attributes: { ...dp.attributes },
            value: dp.value as number,
          });
        }
      }
    }
    return out;
  }

  it('increments `success` with task_type + model labels on a valid payload', async () => {
    const output = {
      branch: 'feat/x',
      commits: [],
      pullRequestUrl: null,
      diaryEntryIds: [],
      summary: 's',
    };
    await parseStructuredTaskOutput(JSON.stringify(output), 'fulfill_brief', {
      model: 'claude-sonnet-4-6',
    });
    const snap = await snapshotByCode();
    expect(snap.success).toHaveLength(1);
    expect(snap.success[0].attributes).toMatchObject({
      task_type: 'fulfill_brief',
      model: 'claude-sonnet-4-6',
      code: 'success',
    });
    expect(snap.success[0].value).toBe(1);
  });

  it('increments `output_missing` when no JSON is present', async () => {
    await parseStructuredTaskOutput('ok done', 'fulfill_brief', {
      model: 'm',
    });
    const snap = await snapshotByCode();
    expect(snap.output_missing).toHaveLength(1);
    expect(snap.output_missing[0].attributes.code).toBe('output_missing');
  });

  it('increments `output_validation_failed` on schema mismatch', async () => {
    await parseStructuredTaskOutput(
      JSON.stringify({ branch: 123 }),
      'fulfill_brief',
      { model: 'm' },
    );
    const snap = await snapshotByCode();
    expect(snap.output_validation_failed).toHaveLength(1);
  });

  it('increments `unknown_task_type` when the type is not registered', async () => {
    await parseStructuredTaskOutput('{}', 'totally_made_up', { model: 'm' });
    const snap = await snapshotByCode();
    expect(snap.unknown_task_type).toHaveLength(1);
  });

  it('falls back to model="unknown" when the caller omits the label', async () => {
    await parseStructuredTaskOutput('not json', 'fulfill_brief');
    const snap = await snapshotByCode();
    expect(snap.output_missing[0].attributes.model).toBe('unknown');
  });

  it('exposes recordTaskOutputParseResult for the captured_via_tool path', async () => {
    recordTaskOutputParseResult({
      taskType: 'curate_pack',
      model: 'm',
      code: 'captured_via_tool',
    });
    const snap = await snapshotByCode();
    expect(snap.captured_via_tool).toHaveLength(1);
    expect(snap.captured_via_tool[0].attributes).toMatchObject({
      task_type: 'curate_pack',
      model: 'm',
      code: 'captured_via_tool',
    });
  });

  it('exposes recordTaskOutputParseResult for output_cid_compute_failed (captured-tool path)', async () => {
    // The captured-tool branch in executePiTask wraps computeJsonCid in
    // try/catch and records this code on throw. The full executor path
    // needs a VM to exercise; covering the counter label here protects
    // the contract — a typo in the executor's record() call would
    // surface as "code labelled wrong" in production dashboards
    // otherwise.
    recordTaskOutputParseResult({
      taskType: 'render_pack',
      model: 'm',
      code: 'output_cid_compute_failed',
    });
    const snap = await snapshotByCode();
    expect(snap.output_cid_compute_failed).toHaveLength(1);
    expect(snap.output_cid_compute_failed[0].attributes).toMatchObject({
      task_type: 'render_pack',
      model: 'm',
      code: 'output_cid_compute_failed',
    });
  });
});

describe('wireSessionAbort', () => {
  it('calls session.abort() once when cancelSignal fires after wiring', async () => {
    const ac = new AbortController();
    const abort = vi.fn().mockResolvedValue(undefined);
    const session = { abort };

    const listener = wireSessionAbort(ac.signal, session);

    expect(abort).not.toHaveBeenCalled();
    ac.abort();
    expect(abort).toHaveBeenCalledTimes(1);

    // Cleanup is the caller's job; verify the returned listener is
    // truthy so they have something to remove.
    expect(typeof listener).toBe('function');
  });

  it('fires session.abort() synchronously when the signal is already aborted at wiring time', () => {
    const ac = new AbortController();
    ac.abort();
    const abort = vi.fn().mockResolvedValue(undefined);

    wireSessionAbort(ac.signal, { abort });

    expect(abort).toHaveBeenCalledTimes(1);
  });

  it('does not double-call session.abort() if the listener fires twice', () => {
    // EventTarget enforces { once: true }, but a caller could also
    // invoke the returned listener manually (we do this in
    // executePiTask when the signal was already aborted at wiring).
    // Verify the internal guard prevents a duplicate call.
    const ac = new AbortController();
    const abort = vi.fn().mockResolvedValue(undefined);

    const listener = wireSessionAbort(ac.signal, { abort });
    listener();
    listener();
    ac.abort();

    expect(abort).toHaveBeenCalledTimes(1);
  });

  it('swallows session.abort() rejections without escaping the listener', async () => {
    const ac = new AbortController();
    const err = new Error('abort blew up');
    const abort = vi.fn().mockRejectedValue(err);

    wireSessionAbort(ac.signal, { abort });

    // The listener fires synchronously; the rejection is caught inside.
    // If this test's microtask cycle resolves without an unhandled
    // rejection, the swallow path works. Vitest will surface unhandled
    // rejections as test failures by default.
    ac.abort();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });
    expect(abort).toHaveBeenCalledTimes(1);
  });
});

describe('isBashTimeoutResult', () => {
  it('matches the pi structured tool-error shape verbatim', () => {
    // Stable wrapper string from @earendil-works/pi-coding-agent's
    // bash.js: `appendStatus(text, \`Command timed out after ${secs} seconds\`)`.
    // We match against the substring "Command timed out after" so a
    // bump in pi's wording (e.g. plural-vs-singular) keeps working.
    expect(
      isBashTimeoutResult({
        content: [
          {
            type: 'text',
            text: 'partial output before timeout\nCommand timed out after 120 seconds',
          },
        ],
      }),
    ).toBe(true);
  });

  it('matches a flat string fallback (defensive — pi flattens some results)', () => {
    expect(isBashTimeoutResult('Command timed out after 5 seconds')).toBe(true);
  });

  it('rejects a non-timeout bash error', () => {
    expect(
      isBashTimeoutResult({
        content: [
          { type: 'text', text: 'Command exited with code 1\nerror text' },
        ],
      }),
    ).toBe(false);
  });

  it('rejects an aborted-but-not-timed-out result', () => {
    expect(
      isBashTimeoutResult({
        content: [{ type: 'text', text: 'Command aborted' }],
      }),
    ).toBe(false);
  });

  it('handles missing or malformed result without throwing', () => {
    expect(isBashTimeoutResult(null)).toBe(false);
    expect(isBashTimeoutResult(undefined)).toBe(false);
    expect(isBashTimeoutResult({})).toBe(false);
    expect(isBashTimeoutResult({ content: null })).toBe(false);
    expect(isBashTimeoutResult({ content: [{}] })).toBe(false);
    expect(isBashTimeoutResult({ content: [{ text: 42 }] })).toBe(false);
    expect(isBashTimeoutResult(42)).toBe(false);
  });

  it('matches even when the timeout text is not at start of message', () => {
    // Real pi output puts captured stdout BEFORE the appendStatus suffix.
    expect(
      isBashTimeoutResult({
        content: [
          {
            type: 'text',
            text: 'lots of build output...\n\nCommand timed out after 240 seconds',
          },
        ],
      }),
    ).toBe(true);
  });
});

describe('describeToolErrorMessage', () => {
  it('prefers the first text chunk in a structured tool error', () => {
    expect(
      describeToolErrorMessage({
        content: [
          { type: 'text', text: 'gitdir missing from guest workspace' },
          { type: 'text', text: 'secondary context' },
        ],
      }),
    ).toBe('gitdir missing from guest workspace');
  });

  it('falls back to a trimmed string payload', () => {
    expect(describeToolErrorMessage('  Command exited with code 1  ')).toBe(
      'Command exited with code 1',
    );
  });

  it('serializes unknown structured results safely', () => {
    expect(describeToolErrorMessage({ ok: false, code: 128 })).toContain(
      '"code":128',
    );
  });
});

describe('shouldEmitToolCallError', () => {
  it('suppresses tool_call_error for bash subprocess non-zero exits', () => {
    // Bash returning isError=true on a non-zero exit is the discovery loop
    // doing its job (probe for absent tool, observe exit 127). Don't pollute
    // the message stream with spurious error events.
    expect(shouldEmitToolCallError({ toolName: 'bash', isError: true })).toBe(
      false,
    );
  });

  it('preserves tool_call_error for non-bash tool failures', () => {
    // MCP/transport/runtime failures stay as kind:"error" so consumers can
    // actually see when the runtime breaks.
    expect(
      shouldEmitToolCallError({
        toolName: 'moltnet_get_task',
        isError: true,
      }),
    ).toBe(true);
  });

  it('emits nothing when the tool call succeeded', () => {
    expect(shouldEmitToolCallError({ toolName: 'bash', isError: false })).toBe(
      false,
    );
    expect(
      shouldEmitToolCallError({
        toolName: 'moltnet_get_task',
        isError: false,
      }),
    ).toBe(false);
  });
});
