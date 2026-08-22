/**
 * RelationshipReader Integration Tests
 *
 * Spins up ephemeral Postgres + Keto containers via testcontainers,
 * runs Keto migrations, then tests the reader against a live Keto instance.
 *
 * Run: pnpm --filter @moltnet/auth test
 */

import * as path from 'node:path';
import * as url from 'node:url';

import {
  Configuration,
  PermissionApi,
  RelationshipApi,
} from '@ory/client-fetch';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Network, Wait } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  DiaryRelation,
  GroupRelation,
  KetoNamespace,
  RuntimePolicyRelation,
  RuntimeProfileRelation,
  TaskRelation,
  TeamRelation,
} from '../src/keto-constants.js';
import { createPermissionChecker } from '../src/permission-checker.js';
import {
  createRelationshipReader,
  type RelationshipReader,
} from '../src/relationship-reader.js';

const KETO_IMAGE = 'oryd/keto:v25.4.0';
const KETO_READ_PORT = 4466;
const KETO_WRITE_PORT = 4467;

const AGENT_ID = '550e8400-e29b-41d4-a716-446655440000';
const TEAM_ID_1 = '880e8400-e29b-41d4-a716-446655440001';
const TEAM_ID_2 = '880e8400-e29b-41d4-a716-446655440002';

const PROFILE_ID = '990e8400-e29b-41d4-a716-4466554400a0';
const POLICY_ID_1 = '990e8400-e29b-41d4-a716-4466554400b1';
const POLICY_ID_2 = '990e8400-e29b-41d4-a716-4466554400b2';

async function grantProfilePolicy(
  writeApi: RelationshipApi,
  profileId: string,
  policyId: string,
): Promise<void> {
  await writeApi.createRelationship({
    createRelationshipBody: {
      namespace: KetoNamespace.RuntimeProfile,
      object: profileId,
      relation: RuntimeProfileRelation.Policies,
      subject_set: {
        namespace: KetoNamespace.RuntimePolicy,
        object: policyId,
        relation: '',
      },
    },
  });
}

async function grantPolicyTool(
  writeApi: RelationshipApi,
  policyId: string,
  toolName: string,
): Promise<void> {
  await writeApi.createRelationship({
    createRelationshipBody: {
      namespace: KetoNamespace.RuntimePolicy,
      object: policyId,
      relation: RuntimePolicyRelation.Tool,
      subject_set: {
        namespace: KetoNamespace.Tool,
        object: toolName,
        relation: '',
      },
    },
  });
}

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
// __dirname = libs/auth/__tests__ → ../../.. = repo root
const REPO_ROOT = path.resolve(__dirname, '../../..');
const PERMISSIONS_TS_PATH = path.join(REPO_ROOT, 'infra/ory/permissions.ts');
const KETO_YAML_PATH = path.join(REPO_ROOT, 'infra/ory/keto/keto.yaml');

