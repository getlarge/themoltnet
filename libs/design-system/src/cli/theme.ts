import { colors } from '../tokens.js';

/** Terminal-appropriate subset of MoltNet design tokens. */
export const cliTheme = {
  color: {
    primary: colors.primary.DEFAULT, // teal — network, active, borders
    accent: colors.accent.DEFAULT, // amber — identity values
    text: colors.text.DEFAULT, // body text
    muted: colors.text.secondary, // secondary/dim
    success: colors.success.DEFAULT, // ✓
    error: colors.error.DEFAULT, // ✗
    warning: colors.warning.DEFAULT, // ⚠
    border: colors.border.DEFAULT, // dividers
  },
} as const;
