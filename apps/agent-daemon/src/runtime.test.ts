import { describe, expect, it, vi } from 'vitest';

import {
  assertRuntimeAdapterSupportsProfile,
  type DaemonRuntimeAdapter,
} from './runtime.js';

describe('assertRuntimeAdapterSupportsProfile', () => {
  const adapter: DaemonRuntimeAdapter = {
    runtimeKind: 'custom_pi',
    prepare: vi.fn(),
  };

  it('accepts a matching operator-owned runtime', () => {
    expect(() =>
      assertRuntimeAdapterSupportsProfile(adapter, {
        id: 'profile-1',
        runtimeKind: 'custom_pi',
      }),
    ).not.toThrow();
  });

  it('rejects a profile intended for another runtime', () => {
    expect(() =>
      assertRuntimeAdapterSupportsProfile(adapter, {
        id: 'profile-1',
        runtimeKind: 'other_runtime',
      }),
    ).toThrow(
      'Runtime profile profile-1 requires "other_runtime", but this daemon adapter provides "custom_pi".',
    );
  });
});