describe('RelationshipReader (integration)', () => {
  let reader: RelationshipReader;
  let permissionApi: PermissionApi;
  let writeApi: RelationshipApi;
  let stopContainers: () => Promise<void>;

  beforeAll(async () => {
    const network = await new Network().start();

    // 1. Start Postgres for Keto
    const postgres = await new PostgreSqlContainer('postgres:16')
      .withDatabase('ketodb')
      .withUsername('keto')
      .withPassword('keto_secret')
      .withNetwork(network)
      .withNetworkAliases('keto-postgres')
      .start();

    const dsn = `postgres://keto:keto_secret@keto-postgres:5432/ketodb?sslmode=disable`;

    // 2. Run Keto migrations
    await new GenericContainer(KETO_IMAGE)
      .withNetwork(network)
      .withEnvironment({ DSN: dsn })
      .withCopyFilesToContainer([
        {
          source: KETO_YAML_PATH,
          target: '/etc/config/keto/keto.yaml',
        },
        {
          source: PERMISSIONS_TS_PATH,
          target: '/etc/config/keto/permissions.ts',
        },
      ])
      .withCommand([
        'migrate',
        'up',
        '--yes',
        '--config',
        '/etc/config/keto/keto.yaml',
      ])
      .withWaitStrategy(Wait.forOneShotStartup())
      .start();

    // 3. Start Keto server
    const keto = await new GenericContainer(KETO_IMAGE)
      .withNetwork(network)
      .withEnvironment({ DSN: dsn })
      .withCopyFilesToContainer([
        {
          source: KETO_YAML_PATH,
          target: '/etc/config/keto/keto.yaml',
        },
        {
          source: PERMISSIONS_TS_PATH,
          target: '/etc/config/keto/permissions.ts',
        },
      ])
      .withCommand(['serve', '--config', '/etc/config/keto/keto.yaml'])
      .withExposedPorts(KETO_READ_PORT, KETO_WRITE_PORT)
      .withWaitStrategy(
        Wait.forHttp('/health/alive', KETO_READ_PORT).withStartupTimeout(
          30_000,
        ),
      )
      .start();

    const ketoReadUrl = `http://${keto.getHost()}:${keto.getMappedPort(KETO_READ_PORT)}`;
    const ketoWriteUrl = `http://${keto.getHost()}:${keto.getMappedPort(KETO_WRITE_PORT)}`;

    const readRelApi = new RelationshipApi(
      new Configuration({ basePath: ketoReadUrl }),
    );
    permissionApi = new PermissionApi(
      new Configuration({ basePath: ketoReadUrl }),
    );
    writeApi = new RelationshipApi(
      new Configuration({ basePath: ketoWriteUrl }),
    );

    reader = createRelationshipReader(readRelApi);

    stopContainers = async () => {
      await keto.stop();
      await postgres.stop();
      await network.stop();
    };
  }, 120_000);

  afterAll(async () => {
    await stopContainers?.();
  });

  it('returns empty array when agent has no team relationships', async () => {
    const ids = await reader.listTeamIdsBySubject(AGENT_ID);
    expect(ids).toEqual([]);
  });

  it('returns team ID after owner relation is written', async () => {
    // Arrange
    await writeApi.createRelationship({
      createRelationshipBody: {
        namespace: KetoNamespace.Team,
        object: TEAM_ID_1,
        relation: TeamRelation.Owners,
        subject_set: {
          namespace: KetoNamespace.Agent,
          object: AGENT_ID,
          relation: '',
        },
      },
    });

    // Act
    const ids = await reader.listTeamIdsBySubject(AGENT_ID);

    // Assert
    expect(ids).toContain(TEAM_ID_1);
  });

  it('returns team IDs for all relation types', async () => {
    // Arrange: add a member relation on a second team
    await writeApi.createRelationship({
      createRelationshipBody: {
        namespace: KetoNamespace.Team,
        object: TEAM_ID_2,
        relation: TeamRelation.Members,
        subject_set: {
          namespace: KetoNamespace.Agent,
          object: AGENT_ID,
          relation: '',
        },
      },
    });

    // Act
    const ids = await reader.listTeamIdsBySubject(AGENT_ID);

    // Assert: both teams returned across owners + members relations
    expect(ids).toContain(TEAM_ID_1);
    expect(ids).toContain(TEAM_ID_2);
  });

  it('deduplicates when agent has multiple relations on the same team', async () => {
    // Arrange: also add a members relation on TEAM_ID_1 (already has owners)
    await writeApi.createRelationship({
      createRelationshipBody: {
        namespace: KetoNamespace.Team,
        object: TEAM_ID_1,
        relation: TeamRelation.Members,
        subject_set: {
          namespace: KetoNamespace.Agent,
          object: AGENT_ID,
          relation: '',
        },
      },
    });

    // Act
    const ids = await reader.listTeamIdsBySubject(AGENT_ID);

    // Assert: TEAM_ID_1 appears only once
    expect(ids.filter((id) => id === TEAM_ID_1)).toHaveLength(1);
  });

  it('returns empty policies for a profile with no bindings', async () => {
    const policies = await reader.listRuntimeProfilePolicies(PROFILE_ID);
    expect(policies).toEqual([]);
  });

  it('resolves allowed tools two hops: profile → policies → tools', async () => {
    // Arrange: profile references P1 + P2; P1 grants git+gh, P2 grants gh+ls.
    await grantProfilePolicy(writeApi, PROFILE_ID, POLICY_ID_1);
    await grantProfilePolicy(writeApi, PROFILE_ID, POLICY_ID_2);
    await grantPolicyTool(writeApi, POLICY_ID_1, 'git');
    await grantPolicyTool(writeApi, POLICY_ID_1, 'gh');
    await grantPolicyTool(writeApi, POLICY_ID_2, 'gh');
    await grantPolicyTool(writeApi, POLICY_ID_2, 'ls');

    // Act: expand the first hop, then union the tools of each policy.
    const policies = await reader.listRuntimeProfilePolicies(PROFILE_ID);
    const toolLists = await Promise.all(
      policies.map((policyId) => reader.listRuntimePolicyTools(policyId)),
    );
    const allowedTools = [...new Set(toolLists.flat())].sort();

    // Assert: both policies bound; tools unioned + de-duped across policies.
    expect(policies.sort()).toEqual([POLICY_ID_1, POLICY_ID_2].sort());
    expect(allowedTools).toEqual(['gh', 'git', 'ls']);
  });

  it('returns only the requested policy’s tools', async () => {
    const tools = await reader.listRuntimePolicyTools(POLICY_ID_1);
    expect(tools.sort()).toEqual(['gh', 'git']);
  });

  it('enforces final task authority without diary-parent fallback', async () => {
    const taskId = '990e8400-e29b-41d4-a716-4466554400c0';
    const teamId = '990e8400-e29b-41d4-a716-4466554400c1';
    const diaryId = '990e8400-e29b-41d4-a716-4466554400c2';
    const ownerId = '990e8400-e29b-41d4-a716-4466554400c3';
    const memberId = '990e8400-e29b-41d4-a716-4466554400c4';
    const writerId = '990e8400-e29b-41d4-a716-4466554400c5';
    const managerId = '990e8400-e29b-41d4-a716-4466554400c6';
    const claimantId = '990e8400-e29b-41d4-a716-4466554400c7';
    const groupId = '990e8400-e29b-41d4-a716-4466554400c8';
    const groupWriterId = '990e8400-e29b-41d4-a716-4466554400c9';
    const diaryOnlyWriterId = '990e8400-e29b-41d4-a716-4466554400ca';
    const executorId = '990e8400-e29b-41d4-a716-4466554400cb';
    const teamManagerId = '990e8400-e29b-41d4-a716-4466554400cc';

    await writeApi.patchRelationships({
      relationshipPatch: [
        tuple('Team', teamId, TeamRelation.Owners, 'Agent', ownerId),
        tuple('Team', teamId, TeamRelation.Executors, 'Agent', ownerId),
        tuple('Team', teamId, TeamRelation.Managers, 'Agent', teamManagerId),
        tuple('Team', teamId, TeamRelation.Executors, 'Agent', teamManagerId),
        tuple('Team', teamId, TeamRelation.Executors, 'Agent', executorId),
        tuple('Team', teamId, TeamRelation.Members, 'Agent', executorId),
        tuple('Team', teamId, TeamRelation.Members, 'Agent', memberId),
        tuple(
          'Diary',
          diaryId,
          DiaryRelation.Writers,
          'Agent',
          diaryOnlyWriterId,
        ),
        tuple('Task', taskId, TaskRelation.Team, 'Team', teamId),
        tuple('Task', taskId, TaskRelation.Writers, 'Agent', writerId),
        tuple('Task', taskId, TaskRelation.Managers, 'Human', managerId),
        tuple('Task', taskId, TaskRelation.Claimant, 'Agent', claimantId),
        tuple('Group', groupId, GroupRelation.Members, 'Agent', groupWriterId),
        tuple(
          'Task',
          taskId,
          TaskRelation.Writers,
          'Group',
          groupId,
          GroupRelation.Members,
        ),
      ],
    });

    const checker = createPermissionChecker(permissionApi, {
      child: () => ({ warn: () => undefined, debug: () => undefined }),
      warn: () => undefined,
      debug: () => undefined,
    } as never);

    await expect(
      checker.canViewTask(taskId, ownerId, KetoNamespace.Agent),
    ).resolves.toBe(true);
    await expect(
      checker.canManageTask(taskId, ownerId, KetoNamespace.Agent),
    ).resolves.toBe(true);
    await expect(
      checker.canClaimTask(taskId, ownerId, KetoNamespace.Agent),
    ).resolves.toBe(true);
    await expect(
      checker.canClaimTask(taskId, teamManagerId, KetoNamespace.Agent),
    ).resolves.toBe(true);
    await expect(
      checker.canClaimTask(taskId, executorId, KetoNamespace.Agent),
    ).resolves.toBe(true);
    await expect(
      checker.canViewTask(taskId, executorId, KetoNamespace.Agent),
    ).resolves.toBe(true);
    await expect(
      checker.canViewTask(taskId, memberId, KetoNamespace.Agent),
    ).resolves.toBe(true);
    await expect(
      checker.canClaimTask(taskId, memberId, KetoNamespace.Agent),
    ).resolves.toBe(false);
    await expect(
      checker.canClaimTask(taskId, writerId, KetoNamespace.Agent),
    ).resolves.toBe(true);
    await expect(
      checker.canManageTask(taskId, managerId, KetoNamespace.Human),
    ).resolves.toBe(true);
    await expect(
      checker.canClaimTask(taskId, groupWriterId, KetoNamespace.Agent),
    ).resolves.toBe(true);
    await expect(
      checker.canReportTask(taskId, claimantId, KetoNamespace.Agent),
    ).resolves.toBe(true);
    await expect(
      checker.canViewTask(taskId, diaryOnlyWriterId, KetoNamespace.Agent),
    ).resolves.toBe(false);
  });
});

function tuple(
  namespace: string,
  object: string,
  relation: string,
  subjectNamespace: string,
  subjectObject: string,
  subjectRelation = '',
) {
  return {
    action: 'insert' as const,
    relation_tuple: {
      namespace,
      object,
      relation,
      subject_set: {
        namespace: subjectNamespace,
        object: subjectObject,
        relation: subjectRelation,
      },
    },
  };
}
