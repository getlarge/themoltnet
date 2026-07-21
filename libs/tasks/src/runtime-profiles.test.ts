import { Value } from 'typebox/value';
import { describe, expect, it } from 'vitest';

import { RuntimeProfileSandbox } from './runtime-profiles.js';

describe('RuntimeProfileSandbox network policy', () => {
  it('accepts exact hosts and leading wildcard hosts', () => {
    // Arrange
    const sandbox = {
      network: {
        allowedHosts: ['onboard-api.internal', '*.example.com', '127.0.0.1'],
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
  ])('rejects malformed runtime host %s', (host) => {
    // Arrange
    const sandbox = { network: { allowedHosts: [host] } };

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
});
