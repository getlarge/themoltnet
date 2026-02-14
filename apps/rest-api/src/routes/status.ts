/**
 * Service status page — at-a-glance health of all MoltNet production services.
 *
 * Checks: REST API (self), MCP Server, Landing Page.
 * Returns HTML by default, JSON when Accept: application/json.
 */

import type { FastifyInstance } from 'fastify';

interface ServiceCheck {
  name: string;
  url: string;
  status: 'up' | 'down';
  responseMs: number;
  error?: string;
}

interface StatusResponse {
  overall: 'healthy' | 'degraded' | 'down';
  timestamp: string;
  services: ServiceCheck[];
}

const DEFAULT_SERVICES = [
  { name: 'REST API', url: 'https://api.themolt.net/health' },
  { name: 'MCP Server', url: 'https://mcp.themolt.net/healthz' },
  { name: 'Landing Page', url: 'https://themolt.net' },
];

async function checkService(name: string, url: string): Promise<ServiceCheck> {
  const start = performance.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    const responseMs = Math.round(performance.now() - start);
    return {
      name,
      url,
      status: res.ok ? 'up' : 'down',
      responseMs,
      ...(res.ok ? {} : { error: `HTTP ${res.status}` }),
    };
  } catch (err) {
    const responseMs = Math.round(performance.now() - start);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { name, url, status: 'down', responseMs, error: message };
  }
}

function resolveOverall(
  services: ServiceCheck[],
): 'healthy' | 'degraded' | 'down' {
  const downCount = services.filter((s) => s.status === 'down').length;
  if (downCount === 0) return 'healthy';
  if (downCount === services.length) return 'down';
  return 'degraded';
}

function renderHtml(data: StatusResponse): string {
  const overallColor =
    data.overall === 'healthy'
      ? '#22c55e'
      : data.overall === 'degraded'
        ? '#eab308'
        : '#ef4444';

  const serviceRows = data.services
    .map((s) => {
      const color = s.status === 'up' ? '#22c55e' : '#ef4444';
      const dot = `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};margin-right:8px"></span>`;
      const errorInfo = s.error
        ? `<span style="color:#94a3b8;font-size:13px"> &mdash; ${escapeHtml(s.error)}</span>`
        : '';
      return `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 0;border-bottom:1px solid #1e293b">
        <div style="display:flex;align-items:center">
          ${dot}
          <div>
            <div style="font-weight:600">${escapeHtml(s.name)}</div>
            <div style="font-size:13px;color:#64748b">${escapeHtml(s.url)}${errorInfo}</div>
          </div>
        </div>
        <div style="text-align:right">
          <div style="font-weight:600;color:${color}">${s.status.toUpperCase()}</div>
          <div style="font-size:13px;color:#64748b">${s.responseMs}ms</div>
        </div>
      </div>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MoltNet Status</title>
  <meta http-equiv="refresh" content="30">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0f172a; color: #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace; }
  </style>
</head>
<body>
  <div style="max-width:640px;margin:0 auto;padding:48px 24px">
    <h1 style="font-size:24px;margin-bottom:4px">MoltNet Status</h1>
    <p style="color:#64748b;margin-bottom:32px">Service health at a glance &mdash; auto-refreshes every 30s</p>

    <div style="background:#1e293b;border-radius:12px;padding:20px 24px;margin-bottom:32px;display:flex;align-items:center;justify-content:space-between">
      <div>
        <div style="font-size:13px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em">Overall</div>
        <div style="font-size:20px;font-weight:700;color:${overallColor}">${data.overall.toUpperCase()}</div>
      </div>
      <div style="text-align:right;font-size:13px;color:#64748b">
        ${escapeHtml(data.timestamp)}
      </div>
    </div>

    <div style="background:#1e293b;border-radius:12px;padding:8px 24px">
      ${serviceRows}
    </div>

    <p style="text-align:center;margin-top:24px;font-size:13px;color:#475569">
      themolt.net
    </p>
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function statusRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/status',
    {
      schema: {
        operationId: 'getStatus',
        tags: ['health'],
        description:
          'Service status page. Returns HTML by default, JSON with Accept: application/json.',
        hide: true,
      },
    },
    async (request, reply) => {
      const services = await Promise.all(
        DEFAULT_SERVICES.map((s) => checkService(s.name, s.url)),
      );

      const data: StatusResponse = {
        overall: resolveOverall(services),
        timestamp: new Date().toISOString(),
        services,
      };

      const accept = request.headers.accept ?? '';
      if (accept.includes('application/json')) {
        return data;
      }

      return reply.type('text/html').send(renderHtml(data));
    },
  );
}
