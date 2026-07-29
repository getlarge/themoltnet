import { randomBytes } from 'node:crypto';

import { createTeam, listTeams } from '@moltnet/api-client';
import { Configuration, FrontendApi } from '@ory/client-fetch';
import { expect, type Page, test } from '@playwright/test';

import { type ConnectedAgent, provisionAgent } from './helpers/agent-seed.js';
import {
  CONSOLE_URL,
  createNativeSessionToken,
  createTestUser,
  createTokenSessionApiClient,
  expectConsoleOverview,
  KRATOS_PUBLIC_URL,
  loginViaBrowser,
  registerViaBrowser,
} from './helpers/index.js';

test.describe.serial('Runtime security console', () => {
  const user = createTestUser({ prefix: 'runtime-security-e2e' });
  const nonce = randomBytes(3).toString('hex');
  const teamName = `runtime-security-${nonce}`;
  const profileName = `guarded-profile-${nonce}`;
  const policyName = `inspection-policy-${nonce}`;
  const keyName = `daemon-key-${nonce}`;

  let sharedTeamId: string;
  let agentCtx: ConnectedAgent;

  test.afterAll(async () => {
    await agentCtx?.teardown();
  });

  test('provisions a human owner and agent in one shared team', async ({
    page,
  }) => {
    await registerViaBrowser(page, user);
    await page.goto(CONSOLE_URL);
    await expectConsoleOverview(page);

    const sessionToken = await createNativeSessionToken(user);
    const humanClient = createTokenSessionApiClient(sessionToken);
    const personalTeam = (
      await listTeams({ client: humanClient })
    ).data?.items.find((team) => team.personal);
    if (!personalTeam) throw new Error('expected a personal team');

    const kratos = new FrontendApi(
      new Configuration({ basePath: KRATOS_PUBLIC_URL }),
    );
    const session = await kratos.toSession({
      xSessionToken: sessionToken,
    });
    const humanSubjectId = session.identity?.id;
    if (!humanSubjectId) {
      throw new Error('Kratos session missing identity id');
    }

    agentCtx = await provisionAgent(`runtime-security-agent-${nonce}`);
    const created = await createTeam({
      client: humanClient,
      body: {
        name: teamName,
        foundingMembers: [
          { subjectId: humanSubjectId, subjectNs: 'Human', role: 'owner' },
          {
            subjectId: agentCtx.genesis.identityId,
            subjectNs: 'Agent',
            role: 'member',
          },
        ],
      },
    });
    if (!created.data?.id) {
      throw new Error(`createTeam failed: ${JSON.stringify(created.error)}`);
    }
    sharedTeamId = created.data.id;
    expect(sharedTeamId).toBeTruthy();
  });

  async function openRuntime(page: Page): Promise<void> {
    await loginViaBrowser(page, user);
    const teamSelect = page.locator('select[aria-label="Select team"]');
    await teamSelect.selectOption({ label: teamName });
    await page.getByRole('button', { name: 'Runtime' }).click();
    await expect(page).toHaveURL(/\/runtime\/profiles$/);
  }

  test('creates a policy and binds its resolved union in watch then enforce', async ({
    page,
  }) => {
    await openRuntime(page);

    await page.getByRole('button', { name: /new profile/i }).click();
    await page.getByLabel(/^name$/i).fill(profileName);
    await page.getByLabel(/^provider$/i).fill('anthropic');
    await page.getByLabel(/^model$/i).fill('claude-sonnet-4-5');
    await page.getByLabel('Sandbox JSON', { exact: true }).fill('{}');
    await page.getByRole('button', { name: /create profile/i }).click();
    await expect(
      page.getByRole('button', { name: new RegExp(profileName) }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Policies' }).click();
    await expect(page).toHaveURL(/\/runtime\/policies$/);
    await page.getByRole('button', { name: 'New policy' }).click();
    const policyEditor = page.getByRole('region', {
      name: 'New tool policy',
    });
    await policyEditor.getByLabel('Name', { exact: true }).fill(policyName);
    await policyEditor
      .getByLabel('Description')
      .fill('Inspection-only tool access');
    const toolInput = policyEditor.getByLabel('Exact tool name');
    await toolInput.fill('read');
    await toolInput.press('Enter');
    await toolInput.fill('grep');
    await toolInput.press('Enter');
    await policyEditor
      .getByRole('button', { name: 'Add shell command' })
      .click();
    await policyEditor.getByLabel('Executable').fill('gh');
    await policyEditor.getByLabel('Subcommand').fill('pr');
    await policyEditor.getByRole('button', { name: 'Add token' }).click();
    await policyEditor.getByLabel('Token 3').fill('view');
    await expect(policyEditor.getByText('gh › pr › view › …')).toBeVisible();
    await policyEditor.getByRole('button', { name: 'Create policy' }).click();
    const savedPolicyEditor = page.getByRole('region', {
      name: 'Tool policy editor',
    });
    await expect(
      savedPolicyEditor.getByRole('button', { name: 'Save policy' }),
    ).toBeVisible();
    await expect(
      savedPolicyEditor.getByLabel('Name', { exact: true }),
    ).toHaveValue(policyName);

    await page.getByRole('button', { name: 'Profiles' }).click();
    await expect(page).toHaveURL(/\/runtime\/profiles$/);
    const toolAccess = page.getByRole('region', { name: 'Tool access' });
    await expect(
      toolAccess.getByRole('checkbox', { name: new RegExp(policyName) }),
    ).toBeVisible();
    await toolAccess
      .getByRole('checkbox', { name: new RegExp(policyName) })
      .check();
    await toolAccess.getByRole('radio', { name: /watch/i }).check();
    await toolAccess.getByRole('button', { name: 'Save tool access' }).click();
    await expect(
      toolAccess.getByText(/next runtime session starts/i),
    ).toBeVisible();
    await expect(
      toolAccess.locator('code').filter({ hasText: 'read' }),
    ).toBeVisible();
    await expect(
      toolAccess.locator('code').filter({ hasText: 'grep' }),
    ).toBeVisible();
    await expect(
      toolAccess.locator('code').filter({ hasText: 'gh › pr › view › …' }),
    ).toBeVisible();

    await toolAccess.getByRole('radio', { name: /enforce/i }).check();
    await toolAccess.getByRole('button', { name: 'Save tool access' }).click();
    await expect(
      toolAccess.getByText('enforce', { exact: true }),
    ).toBeVisible();

    await page.reload();
    await expect(
      page
        .getByRole('region', { name: 'Tool access' })
        .getByRole('radio', { name: /enforce/i }),
    ).toBeChecked();
    expect(sharedTeamId).toBeTruthy();
  });

  test('creates, rotates, and revokes an agent key with one-time disclosure', async ({
    page,
  }) => {
    await openRuntime(page);
    await page.getByRole('button', { name: 'Agent keys' }).click();
    await expect(page).toHaveURL(/\/runtime\/agent-keys$/);

    await page.getByRole('button', { name: 'Create key' }).first().click();
    const createDialog = page.getByRole('dialog', {
      name: 'Create agent key',
    });
    await expect(createDialog.getByLabel('Agent')).not.toHaveValue('');
    await createDialog.getByLabel('Key name').fill(keyName);
    await createDialog.getByLabel('Lifetime in days').fill('7');
    const createKeyButton = createDialog.getByRole('button', {
      name: 'Create key',
    });
    await expect(createKeyButton).toBeEnabled();
    await createKeyButton.click();

    let secretDialog = page.getByRole('dialog', {
      name: 'Store this secret now',
    });
    await expect(
      secretDialog.getByRole('button', { name: /close/i }),
    ).toHaveCount(0);
    const createdDone = secretDialog.getByRole('button', {
      name: 'Done — clear secret',
    });
    await expect(createdDone).toBeDisabled();
    await secretDialog
      .getByRole('checkbox', { name: /I stored this secret/i })
      .check();
    await createdDone.click();

    let keyRow = page.getByRole('row', { name: new RegExp(keyName) });
    await keyRow.getByRole('button', { name: 'Rotate' }).click();
    await page
      .getByRole('dialog', { name: 'Rotate agent key?' })
      .getByRole('button', { name: 'Rotate key' })
      .click();
    secretDialog = page.getByRole('dialog', {
      name: 'Store this secret now',
    });
    await secretDialog
      .getByRole('checkbox', { name: /I stored this secret/i })
      .check();
    await secretDialog
      .getByRole('button', { name: 'Done — clear secret' })
      .click();

    keyRow = page.getByRole('row', { name: new RegExp(keyName) });
    await keyRow.getByRole('button', { name: 'Revoke' }).click();
    const revokeDialog = page.getByRole('dialog', {
      name: 'Revoke agent key',
    });
    await revokeDialog.getByLabel('Reason').selectOption('privilege_withdrawn');
    await revokeDialog
      .getByLabel('Description')
      .fill('Console e2e deployment retired');
    await revokeDialog.getByRole('button', { name: 'Revoke key' }).click();

    keyRow = page.getByRole('row', { name: new RegExp(keyName) });
    await expect(keyRow.getByText('revoked', { exact: true })).toBeVisible();
    await expect(keyRow.getByText('No actions')).toBeVisible();
  });

  test('updates and deletes the policy, narrowing the profile union', async ({
    page,
  }) => {
    await openRuntime(page);
    await page.getByRole('button', { name: 'Policies' }).click();
    await page.getByRole('button', { name: new RegExp(policyName) }).click();
    await page.getByRole('button', { name: 'Remove read' }).click();
    await page.getByLabel('Exact tool name').fill('bash');
    await page.getByRole('button', { name: 'Add tool' }).click();
    await page.getByRole('button', { name: 'Save policy' }).click();

    await page.getByRole('button', { name: 'Profiles' }).click();
    const toolAccess = page.getByRole('region', { name: 'Tool access' });
    await expect(
      toolAccess.locator('code').filter({ hasText: 'bash' }),
    ).toBeVisible();
    await expect(
      toolAccess.locator('code').filter({ hasText: 'grep' }),
    ).toBeVisible();
    await expect(
      toolAccess.locator('code').filter({ hasText: 'read' }),
    ).toHaveCount(0);

    await page.getByRole('button', { name: 'Policies' }).click();
    await page.getByRole('button', { name: 'Delete policy' }).click();
    await page
      .getByRole('dialog', { name: 'Delete tool policy?' })
      .getByRole('button', { name: 'Delete policy' })
      .click();
    await expect(page.getByText('No tool policies yet')).toBeVisible();

    await page.getByRole('button', { name: 'Profiles' }).click();
    await expect(async () => {
      await page.reload();
      await expect(page.getByText(/resolved access set is empty/i)).toBeVisible(
        { timeout: 2_000 },
      );
    }).toPass({ timeout: 20_000 });
    await page.getByRole('button', { name: /delete profile/i }).click();
    await expect(page.getByText(profileName)).toHaveCount(0);
  });
});
