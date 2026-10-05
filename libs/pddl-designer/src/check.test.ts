import { describe, expect, it } from 'vitest';

import {
  checkActions,
  checkPredicates,
  checkProblem,
  checkTypes,
  permanentFacts,
  unlinkedParameters,
} from './check.js';
import type { ActionDef } from './ir.js';
import {
  blocksActions,
  blocksPredicates,
  blocksProblemResult,
  blocksTypes,
} from './test-fixtures.js';

const types = blocksTypes.types;
const predicates = blocksPredicates.predicates;

describe('checkTypes', () => {
  it('accepts a valid hierarchy', () => {
    expect(checkTypes(types)).toEqual([]);
  });

  it('rejects an undefined parent, the root type, and cycles', () => {
    // Act
    const issues = checkTypes([
      { name: 'object', description: 'root' },
      { name: 'coder', parent: 'agent', description: 'x' },
      { name: 'a', parent: 'b', description: 'x' },
      { name: 'b', parent: 'a', description: 'x' },
    ]);

    // Assert
    expect(issues.map((i) => i.message)).toEqual(
      expect.arrayContaining([
        '`object` is the implicit root type; omit it',
        'parent agent is not defined',
        'type hierarchy has a cycle',
      ]),
    );
  });
});

describe('checkPredicates', () => {
  it('rejects unknown parameter types', () => {
    // Act
    const issues = checkPredicates(types, [
      {
        name: 'on',
        parameters: [{ name: '?x', type: 'shelf' }],
        description: 'x',
      },
    ]);

    // Assert
    expect(issues).toEqual([
      {
        severity: 'error',
        path: 'predicates/on',
        message: 'parameter ?x has unknown type shelf',
      },
    ]);
  });
});

describe('checkActions', () => {
  it('accepts the Blocks World actions, with hints about unlinked parameters', () => {
    // Act
    const issues = checkActions(types, predicates, blocksActions);

    // Assert: any arm may move any block, which is legitimate here
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(issues.map((i) => i.path)).toEqual([
      'actions/pick-up',
      'actions/stack',
      'actions/unstack',
    ]);
  });

  it('rejects unknown predicates, wrong arity, non-parameters, and type mismatches', () => {
    // Arrange
    const bad: ActionDef = {
      name: 'bad',
      parameters: [
        { name: '?b', type: 'block' },
        { name: '?a', type: 'robotic-arm' },
      ],
      preconditions: [
        { predicate: 'floating', args: ['?b'], negated: false },
        { predicate: 'clear', args: ['?b', '?b'], negated: false },
        { predicate: 'clear', args: ['?z'], negated: false },
      ],
      addEffects: [{ predicate: 'clear', args: ['?a'] }],
      deleteEffects: [],
      source: 'test',
    };

    // Act
    const messages = checkActions(types, predicates, [bad])
      .filter((i) => i.severity === 'error')
      .map((i) => i.message);

    // Assert
    expect(messages).toEqual([
      'unknown predicate floating',
      'clear takes 1 argument(s), got 2',
      '?z is not a declared parameter of this action',
      'clear argument 1 expects block, got ?a of type robotic-arm',
    ]);
  });
});

describe('permanentFacts', () => {
  it('warns about a required fact that no action deletes', () => {
    // Arrange: approve adds `approved`, merge requires it, nothing deletes it
    const actions: ActionDef[] = [
      {
        name: 'approve',
        parameters: [{ name: '?b', type: 'block' }],
        preconditions: [],
        addEffects: [{ predicate: 'clear', args: ['?b'] }],
        deleteEffects: [],
        source: 'x',
      },
      {
        name: 'merge',
        parameters: [{ name: '?b', type: 'block' }],
        preconditions: [{ predicate: 'clear', args: ['?b'], negated: false }],
        addEffects: [{ predicate: 'on-table', args: ['?b'] }],
        deleteEffects: [],
        source: 'x',
      },
    ];

    // Act
    const issues = permanentFacts(predicates, actions);

    // Assert
    expect(issues).toEqual([
      {
        severity: 'warning',
        path: 'predicates/clear',
        message:
          'no action deletes clear: once added it stays true. Fine for a permanent milestone; a problem if a later step should not be able to reuse it',
      },
    ]);
  });
});

describe('checkProblem', () => {
  it('accepts the Blocks World problem', () => {
    expect(
      checkProblem(types, predicates, blocksActions, blocksProblemResult),
    ).toEqual([]);
  });

  it('reports actions that no object can ground', () => {
    // Arrange: blocks only, no arm
    const problem = {
      ...blocksProblemResult,
      objects: blocksProblemResult.objects.filter((o) => o.type === 'block'),
      init: [],
    };

    // Act
    const issues = checkProblem(types, predicates, blocksActions, problem);

    // Assert
    expect(issues.filter((i) => i.path === 'actions/pick-up')).toEqual([
      {
        severity: 'error',
        path: 'actions/pick-up',
        message:
          'no object can fill ?a - robotic-arm; declare at least one object of that type (actions cannot create objects)',
      },
    ]);
  });

  it('rejects facts about undeclared objects', () => {
    // Act
    const issues = checkProblem(types, predicates, blocksActions, {
      ...blocksProblemResult,
      init: [{ predicate: 'clear', args: ['d'] }],
    });

    // Assert
    expect(issues).toEqual([
      {
        severity: 'error',
        path: 'init/0',
        message: 'd is not a declared object',
      },
    ]);
  });
});

describe('unlinkedParameters', () => {
  it('flags parameters no precondition connects, and parameters in no precondition', () => {
    // Arrange: any busy coder may test any worktree; ?p is never constrained
    const runTests: ActionDef = {
      name: 'run-tests',
      parameters: [
        { name: '?c', type: 'coder' },
        { name: '?w', type: 'worktree' },
        { name: '?i', type: 'issue' },
        { name: '?p', type: 'patch' },
      ],
      preconditions: [
        { predicate: 'busy', args: ['?c'], negated: false },
        { predicate: 'assigned', args: ['?w', '?i'], negated: false },
      ],
      addEffects: [{ predicate: 'green', args: ['?w'] }],
      deleteEffects: [],
      source: 'x',
    };

    // Act
    const messages = unlinkedParameters(runTests).map((i) => i.message);

    // Assert
    expect(messages).toEqual([
      '?p - patch appears in no precondition, so the planner may pick any patch',
      'no precondition links {?c - coder} and {?w - worktree, ?i - issue}: any combination may be chosen. Add a precondition that ties them if only a specific one may act',
    ]);
  });

  it('is silent when one precondition ties all parameters', () => {
    expect(unlinkedParameters(blocksActions[1])).toEqual([]);
  });
});
