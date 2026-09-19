import { describe, expect, it } from 'vitest';

import { applyNativeClientGrant } from './native-grant.js';
import {
  NATIVE_CLIENT_ORIGIN,
  NativeGrantService,
} from './native-grant-service.js';

/** Shaped like what the supervisor generates: 32 bytes, base64url (43 chars). */
const SUPERVISOR_TOKEN = 'qN7dK2xR9vL4mZ8wP1sT6yB3cF5gH0jA2eU4iO7kM9Q';

describe('applyNativeClientGrant', () => {
  it('grants the native origin when the supervisor supplied a token', () => {
    // Arrange
    const pairing = new NativeGrantService();
    const env: NodeJS.ProcessEnv = {
      MOLTNET_AGENT_SERVER_NATIVE_TOKEN: SUPERVISOR_TOKEN,
    };

    // Act
    const granted = applyNativeClientGrant({ pairing, env });

    // Assert
    expect(granted).toBe(true);
    expect(() =>
      pairing.verify(NATIVE_CLIENT_ORIGIN, SUPERVISOR_TOKEN),
    ).not.toThrow();
  });

  it('removes the token from the environment so run children cannot inherit it', () => {
    // A spawned daemon run inherits this process environment. Leaving the
    // token there would hand every task-executing agent control of the Agent
    // Server that supervises it.
    const pairing = new NativeGrantService();
    const env: NodeJS.ProcessEnv = {
      MOLTNET_AGENT_SERVER_NATIVE_TOKEN: SUPERVISOR_TOKEN,
      PATH: '/usr/bin',
    };

    applyNativeClientGrant({ pairing, env });

    expect(env['MOLTNET_AGENT_SERVER_NATIVE_TOKEN']).toBeUndefined();
    expect('MOLTNET_AGENT_SERVER_NATIVE_TOKEN' in env).toBe(false);
    expect(env['PATH']).toBe('/usr/bin');
  });

  it('grants nothing when the variable is absent', () => {
    // Arrange
    const pairing = new NativeGrantService();

    // Act
    const granted = applyNativeClientGrant({ pairing, env: {} });

    // Assert
    expect(granted).toBe(false);
    expect(() => pairing.verify(NATIVE_CLIENT_ORIGIN, 'anything')).toThrow();
  });

  it('grants nothing when the variable is empty', () => {
    // Arrange
    const pairing = new NativeGrantService();
    const env: NodeJS.ProcessEnv = { MOLTNET_AGENT_SERVER_NATIVE_TOKEN: '' };

    // Act
    const granted = applyNativeClientGrant({ pairing, env });

    // Assert
    expect(granted).toBe(false);
    expect(env['MOLTNET_AGENT_SERVER_NATIVE_TOKEN']).toBeUndefined();
  });

  it('rejects a token too short to resist guessing', () => {
    // Arrange
    const pairing = new NativeGrantService();
    const env: NodeJS.ProcessEnv = {
      MOLTNET_AGENT_SERVER_NATIVE_TOKEN: 'short',
    };

    // Act / Assert
    expect(() => applyNativeClientGrant({ pairing, env })).toThrow(
      /at least 32 characters/u,
    );
    expect(env['MOLTNET_AGENT_SERVER_NATIVE_TOKEN']).toBeUndefined();
  });
});
