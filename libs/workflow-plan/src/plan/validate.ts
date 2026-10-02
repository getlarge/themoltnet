/**
 * Structural validation of a {@link WorkflowPlan}.
 *
 * Schema validity is necessary but not sufficient. This validator checks the
 * properties an executor relies on: unique ids, resolvable references,
 * acyclicity, explicit dependencies for every binding, declared gates with
 * reachable successors, and a termination policy that names real nodes.
 */
import { Value } from 'typebox/value';

import {
  type GateEdge,
  type HumanGateNode,
  type PlanNode,
  WorkflowPlan,
} from './schema.js';

export interface PlanIssue {
  code:
    | 'schema'
    | 'duplicate_id'
    | 'unknown_reference'
    | 'cycle'
    | 'implicit_dependency'
    | 'self_dependency'
    | 'gate_option_unreachable'
    | 'gate_edge_invalid'
    | 'gate_reviews_not_dependency'
    | 'revision_target_invalid'
    | 'termination_invalid'
    | 'join_arity'
    | 'unreachable_node';
  node?: string;
  message: string;
}

export interface PlanValidation {
  ok: boolean;
  issues: PlanIssue[];
  /** Topological order (empty when the graph has a cycle). */
  order: string[];
}

function nodeMap(nodes: PlanNode[]): Map<string, PlanNode> {
  const map = new Map<string, PlanNode>();
  for (const node of nodes) map.set(node.id, node);
  return map;
}

/** Kahn topological sort; returns [] when a cycle exists. */
export function topologicalOrder(nodes: PlanNode[]): string[] {
  const indegree = new Map<string, number>();
  const successors = new Map<string, string[]>();
  for (const node of nodes) {
    indegree.set(node.id, 0);
    successors.set(node.id, []);
  }
  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      if (!indegree.has(dep)) continue;
      indegree.set(node.id, (indegree.get(node.id) ?? 0) + 1);
      successors.get(dep)?.push(node.id);
    }
  }
  const ready = [...indegree.entries()]
    .filter(([, n]) => n === 0)
    .map(([id]) => id)
    .sort();
  const order: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift() as string;
    order.push(id);
    for (const next of successors.get(id) ?? []) {
      const n = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, n);
      if (n === 0) ready.push(next);
    }
    ready.sort();
  }
  return order.length === nodes.length ? order : [];
}

function bindingSources(node: PlanNode): string[] {
  if (node.kind !== 'task') return [];
  const sources: string[] = [];
  for (const binding of Object.values(node.inputs)) {
    if (binding.kind === 'output' || binding.kind === 'decision') {
      sources.push(binding.node);
    }
  }
  return sources;
}

function ancestors(id: string, map: Map<string, PlanNode>): Set<string> {
  const seen = new Set<string>();
  const stack = [...(map.get(id)?.dependsOn ?? [])];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(map.get(current)?.dependsOn ?? []));
  }
  return seen;
}

