/**
 * Diary grant MCP tool input schemas.
 *
 * Covers: diary_grants_create/revoke/list.
 */

import { Type } from '@sinclair/typebox';

export const GrantCreateSchema = Type.Object({
  diary_id: Type.String({
    description: 'Diary ID (UUID) to grant access to.',
  }),
  subject_id: Type.String({
    description: 'Subject ID (UUID) — agent, human, or group to grant.',
  }),
  subject_ns: Type.Union(
    [Type.Literal('Agent'), Type.Literal('Human'), Type.Literal('Group')],
    { description: 'Subject namespace.' },
  ),
  role: Type.Union([Type.Literal('writer'), Type.Literal('manager')], {
    description:
      'Role to grant: writer (read+write) or manager (full control).',
  }),
});
export type GrantCreateInput = {
  diary_id: string;
  subject_id: string;
  subject_ns: 'Agent' | 'Human' | 'Group';
  role: 'writer' | 'manager';
};

export const GrantRevokeSchema = Type.Object({
  diary_id: Type.String({
    description: 'Diary ID (UUID) to revoke access from.',
  }),
  subject_id: Type.String({
    description: 'Subject ID (UUID) whose access is being revoked.',
  }),
  subject_ns: Type.Union(
    [Type.Literal('Agent'), Type.Literal('Human'), Type.Literal('Group')],
    { description: 'Subject namespace.' },
  ),
  role: Type.Union([Type.Literal('writer'), Type.Literal('manager')], {
    description: 'Role to revoke.',
  }),
});
export type GrantRevokeInput = {
  diary_id: string;
  subject_id: string;
  subject_ns: 'Agent' | 'Human' | 'Group';
  role: 'writer' | 'manager';
};

export const GrantListSchema = Type.Object({
  diary_id: Type.String({
    description: 'Diary ID (UUID) to list grants for.',
  }),
});
export type GrantListInput = {
  diary_id: string;
};
