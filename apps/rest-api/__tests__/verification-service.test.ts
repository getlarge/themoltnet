import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { VerificationServiceError } from '../src/services/verification.service.js';
import { createVerificationService } from '../src/services/verification.service.js';

vi.mock('@moltnet/database', () => ({
  DBOS: {
    startWorkflow: vi.fn(),
    getEvent: vi.fn(),
    send: vi.fn(),
  },
  verificationWorkflows: {
    startVerification: vi.fn(),
  },
}));

import { DBOS } from '@moltnet/database';

describe('createVerificationService', () => {
  const renderedPackId = '00000000-0000-0000-0000-000000000001';
  const nonce = '00000000-0000-0000-0000-000000000099';
  const verificationId = '00000000-0000-0000-0000-000000000111';

  const deps = {
    verificationRepository: {
      create: vi.fn(),
      findById: vi.fn(),
      findByNonce: vi.fn(),
      findLatestClaimableByRenderedPackId: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns existing verification for duplicate nonce', async () => {
    deps.verificationRepository.findByNonce.mockResolvedValue({
      id: verificationId,
      renderedPackId,
      nonce,
    });

    const service = createVerificationService(deps);
    const result = await service.createVerification(renderedPackId, nonce);

    expect(result).toEqual({ verificationId, nonce });
    expect(deps.verificationRepository.create).not.toHaveBeenCalled();
  });

  it('rejects duplicate nonce reused for a different rendered pack', async () => {
    deps.verificationRepository.findByNonce.mockResolvedValue({
      id: verificationId,
      renderedPackId: '00000000-0000-0000-0000-000000000222',
      nonce,
    });

    const service = createVerificationService(deps);

    await expect(
      service.createVerification(renderedPackId, nonce),
    ).rejects.toMatchObject({
      code: 'conflict',
    } satisfies Partial<VerificationServiceError>);
  });

  it('creates verification and starts workflow for new nonce', async () => {
    deps.verificationRepository.findByNonce.mockResolvedValue(null);
    deps.verificationRepository.create.mockResolvedValue({
      id: verificationId,
      nonce,
    });
    const start = vi.fn().mockResolvedValue(undefined);
    vi.mocked(DBOS.startWorkflow).mockReturnValue(start);
    vi.mocked(DBOS.getEvent).mockResolvedValue({
      verificationId,
      nonce,
    });

    const service = createVerificationService(deps);
    const result = await service.createVerification(renderedPackId, nonce);

    expect(result).toEqual({ verificationId, nonce });
    expect(DBOS.startWorkflow).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ workflowID: verificationId }),
    );
    expect(start).toHaveBeenCalledWith(verificationId, renderedPackId, nonce);
  });

  it('rethrows unexpected workflow startup failures', async () => {
    deps.verificationRepository.findByNonce.mockResolvedValue(null);
    deps.verificationRepository.create.mockResolvedValue({
      id: verificationId,
      nonce,
    });
    const start = vi.fn().mockRejectedValue(new Error('dbos unavailable'));
    vi.mocked(DBOS.startWorkflow).mockReturnValue(start);

    const service = createVerificationService(deps);

    await expect(
      service.createVerification(renderedPackId, nonce),
    ).rejects.toThrow('dbos unavailable');
  });

  it('allows WorkflowAlreadyExists startup error and reuses created event', async () => {
    deps.verificationRepository.findByNonce.mockResolvedValue(null);
    deps.verificationRepository.create.mockResolvedValue({
      id: verificationId,
      nonce,
    });
    const alreadyExists = new Error('already exists');
    alreadyExists.name = 'WorkflowAlreadyExistsError';
    const start = vi.fn().mockRejectedValue(alreadyExists);
    vi.mocked(DBOS.startWorkflow).mockReturnValue(start);
    vi.mocked(DBOS.getEvent).mockResolvedValue({
      verificationId,
      nonce,
    });

    const service = createVerificationService(deps);
    const result = await service.createVerification(renderedPackId, nonce);

    expect(result).toEqual({ verificationId, nonce });
  });

  it('returns timed_out when workflow initialization event is missing', async () => {
    deps.verificationRepository.findByNonce.mockResolvedValue(null);
    deps.verificationRepository.create.mockResolvedValue({
      id: verificationId,
      nonce,
    });
    const start = vi.fn().mockResolvedValue(undefined);
    vi.mocked(DBOS.startWorkflow).mockReturnValue(start);
    vi.mocked(DBOS.getEvent).mockResolvedValue(null);

    const service = createVerificationService(deps);

    await expect(
      service.createVerification(renderedPackId, nonce),
    ).rejects.toMatchObject({
      code: 'timed_out',
    } satisfies Partial<VerificationServiceError>);
  });

  it('claim fails when there is no active verification', async () => {
    deps.verificationRepository.findLatestClaimableByRenderedPackId.mockResolvedValue(
      null,
    );

    const service = createVerificationService(deps);

    await expect(
      service.claim(renderedPackId, 'judge-1'),
    ).rejects.toMatchObject({
      code: 'not_found',
    } satisfies Partial<VerificationServiceError>);
  });

  it('claim uses judge-scoped payload event', async () => {
    deps.verificationRepository.findLatestClaimableByRenderedPackId.mockResolvedValue(
      {
        id: verificationId,
        renderedPackId,
        nonce,
        status: 'created',
        claimedBy: null,
        expiresAt: new Date(Date.now() + 10_000),
      },
    );
    vi.mocked(DBOS.getEvent).mockResolvedValue({
      sourceEntries: [],
      renderedContent: '# rendered',
      rubric: 'rubric',
    });

    const service = createVerificationService(deps);
    await service.claim(renderedPackId, 'judge-1');

    expect(DBOS.getEvent).toHaveBeenCalledWith(
      verificationId,
      'payload:judge-1',
      5,
    );
  });

  it('claim returns conflict when another judge already claimed after race', async () => {
    deps.verificationRepository.findLatestClaimableByRenderedPackId.mockResolvedValue(
      {
        id: verificationId,
        renderedPackId,
        nonce,
        status: 'created',
        claimedBy: null,
        expiresAt: new Date(Date.now() + 10_000),
      },
    );
    vi.mocked(DBOS.getEvent)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    deps.verificationRepository.findById.mockResolvedValue({
      id: verificationId,
      renderedPackId,
      nonce,
      status: 'claimed',
      claimedBy: 'judge-2',
      expiresAt: new Date(Date.now() + 10_000),
    });

    const service = createVerificationService(deps);

    await expect(
      service.claim(renderedPackId, 'judge-1'),
    ).rejects.toMatchObject({
      code: 'conflict',
    } satisfies Partial<VerificationServiceError>);
  });

  it('submit fails when nonce does not match rendered pack', async () => {
    deps.verificationRepository.findByNonce.mockResolvedValue({
      id: verificationId,
      renderedPackId: '00000000-0000-0000-0000-000000000222',
    });

    const service = createVerificationService(deps);

    await expect(
      service.submit(renderedPackId, {
        nonce,
        coverage: 0.8,
        grounding: 0.9,
        faithfulness: 1,
        transcript: 'ok',
        judgeModel: 'claude-sonnet-4-6',
        judgeProvider: 'claude-code',
        judgeBinaryCid: 'sha256:abc',
        createdBy: 'judge-1',
      }),
    ).rejects.toMatchObject({
      code: 'not_found',
    } satisfies Partial<VerificationServiceError>);
  });
});