export function validateWorkflowPlan(input: unknown): PlanValidation {
  const issues: PlanIssue[] = [];
  if (!Value.Check(WorkflowPlan, input)) {
    for (const error of Value.Errors(WorkflowPlan, input)) {
      issues.push({
        code: 'schema',
        message: `${error.instancePath || '/'}: ${error.message}`,
      });
      if (issues.length >= 25) break;
    }
    return { ok: false, issues, order: [] };
  }
  const plan = input;
  const map = nodeMap(plan.nodes);

  const seen = new Set<string>();
  for (const node of plan.nodes) {
    if (seen.has(node.id)) {
      issues.push({
        code: 'duplicate_id',
        node: node.id,
        message: `node id '${node.id}' is declared more than once`,
      });
    }
    seen.add(node.id);
  }

  for (const node of plan.nodes) {
    for (const dep of node.dependsOn) {
      if (dep === node.id) {
        issues.push({
          code: 'self_dependency',
          node: node.id,
          message: `node '${node.id}' depends on itself`,
        });
      } else if (!map.has(dep)) {
        issues.push({
          code: 'unknown_reference',
          node: node.id,
          message: `node '${node.id}' depends on unknown node '${dep}'`,
        });
      }
    }
    for (const source of bindingSources(node)) {
      if (!map.has(source)) {
        issues.push({
          code: 'unknown_reference',
          node: node.id,
          message: `node '${node.id}' binds input from unknown node '${source}'`,
        });
      } else if (!node.dependsOn.includes(source)) {
        issues.push({
          code: 'implicit_dependency',
          node: node.id,
          message: `node '${node.id}' binds input from '${source}' without declaring it in dependsOn`,
        });
      }
    }
    if (node.kind === 'task') {
      for (const [name, binding] of Object.entries(node.inputs)) {
        if (binding.kind === 'decision') {
          const gate = map.get(binding.node);
          if (gate && gate.kind !== 'human_gate') {
            issues.push({
              code: 'unknown_reference',
              node: node.id,
              message: `input '${name}' of '${node.id}' binds a decision from '${binding.node}', which is not a human gate`,
            });
          }
        }
      }
    }
    if (node.kind === 'join' && node.dependsOn.length < 2) {
      issues.push({
        code: 'join_arity',
        node: node.id,
        message: `join '${node.id}' needs at least two predecessors`,
      });
    }
    if (node.kind === 'human_gate')
      validateGate(node, map, plan.gateEdges, issues);
  }

  const order = topologicalOrder(plan.nodes);
  if (order.length === 0 && plan.nodes.length > 0) {
    issues.push({
      code: 'cycle',
      message: 'dependency graph contains a cycle',
    });
  }

  for (const edge of plan.gateEdges) {
    const from = map.get(edge.from);
    if (!from || from.kind !== 'human_gate') {
      issues.push({
        code: 'gate_edge_invalid',
        node: edge.from,
        message: `gate edge from '${edge.from}' does not start at a human gate`,
      });
      continue;
    }
    if (!from.options.includes(edge.when)) {
      issues.push({
        code: 'gate_edge_invalid',
        node: edge.from,
        message: `gate '${edge.from}' has no option '${edge.when}' for edge to '${edge.to}'`,
      });
    }
    const to = map.get(edge.to);
    if (!to) {
      issues.push({
        code: 'unknown_reference',
        node: edge.from,
        message: `gate edge from '${edge.from}' targets unknown node '${edge.to}'`,
      });
    } else if (!to.dependsOn.includes(edge.from)) {
      issues.push({
        code: 'implicit_dependency',
        node: edge.to,
        message: `node '${edge.to}' is enabled by gate '${edge.from}' but does not depend on it`,
      });
    }
  }

  for (const id of plan.termination.successNodes) {
    if (!map.has(id)) {
      issues.push({
        code: 'termination_invalid',
        message: `termination.successNodes names unknown node '${id}'`,
      });
    }
  }
  if (
    plan.termination.maxTotalTasks <
    plan.nodes.filter((n) => n.kind === 'task').length
  ) {
    issues.push({
      code: 'termination_invalid',
      message:
        'termination.maxTotalTasks is smaller than the number of task nodes',
    });
  }

  // Every node must be reachable from a root (no orphan subgraph that can
  // never become eligible) — with explicit dependsOn this reduces to the
  // cycle check, but gate-only successors need an enabling edge.
  for (const node of plan.nodes) {
    const gateDeps = node.dependsOn.filter(
      (d) => map.get(d)?.kind === 'human_gate',
    );
    for (const gateId of gateDeps) {
      if (!plan.gateEdges.some((e) => e.from === gateId && e.to === node.id)) {
        issues.push({
          code: 'unreachable_node',
          node: node.id,
          message: `node '${node.id}' depends on gate '${gateId}' but no gate edge enables it`,
        });
      }
    }
  }

  return { ok: issues.length === 0, issues, order };
}

function validateGate(
  gate: HumanGateNode,
  map: Map<string, PlanNode>,
  edges: GateEdge[],
  issues: PlanIssue[],
): void {
  if (!map.has(gate.reviews.node)) {
    issues.push({
      code: 'unknown_reference',
      node: gate.id,
      message: `gate '${gate.id}' reviews unknown node '${gate.reviews.node}'`,
    });
  } else if (!gate.dependsOn.includes(gate.reviews.node)) {
    issues.push({
      code: 'gate_reviews_not_dependency',
      node: gate.id,
      message: `gate '${gate.id}' reviews '${gate.reviews.node}' but does not depend on it`,
    });
  }
  const outgoing = edges.filter((e) => e.from === gate.id);
  for (const option of gate.options) {
    if (option === 'reject') continue; // reject terminates by definition
    if (option === 'request_revision') {
      const target = gate.revisionTarget ?? gate.reviews.node;
      const allowed = new Set([
        gate.reviews.node,
        ...ancestors(gate.reviews.node, map),
      ]);
      if (!allowed.has(target)) {
        issues.push({
          code: 'revision_target_invalid',
          node: gate.id,
          message: `gate '${gate.id}' revision target '${target}' is not the reviewed node or one of its ancestors`,
        });
      }
      continue;
    }
    if (!outgoing.some((e) => e.when === option)) {
      issues.push({
        code: 'gate_option_unreachable',
        node: gate.id,
        message: `gate '${gate.id}' option '${option}' enables no downstream node`,
      });
    }
  }
}
