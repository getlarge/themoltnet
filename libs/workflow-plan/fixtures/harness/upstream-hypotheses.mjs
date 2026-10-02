// Static evidence for the four hypotheses against upstream windags-skills @ 9e2fed3b.
// Runs the upstream Zod validator (mcp-server/validate-prediction.js) and the
// documented JSON schema (skills/next-move/schemas/predicted-dag.schema.json) on
// the same inputs. postProcessPredictedDAG is not exported upstream, so the
// relevant lines are re-executed via a verbatim extraction below.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const UP = process.env.WINDAGS_DIR;
const { validatePredictedDAG } = await import(
  path.join(UP, 'mcp-server/validate-prediction.js')
);
const require = createRequire(
  path.join(process.env.MOLTNET_DIR, 'package.json'),
);
const Ajv = require(process.env.AJV_2020 ?? 'ajv/dist/2020');
const addFormats = require(process.env.AJV_FORMATS ?? 'ajv-formats');
const schema = JSON.parse(
  fs.readFileSync(
    path.join(UP, 'skills/next-move/schemas/predicted-dag.schema.json'),
    'utf8',
  ),
);
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
const validateJsonSchema = ajv.compile(schema);

// --- verbatim extraction of postProcessPredictedDAG from run-pipeline.js (lines ~317-384)
const src = fs.readFileSync(
  path.join(UP, 'mcp-server/run-pipeline.js'),
  'utf8',
);
const start = src.indexOf('function normalizeTierForSchema');
const end = src.indexOf('async function runSynthesizer');
const extracted =
  src.slice(start, end) +
  '\nexport { postProcessPredictedDAG, normalizeTierForSchema };\n';
fs.writeFileSync(
  path.join(process.env.OUT, '_postprocess-extracted.mjs'),
  extracted,
);
const { postProcessPredictedDAG } = await import(
  path.join(process.env.OUT, '_postprocess-extracted.mjs')
);

// A synthesizer-shaped output exactly as the synthesizer system prompt demands,
// plus the dependency information the Decomposer produced upstream.
const decomposer = {
  subtasks: [
    {
      id: 'process-a',
      description: 'Process evidence set A',
      depends_on: [],
      wave: 0,
    },
    {
      id: 'process-b',
      description: 'Process evidence set B',
      depends_on: [],
      wave: 0,
    },
    {
      id: 'synthesize',
      description: 'Synthesize A and B',
      depends_on: ['process-a', 'process-b'],
      wave: 1,
    },
    {
      id: 'human-decision',
      description: 'Human approves, revises or rejects',
      depends_on: ['synthesize'],
      wave: 2,
    },
    {
      id: 'final-summary',
      description: 'Produce the final summary',
      depends_on: ['human-decision'],
      wave: 3,
    },
  ],
};
const skillSelector = {
  selections: decomposer.subtasks.map((s) => ({
    subtask_id: s.id,
    primary_skill:
      s.id === 'human-decision'
        ? 'human-gate-designer'
        : 'research-synthesizer',
    runner_up: null,
    reasoning: '',
    model_tier: 'balanced',
  })),
};
const premortem = {
  recommendation: 'PROCEED',
  risks: [
    {
      description: 'Synthesis may ignore one evidence set',
      severity: 'medium',
      affected_nodes: ['synthesize'],
      mitigation: 'Require citations to both sets',
    },
  ],
};
const node = (id, wave, deps, extra = {}) => ({
  id,
  skill_id: skillSelector.selections.find((s) => s.subtask_id === id)
    .primary_skill,
  role_description: `Node ${id}`,
  why: `Chosen for ${id}`,
  input_contract: deps.length
    ? `Consumes outputs of ${deps.join(', ')}`
    : 'Consumes the synthetic evidence fixture',
  output_contract: `Produces ${id}.json`,
  commitment_level: 'COMMITTED',
  model_tier: 'sonnet',
  estimated_minutes: 3,
  estimated_cost_usd: 0.05,
  cascade_depth: wave,
  dependencies: deps,
  ...extra,
});
const synthesizerOutput = {
  title: 'Evidence synthesis with human gate',
  problem_classification: 'well-structured',
  confidence: 0.8,
  waves: [
    {
      wave_number: 0,
      parallelizable: true,
      nodes: [node('process-a', 0, []), node('process-b', 0, [])],
    },
    {
      wave_number: 1,
      parallelizable: false,
      nodes: [node('synthesize', 1, ['process-a', 'process-b'])],
    },
    {
      wave_number: 2,
      parallelizable: false,
      nodes: [node('human-decision', 2, ['synthesize'])],
    },
    {
      wave_number: 3,
      parallelizable: false,
      nodes: [node('final-summary', 3, ['human-decision'])],
    },
  ],
  estimated_total_minutes: 15,
  estimated_total_cost_usd: 0.25,
  premortem,
  topology: 'workflow',
  topologyReason: 'Human gate with revise loop',
};
const report = { upstream_revision: process.env.WINDAGS_REV, findings: {} };

