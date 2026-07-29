import { describe, expect, it } from 'vitest';

import {
  assertRuntimeCapabilityManifest,
  findUnavailableRuntimeCapabilities,
  GONDOLIN_PI_CAPABILITY_MANIFEST,
} from '../src/runtime-capabilities.js';

describe('runtime capability manifest', () => {
  it('is versioned, sorted, and duplicate-free', () => {
    expect(GONDOLIN_PI_CAPABILITY_MANIFEST.version).toBe('gondolin_pi:v1');
    expect(GONDOLIN_PI_CAPABILITY_MANIFEST.capabilities).toEqual(
      [...new Set(GONDOLIN_PI_CAPABILITY_MANIFEST.capabilities)].sort(),
    );
  });

  it('reports unavailable capabilities deterministically', () => {
    expect(
      findUnavailableRuntimeCapabilities('gondolin_pi', [
        'read',
        'unknown_z',
        'unknown_a',
        'unknown_z',
      ]),
    ).toEqual(['unknown_a', 'unknown_z']);
  });

  it('rejects a registration or version outside the manifest', () => {
    expect(() =>
      assertRuntimeCapabilityManifest('gondolin_pi', 'gondolin_pi:v0', [
        'read',
      ]),
    ).toThrow(/manifest mismatch/);
    expect(() =>
      assertRuntimeCapabilityManifest(
        'gondolin_pi',
        GONDOLIN_PI_CAPABILITY_MANIFEST.version,
        ['undeclared_tool'],
      ),
    ).toThrow(/undeclared_tool/);
  });
});
