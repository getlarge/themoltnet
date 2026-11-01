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
  buildScenarioFreeformInput,
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
export {
  buildGitFixtureRepo,
  type BuildGitFixtureRepoOptions,
  type GitFixtureCommit,
} from './git-repo.js';
export {
  formatProducerSpend,
  mergeProducerSpend,
  type ProducerSpend,
  type SpendAttempt,
  summarizeProducerSpend,
} from './producer-spend.js';
export { readScenario, ScenarioError } from './read-scenario.js';
export {
  GateExpectations,
  GIT_SEED_PROMPT_PLACEHOLDERS,
  type ResolvedScenarioFixtures,
  type ResolvedScenarioInputArtifact,
  type Scenario,
  SCENARIO_REFERENCE_ROLES,
  SCENARIO_TASK_TYPES,
  ScenarioFixtureConfig,
  ScenarioGitSeedFixture,
  ScenarioInputArtifactFixture,
  type ScenarioReferenceRole,
  type ScenarioTaskType,
} from './scenario.js';
export {
  GIT_SEED_HEAD_BRANCH,
  type ScenarioArtifactStager,
  type ScenarioGitRevisions,
  seedScenarioGitRepo,
  seedScenarioWorkspace,
  type StagedScenarioInputArtifact,
  stageScenarioInputArtifacts,
} from './scenario-fixtures.js';
export {
  FINAL_MESSAGE_SUBMIT_CREDIT,
  isCleanSubmitShape,
  type MatrixDeps,
  runMatrix,
  type ScoreCell,
  type ScoreMatrix,
  submitProtocolCredit,
  submitShapeScore,
  type SubmitStructure,
  summarizeMatrix,
} from './score-matrix.js';
export {
  collectEvalSpend,
  type EvalSpendContext,
  type EvalSpendRecord,
  type EvalSpendReport,
  type EvalSpendTask,
  type EvalSpendTotal,
  formatEvalSpendReport,
} from './spend-report.js';
export {
  readSubmitStructure,
  type SubmitStructureAgent,
  type SubmitStructureMessage,
} from './submit-structure.js';
