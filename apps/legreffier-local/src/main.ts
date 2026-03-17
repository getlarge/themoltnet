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
 *   MOLTNET_API_URL       — REST API base URL (default: https://api.themolt.net)
 *   LEGREFFIER_PORT       — SSE port (default: 0 = random)
 *   LEGREFFIER_TRANSPORT  — "stdio" or "sse" (default: sse)
 *   LEGREFFIER_TEACHER    — Teacher model (default: claude-opus-4-6)
 *   LEGREFFIER_STUDENT    — Student model (default: claude-sonnet-4-6)
 *   LEGREFFIER_IDLE_MS    — Idle timeout in ms (default: 7200000 = 2h)
 */

import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';

import mcpPlugin, { runStdioServer } from '@getlarge/fastify-mcp';
import { connect } from '@themoltnet/sdk';
import Fastify from 'fastify';

import { createAgentBundle } from './agent.js';
import { loadConfig } from './config.js';
import { registerTools } from './tools.js';
import type { LocalMcpDeps } from './types.js';

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
  // CLI flag --stdio overrides env var
  const transport = process.argv.includes('--stdio')
    ? 'stdio'
    : config.LEGREFFIER_TRANSPORT;
  const sessionId = randomUUID();

  const useStdio = transport === 'stdio';
  // In stdio mode, Fastify logs must go to stderr to keep stdout clean for MCP
  const app = Fastify({
    logger: useStdio
      ? {
          level: 'info',
          transport: { target: 'pino/file', options: { destination: 2 } },
        }
      : { level: 'info' },
  });

  // ── Authenticate via SDK ────────────────────────────────
  app.log.info('Connecting to MoltNet...');
  const sdkAgent = await connect({
    clientId: config.MOLTNET_CLIENT_ID,
    clientSecret: config.MOLTNET_CLIENT_SECRET,
    apiUrl: config.MOLTNET_API_URL,
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

  // ── Fetch diary entries for instruction context ─────────
  let identityContext: string | null = null;
  try {
    const [identity, soul] = await Promise.all([
      sdkAgent.entries.list(diaryId, { entryType: 'identity', limit: 5 }),
      sdkAgent.entries.list(diaryId, { entryType: 'soul', limit: 5 }),
    ]);
    const entries = [...(identity?.items ?? []), ...(soul?.items ?? [])];
    if (entries.length) {
      identityContext = entries.map((e) => e.content).join('\n\n');
    }
  } catch {
    app.log.warn('Could not fetch diary entries for context');
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
    gen.setInstruction(
      `${base}\n\n## Agent Context (from diary)\n${identityContext}`,
    );
    app.log.info('Loaded diary context into instruction');
  }

  // ── Health check ────────────────────────────────────────
  app.get('/healthz', () => ({ status: 'ok', sessionId, diaryId }));

  // ── Register MCP plugin (no auth — local only) ─────────
  await app.register(mcpPlugin, {
    serverInfo: { name: 'legreffier-local', version: '0.1.0' },
    capabilities: { tools: {} },
    enableSSE: !useStdio,
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
  if (useStdio) {
    app.log.info({ sessionId, diaryId }, 'Starting in stdio mode');
    await runStdioServer(app);
  } else {
    const address = await app.listen({
      port: config.LEGREFFIER_PORT,
      host: '127.0.0.1',
    });
    app.log.info(
      { address, sessionId, diaryId },
      'Legreffier local MCP server started (SSE)',
    );
  }

  // ── Idle shutdown ───────────────────────────────────────
  const idleCheck = setInterval(() => {
    if (Date.now() - deps.lastActivity > config.LEGREFFIER_IDLE_MS) {
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
  console.error('Failed to start:', err);
  process.exit(1);
});
