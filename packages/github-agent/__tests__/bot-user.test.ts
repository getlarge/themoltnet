import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildBotEmail, lookupBotUser } from '../src/bot-user.js';

describe('lookupBotUser', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('should return bot user id and login', async () => {
    // Arrange
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ id: 261968324, login: 'legreffier[bot]' }),
        text: async () => '',
      })),
    );

    // Act
    const result = await lookupBotUser('legreffier');

    // Assert
    expect(result).toEqual({ id: 261968324, login: 'legreffier[bot]' });
    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/users/legreffier%5Bbot%5D');
  });

  it('should throw on non-ok response', async () => {
    // Arrange
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 404,
        text: async () => '{"message":"Not Found"}',
      })),
    );

    // Act & Assert
    await expect(lookupBotUser('nonexistent')).rejects.toThrow(
      'GitHub API error (404)',
    );
  });

  it('should use custom API base URL', async () => {
    // Arrange
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ id: 123, login: 'test[bot]' }),
        text: async () => '',
      })),
    );

    // Act
    await lookupBotUser('test', 'http://localhost:3000');

    // Assert
    const url = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(url).toMatch(/^http:\/\/localhost:3000\/users\//);
  });
});

describe('buildBotEmail', () => {
  it('should format the noreply email correctly', () => {
    expect(buildBotEmail(261968324, 'legreffier')).toBe(
      '261968324+legreffier[bot]@users.noreply.github.com',
    );
  });
});
