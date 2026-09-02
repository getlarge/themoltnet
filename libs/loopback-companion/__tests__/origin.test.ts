import { describe, expect, it } from 'vitest';

import {
  isLoopbackHostname,
  LoopbackViolationError,
  normalizeOrigin,
  OriginAllowlist,
  parseAllowedOrigins,
  requireOriginHeader,
} from '../src/index.js';

describe('normalizeOrigin', () => {
  it('accepts exact https origins', () => {
    expect(normalizeOrigin('https://console.themolt.net')).toBe(
      'https://console.themolt.net',
    );
  });

  it('accepts http origins only on loopback hosts', () => {
    expect(normalizeOrigin('http://127.0.0.1:17373')).toBe(
      'http://127.0.0.1:17373',
    );
    expect(normalizeOrigin('http://localhost:5173')).toBe(
      'http://localhost:5173',
    );
    expect(normalizeOrigin('http://[::1]:8080')).toBe('http://[::1]:8080');
    expect(() => normalizeOrigin('http://example.com')).toThrow(
      LoopbackViolationError,
    );
  });

  it('rejects values that are not exact origins', () => {
    for (const value of [
      'https://console.themolt.net/',
      'https://console.themolt.net/path',
      'https://user:pass@console.themolt.net',
      'console.themolt.net',
      'null',
      '',
    ]) {
      expect(() => normalizeOrigin(value), value).toThrow(
        LoopbackViolationError,
      );
    }
  });

  it('tags rejections with origin_invalid', () => {
    try {
      normalizeOrigin('ftp://console.themolt.net');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(LoopbackViolationError);
      expect((error as LoopbackViolationError).kind).toBe('origin_invalid');
    }
  });
});

describe('isLoopbackHostname', () => {
  it('accepts only the loopback literals', () => {
    expect(isLoopbackHostname('localhost')).toBe(true);
    expect(isLoopbackHostname('127.0.0.1')).toBe(true);
    expect(isLoopbackHostname('[::1]')).toBe(true);
    expect(isLoopbackHostname('example.com')).toBe(false);
    expect(isLoopbackHostname('127.0.0.2')).toBe(false);
  });
});

describe('parseAllowedOrigins', () => {
  it('splits, trims, and drops empty entries', () => {
    expect(
      parseAllowedOrigins(' https://a.example ,, https://b.example ,'),
    ).toEqual(['https://a.example', 'https://b.example']);
  });
});

describe('OriginAllowlist', () => {
  it('requires at least one origin', () => {
    expect(() => new OriginAllowlist([])).toThrow(
      'OriginAllowlist requires at least one origin',
    );
  });

  it('fails at construction on an invalid configured origin', () => {
    expect(() => new OriginAllowlist(['https://a.example/path'])).toThrow(
      LoopbackViolationError,
    );
  });

  it('matches exactly and asserts with origin_not_allowed', () => {
    const allowlist = new OriginAllowlist(['https://console.themolt.net']);
    expect(allowlist.has('https://console.themolt.net')).toBe(true);
    expect(allowlist.has('https://evil.example')).toBe(false);
    expect(allowlist.has('not-an-origin')).toBe(false);
    expect(allowlist.assert('https://console.themolt.net')).toBe(
      'https://console.themolt.net',
    );
    try {
      allowlist.assert('https://evil.example');
      expect.unreachable();
    } catch (error) {
      expect((error as LoopbackViolationError).kind).toBe('origin_not_allowed');
    }
    try {
      allowlist.assert('garbage');
      expect.unreachable();
    } catch (error) {
      expect((error as LoopbackViolationError).kind).toBe('origin_not_allowed');
    }
  });
});

describe('requireOriginHeader', () => {
  it('returns the header value', () => {
    expect(requireOriginHeader({ origin: 'https://a.example' })).toBe(
      'https://a.example',
    );
  });

  it('rejects missing, empty, and array values', () => {
    for (const origin of [undefined, '', ['https://a.example']] as const) {
      try {
        requireOriginHeader({ origin: origin as never });
        expect.unreachable();
      } catch (error) {
        expect((error as LoopbackViolationError).kind).toBe('origin_required');
      }
    }
  });
});
