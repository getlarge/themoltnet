import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { registerStep, registerWorkflow } = vi.hoisted(() => ({
  registerStep: vi.fn((fn) => fn),
  registerWorkflow: vi.fn((fn) => fn),
}));

vi.mock('@moltnet/database', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  DBOS: { registerStep, registerWorkflow },
}));

import {
  HumanOnboardingError,
  humanOnboardingWorkflow,
  initHumanOnboardingWorkflow,
  setHumanOnboardingDeps,
} from '../../src/workflows/human-onboarding-workflow.js';

const HUMAN_ID = '550e8400-e29b-41d4-a716-446655440000';
const IDENTITY_ID = '660e8400-e29b-41d4-a716-446655440000';
const TEAM_ID = '770e8400-e29b-41d4-a716-446655440000';
const DIARY_ID = '880e8400-e29b-41d4-a716-446655440000';

function createDeps() {
  return {
    humanRepository: {
      bindIdentityId: vi.fn().mockResolvedValue({
        id: HUMAN_ID,
        identityId: IDENTITY_ID,
      }),
      findById: vi.fn().mockResolvedValue({ id: HUMAN_ID, identityId: null }),
      clearIdentityIdIfMatches: vi.fn().mockResolvedValue(true),
    },
    teamRepository: {
      findPersonalByCreator: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: TEAM_ID }),
    },
    diaryRepository: {
      listByCreator: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: DIARY_ID }),
    },
    relationshipWriter: {
      registerHuman: vi.fn(),
      removeHumanRelations: vi.fn(),
      grantTeamOwners: vi.fn(),
      removeTeamMemberRelation: vi.fn(),
      grantDiaryTeam: vi.fn(),
    },
    transactionRunner: {
      runInTransaction: vi.fn(async (fn) => fn()),
    },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

describe('human onboarding workflow', () => {
  beforeAll(() => initHumanOnboardingWorkflow());
  beforeEach(() => vi.clearAllMocks());

  it('binds identity and persists personal resources in DBOS transactions', async () => {
    const deps = createDeps();
    setHumanOnboardingDeps(deps as never);

    const result = await humanOnboardingWorkflow.onboardHuman(
      HUMAN_ID,
      IDENTITY_ID,
      'alice',
    );

    expect(result).toEqual({
      humanId: HUMAN_ID,
      identityId: IDENTITY_ID,
      personalTeamId: TEAM_ID,
    });
    expect(deps.humanRepository.bindIdentityId).toHaveBeenCalledWith(
      HUMAN_ID,
      IDENTITY_ID,
    );
    expect(deps.transactionRunner.runInTransaction).toHaveBeenCalledTimes(3);
    expect(deps.relationshipWriter.grantDiaryTeam).toHaveBeenCalledWith(
      DIARY_ID,
      TEAM_ID,
    );
  });

  it('clears a failed binding only when it still belongs to this identity', async () => {
    const deps = createDeps();
    deps.relationshipWriter.registerHuman.mockRejectedValueOnce(
      new Error('Keto unavailable'),
    );
    setHumanOnboardingDeps(deps as never);

    await expect(
      humanOnboardingWorkflow.onboardHuman(HUMAN_ID, IDENTITY_ID, 'alice'),
    ).rejects.toThrow('Keto unavailable');

    expect(deps.humanRepository.clearIdentityIdIfMatches).toHaveBeenCalledWith(
      HUMAN_ID,
      IDENTITY_ID,
    );
    // Keto subjects are humans.id, not the Kratos identity: an identity can be
    // recreated, and a subject that moves with it detaches the human from every
    // permission they hold.
    expect(deps.relationshipWriter.removeHumanRelations).toHaveBeenCalledWith(
      HUMAN_ID,
    );
  });

  it('rejects a competing identity without compensating the winner', async () => {
    const deps = createDeps();
    deps.humanRepository.bindIdentityId.mockResolvedValueOnce(null);
    deps.humanRepository.findById.mockResolvedValueOnce({
      id: HUMAN_ID,
      identityId: '990e8400-e29b-41d4-a716-446655440000',
    });
    setHumanOnboardingDeps(deps as never);

    await expect(
      humanOnboardingWorkflow.onboardHuman(HUMAN_ID, IDENTITY_ID, 'alice'),
    ).rejects.toThrow(HumanOnboardingError);

    expect(deps.relationshipWriter.registerHuman).not.toHaveBeenCalled();
    expect(
      deps.humanRepository.clearIdentityIdIfMatches,
    ).not.toHaveBeenCalled();
  });
});
