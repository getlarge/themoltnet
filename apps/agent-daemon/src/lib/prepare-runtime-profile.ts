import {
  type ResolvedRuntimeProfile,
  validateRuntimeProfilePrerequisites,
} from '@themoltnet/agent-runtime';
import { assertGuestEnvironmentBoundary } from '@themoltnet/pi-runtime';
import type { Agent } from '@themoltnet/sdk';

import {
  assertRuntimeAdapterSupportsProfile,
  type DaemonRuntimeAdapter,
} from '../runtime.js';
import type { DaemonSlotIdentity } from './daemon-slot-identity.js';
import {
  createExecutionPlanCache,
  type RuntimeSlotStore,
  type SourceAttemptResolver,
} from './execution-plan-cache.js';
import {
  type AttestedDaemonRuntime,
  attestPreparedRuntime,
} from './executor-attestation.js';
import type { RuntimeSessionStore } from './runtime-sessions.js';
import { ensureDaemonStateDirs } from './state-dir.js';

export interface PreparedRuntimeProfile {
  profile: ResolvedRuntimeProfile;
  preparedRuntime: AttestedDaemonRuntime;
  sandbox: {
    config: ResolvedRuntimeProfile['sandboxConfig'];
    rootDir: string;
    path: string;
  };
  stateDirs: ReturnType<typeof ensureDaemonStateDirs>;
  slotIdentity: DaemonSlotIdentity;
  executionPlans: ReturnType<typeof createExecutionPlanCache>;
}

/** Validate and prepare a profile through the shared daemon execution path. */
export async function prepareRuntimeProfile(input: {
  agent: Agent;
  agentName: string;
  profile: ResolvedRuntimeProfile;
  stateRootDir?: string;
  prerequisiteEnv: NodeJS.ProcessEnv;
  runtimeAdapter: DaemonRuntimeAdapter;
  runtimeInstanceId: string;
  signingPrivateKey: string;
  slotRegistry: RuntimeSlotStore;
  runtimeSessionStore: RuntimeSessionStore;
  sourceAttemptResolver: SourceAttemptResolver;
  warmRetentionSec: number;
}): Promise<PreparedRuntimeProfile> {
  const { profile } = input;
  assertRuntimeAdapterSupportsProfile(input.runtimeAdapter, profile);
  const preparedRuntime = attestPreparedRuntime(
    await input.runtimeAdapter.prepare({ profile }),
    input.signingPrivateKey,
  );
  validateRuntimeProfilePrerequisites(profile, input.prerequisiteEnv, {
    tools: preparedRuntime.tools,
    executables: preparedRuntime.executables,
  });
  assertGuestEnvironmentBoundary({
    forwardEnv: profile.requiredEnv,
    sandboxEnv: profile.sandboxConfig.env,
  });
  await input.agent.tasks.registerExecutorManifest(
    await preparedRuntime.attestor.registration(),
  );

  const sandbox = {
    config: profile.sandboxConfig,
    rootDir: profile.mountPath,
    path: profile.source,
  };
  const stateDirs = ensureDaemonStateDirs(
    input.stateRootDir ?? sandbox.rootDir,
  );
  const slotIdentity: DaemonSlotIdentity = {
    agentName: input.agentName,
    runtimeProfileId: profile.id,
    runtimeInstanceId: input.runtimeInstanceId,
  };
  const executionPlans = createExecutionPlanCache({
    stateDirs,
    slotIdentity,
    warmRetentionSec: input.warmRetentionSec,
    workspacePolicy: {
      defaultWorkspaceMode: profile.defaultWorkspaceMode,
      allowedWorkspaceModes: profile.allowedWorkspaceModes,
    },
    slotRegistry: input.slotRegistry,
    runtimeSessionStore: input.runtimeSessionStore,
    sourceAttemptResolver: input.sourceAttemptResolver,
  });

  return {
    profile,
    preparedRuntime,
    sandbox,
    stateDirs,
    slotIdentity,
    executionPlans,
  };
}
