/**
 * Focused tests for the final-output parsing helpers and the
 * cancellation-wiring helper. The full `executePiTask` flow needs a
 * booted Gondolin VM and is covered by the integration demo / a future
 * e2e once we have one that exercises pi against a real task type.
 */
import { computeJsonCid } from '@moltnet/crypto-service';
import { describe, expect, it, vi } from 'vitest';

import { wireSessionAbort } from './execute-pi-task.js';
import { extractJsonObject, parseStructuredTaskOutput } from './task-output.js';

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
