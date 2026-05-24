import { colors, fontFamily, radius } from '@themoltnet/design-system/tokens';

/**
 * Mirror the design-system dark tokens into the `--molt-*` CSS variables the
 * app's stylesheet reads. Ported from libs/task-mcp-app; the host may override a
 * subset via `useHostStyleVariables`, but this guarantees a coherent baseline.
 */
export function applyThemeTokens(): void {
  const root = document.documentElement;
  const variables: Record<string, string> = {
    '--molt-bg-void': colors.bg.void,
    '--molt-bg-surface': colors.bg.surface,
    '--molt-bg-elevated': colors.bg.elevated,
    '--molt-primary': colors.primary.DEFAULT,
    '--molt-primary-hover': colors.primary.hover,
    '--molt-primary-muted': colors.primary.muted,
    '--molt-primary-subtle': colors.primary.subtle,
    '--molt-accent': colors.accent.DEFAULT,
    '--molt-accent-hover': colors.accent.hover,
    '--molt-text': colors.text.DEFAULT,
    '--molt-text-secondary': colors.text.secondary,
    '--molt-text-muted': colors.text.muted,
    '--molt-border': colors.border.DEFAULT,
    '--molt-border-hover': colors.border.hover,
    '--molt-font-sans': fontFamily.sans,
    '--molt-font-mono': fontFamily.mono,
    '--molt-radius-sm': radius.sm,
    '--molt-radius-md': radius.md,
    '--molt-radius-full': radius.full,
  };
  for (const [name, value] of Object.entries(variables)) {
    root.style.setProperty(name, value);
  }
}
