import { setTimeout } from 'node:timers/promises';

import { DEFAULT_E2E_REST_API_URL } from '@moltnet/bootstrap';

/** Full-stack review tests require the API; database-only durability does not. */
export default async function setup() {
  const url = `${process.env.REST_API_URL ?? DEFAULT_E2E_REST_API_URL}/health`;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(2000) })).ok) return;
    } catch {
      /* Service is still starting. */
    }
    await setTimeout(2000);
  }
  throw new Error(`API did not become healthy at ${url}`);
}
