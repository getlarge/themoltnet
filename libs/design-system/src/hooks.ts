import { useCallback, useContext, useState } from 'react';

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
 * Access the theme toggle function.
 */
export function useThemeMode() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useThemeMode must be used within a MoltThemeProvider');
  }
  return { mode: ctx.theme.mode, setMode: ctx.setMode };
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
