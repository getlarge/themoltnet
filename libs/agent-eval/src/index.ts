// @moltnet/agent-eval — deterministic evaluation harness for agent-runtime
// prompts and rendered packs. Reads evals-v2 scenarios, builds run_eval /
// judge_eval_attempt inputs, and evaluates stage-1 deterministic gates before
// any LLM judge runs.
export {
  type BaselineDeps,
  type BaselineReport,
  type BaselineRun,
  type BaselineScenarioResult,
  runBaseline,
  summarizeBaseline,
} from './baseline.js';
export {
  buildJudgeInput,
  type BuildJudgeOptions,
  buildRunEvalInput,
  type BuildRunEvalOptions,
  buildScenarioRunEvalInput,
  type BuildScenarioRunEvalOptions,
} from './build-inputs.js';
export {
  checkGates,
  type GateAgent,
  type GateFailure,
  type GateResult,
  type GateTaskAttempt,
  type GateTaskMessage,
} from './check-gates.js';
export { readScenario, ScenarioError } from './read-scenario.js';
export {
  GateExpectations,
  type ResolvedScenarioFixtures,
  type ResolvedScenarioInputArtifact,
  type Scenario,
  SCENARIO_REFERENCE_ROLES,
  SCENARIO_TASK_TYPES,
  ScenarioFixtureConfig,
  ScenarioInputArtifactFixture,
  type ScenarioReferenceRole,
  type ScenarioTaskType,
} from './scenario.js';
export {
  type ScenarioArtifactStager,
  seedScenarioWorkspace,
  type StagedScenarioInputArtifact,
  stageScenarioInputArtifacts,
} from './scenario-fixtures.js';
export {
  type MatrixDeps,
  runMatrix,
  type ScoreCell,
  type ScoreMatrix,
  summarizeMatrix,
} from './score-matrix.js';
