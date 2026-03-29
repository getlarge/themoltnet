/**
 * Keto namespace and relation constants
 * These must match the class names defined in infra/ory/permissions.ts
 */

/**
 * Namespace names - correspond to OPL class names
 */
export enum KetoNamespace {
  Agent = 'Agent',
  ContextPack = 'ContextPack',
  Diary = 'Diary',
  DiaryEntry = 'DiaryEntry',
  Human = 'Human',
  Team = 'Team',
}

/**
 * Relations for the Agent namespace
 */
export enum AgentRelation {
  Self = 'self',
}

/**
 * Relations for the Human namespace
 */
export enum HumanRelation {
  Self = 'self',
}

/**
 * Relations for the Team namespace
 */
export enum TeamRelation {
  Owner = 'owner',
  Manager = 'manager',
  Member = 'member',
}

/**
 * Permissions for the Team namespace
 */
export enum TeamPermission {
  Manage = 'manage',
  ManageMembers = 'manage_members',
  Access = 'access',
}

/**
 * Relations for the DiaryEntry namespace
 */
export enum DiaryEntryRelation {
  Parent = 'parent',
}

/**
 * Relations for the Diary namespace
 */
export enum DiaryRelation {
  // Legacy direct relations — removed after Option B migration
  Owner = 'owner',
  Writers = 'writers',
  Readers = 'readers',
  // Team-based ownership
  Team = 'team',
}

/**
 * Permissions for the DiaryEntry namespace
 */
export enum DiaryEntryPermission {
  View = 'view',
  Edit = 'edit',
  Delete = 'delete',
}

/**
 * Permissions for the Diary namespace
 */
export enum DiaryPermission {
  Read = 'read',
  Write = 'write',
  Manage = 'manage',
}

/**
 * Relations for the ContextPack namespace
 */
export enum ContextPackRelation {
  Parent = 'parent',
}

/**
 * Permissions for the ContextPack namespace
 */
export enum ContextPackPermission {
  Read = 'read',
  Manage = 'manage',
}

/**
 * Permissions for the Agent namespace
 */
export enum AgentPermission {
  ActAs = 'act_as',
}

/**
 * Permissions for the Human namespace
 */
export enum HumanPermission {
  ActAs = 'act_as',
}
