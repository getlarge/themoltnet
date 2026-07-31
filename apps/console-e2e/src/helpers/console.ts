import { expect, type Page } from '@playwright/test';

export async function expectConsoleOverview(page: Page): Promise<void> {
  await expect(
    page.getByRole('heading', { name: 'Operations', exact: true }),
  ).toBeVisible();
}

export async function expectSelectedProjectTeam(
  page: Page,
  teamName: string,
): Promise<void> {
  const teamSelect = page.locator('select[aria-label="Select team"]');
  await expect(teamSelect).toBeVisible();
  await expect(teamSelect.locator('option:checked')).toHaveText(teamName);
}
