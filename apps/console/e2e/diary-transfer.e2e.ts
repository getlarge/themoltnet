import {
  createDiary,
  createTeam,
  createTeamInvite,
  getDiary,
  initiateTransfer,
  joinTeam,
} from '@moltnet/api-client';
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

test('owner can transfer a diary to another team owner who accepts it', async ({
  browser,
}) => {
  // Two real human users — each owns their own non-personal team.
  const sourceOwner = createTestUser({ prefix: 'xfer-source' });
  const destOwner = createTestUser({ prefix: 'xfer-dest' });
  const sourceTeamName = `xfer-source-team-${Date.now()}`;
  const destTeamName = `xfer-dest-team-${Date.now()}`;
  const diaryName = `xfer-diary-${Date.now()}`;

  // Source owner: register, create team, create diary on that team.
  const sourceCtx = await browser.newContext();
  const sourcePage = await sourceCtx.newPage();
  await registerViaBrowser(sourcePage, sourceOwner);
  const sourceCookie = await ensureConsoleSession(
    sourcePage,
    sourceOwner.email,
  );
  const sourceClient = createCookieSessionApiClient(sourceCookie);

  const { data: sourceTeam } = await createTeam({
    client: sourceClient,
    body: { name: sourceTeamName },
  });
  if (!sourceTeam) throw new Error('Failed to create source team');

  const { data: diary } = await createDiary({
    client: sourceClient,
    headers: { 'x-moltnet-team-id': sourceTeam.id },
    body: { name: diaryName, visibility: 'moltnet' },
  });
  if (!diary) throw new Error('Failed to create diary on source team');

  // Destination owner: register, create their own team.
  const destCtx = await browser.newContext();
  const destPage = await destCtx.newPage();
  await registerViaBrowser(destPage, destOwner);
  const destCookie = await ensureConsoleSession(destPage, destOwner.email);
  const destClient = createCookieSessionApiClient(destCookie);

  const { data: destTeam } = await createTeam({
    client: destClient,
    body: { name: destTeamName },
  });
  if (!destTeam) throw new Error('Failed to create destination team');

  // The source owner must be a *member* of the destination team for the
  // destination team to appear in their TransferDiaryDialog dropdown. The
  // dropdown lists teams the caller belongs to (excluding personal + the
  // source team itself). Use a member invite + join.
  const { data: invite } = await createTeamInvite({
    client: destClient,
    path: { id: destTeam.id },
    body: { role: 'member' },
  });
  if (!invite) throw new Error('Failed to create invite into destination team');
  const joinResp = await joinTeam({
    client: sourceClient,
    body: { code: invite.code },
  });
  expect(joinResp.response.status).toBe(200);

  // Source owner: open the diary, click Transfer, pick destination team, submit.
  await sourcePage.goto(`${CONSOLE_URL}/diaries/${diary.id}`);
  await sourcePage.getByTestId('open-transfer-dialog').click();
  await sourcePage
    .getByTestId('transfer-destination-team')
    .selectOption(destTeam.id);
  await sourcePage.getByTestId('transfer-submit').click();
  // Dialog closes on success.
  await expect(sourcePage.getByTestId('transfer-submit')).toHaveCount(0);

  // Destination owner: open destination team detail, switch to diaries tab,
  // see the pending transfer, accept.
  await destPage.goto(`${CONSOLE_URL}/teams/${destTeam.id}?tab=diaries`);
  await expect(destPage.getByText('Incoming transfers (1)')).toBeVisible();
  await expect(destPage.getByText(`Diary ${diary.id}`)).toBeVisible();
  await destPage.getByTestId(/^accept-transfer-/).click();
  await destPage.getByRole('button', { name: 'Accept' }).click();

  // After acceptance: the diary's teamId is the destination team. Verify via REST.
  // (The REST query needs the source owner's session because they're now a
  // member of both teams; either client works since the diary is moltnet
  // visibility.)
  await expect
    .poll(async () => {
      const { data: refreshed } = await getDiary({
        client: destClient,
        path: { id: diary.id },
      });
      return refreshed?.teamId;
    })
    .toBe(destTeam.id);

  // The pending-transfers panel should no longer show this transfer.
  await destPage.reload();
  await expect(destPage.getByText('Incoming transfers (1)')).not.toBeVisible();

  await sourceCtx.close();
  await destCtx.close();
});

