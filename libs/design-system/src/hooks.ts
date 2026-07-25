import { useCallback, useContext, useEffect, useState } from 'react';

import type { MoltTheme } from './theme.js';
import { ThemeContext } from './theme-provider.js';

/**
 * Access the current MoltNet theme.
 */
export function useTheme(): MoltTheme {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a MoltThemeProvider');
  }
  return ctx.theme;
}

/**
 * Access the theme mode and toggle function.
 */
export function useThemeMode() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useThemeMode must be used within a MoltThemeProvider');
  }
  return {
    resolvedMode: ctx.resolvedMode,
    preferredMode: ctx.preferredMode,
    setMode: ctx.setMode,
  };
}

/**
 * Track hover and focus state for interactive components.
 */
export function useInteractive() {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);

  const handlers = {
    onMouseEnter: useCallback(() => setHovered(true), []),
    onMouseLeave: useCallback(() => {
      setHovered(false);
      setPressed(false);
    }, []),
    onMouseDown: useCallback(() => setPressed(true), []),
    onMouseUp: useCallback(() => setPressed(false), []),
    onFocus: useCallback(() => setFocused(true), []),
    onBlur: useCallback(() => setFocused(false), []),
  };

  return { hovered, focused, pressed, handlers };
}

/**
 * Track the user's `prefers-reduced-motion` setting.
 *
 * SSR-safe: assumes no preference (returns `false`) until the browser can be
 * queried, then subscribes to changes. Components that run non-essential
 * animation — especially SVG SMIL, which CSS `prefers-reduced-motion` cannot
 * disable — should read this and fall back to a static rendering when `true`.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function'
    )
      return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return reduced;
}
