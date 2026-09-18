import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import {
  AgentRuntime,
  ApiTaskReporter,
  ApiTaskSource,
  createLocalSeedSigner,
  resolveRuntimeProfile,
  type TaskExecutor,
} from '@themoltnet/agent-runtime';
import { findMainWorktree } from '@themoltnet/pi-runtime';
import { createNodeSecretProviderRegistry } from '@themoltnet/sdk/node';

import { activatePiCodingAgentDir, loadConfig } from '../config.js';
import { abortActiveAttemptOnSignal } from '../lib/abort-active-attempt.js';
import {
  resolveAgentContext,
  validateStartupBinding,
} from '../lib/agent-context.js';
import { resolveDaemonAgentIdentity } from '../lib/agent-identity.js';
import {
  createGhCliClient,
  makePrBodyAnchorWriter,
} from '../lib/correlation.js';
import { createRuntimeInstanceId } from '../lib/daemon-slot-identity.js';
import { ProducerContextResolutionError } from '../lib/execution-plan-cache.js';
import {
  resolveExecutorSigningPrivateKey,
  validateDaemonScopes,
  validateExecutorSigningIdentity,
} from '../lib/executor-attestation.js';
import { finalizeTask } from '../lib/finalize.js';
import {
  loadRuntimeCredentialConfig,
  observeGovernancePlanSafely,
  resolveCredentialEnforcement,
} from '../lib/governance-plan.js';
import { isHelpFlag, ONCE_HELP } from '../lib/help.js';
import { createRootLogger, logDaemonStartupFailure } from '../lib/logger.js';
import {
  MissingRequiredOptionError,
  parseRuntimeCommandOptions,
  runtimeCommandOptionDefs,
  type RuntimeCommandOptions,
} from '../lib/options.js';
import { initWorkerOtel } from '../lib/otel.js';
import { resolvePiAgentDir } from '../lib/pi-agent-dir.js';
import { prepareRuntimeProfile } from '../lib/prepare-runtime-profile.js';
import { runWithDaemonRuntimeContext } from '../lib/runtime-context.js';
import { runtimeExecutionOffer } from '../lib/runtime-governance.js';
import { createRuntimeProfileRetryTriage } from '../lib/runtime-profile-retry-triage.js';
import { reapRuntimeSlotResources } from '../lib/runtime-resource-reaper.js';
import {
  applyRuntimeSessionUploadFailure,
  createApiRuntimeSessionStore,
  resolveParentRuntimeSession,
  resolveRuntimeSessionKind,
} from '../lib/runtime-sessions.js';
import { createApiRuntimeSlotStore } from '../lib/runtime-slots.js';
import { redactRequiredEnvValues } from '../lib/secret-redaction.js';
import { resolveLatestPiSessionPath } from '../lib/session-files.js';
import { installShutdownSignalHandlers } from '../lib/shutdown-signal.js';
import { createApiSourceAttemptResolver } from '../lib/source-attempts.js';
import { makeTurnEventHandler } from '../lib/turn-event-logger.js';
import { defaultPiDaemonAdapter } from '../pi.js';
import { type DaemonRuntimeAdapter } from '../runtime.js';

