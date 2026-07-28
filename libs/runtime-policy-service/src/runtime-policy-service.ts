import { createHash } from 'node:crypto';

import type {
  KetoNamespace,
  PermissionChecker,
  RelationshipReader,
  RelationshipWriter,
  ShellCommandRule,
} from '@moltnet/auth';
import {
  decodeShellCommandIdentifier,
  encodeShellCommandRule,
  normalizeShellCommandRules,
  ShellCommandIdentifierError,
} from '@moltnet/auth';
import type {
  RuntimePolicy as RuntimePolicyRow,
  RuntimePolicyRepository,
  RuntimePolicySnapshotRepository,
  TransactionRunner,
} from '@moltnet/database';
import {
  findUnavailableRuntimeCapabilities,
  getRuntimeCapabilityManifest,
  type RuntimeKind,
  type ToolEnforcement,
} from '@moltnet/models';

import { createProblem, createValidationProblem } from './problems.js';

export type { ToolEnforcement } from '@moltnet/models';

const TOOL_NAME_RE = /^[a-zA-Z0-9_.:-]{1,128}$/;
const MAX_DESCRIPTION_LENGTH = 4096;

export interface RuntimePolicySubject {
  /** Kratos identity id used for Keto authorization checks. */
  identityId: string;
  /** Repository FK id (`humans.id` for humans, identity id for agents). */
  creatorId: string;
  subjectNs: KetoNamespace;
  subjectType: 'agent' | 'human';
}

