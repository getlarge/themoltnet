/**
 * Host origins: hostnames the guest can reach whose responses are produced by
 * host code inside the proxy (`onRequest` short-circuit). Nothing is listened
 * on, nothing is forwarded; the sandbox knows only the origin → handler map.
 */
export type HostOriginHandler = (request: Request) => Promise<Response>;

export function hostOriginHostnames(
  origins: Record<string, HostOriginHandler>,
): string[] {
  return Object.keys(origins)
    .map((origin) => new URL(origin).hostname)
    .sort();
}

function blocked(): Response {
  return new Response(
    JSON.stringify({
      code: 'host_origin_blocked',
      message: 'origin not served',
    }),
    { status: 421, headers: { 'content-type': 'application/json' } },
  );
}

/**
 * Serve a registered origin in-process. Fails closed for any request whose
 * hostname belongs to a virtual origin but whose exact origin (scheme, host,
 * port) is not registered: such a request must never fall through to normal
 * outbound proxy forwarding (an SSRF route to a host-controlled name).
 */
export function createHostOriginsOnRequest(
  origins: Record<string, HostOriginHandler>,
): (request: Request) => Promise<Response | void> {
  const virtualHostnames = new Set(hostOriginHostnames(origins));
  return async (request) => {
    const url = new URL(request.url);
    const handler = origins[url.origin];
    if (handler) return handler(request);
    if (virtualHostnames.has(url.hostname)) return blocked();
    return undefined;
  };
}
