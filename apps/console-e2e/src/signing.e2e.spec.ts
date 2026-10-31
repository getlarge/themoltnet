import { randomBytes } from 'node:crypto';

import { createSigningRequest, listSigningRequests } from '@moltnet/api-client';
import { expect, test } from '@playwright/test';

import {
  type ConnectedAgent,
  createSharedTeamWithAgent,
  provisionAgent,
} from './helpers/agent-seed.js';
import {
  CONSOLE_URL,
  createNativeSessionToken,
  createTestUser,
  createTokenSessionApiClient,
  expectConsoleOverview,
  loginViaBrowser,
  registerViaBrowser,
  submitKratosForm,
  waitForVerificationCode,
} from './helpers/index.js';

const SIGNER_ORIGIN = 'http://127.0.0.1:17373';

test.describe.serial('Signing surface', () => {
  const user = createTestUser({ prefix: 'signing-e2e' });

  test('registers an authenticated Console human', async ({ page }) => {
    await registerViaBrowser(page, user);

    const codeInput = page.locator('input[name="code"]');
    if (await codeInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await codeInput.fill(await waitForVerificationCode(user.email));
      await submitKratosForm(page);
    }

    await page.goto(`${CONSOLE_URL}/`);
    await expectConsoleOverview(page);
  });

  test('opens the team signing surface without forwarding browser auth to loopback', async ({
    page,
  }) => {
    const loopbackRequests: {
      headers: Record<string, string>;
      postData: string | null;
    }[] = [];
    await page.route(`${SIGNER_ORIGIN}/**`, async (route) => {
      const request = route.request();
      loopbackRequests.push({
        headers: request.headers(),
        postData: request.postData(),
      });
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        headers: {
          'access-control-allow-origin': new URL(CONSOLE_URL).origin,
          vary: 'Origin',
        },
        body: JSON.stringify({
          version: 1,
          token: 'browser-e2e-process-capability',
          expiresAt: '2099-01-01T00:00:00.000Z',
        }),
      });
    });

    await loginViaBrowser(page, user);
    await page.goto(`${CONSOLE_URL}/signing`);

    await expect(
      page.getByRole('heading', { name: 'Signing', exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Companion connected')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Signable requests' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Signing credentials' }),
    ).toBeVisible();

    expect(loopbackRequests).toHaveLength(1);
    const [{ headers, postData }] = loopbackRequests;
    expect(headers['authorization']).toBeUndefined();
    expect(headers['cookie']).toBeUndefined();
    expect(headers['x-moltnet-session-token']).toBeUndefined();
    expect(postData ?? '').not.toMatch(
      /access.?token|refresh.?token|session.?token|authorization|cookie/iu,
    );
  });

  test('connects to the real host-side signing companion', async ({ page }) => {
    test.skip(
      process.env['MOLTNET_SIGNER_E2E'] !== '1',
      'Set MOLTNET_SIGNER_E2E=1 and start @themoltnet/signer on port 17373.',
    );

    await loginViaBrowser(page, user);
    await page.goto(`${CONSOLE_URL}/signing`);

    await expect(
      page.getByRole('heading', { name: 'Signing', exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Companion connected')).toBeVisible();
    await expect(page.getByText('Companion unavailable')).toBeHidden();
  });
});

// `SigningRequest.requestedBy` is a `PrincipalIdentity`; the console shows an
// agent requester by fingerprint. Listing signable requests needs no enrolled
// credential, so this runs without the host-side companion.
test.describe.serial('Signing request requester', () => {
  const user = createTestUser({ prefix: 'signing-requester-e2e' });
  const nonce = randomBytes(3).toString('hex');
  const purpose = `Approve console e2e release ${nonce}`;
  let agentCtx: ConnectedAgent;

  test.afterAll(async () => {
    await agentCtx?.teardown();
  });

  test('an agent requests a delegated signature from a team human', async ({
    page,
  }) => {
    await registerViaBrowser(page, user);
    await page.goto(`${CONSOLE_URL}/`);
    await expectConsoleOverview(page);

    const humanClient = createTokenSessionApiClient(
      await createNativeSessionToken(user),
    );
    agentCtx = await provisionAgent('signing-requester-e2e');
    const { agent, genesis } = agentCtx;
    const { teamId, humanSubjectId } = await createSharedTeamWithAgent({
      humanClient,
      agentId: genesis.agentId,
      name: `signing-requester-shared-${nonce}`,
    });

    // Team membership tuples converge after createTeam returns.
    await expect(async () => {
      const created = await createSigningRequest({
        client: agent.client,
        auth: () => agent.getToken(),
        body: {
          message: `console e2e release ${nonce}`,
          verificationMethod: 'human-hardware-previewsign',
          teamId,
          purpose,
          signerConstraint: { type: 'human', id: humanSubjectId },
        },
      });
      expect(created.error).toBeUndefined();
      expect(created.data!.requestedBy).toMatchObject({
        kind: 'agent',
        agentId: genesis.agentId,
        fingerprint: genesis.keyPair.fingerprint,
      });
    }).toPass({ timeout: 20_000 });

    // The signable list resolves the human's team roles through Keto, which
    // converges separately from the agent's membership. Wait until the human
    // can list the request so the page assertion checks rendering only.
    await expect(async () => {
      const listed = await listSigningRequests({
        client: humanClient,
        query: { scope: 'signable', status: ['pending', 'claimed'] },
      });
      expect(listed.error).toBeUndefined();
      expect(listed.data!.items.some((item) => item.purpose === purpose)).toBe(
        true,
      );
    }).toPass({ timeout: 20_000 });
  });

  test('lists the request with the agent fingerprint as requester', async ({
    page,
  }) => {
    await loginViaBrowser(page, user);
    await page.goto(`${CONSOLE_URL}/signing`);

    const request = page.locator('article').filter({ hasText: purpose });
    await expect(request).toBeVisible();
    await expect(request.locator('dt:text-is("Requester") + dd')).toHaveText(
      agentCtx.genesis.keyPair.fingerprint,
    );
  });
});
