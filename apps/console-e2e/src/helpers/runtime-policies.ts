import type { Locator, Page } from '@playwright/test';

/**
 * Runtime policy editor controls, located by their accessible labels in one
 * place so label copy changes touch a single helper.
 */
export function policyToolNameInput(scope: Page | Locator): Locator {
  return scope.getByLabel('Tool name', { exact: true });
}

/**
 * Adds a shell command rule and fills its argv prefix. The editor starts a new
 * rule with the program token; each further token needs "Add token".
 */
export async function addPolicyShellCommand(
  scope: Page | Locator,
  argvPrefix: readonly [string, ...string[]],
): Promise<void> {
  await scope.getByRole('button', { name: 'Add shell command' }).click();
  const [program, ...rest] = argvPrefix;
  await scope.getByLabel('Program', { exact: true }).last().fill(program);
  for (const [index, token] of rest.entries()) {
    await scope.getByRole('button', { name: 'Add token' }).last().click();
    const label = index === 0 ? 'Subcommand' : `Token ${index + 2}`;
    await scope.getByLabel(label, { exact: true }).last().fill(token);
  }
}
