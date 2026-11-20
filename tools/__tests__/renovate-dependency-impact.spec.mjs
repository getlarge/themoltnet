import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';

import { dependencyImpact } from '../renovate/dependency-impact.mjs';

function fixture(version = '10.2.6') {
  return {
    lockfileVersion: '9.0',
    importers: {
      '.': {
        devDependencies: {
          nx: { specifier: 'catalog:', version: '24.0.6' },
        },
      },
      'apps/example': {
        dependencies: {
          '@nx/plugin': { specifier: 'catalog:', version: '24.0.6' },
        },
      },
    },
    packages: {
      'nx@24.0.6': {},
      '@nx/plugin@24.0.6': {},
      [`minimatch@${version}`]: {},
    },
    snapshots: {
      'nx@24.0.6': { dependencies: { minimatch: version } },
      '@nx/plugin@24.0.6': { dependencies: { nx: '24.0.6' } },
      [`minimatch@${version}`]: {},
    },
  };
}
const report = (base, head, options) =>
  dependencyImpact(stringify(base), stringify(head), options);

describe('Renovate dependency impact', () => {
  it('shows actual versions, parents, grandparents and direct declarations on both sides', () => {
    const output = report(fixture(), fixture('11.0.9'));

    expect(output).toContain('1 package(s) changed resolved versions.');
    expect(output).toContain('`10.2.6` → `11.0.9`');
    expect(output).toContain('nx@24.0.6 → minimatch@10.2.6');
    expect(output).toContain(
      '@nx/plugin@24.0.6 → nx@24.0.6 → minimatch@11.0.9',
    );
    expect(output).toContain('. / devDependencies / nx (catalog:)');
    expect(output).toContain(
      'apps/example / dependencies / @nx/plugin (catalog:)',
    );
    expect(output).toContain('not API compatibility');
  });

  it('reports changed overrides even when resolved versions stay unchanged', () => {
    const base = fixture();
    const head = fixture();
    base.overrides = { minimatch: '>=10.2.6 <11' };
    head.overrides = { minimatch: '>=10.2.6 <12' };

    const output = report(base, head);

    expect(output).toContain('0 package(s) changed resolved versions.');
    expect(output).toContain('`minimatch`: `>=10.2.6 <11` → `>=10.2.6 <12`');
  });

  it('handles optional edges, aliases, and exact peer-context references', () => {
    const head = fixture('11.0.9');
    head.importers['.'].devDependencies.nx.version = '24.0.6(peer@1.0.0)';
    delete head.snapshots['nx@24.0.6'];
    head.snapshots['nx@24.0.6(peer@1.0.0)'] = {
      optionalDependencies: { alias: 'minimatch@11.0.9' },
    };
    head.snapshots['@nx/plugin@24.0.6'].dependencies.nx = '24.0.6(peer@1.0.0)';

    const output = report(fixture(), head);

    expect(output).toContain('nx@24.0.6 → minimatch@11.0.9');
    expect(output).toContain(
      '@nx/plugin@24.0.6 → nx@24.0.6 → minimatch@11.0.9',
    );
    expect(output).toContain('. / devDependencies / nx (catalog:)');
    expect(output).not.toContain('(peer@');
  });

  it('does not invent a chain between different peer contexts', () => {
    const head = fixture('11.0.9');
    delete head.snapshots['nx@24.0.6'];
    head.snapshots['nx@24.0.6(peer@1)'] = {
      dependencies: { minimatch: '11.0.9' },
    };
    head.snapshots['nx@24.0.6(peer@2)'] = {};
    head.snapshots['@nx/plugin@24.0.6'].dependencies.nx = '24.0.6(peer@2)';
    const output = report(fixture(), head).split('**After: parents**')[1];

    expect(output).toContain('nx@24.0.6 → minimatch@11.0.9');
    expect(output).not.toContain('@nx/plugin@24.0.6 → nx@24.0.6');
  });

  it('handles cycles without walking infinitely', () => {
    const head = fixture('11.0.9');
    head.snapshots['nx@24.0.6'].dependencies['@nx/plugin'] = '24.0.6';

    expect(report(fixture(), head)).toContain('. / devDependencies / nx');
  });

  it('handles multi-document pnpm locks and scoped package additions/removals', () => {
    const bootstrap = stringify({
      lockfileVersion: '9.0',
      packages: {},
      snapshots: {},
    });
    const base = fixture();
    const head = fixture();
    delete head.packages['minimatch@10.2.6'];
    head.packages['@scope/added@2.0.0'] = {};

    const output = dependencyImpact(
      `---\n${bootstrap}---\n${stringify(base)}`,
      `---\n${bootstrap}---\n${stringify(head)}`,
    );

    expect(output).toContain('2 package(s) changed resolved versions.');
    expect(output).toContain('### `@scope/added`');
    expect(output).toContain('`absent` → `2.0.0`');
    expect(output).toContain('`10.2.6` → `absent`');
  });

  it('keeps independent YAML document graphs separate', () => {
    const bootstrap = fixture('11.0.9');
    bootstrap.importers = {};
    delete bootstrap.snapshots['@nx/plugin@24.0.6'];
    const head = fixture('11.0.9');
    head.snapshots['nx@24.0.6'] = {};

    const output = dependencyImpact(
      `---\n${stringify(bootstrap)}---\n${stringify(fixture())}`,
      `---\n${stringify(bootstrap)}---\n${stringify(head)}`,
    );

    expect(output).not.toContain(
      '@nx/plugin@24.0.6 → nx@24.0.6 → minimatch@11.0.9',
    );
  });

  it('ignores peer-only changes and unchanged multiple-version sets', () => {
    const head = fixture();
    head.snapshots['nx@24.0.6(peer@1)'] = head.snapshots['nx@24.0.6'];

    expect(report(fixture(), head)).toContain('0 package(s) changed');
  });

  it('sorts output independently of map insertion order', () => {
    const head = fixture('11.0.9');
    const shuffled = structuredClone(head);
    for (const key of ['packages', 'snapshots', 'importers']) {
      shuffled[key] = Object.fromEntries(Object.entries(head[key]).reverse());
    }

    expect(report(fixture(), shuffled)).toBe(report(fixture(), head));
  });

  it('clearly marks compact-output omissions without hiding them in the full report', () => {
    const head = fixture('11.0.9');

    expect(report(fixture(), head, { limit: 1 })).toContain(
      'more in the full report',
    );
    expect(report(fixture(), head)).not.toContain('more in the full report');
  });

  it('fails on malformed or unsupported lockfiles rather than producing a clean report', () => {
    expect(() => dependencyImpact('', stringify(fixture()))).toThrow();
    expect(() => dependencyImpact('bad: [', stringify(fixture()))).toThrow();
    expect(() =>
      dependencyImpact('lockfileVersion: 10', stringify(fixture())),
    ).toThrow();
  });

  it('keeps lockfile strings inside inline code', () => {
    const head = fixture('11.0.9');
    head.importers['.'].devDependencies.nx.specifier = '`\n@someone';

    expect(report(fixture(), head)).toContain('(ˋ @someone)`');
  });

  it('runs the comment writer from the base revision and treats the PR only as data', () => {
    const workflow = parse(
      readFileSync(
        new URL(
          '../../.github/workflows/renovate-dependency-impact.yml',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    const job = workflow.jobs.report;
    const checkout = job.steps.find((step) =>
      step.uses?.startsWith('actions/checkout@'),
    );
    const compare = job.steps.find(
      (step) => step.name === 'Compare lockfiles as data',
    );

    expect(workflow.on.pull_request_target.paths).toEqual(['pnpm-lock.yaml']);
    expect(job.if).toContain('vars.RENOVATE_APP_BOT_LOGIN');
    expect(job.if).toContain('head.repo.full_name == github.repository');
    expect(checkout.with.ref).toBe('${{ github.event.pull_request.base.sha }}');
    expect(checkout.with['persist-credentials']).toBe(false);
    expect(checkout.with['fetch-depth']).toBe(0);
    expect(checkout.with.filter).toBe('blob:none');
    expect(compare.run).toContain('git merge-base "$BASE_SHA" "$HEAD_SHA"');
    expect(compare.run).toContain('git show "$merge_base:pnpm-lock.yaml"');
    expect(compare.run).toContain('git show "$HEAD_SHA:pnpm-lock.yaml"');
    expect(compare.run).not.toContain('checkout');
    expect(
      job.steps.filter((step) => step.uses?.startsWith('actions/checkout@')),
    ).toHaveLength(1);
    expect(job.steps.at(-1).with.script).toContain(
      'current.data.head.sha !== process.env.HEAD_SHA',
    );
    expect(job.steps.at(-1).with.script).toContain(
      "comment.user?.login === 'github-actions[bot]'",
    );
  });
});
