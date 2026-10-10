import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BACKGROUND_CONTEXT,
  withAbortSignal,
} from '@earendil-works/chord/context';
import { formatSkillsForPrompt } from '@earendil-works/pi-coding-agent';
import {
  buildTaskUserPrompt,
  TaskExecutionInterrupted,
  taskTypeUsesSubagents,
} from '@themoltnet/agent-runtime';
import { resolveVfsShadowConfig } from '@themoltnet/sandbox-gondolin';
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
} from './runtime-definition.js';
import {
  createGondolinToolLifecycle,
  guardGondolinToolDefinitions,
  toGuestPath,
} from './tool-operations.js';
import { decideToolCall } from './tool-policy/gate.js';
import { resolveSessionToolPolicy } from './tool-policy/session-policy.js';
import { resumeVm } from './vm.js';

/** Mounted workspaces remain available independently of the daemon process. */
export function createGondolinDurableTaskExecutor(
  options: GondolinDurableTaskOptions,
) {
  return async (
    ...args: Parameters<ReturnType<typeof createDurableTaskExecutor>>
  ) => {
    if (args[0].task.taskType === 'classify')
      return executeProfileClassificationTask(options.classifier, ...args);
    const template = options.template;
    if (!template)
      throw new Error('Generation task requires a Gondolin template');
    const agent = options.moltnetAgent;
    if (!agent || !options.runtimeProfileId)
      throw new Error(
        'Durable runtime requires an authenticated Agent and runtime profile',
      );
    const piDir = resolvePiCodingAgentDir();
    const models = await createRuntimeModels(piDir);
    const model = models.getModel(options.provider, options.model);
    if (!model) throw new Error('Selected chat model is not registered');
    const logger = options.toolPolicyLogger ?? {
      debug: () => {},
      info: (obj: Record<string, unknown>, message: string) =>
        console.error(JSON.stringify({ level: 'info', message, ...obj })),
      warn: (obj: Record<string, unknown>, message: string) =>
        console.error(JSON.stringify({ level: 'warn', message, ...obj })),
    };
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
              agent,
              profileId: options.runtimeProfileId!,
              teamId: claimed.task.teamId,
              runtimeKind: options.runtimeKind,
              enforcement: options.toolEnforcement ?? 'enforce',
              logger,
            });
            if (policy.degraded)
              throw new Error(
                'Durable runtime requires a resolved tool policy',
              );
            const analyzer = await ShellCommandAnalyzer.create();
            const plan = (await options.makeExecutionPlan?.(claimed)) ?? null;
            // Session ownership retains workspaces through a process interruption.
            const retainedPlan = plan
              ? {
                  ...plan,
                  workspaceScope: 'session' as const,
                  sessionKey:
                    plan.sessionKey ?? `${claimed.task.id}/${claimed.attemptN}`,
                }
              : null;
            if (previousEnvironment) {
              const marker = previousEnvironment.marker;
              const token = previousEnvironment.token;
              if (
                typeof marker !== 'string' ||
                typeof token !== 'string' ||
                !existsSync(marker) ||
                readFileSync(marker, 'utf8') !== token
              ) {
                throw new TaskExecutionInterrupted(
                  'Durable workspace is unavailable; restore its persistent volume before resuming',
                );
              }
            }
            const workspace = prepareTaskWorkspace(
              claimed.task,
              options.mountPath ?? process.cwd(),
              retainedPlan,
            );
            await args[1].record({
              kind: 'info',
              payload: {
                event: 'execute_start',
                provider: options.provider,
                model: options.model,
                workspaceMode: workspace.mode,
                workspaceBranch: workspace.branch,
                workspaceRevision: workspace.revision,
              },
            });
            const markerDir = join(
              workspace.cwdPath,
              '.moltnet',
              'durable-workspaces',
            );
            const marker = join(
              markerDir,
              `${claimed.task.id}-${claimed.attemptN}`,
            );
            if (!previousEnvironment) mkdirSync(markerDir, { recursive: true });
            const token = previousEnvironment?.token ?? randomUUID();
            if (!previousEnvironment)
              writeFileSync(marker, String(token), { flag: 'w', mode: 0o600 });
            if (previousEnvironment && marker !== previousEnvironment.marker)
              throw new TaskExecutionInterrupted(
                'Durable workspace path changed',
              );
            const brokeredSecrets = await resolveAttemptBrokeredHttpSecrets({
              runtimeDefinition: options.runtimeDefinition,
              agentName: options.agentName,
              claimedTask: claimed,
              cwdPath: workspace.cwdPath,
              signal: executionSignal,
            });
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
            const managed = await (options.resumeVm ?? resumeVm)({
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
            }).catch((error: unknown) => {
              capabilityLifetime.abort(error);
              throw error;
            });
            const close = async () => {
              capabilityLifetime.abort(new Error('Durable environment closed'));
              try {
                for (const binding of brokeredSecrets ?? []) {
                  if (binding.value)
                    managed.secretManager.revokeSecret(binding.guestEnv);
                }
              } finally {
                try {
                  await managed.services.stop();
                } finally {
                  await managed.vm.close();
                }
              }
            };
            try {
              const effectiveRuntimeContext = resolveEffectiveRuntimeContext({
                rawTaskContext: (claimed.task.input as { context?: unknown })
                  .context,
                runtimeProfileContext: options.runtimeProfileContext,
              });
              const injected = await injectRuntimeContext({
                context: effectiveRuntimeContext,
                fs: managed.vm.fs,
                guestWorkspace: managed.guestWorkspace,
              });
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
              await args[1].record({
                kind: 'info',
                payload: {
                  event: 'prompt_assembled',
                  taskType: assembled.taskType,
                  sections: assembled.trace,
                },
              });
              let prompt = assembled.text;
              if (injected.userInlineSuffix)
                prompt += `\n\n${injected.userInlineSuffix}`;
              const env = new GondolinDurableEnv(
                managed.vm,
                managed.vm.id,
                toGuestPath(
                  workspace.mountPath,
                  workspace.cwdPath,
                  managed.guestWorkspace,
                ),
                executionSignal,
                lifecycle,
              );
              const runtimeTools = options.runtimeDefinition
                ? await materializePiTools({
                    runtime: options.runtimeDefinition,
                    context: {
                      agent,
                      claimedTask: claimed,
                      reporter: args[1],
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
                  const decision = decideToolCall({
                    ...policy,
                    toolName: name,
                    command:
                      typeof arguments_.command === 'string'
                        ? arguments_.command
                        : undefined,
                    analyze: (command) => analyzer.analyze(command),
                  });
                  logger.info(
                    {
                      tool: name,
                      reasonCode: decision.reasonCode,
                      taskId: claimed.task.id,
                      attemptN: claimed.attemptN,
                    },
                    'durable.tool_policy',
                  );
                  return 'allow' in decision && !decision.allow
                    ? decision.reason
                    : undefined;
                },
                close,
              };
            } catch (error) {
              await close();
              throw error;
            }
          },
        };
      },
    });
    return execute(...args);
  };
}
