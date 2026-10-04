/**
 * Blocks World as typed stage results: the paper's running example, matching
 * the domain the authors' pipeline produced in a local reproduction (four
 * actions; Fast Downward finds the optimal 4-step plan for a-on-b-on-c).
 */
import type {
  ActionDef,
  Domain,
  PredicatesResult,
  Problem,
  ProblemResult,
  TypesResult,
} from './ir.js';

const p = (name: string, type: string) => ({ name, type });
const pos = (predicate: string, ...args: string[]) => ({
  predicate,
  args,
  negated: false,
});
const at = (predicate: string, ...args: string[]) => ({ predicate, args });

export const blocksTypes: TypesResult = {
  types: [
    { name: 'block', description: 'Stackable object' },
    { name: 'agent', description: 'Entity that performs actions' },
    { name: 'robotic-arm', parent: 'agent', description: 'Moves blocks' },
  ],
};

export const blocksPredicates: PredicatesResult = {
  predicates: [
    {
      name: 'on-table',
      parameters: [p('?b', 'block')],
      description: 'b is on the table',
    },
    {
      name: 'on-block',
      parameters: [p('?b1', 'block'), p('?b2', 'block')],
      description: 'b1 is on b2',
    },
    {
      name: 'clear',
      parameters: [p('?b', 'block')],
      description: 'nothing is on b',
    },
    {
      name: 'held-by-arm',
      parameters: [p('?b', 'block'), p('?a', 'robotic-arm')],
      description: 'a holds b',
    },
    {
      name: 'arm-empty',
      parameters: [p('?a', 'robotic-arm')],
      description: 'a holds nothing',
    },
  ],
};

export const blocksActions: ActionDef[] = [
  {
    name: 'pick-up',
    parameters: [p('?a', 'robotic-arm'), p('?b', 'block')],
    preconditions: [
      pos('arm-empty', '?a'),
      pos('on-table', '?b'),
      pos('clear', '?b'),
    ],
    addEffects: [at('held-by-arm', '?b', '?a')],
    deleteEffects: [
      at('on-table', '?b'),
      at('clear', '?b'),
      at('arm-empty', '?a'),
    ],
    source: 'picking up blocks',
  },
  {
    name: 'put-down',
    parameters: [p('?a', 'robotic-arm'), p('?b', 'block')],
    preconditions: [pos('held-by-arm', '?b', '?a')],
    addEffects: [
      at('on-table', '?b'),
      at('clear', '?b'),
      at('arm-empty', '?a'),
    ],
    deleteEffects: [at('held-by-arm', '?b', '?a')],
    source: 'placing them on the table',
  },
  {
    name: 'stack',
    parameters: [p('?a', 'robotic-arm'), p('?b1', 'block'), p('?b2', 'block')],
    preconditions: [pos('held-by-arm', '?b1', '?a'), pos('clear', '?b2')],
    addEffects: [
      at('on-block', '?b1', '?b2'),
      at('clear', '?b1'),
      at('arm-empty', '?a'),
    ],
    deleteEffects: [at('held-by-arm', '?b1', '?a'), at('clear', '?b2')],
    source: 'onto other blocks',
  },
  {
    name: 'unstack',
    parameters: [p('?a', 'robotic-arm'), p('?b1', 'block'), p('?b2', 'block')],
    preconditions: [
      pos('on-block', '?b1', '?b2'),
      pos('clear', '?b1'),
      pos('arm-empty', '?a'),
    ],
    addEffects: [at('held-by-arm', '?b1', '?a'), at('clear', '?b2')],
    deleteEffects: [
      at('on-block', '?b1', '?b2'),
      at('clear', '?b1'),
      at('arm-empty', '?a'),
    ],
    source: 'a block can be moved only if it is free',
  },
];

export const blocksProblemResult: ProblemResult = {
  objects: [
    { name: 'a', type: 'block' },
    { name: 'b', type: 'block' },
    { name: 'c', type: 'block' },
    { name: 'arm', type: 'robotic-arm' },
  ],
  init: [
    at('on-table', 'a'),
    at('on-table', 'b'),
    at('on-table', 'c'),
    at('clear', 'a'),
    at('clear', 'b'),
    at('clear', 'c'),
    at('arm-empty', 'arm'),
  ],
  goal: [pos('on-block', 'a', 'b'), pos('on-block', 'b', 'c')],
};

export const blocksDomain: Domain = {
  name: 'blocks-world',
  types: blocksTypes.types,
  predicates: blocksPredicates.predicates,
  actions: blocksActions,
};

export const blocksProblem: Problem = {
  name: 'tower-abc',
  ...blocksProblemResult,
};
