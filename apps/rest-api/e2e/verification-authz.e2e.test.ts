import { randomUUID } from 'node:crypto';

import {
  addGroupMember,
  claimVerification,
  type Client,
  createClient,
  createDiary,
  createDiaryCustomPack,
  createDiaryEntry,
  createGroup,
  createTeam,
  createTeamInvite,
  joinTeam,
  listDiaryPacks,
  renderContextPack,
  verifyRenderedPack,
} from '@moltnet/api-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

async function createTeamRenderedPack(opts: {
  client: Client;
  owner: TestAgent;
  teamId: string;
  suffix: string;
}): Promise<string> {
  const { data: diary } = await createDiary({
    client: opts.client,
    auth: () => opts.owner.accessToken,
    headers: { 'x-moltnet-team-id': opts.teamId },
    body: { name: `verification-authz-${opts.suffix}`, visibility: 'private' },
  });
  expect(diary).toBeDefined();

  const { data: entryA } = await createDiaryEntry({
    client: opts.client,
    auth: () => opts.owner.accessToken,
    path: { diaryId: diary!.id },
    body: {
      title: `Entry A ${opts.suffix}`,
      content: `Entry A content ${opts.suffix}`,
      tags: ['verification', 'authz'],
    },
  });
  const { data: entryB } = await createDiaryEntry({
    client: opts.client,
    auth: () => opts.owner.accessToken,
    path: { diaryId: diary!.id },
    body: {
      title: `Entry B ${opts.suffix}`,
      content: `Entry B content ${opts.suffix}`,
      tags: ['verification', 'authz'],
    },
  });
  expect(entryA).toBeDefined();
  expect(entryB).toBeDefined();

  const { data: customPack } = await createDiaryCustomPack({
    client: opts.client,
    auth: () => opts.owner.accessToken,
    path: { id: diary!.id },
    body: {
      packType: 'custom',
      params: { recipe: `verification-${opts.suffix}` },
      entries: [
        { entryId: entryA!.id, rank: 1 },
        { entryId: entryB!.id, rank: 2 },
      ],
      pinned: true,
    },
  });
  expect(customPack).toBeDefined();

  const { data: packs } = await listDiaryPacks({
    client: opts.client,
    auth: () => opts.owner.accessToken,
    path: { id: diary!.id },
  });
  const sourcePack = packs!.items.find(
    (p) => p.packCid === customPack!.packCid,
  );
  expect(sourcePack).toBeDefined();

  const { data: renderedPack, response: renderResponse } =
    await renderContextPack({
      client: opts.client,
      auth: () => opts.owner.accessToken,
      path: { id: sourcePack!.id },
      body: {
        renderMethod: 'agent-refined',
        renderedMarkdown: `# ${opts.suffix}\n\nRendered verification authz content`,
      },
    });

  expect(renderResponse.status).toBe(201);
  expect(renderedPack).toBeDefined();
  return renderedPack!.id;
}

