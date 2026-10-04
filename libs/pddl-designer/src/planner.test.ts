import { describe, expect, it } from 'vitest';

import type { Domain, Problem } from './ir.js';
import { checkPlan, ground } from './planner.js';
import { blocksDomain, blocksProblem } from './test-fixtures.js';

describe('checkPlan', () => {
  it('finds the optimal 4-step Blocks World plan', () => {
    // Act
    const result = checkPlan(blocksDomain, blocksProblem);

    // Assert
    expect(result.plan).toMatchObject({ status: 'found' });
    expect(result.plan.status === 'found' && result.plan.steps).toEqual([
      '(pick-up arm b)',
      '(stack arm b c)',
      '(pick-up arm a)',
      '(stack arm a b)',
    ]);
  });

  it('reports zero instances and the empty parameter type when no object can fill it', () => {
    // Arrange: the arm exists but no block does
    const problem: Problem = {
      ...blocksProblem,
      objects: [{ name: 'arm', type: 'robotic-arm' }],
      init: [{ predicate: 'arm-empty', args: ['arm'] }],
      goal: [{ predicate: 'arm-empty', args: ['arm'], negated: true }],
    };

    // Act
    const result = checkPlan(blocksDomain, problem);

    // Assert
    expect(result.grounding.find((r) => r.action === 'pick-up')).toEqual({
      action: 'pick-up',
      instances: 0,
      emptyParameters: ['?b - block'],
    });
    expect(result.plan.status).toBe('unsolvable');
  });

  it('counts subtype objects for a parent-typed parameter', () => {
    // Arrange: `agent` parameter is filled by a `robotic-arm` object
    const domain: Domain = {
      ...blocksDomain,
      actions: [
        {
          name: 'rest',
          parameters: [{ name: '?x', type: 'agent' }],
          preconditions: [],
          addEffects: [{ predicate: 'arm-empty', args: ['?x'] }],
          deleteEffects: [],
          source: 'test',
        },
      ],
    };

    // Act
    const { rows } = ground(domain, blocksProblem);

    // Assert
    expect(rows).toEqual([
      { action: 'rest', instances: 1, emptyParameters: [] },
    ]);
  });

  it('honours negative preconditions', () => {
    // Arrange: `go` may only run while `done` is false
    const domain: Domain = {
      name: 'neg',
      types: [{ name: 'thing', description: 't' }],
      predicates: [
        {
          name: 'done',
          parameters: [{ name: '?t', type: 'thing' }],
          description: 'd',
        },
        {
          name: 'count',
          parameters: [{ name: '?t', type: 'thing' }],
          description: 'c',
        },
      ],
      actions: [
        {
          name: 'go',
          parameters: [{ name: '?t', type: 'thing' }],
          preconditions: [{ predicate: 'done', args: ['?t'], negated: true }],
          addEffects: [{ predicate: 'done', args: ['?t'] }],
          deleteEffects: [],
          source: 'test',
        },
      ],
    };
    const problem: Problem = {
      name: 'p',
      objects: [{ name: 't1', type: 'thing' }],
      init: [{ predicate: 'done', args: ['t1'] }],
      goal: [{ predicate: 'count', args: ['t1'], negated: false }],
    };

    // Act
    const result = checkPlan(domain, problem);

    // Assert
    expect(result.plan.status).toBe('unsolvable');
  });

  it('stops at the state limit instead of searching forever', () => {
    // Act
    const result = checkPlan(blocksDomain, blocksProblem, {
      maxGroundActions: 1000,
      maxStates: 3,
    });

    // Assert
    expect(result.plan).toMatchObject({ status: 'limit' });
  });

  it('finds the reuse shortcut when no action deletes an approval', () => {
    // Arrange: approval is never deleted, so one approval merges two items
    const domain: Domain = {
      name: 'reuse',
      types: [
        { name: 'item', description: 'work item' },
        { name: 'review', description: 'review slot' },
      ],
      predicates: [
        {
          name: 'approved',
          parameters: [{ name: '?r', type: 'review' }],
          description: 'a',
        },
        {
          name: 'merged',
          parameters: [{ name: '?i', type: 'item' }],
          description: 'm',
        },
      ],
      actions: [
        {
          name: 'approve',
          parameters: [{ name: '?r', type: 'review' }],
          preconditions: [],
          addEffects: [{ predicate: 'approved', args: ['?r'] }],
          deleteEffects: [],
          source: 'a reviewer approves',
        },
        {
          name: 'merge',
          parameters: [
            { name: '?i', type: 'item' },
            { name: '?r', type: 'review' },
          ],
          preconditions: [
            { predicate: 'approved', args: ['?r'], negated: false },
          ],
          addEffects: [{ predicate: 'merged', args: ['?i'] }],
          deleteEffects: [],
          source: 'approved work is merged',
        },
      ],
    };
    const problem: Problem = {
      name: 'two-items',
      objects: [
        { name: 'i1', type: 'item' },
        { name: 'i2', type: 'item' },
        { name: 'r1', type: 'review' },
      ],
      init: [],
      goal: [
        { predicate: 'merged', args: ['i1'], negated: false },
        { predicate: 'merged', args: ['i2'], negated: false },
      ],
    };

    // Act
    const result = checkPlan(domain, problem);

    // Assert: one approval serves both merges
    expect(result.plan.status === 'found' && result.plan.steps).toEqual([
      '(approve r1)',
      '(merge i1 r1)',
      '(merge i2 r1)',
    ]);
  });
});
