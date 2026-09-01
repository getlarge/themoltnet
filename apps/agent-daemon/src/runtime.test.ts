import { describe, expect, it, vi } from 'vitest';

import {
  registerRuntimeExecutionOffer,
  runtimeExecutionOffer,
} from './lib/runtime-governance.js';
import {
  assertRuntimeAdapterSupportsProfile,
  type DaemonRuntimeAdapter,
  type PreparedDaemonRuntime,
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

describe('private runtime governance metadata', () => {
  it('keeps portable offers off the published runtime adapter contract', () => {
    const prepared = {} as PreparedDaemonRuntime;
    const offer = {
      executor: { id: 'runtime', fingerprint: 'sha256:executor' },
      controls: [],
    };

    expect(runtimeExecutionOffer(prepared, 'sha256:executor')).toBeUndefined();

    registerRuntimeExecutionOffer(prepared, () => offer);

    expect(runtimeExecutionOffer(prepared, 'sha256:executor')).toBe(offer);
  });
});
