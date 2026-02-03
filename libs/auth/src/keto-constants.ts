/**
 * Keto namespace and relation constants
 * These must match the class names defined in infra/ory/permissions.ts
 */

/**
 * Namespace names - correspond to OPL class names
 */
export enum KetoNamespace {
  Agent = 'Agent',
  DiaryEntry = 'DiaryEntry',
}

/**
 * Relations for the Agent namespace
 */
export enum AgentRelation {
  Self = 'self',
}

/**
 * Relations for the DiaryEntry namespace
 */
export enum DiaryEntryRelation {
  Owner = 'owner',
  Viewer = 'viewer',
  Parent = 'parent',
}

/**
 * Permissions for the DiaryEntry namespace
 */
export enum DiaryEntryPermission {
  View = 'view',
  Edit = 'edit',
  Delete = 'delete',
  Share = 'share',
}

/**
 * Permissions for the Agent namespace
 */
export enum AgentPermission {
  ActAs = 'act_as',
}
