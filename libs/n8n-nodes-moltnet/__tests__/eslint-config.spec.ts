import { resolve } from 'node:path';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const packageRoot = resolve(__dirname, '..');

describe('n8n ESLint composition', () => {
  it('loads upstream presets with one TypeScript plugin and keeps n8n rules', async () => {
    const eslint = new ESLint({ cwd: packageRoot });
    const config = await eslint.calculateConfigForFile(
      'nodes/MoltNet/MoltNet.node.ts',
    );

    expect(config.plugins['@typescript-eslint']).toBeDefined();
    for (const rule of [
      '@n8n/community-nodes/no-dangerous-functions',
      '@n8n/community-nodes/no-restricted-globals',
      '@n8n/community-nodes/no-restricted-imports',
    ]) {
      expect(config.rules[rule][0], rule).toBe(2);
    }
  });
});
