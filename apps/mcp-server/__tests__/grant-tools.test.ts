import {
  createTaskGrant,
  getWhoami,
  revokeTaskGrant,
} from '@moltnet/api-client';
import { KetoNamespace } from '@moltnet/auth';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  handleTaskGrantCreate,
  handleTaskGrantRevoke,
} from '../src/grant-tools.js';
import type { McpDeps } from '../src/types.js';
import { createMockContext, createMockDeps, sdkOk } from './helpers.js';

vi.mock('@moltnet/api-client', () => ({
  createDiaryGrant: vi.fn(),
  createTaskGrant: vi.fn(),
  getWhoami: vi.fn(),
  listDiaryGrants: vi.fn(),
  listTaskGrants: vi.fn(),
  revokeDiaryGrant: vi.fn(),
  revokeTaskGrant: vi.fn(),
}));

const TASK_ID = '550e8400-e29b-41d4-a716-446655440010';
const TEAM_ID = '550e8400-e29b-41d4-a716-446655440011';
const SUBJECT_ID = '550e8400-e29b-41d4-a716-446655440012';
const GRANT_ARGS = {
  task_id: TASK_ID,
  team_id: TEAM_ID,
  subject_id: SUBJECT_ID,
  subject_ns: 'Agent',
  role: 'writer',
} as const;

describe('task grant handlers', () => {
  let deps: McpDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
    vi.mocked(getWhoami).mockResolvedValue(
      sdkOk({
        identityId: 'test-user-id',
        subjectType: 'agent',
      }),
    );
    vi.mocked(createTaskGrant).mockResolvedValue(
      sdkOk({ subjectId: SUBJECT_ID, subjectNs: 'Agent', role: 'writer' }),
    );
    vi.mocked(revokeTaskGrant).mockResolvedValue(sdkOk({ revoked: true }));
  });

  const createGrant = () =>
    handleTaskGrantCreate(GRANT_ARGS, deps, createMockContext());
  const revokeGrant = () =>
    handleTaskGrantRevoke(GRANT_ARGS, deps, createMockContext());

  it('fails closed before REST when local task management is denied', async () => {
    vi.mocked(deps.permissionChecker.canManageTask).mockResolvedValue(false);

    const result = await createGrant();

    expect(result.isError).toBe(true);
    expect(createTaskGrant).not.toHaveBeenCalled();
  });

  it('fails closed when the validated token lacks a MoltNet principal', async () => {
    vi.mocked(getWhoami).mockResolvedValue(
      sdkOk(undefined) as Awaited<ReturnType<typeof getWhoami>>,
    );

    const result = await createGrant();

    expect(result.isError).toBe(true);
    expect(deps.permissionChecker.canManageTask).not.toHaveBeenCalled();
    expect(createTaskGrant).not.toHaveBeenCalled();
  });

  it('checks the caller locally before creating a task grant', async () => {
    const result = await createGrant();

    expect(result.isError).toBeUndefined();
    expect(deps.permissionChecker.canManageTask).toHaveBeenCalledWith(
      TASK_ID,
      'test-user-id',
      KetoNamespace.Agent,
    );
    expect(createTaskGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { 'x-moltnet-team-id': TEAM_ID },
      }),
    );
  });

  it('checks the caller locally before revoking a task grant', async () => {
    const result = await revokeGrant();

    expect(result.isError).toBeUndefined();
    expect(deps.permissionChecker.canManageTask).toHaveBeenCalledWith(
      TASK_ID,
      'test-user-id',
      KetoNamespace.Agent,
    );
    expect(revokeTaskGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { 'x-moltnet-team-id': TEAM_ID },
      }),
    );
  });

  it('uses the Human namespace for a human access token', async () => {
    vi.mocked(getWhoami).mockResolvedValue(
      sdkOk({
        identityId: 'human-identity-id',
        subjectType: 'human',
      }),
    );

    const result = await createGrant();

    expect(result.isError).toBeUndefined();
    expect(deps.permissionChecker.canManageTask).toHaveBeenCalledWith(
      TASK_ID,
      'human-identity-id',
      KetoNamespace.Human,
    );
  });
});
