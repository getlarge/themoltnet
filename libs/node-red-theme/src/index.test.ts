import { readFile } from 'node:fs/promises';

import { lightColors } from '@themoltnet/design-system/tokens';
import { describe, expect, it } from 'vitest';

import { moltnetEditorTheme, moltnetNodeRedThemeCssPath } from './index';
import { moltnetNodeRedThemeCss } from './theme-css';

describe('moltnetEditorTheme', () => {
  it('points Node-RED at the packaged MoltNet CSS by default', () => {
    expect(moltnetNodeRedThemeCssPath).toMatch(/moltnet-node-red-theme\.css$/);
    expect(moltnetEditorTheme()).toEqual({
      page: {
        css: moltnetNodeRedThemeCssPath,
      },
    });
  });

  it('preserves caller-owned page settings', () => {
    expect(
      moltnetEditorTheme({
        css: '/custom/theme.css',
        favicon: '/theme/favicon/moltnet.svg',
        title: 'MoltNet Flow Studio',
      }),
    ).toEqual({
      page: {
        css: '/custom/theme.css',
        favicon: '/theme/favicon/moltnet.svg',
        title: 'MoltNet Flow Studio',
      },
    });
  });

  it('uses design system token values in the generated theme css', async () => {
    expect(moltnetNodeRedThemeCss).toContain(lightColors.primary.DEFAULT);
    expect(moltnetNodeRedThemeCss).toContain(lightColors.primary.hover);

    const sourceCss = await readFile(moltnetNodeRedThemeCssPath, 'utf8');

    expect(sourceCss).toContain(lightColors.primary.DEFAULT);
    expect(sourceCss).toContain(lightColors.primary.hover);
  });
});
