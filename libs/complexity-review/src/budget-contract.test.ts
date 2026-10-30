import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  MAX_SERIAL_DOMAIN_WORK,
  STAGE_DISPATCH_TIMEOUT_SEC,
  STAGE_RUNNING_TIMEOUT_SEC,
} from './workflow.js';

const root = resolve(import.meta.dirname, '../../..');
const stageSec = STAGE_DISPATCH_TIMEOUT_SEC + STAGE_RUNNING_TIMEOUT_SEC;

function jobTimeout(workflowName: string, job: string): number {
  const workflow = readFileSync(
    resolve(root, `.github/workflows/${workflowName}.yml`),
    'utf8',
  );
  const block = workflow.split(`\n  ${job}:\n`)[1]?.split(/^ {2}[\w-]+:/m)[0];
  const minutes = /^ {4}timeout-minutes: (\d+)/m.exec(block ?? '')?.[1];
  if (!minutes) throw new Error(`missing timeout for ${workflowName}/${job}`);
  return Number(minutes) * 60;
}

describe('complexity review deadlines', () => {
  it('fits serial domain work into the adaptive review job', () => {
    const criticalPathSec = (MAX_SERIAL_DOMAIN_WORK + 2) * stageSec;

    expect(
      jobTimeout('adaptive-review-reusable', 'review') - criticalPathSec,
    ).toBeGreaterThanOrEqual(10 * 60);
  });

  it('gives each model turn enough time for the input-only profile', () => {
    const profile = JSON.parse(
      readFileSync(
        resolve(
          root,
          '.github/runtime-profiles/legreffier-complexity-review-v2.json',
        ),
        'utf8',
      ),
    ) as { maxTurns: number };

    expect(STAGE_RUNNING_TIMEOUT_SEC / profile.maxTurns).toBeGreaterThanOrEqual(
      20,
    );
  });
});