export interface RuntimePolicy {
  id: string;
  teamId: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimePolicyWithTools extends RuntimePolicy {
  tools: string[];
  shellCommands: ShellCommandRule[];
}

export interface AllowedTools {
  enforcement: ToolEnforcement;
  allowedTools: string[];
  allowedShellCommands: ShellCommandRule[];
  runtimeKind: RuntimeKind;
  capabilityManifestVersion: string;
  runtimeProfileRevision: number;
  policySnapshotHash: string;
}

export interface RuntimePolicyServiceDeps {
  runtimePolicyRepository: RuntimePolicyRepository;
  runtimePolicySnapshotRepository: RuntimePolicySnapshotRepository;
  relationshipReader: RelationshipReader;
  relationshipWriter: RelationshipWriter;
  permissionChecker: PermissionChecker;
  transactionRunner: TransactionRunner;
}

export interface CreateRuntimePolicyInput {
  teamId: string;
  name: string;
  description?: string;
  tools: string[];
  shellCommands?: ShellCommandRule[];
  subject: RuntimePolicySubject;
}

export interface TeamScopedInput {
  teamId: string;
  subject: RuntimePolicySubject;
}

export interface UpdateRuntimePolicyPatch {
  name?: string;
  description?: string | null;
  addTools?: string[];
  removeTools?: string[];
  addShellCommands?: ShellCommandRule[];
  removeShellCommands?: ShellCommandRule[];
}

export interface ResolveAllowedToolsInput {
  profileId: string;
  teamId: string;
}

function toRuntimePolicy(row: RuntimePolicyRow): RuntimePolicy {
  return {
    id: row.id,
    teamId: row.teamId,
    name: row.name,
    description: row.description ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Trim + de-dupe tool names and reject any that fail the name charset. */
function normalizeToolNames(tools: readonly string[], field: string): string[] {
  const containsNewline = tools.filter((tool) => /[\r\n]/.test(tool));
  const cleaned = [...new Set(tools.map((tool) => tool.trim()))].filter(
    Boolean,
  );
  const invalid = [
    ...new Set([
      ...containsNewline,
      ...cleaned.filter((tool) => !TOOL_NAME_RE.test(tool)),
    ]),
  ];
  if (invalid.length > 0) {
    throw createValidationProblem(
      [{ field, message: `Invalid tool name(s): ${invalid.join(', ')}` }],
      'Invalid tool names',
    );
  }
  return cleaned.sort();
}

function normalizeShellCommands(
  rules: readonly ShellCommandRule[],
  field: string,
): ShellCommandRule[] {
  try {
    return normalizeShellCommandRules(rules);
  } catch (error) {
    if (!(error instanceof ShellCommandIdentifierError)) throw error;
    throw createValidationProblem(
      [{ field, message: error.message }],
      'Invalid shell commands',
    );
  }
}

function validateRuntimeCapabilities(
  runtimeKind: RuntimeKind,
  tools: readonly string[],
  field: string,
): void {
  const unavailable = findUnavailableRuntimeCapabilities(runtimeKind, tools);
  if (unavailable.length > 0) {
    throw createValidationProblem(
      [
        {
          field,
          message:
            `Unavailable for runtime ${runtimeKind}: ` + unavailable.join(', '),
        },
      ],
      'Unsupported runtime capabilities',
    );
  }
}

function decodeStoredShellCommands(
  identifiers: readonly string[],
): ShellCommandRule[] {
  // Malformed Keto objects are authorization data corruption. Propagate the
  // decoder error so resolution fails closed rather than silently dropping a
  // grant.
  return normalizeShellCommandRules(
    identifiers.map(decodeShellCommandIdentifier),
  );
}

export const EFFECTIVE_POLICY_SNAPSHOT_SCHEMA_VERSION =
  'effective-policy:v1' as const;

export interface EffectivePolicySnapshotV1 {
  version: typeof EFFECTIVE_POLICY_SNAPSHOT_SCHEMA_VERSION;
  runtimeKind: RuntimeKind;
  capabilityManifestVersion: string;
  enforcement: ToolEnforcement;
  allowedTools: string[];
  allowedShellCommands: ShellCommandRule[];
}

export function canonicalEffectivePolicySnapshot(input: {
  runtimeKind: RuntimeKind;
  enforcement: ToolEnforcement;
  allowedTools: readonly string[];
  allowedShellCommands: readonly ShellCommandRule[];
}): EffectivePolicySnapshotV1 {
  return {
    version: EFFECTIVE_POLICY_SNAPSHOT_SCHEMA_VERSION,
    runtimeKind: input.runtimeKind,
    capabilityManifestVersion: getRuntimeCapabilityManifest(input.runtimeKind)
      .version,
    enforcement: input.enforcement,
    allowedTools: [...new Set(input.allowedTools)].sort(),
    allowedShellCommands: normalizeShellCommandRules(
      input.allowedShellCommands,
    ),
  };
}

export function hashEffectivePolicySnapshot(
  snapshot: EffectivePolicySnapshotV1,
): string {
  const canonical = JSON.stringify({
    version: snapshot.version,
    runtimeKind: snapshot.runtimeKind,
    capabilityManifestVersion: snapshot.capabilityManifestVersion,
    enforcement: snapshot.enforcement,
    allowedTools: snapshot.allowedTools,
    allowedShellCommands: snapshot.allowedShellCommands,
  });
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}

function requireName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw createValidationProblem(
      [{ field: 'name', message: 'Name must contain a non-space character' }],
      'Invalid runtime policy name',
    );
  }
  return trimmed;
}

function normalizeDescription(
  description: string | null | undefined,
): string | null {
  if (description === null || description === undefined) return null;
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw createValidationProblem(
      [
        {
          field: 'description',
          message: `Description must be at most ${MAX_DESCRIPTION_LENGTH} characters`,
        },
      ],
      'Invalid runtime policy description',
    );
  }
  return description;
}

