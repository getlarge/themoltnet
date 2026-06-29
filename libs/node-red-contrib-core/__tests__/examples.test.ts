import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

type FlowNode = {
  id: string;
  type?: string;
  name?: string;
  func?: string;
  maxAttempts?: number;
  out?: unknown;
  outputLabels?: unknown;
  wires?: unknown;
};

function loadExample(name: string): FlowNode[] {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  return JSON.parse(
    readFileSync(resolve(root, 'examples', name), 'utf8'),
  ) as FlowNode[];
}

function byId(flow: FlowNode[]): Map<string, FlowNode> {
  return new Map(flow.map((node) => [node.id, node]));
}

describe('example flows', () => {
  it('keeps the A/B eval flow as a fan-out/fan-in workflow runner', () => {
    const flow = loadExample('ab-eval-with-judge.flow.json');
    const nodes = byId(flow);

    expect(nodes.get('ab_eval_seed')?.func).toContain('msg.evalVariants');
    expect(nodes.get('ab_eval_init_group')?.func).toContain('expectedVariants');
    expect(nodes.get('ab_eval_gate_group')?.func).toContain('groupComplete');
    expect(nodes.get('sf_ab_pack_lane_failure')?.func).toContain(
      "laneStatus: 'failed'",
    );
    expect(nodes.get('sf_ab_pack_node_error')?.func).toContain(
      "laneStatus: 'failed'",
    );
    expect(nodes.get('sf_ab_tail_out')?.type).toBe('link out');
    expect(nodes.get('sf_ab_build_run_eval')?.func).toContain(
      'producerAllowedProfiles',
    );
    expect(nodes.get('sf_ab_build_run_eval')?.func).toContain(
      'scenario.runtimeProfiles?.producer',
    );
    expect(nodes.get('sf_ab_build_judge_eval')?.func).toContain(
      'judgeAllowedProfiles',
    );
    expect(nodes.get('sf_ab_build_judge_eval')?.func).toContain(
      'msg.evalScenario?.runtimeProfiles?.judge',
    );
    expect(nodes.get('sf_ab_wait_run_eval')?.wires).toEqual([
      ['sf_ab_tail_out'],
      ['sf_ab_gate_run_eval'],
    ]);
    expect(nodes.get('sf_ab_wait_judge_eval')?.wires).toEqual([
      ['0f5c72247640f952'],
      ['sf_ab_gate_judge_eval'],
    ]);
    expect(nodes.get('subflow_ab_eval_with_judge')?.out).toEqual([
      {
        wires: [
          { id: 'sf_ab_store_delta', port: 0 },
          { id: 'sf_ab_pack_lane_failure', port: 0 },
          { id: 'sf_ab_pack_node_error', port: 0 },
        ],
        x: 1320,
        y: 360,
      },
      {
        wires: [{ id: '1f190a60c144f6ec', port: 0 }],
        x: 1320,
        y: 80,
      },
    ]);
    expect(nodes.get('subflow_ab_eval_with_judge')?.outputLabels).toEqual([
      'workflow state',
      'task tail events',
    ]);
    expect(nodes.get('ab_eval_subflow')?.wires).toEqual([
      ['ab_eval_gate_group'],
      ['ab_eval_tail_debug'],
    ]);
    expect(nodes.has('ab_eval_tail_in')).toBe(false);

    expect(nodes.get('sf_ab_create_run_eval')?.maxAttempts).toBe(2);
    expect(nodes.get('sf_ab_create_judge_eval')?.maxAttempts).toBe(2);
  });
});
