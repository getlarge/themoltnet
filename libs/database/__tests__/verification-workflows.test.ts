import { beforeEach, describe, expect, it, vi } from 'vitest';

const registeredSteps: Record<string, (...args: unknown[]) => unknown> = {};
const registeredWorkflows: Record<string, (...args: unknown[]) => unknown> = {};

vi.mock('@dbos-inc/dbos-sdk', () => ({
  DBOS: {
    registerStep: vi.fn(
      (fn: (...args: unknown[]) => unknown, config: { name: string }) => {
        registeredSteps[config.name] = fn;
        return fn;
      },
    ),
    registerWorkflow: vi.fn(
      (fn: (...args: unknown[]) => unknown, config: { name: string }) => {
        registeredWorkflows[config.name] = fn;
        return fn;
      },
    ),
    setEvent: vi.fn(),
    recv: vi.fn(),
  },
}));

import { DBOS } from '@dbos-inc/dbos-sdk';

import {
  _resetVerificationWorkflowsForTesting,
  initVerificationWorkflows,
  setVerificationWorkflowDeps,
  verificationWorkflows,
} from '../src/workflows/verification-workflows.js';

describe('verification workflows', () => {
  const deps = {
    updateVerificationStatus: vi.fn(),
    loadRenderedPack: vi.fn(),
    listSourceEntries: vi.fn(),
    createAttestation: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(registeredSteps).forEach((k) => delete registeredSteps[k]);
    Object.keys(registeredWorkflows).forEach(
      (k) => delete registeredWorkflows[k],
    );
    _resetVerificationWorkflowsForTesting();
    setVerificationWorkflowDeps(deps);
    initVerificationWorkflows();
  });

  it('registers and exposes startVerification workflow', () => {
    expect(verificationWorkflows.startVerification).toBeDefined();
    expect(
      registeredWorkflows['verification.workflow.startVerification'],
    ).toBeDefined();
  });

  it('marks verification expired when claim times out', async () => {
    vi.mocked(DBOS.recv).mockResolvedValueOnce(null);
    const workflow =
      registeredWorkflows['verification.workflow.startVerification'];

    const result = await workflow(
      '00000000-0000-0000-0000-000000000111',
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000099',
    );

    expect(deps.updateVerificationStatus).toHaveBeenCalledWith(
      '00000000-0000-0000-0000-000000000111',
      'expired',
      undefined,
    );
    expect(result).toEqual({
      verificationId: '00000000-0000-0000-0000-000000000111',
      nonce: '00000000-0000-0000-0000-000000000099',
    });
  });

  it('submits attestation when claim and submit succeed', async () => {
    vi.mocked(DBOS.recv)
      .mockResolvedValueOnce({ judgeIdentityId: 'judge-1' })
      .mockResolvedValueOnce({
        nonce: '00000000-0000-0000-0000-000000000099',
        coverage: 0.8,
        grounding: 0.9,
        faithfulness: 1,
        transcript: 'ok',
        judgeModel: 'claude-sonnet-4-6',
        judgeProvider: 'claude-code',
        judgeBinaryCid: 'sha256:abc',
        createdBy: 'judge-1',
      });
    deps.loadRenderedPack.mockResolvedValue({
      id: '00000000-0000-0000-0000-000000000001',
      sourcePackId: '00000000-0000-0000-0000-000000000222',
      content: '# rendered',
    });
    deps.listSourceEntries.mockResolvedValue([
      {
        entryCidSnapshot: 'hash1',
        entry: { title: 'Entry 1', content: 'Content 1' },
      },
    ]);
    deps.createAttestation.mockResolvedValue({ id: 'att-1' });

    const workflow =
      registeredWorkflows['verification.workflow.startVerification'];
    await workflow(
      '00000000-0000-0000-0000-000000000111',
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000099',
    );

    expect(deps.updateVerificationStatus).toHaveBeenNthCalledWith(
      1,
      '00000000-0000-0000-0000-000000000111',
      'claimed',
      'judge-1',
    );
    expect(deps.updateVerificationStatus).toHaveBeenNthCalledWith(
      2,
      '00000000-0000-0000-0000-000000000111',
      'submitted',
      undefined,
    );
    expect(deps.createAttestation).toHaveBeenCalledTimes(1);
    expect(vi.mocked(DBOS.setEvent)).toHaveBeenCalledWith(
      'payload:judge-1',
      expect.any(Object),
    );
  });

  it('marks verification expired in DB when submission is invalid', async () => {
    vi.mocked(DBOS.recv)
      .mockResolvedValueOnce({ judgeIdentityId: 'judge-1' })
      .mockResolvedValueOnce({
        nonce: '00000000-0000-0000-0000-000000000000',
        coverage: 0.8,
        grounding: 0.9,
        faithfulness: 1,
        transcript: 'invalid',
        judgeModel: 'claude-sonnet-4-6',
        judgeProvider: 'claude-code',
        judgeBinaryCid: 'sha256:abc',
        createdBy: 'judge-1',
      });
    deps.loadRenderedPack.mockResolvedValue({
      id: '00000000-0000-0000-0000-000000000001',
      sourcePackId: '00000000-0000-0000-0000-000000000222',
      content: '# rendered',
    });
    deps.listSourceEntries.mockResolvedValue([]);

    const workflow =
      registeredWorkflows['verification.workflow.startVerification'];
    await workflow(
      '00000000-0000-0000-0000-000000000111',
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000099',
    );

    expect(deps.updateVerificationStatus).toHaveBeenCalledWith(
      '00000000-0000-0000-0000-000000000111',
      'expired',
      undefined,
    );
  });
});
