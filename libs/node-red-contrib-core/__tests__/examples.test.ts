import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

type FlowNode = {
  id: string;
  type?: string;
  name?: string;
  func?: string;
  info?: string;
  links?: unknown;
  maxAttempts?: number;
  out?: unknown;
  outputs?: number;
  outputLabels?: unknown;
  pollIntervalSec?: number;
  property?: string;
  scope?: unknown;
  wires?: unknown;
  x?: number;
  y?: number;
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
  it('keeps the deep-review flow on builder/gate/error-handling patterns', () => {
    const flow = loadExample('deep-review-freeform.flow.json');
    const nodes = byId(flow);

    expect(nodes.get('deep_review_note')?.info).toContain(
      'moltnet-task-builder',
    );
    expect(nodes.get('deep_review_note')?.info).toContain(
      'Non-accepted task attempts',
    );
    expect(nodes.get('deep_review_lane_freeze')?.name).toBe(
      '2. FREEZE scope bundle',
    );
    expect(nodes.get('deep_review_lane_freeze')?.info).toContain(
      'task artifact CIDs',
    );
    expect(nodes.get('deep_review_build_freeze')?.func).toContain(
      'never return a local filesystem path',
    );
    expect(nodes.get('deep_review_build_freeze')?.func).toContain(
      'set patchArtifactCid and diffArtifactCid to null',
    );
    expect(nodes.get('deep_review_lane_specialists')?.name).toBe(
      '4. Specialist fan-out',
    );
    expect(nodes.get('deep_review_lane_outputs')?.info).toContain(
      'collected through links',
    );
    expect(JSON.stringify(flow)).not.toContain('ASK');
    expect(nodes.has('deep_review_debug_ask')).toBe(false);
    expect(nodes.get('deep_review_switch_preflight')?.outputs).toBe(3);
    expect(nodes.get('deep_review_switch_preflight')?.wires).toEqual([
      ['deep_review_build_pivot_publish'],
      ['deep_review_dimensions_payload'],
      ['deep_review_dimensions_payload'],
    ]);

    const stages = [
      [
        'freeze',
        'deep_review_stash_freeze_snapshot',
        'deep_review_freeze_failure_link_out',
      ],
      [
        'preflight',
        'deep_review_read_preflight',
        'deep_review_preflight_failure_link_out',
      ],
      [
        'pivot_publish',
        'deep_review_pivot_done_link_out',
        'deep_review_pivot_failure_link_out',
      ],
      [
        'specialist',
        'deep_review_read_specialist',
        'deep_review_pack_specialist_error',
      ],
      [
        'aggregate',
        'deep_review_aggregate_done_link_out',
        'deep_review_aggregate_failure_link_out',
      ],
    ] as const;

    for (const [stage, acceptedTarget, failureTarget] of stages) {
      const buildId = `deep_review_build_${stage}`;
      const builderId = `deep_review_builder_${stage}`;
      const createId =
        stage === 'pivot_publish'
          ? 'deep_review_create_pivot_publish'
          : `deep_review_create_${stage}`;
      const waitId =
        stage === 'pivot_publish'
          ? 'deep_review_wait_pivot_publish'
          : `deep_review_wait_${stage}`;
      const gateId = `deep_review_gate_${stage}`;
      expect(nodes.get(buildId)?.wires).toEqual([[builderId]]);
      expect(nodes.get(builderId)?.type).toBe('moltnet-task-builder');
      expect(nodes.get(builderId)?.wires).toEqual([[createId]]);
      expect(nodes.get(waitId)?.wires).toEqual([expect.any(Array), [gateId]]);
      expect(nodes.get(gateId)?.type).toBe('switch');
      expect(nodes.get(gateId)?.property).toBe('payload.accepted');
      expect(nodes.get(gateId)?.wires).toEqual([
        [acceptedTarget],
        [failureTarget],
      ]);
    }

    for (const node of flow.filter(
      (item) => item.type === 'moltnet-task-wait',
    )) {
      expect(node).not.toHaveProperty('intervalMs');
      expect(node.pollIntervalSec).toBeGreaterThan(0);
    }

    expect(nodes.get('deep_review_stash_bundle')?.wires).toEqual([
      [
        'deep_review_bundle_ready_link_out',
        'deep_review_list_freeze_artifacts',
      ],
    ]);
    expect(nodes.get('deep_review_bundle_ready_link_out')?.links).toEqual([
      'deep_review_bundle_ready_link_in',
    ]);
    expect(nodes.get('deep_review_bundle_ready_link_in')?.wires).toEqual([
      ['deep_review_build_preflight'],
    ]);
    expect(nodes.get('deep_review_pack_specialist')?.wires).toEqual([
      ['deep_review_specialist_result_link_out'],
    ]);
    expect(nodes.get('deep_review_pack_specialist_error')?.wires).toEqual([
      ['deep_review_specialist_result_link_out'],
    ]);
    expect(nodes.get('deep_review_specialist_result_link_in')?.wires).toEqual([
      ['deep_review_next_dimension'],
    ]);
    expect(nodes.get('deep_review_terminal_failure_link_in')?.links).toEqual(
      expect.arrayContaining([
        'deep_review_freeze_failure_link_out',
        'deep_review_preflight_failure_link_out',
        'deep_review_pivot_failure_link_out',
        'deep_review_aggregate_failure_link_out',
      ]),
    );
    expect(nodes.get('deep_review_terminal_failure_link_in')?.wires).toEqual([
      ['deep_review_pack_terminal_failure'],
    ]);
    expect(nodes.get('deep_review_specialist_error_catch')?.scope).toEqual(
      expect.arrayContaining(['deep_review_builder_specialist']),
    );
    expect(nodes.get('deep_review_task_error_catch')?.scope).toEqual(
      expect.arrayContaining([
        'deep_review_builder_freeze',
        'deep_review_builder_preflight',
        'deep_review_builder_pivot_publish',
        'deep_review_builder_aggregate',
      ]),
    );
    expect(nodes.get('deep_review_task_error_catch')?.scope).not.toContain(
      'deep_review_builder_specialist',
    );
    expect(nodes.get('deep_review_task_status')?.scope).toEqual(
      expect.arrayContaining([
        'deep_review_builder_freeze',
        'deep_review_builder_specialist',
        'deep_review_builder_aggregate',
      ]),
    );
    expect(nodes.get('deep_review_pack_terminal_failure')?.func).toContain(
      "workflowStatus: 'failed'",
    );
    expect(nodes.get('deep_review_pack_terminal_failure')?.wires).toEqual([
      ['deep_review_failure_done_link_out'],
    ]);
    expect(nodes.get('deep_review_done_link_in')?.links).toEqual(
      expect.arrayContaining(['deep_review_failure_done_link_out']),
    );
  });

  it('keeps the A/B eval flow as a fan-out/fan-in workflow runner', () => {
    const flow = loadExample('ab-eval-with-judge.flow.json');
    const nodes = byId(flow);

    expect(nodes.get('ab_eval_seed')?.func).toContain('msg.evalVariants');
    expect(nodes.get('ab_eval_seed')?.func).toContain(
      'moltnet-practices/dbos-after-commit',
    );
    expect(nodes.get('ab_eval_seed')?.func).toContain(
      'rendered-pack-dbos-rule',
    );
    expect(nodes.get('ab_eval_seed')?.func).not.toContain('requiredFindings');
    expect(nodes.get('ab_eval_seed')?.func).not.toContain('forbidden');
    expect(nodes.get('sf_ab_score_run_eval')?.func).toContain(
      'responseChars: response.length',
    );
    expect(nodes.get('sf_ab_score_run_eval')?.func).toContain(
      'evalProducerMetrics',
    );
    expect(nodes.get('sf_ab_score_run_eval')?.func).not.toContain(
      'requiredFindings',
    );
    expect(nodes.get('ab_eval_init_group')?.func).toContain('expectedVariants');
    expect(nodes.get('ab_eval_init_group')?.func).toContain(
      'return [messages]',
    );
    expect(nodes.get('ab_eval_init_group')?.func).toContain(
      'evalExpectedVariants',
    );
    expect(nodes.get('ab_eval_init_group')?.func).toContain('evalGroup');
    expect(nodes.get('ab_eval_gate_group')?.func).toContain('groupComplete');
    expect(nodes.get('sf_ab_store_delta')?.func).toContain(
      'expectedFromMessage',
    );
    expect(nodes.get('sf_ab_store_delta')?.func).toContain('judgeMetrics');
    expect(nodes.get('sf_ab_store_delta')?.func).toContain('metricsDelta');
    expect(nodes.get('sf_ab_store_delta')?.func).not.toContain(
      'Object.keys(scenario).length || 0',
    );
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
    expect(nodes.get('sf_ab_build_judge_eval')?.func).toContain('judgeRubric');
    expect(nodes.get('sf_ab_build_judge_eval')?.func).toContain(
      'msg.evalScenario?.runtimeProfiles?.judge',
    );
    expect(nodes.get('sf_ab_build_run_eval')?.wires).toEqual([
      ['sf_ab_task_builder_run_eval'],
    ]);
    expect(nodes.get('sf_ab_task_builder_run_eval')?.type).toBe(
      'moltnet-task-builder',
    );
    expect(nodes.get('sf_ab_task_builder_run_eval')?.wires).toEqual([
      ['sf_ab_create_run_eval'],
    ]);
    expect(nodes.get('sf_ab_build_judge_eval')?.wires).toEqual([
      ['sf_ab_task_builder_judge_eval'],
    ]);
    expect(nodes.get('sf_ab_task_builder_judge_eval')?.type).toBe(
      'moltnet-task-builder',
    );
    expect(nodes.get('sf_ab_task_builder_judge_eval')?.wires).toEqual([
      ['sf_ab_create_judge_eval'],
    ]);
    expect(nodes.get('sf_ab_count_run_eval_tail')?.func).toContain(
      'lane.producer',
    );
    expect(nodes.get('sf_ab_count_judge_eval_tail')?.func).toContain(
      'lane.judge',
    );
    expect(nodes.get('a72acb578ef0ea20')?.scope).toEqual(
      expect.arrayContaining([
        'sf_ab_task_builder_run_eval',
        'sf_ab_task_builder_judge_eval',
      ]),
    );
    expect(nodes.get('sf_ab_error_catch')?.scope).toEqual(
      expect.arrayContaining([
        'sf_ab_task_builder_run_eval',
        'sf_ab_task_builder_judge_eval',
      ]),
    );
    expect(nodes.get('sf_ab_wait_run_eval')?.wires).toEqual([
      ['sf_ab_count_run_eval_tail'],
      ['sf_ab_gate_run_eval'],
    ]);
    expect(nodes.get('sf_ab_count_run_eval_tail')?.wires).toEqual([
      ['sf_ab_tail_out'],
    ]);
    expect(nodes.get('sf_ab_wait_judge_eval')?.wires).toEqual([
      ['sf_ab_count_judge_eval_tail'],
      ['sf_ab_gate_judge_eval'],
    ]);
    expect(nodes.get('sf_ab_count_judge_eval_tail')?.wires).toEqual([
      ['0f5c72247640f952'],
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
