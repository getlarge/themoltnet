import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

import { accessibilityConfig } from '../../eslint.config.mjs';

const root = resolve(import.meta.dirname, '../..');
const baseline = JSON.parse(
  readFileSync(
    new URL('./fixtures/eslint-a11y-v9.json', import.meta.url),
    'utf8',
  ),
);
const projects = [
  ['apps/console', 'apps/console', false],
  // The desktop target explicitly loads its config from the workspace root.
  ['apps/agent-desktop', '.', false],
  ['libs/design-system', 'libs/design-system', true],
  ['libs/diary-ui', 'libs/diary-ui', false],
  ['libs/task-ui', 'libs/task-ui', false],
  ['libs/entry-explore-mcp-app', 'libs/entry-explore-mcp-app', false],
];

function activeAccessibilityRules(rules) {
  return Object.fromEntries(
    Object.entries(rules)
      .filter(([name]) => name.startsWith('jsx-a11y/'))
      .map(([name, value]) => {
        const [severity, ...options] = Array.isArray(value) ? value : [value];
        const level = { off: 0, warn: 1, error: 2 }[severity] ?? severity;
        return [name, [level, ...options]];
      })
      .filter(([, [severity]]) => severity !== 0),
  );
}

function projectLinter(project, cwd = project) {
  return new ESLint({
    cwd: resolve(root, cwd),
    overrideConfigFile: resolve(root, project, 'eslint.config.mjs'),
  });
}

const jsxLinter = new ESLint({
  cwd: root,
  overrideConfigFile: true,
  overrideConfig: [{ ...accessibilityConfig, files: ['**/*.jsx'] }],
});

async function lintJsx(code) {
  const [result] = await jsxLinter.lintText(code, {
    filePath: resolve(root, 'eslint10-probe.jsx'),
  });
  return result.messages;
}

describe('ESLint 10 compatibility', () => {
  it('preserves the enabled recommended preset before option defaults are applied', () => {
    expect(activeAccessibilityRules(accessibilityConfig.rules)).toEqual(
      activeAccessibilityRules(baseline.rules),
    );
  });

  it.each(projects)(
    'preserves active accessibility severities and options for %s',
    async (project, cwd, checkLabels) => {
      const expected = { ...baseline.rules };
      if (!checkLabels)
        expected['jsx-a11y/label-has-associated-control'] = 'off';
      const config = await projectLinter(project, cwd).calculateConfigForFile(
        resolve(root, project, 'src/__eslint10_probe.tsx'),
      );

      // ESLint 10 fills in rule meta.defaultOptions. Normalize the frozen
      // policy through the same engine rather than treating those defaults
      // as newly configured options.
      const baselineLinter = new ESLint({
        cwd: root,
        overrideConfigFile: true,
        overrideConfig: [
          { ...accessibilityConfig, files: ['**/*.jsx'], rules: expected },
        ],
      });
      const expectedConfig = await baselineLinter.calculateConfigForFile(
        resolve(root, 'eslint10-probe.jsx'),
      );

      expect(activeAccessibilityRules(config.rules)).toEqual(
        activeAccessibilityRules(expectedConfig.rules),
      );
    },
  );

  it.each([
    ['export const icon = <img src="/test.png" />;', 'jsx-a11y/alt-text'],
    [
      'export const button = <button aria-unknown="true" />;',
      'jsx-a11y/aria-props',
    ],
    [
      'export const control = <div onClick={() => {}}>Open</div>;',
      'jsx-a11y/click-events-have-key-events',
    ],
  ])('still reports accessibility violations in %s', async (code, ruleId) => {
    expect(await lintJsx(code)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleId, severity: 2 }),
      ]),
    );
  });

  it('accepts valid JSX', async () => {
    expect(
      await lintJsx(
        'export const button = <button type="button">Open</button>;',
      ),
    ).toEqual([]);
  });

  it('preserves existing inline rule suppressions', async () => {
    expect(
      await lintJsx(
        '// eslint-disable-next-line jsx-a11y/alt-text\n' +
          'export const icon = <img src="/test.png" />;',
      ),
    ).toEqual([]);
  });

  it('isolates the existing n8n toolchain from the ESLint 10 default', () => {
    const n8nRequire = createRequire(
      resolve(root, 'libs/n8n-nodes-moltnet/package.json'),
    );

    expect(ESLint.version).toMatch(/^10\./);
    expect(n8nRequire('eslint/package.json').version).toBe('9.39.5');
  });

  it('retains Nx module-boundary and JSON dependency checks', async () => {
    const linter = projectLinter('libs/sdk');
    const source = await linter.calculateConfigForFile(
      resolve(root, 'libs/sdk/src/index.ts'),
    );
    const manifest = await linter.calculateConfigForFile(
      resolve(root, 'libs/sdk/package.json'),
    );

    expect(source.rules['@nx/enforce-module-boundaries'][0]).toBe(2);
    expect(manifest.rules['@nx/dependency-checks'][0]).toBe(2);
  });

  it('preserves the core policy instead of adopting new recommended rules', async () => {
    const linter = new ESLint({
      cwd: root,
      overrideConfigFile: resolve(root, 'eslint.config.mjs'),
    });
    const config = await linter.calculateConfigForFile(
      resolve(root, 'tools/__eslint10_probe.mjs'),
    );

    expect(config.rules['no-unassigned-vars'][0]).toBe(0);
    expect(config.rules['no-useless-assignment'][0]).toBe(0);
    expect(config.rules['preserve-caught-error'][0]).toBe(0);
    expect(config.rules['no-dupe-keys'][0]).toBe(2);
  });
});