export function createRuntimePolicyService(deps: RuntimePolicyServiceDeps) {
  async function readPolicyGrants(policyIds: readonly string[]): Promise<{
    tools: string[];
    shellCommands: string[];
  }> {
    if (deps.relationshipReader.listRuntimePolicyGrants) {
      return deps.relationshipReader.listRuntimePolicyGrants(policyIds);
    }
    const grants = await Promise.all(
      policyIds.map(async (policyId) => {
        const [tools, shellCommands] = await Promise.all([
          deps.relationshipReader.listRuntimePolicyTools(policyId),
          deps.relationshipReader.listRuntimePolicyShellCommands(policyId),
        ]);
        return { tools, shellCommands };
      }),
    );
    return {
      tools: grants.flatMap((grant) => grant.tools),
      shellCommands: grants.flatMap((grant) => grant.shellCommands),
    };
  }

  async function assertCanManageRuntime(
    subject: RuntimePolicySubject,
    teamId: string,
  ): Promise<void> {
    const allowed = await deps.permissionChecker.canManageTeamRuntime(
      teamId,
      subject.identityId,
      subject.subjectNs,
    );
    if (!allowed) throw createProblem('forbidden');
  }

  async function requirePolicyForTeam(
    id: string,
    teamId: string,
  ): Promise<RuntimePolicyRow> {
    const row = await deps.runtimePolicyRepository.findByIdForTeam(id, teamId);
    if (!row) throw createProblem('not-found');
    return row;
  }

  return {
    async create(
      input: CreateRuntimePolicyInput,
    ): Promise<RuntimePolicyWithTools> {
      await assertCanManageRuntime(input.subject, input.teamId);
      const name = requireName(input.name);
      const description = normalizeDescription(input.description);
      const tools = normalizeToolNames(input.tools, 'tools');
      const shellCommands = normalizeShellCommands(
        input.shellCommands ?? [],
        'shellCommands',
      );
      validateRuntimeCapabilities('gondolin_pi', tools, 'tools');

      const creator =
        input.subject.subjectType === 'agent'
          ? { createdByAgentId: input.subject.creatorId }
          : { createdByHumanId: input.subject.creatorId };

      const row = await deps.runtimePolicyRepository.create({
        teamId: input.teamId,
        name,
        description,
        ...creator,
      });

      await deps.relationshipWriter.writeRuntimePolicyEdges(row.id, {
        teamId: input.teamId,
        addTools: tools,
        ...(shellCommands.length > 0
          ? {
              addShellCommands: shellCommands.map(encodeShellCommandRule),
            }
          : {}),
      });

      return { ...toRuntimePolicy(row), tools, shellCommands };
    },

    async list(input: TeamScopedInput): Promise<RuntimePolicy[]> {
      await assertCanManageRuntime(input.subject, input.teamId);
      const rows = await deps.runtimePolicyRepository.listByTeam(input.teamId);
      return rows.map(toRuntimePolicy);
    },

    async get(
      id: string,
      input: TeamScopedInput,
    ): Promise<RuntimePolicyWithTools> {
      await assertCanManageRuntime(input.subject, input.teamId);
      const row = await requirePolicyForTeam(id, input.teamId);
      const [tools, commandIds] = await Promise.all([
        deps.relationshipReader.listRuntimePolicyTools(row.id),
        deps.relationshipReader.listRuntimePolicyShellCommands(row.id),
      ]);
      return {
        ...toRuntimePolicy(row),
        tools,
        shellCommands: decodeStoredShellCommands(commandIds),
      };
    },

    async update(
      id: string,
      patch: UpdateRuntimePolicyPatch,
      input: TeamScopedInput,
    ): Promise<RuntimePolicyWithTools> {
      await assertCanManageRuntime(input.subject, input.teamId);
      const sqlPatch: { name?: string; description?: string | null } = {};
      if (patch.name !== undefined) sqlPatch.name = requireName(patch.name);
      if (patch.description !== undefined) {
        sqlPatch.description = normalizeDescription(patch.description);
      }
      const removeTools = normalizeToolNames(
        patch.removeTools ?? [],
        'removeTools',
      );
      const addTools = normalizeToolNames(patch.addTools ?? [], 'addTools');
      const removeShellCommands = normalizeShellCommands(
        patch.removeShellCommands ?? [],
        'removeShellCommands',
      );
      const addShellCommands = normalizeShellCommands(
        patch.addShellCommands ?? [],
        'addShellCommands',
      );

      return deps.transactionRunner.runInTransaction(
        async () => {
          await deps.runtimePolicyRepository.lockRuntimePolicy(id);
          let row = await requirePolicyForTeam(id, input.teamId);
          const [currentTools, currentCommandIds] = await Promise.all([
            deps.relationshipReader.listRuntimePolicyTools(id),
            deps.relationshipReader.listRuntimePolicyShellCommands(id),
          ]);
          const removedCommandIds = new Set(
            removeShellCommands.map(encodeShellCommandRule),
          );
          const finalTools = [
            ...new Set([
              ...currentTools.filter((tool) => !removeTools.includes(tool)),
              ...addTools,
            ]),
          ].sort();
          validateRuntimeCapabilities('gondolin_pi', finalTools, 'addTools');
          const finalShellCommands = normalizeShellCommandRules([
            ...decodeStoredShellCommands(currentCommandIds).filter(
              (rule) => !removedCommandIds.has(encodeShellCommandRule(rule)),
            ),
            ...addShellCommands,
          ]);

          if (Object.keys(sqlPatch).length > 0) {
            const updated = await deps.runtimePolicyRepository.update(
              id,
              input.teamId,
              sqlPatch,
            );
            if (!updated) throw createProblem('not-found');
            row = updated;
          }

          // Keep metadata uncommitted until Keto accepts the grant delta. A
          // Keto failure rejects the transaction so the SQL update rolls back.
          await deps.relationshipWriter.writeRuntimePolicyEdges(id, {
            addTools,
            removeTools,
            ...(addShellCommands.length > 0
              ? {
                  addShellCommands: addShellCommands.map(
                    encodeShellCommandRule,
                  ),
                }
              : {}),
            ...(removeShellCommands.length > 0
              ? {
                  removeShellCommands: removeShellCommands.map(
                    encodeShellCommandRule,
                  ),
                }
              : {}),
          });

          return {
            ...toRuntimePolicy(row),
            tools: finalTools,
            shellCommands: finalShellCommands,
          };
        },
        { name: 'updateRuntimePolicy' },
      );
    },

    async delete(id: string, input: TeamScopedInput): Promise<void> {
      await assertCanManageRuntime(input.subject, input.teamId);
      const existing = await requirePolicyForTeam(id, input.teamId);
      // Revoke Keto grants FIRST (idempotent), then delete the SQL row. If the
      // Keto call fails the row remains, so the operation is safely retryable —
      // this avoids a "deleted" policy whose grants keep authorizing tools.
      await deps.relationshipWriter.removeRuntimePolicyRelations(existing.id);
      // Any inbound RuntimeProfile#policies binding to this id is left dangling
      // but resolves to no tools (fail-closed) until it is re-bound.
      await deps.runtimePolicyRepository.delete(existing.id, input.teamId);
    },

    async setProfilePolicies(
      profileId: string,
      policyIds: string[],
      input: TeamScopedInput,
    ): Promise<void> {
      await assertCanManageRuntime(input.subject, input.teamId);
      const desired = [...new Set(policyIds)];

      // Serialize concurrent replacements for the same profile: a transaction
      // holds a profile-scoped advisory lock across the read/diff/write so two
      // replacements can't interleave and leave the union of both requests.
      await deps.transactionRunner.runInTransaction(
        async () => {
          await deps.runtimePolicyRepository.lockProfileBindings(profileId);

          const profileExists =
            await deps.runtimePolicyRepository.profileExistsForTeam(
              profileId,
              input.teamId,
            );
          if (!profileExists) throw createProblem('not-found');

          const profileContext =
            await deps.runtimePolicyRepository.getProfilePolicyContext(
              profileId,
              input.teamId,
            );
          if (!profileContext) throw createProblem('not-found');

          // Validate every desired policy belongs to the team in ONE query.
          const existingIds =
            await deps.runtimePolicyRepository.findExistingIdsForTeam(
              desired,
              input.teamId,
            );
          const missing = desired.filter((id) => !existingIds.has(id));
          if (missing.length > 0) {
            throw createValidationProblem(
              [
                {
                  field: 'policyIds',
                  message: `Policies do not exist in this team: ${missing.join(', ')}`,
                },
              ],
              'Unknown runtime policy',
            );
          }

          const desiredToolLists = await Promise.all(
            desired.map((policyId) =>
              deps.relationshipReader.listRuntimePolicyTools(policyId),
            ),
          );
          validateRuntimeCapabilities(
            profileContext.runtimeKind,
            desiredToolLists.flat(),
            'policyIds',
          );

          const current =
            await deps.relationshipReader.listRuntimeProfilePolicies(profileId);
          const currentSet = new Set(current);
          const desiredSet = new Set(desired);
          const toRemove = current.filter((id) => !desiredSet.has(id));
          const toAdd = desired.filter((id) => !currentSet.has(id));

          await deps.relationshipWriter.writeRuntimeProfilePolicyEdges(
            profileId,
            { addPolicyIds: toAdd, removePolicyIds: toRemove },
          );
        },
        { name: 'setProfilePolicies' },
      );
    },

    /**
     * Read the policy IDs currently bound to a profile (team-scoped). Lets a
     * client inspect and safely edit a profile's bindings rather than only
     * seeing the flattened allowed-tool union.
     */
    async getProfilePolicies(
      profileId: string,
      input: TeamScopedInput,
    ): Promise<{ policyIds: string[] }> {
      await assertCanManageRuntime(input.subject, input.teamId);
      const profileExists =
        await deps.runtimePolicyRepository.profileExistsForTeam(
          profileId,
          input.teamId,
        );
      if (!profileExists) throw createProblem('not-found');
      const policyIds =
        await deps.relationshipReader.listRuntimeProfilePolicies(profileId);
      return { policyIds };
    },

    /**
     * Resolve a profile's effective allow-set: its enforcement mode plus the
     * union of tools across every bound policy. Team-scoped — a profile that
     * does not belong to `teamId` resolves to not-found (fail-closed).
     */
    async resolveAllowedTools(
      input: ResolveAllowedToolsInput,
    ): Promise<AllowedTools> {
      const profileContext =
        await deps.runtimePolicyRepository.getProfilePolicyContext(
          input.profileId,
          input.teamId,
        );
      if (profileContext === null) throw createProblem('not-found');

      const policyIds =
        await deps.relationshipReader.listRuntimeProfilePolicies(
          input.profileId,
        );
      const grants = await readPolicyGrants(policyIds);
      const allowedTools = [...new Set(grants.tools)].sort();
      const allowedShellCommands = decodeStoredShellCommands(
        grants.shellCommands,
      );
      validateRuntimeCapabilities(
        profileContext.runtimeKind,
        allowedTools,
        'allowedTools',
      );
      const snapshot = canonicalEffectivePolicySnapshot({
        runtimeKind: profileContext.runtimeKind,
        enforcement: profileContext.enforcement,
        allowedTools,
        allowedShellCommands,
      });
      const policySnapshotHash = hashEffectivePolicySnapshot(snapshot);
      await deps.runtimePolicySnapshotRepository.persist({
        hash: policySnapshotHash,
        schemaVersion: snapshot.version,
        runtimeKind: snapshot.runtimeKind,
        capabilityManifestVersion: snapshot.capabilityManifestVersion,
        enforcement: snapshot.enforcement,
        allowedTools: snapshot.allowedTools,
        allowedShellCommands: snapshot.allowedShellCommands,
      });
      return {
        enforcement: profileContext.enforcement,
        allowedTools,
        allowedShellCommands,
        runtimeKind: profileContext.runtimeKind,
        capabilityManifestVersion: snapshot.capabilityManifestVersion,
        runtimeProfileRevision: profileContext.revision,
        policySnapshotHash,
      };
    },
  };
}

export type RuntimePolicyService = ReturnType<
  typeof createRuntimePolicyService
>;
