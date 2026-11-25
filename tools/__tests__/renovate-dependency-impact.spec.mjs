import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';

import {
  dependencyImpact,
  truncateComment,
} from '../renovate/dependency-impact.mjs';

const cli = fileURLToPath(
  new URL('../renovate/dependency-impact.mjs', import.meta.url),
);

function runCli(base, head) {
  const dir = mkdtempSync(join(tmpdir(), 'renovate-impact-'));
  const paths = ['base.yaml', 'head.yaml', 'full.md', 'comment.md'].map(
    (name) => join(dir, name),
  );
  try {
    writeFileSync(paths[0], stringify(base));
    writeFileSync(paths[1], stringify(head));
    execFileSync(process.execPath, [cli, ...paths], { timeout: 10_000 });
    return {
      full: readFileSync(paths[2], 'utf8'),
      comment: readFileSync(paths[3], 'utf8'),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

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

describe('dependency impact CLI', () => {
  it('writes the full report and a compact report with the production list cap', () => {
    const base = fixture();
    const head = fixture('11.0.9');
    for (let i = 0; i < 20; i += 1) {
      head.importers[`apps/consumer-${i}`] = {
        dependencies: { nx: { specifier: 'catalog:', version: '24.0.6' } },
      };
    }

    const { full, comment } = runCli(base, head);

    expect(full).toBe(report(base, head));
    expect(comment).toBe(report(base, head, { limit: 12 }));
    expect(comment).toContain('more in the full report.');
    expect(full).not.toContain('more in the full report.');
  });

  it('hard-truncates a large CLI comment on a whole line and closes its open block', () => {
    const base = fixture();
    const head = fixture('11.0.9');
    for (const lock of [base, head]) {
      for (let i = 0; i < 800; i += 1) {
        const key = `consumer-${i}@1.0.0`;
        lock.packages[key] = {};
        lock.snapshots[key] = {
          dependencies: { minimatch: lock === base ? '10.2.6' : '11.0.9' },
        };
      }
    }
    const compact = report(base, head, { limit: 12 });
    expect(compact.length).toBeGreaterThan(50_000);
    const prefix = compact.slice(0, compact.lastIndexOf('\n', 49_000));

    const { full, comment } = runCli(base, head);

    expect(full).toBe(report(base, head));
    expect(comment).toBe(
      `${prefix}\n</details>\n\nReport truncated; see the full report artifact.\n`,
    );
    expect(comment.length).toBeLessThan(50_000);
    expect(comment.match(/^<details>$/gm)).toHaveLength(1);
    expect(comment.match(/^<\/details>$/gm)).toHaveLength(1);
    expect(full).toContain('**After: workspace declarations**');
  });

  it.each([{ args: [] }, { args: ['base.yaml'] }])(
    'rejects missing arguments: $args',
    ({ args }) => {
      const result = spawnSync(process.execPath, [cli, ...args], {
        encoding: 'utf8',
        timeout: 10_000,
      });

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        'Usage: dependency-impact.mjs BASE HEAD FULL.md COMMENT.md',
      );
    },
  );
});

describe('comment truncation', () => {
  it.each([49_999, 50_000])(
    'preserves a report of %i characters unchanged',
    (size) => {
      const text = 'x'.repeat(size);
      expect(truncateComment(text)).toBe(text);
    },
  );

  it.each([
    ['<details>\n- `</details>`\n', true],
    ['<details>\nAlready closed\n</details>\n', false],
    ['No details block\n', false],
  ])('closes only an open standalone block: %j', (header, open) => {
    const prefix = `${header}${'x'.repeat(48_800)}`;
    const text = `${prefix}\n${'y'.repeat(2_000)}`;

    const output = truncateComment(text);

    expect(output).toBe(
      `${prefix}\n${open ? '</details>\n' : ''}\nReport truncated; see the full report artifact.\n`,
    );
    expect(output.length).toBeLessThan(50_000);
  });

  it('does not split an oversized first line', () => {
    expect(truncateComment('x'.repeat(50_001))).toBe(
      '\n\nReport truncated; see the full report artifact.\n',
    );
  });
});

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

  it.each(['minimatch@11.0.9', 'npm:minimatch@11.0.9'])(
    'handles optional edges, alias %s, and exact peer-context references',
    (alias) => {
      const head = fixture('11.0.9');
      head.importers['.'].devDependencies.nx.version = '24.0.6(peer@1.0.0)';
      delete head.snapshots['nx@24.0.6'];
      head.snapshots['nx@24.0.6(peer@1.0.0)'] = {
        optionalDependencies: { alias },
      };
      head.snapshots['@nx/plugin@24.0.6'].dependencies.nx =
        '24.0.6(peer@1.0.0)';

      head.importers['.'].dependencies = {
        matcher: { specifier: 'npm:minimatch@11.0.9', version: alias },
      };
      const output = report(fixture(), head);

      expect(output).toContain(
        '. / dependencies / matcher (npm:minimatch@11.0.9)',
      );
      expect(output).toContain('nx@24.0.6 → minimatch@11.0.9');
      expect(output).toContain(
        '@nx/plugin@24.0.6 → nx@24.0.6 → minimatch@11.0.9',
      );
      expect(output).toContain('. / devDependencies / nx (catalog:)');
      expect(output).not.toContain('(peer@');
    },
  );

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