// H1 + H2: trace through postProcess then validator (the exact runSynthesizer path)
const post = postProcessPredictedDAG(structuredClone(synthesizerOutput), {
  skillSelector,
  premortem,
});
const v = validatePredictedDAG(post);
const outNode = v.data.waves[1].nodes[0];
report.findings.h1_dependencies_discarded = {
  decomposer_depends_on: decomposer.subtasks[2].depends_on,
  synthesizer_node_had_dependencies:
    synthesizerOutput.waves[1].nodes[0].dependencies,
  after_postProcess_dependencies: post.waves[1].nodes[0].dependencies ?? null,
  after_validator_dependencies: outNode.dependencies,
  confirmed:
    Array.isArray(outNode.dependencies) && outNode.dependencies.length === 0,
};
report.findings.h2_contracts_stripped = {
  after_postProcess_keys: Object.keys(post.waves[1].nodes[0]),
  after_validator_keys: Object.keys(outNode),
  after_validator_wave_keys: Object.keys(v.data.waves[1]),
  input_contract_survives: 'input_contract' in outNode,
  output_contract_survives: 'output_contract' in outNode,
  why_survives: 'why' in outNode,
  commitment_level_survives: 'commitment_level' in outNode,
  wave_number_survives: 'wave_number' in v.data.waves[1],
  topology_reason_survives: 'topologyReason' in v.data,
  confirmed: !('input_contract' in outNode) && !('output_contract' in outNode),
};

// H3: documented JSON schema vs runtime Zod validator on the same documents
const docShaped = structuredClone(synthesizerOutput); // model_tier "sonnet", premortem "PROCEED": matches the JSON schema enums
for (const w of docShaped.waves) for (const n of w.nodes) delete n.dependencies;
const zodShaped = structuredClone(post); // after postProcess: "balanced", "ACCEPT"
const jsOnDoc = validateJsonSchema(docShaped);
const jsDocErrors = (validateJsonSchema.errors ?? []).map(
  (e) => `${e.instancePath} ${e.message}`,
);
const zodOnDoc = validatePredictedDAG(docShaped);
const jsOnZod = validateJsonSchema(zodShaped);
const jsZodErrors = (validateJsonSchema.errors ?? []).map(
  (e) => `${e.instancePath} ${e.message}`,
);
const zodOnZod = validatePredictedDAG(zodShaped);
report.findings.h3_schema_validator_disagree = {
  json_schema_accepts_documented_shape: jsOnDoc,
  json_schema_errors_on_documented_shape: jsDocErrors.slice(0, 5),
  zod_accepts_documented_shape: zodOnDoc.success,
  zod_errors_on_documented_shape: zodOnDoc.errors.slice(0, 5),
  json_schema_accepts_postprocessed_shape: jsOnZod,
  json_schema_errors_on_postprocessed_shape: jsZodErrors.slice(0, 8),
  zod_accepts_postprocessed_shape: zodOnZod.success,
  confirmed: jsOnDoc !== zodOnDoc.success || jsOnZod !== zodOnZod.success,
};

// H4: defaults conceal missing information
const degenerate = {
  waves: [{ nodes: [{ id: 'x', skill_id: 'y', role_description: 'z' }] }],
};
const vd = validatePredictedDAG(degenerate);
const skeletal = {
  title: 't',
  waves: [
    {
      nodes: [
        { id: 'n1', role_description: 'only a role' },
        { id: 'n2', role_description: 'only a role' },
      ],
    },
  ],
};
const bareIds = postProcessPredictedDAG(
  { title: 't', waves: [{ nodes: [{ id: 'n1' }] }] },
  { skillSelector: { selections: [] }, premortem: undefined },
);
const vBare = validatePredictedDAG(bareIds);
const postSkeletal = postProcessPredictedDAG(structuredClone(skeletal), {
  skillSelector: { selections: [] },
  premortem: undefined,
});
const vs = validatePredictedDAG(postSkeletal);
const empty = validatePredictedDAG({});
report.findings.h4_defaults_conceal = {
  minimal_node_accepted: vd.success,
  minimal_node_output: vd.data,
  skeletal_after_postprocess_accepted: vs.success,
  skeletal_node_after_postprocess: vs.data?.waves[0].nodes[0],
  empty_object_accepted: empty.success,
  empty_object_output: empty.data,
  bare_id_node_rejected_because_role_description_empty: !vBare.success,
  bare_id_errors: vBare.errors,
  general_purpose_skill_exists_in_catalog: fs.existsSync(
    path.join(UP, 'skills/general-purpose'),
  ),
  confirmed: vd.success && vs.success && empty.success,
};

// Structural checks that neither validator performs
const dupAndCycle = {
  title: 't',
  waves: [
    {
      nodes: [
        { id: 'a', skill_id: 's', role_description: 'r', dependencies: ['b'] },
        { id: 'a', skill_id: 's', role_description: 'r', dependencies: ['a'] },
        {
          id: 'c',
          skill_id: 's',
          role_description: 'r',
          dependencies: ['ghost'],
        },
      ],
    },
  ],
};
const vc = validatePredictedDAG(dupAndCycle);
report.findings.h5_no_structural_checks = {
  duplicate_ids_self_cycle_and_dangling_ref_accepted: vc.success,
  json_schema_accepts_duplicate_ids: validateJsonSchema({
    ...docShaped,
    waves: [
      {
        wave_number: 0,
        parallelizable: true,
        nodes: [docShaped.waves[0].nodes[0], docShaped.waves[0].nodes[0]],
      },
    ],
  }),
};
fs.writeFileSync(
  path.join(process.env.OUT, 'upstream-hypotheses.json'),
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify(
    Object.fromEntries(
      Object.entries(report.findings).map(([k, f]) => [k, f.confirmed ?? f]),
    ),
    null,
    2,
  ),
);
