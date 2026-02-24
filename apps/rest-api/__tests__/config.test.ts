import { describe, expect, it } from 'vitest';

import { loadSecurityConfig } from '../src/config.js';

describe('SecurityConfig — LeGreffier fields', () => {
  it('defaults RATE_LIMIT_LEGREFFIER_START to 3', () => {
    const config = loadSecurityConfig({});
    expect(config.RATE_LIMIT_LEGREFFIER_START).toBe(3);
  });

  it('accepts SPONSOR_AGENT_ID as UUID string', () => {
    const config = loadSecurityConfig({
      SPONSOR_AGENT_ID: '00000000-0000-0000-0000-000000000001',
    });
    expect(config.SPONSOR_AGENT_ID).toBe(
      '00000000-0000-0000-0000-000000000001',
    );
  });

  it('leaves SPONSOR_AGENT_ID undefined when not set', () => {
    const config = loadSecurityConfig({});
    expect(config.SPONSOR_AGENT_ID).toBeUndefined();
  });
});
