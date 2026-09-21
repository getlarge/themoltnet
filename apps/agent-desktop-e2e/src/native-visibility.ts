import { browser } from '@wdio/globals';
import type { ChainablePromiseElement } from 'webdriverio';

/** Embedded WebKit reports hidden even while its window is driven by WebDriver.
 * Exercise foreground polling without replacing native commands or API data.
 * This module is imported only by the explicit native acceptance specs.
 */
export async function enableNativePolling() {
  await browser.execute(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

/** Embedded WebKit option clicks do not dispatch a select change event. */
export async function selectNative(
  element: ChainablePromiseElement,
  value: string,
) {
  const resolved = await element.getElement();
  await browser.waitUntil(
    () =>
      browser.execute(
        (node, selected) => {
          const select = node as unknown as HTMLSelectElement;
          return (
            !select.disabled &&
            Array.from(select.options).some(
              (option) => option.value === selected,
            )
          );
        },
        resolved,
        value,
      ),
    {
      timeout: 15000,
      timeoutMsg: `Select option ${value} did not become available`,
    },
  );
  await browser.execute(
    (node, selected) => {
      const select = node as unknown as HTMLSelectElement;
      select.value = selected;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    },
    resolved,
    value,
  );
}
