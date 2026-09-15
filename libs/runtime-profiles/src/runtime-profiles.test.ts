import { Value } from 'typebox/value';
import { describe, expect, it } from 'vitest';

import {
  RuntimeProfile,
  runtimeProfileDefinitionPayload,
  RuntimeProfileSandbox,
} from './runtime-profiles.js';

describe('RuntimeProfile contract', () => {
  it('excludes local runtime-operation and storage fields', () => {
    expect(
      (RuntimeProfile as unknown as { additionalProperties: boolean })
        .additionalProperties,
    ).toBe(false);
    for (const field of [
      'heartbeatIntervalMs',
      'leaseTtlSec',
      'maxBatchSize',
      'sessionStorageMode',
      'workspaceStorageMode',
      'sessionTtlSec',
      'workspaceTtlSec',
    ]) {
      expect(RuntimeProfile.properties).not.toHaveProperty(field);
    }
  });

  it('hashes only the reduced behavioral definition', () => {
    const payload = runtimeProfileDefinitionPayload({
      name: 'reviewer',
      provider: 'Anthropic',
      model: 'Claude-Sonnet-4-5',
      sandbox: {},
      maxTurns: 20,
      maxBashTimeouts: 2,
      toolEnforcement: 'enforce',
      heartbeatIntervalMs: 1,
      leaseTtlSec: 2,
    } as Parameters<typeof runtimeProfileDefinitionPayload>[0] &
      Record<string, unknown>);

    expect(payload).toMatchObject({
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      maxTurns: 20,
      maxBashTimeouts: 2,
      toolEnforcement: 'enforce',
    });
    expect(payload).not.toHaveProperty('heartbeatIntervalMs');
    expect(payload).not.toHaveProperty('leaseTtlSec');
  });
});

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
