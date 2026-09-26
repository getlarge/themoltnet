import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  continueRecent,
  forkFrom,
  list,
  inMemory,
  createAgentSession,
  settingsManagerCreate,
  reload,
  resourceLoaderArgs,
} = vi.hoisted(() => ({
  continueRecent: vi.fn(),
  forkFrom: vi.fn(),
  list: vi.fn(),
  inMemory: vi.fn(),
  createAgentSession: vi.fn(),
  settingsManagerCreate: vi.fn(),
  reload: vi.fn(),
  resourceLoaderArgs: [] as Array<{
    extensionFactories?: unknown[];
    settingsManager?: unknown;
    noExtensions?: boolean;
    noPromptTemplates?: boolean;
    noThemes?: boolean;
  }>,
}));

vi.mock('@earendil-works/pi-coding-agent', () => ({
  SettingsManager: { create: settingsManagerCreate },
  SessionManager: {
    continueRecent,
    forkFrom,
    list,
    inMemory,
  },
  DefaultResourceLoader: class {
    constructor(args: (typeof resourceLoaderArgs)[number]) {
      resourceLoaderArgs.push(args);
    }

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
    settingsManagerCreate.mockReset();
    reload.mockReset();
    resourceLoaderArgs.length = 0;

    continueRecent.mockReturnValue({ kind: 'continued' });
    forkFrom.mockReturnValue({ kind: 'forked' });
    inMemory.mockReturnValue({ kind: 'memory' });
    list.mockResolvedValue([]);
    createAgentSession.mockResolvedValue({ session: { id: 'session' } });
    settingsManagerCreate.mockReturnValue({ kind: 'run-settings' });
    reload.mockResolvedValue(undefined);
  });

  it('continues the persistent session by default', async () => {
    const modelRuntime = {};
    await buildAgentSession({
      mountPath: '/guest/workspace',
      cwdPath: '/guest/workspace',
      piAuthDir: '/agent',
      modelHandle: {} as never,
      modelRuntime: modelRuntime as never,
      thinkingLevel: 'high',
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
    expect(createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        thinkingLevel: 'high',
        modelRuntime,
        settingsManager: { kind: 'run-settings' },
      }),
    );
    expect(settingsManagerCreate).toHaveBeenCalledWith(
      '/guest/workspace',
      '/agent',
      { projectTrusted: false },
    );
    expect(resourceLoaderArgs[0]).toEqual(
      expect.objectContaining({
        settingsManager: { kind: 'run-settings' },
        noExtensions: true,
        noPromptTemplates: true,
        noThemes: true,
      }),
    );
  });

  it('registers model option extensions only when model options are set', async () => {
    await buildAgentSession({
      mountPath: '/guest/workspace',
      cwdPath: '/guest/workspace',
      piAuthDir: '/agent',
      modelHandle: {} as never,
      modelRuntime: {} as never,
      customTools: [],
      appendSystemPrompt: ['runtime'],
      otelSpanAttrs: {},
      agentName: 'local-eval-943',
    });

    await buildAgentSession({
      mountPath: '/guest/workspace',
      cwdPath: '/guest/workspace',
      piAuthDir: '/agent',
      modelHandle: { provider: 'anthropic', id: 'claude-sonnet-4-5' } as never,
      modelRuntime: {} as never,
      temperature: 0.2,
      topP: 0.9,
      topK: 40,
      maxOutputTokens: 12_000,
      customTools: [],
      appendSystemPrompt: ['runtime'],
      otelSpanAttrs: {},
      agentName: 'local-eval-943',
    });

    expect(resourceLoaderArgs[0]?.extensionFactories).toHaveLength(1);
    expect(resourceLoaderArgs[1]?.extensionFactories).toHaveLength(2);
  });

  it('keeps modelRuntime optional for existing callers', async () => {
    await buildAgentSession({
      mountPath: '/guest/workspace',
      cwdPath: '/guest/workspace',
      piAuthDir: '/agent',
      modelHandle: {} as never,
      customTools: [],
      appendSystemPrompt: ['runtime'],
      otelSpanAttrs: {},
      agentName: 'legacy-caller',
    });

    expect(createAgentSession).toHaveBeenCalledWith(
      expect.not.objectContaining({ modelRuntime: expect.anything() }),
    );
  });

  it('forks from the producer session when requested', async () => {
    await buildAgentSession({
      mountPath: '/guest/workspace',
      cwdPath: '/guest/workspace',
      piAuthDir: '/agent',
      modelHandle: {} as never,
      modelRuntime: {} as never,
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
