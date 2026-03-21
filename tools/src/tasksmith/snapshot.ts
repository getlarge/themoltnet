#!/usr/bin/env -S npx tsx
/* eslint-disable no-console */

import { cp, mkdir, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import { resolveRepoRoot } from '@moltnet/context-evals/pipeline-shared';

const repoRoot = await resolveRepoRoot();
const tasksmithDir = resolve(repoRoot, 'tasksmith');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const snapshotDir = resolve(tasksmithDir, 'baselines', timestamp);

await mkdir(snapshotDir, { recursive: true });

const dirs = ['candidates/tasks', 'candidates/status', 'verified'];
let totalFiles = 0;

for (const dir of dirs) {
  const src = resolve(tasksmithDir, dir);
  const dest = resolve(snapshotDir, dir);

  try {
    await stat(src);
  } catch {
    continue;
  }

  await mkdir(dest, { recursive: true });
  const files = await readdir(src);
  const jsonFiles = files.filter((f) => f.endsWith('.json'));

  for (const file of jsonFiles) {
    await cp(resolve(src, file), resolve(dest, file));
  }

  totalFiles += jsonFiles.length;
  console.log(`[snapshot] ${dir}: ${jsonFiles.length} files`);
}

// Also snapshot evals criteria
const evalsDir = resolve(repoRoot, 'evals');
try {
  const evalDirs = (await readdir(evalsDir)).filter((d) => d.startsWith('pr-'));
  const critDest = resolve(snapshotDir, 'evals');
  await mkdir(critDest, { recursive: true });

  let criteriaCount = 0;
  for (const dir of evalDirs) {
    const criteriaFile = resolve(evalsDir, dir, 'criteria.json');
    try {
      await stat(criteriaFile);
      const destDir = resolve(critDest, dir);
      await mkdir(destDir, { recursive: true });
      await cp(criteriaFile, resolve(destDir, 'criteria.json'));
      criteriaCount++;
    } catch {
      // no criteria for this PR
    }
  }
  console.log(`[snapshot] evals/criteria: ${criteriaCount} files`);
  totalFiles += criteriaCount;
} catch {
  // no evals dir
}

console.log(
  `\n[snapshot] Saved ${totalFiles} files to tasksmith/baselines/${timestamp}/`,
);
