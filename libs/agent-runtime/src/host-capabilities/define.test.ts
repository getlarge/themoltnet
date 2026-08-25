import { Type } from 'typebox';
import { describe, expect, it } from 'vitest';

import { capabilityOrigin, defineHostCapability } from './define.js';

const op = {
  request: Type.Object({ a: Type.String() }),
  response: Type.Object({}),
  handle: () => Promise.resolve({}),
  evidence: () => ({}),
};

describe('defineHostCapability', () => {
  it('derives the origin and freezes the contribution', () => {
    const c = defineHostCapability({
      name: 'agent-signing',
      operations: { 'sign-git-commit': op },
    });
    expect(c.kind).toBe('host_capability');
    expect(c.origin).toBe('https://agent-signing.moltnet.internal');
    expect(capabilityOrigin('x-y')).toBe('https://x-y.moltnet.internal');
    expect(Object.isFrozen(c)).toBe(true);
    expect(Object.isFrozen(c.operations)).toBe(true);
    expect(Object.isFrozen(c.operations['sign-git-commit'])).toBe(true);
    expect(Object.isFrozen(c.operations['sign-git-commit']!.request)).toBe(
      true,
    );
  });

  it.each(['Agent', 'a', '-bad', 'with/slash', 'x'.repeat(64)])(
    'rejects name %s',
    (name) => {
      expect(() => defineHostCapability({ name, operations: { op } })).toThrow(
        /capability name/,
      );
    },
  );

  it('rejects operation names with slashes and the reserved identity operation', () => {
    expect(() =>
      defineHostCapability({ name: 'ok', operations: { 'sign/git': op } }),
    ).toThrow(/operation name/);
    expect(() =>
      defineHostCapability({ name: 'ok', operations: { identity: op } }),
    ).toThrow(/reserved/);
  });

  it('content-addresses the value-free descriptor and validates guest paths', () => {
    const base = {
      name: 'desc',
      operations: { op: { ...op, maxBodyBytes: 100 } },
      guest: {
        files: [
          { path: '/home/agent/a', mode: 0o600, content: () => 'secret-1' },
        ],
        services: [
          { id: 'svc', command: ['x'], readiness: { path: '/run/x' } },
        ],
      },
    };
    const one = defineHostCapability(base);
    const sameProtocolOtherContent = defineHostCapability({
      ...base,
      guest: {
        ...base.guest,
        files: [{ ...base.guest.files[0], content: () => 'secret-2' }],
      },
    });
    const otherLimit = defineHostCapability({
      ...base,
      operations: { op: { ...op, maxBodyBytes: 101 } },
    });
    expect(one.descriptorCid).toMatch(/^bafkrei/);
    expect(sameProtocolOtherContent.descriptorCid).toBe(one.descriptorCid);
    expect(otherLimit.descriptorCid).not.toBe(one.descriptorCid);
    expect(() =>
      defineHostCapability({
        ...base,
        guest: { files: [{ path: 'relative', content: () => '' }] },
      }),
    ).toThrow(/absolute/);
    expect(() =>
      defineHostCapability({
        ...base,
        guest: { files: [{ path: '/home/../etc/x', content: () => '' }] },
      }),
    ).toThrow(/traverse/);
    expect(() =>
      defineHostCapability({
        ...base,
        guest: { services: [{ id: '../x', command: ['x'] }] },
      }),
    ).toThrow(/service id/);
  });

  it('rejects an empty operation table', () => {
    expect(() => defineHostCapability({ name: 'ok', operations: {} })).toThrow(
      /at least one operation/,
    );
  });
});
