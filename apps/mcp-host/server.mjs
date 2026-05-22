/* global URL, process */

import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, 'dist');
const hostPort = Number(process.env.HOST_PORT ?? 8080);
const sandboxPort = Number(process.env.SANDBOX_PORT ?? 8081);

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.ico')) return 'image/x-icon';
  return 'text/plain; charset=utf-8';
}

function runtimeConfig(hostname) {
  return {
    autorun: process.env.AUTORUN === '1',
    clientId: process.env.MCP_CLIENT_ID,
    clientSecret: process.env.MCP_CLIENT_SECRET,
    defaultArgs: JSON.parse(process.env.DEFAULT_ARGS ?? '{}'),
    defaultTool: process.env.DEFAULT_TOOL ?? 'tasks_app_open',
    sandboxBaseUrl:
      process.env.SANDBOX_BASE_URL ??
      `http://${hostname}:${sandboxPort}/sandbox.html`,
    servers: (process.env.MCP_SERVER_URLS ?? process.env.MCP_SERVER_URL ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  };
}

async function serveFile(reply, filePath) {
  const body = await fs.readFile(filePath);
  reply.writeHead(200, { 'Content-Type': contentType(filePath) });
  reply.end(body);
}

function requestPath(urlPathname, fallbackFile) {
  if (urlPathname === '/' || urlPathname === '') {
    return path.join(distDir, fallbackFile);
  }

  return path.join(distDir, urlPathname.replace(/^\/+/, ''));
}

function createHandler(fallbackFile, isHostServer) {
  return async (request, reply) => {
    try {
      const url = new URL(
        request.url ?? '/',
        `http://${request.headers.host ?? 'localhost'}`,
      );

      if (isHostServer && url.pathname === '/healthz') {
        reply.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        reply.end('ok');
        return;
      }

      if (isHostServer && url.pathname === '/config.js') {
        const hostname = (request.headers.host ?? 'localhost').split(':')[0];
        const body = `window.__MCP_HOST_E2E_CONFIG__ = ${JSON.stringify(runtimeConfig(hostname))};`;
        reply.writeHead(200, {
          'Cache-Control': 'no-store',
          'Content-Type': 'application/javascript; charset=utf-8',
        });
        reply.end(body);
        return;
      }

      await serveFile(reply, requestPath(url.pathname, fallbackFile));
    } catch (error) {
      reply.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      reply.end(error instanceof Error ? error.message : 'Not found');
    }
  };
}

http
  .createServer(createHandler('index.html', true))
  .listen(hostPort, '0.0.0.0');
http
  .createServer(createHandler('sandbox.html', false))
  .listen(sandboxPort, '0.0.0.0');
