import { createTeam, createTeamInvite, joinTeam } from '@moltnet/api-client';
import { expect, type Page, test } from '@playwright/test';

import { provisionAgent } from './helpers/agent-seed.js';
import {
  CONSOLE_URL,
  createCookieSessionApiClient,
  createTestUser,
  expectConsoleOverview,
  getSessionCookie,
  registerViaBrowser,
  submitKratosForm,
  waitForVerificationCode,
} from './helpers/index.js';

async function ensureConsoleSession(
  page: Page,
  email: string,
): Promise<string> {
  const codeInput = page.locator('input[name="code"]');
  if (await codeInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    const code = await waitForVerificationCode(email);
    await codeInput.fill(code);
    await submitKratosForm(page);
  }

  await page.goto(`${CONSOLE_URL}/`);
  await expectConsoleOverview(page);
  return getSessionCookie(page);
}

test('owner can promote a member to manager from the console', async ({
  browser,
}) => {
  const owner = createTestUser({ prefix: 'role-owner' });
  const member = createTestUser({ prefix: 'role-member' });
  const teamName = `role-team-${Date.now()}`;

  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await registerViaBrowser(ownerPage, owner);
  const ownerCookie = await ensureConsoleSession(ownerPage, owner.email);
  const ownerClient = createCookieSessionApiClient(ownerCookie);

  const { data: team } = await createTeam({
    client: ownerClient,
    body: { name: teamName },
  });
  if (!team) throw new Error('Failed to create test team');

  const { data: invite } = await createTeamInvite({
    client: ownerClient,
    path: { id: team.id },
    body: { role: 'member' },
  });
  if (!invite) throw new Error('Failed to create member invite');

  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  await registerViaBrowser(memberPage, member);
  const memberCookie = await ensureConsoleSession(memberPage, member.email);
  const memberClient = createCookieSessionApiClient(memberCookie);

  const joinResponse = await joinTeam({
    client: memberClient,
    body: { code: invite.code },
  });
  expect(joinResponse.response.status).toBe(200);

  await ownerPage.goto(`${CONSOLE_URL}/teams/${team.id}`);
  await expect(ownerPage.getByText(member.email)).toBeVisible();
  const memberRow = ownerPage
    .getByRole('row')
    .filter({ hasText: member.email });
  const roleSelector = memberRow.getByRole('combobox');
  await expect(roleSelector.locator('option[value="executor"]')).toHaveCount(0);
  await roleSelector.selectOption('manager');

  await expect(roleSelector).toHaveValue('manager');

  await memberPage.goto(`${CONSOLE_URL}/teams/${team.id}`);
  await expect(memberPage.getByText('Invites')).toBeVisible();

  await ownerContext.close();
  await memberContext.close();
});

test('owner can demote a manager to member from the console', async ({
  browser,
}) => {
  const owner = createTestUser({ prefix: 'role-owner-demote' });
  const manager = createTestUser({ prefix: 'role-manager-demote' });
  const teamName = `role-team-demote-${Date.now()}`;

  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await registerViaBrowser(ownerPage, owner);
  const ownerCookie = await ensureConsoleSession(ownerPage, owner.email);
  const ownerClient = createCookieSessionApiClient(ownerCookie);

  const { data: team } = await createTeam({
    client: ownerClient,
    body: { name: teamName },
  });
  if (!team) throw new Error('Failed to create test team');

  const { data: invite } = await createTeamInvite({
    client: ownerClient,
    path: { id: team.id },
    body: { role: 'manager' },
  });
  if (!invite) throw new Error('Failed to create manager invite');

  const managerContext = await browser.newContext();
  const managerPage = await managerContext.newPage();
  await registerViaBrowser(managerPage, manager);
  const managerCookie = await ensureConsoleSession(managerPage, manager.email);
  const managerClient = createCookieSessionApiClient(managerCookie);

  const joinResponse = await joinTeam({
    client: managerClient,
    body: { code: invite.code },
  });
  expect(joinResponse.response.status).toBe(200);

  await ownerPage.goto(`${CONSOLE_URL}/teams/${team.id}`);
  await expect(ownerPage.getByText(manager.email)).toBeVisible();
  const managerRow = ownerPage
    .getByRole('row')
    .filter({ hasText: manager.email });
  const roleSelector = managerRow.getByRole('combobox');
  await roleSelector.selectOption('member');

  await expect(roleSelector).toHaveValue('member');

  await managerPage.goto(`${CONSOLE_URL}/teams/${team.id}`);
  await expect(managerPage.getByText('Invites')).toBeHidden();

  await ownerContext.close();
  await managerContext.close();
});

test('owner can assign executor only to an agent from the console', async ({
  browser,
}) => {
  const owner = createTestUser({ prefix: 'role-agent-owner' });
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await registerViaBrowser(ownerPage, owner);
  const ownerCookie = await ensureConsoleSession(ownerPage, owner.email);
  const ownerClient = createCookieSessionApiClient(ownerCookie);
  const agent = await provisionAgent(`role-agent-${Date.now()}`);

  try {
    const { data: team } = await createTeam({
      client: ownerClient,
      body: { name: `role-agent-team-${Date.now()}` },
    });
    if (!team) throw new Error('Failed to create agent role team');
    const { data: invite } = await createTeamInvite({
      client: ownerClient,
      path: { id: team.id },
      body: { role: 'member' },
    });
    if (!invite) throw new Error('Failed to create agent member invite');
    await agent.agent.teams.join(invite.code);

    await ownerPage.goto(`${CONSOLE_URL}/teams/${team.id}`);
    const roleSelector = ownerPage.getByRole('combobox', { name: /role for/i });
    await expect(roleSelector.locator('option[value="executor"]')).toHaveCount(
      1,
    );
    await roleSelector.selectOption('executor');
    await expect(roleSelector).toHaveValue('executor');
  } finally {
    await agent.teardown();
    await ownerContext.close();
  }
});
