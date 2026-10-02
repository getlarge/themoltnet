/**
 * Regression tests pinned to windags-skills @ 9e2fed3bb42ad027284c5a3342e5487be45bf05e.
 *
 * Upstream is BUSL-1.1, so none of its code is vendored. The fixtures were
 * produced by running the pinned checkout with `fixtures/harness/*.mjs`; the
 * assertions below describe UPSTREAM behaviour (what we observed), and the
 * converter tests describe OUR behaviour on top of it. Re-run the harness
 * against a newer upstream revision to refresh the fixtures.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { validateWorkflowPlan } from '../plan/validate.js';
import { referencePlan } from '../testing/reference-plan.js';
import {
  convertWinDagsPrediction,
  type WinDagsDecomposerOutput,
  type WinDagsPredictedDag,
  type WinDagsPredictedNode,
} from './convert.js';

const FIXTURES = resolve(import.meta.dirname, '../../fixtures/upstream');
const read = <T>(name: string): T =>
  JSON.parse(readFileSync(resolve(FIXTURES, name), 'utf8')) as T;

interface HypothesesFixture {
  upstream_revision: string;
  findings: {
    h1_dependencies_discarded: {
      synthesizer_node_had_dependencies: string[];
      after_postProcess_dependencies: string[] | null;
      after_validator_dependencies: string[];
      confirmed: boolean;
    };
    h2_contracts_stripped: {
      after_postProcess_keys: string[];
      after_validator_keys: string[];
      after_validator_wave_keys: string[];
    };
    h3_schema_validator_disagree: {
      json_schema_accepts_documented_shape: boolean;
      zod_accepts_documented_shape: boolean;
      zod_errors_on_documented_shape: string[];
      json_schema_accepts_postprocessed_shape: boolean;
      json_schema_errors_on_postprocessed_shape: string[];
      zod_accepts_postprocessed_shape: boolean;
    };
    h4_defaults_conceal: {
      empty_object_accepted: boolean;
      empty_object_output: { title: string };
      skeletal_node_after_postprocess: Record<string, unknown>;
      general_purpose_skill_exists_in_catalog: boolean;
      bare_id_node_rejected_because_role_description_empty: boolean;
    };
    h5_no_structural_checks: {
      duplicate_ids_self_cycle_and_dangling_ref_accepted: boolean;
      json_schema_accepts_duplicate_ids: boolean;
    };
  };
}

interface LiveRunFixture {
  upstream_revision: string;
  provider: string;
  elapsed_ms: number;
  usage_log: Array<{ stage: string }>;
  decomposer: WinDagsDecomposerOutput;
  skill_selection: { selections: Array<{ primary_skill: string }> };
  narrowed_candidates: Array<{ candidates: unknown[] }>;
  predicted_dag: WinDagsPredictedDag & {
    waves: Array<{
      nodes: Array<WinDagsPredictedNode & { dependencies: string[] }>;
    }>;
  };
}

const hypotheses = read<HypothesesFixture>('hypotheses-9e2fed3b.json');
const liveRun = read<LiveRunFixture>('live-run-2.json');
const invalidRun = read<LiveRunFixture>('live-run-1.json');

describe('upstream windags-skills @ 9e2fed3b — recorded behaviour', () => {
  it('pins the revision the fixtures were recorded against', () => {
    expect(hypotheses.upstream_revision).toBe(
      '9e2fed3bb42ad027284c5a3342e5487be45bf05e',
    );
    expect(liveRun.upstream_revision).toBe(hypotheses.upstream_revision);
  });

  it('H1: node reconstruction discards dependencies (static trace)', () => {
    const f = hypotheses.findings.h1_dependencies_discarded;
    expect(f.synthesizer_node_had_dependencies).toEqual([
      'process-a',
      'process-b',
    ]);
    expect(f.after_postProcess_dependencies).toBeNull();
    expect(f.after_validator_dependencies).toEqual([]);
    expect(f.confirmed).toBe(true);
  });

  it('H1: live run — decomposer had dependencies, returned PredictedDAG has none', () => {
    const decomposerDeps = Object.fromEntries(
      liveRun.decomposer.subtasks.map((s) => [s.id, s.depends_on]),
    );
    expect(decomposerDeps['synthesize-findings']).toEqual([
      'process-set-a',
      'process-set-b',
    ]);
    const nodes = liveRun.predicted_dag.waves.flatMap((w) => w.nodes);
    expect(nodes.length).toBeGreaterThan(1);
    for (const node of nodes) {
      expect(node.dependencies).toEqual([]);
    }
  });

  it('H2: validation strips input/output contracts, why, commitment and wave metadata', () => {
    const f = hypotheses.findings.h2_contracts_stripped;
    expect(f.after_postProcess_keys).toContain('input_contract');
    expect(f.after_validator_keys).not.toContain('input_contract');
    expect(f.after_validator_keys).not.toContain('output_contract');
    expect(f.after_validator_keys).not.toContain('why');
    expect(f.after_validator_keys).not.toContain('commitment_level');
    expect(f.after_validator_wave_keys).toEqual(['nodes']);
    const liveNodeKeys = Object.keys(
      liveRun.predicted_dag.waves[0].nodes[0],
    ).sort();
    expect(liveNodeKeys).toEqual([
      'confidence',
      'dependencies',
      'estimated_cost_usd',
      'estimated_minutes',
      'id',
      'model_tier',
      'role_description',
      'skill_id',
    ]);
  });

  it('H3: documented JSON schema and runtime Zod validator disagree on the same document', () => {
    const f = hypotheses.findings.h3_schema_validator_disagree;
    expect(f.json_schema_accepts_documented_shape).toBe(true);
    expect(f.zod_accepts_documented_shape).toBe(false);
    expect(f.zod_errors_on_documented_shape[0]).toMatch(
      /model_tier.*fast.*balanced.*powerful.*sonnet/,
    );
    expect(f.json_schema_accepts_postprocessed_shape).toBe(false);
    expect(f.json_schema_errors_on_postprocessed_shape).toContain(
      '/premortem/recommendation must be equal to one of the allowed values',
    );
    expect(f.zod_accepts_postprocessed_shape).toBe(true);
  });

  it('H4: defaults conceal missing information (empty object validates; phantom skill is injected)', () => {
    const f = hypotheses.findings.h4_defaults_conceal;
    expect(f.empty_object_accepted).toBe(true);
    expect(f.empty_object_output.title).toBe('Untitled prediction');
    expect(f.skeletal_node_after_postprocess).toMatchObject({
      skill_id: 'general-purpose',
      estimated_minutes: 5,
      estimated_cost_usd: 0.02,
      confidence: 0.7,
    });
    expect(f.general_purpose_skill_exists_in_catalog).toBe(false);
    // The one thing the validator does catch: an empty role description.
    expect(f.bare_id_node_rejected_because_role_description_empty).toBe(true);
  });

  it('H5: neither validator checks unique ids, dangling references, or cycles', () => {
    const f = hypotheses.findings.h5_no_structural_checks;
    expect(f.duplicate_ids_self_cycle_and_dangling_ref_accepted).toBe(true);
    expect(f.json_schema_accepts_duplicate_ids).toBe(true);
  });

  it('H6: with zero skill candidates the pipeline still reports success with invented skill ids', () => {
    expect(
      invalidRun.narrowed_candidates.every((c) => c.candidates.length === 0),
    ).toBe(true);
    const skills = invalidRun.skill_selection.selections.map(
      (s) => s.primary_skill,
    );
    expect(skills).toContain('json-evidence-processor');
    expect(invalidRun.predicted_dag.waves.length).toBeGreaterThan(0);
  });

  it('records provider, model, latency and usage for the live run', () => {
    expect(liveRun.provider).toBe('claude-cli');
    expect(liveRun.usage_log).toHaveLength(5);
    expect(liveRun.usage_log.map((u) => u.stage)).toEqual([
      'sensemaker',
      'decomposer',
      'skill_selector',
      'premortem',
      'synthesizer',
    ]);
    expect(liveRun.elapsed_ms).toBeGreaterThan(0);
  });
});

describe('convertWinDagsPrediction (our behaviour on top of upstream output)', () => {
  const scope = {
    teamId: 'team-synthetic',
    diaryId: 'diary-synthetic',
    correlationId: 'corr-synthetic',
  };

  it('without the decomposer stage every node is independent and the loss is recorded', () => {
    const { plan, lossNotes } = convertWinDagsPrediction(
      liveRun.predicted_dag,
      undefined,
      {
        planId: 'live-2-dag-only',
        scope,
        policyNodeIds: ['bounded-repair'],
      },
    );
    expect(
      plan.nodes.every(
        (n) => n.dependsOn.length === 0 || n.kind === 'human_gate',
      ),
    ).toBe(true);
    expect(
      lossNotes.some((n) => n.includes('wave order is NOT a dependency graph')),
    ).toBe(true);
    // The gate cannot be converted: it has nothing to review.
    expect(
      plan.nodes.find((n) => n.id === 'human-decision-gate'),
    ).toBeUndefined();
  });

  it('with the decomposer stage dependencies are recovered and the plan validates', () => {
    const { plan, lossNotes } = convertWinDagsPrediction(
      liveRun.predicted_dag,
      liveRun.decomposer,
      {
        planId: 'live-2',
        scope,
        policyNodeIds: ['bounded-repair'],
        sourceRef: 'fixtures/upstream/live-run-2.json',
      },
    );
    const validation = validateWorkflowPlan(plan);
    expect(validation.issues).toEqual([]);
    const deps = Object.fromEntries(
      plan.nodes.map((n) => [n.id, [...n.dependsOn].sort()]),
    );
    expect(deps).toEqual({
      'process-set-a': [],
      'process-set-b': [],
      'synthesize-findings': ['process-set-a', 'process-set-b'],
      'human-decision-gate': ['synthesize-findings'],
      'write-gated-summary': ['human-decision-gate'],
    });
    expect(plan.gateEdges).toEqual([
      {
        from: 'human-decision-gate',
        when: 'approve',
        to: 'write-gated-summary',
      },
    ]);
    expect(lossNotes).toEqual(
      expect.arrayContaining([
        expect.stringContaining('recovered from the DecomposerOutput'),
        expect.stringContaining('No input/output contracts survived'),
        expect.stringContaining("'bounded-repair' was dropped"),
        expect.stringContaining('no decider, options, or revision policy'),
      ]),
    );
  });

  it('matches the hand-authored reference plan on topology but not on contracts or policies', () => {
    const { plan } = convertWinDagsPrediction(
      liveRun.predicted_dag,
      liveRun.decomposer,
      {
        planId: 'live-2',
        scope,
        policyNodeIds: ['bounded-repair'],
      },
    );
    const reference = referencePlan();
    const kinds = (p: typeof plan) =>
      p.nodes
        .map((n) => n.kind)
        .sort()
        .join(',');
    // Same node kinds: four tasks and one gate; same two roots feeding one join-like task.
    expect(kinds(plan)).toBe(kinds(reference));
    expect(
      plan.nodes.filter((n) => n.dependsOn.length === 0).map((n) => n.kind),
    ).toEqual(['task', 'task']);
    expect(
      reference.nodes
        .filter((n) => n.dependsOn.length === 0)
        .map((n) => n.kind),
    ).toEqual(['task', 'task']);
    // Not the same plan: generated contracts are open and recovery is unset.
    const generatedTasks = plan.nodes.filter((n) => n.kind === 'task');
    expect(
      generatedTasks.every(
        (n) =>
          n.kind === 'task' &&
          Object.keys(n.output.schema as object).length === 0,
      ),
    ).toBe(true);
    expect(
      generatedTasks.every(
        (n) => n.kind === 'task' && n.recovery.maxRepairs === 0,
      ),
    ).toBe(true);
    const referenceTasks = reference.nodes.filter((n) => n.kind === 'task');
    expect(
      referenceTasks.every(
        (n) =>
          n.kind === 'task' &&
          Object.keys(n.output.schema as object).length > 0,
      ),
    ).toBe(true);
    // The generated summary task depends on the gate only; the reference also binds the synthesis output.
    const generatedSummary = plan.nodes.find(
      (n) => n.id === 'write-gated-summary',
    );
    expect(generatedSummary?.dependsOn).toEqual(['human-decision-gate']);
    const referenceSummary = reference.nodes.find(
      (n) => n.id === 'final-summary',
    );
    expect(referenceSummary?.dependsOn).toEqual([
      'owner-decision',
      'synthesize',
    ]);
  });
});
