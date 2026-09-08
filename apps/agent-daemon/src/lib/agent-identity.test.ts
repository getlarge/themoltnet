import type { Whoami } from '@themoltnet/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { readConfigMock } = vi.hoisted(() => ({ readConfigMock: vi.fn() }));

vi.mock('@themoltnet/sdk', () => ({ readConfig: readConfigMock }));

import { resolveDaemonAgentIdentity } from './agent-identity.js';

const whoami: Whoami = {
  subjectId: 'agent-1',
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

  it('uses host git config when credentials come from the config file', async () => {
    const identity = await resolveDaemonAgentIdentity({
      agentName: 'legreffier',
      whoami,
      credentialSource: 'config',
      agentDir: '/agent',
    });
    expect(identity).toMatchObject({ gitName: 'LeGreffier', gitEmail: 'h@x' });
    expect(readConfigMock).toHaveBeenCalledWith('/agent');
  });

  it('never reads host config when configless and requires explicit authorship', async () => {
    await expect(
      resolveDaemonAgentIdentity({
        agentName: 'legreffier',
        whoami,
        credentialSource: 'environment',
        agentDir: '/agent',
      }),
    ).rejects.toThrow(/git authorship is missing/);
    expect(readConfigMock).not.toHaveBeenCalled();
  });

  it('lets an explicit git author win in either mode', async () => {
    const identity = await resolveDaemonAgentIdentity({
      agentName: 'legreffier',
      whoami,
      credentialSource: 'config',
      agentDir: '/agent',
      gitAuthor: 'Bot <b@x>',
    });
    expect(identity).toMatchObject({ gitName: 'Bot', gitEmail: 'b@x' });
    expect(JSON.stringify(identity)).not.toContain('must-not-be-used');
  });
});
