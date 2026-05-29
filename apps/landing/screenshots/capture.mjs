// Capture the landing product screenshots from the committed mockup HTML.
//
// Usage:
//   node apps/landing/screenshots/capture.mjs
//
// Renders each mockup under ./src at a fixed 1280x800 viewport with a 2x
// device scale factor (2560x1600 output) and writes the PNGs to
// ../public/screenshots/. See docs/reference/landing-screenshots.md.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { chromium } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, 'src');
const outDir = join(__dirname, '..', 'public', 'screenshots');

const shots = ['board', 'live-pane', 'create-task'];

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
});

for (const name of shots) {
  const page = await context.newPage();
  await page.goto(`file://${join(srcDir, `${name}.html`)}`);
  // Let webfonts (if any) settle; the mockups use system mono as fallback.
  await page.waitForTimeout(150);
  // Clip to the actual content height so the PNG has no dead space below the
  // mockup. The body uses min-height:800 for layout, so its own box is always
  // >=800 — instead measure the furthest-reaching child's bottom edge and add
  // the body's bottom padding back. Width stays fixed at 1280; DPR 2 doubles
  // both dimensions in the output file.
  const contentHeight = await page.evaluate(() => {
    const pad = parseFloat(getComputedStyle(document.body).paddingBottom) || 0;
    let maxBottom = 0;
    for (const el of document.body.children) {
      maxBottom = Math.max(maxBottom, el.getBoundingClientRect().bottom);
    }
    return Math.ceil(maxBottom + pad);
  });
  const out = join(outDir, `${name}.png`);
  await page.screenshot({
    path: out,
    clip: { x: 0, y: 0, width: 1280, height: contentHeight },
  });
  console.log(`captured ${name} (${1280}x${contentHeight}) -> ${out}`);
  await page.close();
}

await browser.close();
