import { expect, type Page } from '@playwright/test';

export async function expectConsoleOverview(page: Page): Promise<void> {
  await expect(
    page.getByRole('heading', { name: /^Team pilot(?:, .+)?$/ }),
  ).toBeVisible();
}

export async function expectSelectedProjectTeam(
  page: Page,
  teamName: string,
): Promise<void> {
  await expect(
    page.getByText(`${teamName} is selected.`, { exact: false }),
  ).toBeVisible();
}
