import { describe, expect, it, vi } from 'vitest';

import { resolveCorrelation, type ResolveDeps } from './resolve-correlation.js';

const FRESH = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function makeDeps(overrides: Partial<ResolveDeps> = {}): ResolveDeps {
  return {
    moltnet: { findCorrelationByReference: vi.fn().mockResolvedValue(null) },
    gh: {
      getPrHeadRef: vi.fn().mockResolvedValue(null),
      getPrCommitMessages: vi.fn().mockResolvedValue([]),
      getPrBody: vi.fn().mockResolvedValue(null),
    },
    randomUUID: () => FRESH,
    logger: { info: vi.fn(), warn: vi.fn() },
    ...overrides,
  };
}

describe('resolveCorrelation', () => {
  const PR = { owner: 'o', repo: 'r', number: 1 };

  it('1. returns MoltNet API id when present', async () => {
    const deps = makeDeps({
      moltnet: {
        findCorrelationByReference: vi
          .fn()
          .mockResolvedValue('11111111-2222-4333-8444-555555555555'),
      },
    });
    const id = await resolveCorrelation(
      {
        contextType: 'pr',
        referenceUrl: 'https://github.com/o/r/pull/1',
        pr: PR,
      },
      deps,
    );
    expect(id).toBe('11111111-2222-4333-8444-555555555555');
    expect(deps.gh.getPrHeadRef).not.toHaveBeenCalled();
  });

  it('2. falls back to branch-name when API misses', async () => {
    const deps = makeDeps({
      gh: {
        getPrHeadRef: vi
          .fn()
          .mockResolvedValue('moltnet/22222222-3333-4444-8555-666666666666/x'),
        getPrCommitMessages: vi.fn().mockResolvedValue([]),
        getPrBody: vi.fn().mockResolvedValue(null),
      },
    });
    const id = await resolveCorrelation(
      {
        contextType: 'pr',
        referenceUrl: 'https://github.com/o/r/pull/1',
        pr: PR,
      },
      deps,
    );
    expect(id).toBe('22222222-3333-4444-8555-666666666666');
  });

  it('3. falls back to commit trailer when API + branch miss', async () => {
    const deps = makeDeps({
      gh: {
        getPrHeadRef: vi.fn().mockResolvedValue('feature/x'),
        getPrCommitMessages: vi
          .fn()
          .mockResolvedValue([
            'fix: a\n\nMoltnet-Correlation-Id: 33333333-4444-4555-8666-777777777777',
          ]),
        getPrBody: vi.fn().mockResolvedValue(null),
      },
    });
    const id = await resolveCorrelation(
      {
        contextType: 'pr',
        referenceUrl: 'https://github.com/o/r/pull/1',
        pr: PR,
      },
      deps,
    );
    expect(id).toBe('33333333-4444-4555-8666-777777777777');
  });

  it('4. falls back to PR body marker when commits miss', async () => {
    const deps = makeDeps({
      gh: {
        getPrHeadRef: vi.fn().mockResolvedValue('feature/x'),
        getPrCommitMessages: vi.fn().mockResolvedValue([]),
        getPrBody: vi
          .fn()
          .mockResolvedValue(
            'body\n<!-- moltnet-correlation: 44444444-5555-4666-8777-888888888888 -->',
          ),
      },
    });
    const id = await resolveCorrelation(
      {
        contextType: 'pr',
        referenceUrl: 'https://github.com/o/r/pull/1',
        pr: PR,
      },
      deps,
    );
    expect(id).toBe('44444444-5555-4666-8777-888888888888');
  });

  it('generates a fresh UUID when no anchor matches', async () => {
    const deps = makeDeps();
    const id = await resolveCorrelation(
      {
        contextType: 'issue',
        referenceUrl: 'https://github.com/o/r/issues/9',
      },
      deps,
    );
    expect(id).toBe(FRESH);
  });

  it('issue context only consults MoltNet API (skips PR-only anchors)', async () => {
    const deps = makeDeps();
    await resolveCorrelation(
      {
        contextType: 'issue',
        referenceUrl: 'https://github.com/o/r/issues/9',
      },
      deps,
    );
    expect(deps.gh.getPrHeadRef).not.toHaveBeenCalled();
    expect(deps.gh.getPrCommitMessages).not.toHaveBeenCalled();
    expect(deps.gh.getPrBody).not.toHaveBeenCalled();
  });

  it('survives MoltNet API errors and tries other anchors', async () => {
    const deps = makeDeps({
      moltnet: {
        findCorrelationByReference: vi.fn().mockRejectedValue(new Error('500')),
      },
      gh: {
        getPrHeadRef: vi
          .fn()
          .mockResolvedValue('moltnet/55555555-6666-4777-8888-999999999999/x'),
        getPrCommitMessages: vi.fn().mockResolvedValue([]),
        getPrBody: vi.fn().mockResolvedValue(null),
      },
    });
    const id = await resolveCorrelation(
      {
        contextType: 'pr',
        referenceUrl: 'https://github.com/o/r/pull/1',
        pr: PR,
      },
      deps,
    );
    expect(id).toBe('55555555-6666-4777-8888-999999999999');
  });
});
