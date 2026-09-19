import { describe, expect, it } from 'vitest';

import {
  AgentServerPairingError,
  NATIVE_CLIENT_ORIGIN,
  PairingService,
} from './pairing.js';

describe('native client grant', () => {
  it('authorizes the native origin with the supervisor-supplied token', () => {
    // Arrange
    const pairing = new PairingService();

    // Act
    pairing.grantNative('native-token-value');

    // Assert
    expect(() =>
      pairing.verify(NATIVE_CLIENT_ORIGIN, 'native-token-value'),
    ).not.toThrow();
  });

  it('rejects a wrong token on the native origin', () => {
    // Arrange
    const pairing = new PairingService();
    pairing.grantNative('native-token-value');

    // Act / Assert
    expect(() => pairing.verify(NATIVE_CLIENT_ORIGIN, 'guessed')).toThrow(
      AgentServerPairingError,
    );
  });

  it('does not authorize a browser origin with the native token', () => {
    // Arrange
    const pairing = new PairingService();
    pairing.grantNative('native-token-value');

    // Act / Assert
    expect(() =>
      pairing.verify('https://console.themolt.net', 'native-token-value'),
    ).toThrow(AgentServerPairingError);
  });

  it('refuses to start a browser pairing for the native origin', () => {
    // A web page must never be able to pair as the native client, which would
    // let it inherit the desktop app's authority.
    const pairing = new PairingService();

    expect(() => pairing.start(NATIVE_CLIENT_ORIGIN)).toThrow(
      AgentServerPairingError,
    );
  });

  it('leaves the native origin unauthorized when no grant was issued', () => {
    // Arrange
    const pairing = new PairingService();

    // Act / Assert
    expect(() => pairing.verify(NATIVE_CLIENT_ORIGIN, 'anything')).toThrow(
      AgentServerPairingError,
    );
  });

  it('replaces a previous native grant so an old token stops working', () => {
    // Arrange
    const pairing = new PairingService();
    pairing.grantNative('first-token');

    // Act
    pairing.grantNative('second-token');

    // Assert
    expect(() => pairing.verify(NATIVE_CLIENT_ORIGIN, 'first-token')).toThrow(
      AgentServerPairingError,
    );
    expect(() =>
      pairing.verify(NATIVE_CLIENT_ORIGIN, 'second-token'),
    ).not.toThrow();
  });

  it('rejects an empty native token instead of granting open access', () => {
    // Arrange
    const pairing = new PairingService();

    // Act / Assert
    expect(() => pairing.grantNative('')).toThrow(AgentServerPairingError);
  });

  it('keeps browser pairing working alongside a native grant', () => {
    // Arrange
    const pairing = new PairingService();
    pairing.grantNative('native-token-value');
    const origin = 'https://console.themolt.net';
    const { pairingId } = pairing.start(origin);
    const { confirmToken } = pairing.approval(pairingId);
    pairing.confirm(pairingId, confirmToken);

    // Act
    const { token } = pairing.claim(pairingId, origin);

    // Assert
    expect(() => pairing.verify(origin, token)).not.toThrow();
    expect(() =>
      pairing.verify(NATIVE_CLIENT_ORIGIN, 'native-token-value'),
    ).not.toThrow();
  });
});
