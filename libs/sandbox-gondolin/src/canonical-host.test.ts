import { describe, expect, it } from 'vitest';

import {
  canonicalizeCredentialHostPattern,
  canonicalizeHostname,
  credentialHostMatches,
  networkPatternCoversCredentialPattern,
  normalizeNetworkHostPattern,
} from './canonical-host.js';

describe('Gondolin policy hostname canonicalization', () => {
  it.each([
    ['EXAMPLE.com...', 'example.com'],
    ['b\u00fccher.example', 'xn--bcher-kva.example'],
    ['xn--bcher-kva.example', 'xn--bcher-kva.example'],
    ['127.0.0.1', '127.0.0.1'],
    ['[0:0:0:0:0:0:0:1]', '::1'],
  ])('canonicalizes %s', (input, expected) => {
    expect(canonicalizeHostname(input)).toBe(expected);
  });

  it.each(['127.1', '2130706433', '0x7f000001', '0177.0.0.1'])(
    'rejects ambiguous numeric address %s',
    (input) => {
      expect(() => canonicalizeHostname(input)).toThrow(
        'alternate numeric IP forms',
      );
    },
  );

  it('canonicalizes IDNA below a leading wildcard', () => {
    expect(canonicalizeCredentialHostPattern('*.B\u00dcCHER.example.')).toBe(
      '*.xn--bcher-kva.example',
    );
  });

  it('handles long dot runs in linear time', () => {
    const dots = '.'.repeat(50_000);

    expect(normalizeNetworkHostPattern(`*${dots}x`)).toBe(`*${dots}x`);
    expect(normalizeNetworkHostPattern(`*.example.com${dots}`)).toBe(
      '*.example.com',
    );
    expect(() => canonicalizeHostname(`${dots}x`)).toThrow('invalid hostname');
  });

  it('limits credential wildcards to exactly one label', () => {
    expect(credentialHostMatches('api.example.com', '*.example.com')).toBe(
      true,
    );
    expect(credentialHostMatches('example.com', '*.example.com')).toBe(false);
    expect(credentialHostMatches('deep.api.example.com', '*.example.com')).toBe(
      false,
    );
    expect(credentialHostMatches('api.example.com.evil', '*.example.com')).toBe(
      false,
    );
    expect(() => canonicalizeCredentialHostPattern('api.*')).toThrow(
      'leading *.',
    );
  });

  it('keeps network-glob coverage conservative for credential wildcards', () => {
    expect(
      networkPatternCoversCredentialPattern('*.example.com', 'api.example.com'),
    ).toBe(true);
    expect(
      networkPatternCoversCredentialPattern('api.*', '*.example.com'),
    ).toBe(false);
    expect(
      networkPatternCoversCredentialPattern('*.example.com', '*.example.com'),
    ).toBe(true);
  });
});
