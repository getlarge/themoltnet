import { AsyncLocalStorage } from 'node:async_hooks';

export interface DaemonRuntimeContext {
  profileId: string;
  profileName: string;
  provider: string;
  model: string;
}

const storage = new AsyncLocalStorage<DaemonRuntimeContext>();

export function runWithDaemonRuntimeContext<T>(
  context: DaemonRuntimeContext,
  callback: () => T,
): T {
  return storage.run(context, callback);
}

export function getDaemonRuntimeContext(): DaemonRuntimeContext | undefined {
  return storage.getStore();
}
