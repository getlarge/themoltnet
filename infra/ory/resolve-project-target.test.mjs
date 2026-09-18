import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveProjectTarget,
  resolveProjectTargetFromWorkspace,
} from './resolve-project-target.mjs';

const development = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'development-project',
};

test('resolves the direct project URL through workspace inventory', () => {
  assert.equal(
    resolveProjectTarget({
      projects: [development],
      projectUrl: 'https://development-project.projects.oryapis.com',
      expectedProject: development.id,
    }),
    development.id,
  );
});

test('rejects a protected-environment ID that differs from workspace resolution', () => {
  assert.throws(
    () =>
      resolveProjectTarget({
        projects: { projects: [development] },
        projectUrl: 'https://development-project.projects.oryapis.com',
        expectedProject: '22222222-2222-4222-8222-222222222222',
      }),
    /independently resolved project ID/,
  );
});

test('accepts the common SDK collection envelopes', () => {
  for (const projects of [
    { projects: [development] },
    { items: [development] },
    { data: [development] },
  ]) {
    assert.equal(
      resolveProjectTarget({
        projects,
        projectUrl: 'https://development-project.projects.oryapis.com',
        expectedProject: development.id,
      }),
      development.id,
    );
  }
});

test('resolves through the workspace SDK without exposing the credential', async () => {
  const calls = [];
  const workspaceApi = {
    async listWorkspaceProjects(request) {
      calls.push(request);
      return { projects: [development] };
    },
  };

  assert.equal(
    await resolveProjectTargetFromWorkspace({
      workspace: 'workspace-id',
      projectUrl: 'https://development-project.projects.oryapis.com',
      expectedProject: development.id,
      accessToken: 'not-used-by-the-injected-client',
      workspaceApi,
    }),
    development.id,
  );
  assert.deepEqual(calls, [{ workspace: 'workspace-id' }]);
});

test('rejects custom domains and unknown project slugs', () => {
  assert.throws(
    () =>
      resolveProjectTarget({
        projects: [development],
        projectUrl: 'https://auth.example.com',
        expectedProject: development.id,
      }),
    /direct HTTPS Ory project URL/,
  );
  assert.throws(
    () =>
      resolveProjectTarget({
        projects: [development],
        projectUrl: 'https://other-project.projects.oryapis.com',
        expectedProject: development.id,
      }),
    /found 0/,
  );
});
