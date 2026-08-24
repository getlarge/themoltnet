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

  it('ignores other origins, including the same host over http', async () => {
    expect(
      await onRequest(new Request('https://api.github.com/x')),
    ).toBeUndefined();
    expect(
      await onRequest(
        new Request('http://agent-signing.moltnet.internal/identity'),
      ),
    ).toBeUndefined();
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
