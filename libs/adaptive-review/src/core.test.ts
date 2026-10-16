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
    const task = buildClassifyTask(identity, evidence, packet);
    expect(Object.keys(task.input.questions)).toHaveLength(8);
    expect(task.input.state.packet[0].patch).toContain('+new');
    expect(
      applicableRules(['apps/rest-api/src/routes/foo.ts']).map(
        (rule) => rule.id,
      ),
    ).toContain('database-repository');
    expect(
      applicableRules(['apps/rest-api/e2e/nested/route.test.ts']).map(
        (rule) => rule.id,
      ),
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
      expect(applicableRules([path]).map((rule) => rule.id)).toContain(id);
    }
  });

  it('matches nested glob paths and repeated tsconfig names without regex backtracking', () => {
    const nested = `apps/${'nested/'.repeat(200)}src/routes/example.ts`;
    expect(applicableRules([nested]).map((rule) => rule.id)).toContain(
      'source-config-env',
    );

    const path = `libs/adaptive-review/tsconfig${'tsconfig'.repeat(200)}.json`;
    expect(
      mechanicalConcerns([{ path, patch: '+"paths": {}', bytes: 12 }]),
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
      decideRoutes('shadow', packets, classified, [], []).routes.every(
        (route) => route.run,
      ),
    ).toBe(true);
    const active = decideRoutes('active', packets, classified, [], []);
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
      decideRoutes('active', packets, [], [], []).routes.every(
        (route) => route.run,
      ),
    ).toBe(true);
    expect(
      decideRoutes(
        'active',
        packets,
        [{ packetId: packets[0].id, answers: answers() }],
        [],
        ['generated.ts'],
      ).routes.every((route) => route.run),
    ).toBe(true);
  });

  it('raises mechanical convention candidates but leaves exceptions for the deep reviewer', () => {
    const concerns = mechanicalConcerns([
      { path: 'libs/database/src/schema.ts', patch: '+table', bytes: 6 },
    ]);
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
    const concerns = mechanicalConcerns([
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
    ]);
    expect(concerns.map((concern) => concern.ruleId)).toEqual([
      'source-config-env',
      'test-dynamic-import',
    ]);
  });
});
