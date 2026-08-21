export {
  createMoltNetTools,
  HOST_EXEC_DEFAULT_BASE_ENV,
  MOLTNET_TOOL_NAMES,
  type MoltNetToolsConfig,
  type TrackedError,
} from './moltnet/tools.js';
export { createPiOtelExtension, type PiOtelOptions } from './otel/index.js';
export { isResolvedPathInsideRoot } from './path-containment.js';
export { buildAgentSession } from './runtime/agent-session-factory.js';
export {
  createGondolinToolDefinitions,
  createPiTaskExecutor,
  executePiTask,
  type ExecutePiTaskOptions,
  GONDOLIN_TOOL_NAMES,
  type PiSessionPersistencePlan,
  type PiTaskExecutionPlan,
  type PiTaskExecutionPlanFactory,
  type ProviderErrorRetryEvent,
  type ProviderErrorRetryLevel,
  type ProviderErrorRetryUi,
  resolveHostExecBaseEnv,
  resolveTaskWorktreePath,
  type TurnEventHandlerFactory,
} from './runtime/execute-pi-task.js';
export {
  type InjectedTaskContext,
  injectTaskContext,
  type InjectTaskContextArgs,
  type VmFsForContext,
} from './runtime/inject-task-context.js';
export {
  createPiRetryTriage,
  normalizeRetryTriageResult,
  type PiRetryTriage,
  type PiRetryTriageConfidence,
  type PiRetryTriageDecision,
  type PiRetryTriageInput,
  type PiRetryTriageResult,
  type PiRetryTriageThinkingLevel,
  redactRetryTriageSecrets,
  type RetryTriageConfidence,
  type RetryTriageDecision,
} from './runtime/retry-triage.js';
export {
  buildRuntimeKernel,
  buildWorkspaceMountInstructions,
} from './runtime/runtime-instructor.js';
export {
  createSubagentTool,
  type CreateSubagentToolArgs,
  type SubagentToolHandle,
  type SubagentToolParameters,
} from './runtime/subagent-tool.js';
export type {
  TurnEventHandler,
  TurnEventKind,
} from './runtime/task-event-emitter.js';
export {
  buildPiExecutorManifest,
  defineGondolinTemplate,
  type DefineGondolinTemplateOptions,
  definePiExtension,
  definePiRuntime,
  type DefinePiRuntimeOptions,
  definePiTool,
  enabledPiToolNames,
  filterModelVisibleTools,
  type GondolinTemplateDefinition,
  type GondolinTemplateResolveContext,
  isKernelTool,
  isToolVisible,
  materializePiExtensions,
  materializePiTools,
  type ModelVisibleToolPolicy,
  PI_EXECUTOR_MANIFEST_VERSION,
  PI_RUNTIME_DEFINITION_VERSION,
  type PiExecutorManifest,
  type PiExtensionContribution,
  type PiExtensionFactory,
  type PiExtensionOptions,
  type PiRuntimeDefinition,
  type PiToolContext,
  type PiToolContribution,
  type PiToolDescriptor,
  type PiToolFactoryOptions,
  type PiToolScope,
  type ResolvedGondolinTemplate,
} from './runtime-definition.js';
export type {
  EnsureSnapshotOptions,
  ResumeCommand,
  SandboxConfig,
  SnapshotConfig,
} from './snapshot.js';
export { ensureSnapshot, GONDOLIN_BASE_EXECUTABLES } from './snapshot.js';
export {
  createGondolinBashOps,
  createGondolinEditOps,
  createGondolinFindOps,
  createGondolinLsOps,
  createGondolinReadOps,
  createGondolinWriteOps,
  executeGondolinGrep,
  toGuestPath,
} from './tool-operations.js';
export {
  decideToolCall,
  type GateDecision,
  type GateInput,
  type ToolEnforcement,
  type ToolPolicyDecisionReason,
} from './tool-policy/gate.js';
export {
  type AllowedToolsClient,
  createToolPolicyExtension,
  decideForEvent,
  resolveSessionToolPolicy,
  type SessionToolPolicy,
  type ToolPolicyDecisionContext,
  type ToolPolicyExtensionDeps,
} from './tool-policy/session-policy.js';
export type {
  BrokeredSecret,
  GuestCredentialMode,
  ManagedVm,
  VmConfig,
  VmCredentials,
  VmDiagnostic,
} from './vm-manager.js';
export {
  activateAgentEnv,
  assertBrokeredSecretNamesDoNotCollide,
  assertGuestEnvironmentBoundary,
  assertHostAuthenticatedGuestEnvironment,
  findMainWorktree,
  GONDOLIN_BASE_ALLOWED_HOSTS,
  loadCredentials,
  resumeVm,
} from './vm-manager.js';
export { GuestEnvironmentBoundaryError } from './vm-manager.js';
