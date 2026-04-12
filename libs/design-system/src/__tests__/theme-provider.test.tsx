import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

function mockMatchMedia(prefersDark: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: prefersDark ? query.includes('dark') : false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

describe('MoltThemeProvider system mode', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves system mode to dark when system prefers dark', () => {
    mockMatchMedia(true);

    render(
      <MoltThemeProvider mode="system">
        <ThemeModeDisplay />
      </MoltThemeProvider>,
    );

    expect(screen.getByTestId('preferred').textContent).toBe('system');
    expect(screen.getByTestId('resolved').textContent).toBe('dark');
  });

  it('resolves system mode to light when system prefers light', () => {
    mockMatchMedia(false);

    render(
      <MoltThemeProvider mode="system">
        <ThemeModeDisplay />
      </MoltThemeProvider>,
    );

    expect(screen.getByTestId('preferred').textContent).toBe('system');
    expect(screen.getByTestId('resolved').textContent).toBe('light');
  });

  it('allows switching from system to explicit mode', () => {
    mockMatchMedia(true);

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
