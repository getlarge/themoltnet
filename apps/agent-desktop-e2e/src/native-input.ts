import { browser } from '@wdio/globals';
import type { ChainablePromiseElement } from 'webdriverio';

/*
 * Input quirks of the embedded WebKit view.
 *
 * This module used to also force `document.visibilityState` to 'visible',
 * because the app paused polling on a signal this WebView misreports. The app
 * reads the window's real focus state now, so the specs no longer need to lie
 * to it — and the native journeys exercising foreground polling are genuine.
 */

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
