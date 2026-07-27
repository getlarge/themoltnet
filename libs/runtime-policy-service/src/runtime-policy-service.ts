import type {
  KetoNamespace,
  PermissionChecker,
  RelationshipReader,
  RelationshipWriter,
} from '@moltnet/auth';
import type {
  RuntimePolicy as RuntimePolicyRow,
  RuntimePolicyRepository,
  TransactionRunner,
} from '@moltnet/database';
import type { ToolEnforcement } from '@moltnet/models';

import { createProblem, createValidationProblem } from './problems.js';

export type { ToolEnforcement } from '@moltnet/models';

const TOOL_NAME_RE = /^[a-zA-Z0-9_.:-]{1,128}$/;
const MAX_DESCRIPTION_LENGTH = 4096;

export interface RuntimePolicySubject {
  identityId: string;
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
}

export interface AllowedTools {
  enforcement: ToolEnforcement;
  allowedTools: string[];
}

export interface RuntimePolicyServiceDeps {
  runtimePolicyRepository: RuntimePolicyRepository;
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
  const cleaned = [...new Set(tools.map((tool) => tool.trim()))].filter(
    Boolean,
  );
  const invalid = cleaned.filter((tool) => !TOOL_NAME_RE.test(tool));
  if (invalid.length > 0) {
    throw createValidationProblem(
      [{ field, message: `Invalid tool name(s): ${invalid.join(', ')}` }],
      'Invalid tool names',
    );
  }
  return cleaned;
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

      const creator =
        input.subject.subjectType === 'agent'
          ? { createdByAgentId: input.subject.identityId }
          : { createdByHumanId: input.subject.identityId };

      const row = await deps.runtimePolicyRepository.create({
        teamId: input.teamId,
        name,
        description,
        ...creator,
      });

      await deps.relationshipWriter.writeRuntimePolicyEdges(row.id, {
        teamId: input.teamId,
        addTools: tools,
      });

      return { ...toRuntimePolicy(row), tools };
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
      const tools = await deps.relationshipReader.listRuntimePolicyTools(
        row.id,
      );
      return { ...toRuntimePolicy(row), tools };
    },

    async update(
      id: string,
      patch: UpdateRuntimePolicyPatch,
      input: TeamScopedInput,
    ): Promise<RuntimePolicyWithTools> {
      await assertCanManageRuntime(input.subject, input.teamId);
      let row = await requirePolicyForTeam(id, input.teamId);

      const sqlPatch: { name?: string; description?: string | null } = {};
      if (patch.name !== undefined) sqlPatch.name = requireName(patch.name);
      if (patch.description !== undefined) {
        sqlPatch.description = normalizeDescription(patch.description);
      }
      if (Object.keys(sqlPatch).length > 0) {
        const updated = await deps.runtimePolicyRepository.update(
          id,
          input.teamId,
          sqlPatch,
        );
        if (!updated) throw createProblem('not-found');
        row = updated;
      }

      const removeTools = normalizeToolNames(
        patch.removeTools ?? [],
        'removeTools',
      );
      const addTools = normalizeToolNames(patch.addTools ?? [], 'addTools');
      await deps.relationshipWriter.writeRuntimePolicyEdges(id, {
        addTools,
        removeTools,
      });

      const tools = await deps.relationshipReader.listRuntimePolicyTools(id);
      return { ...toRuntimePolicy(row), tools };
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
      const enforcement =
        await deps.runtimePolicyRepository.getProfileEnforcement(
          input.profileId,
          input.teamId,
        );
      if (enforcement === null) throw createProblem('not-found');

      const policyIds =
        await deps.relationshipReader.listRuntimeProfilePolicies(
          input.profileId,
        );
      const toolLists = await Promise.all(
        policyIds.map((policyId) =>
          deps.relationshipReader.listRuntimePolicyTools(policyId),
        ),
      );
      const allowedTools = [...new Set(toolLists.flat())].sort();
      return { enforcement, allowedTools };
    },
  };
}

export type RuntimePolicyService = ReturnType<
  typeof createRuntimePolicyService
>;
