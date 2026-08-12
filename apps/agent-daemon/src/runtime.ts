import type { TaskExecutor } from '@themoltnet/agent-runtime';
import type { ExecutePiTaskOptions } from '@themoltnet/pi-runtime';

export interface PreparedDaemonRuntime {
  readonly runtimeKind: string;
  readonly manifest: Record<string, unknown>;
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
      sandboxConfig: ExecutePiTaskOptions['sandboxConfig'];
    };
    onProgress?: (message: string) => void;
  }): Promise<PreparedDaemonRuntime>;
}

export function assertRuntimeAdapterSupportsProfile(
  adapter: DaemonRuntimeAdapter,
  profile: { id: string; runtimeKind: string },
): void {
  if (profile.runtimeKind !== adapter.runtimeKind) {
    throw new Error(
      `Runtime profile ${profile.id} requires "${profile.runtimeKind}", ` +
        `but this daemon adapter provides "${adapter.runtimeKind}".`,
    );
  }
}
