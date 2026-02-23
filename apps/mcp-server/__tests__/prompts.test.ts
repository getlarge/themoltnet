import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  handleIdentityBootstrap,
  handleWriteIdentity,
} from '../src/prompts.js';
import type { HandlerContext, McpDeps } from '../src/types.js';
import {
  createMockContext,
  createMockDeps,
  DIARY_ID,
  sdkErr,
  sdkOk,
} from './helpers.js';

vi.mock('@moltnet/api-client', () => ({
  getWhoami: vi.fn(),
  listDiaries: vi.fn(),
  searchDiary: vi.fn(),
}));

import { getWhoami, listDiaries, searchDiary } from '@moltnet/api-client';

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
    vi.mocked(listDiaries).mockResolvedValue(
      sdkOk({ items: [{ id: DIARY_ID }] }) as never,
    );
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
    expect(text).not.toContain('diary_create');
    expect(text).toContain('entries_create');
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

  it('confirms setup when both entries exist — no diary_create reference', async () => {
    vi.mocked(getWhoami).mockResolvedValue(
      sdkOk({ publicKey: 'pk-abc', fingerprint: 'A1B2-C3D4' }) as never,
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

    expect(getPromptText(result)).not.toContain('diary_create');
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

describe('write_identity prompt', () => {
  let deps: McpDeps;
  let context: HandlerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
    context = createMockContext();
  });

  it('returns auth error when not authenticated', async () => {
    const result = await handleWriteIdentity(
      { type: 'whoami', diary_id: DIARY_ID },
      deps,
      createMockContext(null),
    );

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

    const result = await handleWriteIdentity(
      { type: 'whoami', diary_id: DIARY_ID },
      deps,
      context,
    );

    expect(getPromptText(result)).toContain('Failed to retrieve');
  });

  it('whoami type: instructs entries_create with identity entry_type and moltnet visibility', async () => {
    vi.mocked(getWhoami).mockResolvedValue(
      sdkOk({ publicKey: 'pk-abc', fingerprint: 'A1B2-C3D4' }) as never,
    );

    const result = await handleWriteIdentity(
      { type: 'whoami', diary_id: DIARY_ID },
      deps,
      context,
    );

    const text = getPromptText(result);
    expect(text).toContain('entries_create');
    expect(text).toContain(`diary_id: "${DIARY_ID}"`);
    expect(text).toContain('entry_type: "identity"');
    expect(text).toContain('tags: ["system", "identity"]');
    expect(text).toContain('visibility: "moltnet"');
    expect(text).toContain('A1B2-C3D4');
    expect(text).not.toContain('diary_create');
  });

  it('soul type: instructs entries_create with soul entry_type and private visibility', async () => {
    vi.mocked(getWhoami).mockResolvedValue(
      sdkOk({ publicKey: 'pk-abc', fingerprint: 'A1B2-C3D4' }) as never,
    );

    const result = await handleWriteIdentity(
      { type: 'soul', diary_id: DIARY_ID },
      deps,
      context,
    );

    const text = getPromptText(result);
    expect(text).toContain('entries_create');
    expect(text).toContain(`diary_id: "${DIARY_ID}"`);
    expect(text).toContain('entry_type: "soul"');
    expect(text).toContain('tags: ["system", "soul"]');
    expect(text).toContain('visibility: "private"');
    expect(text).not.toContain('diary_create');
  });
});
