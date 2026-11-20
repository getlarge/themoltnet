#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Check actual build output, not the Vite plugin configuration. */
export function checkBuildAssets(projectRoot) {
  const assets = readdirSync(projectRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name);
  if (assets.length === 0) {
    return ['No root Markdown assets found; check the project path'];
  }
  const errors = [];
  for (const asset of assets) {
    const output = join(projectRoot, 'dist', asset);
    let bytes;
    try {
      bytes = readFileSync(output);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      errors.push(`Missing build asset: ${output}`);
      continue;
    }
    if (!bytes.equals(readFileSync(join(projectRoot, asset)))) {
      errors.push(`Build asset differs from source: ${output}`);
    }
  }
  return errors;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (!process.argv[2])
    throw new Error('Usage: check-build-assets.mjs <projectRoot>');
  const errors = checkBuildAssets(resolve(process.argv[2]));
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`Markdown build assets match source bytes: ${process.argv[2]}`);
  }
}
