import { mkdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearState, readState, writeState } from './state.js';

const TEST_ID = 'test-state-' + Math.random().toString(36).slice(2);
const configDir = join(tmpdir(), TEST_ID);

describe('state helpers', () => {
  beforeEach(async () => {
    await mkdir(configDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(configDir, { recursive: true, force: true });
  });

  it('returns null when no state file exists', async () => {
    expect(await readState(configDir)).toBeNull();
  });

  it('round-trips state', async () => {
    const state = {
      workflowId: 'wf-123',
      publicKey: 'ed25519:abc',
      privateKey: 'priv:abc',
      fingerprint: 'A1B2-C3D4-E5F6-G7H8',
      agentName: 'my-bot',
      phase: 'awaiting_github' as const,
    };
    await writeState(state, configDir);
    expect(await readState(configDir)).toEqual(state);
  });

  it('preserves optional fields', async () => {
    const state = {
      workflowId: 'wf-456',
      publicKey: 'ed25519:xyz',
      privateKey: 'priv:xyz',
      fingerprint: 'X1Y2-Z3A4-B5C6-D7E8',
      agentName: 'other-bot',
      phase: 'post_github' as const,
      appId: '12345',
      appSlug: 'my-app',
      installationId: '99999',
    };
    await writeState(state, configDir);
    expect(await readState(configDir)).toEqual(state);
  });

  it('isolates state per configDir', async () => {
    const dirA = join(configDir, 'agent-a');
    const dirB = join(configDir, 'agent-b');
    await mkdir(dirA, { recursive: true });
    await mkdir(dirB, { recursive: true });
    const state1 = {
      workflowId: 'wf-1',
      publicKey: 'pk-1',
      privateKey: 'sk-1',
      fingerprint: 'fp-1',
      agentName: 'agent-a',
      phase: 'awaiting_github' as const,
    };
    const state2 = {
      workflowId: 'wf-2',
      publicKey: 'pk-2',
      privateKey: 'sk-2',
      fingerprint: 'fp-2',
      agentName: 'agent-b',
      phase: 'awaiting_installation' as const,
    };
    await writeState(state1, dirA);
    await writeState(state2, dirB);
    expect(await readState(dirA)).toEqual(state1);
    expect(await readState(dirB)).toEqual(state2);
  });

  it('clearState removes the file', async () => {
    await writeState(
      {
        workflowId: 'x',
        publicKey: 'x',
        privateKey: 'x',
        fingerprint: 'x',
        agentName: 'x',
        phase: 'awaiting_github',
      },
      configDir,
    );
    await clearState(configDir);
    expect(await readState(configDir)).toBeNull();
  });

  it('clearState is idempotent', async () => {
    await expect(clearState(configDir)).resolves.toBeUndefined();
  });

  it('writeState creates directory if missing', async () => {
    const freshDir = join(configDir, 'fresh');
    await writeState(
      {
        workflowId: 'x',
        publicKey: 'x',
        privateKey: 'x',
        fingerprint: 'x',
        agentName: 'x',
        phase: 'awaiting_installation',
      },
      freshDir,
    );
    const s = await stat(join(freshDir, 'legreffier-init.state.json'));
    expect(s.isFile()).toBe(true);
  });
});
