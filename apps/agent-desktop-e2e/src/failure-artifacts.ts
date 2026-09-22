import { mkdirSync } from 'node:fs';

import { browser } from '@wdio/globals';

export async function captureFailure(
  test: { title: string },
  _context: unknown,
  result: { passed: boolean },
) {
  if (result.passed) return;
  try {
    mkdirSync('test-results', { recursive: true });
    const name = test.title.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 100);
    await browser.saveScreenshot(`test-results/failure-${name}.png`);
  } catch {
    /* Preserve the original test failure. */
  }
}
