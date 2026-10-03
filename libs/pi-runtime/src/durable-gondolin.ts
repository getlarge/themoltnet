import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BACKGROUND_CONTEXT,
  withAbortSignal,
} from '@earendil-works/chord/context';
import {
  formatSkillsForPrompt,
  ModelRuntime,
} from '@earendil-works/pi-coding-agent';
import { CodingTools } from '@earendil-works/pi-durable/tools';
import {
  buildTaskUserPrompt,
  TaskExecutionInterrupted,
} from '@themoltnet/agent-runtime';
import { ShellCommandAnalyzer } from '@themoltnet/shell-command-analyzer';

import { resolvePiCodingAgentDir } from './config.js';
import { createDurableTaskExecutor } from './durable-executor.js';
import { GondolinDurableEnv } from './durable-gondolin-env.js';
import { ApiDurableStorage } from './durable-storage.js';
import { acquireDurableTransport } from './durable-transport.js';
import type { ExecutePiTaskOptions } from './runtime/execute-pi-task.js';
import {
  injectRuntimeContext,
  resolveEffectiveRuntimeContext,
} from './runtime/runtime-context.js';
import { prepareTaskWorkspace } from './runtime/task-workspace.js';
import type { ResolvedGondolinTemplate } from './runtime-definition.js';
import { toGuestPath } from './tool-operations.js';
import { decideToolCall } from './tool-policy/gate.js';
import { resolveSessionToolPolicy } from './tool-policy/session-policy.js';
import { resumeVm } from './vm.js';

/** Pilot: mounted workspaces must remain available independently of the daemon. */
export function createGondolinDurableTaskExecutor(
  options: ExecutePiTaskOptions & {
    template: ResolvedGondolinTemplate;
    runtimeKind: string;
  },
) {
  return async (
    ...args: Parameters<ReturnType<typeof createDurableTaskExecutor>>
  ) => {
    for (const name of [
      'temperature',
      'topP',
      'topK',
      'maxOutputTokens',
    ] as const) {
      if (options[name] !== null && options[name] !== undefined)
        throw new Error(
          `Pi Durable 1.0 does not expose ${name}; use provider defaults for this pilot profile`,
        );
    }
    const agent = options.moltnetAgent;
    if (!agent || !options.runtimeProfileId)
      throw new Error(
        'Durable runtime requires an authenticated Agent and runtime profile',
      );
    const piDir = resolvePiCodingAgentDir();
    const models = await ModelRuntime.create({
      authPath: join(piDir, 'auth.json'),
      modelsPath: join(piDir, 'models.json'),
    });
    if (!models.getModel(options.provider, options.model))
      throw new Error('Selected chat model is not registered');
    const logger = options.toolPolicyLogger ?? {
      debug: () => {},
      info: (obj: Record<string, unknown>, message: string) =>
        console.error(JSON.stringify({ level: 'info', message, ...obj })),
      warn: (obj: Record<string, unknown>, message: string) =>
        console.error(JSON.stringify({ level: 'warn', message, ...obj })),
    };
    const execute = createDurableTaskExecutor({
      models,
      model: { provider: options.provider, modelId: options.model },
      maxTurns: options.maxTurns,
      maxSubmitReminders: options.maxSubmitMissingReprompts,
      agent: { thinkingLevel: options.thinkingLevel ?? undefined },
      async open(claimed, signal) {
        const lease = await acquireDurableTransport({
          stores: agent.runtimeStores,
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
        return {
          storage,
          signal: lease.signal,
          check: () => lease.check(),
          async prepare(previousEnvironment) {
            const policy = await resolveSessionToolPolicy({
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
            const managed = await (options.resumeVm ?? resumeVm)({
              checkpointPath: options.template.checkpointPath,
              agentName: options.agentName,
              agentRootDir: options.agentRootDir,
              mountPath: workspace.mountPath,
              workspaceMode: workspace.mode,
              sandboxConfig: {
                ...options.sandboxConfig,
                snapshot: undefined,
                resumeCommands: [...options.template.resumeCommands],
                ...(plan?.workspaceAttachment?.shadowWrites
                  ? {
                      vfs: {
                        ...options.sandboxConfig?.vfs,
                        shadow: ['**'],
                        shadowMode: plan.workspaceAttachment.shadowWrites,
                      },
                    }
                  : {}),
              },
              forwardEnv: options.forwardEnv,
              extraAllowedHosts: options.extraAllowedHosts,
              onDiagnostic: options.onVmDiagnostic,
              signal: lease.signal,
            });
            let prompt: string;
            let instructions: string;
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
              prompt = buildTaskUserPrompt(claimed.task, {
                taskId: claimed.task.id,
                diaryId: claimed.task.diaryId ?? '',
                workspace: {
                  mode: workspace.mode,
                  branch: workspace.branch,
                  revision: workspace.revision,
                },
                extras: options.promptExtras,
                effectiveRuntimeContext,
              }).text;
              if (injected.userInlineSuffix)
                prompt += `\n\n${injected.userInlineSuffix}`;
              instructions = [
                injected.systemPromptPrefix,
                formatSkillsForPrompt(injected.skills),
              ]
                .filter(Boolean)
                .join('\n\n');
            } catch (error) {
              try {
                await managed.services.stop();
              } finally {
                await managed.vm.close();
              }
              throw error;
            }
            const env = new GondolinDurableEnv(
              managed.vm,
              managed.vm.id,
              toGuestPath(
                workspace.mountPath,
                workspace.cwdPath,
                managed.guestWorkspace,
              ),
              lease.signal,
            );
            return {
              env,
              prompt,
              instructions,
              checkpoint: { marker, token: String(token) },
              tools: CodingTools.tools,
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
              async close() {
                try {
                  await managed.services.stop();
                } finally {
                  await managed.vm.close();
                }
              },
            };
          },
        };
      },
    });
    return execute(...args);
  };
}
