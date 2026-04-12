import {
  createContext,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { darkTheme, lightTheme, type MoltTheme } from './theme.js';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface ThemeContextValue {
  theme: MoltTheme;
  setMode: (mode: 'dark' | 'light' | 'system') => void;
  resolvedMode: 'dark' | 'light';
  preferredMode: 'dark' | 'light' | 'system';
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

// ---------------------------------------------------------------------------
// System theme detection
// ---------------------------------------------------------------------------

function useSystemTheme(): 'dark' | 'light' {
  const [systemMode, setSystemMode] = useState<'dark' | 'light'>(() => {
    if (
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function'
    )
      return 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  });
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) =>
      setSystemMode(e.matches ? 'dark' : 'light');
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);
  return systemMode;
}

// ---------------------------------------------------------------------------
// CSS custom properties generation
// ---------------------------------------------------------------------------

function themeToCssVars(theme: MoltTheme): string {
  const c = theme.color;
  const f = theme.font;
  return [
    // Backgrounds
    `--molt-bg-void: ${c.bg.void}`,
    `--molt-bg-surface: ${c.bg.surface}`,
    `--molt-bg-elevated: ${c.bg.elevated}`,
    `--molt-bg-overlay: ${c.bg.overlay}`,
    // Primary
    `--molt-primary: ${c.primary.DEFAULT}`,
    `--molt-primary-hover: ${c.primary.hover}`,
    `--molt-primary-muted: ${c.primary.muted}`,
    `--molt-primary-subtle: ${c.primary.subtle}`,
    // Accent
    `--molt-accent: ${c.accent.DEFAULT}`,
    `--molt-accent-hover: ${c.accent.hover}`,
    `--molt-accent-muted: ${c.accent.muted}`,
    `--molt-accent-subtle: ${c.accent.subtle}`,
    // Text
    `--molt-text: ${c.text.DEFAULT}`,
    `--molt-text-secondary: ${c.text.secondary}`,
    `--molt-text-muted: ${c.text.muted}`,
    `--molt-text-inverse: ${c.text.inverse}`,
    // Border
    `--molt-border: ${c.border.DEFAULT}`,
    `--molt-border-hover: ${c.border.hover}`,
    `--molt-border-focus: ${c.border.focus}`,
    // Signals
    `--molt-error: ${c.error.DEFAULT}`,
    `--molt-error-muted: ${c.error.muted}`,
    `--molt-warning: ${c.warning.DEFAULT}`,
    `--molt-warning-muted: ${c.warning.muted}`,
    `--molt-success: ${c.success.DEFAULT}`,
    `--molt-success-muted: ${c.success.muted}`,
    `--molt-info: ${c.info.DEFAULT}`,
    `--molt-info-muted: ${c.info.muted}`,
    // Typography
    `--molt-font-sans: ${f.family.sans}`,
    `--molt-font-mono: ${f.family.mono}`,
  ].join('; ');
}

function generateGlobalStyles(): string {
  return `
[data-molt-theme] {
  color: var(--molt-text);
  background: var(--molt-bg-void);
  font-family: var(--molt-font-sans);
  font-size: 1rem;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

[data-molt-theme] *, [data-molt-theme] *::before, [data-molt-theme] *::after {
  box-sizing: border-box;
}
`.trim();
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export interface MoltThemeProviderProps {
  /** Initial theme mode. Defaults to 'dark'. */
  mode?: 'dark' | 'light' | 'system';
  children: ReactNode;
}

export function MoltThemeProvider({
  mode: initialMode = 'dark',
  children,
}: MoltThemeProviderProps) {
  const [preferredMode, setPreferredMode] = useState<
    'dark' | 'light' | 'system'
  >(initialMode);
  const systemMode = useSystemTheme();
  const resolvedMode = preferredMode === 'system' ? systemMode : preferredMode;
  const theme = resolvedMode === 'dark' ? darkTheme : lightTheme;

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setMode: setPreferredMode, resolvedMode, preferredMode }),
    [theme, resolvedMode, preferredMode],
  );

  const cssVars = useMemo(() => themeToCssVars(theme), [theme]);

  return (
    <ThemeContext.Provider value={value}>
      <style dangerouslySetInnerHTML={{ __html: generateGlobalStyles() }} />
      <div data-molt-theme={resolvedMode} style={parseCssVars(cssVars)}>
        {children}
      </div>
    </ThemeContext.Provider>
  );
}

/**
 * Parse a CSS custom properties string into a CSSProperties object.
 */
function parseCssVars(vars: string): React.CSSProperties {
  const result: Record<string, string> = {};
  for (const pair of vars.split(';')) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    const val = trimmed.slice(colonIdx + 1).trim();
    result[key] = val;
  }
  return result as React.CSSProperties;
}
