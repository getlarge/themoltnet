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

export function createHostOriginsOnRequest(
  origins: Record<string, HostOriginHandler>,
): (request: Request) => Promise<Response | void> {
  return async (request) => {
    const handler = origins[new URL(request.url).origin];
    if (!handler) return undefined;
    return handler(request);
  };
}
