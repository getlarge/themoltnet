/**
 * Focused tests for the final-output parsing helpers and the
 * cancellation-wiring helper. The full `executePiTask` flow needs a
 * booted Gondolin VM and is covered by the integration demo / a future
 * e2e once we have one that exercises pi against a real task type.
 */
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
  isBashTimeoutResult,
  resolveTaskWorkspaceId,
  resolveTaskWorktreeBranch,
  slugifyBranchComponent,
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

describe('resolveTaskWorktreeBranch', () => {
  it('uses the correlationId branch shape for fulfill_brief', () => {
    expect(
      resolveTaskWorktreeBranch({
        id: '11111111-2222-4333-8444-555555555555',
        taskType: 'fulfill_brief',
        correlationId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        input: {
          brief: 'Implement rendered pack creator support',
          title: 'Rendered Pack Creator',
        },
      }),
    ).toBe(
      'moltnet/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/rendered-pack-creator',
    );
  });

  it('falls back to a feat branch when fulfill_brief has no correlationId', () => {
    expect(
      resolveTaskWorktreeBranch({
        id: '11111111-2222-4333-8444-555555555555',
        taskType: 'fulfill_brief',
        correlationId: null,
        input: {
          brief: 'Implement rendered pack creator support',
          title: 'Rendered Pack Creator',
          scopeHint: 'agent-runtime',
        },
      }),
    ).toBe('feat/agent-runtime-rendered-pack-creator');
  });

  it('returns null for shared-mount task types', () => {
    expect(
      resolveTaskWorktreeBranch({
        id: '11111111-2222-4333-8444-555555555555',
        taskType: 'judge_pack',
        correlationId: null,
        input: {},
      }),
    ).toBeNull();
  });

  it('creates a disposable task branch for assess_brief', () => {
    expect(
      resolveTaskWorktreeBranch({
        id: '11111111-2222-4333-8444-555555555555',
        taskType: 'assess_brief',
        correlationId: null,
        input: {},
      }),
    ).toBe('task/assess-brief-11111111');
  });
});

describe('resolveTaskWorkspaceId', () => {
  it('uses a stable session-scoped worktree id when the daemon provides a session key', () => {
    expect(
      resolveTaskWorkspaceId(
        { id: '11111111-2222-4333-8444-555555555555' },
        {
          sessionKey:
            'fulfill_brief:correlation:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
          workspaceScope: 'session',
          sessionPersistence: { sessionDir: '/tmp/pi-sessions/example' },
        },
      ),
    ).toBe(
      'session-fulfill_brief%3Acorrelation%3Aaaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    );
  });

  it('falls back to attempt-scoped task ids without a reusable session key', () => {
    expect(
      resolveTaskWorkspaceId(
        { id: '11111111-2222-4333-8444-555555555555' },
        null,
      ),
    ).toBe('task-11111111-2222-4333-8444-555555555555');
  });
});

describe('slugifyBranchComponent', () => {
  it('normalizes punctuation and trims trailing separators', () => {
    expect(slugifyBranchComponent(' Rendered Pack Creator!!! ')).toBe(
      'rendered-pack-creator',
    );
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
