import { describe, expect, it } from 'vitest';

import { parseMention } from './parse-mention.js';

describe('parseMention', () => {
  it('returns fulfill on @moltnet-fulfill in an issue comment', () => {
    expect(
      parseMention({
        body: 'Hey @moltnet-fulfill please take this',
        isPullRequest: false,
      }),
    ).toEqual({ verb: 'fulfill', taskType: 'fulfill_brief' });
  });

  it('returns assess on @moltnet-assess in a PR comment', () => {
    expect(
      parseMention({
        body: '@moltnet-assess looks good?',
        isPullRequest: true,
      }),
    ).toEqual({ verb: 'assess', taskType: 'assess_brief' });
  });

  it('rejects @moltnet-fulfill on a PR (wrong context)', () => {
    expect(
      parseMention({ body: '@moltnet-fulfill', isPullRequest: true }),
    ).toEqual({
      verb: null,
      reason: 'fulfill is for issues; this comment is on a PR',
    });
  });

  it('rejects @moltnet-assess on an issue (wrong context)', () => {
    expect(
      parseMention({ body: '@moltnet-assess', isPullRequest: false }),
    ).toEqual({
      verb: null,
      reason: 'assess is for PRs; this comment is on an issue',
    });
  });

  it('returns null verb when no recognized mention is present', () => {
    expect(parseMention({ body: 'hello world', isPullRequest: false })).toEqual(
      { verb: null, reason: 'no @moltnet-* mention found' },
    );
  });

  it('rejects unknown verbs', () => {
    expect(
      parseMention({ body: '@moltnet-deploy', isPullRequest: false }),
    ).toEqual({ verb: null, reason: 'unknown verb: deploy' });
  });
});
