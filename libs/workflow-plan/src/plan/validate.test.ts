import { describe, expect, it } from 'vitest';

import { referencePlan } from '../testing/reference-plan.js';
import type { WorkflowPlan } from './schema.js';
import { topologicalOrder, validateWorkflowPlan } from './validate.js';

function mutate(fn: (plan: WorkflowPlan) => void): WorkflowPlan {
  const plan = referencePlan();
  fn(plan);
  return plan;
}

describe('validateWorkflowPlan', () => {
  it('accepts the hand-authored reference plan and orders it topologically', () => {
    // Arrange
    const plan = referencePlan();
    // Act
    const result = validateWorkflowPlan(plan);
    // Assert
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.order.indexOf('synthesize')).toBeGreaterThan(
      result.order.indexOf('process-a'),
    );
    expect(result.order.indexOf('synthesize')).toBeGreaterThan(
      result.order.indexOf('process-b'),
    );
    expect(result.order.indexOf('final-summary')).toBeGreaterThan(
      result.order.indexOf('owner-decision'),
    );
  });

  it('rejects schema violations before structural checks', () => {
    const result = validateWorkflowPlan({ schemaVersion: 2, nodes: [] });
    expect(result.ok).toBe(false);
    expect(result.issues.every((i) => i.code === 'schema')).toBe(true);
  });

  it('reports duplicate ids', () => {
    const plan = mutate((p) => {
      p.nodes.push({ ...p.nodes[0] });
    });
    const codes = validateWorkflowPlan(plan).issues.map((i) => i.code);
    expect(codes).toContain('duplicate_id');
  });

  it('reports unknown references in dependsOn and bindings', () => {
    const plan = mutate((p) => {
      const synth = p.nodes.find((n) => n.id === 'synthesize');
      if (synth?.kind === 'task') {
        synth.dependsOn.push('ghost');
        synth.inputs['extra'] = { kind: 'output', node: 'phantom' };
      }
    });
    const issues = validateWorkflowPlan(plan).issues;
    expect(
      issues
        .filter((i) => i.code === 'unknown_reference')
        .map((i) => i.message),
    ).toEqual([
      expect.stringContaining("'ghost'"),
      expect.stringContaining("'phantom'"),
    ]);
  });

  it('reports an input binding whose source is not a declared dependency', () => {
    const plan = mutate((p) => {
      const synth = p.nodes.find((n) => n.id === 'synthesize');
      if (synth?.kind === 'task') synth.dependsOn = ['process-a'];
    });
    const issues = validateWorkflowPlan(plan).issues;
    expect(issues.map((i) => i.code)).toContain('implicit_dependency');
  });

  it('reports cycles and returns no order', () => {
    const plan = mutate((p) => {
      const a = p.nodes.find((n) => n.id === 'process-a');
      if (a) a.dependsOn = ['final-summary'];
    });
    const result = validateWorkflowPlan(plan);
    expect(result.issues.map((i) => i.code)).toContain('cycle');
    expect(result.order).toEqual([]);
    expect(topologicalOrder(plan.nodes)).toEqual([]);
  });

  it('requires every non-terminal gate option to enable a successor', () => {
    const plan = mutate((p) => {
      p.gateEdges = [];
    });
    const codes = validateWorkflowPlan(plan).issues.map((i) => i.code);
    expect(codes).toContain('gate_option_unreachable');
    expect(codes).toContain('unreachable_node');
  });

  it('rejects a revision target that is not the reviewed node or an ancestor', () => {
    const plan = mutate((p) => {
      const gate = p.nodes.find((n) => n.id === 'owner-decision');
      if (gate?.kind === 'human_gate') gate.revisionTarget = 'final-summary';
    });
    expect(validateWorkflowPlan(plan).issues.map((i) => i.code)).toContain(
      'revision_target_invalid',
    );
  });

  it('rejects termination policies naming unknown nodes or too small task budgets', () => {
    const plan = mutate((p) => {
      p.termination.successNodes = ['nope'];
      p.termination.maxTotalTasks = 1;
    });
    const issues = validateWorkflowPlan(plan).issues.filter(
      (i) => i.code === 'termination_invalid',
    );
    expect(issues).toHaveLength(2);
  });
});
