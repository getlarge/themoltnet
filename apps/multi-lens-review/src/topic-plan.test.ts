import { describe, expect, it } from 'vitest';

import { reviewManifest } from './test-fixtures.js';
import {
  deterministicTopicPlan,
  MAX_PRIMARY_FILES_PER_TOPIC,
  MAX_SPECIALIST_TASKS,
  MAX_TOPICS,
  parseTopicPlanJson,
  plannerLaneBudgetGuidance,
  validateTopicPlan,
} from './topic-plan.js';
import type { ReviewTopic, TopicPlan } from './types.js';

function plan(topics: ReviewTopic[]): TopicPlan {
  return { version: 1, excludedFiles: [], topics };
}

describe('topic plan validation', () => {
  it('derives an actionable lane budget from trusted manifest classification', () => {
    const guidance = plannerLaneBudgetGuidance(
      reviewManifest(['src/a.ts', 'src/b.ts'], {
        requiresPlanning: true,
        requiredLanes: ['correctness', 'dry-codebase-fit', 'security', 'tests'],
      }),
      ['operability'],
    );

    expect(guidance).toContain(
      '2 reviewable file(s) currently require at least 5 lane task(s)',
    );
    expect(guidance).toContain('at most 6 such topics can fit');
    expect(guidance).toContain('Use an empty `lanes` array');
    expect(guidance).not.toContain('src/');
  });

  it('adds mandatory and trusted classified lanes that a planner omits', () => {
    const manifest = reviewManifest(['src/a.ts'], {
      requiresPlanning: true,
      requiredLanes: ['correctness', 'dry-codebase-fit', 'security'],
    });
    expect(
      validateTopicPlan(
        plan([
          {
            id: 'auth',
            title: 'Auth',
            primaryFiles: ['src/a.ts'],
            lanes: [],
          },
        ]),
        manifest,
      ).topics[0].lanes,
    ).toEqual(['correctness', 'dry-codebase-fit', 'security']);
  });

  it('rejects missing and duplicate primary ownership', () => {
    const manifest = reviewManifest(['a.ts', 'b.ts'], {
      requiresPlanning: true,
    });
    expect(() =>
      validateTopicPlan(
        plan([
          {
            id: 'one',
            title: 'One',
            primaryFiles: ['a.ts'],
            lanes: [],
          },
        ]),
        manifest,
      ),
    ).toThrow(/b\.ts has no primary owner/);
    expect(() =>
      validateTopicPlan(
        plan([
          {
            id: 'one',
            title: 'One',
            primaryFiles: ['a.ts'],
            lanes: [],
          },
          {
            id: 'two',
            title: 'Two',
            primaryFiles: ['a.ts', 'b.ts'],
            lanes: [],
          },
        ]),
        manifest,
      ),
    ).toThrow(/duplicate primary ownership/);
  });

  it('rejects unknown files and lanes', () => {
    expect(() =>
      validateTopicPlan(
        plan([
          {
            id: 'bad',
            title: 'Bad',
            primaryFiles: ['missing.ts'],
            lanes: ['unknown' as never],
          },
        ]),
        reviewManifest(['a.ts'], { requiresPlanning: true }),
      ),
    ).toThrow(/unknown primary file|unknown lanes/);
  });

  it('rejects excessive context overlap', () => {
    const manifest = reviewManifest(
      ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'shared.ts'],
      {
        requiresPlanning: true,
      },
    );
    expect(() =>
      validateTopicPlan(
        plan(
          ['a.ts', 'b.ts', 'c.ts', 'd.ts'].map((path, index) => ({
            id: `topic-${index}`,
            title: path,
            primaryFiles: [path, ...(index === 0 ? ['shared.ts'] : [])],
            contextFiles: index === 0 ? [] : ['shared.ts'],
            lanes: [],
          })),
        ),
        manifest,
      ),
    ).toThrow(/context file shared\.ts overlaps/);
  });

  it('rejects oversized topics, too many topics, and too many tasks', () => {
    const tooManyFiles = Array.from(
      { length: MAX_PRIMARY_FILES_PER_TOPIC + 1 },
      (_, index) => `${index}.ts`,
    );
    expect(() =>
      validateTopicPlan(
        plan([
          {
            id: 'large',
            title: 'Large',
            primaryFiles: tooManyFiles,
            lanes: [],
          },
        ]),
        reviewManifest(tooManyFiles, { requiresPlanning: true }),
      ),
    ).toThrow(/primary files/);

    const topicPaths = Array.from(
      { length: MAX_TOPICS + 1 },
      (_, index) => `${index}.ts`,
    );
    expect(() =>
      validateTopicPlan(
        plan(
          topicPaths.map((path, index) => ({
            id: `topic-${index}`,
            title: path,
            primaryFiles: [path],
            lanes: [],
          })),
        ),
        reviewManifest(topicPaths, { requiresPlanning: true }),
      ),
    ).toThrow(/topics; maximum/);

    const taskPaths = Array.from({ length: 5 }, (_, index) => `${index}.ts`);
    expect(() =>
      validateTopicPlan(
        plan(
          taskPaths.map((path, index) => ({
            id: `topic-${index}`,
            title: path,
            primaryFiles: [path],
            lanes: [
              'security',
              'performance',
              'design-api-backcompat',
              'tests',
              'operability',
              'readability',
            ],
          })),
        ),
        reviewManifest(taskPaths, { requiresPlanning: true }),
      ),
    ).toThrow(
      new RegExp(`${MAX_SPECIALIST_TASKS} specialist tasks|maximum is 32`),
    );
  });

  it('rejects topic byte budgets and malformed planner JSON', () => {
    expect(() =>
      validateTopicPlan(
        plan([
          {
            id: 'bytes',
            title: 'Bytes',
            primaryFiles: ['a.ts', 'b.ts'],
            lanes: [],
          },
        ]),
        reviewManifest(['a.ts', 'b.ts'], {
          requiresPlanning: true,
          byteSize: 40 * 1024,
        }),
      ),
    ).toThrow(/maximum is 65536/);
    expect(() => parseTopicPlanJson('```json\n{}\n```')).toThrow(/strict JSON/);
    expect(() =>
      parseTopicPlanJson(
        JSON.stringify({
          version: 1,
          excludedFiles: [],
          topics: [],
          surprise: true,
        }),
      ),
    ).toThrow(/unknown fields/);
  });

  it('uses one trusted deterministic topic below planning thresholds', () => {
    const result = deterministicTopicPlan(reviewManifest(['a.ts', 'b.ts']));
    expect(result.topics).toHaveLength(1);
    expect(result.topics[0]).toMatchObject({
      id: 'change',
      primaryFiles: ['a.ts', 'b.ts'],
      lanes: ['correctness', 'dry-codebase-fit'],
    });
  });
});
