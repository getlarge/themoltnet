import { describe, expect, it } from 'vitest';

import { moltnetEditorTheme, moltnetNodeRedThemeCssPath } from './index';

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
        favicon: '/favicon.svg',
        title: 'Traffic Fit Auditor',
      }),
    ).toEqual({
      page: {
        css: '/custom/theme.css',
        favicon: '/favicon.svg',
        title: 'Traffic Fit Auditor',
      },
    });
  });
});
