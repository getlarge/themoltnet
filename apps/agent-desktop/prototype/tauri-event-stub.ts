/** PROTOTYPE ONLY. Stands in for `@tauri-apps/api/event`. */
import { subscribeStatus } from './tauri-core-stub.js';

export function listen<T>(
  event: string,
  handler: (payload: { payload: T }) => void,
): Promise<() => void> {
  if (event === 'agent-desktop://status') {
    return Promise.resolve(
      subscribeStatus((status) => handler({ payload: status as T })),
    );
  }
  return Promise.resolve(() => undefined);
}
