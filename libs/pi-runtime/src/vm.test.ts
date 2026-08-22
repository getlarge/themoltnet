import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type * as SandboxGondolin from '@themoltnet/sandbox-gondolin';
import type { VmConfig } from '@themoltnet/sandbox-gondolin';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PI_GUEST_AUTH_PATH, piProviderAuth, resumeVm } from './vm.js';

const resumeSandboxVm = vi.fn(async (config: VmConfig) => ({ config }));
vi.mock('@themoltnet/sandbox-gondolin', async (importOriginal) => ({
  ...(await importOriginal<typeof SandboxGondolin>()),
  resumeVm: (config: VmConfig) => resumeSandboxVm(config),
}));

const savedEnv = {
  HOME: process.env.HOME,
  PI: process.env.PI_CODING_AGENT_DIR,
};
afterEach(() => {
  process.env.HOME = savedEnv.HOME;
  if (savedEnv.PI === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = savedEnv.PI;
  resumeSandboxVm.mockClear();
});

describe('piProviderAuth', () => {
  it('returns null when ~/.pi/agent/auth.json is absent', () => {
    const fakeHome = mkdtempSync(path.join(tmpdir(), 'pi-home-noauth-'));
    process.env.HOME = fakeHome;
    delete process.env.PI_CODING_AGENT_DIR;
    try {
      expect(piProviderAuth().load()).toBeNull();
      expect(piProviderAuth().guestPath).toBe(PI_GUEST_AUTH_PATH);
    } finally {
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  it('honors PI_CODING_AGENT_DIR over the default ~/.pi/agent', () => {
    const altDir = mkdtempSync(path.join(tmpdir(), 'pi-alt-'));
    const agentDir = path.join(altDir, '.pi', 'agent');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      path.join(agentDir, 'auth.json'),
      '{"anthropic":{"key":"sk-x"}}',
    );
    process.env.PI_CODING_AGENT_DIR = agentDir;
    try {
      expect(piProviderAuth().load()).toContain('sk-x');
    } finally {
      rmSync(altDir, { recursive: true, force: true });
    }
  });

  it('still loads the default ~/.pi/agent/auth.json when present', () => {
    const fakeHome = mkdtempSync(path.join(tmpdir(), 'pi-home-auth-'));
    const agentDir = path.join(fakeHome, '.pi', 'agent');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      path.join(agentDir, 'auth.json'),
      '{"openai":{"key":"sk-y"}}',
    );
    process.env.HOME = fakeHome;
    delete process.env.PI_CODING_AGENT_DIR;
    try {
      expect(piProviderAuth().load()).toContain('sk-y');
    } finally {
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });
});

describe('resumeVm (Pi wrapper)', () => {
  it('supplies Pi provider auth to the sandbox unless the caller overrides it', async () => {
    await resumeVm({ checkpointPath: '/cp', agentName: 'a', mountPath: '/ws' });
    expect(resumeSandboxVm.mock.calls[0]?.[0].providerAuth?.guestPath).toBe(
      PI_GUEST_AUTH_PATH,
    );
    const custom = { guestPath: '/x/auth.json', load: () => null };
    await resumeVm({
      checkpointPath: '/cp',
      agentName: 'a',
      mountPath: '/ws',
      providerAuth: custom,
    });
    expect(resumeSandboxVm.mock.calls[1]?.[0].providerAuth).toBe(custom);
  });
});
