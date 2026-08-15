import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  new URL('../../../.github/workflows/multi-lens-review.yml', import.meta.url),
  'utf8',
);
const proxyScript = readFileSync(
  new URL('../scripts/fly-database-proxy.sh', import.meta.url),
  'utf8',
);

function workflowJob(name: string, nextName: string): string {
  const jobStart = workflow.indexOf(`  ${name}:\n`);
  const jobEnd = workflow.indexOf(`\n  ${nextName}:\n`, jobStart);

  expect(jobStart).toBeGreaterThanOrEqual(0);
  expect(jobEnd).toBeGreaterThan(jobStart);
  return workflow.slice(jobStart, jobEnd);
}

function expectPrivateDatabaseProxy(job: string, consumerName: string): void {
  const setupIndex = job.indexOf(
    '- uses: superfly/flyctl-actions/setup-flyctl@ed8efb33836e8b2096c7fd3ba1c8afe303ebbff1',
  );
  const startIndex = job.indexOf('- name: Start private review database proxy');
  const consumerIndex = job.indexOf(`- name: ${consumerName}`);
  const stopIndex = job.indexOf('- name: Stop private review database proxy');

  expect(setupIndex).toBeGreaterThanOrEqual(0);
  expect(job).toContain('version: 0.4.39');
  expect(startIndex).toBeGreaterThan(setupIndex);
  expect(consumerIndex).toBeGreaterThan(startIndex);
  expect(stopIndex).toBeGreaterThan(consumerIndex);
  expect(job.slice(stopIndex)).toContain('if: always()');
  expect(job).toContain(
    'FLY_API_TOKEN: ${{ secrets.FLY_REVIEW_DB_PROXY_TOKEN }}',
  );
  expect(job).toContain(
    'SOURCE_DATABASE_URL: ${{ secrets.MULTI_LENS_REVIEW_DATABASE_URL }}',
  );
}

describe('multi-lens GitHub workflow', () => {
  it('installs a pinned uv action before provisioning the review database', () => {
    const job = workflowJob('runtime-preflight', 'orchestrate');
    const setupUvIndex = job.indexOf(
      '- uses: astral-sh/setup-uv@20cfd1bf945f4377ade1205e4dbc17946fc9a30d',
    );
    const provisionIndex = job.indexOf('- name: Provision Absurd schema');

    expect(setupUvIndex).toBeGreaterThanOrEqual(0);
    expect(provisionIndex).toBeGreaterThan(setupUvIndex);
  });

  it('proxies every database consumer through separate lifecycle steps', () => {
    const preflightJob = workflowJob('runtime-preflight', 'orchestrate');
    const orchestrateJob = workflowJob('orchestrate', 'review-workers');

    expectPrivateDatabaseProxy(preflightJob, 'Provision Absurd schema');
    expectPrivateDatabaseProxy(
      orchestrateJob,
      'Orchestrate reviews and synthesis',
    );
    expect(preflightJob.split('steps:')[0]).not.toContain(
      'MULTI_LENS_REVIEW_DATABASE_URL',
    );
    expect(orchestrateJob.split('steps:')[0]).not.toContain(
      'MULTI_LENS_REVIEW_DATABASE_URL',
    );
  });

  it('exports masked localhost database URLs and stops only the Fly process', () => {
    expect(proxyScript).toContain(
      'nohup flyctl proxy "${local_port}:${remote_port}"',
    );
    expect(proxyScript).toContain('echo "::add-mask::${local_database_url}"');
    expect(proxyScript).toContain(
      'printf \'ABSURD_DATABASE_URL=%s\\n\' "$local_database_url"',
    );
    expect(proxyScript).toContain(
      'printf \'MULTI_LENS_REVIEW_DATABASE_URL=%s\\n\' "$local_database_url"',
    );
    expect(proxyScript).toContain(
      `process_name="$(ps -p "$proxy_pid" -o comm= 2>/dev/null | tr -d '[:space:]')"`,
    );
    expect(proxyScript).not.toContain('wait "$proxy_pid"');
  });
});
