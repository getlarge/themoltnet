export function loopbackUrl(value: string, label: string): URL {
  const url = new URL(value);
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    (url.hostname !== '127.0.0.1' &&
      url.hostname !== 'localhost' &&
      url.hostname !== '[::1]') ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${label} URL must be a plain loopback HTTP(S) URL`);
  }
  return url;
}

/** Legacy signer companion endpoint: it deliberately remains HTTP-only. */
export function loopbackHttpUrl(value: string, label: string): URL {
  const url = loopbackUrl(value, label);
  if (url.protocol !== 'http:') {
    throw new Error(`${label} URL must be plain loopback HTTP`);
  }
  return url;
}

export function loopbackFetch(
  fetchImpl: typeof fetch,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url = new URL(
    input instanceof Request
      ? input.url
      : input instanceof URL
        ? input.href
        : input,
  );
  if (url.protocol === 'https:') return fetchImpl(input, init);
  const loopbackInit: RequestInit & { targetAddressSpace: 'loopback' } = {
    ...init,
    targetAddressSpace: 'loopback',
  };
  return fetchImpl(input, loopbackInit);
}
