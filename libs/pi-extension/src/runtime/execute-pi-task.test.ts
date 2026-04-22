/**
 * Focused tests for `extractJsonObject` — the parser that recovers the
 * agent's final structured output from a stream of chat text. The rest of
 * `executePiTask` needs a booted Gondolin VM and is covered by the
 * integration demo.
 */
import { describe, expect, it } from 'vitest';

// Re-export of a private helper for testing. We reach into the compiled
// module via a named import added specifically for this test surface.
import { __testables } from './execute-pi-task.js';

const { extractJsonObject } = __testables;

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
