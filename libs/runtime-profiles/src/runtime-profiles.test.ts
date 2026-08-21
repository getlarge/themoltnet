import { Value } from 'typebox/value';
import { describe, expect, it } from 'vitest';

import { RuntimeProfileSandbox } from './runtime-profiles.js';

describe('RuntimeProfileSandbox network policy', () => {
  it('accepts exact and wildcard hosts in both runtime allowlists', () => {
    // Arrange
    const sandbox = {
      network: {
        allowedHosts: ['api.example.com', '*.example.com'],
        allowedInternalHosts: ['onboard-api.internal', '127.0.0.1'],
      },
    };

    // Act
    const valid = Value.Check(RuntimeProfileSandbox, sandbox);

    // Assert
    expect(valid).toBe(true);
  });

  it.each([
    'https://example.com',
    'example.com:443',
    'example.com/path',
    'bad host.example',
    '*',
    '-bad.example',
    'bad-.example',
  ])('rejects malformed ordinary runtime host %s', (host) => {
    // Arrange
    const sandbox = { network: { allowedHosts: [host] } };

    // Act
    const valid = Value.Check(RuntimeProfileSandbox, sandbox);

    // Assert
    expect(valid).toBe(false);
  });

  it.each([
    'https://internal.example.com',
    'internal.example.com:8443',
    'internal.example.com/path',
    'bad internal.example',
    '*',
  ])('rejects malformed internal runtime host %s', (host) => {
    // Arrange
    const sandbox = { network: { allowedInternalHosts: [host] } };

    // Act
    const valid = Value.Check(RuntimeProfileSandbox, sandbox);

    // Assert
    expect(valid).toBe(false);
  });

  it('rejects more than 50 runtime hosts', () => {
    // Arrange
    const sandbox = {
      network: {
        allowedHosts: Array.from(
          { length: 51 },
          (_, index) => `host-${index}.example.com`,
        ),
      },
    };

    // Act
    const valid = Value.Check(RuntimeProfileSandbox, sandbox);

    // Assert
    expect(valid).toBe(false);
  });

  it('rejects more than 50 internal runtime hosts', () => {
    // Arrange
    const sandbox = {
      network: {
        allowedInternalHosts: Array.from(
          { length: 51 },
          (_, index) => `internal-${index}.example.com`,
        ),
      },
    };

    // Act
    const valid = Value.Check(RuntimeProfileSandbox, sandbox);

    // Assert
    expect(valid).toBe(false);
  });

  it('rejects runtime hosts longer than 255 characters', () => {
    // Arrange
    const sandbox = {
      network: { allowedHosts: [`${'a'.repeat(252)}.com`] },
    };

    // Act
    const valid = Value.Check(RuntimeProfileSandbox, sandbox);

    // Assert
    expect(valid).toBe(false);
  });

  it('rejects internal runtime hosts longer than 255 characters', () => {
    // Arrange
    const sandbox = {
      network: { allowedInternalHosts: [`${'a'.repeat(252)}.com`] },
    };

    // Act
    const valid = Value.Check(RuntimeProfileSandbox, sandbox);

    // Assert
    expect(valid).toBe(false);
  });
});
