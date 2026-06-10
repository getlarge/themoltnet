import { beforeEach, describe, expect, it, vi } from 'vitest';

const { continueRecent, forkFrom, list, inMemory, createAgentSession, reload } =
  vi.hoisted(() => ({
    continueRecent: vi.fn(),
    forkFrom: vi.fn(),
    list: vi.fn(),
    inMemory: vi.fn(),
    createAgentSession: vi.fn(),
    reload: vi.fn(),
  }));

vi.mock('@earendil-works/pi-coding-agent', () => ({
  SessionManager: {
    continueRecent,
    forkFrom,
    list,
    inMemory,
  },
  DefaultResourceLoader: class {
    async reload() {
      await reload();
    }
  },
  createAgentSession,
}));

vi.mock('../otel/index.js', () => ({
  createPiOtelExtension: vi.fn(() => ({})),
}));

import { buildAgentSession } from './agent-session-factory.js';

describe('buildAgentSession', () => {
  beforeEach(() => {
    continueRecent.mockReset();
    forkFrom.mockReset();
    list.mockReset();
    inMemory.mockReset();
    createAgentSession.mockReset();
    reload.mockReset();

    continueRecent.mockReturnValue({ kind: 'continued' });
    forkFrom.mockReturnValue({ kind: 'forked' });
    inMemory.mockReturnValue({ kind: 'memory' });
    list.mockResolvedValue([]);
    createAgentSession.mockResolvedValue({ session: { id: 'session' } });
    reload.mockResolvedValue(undefined);
  });

  it('continues the persistent session by default', async () => {
    await buildAgentSession({
      mountPath: '/guest/workspace',
      cwdPath: '/guest/workspace',
      piAuthDir: '/agent',
      modelHandle: {} as never,
      customTools: [],
      appendSystemPrompt: ['runtime'],
      otelSpanAttrs: {},
      agentName: 'local-eval-943',
      sessionPersistence: { sessionDir: '/sessions/judge' },
    });

    expect(list).toHaveBeenCalledWith('/guest/workspace', '/sessions/judge');
    expect(continueRecent).toHaveBeenCalledWith(
      '/guest/workspace',
      '/sessions/judge',
    );
    expect(forkFrom).not.toHaveBeenCalled();
  });

  it('forks from the producer session when requested', async () => {
    await buildAgentSession({
      mountPath: '/guest/workspace',
      cwdPath: '/guest/workspace',
      piAuthDir: '/agent',
      modelHandle: {} as never,
      customTools: [],
      appendSystemPrompt: ['runtime'],
      otelSpanAttrs: {},
      agentName: 'local-eval-943',
      sessionPersistence: {
        sessionDir: '/sessions/judge',
        forkFromSessionPath: '/sessions/producer/session-a.jsonl',
      },
    });

    expect(forkFrom).toHaveBeenCalledWith(
      '/sessions/producer/session-a.jsonl',
      '/guest/workspace',
      '/sessions/judge',
    );
    expect(list).not.toHaveBeenCalled();
    expect(continueRecent).not.toHaveBeenCalled();
  });
});