export async function runOnce(
  argv: string[],
  runtimeAdapter: DaemonRuntimeAdapter = defaultPiDaemonAdapter,
): Promise<number> {
  if (isHelpFlag(argv)) {
    console.log(ONCE_HELP);
    return 0;
  }

  const { values } = parseArgs({
    args: argv,
    options: {
      ...runtimeCommandOptionDefs(),
      'task-id': { type: 'string', short: 't' },
      team: { type: 'string' },
      sandbox: { type: 'string' },
      profile: { type: 'string' },
    },
  });

  if (!values['task-id']) {
    console.error('Missing required flag: --task-id\n');
    console.error(ONCE_HELP);
    return 1;
  }

  const taskId = values['task-id'];
  if (!values.profile) {
    console.error('Missing required flag: --profile\n');
    console.error(ONCE_HELP);
    return 1;
  }
  let commandOptions: RuntimeCommandOptions;
  try {
    commandOptions = parseRuntimeCommandOptions(values);
  } catch (err) {
    if (err instanceof MissingRequiredOptionError) {
      console.error(`${err.message}\n`);
      console.error(ONCE_HELP);
      return 1;
    }
    throw err;
  }
  const { identity, operations } = commandOptions;
  if (values.sandbox) {
    console.error(
      'Cannot use --sandbox. ' +
        'Remote runtime profiles define sandbox policy.',
    );
    return 1;
  }
  const cfg = loadConfig();
  const credentialSources = {
    profileRequirements: cfg.profileCredentialRequirements,
    bindings: cfg.credentialBindings,
  };
  const runtimeCredentialConfig =
    resolveCredentialEnforcement(
      cfg.credentialEnforcement,
      credentialSources,
    ) === 'off'
      ? null
      : loadRuntimeCredentialConfig(credentialSources);
  // Credential resolution follows --agent-root only when it was actually
  // passed. The old cwd default meant "search the current checkout", which is
  // exactly the repository auto-discovery the central-store cutover removed.
  const explicitAgentRootDir = values['agent-root']
    ? resolve(process.cwd(), values['agent-root'])
    : undefined;
  const { ctx, signingPrivateKey, agentIdentity, hostCapabilitySigner } =
    await (async () => {
      let gate = 'resolve_agent_context';
      try {
        const resolvedContext = await resolveAgentContext(identity.agent, {
          agentRootDir: explicitAgentRootDir,
          credentialSource: cfg.credentialSource,
          envApiUrl: cfg.apiUrl,
          teamId: values.team,
        });
        // Authenticate and validate team binding before resolving signing
        // material, consistently with poll/drain.
        gate = 'authenticate_and_bind';
        const whoami = await validateStartupBinding({
          agent: resolvedContext.agent,
          credentialTeamId: resolvedContext.credentialTeamId,
          teamId: values.team,
          expectedAgent: cfg.expectedAgent,
        });
        gate = 'resolve_signing_material';
        const privateKey = await resolveExecutorSigningPrivateKey({
          credentialSource: cfg.credentialSource,
          agentDir: resolvedContext.agentDir,
          configuredPrivateKey: cfg.signingPrivateKey,
          configuredPrivateKeyRef: cfg.signingPrivateKeyRef,
        });
        gate = 'validate_scopes';
        validateDaemonScopes(whoami);
        gate = 'validate_signing_identity';
        await validateExecutorSigningIdentity({
          whoami,
          signingPrivateKey: privateKey,
        });
        gate = 'resolve_agent_identity';
        const agentIdentity = await resolveDaemonAgentIdentity({
          agentName: identity.agent,
          whoami,
          credentialSource: cfg.credentialSource,
          agentDir: resolvedContext.agentDir,
          gitAuthor: values['git-author'] ?? (cfg.gitAuthor || undefined),
        });
        const hostCapabilitySigner = createLocalSeedSigner({
          privateKeySeed: privateKey,
          agent: resolvedContext.agent,
          identity: agentIdentity,
        });
        return {
          ctx: resolvedContext,
          signingPrivateKey: privateKey,
          agentIdentity,
          hostCapabilitySigner,
        };
      } catch (error) {
        await logDaemonStartupFailure({
          serviceName: 'agent-daemon.once',
          level: cfg.logLevel || (identity.debug ? 'debug' : 'info'),
          gate,
          agent: identity.agent,
          credentialSource: cfg.credentialSource,
          error,
        });
        throw error;
      }
    })();
  // Where daemon state lives and what the sandbox mounts. `sync-sessions`
  // already resolves it this way and states the principle: the cwd default
  // seeds daemon state dirs, not identity discovery. Credential resolution
  // keeps following `explicitAgentRootDir`, so this reintroduces no
  // repository auto-discovery for identities.
  //
  // `ctx.agentRootDir` cannot serve here: when --agent-root is omitted it
  // falls back to the central identity directory, which is outside any
  // repository, and `dedicated_worktree` tasks discover their main worktree
  // from the mount path.
  const daemonRootDir = explicitAgentRootDir ?? process.cwd();
  const profile = await resolveRuntimeProfile({
    agent: ctx.agent,
    profile: values.profile,
    teamId: values.team,
    cwd: daemonRootDir,
  });
  const { logger, shutdown: shutdownLogger } = createRootLogger({
    name: 'agent-daemon.once',
    level: cfg.logLevel || (identity.debug ? 'debug' : 'info'),
  });
  const rootLogger = logger.child({
    mode: 'once',
    agent: identity.agent,
    provider: profile.provider,
    model: profile.model,
    thinkingLevel: profile.thinkingLevel,
    temperature: profile.temperature,
    topP: profile.topP,
    topK: profile.topK,
    maxOutputTokens: profile.maxOutputTokens,
    runtimeProfileId: profile.id,
    runtimeProfileName: profile.name,
  });
  const slotRegistry = createApiRuntimeSlotStore({ agent: ctx.agent });
  const runtimeSessionStore = createApiRuntimeSessionStore({
    agent: ctx.agent,
    logger: {
      warn: (context, message) => rootLogger.warn(context, message),
    },
  });
  const sourceAttemptResolver = createApiSourceAttemptResolver({
    agent: ctx.agent,
  });
  const runtimeInstanceId = createRuntimeInstanceId();
  const prepared = await prepareRuntimeProfile({
    agent: ctx.agent,
    agentName: identity.agent,
    profile,
    prerequisiteEnv: cfg.profilePrerequisiteEnv,
    runtimeAdapter,
    runtimeInstanceId,
    signingPrivateKey,
    slotRegistry,
    runtimeSessionStore,
    sourceAttemptResolver,
    warmRetentionSec: operations.warmRetentionSec,
  });
  const { executionPlans, preparedRuntime, sandbox, slotIdentity, stateDirs } =
    prepared;
  const piAgentDir = await resolvePiAgentDir(cfg, sandbox.rootDir, [profile]);
  process.once('exit', piAgentDir.cleanup);
  activatePiCodingAgentDir(piAgentDir.path, piAgentDir.env);
  const otelShutdown = await initWorkerOtel({
    serviceName: 'moltnet.agent-daemon.once',
    agent: ctx.agent,
    endpoint: cfg.otelEndpoint,
    resourceAttributes: {
      'moltnet.task.id': taskId,
      'moltnet.agent.name': identity.agent,
      'moltnet.credential.source': ctx.credentialSource,
      'moltnet.llm.provider': profile.provider,
      'moltnet.llm.model': profile.model,
      ...(profile.thinkingLevel
        ? { 'moltnet.llm.thinking_level': profile.thinkingLevel }
        : {}),
      ...(profile.temperature !== null
        ? { 'moltnet.llm.temperature': String(profile.temperature) }
        : {}),
      ...(profile.topP !== null
        ? { 'moltnet.llm.top_p': String(profile.topP) }
        : {}),
      ...(profile.topK !== null
        ? { 'moltnet.llm.top_k': String(profile.topK) }
        : {}),
      ...(profile.maxOutputTokens !== null
        ? {
            'moltnet.llm.max_output_tokens': String(profile.maxOutputTokens),
          }
        : {}),
      'moltnet.runtime_profile.id': profile.id,
    },
  });

  rootLogger.info(
    {
      sandbox: sandbox.path,
      taskId,
      heartbeatIntervalMs: operations.heartbeatIntervalMs,
      maxTurns: profile.maxTurns,
      maxBashTimeouts: profile.maxBashTimeouts,
      warmRetentionSec: operations.warmRetentionSec,
      profileId: profile.id,
      piAgentDir: piAgentDir.path,
      piAgentDirSource: piAgentDir.source,
    },
    'agent-daemon.starting',
  );
  try {
    const reaped = await reapRuntimeSlotResources(
      {
        onIssue: (issue) => {
          rootLogger.warn(issue, 'agent-daemon.runtime_resource_reap_issue');
        },
        runtimeSlotStore: slotRegistry,
        taskReader: ctx.agent.tasks,
      },
      {
        agentName: identity.agent,
        mainWorktree: resolveMainWorktree(sandbox.rootDir),
        runtimeInstanceId,
        runtimeProfileId: profile.id,
        sessionRootDir: stateDirs.piSessionsDir,
        scratchRootDir: join(stateDirs.rootDir, 'task-workspaces'),
        teamId: profile.teamId,
      },
    );
    if (
      reaped.removedSessions > 0 ||
      reaped.removedWorkspaces > 0 ||
      reaped.failed > 0 ||
      reaped.unsafePaths > 0 ||
      reaped.truncated
    ) {
      rootLogger.info(reaped, 'agent-daemon.runtime_resources_reaped');
    }
  } catch (err) {
    rootLogger.warn({ err }, 'agent-daemon.runtime_resource_reap_failed');
  }

  // Wire SIGTERM/SIGINT for cooperative shutdown. GitHub-hosted runners
  // send SIGTERM 5 minutes before `timeout-minutes` expires (then
  // SIGKILL on expiry); we use that grace window to abort the *active
  // attempt* server-side (#1382). Attempt abort flips the running attempt
  // to `aborted` and requeues the task for another daemon / retry — it
  // does NOT terminal-cancel the user's task the way `tasks.cancel()`
  // did. Cancellation of the whole task stays an explicit proposer/operator
  // action via `tasks.cancel()`.
  let runtime: AgentRuntime | null = null;
  // The signal handler only has `taskId` in lexical scope; the live attempt
  // number is known only inside the executor. Track it here so `drain` can
  // target the correct attempt. Null when no attempt is in flight.
  let activeAttemptN: number | null = null;
  const signalHandlers = installShutdownSignalHandlers({
    logDrain: (signal) => {
      rootLogger.warn({ signal, taskId }, 'agent-daemon.draining');
    },
    drain: (signal) => {
      runtime?.stop(`agent-daemon received ${signal}`);
      // No attempt in flight (claim loop idle / already settled): nothing
      // to abort, and the server has no running attempt to target.
      // Fire-and-forget: abort reaches the workflow and surfaces back
      // through the reporter's `cancelSignal`, which pi-extension uses
      // to abort the LLM session. We don't await — SIGKILL deadline is
      // 5 min away and the executor needs every second.
      void abortActiveAttemptOnSignal({
        active:
          activeAttemptN === null ? null : { taskId, attemptN: activeAttemptN },
        signal,
        abortAttempt: (activeTaskId, attemptN, body) =>
          ctx.agent.tasks.abortAttempt(activeTaskId, attemptN, body),
        logFailure: (err, current) => {
          // Abort-on-already-terminal returns a 4xx; ignore. Other
          // errors are visible in the daemon log but shouldn't block
          // SIGKILL — the server's lease check is the backstop.
          try {
            rootLogger.warn(
              {
                err: err instanceof Error ? err.message : String(err),
                taskId: current.taskId,
                attemptN: current.attemptN,
              },
              'agent-daemon.abort_on_signal_failed',
            );
          } catch (logErr) {
            process.stderr.write(
              `[agent-daemon] failed to log abort error: ` +
                (logErr instanceof Error ? logErr.message : String(logErr)) +
                '\n',
            );
          }
        },
      });
    },
  });

  try {
    const rawExecuteTask = preparedRuntime.createTaskExecutor({
      agentName: identity.agent,
      moltnetAgent: ctx.agent,
      agentIdentity,
      hostCapabilitySigner,
      hostCapabilityLogger: rootLogger,
      agentRootDir: ctx.agentRootDir,
      mountPath: sandbox.rootDir,
      provider: profile.provider,
      model: profile.model,
      thinkingLevel: profile.thinkingLevel,
      temperature: profile.temperature,
      topP: profile.topP,
      topK: profile.topK,
      maxOutputTokens: profile.maxOutputTokens,
      sandboxConfig: sandbox.config,
      forwardEnv: profile.requiredEnv,
      onVmDiagnostic: (diagnostic) => {
        const fields = {
          event: diagnostic.event,
          ...(diagnostic.brokeredSecretCount !== undefined && {
            brokeredSecretCount: diagnostic.brokeredSecretCount,
          }),
        };
        if (diagnostic.level === 'warning') {
          rootLogger.warn(fields, diagnostic.message);
        } else {
          rootLogger.info(fields, diagnostic.message);
        }
      },
      runtimeProfileContext: profile.context,
      runtimeProfileId: profile.id,
      toolEnforcement: profile.toolEnforcement,
      makeExecutionPlan: (claimedTask) =>
        executionPlans.getOrCreate(claimedTask),
      onTurnEvent: makeTurnEventHandler(rootLogger, { taskId }),
      toolPolicyLogger: rootLogger,
      maxTurns: profile.maxTurns,
      maxBashTimeouts: profile.maxBashTimeouts,
    });
    const executeTask: TaskExecutor = async (claimedTask, reporter) => {
      if (runtimeCredentialConfig) {
        await observeGovernancePlanSafely({
          config: runtimeCredentialConfig,
          profile,
          offer: runtimeExecutionOffer(
            preparedRuntime,
            preparedRuntime.attestor.fingerprint,
          ),
          registry: createNodeSecretProviderRegistry(),
          executorFingerprint: preparedRuntime.attestor.fingerprint,
          claimAuthority: claimedTask.claimAuthority ?? {},
          taskId: claimedTask.task.id,
          attemptN: claimedTask.attemptN,
          logger: rootLogger,
        });
      }
      let executionPlan: Awaited<ReturnType<typeof executionPlans.getOrCreate>>;
      try {
        executionPlan = await executionPlans.getOrCreate(claimedTask);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        rootLogger.warn(
          {
            taskId: claimedTask.task.id,
            attemptN: claimedTask.attemptN,
            err: message,
          },
          'agent-daemon.execution_plan_failed',
        );
        return {
          taskId: claimedTask.task.id,
          attemptN: claimedTask.attemptN,
          status: 'failed',
          output: null,
          outputCid: null,
          usage: { inputTokens: 0, outputTokens: 0 },
          durationMs: 0,
          error: {
            code:
              err instanceof ProducerContextResolutionError
                ? 'producer_context_missing'
                : 'execution_plan_failed',
            message,
            retryable: false,
          },
        };
      }
      if (executionPlan.slotKey && executionPlan.sessionPersistence) {
        await slotRegistry.beginSlot({
          ...slotIdentity,
          runtimeProfileId: profile.id,
          provider: profile.provider,
          model: profile.model,
          teamId: claimedTask.task.teamId,
          slotKey: executionPlan.slotKey,
          taskType: claimedTask.task.taskType,
          sessionDir: executionPlan.sessionPersistence.sessionDir,
          sessionPath: resolveLatestPiSessionPath(
            executionPlan.sessionPersistence.sessionDir,
          ),
          workspaceId: executionPlan.workspaceId,
          worktreePath: resolveRecordedWorkspacePath(
            stateDirs.rootDir,
            sandbox.rootDir,
            executionPlan,
          ),
          worktreeBranch: executionPlan.worktreeBranch,
          workspaceKind: executionPlan.workspaceKind,
          lastTaskId: claimedTask.task.id,
          lastAttemptN: claimedTask.attemptN,
          warmRetentionSec: operations.warmRetentionSec,
        });
      }
      // Publish the live attempt number so a SIGINT/SIGTERM `drain` can
      // abort exactly this attempt (#1382). Cleared in the finally so a
      // signal arriving after the executor returns finds no live attempt.
      activeAttemptN = claimedTask.attemptN;
      try {
        return await runWithDaemonRuntimeContext(
          {
            profileId: profile.id,
            profileName: profile.name,
            provider: profile.provider,
            model: profile.model,
            thinkingLevel: profile.thinkingLevel,
            temperature: profile.temperature,
            topP: profile.topP,
            topK: profile.topK,
            maxOutputTokens: profile.maxOutputTokens,
          },
          () => rawExecuteTask(claimedTask, reporter),
        );
      } finally {
        activeAttemptN = null;
        executionPlans.delete(claimedTask);
        if (executionPlan.slotKey) {
          await slotRegistry.finishSlot(
            claimedTask.task.teamId,
            claimedTask.task.id,
            claimedTask.attemptN,
            slotIdentity,
            executionPlan.slotKey,
            profile.provider,
            profile.model,
            executionPlan.sessionPersistence
              ? resolveLatestPiSessionPath(
                  executionPlan.sessionPersistence.sessionDir,
                )
              : null,
            operations.warmRetentionSec,
          );
        }
      }
    };

    const writeCorrelationAnchors = makePrBodyAnchorWriter({
      gh: createGhCliClient(),
      logger: rootLogger,
    });

    runtime = new AgentRuntime({
      logger: rootLogger,
      source: new ApiTaskSource({
        agent: ctx.agent,
        taskId,
        teamId: profile.teamId,
        profileId: profile.id,
        executorFingerprint: preparedRuntime.attestor.fingerprint,
      }),
      makeReporter: () =>
        new ApiTaskReporter({
          tasks: ctx.agent.tasks,
          teamId: profile.teamId,
          heartbeatIntervalMs: operations.heartbeatIntervalMs,
          logger: rootLogger,
        }),
      // Finalize inside the runtime loop so the correlation anchor writer
      // sees the claimedTask alongside its output. once mode only ever
      // claims one task, so this fires exactly once.
      onTaskFinished: async (output, claimedTask) => {
        // Look up the slot record at finalize time. `executeTask`'s
        // finally block has already called `finishSlot` which updates
        // `expires_at_ms` to the post-completion idle TTL — that's
        // exactly the `slotResumableUntil` window we want stamped on
        // the attempt row.
        const resolved = await slotRegistry.findLatestSlotByTaskAttempt(
          claimedTask.task.teamId,
          claimedTask.task.id,
          claimedTask.attemptN,
        );
        let terminalOutput = redactRequiredEnvValues(
          output,
          profile.requiredEnv,
          cfg.profilePrerequisiteEnv,
        );
        if (resolved?.session?.sessionDir) {
          try {
            const parentSession = await resolveParentRuntimeSession(
              runtimeSessionStore,
              claimedTask,
            );
            await runtimeSessionStore.uploadAttemptFinal({
              attemptN: claimedTask.attemptN,
              parentSessionId: parentSession?.id ?? null,
              sessionDir: resolved.session.sessionDir,
              sessionKind: resolveRuntimeSessionKind(claimedTask),
              sourceRuntimeProfileId: resolved.slot.runtimeProfileId,
              sourceSlotId: resolved.slot.id,
              taskId: claimedTask.task.id,
              teamId: claimedTask.task.teamId,
            });
          } catch (err) {
            rootLogger.error(
              {
                err,
                taskId: claimedTask.task.id,
                attemptN: claimedTask.attemptN,
              },
              'agent-daemon.runtime_session_upload_failed',
            );
            terminalOutput = applyRuntimeSessionUploadFailure(
              terminalOutput,
              err,
            );
          }
        }
        return finalizeTask(ctx.agent, terminalOutput, {
          task: claimedTask.task,
          slot: resolved ? { expiresAtMs: resolved.slot.expiresAtMs } : null,
          retryTriage: createRuntimeProfileRetryTriage({
            runtimeProfile: profile,
            piAgentDir: piAgentDir.path,
            cwd: ctx.agentRootDir,
          }),
          providerFailureContext: {
            provider: profile.provider,
            model: profile.model,
            runtimeProfileId: profile.id,
            runtimeProfileName: profile.name,
            runtimeProfileRevision:
              claimedTask.claimAuthority?.runtimeProfileRevision ?? null,
            piAgentDirSource: piAgentDir.source,
          },
          executorAttestor: preparedRuntime.attestor,
          writeCorrelationAnchors,
          log: (msg, fields) => rootLogger.warn(fields ?? {}, msg),
        });
      },
      executeTask,
    });

    const outputs = await runtime.start();
    const [output] = outputs;
    if (!output) {
      rootLogger.error({}, 'agent-daemon.no_output');
      return 1;
    }
    console.log('\n[done] TaskOutput:');
    console.log(JSON.stringify(output, null, 2));
    return output.status === 'completed' ? 0 : 1;
  } finally {
    signalHandlers.dispose();
    await slotRegistry.close();
    await otelShutdown();
    await shutdownLogger();
  }
}

function resolveRecordedWorkspacePath(
  stateRootDir: string,
  mountPath: string,
  executionPlan: {
    workspaceId: string | null;
    workspaceMode: 'shared_mount' | 'dedicated_worktree' | 'scratch_mount';
  },
): string | null {
  if (!executionPlan.workspaceId) return null;
  return executionPlan.workspaceMode === 'scratch_mount'
    ? join(stateRootDir, 'task-workspaces', executionPlan.workspaceId)
    : join(
        findMainWorktree(mountPath),
        '.worktrees',
        executionPlan.workspaceId,
      );
}

function resolveMainWorktree(mountPath: string): string | null {
  try {
    return findMainWorktree(mountPath);
  } catch {
    return null;
  }
}
