import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createPermissionChecker,
  type PermissionChecker,
} from '../src/permission-checker.js';

interface MockPermissionApi {
  checkPermission: ReturnType<typeof vi.fn>;
}

interface MockRelationshipApi {
  createRelationship: ReturnType<typeof vi.fn>;
  deleteRelationships: ReturnType<typeof vi.fn>;
}

function createMockPermissionApi(): MockPermissionApi {
  return { checkPermission: vi.fn() };
}

function createMockRelationshipApi(): MockRelationshipApi {
  return {
    createRelationship: vi.fn(),
    deleteRelationships: vi.fn(),
  };
}

const AGENT_ID = '550e8400-e29b-41d4-a716-446655440000';
const OTHER_AGENT_ID = '660e8400-e29b-41d4-a716-446655440001';
const ENTRY_ID = '770e8400-e29b-41d4-a716-446655440002';

describe('PermissionChecker', () => {
  let mockPermissionApi: MockPermissionApi;
  let mockRelationshipApi: MockRelationshipApi;
  let checker: PermissionChecker;

  beforeEach(() => {
    mockPermissionApi = createMockPermissionApi();
    mockRelationshipApi = createMockRelationshipApi();
    checker = createPermissionChecker(
      mockPermissionApi as any,

      mockRelationshipApi as any,
    );
  });

  describe('canViewEntry', () => {
    it('returns true when agent has view permission', async () => {
      mockPermissionApi.checkPermission.mockResolvedValue({
        data: { allowed: true },
      });

      const result = await checker.canViewEntry(ENTRY_ID, AGENT_ID);

      expect(result).toBe(true);
      expect(mockPermissionApi.checkPermission).toHaveBeenCalledWith({
        namespace: 'DiaryEntry',
        object: ENTRY_ID,
        relation: 'view',
        subjectId: AGENT_ID,
      });
    });

    it('returns false when agent lacks view permission', async () => {
      mockPermissionApi.checkPermission.mockResolvedValue({
        data: { allowed: false },
      });

      const result = await checker.canViewEntry(ENTRY_ID, AGENT_ID);

      expect(result).toBe(false);
    });

    it('returns false on API error', async () => {
      mockPermissionApi.checkPermission.mockRejectedValue(
        new Error('Keto unavailable'),
      );

      const result = await checker.canViewEntry(ENTRY_ID, AGENT_ID);

      expect(result).toBe(false);
    });
  });

  describe('canEditEntry', () => {
    it('returns true when agent is owner', async () => {
      mockPermissionApi.checkPermission.mockResolvedValue({
        data: { allowed: true },
      });

      const result = await checker.canEditEntry(ENTRY_ID, AGENT_ID);

      expect(result).toBe(true);
      expect(mockPermissionApi.checkPermission).toHaveBeenCalledWith({
        namespace: 'DiaryEntry',
        object: ENTRY_ID,
        relation: 'edit',
        subjectId: AGENT_ID,
      });
    });

    it('returns false when agent is not owner', async () => {
      mockPermissionApi.checkPermission.mockResolvedValue({
        data: { allowed: false },
      });

      const result = await checker.canEditEntry(ENTRY_ID, OTHER_AGENT_ID);

      expect(result).toBe(false);
    });
  });

  describe('canDeleteEntry', () => {
    it('checks delete permission', async () => {
      mockPermissionApi.checkPermission.mockResolvedValue({
        data: { allowed: true },
      });

      const result = await checker.canDeleteEntry(ENTRY_ID, AGENT_ID);

      expect(result).toBe(true);
      expect(mockPermissionApi.checkPermission).toHaveBeenCalledWith({
        namespace: 'DiaryEntry',
        object: ENTRY_ID,
        relation: 'delete',
        subjectId: AGENT_ID,
      });
    });
  });

  describe('canShareEntry', () => {
    it('checks share permission', async () => {
      mockPermissionApi.checkPermission.mockResolvedValue({
        data: { allowed: true },
      });

      const result = await checker.canShareEntry(ENTRY_ID, AGENT_ID);

      expect(result).toBe(true);
      expect(mockPermissionApi.checkPermission).toHaveBeenCalledWith({
        namespace: 'DiaryEntry',
        object: ENTRY_ID,
        relation: 'share',
        subjectId: AGENT_ID,
      });
    });
  });

  describe('grantOwnership', () => {
    it('creates owner relation tuple', async () => {
      mockRelationshipApi.createRelationship.mockResolvedValue({
        data: {},
      });

      await checker.grantOwnership(ENTRY_ID, AGENT_ID);

      expect(mockRelationshipApi.createRelationship).toHaveBeenCalledWith({
        createRelationshipBody: {
          namespace: 'DiaryEntry',
          object: ENTRY_ID,
          relation: 'owner',
          subject_id: AGENT_ID,
        },
      });
    });

    it('throws on API error', async () => {
      mockRelationshipApi.createRelationship.mockRejectedValue(
        new Error('Keto unavailable'),
      );

      await expect(checker.grantOwnership(ENTRY_ID, AGENT_ID)).rejects.toThrow(
        'Keto unavailable',
      );
    });
  });

  describe('grantViewer', () => {
    it('creates viewer relation tuple', async () => {
      mockRelationshipApi.createRelationship.mockResolvedValue({
        data: {},
      });

      await checker.grantViewer(ENTRY_ID, OTHER_AGENT_ID);

      expect(mockRelationshipApi.createRelationship).toHaveBeenCalledWith({
        createRelationshipBody: {
          namespace: 'DiaryEntry',
          object: ENTRY_ID,
          relation: 'viewer',
          subject_id: OTHER_AGENT_ID,
        },
      });
    });
  });

  describe('revokeViewer', () => {
    it('deletes viewer relation tuple', async () => {
      mockRelationshipApi.deleteRelationships.mockResolvedValue({
        data: {},
      });

      await checker.revokeViewer(ENTRY_ID, OTHER_AGENT_ID);

      expect(mockRelationshipApi.deleteRelationships).toHaveBeenCalledWith({
        namespace: 'DiaryEntry',
        object: ENTRY_ID,
        relation: 'viewer',
        subjectId: OTHER_AGENT_ID,
      });
    });
  });

  describe('registerAgent', () => {
    it('creates agent self relation', async () => {
      mockRelationshipApi.createRelationship.mockResolvedValue({
        data: {},
      });

      await checker.registerAgent(AGENT_ID);

      expect(mockRelationshipApi.createRelationship).toHaveBeenCalledWith({
        createRelationshipBody: {
          namespace: 'Agent',
          object: AGENT_ID,
          relation: 'self',
          subject_id: AGENT_ID,
        },
      });
    });
  });

  describe('removeEntryRelations', () => {
    it('deletes all relations for an entry', async () => {
      mockRelationshipApi.deleteRelationships.mockResolvedValue({
        data: {},
      });

      await checker.removeEntryRelations(ENTRY_ID);

      expect(mockRelationshipApi.deleteRelationships).toHaveBeenCalledWith({
        namespace: 'DiaryEntry',
        object: ENTRY_ID,
      });
    });
  });
});
