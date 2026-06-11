import { afterEach, describe, expect, it, vi } from 'vitest';

describe('TypeBox format registration', () => {
  afterEach(() => {
    vi.doUnmock('typebox/format');
    vi.resetModules();
  });

  it('registers uuid and date-time when missing', async () => {
    const formats = new Map<string, (value: string) => boolean>();
    const Format = {
      Has: vi.fn((format: string) => formats.has(format)),
      Set: vi.fn((format: string, check: (value: string) => boolean) => {
        formats.set(format, check);
      }),
    };

    vi.doMock('typebox/format', () => Format);

    await import('./formats.js');

    expect(Format.Set).toHaveBeenCalledWith('uuid', expect.any(Function));
    expect(Format.Set).toHaveBeenCalledWith('date-time', expect.any(Function));
    expect(formats.get('uuid')?.('550e8400-e29b-41d4-a716-446655440000')).toBe(
      true,
    );
    expect(formats.get('uuid')?.('not-a-uuid')).toBe(false);
  });

  it('does not overwrite existing registrations', async () => {
    const Format = {
      Has: vi.fn(() => true),
      Set: vi.fn(),
    };

    vi.doMock('typebox/format', () => Format);

    await import('./formats.js');

    expect(Format.Set).not.toHaveBeenCalled();
  });
});
