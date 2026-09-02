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
import { createWriteStream, openSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { writePiConfig } from '@themoltnet/pi-runtime';
import {
  formatSecretReferenceString,
  parseSecretReferenceString,
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
    stdio: ['ignore', 'pipe', 'pipe'];
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
  child: ChildProcess;
  stopRequested: boolean;
}

export class RunManager {
  private readonly active = new Map<string, ActiveRun>();

  constructor(private readonly options: RunManagerOptions) {}

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
    const env: Record<string, string> = {
      PI_CODING_AGENT_DIR: piDir,
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
    }
    env['MOLTNET_EXPECTED_IDENTITY_ID'] = activation.identityId;
    env['MOLTNET_EXPECTED_PUBLIC_KEY'] = activation.publicKey;
    env['MOLTNET_EXPECTED_FINGERPRINT'] = activation.fingerprint;

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

  async start(spec: RunSpec): Promise<RunRecord> {
    validateRunSpec(spec);
    const verify = this.options.verifyActivationImpl ?? verifyAgentActivation;
    const agent = await verify(
      this.store,
      spec.agent,
      this.options.secretProviders,
      this.options.externalSecretProviders,
    );
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
    let child: ChildProcess | undefined;
    let logStream: ReturnType<typeof createWriteStream> | undefined;
    try {
      const { logPath } = this.store.createRunDir(id);
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

      const entry = this.entrypoint();
      logStream = createWriteStream(logPath, {
        fd: openSync(logPath, 'a', 0o600),
        autoClose: true,
      });
      logStream.on('error', () => child?.kill('SIGKILL'));
      const spawnImpl = this.options.spawnImpl ?? nodeSpawn;
      child = spawnImpl(
        entry.execPath,
        [...entry.execArgv, entry.scriptPath, ...args],
        {
          cwd,
          env: { ...this.options.baseEnv, ...env },
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: false,
        },
      );
      this.active.set(id, { child, stopRequested: false });
      child.stdout?.pipe(logStream, { end: false });
      child.stderr?.pipe(logStream, { end: false });

      const record: RunRecord = {
        ...spec,
        id,
        status: 'running',
        pid: child.pid,
        startedAt: (this.options.now?.() ?? new Date()).toISOString(),
      };
      child.once('exit', (code) => {
        const activeRun = this.active.get(id);
        this.active.delete(id);
        logStream?.end();
        const current = this.store.readRun(id);
        if (!current) return;
        this.store.writeRun({
          ...current,
          status: activeRun?.stopRequested
            ? 'stopped'
            : code === 0
              ? 'exited'
              : 'failed',
          exitCode: code,
          endedAt: (this.options.now?.() ?? new Date()).toISOString(),
        });
      });
      child.once('error', () => {
        this.active.delete(id);
        logStream?.end();
        const current = this.store.readRun(id);
        if (current) {
          this.store.writeRun({
            ...current,
            status: 'failed',
            endedAt: (this.options.now?.() ?? new Date()).toISOString(),
          });
        }
      });

      this.store.writeRun(record);
      return record;
    } catch (cause) {
      logStream?.destroy();
      if (child && !(await terminateChild(child))) {
        throw new AggregateError(
          [cause],
          `run "${id}" failed to start and its child did not exit after SIGKILL`,
        );
      }
      this.active.delete(id);
      rmSync(runDir, { recursive: true, force: true });
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

  list(): RunRecord[] {
    return this.store.listRuns();
  }

  isActive(id: string): boolean {
    return this.active.has(id);
  }

  async stopAll(): Promise<void> {
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
