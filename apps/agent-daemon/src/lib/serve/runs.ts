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
import { createWriteStream } from 'node:fs';
import { dirname } from 'node:path';

import type { FileSecretProvider } from '@themoltnet/sdk/node';

import { requireAgent } from './identity.js';
import { writeRunPiConfig } from './pi-config.js';
import type { AgentEntry, RunRecord, RunSpec, ServeStore } from './store.js';
import { ServeStoreError } from './store.js';

const STOP_GRACE_MS = 10_000;

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
  secrets: FileSecretProvider;
  /** Base environment inherited by children (config module snapshot). */
  baseEnv: NodeJS.ProcessEnv;
  /** Defaults to re-execing the current entry script. */
  entrypoint?: RunEntrypoint;
  spawnImpl?: SpawnImpl;
  now?: () => Date;
}

function parseFileRef(ref: string): string {
  if (!ref.startsWith('file:')) {
    throw new ServeRunError(
      'invalid_spec',
      `serve v1 resolves file: secret references only, got "${ref.split(':')[0]}:"`,
    );
  }
  return ref.slice('file:'.length);
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
    agent: AgentEntry,
    piDir: string,
  ): Promise<{ args: string[]; env: Record<string, string>; cwd: string }> {
    const env: Record<string, string> = {
      PI_CODING_AGENT_DIR: piDir,
      MOLTNET_TEAM_ID: spec.teamId,
    };
    const args = [
      spec.mode,
      '--agent',
      agent.agentName,
      '--team',
      spec.teamId,
      ...spec.profiles.flatMap((profile) => ['--profile', profile]),
      '--task-types',
      spec.taskTypes.join(','),
    ];

    let cwd: string;
    if (agent.kind === 'managed') {
      env['MOLTNET_API_URL'] = agent.apiUrl;
      env['MOLTNET_AGENT_KEY_REF'] = agent.agentKeyRef;
      env['MOLTNET_PRIVATE_KEY_REF'] = agent.privateKeyRef;
      env['MOLTNET_SECRET_ROOT'] = this.store.secretsDir;
      cwd = dirname(piDir);
    } else {
      // External agents run in OAuth2/config mode from their repository:
      // configDir is `<repo>/.moltnet/<agent>`, so the agent root is two
      // levels up and becomes the working directory (VM mount path).
      if (agent.apiUrl) env['MOLTNET_API_URL'] = agent.apiUrl;
      const agentRoot = dirname(dirname(agent.configDir));
      args.push('--agent-root', agentRoot);
      cwd = agentRoot;
    }

    // Provider API keys: resolve `file:` refs now, inject values into the
    // child env under the name the generated models.json references.
    const providers = this.store.readProviders();
    for (const provider of Object.values(providers)) {
      if (!provider.apiKeyRef) continue;
      const value = await this.options.secrets.read(
        parseFileRef(provider.apiKeyRef),
      );
      if (value) env[provider.envName] = value;
    }

    return { args, env, cwd };
  }

  async start(spec: RunSpec): Promise<RunRecord> {
    validateRunSpec(spec);
    const agent = requireAgent(this.store, spec.agent);
    const id = `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
    const { piDir, logPath } = this.store.createRunDir(id);
    writeRunPiConfig(piDir, this.store.readProviders());

    const { args, env, cwd } = await this.prepare(spec, agent, piDir);
    const entry = this.entrypoint();
    const logStream = createWriteStream(logPath, { flags: 'a', mode: 0o600 });
    const spawnImpl = this.options.spawnImpl ?? nodeSpawn;
    const child = spawnImpl(
      entry.execPath,
      [...entry.execArgv, entry.scriptPath, ...args],
      {
        cwd,
        env: { ...this.options.baseEnv, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      },
    );
    child.stdout?.pipe(logStream, { end: false });
    child.stderr?.pipe(logStream, { end: false });

    const record: RunRecord = {
      ...spec,
      id,
      status: 'running',
      pid: child.pid,
      startedAt: (this.options.now?.() ?? new Date()).toISOString(),
    };
    this.store.writeRun(record);
    this.active.set(id, { child, stopRequested: false });

    child.once('exit', (code) => {
      const activeRun = this.active.get(id);
      this.active.delete(id);
      logStream.end();
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
      logStream.end();
      const current = this.store.readRun(id);
      if (current) {
        this.store.writeRun({
          ...current,
          status: 'failed',
          endedAt: (this.options.now?.() ?? new Date()).toISOString(),
        });
      }
    });

    return record;
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
      activeRun.child.kill('SIGTERM');
      waits.push(
        new Promise((resolvePromise) => {
          activeRun.child.once('exit', () => resolvePromise());
          const killTimer = setTimeout(() => {
            activeRun.child.kill('SIGKILL');
          }, STOP_GRACE_MS);
          killTimer.unref();
          void id;
        }),
      );
    }
    await Promise.all(waits);
  }
}
