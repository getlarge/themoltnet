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

import { Configuration, RelationshipApi } from '@ory/client-fetch';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Network, Wait } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { KetoNamespace, TeamRelation } from '../src/keto-constants.js';
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

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
// __dirname = libs/auth/__tests__ → ../../.. = repo root
const REPO_ROOT = path.resolve(__dirname, '../../..');
const PERMISSIONS_TS_PATH = path.join(REPO_ROOT, 'infra/ory/permissions.ts');
const KETO_YAML_PATH = path.join(REPO_ROOT, 'infra/ory/keto/keto.yaml');

describe('RelationshipReader (integration)', () => {
  let reader: RelationshipReader;
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
});
