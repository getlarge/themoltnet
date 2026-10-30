import { beforeAll, describe, expect, it, vi } from 'vitest';

const { registerStep, registerWorkflow } = vi.hoisted(() => ({
  registerStep: vi.fn((fn) => fn),
  registerWorkflow: vi.fn((fn) => fn),
}));

vi.mock('@moltnet/database', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  DBOS: { registerStep, registerWorkflow },
}));

import {
  initTeamFoundingWorkflow,
  setTeamFoundingDeps,
} from '../../src/workflows/team-founding-workflow.js';

const TEAM_ID = '770e8400-e29b-41d4-a716-446655440000';
const AGENT_ID = '660e8400-e29b-41d4-a716-446655440000';

describe('team founding workflow', () => {
  beforeAll(() => initTeamFoundingWorkflow());

  it('grants an executor projection to an agent founding member', async () => {
    const relationshipWriter = {
      grantTeamOwners: vi.fn(),
      grantTeamManagers: vi.fn(),
      grantTeamExecutors: vi.fn(),
      grantTeamMembers: vi.fn(),
      removeTeamMemberRelation: vi.fn(),
    };
    setTeamFoundingDeps({ relationshipWriter } as never);
    const grantStep = registerStep.mock.calls.find(
      ([, options]) => options.name === 'team.founding.step.grantMember',
    )?.[0];

    if (!grantStep) throw new Error('Founding member step was not registered');
    await grantStep(TEAM_ID, {
      subjectId: AGENT_ID,
      subjectNs: 'Agent',
      role: 'executor',
    });

    expect(relationshipWriter.grantTeamExecutors).toHaveBeenCalledWith(
      TEAM_ID,
      AGENT_ID,
      'Agent',
    );
  });
});
