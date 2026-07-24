import { describe, expect, it } from 'vitest';

import {
  VERIFICATION_METHOD,
  VERIFICATION_METHOD_VALUES,
} from '../src/verification-method.js';

describe('verification methods', () => {
  it('preserves the persisted Phase 0 identifiers', () => {
    expect(VERIFICATION_METHOD.AgentEd25519).toBe('agent-ed25519');
    expect(VERIFICATION_METHOD.HumanHardwarePreviewSign).toBe(
      'human-hardware-previewsign',
    );
    expect(VERIFICATION_METHOD_VALUES).toEqual(
      expect.arrayContaining(['agent-ed25519', 'human-hardware-previewsign']),
    );
    expect(new Set(VERIFICATION_METHOD_VALUES).size).toBe(
      VERIFICATION_METHOD_VALUES.length,
    );
  });
});
