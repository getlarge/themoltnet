/**
 * Focused tests for the final-output parsing helpers. The rest of
 * `executePiTask` needs a booted Gondolin VM and is covered by the
 * integration demo.
 */
import { computeJsonCid } from '@moltnet/crypto-service';
import { describe, expect, it } from 'vitest';

// Re-export of a private helper for testing. We reach into the compiled
// module via a named import added specifically for this test surface.
import { __testables } from './execute-pi-task.js';

const { extractJsonObject, parseStructuredTaskOutput } = __testables;

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
          diary_entry_id: '1851828e-b3a7-4130-a938-db6dd16477bd',
        },
      ],
      pull_request_url: null,
      diary_entry_ids: ['1851828e-b3a7-4130-a938-db6dd16477bd'],
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
        pull_request_url: null,
        diary_entry_ids: [],
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
