import type { ClassifierFunction } from '@earendil-works/pi-ai';
import { classify as classifyWithKey } from '@earendil-works/pi-ai/api/typesafe-system-one';
import { providerHeadersToRecord } from '@earendil-works/pi-ai/utils/headers';

/**
 * Pi requires a nonempty key even for anonymous System One servers. Keep its
 * transport, parsing and usage accounting; remove only the synthetic auth at
 * the fetch boundary. An unresolved key still fails through Pi normally.
 * This sentinel is not a server credential: Pi 1.4's postClassifierRequest
 * rejects empty keys. Remove this shim when Pi supports anonymous auth.
 */
export const classify: ClassifierFunction = (model, context, options) => {
  if (options?.apiKey !== '') return classifyWithKey(model, context, options);
  const suppliedHeaders = new Headers(
    providerHeadersToRecord(model.headers, options.headers),
  );
  const requestFetch = options.fetch ?? globalThis.fetch;
  return classifyWithKey(model, context, {
    ...options,
    apiKey: 'pi-anonymous-sdk-only',
    fetch: (input, init) => {
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      );
      if (!suppliedHeaders.has('authorization'))
        headers.delete('authorization');
      return requestFetch(input, { ...init, headers });
    },
  });
};
