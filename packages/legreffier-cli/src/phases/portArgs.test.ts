import { describe, expect, it } from 'vitest';

import { validatePortFromArg } from './portArgs.js';

describe('validatePortFromArg', () => {
  it('rejects undefined', () => {
    const result = validatePortFromArg(undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('legreffier port requires --from');
    }
  });

  it('rejects an empty string', () => {
    const result = validatePortFromArg('');
    expect(result.ok).toBe(false);
  });

  it('rejects a non-string value', () => {
    const result = validatePortFromArg(42 as unknown);
    expect(result.ok).toBe(false);
  });

  it('rejects a relative path with no leading slash', () => {
    const result = validatePortFromArg('.moltnet/jobi');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('must be an absolute path');
      expect(result.error).toContain('.moltnet/jobi');
    }
  });

  it('rejects a relative path with dot-slash prefix', () => {
    const result = validatePortFromArg('./.moltnet/jobi');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('must be an absolute path');
    }
  });

  it('rejects a parent-relative path', () => {
    const result = validatePortFromArg('../other-repo/.moltnet/jobi');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('must be an absolute path');
    }
  });

  it('rejects a ~-prefixed path with a tilde-specific hint', () => {
    const result = validatePortFromArg('~/code/other-repo/.moltnet/jobi');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('"~" which is not expanded');
      expect(result.error).toContain('$HOME');
    }
  });

  it('rejects a bare repo-name shorthand', () => {
    const result = validatePortFromArg('other-repo');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('must be an absolute path');
    }
  });

  it('accepts a POSIX absolute path', () => {
    const result = validatePortFromArg(
      '/Users/me/code/other-repo/.moltnet/jobi',
    );
    expect(result.ok).toBe(true);
  });

  it('accepts a long absolute path with trailing segments', () => {
    const result = validatePortFromArg(
      '/var/lib/repos/some-org/some-repo/.moltnet/my-agent',
    );
    expect(result.ok).toBe(true);
  });
});
