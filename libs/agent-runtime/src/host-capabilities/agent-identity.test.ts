import { describe, expect, it } from 'vitest';

import { resolveAgentIdentity } from './agent-identity.js';

const whoami = {
  subjectId: 'agent-1',
  subjectType: 'agent',
  publicKey: 'ed25519:wBkbENwyQSOnY+OZIsVX1F3b35JvQ42juWDXyqTapN4=',
  fingerprint: '1671-B080-99BF-4270',
};

describe('resolveAgentIdentity', () => {
  it('prefers an explicit git author', () => {
    expect(
      resolveAgentIdentity({
        agentName: 'legreffier',
        whoami,
        gitAuthor: 'LeGreffier <1+legreffier[bot]@users.noreply.github.com>',
        hostGit: { name: 'x', email: 'y@z' },
      }),
    ).toMatchObject({
      gitName: 'LeGreffier',
      gitEmail: '1+legreffier[bot]@users.noreply.github.com',
    });
  });

  it('uses existing host git config and refuses to invent authorship', () => {
    expect(
      resolveAgentIdentity({
        agentName: 'legreffier',
        whoami,
        hostGit: { name: 'LeGreffier', email: 'h@x' },
      }),
    ).toMatchObject({ gitName: 'LeGreffier', gitEmail: 'h@x' });
    expect(() =>
      resolveAgentIdentity({ agentName: 'legreffier', whoami }),
    ).toThrow(/git authorship is missing/);
  });

  it('parses authors with spaces and angle brackets without backtracking', () => {
    expect(
      resolveAgentIdentity({
        agentName: 'a',
        whoami,
        gitAuthor: '  Le Greffier   <l@x.test>  ',
      }),
    ).toMatchObject({ gitName: 'Le Greffier', gitEmail: 'l@x.test' });
    const hostile = 'a' + ' '.repeat(50_000) + '<';
    const started = Date.now();
    expect(() =>
      resolveAgentIdentity({ agentName: 'a', whoami, gitAuthor: hostile }),
    ).toThrow(/git author/);
    expect(Date.now() - started).toBeLessThan(200);
    for (const bad of [
      '<l@x>',
      'Name <l@x',
      'Name <lx>',
      'Name <l@x@y>',
      'Name <l @x>',
    ]) {
      expect(() =>
        resolveAgentIdentity({ agentName: 'a', whoami, gitAuthor: bad }),
      ).toThrow(/git author/);
    }
  });

  it('rejects a malformed git author and a whoami without key material', () => {
    expect(() =>
      resolveAgentIdentity({
        agentName: 'a',
        whoami,
        gitAuthor: 'no-angle-brackets',
      }),
    ).toThrow(/git author/);
    expect(() =>
      resolveAgentIdentity({
        agentName: 'a',
        whoami: { subjectId: 'x', subjectType: 'agent' },
      }),
    ).toThrow(/publicKey/);
  });

  it('returns the versioned canonical subject shape', () => {
    expect(
      resolveAgentIdentity({
        agentName: 'legreffier',
        whoami,
        hostGit: { name: 'LeGreffier', email: 'h@x' },
      }),
    ).toMatchObject({
      protocolVersion: 1,
      subjectId: 'agent-1',
      subjectType: 'agent',
    });
  });
});
