import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KetoNamespace } from '../src/keto-constants.js';
import {
  createPermissionChecker,
  type PermissionChecker,
} from '../src/permission-checker.js';

interface MockPermissionApi {
  checkPermission: ReturnType<typeof vi.fn>;
  batchCheckPermission: ReturnType<typeof vi.fn>;
}

function createMockPermissionApi(): MockPermissionApi {
  return { checkPermission: vi.fn(), batchCheckPermission: vi.fn() };
}

const AGENT_ID = '550e8400-e29b-41d4-a716-446655440000';
const OTHER_AGENT_ID = '660e8400-e29b-41d4-a716-446655440001';
const DIARY_ID = '880e8400-e29b-41d4-a716-446655440004';
const ENTRY_ID = '770e8400-e29b-41d4-a716-446655440002';

describe('PermissionChecker', () => {
  let mockPermissionApi: MockPermissionApi;
  let checker: PermissionChecker;

  beforeEach(() => {
    mockPermissionApi = createMockPermissionApi();
    checker = createPermissionChecker(mockPermissionApi as any);
  });

  describe('diary permissions', () => {
    it('checks canReadDiary against Diary namespace', async () => {
      mockPermissionApi.checkPermission.mockResolvedValue({
        allowed: true,
      });

      const result = await checker.canReadDiary(
        DIARY_ID,
        AGENT_ID,
        KetoNamespace.Agent,
      );

      expect(result).toBe(true);
      expect(mockPermissionApi.checkPermission).toHaveBeenCalledWith({
        namespace: 'Diary',
        object: DIARY_ID,
        relation: 'read',
        subjectId: undefined,
        subjectSetNamespace: 'Agent',
        subjectSetObject: AGENT_ID,
        subjectSetRelation: '',
      });
    });

    it('checks canWriteDiary against Diary namespace', async () => {
      mockPermissionApi.checkPermission.mockResolvedValue({
        allowed: true,
      });

      const result = await checker.canWriteDiary(
        DIARY_ID,
        AGENT_ID,
        KetoNamespace.Agent,
      );

      expect(result).toBe(true);
      expect(mockPermissionApi.checkPermission).toHaveBeenCalledWith({
        namespace: 'Diary',
        object: DIARY_ID,
        relation: 'write',
        subjectId: undefined,
        subjectSetNamespace: 'Agent',
        subjectSetObject: AGENT_ID,
        subjectSetRelation: '',
      });
    });

    it('checks canManageDiary against Diary namespace', async () => {
      mockPermissionApi.checkPermission.mockResolvedValue({
        allowed: false,
      });

      const result = await checker.canManageDiary(
        DIARY_ID,
        OTHER_AGENT_ID,
        KetoNamespace.Human,
      );

      expect(result).toBe(false);
      expect(mockPermissionApi.checkPermission).toHaveBeenCalledWith({
        namespace: 'Diary',
        object: DIARY_ID,
        relation: 'manage',
        subjectId: undefined,
        subjectSetNamespace: 'Human',
        subjectSetObject: OTHER_AGENT_ID,
        subjectSetRelation: '',
      });
    });
  });

  describe('canViewEntry', () => {
    it('returns true when agent has view permission', async () => {
      mockPermissionApi.checkPermission.mockResolvedValue({
        allowed: true,
      });

      const result = await checker.canViewEntry(
        ENTRY_ID,
        AGENT_ID,
        KetoNamespace.Agent,
      );

      expect(result).toBe(true);
      expect(mockPermissionApi.checkPermission).toHaveBeenCalledWith({
        namespace: 'DiaryEntry',
        object: ENTRY_ID,
        relation: 'view',
        subjectId: undefined,
        subjectSetNamespace: 'Agent',
        subjectSetObject: AGENT_ID,
        subjectSetRelation: '',
      });
    });

    it('returns false when agent lacks view permission', async () => {
      mockPermissionApi.checkPermission.mockResolvedValue({
        allowed: false,
      });

      const result = await checker.canViewEntry(
        ENTRY_ID,
        AGENT_ID,
        KetoNamespace.Agent,
      );

      expect(result).toBe(false);
    });

    it('returns false on API error', async () => {
      mockPermissionApi.checkPermission.mockRejectedValue(
        new Error('Keto unavailable'),
      );

      const result = await checker.canViewEntry(
        ENTRY_ID,
        AGENT_ID,
        KetoNamespace.Agent,
      );

      expect(result).toBe(false);
    });
  });

  describe('canEditEntry', () => {
    it('returns true when agent is owner', async () => {
      mockPermissionApi.checkPermission.mockResolvedValue({
        allowed: true,
      });

      const result = await checker.canEditEntry(
        ENTRY_ID,
        AGENT_ID,
        KetoNamespace.Agent,
      );

      expect(result).toBe(true);
      expect(mockPermissionApi.checkPermission).toHaveBeenCalledWith({
        namespace: 'DiaryEntry',
        object: ENTRY_ID,
        relation: 'edit',
        subjectId: undefined,
        subjectSetNamespace: 'Agent',
        subjectSetObject: AGENT_ID,
        subjectSetRelation: '',
      });
    });

    it('returns false when agent is not owner', async () => {
      mockPermissionApi.checkPermission.mockResolvedValue({
        allowed: false,
      });

      const result = await checker.canEditEntry(
        ENTRY_ID,
        OTHER_AGENT_ID,
        KetoNamespace.Agent,
      );

      expect(result).toBe(false);
    });
  });

  describe('canDeleteEntry', () => {
    it('checks delete permission', async () => {
      mockPermissionApi.checkPermission.mockResolvedValue({
        allowed: true,
      });

      const result = await checker.canDeleteEntry(
        ENTRY_ID,
        AGENT_ID,
        KetoNamespace.Agent,
      );

      expect(result).toBe(true);
      expect(mockPermissionApi.checkPermission).toHaveBeenCalledWith({
        namespace: 'DiaryEntry',
        object: ENTRY_ID,
        relation: 'delete',
        subjectId: undefined,
        subjectSetNamespace: 'Agent',
        subjectSetObject: AGENT_ID,
        subjectSetRelation: '',
      });
    });
  });

  describe('canReadPacks', () => {
    it('checks pack permissions in one batch request', async () => {
      mockPermissionApi.batchCheckPermission.mockResolvedValue({
        results: [{ allowed: true }, { allowed: false }],
      });

      const result = await checker.canReadPacks(
        [DIARY_ID, ENTRY_ID],
        AGENT_ID,
        KetoNamespace.Agent,
      );

      expect(result).toEqual(
        new Map([
          [DIARY_ID, true],
          [ENTRY_ID, false],
        ]),
      );
      expect(mockPermissionApi.batchCheckPermission).toHaveBeenCalledWith({
        batchCheckPermissionBody: {
          tuples: [
            {
              namespace: 'ContextPack',
              object: DIARY_ID,
              relation: 'read',
              subject_set: {
                namespace: 'Agent',
                object: AGENT_ID,
                relation: '',
              },
            },
            {
              namespace: 'ContextPack',
              object: ENTRY_ID,
              relation: 'read',
              subject_set: {
                namespace: 'Agent',
                object: AGENT_ID,
                relation: '',
              },
            },
          ],
        },
      });
    });

    it('throws when the batch API errors', async () => {
      mockPermissionApi.batchCheckPermission.mockRejectedValue(
        new Error('Keto unavailable'),
      );

      await expect(
        checker.canReadPacks(
          [DIARY_ID, ENTRY_ID],
          AGENT_ID,
          KetoNamespace.Agent,
        ),
      ).rejects.toThrow('Keto unavailable');
    });

    it('throws when Keto returns per-item errors in the batch result', async () => {
      mockPermissionApi.batchCheckPermission.mockResolvedValue({
        results: [
          { allowed: true },
          { allowed: false, error: 'resolution failed' },
        ],
      });

      await expect(
        checker.canReadPacks(
          [DIARY_ID, ENTRY_ID],
          AGENT_ID,
          KetoNamespace.Agent,
        ),
      ).rejects.toThrow(
        `batch permission check failed for ${ENTRY_ID}: resolution failed`,
      );
    });
  });

  describe('canVerifyClaimPack', () => {
    it('checks verify_claim permission on ContextPack namespace', async () => {
      mockPermissionApi.checkPermission.mockResolvedValue({
        allowed: true,
      });

      const result = await checker.canVerifyClaimPack(
        DIARY_ID,
        AGENT_ID,
        KetoNamespace.Agent,
      );

      expect(result).toBe(true);
      expect(mockPermissionApi.checkPermission).toHaveBeenCalledWith({
        namespace: 'ContextPack',
        object: DIARY_ID,
        relation: 'verify_claim',
        subjectId: undefined,
        subjectSetNamespace: 'Agent',
        subjectSetObject: AGENT_ID,
        subjectSetRelation: '',
      });
    });
  });
});
