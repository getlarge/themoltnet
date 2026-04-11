import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useThemeMode } from '../hooks.js';
import { MoltThemeProvider } from '../theme-provider.js';

function ThemeModeDisplay() {
  const { resolvedMode, preferredMode, setMode } = useThemeMode();
  return (
    <div>
      <span data-testid="resolved">{resolvedMode}</span>
      <span data-testid="preferred">{preferredMode}</span>
      <button onClick={() => setMode('light')}>light</button>
      <button onClick={() => setMode('system')}>system</button>
    </div>
  );
}

describe('MoltThemeProvider system mode', () => {
  let matchMediaMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    matchMediaMock = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('dark'),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: matchMediaMock,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves system mode to dark when system prefers dark', () => {
    render(
      <MoltThemeProvider mode="system">
        <ThemeModeDisplay />
      </MoltThemeProvider>,
    );

    expect(screen.getByTestId('preferred').textContent).toBe('system');
    expect(screen.getByTestId('resolved').textContent).toBe('dark');
  });

  it('allows switching from system to explicit mode', () => {
    render(
      <MoltThemeProvider mode="system">
        <ThemeModeDisplay />
      </MoltThemeProvider>,
    );

    act(() => {
      screen.getByText('light').click();
    });

    expect(screen.getByTestId('preferred').textContent).toBe('light');
    expect(screen.getByTestId('resolved').textContent).toBe('light');
  });
});
