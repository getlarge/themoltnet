/**
 * E2E: Runtime tool policies API
 *
 * Covers team-scoped tool-policy CRUD, profile→policy binding, and the
 * allowed-tools resolution (enforcement mode + unioned tool set) against a real
 * REST API, Postgres, and Keto stack.
 */

import {
  type Client,
  createClient,
  createRuntimePolicy,
  createRuntimeProfile,
  createTeam,
  createTeamInvite,
  deleteRuntimePolicy,
  getRuntimePolicy,
  getRuntimeProfileAllowedTools,
  joinTeam,
  listRuntimePolicies,
  setRuntimeProfilePolicies,
  updateRuntimePolicy,
} from '@moltnet/api-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

describe('Runtime Tool Policies API', () => {
  let harness: TestHarness;
  let client: Client;
  let owner: TestAgent;
  let manager: TestAgent;
  let outsider: TestAgent;
  let managedTeamId: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    client = createClient({ baseUrl: harness.baseUrl });

    [owner, manager, outsider] = await Promise.all([
      createAgent({
        baseUrl: harness.baseUrl,
        db: harness.db,
        bootstrapIdentityId: harness.bootstrapIdentityId,
      }),
      createAgent({
        baseUrl: harness.baseUrl,
        db: harness.db,
        bootstrapIdentityId: harness.bootstrapIdentityId,
      }),
      createAgent({
        baseUrl: harness.baseUrl,
        db: harness.db,
        bootstrapIdentityId: harness.bootstrapIdentityId,
      }),
    ]);

    const { data: team, error: teamError } = await createTeam({
      client,
      auth: () => owner.accessToken,
      body: { name: `runtime-policies-managed-${Date.now()}` },
    });
    expect(teamError).toBeUndefined();
    managedTeamId = team!.id;

    const { data: invite, error: inviteError } = await createTeamInvite({
      client,
      auth: () => owner.accessToken,
      path: { id: managedTeamId },
      body: { role: 'manager' },
    });
    expect(inviteError).toBeUndefined();

    const { error: joinError } = await joinTeam({
      client,
      auth: () => manager.accessToken,
      body: { code: invite!.code },
    });
    expect(joinError).toBeUndefined();
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  function createPolicy(
    name: string,
    tools: string[],
    agent: TestAgent = owner,
    teamId: string = owner.personalTeamId,
    shellCommands: Array<{ argvPrefix: string[] }> = [],
  ) {
    return createRuntimePolicy({
      client,
      auth: () => agent.accessToken,
      headers: { 'x-moltnet-team-id': teamId },
      body: { name, tools, shellCommands },
    });
  }

  function createEnforcingProfile(name: string) {
    return createRuntimeProfile({
      client,
      auth: () => owner.accessToken,
      headers: { 'x-moltnet-team-id': owner.personalTeamId },
      body: {
        name,
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        sandbox: { hostExec: { autoApprove: false } },
        toolEnforcement: 'enforce',
      },
    });
  }

  it('creates, lists, gets, updates, and deletes a tool policy', async () => {
    const name = `ci-${Date.now()}`;
    const {
      data: created,
      error: createError,
      response: createResponse,
    } = await createPolicy(name, ['git'], owner, owner.personalTeamId, [
      { argvPrefix: ['gh', 'pr', 'view'] },
      { argvPrefix: ['npm', 'run', 'test:unit'] },
    ]);

    expect(createError).toBeUndefined();
    expect(createResponse.status).toBe(201);
    expect(created).toMatchObject({ name, teamId: owner.personalTeamId });
    expect(created!.tools).toEqual(['git']);
    expect(created!.shellCommands).toEqual([
      { argvPrefix: ['gh', 'pr', 'view'] },
      { argvPrefix: ['npm', 'run', 'test:unit'] },
    ]);

    const { data: listed, error: listError } = await listRuntimePolicies({
      client,
      auth: () => owner.accessToken,
      headers: { 'x-moltnet-team-id': owner.personalTeamId },
    });
    expect(listError).toBeUndefined();
    expect(listed!.items.map((item) => item.id)).toContain(created!.id);

    const { data: fetched, error: getError } = await getRuntimePolicy({
      client,
      auth: () => owner.accessToken,
      headers: { 'x-moltnet-team-id': owner.personalTeamId },
      path: { policyId: created!.id },
    });
    expect(getError).toBeUndefined();
    expect(fetched!.tools).toEqual(['git']);
    expect(fetched!.shellCommands).toEqual(created!.shellCommands);

    const { data: updated, error: updateError } = await updateRuntimePolicy({
      client,
      auth: () => owner.accessToken,
      headers: { 'x-moltnet-team-id': owner.personalTeamId },
      path: { policyId: created!.id },
      body: {
        name: `${name}-renamed`,
        addTools: ['ls'],
        addShellCommands: [{ argvPrefix: ['pnpm', 'exec', 'vitest'] }],
        removeShellCommands: [{ argvPrefix: ['npm', 'run', 'test:unit'] }],
      },
    });
    expect(updateError).toBeUndefined();
    expect(updated!.name).toBe(`${name}-renamed`);
    expect([...updated!.tools].sort()).toEqual(['git', 'ls']);
    expect(updated!.shellCommands).toEqual([
      { argvPrefix: ['gh', 'pr', 'view'] },
      { argvPrefix: ['pnpm', 'exec', 'vitest'] },
    ]);

    const { response: deleteResponse, error: deleteError } =
      await deleteRuntimePolicy({
        client,
        auth: () => owner.accessToken,
        headers: { 'x-moltnet-team-id': owner.personalTeamId },
        path: { policyId: created!.id },
      });
    expect(deleteError).toBeUndefined();
    expect(deleteResponse.status).toBe(204);

    const { response: getDeleted } = await getRuntimePolicy({
      client,
      auth: () => owner.accessToken,
      headers: { 'x-moltnet-team-id': owner.personalTeamId },
      path: { policyId: created!.id },
    });
    expect(getDeleted.status).toBe(404);
  });

  it('binds policies to a profile and resolves the unioned allowed-tool set', async () => {
    const { data: profile } = await createEnforcingProfile(
      `enforced-${Date.now()}`,
    );
    expect(profile).toBeDefined();
    expect(profile!.toolEnforcement).toBe('enforce');

    const { data: p1 } = await createPolicy(
      `p1-${Date.now()}`,
      ['git', 'gh'],
      owner,
      owner.personalTeamId,
      [{ argvPrefix: ['gh', 'pr', 'view'] }],
    );
    const { data: p2 } = await createPolicy(`p2-${Date.now()}`, ['gh', 'ls']);
    expect(p1).toBeDefined();
    expect(p2).toBeDefined();

    const { response: bindResponse, error: bindError } =
      await setRuntimeProfilePolicies({
        client,
        auth: () => owner.accessToken,
        headers: { 'x-moltnet-team-id': owner.personalTeamId },
        path: { profileId: profile!.id },
        body: { policyIds: [p1!.id, p2!.id] },
      });
    expect(bindError).toBeUndefined();
    expect(bindResponse.status).toBe(204);

    const { data: allowed, error: allowedError } =
      await getRuntimeProfileAllowedTools({
        client,
        auth: () => owner.accessToken,
        headers: { 'x-moltnet-team-id': owner.personalTeamId },
        path: { profileId: profile!.id },
      });
    expect(allowedError).toBeUndefined();
    expect(allowed!.enforcement).toBe('enforce');
    expect([...allowed!.allowedTools].sort()).toEqual(['gh', 'git', 'ls']);
    expect(allowed!.allowedShellCommands).toEqual([
      { argvPrefix: ['gh', 'pr', 'view'] },
    ]);

    // Rebinding to a single policy narrows the allow-set.
    await setRuntimeProfilePolicies({
      client,
      auth: () => owner.accessToken,
      headers: { 'x-moltnet-team-id': owner.personalTeamId },
      path: { profileId: profile!.id },
      body: { policyIds: [p1!.id] },
    });
    const { data: narrowed } = await getRuntimeProfileAllowedTools({
      client,
      auth: () => owner.accessToken,
      headers: { 'x-moltnet-team-id': owner.personalTeamId },
      path: { profileId: profile!.id },
    });
    expect([...narrowed!.allowedTools].sort()).toEqual(['gh', 'git']);
    expect(narrowed!.allowedShellCommands).toEqual([
      { argvPrefix: ['gh', 'pr', 'view'] },
    ]);
  });

  it('defaults enforcement to off for a profile with no policies', async () => {
    const { data: profile } = await createRuntimeProfile({
      client,
      auth: () => owner.accessToken,
      headers: { 'x-moltnet-team-id': owner.personalTeamId },
      body: {
        name: `unenforced-${Date.now()}`,
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        sandbox: { hostExec: { autoApprove: false } },
      },
    });
    expect(profile!.toolEnforcement).toBe('off');

    const { data: allowed } = await getRuntimeProfileAllowedTools({
      client,
      auth: () => owner.accessToken,
      headers: { 'x-moltnet-team-id': owner.personalTeamId },
      path: { profileId: profile!.id },
    });
    expect(allowed).toEqual({
      enforcement: 'off',
      allowedTools: [],
      allowedShellCommands: [],
    });
  });

  it('rejects duplicate policy names within a team', async () => {
    const name = `dup-${Date.now()}`;
    const first = await createPolicy(name, ['git']);
    expect(first.response.status).toBe(201);

    const second = await createPolicy(name, ['gh']);
    expect(second.response.status).toBe(409);
  });

  it('lets a team manager manage policies', async () => {
    const { data: created, response: createResponse } = await createPolicy(
      `mgr-${Date.now()}`,
      ['git'],
      manager,
      managedTeamId,
    );
    expect(createResponse.status).toBe(201);

    const { response: deleteResponse } = await deleteRuntimePolicy({
      client,
      auth: () => manager.accessToken,
      headers: { 'x-moltnet-team-id': managedTeamId },
      path: { policyId: created!.id },
    });
    expect(deleteResponse.status).toBe(204);
  });

  it('does not leak policies across team boundaries', async () => {
    const { data: secret } = await createPolicy(`secret-${Date.now()}`, [
      'git',
    ]);
    expect(secret).toBeDefined();

    const { response: listResponse } = await listRuntimePolicies({
      client,
      auth: () => outsider.accessToken,
      headers: { 'x-moltnet-team-id': owner.personalTeamId },
    });
    expect(listResponse.status).toBe(403);

    const { response: getResponse } = await getRuntimePolicy({
      client,
      auth: () => outsider.accessToken,
      headers: { 'x-moltnet-team-id': owner.personalTeamId },
      path: { policyId: secret!.id },
    });
    expect(getResponse.status).toBe(403);

    const { response: createResponse } = await createPolicy(
      `outsider-${Date.now()}`,
      ['git'],
      outsider,
      owner.personalTeamId,
    );
    expect(createResponse.status).toBe(403);
  });
});
