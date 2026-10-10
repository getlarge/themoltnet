import {
  type ClaimedTask,
  createHostCapabilityRouter,
} from '@themoltnet/agent-runtime';
import type {
  BrokeredHttpSecretBinding,
  SandboxConfig,
} from '@themoltnet/sandbox-gondolin';

import {
  materializePiBrokeredHttpSecrets,
  type PiRuntimeDefinition,
} from '../runtime-definition.js';
import type { GondolinDurableTaskOptions } from './durable-task-options.js';
import type { PiTaskExecutionPlan } from './execution-plan.js';

export class HostCapabilityContextMissingError extends Error {
  constructor() {
    super(
      'runtime declares host capabilities but no agent identity and authenticated host Agent were injected',
    );
    this.name = 'HostCapabilityContextMissingError';
  }
}

/** Compile before VM resume; calls fail closed until the executor sets policy. */
export function createAttemptHostCapabilityRouter(input: {
  options: Pick<
    GondolinDurableTaskOptions,
    | 'runtimeDefinition'
    | 'moltnetAgent'
    | 'agentIdentity'
    | 'hostCapabilitySigner'
    | 'hostCapabilityLogger'
    | 'toolPolicyLogger'
  >;
  claimedTask: ClaimedTask;
  mountPath: string;
  signal: AbortSignal;
}) {
  const { options, claimedTask, mountPath, signal } = input;
  const capabilities = options.runtimeDefinition?.hostCapabilities ?? [];
  if (capabilities.length === 0) return undefined;
  if (!options.moltnetAgent || !options.agentIdentity)
    throw new HostCapabilityContextMissingError();
  return createHostCapabilityRouter({
    capabilities,
    context: {
      taskId: claimedTask.task.id,
      attemptN: claimedTask.attemptN,
      teamId: claimedTask.task.teamId ?? '',
      agent: options.moltnetAgent,
      identity: options.agentIdentity,
    },
    injected: {
      ...(options.hostCapabilitySigner && {
        signer: options.hostCapabilitySigner,
      }),
    },
    paths: { mountPath },
    // Evidence remains observable for direct callers without an injected logger.
    logger: options.hostCapabilityLogger ??
      options.toolPolicyLogger ?? {
        info: (obj: Record<string, unknown>, msg: string) =>
          console.error(JSON.stringify({ level: 'info', msg, ...obj })),
        warn: (obj: Record<string, unknown>, msg: string) =>
          console.error(JSON.stringify({ level: 'warn', msg, ...obj })),
      },
    signal,
  });
}

/** Resolve one attempt's host-only HTTP credentials before VM resume. */
export async function resolveAttemptBrokeredHttpSecrets(input: {
  runtimeDefinition?: PiRuntimeDefinition;
  agentName: string;
  claimedTask: ClaimedTask;
  cwdPath: string;
  signal: AbortSignal;
  timeoutMs?: number;
}): Promise<BrokeredHttpSecretBinding[] | undefined> {
  if (!input.runtimeDefinition) return undefined;
  return materializePiBrokeredHttpSecrets({
    runtime: input.runtimeDefinition,
    context: {
      agentName: input.agentName,
      claimedTask: input.claimedTask,
      cwdPath: input.cwdPath,
    },
    signal: input.signal,
    timeoutMs: input.timeoutMs,
  });
}

export function applyExecutionPlanSandboxOverrides(
  sandboxConfig: SandboxConfig | undefined,
  executionPlan: PiTaskExecutionPlan | null,
): SandboxConfig | undefined {
  const shadowWrites = executionPlan?.workspaceAttachment?.shadowWrites;
  if (!shadowWrites) {
    return sandboxConfig;
  }

  return {
    ...sandboxConfig,
    vfs: {
      ...sandboxConfig?.vfs,
      shadow: ['**'],
      shadowMode: shadowWrites,
    },
  };
}
