import { describe, expect, it, vi } from 'vitest';

import {
  createHostOriginsOnRequest,
  hostOriginHostnames,
} from './host-origins.js';

describe('createHostOriginsOnRequest', () => {
  const handler = vi.fn(() =>
    Promise.resolve(new Response('ok', { status: 200 })),
  );
  const onRequest = createHostOriginsOnRequest({
    'https://agent-signing.moltnet.internal': handler,
  });

  it('short-circuits requests to a registered origin', async () => {
    const res = await onRequest(
      new Request('https://agent-signing.moltnet.internal/identity'),
    );
    expect(res).toBeInstanceOf(Response);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('ignores unrelated origins but fails closed for a virtual hostname over the wrong scheme/port', async () => {
    expect(
      await onRequest(new Request('https://api.github.com/x')),
    ).toBeUndefined();
    // Same virtual hostname, wrong scheme or port -> blocked, never forwarded.
    const wrongScheme = await onRequest(
      new Request('http://agent-signing.moltnet.internal/identity'),
    );
    expect(wrongScheme).toBeInstanceOf(Response);
    expect((wrongScheme as Response).status).toBe(421);
    const wrongPort = await onRequest(
      new Request('https://agent-signing.moltnet.internal:8443/identity'),
    );
    expect((wrongPort as Response).status).toBe(421);
  });

  it('lists hostnames for the internal allowlist', () => {
    expect(
      hostOriginHostnames({
        'https://b.moltnet.internal': handler,
        'https://a.moltnet.internal': handler,
      }),
    ).toEqual(['a.moltnet.internal', 'b.moltnet.internal']);
  });
});
