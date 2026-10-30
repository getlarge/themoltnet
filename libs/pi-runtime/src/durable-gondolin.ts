import { randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import {
  BACKGROUND_CONTEXT,
  withAbortSignal,
} from '@earendil-works/chord/context';
import { formatSkillsForPrompt } from '@earendil-works/pi-coding-agent';
import {
  buildTaskUserPrompt,
  TaskExecutionInterrupted,
  taskTypeUsesSubagents,
  traceRuntimePhase,
} from '@themoltnet/agent-runtime';
import {
  GUEST_TASK_CONTEXT_MOUNT,
  resolveVfsShadowConfig,
} from '@themoltnet/sandbox-gondolin';
import { ShellCommandAnalyzer } from '@themoltnet/shell-command-analyzer';

import { resolvePiCodingAgentDir } from './config.js';
import { createDurableTaskExecutor } from './durable-executor.js';
import { GondolinDurableEnv } from './durable-gondolin-env.js';
import {
  adaptDurableTools,
  createDurableGondolinTools,
} from './durable-gondolin-tools.js';
import { ApiDurableStorage } from './durable-storage.js';
import { acquireDurableTransport } from './durable-transport.js';
import { createAttemptMoltNetTools } from './moltnet/tools.js';
import {
  applyExecutionPlanSandboxOverrides,
  createAttemptHostCapabilityRouter,
  resolveAttemptBrokeredHttpSecrets,
} from './runtime/attempt-vm.js';
import { discoverGuestExecutables } from './runtime/capability-discovery.js';
import type { GondolinDurableTaskOptions } from './runtime/durable-task-options.js';
import { configureDurableModelOptions } from './runtime/model-options-extension.js';
import {
  createClassifierTool,
  createRuntimeModels,
  executeProfileClassificationTask,
  resolveClassifier,
} from './runtime/model-runtime.js';
import { projectRuntimeCapabilities } from './runtime/runtime-capability-projection.js';
import {
  injectRuntimeContext,
  resolveEffectiveRuntimeContext,
} from './runtime/runtime-context.js';
import {
  buildRuntimeKernel,
  composeRuntimeSystemPrompt,
} from './runtime/runtime-instructor.js';
import { prepareTaskWorkspace } from './runtime/task-workspace.js';
import {
  filterModelVisibleTools,
  materializePiTools,
  PiBrokeredHttpSecretResolutionError,
} from './runtime-definition.js';
import {
  createGondolinToolLifecycle,
  guardGondolinToolDefinitions,
  toGuestPath,
} from './tool-operations.js';
import {
  authorizeDurableToolCall,
  createStderrToolPolicyLogger,
  resolveSessionToolPolicy,
} from './tool-policy/session-policy.js';
import { resumeVm } from './vm.js';

/**
 * Host-side proof that a resumed attempt found the workspace its first run
 * prepared. The guest cannot read or write `.moltnet` paths in a mount.
 */
function workspaceMarkerPath(
  cwdPath: string,
  taskId: string,
  attemptN: number,
) {
  return join(
    cwdPath,
    '.moltnet',
    'durable-workspaces',
    `${taskId}-${attemptN}`,
  );
}

function writeWorkspaceMarker(marker: string, token: string) {
  mkdirSync(dirname(marker), { recursive: true });
  const fd = openSync(
    marker,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_TRUNC |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeFileSync(fd, token);
  } finally {
    closeSync(fd);
  }
}

function workspaceUnavailable(reason: string, cause?: unknown) {
  return new TaskExecutionInterrupted(
    `Durable workspace is unavailable (${reason}); restore its persistent volume before resuming`,
    cause === undefined ? undefined : { cause },
  );
}

/** Returns the stored token once the expected marker is confirmed. */
function verifyWorkspaceMarker(
  previous: Readonly<Record<string, unknown>>,
  marker: string,
): string {
  if (typeof previous.marker !== 'string' || typeof previous.token !== 'string')
    throw workspaceUnavailable('checkpoint has no workspace marker');
  // Compare before touching the filesystem: the path comes from stored state.
  if (previous.marker !== marker)
    throw workspaceUnavailable(
      `workspace moved from ${previous.marker} to ${marker}`,
    );
  let stored: string;
  try {
    stored = readFileSync(marker, 'utf8');
  } catch (cause) {
    throw workspaceUnavailable(`marker ${marker} is unreadable`, cause);
  }
  if (stored !== previous.token)
    throw workspaceUnavailable(`marker ${marker} belongs to another run`);
  return previous.token;
}

/** Mounted workspaces remain available independently of the daemon process. */
export function createGondolinDurableTaskExecutor(
  options: GondolinDurableTaskOptions,
) {
  return async (
    ...args: Parameters<ReturnType<typeof createDurableTaskExecutor>>
  ) => {
    const [claimedTask, reporter] = args;
    const startedAt = Date.now();
    if (claimedTask.task.taskType === 'classify')
      return executeProfileClassificationTask(options.classifier, ...args);
    const template = options.template;
    if (!template)
      throw new Error('Generation task requires a Gondolin template');
    const agent = options.moltnetAgent;
    if (!agent || !options.runtimeProfileId)
      throw new Error(
        `Durable runtime requires an authenticated Agent and runtime profile (agent: ${agent ? 'present' : 'missing'}, profile: ${options.runtimeProfileId ?? 'missing'})`,
      );
    const runtimeProfileId = options.runtimeProfileId;
    const piDir = resolvePiCodingAgentDir();
    const models = await createRuntimeModels(piDir);
    const model = models.getModel(options.provider, options.model);
    if (!model)
      throw new Error(
        `Chat model ${options.provider}/${options.model} is not registered`,
      );
    const logger =
      options.toolPolicyLogger ??
      createStderrToolPolicyLogger({
        taskId: claimedTask.task.id,
        attemptN: claimedTask.attemptN,
      });
    // Task events are telemetry: a reporter failure never fails the attempt.
    const record = async (event: Parameters<typeof reporter.record>[0]) => {
      try {
        await reporter.record(event);
      } catch (error) {
        logger.warn(
          {
            kind: event.kind,
            error: error instanceof Error ? error.message : String(error),
          },
          'durable.task_event_failed',
        );
      }
    };
    const analyzer = await ShellCommandAnalyzer.create();
    configureDurableModelOptions(
      models,
      options,
      options.provider,
      options.model,
      (details, message) => logger.warn(details, message),
    );
    const execute = createDurableTaskExecutor({
      models,
      model: { provider: options.provider, modelId: options.model },
      maxTurns: options.maxTurns,
      maxBashTimeouts: options.maxBashTimeouts,
      subagentContracts: options.subagentContractRegistry,
      maxSubmitReminders: options.maxSubmitMissingReprompts,
      agent: { thinkingLevel: options.thinkingLevel ?? undefined },
      async open(claimed, signal) {
        const lease = await acquireDurableTransport({
          stores: agent.runtimeSessions,
          claimed,
          signal,
        });
        const storage = await ApiDurableStorage.open(
          lease.transport,
          withAbortSignal(lease.signal, BACKGROUND_CONTEXT),
        ).catch((cause: unknown) => {
          throw new TaskExecutionInterrupted(
            'Unable to restore Durable state',
            { cause },
          );
        });
        const retirement = new AbortController();
        const executionSignal = AbortSignal.any([
          lease.signal,
          retirement.signal,
        ]);
        const lifecycle = createGondolinToolLifecycle({
          onRetired: () =>
            retirement.abort(
              new TaskExecutionInterrupted('Durable VM retired'),
            ),
        });
        return {
          storage,
          signal: executionSignal,
          check() {
            lease.check();
            executionSignal.throwIfAborted();
          },
          async prepare(previousEnvironment) {
            let policy = await resolveSessionToolPolicy({
              signal: executionSignal,
              agent,
              profileId: runtimeProfileId,
              teamId: claimed.task.teamId,
              runtimeKind: options.runtimeKind,
              enforcement: options.toolEnforcement ?? 'enforce',
              logger,
            });
            // Durable never runs on the degraded fallback allow-set, even in
            // audit mode.
            if (policy.degraded)
              throw new Error(
                `Durable runtime requires a resolved tool policy (runtime profile ${runtimeProfileId})`,
              );
            const claimPolicySnapshotHash =
              claimed.claimAuthority?.policySnapshotHash;
            if (
              claimPolicySnapshotHash &&
              policy.executionPolicySnapshotHash &&
              claimPolicySnapshotHash !== policy.executionPolicySnapshotHash
            )
              // Informational: the gate always uses the execution snapshot.
              logger.info(
                {
                  taskId: claimed.task.id,
                  attemptN: claimed.attemptN,
                  decision: 'continue',
                  reason: 'claim_execution_policy_drift',
                  claimPolicySnapshotHash,
                  executionPolicySnapshotHash:
                    policy.executionPolicySnapshotHash,
                },
                'tool_policy.snapshot_drift',
              );
            const plan = (await options.makeExecutionPlan?.(claimed)) ?? null;
            const resumed = previousEnvironment !== null;
            const workspace = await traceRuntimePhase(
              'moltnet.execution.workspace.prepare',
              {
                'moltnet.workspace.mode': plan?.workspaceMode ?? 'shared_mount',
                'moltnet.workspace.resumed': resumed,
              },
              async () => {
                try {
                  return prepareTaskWorkspace(
                    claimed.task,
                    options.mountPath ?? process.cwd(),
                    plan,
                    { reuseExisting: resumed },
                  );
                } catch (error) {
                  if (!resumed) throw error;
                  throw workspaceUnavailable(
                    error instanceof Error ? error.message : String(error),
                    error,
                  );
                }
              },
            );
            const marker = workspaceMarkerPath(
              workspace.cwdPath,
              claimed.task.id,
              claimed.attemptN,
            );
            let token: string;
            if (previousEnvironment) {
              token = verifyWorkspaceMarker(previousEnvironment, marker);
            } else {
              token = randomUUID();
              writeWorkspaceMarker(marker, token);
            }
            await record({
              kind: 'info',
              payload: {
                event: 'execute_start',
                provider: options.provider,
                model: options.model,
                resumed,
                workspaceMode: workspace.mode,
                workspaceBranch: workspace.branch,
                workspaceRevision: workspace.revision,
              },
            });
            const brokeredSecrets = await traceRuntimePhase(
              'moltnet.execution.credentials.resolve',
              {
                'moltnet.credentials.requirement_count':
                  options.runtimeDefinition?.brokeredHttpSecrets?.length ?? 0,
              },
              () =>
                resolveAttemptBrokeredHttpSecrets({
                  runtimeDefinition: options.runtimeDefinition,
                  agentName: options.agentName,
                  claimedTask: claimed,
                  cwdPath: workspace.cwdPath,
                  signal: executionSignal,
                }),
            );
            const capabilityLifetime = new AbortController();
            const capabilityRouter = createAttemptHostCapabilityRouter({
              options,
              claimedTask: claimed,
              mountPath: workspace.mountPath,
              signal: AbortSignal.any([
                executionSignal,
                capabilityLifetime.signal,
              ]),
            });
            capabilityRouter?.setPolicy(policy);
            const managed = await traceRuntimePhase(
              'moltnet.execution.vm.resume',
              { 'moltnet.workspace.mode': workspace.mode },
              () =>
                (options.resumeVm ?? resumeVm)({
                  checkpointPath: template.checkpointPath,
                  agentName: options.agentName,
                  agentRootDir: options.agentRootDir,
                  mountPath: workspace.mountPath,
                  workspaceMode: workspace.mode,
                  sandboxConfig: applyExecutionPlanSandboxOverrides(
                    {
                      ...options.sandboxConfig,
                      snapshot: undefined,
                      resumeCommands: [...template.resumeCommands],
                    },
                    plan,
                  ),
                  brokeredSecrets,
                  ...(capabilityRouter && {
                    hostOrigins: capabilityRouter.origins,
                    guestProjection: capabilityRouter.guestProjection,
                  }),
                  forwardEnv: options.forwardEnv,
                  extraAllowedHosts: options.extraAllowedHosts,
                  onDiagnostic: options.onVmDiagnostic,
                  signal: executionSignal,
                }),
            ).catch((error: unknown) => {
              capabilityLifetime.abort(error);
              throw error;
            });
            // Every teardown step runs even when an earlier one fails.
            const close = async () => {
              capabilityLifetime.abort(new Error('Durable environment closed'));
              const failures: unknown[] = [];
              for (const binding of brokeredSecrets ?? []) {
                if (!binding.value) continue;
                try {
                  managed.secretManager.revokeSecret(binding.guestEnv);
                } catch (error) {
                  failures.push(error);
                }
              }
              for (const step of [
                () => managed.services.stop(),
                () => managed.vm.close(),
              ]) {
                try {
                  await step();
                } catch (error) {
                  failures.push(error);
                }
              }
              if (failures.length > 0)
                throw new AggregateError(
                  failures,
                  'Durable environment cleanup failed',
                );
            };
            try {
              const effectiveRuntimeContext = await traceRuntimePhase(
                'moltnet.execution.context.resolve',
                {},
                async () =>
                  resolveEffectiveRuntimeContext({
                    rawTaskContext: (
                      claimed.task.input as { context?: unknown }
                    ).context,
                    runtimeProfileContext: options.runtimeProfileContext,
                  }),
              );
              const injected = await traceRuntimePhase(
                'moltnet.execution.context.inject',
                { 'moltnet.context.ref_count': effectiveRuntimeContext.length },
                () =>
                  injectRuntimeContext({
                    context: effectiveRuntimeContext,
                    fs: managed.vm.fs,
                    guestWorkspace: managed.guestWorkspace,
                  }),
              );
              const assembled = buildTaskUserPrompt(claimed.task, {
                taskId: claimed.task.id,
                diaryId: claimed.task.diaryId ?? '',
                workspace: {
                  mode: workspace.mode,
                  branch: workspace.branch,
                  revision: workspace.revision,
                },
                extras: options.promptExtras,
                effectiveRuntimeContext,
              });
              await record({
                kind: 'info',
                payload: {
                  event: 'prompt_assembled',
                  taskType: assembled.taskType,
                  sections: assembled.trace,
                },
              });
              let prompt = assembled.text;
              if (injected.userInlineSuffix)
                prompt += `\n\n---\n\n${injected.userInlineSuffix}`;
              const env = new GondolinDurableEnv(
                managed.vm,
                managed.vm.id,
                toGuestPath(
                  workspace.mountPath,
                  workspace.cwdPath,
                  managed.guestWorkspace,
                ),
                {
                  lifetime: executionSignal,
                  lifecycle,
                  roots: [managed.guestWorkspace, GUEST_TASK_CONTEXT_MOUNT],
                },
              );
              const runtimeTools = options.runtimeDefinition
                ? await materializePiTools({
                    runtime: options.runtimeDefinition,
                    context: {
                      agent,
                      claimedTask: claimed,
                      reporter,
                      vm: managed.vm,
                      cwdPath: workspace.cwdPath,
                      guestWorkspace: managed.guestWorkspace,
                    },
                    target: 'parent',
                    policy,
                  })
                : [];
              const hostTools = guardGondolinToolDefinitions(
                [
                  ...createAttemptMoltNetTools({
                    agent,
                    claimedTask: claimed,
                    vm: managed.vm,
                    cwdPath: workspace.cwdPath,
                    guestWorkspace: managed.guestWorkspace,
                    lifecycle,
                    capabilityRouter,
                    identity: options.agentIdentity,
                    agentEnv: managed.credentials.agentEnv,
                    hostExecAutoApprove:
                      options.hostExecAutoApprove ??
                      options.sandboxConfig?.hostExec?.autoApprove ??
                      false,
                    onTaskProvenanceEvent: (event, details) =>
                      logger.warn(
                        { event, ...details },
                        'durable.task_provenance',
                      ),
                  }),
                  ...runtimeTools,
                ],
                lifecycle,
              );
              const available = await discoverGuestExecutables(
                managed.vm,
                policy.allowedShellCommands.map((rule) => rule.argvPrefix[0]),
                { signal: executionSignal },
              );
              policy = {
                ...policy,
                allowedShellCommands: policy.allowedShellCommands.filter(
                  (rule) => available.available.includes(rule.argvPrefix[0]),
                ),
              };
              const contributions = options.runtimeDefinition?.extensions ?? [];
              const extensions = contributions.map((contribution) => {
                if (contribution.kind !== 'durable_extension')
                  throw new Error(
                    'Coding-agent session extensions require migration to native Durable extensions',
                  );
                return {
                  ...contribution.extension,
                  tools: filterModelVisibleTools(
                    contribution.extension.tools ?? [],
                    policy,
                  ),
                };
              });
              const tools = filterModelVisibleTools(
                [
                  ...adaptDurableTools(hostTools, {
                    cwd: workspace.cwdPath,
                    model,
                  }),
                  ...createDurableGondolinTools({
                    vm: managed.vm,
                    cwdPath: workspace.cwdPath,
                    guestWorkspace: env.cwd,
                    lifecycle,
                    model,
                  }),
                  ...(options.classifier
                    ? adaptDurableTools(
                        [
                          createClassifierTool(
                            resolveClassifier(models, options.classifier),
                          ),
                        ],
                        { cwd: workspace.cwdPath, model },
                        'safe',
                      )
                    : []),
                ],
                policy,
              );

              const canDelegate =
                taskTypeUsesSubagents(claimed.task.taskType) &&
                filterModelVisibleTools([{ name: 'subagent' }], policy).length >
                  0;
              const sandbox = applyExecutionPlanSandboxOverrides(
                options.sandboxConfig,
                plan,
              );
              const shadow = resolveVfsShadowConfig(sandbox);
              const instructions = [
                composeRuntimeSystemPrompt({
                  profilePromptPrefix: injected.systemPromptPrefix,
                  kernel: buildRuntimeKernel({
                    taskId: claimed.task.id,
                    taskType: claimed.task.taskType,
                    attemptN: claimed.attemptN,
                    diaryId: claimed.task.diaryId ?? '',
                    agentName: options.agentName,
                    guestWorkspace: managed.guestWorkspace,
                    correlationId: claimed.task.correlationId ?? null,
                    toolPolicy: projectRuntimeCapabilities({
                      policy,
                      visibleToolNames: [
                        ...tools.map((tool) => tool.name),
                        ...extensions.flatMap((extension) =>
                          (extension.tools ?? []).map((tool) => tool.name),
                        ),
                        ...(canDelegate ? ['subagent'] : []),
                      ],
                    }).instructorPolicy,
                    sandbox: {
                      workspaceMode: workspace.mode,
                      workspaceRevision: workspace.revision,
                      vfsShadowMode: shadow.mode,
                      vfsShadowPatterns: shadow.patterns,
                      nodeModulesWriteMode: 'tmpfs',
                      verifiedExecutables: available.available,
                      allowedHosts: [
                        ...(sandbox?.network?.allowedHosts ?? []),
                        ...(options.extraAllowedHosts ?? []),
                      ],
                      allowedInternalHosts:
                        sandbox?.network?.allowedInternalHosts ?? [],
                      brokeredSecretEnvNames: (brokeredSecrets ?? []).map(
                        (secret) => secret.guestEnv,
                      ),
                      ...(capabilityRouter && {
                        hostCapabilities: capabilityRouter.manifest,
                      }),
                    },
                  }),
                }),
                formatSkillsForPrompt(injected.skills),
              ]
                .filter(Boolean)
                .join('\n\n');
              return {
                env,
                prompt,
                instructions,
                checkpoint: { marker, token: String(token) },
                tools,
                extensions,
                subagentExtensions: extensions.filter((extension) =>
                  contributions.some(
                    (contribution) =>
                      contribution.id === extension.name &&
                      contribution.scope === 'parent_and_subagents',
                  ),
                ),
                ...(canDelegate
                  ? {
                      subagentTools: tools.filter(
                        (tool) =>
                          !options.runtimeDefinition?.tools.some(
                            (contribution) =>
                              contribution.descriptor.name === tool.name &&
                              contribution.scope === 'parent',
                          ),
                      ),
                    }
                  : {}),
                async authorizeTool(name, arguments_) {
                  lease.check();
                  return authorizeDurableToolCall({
                    policy,
                    analyze: (command) => analyzer.analyze(command),
                    logger,
                    context: {
                      taskId: claimed.task.id,
                      attemptN: claimed.attemptN,
                    },
                    toolName: name,
                    args: arguments_,
                    onDecision: (decision) =>
                      reporter.record({
                        kind: 'tool_policy_decision',
                        payload: { ...decision },
                      }),
                  });
                },
                close,
              };
            } catch (error) {
              // Keep the setup failure; a teardown failure is only logged.
              await close().catch((closeError: unknown) =>
                logger.warn(
                  {
                    error:
                      closeError instanceof Error
                        ? closeError.message
                        : String(closeError),
                  },
                  'durable.environment_close_failed',
                ),
              );
              throw error;
            }
          },
        };
      },
    });
    try {
      return await execute(...args);
    } catch (error) {
      // Keep expected credential failures in the task failure contract. Lease
      // loss and other interruptions still propagate for same-attempt recovery.
      if (!(error instanceof PiBrokeredHttpSecretResolutionError)) throw error;
      return {
        taskId: claimedTask.task.id,
        attemptN: claimedTask.attemptN,
        status: 'failed' as const,
        output: null,
        outputCid: null,
        usage: { inputTokens: 0, outputTokens: 0 },
        durationMs: Date.now() - startedAt,
        error: {
          code: 'credential_resolution_failed',
          message: error.message,
          retryable: error.retryable,
        },
      };
    }
  };
}