test('destination owner can reject a pending transfer and the diary stays on the source team', async ({
  browser,
}) => {
  const sourceOwner = createTestUser({ prefix: 'xfer-reject-source' });
  const destOwner = createTestUser({ prefix: 'xfer-reject-dest' });
  const sourceTeamName = `xfer-reject-src-${Date.now()}`;
  const destTeamName = `xfer-reject-dst-${Date.now()}`;
  const diaryName = `xfer-reject-diary-${Date.now()}`;

  const sourceCtx = await browser.newContext();
  const sourcePage = await sourceCtx.newPage();
  await registerViaBrowser(sourcePage, sourceOwner);
  const sourceCookie = await ensureConsoleSession(
    sourcePage,
    sourceOwner.email,
  );
  const sourceClient = createCookieSessionApiClient(sourceCookie);

  const { data: sourceTeam } = await createTeam({
    client: sourceClient,
    body: { name: sourceTeamName },
  });
  if (!sourceTeam) throw new Error('Failed to create source team');

  const { data: diary } = await createDiary({
    client: sourceClient,
    headers: { 'x-moltnet-team-id': sourceTeam.id },
    body: { name: diaryName, visibility: 'moltnet' },
  });
  if (!diary) throw new Error('Failed to create diary');

  const destCtx = await browser.newContext();
  const destPage = await destCtx.newPage();
  await registerViaBrowser(destPage, destOwner);
  const destCookie = await ensureConsoleSession(destPage, destOwner.email);
  const destClient = createCookieSessionApiClient(destCookie);

  const { data: destTeam } = await createTeam({
    client: destClient,
    body: { name: destTeamName },
  });
  if (!destTeam) throw new Error('Failed to create destination team');

  // Initiate the transfer directly via REST (the happy-path test already
  // covers the dialog UI; this test focuses on reject UX).
  const initiated = await initiateTransfer({
    client: sourceClient,
    path: { id: diary.id },
    body: { destinationTeamId: destTeam.id },
  });
  expect(initiated.response.status).toBe(202);

  // Destination owner navigates and rejects.
  await destPage.goto(`${CONSOLE_URL}/teams/${destTeam.id}?tab=diaries`);
  await expect(destPage.getByText('Incoming transfers (1)')).toBeVisible();
  await destPage.getByTestId(/^reject-transfer-/).click();
  await destPage.getByRole('button', { name: 'Reject' }).click();
  await expect(destPage.getByText('Incoming transfers (1)')).not.toBeVisible();

  // Diary stays on the source team.
  const { data: refreshed } = await getDiary({
    client: sourceClient,
    path: { id: diary.id },
  });
  expect(refreshed?.teamId).toBe(sourceTeam.id);

  await sourceCtx.close();
  await destCtx.close();
});

test('initiating a transfer while one is already pending returns an error', async ({
  browser,
}) => {
  const sourceOwner = createTestUser({ prefix: 'xfer-conflict-source' });
  const destOwner = createTestUser({ prefix: 'xfer-conflict-dest' });
  const sourceTeamName = `xfer-conflict-src-${Date.now()}`;
  const destTeamName = `xfer-conflict-dst-${Date.now()}`;
  const diaryName = `xfer-conflict-diary-${Date.now()}`;

  const sourceCtx = await browser.newContext();
  const sourcePage = await sourceCtx.newPage();
  await registerViaBrowser(sourcePage, sourceOwner);
  const sourceCookie = await ensureConsoleSession(
    sourcePage,
    sourceOwner.email,
  );
  const sourceClient = createCookieSessionApiClient(sourceCookie);

  const { data: sourceTeam } = await createTeam({
    client: sourceClient,
    body: { name: sourceTeamName },
  });
  if (!sourceTeam) throw new Error('Failed to create source team');

  const { data: diary } = await createDiary({
    client: sourceClient,
    headers: { 'x-moltnet-team-id': sourceTeam.id },
    body: { name: diaryName, visibility: 'moltnet' },
  });
  if (!diary) throw new Error('Failed to create diary');

  // Bring up the destination team and add source owner as a member so the
  // dropdown includes it.
  const destCtx = await browser.newContext();
  const destPage = await destCtx.newPage();
  await registerViaBrowser(destPage, destOwner);
  const destCookie = await ensureConsoleSession(destPage, destOwner.email);
  const destClient = createCookieSessionApiClient(destCookie);

  const { data: destTeam } = await createTeam({
    client: destClient,
    body: { name: destTeamName },
  });
  if (!destTeam) throw new Error('Failed to create destination team');
  const { data: invite } = await createTeamInvite({
    client: destClient,
    path: { id: destTeam.id },
    body: { role: 'member' },
  });
  if (!invite) throw new Error('Failed to create invite');
  await joinTeam({ client: sourceClient, body: { code: invite.code } });

  // First transfer — succeeds.
  const initiated = await initiateTransfer({
    client: sourceClient,
    path: { id: diary.id },
    body: { destinationTeamId: destTeam.id },
  });
  expect(initiated.response.status).toBe(202);

  // Second attempt from the UI — REST rejects with 409 "diary-transfer-pending".
  // The dialog should surface the error inline (not crash, not close).
  await sourcePage.goto(`${CONSOLE_URL}/diaries/${diary.id}`);
  await sourcePage.getByTestId('open-transfer-dialog').click();
  await sourcePage
    .getByTestId('transfer-destination-team')
    .selectOption(destTeam.id);
  await sourcePage.getByTestId('transfer-submit').click();

  // The submit button stays visible and an error message appears.
  await expect(sourcePage.getByTestId('transfer-submit')).toBeVisible();
  // The error text is mutation.error.message — we don't assert on the exact
  // wording, just that some error is shown (caption color, "pending" substring).
  await expect(sourcePage.getByText(/pending|already|conflict/i)).toBeVisible();

  await sourceCtx.close();
  await destCtx.close();
});
