import type { DesktopStatus } from '@moltnet/agent-desktop/bridge';
import { $, browser } from '@wdio/globals';

/** The select that follows a visible label, as the composer renders them. */
export const field = (label: string) =>
  $(`//label[normalize-space()="${label}"]/following-sibling::select`);

/**
 * Native refresh and explicit operations share a nonblocking lock. Retry only
 * an operation rejected before it acquired the lock or changed any state.
 */
export async function lifecycle<T = DesktopStatus>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  let result: T | undefined;
  let failure: unknown;
  await browser.waitUntil(
    async () => {
      try {
        result = await browser.tauri.execute<
          Promise<T>,
          [string, Record<string, unknown> | undefined]
        >(
          ({ core }, name, values) => core.invoke(name, values) as Promise<T>,
          command,
          args,
        );
        return true;
      } catch (error) {
        if (
          String(error).includes(
            'another desktop lifecycle operation is already in progress',
          )
        )
          return false;
        failure = error;
        return true;
      }
    },
    {
      timeout: 30_000,
      interval: 200,
      timeoutMsg: `Lifecycle lock did not become available for ${command}`,
    },
  );
  if (failure !== undefined)
    throw failure instanceof Error ? failure : new Error(String(failure));
  if (!result) throw new Error(`No lifecycle result for ${command}`);
  return result;
}
