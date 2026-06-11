import { afterEach, describe, expect, it, vi } from 'vitest';

describe('TypeBox format registration', () => {
  afterEach(() => {
    vi.doUnmock('@sinclair/typebox');
    vi.resetModules();
  });

  it('registers uuid and date-time when FormatRegistry is available', async () => {
    const formats = new Map<string, (value: string) => boolean>();
    const FormatRegistry = {
      Has: vi.fn((format: string) => formats.has(format)),
      Set: vi.fn((format: string, check: (value: string) => boolean) => {
        formats.set(format, check);
      }),
    };

    vi.doMock('@sinclair/typebox', () => ({ FormatRegistry }));

    await import('./formats.js');

    expect(FormatRegistry.Set).toHaveBeenCalledWith(
      'uuid',
      expect.any(Function),
    );
    expect(FormatRegistry.Set).toHaveBeenCalledWith(
      'date-time',
      expect.any(Function),
    );
    expect(formats.get('uuid')?.('550e8400-e29b-41d4-a716-446655440000')).toBe(
      true,
    );
    expect(formats.get('uuid')?.('not-a-uuid')).toBe(false);
  });

  it('does not crash when Pi aliases TypeBox without FormatRegistry', async () => {
    vi.doMock('@sinclair/typebox', () => ({
      FormatRegistry: undefined,
      Type: {},
    }));

    await expect(import('./formats.js')).resolves.toBeDefined();
  });

  it('throws when TypeBox exposes a malformed FormatRegistry', async () => {
    vi.doMock('@sinclair/typebox', () => ({
      FormatRegistry: {
        Has: true,
      },
    }));

    await expect(import('./formats.js')).rejects.toThrow(
      'Invalid TypeBox FormatRegistry export',
    );
  });
});
