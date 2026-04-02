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
  Group = 'Group',
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
  Owners = 'owners',
  Managers = 'managers',
  Members = 'members',
}

/**
 * Permissions for the Team namespace
 */
export enum TeamPermission {
  Manage = 'manage',
  ManageMembers = 'manage_members',
  Write = 'write',
  Access = 'access',
}

/**
 * Relations for the Group namespace
 */
export enum GroupRelation {
  Members = 'members',
  Parent = 'parent',
}

/**
 * Permissions for the Group namespace
 */
export enum GroupPermission {
  Manage = 'manage',
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
  // Team-based ownership
  Team = 'team',
  // Per-diary grants (chunk 3 routes — forward-declared for OPL)
  Writers = 'writers',
  Managers = 'managers',
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
  VerifyClaim = 'verify_claim',
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
