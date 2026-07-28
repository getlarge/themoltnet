import {
  isConnectorCredentialClaims,
  isTaskCredentialClaims,
  type TaskCredentialClaims,
} from '../index.js';

const taskClaims: TaskCredentialClaims = {
  version: 1,
  kind: 'task',
  agentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  teamId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  taskId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  attemptN: 1,
  leaseId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  runtimeKind: 'pi',
  capabilityManifestVersion: 'pi-v1',
  runtimeProfileId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  runtimeProfileRevision: 3,
  policySnapshotHash: `sha256:${'a'.repeat(64)}`,
};

const connectorClaims = {
  version: 1,
  kind: 'connector',
  task: {
    agentId: taskClaims.agentId,
    teamId: taskClaims.teamId,
    taskId: taskClaims.taskId,
    attemptN: taskClaims.attemptN,
    leaseId: taskClaims.leaseId,
  },
  grantId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  grantRevision: 4,
  connectorId: 'plant-readonly',
  operation: 'read',
  resourceId: 'sensor-17',
  parentTaskJti: 'parent-task-jti',
} as const;

describe('credential claim guards', () => {
  it('accepts canonical task and connector claims', () => {
    expect(isTaskCredentialClaims(taskClaims)).toBe(true);
    expect(isConnectorCredentialClaims(connectorClaims)).toBe(true);
  });

  it.each([
    ['task missing a required field', { ...taskClaims, taskId: undefined }],
    ['task with an extra property', { ...taskClaims, scope: 'admin' }],
    [
      'connector with an invalid nested task',
      { ...connectorClaims, task: { ...connectorClaims.task, attemptN: 0 } },
    ],
    [
      'connector with an extra property',
      { ...connectorClaims, audience: 'gateway' },
    ],
  ])('rejects %s', (_name, claims) => {
    expect(isTaskCredentialClaims(claims)).toBe(false);
    expect(isConnectorCredentialClaims(claims)).toBe(false);
  });
});
