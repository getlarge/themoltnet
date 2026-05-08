import { describe, expect, it, vi } from 'vitest';

import {
  appendPrBodyMarker,
  buildBranchName,
  CORRELATION_MARKER_RE,
  CORRELATION_TRAILER_KEY,
  ensureCommitTrailer,
  makePrBodyAnchorWriter,
  parsePrUrl,
  slugify,
} from './correlation.js';

describe('slugify', () => {
  it('lowercases, replaces non-alnum runs with single dashes, trims', () => {
    expect(slugify('  Hello, World!! ')).toBe('hello-world');
  });

  it('caps slugs at 60 chars and trims trailing dashes', () => {
    const out = slugify('a'.repeat(120));
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out).not.toMatch(/-$/);
  });

  it('returns empty string when input slugifies to nothing', () => {
    expect(slugify('!!!')).toBe('');
  });
});

describe('buildBranchName', () => {
  it('produces moltnet/<correlationId>/<slug>', () => {
    const name = buildBranchName({
      correlationId: '11111111-2222-4333-8444-555555555555',
      title: 'Fix the flaky test in auth flow',
    });
    expect(name).toBe(
      'moltnet/11111111-2222-4333-8444-555555555555/fix-the-flaky-test-in-auth-flow',
    );
  });

  it('falls back to "task" when title slugifies to empty', () => {
    const name = buildBranchName({
      correlationId: '11111111-2222-4333-8444-555555555555',
      title: '!!!',
    });
    expect(name.endsWith('/task')).toBe(true);
  });
});

describe('ensureCommitTrailer', () => {
  it('appends Moltnet-Correlation-Id when missing', () => {
    const out = ensureCommitTrailer('feat: something\n\nbody', 'abc-123');
    expect(out).toMatch(/Moltnet-Correlation-Id: abc-123$/m);
    expect(out).toContain('feat: something');
  });

  it('is idempotent when trailer already present', () => {
    const msg = 'feat: x\n\nbody\n\nMoltnet-Correlation-Id: abc-123';
    expect(ensureCommitTrailer(msg, 'abc-123')).toBe(msg);
  });

  it('refuses to add a conflicting id', () => {
    const msg = 'feat: x\n\nMoltnet-Correlation-Id: existing-id';
    expect(() => ensureCommitTrailer(msg, 'new-id')).toThrow(/conflict/i);
  });

  it('exposes the trailer key as a stable constant', () => {
    expect(CORRELATION_TRAILER_KEY).toBe('Moltnet-Correlation-Id');
  });
});

describe('appendPrBodyMarker', () => {
  it('appends marker when absent', () => {
    const out = appendPrBodyMarker('PR description.', 'abc-123');
    expect(out).toMatch(CORRELATION_MARKER_RE);
    expect(out).toContain('PR description.');
  });

  it('is idempotent on identical correlationId', () => {
    const once = appendPrBodyMarker('body', 'abc-123');
    const twice = appendPrBodyMarker(once, 'abc-123');
    expect(twice).toBe(once);
  });

  it('handles null and empty bodies', () => {
    expect(appendPrBodyMarker(null, 'abc-123')).toMatch(CORRELATION_MARKER_RE);
    expect(appendPrBodyMarker('', 'abc-123')).toMatch(CORRELATION_MARKER_RE);
  });
});

describe('parsePrUrl', () => {
  it('extracts owner/repo/number from a GitHub PR url', () => {
    expect(parsePrUrl('https://github.com/o/r/pull/42')).toEqual({
      owner: 'o',
      repo: 'r',
      number: 42,
    });
  });

  it('tolerates trailing path/query segments', () => {
    expect(parsePrUrl('https://github.com/o/r/pull/42/files')).toEqual({
      owner: 'o',
      repo: 'r',
      number: 42,
    });
  });

  it('returns null for non-PR URLs', () => {
    expect(parsePrUrl('https://github.com/o/r/issues/42')).toBeNull();
    expect(parsePrUrl('not a url')).toBeNull();
  });
});

describe('makePrBodyAnchorWriter', () => {
  function makeLogger() {
    return { warn: vi.fn(), info: vi.fn() };
  }

  it('GETs PR body, appends marker, PATCHes back', async () => {
    const get = vi.fn().mockResolvedValue({ body: 'PR description.' });
    const patch = vi.fn().mockResolvedValue(undefined);
    const writer = makePrBodyAnchorWriter({
      gh: { get, patch },
      logger: makeLogger(),
    });

    await writer({
      correlationId: 'abc-123',
      pullRequestUrl: 'https://github.com/o/r/pull/9',
    });

    expect(get).toHaveBeenCalledWith({ owner: 'o', repo: 'r', number: 9 });
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith(
      { owner: 'o', repo: 'r', number: 9 },
      expect.stringMatching(/<!--\s*moltnet-correlation:\s*abc-123\s*-->/),
    );
  });

  it('skips PATCH when marker already present (idempotent)', async () => {
    const get = vi.fn().mockResolvedValue({
      body: 'body\n\n<!-- moltnet-correlation: abc-123 -->',
    });
    const patch = vi.fn();
    const writer = makePrBodyAnchorWriter({
      gh: { get, patch },
      logger: makeLogger(),
    });

    await writer({
      correlationId: 'abc-123',
      pullRequestUrl: 'https://github.com/o/r/pull/9',
    });

    expect(patch).not.toHaveBeenCalled();
  });

  it('logs and skips when PR url is unparseable', async () => {
    const logger = makeLogger();
    const get = vi.fn();
    const patch = vi.fn();
    const writer = makePrBodyAnchorWriter({ gh: { get, patch }, logger });

    await writer({ correlationId: 'abc-123', pullRequestUrl: 'not-a-url' });

    expect(get).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });
});