describe('Verification claim authorization (teams + groups)', () => {
  let harness: TestHarness;
  let client: Client;
  let owner: TestAgent;
  let judge: TestAgent;
  let outsider: TestAgent;

  beforeAll(async () => {
    harness = await createTestHarness();
    client = createClient({ baseUrl: harness.baseUrl });

    owner = await createAgent({
      baseUrl: harness.baseUrl,
      db: harness.db,
      bootstrapIdentityId: harness.bootstrapIdentityId,
    });
    judge = await createAgent({
      baseUrl: harness.baseUrl,
      db: harness.db,
      bootstrapIdentityId: harness.bootstrapIdentityId,
    });
    outsider = await createAgent({
      baseUrl: harness.baseUrl,
      db: harness.db,
      bootstrapIdentityId: harness.bootstrapIdentityId,
    });
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  it('blocks claim across teams and allows claim once judge joins owner team', async () => {
    const { data: team } = await createTeam({
      client,
      auth: () => owner.accessToken,
      body: { name: 'verification-claim-authz-team' },
    });
    expect(team).toBeDefined();

    const renderedPackId = await createTeamRenderedPack({
      client,
      owner,
      teamId: team!.id,
      suffix: 'cross-team',
    });

    const { response: verifyResponse } = await verifyRenderedPack({
      client,
      auth: () => owner.accessToken,
      path: { id: renderedPackId },
      body: { nonce: randomUUID() },
    });
    expect(verifyResponse.status).toBe(201);

    const { response: outsiderClaim } = await claimVerification({
      client,
      auth: () => outsider.accessToken,
      path: { id: renderedPackId },
    });
    expect(outsiderClaim.status).toBe(403);

    const { data: invite } = await createTeamInvite({
      client,
      auth: () => owner.accessToken,
      path: { id: team!.id },
      body: { role: 'member', maxUses: 1, expiresInHours: 24 },
    });
    expect(invite).toBeDefined();

    const { response: joinResponse } = await joinTeam({
      client,
      auth: () => outsider.accessToken,
      body: { code: invite!.code },
    });
    expect(joinResponse.status).toBe(200);

    const { response: joinedClaim, data: payload } = await claimVerification({
      client,
      auth: () => outsider.accessToken,
      path: { id: renderedPackId },
    });
    expect(joinedClaim.status).toBe(200);
    expect(payload?.sourceEntries.length).toBeGreaterThan(0);
  });

  it('enforces group operations as team-scoped and keeps outsider claim forbidden', async () => {
    const { data: team } = await createTeam({
      client,
      auth: () => owner.accessToken,
      body: { name: 'verification-claim-groups-team' },
    });
    expect(team).toBeDefined();

    const { data: judgeInvite } = await createTeamInvite({
      client,
      auth: () => owner.accessToken,
      path: { id: team!.id },
      body: { role: 'member', maxUses: 1, expiresInHours: 24 },
    });
    await joinTeam({
      client,
      auth: () => judge.accessToken,
      body: { code: judgeInvite!.code },
    });

    const { data: group } = await createGroup({
      client,
      auth: () => owner.accessToken,
      path: { id: team!.id },
      body: { name: 'verification-judges' },
    });
    expect(group).toBeDefined();

    const { response: addJudgeResponse } = await addGroupMember({
      client,
      auth: () => owner.accessToken,
      path: { groupId: group!.id },
      body: { subjectId: judge.identityId, subjectNs: 'Agent' },
    });
    expect(addJudgeResponse.status).toBe(201);

    const { response: addOutsiderResponse } = await addGroupMember({
      client,
      auth: () => owner.accessToken,
      path: { groupId: group!.id },
      body: { subjectId: outsider.identityId, subjectNs: 'Agent' },
    });
    expect([400, 403, 404]).toContain(addOutsiderResponse.status);

    const renderedPackId = await createTeamRenderedPack({
      client,
      owner,
      teamId: team!.id,
      suffix: 'groups',
    });

    const { response: verifyResponse } = await verifyRenderedPack({
      client,
      auth: () => owner.accessToken,
      path: { id: renderedPackId },
      body: { nonce: randomUUID() },
    });
    expect(verifyResponse.status).toBe(201);

    const { response: judgeClaim } = await claimVerification({
      client,
      auth: () => judge.accessToken,
      path: { id: renderedPackId },
    });
    expect(judgeClaim.status).toBe(200);

    const renderedPackId2 = await createTeamRenderedPack({
      client,
      owner,
      teamId: team!.id,
      suffix: 'groups-outsider-check',
    });
    await verifyRenderedPack({
      client,
      auth: () => owner.accessToken,
      path: { id: renderedPackId2 },
      body: { nonce: randomUUID() },
    });

    const { response: outsiderClaim } = await claimVerification({
      client,
      auth: () => outsider.accessToken,
      path: { id: renderedPackId2 },
    });
    expect(outsiderClaim.status).toBe(403);
  });
});
