import { createTeam, createTeamInvite, joinTeam } from '@moltnet/api-client';
import { expect, type Page, test } from '@playwright/test';

import {
  CONSOLE_URL,
  createCookieSessionApiClient,
  createTestUser,
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
  await expect(page.getByText('Welcome')).toBeVisible();
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
  await ownerPage.getByRole('button', { name: 'Promote to manager' }).click();

  await expect(ownerPage.getByText('managers')).toBeVisible();

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
  await ownerPage.getByRole('button', { name: 'Demote to member' }).click();

  await expect(
    ownerPage.getByRole('button', { name: 'Promote to manager' }),
  ).toBeVisible();

  await managerPage.goto(`${CONSOLE_URL}/teams/${team.id}`);
  await expect(managerPage.getByText('Invites')).not.toBeVisible();

  await ownerContext.close();
  await managerContext.close();
});
