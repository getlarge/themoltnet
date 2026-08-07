import { describe, expect, it } from 'vitest';

import { firstUsefulTaskEvent } from './task-readiness.js';

describe('firstUsefulTaskEvent', () => {
  it('ignores lifecycle events and empty model deltas', () => {
    expect(
      firstUsefulTaskEvent([
        { kind: 'info', payload: { event: 'execute_start' } },
        { kind: 'text_delta', payload: { delta: '  \n' } },
        { kind: 'text_delta', payload: { delta: 'hello' } },
      ]),
    ).toEqual({ index: 2, kind: 'text_delta' });
  });

  it('accepts a tool call even when the provider omits its name', () => {
    expect(
      firstUsefulTaskEvent([{ kind: 'tool_call_start', payload: {} }]),
    ).toEqual({ index: 0, kind: 'tool_call_start' });
  });

  it('returns null when no useful event is present', () => {
    expect(
      firstUsefulTaskEvent([
        { kind: 'turn_end', payload: { stop_reason: 'error' } },
        { kind: 'error', payload: { message: 'provider unavailable' } },
      ]),
    ).toBeNull();
  });
});
