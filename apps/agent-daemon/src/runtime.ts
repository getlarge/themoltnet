import type { TaskExecutor } from '@themoltnet/agent-runtime';
import type { ExecutePiTaskOptions } from '@themoltnet/pi-runtime';
import type { ExecutorAttestor } from '@themoltnet/sdk';

export interface PreparedDaemonRuntime {
  readonly runtimeKind: string;
  readonly manifest: Record<string, unknown>;
  readonly attestor: ExecutorAttestor;
  readonly tools: readonly string[];
  readonly executables: readonly string[];
  createTaskExecutor(options: ExecutePiTaskOptions): TaskExecutor;
}

export interface DaemonRuntimeAdapter {
  readonly runtimeKind: string;
  prepare(input: {
    profile: {
      id: string;
      definitionCid: string;
      runtimeKind: string;
    };
    configDir: string;
    onProgress?: (message: string) => void;
  }): Promise<PreparedDaemonRuntime>;
}
