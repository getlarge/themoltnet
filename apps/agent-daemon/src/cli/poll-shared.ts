// Shared poll-loop runner for `poll` and `drain` (only difference: stopWhenEmpty).
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import type { TaskOutput } from '@moltnet/tasks';
import {
  AgentRuntime,
  ApiTaskReporter,
  type ClaimedTask,
  createLocalSeedSigner,
  resolveRuntimeProfiles,
} from '@themoltnet/agent-runtime';
import {
  findMainWorktree,
  GuestEnvironmentBoundaryError,
} from '@themoltnet/pi-runtime';
import { createNodeSecretProviderRegistry } from '@themoltnet/sdk/node';

import { activatePiCodingAgentDir, loadConfig } from '../config.js';
import { abortActiveAttemptOnSignal } from '../lib/abort-active-attempt.js';
import {
  resolveAgentContext,
  resolveSelectionApiUrl,
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
import { isHelpFlag } from '../lib/help.js';
import { createRootLogger, logDaemonStartupFailure } from '../lib/logger.js';
import {
  MissingRequiredOptionError,
  parseRuntimeCommandOptions,
  runtimeCommandOptionDefs,
  type RuntimeCommandOptions,
  validateTaskTypes,
} from '../lib/options.js';
import { initWorkerOtel } from '../lib/otel.js';
import { resolvePiAgentDir } from '../lib/pi-agent-dir.js';
import {
  type PreparedRuntimeProfile,
  prepareRuntimeProfile,
} from '../lib/prepare-runtime-profile.js';
import { createProjectPollingSource } from '../lib/project-task-source.js';
import {
  applyProjectWorkspacePolicy,
  projectRunOptionDefs,
  resolveRunProjectSelection,
} from '../lib/run-project-selection.js';
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
import { WorkspaceModeMismatchError } from '../lib/task-execution-plan.js';
import { makeTurnEventHandlerFactory } from '../lib/turn-event-logger.js';
import { defaultPiDaemonAdapter } from '../pi.js';
import type { DaemonRuntimeAdapter } from '../runtime.js';

export interface PollSharedArgs {
  argv: string[];
  serviceName: string;
  stopWhenEmpty: boolean;
  modeLabel: string;
  helpText: string;
  runtimeAdapter?: DaemonRuntimeAdapter;
}

export async function runPolling(opts: PollSharedArgs): Promise<number> {
  if (isHelpFlag(opts.argv)) {
    console.log(opts.helpText);
    return 0;
  }

  const { values } = parseArgs({
    args: opts.argv,
    options: {
      ...runtimeCommandOptionDefs(),
      ...projectRunOptionDefs(),
      team: { type: 'string' },
      'task-types': { type: 'string' },
      'correlation-id': { type: 'string' },
      'diary-ids': { type: 'string' },
      'wait-for-first-task-sec': { type: 'string' },
      'wait-after-task-sec': { type: 'string' },
      'poll-interval-ms': { type: 'string' },
      'max-poll-interval-ms': { type: 'string' },
      'list-limit': { type: 'string' },
      sandbox: { type: 'string' },
      profile: { type: 'string', multiple: true },
    },
  });

  if (
    !values.team &&
    !values.binding &&
    !values.project &&
    !values['config-file']
  ) {
    console.error('Missing required flag: --team\n');
    console.error(opts.helpText);
    return 1;
  }

  let teamId = values.team ?? '';
  const profileValues = parseProfileValues(values.profile);
  if (profileValues.length === 0) {
    console.error('Missing required flag: --profile\n');
    console.error(opts.helpText);
    return 1;
  }
  let taskTypes: string[];
  try {
    taskTypes = validateTaskTypes(parseCsv(values['task-types']));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    return 1;
  }
  const diaryIds = parseCsv(values['diary-ids']);
  let commandOptions: RuntimeCommandOptions;
  try {
    commandOptions = parseRuntimeCommandOptions(values);
  } catch (err) {
    if (err instanceof MissingRequiredOptionError) {
      console.error(`${err.message}\n`);
      console.error(opts.helpText);
      return 1;
    }
    throw err;
  }
  const { identity, operations } = commandOptions;
  const pollIntervalMs = optionalPositiveInt(
    values['poll-interval-ms'],
    'poll-interval-ms',
    2_000,
  );
  const maxPollIntervalMs = optionalPositiveInt(
    values['max-poll-interval-ms'],
    'max-poll-interval-ms',
    30_000,
  );
  const listLimit = optionalPositiveInt(values['list-limit'], 'list-limit', 10);
  const waitForFirstTaskSec = optionalNonNegativeInt(
    values['wait-for-first-task-sec'],
    'wait-for-first-task-sec',
    0,
  );
  const waitAfterTaskSec = optionalNonNegativeInt(
    values['wait-after-task-sec'],
    'wait-after-task-sec',
    0,
  );
  if (
    !opts.stopWhenEmpty &&
    (waitForFirstTaskSec > 0 || waitAfterTaskSec > 0)
  ) {
    console.error(
      `[${opts.modeLabel}] --wait-for-first-task-sec and ` +
        '--wait-after-task-sec are only valid with drain.',
    );
    return 1;
  }

  if (values.sandbox) {
    console.error(
      `[${opts.modeLabel}] Cannot use --sandbox. ` +
        'Remote runtime profiles define sandbox policy.',
    );
    return 1;
  }

  if (taskTypes.length === 0) {
    console.error(
      `[${opts.modeLabel}] --task-types is empty — daemon will accept any registered type. ` +
        'Pass an explicit list to limit scope (e.g. --task-types fulfill_brief).',
    );
  }

  const cfg = loadConfig();
  let selection: Awaited<ReturnType<typeof resolveRunProjectSelection>>;
  try {
    const endpoint = await resolveSelectionApiUrl(identity.agent, {
      agentRootDir: values['agent-root']
        ? resolve(process.cwd(), values['agent-root'])
        : undefined,
      credentialSource: cfg.credentialSource,
      envApiUrl: cfg.apiUrl,
    });
    selection = await resolveRunProjectSelection({
      agent: identity.agent,
      cwd: process.cwd(),
      apiUrl: endpoint,
      binding: values.binding,
      project: values.project,
      team: values.team,
      general: values.general,
      'config-file': values['config-file'],
      'state-dir': values['state-dir'],
      source: values.source,
      'workspace-strategy': values['workspace-strategy'],
    });
    teamId = selection.teamId ?? '';
    if (!teamId) throw new Error('Select --team or a binding with a team');
  } catch (error) {
    await logDaemonStartupFailure({
      serviceName: 'agent-daemon.selection',
      level: cfg.logLevel || 'info',
      gate: 'project_selection',
      agent: identity.agent,
      credentialSource: cfg.credentialSource,
      error,
    });
    console.error(error instanceof Error ? error.message : String(error));
    console.error(opts.helpText);
    return 1;
  }
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
  const {
    ctx,
    signingPrivateKey,
    startupWhoami,
    agentIdentity,
    hostCapabilitySigner,
  } = await (async () => {
    let gate = 'resolve_agent_context';
    try {
      const resolvedContext = await resolveAgentContext(identity.agent, {
        agentRootDir: explicitAgentRootDir,
        credentialSource: cfg.credentialSource,
        envApiUrl: cfg.apiUrl,
        projectApiUrl: selection.binding?.apiUrl,
        teamId: teamId,
      });
      // Fail fast, before polling, on a rejected or wrong-team credential.
      gate = 'authenticate_and_bind';
      const whoami = await validateStartupBinding({
        agent: resolvedContext.agent,
        credentialTeamId: resolvedContext.credentialTeamId,
        teamId,
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
        startupWhoami: whoami,
        agentIdentity,
        hostCapabilitySigner,
      };
    } catch (error) {
      await logDaemonStartupFailure({
        serviceName: `agent-daemon.${opts.modeLabel}`,
        level: cfg.logLevel || (identity.debug ? 'debug' : 'info'),
        gate,
        agent: identity.agent,
        credentialSource: cfg.credentialSource,
        error,
      });
      throw error;
    }
  })();
  // A central identity directory is never a workspace. Preserve explicit bundle
  // roots for existing callers unless a location or source override was selected.
  const daemonRootDir =
    selection.binding || values.source
      ? (selection.source ?? process.cwd())
      : (explicitAgentRootDir ?? process.cwd());
  const resolvedProfiles = (
    await resolveRuntimeProfiles({
      agent: ctx.agent,
      profiles: profileValues,
      teamId,
      cwd: daemonRootDir,
    })
  ).map((profile) => applyProjectWorkspacePolicy(profile, selection));
  const { logger, shutdown: shutdownLogger } = createRootLogger({
    name: `agent-daemon.${opts.modeLabel}`,
    level: cfg.logLevel || (identity.debug ? 'debug' : 'info'),
  });
  const rootLogger = logger.child({
    projectId: selection.projectId,
    binding: selection.binding?.name,
    selectedBy: selection.selectedBy,
    source: daemonRootDir,
    strategy: selection.strategy,
    stateRootDir: selection.stateRootDir ?? daemonRootDir,
    apiUrl: selection.apiUrl,
    mode: opts.modeLabel,
    agent: identity.agent,
    teamId,
    runtimeProfileIds: resolvedProfiles.map((profile) => profile.id),
    runtimeProfileNames: resolvedProfiles.map((profile) => profile.name),
  });
  const runtimeAdapter = opts.runtimeAdapter ?? defaultPiDaemonAdapter;
  const profiles: typeof resolvedProfiles = [];
  const runtimes = new Map<string, PreparedRuntimeProfile>();
  const skippedProfileBoundaries: Array<{
    profile: (typeof resolvedProfiles)[number];
    error: GuestEnvironmentBoundaryError;
  }> = [];
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
  for (const profile of resolvedProfiles) {
    try {
      const prepared = await prepareRuntimeProfile({
        agent: ctx.agent,
        agentName: identity.agent,
        profile,
        stateRootDir: selection.stateRootDir,
        workspaceExplicit: selection.workspaceExplicit,
        prerequisiteEnv: cfg.profilePrerequisiteEnv,
        runtimeAdapter,
        runtimeInstanceId,
        signingPrivateKey,
        slotRegistry,
        runtimeSessionStore,
        sourceAttemptResolver,
        warmRetentionSec: operations.warmRetentionSec,
      });
      runtimes.set(profile.id, prepared);
      profiles.push(profile);
    } catch (error) {
      if (!(error instanceof GuestEnvironmentBoundaryError)) throw error;
      skippedProfileBoundaries.push({ profile, error });
    }
  }
  if (profiles.length === 0) {
    const details = skippedProfileBoundaries
      .map(({ profile, error }) => `${profile.name}: ${error.message}`)
      .join('; ');
    throw new Error(`No safe runtime profiles remain. ${details}`);
  }
  // PI_CODING_AGENT_DIR is process-wide, so every profile shares one Pi dir.
  const piAgentDir = await resolvePiAgentDir(
    cfg,
    profiles[0].mountPath,
    profiles,
  );
  process.once('exit', piAgentDir.cleanup);
  activatePiCodingAgentDir(piAgentDir.path, piAgentDir.env);
  if (!runtimes.has(profiles[0].id)) {
    throw new Error('No runtime profiles resolved');
  }
  const otelShutdown = await initWorkerOtel({
    serviceName: opts.serviceName,
    agent: ctx.agent,
    endpoint: cfg.otelEndpoint,
    resourceAttributes: {
      'moltnet.project.id': selection.projectId ?? 'general',
      'moltnet.project.selection': selection.selectedBy,
      'moltnet.workspace.strategy': selection.strategy,
      'moltnet.team.id': teamId,
      'moltnet.agent.name': identity.agent,
      'moltnet.credential.source': ctx.credentialSource,
      'moltnet.runtime_profile.count': String(profiles.length),
      'moltnet.runtime_profile.ids': profiles.map((p) => p.id).join(','),
    },
  });

  for (const { profile, error } of skippedProfileBoundaries) {
    rootLogger.warn(
      {
        runtimeProfileId: profile.id,
        runtimeProfileName: profile.name,
        refusedEnvironmentNames: error.refusedNames,
      },
      'agent-daemon.runtime_profile_skipped_credential_boundary',
    );
  }

  const abort = new AbortController();
  let runtime: AgentRuntime | null = null;
  // Track the in-flight task+attempt so a SIGINT/SIGTERM `drain` can abort
  // exactly the running attempt server-side (#1382) instead of leaving it
  // to lease-expire. Poll mode runs one task at a time through the runtime
  // loop, so a single ref pair is sufficient. Null when the loop is idle.
  let active: { taskId: string; attemptN: number } | null = null;
  const signalHandlers = installShutdownSignalHandlers({
    logDrain: (signal) => {
      rootLogger.warn({ signal }, 'agent-daemon.draining');
    },
    drain: (signal) => {
      abort.abort();
      runtime?.stop(`agent-daemon received ${signal}`);
      // Abort the active attempt rather than letting it lease-expire. The
      // task requeues for another daemon / retry; it is NOT cancelled.
      void abortActiveAttemptOnSignal({
        active,
        signal,
        abortAttempt: (taskId, attemptN, body) =>
          ctx.agent.tasks.abortAttempt(taskId, attemptN, body),
        logFailure: (err, current) => {
          try {
            rootLogger.warn(
              {
                err: err instanceof Error ? err.message : String(err),
                taskId: current.taskId,
                attemptN: current.attemptN,
              },
              'agent-daemon.abort_on_signal_failed',
            );
          } catch {
            // best-effort logging; never block SIGKILL deadline
          }
        },
      });
    },
  });

  rootLogger.info(
    {
      credentialSource: cfg.credentialSource,
      subjectType: startupWhoami.subjectType,
      bindingScope: startupWhoami.credentialBinding?.bindingScope ?? null,
      credentialKeyId: startupWhoami.credentialBinding?.keyId ?? null,
      boundTeamId:
        startupWhoami.credentialBinding?.bindingScope === 'team'
          ? startupWhoami.credentialBinding.boundTeamId
          : null,
      taskTypes: taskTypes.length > 0 ? taskTypes : ['*'],
      correlationId: values['correlation-id'] ?? null,
      diaryIds: diaryIds.length > 0 ? diaryIds : ['*'],
      pollIntervalMs,
      maxPollIntervalMs,
      profiles: profiles.map((profile) => {
        const runtime = requireRuntime(runtimes, profile.id);
        return {
          id: profile.id,
          name: profile.name,
          provider: profile.provider,
          model: profile.model,
          thinkingLevel: profile.thinkingLevel,
          temperature: profile.temperature,
          topP: profile.topP,
          topK: profile.topK,
          maxOutputTokens: profile.maxOutputTokens,
          sandbox: runtime.sandbox.path,
          heartbeatIntervalMs: operations.heartbeatIntervalMs,
          maxTurns: profile.maxTurns,
          maxBashTimeouts: profile.maxBashTimeouts,
          warmRetentionSec: operations.warmRetentionSec,
          defaultWorkspaceMode: profile.defaultWorkspaceMode,
          allowedWorkspaceModes: profile.allowedWorkspaceModes,
        };
      }),
      piAgentDir: piAgentDir.path,
      piAgentDirSource: piAgentDir.source,
    },
    'agent-daemon.starting',
  );

  let reaperRunning = false;
  const reapRuntimeResources = async () => {
    if (reaperRunning) return;
    reaperRunning = true;
    try {
      for (const profile of profiles) {
        const selected = requireRuntime(runtimes, profile.id);
        const result = await reapRuntimeSlotResources(
          {
            onIssue: (issue) => {
              rootLogger.warn(
                { ...issue, runtimeProfileId: profile.id },
                'agent-daemon.runtime_resource_reap_issue',
              );
            },
            runtimeSlotStore: slotRegistry,
            taskReader: ctx.agent.tasks,
          },
          {
            agentName: identity.agent,
            mainWorktree: resolveMainWorktree(selected.sandbox.rootDir),
            runtimeInstanceId,
            runtimeProfileId: profile.id,
            sessionRootDir: selected.stateDirs.piSessionsDir,
            scratchRootDir: join(selected.stateDirs.rootDir, 'task-workspaces'),
            teamId,
          },
        );
        if (
          result.removedSessions > 0 ||
          result.removedWorkspaces > 0 ||
          result.failed > 0 ||
          result.unsafePaths > 0 ||
          result.truncated
        ) {
          rootLogger.info(
            { ...result, runtimeProfileId: profile.id },
            'agent-daemon.runtime_resources_reaped',
          );
        }
      }
    } catch (err) {
      rootLogger.warn({ err }, 'agent-daemon.runtime_resource_reap_failed');
    } finally {
      reaperRunning = false;
    }
  };
  await reapRuntimeResources();
  const reaperTimer = setInterval(() => {
    void reapRuntimeResources();
  }, 60_000);
  reaperTimer.unref();

  const outputs: TaskOutput[] = [];
  try {
    runtime = new AgentRuntime({
      logger: rootLogger,
      source: createProjectPollingSource(selection, {
        agent: ctx.agent,
        teamId,
        taskTypes: taskTypes.length > 0 ? taskTypes : undefined,
        correlationId: values['correlation-id'],
        profiles: profiles.map((profile) => ({
          profileId: profile.id,
        })),
        diaryIds: diaryIds.length > 0 ? diaryIds : undefined,
        listLimit,
        pollIntervalMs,
        maxPollIntervalMs,
        signal: abort.signal,
        stopWhenEmpty: opts.stopWhenEmpty,
        waitForFirstTaskMs: waitForFirstTaskSec * 1_000,
        waitAfterTaskMs: waitAfterTaskSec * 1_000,
        debug: identity.debug,
        traceIdlePolling: cfg.traceIdlePolling,
        logger: rootLogger,
        executorFingerprints: Object.fromEntries(
          profiles.map((profile) => [
            profile.id,
            requireRuntime(runtimes, profile.id).preparedRuntime.attestor
              .fingerprint,
          ]),
        ),
        // Warm-resume affinity: skip continuations whose source warm
        // session is neither remotely durable nor locally available.
        slotRegistry,
        sessionRegistry: runtimeSessionStore,
        sourceAttemptResolver,
      }),
      makeReporter: (claimedTask) => {
        return new ApiTaskReporter({
          tasks: ctx.agent.tasks,
          teamId: claimedTask.task.teamId,
          heartbeatIntervalMs: operations.heartbeatIntervalMs,
          logger: rootLogger,
        });
      },
      // Finalize each task as soon as the executor resolves — long-
      // polling sources never terminate, so deferring `/complete` to
      // after `runtime.start()` would let every lease expire even when
      // the judge submitted a clean payload. The post-drain finalize
      // loop that used to live below is gone: it would now double-
      // call `/complete` on every task and the server returns 409
      // "Task is already in terminal state" on the second call.
      onTaskFinished: async (output, claimedTask) => {
        const selected = runtimeForClaimedTask(runtimes, claimedTask);
        // `executeTask`'s finally block has already called `finishSlot`
        // by the time we land here, so the slot's `expires_at_ms`
        // reflects the post-completion idle TTL — that's the
        // `slotResumableUntil` window we stamp on the attempt row.
        const resolved = await slotRegistry.findLatestSlotByTaskAttempt(
          claimedTask.task.teamId,
          claimedTask.task.id,
          claimedTask.attemptN,
        );
        let terminalOutput = redactRequiredEnvValues(
          output,
          selected.profile.requiredEnv,
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
            runtimeProfile: selected.profile,
            piAgentDir: piAgentDir.path,
            cwd: ctx.agentRootDir,
          }),
          providerFailureContext: {
            provider: selected.profile.provider,
            model: selected.profile.model,
            runtimeProfileId: selected.profile.id,
            runtimeProfileName: selected.profile.name,
            runtimeProfileRevision:
              claimedTask.claimAuthority?.runtimeProfileRevision ?? null,
            piAgentDirSource: piAgentDir.source,
          },
          executorAttestor: selected.preparedRuntime.attestor,
          writeCorrelationAnchors: makePrBodyAnchorWriter({
            gh: createGhCliClient(),
            logger: rootLogger.child({
              runtimeProfileId: selected.profile.id,
              runtimeProfileName: selected.profile.name,
            }),
          }),
          log: (msg, fields) => rootLogger.warn(fields ?? {}, msg),
        });
      },
      executeTask: async (claimedTask, reporter) => {
        const selected = runtimeForClaimedTask(runtimes, claimedTask);
        const { executionPlans, profile, sandbox, slotIdentity, stateDirs } =
          selected;
        if (runtimeCredentialConfig) {
          await observeGovernancePlanSafely({
            config: runtimeCredentialConfig,
            profile,
            offer: runtimeExecutionOffer(
              selected.preparedRuntime,
              selected.preparedRuntime.attestor.fingerprint,
            ),
            registry: createNodeSecretProviderRegistry(),
            executorFingerprint: selected.preparedRuntime.attestor.fingerprint,
            claimAuthority: claimedTask.claimAuthority ?? {},
            taskId: claimedTask.task.id,
            attemptN: claimedTask.attemptN,
            logger: rootLogger,
          });
        }
        const taskLogger = rootLogger.child({
          runtimeProfileId: profile.id,
          runtimeProfileName: profile.name,
          provider: profile.provider,
          model: profile.model,
          thinkingLevel: profile.thinkingLevel,
          temperature: profile.temperature,
          topP: profile.topP,
          topK: profile.topK,
          maxOutputTokens: profile.maxOutputTokens,
        });
        let executionPlan: Awaited<
          ReturnType<typeof executionPlans.getOrCreate>
        >;
        try {
          executionPlan = await executionPlans.getOrCreate(claimedTask);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          taskLogger.warn(
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
              retryable: err instanceof WorkspaceModeMismatchError,
            },
          };
        }
        const sessionDescriptor = executionPlan.descriptor;
        taskLogger.debug(
          {
            taskId: claimedTask.task.id,
            taskType: claimedTask.task.taskType,
            resumable: sessionDescriptor.policy.resumable,
            workspaceMode: executionPlan.workspaceMode,
            workspaceScope: sessionDescriptor.policy.workspaceScope,
            sessionScope: sessionDescriptor.policy.sessionScope,
            slotKey: executionPlan.slotKey,
            slotId: executionPlan.slotId,
            sessionKey: executionPlan.sessionKey,
            piSessionDir: executionPlan.sessionPersistence?.sessionDir ?? null,
            workspaceId: executionPlan.workspaceId,
          },
          'agent-daemon.task_execution_policy',
        );
        // Belt-and-braces: refuse a task whose type isn't in the configured
        // whitelist (e.g. server filter race after config change). The
        // task requeues for someone else.
        if (
          taskTypes.length > 0 &&
          !taskTypes.includes(claimedTask.task.taskType)
        ) {
          return {
            taskId: claimedTask.task.id,
            attemptN: claimedTask.attemptN,
            status: 'failed',
            output: null,
            outputCid: null,
            usage: { inputTokens: 0, outputTokens: 0 },
            durationMs: 0,
            error: {
              code: 'unsupported_task_type',
              message:
                `Daemon does not support task type "${claimedTask.task.taskType}". ` +
                `Configured types: ${taskTypes.join(', ')}.`,
              retryable: true,
            },
          };
        }
        // Pre-execute cancel check. The reporter's first heartbeat
        // (fired by `open()`) may already have observed `cancelled:true`
        // from the server — e.g. the proposer cancelled between claim and
        // executor entry. Don't burn a VM on work that's already
        // terminal. The runtime would override our output anyway via the
        // post-execute cancelSignal check, but bailing here saves the
        // VM resume.
        if (reporter.cancelSignal.aborted) {
          return {
            taskId: claimedTask.task.id,
            attemptN: claimedTask.attemptN,
            status: 'cancelled',
            output: null,
            outputCid: null,
            usage: { inputTokens: 0, outputTokens: 0 },
            durationMs: 0,
            error: {
              code: 'task_cancelled',
              message:
                reporter.cancelReason ??
                'Task cancelled before executor started.',
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
        const rawExecuteTask = selected.preparedRuntime.createTaskExecutor({
          agentName: identity.agent,
          moltnetAgent: ctx.agent,
          agentIdentity,
          hostCapabilitySigner,
          hostCapabilityLogger: taskLogger,
          agentRootDir: ctx.agentRootDir,
          mountPath: sandbox.rootDir,
          provider: profile.provider,
          model: profile.model,
          providerFailureContext: {
            provider: profile.provider,
            model: profile.model,
            runtimeProfileId: profile.id,
            runtimeProfileName: profile.name,
            piAgentDirSource: piAgentDir.source,
          },
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
              taskLogger.warn(fields, diagnostic.message);
            } else {
              taskLogger.info(fields, diagnostic.message);
            }
          },
          runtimeProfileContext: profile.context,
          runtimeProfileId: profile.id,
          toolEnforcement: profile.toolEnforcement,
          makeExecutionPlan: (task) => executionPlans.getOrCreate(task),
          makeOnTurnEvent: makeTurnEventHandlerFactory(taskLogger),
          toolPolicyLogger: taskLogger,
          maxTurns: profile.maxTurns,
          maxBashTimeouts: profile.maxBashTimeouts,
        });
        try {
          active = {
            taskId: claimedTask.task.id,
            attemptN: claimedTask.attemptN,
          };
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
          active = null;
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
      },
    });

    const drained = await runtime.start();
    outputs.push(...drained);
    rootLogger.info({ processed: drained.length }, 'agent-daemon.drained');
    const anyFailed = drained.some((o) => o.status !== 'completed');
    return anyFailed ? 1 : 0;
  } finally {
    clearInterval(reaperTimer);
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

function runtimeForClaimedTask(
  runtimes: ReadonlyMap<string, PreparedRuntimeProfile>,
  claimedTask: ClaimedTask,
): PreparedRuntimeProfile {
  if (!claimedTask.profileId) {
    throw new Error(
      `Claimed task ${claimedTask.task.id} did not include a selected runtime profile`,
    );
  }
  return requireRuntime(runtimes, claimedTask.profileId);
}

function requireRuntime(
  runtimes: ReadonlyMap<string, PreparedRuntimeProfile>,
  profileId: string,
): PreparedRuntimeProfile {
  const runtime = runtimes.get(profileId);
  if (!runtime) {
    throw new Error(`No runtime profile configured for ${profileId}`);
  }
  return runtime;
}

function parseProfileValues(raw: string[] | undefined): string[] {
  return (raw ?? []).map((s) => s.trim()).filter((s) => s.length > 0);
}

function parseCsv(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function optionalPositiveInt(
  raw: string | undefined,
  name: string,
  defaultValue: number,
): number {
  if (raw === undefined) return defaultValue;
  const v = Number(raw);
  if (!Number.isInteger(v) || v < 1) {
    throw new Error(`Invalid --${name} "${raw}": must be a positive integer`);
  }
  return v;
}

function optionalNonNegativeInt(
  raw: string | undefined,
  name: string,
  defaultValue: number,
): number {
  if (raw === undefined) return defaultValue;
  const v = Number(raw);
  if (!Number.isInteger(v) || v < 0) {
    throw new Error(
      `Invalid --${name} "${raw}": must be a non-negative integer`,
    );
  }
  return v;
}
