import { Value } from 'typebox/value';
import { describe, expect, it } from 'vitest';

import {
  CALLER_AUTHORED_PREFIXES,
  classifyRenderMethod,
  DEFAULT_AGENT_RENDER_METHOD,
  DEFAULT_PI_RENDER_METHOD,
  DEFAULT_SERVER_RENDER_METHOD,
  isServerRenderMethod,
  RenderMethodSchema,
  SERVER_RENDER_PREFIX,
} from '../src/render-method.js';

describe('render method convention', () => {
  it('keeps the defaults consistent with their prefixes', () => {
    expect(DEFAULT_SERVER_RENDER_METHOD.startsWith(SERVER_RENDER_PREFIX)).toBe(
      true,
    );
    expect(classifyRenderMethod(DEFAULT_AGENT_RENDER_METHOD)).toBe(
      'caller-authored',
    );
    expect(classifyRenderMethod(DEFAULT_PI_RENDER_METHOD)).toBe(
      'caller-authored',
    );
    expect(CALLER_AUTHORED_PREFIXES).not.toContain(SERVER_RENDER_PREFIX);
  });

  it.each([
    ['server:pack-to-docs-v1', 'server'],
    ['agent:pack-to-docs-v1', 'caller-authored'],
    ['pi:pack-to-docs-v1', 'caller-authored'],
    ['agent-refined', 'caller-authored'],
    ['agent-refined-v2', 'caller-authored'],
    ['pack-to-docs-v1', 'unrecognised'],
    ['homegrown', 'unrecognised'],
    ['', 'unrecognised'],
    ['SERVER:pack-to-docs-v1', 'unrecognised'],
  ] as const)('classifies %s as %s', (method, kind) => {
    expect(classifyRenderMethod(method)).toBe(kind);
  });

  it('bifurcates only on the server prefix, like the service does', () => {
    expect(isServerRenderMethod('server:pack-to-docs-v1')).toBe(true);
    expect(isServerRenderMethod('server:anything-else')).toBe(true);
    expect(isServerRenderMethod('agent:pack-to-docs-v1')).toBe(false);
    expect(isServerRenderMethod('pack-to-docs-v1')).toBe(false);
  });

  describe('RenderMethodSchema', () => {
    // Every value observed in production data plus the live code defaults
    // (issue #1857 ground truth) must pass unchanged.
    it.each([
      'server:pack-to-docs-v1',
      'agent:pack-to-docs-v1',
      'pi:pack-to-docs-v1',
      'agent-refined',
      'agent-refined-v2',
    ])('accepts %s', (method) => {
      expect(Value.Check(RenderMethodSchema, method)).toBe(true);
    });

    it.each([
      '',
      'server:',
      'agent:',
      'pi:',
      'agent-',
      'pack-to-docs-v1',
      'homegrown',
      'server: spaced',
      'server:pack-to-docs-v1\n',
      `server:${'x'.repeat(100)}`,
    ])('rejects %j', (method) => {
      expect(Value.Check(RenderMethodSchema, method)).toBe(false);
    });

    it('rejects a bare prefix even though classify recognises it', () => {
      // Classification is lenient by design (it reads stored rows);
      // the write-side schema is strict.
      expect(classifyRenderMethod('server:')).toBe('server');
      expect(Value.Check(RenderMethodSchema, 'server:')).toBe(false);
    });
  });
});
