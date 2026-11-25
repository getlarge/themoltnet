/**
 * Ory Network's domain edge owns browser CORS, including preflight responses.
 * Project-level CORS must stay disabled to avoid duplicate response headers.
 */
export async function checkDomainCors({
  projectId,
  apiKey,
  baseUrl,
  origins,
  fetchImpl = fetch,
}) {
  const response = await fetchImpl(
    `https://api.console.ory.sh/projects/${encodeURIComponent(projectId)}/cname`,
    {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
    },
  );
  if (!response.ok)
    throw new Error(`Could not read Ory domain CORS (HTTP ${response.status})`);
  const domains = await response.json();
  const hostname = new URL(baseUrl).hostname;
  const domain = domains.find((item) => item.hostname === hostname);
  if (!domain || domain.cors_enabled !== true)
    throw new Error(
      `Enable domain-level CORS for ${hostname} before deploying`,
    );
  if (
    JSON.stringify([...(domain.cors_allowed_origins ?? [])].sort()) !==
    JSON.stringify([...origins].sort())
  )
    throw new Error(
      `Domain CORS origins for ${hostname} must match cors_public.origins`,
    );
}

function requireHeader(response, name, expected) {
  if (response.headers.get(name) !== expected)
    throw new Error(`Browser CORS check: ${name} must equal ${expected}`);
}

export async function checkBrowserCors({ baseUrl, origin, fetchImpl = fetch }) {
  const request = async (path, options) => {
    const response = await fetchImpl(new URL(path, baseUrl), {
      ...options,
      signal: AbortSignal.timeout(10_000),
      redirect: 'manual',
    });
    await response.body?.cancel();
    return response;
  };
  const preflight = await request('/self-service/login', {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  if (!preflight.ok) throw new Error('Browser CORS preflight did not succeed');
  requireHeader(preflight, 'access-control-allow-origin', origin);
  requireHeader(preflight, 'access-control-allow-credentials', 'true');
  for (const [name, value] of [
    ['access-control-allow-methods', 'post'],
    ['access-control-allow-headers', 'content-type'],
  ]) {
    const values = (preflight.headers.get(name) ?? '')
      .toLowerCase()
      .split(',')
      .map((item) => item.trim());
    if (!values.includes(value))
      throw new Error(`Browser CORS preflight must allow ${value}`);
  }
  const session = await request('/sessions/whoami', {
    headers: { Origin: origin },
  });
  if (![200, 401, 403].includes(session.status))
    throw new Error(`Browser session check returned HTTP ${session.status}`);
  // Equality also rejects comma-joined duplicate headers from two CORS layers.
  requireHeader(session, 'access-control-allow-origin', origin);
  requireHeader(session, 'access-control-allow-credentials', 'true');
}
