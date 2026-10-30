import { $, browser, expect } from '@wdio/globals';

import {
  catalogue,
  expectNoAxeViolations,
  running,
  status,
  WINDOW_SIZES,
} from './run-fixtures.js';

let generation = 0;
async function mount() {
  await browser.tauri.restoreAllMocks();
  const url = new URL(await browser.getUrl());
  url.hash = '';
  url.search = `?renewal=${++generation}`;
  await browser.url(url.href);
  for (const [command, value] of Object.entries({
    desktop_status: running,
    desktop_control_status: status,
    desktop_operator_configured: {
      operatorConfigured: true,
      email: 'operator@example.com',
    },
    desktop_operator_teams: { items: [] },
    desktop_catalogue: { ...catalogue, hiddenTeamIds: ['removed-team'] },
    desktop_preset_storage_scope: { storageScope: '' },
    desktop_providers: {},
    desktop_subscriptions: [],
    desktop_list_enrollment_recoveries: { items: [] },
  }))
    await (await browser.tauri.mock(command)).mockResolvedValue(value);
  await (
    await browser.tauri.mock('desktop_enroll_team')
  ).mockImplementation(
    () =>
      new Promise((_, reject) => {
        window.addEventListener(
          'desktop-test:approval-result',
          (event) => {
            // Native IPC rejects with the safe server message as a string.
            // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
            reject((event as CustomEvent<string>).detail);
          },
          { once: true },
        );
      }),
  );
  await (
    await browser.tauri.mock('desktop_cancel_operator_approval')
  ).mockImplementation(() => {
    window.dispatchEvent(
      new CustomEvent('desktop-test:approval-result', {
        detail: 'Approval cancelled',
      }),
    );
  });
  await browser.execute(() => {
    localStorage.clear();
    window.dispatchEvent(new Event('desktop-e2e:mount'));
  });
  await expect($('button=New run')).toBeEnabled();
  await $('a=Identity and teams').click();
  await expect($('button=Renew')).toBeEnabled();
}
async function approve(label: string) {
  if (label === 'Renew access')
    await $('summary*=Removed from Desktop').click();
  await $(`button=${label}`).click();
  const review = $('section[aria-labelledby="team-approval-heading"]');
  await expect(review).toBeFocused();
  const inView = await browser.execute(() => {
    const bounds = document
      .querySelector('section[aria-labelledby="team-approval-heading"]')!
      .getBoundingClientRect();
    return bounds.top >= 0 && bounds.top < window.innerHeight;
  });
  expect(inView).toBe(true);
  await $('button=Replace team credential').click();
  await $('button=Replace credential').click();
  await expect($('body')).toHaveText(
    expect.stringContaining('Waiting for browser approval'),
  );
  await expect($('button=Replace team credential')).not.toExist();
  await expect($('button=Cancel approval')).toBeEnabled();
  await expect($('body')).toHaveText(expect.stringContaining('Expires in 5:'));
}

describe('Team credential renewal through the native bridge', () => {
  for (const [width, height] of WINDOW_SIZES) {
    it(`shows missing access and recovers from consent denial at ${width}×${height}`, async () => {
      await browser.setWindowSize(width, height);
      await browser.emulate('colorScheme', width === 820 ? 'dark' : 'light');
      await mount();
      await browser.saveScreenshot(
        `test-results/team-access-overview-${width}.png`,
      );
      await approve('Renew access');
      await expectNoAxeViolations();
      await browser.saveScreenshot(
        `test-results/team-renewal-waiting-${width}.png`,
      );
      await browser.execute(() =>
        window.dispatchEvent(
          new CustomEvent('desktop-test:approval-result', {
            detail:
              'Team approval denied. Your signed-in account cannot manage credentials for this team.',
          }),
        ),
      );
      await expect($('[role="alert"]')).toHaveText(
        expect.stringContaining('Team access required'),
      );
      await expect($('[role="alert"]')).toHaveText(
        expect.stringContaining('Refreshing alone does not grant access'),
      );
      await expect($('button=Replace team credential')).toBeEnabled();
      await expect($('button=Waiting for approval…')).not.toExist();
      await expectNoAxeViolations();
      await browser.saveScreenshot(
        `test-results/team-renewal-denied-${width}.png`,
      );
      // The selected removed team and permissions survive the denial, so a
      // subsequent approval can finish without reconstructing the request.
      const enrollment = await browser.tauri.mock('desktop_enroll_team');
      await enrollment.mockResolvedValue({
        state: 'persisted',
        teamId: 'removed-team',
        keyId: 'replacement',
        scopes: ['agent:profile'],
      });
      await $('button=Replace team credential').click();
      await $('button=Replace credential').click();
      await expect(
        $('[role="status"][aria-label="Approval completed"]'),
      ).toHaveText(expect.stringContaining('Team credential renewed'));
      await enrollment.update();
      expect(enrollment.mock.calls.at(-1)?.[0]).toEqual(
        expect.objectContaining({
          request: expect.objectContaining({
            mode: 'replace',
            teamId: 'removed-team',
          }),
        }),
      );
    });
  }
  it('reports an approval-service failure without calling it a decline', async () => {
    await browser.setWindowSize(820, 720);
    await mount();
    await approve('Renew');
    await expect(
      $('section[aria-labelledby="team-approval-heading"] [aria-live="off"]'),
    ).toHaveText(expect.stringContaining('Expires in'));
    await browser.execute(() =>
      window.dispatchEvent(
        new CustomEvent('desktop-test:approval-result', {
          detail:
            'Approval failed. No credential was issued. Start a new approval or try again later.',
        }),
      ),
    );
    await expect($('[role="alert"]')).toHaveText(
      expect.stringContaining('Approval failed'),
    );
    await expect($('[role="alert"]')).not.toHaveText(
      expect.stringContaining('Approval declined'),
    );
    await expect($('button=Replace team credential')).toBeEnabled();
    await expect($('button=Cancel approval')).not.toExist();
    await expectNoAxeViolations();
  });
  it('recovers from an expired approval without labeling it cancellation', async () => {
    await browser.setWindowSize(820, 720);
    await mount();
    await approve('Renew');
    await browser.execute(() =>
      window.dispatchEvent(
        new CustomEvent('desktop-test:approval-result', {
          detail:
            'Approval expired. Start a new approval and complete it within five minutes.',
        }),
      ),
    );
    await expect($('[role="alert"]')).toHaveText(
      expect.stringContaining('Approval timed out'),
    );
    await expect($('button=Replace team credential')).toBeEnabled();
    await expect($('button=Cancel approval')).not.toExist();
  });
  it('cancels a pending renewal and enables another attempt', async () => {
    await mount();
    await approve('Renew');
    await $('button=Cancel approval').click();
    await expect($('[aria-label="Approval completed"]')).toHaveText(
      expect.stringContaining('Approval cancelled'),
    );
    await expect($('button=Replace team credential')).toBeEnabled();
    await expect($('button=Cancel approval')).not.toExist();
  });
});
