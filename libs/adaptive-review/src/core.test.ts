import { readFileSync } from 'node:fs';

import type { ClassifyOutput } from '@moltnet/tasks';
import { describe, expect, it } from 'vitest';

import {
  applicableRules,
  buildClassifyTask,
  decideRoutes,
  LANES,
  mechanicalConcerns,
  packetize,
  type ReviewIdentity,
} from './core.js';
import { parseAdaptivePolicy } from './policy.js';

const policy = parseAdaptivePolicy(
  JSON.parse(
    readFileSync(
      new URL('../../../.github/adaptive-review.json', import.meta.url),
      'utf8',
    ),
  ),
);

const identity: ReviewIdentity = {
  repo: 'getlarge/themoltnet',
  pr: 42,
  title: 'Change API behavior',
  body: 'Adds a route',
  base: 'a'.repeat(40),
  head: 'b'.repeat(40),
  teamId: 'team',
  diaryId: 'diary',
  correlationId: 'correlation',
  classifierProfileId: 'profile',
};

const evidence = {
  manifest: 'one file',
  files: [
    {
      path: 'apps/rest-api/src/routes/foo.ts',
      patch:
        'diff --git a/apps/rest-api/src/routes/foo.ts b/apps/rest-api/src/routes/foo.ts\n@@ -1 +1 @@\n-old\n+new\n',
      bytes: 99,
    },
  ],
  bytes: 99,
  generatedPaths: [],
};

function answers(security = 0.01): ClassifyOutput['answers'] {
  const result: ClassifyOutput['answers'] = {};
  for (const lane of LANES) {
    result[lane] = {
      type: 'bool',
      probability: lane === 'security' ? security : 0.01,
    };
  }
  result['code-complexity'] = { type: 'score', score: 1, confidence: 1 };
  result['review-effort'] = { type: 'score', score: 2, confidence: 1 };
  return result;
}

