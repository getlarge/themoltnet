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
  RuntimePolicy = 'RuntimePolicy',
  RuntimeProfile = 'RuntimeProfile',
  ShellCommand = 'ShellCommand',
  Task = 'Task',
  Team = 'Team',
  Tool = 'Tool',
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
  ManageCredentials = 'manage_credentials',
  ManageMembers = 'manage_members',
  ManageRuntime = 'manage_runtime',
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
  Propose = 'propose',
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
  Write = 'write',
  Manage = 'manage',
  VerifyClaim = 'verify_claim',
}

/**
 * Relations for the RuntimeProfile namespace.
 * A profile references the policies that gate its tool calls:
 *   RuntimeProfile:{profileId}#policies@RuntimePolicy:{policyId}
 */
export enum RuntimeProfileRelation {
  Policies = 'policies',
}

/**
 * Relations for the RuntimePolicy namespace.
 * A policy is owned by a team and grants a set of tools:
 *   RuntimePolicy:{policyId}#team@Team:{teamId}
 *   RuntimePolicy:{policyId}#tool@Tool:{toolName}
 *   RuntimePolicy:{policyId}#command@ShellCommand:{encodedPrefix}
 */
export enum RuntimePolicyRelation {
  Command = 'command',
  Team = 'team',
  Tool = 'tool',
}

/**
 * Permissions for the RuntimePolicy namespace
 */
export enum RuntimePolicyPermission {
  Manage = 'manage',
}

/**
 * Relations for the Task namespace
 */
export enum TaskRelation {
  Parent = 'parent',
  Claimant = 'claimant',
}

/**
 * Permissions for the Task namespace
 */
export enum TaskPermission {
  View = 'view',
  EditMetadata = 'edit_metadata',
  Cancel = 'cancel',
  Delete = 'delete',
  ForceDelete = 'force_delete',
  Claim = 'claim',
  Report = 'report',
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
