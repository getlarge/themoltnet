import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  colors,
  fontFamily,
  lightColors,
  radius,
} from '@themoltnet/design-system';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(SCRIPT_DIR, '..', '.vitepress', 'theme');
const OUT_FILE = join(OUT_DIR, 'vars.css');

mkdirSync(OUT_DIR, { recursive: true });

const css = `/* Auto-generated from @themoltnet/design-system tokens — do not edit */

:root,
.dark {
  --molt-bg-void: ${colors.bg.void};
  --molt-bg-surface: ${colors.bg.surface};
  --molt-bg-elevated: ${colors.bg.elevated};
  --molt-bg-overlay: ${colors.bg.overlay};

  --molt-primary: ${colors.primary.DEFAULT};
  --molt-primary-hover: ${colors.primary.hover};
  --molt-primary-muted: ${colors.primary.muted};
  --molt-primary-subtle: ${colors.primary.subtle};

  --molt-accent: ${colors.accent.DEFAULT};
  --molt-accent-hover: ${colors.accent.hover};
  --molt-accent-muted: ${colors.accent.muted};

  --molt-text: ${colors.text.DEFAULT};
  --molt-text-secondary: ${colors.text.secondary};
  --molt-text-muted: ${colors.text.muted};

  --molt-border: ${colors.border.DEFAULT};
  --molt-border-hover: ${colors.border.hover};
  --molt-border-focus: ${colors.border.focus};

  --molt-error: ${colors.error.DEFAULT};
  --molt-warning: ${colors.warning.DEFAULT};
  --molt-success: ${colors.success.DEFAULT};
  --molt-info: ${colors.info.DEFAULT};

  --molt-font-sans: ${fontFamily.sans};
  --molt-font-mono: ${fontFamily.mono};

  --molt-radius-sm: ${radius.sm};
  --molt-radius-md: ${radius.md};
  --molt-radius-lg: ${radius.lg};
  --molt-radius-xl: ${radius.xl};
}

html:not(.dark) {
  --molt-bg-void: ${lightColors.bg.void};
  --molt-bg-surface: ${lightColors.bg.surface};
  --molt-bg-elevated: ${lightColors.bg.elevated};
  --molt-bg-overlay: ${lightColors.bg.overlay};

  --molt-primary: ${lightColors.primary.DEFAULT};
  --molt-primary-hover: ${lightColors.primary.hover};
  --molt-primary-muted: ${lightColors.primary.muted};
  --molt-primary-subtle: ${lightColors.primary.subtle};

  --molt-accent: ${lightColors.accent.DEFAULT};
  --molt-accent-hover: ${lightColors.accent.hover};
  --molt-accent-muted: ${lightColors.accent.muted};

  --molt-text: ${lightColors.text.DEFAULT};
  --molt-text-secondary: ${lightColors.text.secondary};
  --molt-text-muted: ${lightColors.text.muted};

  --molt-border: ${lightColors.border.DEFAULT};
  --molt-border-hover: ${lightColors.border.hover};
  --molt-border-focus: ${lightColors.border.focus};

  --molt-error: ${lightColors.error.DEFAULT};
  --molt-warning: ${lightColors.warning.DEFAULT};
  --molt-success: ${lightColors.success.DEFAULT};
  --molt-info: ${lightColors.info.DEFAULT};
}
`;

writeFileSync(OUT_FILE, css, 'utf8');
console.log(`Wrote ${OUT_FILE}`);
