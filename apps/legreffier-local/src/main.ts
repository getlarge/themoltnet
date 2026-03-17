#!/usr/bin/env -S npx tsx
/**
 * Legreffier Local MCP Server
 *
 * A local MCP server that wraps AxLearn with diary-backed storage
 * for self-improving codebase Q&A.
 *
 * Usage:
 *   pnpm --filter @moltnet/legreffier-local dev
 *
 * Authentication (resolved by @themoltnet/sdk in order):
 *   1. MOLTNET_CLIENT_ID + MOLTNET_CLIENT_SECRET env vars
 *   2. ~/.config/moltnet/moltnet.json config file
 *   3. Explicit --client-id / --client-secret flags (not yet)
 *
 * Environment:
 *   MOLTNET_API_URL    — REST API base URL (default: https://api.themolt.net)
 *   LEGREFFIER_PORT    — SSE port (default: 0 = random)
 *   LEGREFFIER_TEACHER — Teacher model (default: claude-opus-4-6)
 *   LEGREFFIER_STUDENT — Student model (default: claude-sonnet-4-6)
 *   LEGREFFIER_IDLE_MS — Idle timeout in ms (default: 7200000 = 2h)
 */

import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';

import mcpPlugin from '@getlarge/fastify-mcp';
import { connect } from '@themoltnet/sdk';
import Fastify from 'fastify';

import { createAgentBundle } from './agent.js';
import { registerTools } from './tools.js';
import type { LocalMcpDeps, ServerConfig } from './types.js';

function loadConfig(): ServerConfig {
  /* eslint-disable no-restricted-syntax -- standalone CLI entry point, process.env is the only way to read config */
  return {
    apiUrl: process.env.MOLTNET_API_URL,
    clientId: process.env.MOLTNET_CLIENT_ID,
    clientSecret: process.env.MOLTNET_CLIENT_SECRET,
    port: parseInt(process.env.LEGREFFIER_PORT ?? '0', 10),
    teacherModel: process.env.LEGREFFIER_TEACHER ?? 'claude-opus-4-6',
    studentModel: process.env.LEGREFFIER_STUDENT ?? 'claude-sonnet-4-6',
    idleTimeoutMs: parseInt(process.env.LEGREFFIER_IDLE_MS ?? '7200000', 10),
  };
  /* eslint-enable no-restricted-syntax */
}

/** Detect repo name from git for diary auto-discovery. */
function repoName(): string {
  try {
    const toplevel = execSync('git rev-parse --show-toplevel', {
      encoding: 'utf8',
    }).trim();
    return basename(toplevel);
  } catch {
    return 'unknown';
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const sessionId = randomUUID();

  const app = Fastify({ logger: { level: 'info' } });

  // ── Authenticate via SDK ────────────────────────────────
  app.log.info('Connecting to MoltNet...');
  const sdkAgent = await connect({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    apiUrl: config.apiUrl,
  });
  app.log.info('Authenticated.');

  // ── Resolve diary ID ────────────────────────────────────
  const repo = repoName();
  const diaries = await sdkAgent.diaries.list();
  let diary = diaries.items.find((d) => d.name === repo);
  if (!diary) {
    app.log.info({ repo }, 'Diary not found, creating...');
    diary = await sdkAgent.diaries.create({
      name: repo,
      visibility: 'moltnet',
    });
  }
  const diaryId = diary.id;
  app.log.info({ diaryId, repo }, 'Using diary');

  // ── Fetch identity/soul for instruction customization ───
  let identityContext: string | null = null;
  try {
    const digest = await sdkAgent.entries.reflect({
      diaryId,
      maxEntries: 10,
      entryTypes: 'identity,soul',
    });
    if (digest?.entries?.length) {
      identityContext = digest.entries.map((e) => e.content).join('\n\n');
    }
  } catch {
    app.log.warn('Could not fetch identity/soul entries');
  }

  // ── Create AxLearn agent ────────────────────────────────
  const { agent, gen, studentAi } = createAgentBundle(
    config,
    sessionId,
    sdkAgent,
    diaryId,
  );

  if (identityContext) {
    const base = gen.getInstruction() ?? '';
    gen.setInstruction(`${base}\n\n## Agent Identity\n${identityContext}`);
    app.log.info('Loaded identity/soul context into instruction');
  }

  // ── Health check ────────────────────────────────────────
  app.get('/healthz', () => ({ status: 'ok', sessionId, diaryId }));

  // ── Register MCP plugin (no auth — local only) ─────────
  await app.register(mcpPlugin, {
    serverInfo: { name: 'legreffier-local', version: '0.1.0' },
    capabilities: { tools: {} },
    enableSSE: true,
    sessionStore: 'memory',
    authorization: { enabled: false },
  });

  // ── Build deps + register tools ─────────────────────────
  const deps: LocalMcpDeps = {
    agent,
    gen,
    studentAi,
    sdkAgent,
    diaryId,
    config,
    logger: app.log,
    sessionId,
    traceCounter: 0,
    traceIndex: new Map(),
    lastActivity: Date.now(),
    startTime: Date.now(),
  };

  registerTools(app, deps);

  // ── Start ───────────────────────────────────────────────
  const address = await app.listen({
    port: config.port,
    host: '127.0.0.1',
  });
  app.log.info(
    { address, sessionId, diaryId },
    'Legreffier local MCP server started',
  );

  // ── Idle shutdown ───────────────────────────────────────
  const idleCheck = setInterval(() => {
    if (Date.now() - deps.lastActivity > config.idleTimeoutMs) {
      app.log.info('Idle timeout reached, shutting down');
      clearInterval(idleCheck);
      void app.close();
    }
  }, 60_000);

  const shutdown = async () => {
    clearInterval(idleCheck);
    app.log.info('Shutting down...');
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console -- CLI entry point, logger not available
  console.error('Failed to start:', err);
  process.exit(1);
});
