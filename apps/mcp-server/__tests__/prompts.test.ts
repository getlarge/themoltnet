import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleIdentityBootstrap } from '../src/prompts.js';
import type { HandlerContext, McpDeps } from '../src/types.js';
import { createMockContext, createMockDeps, sdkErr, sdkOk } from './helpers.js';

vi.mock('@moltnet/api-client', () => ({
  getWhoami: vi.fn(),
  searchDiary: vi.fn(),
}));

import { getWhoami, searchDiary } from '@moltnet/api-client';

function getPromptText(result: { messages: { content: unknown }[] }): string {
  return (result.messages[0].content as { type: string; text: string }).text;
}

describe('identity_bootstrap prompt', () => {
  let deps: McpDeps;
  let context: HandlerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
    context = createMockContext();
  });

  it('returns auth error when not authenticated', async () => {
    const unauthContext = createMockContext(null);

    const result = await handleIdentityBootstrap(deps, unauthContext);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');
    expect(getPromptText(result)).toContain('not authenticated');
  });

  it('returns identity error when whoami API fails', async () => {
    vi.mocked(getWhoami).mockResolvedValue(
      sdkErr({
        error: 'Unauthorized',
        message: 'Unauthorized',
        statusCode: 401,
      }) as never,
    );

    const result = await handleIdentityBootstrap(deps, context);

    expect(getPromptText(result)).toContain('Failed to retrieve');
  });

  it('guides creation when no system entries exist', async () => {
    vi.mocked(getWhoami).mockResolvedValue(
      sdkOk({
        publicKey: 'pk-abc',
        fingerprint: 'A1B2-C3D4',
      }) as never,
    );
    vi.mocked(searchDiary).mockResolvedValue(sdkOk({ results: [] }) as never);

    const result = await handleIdentityBootstrap(deps, context);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');
    const text = getPromptText(result);
    expect(text).toContain('A1B2-C3D4');
    expect(text).toContain('pk-abc');
    expect(text).toContain('Whoami (missing)');
    expect(text).toContain('Soul (missing)');
    expect(text).toContain('["system", "identity"]');
    expect(text).toContain('["system", "soul"]');
  });

  it('confirms setup when both entries exist', async () => {
    vi.mocked(getWhoami).mockResolvedValue(
      sdkOk({
        publicKey: 'pk-abc',
        fingerprint: 'A1B2-C3D4',
      }) as never,
    );
    vi.mocked(searchDiary).mockResolvedValue(
      sdkOk({
        results: [
          {
            id: '1',
            content: 'I am Archon',
            tags: ['system', 'identity'],
            entryType: 'identity',
          },
          {
            id: '2',
            content: 'I value truth',
            tags: ['system', 'soul'],
            entryType: 'soul',
          },
        ],
      }) as never,
    );

    const result = await handleIdentityBootstrap(deps, context);

    const text = getPromptText(result);
    expect(text).toContain('Whoami (established)');
    expect(text).toContain('I am Archon');
    expect(text).toContain('Soul (established)');
    expect(text).toContain('I value truth');
    expect(text).not.toContain('diary_create');
  });

  it('shows mixed state when only whoami exists', async () => {
    vi.mocked(getWhoami).mockResolvedValue(
      sdkOk({
        publicKey: 'pk-abc',
        fingerprint: 'A1B2-C3D4',
      }) as never,
    );
    vi.mocked(searchDiary).mockResolvedValue(
      sdkOk({
        results: [
          {
            id: '1',
            content: 'I am Archon',
            tags: ['system', 'identity'],
            entryType: 'identity',
          },
        ],
      }) as never,
    );

    const result = await handleIdentityBootstrap(deps, context);

    const text = getPromptText(result);
    expect(text).toContain('Whoami (established)');
    expect(text).toContain('Soul (missing)');
  });
});
