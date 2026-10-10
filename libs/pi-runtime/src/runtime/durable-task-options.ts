import type {
  AgentIdentity,
  AgentSigningCapability,
} from '@moltnet/crypto-service/agent-signing';
import type { ContextRef } from '@moltnet/runtime-profiles';
import type {
  HostCapabilityEvidenceLogger,
  SubagentContractRegistry,
} from '@themoltnet/agent-runtime';
import type { SandboxConfig, VmDiagnostic } from '@themoltnet/sandbox-gondolin';
import type { Agent } from '@themoltnet/sdk';

import type { HostExecAutoApproveConfig } from '../moltnet/tools.js';
import type {
  PiRuntimeDefinition,
  ResolvedGondolinTemplate,
} from '../runtime-definition.js';
import type { ToolEnforcement } from '../tool-policy/gate.js';
import type { ToolPolicyLogger } from '../tool-policy/session-policy.js';
import type { resumeVm } from '../vm.js';
import type { PiTaskExecutionPlanFactory } from './execution-plan.js';
import type { PiModelOptions } from './model-options-extension.js';
import type { PiThinkingLevel } from './pi-thinking-level.js';

/** Inputs used by the Durable Gondolin executor. */
export interface GondolinDurableTaskOptions extends PiModelOptions {
  agentName: string;
  provider: string;
  model: string;
  template: ResolvedGondolinTemplate | null;
  runtimeKind: string;
  moltnetAgent?: Agent;
  agentRootDir?: string;
  mountPath?: string;
  classifier?: { provider: string; model: string } | null;
  thinkingLevel?: PiThinkingLevel | null;
  extraAllowedHosts?: string[];
  sandboxConfig?: SandboxConfig;
  forwardEnv?: string[];
  runtimeProfileContext?: readonly ContextRef[];
  runtimeProfileId?: string;
  toolEnforcement?: ToolEnforcement;
  promptExtras?: Record<string, unknown>;
  onVmDiagnostic?: (diagnostic: VmDiagnostic) => void;
  resumeVm?: typeof resumeVm;
  maxTurns?: number;
  maxSubmitMissingReprompts?: number;
  hostExecAutoApprove?: HostExecAutoApproveConfig;
  makeExecutionPlan?: PiTaskExecutionPlanFactory;
  subagentContractRegistry?: SubagentContractRegistry;
  toolPolicyLogger?: ToolPolicyLogger;
  runtimeDefinition?: PiRuntimeDefinition;
  hostCapabilitySigner?: AgentSigningCapability;
  agentIdentity?: AgentIdentity;
  hostCapabilityLogger?: HostCapabilityEvidenceLogger;
}