describe('classifier-first routing', () => {
  it('gives each bounded packet every independent question and applicable rule', () => {
    const [packet] = packetize(evidence);
    const task = buildClassifyTask(identity, evidence, packet, policy);
    expect(Object.keys(task.input.questions)).toHaveLength(8);
    expect(task.input.state.packet[0].patch).toContain('+new');
    expect(
      applicableRules(['apps/rest-api/src/routes/foo.ts'], policy.rules).map(
        (rule) => rule.id,
      ),
    ).toContain('database-repository');
    expect(
      applicableRules(
        ['apps/rest-api/e2e/nested/route.test.ts'],
        policy.rules,
      ).map((rule) => rule.id),
    ).toContain('e2e-api-client');
    expect(task.input.state.rules.map((rule) => rule.id)).toContain(
      'runtime-typebox',
    );
  });

  it('selects repository rules across workspace, UI, docs, and review automation', () => {
    const cases = [
      ['packages/adaptive-review-action/package.json', 'nx-project-tasks'],
      ['libs/adaptive-review/tsconfig.lib.json', 'tsconfig-project-graph'],
      ['apps/rest-api-e2e/src/nested/route.test.ts', 'e2e-api-client'],
      ['apps/console/src/pages/Home.tsx', 'ui-accessibility'],
      ['docs/start/install-and-initialize.md', 'docs-canonical'],
      ['.github/workflows/adaptive-review.yml', 'review-workflow-trust'],
    ] as const;
    for (const [path, id] of cases) {
      expect(
        applicableRules([path], policy.rules).map((rule) => rule.id),
      ).toContain(id);
    }
  });

  it('matches nested glob paths and repeated tsconfig names without regex backtracking', () => {
    const nested = `apps/${'nested/'.repeat(200)}src/routes/example.ts`;
    expect(
      applicableRules([nested], policy.rules).map((rule) => rule.id),
    ).toContain('source-config-env');

    const path = `libs/adaptive-review/tsconfig${'tsconfig'.repeat(200)}.json`;
    expect(
      mechanicalConcerns(
        [{ status: 'modified', path }],
        [{ path, patch: '+"paths": {}', bytes: 12 }],
        policy.checks,
      ),
    ).toMatchObject([{ ruleId: 'tsconfig-paths', path }]);
  });

  it('keeps every byte of a large patch in bounded packets', () => {
    const patch = 'é'.repeat(24_001);
    const packets = packetize({
      ...evidence,
      files: [{ path: 'x.ts', patch, bytes: Buffer.byteLength(patch) }],
    });
    expect(packets.length).toBeGreaterThan(1);
    expect(
      packets
        .flatMap((packet) => packet.files)
        .map((file) => file.patch)
        .join(''),
    ).toBe(patch);
    expect(packets.every((packet) => packet.bytes <= 24_000)).toBe(true);
  });

  it('runs all lanes in shadow, then screens low-concern lanes in active mode', () => {
    const packets = packetize(evidence);
    const classified = [{ packetId: packets[0].id, answers: answers(0.12) }];
    expect(
      decideRoutes(
        'shadow',
        policy.lanes,
        packets,
        classified,
        [],
        [],
      ).routes.every((route) => route.run),
    ).toBe(true);
    const active = decideRoutes(
      'active',
      policy.lanes,
      packets,
      classified,
      [],
      [],
    );
    expect(
      active.routes.find((route) => route.lane === 'security'),
    ).toMatchObject({ run: true, reason: 'selected' });
    expect(active.routes.find((route) => route.lane === 'docs')).toMatchObject({
      run: false,
      reason: 'screened',
    });
    expect(active.scores['review-effort']).toBe(2);
  });

  it('routes all lanes on missing answers or incomplete evidence', () => {
    const packets = packetize(evidence);
    expect(
      decideRoutes('active', policy.lanes, packets, [], [], []).routes.every(
        (route) => route.run,
      ),
    ).toBe(true);
    expect(
      decideRoutes(
        'active',
        policy.lanes,
        packets,
        [{ packetId: packets[0].id, answers: answers() }],
        [],
        ['generated.ts'],
      ).routes.every((route) => route.run),
    ).toBe(true);
  });

  it('raises mechanical convention candidates but leaves exceptions for the deep reviewer', () => {
    const concerns = mechanicalConcerns(
      [{ status: 'modified', path: 'libs/database/src/schema.ts' }],
      [{ path: 'libs/database/src/schema.ts', patch: '+table', bytes: 6 }],
      policy.checks,
    );
    expect(concerns).toEqual([
      {
        ruleId: 'schema-migration',
        path: 'libs/database/src/schema.ts',
        detail: 'Schema changed without a SQL migration in the PR.',
      },
    ]);
    const packets = packetize(evidence);
    const routes = decideRoutes(
      'active',
      policy.lanes,
      packets,
      [{ packetId: packets[0].id, answers: answers() }],
      concerns,
      [],
    );
    expect(
      routes.routes.find((route) => route.lane === 'conventions')?.run,
    ).toBe(true);
  });

  it('flags direct environment reads and TSX test imports, while respecting config exceptions', () => {
    const files = [
      {
        path: 'apps/rest-api/src/routes/example.ts',
        patch: '+const key = process.env.KEY;',
        bytes: 29,
      },
      {
        path: 'apps/rest-api/src/config.ts',
        patch: '+const key = process.env.KEY;',
        bytes: 29,
      },
      {
        path: 'apps/console/src/example.test.tsx',
        patch: '+await import("./module");',
        bytes: 26,
      },
    ];
    const concerns = mechanicalConcerns(
      files.map((file) => ({ status: 'modified' as const, path: file.path })),
      files,
      policy.checks,
    );
    expect(concerns.map((concern) => concern.ruleId)).toEqual([
      'test-dynamic-import',
      'source-config-env',
    ]);
  });

  it('uses only the lanes and conventions supplied by an unrelated repository', () => {
    const other = parseAdaptivePolicy({
      version: 1,
      lanes: ['tests'],
      rules: [],
      checks: [],
    });
    const packets = packetize(evidence);
    const task = buildClassifyTask(identity, evidence, packets[0], other);
    expect(Object.keys(task.input.questions)).toEqual([
      'tests',
      'code-complexity',
      'review-effort',
    ]);
    expect(task.input.state.rules).toEqual([]);
    expect(
      applicableRules(['libs/database/src/schema.ts'], other.rules),
    ).toEqual([]);
    expect(
      mechanicalConcerns(
        [{ status: 'modified', path: 'libs/database/src/schema.ts' }],
        [],
        other.checks,
      ),
    ).toEqual([]);
    expect(
      decideRoutes('shadow', other.lanes, packets, [], [], []).routes.map(
        (route) => route.lane,
      ),
    ).toEqual(['tests']);
    expect(
      decideRoutes('active', other.lanes, packets, [], [], []).routes,
    ).toMatchObject([{ lane: 'tests', run: true, reason: 'classifier-error' }]);
  });

  it('uses the complete change manifest for companion and renamed-path checks', () => {
    const schema = {
      status: 'modified' as const,
      path: 'libs/database/src/schema.ts',
    };
    const migration = {
      status: 'added' as const,
      path: 'libs/database/drizzle/123.sql',
    };
    const schemaPatch = [{ path: schema.path, patch: '+table', bytes: 6 }];
    expect(
      mechanicalConcerns([schema, migration], schemaPatch, policy.checks),
    ).toEqual([]);
    for (const status of [
      'deleted',
      'renamed',
      'copied',
      'typechanged',
    ] as const) {
      expect(
        mechanicalConcerns(
          [schema, { ...migration, status }],
          schemaPatch,
          policy.checks,
        ),
      ).toMatchObject([{ ruleId: 'schema-migration' }]);
    }
    expect(
      mechanicalConcerns(
        [
          {
            status: 'renamed',
            previousPath: '.secretlintignore',
            path: 'old-ignore',
          },
        ],
        [],
        policy.checks,
      ),
    ).toMatchObject([{ ruleId: 'fixture-secretlint' }]);
  });

  it('marks missing patch content as unknown instead of passing an added-line check', () => {
    expect(
      mechanicalConcerns(
        [{ status: 'modified', path: 'apps/service/src/route.ts' }],
        [],
        policy.checks,
      ),
    ).toMatchObject([{ ruleId: 'source-config-env', unknown: true }]);
  });

  it('rejects malformed or capability-bearing policy instead of silently skipping it', () => {
    expect(() =>
      parseAdaptivePolicy({
        version: 1,
        lanes: ['tests', 'tests'],
        rules: [],
        checks: [],
      }),
    ).toThrow('unique');
    expect(() =>
      parseAdaptivePolicy({
        version: 1,
        lanes: ['tests'],
        rules: [],
        checks: [],
        command: 'curl',
      }),
    ).toThrow('schema');
    expect(() =>
      parseAdaptivePolicy({
        version: 1,
        lanes: ['tests'],
        rules: [],
        checks: [],
        docs: { config: '../private' },
      }),
    ).toThrow('reference');
  });
});
