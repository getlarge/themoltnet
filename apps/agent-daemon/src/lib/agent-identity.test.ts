import type { Whoami } from '@themoltnet/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { readConfigMock } = vi.hoisted(() => ({ readConfigMock: vi.fn() }));

vi.mock('@themoltnet/sdk', () => ({ readConfig: readConfigMock }));

import { resolveDaemonAgentIdentity } from './agent-identity.js';

const whoami: Whoami = {
  identityId: 'id-1',
  subjectType: 'agent',
  publicKey: 'ed25519:wBkbENwyQSOnY+OZIsVX1F3b35JvQ42juWDXyqTapN4=',
  fingerprint: '1671-B080-99BF-4270',
};

describe('resolveDaemonAgentIdentity', () => {
  beforeEach(() => {
    readConfigMock.mockReset();
    readConfigMock.mockResolvedValue({
      git: { name: 'LeGreffier', email: 'h@x' },
      keys: { private_key: 'must-not-be-used' },
    });
  });

  it('uses host git config in oauth2 mode', async () => {
    const identity = await resolveDaemonAgentIdentity({
      agentName: 'legreffier',
      whoami,
      authMode: 'oauth2',
      agentDir: '/agent',
    });
    expect(identity).toMatchObject({ gitName: 'LeGreffier', gitEmail: 'h@x' });
    expect(readConfigMock).toHaveBeenCalledWith('/agent');
  });

  it('never reads host config in agent-key mode and derives the bot address', async () => {
    const identity = await resolveDaemonAgentIdentity({
      agentName: 'legreffier',
      whoami,
      authMode: 'agent-key',
      agentDir: '/agent',
    });
    expect(identity.gitEmail).toBe(
      'id-1+legreffier[bot]@users.noreply.github.com',
    );
    expect(readConfigMock).not.toHaveBeenCalled();
  });

  it('lets an explicit git author win in either mode', async () => {
    const identity = await resolveDaemonAgentIdentity({
      agentName: 'legreffier',
      whoami,
      authMode: 'oauth2',
      agentDir: '/agent',
      gitAuthor: 'Bot <b@x>',
    });
    expect(identity).toMatchObject({ gitName: 'Bot', gitEmail: 'b@x' });
    expect(JSON.stringify(identity)).not.toContain('must-not-be-used');
  });
});
