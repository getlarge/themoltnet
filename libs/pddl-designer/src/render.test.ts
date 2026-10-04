import { describe, expect, it } from 'vitest';

import type { Domain } from './ir.js';
import { renderDomain, renderProblem, requirements } from './render.js';
import { blocksDomain, blocksProblem } from './test-fixtures.js';

describe('renderDomain', () => {
  it('renders types, predicates and actions as PDDL', () => {
    // Act
    const pddl = renderDomain(blocksDomain);

    // Assert
    expect(pddl).toContain('(define (domain blocks-world)');
    expect(pddl).toContain('(:requirements :strips :typing)');
    expect(pddl).toContain('    block agent - object\n    robotic-arm - agent');
    expect(pddl).toContain('    (on-block ?b1 ?b2 - block)');
    expect(pddl).toContain(
      '  (:action pick-up\n' +
        '    :parameters (?a - robotic-arm ?b - block)\n' +
        '    :precondition (and (arm-empty ?a) (on-table ?b) (clear ?b))\n' +
        '    :effect (and (held-by-arm ?b ?a) (not (on-table ?b)) (not (clear ?b)) (not (arm-empty ?a)))\n' +
        '  )',
    );
  });

  it('declares negative preconditions only when an action uses them', () => {
    // Arrange
    const domain: Domain = {
      ...blocksDomain,
      actions: [
        {
          ...blocksDomain.actions[0],
          preconditions: [{ predicate: 'clear', args: ['?b'], negated: true }],
        },
      ],
    };

    // Act / Assert
    expect(requirements(blocksDomain)).toEqual([':strips', ':typing']);
    expect(requirements(domain)).toContain(':negative-preconditions');
    expect(renderDomain(domain)).toContain(':precondition (not (clear ?b))');
  });

  it('is deterministic', () => {
    expect(renderDomain(blocksDomain)).toBe(
      renderDomain(structuredClone(blocksDomain)),
    );
  });
});

describe('renderProblem', () => {
  it('renders objects grouped by type, initial facts and the goal', () => {
    // Act
    const pddl = renderProblem(blocksProblem, 'blocks-world');

    // Assert
    expect(pddl).toContain(
      '(define (problem tower-abc)\n  (:domain blocks-world)',
    );
    expect(pddl).toContain('    a b c - block\n    arm - robotic-arm');
    expect(pddl).toContain('    (arm-empty arm)');
    expect(pddl).toContain('(:goal (and (on-block a b) (on-block b c)))');
  });
});
