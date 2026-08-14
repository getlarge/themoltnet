import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  new URL('../../../.github/workflows/multi-lens-review.yml', import.meta.url),
  'utf8',
);

describe('multi-lens GitHub workflow', () => {
  it('installs uv before provisioning the review database', () => {
    const jobStart = workflow.indexOf('  runtime-preflight:\n');
    const jobEnd = workflow.indexOf('\n  orchestrate:\n', jobStart);
    const job = workflow.slice(jobStart, jobEnd);
    const setupUvIndex = job.indexOf('- uses: astral-sh/setup-uv@v10');
    const provisionIndex = job.indexOf('- name: Provision Absurd schema');

    expect(jobStart).toBeGreaterThanOrEqual(0);
    expect(jobEnd).toBeGreaterThan(jobStart);
    expect(setupUvIndex).toBeGreaterThanOrEqual(0);
    expect(provisionIndex).toBeGreaterThan(setupUvIndex);
  });
});
