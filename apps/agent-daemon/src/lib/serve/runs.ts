/**
 * RunManager — spawns and supervises daemon runs for `serve` (#2061).
 *
 * A run is one child process executing the UNCHANGED `poll`/`drain` CLI
 * path: serve re-execs its own entry script with the run's flags and an
 * environment assembled from stored secret references. Values are resolved
 * in serve's memory at spawn time and injected into the child env only —
 * never written to disk; on-disk artifacts carry refs and `$ENV_NAME`
 * placeholders exclusively.
 */
import type { ChildProcess } from 'node:child_process';
import { spawn as nodeSpawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  createWriteStream,
  mkdirSync,
  openSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { Transform } from 'node:stream';

import { writePiConfig } from '@themoltnet/pi-runtime/pi-config';
import {
  formatSecretReferenceString,
  parseSecretReferenceString,
  resolveAgentKey,
  resolveIdentitySeed,
  resolveOAuth2ClientSecret,
  type SecretProviderRegistry,
} from '@themoltnet/sdk';

import {
  type ActivatedAgent,
  externalAgentLocation,
  verifyAgentActivation,
} from './identity.js';
import type {
  ProvidersState,
  RunRecord,
  RunSpec,
  ServeStore,
} from './store.js';
import { ServeStoreError } from './store.js';

const STOP_GRACE_MS = 10_000;
const STOP_FORCE_MS = 2_000;
const DEFAULT_MAX_LOG_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_COMPLETED_RUNS = 100;
const DEFAULT_MAX_RUN_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
const DEFAULT_MAX_RUN_STORAGE_BYTES = 512 * 1024 * 1024;
const DEFAULT_MAX_ACTIVE_RUNS = 16;
const DEFAULT_MAX_ACTIVE_RUNS_PER_AGENT = 4;
const LOG_TRUNCATION_MARKER = Buffer.from('[truncated]\n');
const INHERITED_ENV_NAMES = new Set([
  'COLORTERM',
  'FORCE_COLOR',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LOG_LEVEL',
  'NO_COLOR',
  'PATH',
  'SSL_CERT_DIR',
  'SSL_CERT_FILE',
  'TEMP',
  'TERM',
  'TMP',
  'TMPDIR',
  'TZ',
]);
const INHERITED_MOLTNET_ENV_NAMES = new Set([
  'MOLTNET_CLI_LINUX_BINARY',
  'MOLTNET_CREDENTIAL_BINDINGS',
  'MOLTNET_CREDENTIAL_ENFORCEMENT',
  'MOLTNET_DIARY_ID',
  'MOLTNET_GIT_AUTHOR',
  'MOLTNET_OTEL_ENDPOINT',
  'MOLTNET_PI_VM_INTEGRATION',
  'MOLTNET_PROFILE_CREDENTIAL_REQUIREMENTS',
  'MOLTNET_SIGNER_URL',
  'MOLTNET_TRACE_IDLE_POLLING',
]);

export class ServeRunError extends Error {
  override name = 'ServeRunError';
  constructor(
    readonly code: 'invalid_spec' | 'run_not_found' | 'run_not_active',
    message: string,
  ) {
    super(message);
  }
}

export interface RunEntrypoint {
  execPath: string;
  execArgv: readonly string[];
  scriptPath: string;
}

export type SpawnImpl = (
  command: string,
  args: readonly string[],
  options: {
    cwd: string;
    env: Record<string, string | undefined>;
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'];
    detached: false;
  },
) => ChildProcess;

export interface RunManagerOptions {
  store: ServeStore;
  /** Serve-managed refs (`file:` rooted under this serve store plus env/keyring). */
  secretProviders: SecretProviderRegistry;
  /** Providers used by external configs at their original location. */
  externalSecretProviders: SecretProviderRegistry;
  /** Base environment inherited by children (config module snapshot). */
  baseEnv: NodeJS.ProcessEnv;
  /** Defaults to re-execing the current entry script. */
  entrypoint?: RunEntrypoint;
  spawnImpl?: SpawnImpl;
  now?: () => Date;
  verifyActivationImpl?: typeof verifyAgentActivation;
  logger?: RunLogger;
  maxLogBytes?: number;
  maxCompletedRuns?: number;
  maxRunAgeMs?: number;
  maxRunStorageBytes?: number;
  maxActiveRuns?: number;
  maxActiveRunsPerAgent?: number;
}

export interface RunLogger {
  info(context: Record<string, unknown>, message: string): void;
  warn(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
}

export function validateRunSpec(spec: RunSpec): void {
  if (spec.mode !== 'poll' && spec.mode !== 'drain') {
    throw new ServeRunError('invalid_spec', 'mode must be poll or drain');
  }
  if (!spec.agent) throw new ServeRunError('invalid_spec', 'agent is required');
  if (!spec.teamId) {
    throw new ServeRunError('invalid_spec', 'teamId is required');
  }
  if (!Array.isArray(spec.profiles) || spec.profiles.length === 0) {
    throw new ServeRunError('invalid_spec', 'at least one profile is required');
  }
  if (!Array.isArray(spec.taskTypes) || spec.taskTypes.length === 0) {
    throw new ServeRunError(
      'invalid_spec',
      'at least one task type is required',
    );
  }
}

interface ActiveRun {
  agent: string;
  child: ChildProcess;
  stopRequested: boolean;
}

export class RunManager {
  private readonly active = new Map<string, ActiveRun>();
  private readonly startingByAgent = new Map<string, number>();
  private starting = 0;
  private closing = false;

  constructor(private readonly options: RunManagerOptions) {
    this.reconcileInterruptedRuns();
    this.pruneCompletedRuns();
  }

  private get store(): ServeStore {
    return this.options.store;
  }

  private entrypoint(): RunEntrypoint {
    return (
      this.options.entrypoint ?? {
        execPath: process.execPath,
        execArgv: process.execArgv,
        scriptPath: process.argv[1] ?? '',
      }
    );
  }

  /** Assemble child env + args for a run. Exposed for tests. */
  async prepare(
    spec: RunSpec,
    agent: ActivatedAgent,
    piDir: string,
    providers: ProvidersState = this.store.readProviders(),
  ): Promise<{ args: string[]; env: Record<string, string>; cwd: string }> {
    const { activation, config } = agent;
    const homeDir = join(dirname(piDir), 'home');
    const env: Record<string, string> = {
      HOME: homeDir,
      PI_CODING_AGENT_DIR: piDir,
      XDG_CACHE_HOME: join(homeDir, '.cache'),
      XDG_CONFIG_HOME: join(homeDir, '.config'),
      XDG_DATA_HOME: join(homeDir, '.local', 'share'),
      MOLTNET_TEAM_ID: spec.teamId,
    };
    const target =
      activation.source === 'managed'
        ? { agentName: activation.alias, cwd: dirname(piDir), extraArgs: [] }
        : (() => {
            const { agentName, agentRoot } = externalAgentLocation(
              activation.configPath,
            );
            return {
              agentName,
              cwd: agentRoot,
              extraArgs: ['--agent-root', agentRoot],
            };
          })();
    const args = [
      spec.mode,
      '--agent',
      target.agentName,
      '--team',
      spec.teamId,
      ...spec.profiles.flatMap((profile) => ['--profile', profile]),
      '--task-types',
      spec.taskTypes.join(','),
      ...target.extraArgs,
    ];

    if (activation.source === 'managed') {
      if (!config.agent_key_ref || !config.keys.private_key_ref) {
        throw new ServeRunError(
          'invalid_spec',
          `managed config for "${activation.alias}" is missing canonical secret references`,
        );
      }
      env['MOLTNET_API_URL'] = activation.apiUrl;
      env['MOLTNET_AGENT_KEY_REF'] = formatSecretReferenceString(
        config.agent_key_ref,
      );
      env['MOLTNET_PRIVATE_KEY_REF'] = formatSecretReferenceString(
        config.keys.private_key_ref,
      );
      env['MOLTNET_SECRET_ROOT'] = this.store.secretsDir;
    } else {
      env['MOLTNET_API_URL'] = activation.apiUrl ?? activation.configApiUrl;
      try {
        const agentKey = await resolveAgentKey(
          config,
          this.options.externalSecretProviders,
        );
        if (agentKey) {
          env['MOLTNET_AGENT_KEY'] = agentKey;
          env['MOLTNET_PRIVATE_KEY'] = await resolveIdentitySeed(
            config,
            this.options.externalSecretProviders,
          );
        } else if (config.oauth2?.client_secret_ref) {
          env['MOLTNET_CLIENT_ID'] = config.oauth2.client_id;
          env['MOLTNET_CLIENT_SECRET'] = await resolveOAuth2ClientSecret(
            config,
            this.options.externalSecretProviders,
          );
        }
        if (!agentKey && config.keys.private_key_ref) {
          env['MOLTNET_PRIVATE_KEY'] = await resolveIdentitySeed(
            config,
            this.options.externalSecretProviders,
          );
        }
      } catch {
        throw new ServeRunError(
          'invalid_spec',
          `external credentials for "${activation.alias}" could not be projected`,
        );
      }
    }
    env['MOLTNET_EXPECTED_IDENTITY_ID'] = activation.identityId;
    env['MOLTNET_EXPECTED_PUBLIC_KEY'] = activation.publicKey;
    env['MOLTNET_EXPECTED_FINGERPRINT'] = activation.fingerprint;
    env['MOLTNET_SUPERVISED_RUN'] = '1';

    // Provider API keys resolve through the registry so file/keyring/env
    // providers share one parser and one value-free failure boundary.
    for (const [providerId, provider] of Object.entries(providers)) {
      if (!provider.apiKeyRef) continue;
      let value: string;
      try {
        value = await this.options.secretProviders.resolve(
          parseSecretReferenceString(provider.apiKeyRef),
        );
      } catch {
        throw new ServeRunError(
          'invalid_spec',
          `provider "${providerId}" API key could not be resolved`,
        );
      }
      env[provider.envName] = value;
    }

    return { args, env, cwd: target.cwd };
  }

  async start(spec: RunSpec, signal?: AbortSignal): Promise<RunRecord> {
    validateRunSpec(spec);
    const releaseStart = this.reserveStart(spec.agent);
    try {
      return await this.startReserved(spec, signal);
    } finally {
      releaseStart();
    }
  }

  private async startReserved(
    spec: RunSpec,
    signal?: AbortSignal,
  ): Promise<RunRecord> {
    this.assertStartOpen(signal);
    const verify = this.options.verifyActivationImpl ?? verifyAgentActivation;
    const agent = await verify(
      this.store,
      spec.agent,
      this.options.secretProviders,
      this.options.externalSecretProviders,
      undefined,
      signal,
    );
    this.assertStartOpen(signal);
    if (agent.boundTeamId && agent.boundTeamId !== spec.teamId) {
      throw new ServeRunError(
        'invalid_spec',
        `agent "${spec.agent}" has a key bound to team ${agent.boundTeamId}; ` +
          `start the run with that team, or create a new agent with an ` +
          `enrollment token from team ${spec.teamId}`,
      );
    }
    const id = `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
    const runDir = this.store.runDir(id);
    const piDir = join(runDir, 'pi');
    const providers = this.store.readProviders();
    const { args, env, cwd } = await this.prepare(
      spec,
      agent,
      piDir,
      providers,
    );
    this.assertStartOpen(signal);
    let child: ChildProcess | undefined;
    let logStream: ReturnType<typeof createWriteStream> | undefined;
    let logLimiter: Transform | undefined;
    try {
      const { logPath } = this.store.createRunDir(id);
      for (const dir of [
        env.HOME,
        env.XDG_CACHE_HOME,
        env.XDG_CONFIG_HOME,
        env.XDG_DATA_HOME,
      ]) {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
      }
      writePiConfig({
        piDir,
        providers: Object.fromEntries(
          Object.entries(providers).map(([providerId, provider]) => [
            providerId,
            {
              api: provider.api,
              ...(provider.apiKeyRef
                ? { apiKeyEnvRef: `$${provider.envName}` }
                : {}),
              baseUrl: provider.baseUrl,
              models: provider.models,
            },
          ]),
        ),
      });
      // Subscription credentials: every run shares the store's pi/auth.json
      // (pi lockfiles it and rotates tokens in place). A dangling link is
      // fine — pi treats a missing auth.json as "no subscription auth".
      try {
        symlinkSync(this.store.piAuthJsonPath, join(piDir, 'auth.json'));
      } catch {
        // already linked or filesystem without symlinks: env-var providers
        // still work; subscription auth is simply unavailable for the run.
      }

      const entry = this.entrypoint();
      logStream = createWriteStream(logPath, {
        fd: openSync(logPath, 'a', 0o600),
        autoClose: true,
      });
      logLimiter = createByteLimitTransform(
        this.options.maxLogBytes ?? DEFAULT_MAX_LOG_BYTES,
        () =>
          this.log('warn', 'serve run log output truncated', {
            ...runContext(id, spec.agent, child),
            transition: 'log_truncated',
          }),
      );
      logLimiter.pipe(logStream);
      logStream.on('error', (error) => {
        this.log('error', 'serve run log stream failed', {
          ...runContext(id, spec.agent, child),
          transition: 'log_failed',
          ...safeRunError(error),
        });
        child?.kill('SIGKILL');
      });
      const spawnImpl = this.options.spawnImpl ?? nodeSpawn;
      this.assertStartOpen(signal);
      child = spawnImpl(
        entry.execPath,
        [...entry.execArgv, entry.scriptPath, ...args],
        {
          cwd,
          env: { ...sanitizeChildBaseEnv(this.options.baseEnv), ...env },
          stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
          detached: false,
        },
      );
      this.active.set(id, { agent: spec.agent, child, stopRequested: false });
      child.stdout?.pipe(logLimiter, { end: false });
      child.stderr?.pipe(logLimiter, { end: false });

      const record: RunRecord = {
        ...spec,
        id,
        status: 'running',
        pid: child.pid,
        startedAt: (this.options.now?.() ?? new Date()).toISOString(),
      };
      child.once('exit', (code, signal) => {
        const activeRun = this.active.get(id);
        this.active.delete(id);
        logLimiter?.end();
        const status = activeRun?.stopRequested
          ? 'stopped'
          : code === 0
            ? 'exited'
            : 'failed';
        this.log(status === 'failed' ? 'error' : 'info', 'serve run exited', {
          ...runContext(id, spec.agent, child),
          transition: status,
          exitCode: code,
          signal,
        });
        this.persistRunCompletion(id, spec.agent, {
          status,
          exitCode: code,
        });
      });
      child.once('error', (error) => {
        this.active.delete(id);
        logLimiter?.end();
        this.log('error', 'serve run child process failed', {
          ...runContext(id, spec.agent, child),
          transition: 'spawn_failed',
          ...safeRunError(error),
        });
        this.persistRunCompletion(id, spec.agent, { status: 'failed' });
      });

      this.store.writeRun(record);
      this.log('info', 'serve run started', {
        ...runContext(id, spec.agent, child),
        transition: 'running',
      });
      return record;
    } catch (cause) {
      logLimiter?.destroy();
      logStream?.destroy();
      if (child && !(await terminateChild(child))) {
        throw new AggregateError(
          [cause],
          `run "${id}" failed to start and its child did not exit after SIGKILL`,
        );
      }
      this.active.delete(id);
      rmSync(runDir, { recursive: true, force: true });
      this.log('error', 'serve run failed to start', {
        ...runContext(id, spec.agent, child),
        transition: 'start_failed',
        ...safeRunError(cause),
      });
      throw cause;
    }
  }

  stop(id: string): RunRecord {
    const record = this.store.readRun(id);
    if (!record) {
      throw new ServeRunError('run_not_found', `run "${id}" was not found`);
    }
    const activeRun = this.active.get(id);
    if (!activeRun) {
      throw new ServeRunError('run_not_active', `run "${id}" is not running`);
    }
    activeRun.stopRequested = true;
    this.log('info', 'serve run stop requested', {
      ...runContext(id, record.agent, activeRun.child),
      transition: 'stopping',
      signal: 'SIGTERM',
    });
    activeRun.child.kill('SIGTERM');
    const killTimer = setTimeout(() => {
      if (this.active.has(id)) activeRun.child.kill('SIGKILL');
    }, STOP_GRACE_MS);
    killTimer.unref();
    return record;
  }

  /** Live status merged over the persisted record. */
  status(id: string): RunRecord {
    const record = this.store.readRun(id);
    if (!record) {
      throw new ServeStoreError('not_found', `run "${id}" was not found`);
    }
    return record;
  }

  list(limit = Number.POSITIVE_INFINITY): RunRecord[] {
    if (!Number.isFinite(limit)) return this.store.listRuns();

    const active = [...this.active.keys()]
      .map((id) => this.store.readRun(id))
      .filter((record): record is RunRecord => record !== null)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const activeIds = new Set(active.map((record) => record.id));
    const history = this.store
      .listRuns(limit + active.length)
      .filter((record) => !activeIds.has(record.id))
      .slice(0, limit);
    return [...active, ...history];
  }

  isActive(id: string): boolean {
    return this.active.has(id);
  }

  async stopAll(): Promise<void> {
    this.closing = true;
    const waits: Promise<void>[] = [];
    for (const [id, activeRun] of this.active) {
      activeRun.stopRequested = true;
      waits.push(
        new Promise((resolvePromise, rejectPromise) => {
          let settled = false;
          const finish = (): void => {
            if (settled) return;
            settled = true;
            clearTimeout(killTimer);
            clearTimeout(forceTimer);
            resolvePromise();
          };
          activeRun.child.once('exit', finish);
          activeRun.child.kill('SIGTERM');
          const killTimer = setTimeout(() => {
            activeRun.child.kill('SIGKILL');
          }, STOP_GRACE_MS);
          killTimer.unref();
          const forceTimer = setTimeout(() => {
            if (settled) return;
            settled = true;
            clearTimeout(killTimer);
            rejectPromise(new Error(`run "${id}" did not exit after SIGKILL`));
          }, STOP_GRACE_MS + STOP_FORCE_MS);
          forceTimer.unref();
        }),
      );
    }
    await Promise.all(waits);
  }

  forceStopAll(): void {
    this.closing = true;
    for (const [id, activeRun] of this.active) {
      activeRun.stopRequested = true;
      this.log('warn', 'serve run force stop requested', {
        ...runContext(
          id,
          this.store.readRun(id)?.agent ?? 'unknown',
          activeRun.child,
        ),
        transition: 'force_stopping',
        signal: 'SIGKILL',
      });
      activeRun.child.kill('SIGKILL');
    }
  }

  private reconcileInterruptedRuns(): void {
    const endedAt = (this.options.now?.() ?? new Date()).toISOString();
    for (const record of this.store.listRuns()) {
      if (record.status !== 'running') continue;
      this.store.writeRun({
        ...record,
        status: 'failed',
        exitCode: null,
        endedAt,
      });
      this.log('warn', 'serve run interrupted by supervisor replacement', {
        runId: record.id,
        agent: record.agent,
        pid: record.pid,
        transition: 'interrupted',
      });
    }
  }

  private reserveStart(agent: string): () => void {
    if (this.closing) {
      throw new ServeRunError('invalid_spec', 'serve is shutting down');
    }
    const agentStarting = this.startingByAgent.get(agent) ?? 0;
    const agentActive = [...this.active.values()].filter(
      (run) => run.agent === agent,
    ).length;
    if (
      this.active.size + this.starting >=
        (this.options.maxActiveRuns ?? DEFAULT_MAX_ACTIVE_RUNS) ||
      agentActive + agentStarting >=
        (this.options.maxActiveRunsPerAgent ??
          DEFAULT_MAX_ACTIVE_RUNS_PER_AGENT)
    ) {
      throw new ServeRunError(
        'invalid_spec',
        `active run limit reached for agent "${agent}"`,
      );
    }
    this.starting += 1;
    this.startingByAgent.set(agent, agentStarting + 1);
    return () => {
      this.starting -= 1;
      const remaining = (this.startingByAgent.get(agent) ?? 1) - 1;
      if (remaining > 0) this.startingByAgent.set(agent, remaining);
      else this.startingByAgent.delete(agent);
    };
  }

  private assertStartOpen(signal?: AbortSignal): void {
    if (this.closing || signal?.aborted) {
      throw new ServeRunError('invalid_spec', 'serve is shutting down');
    }
  }

  private pruneCompletedRuns(): void {
    const removed = this.store.pruneCompletedRuns({
      maxCount: this.options.maxCompletedRuns ?? DEFAULT_MAX_COMPLETED_RUNS,
      maxAgeMs: this.options.maxRunAgeMs ?? DEFAULT_MAX_RUN_AGE_MS,
      maxBytes:
        this.options.maxRunStorageBytes ?? DEFAULT_MAX_RUN_STORAGE_BYTES,
      now: this.options.now?.() ?? new Date(),
    });
    if (removed.length > 0) {
      this.log('info', 'serve run retention removed completed artifacts', {
        transition: 'pruned',
        removedCount: removed.length,
      });
    }
  }

  private persistRunCompletion(
    id: string,
    agent: string,
    update: Pick<RunRecord, 'status'> & { exitCode?: number | null },
  ): void {
    try {
      const current = this.store.readRun(id);
      if (current) {
        this.store.writeRun({
          ...current,
          ...update,
          endedAt: (this.options.now?.() ?? new Date()).toISOString(),
        });
      }
      this.pruneCompletedRuns();
    } catch (error) {
      this.log('error', 'serve run completion persistence failed', {
        runId: id,
        agent,
        transition: 'persistence_failed',
        ...safeRunError(error),
      });
    }
  }

  private log(
    level: keyof RunLogger,
    message: string,
    context: Record<string, unknown>,
  ): void {
    this.options.logger?.[level](context, message);
  }
}

function createByteLimitTransform(
  limit: number,
  onTruncated: () => void,
): Transform {
  const byteLimit = Math.max(0, Math.floor(limit));
  const contentLimit = Math.max(0, byteLimit - LOG_TRUNCATION_MARKER.length);
  let emitted = 0;
  let truncated = false;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      const remaining = Math.max(0, contentLimit - emitted);
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (remaining > 0) {
        const selected = bytes.subarray(0, remaining);
        emitted += selected.length;
        this.push(selected);
      }
      if (!truncated && bytes.length > remaining) {
        truncated = true;
        const marker = LOG_TRUNCATION_MARKER.subarray(0, byteLimit - emitted);
        emitted += marker.length;
        this.push(marker);
        onTruncated();
      }
      callback();
    },
  });
}

function runContext(
  runId: string,
  agent: string,
  child: ChildProcess | undefined,
): Record<string, unknown> {
  return { runId, agent, pid: child?.pid };
}

function safeRunError(error: unknown): Record<string, unknown> {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return {
    errorType: error instanceof Error ? error.name : typeof error,
    ...(typeof code === 'string' ? { errorCode: code } : {}),
  };
}

function sanitizeChildBaseEnv(
  baseEnv: NodeJS.ProcessEnv,
): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(baseEnv).filter(
      ([name]) =>
        INHERITED_ENV_NAMES.has(name) || INHERITED_MOLTNET_ENV_NAMES.has(name),
    ),
  );
}

async function terminateChild(child: ChildProcess): Promise<boolean> {
  if (child.exitCode !== null && child.exitCode !== undefined) return true;
  return new Promise<boolean>((resolvePromise) => {
    const timer = setTimeout(() => resolvePromise(false), STOP_FORCE_MS);
    timer.unref();
    child.once('exit', () => {
      clearTimeout(timer);
      resolvePromise(true);
    });
    child.kill('SIGKILL');
  });
}
