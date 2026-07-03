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
  it('configures the Node-RED dev runner with filesystem flow context', () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const devRunner = readFileSync(resolve(root, 'scripts/dev.mjs'), 'utf8');

    expect(devRunner).toContain('contextStorage');
    expect(devRunner).toContain('localfilesystem');
    expect(devRunner).toContain('syncExampleToDevFlow');
    expect(devRunner).toContain('MOLTNET_NODE_RED_REFRESH_EXAMPLE');
    expect(devRunner).toContain('Preserving the live Node-RED canvas');
  });

  it('does not prescribe arbitrary deep-review runtime tuning values', () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
    const deepReviewSection = readme.slice(
      readme.indexOf('## Freeform deep review workflow'),
      readme.indexOf('## Development with Node-RED 5'),
    );

    expect(deepReviewSection).toContain(
      'intentionally avoids prescribing `maxTurns`',
    );
    expect(deepReviewSection).not.toContain('maxOutputTokens=');
    expect(deepReviewSection).not.toContain('temperature=');
    expect(deepReviewSection).not.toContain('thinkingLevel=');
    expect(deepReviewSection).not.toContain('maxBashTimeouts=');
  });

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
    expect(nodes.get('deep_review_profile_freeze')?.profileName).toBe(
      'deep-review-freeze-v1',
    );
    expect(nodes.get('deep_review_profile_preflight')?.profileName).toBe(
      'deep-review-preflight-v1',
    );
    expect(nodes.get('deep_review_profile_specialist')?.profileName).toBe(
      'deep-review-specialist-v1',
    );
    expect(nodes.get('deep_review_profile_aggregate')?.profileName).toBe(
      'deep-review-aggregate-v1',
    );
    expect(nodes.get('deep_review_lane_outputs')?.info).toContain(
      'collected through links',
    );
    expect(JSON.stringify(flow)).not.toContain('ASK');
    expect(nodes.has('deep_review_debug_ask')).toBe(false);
    expect(nodes.get('deep_review_switch_preflight')?.outputs).toBe(3);
    expect(nodes.get('deep_review_switch_preflight')?.wires).toEqual([
      ['0e5bc273a0b26717'],
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
        'deep_review_stash_preflight_snapshot',
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
        'deep_review_get_freeze_session',
      ],
    ]);
    expect(nodes.get('deep_review_lane_bundle_artifacts')?.name).toBe(
      'Review bundle and runtime sessions',
    );
    expect(nodes.get('deep_review_lane_bundle_artifacts')?.info).toContain(
      'runtime-session metadata',
    );
    expect(nodes.get('deep_review_get_freeze_session')?.type).toBe(
      'moltnet-runtime-session-get',
    );
    expect(nodes.get('deep_review_get_freeze_session')?.wires).toEqual([
      ['deep_review_debug_runtime_session'],
    ]);
    expect(nodes.get('deep_review_stash_preflight_snapshot')?.wires).toEqual([
      ['deep_review_read_preflight'],
    ]);
    expect(nodes.get('deep_review_stash_preflight')?.func).toContain(
      'preflightAttemptN',
    );
    expect(nodes.get('deep_review_stash_preflight')?.wires).toEqual([
      ['deep_review_switch_preflight', 'deep_review_get_preflight_session'],
    ]);
    expect(nodes.get('deep_review_get_preflight_session')?.type).toBe(
      'moltnet-runtime-session-get',
    );
    expect(nodes.get('deep_review_get_preflight_session')?.wires).toEqual([
      ['deep_review_debug_runtime_session'],
    ]);
    expect(nodes.get('deep_review_debug_runtime_session')?.type).toBe('debug');
    expect(nodes.get('deep_review_bundle_ready_link_out')?.links).toEqual([
      'deep_review_bundle_ready_link_in',
    ]);
    expect(nodes.get('deep_review_bundle_ready_link_in')?.links).toEqual(
      expect.arrayContaining([
        'deep_review_bundle_ready_link_out',
        '18a480760520ba5a',
      ]),
    );
    expect(nodes.get('deep_review_bundle_ready_link_in')?.wires).toEqual([
      ['deep_review_build_preflight'],
    ]);
    expect(nodes.get('16faf32e4fc42dce')?.wires).toEqual([
      ['deep_review_build_pivot_publish'],
    ]);
    expect(nodes.get('16faf32e4fc42dce')?.links).toEqual(
      expect.arrayContaining(['0e5bc273a0b26717', 'edcc698660d82265']),
    );
    expect(nodes.get('deep_review_dimensions_payload')?.wires).toEqual([
      ['85888005a9fb88bc'],
      ['791ab27471c4788e'],
    ]);
    expect(nodes.get('0bb7739dbe669278')?.wires).toEqual([
      ['deep_review_build_specialist'],
    ]);
    expect(nodes.get('b3bb0fc6441c8e1c')?.wires).toEqual([
      ['deep_review_build_aggregate'],
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
    expect(nodes.get('deep_review_next_dimension')?.wires).toEqual([
      ['121f5380eb3e3a9f'],
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
    expect(nodes.get('deep_review_lane_retry')?.info).toContain(
      'Filesystem-backed flow context',
    );
    expect(nodes.get('deep_review_retry_failed')?.wires).toEqual([
      ['deep_review_load_retry_state'],
    ]);
    expect(nodes.get('deep_review_load_retry_state')?.outputs).toBe(4);
    expect(nodes.get('deep_review_load_retry_state')?.outputLabels).toEqual([
      'AGGREGATE',
      'SPECIALIST',
      'PREFLIGHT',
      'PIVOT',
    ]);
    expect(nodes.get('deep_review_load_retry_state')?.func).toContain(
      "flow.get('deepReview:lastCorrelationId')",
    );
    expect(nodes.get('deep_review_lane_retry')?.info).toContain(
      'Retry creates a fresh task',
    );
    expect(nodes.get('deep_review_load_retry_state')?.wires).toEqual([
      ['f25f51b3e15378ba'],
      ['fac3b7976571600e'],
      ['18a480760520ba5a'],
      ['edcc698660d82265'],
    ]);
    for (const createId of [
      'deep_review_create_freeze',
      'deep_review_create_preflight',
      'deep_review_create_pivot_publish',
      'deep_review_create_specialist',
      'deep_review_create_aggregate',
    ]) {
      expect(nodes.get(createId)?.maxAttempts).toBe(2);
    }
    expect(nodes.get('deep_review_pack_terminal_failure')?.func).toContain(
      'deepReview:lastCorrelationId',
    );

    const positionedNodes = flow.filter(
      (node) => node.id === 'deep_review_tab' || node.type !== undefined,
    );
    const positions = new Map<string, string[]>();
    for (const node of positionedNodes) {
      if (node.x === undefined || node.y === undefined) continue;
      const key = `${node.x},${node.y}`;
      positions.set(key, [...(positions.get(key) ?? []), node.id]);
    }
    const overlappingPositions = [...positions.values()].filter(
      (ids) => ids.length > 1,
    );
    expect(overlappingPositions).toEqual([]);
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
